#!/usr/bin/env python3
"""PongLens pull-worker — runs on the Mac Studio.

Loop:
  1. pgmq.read('jobs') over a direct Postgres connection (30 min visibility)
  2. mark job processing
  3. download the upload — r2://bucket/key paths from Cloudflare R2 (S3 API),
     legacy bare paths from Supabase Storage (service role)
  4. run the TTVid pipeline: blurball inference -> cut_deadspace
  5. upload the trimmed video — R2 jobs go to
     ponglens-media/results/<user_id>/<job_id>.mp4 (result_path r2://...),
     legacy jobs keep going to the Supabase 'results' bucket
  6. mark done + archive the queue message

On failure: mark failed with the error; archive the message once it has been
attempted 3 times (poison-message guard), otherwise leave it to reappear
after the visibility timeout.

Daily retention sweep (SPEC.md §7; keep the Privacy Policy in step):
  - R2 ponglens-raw: raw uploads older than 7 days -> delete
  - R2 ponglens-media results/: cut videos older than 30 days -> delete
  - Later phases add tiers for point clips + match.json (keep while account
    active) and voice audio (90 days); wire them in here when they exist.
  - Legacy Supabase 'uploads' bucket: older than 30 days -> delete (until
    the last legacy rows age out, then this can go)

Dependencies:  pip3 install psycopg2-binary requests boto3
Secrets:       macOS Keychain (see worker/README.md) or env vars.
"""

import base64
import html
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timedelta, timezone

import boto3
import psycopg2
import psycopg2.extras
import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
TTVID = "/Users/adil/Desktop/Projects/TTVid"
VENV_PY = f"{TTVID}/vendor/venv/bin/python"          # numpy+cv2 (+torch)
BLURBALL_INFER = f"{TTVID}/vendor/blurball_infer.py"
POINTS_PIPELINE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "points_pipeline.py")

VALID_STRICTNESS = ("tight", "normal", "loose")

# YouTube import (jobs.kind = 'youtube_import', options.url).
# yt-dlp installed via Homebrew (`brew install yt-dlp`); currently pinned by
# whatever brew ships (2026.07.04 at setup time). YouTube changes break old
# versions, so when imports start failing with extractor errors run:
#   brew upgrade yt-dlp && launchctl kickstart -k gui/501/com.adil.ponglens-worker
YTDLP = os.environ.get("YTDLP_PATH") or shutil.which("yt-dlp") \
    or "/opt/homebrew/bin/yt-dlp"
# mp4/h264 <= 1080p keeps the file compatible with the existing pipeline
# (blurball + ffmpeg cut) without a re-encode step.
YTDLP_FORMAT = "bv*[ext=mp4][height<=1080]+ba[ext=m4a]/b[ext=mp4]"
YT_MAX_DURATION_S = 45 * 60          # matches product positioning (one match)
YT_MAX_BYTES = 2 * 1024**3           # same 2 GB cap as direct uploads


# Upfront content check — a cheap vision call rejects non-table-tennis
# uploads BEFORE blurball/cut/points burn GPU time. gpt-5-nano chosen after
# a bake-off (gpt-4.1-nano rubber-stamped "yes" on pure test-pattern frames;
# gpt-5-nano got both positive and negative sets right, ~2-4 s, ~2.7k prompt
# + ~100 completion tokens ≈ $0.0002/check at $0.05/$0.40 per Mtok).
# FAIL OPEN on any API problem: availability beats gating.
CONTENT_CHECK_MODEL = os.environ.get("WORKER_CONTENT_CHECK_MODEL",
                                     "gpt-5-nano")
CONTENT_CHECK_FRAMES = 12            # sampled evenly, skipping first/last 3%
CONTENT_CHECK_MIN_POSITIVE = 3       # reject only if fewer frames are TT
CONTENT_CHECK_TIMEOUT_S = 10         # per socket op; slow API = fail open
CONTENT_CHECK_REJECT_MSG = ("This doesn't look like a table tennis video. "
                            "Upload a match and try again.")
SKIP_CONTENT_CHECK = os.environ.get(
    "WORKER_SKIP_CONTENT_CHECK", "").lower() not in ("", "0", "false")
OPENAI_BASE_URL = os.environ.get(
    "WORKER_OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")


class UserFacingError(Exception):
    """A job failure whose message is safe to show to the user verbatim.
    Deterministic (retrying won't help), so the queue message is archived
    immediately instead of burning the usual 3 attempts."""

POLL_SLEEP_S = 15          # idle sleep between empty queue reads
VISIBILITY_S = 1800        # pgmq visibility timeout (30 min per attempt)
MAX_READ_CT = 3            # archive (give up) after this many attempts
CLEANUP_EVERY_S = 24 * 3600
LEGACY_UPLOAD_RETENTION_DAYS = 30   # Supabase 'uploads' bucket (legacy rows)

# R2 storage (SPEC.md §7)
R2_RAW_BUCKET = "ponglens-raw"
R2_MEDIA_BUCKET = "ponglens-media"
R2_RAW_RETENTION_DAYS = 7           # raw uploads
R2_RESULTS_RETENTION_DAYS = 30      # cut videos under results/
R2_VOICE_RETENTION_DAYS = 90        # voice note audio under voice/
                                    # (transcripts live in Postgres forever)

WORKER_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(WORKER_DIR, "worker.log")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.FileHandler(LOG_PATH), logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("ponglens-worker")


def keychain(service: str) -> str | None:
    try:
        return (
            subprocess.check_output(
                ["security", "find-generic-password", "-a", "openclaw",
                 "-s", service, "-w"],
                stderr=subprocess.DEVNULL,
            )
            .decode()
            .strip()
        )
    except subprocess.CalledProcessError:
        return None


def require(value: str | None, hint: str) -> str:
    if not value:
        log.error("Missing secret: %s", hint)
        sys.exit(1)
    return value


DATABASE_URL = require(
    os.environ.get("DATABASE_URL") or keychain("ponglens-db-url"),
    "DATABASE_URL env var or Keychain item 'ponglens-db-url'",
)
SERVICE_ROLE_KEY = require(
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or keychain("ponglens-service-role"),
    "SUPABASE_SERVICE_ROLE_KEY env var or Keychain item 'ponglens-service-role'",
)
SUPABASE_URL = require(
    os.environ.get("SUPABASE_URL") or keychain("ponglens-supabase-url"),
    "SUPABASE_URL env var or Keychain item 'ponglens-supabase-url' "
    "(https://<ref>.supabase.co)",
).rstrip("/")

STORAGE_HEADERS = {
    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
    "apikey": SERVICE_ROLE_KEY,
}

# Cloudflare R2 (S3-compatible). Required for all new jobs; legacy
# Supabase-path jobs still work without it, so fail lazily, not at boot.
R2_ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID") or keychain("ponglens-r2-account")
R2_ACCESS_KEY_ID = (
    os.environ.get("R2_ACCESS_KEY_ID") or keychain("ponglens-r2-key-id")
)
R2_SECRET_ACCESS_KEY = (
    os.environ.get("R2_SECRET_ACCESS_KEY") or keychain("ponglens-r2-secret")
)

_r2_client = None


def r2():
    """Lazily-constructed boto3 S3 client pointed at R2."""
    global _r2_client
    if _r2_client is None:
        if not (R2_ACCOUNT_ID and R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY):
            raise RuntimeError(
                "R2 credentials missing: need Keychain items "
                "'ponglens-r2-account' / 'ponglens-r2-key-id' / "
                "'ponglens-r2-secret' (or env vars)"
            )
        _r2_client = boto3.client(
            "s3",
            endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            region_name="auto",
        )
    return _r2_client


def parse_r2_path(path: str) -> tuple[str, str] | None:
    """'r2://bucket/key/parts' -> ('bucket', 'key/parts'), else None."""
    if not path.startswith("r2://"):
        return None
    rest = path[len("r2://"):]
    bucket, _, key = rest.partition("/")
    if not bucket or not key:
        raise RuntimeError(f"malformed r2 path: {path}")
    return bucket, key

# Email notifications (Resend, send-only key). Optional: if the key is
# missing we log and carry on — email must never affect job processing.
RESEND_API_KEY = os.environ.get("PONGLENS_RESEND_KEY") or keychain(
    "ponglens-resend-key"
)

# OpenAI key for the upfront content check. Optional: if missing, the check
# is skipped (fail open) — it must never block job processing.
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY") or keychain("openai-api-key")
EMAIL_FROM = "PongLens <noreply@ponglens.com>"
ADMIN_EMAIL = "adilharis2001@gmail.com"
DASHBOARD_URL = "https://ponglens.com/dashboard"


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------
def connect():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    return conn


def read_message(conn):
    """Read one message from the pgmq 'jobs' queue, or None."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "select msg_id, read_ct, message from pgmq.read('jobs', %s, %s)",
            (VISIBILITY_S, 1),
        )
        return cur.fetchone()


def archive_message(conn, msg_id: int):
    with conn.cursor() as cur:
        cur.execute("select pgmq.archive('jobs', %s::bigint)", (msg_id,))


def update_job(conn, job_id: str, **fields):
    cols = ", ".join(f"{k} = %s" for k in fields)
    with conn.cursor() as cur:
        cur.execute(
            f"update public.jobs set {cols} where id = %s",
            [*fields.values(), job_id],
        )


# ---------------------------------------------------------------------------
# Storage ledger (migration 010): every R2 write appends a positive row,
# every delete a negative one; a user's usage is sum(bytes). Accounting is
# best-effort — it must never fail a job or the retention sweep.
# ---------------------------------------------------------------------------
def ledger_append(conn, user_id: str, kind: str, num_bytes: int,
                  r2_key: str | None = None, match_id: str | None = None):
    try:
        with conn.cursor() as cur:
            cur.execute(
                "insert into public.storage_ledger "
                "(user_id, match_id, kind, bytes, r2_key) "
                "values (%s, %s, %s, %s, %s)",
                (user_id, match_id, kind, int(num_bytes), r2_key),
            )
    except Exception as e:
        log.warning("  ledger append failed (non-fatal): %s", e)


def ledger_negate_keys(conn, r2_keys: list[str]):
    """Zero out the net-positive balance of each 'r2://bucket/key' URI
    (idempotent; see public._ledger_negate_keys)."""
    if not r2_keys:
        return
    try:
        with conn.cursor() as cur:
            cur.execute("select public._ledger_negate_keys(%s)", (r2_keys,))
    except Exception as e:
        log.warning("  ledger negate failed (non-fatal): %s", e)


# ---------------------------------------------------------------------------
# Storage helpers (Supabase Storage REST API, service role)
# ---------------------------------------------------------------------------
def storage_download(bucket: str, path: str, dest: str):
    url = f"{SUPABASE_URL}/storage/v1/object/{bucket}/{path}"
    with requests.get(url, headers=STORAGE_HEADERS, stream=True, timeout=600) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=8 * 1024 * 1024):
                f.write(chunk)


def storage_upload(bucket: str, path: str, src: str, content_type="video/mp4"):
    url = f"{SUPABASE_URL}/storage/v1/object/{bucket}/{path}"
    with open(src, "rb") as f:
        r = requests.post(
            url,
            headers={**STORAGE_HEADERS, "Content-Type": content_type,
                     "x-upsert": "true"},
            data=f,
            timeout=1800,
        )
    r.raise_for_status()


def storage_delete(bucket: str, paths: list[str]):
    url = f"{SUPABASE_URL}/storage/v1/object/{bucket}"
    r = requests.delete(
        url,
        headers={**STORAGE_HEADERS, "Content-Type": "application/json"},
        json={"prefixes": paths},
        timeout=120,
    )
    r.raise_for_status()


# ---------------------------------------------------------------------------
# Email notifications (Resend) — strictly best-effort, never fatal.
# The domain may not be verified yet, so 4xx responses are expected for a
# while; we log and move on without touching job status.
# ---------------------------------------------------------------------------
def send_email(to: str, subject: str, html_body: str, bcc: str | None = None):
    if not RESEND_API_KEY:
        log.warning("email skipped (no Resend key in Keychain): %s", subject)
        return
    payload: dict = {
        "from": EMAIL_FROM,
        "to": [to],
        "subject": subject,
        "html": html_body,
    }
    if bcc:
        payload["bcc"] = [bcc]
    r = requests.post(
        "https://api.resend.com/emails",
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=30,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"Resend {r.status_code}: {r.text[:300]}")
    log.info("  email sent: %r -> %s", subject, to)


def get_user_email(conn, user_id: str) -> str | None:
    with conn.cursor() as cur:
        cur.execute("select email from auth.users where id = %s", (user_id,))
        row = cur.fetchone()
    return row[0] if row and row[0] else None


def get_job_original_name(conn, job_id: str) -> str | None:
    with conn.cursor() as cur:
        cur.execute(
            "select original_name from public.jobs where id = %s", (job_id,)
        )
        row = cur.fetchone()
    return row[0] if row and row[0] else None


def done_email_html(original_name: str) -> str:
    name = html.escape(original_name)
    return f"""\
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Your trimmed match video is ready to download.&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background-color:#f4f5f7;">
  <tr>
    <td align="center" style="padding:48px 16px;background-color:#f4f5f7;">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:16px;">
        <tr>
          <td align="center" style="padding:40px 32px 36px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <img src="https://www.ponglens.com/img/email-logo.png" width="180" height="44" alt="PongLens" style="display:block;width:180px;height:44px;border:0;margin:0 auto 28px;">
            <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;font-weight:700;color:#0f172a;">Your match is ready</h1>
            <p style="margin:0 0 28px;font-size:14px;line-height:1.6;color:#475569;">
              We trimmed the dead time out of
              <strong style="color:#0f172a;word-break:break-word;">{name}</strong>.
              What's left is pure play.
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
              <tr>
                <td align="center" style="background-color:#0891b2;border-radius:999px;">
                  <a href="{DASHBOARD_URL}" style="display:inline-block;padding:13px 30px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;line-height:1;color:#ffffff;text-decoration:none;border-radius:999px;">Download your video</a>
                </td>
              </tr>
            </table>
            <p style="margin:32px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">Sent by PongLens &middot; ponglens.com</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
"""


def notify_job_done(conn, job_id: str, user_id: str):
    """Email the uploader that their video is ready. Never raises."""
    try:
        original_name = get_job_original_name(conn, job_id) or "your match video"
        body = done_email_html(original_name)
        to = get_user_email(conn, user_id)
        if to:
            send_email(to, "Your match is ready", body, bcc=ADMIN_EMAIL)
        else:
            log.warning("  no email found for user %s; notifying admin only",
                        user_id)
            send_email(ADMIN_EMAIL, "Your match is ready", body)
    except Exception as e:
        log.warning("  done email failed (non-fatal): %s", e)


def notify_job_failed(job_id: str, error: str):
    """Email the admin about a failed job. Never raises."""
    try:
        body = (
            "<div style=\"font-family:monospace;font-size:13px;\">"
            f"<p>PongLens job failed.</p>"
            f"<p><strong>Job:</strong> {html.escape(job_id)}</p>"
            f"<p><strong>Error:</strong> {html.escape(error[:1000])}</p>"
            "</div>"
        )
        send_email(ADMIN_EMAIL, f"PongLens job failed: {job_id[:8]}", body)
    except Exception as e:
        log.warning("  failure email failed (non-fatal): %s", e)


# ---------------------------------------------------------------------------
# App config (migration 014) — non-secret settings the app + worker share.
# ---------------------------------------------------------------------------
def get_config(conn, key: str) -> str | None:
    with conn.cursor() as cur:
        cur.execute("select value from public.app_config where key = %s",
                    (key,))
        row = cur.fetchone()
    return row[0] if row else None


def set_config(conn, key: str, value: str):
    with conn.cursor() as cur:
        cur.execute(
            "insert into public.app_config (key, value) values (%s, %s) "
            "on conflict (key) do update set value = excluded.value",
            (key, value),
        )


# ---------------------------------------------------------------------------
# Daily feedback digest (Feedback 2.0) — once per Toronto day, everything
# posted to feedback_items in the last 24 h plus a standing top-5 board
# leaderboard, mailed to app_config.digest_recipient via Resend. No new
# items -> nothing is sent (the day is still marked as handled).
# ---------------------------------------------------------------------------
DIGEST_CHECK_EVERY_S = 15 * 60
DIGEST_TZ = "America/Toronto"

_FEEDBACK_SECTION_STYLE = (
    "margin:24px 0 0;padding:0;text-align:left;"
)


def _digest_item_html(item: dict) -> str:
    """One feedback item as a light-theme card row."""
    title = html.escape(item["title"] or "")
    body_txt = html.escape(item["body"] or "")
    who = html.escape(item["author"] or "someone")
    votes = int(item["vote_count"] or 0)
    qa_html = ""
    for pair in (item["qa"] or []):
        if not isinstance(pair, dict):
            continue
        q = html.escape(str(pair.get("q", "")))
        a = html.escape(str(pair.get("a", "")))
        qa_html += (
            f"<p style='margin:8px 0 0;font-size:12px;line-height:1.5;"
            f"color:#64748b;'><em>{q}</em><br>"
            f"<span style='color:#334155;'>{a}</span></p>"
        )
    meta = f"{who} &middot; {votes} vote{'s' if votes != 1 else ''}"
    return (
        "<div style='margin:12px 0 0;padding:14px 16px;background:#f8fafc;"
        "border:1px solid #e2e8f0;border-radius:12px;'>"
        f"<p style='margin:0;font-size:14px;font-weight:700;color:#0f172a;'>"
        f"{title}</p>"
        f"<p style='margin:6px 0 0;font-size:13px;line-height:1.55;"
        f"color:#475569;white-space:pre-wrap;'>{body_txt}</p>"
        f"{qa_html}"
        f"<p style='margin:8px 0 0;font-size:11px;color:#94a3b8;'>{meta}</p>"
        "</div>"
    )


def _digest_section(title: str, items: list[dict]) -> str:
    if not items:
        return ""
    rows = "".join(_digest_item_html(i) for i in items)
    return (
        f"<div style='{_FEEDBACK_SECTION_STYLE}'>"
        f"<h2 style='margin:0;font-size:15px;font-weight:700;"
        f"color:#0f172a;'>{html.escape(title)}</h2>{rows}</div>"
    )


def feedback_digest_html(new_items: list[dict],
                         leaderboard: list[dict]) -> str:
    bugs = [i for i in new_items
            if i["type"] == "bug" and i["visibility"] == "board"]
    ideas = [i for i in new_items
             if i["type"] != "bug" and i["visibility"] == "board"]
    private = [i for i in new_items if i["visibility"] == "private"]

    lb_rows = ""
    for rank, item in enumerate(leaderboard, 1):
        lb_rows += (
            "<tr>"
            f"<td style='padding:6px 10px 6px 0;font-size:13px;"
            f"color:#94a3b8;'>{rank}.</td>"
            f"<td style='padding:6px 0;font-size:13px;color:#0f172a;"
            f"text-align:left;'>{html.escape(item['title'])}</td>"
            f"<td style='padding:6px 0 6px 12px;font-size:13px;"
            f"font-weight:700;color:#0891b2;text-align:right;'>"
            f"&#9650; {int(item['vote_count'] or 0)}</td>"
            "</tr>"
        )
    leaderboard_html = (
        f"<div style='{_FEEDBACK_SECTION_STYLE}'>"
        "<h2 style='margin:0;font-size:15px;font-weight:700;color:#0f172a;'>"
        "Top of the board</h2>"
        "<table role='presentation' cellpadding='0' cellspacing='0' "
        "border='0' style='margin-top:8px;width:100%;'>"
        f"{lb_rows}</table></div>"
    ) if lb_rows else ""

    n = len(new_items)
    return f"""\
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">{n} new feedback item{'s' if n != 1 else ''} in the last day.&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background-color:#f4f5f7;">
  <tr>
    <td align="center" style="padding:48px 16px;background-color:#f4f5f7;">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:16px;">
        <tr>
          <td style="padding:40px 32px 36px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <img src="https://www.ponglens.com/img/email-logo.png" width="180" height="44" alt="PongLens" style="display:block;width:180px;height:44px;border:0;margin:0 auto 28px;">
            <h1 style="margin:0;font-size:20px;line-height:1.3;font-weight:700;color:#0f172a;text-align:center;">Feedback digest</h1>
            <p style="margin:8px 0 0;font-size:13px;line-height:1.5;color:#64748b;text-align:center;">{n} new item{'s' if n != 1 else ''} in the last 24 hours.</p>
            {_digest_section('Bugs', bugs)}
            {_digest_section('Ideas &amp; improvements', ideas)}
            {_digest_section('Private reports', private)}
            {leaderboard_html}
            <p style="margin:32px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;text-align:center;">Sent by PongLens &middot; <a href="https://www.ponglens.com/feedback" style="color:#0891b2;text-decoration:none;">open the board</a></p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
"""


def maybe_send_feedback_digest(conn):
    """Once per Toronto calendar day: mail new feedback (if any). Tracks the
    last handled day in app_config.digest_last_sent. Never raises."""
    try:
        from zoneinfo import ZoneInfo
        today = datetime.now(ZoneInfo(DIGEST_TZ)).strftime("%Y-%m-%d")
        if get_config(conn, "digest_last_sent") == today:
            return

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "select i.title, i.body, i.type, i.visibility, i.qa, "
                "       i.vote_count, i.created_at, "
                "       coalesce(nullif(trim(u.raw_user_meta_data ->> "
                "'full_name'), ''), split_part(u.email, '@', 1)) as author "
                "from public.feedback_items i "
                "join auth.users u on u.id = i.user_id "
                "where i.created_at >= now() - interval '24 hours' "
                "and i.status <> 'declined' "
                "order by i.created_at",
            )
            new_items = [dict(r) for r in cur.fetchall()]
            cur.execute(
                "select title, vote_count from public.feedback_items "
                "where visibility = 'board' "
                "and status not in ('done', 'declined') "
                "order by vote_count desc, created_at desc limit 5",
            )
            leaderboard = [dict(r) for r in cur.fetchall()]

        if new_items:
            to = (get_config(conn, "digest_recipient") or "").strip() \
                or ADMIN_EMAIL
            n = len(new_items)
            send_email(
                to,
                f"PongLens feedback: {n} new item{'s' if n != 1 else ''}",
                feedback_digest_html(new_items, leaderboard),
            )
            log.info("feedback digest sent to %s (%d new item(s))", to, n)
        else:
            log.info("feedback digest: nothing new in the last 24 h")
        set_config(conn, "digest_last_sent", today)
    except Exception as e:
        log.warning("feedback digest failed (non-fatal): %s", e)


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------
def run_pipeline(input_video: str, workdir: str,
                 strictness: str = "normal") -> tuple[str, str]:
    """blurball inference -> dead-space cut (ported cut_deadspace with
    strictness paddings). Returns (trimmed mp4, blurball jsonl)."""
    blurball_out = os.path.join(workdir, "blurball.jsonl")
    result = os.path.join(workdir, "result.mp4")

    log.info("  running blurball inference (this is the slow part)…")
    subprocess.run(
        [VENV_PY, BLURBALL_INFER, "--video", input_video, "--out", blurball_out],
        check=True, cwd=workdir, timeout=4 * 3600,
    )

    log.info("  cutting dead space (strictness=%s)…", strictness)
    subprocess.run(
        [VENV_PY, POINTS_PIPELINE, "cut", "--blurball", blurball_out,
         "--video", input_video, "--out", result,
         "--strictness", strictness],
        check=True, cwd=workdir, timeout=2 * 3600,
    )

    if not os.path.exists(result) or os.path.getsize(result) == 0:
        raise RuntimeError("pipeline produced no output file")
    return result, blurball_out


def get_job_options(conn, job_id: str, payload: dict) -> dict:
    """Job options: prefer the queue payload, fall back to the row."""
    opts = payload.get("options")
    if isinstance(opts, dict):
        return opts
    with conn.cursor() as cur:
        cur.execute("select options from public.jobs where id = %s",
                    (job_id,))
        row = cur.fetchone()
    return row[0] if row and isinstance(row[0], dict) else {}


# ---------------------------------------------------------------------------
# Points stage (SPEC.md §6) — runs on the ORIGINAL video after the cut.
# Outputs: r2://ponglens-media/points/<userId>/<matchId>/{NN.mp4,match.json},
# a matches row and one points row per detected point.
# ---------------------------------------------------------------------------
VALID_MATCH_TYPES = {"practice", "league", "tournament"}


def create_match(conn, match_id: str, user_id: str, job_id: str,
                 cut_path: str, opponent_name: str | None = None,
                 match_type: str | None = None):
    with conn.cursor() as cur:
        cur.execute(
            "insert into public.matches (id, user_id, job_id, cut_path, "
            "status, opponent_name, match_type) "
            "values (%s, %s, %s, %s, 'processing', %s, %s)",
            (match_id, user_id, job_id, cut_path, opponent_name, match_type),
        )


def finish_match(conn, match_id: str, status: str,
                 match_json_path: str | None = None):
    with conn.cursor() as cur:
        cur.execute(
            "update public.matches set status = %s, "
            "match_json_path = coalesce(%s, match_json_path) where id = %s",
            (status, match_json_path, match_id),
        )


def insert_points(conn, match_id: str, points: list[dict], prefix: str):
    with conn.cursor() as cur:
        for p in points:
            cur.execute(
                "insert into public.points (match_id, idx, t0, t1, "
                "clip_path, server, placement, suggestion, cut_t0) "
                "values (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (match_id, p["idx"], p["t0"], p["t1"],
                 f"{prefix}/{p['clip']}", p.get("server"),
                 json.dumps(p["placement"]) if p.get("placement") else None,
                 json.dumps(p["suggestion"]) if p.get("suggestion")
                 else None,
                 p.get("cut_t0")),
            )


def run_points_stage(conn, job_id: str, user_id: str, input_video: str,
                     blurball_out: str, workdir: str, options: dict,
                     cut_result_path: str):
    """Break the original video into points. Failure here never fails the
    job (the cut already shipped): the match row is marked failed."""
    strictness = options.get("strictness", "normal")
    if strictness not in VALID_STRICTNESS:
        strictness = "normal"
    match_id = str(uuid.uuid4())
    # Upload-form metadata rides on jobs.options.meta (upload sheet).
    meta = options.get("meta") if isinstance(options.get("meta"), dict) else {}
    opponent_name = (meta.get("opponent_name") or "").strip()[:120] or None
    match_type = meta.get("match_type")
    if match_type not in VALID_MATCH_TYPES:
        match_type = None
    create_match(conn, match_id, user_id, job_id, cut_result_path,
                 opponent_name=opponent_name, match_type=match_type)
    outdir = os.path.join(workdir, "points_out")
    try:
        cmd = [VENV_PY, POINTS_PIPELINE, "points",
               "--blurball", blurball_out, "--video", input_video,
               "--outdir", outdir, "--strictness", strictness]
        if options.get("placement"):
            cmd.append("--placement")
        log.info("  points pipeline (strictness=%s placement=%s)…",
                 strictness, bool(options.get("placement")))
        subprocess.run(cmd, check=True, cwd=workdir, timeout=6 * 3600)

        with open(os.path.join(outdir, "match.json")) as fh:
            match_json = json.load(fh)
        points = match_json["points"]
        if not points:
            raise RuntimeError("points pipeline found no points")

        key_prefix = f"points/{user_id}/{match_id}"
        r2_prefix = f"r2://{R2_MEDIA_BUCKET}/{key_prefix}"
        clip_bytes = 0
        for p in points:
            local = os.path.join(outdir, p["clip"])
            clip_bytes += os.path.getsize(local)
            r2().upload_file(
                local, R2_MEDIA_BUCKET, f"{key_prefix}/{p['clip'].split('/')[-1]}",
                ExtraArgs={"ContentType": "video/mp4"},
            )
        # store clip paths flat under the match folder: NN.mp4
        for p in points:
            p["clip"] = p["clip"].split("/")[-1]
        other_bytes = os.path.getsize(os.path.join(outdir, "match.json"))
        r2().upload_file(
            os.path.join(outdir, "match.json"), R2_MEDIA_BUCKET,
            f"{key_prefix}/match.json",
            ExtraArgs={"ContentType": "application/json"},
        )
        calib_dbg = os.path.join(outdir, "calib_debug.jpg")
        if os.path.exists(calib_dbg):
            other_bytes += os.path.getsize(calib_dbg)
            r2().upload_file(calib_dbg, R2_MEDIA_BUCKET,
                             f"{key_prefix}/calib_debug.jpg",
                             ExtraArgs={"ContentType": "image/jpeg"})

        # Storage ledger: rows carry match_id, so match deletion (010
        # trigger) frees them; r2_key is the folder prefix for reference.
        ledger_append(conn, user_id, "clip", clip_bytes,
                      f"{r2_prefix}/", match_id)
        ledger_append(conn, user_id, "other", other_bytes,
                      f"{r2_prefix}/", match_id)

        insert_points(conn, match_id, points, r2_prefix)
        finish_match(conn, match_id, "ready",
                     f"{r2_prefix}/match.json")
        log.info("  match %s ready: %d points -> %s",
                 match_id, len(points), r2_prefix)
        return match_id
    except Exception as e:
        log.exception("  points stage failed (cut already delivered): %s", e)
        try:
            finish_match(conn, match_id, "failed")
        except Exception:
            log.exception("  failed to mark match failed")
        notify_job_failed(job_id, f"points stage: {e}")
        return None


# ---------------------------------------------------------------------------
# YouTube import (kind 'youtube_import') — fetch with yt-dlp, land the file
# in R2 exactly where a direct upload would go, then run the normal pipeline.
# ---------------------------------------------------------------------------
_YT_ERROR_MAP = (
    # (needle in yt-dlp stderr, plain message for the user)
    ("private video", "That video is private or unavailable."),
    ("video unavailable", "That video is private or unavailable."),
    ("this video is not available", "That video is private or unavailable."),
    ("account associated with this video has been terminated",
     "That video is private or unavailable."),
    ("removed by the uploader", "That video is private or unavailable."),
    ("sign in to confirm your age", "That video is age-restricted, so we "
     "can't fetch it. Please upload the file instead."),
    ("age-restricted", "That video is age-restricted, so we can't fetch it. "
     "Please upload the file instead."),
    ("sign in to confirm", "YouTube wouldn't let us fetch that video. "
     "Please upload the file instead."),
    ("members-only", "That video is members-only, so we can't fetch it."),
    ("live event", "That looks like a live stream. Import it after the "
     "stream has ended."),
    ("is not a valid url", "That doesn't look like a YouTube video link."),
    ("unsupported url", "That doesn't look like a YouTube video link."),
)


def _yt_user_error(stderr: str) -> str | None:
    low = (stderr or "").lower()
    for needle, message in _YT_ERROR_MAP:
        if needle in low:
            return message
    return None


def _run_ytdlp(args: list[str], timeout: int) -> subprocess.CompletedProcess:
    if not os.path.exists(YTDLP):
        raise RuntimeError(
            f"yt-dlp not found at {YTDLP} — `brew install yt-dlp`")
    proc = subprocess.run(
        [YTDLP, "--no-playlist", "--no-progress", *args],
        capture_output=True, text=True, timeout=timeout,
    )
    if proc.returncode != 0:
        friendly = _yt_user_error(proc.stderr)
        if friendly:
            raise UserFacingError(friendly)
        raise RuntimeError(
            f"yt-dlp failed (rc={proc.returncode}): "
            f"{(proc.stderr or '')[-400:]}"
        )
    return proc


def fetch_youtube(conn, job_id: str, user_id: str, options: dict,
                  workdir: str) -> tuple[str, str]:
    """Download options['url'] with yt-dlp, enforce duration/size limits,
    upload the file to ponglens-raw (same key shape as a direct upload) and
    stamp it on the job row. Returns (local_path, r2_input_path)."""
    url = options.get("url")
    if not isinstance(url, str) or not url.startswith("https://www.youtube.com/"):
        raise UserFacingError("That doesn't look like a YouTube video link.")

    # 1. Probe first: cheap, and lets us reject long/live videos pre-download.
    log.info("  probing %s", url)
    probe = _run_ytdlp(["--dump-single-json", "--skip-download", url],
                       timeout=120)
    try:
        info = json.loads(probe.stdout)
    except json.JSONDecodeError:
        raise RuntimeError("yt-dlp probe returned unparseable JSON")
    if info.get("is_live"):
        raise UserFacingError("That looks like a live stream. Import it "
                              "after the stream has ended.")
    duration = info.get("duration")
    if duration and duration > YT_MAX_DURATION_S:
        raise UserFacingError("That video is over 45 minutes. Import a "
                              "single match, not a whole session.")
    title = (info.get("title") or "YouTube video").strip()[:200]

    # 2. Download (mp4/h264 <= 1080p for pipeline compatibility).
    local_path = os.path.join(workdir, "input.mp4")
    log.info("  yt-dlp downloading %r (%ss)…", title, duration)
    _run_ytdlp(
        ["-f", YTDLP_FORMAT, "--merge-output-format", "mp4",
         "-o", local_path, url],
        timeout=3600,
    )
    if not os.path.exists(local_path) or os.path.getsize(local_path) == 0:
        raise RuntimeError("yt-dlp reported success but produced no file")
    size = os.path.getsize(local_path)
    if size > YT_MAX_BYTES:
        raise UserFacingError("That video is over 2 GB once downloaded. "
                              "Import something shorter.")

    # 3. Land it in R2 exactly where a direct upload would live, so the
    # retention sweep and the rest of the pipeline treat it identically.
    key = f"{user_id}/{uuid.uuid4()}.mp4"
    input_path = f"r2://{R2_RAW_BUCKET}/{key}"
    log.info("  uploading raw import (%d MB) -> %s", size // 2**20, input_path)
    r2().upload_file(local_path, R2_RAW_BUCKET, key,
                     ExtraArgs={"ContentType": "video/mp4"})
    ledger_append(conn, user_id, "other", size, input_path)
    update_job(conn, job_id, input_path=input_path, original_name=title)
    return local_path, input_path


# ---------------------------------------------------------------------------
# Reclip stage — re-cut ONLY edited/new points' clips after the owner fixes
# timings in the match UI. Jobs arrive as kind='reclip' with
# options={'match_id': ...} (client-enqueued, debounced per match).
#
# Source preference: the original raw upload (jobs.input_path of the match's
# source job). If retention already deleted it there is no stored
# original->cut timeline mapping, so re-cutting from the cut video is not
# feasible; we mark those clips unavailable (clip_path=null) — the t0/t1
# edits themselves are already saved in Postgres.
# ---------------------------------------------------------------------------
# Clip context padding per strictness: (pre, post) seconds — must match
# STRICTNESS in points_pipeline.py and CLIP_PAD in the match page UI.
CLIP_PADDING = {"tight": (0.5, 1.0), "normal": (1.0, 1.6), "loose": (1.6, 2.4)}


def process_reclip(conn, job_id: str, user_id: str, payload: dict) -> None:
    options = get_job_options(conn, job_id, payload)
    match_id = options.get("match_id")
    if not match_id:
        raise RuntimeError("reclip job missing options.match_id")

    with conn.cursor() as cur:
        cur.execute(
            "select m.user_id, j.input_path, j.options "
            "from public.matches m "
            "left join public.jobs j on j.id = m.job_id "
            "where m.id = %s",
            (match_id,),
        )
        row = cur.fetchone()
    if not row:
        raise RuntimeError(f"reclip: match {match_id} not found")
    owner_id, input_path, src_options = row
    # options.match_id is client-writable JSON: never touch a match the
    # job's creator doesn't own.
    if str(owner_id) != str(user_id):
        raise RuntimeError("reclip: job user does not own the match")

    strictness = (src_options or {}).get("strictness", "normal")
    if strictness not in VALID_STRICTNESS:
        strictness = "normal"
    pre, post = CLIP_PADDING[strictness]

    with conn.cursor() as cur:
        cur.execute(
            "select id, idx, t0, t1 from public.points "
            "where match_id = %s and edited and not deleted "
            "and t0 is not null and t1 is not null order by idx",
            (match_id,),
        )
        targets = cur.fetchall()
    if not targets:
        log.info("  reclip: nothing to do for match %s", match_id)
        return

    update_job(conn, job_id, progress=10)
    workdir = tempfile.mkdtemp(prefix=f"ponglens-reclip-{str(job_id)[:8]}-")
    try:
        local_input = os.path.join(workdir, "source.mp4")
        source_ok = False
        try:
            r2_input = parse_r2_path(input_path or "")
            if r2_input:
                log.info("  reclip: downloading r2://%s/%s", *r2_input)
                r2().download_file(r2_input[0], r2_input[1], local_input)
            elif input_path:
                log.info("  reclip: downloading uploads/%s (legacy)", input_path)
                storage_download("uploads", input_path, local_input)
            source_ok = bool(input_path) and os.path.exists(local_input) \
                and os.path.getsize(local_input) > 0
        except Exception as e:
            log.warning("  reclip: raw source unavailable: %s", e)

        if not source_ok:
            # Raw gone (7-day retention) and no original->cut mapping stored:
            # keep the timing edits, mark the clips unavailable.
            with conn.cursor() as cur:
                for pid, _idx, t0, t1 in targets:
                    cur.execute(
                        "update public.points set clip_path = null, "
                        "edited = false where id = %s and t0 = %s and t1 = %s",
                        (pid, t0, t1),
                    )
            log.info("  reclip: source gone; marked %d clip(s) unavailable",
                     len(targets))
            return

        update_job(conn, job_id, progress=30)
        key_prefix = f"points/{owner_id}/{match_id}"
        done = 0
        for pid, idx, t0, t1 in targets:
            c0 = max(0.0, float(t0) - pre)
            span = (float(t1) + post) - c0
            out = os.path.join(workdir, f"clip_{idx}.mp4")
            subprocess.run(
                ["ffmpeg", "-y", "-v", "error", "-ss", f"{c0:.2f}",
                 "-i", local_input, "-t", f"{span:.2f}",
                 "-vf", "scale=720:-2",
                 "-c:v", "libx264", "-preset", "medium", "-crf", "23",
                 "-c:a", "aac", "-b:a", "96k",
                 "-movflags", "+faststart", out],
                check=True, timeout=1800,
            )
            # fresh key per cut so stale CDN/browser caches never win
            key = f"{key_prefix}/{int(idx):02d}-{uuid.uuid4().hex[:8]}.mp4"
            r2().upload_file(out, R2_MEDIA_BUCKET, key,
                             ExtraArgs={"ContentType": "video/mp4"})
            ledger_append(conn, str(owner_id), "clip", os.path.getsize(out),
                          f"r2://{R2_MEDIA_BUCKET}/{key}", match_id)
            # claim the edit only if t0/t1 didn't change while we were
            # cutting; if they did, a follow-up reclip will redo this point
            with conn.cursor() as cur:
                cur.execute(
                    "update public.points set clip_path = %s, edited = false "
                    "where id = %s and t0 = %s and t1 = %s",
                    (f"r2://{R2_MEDIA_BUCKET}/{key}", pid, t0, t1),
                )
            done += 1
            update_job(conn, job_id,
                       progress=30 + int(60 * done / len(targets)))
        log.info("  reclip: regenerated %d clip(s) for match %s",
                 done, match_id)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


# ---------------------------------------------------------------------------
# Highlight reels (Share v1.5, kind 'reel') — render the starred points into
# one shareable mp4: 2 s title card, clips with 0.3 s crossfades, 1.5 s
# outro. The manifest (score truth, computed in TS by /api/reel) lives in
# match_reels; this side only draws and encodes. Overlays are Pillow PNGs:
# a PongLens watermark top-right on every clip and, when show_score, a
# translucent scorebug pill bottom-left with the score ENTERING each rally.
# Encoding prefers h264_videotoolbox (Apple hardware) with a libx264
# fallback per command.
# ---------------------------------------------------------------------------
REEL_BG = (10, 10, 18)          # near-black brand background (#0a0a12)
REEL_CYAN = (34, 211, 238)      # cyan glow (#22d3ee)
REEL_XFADE_S = 0.3
REEL_TITLE_S = 2.0
REEL_OUTRO_S = 1.5

_FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/HelveticaNeue.ttc",
]
_FONT_REGULAR_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/HelveticaNeue.ttc",
]


def _load_font(size: int, bold: bool = True):
    from PIL import ImageFont
    for path in (_FONT_CANDIDATES if bold else _FONT_REGULAR_CANDIDATES):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def _text_size(draw, text: str, font) -> tuple[int, int]:
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    return right - left, bottom - top


def _reel_title_card(path: str, w: int, h: int, you: str, them: str,
                     date_str: str):
    """Dark title card: 'You vs Them', date, small cyan PongLens wordmark."""
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (w, h), REEL_BG)
    d = ImageDraw.Draw(img)
    name_font = _load_font(max(24, int(h * 0.085)))
    date_font = _load_font(max(14, int(h * 0.035)), bold=False)
    brand_font = _load_font(max(14, int(h * 0.032)))

    title = f"{you} vs {them}"
    tw, th = _text_size(d, title, name_font)
    if tw > w * 0.9:  # very long names: shrink to fit
        name_font = _load_font(max(20, int(h * 0.085 * w * 0.9 / tw)))
        tw, th = _text_size(d, title, name_font)
    d.text(((w - tw) / 2, h * 0.42 - th / 2), title, font=name_font,
           fill=(244, 244, 245))
    dw, dh = _text_size(d, date_str, date_font)
    d.text(((w - dw) / 2, h * 0.42 + th * 0.9), date_str, font=date_font,
           fill=(161, 161, 170))
    bw, _bh = _text_size(d, "PongLens", brand_font)
    d.text(((w - bw) / 2, h * 0.86), "PongLens", font=brand_font,
           fill=REEL_CYAN)
    img.save(path)


def _reel_outro_card(path: str, w: int, h: int):
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (w, h), REEL_BG)
    d = ImageDraw.Draw(img)
    font = _load_font(max(24, int(h * 0.06)))
    tw, th = _text_size(d, "ponglens.com", font)
    d.text(((w - tw) / 2, (h - th) / 2), "ponglens.com", font=font,
           fill=REEL_CYAN)
    img.save(path)


def _reel_watermark(path: str, h: int):
    """Small 'PongLens' wordmark, ~3% of frame height, ~50% opacity."""
    from PIL import Image, ImageDraw
    size = max(12, int(h * 0.03))
    font = _load_font(size)
    probe = Image.new("RGBA", (10, 10))
    tw, th = _text_size(ImageDraw.Draw(probe), "PongLens", font)
    img = Image.new("RGBA", (tw + 8, th + 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.text((4, 4), "PongLens", font=font, fill=(255, 255, 255, 128))
    img.save(path)


def _abbrev(name: str) -> str:
    """Broadcast-style 3-letter tag: 'Vaibhav' -> 'VAI'."""
    clean = "".join(c for c in (name or "") if c.isalnum())
    return (clean[:3] or "PLR").upper()


def _reel_scorebug(path: str, frame_h: int, you: str, them: str,
                   games_you: int, games_them: int,
                   score_you: int, score_them: int):
    """Translucent dark pill: 'ADI–VAI  0–0 · 3–1' (games, then the score
    entering this rally). Rendered at 2x and kept as RGBA for overlay."""
    from PIL import Image, ImageDraw
    s = 2  # supersample for clean corners at small sizes
    fh = max(16, int(frame_h * 0.024)) * s
    font_names = _load_font(fh, bold=False)
    font_nums = _load_font(fh)
    pad_x, pad_y = int(fh * 0.9), int(fh * 0.55)
    gap = int(fh * 0.55)

    names = f"{_abbrev(you)}–{_abbrev(them)}"
    games = f"{games_you}–{games_them}"
    dot = "·"
    score = f"{score_you}–{score_them}"

    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    parts = [(names, font_names, (212, 212, 216)),
             (games, font_nums, (244, 244, 245)),
             (dot, font_names, REEL_CYAN),
             (score, font_nums, (244, 244, 245))]
    sizes = [_text_size(probe, t, f) for t, f, _ in parts]
    text_w = sum(wd for wd, _ in sizes) + gap * (len(parts) - 1)
    text_h = max(hh for _, hh in sizes)
    w, h = text_w + pad_x * 2, text_h + pad_y * 2

    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=h // 2,
                        fill=(10, 10, 18, 200))
    x = pad_x
    for (t, f, color), (wd, _hh) in zip(parts, sizes):
        # anchor per-part text on a shared baseline via textbbox top offset
        top = d.textbbox((0, 0), t, font=f)[1]
        d.text((x, pad_y - top + (text_h - _hh) / 2 + top), t, font=f,
               fill=color)
        x += wd + gap
    img = img.resize((w // s, h // s), Image.LANCZOS)
    img.save(path)


def _ffprobe_streams(path: str) -> dict:
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format",
         "-of", "json", path],
        timeout=120,
    )
    return json.loads(out.decode())


def _run_ffmpeg_encoded(args_before_codec: list[str], vt_args: list[str],
                        x264_args: list[str], args_after: list[str]):
    """Run ffmpeg preferring the hardware encoder; fall back to libx264.
    Returns the codec name that succeeded."""
    for codec_name, codec_args in (("h264_videotoolbox", vt_args),
                                   ("libx264", x264_args)):
        proc = subprocess.run(
            ["ffmpeg", "-y", "-v", "error", *args_before_codec,
             *codec_args, *args_after],
            capture_output=True, text=True, timeout=1800,
        )
        if proc.returncode == 0:
            return codec_name
        log.warning("  reel: %s encode failed (%s); %s",
                    codec_name, (proc.stderr or "")[-300:],
                    "falling back to libx264"
                    if codec_name == "h264_videotoolbox" else "giving up")
    raise RuntimeError(f"ffmpeg encode failed: {(proc.stderr or '')[-400:]}")


def render_reel(manifest: dict, show_score: bool, workdir: str) -> str:
    """Render the reel mp4 from the manifest. Returns the output path."""
    points = manifest["points"]
    you = (manifest.get("you_name") or "Player").strip() or "Player"
    them = (manifest.get("them_name") or "Opponent").strip() or "Opponent"
    played_at = manifest.get("played_at") or ""
    try:
        date_str = datetime.fromisoformat(
            played_at.replace("Z", "+00:00")).strftime("%B %-d, %Y")
    except (ValueError, AttributeError):
        date_str = ""

    # 1. Download the clips.
    clips = []
    for i, p in enumerate(points):
        loc = parse_r2_path(p["clip_path"])
        if not loc:
            raise RuntimeError(f"reel: point {p.get('point_id')} has no r2 "
                               "clip path")
        local = os.path.join(workdir, f"src_{i:02d}.mp4")
        r2().download_file(loc[0], loc[1], local)
        clips.append(local)

    # 2. Target format from the first clip; audio only if EVERY clip has it.
    first = _ffprobe_streams(clips[0])
    v0 = next(s for s in first["streams"] if s["codec_type"] == "video")
    tw, th = int(v0["width"]), int(v0["height"])
    if tw % 2:
        tw += 1
    if th % 2:
        th += 1
    fps = v0.get("r_frame_rate", "30/1")
    try:
        num, den = fps.split("/")
        fps_f = float(num) / float(den or 1)
    except (ValueError, ZeroDivisionError):
        fps_f = 30.0
    if not (10 <= fps_f <= 120):
        fps_f = 30.0
    keep_audio = all(
        any(s["codec_type"] == "audio"
            for s in _ffprobe_streams(c)["streams"])
        for c in clips
    )

    # Hardware encoders are bitrate-driven; ~0.12 bit/pixel/frame keeps
    # source-resolution output visually clean for sports footage.
    bitrate = max(4_000_000, int(tw * th * fps_f * 0.12))
    vt = ["-c:v", "h264_videotoolbox", "-b:v", str(bitrate),
          "-allow_sw", "1", "-pix_fmt", "yuv420p"]
    x264 = ["-c:v", "libx264", "-preset", "medium", "-crf", "20",
            "-pix_fmt", "yuv420p"]
    audio_args = ["-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2"]

    # 3. Overlay assets.
    wm_png = os.path.join(workdir, "wm.png")
    _reel_watermark(wm_png, th)
    title_png = os.path.join(workdir, "title.png")
    _reel_title_card(title_png, tw, th, you, them, date_str)
    outro_png = os.path.join(workdir, "outro.png")
    _reel_outro_card(outro_png, tw, th)

    encoder_used = "libx264"

    # 4. Cards -> short segments (silent audio when audio is kept).
    def card_segment(png: str, seconds: float, out: str):
        nonlocal encoder_used
        before = ["-loop", "1", "-t", f"{seconds}", "-i", png]
        maps = ["-map", "0:v"]
        if keep_audio:
            before += ["-f", "lavfi", "-t", f"{seconds}",
                       "-i", "anullsrc=r=48000:cl=stereo"]
            maps = ["-map", "0:v", "-map", "1:a"]
        encoder_used = _run_ffmpeg_encoded(
            [*before, *maps, "-vf",
             f"fps={fps_f:.5f},format=yuv420p", "-shortest"],
            vt, x264,
            [*(audio_args if keep_audio else []), out],
        )

    seg_title = os.path.join(workdir, "seg_title.mp4")
    card_segment(title_png, REEL_TITLE_S, seg_title)
    seg_outro = os.path.join(workdir, "seg_outro.mp4")
    card_segment(outro_png, REEL_OUTRO_S, seg_outro)

    # 5. Clips -> normalized segments with burned-in overlays. The scorebug
    # is static per segment: the score entering that rally.
    margin_x = max(12, int(tw * 0.015))
    margin_y = max(12, int(th * 0.02))
    segments = [seg_title]
    for i, (src, p) in enumerate(zip(clips, points)):
        seg = os.path.join(workdir, f"seg_{i:02d}.mp4")
        inputs = ["-i", src, "-i", wm_png]
        chain = (
            f"[0:v]scale={tw}:{th}:force_original_aspect_ratio=decrease,"
            f"pad={tw}:{th}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,"
            f"fps={fps_f:.5f}[base];"
            f"[base][1:v]overlay=W-w-{margin_x}:{margin_y}[wm]"
        )
        last = "wm"
        if show_score:
            bug = os.path.join(workdir, f"bug_{i:02d}.png")
            _reel_scorebug(bug, th, you, them,
                           int(p.get("games_you") or 0),
                           int(p.get("games_them") or 0),
                           int(p.get("score_you") or 0),
                           int(p.get("score_them") or 0))
            inputs += ["-i", bug]
            chain += f";[wm][2:v]overlay={margin_x}:H-h-{margin_y}[out]"
            last = "out"
        maps = ["-map", f"[{last}]"]
        if keep_audio:
            maps += ["-map", "0:a"]
        encoder_used = _run_ffmpeg_encoded(
            [*inputs, "-filter_complex", chain, *maps],
            vt, x264,
            [*(audio_args if keep_audio else ["-an"]), seg],
        )
        segments.append(seg)
    segments.append(seg_outro)

    # 6. Crossfade chain (video xfade + audio acrossfade), faststart.
    durs = [float(_ffprobe_streams(s)["format"]["duration"])
            for s in segments]
    out_path = os.path.join(workdir, "reel.mp4")
    if len(segments) == 1:
        shutil.copyfile(segments[0], out_path)
        return out_path

    inputs = []
    for s in segments:
        inputs += ["-i", s]
    fc = []
    offset = 0.0
    vin = "0:v"
    for i in range(1, len(segments)):
        offset += durs[i - 1] - REEL_XFADE_S
        vout = f"v{i}" if i < len(segments) - 1 else "vout"
        fc.append(f"[{vin}][{i}:v]xfade=transition=fade:"
                  f"duration={REEL_XFADE_S}:offset={offset:.4f}[{vout}]")
        vin = vout
    maps = ["-map", "[vout]"]
    if keep_audio:
        ain = "0:a"
        for i in range(1, len(segments)):
            aout = f"a{i}" if i < len(segments) - 1 else "aout"
            fc.append(f"[{ain}][{i}:a]acrossfade=d={REEL_XFADE_S}[{aout}]")
            ain = aout
        maps += ["-map", "[aout]"]
    encoder_used = _run_ffmpeg_encoded(
        [*inputs, "-filter_complex", ";".join(fc), *maps],
        vt, x264,
        [*(audio_args if keep_audio else []),
         "-movflags", "+faststart", out_path],
    )
    log.info("  reel: rendered %d clip(s) at %dx%d %.2ffps, audio=%s, "
             "encoder=%s", len(clips), tw, th, fps_f, keep_audio,
             encoder_used)
    return out_path


def reel_email_html(match_url: str) -> str:
    return f"""\
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Your highlight reel is rendered and ready to share.&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background-color:#f4f5f7;">
  <tr>
    <td align="center" style="padding:48px 16px;background-color:#f4f5f7;">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:16px;">
        <tr>
          <td align="center" style="padding:40px 32px 36px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <img src="https://www.ponglens.com/img/email-logo.png" width="180" height="44" alt="PongLens" style="display:block;width:180px;height:44px;border:0;margin:0 auto 28px;">
            <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;font-weight:700;color:#0f172a;">Your reel is ready</h1>
            <p style="margin:0 0 28px;font-size:14px;line-height:1.6;color:#475569;">
              We rendered your starred points into one highlight reel.
              Save it from the match page and share it anywhere.
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
              <tr>
                <td align="center" style="background-color:#0891b2;border-radius:999px;">
                  <a href="{match_url}" style="display:inline-block;padding:13px 30px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;line-height:1;color:#ffffff;text-decoration:none;border-radius:999px;">Get your reel</a>
                </td>
              </tr>
            </table>
            <p style="margin:32px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">Sent by PongLens &middot; ponglens.com</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
"""


def notify_reel_done(conn, user_id: str, match_id: str):
    """Email the owner that their reel is ready. Never raises."""
    try:
        to = get_user_email(conn, user_id)
        body = reel_email_html(f"https://www.ponglens.com/match/{match_id}")
        if to:
            send_email(to, "Your reel is ready", body, bcc=ADMIN_EMAIL)
        else:
            log.warning("  no email for user %s; notifying admin only",
                        user_id)
            send_email(ADMIN_EMAIL, "Your reel is ready", body)
    except Exception as e:
        log.warning("  reel email failed (non-fatal): %s", e)


def process_reel(conn, job_id: str, user_id: str, payload: dict) -> None:
    options = get_job_options(conn, job_id, payload)
    match_id = options.get("match_id")
    if not match_id:
        raise RuntimeError("reel job missing options.match_id")

    with conn.cursor() as cur:
        cur.execute(
            "select m.user_id, r.show_score, r.manifest "
            "from public.match_reels r "
            "join public.matches m on m.id = r.match_id "
            "where r.match_id = %s",
            (match_id,),
        )
        row = cur.fetchone()
    if not row:
        raise RuntimeError(f"reel: no match_reels row for {match_id}")
    owner_id, show_score, manifest = row
    # options.match_id is client-influenced: never render a match the job's
    # creator doesn't own.
    if str(owner_id) != str(user_id):
        raise RuntimeError("reel: job user does not own the match")
    if not isinstance(manifest, dict) or not manifest.get("points"):
        raise RuntimeError("reel: empty manifest")

    with conn.cursor() as cur:
        cur.execute(
            "update public.match_reels set status = 'rendering' "
            "where match_id = %s",
            (match_id,),
        )
    update_job(conn, job_id, progress=15)

    workdir = tempfile.mkdtemp(prefix=f"ponglens-reel-{str(job_id)[:8]}-")
    try:
        t0 = time.time()
        out = render_reel(manifest, bool(show_score), workdir)
        update_job(conn, job_id, progress=80)

        key = f"reels/{match_id}.mp4"
        r2_uri = f"r2://{R2_MEDIA_BUCKET}/{key}"
        size = os.path.getsize(out)
        duration = _video_duration_s(out)
        r2().upload_file(out, R2_MEDIA_BUCKET, key,
                         ExtraArgs={"ContentType": "video/mp4"})
        # one key per match, overwritten on re-render: zero the previous
        # balance before booking the new bytes
        ledger_negate_keys(conn, [r2_uri])
        ledger_append(conn, str(owner_id), "reel", size, r2_uri, match_id)

        with conn.cursor() as cur:
            cur.execute(
                "update public.match_reels set status = 'ready', "
                "r2_key = %s, duration_s = %s, size_bytes = %s, "
                "error = null where match_id = %s",
                (key, round(duration, 2), size, match_id),
            )
        log.info("  reel ready: %s (%.1fs video, %d KB, rendered in %.0fs)",
                 r2_uri, duration, size // 1024, time.time() - t0)
        notify_reel_done(conn, str(owner_id), match_id)
    except Exception as e:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "update public.match_reels set status = 'failed', "
                    "error = %s where match_id = %s",
                    (str(e)[:500], match_id),
                )
        except Exception:
            log.exception("  failed to mark reel failed")
        raise
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


# ---------------------------------------------------------------------------
# Upfront content check (SPEC.md §6) — runs right after the input video is
# downloaded (uploads AND YouTube imports), before any expensive processing.
# ---------------------------------------------------------------------------
def _video_duration_s(video: str) -> float:
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", video],
        timeout=60,
    )
    return float(out.decode().strip())


def _sample_frames(video: str, workdir: str,
                   n: int = CONTENT_CHECK_FRAMES) -> list[str]:
    """Extract n frames evenly across the video (skipping the first/last 3%,
    which tend to be walking-to-camera / phone-pocket footage), downscaled
    to 512 px wide JPEGs. Frames that fail to extract are skipped."""
    duration = _video_duration_s(video)
    lo, hi = duration * 0.03, duration * 0.97
    outdir = os.path.join(workdir, "content_check")
    os.makedirs(outdir, exist_ok=True)
    frames = []
    for i in range(n):
        ts = lo + (hi - lo) * i / max(n - 1, 1)
        out = os.path.join(outdir, f"frame{i:02d}.jpg")
        proc = subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-ss", f"{ts:.2f}", "-i", video,
             "-frames:v", "1", "-vf", "scale=512:-2", "-q:v", "5", out],
            capture_output=True, timeout=120,
        )
        if proc.returncode == 0 and os.path.exists(out) \
                and os.path.getsize(out) > 0:
            frames.append(out)
    return frames


def looks_like_table_tennis(video: str, workdir: str) -> bool:
    """One vision request over sampled frames; per-frame yes/no verdicts.
    True  = enough frames show table tennis, OR the check could not run
            (fail open — availability beats gating).
    False = confident negative (< CONTENT_CHECK_MIN_POSITIVE frames)."""
    if SKIP_CONTENT_CHECK:
        log.info("  content check skipped (WORKER_SKIP_CONTENT_CHECK)")
        return True
    if not OPENAI_API_KEY:
        log.warning("  content check skipped: no OpenAI key in Keychain "
                    "('openai-api-key') or OPENAI_API_KEY env")
        return True
    try:
        frames = _sample_frames(video, workdir)
        if len(frames) < CONTENT_CHECK_FRAMES // 2:
            log.warning("  content check skipped: only %d/%d frames "
                        "extracted", len(frames), CONTENT_CHECK_FRAMES)
            return True

        content: list[dict] = [{
            "type": "text",
            "text": (
                f"You will see {len(frames)} frames sampled from one video. "
                "For EACH frame, in order, answer whether it shows table "
                "tennis (ping pong). Count as YES: a table tennis table "
                "with play or practice happening, players at or around a "
                "table tennis table, or an empty table tennis table/venue. "
                "Anything else (other sports, unrelated scenes, screens, "
                "test patterns) is NO. Reply with ONLY a JSON array of "
                f'{len(frames)} strings, each "yes" or "no". No other text.'
            ),
        }]
        for f in frames:
            with open(f, "rb") as fh:
                b64 = base64.b64encode(fh.read()).decode()
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64}",
                              "detail": "low"},
            })
        body: dict = {
            "model": CONTENT_CHECK_MODEL,
            "messages": [{"role": "user", "content": content}],
            "max_completion_tokens": 1000,
        }
        if CONTENT_CHECK_MODEL.startswith(("gpt-5", "o3", "o4")):
            body["reasoning_effort"] = "low"    # reasoning models: keep cheap
        else:
            body["temperature"] = 0

        r = requests.post(
            f"{OPENAI_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            json=body, timeout=CONTENT_CHECK_TIMEOUT_S,
        )
        r.raise_for_status()
        data = r.json()
        reply = data["choices"][0]["message"]["content"] or ""
        # tolerate code fences / stray prose around the JSON array
        start, end = reply.find("["), reply.rfind("]")
        verdicts = json.loads(reply[start:end + 1])
        if not isinstance(verdicts, list) or len(verdicts) != len(frames):
            raise ValueError(f"expected {len(frames)} verdicts, got: "
                             f"{reply[:200]!r}")
        positives = sum(1 for v in verdicts
                        if str(v).strip().lower() == "yes")
        usage = data.get("usage", {})
        log.info("  content check: %d/%d frames positive (model=%s, "
                 "%s prompt + %s completion tokens)",
                 positives, len(frames), CONTENT_CHECK_MODEL,
                 usage.get("prompt_tokens", "?"),
                 usage.get("completion_tokens", "?"))
        return positives >= CONTENT_CHECK_MIN_POSITIVE
    except Exception as e:
        # FAIL OPEN: a broken/slow/renamed API must never block processing.
        log.warning("  content check unavailable (%s: %s) — proceeding "
                    "without it", type(e).__name__, e)
        return True


def delete_rejected_raw(conn, input_path: str | None):
    """Rejected upload: remove the raw object immediately (don't wait for
    the 7-day sweep) and net out its storage_ledger rows. Best-effort —
    retention catches anything we miss."""
    if not input_path:
        return
    try:
        r2_input = parse_r2_path(input_path)
        if r2_input:
            bucket, key = r2_input
            r2().delete_object(Bucket=bucket, Key=key)
            ledger_negate_keys(conn, [input_path])
        else:
            storage_delete("uploads", [input_path])
        log.info("  rejected raw deleted: %s", input_path)
    except Exception as e:
        log.warning("  failed to delete rejected raw (retention sweep will "
                    "catch it): %s", e)


def process_job(conn, msg) -> None:
    payload = msg["message"]
    if isinstance(payload, str):
        payload = json.loads(payload)
    job_id = payload["job_id"]
    user_id = payload["user_id"]
    input_path = payload["input_path"]
    kind = payload.get("kind", "deadspace_cut")

    log.info("job %s (kind=%s, attempt %s)", job_id, kind, msg["read_ct"])

    if kind == "reclip":
        # lightweight path: no blurball pipeline, just ffmpeg re-cuts
        update_job(conn, job_id, status="processing", progress=5, error=None)
        process_reclip(conn, job_id, user_id, payload)
        update_job(conn, job_id, status="done", progress=100)
        archive_message(conn, msg["msg_id"])
        log.info("  reclip done: job %s", job_id)
        return

    if kind == "reel":
        # render the starred-points highlight reel (no blurball pipeline)
        update_job(conn, job_id, status="processing", progress=5, error=None)
        process_reel(conn, job_id, user_id, payload)
        update_job(conn, job_id, status="done", progress=100)
        archive_message(conn, msg["msg_id"])
        log.info("  reel done: job %s", job_id)
        return

    if kind not in ("deadspace_cut", "youtube_import"):
        raise RuntimeError(f"unknown job kind: {kind}")

    options = get_job_options(conn, job_id, payload)
    strictness = options.get("strictness", "normal")
    if strictness not in VALID_STRICTNESS:
        strictness = "normal"

    update_job(conn, job_id, status="processing", progress=5, error=None)

    workdir = tempfile.mkdtemp(prefix=f"ponglens-{job_id[:8]}-")
    try:
        if kind == "youtube_import":
            # yt-dlp fetch -> R2 raw bucket; from here on the job is
            # indistinguishable from a direct upload.
            local_input, input_path = fetch_youtube(
                conn, job_id, user_id, options, workdir)
            r2_input = parse_r2_path(input_path)
        else:
            ext = os.path.splitext(input_path)[1] or ".mp4"
            local_input = os.path.join(workdir, f"input{ext}")

            r2_input = parse_r2_path(input_path)
            if r2_input:
                bucket, key = r2_input
                log.info("  downloading r2://%s/%s", bucket, key)
                r2().download_file(bucket, key, local_input)
            else:
                log.info("  downloading uploads/%s (legacy Supabase path)",
                         input_path)
                storage_download("uploads", input_path, local_input)
        update_job(conn, job_id, progress=10)

        # Upfront content gate: cheap vision check before the expensive
        # pipeline. Confident negative -> delete the raw, fail the job with
        # a user-facing message, archive the queue message (no retries).
        if not looks_like_table_tennis(local_input, workdir):
            delete_rejected_raw(conn, input_path)
            raise UserFacingError(CONTENT_CHECK_REJECT_MSG)
        update_job(conn, job_id, progress=15)

        result, blurball_out = run_pipeline(local_input, workdir, strictness)
        update_job(conn, job_id, progress=60 if options.get("points") else 85)

        if r2_input:
            result_key = f"results/{user_id}/{job_id}.mp4"
            result_path = f"r2://{R2_MEDIA_BUCKET}/{result_key}"
            log.info("  uploading %s", result_path)
            r2().upload_file(
                result, R2_MEDIA_BUCKET, result_key,
                ExtraArgs={"ContentType": "video/mp4"},
            )
            # match_id doesn't exist yet; the 010 delete trigger frees this
            # row by key (matches.cut_path), retention by key too.
            ledger_append(conn, user_id, "cut", os.path.getsize(result),
                          result_path)
        else:
            result_path = f"{user_id}/{job_id}.mp4"
            log.info("  uploading results/%s (legacy Supabase path)",
                     result_path)
            storage_upload("results", result_path, result)

        # SPEC.md §6: point-by-point breakdown on the ORIGINAL video
        if options.get("points"):
            update_job(conn, job_id, progress=70)
            run_points_stage(conn, job_id, user_id, local_input,
                             blurball_out, workdir, options, result_path)

        update_job(conn, job_id, status="done", result_path=result_path,
                   progress=100)
        archive_message(conn, msg["msg_id"])
        log.info("  done: %s", result_path)
        notify_job_done(conn, job_id, user_id)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


# ---------------------------------------------------------------------------
# Daily retention sweep (SPEC.md §7 tiers; Privacy Policy promise)
# ---------------------------------------------------------------------------
def cleanup_legacy_uploads(conn):
    """Legacy Supabase 'uploads' bucket: delete objects older than 30 days."""
    cutoff = datetime.now(timezone.utc) - timedelta(
        days=LEGACY_UPLOAD_RETENTION_DAYS
    )
    with conn.cursor() as cur:
        cur.execute(
            "select name from storage.objects "
            "where bucket_id = 'uploads' and created_at < %s limit 200",
            (cutoff,),
        )
        names = [row[0] for row in cur.fetchall()]
    if not names:
        log.info("cleanup: no legacy uploads older than %s days",
                 LEGACY_UPLOAD_RETENTION_DAYS)
        return
    log.info("cleanup: deleting %d expired legacy upload(s)", len(names))
    storage_delete("uploads", names)


def r2_sweep_prefix(conn, bucket: str, prefix: str, older_than_days: int):
    """Delete objects under bucket/prefix whose LastModified is too old,
    then book the freed bytes as negative storage_ledger rows (by key)."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=older_than_days)
    client = r2()
    deleted = 0
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        expired = [
            {"Key": obj["Key"]}
            for obj in page.get("Contents", [])
            if obj["LastModified"] < cutoff
        ]
        for i in range(0, len(expired), 1000):
            chunk = expired[i : i + 1000]
            client.delete_objects(Bucket=bucket, Delete={"Objects": chunk})
            ledger_negate_keys(
                conn, [f"r2://{bucket}/{o['Key']}" for o in chunk])
        deleted += len(expired)
    log.info("cleanup: r2://%s/%s — deleted %d object(s) older than %dd",
             bucket, prefix or "*", deleted, older_than_days)


def retention_sweep(conn):
    """Run all retention tiers. Each tier is independent and best-effort.

    Current tiers (SPEC.md §7):
      raw uploads (ponglens-raw)              7 days
      cut videos  (ponglens-media results/)   30 days
      voice audio (ponglens-media voice/)     90 days
    Remaining tier, kept while the account is active (no sweep):
      point clips + match.json (points/), transcripts (Postgres)
    """
    for name, fn in (
        ("legacy-supabase-uploads", lambda: cleanup_legacy_uploads(conn)),
        ("r2-raw", lambda: r2_sweep_prefix(
            conn, R2_RAW_BUCKET, "", R2_RAW_RETENTION_DAYS)),
        ("r2-results", lambda: r2_sweep_prefix(
            conn, R2_MEDIA_BUCKET, "results/", R2_RESULTS_RETENTION_DAYS)),
        ("r2-voice", lambda: r2_sweep_prefix(
            conn, R2_MEDIA_BUCKET, "voice/", R2_VOICE_RETENTION_DAYS)),
    ):
        try:
            fn()
        except Exception as e:  # a failing tier must not block the others
            log.warning("cleanup tier %s failed: %s", name, e)


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
def main():
    log.info("PongLens worker starting (supabase=%s)", SUPABASE_URL)
    conn = connect()
    last_cleanup = 0.0
    last_digest_check = 0.0

    while True:
        try:
            if time.time() - last_cleanup > CLEANUP_EVERY_S or last_cleanup == 0:
                try:
                    retention_sweep(conn)
                except Exception as e:  # cleanup must never kill the loop
                    log.warning("cleanup failed: %s", e)
                last_cleanup = time.time()

            if time.time() - last_digest_check > DIGEST_CHECK_EVERY_S \
                    or last_digest_check == 0:
                maybe_send_feedback_digest(conn)   # never raises
                last_digest_check = time.time()

            msg = read_message(conn)
            if msg is None:
                time.sleep(POLL_SLEEP_S)
                continue

            try:
                process_job(conn, msg)
            except Exception as e:
                log.exception("job failed: %s", e)
                payload = msg["message"]
                if isinstance(payload, str):
                    payload = json.loads(payload)
                job_id = payload.get("job_id")
                try:
                    if job_id:
                        update_job(conn, job_id, status="failed",
                                   error=str(e)[:500])
                    if isinstance(e, UserFacingError):
                        # Deterministic failure (private video, too long…):
                        # retrying can't succeed, archive right away.
                        archive_message(conn, msg["msg_id"])
                    elif msg["read_ct"] >= MAX_READ_CT:
                        log.warning("archiving poison message %s "
                                    "(read_ct=%s)", msg["msg_id"], msg["read_ct"])
                        archive_message(conn, msg["msg_id"])
                except Exception:
                    log.exception("failed to record job failure")
                if job_id:
                    notify_job_failed(job_id, str(e))

        except psycopg2.Error as e:
            log.warning("database connection issue (%s) — reconnecting in 30s", e)
            try:
                conn.close()
            except Exception:
                pass
            time.sleep(30)
            try:
                conn = connect()
            except Exception as e2:
                log.error("reconnect failed: %s", e2)
                time.sleep(60)
        except KeyboardInterrupt:
            log.info("worker stopped by user")
            break
        except Exception:
            log.exception("unexpected error in main loop — sleeping 60s")
            time.sleep(60)


if __name__ == "__main__":
    if "--digest-once" in sys.argv:
        # Manual/verification run: one digest check against the real DB,
        # honoring app_config.digest_last_sent, then exit.
        maybe_send_feedback_digest(connect())
    else:
        main()

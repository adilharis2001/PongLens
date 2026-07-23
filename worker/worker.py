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
import math
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
    """Job options: prefer a fresh read of the jobs row, fall back to the
    queue payload snapshot. The row is the source of truth because uploads
    and YouTube imports enqueue with a 60s pgmq delay (migrations 022/024)
    and both forms keep the processing toggles editable past insert — the
    payload's options are a snapshot from insert time and can be stale.
    youtube_import jobs additionally call this again AFTER the yt-dlp
    download (see process_job) so edits made during the download land."""
    with conn.cursor() as cur:
        cur.execute("select options from public.jobs where id = %s",
                    (job_id,))
        row = cur.fetchone()
    if row and isinstance(row[0], dict):
        return row[0]
    opts = payload.get("options")
    return opts if isinstance(opts, dict) else {}


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
    # Upload-form metadata rides on jobs.options.meta. Opponent/type stay
    # editable in the UI all the way through processing, so read meta fresh
    # from the row at match creation — a name typed after the processing
    # lock still lands on the match.
    meta = options.get("meta") if isinstance(options.get("meta"), dict) else {}
    fresh_meta = get_job_options(conn, job_id, {}).get("meta")
    if isinstance(fresh_meta, dict):
        meta = fresh_meta
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

        # cut_t0 regression tripwire. Every point must map into the cut
        # video (Keep score + Player navigation depend on it). The 2026-07-22
        # NULL-cut_t0 incident was a daemon still running pre-cut_t0 code
        # after the feature landed on disk — if this fires, the running
        # worker and points_pipeline.py disagree; restart the daemon.
        missing_cut_t0 = sum(1 for p in points if p.get("cut_t0") is None)
        if missing_cut_t0:
            log.warning("  %d/%d point(s) missing cut_t0 in match.json — "
                        "stale points_pipeline output? (match %s)",
                        missing_cut_t0, len(points), match_id)

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
                  workdir: str) -> tuple[str, str, str]:
    """Download options['url'] with yt-dlp, enforce duration/size limits,
    upload the file to ponglens-raw (same key shape as a direct upload) and
    stamp it on the job row. Returns (local_path, r2_input_path, title)."""
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
    return local_path, input_path, title


# Opponent prefill from the YouTube title ("Adil vs Faye — club night"):
# one cheap text call extracts the player that is NOT the uploader. Purely
# a nicety — FAIL OPEN on any error, and NEVER overwrite a name the user
# typed (guarded writes).
TITLE_OPPONENT_MODEL = os.environ.get("WORKER_TITLE_OPPONENT_MODEL",
                                      "gpt-5-nano")
TITLE_OPPONENT_TIMEOUT_S = 20


def account_display_name(conn, user_id: str) -> str:
    """The uploader's auth display name (Google full_name/name), or ''."""
    with conn.cursor() as cur:
        cur.execute(
            "select coalesce(raw_user_meta_data->>'full_name', "
            "raw_user_meta_data->>'name', '') "
            "from auth.users where id = %s",
            (user_id,),
        )
        row = cur.fetchone()
    return (row[0] or "").strip() if row else ""


def opponent_from_title(title: str, account_name: str) -> str | None:
    """Extract the opponent's name from a video title, or None unless the
    model is confident. Raises on API problems (callers fail open)."""
    prompt = (
        "A user imported a YouTube video of their own table tennis match.\n"
        f"Video title: {title!r}\n"
        f"The uploader's account name: {account_name!r}\n\n"
        "If the title clearly names the two players of a match (patterns "
        "like 'A vs B', 'A v B', 'A x B'), return the player name that is "
        "NOT the uploader. Match the uploader against the account name "
        "loosely: first name only, different casing, all-caps and minor "
        "spelling variants all count as the uploader. If the title does "
        "not clearly name a match between two players, or you cannot "
        "confidently tell which player is the uploader, return null.\n\n"
        'Reply with ONLY strict JSON: {"opponent_name": <string or null>}'
    )
    body: dict = {
        "model": TITLE_OPPONENT_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_completion_tokens": 1000,
        "response_format": {"type": "json_object"},
    }
    if TITLE_OPPONENT_MODEL.startswith(("gpt-5", "o3", "o4")):
        body["reasoning_effort"] = "low"    # reasoning models: keep cheap
    else:
        body["temperature"] = 0
    r = requests.post(
        f"{OPENAI_BASE_URL}/chat/completions",
        headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
        json=body, timeout=TITLE_OPPONENT_TIMEOUT_S,
    )
    r.raise_for_status()
    reply = r.json()["choices"][0]["message"]["content"] or ""
    start, end = reply.find("{"), reply.rfind("}")
    data = json.loads(reply[start:end + 1])
    name = data.get("opponent_name")
    if isinstance(name, str):
        return name.strip()[:120] or None
    return None


def prefill_opponent_from_title(conn, job_id: str, user_id: str,
                                options: dict, title: str) -> None:
    """If no opponent was typed for a YouTube import, prefill it from the
    video title. Writes jobs.options.meta.opponent_name (guarded: only if
    still empty — the user may save details mid-import) and the matches row
    if it already exists (re-runs); also patches the in-memory options dict
    so run_points_stage creates the match with the name. FAIL OPEN."""
    try:
        meta = options.get("meta") \
            if isinstance(options.get("meta"), dict) else {}
        if (meta.get("opponent_name") or "").strip():
            return
        if not OPENAI_API_KEY:
            log.info("  title->opponent skipped: no OpenAI key")
            return
        account = account_display_name(conn, user_id)
        name = opponent_from_title(title, account)
        if not name:
            log.info("  title->opponent: no confident opponent in %r", title)
            return
        with conn.cursor() as cur:
            # Only if still empty at write time — never overwrite the user.
            cur.execute(
                "update public.jobs set options = jsonb_set("
                "coalesce(options, '{}'::jsonb), '{meta}', "
                "coalesce(options->'meta', '{}'::jsonb) || "
                "jsonb_build_object('opponent_name', %s::text)) "
                "where id = %s "
                "and coalesce(options->'meta'->>'opponent_name', '') = ''",
                (name, job_id),
            )
            wrote = cur.rowcount == 1
            cur.execute(
                "update public.matches set opponent_name = %s "
                "where job_id = %s and coalesce(opponent_name, '') = ''",
                (name, job_id),
            )
        if wrote:
            # run_points_stage reads THIS dict (queue payload snapshot).
            if isinstance(options.get("meta"), dict):
                options["meta"]["opponent_name"] = name
            else:
                options["meta"] = {"opponent_name": name}
            log.info("  title->opponent: prefilled %r from %r", name, title)
        else:
            log.info("  title->opponent: user already set an opponent; "
                     "keeping theirs")
    except Exception as e:
        log.warning("  title->opponent unavailable (%s: %s) — proceeding "
                    "without it", type(e).__name__, e)


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
# Context kept at a SPLIT boundary (points.tight_start / tight_end): the two
# children share one moment, so the shared edge keeps min(pad, TIGHT_PAD)
# instead of doubling the full pad on both sides. Outer edges keep the full
# strictness pad. MUST match TIGHT_PAD in the match page UI (clipEdit.ts).
TIGHT_PAD = 0.3


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
            "select id, idx, t0, t1, tight_start, tight_end "
            "from public.points "
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
                for pid, _idx, t0, t1, _ts, _te in targets:
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
        for pid, idx, t0, t1, tight_start, tight_end in targets:
            p_pre = min(pre, TIGHT_PAD) if tight_start else pre
            p_post = min(post, TIGHT_PAD) if tight_end else post
            c0 = max(0.0, float(t0) - p_pre)
            span = (float(t1) + p_post) - c0
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
# one shareable mp4: 2 s title card, point segments with 0.3 s crossfades,
# 1.5 s outro. The manifest (score truth, computed in TS by /api/reel) lives
# in match_reels; this side only draws and encodes.
#
# Manifest v2 renders from the FULL-RESOLUTION cut video (matches.cut_path,
# downloaded once): each point carries cut-timeline bounds (seg_start /
# seg_end, clamped here against the cut's real duration) and ffmpeg extracts
# the segment at source resolution. Points without bounds — and whole
# matches whose cut video is gone (30-day retention) — fall back to the
# 720p preview clips, scaled/padded to the target frame.
#
# Overlays are Pillow PNGs designed against a 1080p frame and scaled by
# height/1080: a PongLens watermark bottom-RIGHT on every segment and, when
# show_score, a broadcast two-row score table bottom-LEFT with the score
# ENTERING each rally (full names, one column per completed game, current
# points in a highlighted box). Encoding prefers h264_videotoolbox (Apple
# hardware, quality bitrate ~9 Mbps at 1080p30 scaled by pixels*fps) with a
# libx264 fallback per command.
# ---------------------------------------------------------------------------
REEL_BG = (10, 10, 18)           # near-black brand background (#0a0a12)
REEL_CYAN = (34, 211, 238)       # cyan glow (#22d3ee) — the owner ("You")
REEL_MAGENTA = (232, 121, 249)   # magenta (#e879f9) — the opponent ("Them")
REEL_WHITE = (244, 244, 245)     # zinc-100
REEL_MUTED = (161, 161, 170)     # zinc-400
REEL_XFADE_S = 0.3
REEL_TITLE_S = 2.0
REEL_OUTRO_S = 1.5

# Helvetica Neue ships in every macOS as a .ttc; indices verified on this
# machine (0=Regular, 1=Bold, 10=Medium). Arial as a fallback.
_HN_TTC = "/System/Library/Fonts/HelveticaNeue.ttc"
_HN_INDEX = {"regular": 0, "bold": 1, "medium": 10}
_FALLBACK_FONTS = {
    "regular": "/System/Library/Fonts/Supplemental/Arial.ttf",
    "medium": "/System/Library/Fonts/Supplemental/Arial.ttf",
    "bold": "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
}


def _load_font(size: int, weight: str = "bold"):
    from PIL import ImageFont
    if os.path.exists(_HN_TTC):
        try:
            return ImageFont.truetype(
                _HN_TTC, size, index=_HN_INDEX.get(weight, 1))
        except OSError:
            pass
    fb = _FALLBACK_FONTS.get(weight)
    if fb and os.path.exists(fb):
        try:
            return ImageFont.truetype(fb, size)
        except OSError:
            pass
    return ImageFont.load_default()


def _text_size(draw, text: str, font) -> tuple[int, int]:
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    return right - left, bottom - top


def _draw_lens_mark(img, cx: float, cy: float, box: float,
                    alpha_scale: float = 1.0):
    """The Logo.tsx lens-ring glyph, drawn onto an RGBA image.

    Geometry mirrors the SVG (32-unit viewBox): ring r=12 stroke 2.5 at 95%
    opacity; glass-glint inner arc r=8.25 stroke 2, round caps, 210°→285°
    (upper-left to top) at 50% opacity. `box` is the viewBox size in px.
    """
    from PIL import ImageDraw
    d = ImageDraw.Draw(img)
    k = box / 32.0
    ring = (*REEL_CYAN, max(0, min(255, round(242 * alpha_scale))))
    glint = (*REEL_CYAN, max(0, min(255, round(128 * alpha_scale))))
    # ring: stroke centered on r=12 -> outer edge r=13.25, width 2.5
    ro = 13.25 * k
    d.ellipse([cx - ro, cy - ro, cx + ro, cy + ro], outline=ring,
              width=max(1, round(2.5 * k)))
    # glint arc: stroke centered on r=8.25 -> outer edge r=9.25, width 2
    go = 9.25 * k
    d.arc([cx - go, cy - go, cx + go, cy + go], start=210, end=285,
          fill=glint, width=max(1, round(2.0 * k)))
    # round caps on the glint (PIL arcs are butt-capped)
    for ang in (210.0, 285.0):
        ex = cx + 8.25 * k * math.cos(math.radians(ang))
        ey = cy + 8.25 * k * math.sin(math.radians(ang))
        rc = 1.0 * k
        d.ellipse([ex - rc, ey - rc, ex + rc, ey + rc], fill=glint)


def _reel_title_card(path: str, w: int, h: int, you: str, them: str,
                     date_str: str):
    """Dark title card: '<You> vs <Them>' big, date small and muted.
    No wordmark — branding lives on the outro. Rendered 2x, downscaled."""
    from PIL import Image, ImageDraw
    s = 2
    W, H = w * s, h * s
    img = Image.new("RGB", (W, H), REEL_BG)
    d = ImageDraw.Draw(img)

    name_size = max(40, int(H * 0.088))
    while True:  # shrink long names until the line fits
        f_name = _load_font(name_size, "bold")
        f_vs = _load_font(max(18, int(name_size * 0.5)), "regular")
        gap = int(name_size * 0.45)
        w_you = d.textlength(you, font=f_name)
        w_vs = d.textlength("vs", font=f_vs)
        w_them = d.textlength(them, font=f_name)
        total = w_you + w_vs + w_them + 2 * gap
        if total <= W * 0.9 or name_size <= 20 * s:
            break
        name_size = int(name_size * 0.92)

    base_y = int(H * 0.47)
    x = (W - total) / 2
    d.text((x, base_y), you, font=f_name, fill=REEL_WHITE, anchor="ls")
    x += w_you + gap
    d.text((x, base_y), "vs", font=f_vs, fill=(113, 113, 122), anchor="ls")
    x += w_vs + gap
    d.text((x, base_y), them, font=f_name, fill=REEL_WHITE, anchor="ls")

    if date_str:
        f_date = _load_font(max(16, int(H * 0.034)), "regular")
        d.text((W / 2, base_y + int(H * 0.09)), date_str, font=f_date,
               fill=REEL_MUTED, anchor="ms")
    img.resize((w, h), Image.LANCZOS).save(path)


def _reel_outro_card(path: str, w: int, h: int):
    """Outro: the cyan lens-ring mark centered above 'ponglens.com'."""
    from PIL import Image, ImageDraw
    s = 2
    W, H = w * s, h * s
    img = Image.new("RGBA", (W, H), (*REEL_BG, 255))
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    mark_box = int(H * 0.24)          # viewBox; visible ring ~0.83x this
    mark_cy = H * 0.42
    _draw_lens_mark(layer, W / 2, mark_cy, mark_box)
    img = Image.alpha_composite(img, layer)
    d = ImageDraw.Draw(img)
    f = _load_font(max(20, int(H * 0.052)), "medium")
    d.text((W / 2, mark_cy + mark_box * 0.5 + H * 0.06), "ponglens.com",
           font=f, fill=REEL_WHITE, anchor="ms")
    img.convert("RGB").resize((w, h), Image.LANCZOS).save(path)


def _reel_watermark(path: str, h: int):
    """Lens-ring glyph + 'PongLens', ~3% of frame height, ~50% opacity.
    Overlaid bottom-right; the only branding visible during play."""
    from PIL import Image, ImageDraw
    s = 3
    text_size = max(11, int(h * 0.026)) * s
    font = _load_font(text_size, "bold")
    text = "PongLens"
    probe = ImageDraw.Draw(Image.new("RGBA", (8, 8)))
    tw = int(probe.textlength(text, font=font))
    asc, desc = font.getmetrics()
    mark_box = int(text_size * 1.5)
    gap = int(text_size * 0.35)
    pad = 2 * s
    W = pad * 2 + mark_box + gap + tw
    Hh = pad * 2 + max(mark_box, asc + desc)
    img = Image.new("RGBA", (W, Hh), (0, 0, 0, 0))
    cy = Hh / 2
    _draw_lens_mark(img, pad + mark_box / 2, cy, mark_box, alpha_scale=0.5)
    d = ImageDraw.Draw(img)
    d.text((pad + mark_box + gap, cy + (asc - desc) * 0.5 - asc * 0.48),
           text, font=font, fill=(255, 255, 255, 128), anchor="lm")
    img.resize((max(1, W // s), max(1, Hh // s)), Image.LANCZOS).save(path)


def _fit_name(name: str, limit: int = 16) -> str:
    """Full display name, capped at `limit` chars with an ellipsis."""
    name = (name or "").strip() or "Player"
    return name if len(name) <= limit else name[: limit - 1] + "…"


def _reel_scorebug(path: str, frame_h: int, you: str, them: str,
                   games_detail: list, score_you: int, score_them: int):
    """Broadcast two-row score table, tennis-style full score:

        | Adil       11   6 |[ 3 ]|
        | Vaibhav     9  11 |[ 1 ]|

    Rows are the players (full names, cyan/magenta 3px leading bars — the
    app's You/Them accents), then one muted-zinc column per completed game
    (that player's points in it), then the CURRENT game's points inside a
    slightly brighter cyan-tinted box, broadcast-bug style. Near-black
    translucent panel (#0a0a12 ~85%) with a thin edge and rounded corners.

    Designed in 1080p units and scaled by frame_h/1080, rendered 3x
    supersampled and LANCZOS-downscaled. Panel height ~8% of the frame."""
    from PIL import Image, ImageDraw
    s = 3
    # 1.5x: owner sized the bug up from the original ~8% of frame height
    # to ~12% — everything (fonts, pads, panel) scales through k.
    k = (frame_h / 1080.0) * s * 1.5    # design px -> supersampled px

    def px(v: float) -> float:
        return v * k

    f_name = _load_font(max(8, round(px(25))), "medium")
    f_game = _load_font(max(8, round(px(22))), "regular")
    f_cur = _load_font(max(8, round(px(27))), "bold")

    row_h = px(35)
    pad_y = px(8)
    H = round(2 * row_h + 2 * pad_y)    # ~86 design px = 8% of 1080

    rows = [  # (name, accent, per-game points, current points)
        (_fit_name(you), REEL_CYAN,
         [int(g[0]) for g in games_detail], int(score_you)),
        (_fit_name(them), REEL_MAGENTA,
         [int(g[1]) for g in games_detail], int(score_them)),
    ]

    probe = ImageDraw.Draw(Image.new("RGBA", (8, 8)))
    # column geometry (all in supersampled px)
    x_bar = px(14)
    bar_w = px(3.5)
    x_name = x_bar + bar_w + px(11)
    name_w = max(probe.textlength(r[0], font=f_name) for r in rows)
    x_games = x_name + name_w + px(24)
    game_cols = []                       # (center_x,) per completed game
    x = x_games
    for gi in range(len(games_detail)):
        col_w = max(probe.textlength(str(rows[r][2][gi]), font=f_game)
                    for r in range(2)) + px(20)
        game_cols.append(x + col_w / 2)
        x += col_w
    x += px(10) if games_detail else px(2)
    # current-game box: highlighted, spans both rows
    cur_w = max(probe.textlength(str(r[3]), font=f_cur) for r in rows)
    box_w = cur_w + px(32)
    box_x0, box_x1 = x, x + box_w
    W = round(box_x1 + px(8))

    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    edge = max(1, round(px(1)))

    # ImageDraw REPLACES pixels (no alpha blending), so anything painted on
    # top of the panel must be pre-blended against the panel color or it
    # punches a translucent hole showing the video through.
    def blend(tint, t, alpha):
        return tuple(round(b + (c - b) * t)
                     for b, c in zip(REEL_BG, tint)) + (alpha,)

    d.rounded_rectangle([0, 0, W - 1, H - 1], radius=px(12),
                        fill=(*REEL_BG, 217),             # ~85% #0a0a12
                        outline=(255, 255, 255, 36), width=edge)
    # current-game box: cyan-tinted dark, slightly brighter than the panel
    d.rounded_rectangle([box_x0, px(7), box_x1, H - 1 - px(7)],
                        radius=px(8),
                        fill=blend(REEL_CYAN, 0.16, 230),
                        outline=blend(REEL_CYAN, 0.45, 235), width=edge)
    # subtle row divider (stops short of the current-game box)
    d.rectangle([x_name, H / 2 - px(0.5), box_x0 - px(10), H / 2 + px(0.5)],
                fill=blend((255, 255, 255), 0.10, 220))

    for r, (name, accent, games, cur) in enumerate(rows):
        cy = pad_y + row_h * (r + 0.5)
        bh = px(20)
        d.rounded_rectangle([x_bar, cy - bh / 2, x_bar + bar_w, cy + bh / 2],
                            radius=bar_w / 2, fill=(*accent, 235))
        d.text((x_name, cy), name, font=f_name,
               fill=(*REEL_WHITE, 255), anchor="lm")
        for gi, cx in enumerate(game_cols):
            won = games[gi] > rows[1 - r][2][gi]
            fill = (212, 212, 216, 255) if won else (128, 128, 137, 255)
            d.text((cx, cy), str(games[gi]), font=f_game,
                   fill=fill, anchor="mm")
        d.text(((box_x0 + box_x1) / 2, cy), str(cur), font=f_cur,
               fill=(250, 250, 250, 255), anchor="mm")

    img = img.resize((max(1, round(W / s)), max(1, round(H / s))),
                     Image.LANCZOS)
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


def render_reel(manifest: dict, show_score: bool, workdir: str,
                cut_local: str | None = None) -> str:
    """Render the reel mp4 from the manifest. Returns the output path.

    cut_local: local path to the match's full-resolution cut video. Points
    with seg_start/seg_end bounds are extracted from it at source
    resolution; points without bounds — and everything when it is None
    (pre-v2 manifests, cut lost to 30-day retention) — fall back to their
    720p preview clips."""
    points = manifest["points"]
    you = (manifest.get("you_name") or "Player").strip() or "Player"
    them = (manifest.get("them_name") or "Opponent").strip() or "Opponent"
    played_at = manifest.get("played_at") or ""
    try:
        date_str = datetime.fromisoformat(
            played_at.replace("Z", "+00:00")).strftime("%B %-d, %Y")
    except (ValueError, AttributeError):
        date_str = ""

    # 1. Pick each point's source: cut segment when we have both the cut
    # video and this point's bounds, else its preview clip (downloaded).
    cut_dur = None
    if cut_local and os.path.exists(cut_local):
        cut_dur = float(_ffprobe_streams(cut_local)["format"]["duration"])
    sources = []            # ("cut", start_s, dur_s) | ("clip", local_path)
    for i, p in enumerate(points):
        s0, s1 = p.get("seg_start"), p.get("seg_end")
        if cut_dur is not None and s0 is not None and s1 is not None:
            s0 = max(0.0, float(s0))
            s1 = min(float(s1), cut_dur)   # clamp to the cut's real length
            if s1 - s0 >= 0.5:
                sources.append(("cut", s0, s1 - s0))
                continue
        local = os.path.join(workdir, f"src_{i:02d}.mp4")
        loc = parse_r2_path(p["clip_path"])
        if loc:
            r2().download_file(loc[0], loc[1], local)
        elif os.path.isfile(p["clip_path"]):
            # local path: only produced by the --render-test harness
            shutil.copyfile(p["clip_path"], local)
        else:
            raise RuntimeError(f"reel: point {p.get('point_id')} has no r2 "
                               "clip path")
        sources.append(("clip", local))
    n_cut = sum(1 for src in sources if src[0] == "cut")

    # 2. Target format: the cut video (full source resolution) when any
    # segment comes from it, else the first preview clip. Audio only if
    # EVERY contributing source has it.
    fmt_src = cut_local if n_cut else sources[0][1]
    fmt = _ffprobe_streams(fmt_src)
    v0 = next(s for s in fmt["streams"] if s["codec_type"] == "video")
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

    def _has_audio(path: str) -> bool:
        return any(s["codec_type"] == "audio"
                   for s in _ffprobe_streams(path)["streams"])

    audio_srcs = {cut_local if src[0] == "cut" else src[1]
                  for src in sources}
    keep_audio = all(_has_audio(p) for p in audio_srcs)

    # Hardware encoders are bitrate-driven. ~9 Mbps for 1080p30, scaled
    # linearly with pixel count and frame rate, keeps full-resolution
    # sports footage visually clean without bloating phone downloads.
    bitrate = int(9_000_000 * (tw * th) / (1920 * 1080) * (fps_f / 30.0))
    bitrate = max(4_000_000, min(bitrate, 24_000_000))
    vt = ["-c:v", "h264_videotoolbox", "-b:v", str(bitrate),
          "-allow_sw", "1", "-pix_fmt", "yuv420p"]
    x264 = ["-c:v", "libx264", "-preset", "medium", "-crf", "19",
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

    # 5. Point sources -> normalized segments with burned-in overlays. The
    # scorebug is static per segment: the score entering that rally.
    # Safe margins: bug bottom-LEFT, watermark bottom-RIGHT.
    margin_x = max(16, int(tw * 0.02))
    margin_y = max(16, int(th * 0.028))
    segments = [seg_title]
    for i, (src, p) in enumerate(zip(sources, points)):
        seg = os.path.join(workdir, f"seg_{i:02d}.mp4")
        if src[0] == "cut":
            # input-side seek + duration: frame-accurate under re-encode
            inputs = ["-ss", f"{src[1]:.3f}", "-t", f"{src[2]:.3f}",
                      "-i", cut_local, "-i", wm_png]
        else:
            inputs = ["-i", src[1], "-i", wm_png]
        chain = (
            f"[0:v]scale={tw}:{th}:force_original_aspect_ratio=decrease,"
            f"pad={tw}:{th}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,"
            f"fps={fps_f:.5f}[base];"
            # watermark bottom-RIGHT; the scorebug owns the bottom-left
            f"[base][1:v]overlay=W-w-{margin_x}:H-h-{margin_y}[wm]"
        )
        last = "wm"
        if show_score:
            bug = os.path.join(workdir, f"bug_{i:02d}.png")
            _reel_scorebug(bug, th, you, them,
                           p.get("games_detail") or [],
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
    log.info("  reel: rendered %d point(s) (%d from cut, %d from clips) at "
             "%dx%d %.2ffps ~%d kbps, audio=%s, encoder=%s",
             len(sources), n_cut, len(sources) - n_cut, tw, th, fps_f,
             bitrate // 1000, keep_audio, encoder_used)
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


def _fetch_cut_video(conn, match_id: str, workdir: str) -> str | None:
    """Download the match's full-resolution cut video ONCE per render —
    matches.cut_path, falling back to the source job's result path exactly
    like /api/media-url does. Returns the local path, or None (the 30-day
    results retention may have deleted it) — the caller then falls back to
    the 720p preview clips."""
    with conn.cursor() as cur:
        cur.execute(
            "select m.cut_path, j.result_path, j.status "
            "from public.matches m "
            "left join public.jobs j on j.id = m.job_id "
            "where m.id = %s",
            (match_id,),
        )
        row = cur.fetchone()
    if not row:
        return None
    cut_path, result_path, job_status = row
    path = cut_path or (result_path if job_status == "done" else None)
    if not path:
        return None
    local = os.path.join(workdir, "cut_source.mp4")
    try:
        loc = parse_r2_path(path)
        if loc:
            log.info("  reel: downloading cut r2://%s/%s", *loc)
            r2().download_file(loc[0], loc[1], local)
        else:
            log.info("  reel: downloading cut results/%s (legacy)", path)
            storage_download("results", path, local)
        if os.path.getsize(local) > 0:
            return local
    except Exception as e:
        log.warning("  reel: cut video unavailable (%s) — falling back to "
                    "preview clips", e)
    return None


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
        cut_local = None
        if any(isinstance(p, dict) and p.get("seg_start") is not None
               for p in manifest["points"]):
            cut_local = _fetch_cut_video(conn, match_id, workdir)
        out = render_reel(manifest, bool(show_score), workdir, cut_local)
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
            local_input, input_path, yt_title = fetch_youtube(
                conn, job_id, user_id, options, workdir)
            r2_input = parse_r2_path(input_path)
            # The import form keeps the processing toggles editable while
            # the download runs (it takes minutes). Flip the lock marker
            # FIRST — progress=10 while 'processing' is the UI's cutoff
            # signal — THEN take the final options snapshot, so every edit
            # saved before the marker flipped is guaranteed to be in it.
            update_job(conn, job_id, progress=10)
            options = get_job_options(conn, job_id, payload)
            strictness = options.get("strictness", "normal")
            if strictness not in VALID_STRICTNESS:
                strictness = "normal"
            log.info("  options re-read post-download: points=%s "
                     "placement=%s strictness=%s",
                     bool(options.get("points")),
                     bool(options.get("placement")), strictness)
            # "Adil vs Faye" in the title -> opponent prefill (fail-open,
            # never overwrites a user-typed name).
            prefill_opponent_from_title(conn, job_id, user_id, options,
                                        yt_title)
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
def _code_version() -> str:
    """git describe of the checkout the daemon actually loaded, so
    worker.log shows when a long-lived daemon is running stale code
    (root cause of the 2026-07-22 NULL-cut_t0 matches)."""
    try:
        out = subprocess.run(
            ["git", "-C", os.path.dirname(os.path.abspath(__file__)),
             "log", "-1", "--format=%h %s"],
            capture_output=True, text=True, timeout=10)
        return out.stdout.strip() or "unknown"
    except Exception:
        return "unknown"


def main():
    log.info("PongLens worker starting (supabase=%s, code=%s)",
             SUPABASE_URL, _code_version())
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


def _render_test(argv: list[str]) -> None:
    """Local visual harness — NEVER touches jobs/match_reels/R2 uploads.

        python3 worker.py --render-test <outdir> <manifest.json> [cut.mp4]
        python3 worker.py --render-test <outdir> <clip1.mp4> [clip2 ...]

    Manifest mode (v2): renders from a hand-built manifest JSON; points
    with seg_start/seg_end are extracted from the local cut video (2nd
    arg), the rest from their clip_path (local file paths allowed).
    Clips mode (legacy): builds a plausible manifest over local clips.
    <outdir> doubles as the workdir, so overlay PNGs and per-segment mp4s
    stay around for inspection."""
    i = argv.index("--render-test")
    args = argv[i + 1:]
    if len(args) < 2:
        sys.exit("usage: worker.py --render-test <outdir> "
                 "<manifest.json|clip.mp4> [cut.mp4|clip2.mp4 ...]")
    outdir = args[0]
    os.makedirs(outdir, exist_ok=True)

    if args[1].endswith(".json"):
        with open(args[1]) as fh:
            manifest = json.load(fh)
        cut_local = args[2] if len(args) > 2 else None
        out = render_reel(manifest, show_score=True, workdir=outdir,
                          cut_local=cut_local)
        print(out)
        return

    clip_paths = args[1:]
    # plausible score progression entering each rally
    # (completed games' point pairs, current points)
    states = [
        ([], 0, 0),
        ([], 3, 1),
        ([[11, 9]], 10, 9),
        ([[11, 9], [6, 11]], 5, 7),
    ]
    points = []
    for n, clip in enumerate(clip_paths):
        gd, sy, st = states[n % len(states)]
        points.append({"point_id": f"test-{n}", "clip_path": clip,
                       "seg_start": None, "seg_end": None,
                       "games_you": sum(1 for g in gd if g[0] > g[1]),
                       "games_them": sum(1 for g in gd if g[1] > g[0]),
                       "games_detail": gd,
                       "score_you": sy, "score_them": st})
    manifest = {"version": 2, "you_name": "Adil", "them_name": "Vaibhav",
                "played_at": "2026-07-22T00:00:00Z", "points": points}
    out = render_reel(manifest, show_score=True, workdir=outdir)
    print(out)


if __name__ == "__main__":
    if "--digest-once" in sys.argv:
        # Manual/verification run: one digest check against the real DB,
        # honoring app_config.digest_last_sent, then exit.
        maybe_send_feedback_digest(connect())
    elif "--render-test" in sys.argv:
        _render_test(sys.argv)
    else:
        main()

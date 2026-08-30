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
  - R2 ponglens-raw: raw uploads older than 30 days -> delete
  - R2 ponglens-media results/: cut videos older than 30 days -> delete
  - Later phases add tiers for point clips + match.json (keep while account
    active) and voice audio (90 days); wire them in here when they exist.
  - Legacy Supabase 'uploads' bucket: older than 30 days -> delete (until
    the last legacy rows age out, then this can go)

Dependencies:  pip3 install psycopg2-binary requests boto3
Secrets:       macOS Keychain (see worker/README.md) or env vars.
"""

import base64
import copy
import html
import json
import logging
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import boto3
import psycopg2
import psycopg2.extras
import requests
from botocore.exceptions import ClientError

try:
    from worker.cost_alerts import (
        PostgresCostAlertStore,
        deliver_cost_alerts,
    )
    from worker.cost_meter import CostMeter, stable_key
    from worker.cost_reconcile import (
        record_r2_storage_snapshot,
        run_daily_reconciliation,
    )
except ModuleNotFoundError:  # direct `python worker/worker.py` execution
    from cost_alerts import PostgresCostAlertStore, deliver_cost_alerts
    from cost_meter import CostMeter, stable_key
    from cost_reconcile import (
        record_r2_storage_snapshot,
        run_daily_reconciliation,
    )

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
TTVID = "/Users/adil/Desktop/Projects/TTVid"
VENV_PY = f"{TTVID}/vendor/venv/bin/python"          # numpy+cv2 (+torch)
BLURBALL_INFER = f"{TTVID}/vendor/blurball_infer.py"
POINTS_PIPELINE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "points_pipeline.py")
# Also under VENV_PY: it needs scipy, which the worker's own venv does not
# carry and should not start carrying for one diagnostic row.
CARD_AUDIO = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "card_audio.py")
MATCH_STRUCTURE_SCRIPT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "extract_match_structure_rtmpose.py",
)
MATCH_STRUCTURE_ENABLED = (
    os.environ.get("PONGLENS_RTMPOSE_STRUCTURE_ENABLED") == "true"
)
RTMPOSE_PY = os.environ.get(
    "PONGLENS_RTMPOSE_PY",
    "/Users/adil/Library/Caches/PongLens/rtmpose-production/venv/bin/python",
)
RTMPOSE_MODEL = os.environ.get(
    "PONGLENS_RTMPOSE_MODEL",
    "/Users/adil/Library/Caches/PongLens/rtmpose-production/end2end.onnx",
)
RTMPOSE_BACKEND = os.environ.get(
    "PONGLENS_RTMPOSE_BACKEND",
    "onnxruntime",
)
RTMPOSE_DEVICE = os.environ.get("PONGLENS_RTMPOSE_DEVICE", "mps")

VALID_STRICTNESS = ("tight", "normal", "loose")

# YouTube import (jobs.kind = 'youtube_import', options.url).
#
# NOT the Homebrew copy, and the ordering below is the whole point.
# YouTube rotates which player clients will serve media, so a yt-dlp more
# than a few weeks old stops being able to download while still probing
# fine — you get metadata, then 403 partway through the stream. That is
# what took imports out between 2026-08-13 and 2026-08-19: every attempt
# walked the height ladder down to 480p and 403'd on each rung. The
# advice this comment used to carry, `brew upgrade yt-dlp`, could not
# have fixed it: homebrew-core was ITSELF still on 2026.07.04 while
# upstream had shipped 2026.08.19, and the two versions pick different
# player clients (android vr, which was being refused, against visionos,
# which was not).
#
# So the standalone build in ~/.local/bin wins over anything on PATH. It
# updates itself (`yt-dlp -U`) instead of waiting on a packager, which is
# the property that matters when the breakage is upstream and dated.
YTDLP = next(
    (p for p in (os.environ.get("YTDLP_PATH"),
                 os.path.expanduser("~/.local/bin/yt-dlp"),
                 shutil.which("yt-dlp"),
                 "/opt/homebrew/bin/yt-dlp")
     if p and os.path.exists(p)),
    "/opt/homebrew/bin/yt-dlp",
)
# mp4/h264 <= 1080p keeps the file compatible with the existing pipeline
# (blurball + ffmpeg cut) without a re-encode step.
#
# HEIGHT LADDER (2026-08-13). An import failed with "unable to download
# video data: HTTP Error 403" — metadata and the player API fine, then
# the media stream cut off ~10 MB in. In one window it reproduced three
# times at 1080p at the same offset (with and without --http-chunk-size)
# while the SAME video's 720p rendition completed at full speed; an hour
# later 1080p downloaded in full. So it is INTERMITTENT refusal, not a
# ban, not a stale yt-dlp (2026.07.04 was current), and not the video
# being unlisted — most likely rate limiting, which the bigger rendition
# is simply exposed to for longer.
#
# Signing in would probably paper over it, but at scale that means every
# user's import downloading under ONE Google account — the exact pattern
# YouTube's anti-abuse blocks, with the whole feature behind a single
# point of failure. Stepping down a rung carries no credentials and
# degrades instead of failing.
YTDLP_HEIGHTS = (1080, 720, 480)


def _ytdlp_format(height: int) -> str:
    return (f"bv*[ext=mp4][height<={height}]+ba[ext=m4a]/"
            f"b[ext=mp4][height<={height}]/b[ext=mp4]")


# Retained for callers/tests that want the default selector.
YTDLP_FORMAT = _ytdlp_format(YTDLP_HEIGHTS[0])
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

# Broadcast gate: televised or professionally produced match footage, which
# is usually a YouTube import. The pipeline can do nothing useful with it.
# The camera cuts between points, so the table moves, the players change and
# the venue changes, and every stage downstream (calibration, point
# assembly, placement) is looking at a different match every few seconds. It
# costs real compute, and none of it is the player's own game.
#
# TWO signals, and BOTH must fire. Measured 2026-08-22 against 26 videos a
# real person would upload (22 phone recordings from 2 users across 7
# venues, one under-13 tournament, and three synthesised self-edited
# videos) and 6 broadcasts:
#
#   cuts   frames whose ffmpeg scene score clears BROADCAST_CUT_SCORE,
#          over windows spread across the file. All 22 real recordings
#          scored ZERO; the broadcasts scored 13 to 34. Costs only CPU on
#          a file that is already local, so it runs FIRST and an ordinary
#          upload never reaches the paid half at all.
#   vision per-frame production markers: a score bug, a player-name lower
#          third, a channel logo, a replay badge, or a shot that is not a
#          plain wide view of one table.
#
# Neither is safe on its own, and that is measured rather than cautious:
#   - vision alone called a real under-13 tournament a broadcast on 12 of
#     12 frames. It is a parent's tripod, an umpire at a flip scoreboard
#     and equipment-sponsor barriers, and it reads as "tournament";
#   - cuts alone flagged a player's own highlights reel at 14, which is
#     inside the broadcast band.
# Each signal's blind spot is the other's strong suit, so this is an AND
# and must stay one. Widening either alone re-opens a rejection of real
# footage, which is far worse than passing a broadcast through.
#
# Known miss: a very short highlight clip. A 10s single rally has no cuts
# to find, and it bills one minute, so it is not worth widening a signal
# to catch. Left deliberately.
BROADCAST_CUT_SCORE = 0.30       # real footage topped out at 0.26
BROADCAST_CUT_FRAMES = 5         # real max was 2, broadcast min was 13
BROADCAST_WINDOW_S = 60          # four windows spread across the video
BROADCAST_WINDOWS = 4
BROADCAST_SAMPLE_FPS = 5
BROADCAST_SAMPLE_WIDTH = 320
# Three trials and take the median. One bad roll flips every frame in the
# batch at once (a real PingPod session came back 12 of 12 on one trial of
# three, because the wall screens reading "Table 2" look like a score bug),
# so a single call is not a safe reading.
BROADCAST_VISION_TRIALS = 3
# Only videos that already cleared the cut half ever reach this number, so
# what it has to separate is not "amateur vs broadcast" but "a player's own
# edit vs a broadcast". The player's own 16-cut highlights reel scored 0 on
# 9 trials of 9. A highlights compilation of professional rallies is the
# thin one, because most of its frames are wide rally shots with no graphic
# on them: 9 trials gave a median of 7 and a minimum of 4, and a different
# frame sample of the same video gave a median of 3. Three sits above every
# legitimate reading seen (highest was a median of 1, on a video that never
# reaches this call) and below every broadcast reading seen.
BROADCAST_MIN_VISION = 3
BROADCAST_TIMEOUT_S = 30
BROADCAST_REJECT_MSG = (
    "This looks like broadcast footage of a professional match. PongLens "
    "works on a recording of your own match from a single camera, so "
    "upload one of those instead.")
SKIP_BROADCAST_CHECK = os.environ.get(
    "WORKER_SKIP_BROADCAST_CHECK", "").lower() not in ("", "0", "false")
# Every message an upload gate can refuse with. check_match_row_alive reads
# this to recognise a rejection it did not itself make; a new gate that
# forgets to register here emails the uploader its refusal twice.
GATE_REJECT_MSGS = [CONTENT_CHECK_REJECT_MSG, BROADCAST_REJECT_MSG]
OPENAI_BASE_URL = os.environ.get(
    "WORKER_OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")


class UserFacingError(Exception):
    """A job failure whose message is safe to show to the user verbatim.
    Deterministic (retrying won't help), so the queue message is archived
    immediately instead of burning the usual 3 attempts.

    already_reported marks a failure that is only the echo of an earlier
    job's failure — the processing job that died because the content check
    already rejected and removed its match. The row still fails with the
    message (the bell rides user_message), but no email goes out: the
    uploader heard the real reason when the first job failed."""

    def __init__(self, message: str, already_reported: bool = False):
        super().__init__(message)
        self.already_reported = already_reported

# Idle sleep between empty queue reads.
#
# Fifteen seconds was right when every job was a 45-minute upload nobody was
# watching — the wait was invisible against a pipeline that ran for minutes.
# Sharing a rally to Instagram (135) broke that assumption: the render takes
# about two seconds and someone is holding the phone through it, so the nap
# WAS the feature's latency. Measured end to end, a share took 18 seconds
# and 14 of them were this line.
#
# Two seconds costs 30 cheap pgmq reads a minute on a connection the worker
# already holds open, against 4. That is nothing, and it speeds up every
# other job's pickup as a side effect. Do not "optimise" this back up
# without checking what a share feels like afterwards.
POLL_SLEEP_S = 2
VISIBILITY_S = 1800        # pgmq visibility timeout (30 min per attempt)
# Two attempts, not three. One retry covers the transient case a retry can
# actually fix — a dropped connection, a cold model, a busy GPU — and a third
# has never rescued a job that a second did not. Every attempt past that is
# another failure email on a 30-minute clock.
MAX_READ_CT = 2            # archive (give up) after this many attempts
CLEANUP_EVERY_S = 24 * 3600
COST_ALERT_CHECK_EVERY_S = 60
LEGACY_UPLOAD_RETENTION_DAYS = 30   # Supabase 'uploads' bucket (legacy rows)

# R2 storage (SPEC.md §7)
R2_RAW_BUCKET = "ponglens-raw"
R2_MEDIA_BUCKET = "ponglens-media"
R2_RAW_RETENTION_DAYS = 30          # raw uploads
R2_RESULTS_RETENTION_DAYS = 30      # cut videos under results/
R2_VOICE_RETENTION_DAYS = 90        # voice note audio under voice/
ENTRY_ORPHAN_GRACE_DAYS = 2         # staged Journal images under entry/
                                    # (transcripts live in Postgres forever)

WORKER_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(WORKER_DIR, "worker.log")

# Under launchd the wrapper already appends stdout to worker.log, so a
# stdout handler there would double every line. The stream handler is for
# humans: only when stdout is a real terminal.
_log_handlers: list[logging.Handler] = [logging.FileHandler(LOG_PATH)]
if sys.stdout.isatty():
    _log_handlers.append(logging.StreamHandler(sys.stdout))
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=_log_handlers,
)
log = logging.getLogger("ponglens-worker")
COST_METER = CostMeter(None, logger=log)


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


class _MeteredR2Paginator:
    def __init__(self, paginator, operation: str):
        self._paginator = paginator
        self._operation = operation

    def paginate(self, *args, **kwargs):
        for page in self._paginator.paginate(*args, **kwargs):
            event = COST_METER.r2_operation_event(
                self._operation,
                uuid.uuid4().hex,
            )
            if event:
                COST_METER.record([event])
            yield page


class _MeteredR2Client:
    """Small boto3 proxy that records aggregate R2 operations after success."""

    def __init__(self, client):
        self._client = client

    def upload_file(self, *args, **kwargs):
        result = self._client.upload_file(*args, **kwargs)
        COST_METER.record([
            COST_METER.r2_operation_event(
                "upload_file", uuid.uuid4().hex
            )
        ])
        return result

    def download_file(self, *args, **kwargs):
        result = self._client.download_file(*args, **kwargs)
        COST_METER.record([
            COST_METER.r2_operation_event(
                "download_file", uuid.uuid4().hex
            )
        ])
        return result

    def get_paginator(self, operation_name: str):
        return _MeteredR2Paginator(
            self._client.get_paginator(operation_name),
            operation_name,
        )

    def generate_presigned_url(self, client_method: str, *args, **kwargs):
        result = self._client.generate_presigned_url(
            client_method, *args, **kwargs
        )
        event = COST_METER.r2_operation_event(
            client_method,
            uuid.uuid4().hex,
            assumed=True,
        )
        if event:
            COST_METER.record([event])
        return result

    def __getattr__(self, name):
        return getattr(self._client, name)


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
        _r2_client = _MeteredR2Client(
            boto3.client(
                "s3",
                endpoint_url=(
                    f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
                ),
                aws_access_key_id=R2_ACCESS_KEY_ID,
                aws_secret_access_key=R2_SECRET_ACCESS_KEY,
                region_name="auto",
            )
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


def sign_feedback_attachment(key: str, expires_days: int = 7) -> str | None:
    """Short-ish signed GET for a private feedback screenshot, for the daily
    digest (owner is admin, so full visibility is fine). Best-effort."""
    try:
        return r2().generate_presigned_url(
            "get_object",
            Params={
                "Bucket": R2_MEDIA_BUCKET,
                "Key": key,
                "ResponseContentDisposition": "inline",
            },
            ExpiresIn=expires_days * 86400,
        )
    except Exception as e:
        log.warning("feedback digest: sign attachment failed (%s): %s", key, e)
        return None

# Email notifications (Resend, send-only key). Optional: if the key is
# missing we log and carry on — email must never affect job processing.
RESEND_API_KEY = os.environ.get("PONGLENS_RESEND_KEY") or keychain(
    "ponglens-resend-key"
)

# OpenAI key for the upfront content check. Optional: if missing, the check
# is skipped (fail open) — it must never block job processing.
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY") or keychain("openai-api-key")
EMAIL_FROM = "PongLens <noreply@ponglens.com>"
# Replies land in the Fastmail support mailbox instead of dying at noreply@.
EMAIL_REPLY_TO = "support@ponglens.com"
ADMIN_EMAIL = "adilharis2001@gmail.com"
APP_URL = "https://ponglens.com"
DASHBOARD_URL = "https://ponglens.com/dashboard"


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------
def connect():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    COST_METER.connection = conn
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
def address_suppressed(to: str) -> bool:
    """True when this address has hard-bounced or complained (104).

    Fails open on purpose. Any error here answers "not suppressed" and the
    mail goes out: a suppression list protects domain reputation, which is
    a slow problem, while swallowing every job notification because one
    query failed is a fast one.

    Opens its own connection rather than borrowing the caller's, because
    send_email is called from paths that do not hold one, and connect()
    would rebind the global cost meter as a side effect.
    """
    if not DATABASE_URL:
        return False
    try:
        conn = psycopg2.connect(DATABASE_URL)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "select 1 from public.email_suppressions where address = %s",
                    (to.strip().lower(),),
                )
                return cur.fetchone() is not None
        finally:
            conn.close()
    except Exception as e:
        log.warning("suppression lookup failed, sending anyway: %s", e)
        return False


def send_email(
    to: str,
    subject: str,
    html_body: str,
    bcc: str | list[str] | None = None,
    *,
    idempotency_key: str | None = None,
    cost_meter: CostMeter | None = None,
):
    if not RESEND_API_KEY:
        log.warning("email skipped (no Resend key in Keychain): %s", subject)
        return
    if address_suppressed(to):
        log.info("email skipped (address suppressed): %s", subject)
        return
    # A bcc list arrives once QA watches failures alongside the admin. Each
    # address is checked on its own: suppression is a promise about an
    # address, and riding a bcc was never meant to get around it.
    bcc_list = [bcc] if isinstance(bcc, str) else list(bcc or [])
    bcc_list = [a for a in bcc_list if a and not address_suppressed(a)]
    if idempotency_key is not None and not (1 <= len(idempotency_key) <= 256):
        raise ValueError("invalid Resend idempotency key")
    payload: dict = {
        "from": EMAIL_FROM,
        "to": [to],
        "reply_to": EMAIL_REPLY_TO,
        "subject": subject,
        "html": html_body,
    }
    if bcc_list:
        payload["bcc"] = bcc_list
    r = requests.post(
        "https://api.resend.com/emails",
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json",
            **(
                {"Idempotency-Key": idempotency_key}
                if idempotency_key
                else {}
            ),
        },
        json=payload,
        timeout=30,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"Resend {r.status_code}: {r.text[:300]}")
    try:
        message_id = str(r.json().get("id") or uuid.uuid4())
    except (ValueError, AttributeError):
        message_id = str(uuid.uuid4())
    meter = cost_meter or COST_METER
    meter.record([
        meter.email_event(
            message_id,
            recipients=1 + len(bcc_list),
        )
    ])
    log.info(
        "  email sent: %r -> %s%s",
        subject,
        to,
        f" (bcc {', '.join(bcc_list)})" if bcc_list else "",
    )


def get_user_email(conn, user_id: str) -> str | None:
    with conn.cursor() as cur:
        cur.execute("select email from auth.users where id = %s", (user_id,))
        row = cur.fetchone()
    return row[0] if row and row[0] else None


def failure_watchers(conn, exclude: str | None = None) -> list[str]:
    """Who gets copied on a failure: the admin, and nobody else.

    QA used to be on this list, on the reasoning that the person who fixes
    things wants to see them break. In practice it meant the tester was
    bcc'd on every failure in the system including the admin's own crash
    reports, complete with raw exception text, for jobs that had nothing
    to do with them. That is somebody else's alarm going off in your
    kitchen, and it drowns the mail that IS theirs.

    Nothing is lost that they need. A tester whose own upload fails is the
    To on that email, not a bcc, so it still reaches them. Their reports
    and the replies on them arrive in the daily digest (128). This list is
    only ever the over-the-shoulder copy.

    `exclude` drops whoever is already the To, so nobody is mailed twice.
    """
    seen: set[str] = set()
    if exclude:
        seen.add(exclude.strip().lower())
    out: list[str] = []
    for address in [ADMIN_EMAIL]:
        key = (address or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(address)
    return out


def get_job_match_id(conn, job_id: str) -> str | None:
    """The match a finished job produced, so an email can point at it.

    Two places to look, because commerce mode (096) reversed the order the
    two rows are created in: a library upload writes the match first and
    stamps the job onto it later, while the legacy path creates the match
    from the job. matches.job_id covers the first, options.match_id the
    second, and asking for both costs one query.
    """
    # Best-effort, and that is the whole point. This runs inside the
    # match-ready email, which is the one message a player is actually
    # waiting for. Letting a lookup for a nicer link decide whether the
    # email goes out at all is a bad trade: a dashboard link is a mild
    # disappointment, silence is a broken promise. The test suite caught
    # this by calling notify_job_done with no connection.
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select m.id from public.matches m"
                " where m.job_id = %s"
                " union all"
                " select (j.options ->> 'match_id')::uuid from public.jobs j"
                " where j.id = %s and j.options ->> 'match_id' is not null"
                " limit 1",
                (job_id, job_id),
            )
            row = cur.fetchone()
        return str(row[0]) if row and row[0] else None
    except Exception as e:
        log.warning("  match lookup for the ready email failed: %s", e)
        return None


def get_job_original_name(conn, job_id: str) -> str | None:
    with conn.cursor() as cur:
        cur.execute(
            "select original_name from public.jobs where id = %s", (job_id,)
        )
        row = cur.fetchone()
    return row[0] if row and row[0] else None


def email_card_html(
    title: str,
    message: str,
    cta_label: str,
    cta_url: str,
) -> str:
    """Render the shared PongLens outcome-email card with escaped content."""
    safe_title = html.escape(title)
    safe_message = html.escape(message)
    safe_cta = html.escape(cta_label)
    safe_url = html.escape(cta_url, quote=True)
    return f"""\
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">{safe_title}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background-color:#f4f5f7;">
  <tr>
    <td align="center" style="padding:48px 16px;background-color:#f4f5f7;">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:16px;">
        <tr>
          <td align="center" style="padding:40px 32px 36px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <img src="https://www.ponglens.com/img/email-logo.png" width="180" height="44" alt="PongLens" style="display:block;width:180px;height:44px;border:0;margin:0 auto 28px;">
            <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;font-weight:700;color:#0f172a;">{safe_title}</h1>
            <p style="margin:0 0 28px;font-size:14px;line-height:1.6;color:#475569;">
              {safe_message}
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
              <tr>
                <td align="center" style="background-color:#0891b2;border-radius:999px;">
                  <a href="{safe_url}" style="display:inline-block;padding:13px 30px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;line-height:1;color:#ffffff;text-decoration:none;border-radius:999px;">{safe_cta}</a>
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


def done_email_html(original_name: str, match_id: str | None = None) -> str:
    """The one email a player actually waits for, so its button has to land
    on the match itself. It used to go to the dashboard for everyone: the
    bell notification had carried a real /match/<id> link since 031, and
    this sat one step behind it, dropping people on a list to find the
    video they had just been told was ready. Falls back to the dashboard
    only when the match cannot be resolved, which is the old behaviour and
    still better than a dead link."""
    return email_card_html(
        "Your match is ready",
        f"We finished processing {original_name}. Open PongLens to review "
        "the match point by point, add notes, and share it with your coach.",
        "Review your match",
        f"{APP_URL}/match/{match_id}" if match_id else DASHBOARD_URL,
    )


# PLACEMENT SENDS NO EMAIL, in either direction.
#
# There used to be three: a failed placement hijacked the subject of the
# match-ready email, and the two dedicated jobs (generate, retry) each sent
# their own success and failure notice. That is a lot of inbox for a beta
# feature whose maps are only as good as a table calibration that regularly
# is not — an email that says "couldn't be generated" lands with more
# authority than the feature has earned, and one that says "ready" is worse,
# because it may not be.
#
# The state lives on the match either way: the Tools row shows the status,
# and a failure explains itself there with the retry in reach. Someone who
# cares looks; nobody gets told about a beta at 6am.
#
# The admin still hears about it — a poisoned placement job falls through to
# notify_job_failed like any other failure.


def notify_job_done(conn, job_id: str, user_id: str):
    """Email the uploader that their video is ready. Never raises."""
    try:
        original_name = get_job_original_name(conn, job_id) or "your match video"
        body = done_email_html(original_name, get_job_match_id(conn, job_id))
        subject = "Your match is ready to review"
        to = get_user_email(conn, user_id)
        if to:
            send_email(to, subject, body, bcc=ADMIN_EMAIL)
        else:
            log.warning("  no email found for user %s; notifying admin only",
                        user_id)
            send_email(ADMIN_EMAIL, subject, body)
    except Exception as e:
        log.warning("  done email failed (non-fatal): %s", e)


def notify_job_failed(conn, job_id: str, error: str):
    """Email the admin, and anyone holding QA, about a failed job. The raw
    exception rides along — this is the copy for whoever fixes it, which
    is exactly who QA is. Never raises.
    """
    try:
        body = (
            "<div style=\"font-family:monospace;font-size:13px;\">"
            f"<p>PongLens job failed.</p>"
            f"<p><strong>Job:</strong> {html.escape(job_id)}</p>"
            f"<p><strong>Error:</strong> {html.escape(error[:1000])}</p>"
            "</div>"
        )
        send_email(
            ADMIN_EMAIL,
            f"PongLens job failed: {job_id[:8]}",
            body,
            bcc=failure_watchers(conn, exclude=ADMIN_EMAIL),
        )
    except Exception as e:
        log.warning("  failure email failed (non-fatal): %s", e)


def notify_upload_failed(conn, user_id: str, kind: str,
                         message: str | None) -> bool:
    """Tell the UPLOADER their video didn't make it. Never raises.

    Separate from notify_job_failed, which is the admin's copy and carries
    the raw exception. This one only ever sends what a person can act on:
    the UserFacingError text where we have it ("That video is private or
    unavailable."), and a plain line where the failure was a crash.

    Returns True when the email actually went out. The admin rides its bcc,
    so a True here means the failure handler can skip the separate admin
    copy for a user-facing failure — one event, one email.
    """
    try:
        if not user_id:
            return False
        what = "Import failed" if kind == "youtube_import" else "Upload failed"
        body = email_card_html(
            what,
            message or "We couldn't process this video.",
            "Try another video",
            f"{APP_URL}/upload",
        )
        to = get_user_email(conn, user_id)
        if to:
            send_email(to, what, body,
                       bcc=failure_watchers(conn, exclude=to))
            return True
        return False
    except Exception as e:
        log.warning("  upload failure email failed (non-fatal): %s", e)
        return False


def send_failure_emails(conn, e: Exception, job_id: str | None, kind: str,
                        user_id: str | None, user_message: str | None):
    """Decide who hears about a failed job. One failure, one email.

    An echo failure (already_reported: the processing job that died only
    because the content check had removed its match) sends nothing — the
    uploader heard the real reason when the first job failed. Otherwise
    the uploader is told about the jobs a person waits on, and the admin's
    separate copy goes out only where it adds something: a crash (whose
    message the uploader email withholds), or a failure that reached no
    uploader inbox. When the uploader email carried the full user-facing
    message, the admin is already on its bcc.
    """
    if isinstance(e, UserFacingError) and e.already_reported:
        return
    uploader_emailed = False
    if kind in ("deadspace_cut", "youtube_import", "content_check"):
        # The bell row is the trigger's job (066); this is the email.
        # A failed content check is an upload outcome too (097).
        uploader_emailed = notify_upload_failed(conn, user_id, kind,
                                                user_message)
    if job_id and not (isinstance(e, UserFacingError) and uploader_emailed):
        notify_job_failed(conn, job_id, str(e))


def check_match_row_alive(conn, match_id):
    """Raise UserFacingError when a library job has nothing left to process.

    Two ways that happens, and which one it is decides who hears about it.

    The content gate (097) rejected this exact video. The uploader was
    already emailed the reason, so this job dying is the same event and
    not news: carry the rejection text so the bell (066 fires only for
    processing kinds, not content_check) says what actually happened,
    flagged already_reported so no second email goes out. The rejection
    is checked BEFORE the row, because the row now survives a rejection —
    it stays as a failed match so the uploader can see why. Reading
    existence first would let this job march on and try to download a raw
    that was deleted seconds ago.

    Or the user deleted the row themselves, which stays a normally
    reported failure.
    """
    with conn.cursor() as cur:
        cur.execute(
            "select user_message from public.jobs"
            " where kind = 'content_check' and status = 'failed'"
            "   and user_message = any(%s)"
            "   and options->>'match_id' = %s"
            " order by created_at desc limit 1",
            (GATE_REJECT_MSGS, str(match_id)))
        row = cur.fetchone()
    if row:
        # Carry back the message the gate actually used. Matching on one
        # literal would have left a broadcast rejection unrecognised here,
        # and the uploader would have been emailed the same refusal twice.
        raise UserFacingError(row[0], already_reported=True)
    with conn.cursor() as cur:
        cur.execute("select 1 from public.matches where id = %s",
                    (match_id,))
        if cur.fetchone() is not None:
            return
    raise UserFacingError(
        "This video was removed before processing started.")


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
    shots_html = ""
    for url in (item.get("attachment_urls") or []):
        safe = html.escape(url, quote=True)
        shots_html += (
            f"<a href='{safe}' style='display:inline-block;margin:8px 8px 0 0;"
            f"text-decoration:none;'>"
            f"<img src='{safe}' width='96' height='96' alt='Screenshot' "
            f"style='display:block;width:96px;height:96px;object-fit:cover;"
            f"border-radius:8px;border:1px solid #e2e8f0;'></a>"
        )
    if shots_html:
        shots_html = (
            "<p style='margin:10px 0 0;font-size:11px;color:#94a3b8;'>"
            "Screenshots</p>" + shots_html
        )
    meta = f"{who} &middot; {votes} vote{'s' if votes != 1 else ''}"
    # QA reports (092) carry the two fields that make one reproducible.
    # Without them the digest describes a bug you then have to open the
    # board to act on, which is the trip the digest exists to save.
    if item.get("severity"):
        meta = f"{html.escape(str(item['severity']))} &middot; {meta}"
    env = item.get("environment") or {}
    env_bits = [str(env[k]) for k in ("viewport", "ua") if env.get(k)] \
        if isinstance(env, dict) else []
    env_html = (
        f"<p style='margin:6px 0 0;font-size:11px;line-height:1.5;"
        f"color:#94a3b8;'>"
        f"{' &middot; '.join(html.escape(b) for b in env_bits)}</p>"
    ) if env_bits else ""
    return (
        "<div style='margin:12px 0 0;padding:14px 16px;background:#f8fafc;"
        "border:1px solid #e2e8f0;border-radius:12px;'>"
        f"<p style='margin:0;font-size:14px;font-weight:700;color:#0f172a;'>"
        f"{title}</p>"
        f"<p style='margin:6px 0 0;font-size:13px;line-height:1.55;"
        f"color:#475569;white-space:pre-wrap;'>{body_txt}</p>"
        f"{qa_html}"
        f"{shots_html}"
        f"{env_html}"
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
                "       i.attachments, i.severity, i.environment, "
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

        # Sign each attachment (one-week GET) so the owner can open screenshots
        # straight from the email. Best-effort; a failed sign is just skipped.
        for it in new_items:
            urls = []
            for att in (it.get("attachments") or []):
                if isinstance(att, dict) and att.get("key"):
                    signed = sign_feedback_attachment(att["key"])
                    if signed:
                        urls.append(signed)
            it["attachment_urls"] = urls

        # Claimed before the send, for the reason spelled out on the QA
        # digest below: this used to be set only after send_email
        # returned, so any throw on that line skipped it and the next
        # fifteen-minute cycle sent the same digest again. That is exactly
        # how the QA one reached 39 copies. It has never bitten here only
        # because the sends have happened to succeed, which is luck rather
        # than design. A digest that misses a day is a nuisance; one that
        # repeats every quarter hour costs a mailbox its trust.
        set_config(conn, "digest_last_sent", today)

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
    except Exception as e:
        log.warning("feedback digest failed (non-fatal): %s", e)


# ---------------------------------------------------------------------------
# Closed-report digest (103) — the tester's half of the feedback loop.
#
# 102 keeps QA reports off the public board, so the only sign anything has
# happened to one is a status chip on a page the tester has to remember to
# open. Once per Toronto day each QA author gets one mail listing their
# reports that closed since the last one. Nothing closed, no mail.
#
# Rows are stamped rather than windowed: closed_notified_at is written only
# after Resend accepts the mail, so a send that fails, or a day the worker
# spends switched off, retries instead of losing the news.
# ---------------------------------------------------------------------------
# Both vocabularies: feedback_items closes as done/declined, qa_bugs (104)
# as closed/rejected/duplicate. The tester sees one word either way.
_CLOSED_STATUS_LABEL = {
    "done": "Done",
    "declined": "Not doing",
    "closed": "Fixed and closed",
    "rejected": "Not a bug",
    "duplicate": "Already reported",
}


def _closed_item_html(item: dict) -> str:
    """One closed report as a light-theme card row."""
    title = html.escape(item["title"] or "")
    body_txt = html.escape((item["body"] or "").strip())
    if len(body_txt) > 240:
        body_txt = body_txt[:240].rstrip() + "…"
    label = _CLOSED_STATUS_LABEL.get(item["status"], item["status"])
    # A fix landing is the good outcome and reads green. Everything else is
    # neutral: "not a bug" is information, not bad news.
    chip_colour = (
        "#059669" if item["status"] in ("done", "closed") else "#64748b"
    )
    filed = ""
    if item.get("created_at"):
        filed = f" &middot; filed {item['created_at'].strftime('%-d %b')}"
    return (
        "<div style='margin:12px 0 0;padding:14px 16px;background:#f8fafc;"
        "border:1px solid #e2e8f0;border-radius:12px;'>"
        f"<p style='margin:0;font-size:14px;font-weight:700;color:#0f172a;'>"
        f"{title}</p>"
        f"<p style='margin:6px 0 0;font-size:12px;color:{chip_colour};"
        f"font-weight:700;'>{label}"
        f"<span style='color:#94a3b8;font-weight:400;'>{filed}</span></p>"
        + (
            f"<p style='margin:8px 0 0;font-size:13px;line-height:1.5;"
            f"color:#334155;'>{body_txt}</p>" if body_txt else ""
        )
        + "</div>"
    )


def _comment_item_html(item: dict) -> str:
    """One reply as a light-theme card row.

    Quoted rather than summarised, and capped: the point is to carry
    enough that the tester can tell whether it needs them today, not to
    reproduce the thread in an inbox. The bug title is the heading because
    that is what they recognise; the reply is the content.
    """
    title = html.escape(item["bug_title"] or "")
    body_txt = html.escape((item["body"] or "").strip())
    if len(body_txt) > 320:
        body_txt = body_txt[:320].rstrip() + "…"
    who = html.escape((item.get("writer") or "PongLens").split(" ")[0])
    when = ""
    if item.get("created_at"):
        when = f" &middot; {item['created_at'].strftime('%-d %b')}"
    link = f"{APP_URL}/testing/bugs?bug={item['bug_id']}"
    return (
        "<div style='margin:12px 0 0;padding:14px 16px;background:#f8fafc;"
        "border:1px solid #e2e8f0;border-radius:12px;'>"
        f"<p style='margin:0;font-size:14px;font-weight:700;color:#0f172a;'>"
        f"{title}</p>"
        f"<p style='margin:6px 0 0;font-size:12px;color:#0891b2;"
        f"font-weight:700;'>{who} replied"
        f"<span style='color:#94a3b8;font-weight:400;'>{when}</span></p>"
        + (
            f"<p style='margin:8px 0 0;font-size:13px;line-height:1.5;"
            f"color:#334155;'>{body_txt}</p>" if body_txt else ""
        )
        + f"<p style='margin:10px 0 0;font-size:12px;'>"
        f"<a href='{link}' style='color:#0891b2;text-decoration:none;"
        f"font-weight:600;'>Open and reply &rarr;</a></p>"
        + "</div>"
    )


def qa_digest_subject(n_closed: int, n_comments: int) -> str:
    """What the inbox line says. Both counts when both happened, because a
    mail titled "7 reports closed" that also holds two replies buries the
    half somebody is waiting on."""
    parts = []
    if n_comments:
        parts.append(f"{n_comments} repl{'ies' if n_comments != 1 else 'y'}")
    if n_closed:
        parts.append(f"{n_closed} report{'s' if n_closed != 1 else ''} closed")
    return "PongLens: " + " and ".join(parts)


def qa_closed_digest_html(
    items: list[dict],
    first_name: str,
    comments: list[dict] | None = None,
) -> str:
    comments = comments or []
    n = len(items)
    c = len(comments)
    rows = "".join(_closed_item_html(i) for i in items)
    comment_rows = "".join(_comment_item_html(i) for i in comments)
    greeting = f"Hi {html.escape(first_name)}," if first_name else "Hi,"

    # Replies first. A closed report is news; a reply is usually a
    # question, and the person who asked it is waiting.
    body = ""
    if c:
        body += (
            "<p style='margin:28px 0 0;font-size:12px;font-weight:700;"
            "letter-spacing:0.06em;text-transform:uppercase;color:#64748b;'>"
            f"{'Replies' if c != 1 else 'Reply'} on your reports</p>"
            + comment_rows
        )
    if n:
        body += (
            "<p style='margin:28px 0 0;font-size:12px;font-weight:700;"
            "letter-spacing:0.06em;text-transform:uppercase;color:#64748b;'>"
            "Closed</p>" + rows
        )

    headline = "Replies and closed reports" if (c and n) else (
        "Someone replied to you" if c else "Reports closed"
    )
    if c and n:
        lede = (f"{greeting} {c} repl{'ies' if c != 1 else 'y'} "
                f"and {n} report{'s' if n != 1 else ''} closed.")
    elif c:
        lede = (f"{greeting} {c} of your reports "
                f"{'have' if c != 1 else 'has'} a new reply.")
    else:
        lede = (f"{greeting} {n} report{'s' if n != 1 else ''} you filed "
                f"{'have' if n != 1 else 'has'} been closed.")

    return f"""\
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">{html.escape(lede)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background-color:#f4f5f7;">
  <tr>
    <td align="center" style="padding:48px 16px;background-color:#f4f5f7;">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:16px;">
        <tr>
          <td style="padding:40px 32px 36px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <img src="https://www.ponglens.com/img/email-logo.png" width="180" height="44" alt="PongLens" style="display:block;width:180px;height:44px;border:0;margin:0 auto 28px;">
            <h1 style="margin:0;font-size:20px;line-height:1.3;font-weight:700;color:#0f172a;text-align:center;">{headline}</h1>
            <p style="margin:8px 0 0;font-size:13px;line-height:1.5;color:#64748b;text-align:center;">{lede}</p>
            {body}
            <p style="margin:32px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;text-align:center;">Sent once a day by PongLens &middot; <a href="https://www.ponglens.com/testing/bugs" style="color:#0891b2;text-decoration:none;">open your reports</a></p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
"""


def maybe_send_qa_closed_digest(conn):
    """Once per Toronto calendar day: mail each QA author the reports of
    theirs that closed since last time. Nothing closed, nothing sent.
    Never raises."""
    try:
        from zoneinfo import ZoneInfo
        today = datetime.now(ZoneInfo(DIGEST_TZ)).strftime("%Y-%m-%d")
        if get_config(conn, "qa_closed_digest_last_sent") == today:
            return
        if not RESEND_API_KEY:
            # Stamping without a send would tell the tester nothing and
            # then claim it had. Leave the rows for a run that can mail.
            log.warning("qa closed digest skipped (no Resend key)")
            return

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Both places a tester's report can live: /feedback, which any
            # player uses, and qa_bugs (104), which is the portal. One mail
            # covers both, because the tester does not care which table a
            # thing they wrote is in.
            #
            # app_roles directly rather than is_qa(): the worker is a plain
            # database client with no auth context to speak of.
            cur.execute(
                "select 'feedback' as src, i.id, i.title, i.body, i.status, "
                "       i.created_at, u.email, "
                "       coalesce(nullif(trim(u.raw_user_meta_data ->> "
                "'full_name'), ''), split_part(u.email, '@', 1)) as author "
                "from public.feedback_items i "
                "join auth.users u on u.id = i.user_id "
                "join public.app_roles r "
                "  on r.user_id = i.user_id and r.role = 'qa' "
                "where i.closed_notified_at is null "
                "  and i.status in ('done', 'declined') "
                "union all "
                "select 'bug' as src, b.id, b.title, "
                "       coalesce(nullif(btrim(b.actual), ''), b.steps) as body, "
                "       b.status, b.created_at, u.email, "
                "       coalesce(nullif(trim(u.raw_user_meta_data ->> "
                "'full_name'), ''), split_part(u.email, '@', 1)) as author "
                "from public.qa_bugs b "
                "join auth.users u on u.id = b.reporter_id "
                "where b.closed_notified_at is null "
                "  and b.status in ('closed', 'rejected', 'duplicate') "
                "order by created_at",
            )
            pending = [dict(r) for r in cur.fetchall()]

        # Replies waiting on the tester (128). Only comments somebody ELSE
        # wrote on a report they filed: their own messages are not news to
        # them, and mailing those back is how a digest starts arguing with
        # itself. digest_notified_at is the whole loop guard, mirroring
        # closed_notified_at above.
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "select m.id, m.bug_id, m.body, m.created_at, "
                "       b.title as bug_title, u.email, "
                "       coalesce(nullif(trim(u.raw_user_meta_data ->> "
                "'full_name'), ''), split_part(u.email, '@', 1)) as author, "
                "       coalesce(nullif(trim(w.raw_user_meta_data ->> "
                "'full_name'), ''), split_part(w.email, '@', 1)) as writer "
                "from public.qa_bug_messages m "
                "join public.qa_bugs b on b.id = m.bug_id "
                "join auth.users u on u.id = b.reporter_id "
                "join public.app_roles r "
                "  on r.user_id = b.reporter_id and r.role = 'qa' "
                "left join auth.users w on w.id = m.author_id "
                "where m.kind = 'comment' "
                "  and m.digest_notified_at is null "
                "  and m.author_id is distinct from b.reporter_id "
                "order by m.created_at",
            )
            replies = [dict(r) for r in cur.fetchall()]

        if not pending and not replies:
            log.info("qa digest: nothing closed and no new replies")
            set_config(conn, "qa_closed_digest_last_sent", today)
            return

        # One bucket per recipient holding both halves, so a person with a
        # reply and a closed report gets one mail rather than two.
        by_author: dict[str, dict] = {}

        def bucket(row):
            return by_author.setdefault(
                row["email"],
                {"closed": [], "replies": [], "author": row["author"]},
            )

        for row in pending:
            bucket(row)["closed"].append(row)
        for row in replies:
            bucket(row)["replies"].append(row)

        # Claim the day BEFORE sending anything. This used to sit at the
        # very end, on the success path only, and that is how a daily
        # digest became a quarter-hourly one: the stamping query below
        # threw, the exception skipped this line, and fifteen minutes
        # later the whole function ran again and re-sent the identical
        # mail. It reached 39 copies of the same message to one tester.
        #
        # Claiming first caps the blast radius at one attempt per day no
        # matter what breaks after it, which is the promise the digest is
        # supposed to make. Nothing is lost by being early: correctness
        # rests on closed_notified_at per row, so anything that does not
        # get stamped is simply picked up tomorrow.
        set_config(conn, "qa_closed_digest_last_sent", today)

        for email, box in by_author.items():
            items = box["closed"]
            convo = box["replies"]
            first_name = (box["author"] or "").split(" ")[0]
            n = len(items)
            c = len(convo)
            try:
                send_email(
                    email,
                    qa_digest_subject(n, c),
                    qa_closed_digest_html(items, first_name, convo),
                )
            except Exception as e:
                # Unstamped, so tomorrow's run picks the same rows back up.
                log.warning("qa digest to %s failed: %s", email, e)
                continue
            # Stamp each table with its own ids. Only after the send, so a
            # failure leaves both sets for tomorrow rather than losing them.
            #
            # The ::uuid[] casts are load-bearing. psycopg2 adapts a list
            # of Python strings to text[], both id columns are uuid, and
            # `uuid = any(text[])` has no operator, so this raised every
            # time it ran. It only ever ran once real reports were closed,
            # which is why it sat here unnoticed until it mattered.
            feedback_ids = [str(i["id"]) for i in items if i["src"] == "feedback"]
            bug_ids = [str(i["id"]) for i in items if i["src"] == "bug"]
            reply_ids = [str(r["id"]) for r in convo]
            try:
                with conn.cursor() as cur:
                    if feedback_ids:
                        cur.execute(
                            "update public.feedback_items set closed_notified_at "
                            "= now() where id = any(%s::uuid[])",
                            (feedback_ids,),
                        )
                    if bug_ids:
                        cur.execute(
                            "update public.qa_bugs set closed_notified_at = now() "
                            "where id = any(%s::uuid[])",
                            (bug_ids,),
                        )
                    if reply_ids:
                        cur.execute(
                            "update public.qa_bug_messages "
                            "set digest_notified_at = now() "
                            "where id = any(%s::uuid[])",
                            (reply_ids,),
                        )
            except Exception as e:
                # One recipient's bookkeeping must not cost the others
                # their mail, and the day is already claimed above.
                log.warning("qa digest stamp for %s failed: %s", email, e)
                continue
            log.info("qa digest sent to %s (%d closed, %d repl%s)",
                     email, n, c, "y" if c == 1 else "ies")
    except Exception as e:
        log.warning("qa closed digest failed (non-fatal): %s", e)


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------
BLURBALL_FRAME_RE = re.compile(r"^frame (\d+)/(\d+)\b")


def run_blurball(
    input_video: str,
    workdir: str,
    *,
    attempt_key: str = "manual",
    on_progress: Callable[[float], None] | None = None,
) -> str:
    """blurball inference (the slow part). Returns the detections jsonl.

    Streams the child's stdout instead of letting it inherit ours, because
    it has been printing `frame 43800/45128` every few seconds all along
    and nobody was reading it. That was the whole of the "progress jumps
    from 15% to 45%" complaint: this stage is minutes of real work between
    two stamps, and on a long video the number sat still long enough to
    look stuck. The lines are still logged exactly as before, so the log
    reads the same; they just also drive `on_progress` now, which gets a
    0..1 fraction of the frames done.
    """
    blurball_out = os.path.join(workdir, "blurball.jsonl")
    log.info("  running blurball inference (this is the slow part)…")
    with COST_METER.timed_stage("blurball_inference", attempt_key):
        proc = subprocess.Popen(
            [VENV_PY, BLURBALL_INFER, "--video", input_video,
             "--out", blurball_out],
            cwd=workdir, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True, bufsize=1,
        )
        try:
            for line in proc.stdout or ():
                line = line.rstrip()
                if line:
                    print(line, flush=True)
                match = BLURBALL_FRAME_RE.match(line)
                if match and on_progress:
                    done, total = int(match.group(1)), int(match.group(2))
                    if total > 0:
                        # Reporting is best-effort. A progress bar must
                        # never be the reason a job dies, and this runs
                        # dozens of times per video.
                        try:
                            on_progress(min(1.0, done / total))
                        except Exception as e:
                            log.warning("  progress report failed: %s", e)
            code = proc.wait(timeout=4 * 3600)
        except BaseException:
            proc.kill()
            raise
        if code != 0:
            raise subprocess.CalledProcessError(code, BLURBALL_INFER)
    return blurball_out


def run_cut(
    input_video: str,
    workdir: str,
    blurball_out: str,
    strictness: str = "normal",
    *,
    segments_json: str | None = None,
    attempt_key: str = "manual",
) -> str:
    """Dead-space cut. With segments_json (a --cut-mode plays match.json),
    the cut keeps exactly its per-point cut_segments — dead-space round 4;
    without it, the legacy activity-span cut."""
    result = os.path.join(workdir, "result.mp4")
    log.info("  cutting dead space (strictness=%s mode=%s)…", strictness,
             "plays" if segments_json else "spans")
    cmd = [VENV_PY, POINTS_PIPELINE, "cut", "--blurball", blurball_out,
           "--video", input_video, "--out", result,
           "--strictness", strictness]
    if segments_json:
        cmd += ["--segments", segments_json]
    with COST_METER.timed_stage("pure_cut_encoding", attempt_key):
        subprocess.run(cmd, check=True, cwd=workdir, timeout=2 * 3600)

    if not os.path.exists(result) or os.path.getsize(result) == 0:
        raise RuntimeError("pipeline produced no output file")
    return result


def run_pipeline(
    input_video: str,
    workdir: str,
    strictness: str = "normal",
    *,
    attempt_key: str = "manual",
    on_progress: Callable[[float], None] | None = None,
) -> tuple[str, str]:
    """blurball inference -> legacy span cut. Kept for the points-disabled
    path; the points-enabled path sequences the stages itself so the cut
    can consume the points stage's segments.

    on_progress carries the inference fraction out to the caller. This path
    has the WIDER silence of the two: with points off the job goes straight
    from 15 to 85, so the one stage that can report itself matters more
    here, not less."""
    blurball_out = run_blurball(input_video, workdir,
                                attempt_key=attempt_key,
                                on_progress=on_progress)
    result = run_cut(input_video, workdir, blurball_out, strictness,
                     attempt_key=attempt_key)
    return result, blurball_out


# ---------------------------------------------------------------------------
# Existing-match placement v3 backfill
# ---------------------------------------------------------------------------
PLACEMENT_BACKFILL = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "placement_backfill.py",
)
PLACEMENT_RETRY_CALIBRATION = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "placement_retry_calibration.py",
)
PLACEMENT_VISION_MODEL = os.environ.get(
    "WORKER_PLACEMENT_VISION_MODEL",
    "gpt-5.6-sol",
)


@dataclass(frozen=True)
class BackfillResult:
    match_id: str
    point_count: int
    ready: int
    review: int
    unavailable: int


class BackfillConsistencyError(RuntimeError):
    """A post-mutation failure that must halt the entire rollout."""


def run_blurball_only(
    input_video: str | Path,
    workdir: str | Path,
    command_runner=subprocess.run,
) -> Path:
    output = Path(workdir) / "blurball.jsonl"
    command_runner(
        [
            VENV_PY,
            BLURBALL_INFER,
            "--video",
            str(input_video),
            "--out",
            str(output),
        ],
        check=True,
        cwd=str(workdir),
        timeout=4 * 3600,
    )
    if not output.is_file():
        raise RuntimeError("BlurBall inference produced no detections file")
    return output


def run_placement_reconstruction(
    match_path: str | Path,
    video_path: str | Path,
    blurball_path: str | Path,
    points: list[dict],
    workdir: str | Path,
    command_runner=subprocess.run,
) -> dict:
    root = Path(workdir)
    points_path = root / "points.json"
    output_path = root / "placement-backfill.json"
    points_path.write_text(json.dumps(points, indent=2) + "\n")
    command_runner(
        [
            VENV_PY,
            PLACEMENT_BACKFILL,
            "reconstruct",
            "--match-json",
            str(match_path),
            "--points-json",
            str(points_path),
            "--blurball",
            str(blurball_path),
            "--video",
            str(video_path),
            "--output",
            str(output_path),
        ],
        check=True,
        cwd=str(workdir),
        timeout=2 * 3600,
    )
    if not output_path.is_file():
        raise RuntimeError("placement reconstruction produced no output file")
    return json.loads(output_path.read_text())


def load_backfill_record(
    conn,
    match_id: str,
    *,
    for_update: bool = False,
) -> dict:
    match_lock = " for update of m" if for_update else ""
    point_lock = " for update" if for_update else ""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "select m.id::text as match_id, m.status, "
            "j.input_path, j.options as job_options, m.match_json_path "
            "from public.matches m "
            "left join public.jobs j on j.id = m.job_id "
            f"where m.id = %s{match_lock}",
            (match_id,),
        )
        match = cur.fetchone()
        if not match:
            raise RuntimeError(f"placement backfill: match {match_id} not found")
        cur.execute(
            "select to_jsonb(p) - 'id' - 'match_id' as point "
            f"from public.points p where p.match_id = %s "
            f"order by p.idx{point_lock}",
            (match_id,),
        )
        points = [row["point"] for row in cur.fetchall()]
    record = dict(match)
    record["points"] = points
    if record["status"] != "ready":
        raise RuntimeError("placement backfill requires a ready match")
    if not record.get("input_path") or not record.get("match_json_path"):
        raise RuntimeError("placement backfill source inputs are unavailable")
    if not points:
        raise RuntimeError("placement backfill match has no points")
    indices = [int(point["idx"]) for point in points]
    if len(indices) != len(set(indices)):
        raise RuntimeError("placement backfill found duplicate point indices")
    if any(
        point.get("t0") is None
        or point.get("t1") is None
        or float(point["t1"]) <= float(point["t0"])
        for point in points
    ):
        raise RuntimeError("placement backfill found an invalid point range")
    return record


def _download_backfill_object(path: str, destination: Path) -> None:
    r2_path = parse_r2_path(path)
    if r2_path:
        r2().download_file(r2_path[0], r2_path[1], str(destination))
    else:
        storage_download("uploads", path, str(destination))
    if not destination.is_file() or destination.stat().st_size == 0:
        raise RuntimeError(f"placement backfill input is empty: {destination.name}")


def download_backfill_inputs(
    record: dict,
    workdir: str | Path,
) -> tuple[Path, Path]:
    root = Path(workdir)
    video_path = root / "source.mp4"
    match_path = root / "match.json"
    _download_backfill_object(record["input_path"], video_path)
    # Library sources: cut the claimed window so point timestamps line up.
    video_path = Path(apply_source_trim(
        str(video_path), str(root), record.get("job_options")))
    match_r2 = parse_r2_path(record["match_json_path"])
    if not match_r2:
        raise RuntimeError("placement backfill match.json must be stored in R2")
    r2().download_file(match_r2[0], match_r2[1], str(match_path))
    if not match_path.is_file() or match_path.stat().st_size == 0:
        raise RuntimeError("placement backfill match.json is empty")
    return video_path, match_path


def is_missing_source_error(error: Exception) -> bool:
    if isinstance(error, ClientError):
        code = str(error.response.get("Error", {}).get("Code") or "")
        return code in {"404", "NoSuchKey", "NotFound"}
    return (
        isinstance(error, requests.HTTPError)
        and error.response is not None
        and error.response.status_code == 404
    )


def upload_match_json(
    match_json_path: str,
    match: dict,
    workdir: str | Path,
) -> None:
    destination = parse_r2_path(match_json_path)
    if not destination:
        raise RuntimeError("placement backfill match.json must be stored in R2")
    local_path = Path(workdir) / "merged-match.json"
    local_path.write_text(json.dumps(match, indent=1) + "\n")
    r2().upload_file(
        str(local_path),
        destination[0],
        destination[1],
        ExtraArgs={"ContentType": "application/json"},
    )


def restore_match_json(match_json_path: str, original_path: str | Path) -> None:
    destination = parse_r2_path(match_json_path)
    if not destination:
        raise RuntimeError("placement backfill match.json must be stored in R2")
    r2().upload_file(
        str(original_path),
        destination[0],
        destination[1],
        ExtraArgs={"ContentType": "application/json"},
    )


def _is_json_number(value) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def _is_confidence(value) -> bool:
    return _is_json_number(value) and 0.0 <= float(value) <= 1.0


def _validate_v3_event(
    event,
    *,
    terminal: bool = False,
    on_table: bool = False,
    label: str = "event",
) -> None:
    if event is None:
        return
    if not isinstance(event, dict):
        raise ValueError("placement event must be an object or null")
    if event.get("event_id") is not None and not isinstance(
        event.get("event_id"), str
    ):
        raise ValueError("placement event_id must be a string or null")
    if not _is_confidence(event.get("confidence")):
        raise ValueError("placement event confidence must be numeric")
    for field in ("t", "u", "v", "x", "y"):
        if field in event and event[field] is not None and not _is_json_number(
            event[field]
        ):
            raise ValueError(f"placement event {field} must be numeric")
    if on_table:
        u = event.get("u")
        v = event.get("v")
        if (
            u is not None
            and v is not None
            and not (
                0.0 <= float(u) <= 1.525
                and 0.0 <= float(v) <= 2.74
            )
        ):
            raise ValueError(f"placement {label} must be on the table")
    if terminal:
        if event.get("kind") not in {
            "net",
            "out",
            "winner_landing",
            "no_return",
        }:
            raise ValueError("placement terminal kind is invalid")
        direction = event.get("direction")
        if direction is not None and (
            not isinstance(direction, dict)
            or not _is_json_number(direction.get("du"))
            or not _is_json_number(direction.get("dv"))
        ):
            raise ValueError("placement terminal direction is invalid")


def _validate_v3_placement(payload: dict) -> None:
    statuses = {"ready", "review", "unavailable"}
    if payload.get("v") != 3 or payload.get("status") not in statuses:
        raise ValueError("placement payload must be a valid v3 status")
    candidates = payload.get("candidates")
    if not isinstance(candidates, list):
        raise ValueError("placement candidates must be a list")
    for candidate in candidates:
        if not isinstance(candidate, dict):
            raise ValueError("placement candidate must be an object")
        if not isinstance(candidate.get("id"), str):
            raise ValueError("placement candidate id is invalid")
        if candidate.get("kind") not in {
            "bounce",
            "contact",
            "impact",
            "net",
            "out",
        }:
            raise ValueError("placement candidate kind is invalid")
        if not isinstance(candidate.get("kinds"), list) or not all(
            isinstance(kind, str) for kind in candidate["kinds"]
        ):
            raise ValueError("placement candidate kinds are invalid")
        if not _is_json_number(candidate.get("t")):
            raise ValueError("placement candidate time is invalid")
        for field in ("u", "v", "x", "y"):
            if (
                field in candidate
                and candidate[field] is not None
                and not _is_json_number(candidate[field])
            ):
                raise ValueError(f"placement candidate {field} is invalid")
        if candidate.get("side") is not None and candidate.get("side") not in {
            "near",
            "far",
        }:
            raise ValueError("placement candidate side is invalid")
        if not _is_json_number(candidate.get("visual_confidence")):
            raise ValueError("placement candidate visual confidence is invalid")
        if not _is_json_number(candidate.get("audio_confidence")):
            raise ValueError("placement candidate audio confidence is invalid")
    hypotheses = payload.get("hypotheses")
    if not isinstance(hypotheses, dict) or set(hypotheses) != {"near", "far"}:
        raise ValueError("placement must contain near and far hypotheses")
    for side in ("near", "far"):
        hypothesis = hypotheses[side]
        if not isinstance(hypothesis, dict):
            raise ValueError("placement hypothesis must be an object")
        if (
            hypothesis.get("serverSide") != side
            or hypothesis.get("server_side") != side
        ):
            raise ValueError("placement hypothesis server side is invalid")
        if hypothesis.get("status") not in statuses:
            raise ValueError("placement hypothesis status is invalid")
        trusted_hypothesis = hypothesis.get("status") == "ready"
        if not _is_confidence(hypothesis.get("confidence")):
            raise ValueError("placement hypothesis confidence must be numeric")
        if not _is_json_number(hypothesis.get("score")):
            raise ValueError("placement hypothesis score must be numeric")
        for field in ("reasons", "hard_reasons", "used_event_ids"):
            values = hypothesis.get(field)
            if not isinstance(values, list) or not all(
                isinstance(value, str) for value in values
            ):
                raise ValueError(f"placement hypothesis {field} is invalid")
        shots = hypothesis.get("shots")
        if not isinstance(shots, list):
            raise ValueError("placement hypothesis shots must be a list")
        for shot_index, shot in enumerate(shots, start=1):
            if not isinstance(shot, dict):
                raise ValueError("placement shot must be an object")
            if not isinstance(shot.get("id"), str):
                raise ValueError("placement shot id is invalid")
            if (
                not isinstance(shot.get("seq"), int)
                or isinstance(shot.get("seq"), bool)
            ):
                raise ValueError("placement shot sequence is invalid")
            if shot["seq"] != shot_index:
                raise ValueError(
                    "placement shot sequences must be contiguous from one"
                )
            if shot.get("phase") not in {"serve", "rally", "final"}:
                raise ValueError("placement shot phase is invalid")
            if (
                trusted_hypothesis
                and shot_index == 1
                and shot.get("phase") != "serve"
            ):
                raise ValueError("placement first shot must be serve")
            if (
                trusted_hypothesis
                and shot_index > 1
                and shot.get("phase") == "serve"
            ):
                raise ValueError("placement serve must be the first shot")
            if shot.get("hitter_side") not in {"near", "far"}:
                raise ValueError("placement shot hitter side is invalid")
            expected_hitter = (
                side
                if shot_index % 2 == 1
                else ("far" if side == "near" else "near")
            )
            if (
                trusted_hypothesis
                and shot.get("hitter_side") != expected_hitter
            ):
                raise ValueError(
                    "placement shot hitter side does not match server sequence"
                )
            if shot.get("contact_t") is not None and not _is_json_number(
                shot.get("contact_t")
            ):
                raise ValueError("placement shot contact time is invalid")
            if not _is_confidence(shot.get("confidence")):
                raise ValueError("placement shot confidence must be numeric")
            _validate_v3_event(shot.get("contact"))
            _validate_v3_event(
                shot.get("serve_first_bounce"),
                on_table=trusted_hypothesis,
                label="serve first bounce",
            )
            _validate_v3_event(
                shot.get("landing"),
                on_table=trusted_hypothesis,
                label="landing",
            )
            _validate_v3_event(shot.get("terminal"), terminal=True)
            if (
                trusted_hypothesis
                and shot_index == 1
                and isinstance(shot.get("landing"), dict)
            ):
                landing_v = shot["landing"].get("v")
                if landing_v is not None:
                    receiver_half = (
                        float(landing_v) >= 2.74 / 2.0
                        if side == "near"
                        else float(landing_v) <= 2.74 / 2.0
                    )
                    if not receiver_half:
                        raise ValueError(
                            "placement serve landing must be on receiver half"
                        )


def _ready_hypothesis_trust_issue(side: str, hypothesis: dict) -> str | None:
    shots = hypothesis.get("shots")
    if not isinstance(shots, list):
        return None
    for shot_index, shot in enumerate(shots, start=1):
        if not isinstance(shot, dict):
            return None
        if shot_index == 1 and shot.get("phase") != "serve":
            return "first_shot_not_serve"
        if shot_index > 1 and shot.get("phase") == "serve":
            return "late_serve_phase"
        expected_hitter = (
            side
            if shot_index % 2 == 1
            else ("far" if side == "near" else "near")
        )
        if shot.get("hitter_side") != expected_hitter:
            return "hitter_sequence"
        for field, reason in (
            ("serve_first_bounce", "serve_first_bounce_off_table"),
            ("landing", "landing_off_table"),
        ):
            event = shot.get(field)
            if not isinstance(event, dict):
                continue
            u, v = event.get("u"), event.get("v")
            if (
                _is_json_number(u)
                and _is_json_number(v)
                and not (
                    0.0 <= float(u) <= 1.525
                    and 0.0 <= float(v) <= 2.74
                )
            ):
                return reason
        if shot_index == 1 and isinstance(shot.get("landing"), dict):
            landing_v = shot["landing"].get("v")
            if _is_json_number(landing_v):
                receiver_half = (
                    float(landing_v) >= 2.74 / 2.0
                    if side == "near"
                    else float(landing_v) <= 2.74 / 2.0
                )
                if not receiver_half:
                    return "serve_landing_on_server_half"
    return None


def _downgrade_payload_ready_hypotheses(payload: object) -> int:
    if not isinstance(payload, dict) or payload.get("v") != 3:
        return 0
    hypotheses = payload.get("hypotheses")
    if not isinstance(hypotheses, dict):
        return 0
    changed = 0
    for side in ("near", "far"):
        hypothesis = hypotheses.get(side)
        if (
            not isinstance(hypothesis, dict)
            or hypothesis.get("status") != "ready"
        ):
            continue
        issue = _ready_hypothesis_trust_issue(side, hypothesis)
        if issue is None:
            continue
        hypothesis["status"] = "review"
        confidence = hypothesis.get("confidence")
        if _is_json_number(confidence):
            hypothesis["confidence"] = min(float(confidence), 0.69)
        hard_reasons = hypothesis.get("hard_reasons")
        if isinstance(hard_reasons, list):
            reason = f"worker_trust_contract:{issue}"
            if reason not in hard_reasons:
                hard_reasons.append(reason)
        changed += 1
    statuses = {
        hypothesis.get("status")
        for hypothesis in hypotheses.values()
        if isinstance(hypothesis, dict)
    }
    payload["status"] = (
        "ready"
        if "ready" in statuses
        else "review"
        if "review" in statuses
        else "unavailable"
    )
    return changed


def downgrade_untrusted_ready_hypotheses(output: dict) -> int:
    """Suppress drawable hypotheses that violate the aggregate trust contract."""
    changed = 0
    placements = output.get("placements")
    if isinstance(placements, dict):
        for payload in placements.values():
            changed += _downgrade_payload_ready_hypotheses(payload)
    match = output.get("match")
    points = match.get("points") if isinstance(match, dict) else None
    if isinstance(points, list):
        for point in points:
            if isinstance(point, dict):
                changed += _downgrade_payload_ready_hypotheses(
                    point.get("placement")
                )
    return changed


def validate_backfill_output(record: dict, output: dict) -> dict[int, dict]:
    expected = [int(point["idx"]) for point in record["points"]]
    raw_placements = output.get("placements")
    merged = output.get("match")
    if not isinstance(raw_placements, dict) or not isinstance(merged, dict):
        raise ValueError("placement reconstruction output is malformed")
    placements = {int(index): payload for index, payload in raw_placements.items()}
    if len(expected) != len(set(expected)) or sorted(expected) != sorted(placements):
        raise ValueError("placement point indices do not match existing points")
    for payload in placements.values():
        if not isinstance(payload, dict):
            raise ValueError("every placement payload must have v=3")
        _validate_v3_placement(payload)
    merged_points = merged.get("points")
    if not isinstance(merged_points, list):
        raise ValueError("reconstructed match points are missing")
    merged_by_index = {
        int(point["idx"]): point.get("placement") for point in merged_points
    }
    # The artifact and the points table are allowed to disagree about which
    # points exist, in BOTH directions, and neither direction is a fault:
    #
    #   artifact has more — a point extended over its neighbour merges the
    #   two, and the swallowed one leaves the table while match.json goes on
    #   listing it.
    #
    #   table has more — split_point inserts the child at max(idx) + 1, so
    #   every point the owner has ever split exists only in the table. The
    #   child is not pipeline output and match.json never had it.
    #
    # Both get their placement written to the points table by
    # _update_backfill_rows, which is what the app reads, so nothing is lost
    # either way. Requiring the sets to match meant no match the owner had
    # edited could be given placement maps at all — first in one direction,
    # then, once that was fixed, in the other.
    shared = [index for index in placements if index in merged_by_index]
    if any(merged_by_index[index] != placements[index] for index in shared):
        raise ValueError("reconstructed match placements do not match payloads")
    return placements


# Point fields the placement job re-syncs from the points table, which is
# authoritative for them: the owner may have retimed a point since the
# pipeline wrote match.json, and the reconstruction has to read the corrected
# window anyway to know where to look. Everything else in a point — the clip
# path, the clip window, which side served — is the pipeline's own and must
# come out untouched.
#
# Kept in step with placement_backfill.ARTIFACT_POINT_FIELDS by
# test_placement_backfill_reconstruction; if that test fails, these two
# drifted and the guard is either too tight or too loose.
DATABASE_SYNCED_POINT_FIELDS = frozenset({
    "t0", "t1", "cut_t0", "server", "suggestion", "placement",
    "rally_end_cut_s",
})


def validate_placement_only_match_update(
    original: dict,
    reconstructed: dict,
) -> None:
    """Reject reconstruction changes outside calibration and point placement."""
    def without_placement(document: dict) -> dict:
        projection = copy.deepcopy(document)
        projection.pop("calibration", None)
        # The version is checked on its own below, then set aside: writing
        # v3 placement into a v2 match legitimately raises it, which is the
        # reconstruction describing what it just did rather than changing
        # anything a player would notice.
        projection.pop("version", None)
        points = projection.get("points")
        if isinstance(points, list):
            for point in points:
                if isinstance(point, dict):
                    for field in DATABASE_SYNCED_POINT_FIELDS:
                        point.pop(field, None)
        return projection

    # Upward only, and no further than 3. A version going backwards, or
    # landing somewhere this pipeline never writes, is a real change.
    was = int(original.get("version") or 0)
    now = int(reconstructed.get("version") or 0)
    if now < was or now > max(was, 3):
        raise ValueError(
            f"placement reconstruction moved the match version {was} -> {now}")
    if without_placement(original) != without_placement(reconstructed):
        raise ValueError("placement reconstruction changed non-placement match data")


def _update_backfill_rows(
    conn,
    match_id: str,
    placements: dict[int, dict | None],
) -> None:
    with conn.cursor() as cur:
        for index in sorted(placements):
            payload = placements[index]
            serialized = None if payload is None else json.dumps(payload)
            cur.execute(
                "update public.points set placement = %s::jsonb "
                "where match_id = %s and idx = %s",
                (serialized, match_id, index),
            )
            if cur.rowcount != 1:
                raise RuntimeError(
                    f"placement backfill point {index} update matched "
                    f"{cur.rowcount} rows"
                )


def _assert_backfill_record_unchanged(expected: dict, current: dict) -> None:
    fields = ("match_id", "status", "input_path", "match_json_path")

    def point_inputs(record: dict) -> list[dict]:
        inputs = copy.deepcopy(record.get("points") or [])
        for point in inputs:
            if isinstance(point, dict):
                point.pop("placement", None)
        return inputs

    if (
        any(expected.get(field) != current.get(field) for field in fields)
        or point_inputs(expected) != point_inputs(current)
    ):
        raise RuntimeError(
            "placement backfill match changed during reconstruction"
        )


def _restore_backfill_database(
    conn,
    match_id: str,
    original_placements: dict[int, dict | None],
) -> None:
    original_autocommit = conn.autocommit
    try:
        conn.autocommit = False
        _update_backfill_rows(conn, match_id, original_placements)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.autocommit = original_autocommit


def _compensate_backfill(
    conn,
    match_id: str,
    original_placements: dict[int, dict | None],
    match_json_path: str,
    original_match_path: str | Path,
    cause: Exception,
) -> None:
    failures = []
    try:
        _restore_backfill_database(conn, match_id, original_placements)
    except Exception as error:
        failures.append(f"database restore failed: {error}")
    try:
        restore_match_json(match_json_path, original_match_path)
    except Exception as error:
        failures.append(f"match.json restore failed: {error}")
    detail = f"placement backfill consistency failure: {cause}"
    if failures:
        detail += " (" + "; ".join(failures) + ")"
    raise BackfillConsistencyError(detail) from cause


def validate_stored_match(expected: dict, stored: dict) -> None:
    if stored != expected:
        raise RuntimeError(
            "placement backfill full document verification failed"
        )


def verify_backfill(
    conn,
    match_id: str,
    match_json_path: str,
    placements: dict[int, dict],
    expected_match: dict,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "select idx, placement from public.points "
            "where match_id = %s order by idx",
            (match_id,),
        )
        database = {int(index): placement for index, placement in cur.fetchall()}
    if database != placements:
        raise RuntimeError("placement backfill database verification failed")

    workdir = tempfile.mkdtemp(prefix=f"ponglens-backfill-verify-{match_id[:8]}-")
    try:
        path = Path(workdir) / "match.json"
        destination = parse_r2_path(match_json_path)
        if not destination:
            raise RuntimeError("placement backfill match.json must be stored in R2")
        r2().download_file(destination[0], destination[1], str(path))
        stored = json.loads(path.read_text())
        validate_stored_match(expected_match, stored)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def verify_placement_attempt(
    conn,
    match_id: str,
    job_id: str,
    job_field: str,
    match_json_path: str,
    placements: dict[int, dict],
    expected_match: dict,
    mapped_points: int,
) -> None:
    """Verify both placement stores and the terminal lifecycle row."""
    if job_field not in {
        "placement_generation_job_id",
        "placement_retry_job_id",
    }:
        raise ValueError("placement attempt job field is invalid")
    verify_backfill(
        conn,
        match_id,
        match_json_path,
        placements,
        expected_match,
    )
    with conn.cursor() as cur:
        cur.execute(
            "select placement_status, placement_mapped_points, "
            f"placement_failure_code, {job_field}::text "
            "from public.matches where id = %s",
            (match_id,),
        )
        row = cur.fetchone()
    if row != ("ready", mapped_points, None, job_id):
        raise RuntimeError("placement attempt lifecycle verification failed")


def backfill_placement_for_match(conn, match_id: str) -> BackfillResult:
    record = load_backfill_record(conn, match_id)
    workdir = tempfile.mkdtemp(prefix=f"ponglens-placement-v3-{match_id[:8]}-")
    try:
        video_path, match_path = download_backfill_inputs(record, workdir)
        blurball_path = run_blurball_only(video_path, workdir)
        try:
            output = run_placement_reconstruction(
                match_path,
                video_path,
                blurball_path,
                record["points"],
                workdir,
            )
        except subprocess.CalledProcessError:
            calibration = run_placement_calibration(
                video_path,
                blurball_path,
                workdir,
                strategy="stronger",
            )
            if not calibration["ok"]:
                raise RuntimeError(
                    "placement backfill calibration failed: "
                    f"{calibration.get('code') or 'unknown'}"
                )
            placement_match = json.loads(Path(match_path).read_text())
            placement_match["calibration"] = calibration["calibration"]
            placement_match_path = Path(workdir) / "placement-match.json"
            placement_match_path.write_text(
                json.dumps(placement_match, indent=1) + "\n"
            )
            output = run_placement_reconstruction(
                placement_match_path,
                video_path,
                blurball_path,
                record["points"],
                workdir,
            )
        downgrade_untrusted_ready_hypotheses(output)
        placements = validate_backfill_output(record, output)
        original_placements = {
            int(point["idx"]): point.get("placement")
            for point in record["points"]
        }

        original_autocommit = conn.autocommit
        try:
            conn.autocommit = False
            current = load_backfill_record(conn, match_id, for_update=True)
            _assert_backfill_record_unchanged(record, current)
            _update_backfill_rows(conn, match_id, placements)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.autocommit = original_autocommit

        try:
            upload_match_json(
                record["match_json_path"],
                output["match"],
                workdir,
            )
            verify_backfill(
                conn,
                match_id,
                record["match_json_path"],
                placements,
                output["match"],
            )
        except Exception as error:
            _compensate_backfill(
                conn,
                match_id,
                original_placements,
                record["match_json_path"],
                match_path,
                error,
            )
        statuses = [placement.get("status") for placement in placements.values()]
        return BackfillResult(
            match_id=match_id,
            point_count=len(placements),
            ready=statuses.count("ready"),
            review=statuses.count("review"),
            unavailable=statuses.count("unavailable"),
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


@dataclass(frozen=True)
class PlacementAttemptSpec:
    name: str
    job_field: str
    active_status: str
    expected_retry_count: int
    calibration_strategy: str
    expected_failure_status: str


NORMAL_PLACEMENT_ATTEMPT = PlacementAttemptSpec(
    name="normal",
    job_field="placement_generation_job_id",
    active_status="processing",
    expected_retry_count=0,
    calibration_strategy="deterministic",
    expected_failure_status="retry_available",
)

STRONGER_PLACEMENT_ATTEMPT = PlacementAttemptSpec(
    name="stronger",
    job_field="placement_retry_job_id",
    active_status="retrying",
    expected_retry_count=1,
    calibration_strategy="stronger",
    expected_failure_status="final_failed",
)


@dataclass(frozen=True)
class PlacementRetryResult:
    match_id: str
    succeeded: bool
    mapped_points: int
    failure_code: str | None
    terminal_status: str
    already_terminal: bool = False


def load_placement_attempt_record(
    conn,
    job_id: str,
    user_id: str,
    match_id: str,
    attempt: PlacementAttemptSpec,
    *,
    for_update: bool = False,
) -> dict:
    """Load and authorize the exact server-recorded placement attempt."""
    if attempt not in {NORMAL_PLACEMENT_ATTEMPT, STRONGER_PLACEMENT_ATTEMPT}:
        raise ValueError("placement attempt spec is invalid")
    match_lock = " for update of m" if for_update else ""
    point_lock = " for update" if for_update else ""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "select m.id::text as match_id, m.user_id::text as user_id, "
            "m.status, m.placement_status, m.placement_retry_count, "
            "m.placement_mapped_points, m.placement_failure_code, "
            "m.placement_retry_expires_at, "
            "m.placement_generation_job_id::text as "
            "placement_generation_job_id, "
            "m.placement_retry_job_id::text as placement_retry_job_id, "
            "(m.placement_retry_expires_at is null or "
            " m.placement_retry_expires_at <= now()) as source_expired, "
            "j.input_path, j.options as job_options, m.match_json_path "
            "from public.matches m "
            "left join public.jobs j on j.id = m.job_id "
            f"where m.id = %s{match_lock}",
            (match_id,),
        )
        match = cur.fetchone()
        if not match:
            raise RuntimeError("placement attempt match not found")
        record = dict(match)
        attempt_label = "generation" if attempt.name == "normal" else "retry"
        if (
            str(record.get("user_id")) != user_id
            or str(record.get(attempt.job_field)) != job_id
            or record.get("placement_retry_count")
            != attempt.expected_retry_count
        ):
            raise RuntimeError(
                f"placement {attempt_label} job is not the authorized "
                f"{attempt_label} job"
            )
        if record.get("status") != "ready":
            raise RuntimeError("placement attempt requires a ready match")
        terminal_statuses = (
            {"ready", "retry_available", "final_failed"}
            if attempt.name == "normal"
            else {"ready", "final_failed"}
        )
        if record.get("placement_status") not in {
            attempt.active_status,
            *terminal_statuses,
        }:
            raise RuntimeError(
                f"placement {attempt_label} lifecycle is not "
                f"{attempt.active_status}"
            )

        cur.execute(
            "select to_jsonb(p) - 'id' - 'match_id' as point "
            f"from public.points p where p.match_id = %s "
            f"order by p.idx{point_lock}",
            (match_id,),
        )
        points = [row["point"] for row in cur.fetchall()]

    record["points"] = points
    if record["placement_status"] in terminal_statuses:
        return record
    if not points:
        raise RuntimeError("placement attempt match has no points")
    indices = [int(point["idx"]) for point in points]
    if len(indices) != len(set(indices)):
        raise RuntimeError("placement attempt found duplicate point indices")
    if any(
        point.get("t0") is None
        or point.get("t1") is None
        or float(point["t1"]) <= float(point["t0"])
        for point in points
    ):
        raise RuntimeError("placement attempt found an invalid point range")
    return record


def record_vision_usage_sidecar(
    usage_output_path: Path,
    *,
    operation: str,
    scope: str,
) -> None:
    """Meter every vision request a child subprocess made.

    The sidecar is JSONL, one object per OpenAI request, written by
    placement_retry_calibration._write_cost_usage_sidecar. Both the placement
    retry path and the ordinary points pipeline reach the same vision call, so
    both meter through here — the points path did not meter at all until
    2026-08-16, which hid every table calibration an upload paid for.

    Metering never changes job status: anything unreadable is logged and
    dropped.
    """
    if not usage_output_path.is_file():
        return
    try:
        # 3 trials/calibration at ~200 bytes each. 64 KiB is far past any
        # honest sidecar and still cheap to reject.
        if usage_output_path.stat().st_size > 64 * 1024:
            raise ValueError("vision usage sidecar is too large")
        events: list[dict] = []
        for index, line in enumerate(
            usage_output_path.read_text().splitlines()
        ):
            line = line.strip()
            if not line:
                continue
            cost_usage = json.loads(line)
            usage = cost_usage.get("usage")
            if not isinstance(usage, dict):
                raise ValueError("vision usage sidecar is invalid")
            response_id = str(cost_usage.get("response_id") or "")
            model = str(
                cost_usage.get("model") or PLACEMENT_VISION_MODEL
            )[:120]
            # response_id makes retries idempotent. It is absent only when
            # OpenAI returned no id, so the path plus the line number keeps
            # sibling trials from collapsing onto one key.
            key = stable_key(
                response_id or f"{usage_output_path}:{index}",
                model,
                scope,
            )
            events.extend(COST_METER.openai_usage_events(
                {"usage": usage},
                model=model,
                operation=operation,
                idempotency_key=f"openai:{key}:{scope}",
            ))
        COST_METER.record(events)
    except Exception as error:
        log.warning(
            "%s cost metering failed (non-fatal): %s",
            operation,
            type(error).__name__,
        )


def run_placement_calibration(
    video_path: str | Path,
    blurball_path: str | Path,
    workdir: str | Path,
    *,
    strategy: str,
    command_runner=subprocess.run,
) -> dict:
    """Run an isolated, attempt-specific calibration strategy."""
    if strategy not in {"deterministic", "stronger"}:
        raise ValueError("placement calibration strategy is invalid")
    output_path = Path(workdir) / "placement-calibration.json"
    usage_output_path = Path(workdir) / "placement-cost-usage.json"
    child_env = os.environ.copy()
    child_env["OPENAI_API_KEY"] = (
        (OPENAI_API_KEY or "") if strategy == "stronger" else ""
    )
    if strategy == "stronger":
        child_env["WORKER_PLACEMENT_VISION_MODEL"] = PLACEMENT_VISION_MODEL
    else:
        child_env.pop("WORKER_PLACEMENT_VISION_MODEL", None)
    child_env["PONGLENS_COST_USAGE_OUTPUT"] = str(usage_output_path)
    command = [
        VENV_PY,
        PLACEMENT_RETRY_CALIBRATION,
        "calibrate",
        "--video",
        str(video_path),
        "--blurball",
        str(blurball_path),
        "--workdir",
        str(workdir),
        "--output",
        str(output_path),
        "--strategy",
        strategy,
    ]
    if strategy == "stronger":
        command.extend(["--model", PLACEMENT_VISION_MODEL])
    command_runner(
        command,
        check=True,
        cwd=str(workdir),
        env=child_env,
        timeout=20 * 60,
    )
    record_vision_usage_sidecar(
        usage_output_path,
        operation="placement_retry_validation",
        scope="placement-retry",
    )
    if (
        not output_path.is_file()
        or output_path.stat().st_size == 0
        or output_path.stat().st_size > 64 * 1024
    ):
        raise RuntimeError("placement retry calibration output is invalid")
    result = json.loads(output_path.read_text())
    if (
        not isinstance(result, dict)
        or set(result) != {"ok", "code", "calibration"}
        or not isinstance(result["ok"], bool)
        or result["code"] is not None
        and not isinstance(result["code"], str)
        or result["calibration"] is not None
        and not isinstance(result["calibration"], dict)
    ):
        raise RuntimeError("placement retry calibration schema is invalid")
    if result["ok"] != (result["calibration"] is not None):
        raise RuntimeError("placement retry calibration outcome is inconsistent")
    return result


def _assert_placement_record_unchanged(
    expected: dict,
    current: dict,
) -> None:
    fields = (
        "match_id",
        "user_id",
        "status",
        "placement_status",
        "placement_retry_count",
        "placement_mapped_points",
        "placement_failure_code",
        "placement_retry_expires_at",
        "placement_generation_job_id",
        "placement_retry_job_id",
        "input_path",
        "match_json_path",
        "points",
    )
    if any(expected.get(field) != current.get(field) for field in fields):
        raise RuntimeError(
            "placement attempt match changed during reconstruction"
        )


# Calibrations we are willing to reuse rather than recompute. The pink-rim
# calibrator is excluded by name: it ran at 3.50% median corner error with 20
# gross failures in 50 against hand marks, so a quad it produced is not
# evidence of anything. Everything else in the history came from a vision
# model or the keypoint detector, both of which are worth keeping.
def stored_calibration_for_rescue(match_path: str | Path) -> dict | None:
    """A table this match already had, if it is one we would still trust.

    A placement job re-detects the table from scratch, which is right — the
    keypoint detector is more accurate than whatever found it originally. But
    when that fresh attempt DECLINES, giving up throws away an answer that is
    sitting in match.json and was good enough to draw maps with at upload
    time. `87d99586` is the case: Luna found its table on the way in, the
    keypoint detector declined on the same video later, and the match was
    left with no placement maps and a table nobody had lost.

    Returns None when there is nothing trustworthy stored, which is the
    common case for a match whose calibration failed the first time too.
    """
    try:
        document = json.loads(Path(match_path).read_text())
    except (OSError, ValueError):
        return None
    calibration = document.get("calibration")
    if not isinstance(calibration, dict) or not calibration.get("ok"):
        return None
    if not isinstance(calibration.get("table_corners_px"), dict):
        return None
    source = calibration.get("source")
    note = str(calibration.get("note") or "").lower()
    if source in {"keypoints", "vision"}:
        return calibration
    # Older documents predate the source field. Their note still names the
    # detector, and the only one we refuse is the pink rim.
    if source is None and "pink" not in note:
        return calibration
    return None


def _update_placement_lifecycle(
    conn,
    match_id: str,
    job_id: str,
    attempt: PlacementAttemptSpec,
    *,
    status: str,
    mapped_points: int,
    failure_code: str | None,
) -> None:
    if attempt.job_field not in {
        "placement_generation_job_id",
        "placement_retry_job_id",
    }:
        raise ValueError("placement attempt job field is invalid")
    with conn.cursor() as cur:
        cur.execute(
            "update public.matches set placement_status = %s, "
            "placement_mapped_points = %s, placement_failure_code = %s "
            f"where id = %s and {attempt.job_field} = %s",
            (status, mapped_points, failure_code, match_id, job_id),
        )
        if cur.rowcount != 1:
            raise RuntimeError(
                "placement attempt lifecycle update lost ownership"
            )


def _commit_placement_lifecycle(
    conn,
    record: dict,
    job_id: str,
    user_id: str,
    attempt: PlacementAttemptSpec,
    *,
    status: str,
    mapped_points: int,
    failure_code: str | None,
) -> tuple[str, str | None]:
    original_autocommit = conn.autocommit
    try:
        conn.autocommit = False
        current = load_placement_attempt_record(
            conn,
            job_id,
            user_id,
            record["match_id"],
            attempt,
            for_update=True,
        )
        _assert_placement_record_unchanged(record, current)
        resolved_status = status
        resolved_failure_code = failure_code
        if status == "retry_available" and current.get("source_expired"):
            resolved_status = "final_failed"
            resolved_failure_code = "source_expired"
        _update_placement_lifecycle(
            conn,
            record["match_id"],
            job_id,
            attempt,
            status=resolved_status,
            mapped_points=mapped_points,
            failure_code=resolved_failure_code,
        )
        conn.commit()
        return resolved_status, resolved_failure_code
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.autocommit = original_autocommit


def _restore_placement_database(
    conn,
    record: dict,
    job_id: str,
    attempt: PlacementAttemptSpec,
    original_placements: dict[int, dict | None],
) -> None:
    original_autocommit = conn.autocommit
    try:
        conn.autocommit = False
        _update_backfill_rows(conn, record["match_id"], original_placements)
        _update_placement_lifecycle(
            conn,
            record["match_id"],
            job_id,
            attempt,
            status=record["placement_status"],
            mapped_points=int(record["placement_mapped_points"]),
            failure_code=record.get("placement_failure_code"),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.autocommit = original_autocommit


def _compensate_placement(
    conn,
    record: dict,
    job_id: str,
    attempt: PlacementAttemptSpec,
    original_placements: dict[int, dict | None],
    original_match_path: str | Path,
    cause: Exception,
) -> None:
    failures = []
    try:
        _restore_placement_database(
            conn,
            record,
            job_id,
            attempt,
            original_placements,
        )
    except Exception as error:
        failures.append(f"database restore failed: {error}")
    try:
        restore_match_json(record["match_json_path"], original_match_path)
    except Exception as error:
        failures.append(f"match.json restore failed: {error}")
    detail = f"placement attempt consistency failure: {cause}"
    if failures:
        detail += " (" + "; ".join(failures) + ")"
    raise BackfillConsistencyError(detail) from cause


def placement_for_match(
    conn,
    job_id: str,
    user_id: str,
    match_id: str,
    attempt: PlacementAttemptSpec,
    *,
    progress=None,
) -> PlacementRetryResult:
    """Compute placement off-transaction, then atomically commit and verify."""
    record = load_placement_attempt_record(
        conn,
        job_id,
        user_id,
        match_id,
        attempt,
    )
    terminal_statuses = (
        {"ready", "retry_available", "final_failed"}
        if attempt.name == "normal"
        else {"ready", "final_failed"}
    )
    if record["placement_status"] in terminal_statuses:
        terminal_status = record["placement_status"]
        return PlacementRetryResult(
            match_id=match_id,
            succeeded=terminal_status == "ready",
            mapped_points=int(record.get("placement_mapped_points") or 0),
            failure_code=record.get("placement_failure_code"),
            terminal_status=terminal_status,
            already_terminal=True,
        )
    if (
        record.get("source_expired")
        or not record.get("input_path")
        or not record.get("match_json_path")
    ):
        source_failure = (
            "source_expired"
            if record.get("source_expired")
            else "source_missing"
        )
        _commit_placement_lifecycle(
            conn,
            record,
            job_id,
            user_id,
            attempt,
            status="final_failed",
            mapped_points=0,
            failure_code=source_failure,
        )
        return PlacementRetryResult(
            match_id,
            False,
            0,
            source_failure,
            "final_failed",
        )

    workdir = tempfile.mkdtemp(
        prefix=f"ponglens-placement-{attempt.name}-{match_id[:8]}-"
    )
    try:
        try:
            video_path, original_match_path = download_backfill_inputs(
                record,
                workdir,
            )
        except Exception as error:
            if not is_missing_source_error(error):
                raise
            _commit_placement_lifecycle(
                conn,
                record,
                job_id,
                user_id,
                attempt,
                status="final_failed",
                mapped_points=0,
                failure_code="source_missing",
            )
            return PlacementRetryResult(
                match_id,
                False,
                0,
                "source_missing",
                "final_failed",
            )
        if progress:
            progress(20)
        blurball_path = run_blurball_only(video_path, workdir)
        if progress:
            progress(55)
        calibration = run_placement_calibration(
            video_path,
            blurball_path,
            workdir,
            strategy=attempt.calibration_strategy,
        )
        if progress:
            progress(70)
        if not calibration["ok"]:
            # Before giving up, look at what this match already knows. A
            # fresh detection is preferred and ran first; a refusal from it
            # is not a reason to discard a table that was good enough to
            # draw maps with at upload time.
            rescued = stored_calibration_for_rescue(original_match_path)
            if rescued is not None:
                log.info(
                    "  %s calibration declined (%s); reusing the stored "
                    "table from %s",
                    attempt.name,
                    calibration.get("code") or "no reason given",
                    rescued.get("source") or "an earlier run",
                )
                calibration = {"ok": True, "code": None,
                               "calibration": rescued}
        if not calibration["ok"]:
            failure = (
                calibration.get("code")
                or (
                    "keypoint_calibration_declined"
                    if attempt.name == "normal"
                    else "vision_calibration_rejected"
                )
            )
            terminal_status, terminal_failure = _commit_placement_lifecycle(
                conn,
                record,
                job_id,
                user_id,
                attempt,
                status=attempt.expected_failure_status,
                mapped_points=0,
                failure_code=failure,
            )
            return PlacementRetryResult(
                match_id,
                False,
                0,
                terminal_failure,
                terminal_status,
            )

        placement_match = json.loads(Path(original_match_path).read_text())
        placement_match["calibration"] = calibration["calibration"]
        placement_match_path = Path(workdir) / "placement-match.json"
        placement_match_path.write_text(
            json.dumps(placement_match, indent=1) + "\n"
        )
        output = run_placement_reconstruction(
            placement_match_path,
            video_path,
            blurball_path,
            record["points"],
            workdir,
        )
        if progress:
            progress(85)
        downgrade_untrusted_ready_hypotheses(output)
        placements = validate_backfill_output(record, output)
        validate_placement_only_match_update(
            placement_match,
            output["match"],
        )
        mapped = count_drawable_placements(
            [{"placement": placement} for placement in placements.values()]
        )
        if mapped == 0:
            terminal_status, terminal_failure = _commit_placement_lifecycle(
                conn,
                record,
                job_id,
                user_id,
                attempt,
                status=attempt.expected_failure_status,
                mapped_points=0,
                failure_code="no_mappable_points",
            )
            return PlacementRetryResult(
                match_id,
                False,
                0,
                terminal_failure,
                terminal_status,
            )

        original_placements = {
            int(point["idx"]): point.get("placement")
            for point in record["points"]
        }
        original_autocommit = conn.autocommit
        try:
            conn.autocommit = False
            current = load_placement_attempt_record(
                conn,
                job_id,
                user_id,
                match_id,
                attempt,
                for_update=True,
            )
            _assert_placement_record_unchanged(record, current)
            _update_backfill_rows(conn, match_id, placements)
            _update_placement_lifecycle(
                conn,
                match_id,
                job_id,
                attempt,
                status="ready",
                mapped_points=mapped,
                failure_code=None,
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.autocommit = original_autocommit
        if progress:
            progress(92)

        try:
            upload_match_json(
                record["match_json_path"],
                output["match"],
                workdir,
            )
            verify_placement_attempt(
                conn,
                match_id,
                job_id,
                attempt.job_field,
                record["match_json_path"],
                placements,
                output["match"],
                mapped,
            )
        except Exception as error:
            _compensate_placement(
                conn,
                record,
                job_id,
                attempt,
                original_placements,
                original_match_path,
                error,
            )
        if progress:
            progress(98)
        return PlacementRetryResult(
            match_id,
            True,
            mapped,
            None,
            "ready",
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def process_placement_retry(
    conn,
    job_id: str,
    user_id: str,
    payload: dict,
) -> PlacementRetryResult:
    options = get_job_options(conn, job_id, payload)
    match_id = require_match_id(options)
    return placement_for_match(
        conn,
        job_id,
        user_id,
        match_id,
        STRONGER_PLACEMENT_ATTEMPT,
        progress=lambda value: update_job(conn, job_id, progress=value),
    )


def require_match_id(options: dict) -> str:
    match_id = options.get("match_id")
    if not isinstance(match_id, str) or not re.fullmatch(
        r"[0-9a-fA-F-]{36}",
        match_id,
    ):
        raise RuntimeError("placement job has an invalid match id")
    return match_id


def process_placement_generation(
    conn,
    job_id: str,
    user_id: str,
    payload: dict,
) -> PlacementRetryResult:
    options = get_job_options(conn, job_id, payload)
    match_id = require_match_id(options)
    return placement_for_match(
        conn,
        job_id,
        user_id,
        match_id,
        NORMAL_PLACEMENT_ATTEMPT,
        progress=lambda value: update_job(conn, job_id, progress=value),
    )


def finalize_poisoned_placement_attempt(
    conn,
    job_id: str,
    user_id: str,
    match_id: str,
    attempt: PlacementAttemptSpec,
) -> str | None:
    """Make the last unexpected worker failure visible exactly once."""
    record = load_placement_attempt_record(
        conn,
        job_id,
        user_id,
        match_id,
        attempt,
    )
    terminal_statuses = (
        {"ready", "retry_available", "final_failed"}
        if attempt.name == "normal"
        else {"ready", "final_failed"}
    )
    if record["placement_status"] in terminal_statuses:
        return None
    source_missing = (
        not record.get("input_path")
        or not record.get("match_json_path")
    )
    source_unavailable = record.get("source_expired") or source_missing
    terminal_status = (
        "retry_available"
        if attempt.name == "normal" and not source_unavailable
        else "final_failed"
    )
    if record.get("source_expired"):
        failure_code = "source_expired"
    elif source_missing:
        failure_code = "source_missing"
    else:
        failure_code = (
            "generation_processing_failed"
            if attempt.name == "normal"
            else "retry_processing_failed"
        )
    _commit_placement_lifecycle(
        conn,
        record,
        job_id,
        user_id,
        attempt,
        status=terminal_status,
        mapped_points=0,
        failure_code=failure_code,
    )
    return terminal_status


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
VALID_MATCH_TYPES = {"drills", "practice", "match", "league", "tournament"}
PLACEMENT_STATUSES = {
    "not_requested",
    "processing",
    "ready",
    "retry_available",
    "retrying",
    "final_failed",
}


# ---------------------------------------------------------------------------
# Commerce (096): uploads and processing are separate actions. A library
# job carries options.match_id — the row already exists (status 'uploaded'),
# processing was paid for in whole minutes by claim_processing, and the
# worker's job is to fill the row in rather than create it.
# ---------------------------------------------------------------------------
def commerce_enabled(conn) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "select value from public.app_config where key = 'commerce_enabled'")
        row = cur.fetchone()
    return bool(row and row[0] == "true")


def probe_duration_s(path: str) -> float | None:
    try:
        return float(_ffprobe_streams(path)["format"]["duration"])
    except Exception:
        return None


def apply_trim(local_input: str, workdir: str,
               start_s: float, end_s: float) -> str:
    """Cut the working copy down to the claimed window before the pipeline
    sees it. Input-seeked stream copy: fast, and keyframe-snapped so the
    head may open up to one GOP early — generous, never short, and the
    charge was computed from this exact window either way. The stored raw
    stays whole."""
    out = os.path.join(workdir,
                       "trimmed" + (os.path.splitext(local_input)[1] or ".mp4"))
    dur = max(0.0, end_s - start_s)
    subprocess.run(
        ["ffmpeg", "-y", "-ss", f"{max(0.0, start_s):.3f}",
         "-i", local_input, "-t", f"{dur:.3f}",
         "-c", "copy", "-avoid_negative_ts", "make_zero", out],
        check=True, capture_output=True)
    log.info("  trimmed to claimed window %.1fs-%.1fs", start_s, end_s)
    return out


def apply_source_trim(local_path: str, workdir: str, options) -> str:
    """A library job (096) processed inside a trim window, so every point
    timestamp lives in the TRIMMED timebase. Any later consumer of those
    timestamps against the raw source — reclips, placement backfills —
    must cut the same window first or every cut lands trim_start seconds
    late. No-op for legacy sources and untrimmed claims."""
    if not isinstance(options, dict) or options.get("match_id") is None:
        return local_path
    t1 = options.get("trim_end_s")
    if t1 is None:
        return local_path
    t0 = float(options.get("trim_start_s") or 0.0)
    real = probe_duration_s(local_path)
    if t0 > 0.5 or (real is not None and float(t1) < real - 0.5):
        return apply_trim(local_path, workdir, t0, float(t1))
    return local_path


def create_uploaded_match(conn, user_id: str, job_id: str, raw_path: str,
                          duration_s: float | None, original_name: str | None,
                          played_at: str | None, meta: dict | None = None
                          ) -> str | None:
    """Library row for a YouTube import in commerce mode: downloaded, not
    processed. Idempotent by job_id — a retried download must not mint a
    second row. Returns the row's id (existing one on a retry).

    The import form's answers (opponent, venue, type, and which end they
    played from) ride jobs.options.meta and belong on the row from birth:
    without them the match page asks for the side a second time, and the
    typed opponent and venue are simply lost. Same guards register_upload
    applies to a direct upload's answers."""
    meta = meta if isinstance(meta, dict) else {}
    opponent = (meta.get("opponent_name") or "").strip()[:120] or None
    venue = (meta.get("venue") or "").strip()[:120] or None
    match_type = meta.get("match_type")
    if match_type not in VALID_MATCH_TYPES:
        match_type = None
    user_side = meta.get("user_side")
    if user_side not in ("near", "far"):
        user_side = None
    first_server = meta_first_server(meta)
    with conn.cursor() as cur:
        cur.execute(
            "insert into public.matches "
            "(user_id, job_id, status, raw_path, duration_s, original_name, "
            " played_at, content_checked_at, opponent_name, venue, "
            " match_type, user_side, first_server, first_server_source) "
            "select %s, %s, 'uploaded', %s, %s, %s, "
            "coalesce(%s::timestamptz, now()), now(), %s, %s, %s, %s, %s, "
            "case when %s is not null then 'user' end "
            "where not exists "
            "(select 1 from public.matches where job_id = %s)",
            (user_id, job_id, raw_path, duration_s,
             (original_name or "").strip()[:200] or None, played_at,
             opponent, venue, match_type, user_side, first_server,
             first_server, job_id),
        )
        cur.execute(
            "select id::text from public.matches where job_id = %s", (job_id,))
        row = cur.fetchone()
    return row[0] if row else None


def claim_processing_for(conn, user_id: str, match_id: str,
                         placement: bool, strictness: str) -> bool:
    """Start processing on the uploader's behalf after a library import
    (098). The import finishes on the worker with no browser left to make
    the claim, so the service role makes it — same function, same rules.
    A refusal (no minutes, queue full) is not an error: the video simply
    waits in the library, which is what the import UI promises."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select set_config('request.jwt.claims', %s, true)",
                (json.dumps({"role": "service_role"}),))
            cur.execute(
                "select public.claim_processing(%s, null, null, true, %s, "
                "%s, null, %s)",
                (match_id, placement, strictness, user_id))
            claim = cur.fetchone()[0]
            cur.execute("select set_config('request.jwt.claims', '', true)")
        log.info("  auto-process claimed: %s minute(s), job %s",
                 claim.get("charged_minutes"), claim.get("job_id"))
        return True
    except psycopg2.Error as e:
        log.info("  auto-process not started (%s) — the video is in the "
                 "library", str(e).strip().splitlines()[0])
        return False


def refund_processing_spend_direct(conn, job_id: str):
    """Compensating ledger rows when a claimed job fails for good. Personal
    spends only (an order-funded review moves no personal minutes), and the
    not-exists guard makes a double call harmless. Mirrors the
    refund_processing_spend RPC, which the worker cannot call: its direct
    Postgres session has no auth.role()."""
    with conn.cursor() as cur:
        cur.execute(
            "insert into public.processing_ledger "
            "(user_id, minutes, kind, funding, billing_mode, match_id, "
            " job_id, order_id, note) "
            "select l.user_id, -l.minutes, 'refund', l.funding, "
            "l.billing_mode, l.match_id, l.job_id, l.order_id, "
            "'processing failed' "
            "from public.processing_ledger l "
            "where l.job_id = %s and l.kind = 'spend' "
            "and l.funding = 'personal' "
            "and not exists (select 1 from public.processing_ledger r "
            "where r.job_id = %s and r.kind = 'refund')",
            (job_id, job_id),
        )
        if cur.rowcount:
            log.info("  refunded %d minute spend(s) for job %s",
                     cur.rowcount, job_id)


def mark_library_match_failed(conn, match_id: str):
    """Flip a library row to failed so its page offers Process again. Only
    from the in-flight states — a ready match never regresses."""
    with conn.cursor() as cur:
        cur.execute(
            "update public.matches set status = 'failed' "
            "where id = %s and status in ('uploaded', 'processing')",
            (match_id,),
        )


def create_match(conn, match_id: str, user_id: str, job_id: str,
                 cut_path: str, opponent_name: str | None = None,
                 match_type: str | None = None, venue: str | None = None,
                 played_at: str | None = None, user_side: str | None = None,
                 first_server: str | None = None,
                 placement_requested: bool = False,
                 existing: bool = False):
    """Insert the match row. played_at is the video's capture date (ISO
    string) when we could read one; NULL/None falls back to now(). user_side
    ('near'/'far') is the end the uploader played from, tagged in the upload
    form; NULL means untagged and the match page asks on first open.

    first_server ('user'/'opponent') is the upload form's optional answer
    to who served the first point; NULL means unanswered and the match page
    asks. It always travels with first_server_source = 'user', which is what
    keeps the RTMPose detector from overwriting it later.

    existing=True (096): the row was created at upload; fill it in instead.
    User-entered fields only backfill when empty — the owner may have edited
    them on the raw page while the job ran."""
    pending_structure = (
        json.dumps({
            "version": 1,
            "status": "pending",
            "algorithm": "rtmpose-match-structure-v1",
        })
        if MATCH_STRUCTURE_ENABLED
        else None
    )
    with conn.cursor() as cur:
        if existing:
            # A re-run after a failed points stage would stack a second
            # set of rows onto the leftovers; clear them first. Every
            # reference cascades (notes, tags, share links, cut labels).
            cur.execute("delete from public.points where match_id = %s",
                        (match_id,))
            cur.execute(
                "update public.matches set job_id = %s, cut_path = %s, "
                "status = 'processing', "
                "opponent_name = coalesce(opponent_name, %s), "
                "match_type = coalesce(match_type, %s), "
                "venue = coalesce(venue, %s), "
                "played_at = coalesce(%s::timestamptz, played_at), "
                "user_side = coalesce(user_side, %s), "
                # Backfill only. register_upload may already have written
                # the answer at completion, and the owner may have set it
                # on the raw page while the job ran; either way theirs is
                # the newer read and this one is stale form state.
                "first_server_source = case "
                "when first_server is null and %s is not null then 'user' "
                "else first_server_source end, "
                "first_server = coalesce(first_server, %s), "
                "match_structure = coalesce(%s::jsonb, match_structure), "
                "placement_status = %s "
                "where id = %s",
                (job_id, cut_path, opponent_name, match_type, venue,
                 played_at, user_side, first_server, first_server,
                 pending_structure,
                 "processing" if placement_requested else "not_requested",
                 match_id),
            )
            return
        cur.execute(
            "insert into public.matches (id, user_id, job_id, cut_path, "
            "status, opponent_name, match_type, venue, played_at, user_side, "
            "first_server, first_server_source, "
            "match_structure, placement_status) "
            "values (%s, %s, %s, %s, 'processing', %s, %s, %s, "
            "coalesce(%s::timestamptz, now()), %s, %s, "
            "case when %s is not null then 'user' end, %s, %s)",
            (match_id, user_id, job_id, cut_path, opponent_name, match_type,
             venue, played_at, user_side, first_server, first_server,
             pending_structure,
             "processing" if placement_requested else "not_requested"),
        )


def finish_match(conn, match_id: str, status: str,
                 match_json_path: str | None = None,
                 thumb_path: str | None = None,
                 placement_status: str | None = None,
                 placement_mapped_points: int | None = None,
                 placement_failure_code: str | None = None):
    if (placement_status is not None
            and placement_status not in PLACEMENT_STATUSES):
        raise ValueError(f"invalid placement status: {placement_status}")
    with conn.cursor() as cur:
        cur.execute(
            "update public.matches set status = %s, "
            "match_json_path = coalesce(%s, match_json_path), "
            "thumb_path = coalesce(%s, thumb_path), "
            "placement_status = coalesce(%s, placement_status), "
            "placement_mapped_points = "
            "coalesce(%s, placement_mapped_points), "
            "placement_failure_code = case when %s is null "
            "then placement_failure_code else %s end, "
            "placement_retry_expires_at = case "
            "when %s in ('not_requested', 'retry_available') then "
            "(select j.created_at + interval '30 days' "
            " from public.jobs j where j.id = public.matches.job_id) "
            "when %s is not null then null "
            "else placement_retry_expires_at end "
            "where id = %s",
            (
                status,
                match_json_path,
                thumb_path,
                placement_status,
                placement_mapped_points,
                placement_status,
                placement_failure_code,
                placement_status,
                placement_status,
                match_id,
            ),
        )


def count_drawable_placements(points: list[dict]) -> int:
    """Count points with at least one renderable placement event."""
    count = 0
    for point in points:
        placement = point.get("placement")
        if not isinstance(placement, dict):
            continue
        hypotheses = placement.get("hypotheses")
        if not isinstance(hypotheses, dict):
            bounces = placement.get("bounces")
            count += int(isinstance(bounces, list) and bool(bounces))
            continue
        drawable = any(
            isinstance(hypothesis, dict)
            and any(
                shot.get("landing") is not None
                or shot.get("terminal") is not None
                for shot in hypothesis.get("shots", [])
                if isinstance(shot, dict)
            )
            for hypothesis in hypotheses.values()
        )
        count += int(drawable)
    return count


def placement_outcome(
    *,
    requested: bool,
    mapped_points: int,
    calibration: object,
) -> tuple[str, str | None]:
    """Where a finished match's placement lifecycle lands, and why.

    Three outcomes, and the distinction between the last two is the point:

    'no_table_found' means every calibrator declined — the keypoint
    detector, then Luna, then Sol. A retry runs that same ladder against
    that same video and reaches that same answer, so offering one would
    spend the player's single placement request on something that cannot
    work and leave them waiting for it. Terminal, allowance untouched.

    'no_mappable_points' means the table WAS found and no point produced a
    drawable landing. That is a tracking problem rather than a calibration
    one and a second pass genuinely can come out differently, so the retry
    stays on offer.

    No money moves either way. Processing is billed at ceil(duration / 60)
    minutes by claim_processing and the placement flag does not enter that
    sum, so placement has never carried a charge of its own and a late
    generation is free.
    """
    if not requested:
        return "not_requested", None
    if mapped_points:
        return "ready", None
    found_table = (isinstance(calibration, dict)
                   and bool(calibration.get("ok")))
    if not found_table:
        return "final_failed", "no_table_found"
    return "retry_available", "no_mappable_points"


# Poster thumb geometry. The Matches grid is the widest consumer: the app
# shell caps at max-w-4xl (896px) and the grid is 3-up on desktop, so a card
# is ~274 CSS px — 549 device px on a 2x display. 560 covers that and a 3x
# phone (507) with nothing to spare and nothing wasted. WebP q75 lands
# around 15 KB against the 42 KB the old 720px JPEG cost.
THUMB_WIDTH = 560
THUMB_QUALITY = 75


def encode_thumb(src_path: str, out_path: str) -> bool:
    """Downscale an extracted frame into the poster WebP. Split out so the
    backfill produces byte-identical output to a fresh job."""
    from PIL import Image

    with Image.open(src_path) as im:
        im = im.convert("RGB")
        if im.width > THUMB_WIDTH:
            height = round(im.height * THUMB_WIDTH / im.width)
            im = im.resize((THUMB_WIDTH, height), Image.LANCZOS)
        im.save(out_path, "WEBP", quality=THUMB_QUALITY, method=6)
    return os.path.exists(out_path) and os.path.getsize(out_path) > 0


def extract_thumb(clip_path: str, out_path: str, seek_s: float) -> bool:
    """Poster WebP for match cards (033): one frame out of a point clip,
    downscaled to THUMB_WIDTH. Never raises — a match without a thumb simply
    renders as a plain card.

    The frame lands as a lossless PNG first so the only lossy step is the
    WebP encode; a JPEG intermediate would compress twice for nothing.
    """
    frame = None
    try:
        frame = f"{out_path}.frame.png"
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error",
             "-ss", f"{max(0.0, seek_s):.2f}", "-i", clip_path,
             "-frames:v", "1", frame],
            check=True, capture_output=True, timeout=120)
        return encode_thumb(frame, out_path)
    except Exception:
        log.warning("  thumb extraction failed for %s", clip_path)
        return False
    finally:
        if frame and os.path.exists(frame):
            try:
                os.remove(frame)
            except OSError:
                pass


def merge_card_audio(input_video: str, outdir: str) -> int:
    """Add what the microphone heard to the assembler's evidence dump.

    The portal draws four rows under each card — the ear, the ball
    detector, the bounces it called, the serve it anchored. The last three
    are already in the dump; this is the first, and it has to be measured
    here because nothing downstream still has the audio on the assembler's
    clock.

    Handed `input_video`, which is the file the assembler was handed:
    trimmed exactly as it was. Reading the stored raw instead would put
    every impact `trim_start` seconds early on a trimmed upload, and the
    error is invisible — the row simply lines up with the wrong rally.

    About four seconds for a half-hour match, and no bearing on anything
    the player sees, so a failure is logged and dropped. Returns the number
    of impacts found, or 0.
    """
    dump = os.path.join(outdir, "evidence.json")
    if not os.path.exists(dump):
        return 0
    out = os.path.join(outdir, "audio.json")
    # The vendor interpreter, where scipy lives — the same one that runs
    # blurball and the points pipeline. The worker's own environment has
    # never carried the scientific stack and does not start here.
    subprocess.run([VENV_PY, CARD_AUDIO, "--video", input_video,
                    "--out", out], check=True, timeout=1800)
    with open(out) as fh:
        audio = json.load(fh)
    with open(dump) as fh:
        blob = json.load(fh)
    blob["audio"] = audio
    with open(dump, "w") as fh:
        json.dump(blob, fh, separators=(",", ":"))
    rate = len(audio["impacts"]) / max(audio["duration"], 1)
    log.info("  card audio: %d impacts over %.0fs (%.1f/s)",
             len(audio["impacts"]), audio["duration"], rate)
    return len(audio["impacts"])


def publish_card_diagnosis(outdir: str, key_prefix: str,
                           serve_pad: str = SERVE_SURFACE_PAD_DEFAULT,
                           serve_merge: str = SERVE_MERGE_S_DEFAULT) -> int:
    """Distil the assembler's evidence dump into the portal's per-card view.

    Returns the bytes uploaded, or 0 when there was nothing to publish —
    which is the ordinary case for a v1 match, an uncalibrated one, or any
    upload whose assembler declined to run. Callers treat a missing file as
    "no diagnosis for this match", never as a failure.

    Deliberately the same builder the research page uses
    (research_serve_misses.build), with include_all so the portal gets the
    cards that DID find a serve too — the question there is whether the
    placement and the first bounce are right, which only makes sense on a
    card that has one.
    """
    dump = os.path.join(outdir, "evidence.json")
    if not os.path.exists(dump):
        return 0
    import points_v2
    from publish_card_diagnosis import trim_for_transport
    from research_serve_misses import build as build_card_diagnosis

    # The serve rule reads two of its constants from app_config per job, so
    # importing the detector gives its module defaults rather than what this
    # match was actually cut with. Pin them to the job's own values: a page
    # that recomputes the verdict at different settings than production used
    # disagrees with the cards it is drawn on top of, and reads as evidence
    # while doing it. The research page learned this the expensive way.
    points_v2.PAIR_SURFACE_PAD_M = float(serve_pad)
    points_v2.CLUSTER_S = float(serve_merge)

    with open(dump) as fh:
        blob = json.load(fh)
    blob.setdefault("match_id", key_prefix.rsplit("/", 1)[-1])
    try:
        page = trim_for_transport(build_card_diagnosis(blob, include_all=True))
    except ValueError as e:
        # No table quad; there is nothing to project bounces against.
        log.info("  card diagnosis skipped: %s", e)
        return 0

    dest = os.path.join(outdir, "serves.json")
    with open(dest, "w") as fh:
        json.dump(page, fh, separators=(",", ":"))
    size = os.path.getsize(dest)
    r2().upload_file(dest, R2_MEDIA_BUCKET, f"{key_prefix}/serves.json",
                     ExtraArgs={"ContentType": "application/json"})
    anchored = sum(1 for c in page["cards"] if c.get("serve_s") is not None)
    log.info("  card diagnosis: %d cards (%d with a serve), %.0f KB",
             len(page["cards"]), anchored, size / 1024)
    return size


def insert_points(
    conn,
    match_id: str,
    points: list[dict],
    prefix: str,
) -> dict[int, dict]:
    inserted = {}
    with conn.cursor() as cur:
        for p in points:
            point_id = str(uuid.uuid4())
            cur.execute(
                "insert into public.points (id, match_id, idx, t0, t1, "
                "clip_path, server, placement, suggestion, cut_t0, "
                "rally_end_cut_s) "
                "values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (point_id, match_id, p["idx"], p["t0"], p["t1"],
                 f"{prefix}/{p['clip']}", p.get("server"),
                 json.dumps(p["placement"]) if p.get("placement") else None,
                 json.dumps(p["suggestion"]) if p.get("suggestion")
                 else None,
                 p.get("cut_t0"), p.get("rally_end_cut_s")),
            )
            inserted[int(p["idx"])] = {
                "id": point_id,
                "t0": float(p["t0"]),
                "t1": float(p["t1"]),
            }
    return inserted


def map_structure_point_ids(
    evidence: dict,
    points_by_idx: dict[int, dict],
) -> dict:
    """Attach stable database point IDs/timestamps to summarized evidence."""
    mapped = json.loads(json.dumps(evidence))
    for point in mapped.get("points") or []:
        idx = int(point["idx"])
        stored = points_by_idx.get(idx)
        if not stored:
            raise ValueError(
                f"match structure references missing point index {idx}"
            )
        point["point_id"] = str(stored["id"])
        point["t0"] = float(stored["t0"])
        point["t1"] = float(stored["t1"])
    for change in mapped.get("end_changes") or []:
        for prefix in ("after", "before", "confirmed_at"):
            idx = int(change[f"{prefix}_idx"])
            stored = points_by_idx.get(idx)
            if not stored:
                raise ValueError(
                    f"match structure references missing point index {idx}"
                )
            change[f"{prefix}_point_id"] = str(stored["id"])
    return mapped


def meta_first_server(meta: dict | None) -> str | None:
    """The upload form's "who served first" answer, or None.

    Anything that is not one of the two answers is no answer. A guessed
    first server is worse than a missing one: the rotation is wrong for
    the whole match, and because the value is present it also suppresses
    the detector fallback AND the banner that would have let someone fix
    it. Whenever this returns a value the caller must also write
    first_server_source = 'user', or persist_match_structure will let
    RTMPose overrule the person who was standing at the table.
    """
    if not isinstance(meta, dict):
        return None
    value = meta.get("first_server")
    return value if value in ("user", "opponent") else None


def resolved_detected_first_server(
    evidence: dict | None,
    user_side: str | None,
) -> str | None:
    """Map high-confidence near/far evidence into uploader/opponent."""
    if user_side not in ("near", "far") or not isinstance(evidence, dict):
        return None
    first = evidence.get("first_server")
    if (
        not isinstance(first, dict)
        or first.get("status") != "high_confidence"
        or first.get("side") not in ("near", "far")
    ):
        return None
    return "user" if first["side"] == user_side else "opponent"


def run_match_structure_stage(
    blurball_out: str,
    match_json_path: str,
    clips_dir: str,
    workdir: str,
) -> dict | None:
    """Run optional RTMPose inference without failing normal match output."""
    if not MATCH_STRUCTURE_ENABLED:
        return None
    output = os.path.join(workdir, "match-structure.json")
    started = time.perf_counter()
    try:
        subprocess.run(
            [
                RTMPOSE_PY,
                MATCH_STRUCTURE_SCRIPT,
                "--clips-dir", clips_dir,
                "--blurball", blurball_out,
                "--match-json", match_json_path,
                "--output", output,
                "--model", RTMPOSE_MODEL,
                "--backend", RTMPOSE_BACKEND,
                "--device", RTMPOSE_DEVICE,
            ],
            check=True,
            timeout=20 * 60,
        )
        with open(output) as source:
            evidence = json.load(source)
        compute = evidence.get("compute") or {}
        coverage = evidence.get("coverage") or {}
        log.info(
            "  match structure %s: elapsed=%ss inference=%ss "
            "high_confidence=%s/%s",
            evidence.get("status"),
            compute.get("elapsed_s"),
            compute.get("inference_s"),
            coverage.get("high_confidence"),
            coverage.get("total"),
        )
        return evidence
    except Exception:
        elapsed = round(time.perf_counter() - started, 6)
        log.exception(
            "  match structure failed open after %.3fs; "
            "normal processing continues",
            elapsed,
        )
        return {
            "version": 1,
            "status": "failed",
            "algorithm": "rtmpose-match-structure-v1",
            "first_server": {
                "status": "unavailable",
                "side": None,
            },
            "points": [],
            "end_changes": [],
            "coverage": {
                "total": 0,
                "high_confidence": 0,
                "needs_review": 0,
                "unavailable": 0,
            },
            "compute": {"elapsed_s": elapsed},
            "reason": "runtime_error",
        }


def persist_match_structure(
    conn,
    match_id: str,
    evidence: dict,
    points_by_idx: dict[int, dict],
    user_side: str | None,
) -> dict:
    """Persist evidence while preserving an in-flight user decision."""
    mapped = map_structure_point_ids(evidence, points_by_idx)
    detected = resolved_detected_first_server(mapped, user_side)
    with conn.cursor() as cur:
        cur.execute(
            "update public.matches set match_structure = %s, "
            "first_server = case "
            "when first_server_source = 'user' then first_server "
            "else coalesce(%s, first_server) end, "
            "first_server_source = case "
            "when first_server_source = 'user' then 'user' "
            "when %s is not null then 'detected' "
            "else first_server_source end "
            "where id = %s",
            (json.dumps(mapped), detected, detected, match_id),
        )
    return mapped


# ---------------------------------------------------------------------------
# Side-change detection (game-end candidates), v2 — 2026-08-26
#
# Downstream of point detection and deliberately blind to it: reads the
# clips the pipeline already cut and answers one question — did the two
# players persistently swap table ends between two consecutive points?
# It never decides whether a point exists or where it starts or ends.
#
# Runs AFTER the match is ready and the owner is notified: the detector
# costs ~4 minutes of CPU (RTMDet person detection is CPU-only here —
# onnxruntime's CoreML EP rejects its output shape), and an upload's
# time-to-ready must not pay for an indicator. Evidence simply appears
# on the match a few minutes later.
# ---------------------------------------------------------------------------
SIDE_CHANGE_SCRIPT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "extract_side_changes_rtmpose.py",
)
# Content the detector must not run for. Everything else — match, league,
# tournament, and untyped — is computed; DISPLAY is gated separately at
# read time (app must also see an eligible type and an unscored match),
# so typing a match after upload lights it up with no reprocess.
SIDE_CHANGE_SKIP_TYPES = {"drills", "practice"}


def side_change_detection_enabled(conn) -> bool:
    """app_config.game_end_detection == 'on'.

    Same contract as points_pipeline_version: read per job so one UPDATE
    turns the stage on or off with no deploy and no restart, and a config
    read that errors FAILS OPEN to off — a broken config table must not
    change how a match processes.
    """
    try:
        return get_config(conn, "game_end_detection") == "on"
    except Exception:
        return False


def side_change_config(conn) -> dict | None:
    """Optional threshold overrides: app_config.game_end_detection_config,
    a JSON object merged over side_change.DEFAULT_CONFIG. Junk or a failed
    read means defaults."""
    try:
        raw = get_config(conn, "game_end_detection_config")
        parsed = json.loads(raw) if raw else None
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def run_side_change_stage(conn, match_id: str, workdir: str,
                          outdir: str) -> None:
    """Post-ready enrichment: detect side changes, persist the evidence.

    Every failure is logged and swallowed — the match is already ready
    and notified, so nothing downstream may be disturbed. Persists the
    COMPACT evidence (side_changes + provenance, no per-point payload)
    to matches.match_structure, never touching first_server, and uploads
    the full diagnostic artifact beside match.json in R2.
    """
    try:
        from worker.side_change import compact_evidence, map_point_ids
    except ModuleNotFoundError:  # direct `python worker/worker.py`
        from side_change import compact_evidence, map_point_ids

    if not side_change_detection_enabled(conn):
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select user_id, match_type, status, match_json_path "
                "from public.matches where id = %s",
                (match_id,),
            )
            row = cur.fetchone()
        if not row or row[2] != "ready":
            return
        user_id, match_type, _, match_json_path = row
        if match_type in SIDE_CHANGE_SKIP_TYPES:
            return
        output = os.path.join(workdir, "side-changes.json")
        cmd = [
            RTMPOSE_PY, SIDE_CHANGE_SCRIPT,
            "--clips-dir", outdir,
            "--match-json", os.path.join(outdir, "match.json"),
            "--output", output,
            "--model", RTMPOSE_MODEL,
            "--backend", RTMPOSE_BACKEND,
            "--device", RTMPOSE_DEVICE,
        ]
        overrides = side_change_config(conn)
        if overrides:
            cmd += ["--config", json.dumps(overrides)]
        started = time.perf_counter()
        subprocess.run(cmd, check=True, timeout=30 * 60)
        with open(output) as source:
            evidence = json.load(source)
        with conn.cursor() as cur:
            cur.execute(
                "select id, idx, t0, t1 from public.points "
                "where match_id = %s",
                (match_id,),
            )
            points_by_idx = {
                int(r[1]): {"id": r[0], "t0": float(r[2]),
                            "t1": float(r[3])}
                for r in cur.fetchall()
            }
        mapped = map_point_ids(evidence, points_by_idx)
        with conn.cursor() as cur:
            cur.execute(
                "update public.matches set match_structure = %s "
                "where id = %s",
                (json.dumps(compact_evidence(mapped)), match_id),
            )
        # Full diagnostics land beside match.json; the ledger row keeps
        # the bytes attached to the match so deletion frees them.
        if match_json_path and match_json_path.startswith("r2://"):
            prefix = match_json_path.rsplit("/", 1)[0]
            bucket, key_prefix = prefix.removeprefix("r2://").split("/", 1)
            r2().upload_file(
                output, bucket, f"{key_prefix}/side-changes.json",
                ExtraArgs={"ContentType": "application/json"},
            )
            ledger_append(conn, user_id, "other",
                          os.path.getsize(output), f"{prefix}/", match_id)
        confirmed = [
            c for c in mapped.get("side_changes") or []
            if c.get("confirmed")
        ]
        log.info(
            "  side changes %s: %d confirmed, %s/%s qualified, %.0fs",
            mapped.get("status"),
            len(confirmed),
            (mapped.get("coverage") or {}).get("qualified"),
            (mapped.get("coverage") or {}).get("total"),
            time.perf_counter() - started,
        )
    except Exception:
        log.exception(
            "  side-change stage failed open; match %s stays as shipped",
            match_id,
        )


def points_child_env(workdir: str | Path) -> tuple[dict, Path]:
    """Environment for a points-pipeline child, wired for cost metering.

    Returns the env and the sidecar path to hand to
    record_vision_usage_sidecar once the child exits. The child inherits the
    parent environment otherwise; it finds its own OpenAI key through the
    Keychain, so this grants no access it did not already have — it only
    gives the spend somewhere to be reported.
    """
    usage_output_path = Path(workdir) / "points-cost-usage.jsonl"
    child_env = os.environ.copy()
    child_env["PONGLENS_COST_USAGE_OUTPUT"] = str(usage_output_path)
    return child_env, usage_output_path


def points_pipeline_version(conn) -> str:
    """Which card assembly cuts new matches: app_config.points_pipeline.

    Read per job so a flip in the database takes effect on the next upload
    with no deploy and no restart. FAIL OPEN to v1 — a config read that
    errors must not change how a match processes.
    """
    try:
        return "v2" if get_config(conn, "points_pipeline") == "v2" else "v1"
    except Exception:
        return "v1"


def endon_fallback_enabled(conn) -> bool:
    """Whether a match whose serve detector found nothing gets the
    end-on assembler instead: app_config.points_endon_fallback.

    Same contract as the version switch above — read per job, so turning
    it off is one UPDATE with no deploy and no restart, and a config read
    that errors leaves the match on the path it takes today.

    The switch only decides whether the alternative is AVAILABLE. Whether
    a given match takes it is points_endon's own serve-rate test, which
    runs in the child where the evidence already is.
    """
    try:
        return get_config(conn, "points_endon_fallback") == "on"
    except Exception:
        return False


# The pre-2026-08-28 serve tolerances. These are deliberately the OLD numbers
# rather than a mirror of what points_v2 now says: a missing config row, or a
# config read that fails, has to reproduce the behaviour a match would have
# had yesterday. That is what makes deploying the code and flipping the
# setting two separate events, and what makes the rollback one UPDATE.
SERVE_SURFACE_PAD_DEFAULT = "0.15"
SERVE_MERGE_S_DEFAULT = "1.5"


def serve_motif_settings(conn) -> tuple[str, str]:
    """How much slack a serve's two bounces get, and how close together two
    readings have to be to count as one serve: app_config.serve_surface_pad_m
    and app_config.serve_merge_s.

    Read per job like the switches above, so retuning either is one UPDATE
    with no deploy and no restart.

    A value that is not a number falls back and logs rather than raising. A
    typo in one config row should cost the tolerance it was meant to set, not
    every upload on the platform — and the fallback is the rule the match
    would have got anyway.
    """
    def read(key: str, fallback: str) -> str:
        try:
            value = get_config(conn, key)
        except Exception:
            return fallback
        if value is None:
            return fallback
        try:
            float(value)
        except (TypeError, ValueError):
            log.warning("app_config.%s is not a number (%r) — using %s",
                        key, value, fallback)
            return fallback
        return value

    return (read("serve_surface_pad_m", SERVE_SURFACE_PAD_DEFAULT),
            read("serve_merge_s", SERVE_MERGE_S_DEFAULT))


def placement_serve_seed_enabled(conn) -> bool:
    """Whether placement starts its walk at the serve the assembler found:
    app_config.placement_serve_seed.

    Placement used to re-derive the start of the point from the first bounce
    inside the card, and that bounce is very often the server tapping the ball
    on the table before serving — so the serve's own two bounces were two
    events too late to be chosen. The serve time was already computed and
    written onto the point; it simply was never handed over.

    Read per job like the switches above. A read that errors leaves placement
    on the path it takes today, because a config outage must not quietly
    change how a match is reconstructed.
    """
    try:
        return get_config(conn, "placement_serve_seed") == "on"
    except Exception:
        return False


def run_points_subprocess(
    input_video: str,
    blurball_out: str,
    workdir: str,
    options: dict,
    *,
    pipeline: str = "v1",
    endon_fallback: bool = False,
    serve_surface_pad: str = SERVE_SURFACE_PAD_DEFAULT,
    serve_merge_s: str = SERVE_MERGE_S_DEFAULT,
    placement_serve_seed: bool = False,
    attempt_key: str = "manual",
) -> str:
    """The points pipeline in plays cut mode, run BEFORE the cut so the
    cut can keep exactly the per-point segments (dead-space round 4).
    Returns the outdir whose match.json carries cut_segments."""
    strictness = options.get("strictness", "normal")
    if strictness not in VALID_STRICTNESS:
        strictness = "normal"
    outdir = os.path.join(workdir, "points_out")
    cmd = [VENV_PY, POINTS_PIPELINE, "points",
           "--blurball", blurball_out, "--video", input_video,
           "--outdir", outdir, "--strictness", strictness,
           "--cut-mode", "plays"]
    if pipeline == "v2":
        # The child decides for itself whether v2 can actually run (it
        # needs a table and candidate detections) and notes the fallback
        # in match.json when it cannot; match.json's "pipeline" key is the
        # truth about what happened.
        cmd += ["--pipeline", "v2",
                "--serve-surface-pad", str(serve_surface_pad),
                "--serve-merge-s", str(serve_merge_s),
                # Every signal the assembler saw, kept so the admin portal
                # can show per-card evidence — the ball, the bounces, and
                # the rule that accepted or refused each serve pair. None
                # of it is otherwise recoverable: it lives for seconds
                # inside the assembler and is discarded, and getting it
                # back later costs a full re-run of blurball over the
                # video. Written to the workdir and never shipped whole;
                # publish_card_diagnosis distils it to ~120 KB.
                "--evidence-dump", os.path.join(outdir, "evidence.json")]
        if endon_fallback:
            cmd.append("--endon-fallback")
    if options.get("placement"):
        cmd.append("--placement")
        if placement_serve_seed:
            cmd.append("--placement-serve-seed")
    log.info("  points pipeline (strictness=%s placement=%s cut=plays "
             "pipeline=%s)…",
             strictness, bool(options.get("placement")), pipeline)
    # The points pipeline reaches the same paid vision call the placement
    # retry does, through vision_calibrate's colour-independent fallback.
    # Without this the child cannot report it and an upload's table
    # calibration is billed by OpenAI but absent from the ledger.
    child_env, usage_output_path = points_child_env(workdir)
    with COST_METER.timed_stage("point_clip_encoding", attempt_key):
        subprocess.run(cmd, check=True, cwd=workdir, timeout=6 * 3600,
                       env=child_env)
    record_vision_usage_sidecar(
        usage_output_path,
        operation="table_vision_calibration",
        scope="points-vision",
    )
    return outdir


def run_points_stage(
    conn,
    job_id: str,
    user_id: str,
    input_video: str,
    blurball_out: str,
    workdir: str,
    options: dict,
    cut_result_path: str,
    played_at: str | None = None,
    *,
    attempt_key: str = "manual",
):
    """Break the original video into points. Failure here never fails the
    job (the cut already shipped): the match row is marked failed.
    played_at is the capture date the caller extracted (ISO string or None)."""
    strictness = options.get("strictness", "normal")
    if strictness not in VALID_STRICTNESS:
        strictness = "normal"
    # A library job (096) fills in the row created at upload; everything
    # else mints a fresh match, exactly as before.
    library_id = options.get("match_id")
    match_id = str(library_id) if library_id else str(uuid.uuid4())
    # Upload-form metadata rides on jobs.options.meta. Opponent/venue/type
    # stay editable in the UI all the way through processing, so read meta
    # fresh from the row at match creation — a value typed after the
    # processing lock still lands on the match.
    meta = options.get("meta") if isinstance(options.get("meta"), dict) else {}
    fresh_meta = get_job_options(conn, job_id, {}).get("meta")
    if isinstance(fresh_meta, dict):
        meta = fresh_meta
    opponent_name = (meta.get("opponent_name") or "").strip()[:120] or None
    venue = (meta.get("venue") or "").strip()[:120] or None
    match_type = meta.get("match_type")
    if match_type not in VALID_MATCH_TYPES:
        match_type = None
    # Which end the uploader played from, tagged in the upload form. Guard:
    # only 'near'/'far' land; anything else stays NULL (untagged) and the
    # match page asks on first open.
    user_side = meta.get("user_side")
    if user_side not in ("near", "far"):
        user_side = None
    # Who served the first point, asked optionally on the upload form.
    # Backfill only: on the commerce path register_upload already wrote it
    # at completion, and the owner may have answered on the raw page since.
    first_server = meta_first_server(meta)
    create_match(conn, match_id, user_id, job_id, cut_result_path,
                 opponent_name=opponent_name, match_type=match_type,
                 venue=venue, played_at=played_at, user_side=user_side,
                 first_server=first_server,
                 placement_requested=bool(options.get("placement")),
                 existing=bool(library_id))
    outdir = os.path.join(workdir, "points_out")
    try:
        # Dead-space round 4: the points stage normally already ran BEFORE
        # the cut (run_points_subprocess, plays mode) so the cut could use
        # its segments — reuse that output. The subprocess here is the
        # fallback when the early run failed, and it deliberately runs in
        # legacy spans mode so cut_t0 agrees with the span cut that shipped.
        if not os.path.exists(os.path.join(outdir, "match.json")):
            cmd = [VENV_PY, POINTS_PIPELINE, "points",
                   "--blurball", blurball_out, "--video", input_video,
                   "--outdir", outdir, "--strictness", strictness]
            if options.get("placement"):
                cmd.append("--placement")
            log.info("  points pipeline (strictness=%s placement=%s)…",
                     strictness, bool(options.get("placement")))
            child_env, usage_output_path = points_child_env(workdir)
            with COST_METER.timed_stage("point_clip_encoding", attempt_key):
                subprocess.run(cmd, check=True, cwd=workdir,
                               timeout=6 * 3600, env=child_env)
            record_vision_usage_sidecar(
                usage_output_path,
                operation="table_vision_calibration",
                scope="points-vision",
            )

        with open(os.path.join(outdir, "match.json")) as fh:
            match_json = json.load(fh)
        points = match_json["points"]
        if not points:
            raise RuntimeError("points pipeline found no points")
        structure_evidence = run_match_structure_stage(
            blurball_out,
            os.path.join(outdir, "match.json"),
            outdir,
            workdir,
        )

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
        # Poster thumb source: the first point's clip, seeked to its rally
        # midpoint. Captured before the basename rewrite below so the local
        # path still resolves.
        p0 = min(points, key=lambda p: p["idx"])
        first_clip_local = os.path.join(outdir, p0["clip"])
        thumb_seek = max(0.0, (float(p0["t1"]) - float(p0["t0"])) / 2)
        # store clip paths flat under the match folder: NN.mp4
        for p in points:
            p["clip"] = p["clip"].split("/")[-1]
        other_bytes = os.path.getsize(os.path.join(outdir, "match.json"))
        r2().upload_file(
            os.path.join(outdir, "match.json"), R2_MEDIA_BUCKET,
            f"{key_prefix}/match.json",
            ExtraArgs={"ContentType": "application/json"},
        )
        # Per-card evidence for the admin portal: the ball track, the
        # bounces and the rule that accepted or refused each serve pair,
        # for EVERY card. Distilled from the evidence dump the points run
        # just wrote, which stays in the workdir — the dump is megabytes of
        # raw track, this is ~120 KB.
        #
        # Best effort on purpose. A player's match is ready whether or not
        # an internal diagnostic got written, so nothing in this block may
        # fail the job.
        try:
            # Two steps, two try blocks: no audio is a missing row on one
            # page, and it must not cost the ball track and the bounces
            # that were already measured.
            try:
                merge_card_audio(input_video, outdir)
            except Exception:                               # noqa: BLE001
                log.warning("  card audio skipped", exc_info=True)
            diag_pad, diag_merge = serve_motif_settings(conn)
            other_bytes += publish_card_diagnosis(
                outdir, key_prefix, diag_pad, diag_merge)
        except Exception:                                   # noqa: BLE001
            log.warning("  card diagnosis skipped", exc_info=True)

        calib_dbg = os.path.join(outdir, "calib_debug.jpg")
        if os.path.exists(calib_dbg):
            other_bytes += os.path.getsize(calib_dbg)
            r2().upload_file(calib_dbg, R2_MEDIA_BUCKET,
                             f"{key_prefix}/calib_debug.jpg",
                             ExtraArgs={"ContentType": "image/jpeg"})

        thumb_path = None
        thumb_local = os.path.join(workdir, "match_thumb.webp")
        # Keyed by job, not by match. The cut video has always been
        # results/<uid>/<job_id>.mp4, so reprocessing hands every client a
        # URL it has never seen and the new picture just appears. The thumb
        # was a fixed thumb.webp overwritten in place, so the URL never
        # changed and the app, the browser and anything in between kept
        # serving the old bytes. That is how three matches came back from a
        # reprocess playing the right way up under a thumbnail still lying
        # on its side.
        thumb_name = f"thumb-{job_id}.webp"
        if extract_thumb(first_clip_local, thumb_local, thumb_seek):
            r2().upload_file(thumb_local, R2_MEDIA_BUCKET,
                             f"{key_prefix}/{thumb_name}",
                             ExtraArgs={"ContentType": "image/webp"})
            other_bytes += os.path.getsize(thumb_local)
            thumb_path = f"{r2_prefix}/{thumb_name}"

        # Storage ledger: rows carry match_id, so match deletion (010
        # trigger) frees them; r2_key is the folder prefix for reference.
        ledger_append(conn, user_id, "clip", clip_bytes,
                      f"{r2_prefix}/", match_id)
        ledger_append(conn, user_id, "other", other_bytes,
                      f"{r2_prefix}/", match_id)

        inserted_points = insert_points(
            conn,
            match_id,
            points,
            r2_prefix,
        )
        if structure_evidence is not None:
            persist_match_structure(
                conn,
                match_id,
                structure_evidence,
                inserted_points,
                user_side,
            )
        # Stamp the clip pads the clips were actually cut with (migration
        # 048): the app's playhead mapping prefers these over the frozen
        # per-strictness fallback table. Best-effort — a pre-clip_pads
        # points_pipeline output simply leaves the column null.
        clip_pads = (match_json.get("options") or {}).get("clip_pads")
        if clip_pads:
            with conn.cursor() as cur:
                cur.execute(
                    "update public.matches set clip_pads = %s where id = %s",
                    (json.dumps(clip_pads), match_id),
                )
        # Where a 9:16 share cuts this camera (135). Computed in the points
        # pipeline from corners it already had, so this costs nothing here.
        # Written unconditionally, null included: a reprocess that loses
        # calibration must clear a stale window rather than leave the old
        # one framing a camera that has since moved. Absent from pre-135
        # pipeline output, in which case the key is simply missing and we
        # leave whatever is there alone.
        if "story_crop" in match_json:
            with conn.cursor() as cur:
                cur.execute(
                    "update public.matches set story_crop = %s where id = %s",
                    (json.dumps(match_json["story_crop"])
                     if match_json["story_crop"] else None, match_id),
                )
        mapped = count_drawable_placements(points)
        placement_status, placement_failure_code = placement_outcome(
            requested=bool(options.get("placement")),
            mapped_points=mapped,
            calibration=match_json.get("calibration"),
        )

        finish_match(
            conn,
            match_id,
            "ready",
            f"{r2_prefix}/match.json",
            thumb_path=thumb_path,
            placement_status=placement_status,
            placement_mapped_points=mapped,
            placement_failure_code=placement_failure_code,
        )
        log.info("  match %s ready: %d points -> %s",
                 match_id, len(points), r2_prefix)
        return match_id
    except Exception as e:
        log.exception("  points stage failed (cut already delivered): %s", e)
        try:
            finish_match(conn, match_id, "failed")
        except Exception:
            log.exception("  failed to mark match failed")
        if library_id:
            # The player paid minutes for points and got only a cut —
            # that's a failed processing to them. The minutes come back;
            # the cut stays.
            try:
                refund_processing_spend_direct(conn, job_id)
            except Exception:
                log.exception("  failed to refund minutes")
        notify_job_failed(conn, job_id, f"points stage: {e}")
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


def _stream_refused(message: str) -> bool:
    """A rendition YouTube served and then cut off, rather than a real
    problem with the video. Worth retrying one rung lower; anything else
    (private, age-gated, unsupported) is not."""
    low = (message or "").lower()
    return ("403" in low or "forbidden" in low
            or "unable to download video data" in low
            or "fragment" in low and "not found" in low)


def _clear_download_artifacts(workdir: str) -> None:
    """yt-dlp leaves per-format files and .part fragments behind on a
    failed attempt; the next rung must not merge or upload them."""
    try:
        for name in os.listdir(workdir):
            if name.startswith("input."):
                try:
                    os.unlink(os.path.join(workdir, name))
                except OSError:
                    pass
    except OSError:
        pass


def _download_video(url: str, local_path: str, workdir: str) -> int:
    """Download the best rendition YouTube will actually serve, walking
    YTDLP_HEIGHTS down on a cut-off stream. Returns the height that
    worked. See the YTDLP_HEIGHTS comment for why this ladder exists."""
    last: Exception | None = None
    for i, height in enumerate(YTDLP_HEIGHTS):
        _clear_download_artifacts(workdir)
        try:
            _run_ytdlp(
                ["-f", _ytdlp_format(height), "--merge-output-format", "mp4",
                 "-o", local_path, url],
                timeout=3600,
            )
            if i:
                log.warning("  YouTube refused higher renditions; got %dp",
                            height)
            return height
        except UserFacingError:
            raise                      # a real problem with the video
        except RuntimeError as e:
            if not _stream_refused(str(e)):
                raise
            if i == len(YTDLP_HEIGHTS) - 1:
                # Every rung refused. This used to raise the bare
                # RuntimeError, which carries no user_message, so the
                # uploader was told "We couldn't process this video." for
                # the one failure that is usually temporary and always
                # worth retrying. The admin still gets the stderr in
                # jobs.error; the person waiting gets something to do.
                log.warning("  every rendition refused (last: %s)",
                            str(e)[-120:])
                raise UserFacingError(
                    "YouTube would not send us the whole video. Try again "
                    "in a few minutes, or upload the file instead."
                ) from e
            log.warning("  %dp refused (%s) — trying %dp",
                        height, str(e)[-120:], YTDLP_HEIGHTS[i + 1])
            last = e
    raise last or RuntimeError("yt-dlp: no rendition could be downloaded")


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


def _yt_upload_date(info: dict) -> str | None:
    """yt-dlp's upload_date ('YYYYMMDD') as an ISO timestamp (midnight UTC),
    or None. Used as the imported match's capture date."""
    raw = info.get("upload_date")
    if isinstance(raw, str) and len(raw) == 8 and raw.isdigit():
        try:
            return datetime.strptime(raw, "%Y%m%d").replace(
                tzinfo=timezone.utc).isoformat()
        except ValueError:
            return None
    return None


def fetch_youtube(conn, job_id: str, user_id: str, options: dict,
                  workdir: str) -> tuple[str, str, str, str | None]:
    """Download options['url'] with yt-dlp, enforce duration/size limits,
    upload the file to ponglens-raw (same key shape as a direct upload) and
    stamp it on the job row. Returns
    (local_path, r2_input_path, title, played_at) where played_at is the
    video's upload_date (ISO string) or None."""
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
    played_at = _yt_upload_date(info)

    # 2. Download (mp4/h264 <= 1080p for pipeline compatibility).
    local_path = os.path.join(workdir, "input.mp4")
    log.info("  yt-dlp downloading %r (%ss)…", title, duration)
    _download_video(url, local_path, workdir)
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
    return local_path, input_path, title, played_at


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
        "Return ONLY the opponent's personal name (a person, e.g. "
        "'Ma Long' or 'Vaibhav') — never the whole title, a description, a "
        "phrase, or a year. If the title is generic (e.g. 'Professional "
        "Match', 'League Night', 'Sunday practice') with no clearly named "
        "opponent person, return null. Prefer null over guessing.\n\n"
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
    response = r.json()
    response_id = str(response.get("id") or uuid.uuid4())
    COST_METER.record(COST_METER.openai_usage_events(
        response,
        model=TITLE_OPPONENT_MODEL,
        operation="youtube_opponent_parse",
        idempotency_key=f"openai:{response_id}:youtube-opponent",
    ))
    reply = response["choices"][0]["message"]["content"] or ""
    start, end = reply.find("{"), reply.rfind("}")
    data = json.loads(reply[start:end + 1])
    name = data.get("opponent_name")
    if not isinstance(name, str):
        return None
    name = name.strip()[:120]
    if not name:
        return None
    # Guard: opponent_name is a PERSON's name, never a phrase the model
    # echoed back. Reject anything with digits (years like 'Vaibhav 2022')
    # and multi-word phrases (> 3 tokens, e.g. 'Professional Match Final').
    if any(ch.isdigit() for ch in name):
        log.info("  title->opponent: rejected %r (contains digits)", name)
        return None
    if len(name.split()) > 3:
        log.info("  title->opponent: rejected %r (too many words)", name)
        return None
    return name


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
            "select m.user_id, j.input_path, j.options, m.clip_pads "
            "from public.matches m "
            "left join public.jobs j on j.id = m.job_id "
            "where m.id = %s",
            (match_id,),
        )
        row = cur.fetchone()
    if not row:
        raise RuntimeError(f"reclip: match {match_id} not found")
    owner_id, input_path, src_options, stored_pads = row
    # options.match_id is client-writable JSON: never touch a match the
    # job's creator doesn't own.
    if str(owner_id) != str(user_id):
        raise RuntimeError("reclip: job user does not own the match")

    strictness = (src_options or {}).get("strictness", "normal")
    if strictness not in VALID_STRICTNESS:
        strictness = "normal"
    # Prefer the pads this match's clips were actually cut with (migration
    # 048); pre-048 matches fall back to the frozen per-strictness table.
    if isinstance(stored_pads, dict) and \
            isinstance(stored_pads.get("pre"), (int, float)) and \
            isinstance(stored_pads.get("post"), (int, float)):
        pre, post = float(stored_pads["pre"]), float(stored_pads["post"])
    else:
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

        if source_ok:
            # Library sources: cut the claimed window so t0/t1 line up.
            local_input = apply_source_trim(local_input, workdir, src_options)

        if not source_ok:
            # Raw gone (30-day retention) and no original->cut mapping stored:
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


def _reel_single_title_card(path: str, w: int, h: int, title: str,
                            subtitle: str):
    """One-line title card (tag reels: the tag label, not 'A vs B'),
    subtitle small and muted. Rendered 2x, downscaled."""
    from PIL import Image, ImageDraw
    s = 2
    W, H = w * s, h * s
    img = Image.new("RGB", (W, H), REEL_BG)
    d = ImageDraw.Draw(img)

    size = max(40, int(H * 0.088))
    while True:  # shrink a long label until the line fits
        f_title = _load_font(size, "bold")
        if d.textlength(title, font=f_title) <= W * 0.9 or size <= 20 * s:
            break
        size = int(size * 0.92)

    base_y = int(H * 0.47)
    d.text((W / 2, base_y), title, font=f_title, fill=REEL_WHITE,
           anchor="ms")
    if subtitle:
        f_sub = _load_font(max(16, int(H * 0.034)), "regular")
        d.text((W / 2, base_y + int(H * 0.09)), subtitle, font=f_sub,
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


# --------------------------------------------------------------------------
# 9:16 story canvas (135)
# --------------------------------------------------------------------------
STORY_W, STORY_H = 1080, 1920
# Instagram draws its own header over roughly the top of a Story and its
# reply bar over the bottom. Nothing of ours goes inside these.
STORY_SAFE_TOP = 260
STORY_SAFE_BOTTOM = 300


def story_video_box(crop_w: int, crop_h: int) -> tuple[int, int, int, int]:
    """Where the rally sits on the story canvas: (x, y, w, h).

    Full canvas width unless the source is portrait enough that fitting by
    width would overflow the height — the library already contains 608x1080
    uploads, and those must fit by height or they are cropped by the canvas.
    """
    w = STORY_W
    h = round(STORY_W * crop_h / max(1, crop_w))
    if h > STORY_H:
        h = STORY_H
        w = round(STORY_H * crop_w / max(1, crop_h))
    return ((STORY_W - w) // 2, (STORY_H - h) // 2, w, h)


def _story_background(path: str, you: str, them: str, video_box, *,
                      score_you: int = 0, score_them: int = 0,
                      games_detail: list | None = None,
                      show_score: bool = False,
                      show_names: bool = True,
                      show_logo: bool = True):
    """The full 1080x1920 story canvas the rally is overlaid onto.

    Everything except the video: the ink ground with the site's bloom, the
    name and score band above the picture, and the mark below it. One PNG
    rather than three overlays, because the bands' positions depend on
    where the video lands and working that out once is simpler than three
    ffmpeg overlay expressions that have to agree.

    show_score is the caller's decision, not ours. A match with no
    confirmed winners has no score to print, and printing 0-0 over a rally
    that was really 8-6 is worse than printing nothing.
    """
    from PIL import Image, ImageDraw, ImageFilter
    s = 2
    W, H = STORY_W * s, STORY_H * s
    vx, vy, vw, vh = (v * s for v in video_box)

    # Ground: ink, with the cyan bloom top-centre and a magenta hint upper
    # right — the same two washes as .bg-arena on the site, where both are
    # centred ABOVE the top edge and fade out well before mid-page.
    #
    # Painted small and blurred hard, then scaled up. The blur has to be a
    # large fraction of the small canvas, not a few pixels: a soft-looking
    # radius at 1/8 scale is still a hard edge once it is eight times
    # bigger, and the first attempt put a visible teal rectangle across the
    # top of the frame.
    img = Image.new("RGB", (W, H), REEL_BG)
    gw, gh = W // 8, H // 8
    glow = Image.new("RGB", (gw, gh), REEL_BG)
    g = ImageDraw.Draw(glow)
    g.ellipse([-gw * 0.35, -gh * 0.22, gw * 1.35, gh * 0.16],
              fill=(15, 30, 38))
    g.ellipse([gw * 0.55, -gh * 0.06, gw * 1.25, gh * 0.10],
              fill=(24, 15, 30))
    img.paste(glow.filter(ImageFilter.GaussianBlur(gw // 4))
              .resize((W, H), Image.LANCZOS), (0, 0))
    img = img.convert("RGBA")

    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    # A hairline so the picture has an edge against the ink rather than
    # bleeding into it.
    d.rectangle([vx, vy, vx + vw - 1, vy + vh - 1],
                outline=(255, 255, 255, 30), width=max(1, 2 * s))

    margin = 72 * s
    # The band sits above the picture, but never inside Instagram's own
    # chrome. On a tall picture it is the safe line that wins.
    top = max(STORY_SAFE_TOP * s, vy - 210 * s)

    if show_names:
        f_you = _load_font(30 * s, "medium")
        f_vs = _load_font(52 * s, "bold")
        d.text((margin, top), _fit_name(you, 22).upper(), font=f_you,
               fill=(*REEL_CYAN, 255))
        d.text((margin, top + 44 * s), f"vs {_fit_name(them, 20)}", font=f_vs,
               fill=(*REEL_WHITE, 255))

    if show_score:
        # Inset further than the names: Instagram's own icon rail runs down
        # the composer's right edge and sat over the score at 72.
        score_right = W - 150 * s
        f_score = _load_font(84 * s, "bold")
        score = f"{int(score_you)} – {int(score_them)}"
        d.text((score_right, top + 18 * s), score, font=f_score,
               fill=(*REEL_WHITE, 255), anchor="ra")
        if games_detail:
            games = "   ".join(f"{int(a)}-{int(b)}" for a, b in games_detail)
            d.text((score_right, top + 118 * s), games,
                   font=_load_font(28 * s, "medium"),
                   fill=(*REEL_MUTED, 255), anchor="ra")

    # The mark, below the picture and above Instagram's reply bar —
    # unless the owner switched it off in the share sheet (show_logo).
    if show_logo:
        mark_y = min((STORY_H - STORY_SAFE_BOTTOM) * s, vy + vh + 130 * s)
        f_wm = _load_font(38 * s, "bold")
        label = "PongLens"
        label_w = d.textlength(label, font=f_wm)
        box = 46 * s
        gap = 16 * s
        total = box + gap + label_w
        x0 = W - margin - total
        _draw_lens_mark(layer, x0 + box / 2, mark_y, box)
        d.text((x0 + box + gap, mark_y), label, font=f_wm,
               fill=(*REEL_WHITE, 235), anchor="lm")

    Image.alpha_composite(img, layer).convert("RGB") \
        .resize((STORY_W, STORY_H), Image.LANCZOS).save(path)


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


def capture_date_from_file(path: str) -> str | None:
    """The video's real capture date from container metadata
    (format.tags.creation_time), as an ISO timestamp — or None when the tag
    is absent or implausible. Fail-open: any problem just falls back to
    now() at the call site (create_match coalesces None -> now())."""
    try:
        fmt = _ffprobe_streams(path).get("format", {})
        tags = fmt.get("tags") or {}
        raw = tags.get("creation_time")
        if not isinstance(raw, str) or not raw.strip():
            return None
        dt = datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        # Sanity window: reject the epoch / unset-clock and absurd-future
        # stamps some cameras emit when the clock was never set.
        now = datetime.now(timezone.utc)
        if dt.year < 2000 or dt > now + timedelta(days=2):
            return None
        return dt.isoformat()
    except Exception as e:
        log.info("  capture-date probe skipped (%s: %s)",
                 type(e).__name__, e)
        return None


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
    # A manifest-level "title" (tag reels) replaces the 'you vs them' card:
    # a cross-match collection has no single opponent.
    custom_title = (manifest.get("title") or "").strip()
    if custom_title:
        _reel_single_title_card(title_png, tw, th, custom_title,
                                (manifest.get("subtitle") or "").strip())
    else:
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


def render_story(manifest: dict, show_score: bool, workdir: str,
                 cut_local: str | None = None,
                 crop: dict | None = None) -> str:
    """Render the 9:16 mp4 a share hands to Instagram. Returns the path.

    Deliberately NOT a branch inside render_reel. That function renders the
    exports players download and has been correct for months; a vertical
    mode threaded through its format detection, card sizing and overlay
    geometry would put both at risk to save maybe forty lines.

    No title or outro card here. The name band is burned into every frame,
    so it already does a title card's job for the whole clip, and on a
    seven-second Story an outro would eat a fifth of the video.
    """
    points = manifest["points"]
    you = (manifest.get("you_name") or "Player").strip() or "Player"
    them = (manifest.get("them_name") or "Opponent").strip() or "Opponent"
    # Absent on every manifest written before the toggle existed, and
    # absence must mean what those renders did: names on. Same for the
    # mark (show_logo, 2026-08-25).
    show_names = manifest.get("show_names") is not False
    show_logo = manifest.get("show_logo") is not False

    # cut_local may be a local path OR a presigned URL. A single rally is a
    # few seconds out of a video that can run to hundreds of megabytes, and
    # ffmpeg range-seeks over https rather than fetching the whole file, so
    # a share does not wait on a download it will use one percent of.
    cut_dur = None
    if cut_local and (cut_local.startswith("http")
                      or os.path.exists(cut_local)):
        try:
            cut_dur = float(_ffprobe_streams(cut_local)["format"]["duration"])
        except Exception as e:                                  # noqa: BLE001
            log.warning("  story: cut source unreadable (%s) — falling back "
                        "to the preview clip", e)
            cut_local = None

    # Source per point, exactly as render_reel picks them — but the crop is
    # only valid against the FULL-RESOLUTION cut. A preview clip is 720px
    # wide, and cropping that then blowing it back up to 1080 is visibly
    # soft on a phone. So a clip-sourced point keeps its whole frame.
    sources = []      # ("cut", start, dur) | ("clip", path)
    for i, p in enumerate(points):
        s0, s1 = p.get("seg_start"), p.get("seg_end")
        if cut_dur is not None and s0 is not None and s1 is not None:
            s0 = max(0.0, float(s0))
            s1 = min(float(s1), cut_dur)
            if s1 - s0 >= 0.5:
                sources.append(("cut", s0, s1 - s0))
                continue
        local = os.path.join(workdir, f"vsrc_{i:02d}.mp4")
        loc = parse_r2_path(p["clip_path"])
        if loc:
            r2().download_file(loc[0], loc[1], local)
        elif os.path.isfile(p["clip_path"]):
            shutil.copyfile(p["clip_path"], local)
        else:
            raise RuntimeError(f"story: point {p.get('point_id')} has no clip")
        sources.append(("clip", local))

    audio_srcs = {cut_local if s[0] == "cut" else s[1] for s in sources}
    keep_audio = all(
        any(st["codec_type"] == "audio"
            for st in _ffprobe_streams(p)["streams"])
        for p in audio_srcs)

    # The canvas is 1080x1920 but only the middle strip carries picture —
    # the bands are flat ink. Meta asks for under 50 MB, and a stitched
    # 60-second reel at 10 Mbps would break that, so multi-rally renders
    # hold at 6 Mbps. A single rally is 20 seconds at most, where 10 Mbps
    # tops out around 25 MB — affordable, and it is the render whose dark
    # gradient shows 6 Mbps banding on a phone screen.
    single = len(points) == 1
    vt = ["-c:v", "h264_videotoolbox",
          "-b:v", "10000000" if single else "6000000",
          "-allow_sw", "1", "-pix_fmt", "yuv420p"]
    x264 = ["-c:v", "libx264", "-preset", "medium",
            "-crf", "19" if single else "21", "-pix_fmt", "yuv420p"]
    audio_args = ["-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2"]
    encoder_used = "libx264"

    # Match the source's motion instead of flattening it to 30 fps — a 60
    # fps recording loses half its smoothness exactly where a rally moves
    # fastest. Capped at Instagram's 60, floored at 24, and shared by every
    # segment because xfade needs one clock.
    def _fps_of(src) -> int:
        try:
            v = next(st for st in _ffprobe_streams(src)["streams"]
                     if st["codec_type"] == "video")
            num, den = (v.get("avg_frame_rate") or "0/1").split("/")
            f = float(num) / max(1.0, float(den))
            if f >= 1:
                return max(24, min(60, round(f)))
        except Exception:                                       # noqa: BLE001
            pass
        return 30
    fps = _fps_of(cut_local if any(s[0] == "cut" for s in sources)
                  else sources[0][1])

    segments = []
    for i, (src, p) in enumerate(zip(sources, points)):
        seg = os.path.join(workdir, f"vseg_{i:02d}.mp4")
        from_cut = src[0] == "cut"
        probe_src = cut_local if from_cut else src[1]
        v0 = next(st for st in _ffprobe_streams(probe_src)["streams"]
                  if st["codec_type"] == "video")
        sw, sh = int(v0["width"]), int(v0["height"])

        # The stored window is in SOURCE pixels. Use it only when this
        # segment really came from a source of that size; a reprocess at a
        # different resolution, or a clip fallback, must not be cropped
        # with a window measured against something else.
        use_crop = (
            from_cut and crop
            and int(crop.get("src_w") or 0) == sw
            and int(crop.get("src_h") or 0) == sh
        )
        if use_crop:
            cw, ch = int(crop["w"]), int(crop["h"])
            cx, cy = int(crop["x"]), int(crop["y"])
            crop_filter = f"crop={cw}:{ch}:{cx}:{cy},"
        else:
            cw, ch = sw, sh
            crop_filter = ""

        bx, by, bw, bh = story_video_box(cw, ch)
        bg = os.path.join(workdir, f"vbg_{i:02d}.png")
        _story_background(
            bg, you, them, (bx, by, bw, bh),
            score_you=int(p.get("score_you") or 0),
            score_them=int(p.get("score_them") or 0),
            games_detail=p.get("games_detail") or [],
            show_score=show_score, show_names=show_names,
            show_logo=show_logo)

        if from_cut:
            inputs = ["-ss", f"{src[1]:.3f}", "-t", f"{src[2]:.3f}",
                      "-i", cut_local, "-i", bg]
        else:
            inputs = ["-i", src[1], "-i", bg]
        chain = (
            f"[0:v]{crop_filter}scale={bw}:{bh}:flags=lanczos,setsar=1,"
            f"fps={fps}[vid];"
            f"[1:v][vid]overlay={bx}:{by}:format=auto[out]"
        )
        maps = ["-map", "[out]"]
        if keep_audio:
            maps += ["-map", "0:a"]
        encoder_used = _run_ffmpeg_encoded(
            [*inputs, "-filter_complex", chain, *maps],
            vt, x264,
            [*(audio_args if keep_audio else ["-an"]), seg],
        )
        segments.append(seg)

    out_path = os.path.join(workdir, "story.mp4")
    if len(segments) == 1:
        # Stream copy, but re-muxed: faststart moves the index to the front
        # so Instagram can read the file without buffering all of it first.
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", segments[0], "-c", "copy",
             "-movflags", "+faststart", out_path],
            check=True, capture_output=True, timeout=300)
        log.info("  story: 1 rally at %dx%d, audio=%s, encoder=%s, "
                 "crop=%s", STORY_W, STORY_H, keep_audio, encoder_used,
                 "yes" if crop else "no")
        return out_path

    durs = [float(_ffprobe_streams(s)["format"]["duration"])
            for s in segments]
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
    log.info("  story: %d rallies at %dx%d, audio=%s, encoder=%s",
             len(segments), STORY_W, STORY_H, keep_audio, encoder_used)
    return out_path


def reel_email_html(match_url: str) -> str:
    return f"""\
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Your shareable match video is ready.&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background-color:#f4f5f7;">
  <tr>
    <td align="center" style="padding:48px 16px;background-color:#f4f5f7;">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:16px;">
        <tr>
          <td align="center" style="padding:40px 32px 36px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <img src="https://www.ponglens.com/img/email-logo.png" width="180" height="44" alt="PongLens" style="display:block;width:180px;height:44px;border:0;margin:0 auto 28px;">
            <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;font-weight:700;color:#0f172a;">Your export is ready</h1>
            <p style="margin:0 0 28px;font-size:14px;line-height:1.6;color:#475569;">
              Your shareable match video has finished rendering. Open the
              match to save it or share it anywhere.
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
              <tr>
                <td align="center" style="background-color:#0891b2;border-radius:999px;">
                  <a href="{match_url}" style="display:inline-block;padding:13px 30px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;line-height:1;color:#ffffff;text-decoration:none;border-radius:999px;">Open your match</a>
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
            send_email(to, "Your match export is ready", body,
                       bcc=ADMIN_EMAIL)
        else:
            log.warning("  no email for user %s; notifying admin only",
                        user_id)
            send_email(ADMIN_EMAIL, "Your match export is ready", body)
    except Exception as e:
        log.warning("  reel email failed (non-fatal): %s", e)


def _cut_video_path(conn, match_id: str) -> str | None:
    """The match's cut video location, or None. matches.cut_path, falling
    back to the source job's result exactly like /api/media-url does."""
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
    return cut_path or (result_path if job_status == "done" else None)


def _cut_video_url(conn, match_id: str, expires_s: int = 3600) -> str | None:
    """A signed URL for the cut video that ffmpeg can range-seek.

    Returns None for a legacy Supabase-Storage path or a cut that retention
    has already taken; the caller then falls back to downloading, or to the
    preview clip.
    """
    path = _cut_video_path(conn, match_id)
    loc = parse_r2_path(path or "")
    if not loc:
        return None
    try:
        return r2().generate_presigned_url(
            "get_object",
            Params={"Bucket": loc[0], "Key": loc[1]},
            ExpiresIn=expires_s,
        )
    except Exception as e:                                      # noqa: BLE001
        log.warning("  could not sign the cut video (%s)", e)
        return None


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


def process_tag_reel(conn, job_id: str, user_id: str, tag_id: str) -> None:
    """Cross-match tag reel (042): render the tag_reels manifest — point
    preview clips across every match carrying the tag — with a single-title
    card and no scorebug (a cross-match score would be incoherent)."""
    with conn.cursor() as cur:
        cur.execute(
            "select t.owner_id, r.manifest from public.tag_reels r "
            "join public.tags t on t.id = r.tag_id where r.tag_id = %s",
            (tag_id,),
        )
        row = cur.fetchone()
    if not row:
        raise RuntimeError(f"tag reel: no tag_reels row for {tag_id}")
    owner_id, manifest = row
    if str(owner_id) != str(user_id):
        raise RuntimeError("tag reel: job user does not own the tag")
    if not isinstance(manifest, dict) or not manifest.get("points"):
        raise RuntimeError("tag reel: empty manifest")

    with conn.cursor() as cur:
        cur.execute(
            "update public.tag_reels set status = 'rendering', "
            "updated_at = now() where tag_id = %s",
            (tag_id,),
        )
    update_job(conn, job_id, progress=15)

    workdir = tempfile.mkdtemp(prefix=f"ponglens-tagreel-{str(job_id)[:8]}-")
    try:
        t0 = time.time()
        # cut_local stays None: the clips span many matches, so every
        # point renders from its own preview clip (seg bounds are null).
        out = render_reel(manifest, False, workdir, None)
        update_job(conn, job_id, progress=80)

        key = f"reels/tag-{tag_id}.mp4"
        r2_uri = f"r2://{R2_MEDIA_BUCKET}/{key}"
        size = os.path.getsize(out)
        duration = _video_duration_s(out)
        r2().upload_file(out, R2_MEDIA_BUCKET, key,
                         ExtraArgs={"ContentType": "video/mp4"})
        ledger_negate_keys(conn, [r2_uri])
        ledger_append(conn, str(owner_id), "reel", size, r2_uri)

        with conn.cursor() as cur:
            cur.execute(
                "update public.tag_reels set status = 'ready', "
                "r2_key = %s, duration_s = %s, size_bytes = %s, "
                "error = null, updated_at = now() where tag_id = %s",
                (key, round(duration, 2), size, tag_id),
            )
        log.info("  tag reel ready: %s (%.1fs video, %d KB, rendered "
                 "in %.0fs)",
                 r2_uri, duration, size // 1024, time.time() - t0)
    except Exception as e:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "update public.tag_reels set status = 'failed', "
                    "error = %s, updated_at = now() where tag_id = %s",
                    (str(e)[:500], tag_id),
                )
        except Exception:
            log.exception("  failed to mark tag reel failed")
        raise
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def process_reel(conn, job_id: str, user_id: str, payload: dict) -> None:
    options = get_job_options(conn, job_id, payload)
    match_id = options.get("match_id")
    if not match_id:
        # kind 'reel' with options.tag_id and no match: a cross-match tag
        # reel (042) — same queue, its own row/table/render path.
        tag_id = options.get("tag_id")
        if tag_id and re.fullmatch(
                r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}"
                r"-[0-9a-f]{12}", str(tag_id)):
            process_tag_reel(conn, job_id, user_id, str(tag_id))
            return
        raise RuntimeError("reel job missing options.match_id")
    # scope 'starred' (default, back-compat with pre-028 jobs already in the
    # queue), 'full' (whole match), or 'tag:<uuid>' (036: one export per
    # tagged-point collection). Selects the (match_id, scope) row and the
    # r2 key so exports never overwrite each other.
    # 135 adds the vertical scopes — 'v:point:<uuid>' (one rally, shared to
    # an Instagram Story) and 'v:starred'. They take the same queue, row and
    # manifest; only the canvas differs.
    scope = options.get("scope") or "starred"
    _UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
    if (scope not in ("starred", "full", "v:starred",
                      "v:hl:story", "v:hl:reel", "v:hl:long")
            and not re.fullmatch(rf"tag:{_UUID}", scope)
            and not re.fullmatch(rf"v:point:{_UUID}", scope)):
        raise RuntimeError(f"reel: invalid scope {scope!r}")
    vertical = scope.startswith("v:")

    with conn.cursor() as cur:
        cur.execute(
            "select m.user_id, r.show_score, r.manifest, m.story_crop "
            "from public.match_reels r "
            "join public.matches m on m.id = r.match_id "
            "where r.match_id = %s and r.scope = %s",
            (match_id, scope),
        )
        row = cur.fetchone()
    if not row:
        raise RuntimeError(f"reel: no match_reels row for {match_id}/{scope}")
    owner_id, show_score, manifest, story_crop = row
    # options.match_id is client-influenced: never render a match the job's
    # creator doesn't own.
    if str(owner_id) != str(user_id):
        raise RuntimeError("reel: job user does not own the match")
    if not isinstance(manifest, dict) or not manifest.get("points"):
        raise RuntimeError("reel: empty manifest")

    with conn.cursor() as cur:
        cur.execute(
            "update public.match_reels set status = 'rendering' "
            "where match_id = %s and scope = %s",
            (match_id, scope),
        )
    update_job(conn, job_id, progress=15)

    workdir = tempfile.mkdtemp(prefix=f"ponglens-reel-{str(job_id)[:8]}-")
    try:
        t0 = time.time()
        cut_local = None
        if any(isinstance(p, dict) and p.get("seg_start") is not None
               for p in manifest["points"]):
            # A share is rendered while its owner waits, and a vertical
            # render reads seconds out of the cut, not the whole thing —
            # so hand ffmpeg a signed URL and let it range-seek. A named
            # export still downloads, because it walks the entire video.
            cut_local = (_cut_video_url(conn, match_id) if vertical
                         else _fetch_cut_video(conn, match_id, workdir))
            if vertical and cut_local is None:
                cut_local = _fetch_cut_video(conn, match_id, workdir)
        if vertical:
            out = render_story(manifest, bool(show_score), workdir,
                               cut_local, story_crop)
        else:
            out = render_reel(manifest, bool(show_score), workdir, cut_local)
        update_job(conn, job_id, progress=80)

        # Distinct key per scope so exports coexist: starred keeps the
        # historical reels/<match_id>.mp4; full and tag scopes live
        # alongside it (tag:<uuid> -> -tag-<uuid>). Vertical share renders
        # get a v- prefix, which is also what the retention sweep matches
        # on — they are regenerable in seconds and must not accumulate.
        key = (f"reels/{match_id}.mp4" if scope == "starred"
               else f"reels/{match_id}-full.mp4" if scope == "full"
               else f"reels/v-{match_id}-{scope.replace(':', '-')}.mp4"
               if vertical
               else f"reels/{match_id}-{scope.replace(':', '-')}.mp4")
        r2_uri = f"r2://{R2_MEDIA_BUCKET}/{key}"
        size = os.path.getsize(out)
        duration = _video_duration_s(out)
        r2().upload_file(out, R2_MEDIA_BUCKET, key,
                         ExtraArgs={"ContentType": "video/mp4"})
        # one key per (match, scope), overwritten on re-render: zero the
        # previous balance before booking the new bytes
        ledger_negate_keys(conn, [r2_uri])
        ledger_append(conn, str(owner_id), "reel", size, r2_uri, match_id)

        with conn.cursor() as cur:
            cur.execute(
                "update public.match_reels set status = 'ready', "
                "r2_key = %s, duration_s = %s, size_bytes = %s, "
                "error = null where match_id = %s and scope = %s",
                (key, round(duration, 2), size, match_id, scope),
            )
        log.info("  reel ready: %s (scope=%s, %.1fs video, %d KB, rendered "
                 "in %.0fs)",
                 r2_uri, scope, duration, size // 1024, time.time() - t0)
        # No email for a share render. The player is holding the phone
        # waiting for it, and an "export is ready" message arriving after
        # they have already posted to Instagram is noise. The bell is
        # suppressed for the same reason, in match_reels_notify (135).
        if not vertical:
            notify_reel_done(conn, str(owner_id), match_id)
    except Exception as e:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "update public.match_reels set status = 'failed', "
                    "error = %s where match_id = %s and scope = %s",
                    (str(e)[:500], match_id, scope),
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
                   n: int = CONTENT_CHECK_FRAMES,
                   subdir: str = "content_check") -> list[str]:
    """Extract n frames evenly across the video (skipping the first/last 3%,
    which tend to be walking-to-camera / phone-pocket footage), downscaled
    to 512 px wide JPEGs. Frames that fail to extract are skipped.

    subdir keeps one caller's frames from overwriting another's: the
    broadcast gate samples the same video moments later and would otherwise
    write over the content gate's JPEGs at identical filenames."""
    duration = _video_duration_s(video)
    lo, hi = duration * 0.03, duration * 0.97
    outdir = os.path.join(workdir, subdir)
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
        response_id = str(data.get("id") or uuid.uuid4())
        COST_METER.record(COST_METER.openai_usage_events(
            data,
            model=CONTENT_CHECK_MODEL,
            operation="video_content_validation",
            idempotency_key=f"openai:{response_id}:content-check",
        ))
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


def _camera_cut_frames(video: str) -> tuple[int, int]:
    """(frames clearing BROADCAST_CUT_SCORE, frames examined) over windows
    spread across the video.

    Counts frames rather than taking the maximum score on purpose. The two
    hardest real videos in the corpus were a handheld phone (peak 0.28) and
    a tournament on a tripod (peak 0.32), which a max rule cannot separate
    from anything. By count they are 0 and 1 against a broadcast's 13.

    (0, 0) means nothing decoded. The caller reads that as no evidence,
    which is the fail-open direction: a video we could not measure is a
    video we do not reject.
    """
    duration = _video_duration_s(video)
    if not duration or duration <= 0:
        return 0, 0
    span, lo = duration * 0.90, duration * 0.05
    win = min(BROADCAST_WINDOW_S, max(span / BROADCAST_WINDOWS, 2.0))
    if span <= win * 1.2:                     # too short to spread windows
        starts, win = [lo], span
    else:
        starts = [lo + (span - win) * i / max(BROADCAST_WINDOWS - 1, 1)
                  for i in range(BROADCAST_WINDOWS)]
    over = examined = 0
    for start in starts:
        proc = subprocess.run(
            ["ffmpeg", "-nostdin", "-ss", f"{start:.2f}", "-t", f"{win:.2f}",
             "-i", video, "-an", "-sn", "-vf",
             f"scale={BROADCAST_SAMPLE_WIDTH}:-2,fps={BROADCAST_SAMPLE_FPS},"
             r"select='gte(scene\,0)',metadata=print:file=-",
             "-f", "null", "-"],
            capture_output=True, text=True, timeout=600,
        )
        scores = [float(x) for x in
                  re.findall(r"lavfi\.scene_score=([0-9.eE+-]+)", proc.stdout)]
        # The first frame after a seek always scores high against nothing.
        scores = scores[1:]
        examined += len(scores)
        over += sum(1 for s in scores if s >= BROADCAST_CUT_SCORE)
    return over, examined


def _broadcast_vision_votes(frames: list[str]) -> list[int]:
    """Per-trial counts of frames showing broadcast production markers."""
    content: list[dict] = [{
        "type": "text",
        "text": (
            f"You will see {len(frames)} frames sampled from one video of "
            "table tennis.\n\nFor EACH frame, in order, decide whether that "
            "frame shows evidence that the video was made by a television "
            "or streaming production company, rather than recorded on a "
            "single fixed camera by a player, a parent or a spectator.\n\n"
            "Answer \"yes\" for a frame ONLY if you can see at least one of "
            "these:\n"
            "  - a graphic electronically laid over the picture by a "
            "broadcaster: a score bug, a player-name lower third, a channel "
            "or streaming-service logo watermark, a replay or slow-motion "
            "badge, a serve-speed or match-statistics graphic;\n"
            "  - a camera shot that is not a plain wide view of one table: "
            "a close-up of a face, hands or torso, a shot of the crowd, a "
            "bench or coaching shot, a commentary desk or studio.\n\n"
            "Answer \"no\" for everything else. These are all found at "
            "ordinary clubs and amateur tournaments and are NOT evidence of "
            "a broadcast. Answer \"no\" even when several appear together:\n"
            "  - a manual flip scoreboard or a small electronic scoreboard "
            "standing on the floor or beside an umpire;\n"
            "  - an umpire, referee, officials, or a coach at the table;\n"
            "  - a television, monitor or display screen mounted on a wall "
            "or post in the venue, showing a table number, a booking, a "
            "timer, an advert or the venue's own logo;\n"
            "  - printed advertising, sponsor names, equipment-brand names "
            "or venue branding on the surround barriers, the table, the "
            "net, the floor, the walls or the ceiling;\n"
            "  - a neon sign or illuminated venue logo;\n"
            "  - spectators, seating, a large or well-lit hall, several "
            "tables side by side;\n"
            "  - players in matching club or national kit, or wearing "
            "numbered bibs;\n"
            "  - a tripod, phone or camera visible in the shot.\n\n"
            f"Reply with ONLY a JSON array of {len(frames)} strings, each "
            "\"yes\" or \"no\". No other text."
        ),
    }]
    for f in frames:
        with open(f, "rb") as fh:
            b64 = base64.b64encode(fh.read()).decode()
        content.append({"type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{b64}",
                                      "detail": "low"}})
    body: dict = {
        "model": CONTENT_CHECK_MODEL,
        "messages": [{"role": "user", "content": content}],
        "max_completion_tokens": 2000,
    }
    if CONTENT_CHECK_MODEL.startswith(("gpt-5", "o3", "o4")):
        body["reasoning_effort"] = "low"
    else:
        body["temperature"] = 0

    votes = []
    for _ in range(BROADCAST_VISION_TRIALS):
        r = requests.post(
            f"{OPENAI_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            json=body, timeout=BROADCAST_TIMEOUT_S,
        )
        r.raise_for_status()
        data = r.json()
        response_id = str(data.get("id") or uuid.uuid4())
        COST_METER.record(COST_METER.openai_usage_events(
            data,
            model=CONTENT_CHECK_MODEL,
            operation="video_broadcast_validation",
            idempotency_key=f"openai:{response_id}:broadcast-check",
        ))
        reply = data["choices"][0]["message"]["content"] or ""
        start, end = reply.find("["), reply.rfind("]")
        verdicts = json.loads(reply[start:end + 1])
        if not isinstance(verdicts, list) or len(verdicts) != len(frames):
            raise ValueError(f"expected {len(frames)} verdicts, got: "
                             f"{reply[:200]!r}")
        votes.append(sum(1 for v in verdicts
                         if str(v).strip().lower() == "yes"))
    return votes


def looks_like_broadcast(video: str, workdir: str) -> bool:
    """True = professionally produced match footage; refuse to process it.

    FAILS OPEN everywhere, like the content gate above. Every uncertain
    answer here is the difference between a player's own match being
    processed and being turned away, and turning one away is the worse
    outcome by a distance.
    """
    if SKIP_BROADCAST_CHECK:
        log.info("  broadcast check skipped (WORKER_SKIP_BROADCAST_CHECK)")
        return False
    try:
        cuts, examined = _camera_cut_frames(video)
        if examined == 0:
            log.warning("  broadcast check skipped: no frames decoded")
            return False
        if cuts < BROADCAST_CUT_FRAMES:
            log.info("  broadcast check: %d/%d frames cut (need %d) — "
                     "single camera, not a broadcast", cuts, examined,
                     BROADCAST_CUT_FRAMES)
            return False
        # Only now is the paid half worth running. An ordinary upload has
        # already returned above without spending anything.
        if not OPENAI_API_KEY:
            log.warning("  broadcast check: %d cuts but no OpenAI key — "
                        "proceeding without the second signal", cuts)
            return False
        frames = _sample_frames(video, workdir, subdir="broadcast_check")
        if len(frames) < CONTENT_CHECK_FRAMES // 2:
            log.warning("  broadcast check skipped: only %d frames",
                        len(frames))
            return False
        votes = _broadcast_vision_votes(frames)
        median = sorted(votes)[len(votes) // 2]
        verdict = median >= BROADCAST_MIN_VISION
        # Log the trials in the order they came back, not sorted: a
        # 12/0/0 reads as one bad roll, a sorted 0/0/12 reads as noise.
        log.info("  broadcast check: %d/%d frames cut, vision %s median %d "
                 "of %d (need %d) — %s", cuts, examined,
                 "/".join(str(v) for v in votes), median, len(frames),
                 BROADCAST_MIN_VISION,
                 "BROADCAST" if verdict else "not a broadcast")
        return verdict
    except Exception as e:
        # FAIL OPEN: never let a broken API or a slow decode reject a
        # player's own match.
        log.warning("  broadcast check unavailable (%s: %s) — proceeding "
                    "without it", type(e).__name__, e)
        return False


def reject_checked_match(conn, match_id: str, input_path: str | None):
    """A video the content gate turned down: keep the row, drop the file.

    This used to delete the match row outright. The uploader's card then
    vanished from the library mid-flight, and the only account of what
    happened was an email and a bell notice pointing at /upload — nothing
    at the place they were actually looking. It was also the one failure
    in the product that behaved this way: every other failed job leaves a
    failed match you can open and read the reason on.

    So the row stays, as an ordinary failure. The reason travels on the
    job, which is what the match page already reads (it selects the newest
    job whose options.match_id is this match), so no new column is needed
    to carry it.

    Only the bytes go. The raw object is removed now rather than at the
    30-day sweep, and its ledger rows are netted out by the same helper
    the import path uses — safe against the delete trigger doing it again
    later, which skips anything already summing to zero. raw_path goes
    null because a path that presigns to a 404 renders as a broken
    player, and "the file is gone" is the true thing to say.
    """
    delete_rejected_raw(conn, input_path)
    with conn.cursor() as cur:
        cur.execute(
            "update public.matches "
            "set status = 'failed', raw_path = null "
            "where id = %s",
            (match_id,),
        )
    log.info("  content check rejected match %s (row kept, raw removed)",
             match_id)


def delete_rejected_raw(conn, input_path: str | None):
    """Rejected upload: remove the raw object immediately (don't wait for
    the 30-day sweep) and net out its storage_ledger rows. Best-effort —
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
    attempt_key = f"{job_id}:{msg['read_ct']}"

    log.info("job %s (kind=%s, attempt %s)", job_id, kind, msg["read_ct"])

    # The ROW is the truth, not the queue message.
    #
    # A player can take back a processing claim while it is still queued
    # (cancel_queued_processing, migration 112 — the undo on the upload
    # card). That marks the row 'cancelled' and credits the minutes back,
    # but the pgmq message it was enqueued with knows nothing about it, so
    # without this the worker would pick the message up, write
    # status='processing' straight over 'cancelled', and spend real compute
    # doing work the player had already been refunded for. Which is exactly
    # what happened the first time the undo was exercised.
    #
    # One statement, so the race closes in both directions: either this
    # update wins and a concurrent cancel then finds 'processing' and
    # refuses, or the cancel wins and this matches nothing. A retry
    # (read_ct > 1) still matches, since only 'cancelled' is excluded.
    with conn.cursor() as cur:
        cur.execute(
            "update public.jobs set status = 'processing' "
            "where id = %s and status <> 'cancelled' returning id",
            (job_id,),
        )
        claimed = cur.fetchone()
    if claimed is None:
        log.info("  job %s was cancelled or removed before pickup — "
                 "archiving the message, doing nothing", job_id)
        archive_message(conn, msg["msg_id"])
        return

    if kind == "placement_generate":
        update_job(conn, job_id, status="processing", progress=5, error=None)
        try:
            with COST_METER.timed_stage(
                "placement_generate_compute",
                attempt_key,
            ):
                result = process_placement_generation(
                    conn,
                    job_id,
                    user_id,
                    payload,
                )
        except RuntimeError as e:
            if "lifecycle is not processing" in str(e):
                # A stale enqueue racing a reprocess that reset the match's
                # placement state. Retrying can never succeed, and every
                # retry flips the job processing->failed, which fires the
                # failure email — one such message emailed the owner every
                # 30 minutes for twelve hours (2026-08-12, msg 189).
                # Archive it and record the failure exactly once.
                log.info("  placement job %s: stale lifecycle — archived, "
                         "no retries", job_id)
                update_job(conn, job_id, status="failed",
                           error=str(e)[:500])
                archive_message(conn, msg["msg_id"])
                return
            raise
        update_job(conn, job_id, status="done", progress=100)
        archive_message(conn, msg["msg_id"])
        # No email either way — the match's Tools row already carries the
        # outcome. See the note above notify_job_done.
        log.info(
            "  placement generation done: match=%s status=%s mapped=%d",
            result.match_id,
            result.terminal_status,
            result.mapped_points,
        )
        return

    if kind == "placement_retry":
        update_job(conn, job_id, status="processing", progress=5, error=None)
        with COST_METER.timed_stage("placement_retry_compute", attempt_key):
            result = process_placement_retry(conn, job_id, user_id, payload)
        update_job(conn, job_id, status="done", progress=100)
        archive_message(conn, msg["msg_id"])
        log.info(
            "  placement retry done: match=%s succeeded=%s mapped=%d",
            result.match_id,
            result.succeeded,
            result.mapped_points,
        )
        return

    if kind == "reclip":
        # lightweight path: no blurball pipeline, just ffmpeg re-cuts
        update_job(conn, job_id, status="processing", progress=5, error=None)
        with COST_METER.timed_stage("point_reclip_encoding", attempt_key):
            process_reclip(conn, job_id, user_id, payload)
        update_job(conn, job_id, status="done", progress=100)
        archive_message(conn, msg["msg_id"])
        log.info("  reclip done: job %s", job_id)
        return

    if kind == "reel":
        # render the starred-points highlight reel (no blurball pipeline)
        update_job(conn, job_id, status="processing", progress=5, error=None)
        with COST_METER.timed_stage("reel_encoding", attempt_key):
            process_reel(conn, job_id, user_id, payload)
        update_job(conn, job_id, status="done", progress=100)
        archive_message(conn, msg["msg_id"])
        log.info("  reel done: job %s", job_id)
        return

    if kind == "content_check":
        # 097: the content gate at upload time. Download, sample the same
        # 12 frames, ask the same model. A confident non-table-tennis
        # verdict removes the raw and the library row (the delete trigger
        # returns the bytes) and fails the job with the user-facing
        # message — bell and email ride the existing failure machinery.
        # Everything else fails open; the processing-time gate remains
        # the backstop.
        update_job(conn, job_id, status="processing", progress=10, error=None)
        options = get_job_options(conn, job_id, payload)
        check_match_id = options.get("match_id")
        r2_input = parse_r2_path(input_path or "")
        if not check_match_id or not r2_input:
            raise RuntimeError("content check job missing match or source")
        with conn.cursor() as cur:
            cur.execute("select user_id from public.matches where id = %s",
                        (check_match_id,))
            check_row = cur.fetchone()
            row_alive = check_row is not None
        if not row_alive:
            # Deleted before the check ran; nothing left to judge.
            update_job(conn, job_id, status="done", progress=100)
            archive_message(conn, msg["msg_id"])
            return
        workdir = tempfile.mkdtemp(prefix=f"ponglens-check-{job_id[:8]}-")
        try:
            ext = os.path.splitext(input_path)[1] or ".mp4"
            local_input = os.path.join(workdir, f"input{ext}")
            r2().download_file(r2_input[0], r2_input[1], local_input)
            update_job(conn, job_id, progress=50)
            if not looks_like_table_tennis(local_input, workdir):
                reject_checked_match(conn, check_match_id, input_path)
                raise UserFacingError(CONTENT_CHECK_REJECT_MSG)
            if looks_like_broadcast(local_input, workdir):
                reject_checked_match(conn, check_match_id, input_path)
                raise UserFacingError(BROADCAST_REJECT_MSG)
            with conn.cursor() as cur:
                cur.execute(
                    "update public.matches set content_checked_at = now() "
                    "where id = %s", (check_match_id,))
            # A poster for the library while the match is still raw. The
            # video is already on disk, so this is one frame and a WebP
            # encode on the way out the door — the difference between a
            # library of grey "Not processed" rectangles and one where an
            # unprocessed match looks like the match it is. Keyed by this
            # job so the URL is fresh (the fixed-name thumb burned us
            # once); processing later replaces thumb_path with its own,
            # per-job-keyed picture, so nothing here goes stale.
            # Best-effort by construction: a match without a thumb is a
            # plain card, not a failure.
            try:
                raw_dur = probe_duration_s(local_input)
                seek = min(60.0, raw_dur * 0.25) if raw_dur else 30.0
                thumb_local = os.path.join(workdir, "raw_thumb.webp")
                if check_row and extract_thumb(local_input, thumb_local, seek):
                    owner = str(check_row[0])
                    prefix = f"points/{owner}/{check_match_id}"
                    key = f"{prefix}/thumb-{job_id}.webp"
                    r2().upload_file(
                        thumb_local, R2_MEDIA_BUCKET, key,
                        ExtraArgs={"ContentType": "image/webp"})
                    with conn.cursor() as cur:
                        # Never over an existing picture: a reprocess can
                        # re-run the check, and the processed thumb (a
                        # rally, not the walk-in) is the better one.
                        cur.execute(
                            "update public.matches set thumb_path = %s "
                            "where id = %s and thumb_path is null",
                            (f"r2://{R2_MEDIA_BUCKET}/{key}",
                             check_match_id))
                    ledger_append(conn, str(check_row[0]), "other",
                                  os.path.getsize(thumb_local),
                                  f"r2://{R2_MEDIA_BUCKET}/{prefix}/",
                                  check_match_id)
            except Exception:
                log.warning("  content check: thumb extraction failed "
                            "for %s", check_match_id, exc_info=True)
            update_job(conn, job_id, status="done", progress=100)
            archive_message(conn, msg["msg_id"])
            log.info("  content check passed: match %s", check_match_id)
            return
        finally:
            shutil.rmtree(workdir, ignore_errors=True)

    if kind not in ("deadspace_cut", "youtube_import"):
        raise RuntimeError(f"unknown job kind: {kind}")

    options = get_job_options(conn, job_id, payload)
    strictness = options.get("strictness", "normal")
    if strictness not in VALID_STRICTNESS:
        strictness = "normal"

    update_job(conn, job_id, status="processing", progress=5, error=None)

    # A library job with nothing left to process (the row deleted, or the
    # content check having taken its raw away) — fail fast so the spend
    # refunds instead of grinding through a pipeline nobody can see.
    if options.get("match_id") is not None:
        check_match_row_alive(conn, options["match_id"])

    workdir = tempfile.mkdtemp(prefix=f"ponglens-{job_id[:8]}-")
    try:
        # Capture date for the match's played_at: yt-dlp upload_date for
        # imports, the file's creation_time tag for uploads, else now().
        played_at: str | None = None
        if kind == "youtube_import":
            # yt-dlp fetch -> R2 raw bucket; from here on the job is
            # indistinguishable from a direct upload.
            local_input, input_path, yt_title, played_at = fetch_youtube(
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
            # Commerce (096): an import is a library download, nothing
            # more. The row lands as 'uploaded'; processing is a separate
            # paid claim from the video's own page, where the content gate
            # also runs.
            if options.get("library_only"):
                # The gate runs here too (097): the file is already local,
                # so the check is close to free, and a rejected import is
                # never stored. No match row exists yet, so the legacy
                # helper's delete-and-negate is exactly right.
                if not looks_like_table_tennis(local_input, workdir):
                    delete_rejected_raw(conn, input_path)
                    raise UserFacingError(CONTENT_CHECK_REJECT_MSG)
                # An import is where broadcast footage almost always
                # arrives, and no match row exists yet, so nothing is
                # stored and nothing is billed.
                if looks_like_broadcast(local_input, workdir):
                    delete_rejected_raw(conn, input_path)
                    raise UserFacingError(BROADCAST_REJECT_MSG)
                # Read the form's answers fresh: the import screen keeps
                # saving through the download and the content check, so a
                # name typed a moment ago must still land.
                fresh_meta = get_job_options(conn, job_id, {}).get("meta")
                import_match_id = create_uploaded_match(
                    conn, user_id, job_id, input_path,
                    probe_duration_s(local_input),
                    yt_title, played_at,
                    fresh_meta if isinstance(fresh_meta, dict)
                    else options.get("meta"))
                # "Process right away" asked for at import time (098).
                if options.get("auto_process") and import_match_id:
                    claim_processing_for(
                        conn, user_id, import_match_id,
                        bool(options.get("placement")), strictness)
                update_job(conn, job_id, status="done",
                           result_path=input_path, progress=100)
                archive_message(conn, msg["msg_id"])
                log.info("  library import done: %s", input_path)
                return
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
            # Real capture date from the video's own metadata, when present.
            played_at = capture_date_from_file(local_input)
            if played_at:
                log.info("  capture date from creation_time: %s", played_at)

        # Library job (096): cut the working copy down to the claimed
        # window before anything expensive sees it. Skipped when the
        # window is effectively the whole file.
        if options.get("match_id") is not None:
            t0 = float(options.get("trim_start_s") or 0.0)
            t1 = options.get("trim_end_s")
            if t1 is not None:
                real = probe_duration_s(local_input)
                if t0 > 0.5 or (real is not None and float(t1) < real - 0.5):
                    local_input = apply_trim(local_input, workdir,
                                             t0, float(t1))

        # Upfront content gate: cheap vision check before the expensive
        # pipeline. Confident negative -> delete the raw, fail the job with
        # a user-facing message, archive the queue message (no retries).
        # Skip the gate when the upload-time check (097) already cleared
        # this video; it stays as the backstop for anything unchecked.
        already_checked = False
        if options.get("match_id") is not None:
            with conn.cursor() as cur:
                cur.execute(
                    "select content_checked_at from public.matches "
                    "where id = %s", (options["match_id"],))
                row = cur.fetchone()
            already_checked = bool(row and row[0])
        if not already_checked and not looks_like_table_tennis(
                local_input, workdir):
            # Library raws (096) are the user's stored content, paid for in
            # storage — refuse to process, never delete. The legacy path
            # keeps deleting: there the raw exists only to be processed.
            if options.get("match_id") is None:
                delete_rejected_raw(conn, input_path)
            raise UserFacingError(CONTENT_CHECK_REJECT_MSG)
        if not already_checked and looks_like_broadcast(local_input, workdir):
            if options.get("match_id") is None:
                delete_rejected_raw(conn, input_path)
            raise UserFacingError(BROADCAST_REJECT_MSG)
        update_job(conn, job_id, progress=15)

        if options.get("points"):
            # Dead-space round 4: points BEFORE the cut, so the cut keeps
            # the per-point segments instead of whole activity spans (the
            # span cut measured 82-99% of the source — the ball moving
            # between rallies chained every span together). If the points
            # stage crashes here, fall back to the legacy span cut so the
            # match still ships with video; run_points_stage retries in
            # spans mode and owns the failure path.
            # 15 -> 45 is minutes of inference on a long video, and it
            # used to be two stamps with silence between them. Written
            # only when the whole number changes, so a 45k-frame video
            # costs thirty small updates rather than one per log line.
            last_pct = [15]

            def blurball_progress(fraction: float) -> None:
                pct = 15 + int(fraction * 30)
                if pct > last_pct[0]:
                    last_pct[0] = pct
                    update_job(conn, job_id, progress=pct)

            blurball_out = run_blurball(local_input, workdir,
                                        attempt_key=attempt_key,
                                        on_progress=blurball_progress)
            update_job(conn, job_id, progress=45)
            segments_json = None
            try:
                serve_pad, serve_merge = serve_motif_settings(conn)
                outdir = run_points_subprocess(
                    local_input, blurball_out, workdir, options,
                    pipeline=points_pipeline_version(conn),
                    endon_fallback=endon_fallback_enabled(conn),
                    serve_surface_pad=serve_pad,
                    serve_merge_s=serve_merge,
                    placement_serve_seed=placement_serve_seed_enabled(conn),
                    attempt_key=attempt_key)
                mj = os.path.join(outdir, "match.json")
                with open(mj) as fh:
                    if json.load(fh).get("cut_segments"):
                        segments_json = mj
            except Exception as e:
                log.warning("  early points stage failed (%s) — "
                            "falling back to the span cut", e)
                shutil.rmtree(os.path.join(workdir, "points_out"),
                              ignore_errors=True)
            result = run_cut(local_input, workdir, blurball_out,
                             strictness, segments_json=segments_json,
                             attempt_key=attempt_key)
        else:
            # Same reporting as the points path, over a wider band: this
            # branch has nothing between inference and the finished cut.
            last_pct = [15]

            def pipeline_progress(fraction: float) -> None:
                pct = 15 + int(fraction * 60)
                if pct > last_pct[0]:
                    last_pct[0] = pct
                    update_job(conn, job_id, progress=pct)

            result, blurball_out = run_pipeline(
                local_input,
                workdir,
                strictness,
                attempt_key=attempt_key,
                on_progress=pipeline_progress,
            )
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
        points_match_id = None
        if options.get("points"):
            update_job(conn, job_id, progress=70)
            points_match_id = run_points_stage(
                conn, job_id, user_id, local_input,
                blurball_out, workdir, options, result_path,
                played_at=played_at,
                attempt_key=attempt_key)

        update_job(conn, job_id, status="done", result_path=result_path,
                   progress=100)
        archive_message(conn, msg["msg_id"])
        log.info("  done: %s", result_path)
        notify_job_done(conn, job_id, user_id)

        # Post-ready enrichment: side-change (game-end) detection. Runs
        # after the owner is told the match is ready so its ~4 CPU
        # minutes never delay a result; the workdir with the clips is
        # still alive until the finally below.
        if points_match_id:
            run_side_change_stage(
                conn, points_match_id, workdir,
                os.path.join(workdir, "points_out"))
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


def expire_placement_retries(conn):
    """Normalize retry buttons before their retained raw source is swept."""
    with conn.cursor() as cur:
        cur.execute(
            "update public.matches "
            "set placement_status = 'final_failed', "
            "placement_failure_code = 'source_expired' "
            "where placement_status = 'retry_available' "
            "and placement_retry_expires_at <= now()"
        )
        expired = cur.rowcount
    if expired:
        log.info("cleanup: expired %d placement retry window(s)", expired)


def r2_raw_sweep(conn, older_than_days: int):
    """Delete raw objects only after their source job's retention deadline.

    An R2 object's LastModified is not the source-upload time: a direct
    upload may land before its job row is inserted, while a YouTube import can
    land after its job exists. Linked objects use the earliest source job.
    Unlinked objects use their upload-ledger timestamp when present, with
    LastModified as the conservative fallback for true orphans.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=older_than_days)
    client = r2()
    deleted = 0
    unresolved = 0
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=R2_RAW_BUCKET, Prefix=""):
        objects = page.get("Contents", [])
        paths = [
            f"r2://{R2_RAW_BUCKET}/{obj['Key']}"
            for obj in objects
        ]
        if not paths:
            continue
        with conn.cursor() as cur:
            cur.execute(
                "select input_path, min(created_at) from public.jobs "
                "where input_path = any(%s) group by input_path",
                (paths,),
            )
            source_created_at = dict(cur.fetchall())
            cur.execute(
                "select r2_key, min(created_at) from public.storage_ledger "
                "where r2_key = any(%s) and kind = 'other' and bytes > 0 "
                "group by r2_key",
                (paths,),
            )
            upload_created_at = dict(cur.fetchall())
            # Commerce (096): a raw referenced by a live library row is the
            # user's stored video — it never ages out. A deleted match
            # leaves no row, so its raw expires here on the normal clock.
            cur.execute(
                "select raw_path from public.matches "
                "where raw_path = any(%s)",
                (paths,),
            )
            library_paths = {row[0] for row in cur.fetchall()}
        expired = []
        for obj, path in zip(objects, paths):
            if path in library_paths:
                continue
            created_at = source_created_at.get(path)
            if created_at is None:
                created_at = upload_created_at.get(
                    path, obj.get("LastModified")
                )
            if created_at is None:
                unresolved += 1
            elif created_at <= cutoff:
                expired.append({"Key": obj["Key"]})
        for i in range(0, len(expired), 1000):
            chunk = expired[i : i + 1000]
            client.delete_objects(
                Bucket=R2_RAW_BUCKET, Delete={"Objects": chunk})
            ledger_negate_keys(
                conn, [f"r2://{R2_RAW_BUCKET}/{obj['Key']}" for obj in chunk])
        deleted += len(expired)
    log.info(
        "cleanup: r2://%s/* — deleted %d retention-expired object(s); kept %d "
        "without a usable timestamp",
        R2_RAW_BUCKET,
        deleted,
        unresolved,
    )


def r2_sweep_prefix(conn, bucket: str, prefix: str, older_than_days: int,
                    protect_keys: set[str] | None = None):
    """Delete objects under bucket/prefix whose LastModified is too old,
    then book the freed bytes as negative storage_ledger rows (by key).
    protect_keys (full r2:// URIs) are never deleted regardless of age."""
    if bucket == R2_RAW_BUCKET and not prefix:
        return r2_raw_sweep(conn, older_than_days)
    cutoff = datetime.now(timezone.utc) - timedelta(days=older_than_days)
    protect = protect_keys or set()
    client = r2()
    deleted = 0
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        expired = [
            {"Key": obj["Key"]}
            for obj in page.get("Contents", [])
            if obj["LastModified"] < cutoff
            and f"r2://{bucket}/{obj['Key']}" not in protect
        ]
        for i in range(0, len(expired), 1000):
            chunk = expired[i : i + 1000]
            client.delete_objects(Bucket=bucket, Delete={"Objects": chunk})
            ledger_negate_keys(
                conn, [f"r2://{bucket}/{o['Key']}" for o in chunk])
        deleted += len(expired)
    log.info("cleanup: r2://%s/%s — deleted %d object(s) older than %dd",
             bucket, prefix or "*", deleted, older_than_days)


def sketch_sweep(conn):
    """Delete sketch/ frame images no note references — drawn, uploaded,
    but the note was never saved. Referenced sketches keep for the
    account's life (they are part of a note); a 2-day grace period covers
    a drawing whose note is still being written. Freed bytes are booked as
    negative ledger rows, same as the timed tiers."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=2)
    cur = conn.cursor()
    cur.execute(
        "select image_path from notes where image_path is not null")
    referenced = {row[0] for row in cur.fetchall()}
    client = r2()
    deleted = 0
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=R2_MEDIA_BUCKET, Prefix="sketch/"):
        orphans = [
            {"Key": obj["Key"]}
            for obj in page.get("Contents", [])
            if obj["LastModified"] < cutoff
            and f"r2://{R2_MEDIA_BUCKET}/{obj['Key']}" not in referenced
        ]
        for i in range(0, len(orphans), 1000):
            chunk = orphans[i : i + 1000]
            client.delete_objects(
                Bucket=R2_MEDIA_BUCKET, Delete={"Objects": chunk})
            ledger_negate_keys(
                conn, [f"r2://{R2_MEDIA_BUCKET}/{o['Key']}" for o in chunk])
        deleted += len(orphans)
    log.info("cleanup: r2://%s/sketch/ — deleted %d orphan(s)",
             R2_MEDIA_BUCKET, deleted)


def unreferenced_entry_objects(objects, referenced, cutoff):
    """Select old staged Journal images that no saved entry references."""
    return [
        {"Key": obj["Key"]}
        for obj in objects
        if obj["LastModified"] < cutoff
        and f"r2://{R2_MEDIA_BUCKET}/{obj['Key']}" not in referenced
    ]


def entry_image_sweep(conn):
    """Delete abandoned Journal images after the composition grace period."""
    cutoff = datetime.now(timezone.utc) - timedelta(
        days=ENTRY_ORPHAN_GRACE_DAYS
    )
    cur = conn.cursor()
    cur.execute(
        "select image_path from lessons where image_path is not null")
    referenced = {row[0] for row in cur.fetchall()}
    client = r2()
    deleted = 0
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(
            Bucket=R2_MEDIA_BUCKET, Prefix="entry/"):
        orphans = unreferenced_entry_objects(
            page.get("Contents", []), referenced, cutoff)
        for i in range(0, len(orphans), 1000):
            chunk = orphans[i : i + 1000]
            client.delete_objects(
                Bucket=R2_MEDIA_BUCKET, Delete={"Objects": chunk})
            ledger_negate_keys(
                conn, [f"r2://{R2_MEDIA_BUCKET}/{o['Key']}" for o in chunk])
        deleted += len(orphans)
    log.info("cleanup: r2://%s/entry/ — deleted %d orphan(s)",
             R2_MEDIA_BUCKET, deleted)


def _live_cut_paths(conn) -> set[str]:
    """Cut videos referenced by a live match, in commerce mode (096): the
    cut counts toward the owner's storage, so it persists with the match.
    Pre-flip this returns empty and the 30-day results sweep is unchanged.
    Cuts of DELETED matches have no row and expire on the normal clock."""
    if not commerce_enabled(conn):
        return set()
    with conn.cursor() as cur:
        cur.execute(
            "select cut_path from public.matches "
            "where cut_path like %s",
            (f"r2://{R2_MEDIA_BUCKET}/results/%",),
        )
        return {row[0] for row in cur.fetchall()}


SHARE_RENDER_RETENTION_DAYS = 7


def share_render_sweep(conn):
    """Drop vertical share renders older than a week (135).

    A rally shared to Instagram lives on Instagram. The mp4 we handed over
    is a courier, not an artifact: it is regenerable in seconds from the
    cut video and the stored manifest, and a player who shares twenty
    rallies would otherwise leave twenty files and twenty rows behind
    forever. Named exports (starred, full, tag) are untouched — those are
    things people come back to download.

    Row and object are removed together, and the ledger is zeroed so the
    bytes leave the player's storage allowance with them.
    """
    with conn.cursor() as cur:
        # 'v:%%', not 'v:%'. This statement carries a parameter, so psycopg2
        # scans it for placeholders and reads a lone % as the start of one —
        # which raised "tuple index out of range" on every sweep. It fails
        # open, so the only symptom was a warning nobody would read and
        # share renders quietly accumulating forever.
        cur.execute(
            "select match_id, scope, r2_key from public.match_reels "
            "where scope like 'v:%%' and r2_key is not null "
            "  and updated_at < now() - make_interval(days => %s)",
            (SHARE_RENDER_RETENTION_DAYS,),
        )
        rows = cur.fetchall()
    if not rows:
        return
    keys = [r[2] for r in rows]
    try:
        r2().delete_objects(
            Bucket=R2_MEDIA_BUCKET,
            Delete={"Objects": [{"Key": k} for k in keys], "Quiet": True},
        )
    except Exception as e:
        log.warning("  share-render sweep: delete failed (%s) — rows kept "
                    "so the next pass retries", e)
        return
    ledger_negate_keys(conn, [f"r2://{R2_MEDIA_BUCKET}/{k}" for k in keys])
    with conn.cursor() as cur:
        for match_id, scope, _ in rows:
            cur.execute(
                "delete from public.match_reels "
                "where match_id = %s and scope = %s", (match_id, scope))
    log.info("  share-render sweep: removed %d render(s) older than %d days",
             len(rows), SHARE_RENDER_RETENTION_DAYS)


def retention_sweep(conn):
    """Run all retention tiers. Each tier is independent and best-effort.

    Current tiers (SPEC.md §7):
      raw uploads (ponglens-raw)              30 days
      cut videos  (ponglens-media results/)   30 days
      voice audio (ponglens-media voice/)     90 days
      orphaned sketches (sketch/, unreferenced by notes)  2 days
      orphaned Journal images (entry/, unreferenced by lessons)  2 days
    Remaining tier, kept while the account is active (no sweep):
      point clips + match.json (points/), transcripts (Postgres),
      note-referenced sketches (sketch/), entry-referenced images (entry/)
    """
    for name, fn in (
        ("placement-retry-expiry", lambda: expire_placement_retries(conn)),
        ("legacy-supabase-uploads", lambda: cleanup_legacy_uploads(conn)),
        ("r2-raw", lambda: r2_sweep_prefix(
            conn, R2_RAW_BUCKET, "", R2_RAW_RETENTION_DAYS)),
        ("r2-results", lambda: r2_sweep_prefix(
            conn, R2_MEDIA_BUCKET, "results/", R2_RESULTS_RETENTION_DAYS,
            protect_keys=_live_cut_paths(conn))),
        ("r2-voice", lambda: r2_sweep_prefix(
            conn, R2_MEDIA_BUCKET, "voice/", R2_VOICE_RETENTION_DAYS)),
        ("r2-sketch-orphans", lambda: sketch_sweep(conn)),
        ("r2-entry-orphans", lambda: entry_image_sweep(conn)),
        ("r2-share-renders", lambda: share_render_sweep(conn)),
        ("cost-reconciliation", lambda: reconcile_platform_costs(conn)),
    ):
        try:
            fn()
        except Exception as e:  # a failing tier must not block the others
            log.warning("cleanup tier %s failed: %s", name, e)


def _cost_reconciliation_config() -> dict:
    """Load optional read-only provider credentials without requiring them."""
    values = {
        "openai_admin_key": (
            os.environ.get("PONGLENS_OPENAI_ADMIN_KEY")
            or keychain("ponglens-openai-admin-key")
        ),
        "deepgram_usage_key": (
            os.environ.get("PONGLENS_DEEPGRAM_USAGE_KEY")
            or keychain("ponglens-deepgram-usage-key")
        ),
        "deepgram_project_id": (
            os.environ.get("PONGLENS_DEEPGRAM_PROJECT_ID")
            or keychain("ponglens-deepgram-project-id")
        ),
        "cloudflare_analytics_token": (
            os.environ.get("PONGLENS_CLOUDFLARE_ANALYTICS_TOKEN")
            or keychain("ponglens-cloudflare-analytics-token")
        ),
        "cloudflare_account_id": R2_ACCOUNT_ID,
        "vercel_access_token": (
            os.environ.get("PONGLENS_VERCEL_ACCESS_TOKEN")
            or keychain("ponglens-vercel-access-token")
        ),
        "vercel_team_id": (
            os.environ.get("PONGLENS_VERCEL_TEAM_ID")
            or keychain("ponglens-vercel-team-id")
        ),
        "supabase_management_token": (
            os.environ.get("PONGLENS_SUPABASE_MANAGEMENT_TOKEN")
            or keychain("ponglens-supabase-management-token")
        ),
        "supabase_project_ref": (
            os.environ.get("PONGLENS_SUPABASE_PROJECT_REF")
            or keychain("ponglens-supabase-project-ref")
        ),
    }
    return {name: value for name, value in values.items() if value}


def reconcile_platform_costs(conn):
    """Capture daily R2 storage and optional provider-reported aggregates."""
    record_r2_storage_snapshot(
        COST_METER,
        r2(),
        (R2_RAW_BUCKET, R2_MEDIA_BUCKET),
    )
    statuses = run_daily_reconciliation(
        conn,
        config=_cost_reconciliation_config(),
    )
    if statuses:
        log.info(
            "cost reconciliation: %s",
            ", ".join(
                f"{provider}={status}"
                for provider, status in sorted(statuses.items())
            ),
        )


_cost_alert_missing_key_logged = False


def maybe_send_cost_alerts():
    """Run one isolated threshold check; never affect video processing."""
    global _cost_alert_missing_key_logged
    if not RESEND_API_KEY:
        if not _cost_alert_missing_key_logged:
            log.warning("cost alerts disabled: no Resend key")
            _cost_alert_missing_key_logged = True
        return

    connection = None
    try:
        connection = psycopg2.connect(DATABASE_URL)
        connection.autocommit = True
        alert_meter = CostMeter(connection, logger=log)

        def send_threshold_email(
            to: str,
            subject: str,
            body: str,
            *,
            idempotency_key: str,
        ):
            return send_email(
                to,
                subject,
                body,
                idempotency_key=idempotency_key,
                cost_meter=alert_meter,
            )

        delivered = deliver_cost_alerts(
            PostgresCostAlertStore(connection),
            send_threshold_email,
            ADMIN_EMAIL,
            "https://www.ponglens.com/admin",
            log,
        )
        if delivered:
            log.info("cost alerts sent: %d", delivered)
    except Exception as error:
        log.warning(
            "cost alert check failed (non-fatal): %s",
            type(error).__name__,
        )
    finally:
        if connection is not None:
            connection.close()


def _cost_alert_monitor():
    while True:
        maybe_send_cost_alerts()
        time.sleep(COST_ALERT_CHECK_EVERY_S)


def start_cost_alert_monitor():
    monitor = threading.Thread(
        target=_cost_alert_monitor,
        name="ponglens-cost-alerts",
        daemon=True,
    )
    monitor.start()
    return monitor


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


def _ytdlp_version() -> str:
    """Which yt-dlp this run will actually use. Printed at startup beside
    the commit, because the six weeks of dead imports were invisible: the
    job rows said 403, the logs said 403, and nothing anywhere said the
    downloader was from July. A version in the banner turns "imports are
    failing" into one glance."""
    try:
        out = subprocess.run([YTDLP, "--version"], capture_output=True,
                             text=True, timeout=30)
        return out.stdout.strip() or "unknown"
    except Exception:
        return "missing"


def main():
    log.info("PongLens worker starting (supabase=%s, code=%s, "
             "yt-dlp=%s at %s)",
             SUPABASE_URL, _code_version(), _ytdlp_version(), YTDLP)
    conn = connect()
    start_cost_alert_monitor()
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
                maybe_send_feedback_digest(conn)     # never raises
                maybe_send_qa_closed_digest(conn)    # never raises
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
                kind = payload.get("kind", "deadspace_cut")
                # UserFacingError means the message is safe verbatim; the
                # column is what the notify trigger and the uploader's email
                # read, and it stays NULL for a crash so nothing internal
                # can reach them. Written in the same statement as the
                # status so the trigger sees both at once.
                user_message = (
                    str(e)[:300] if isinstance(e, UserFacingError) else None
                )
                try:
                    if job_id:
                        update_job(conn, job_id, status="failed",
                                   error=str(e)[:500],
                                   user_message=user_message)
                    # Library job (096): a terminal failure gives the
                    # minutes back and flips the row to failed so its page
                    # offers Process again. Retryable crashes keep the
                    # spend until the message poisons out.
                    if job_id and kind == "deadspace_cut" and (
                        isinstance(e, UserFacingError)
                        or msg["read_ct"] >= MAX_READ_CT
                    ):
                        lib_options = get_job_options(conn, job_id, payload)
                        lib_match = lib_options.get("match_id")
                        if lib_match:
                            refund_processing_spend_direct(conn, job_id)
                            mark_library_match_failed(conn, str(lib_match))
                    if isinstance(e, UserFacingError):
                        # Deterministic failure (private video, too long…):
                        # retrying can't succeed, archive right away.
                        pass
                    elif msg["read_ct"] >= MAX_READ_CT:
                        log.warning("archiving poison message %s "
                                    "(read_ct=%s)", msg["msg_id"], msg["read_ct"])
                        if kind in {
                            "placement_generate",
                            "placement_retry",
                        } and job_id:
                            options = get_job_options(conn, job_id, payload)
                            match_id = require_match_id(options)
                            attempt = (
                                NORMAL_PLACEMENT_ATTEMPT
                                if kind == "placement_generate"
                                else STRONGER_PLACEMENT_ATTEMPT
                            )
                            # Records the terminal status on the match so the
                            # Tools row stops spinning. The uploader is not
                            # emailed (see notify_job_done); the admin still
                            # gets notify_job_failed below, which is now the
                            # only signal that a placement job died.
                            finalize_poisoned_placement_attempt(
                                conn,
                                job_id,
                                payload.get("user_id"),
                                match_id,
                                attempt,
                            )
                except Exception:
                    log.exception("failed to record job failure")

                # OUTSIDE the bookkeeping, deliberately. This used to be the
                # last statement inside it, so any book-keeping that threw —
                # and finalize_poisoned_placement_attempt threw on a match
                # whose authorized job had moved on — skipped the archive and
                # left the message in the queue. It then came back every 30
                # minutes forever, with a failure email each time. Two of them
                # ran for 14 hours at read_ct 4 and 5, well past the cap that
                # was supposed to stop them.
                #
                # Giving up is not a favour the bookkeeping earns. Whether the
                # message dies is decided by the error and the attempt count,
                # nothing else.
                if isinstance(e, UserFacingError) or \
                        msg["read_ct"] >= MAX_READ_CT:
                    try:
                        archive_message(conn, msg["msg_id"])
                    except Exception:
                        log.exception("could not archive poison message %s",
                                      msg["msg_id"])

                send_failure_emails(conn, e, job_id, kind,
                                    payload.get("user_id"), user_message)

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
        # honoring the two last_sent keys, then exit.
        _digest_conn = connect()
        maybe_send_feedback_digest(_digest_conn)
        maybe_send_qa_closed_digest(_digest_conn)
    elif "--render-test" in sys.argv:
        _render_test(sys.argv)
    else:
        main()

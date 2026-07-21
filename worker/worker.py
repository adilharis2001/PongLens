#!/usr/bin/env python3
"""PongLens pull-worker — runs on the Mac Studio.

Loop:
  1. pgmq.read('jobs') over a direct Postgres connection (30 min visibility)
  2. mark job processing
  3. download the upload from Supabase Storage (service role)
  4. run the TTVid pipeline: blurball inference -> cut_deadspace
  5. upload the trimmed video to results/<user_id>/<job_id>.mp4
  6. mark done + archive the queue message

On failure: mark failed with the error; archive the message once it has been
attempted 3 times (poison-message guard), otherwise leave it to reappear
after the visibility timeout.

Also runs a daily cleanup pass deleting original uploads older than 30 days
(the Privacy Policy promises this).

Dependencies:  pip3 install psycopg2-binary requests
Secrets:       macOS Keychain (see worker/README.md) or env vars.
"""

import html
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone

import psycopg2
import psycopg2.extras
import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
TTVID = "/Users/adil/Desktop/Projects/TTVid"
VENV_PY = f"{TTVID}/vendor/venv/bin/python"
BLURBALL_INFER = f"{TTVID}/vendor/blurball_infer.py"
CUT_DEADSPACE = f"{TTVID}/pipeline/cut_deadspace.py"

POLL_SLEEP_S = 15          # idle sleep between empty queue reads
VISIBILITY_S = 1800        # pgmq visibility timeout (30 min per attempt)
MAX_READ_CT = 3            # archive (give up) after this many attempts
CLEANUP_EVERY_S = 24 * 3600
UPLOAD_RETENTION_DAYS = 30

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

# Email notifications (Resend, send-only key). Optional: if the key is
# missing we log and carry on — email must never affect job processing.
RESEND_API_KEY = os.environ.get("PONGLENS_RESEND_KEY") or keychain(
    "ponglens-resend-key"
)
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
# Pipeline
# ---------------------------------------------------------------------------
def run_pipeline(input_video: str, workdir: str) -> str:
    """blurball inference -> cut_deadspace. Returns path to the trimmed mp4."""
    blurball_out = os.path.join(workdir, "blurball.jsonl")
    result = os.path.join(workdir, "result.mp4")

    log.info("  running blurball inference (this is the slow part)…")
    subprocess.run(
        [VENV_PY, BLURBALL_INFER, "--video", input_video, "--out", blurball_out],
        check=True, cwd=workdir, timeout=4 * 3600,
    )

    log.info("  cutting dead space…")
    subprocess.run(
        [VENV_PY, CUT_DEADSPACE, blurball_out, input_video, result],
        check=True, cwd=workdir, timeout=2 * 3600,
    )

    if not os.path.exists(result) or os.path.getsize(result) == 0:
        raise RuntimeError("pipeline produced no output file")
    return result


def process_job(conn, msg) -> None:
    payload = msg["message"]
    if isinstance(payload, str):
        payload = json.loads(payload)
    job_id = payload["job_id"]
    user_id = payload["user_id"]
    input_path = payload["input_path"]
    kind = payload.get("kind", "deadspace_cut")

    log.info("job %s (kind=%s, attempt %s)", job_id, kind, msg["read_ct"])

    if kind != "deadspace_cut":
        raise RuntimeError(f"unknown job kind: {kind}")

    update_job(conn, job_id, status="processing", progress=5, error=None)

    workdir = tempfile.mkdtemp(prefix=f"ponglens-{job_id[:8]}-")
    try:
        ext = os.path.splitext(input_path)[1] or ".mp4"
        local_input = os.path.join(workdir, f"input{ext}")

        log.info("  downloading uploads/%s", input_path)
        storage_download("uploads", input_path, local_input)
        update_job(conn, job_id, progress=15)

        result = run_pipeline(local_input, workdir)
        update_job(conn, job_id, progress=85)

        result_path = f"{user_id}/{job_id}.mp4"
        log.info("  uploading results/%s", result_path)
        storage_upload("results", result_path, result)

        update_job(conn, job_id, status="done", result_path=result_path,
                   progress=100)
        archive_message(conn, msg["msg_id"])
        log.info("  done: %s", result_path)
        notify_job_done(conn, job_id, user_id)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


# ---------------------------------------------------------------------------
# 30-day upload cleanup (Privacy Policy promise)
# ---------------------------------------------------------------------------
def cleanup_old_uploads(conn):
    cutoff = datetime.now(timezone.utc) - timedelta(days=UPLOAD_RETENTION_DAYS)
    with conn.cursor() as cur:
        cur.execute(
            "select name from storage.objects "
            "where bucket_id = 'uploads' and created_at < %s limit 200",
            (cutoff,),
        )
        names = [row[0] for row in cur.fetchall()]
    if not names:
        log.info("cleanup: nothing older than %s days", UPLOAD_RETENTION_DAYS)
        return
    log.info("cleanup: deleting %d expired upload(s)", len(names))
    storage_delete("uploads", names)


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
def main():
    log.info("PongLens worker starting (supabase=%s)", SUPABASE_URL)
    conn = connect()
    last_cleanup = 0.0

    while True:
        try:
            if time.time() - last_cleanup > CLEANUP_EVERY_S or last_cleanup == 0:
                try:
                    cleanup_old_uploads(conn)
                except Exception as e:  # cleanup must never kill the loop
                    log.warning("cleanup failed: %s", e)
                last_cleanup = time.time()

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
                    if msg["read_ct"] >= MAX_READ_CT:
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
    main()

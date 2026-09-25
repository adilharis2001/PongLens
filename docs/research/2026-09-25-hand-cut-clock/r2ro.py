"""Read-only R2 access for the hand-cut clock study.

Only HEAD, GET and presigned GET. Nothing here can write or delete.
Credentials come from the login Keychain (account openclaw), the same
items the worker reads.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

import boto3

LOCAL_ROOT = Path(os.environ.get("HC_DRIFT_DIR", "/private/tmp/claude-501/hc-drift"))


def _keychain(service: str) -> str:
    return subprocess.check_output(
        ["security", "find-generic-password", "-a", "openclaw", "-s", service, "-w"],
        text=True).strip()


_client = None


def client():
    global _client
    if _client is None:
        account = _keychain("ponglens-r2-account")
        _client = boto3.client(
            "s3",
            endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
            aws_access_key_id=_keychain("ponglens-r2-key-id"),
            aws_secret_access_key=_keychain("ponglens-r2-secret"),
            region_name="auto")
    return _client


def split(path: str) -> tuple[str, str]:
    assert path.startswith("r2://"), path
    bucket, key = path[5:].split("/", 1)
    return bucket, key


def head(path: str) -> dict | None:
    bucket, key = split(path)
    try:
        return client().head_object(Bucket=bucket, Key=key)
    except client().exceptions.ClientError:
        return None


def presign(path: str, expires: int = 6 * 3600) -> str:
    bucket, key = split(path)
    return client().generate_presigned_url(
        "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=expires)


def fetch(path: str, dest: Path) -> Path:
    """Download once; a file already on disk with the same size is reused."""
    bucket, key = split(path)
    size = client().head_object(Bucket=bucket, Key=key)["ContentLength"]
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size == size:
        return dest
    tmp = dest.with_suffix(dest.suffix + ".part")
    client().download_file(bucket, key, str(tmp))
    tmp.rename(dest)
    return dest

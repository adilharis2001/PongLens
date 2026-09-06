"""Fetch what the replay needs: the raw video, its audio, and the ball track.

  ./venv/bin/python fetch_inputs.py <corpus-dir> <work-dir>

Read-only against the product. Nothing is written to jobs, matches or
points, no job is queued and no mail can fire — this only reads R2 and runs
the detector locally, the same structural property research_reprocess.py
was built with.

`matches.raw_path` is not the authority. It only started being filled
partway through August 2026, so three of these seven read null while the
object sits in R2 untouched. `jobs.input_path` is, and that is what
dump_corpus.py recorded.

Each stage is skipped when its output already exists, so a re-run after a
crash costs only what is missing.
"""
import json
import os
import subprocess
import sys

import boto3

TTVID = "/Users/adil/Desktop/Projects/TTVid"
VENV_PY = f"{TTVID}/vendor/venv/bin/python"
BLURBALL_INFER = f"{TTVID}/vendor/blurball_infer.py"
MEDIA_BUCKET = "ponglens-media"


def keychain(service):
    return subprocess.check_output(
        ["security", "find-generic-password", "-a", "openclaw",
         "-s", service, "-w"]).decode().strip()


def s3_client():
    account = os.environ.get("R2_ACCOUNT_ID") or keychain("ponglens-r2-account")
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
        aws_access_key_id=(os.environ.get("R2_ACCESS_KEY_ID")
                           or keychain("ponglens-r2-key-id")),
        aws_secret_access_key=(os.environ.get("R2_SECRET_ACCESS_KEY")
                               or keychain("ponglens-r2-secret")),
        region_name="auto")


def fetch(s3, uri, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    bucket, key = uri.replace("r2://", "").split("/", 1)
    tmp = dest + ".part"
    s3.download_file(bucket, key, tmp)
    os.replace(tmp, dest)
    return dest


def main():
    corpus, workroot = sys.argv[1], sys.argv[2]
    manifest = json.load(open(os.path.join(corpus, "manifest.json")))
    s3 = s3_client()
    for entry in manifest:
        slug = entry["slug"]
        work = os.path.join(workroot, slug)
        os.makedirs(work, exist_ok=True)
        raw = os.path.join(work, "raw.mp4")
        print(f"\n=== {slug} ===", flush=True)

        print("  raw video…", flush=True)
        fetch(s3, entry["input_path"], raw)

        match_json = os.path.join(work, "match.json")
        if not os.path.exists(match_json):
            print("  match.json (production's own calibration)…", flush=True)
            row = json.load(open(os.path.join(corpus, f"{slug}.json")))
            path = row["match"]["match_json_path"]
            if not path:
                print("  !! no match_json_path")
            else:
                fetch(s3, path, match_json)

        # Mono 48 kHz. The detector wants sample-accurate onsets, and
        # downmixing before analysis is deliberate: a stereo phone
        # recording puts the same strike in both channels a millisecond
        # apart, which smears the very edge being measured.
        wav = os.path.join(work, "audio.wav")
        if not os.path.exists(wav):
            print("  audio track…", flush=True)
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", raw,
                 "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", wav],
                check=True)

        blurball = os.path.join(work, "blurball.jsonl")
        if not os.path.exists(blurball):
            print("  blurball inference (the slow part)…", flush=True)
            subprocess.run([VENV_PY, BLURBALL_INFER, "--video", raw,
                            "--out", blurball], check=True)
        n = sum(1 for _ in open(blurball))
        print(f"  {n} detection frames, "
              f"{os.path.getsize(wav) / 1e6:.0f} MB of audio", flush=True)


if __name__ == "__main__":
    main()

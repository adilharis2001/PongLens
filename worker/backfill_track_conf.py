#!/usr/bin/env python3
"""Give the already-diagnosed matches a ball track the winner rules can read.

    ./venv/bin/python backfill_track_conf.py --workroot <dir> [ids...]

The portal reads three rules over each card — the ball died, it went off
the table, it never came back — and two of them filter the ball track on
BlurBall's per-detection confidence. The evidence dumps on disk carry the
track but not the confidence: the assembler drops it long before the dump
is written.

Measured on the 23-point corpus the rules were written against, no invented
confidence works. Stamp every sample at 1.0 and the flight reader sees
nothing, so the whole repair layer goes quiet. Stamp them at 25 and it sees
samples BlurBall was unsure about, and two of the 23 change verdict. With
the real numbers, and the track moved onto the source clock, all 23 come
out exactly as the research page has them. So this recovers the real ones.

Which means running BlurBall again — about thirteen minutes a match, and
the reason this is an overnight job rather than a minute. Nothing else is
re-run: the evidence dump, the cards, the audio and the serve diagnosis all
stand, and only tracks.json is rewritten.

Resumable, and it decides by MEASUREMENT rather than by a list: a match
whose published tracks.json already says its confidences are measured is
skipped, so this can be stopped and restarted freely.
"""
import argparse
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import psycopg2  # noqa: E402
from publish_card_diagnosis import (  # noqa: E402
    CONF_MEASURED, owner_of, point_tracks,
)
from research_reprocess import (  # noqa: E402
    BLURBALL_INFER, MEDIA_BUCKET, VENV_PY, config, download, resolve,
    s3_client, trim_as_production_did,
)


def already_measured(s3, conn, match_id):
    """Whether the published artifact already carries real confidences."""
    try:
        key = f"points/{owner_of(conn, match_id)}/{match_id}/tracks.json"
        body = s3.get_object(Bucket=MEDIA_BUCKET, Key=key)["Body"].read()
        return json.loads(body).get("conf") == CONF_MEASURED
    except Exception:                                        # noqa: BLE001
        return False


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--workroot", required=True)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("ids", nargs="*")
    args = ap.parse_args()

    env = config()
    s3 = s3_client(env)
    done = skipped = failed = 0

    with psycopg2.connect(env["DATABASE_URL"]) as conn:
        todo = [
            n for n in sorted(os.listdir(args.workroot))
            if (not args.ids or n in args.ids)
            and os.path.exists(os.path.join(args.workroot, n, "evidence.json"))
        ]
        print(f"{len(todo)} matches with an evidence dump\n", flush=True)

        for i, name in enumerate(todo, 1):
            work = os.path.join(args.workroot, name)
            started = time.time()
            if not args.force and already_measured(s3, conn, name):
                print(f"[{i}/{len(todo)}] {name[:8]}  already measured",
                      flush=True)
                skipped += 1
                continue

            raw = video = None
            try:
                info = resolve(conn, name)
                ext = os.path.splitext(info["input_path"])[1] or ".mp4"
                raw = os.path.join(work, f"raw{ext}")
                print(f"[{i}/{len(todo)}] {name[:8]}  downloading", flush=True)
                download(s3, info["input_path"], raw)
                # The file PRODUCTION worked on. A head trim moves the clock,
                # and the dump this track has to line up with was written
                # against the trimmed copy.
                video = trim_as_production_did(raw, work, info["options"])

                jsonl = os.path.join(work, "blurball.jsonl")
                print("    blurball (the slow part)…", flush=True)
                subprocess.run([VENV_PY, BLURBALL_INFER, "--video", video,
                                "--out", jsonl], check=True)

                with open(os.path.join(work, "evidence.json")) as fh:
                    blob = json.load(fh)
                if blob.get("prod_cards"):
                    blob["cards"] = blob["prod_cards"]
                built = point_tracks(blob, jsonl)
                if built["conf"] != CONF_MEASURED:
                    raise RuntimeError("confidences did not come through")

                dest = os.path.join(work, "tracks.json")
                with open(dest, "w") as fh:
                    json.dump(built, fh, separators=(",", ":"))
                key = f"points/{owner_of(conn, name)}/{name}/tracks.json"
                s3.upload_file(dest, MEDIA_BUCKET, key,
                               ExtraArgs={"ContentType": "application/json"})

                samples = sum(len(c["track"]) for c in built["cards"])
                strong = sum(1 for c in built["cards"] for r in c["track"]
                             if r[3] >= 4)
                print(f"    {len(built['cards'])} cards, {samples} samples, "
                      f"{100 * strong / max(samples, 1):.0f}% clear the "
                      f"flight reader, {os.path.getsize(dest) / 1024:.0f} KB, "
                      f"{(time.time() - started) / 60:.1f} min", flush=True)
                done += 1
            except Exception as e:                           # noqa: BLE001
                print(f"    !! {name[:8]} failed: {e}", flush=True)
                failed += 1
            finally:
                # The video and the jsonl are hundreds of megabytes and are
                # never read again; the dump and the artifacts stay.
                for junk in os.listdir(work):
                    if junk not in ("evidence.json", "serves.json",
                                    "tracks.json"):
                        subprocess.run(["rm", "-rf", os.path.join(work, junk)],
                                       check=False)

    print(f"\n{done} rebuilt, {skipped} already measured, {failed} failed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

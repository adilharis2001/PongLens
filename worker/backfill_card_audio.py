#!/usr/bin/env python3
"""Add the audio row — and fix two shifted clocks — on already-diagnosed matches.

    ./venv/bin/python backfill_card_audio.py --workroot <dir> [ids...]

The portal's per-card timeline draws four rows. Three of them come from the
assembler's evidence dump, which thirty-six matches already have on disk
from the earlier backfill. The fourth is the microphone, and nothing we hold
carries it — so this downloads each raw once, listens to it, folds the
result into the dump beside the ball track, and republishes.

Cheap next to the run that produced those dumps: no blurball, no assembler,
so a match is its download plus about five seconds.

TWO MATCHES NEED MORE THAN THAT. research_reprocess used to run on the
stored raw, but a job processed inside a trim window (096) works on a
trimmed copy, and every timestamp production holds is in that trimmed
clock. Two of the thirty-six were trimmed at the head — one by four
minutes — so their dumps describe a rally minutes away from the card the
portal draws them under. Nothing about that looks wrong on screen, which is
why it went unnoticed. Those get the full re-run, now that
research_reprocess trims the way the worker does.

Only a trim at the HEAD moves the clock. Almost every job here was trimmed
at the tail, and a tail trim leaves the origin alone: the dump simply runs
past the end of the last card, which nothing reads. Re-running those would
cost eight hours of blurball to change nothing. So the test is a head trim
AND a dump that still spans the whole raw — the second half makes it
self-correcting, because a match already re-run properly now agrees with
production's own duration and is left alone.

Resumable. A match whose dump already carries audio and agrees with
production is skipped, so this can be stopped and started freely.
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
    owner_of, trim_for_transport, write_point_tracks,
)
from research_reprocess import (  # noqa: E402
    CARD_AUDIO, MEDIA_BUCKET, VENV_PY, config, download, resolve, run_one,
    s3_client, trim_as_production_did,
)
from research_serve_misses import (  # noqa: E402
    apply_shipped_settings, build,
)

# How far the dump's duration may sit from production's and still count as
# the same window. A stream copy lands on a keyframe, so an honest trim can
# miss the claim by a second; four minutes is what a wrong clock looked like.
CLOCK_TOLERANCE_S = 3.0
# Below this, apply_source_trim leaves the head alone and the two clocks
# share an origin. The worker's own threshold, so the same jobs qualify.
HEAD_TRIM_MIN_S = 0.5


def production_duration(s3, conn, match_id):
    """How long the file production actually processed was.

    match.json's `source.duration` is written by the pipeline about the file
    it was handed, so it is a direct reading of the processed window — no
    inference from the trim settings, which are a claim rather than a
    measurement once ffmpeg has snapped the head to a keyframe.
    """
    with conn.cursor() as cur:
        cur.execute("select match_json_path from public.matches where id = %s",
                    (match_id,))
        row = cur.fetchone()
    if not row or not row[0]:
        return None
    prefix = f"r2://{MEDIA_BUCKET}/"
    if not str(row[0]).startswith(prefix):
        return None
    try:
        body = s3.get_object(Bucket=MEDIA_BUCKET,
                             Key=str(row[0])[len(prefix):])["Body"].read()
        return float(json.loads(body)["source"]["duration"])
    except Exception:                                        # noqa: BLE001
        return None


def listen(video, work):
    """Impacts and an envelope for the whole file, on its own clock."""
    out = os.path.join(work, "audio.json")
    subprocess.run([VENV_PY, CARD_AUDIO, "--video", video, "--out", out],
                   check=True)
    with open(out) as fh:
        return json.load(fh)


def add_audio(s3, info, work, dump):
    """Download, trim as production did, listen, fold into the dump."""
    ext = os.path.splitext(info["input_path"])[1] or ".mp4"
    raw = os.path.join(work, f"raw{ext}")
    download(s3, info["input_path"], raw)
    video = trim_as_production_did(raw, work, info["options"])
    try:
        audio = listen(video, work)
    finally:
        for path in (raw, video):
            if path and os.path.exists(path) and path != dump:
                os.remove(path)
    with open(dump) as fh:
        blob = json.load(fh)
    blob["audio"] = audio
    with open(dump, "w") as fh:
        json.dump(blob, fh, separators=(",", ":"))
    return audio


def publish(s3, conn, match_id, work):
    """Rebuild the portal's artifact from the dump and upload it."""
    dump = os.path.join(work, "evidence.json")
    with open(dump) as fh:
        blob = json.load(fh)
    blob.setdefault("match_id", match_id)
    # Explain the cards the PLAYER has, never the ones a re-run drew.
    if blob.get("prod_cards"):
        blob["cards"] = blob["prod_cards"]
    page = trim_for_transport(build(blob, include_all=True))
    dest = os.path.join(work, "serves.json")
    with open(dest, "w") as fh:
        json.dump(page, fh, separators=(",", ":"))
    tracks = write_point_tracks(blob, work)
    prefix = f"points/{owner_of(conn, match_id)}/{match_id}"
    s3.upload_file(dest, MEDIA_BUCKET, f"{prefix}/serves.json",
                   ExtraArgs={"ContentType": "application/json"})
    s3.upload_file(tracks, MEDIA_BUCKET, f"{prefix}/tracks.json",
                   ExtraArgs={"ContentType": "application/json"})
    heard = sum(len((c.get("audio") or {}).get("impacts") or [])
                for c in page["cards"])
    return page, heard, os.path.getsize(dest)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--workroot", required=True)
    ap.add_argument("--force", action="store_true",
                    help="redo matches that already carry audio")
    ap.add_argument("ids", nargs="*")
    args = ap.parse_args()

    env = config()
    pad, merge = apply_shipped_settings(env)
    print(f"serve rule at the shipped settings: surface pad {pad} m, "
          f"merge {merge} s")
    s3 = s3_client(env)
    done = skipped = failed = reruns = 0

    with psycopg2.connect(env["DATABASE_URL"]) as conn:
        names = sorted(os.listdir(args.workroot))
        todo = [n for n in names
                if (not args.ids or n in args.ids)
                and os.path.exists(os.path.join(args.workroot, n,
                                                "evidence.json"))]
        print(f"{len(todo)} matches with an evidence dump\n")

        for i, name in enumerate(todo, 1):
            work = os.path.join(args.workroot, name)
            dump = os.path.join(work, "evidence.json")
            started = time.time()
            with open(dump) as fh:
                blob = json.load(fh)

            info = resolve(conn, name)
            prod_dur = production_duration(s3, conn, name)
            head_trim = float(
                info["options"].get("trim_start_s") or 0.0) > HEAD_TRIM_MIN_S
            same_window = (prod_dur is None
                           or abs(float(blob["duration"]) - prod_dur)
                           <= CLOCK_TOLERANCE_S)
            shifted = head_trim and not same_window
            if blob.get("audio") and not shifted and not args.force:
                print(f"[{i}/{len(todo)}] {name[:8]}  already done")
                skipped += 1
                continue

            try:
                if shifted:
                    # The dump itself is untrustworthy; audio alone would
                    # not save it. Everything comes again, trimmed properly.
                    print(f"[{i}/{len(todo)}] {name[:8]}  WRONG CLOCK "
                          f"(dump {blob['duration']:.0f}s vs production "
                          f"{prod_dur:.0f}s) — full re-run")
                    run_one(conn, s3, env, name, args.workroot,
                            skip_video=True, prefix="research/crossings")
                    reruns += 1
                else:
                    print(f"[{i}/{len(todo)}] {name[:8]}  listening")
                    audio = add_audio(s3, info, work, dump)
                    print(f"    {len(audio['impacts'])} impacts over "
                          f"{audio['duration']:.0f}s")

                page, heard, size = publish(s3, conn, name, work)
                anchored = sum(1 for c in page["cards"]
                               if c.get("serve_s") is not None)
                print(f"    published {len(page['cards'])} cards, "
                      f"{anchored} with a serve, {heard} impacts inside "
                      f"cards, {size / 1024:.0f} KB, "
                      f"{(time.time() - started) / 60:.1f} min")
                done += 1
            except Exception as e:                           # noqa: BLE001
                print(f"    !! {name[:8]} failed: {e}")
                failed += 1
            finally:
                # Never leave a raw behind: thirty-six of them is 23 GB.
                for junk in os.listdir(work):
                    if junk not in ("evidence.json", "serves.json",
                                    "tracks.json"):
                        path = os.path.join(work, junk)
                        subprocess.run(["rm", "-rf", path], check=False)

    print(f"\n{done} published, {reruns} of them re-run for a wrong clock, "
          f"{skipped} already done, {failed} failed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

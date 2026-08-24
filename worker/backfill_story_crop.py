"""Fill matches.story_crop for matches processed before it existed (135).

New matches get the window during processing, for free, from corners the
points pipeline already has in hand. Everything already in the library
needs the detector run over it once.

It is run over the CUT video rather than the original: the cut is derived
without rescaling, so the corners are identical, and it is the video the
vertical render actually reads. ffmpeg range-seeks it over a signed URL,
so nothing is downloaded.

Deliberately narrow. Writes exactly one column, on matches whose window is
currently null, and touches nothing else — no clips, no points, no job
rows, no R2 objects. Safe to interrupt and safe to re-run.

    python backfill_story_crop.py --dry-run
    python backfill_story_crop.py --limit 5
    python backfill_story_crop.py
    python backfill_story_crop.py --match <uuid> --force
"""
import argparse
import json
import subprocess
import sys
import tempfile
import shutil

sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/worker")

import points_pipeline as pp                                    # noqa: E402
import worker as W                                              # noqa: E402


def probe_size(url: str) -> tuple[int, int] | None:
    try:
        out = subprocess.check_output(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-of", "json", url],
            timeout=300)
        s = json.loads(out.decode())["streams"][0]
        return int(s["width"]), int(s["height"])
    except Exception:
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--match", help="one match id")
    ap.add_argument("--force", action="store_true",
                    help="recompute even where a window is already stored")
    args = ap.parse_args()

    conn = W.connect()
    where = ["m.status = 'ready'", "m.cut_path is not null"]
    params: list = []
    if args.match:
        where.append("m.id = %s")
        params.append(args.match)
    elif not args.force:
        where.append("m.story_crop is null")
    sql = ("select m.id, m.opponent_name from public.matches m where "
           + " and ".join(where) + " order by m.created_at desc")
    if args.limit:
        sql += f" limit {int(args.limit)}"
    with conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()

    print(f"{len(rows)} match(es) to look at"
          + (" (dry run, nothing will be written)" if args.dry_run else ""))
    done = skipped = failed = 0
    for i, (match_id, opponent) in enumerate(rows, 1):
        label = f"[{i}/{len(rows)}] {str(match_id)[:8]} vs {opponent or '?'}"
        url = W._cut_video_url(conn, str(match_id), expires_s=7200)
        if not url:
            print(f"{label}: no signable cut (legacy path, or swept)")
            skipped += 1
            continue
        size = probe_size(url)
        if not size:
            print(f"{label}: cut video would not open")
            failed += 1
            continue
        workdir = tempfile.mkdtemp(prefix="storycrop-")
        try:
            calib = pp.keypoint_calibrate(url, workdir)
        except Exception as e:                                  # noqa: BLE001
            print(f"{label}: detector crashed ({e})")
            failed += 1
            continue
        finally:
            shutil.rmtree(workdir, ignore_errors=True)

        block = ({"ok": True,
                  "table_corners_px": calib["corners_px"],
                  "agreement": calib.get("agreement")}
                 if calib else {"ok": False})
        window, note = pp.story_crop_from_calibration(block, *size)
        if window is None:
            # Not a failure. An uncropped share is exactly what this match
            # would have got without any of this, and it still works.
            print(f"{label}: no crop — {note}")
            skipped += 1
        else:
            pct = round(100 * window["w"] / size[0])
            print(f"{label}: {window['w']}x{window['h']} at x={window['x']} "
                  f"({pct}% of width, {window['camera']}, "
                  f"{window['frames']} frames, {window['spread']}px)")
            done += 1
        if not args.dry_run:
            with conn.cursor() as cur:
                cur.execute(
                    "update public.matches set story_crop = %s where id = %s",
                    (json.dumps(window) if window else None, match_id))
    print(f"\ncropped {done}, left uncropped {skipped}, failed {failed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

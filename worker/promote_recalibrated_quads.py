"""Write keypoint-detected table quads back into production match.json.

Twenty-two matches in the game-end corpus still carried a quad from the
retired pink-rim calibrator, which measured 0.5% accurate at LYTTC and
7.6% at PingPod. Rendered against the keypoint model's answer they are not
subtly off: they run across two tables, across the hall, or entirely off
the picture. Fourteen were re-detected from their own rally clips
(recalibrate_from_clips.py) and every one was visibly wrong before and
visibly right after.

Near and far are decided by which side of that quad a player stands on,
so a wrong quad does not add noise to the game-end detector — it compares
the wrong two people.

READ, MODIFY, WRITE. The local research copy of match.json was downloaded
hours or days ago and the production file may have moved on; only the
`calibration` key is replaced, on a fresh download, so nothing else can go
stale. What it replaces is kept in R2 beside it as match.pinkrim.json,
which is what a rollback reads.

    python3 -m worker.promote_recalibrated_quads --dry-run
    python3 -m worker.promote_recalibrated_quads --apply

Applied 2026-08-28: twelve matches, moving between 11% and 49% of frame
width. Two already agreed and were left alone.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import psycopg2
import psycopg2.extras

REPO = Path(__file__).resolve().parent
sys.path.insert(0, str(REPO.parent))

from worker.eval_side_changes import (  # noqa: E402
    DEFAULT_WORKDIR, keychain, parse_r2, r2_client,
)


def corners(calibration: dict) -> dict[str, list[float]]:
    raw = calibration.get("table_corners_px") or {}
    return {
        str(k)[:1].upper(): [float(v[0]), float(v[1])]
        for k, v in raw.items()
        if str(k)[:1].upper() in "ABCD"
    }


def displacement(a: dict, b: dict, width: float) -> float | None:
    """Mean corner distance as a fraction of frame width. Both quads must
    already be in the SAME space — see rescale."""
    if set(a) != set("ABCD") or set(b) != set("ABCD"):
        return None
    return sum(
        ((a[k][0] - b[k][0]) ** 2 + (a[k][1] - b[k][1]) ** 2) ** 0.5
        for k in "ABCD"
    ) / 4.0 / width


def rescale(quad: dict, frm: list[float], to: list[float]) -> dict:
    """The keypoint model measured on the 720-wide CLIPS; the stored quad
    is in source pixels. Comparing them without this reads every match as
    40-60% out, which is the scale difference and not the table."""
    kx, ky = float(to[0]) / float(frm[0]), float(to[1]) / float(frm[1])
    return {k: [v[0] * kx, v[1] * ky] for k, v in quad.items()}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workdir", type=Path, default=DEFAULT_WORKDIR)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not args.apply and not args.dry_run:
        parser.error("pass --dry-run or --apply")

    conn = psycopg2.connect(keychain("ponglens-db-url"))
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    client = r2_client()

    promoted = skipped = 0
    for directory in sorted(args.workdir.iterdir()):
        local = directory / "match.json"
        backup = directory / "match.pinkrim.json"
        # The local backup is the receipt that this match was recalibrated
        # here; without one there is nothing to promote.
        if not (local.is_file() and backup.is_file()):
            continue
        fresh_cal = (json.loads(local.read_text()).get("calibration") or {})
        if not fresh_cal.get("table_corners_px"):
            print(f"{directory.name[:8]} no corners locally")
            continue

        cur.execute(
            "select match_json_path from public.matches where id = %s",
            (directory.name,),
        )
        row = cur.fetchone()
        conn.commit()
        if not row or not (row["match_json_path"] or "").startswith("r2://"):
            print(f"{directory.name[:8]} no match_json_path")
            skipped += 1
            continue
        bucket, key = parse_r2(row["match_json_path"])

        body = client.get_object(Bucket=bucket, Key=key)["Body"].read()
        live = json.loads(body)
        live_cal = live.get("calibration") or {}
        size = live_cal.get("size") or [
            int((live.get("source") or {}).get("width") or 1920),
            int((live.get("source") or {}).get("height") or 1080),
        ]
        fresh_size = fresh_cal.get("size") or size
        moved = displacement(
            corners(live_cal),
            rescale(corners(fresh_cal), fresh_size, size),
            float(size[0]),
        )
        if moved is None:
            print(f"{directory.name[:8]} corners not comparable")
            skipped += 1
            continue
        if moved < 0.01:
            print(f"{directory.name[:8]} already agrees ({moved:.1%})")
            skipped += 1
            continue

        print(f"{directory.name[:8]} quad moves {moved:>6.1%} of frame width"
              f"  {'APPLY' if args.apply else '(dry run)'}")
        if not args.apply:
            promoted += 1
            continue

        pink_key = key.rsplit("/", 1)[0] + "/match.pinkrim.json"
        try:
            client.head_object(Bucket=bucket, Key=pink_key)
        except Exception:                                     # noqa: BLE001
            client.put_object(Bucket=bucket, Key=pink_key, Body=body,
                              ContentType="application/json")
        live["calibration"] = fresh_cal
        client.put_object(
            Bucket=bucket, Key=key,
            Body=json.dumps(live).encode(),
            ContentType="application/json",
        )
        promoted += 1

    print(f"\n{promoted} promoted, {skipped} skipped")


if __name__ == "__main__":
    main()

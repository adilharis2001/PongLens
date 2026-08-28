"""Give every existing match its game-end evidence.

The worker's side-change stage only runs post-ready, so every match
already in the library has no evidence at all — turning
app_config.game_end_detection on would light up nothing for anyone until
they uploaded again. This walks the library instead.

Two passes, cheapest first:

  --from-cache   persist evidence already extracted into the research
                 workdir. Free: no pose, no downloads, seconds for the
                 whole corpus.
  --extract      run the detector on everything still missing. About four
                 minutes of CPU each, so this is the long one.

Both go through eval_side_changes.persist_evidence, which refuses to
overwrite retained v1 artifacts, skips drills and practice, and runs
assert_aligned before pinning anything to a point id — a marker on the
wrong rally is worse than no marker.

    python3 -m worker.backfill_side_changes --from-cache
    python3 -m worker.backfill_side_changes --extract --limit 20
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import psycopg2
import psycopg2.extras

REPO = Path(__file__).resolve().parent
sys.path.insert(0, str(REPO.parent))

from worker.eval_side_changes import (  # noqa: E402
    DEFAULT_WORKDIR, EXTRACTOR, RTMPOSE_MODEL, RTMPOSE_PY,
    fetch_match_media, keychain, persist_evidence, r2_client,
)
from worker.side_change import assert_aligned  # noqa: E402

SKIP_TYPES = ("drills", "practice")


def cache_is_current(cur, match_id: str, cached: Path) -> bool:
    """Does this cached evidence still describe the match as it is now?

    A reprocess or a reclip moves every rally's t0/t1, and evidence taken
    before it describes a different cut. assert_aligned already refuses to
    pin such evidence to point ids — a marker on the wrong rally is worse
    than no marker — but a cache that can never be persisted is not a
    cache, it is a permanent hole: the match keeps its stale file, the
    extract pass skips it for having one, and it never gets evidence at
    all. Seven matches were sitting in exactly that state on 2026-08-28,
    every one of them named "recut" or "new pipeline".
    """
    cur.execute(
        "select id, idx, t0::float as t0, t1::float as t1 "
        "from public.points where match_id = %s",
        (match_id,),
    )
    points = {
        int(r["idx"]): {"id": r["id"], "t0": r["t0"], "t1": r["t1"]}
        for r in cur.fetchall()
    }
    if not points:
        return True
    try:
        assert_aligned(json.loads(cached.read_text()), points)
        return True
    except Exception:                                        # noqa: BLE001
        return False


def eligible(cur, limit: int | None, only: list[str]) -> list[dict]:
    cur.execute(
        """
        select id::text as id, opponent_name, match_type,
               match_json_path, match_structure is not null as has_structure
        from public.matches
        where status = 'ready'
          and match_json_path is not null
          and coalesce(match_type, '') <> all(%s)
        order by created_at desc
        """,
        (list(SKIP_TYPES),),
    )
    rows = [dict(r) for r in cur.fetchall()]
    if only:
        rows = [r for r in rows if any(r["id"].startswith(o) for o in only)]
    if limit:
        rows = rows[:limit]
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workdir", type=Path, default=DEFAULT_WORKDIR)
    parser.add_argument("--from-cache", action="store_true")
    parser.add_argument("--extract", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--match", nargs="*", default=[])
    parser.add_argument(
        "--evidence", default="evidence-v4.json",
        help="cache filename; falls back to evidence.json when absent")
    parser.add_argument("--samples", type=int, default=7)
    args = parser.parse_args()
    if not args.from_cache and not args.extract:
        parser.error("pass --from-cache and/or --extract")

    conn = psycopg2.connect(keychain("ponglens-db-url"))
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    rows = eligible(cur, args.limit, args.match)
    # Let the read go before four hours of pose inference start. psycopg2
    # opens a transaction on the first statement and holds it until a
    # commit, so without this the connection sits "idle in transaction"
    # for the whole run — holding a lock on public.points and blocking any
    # DDL behind it. That is exactly what this script did to migration 146
    # for a quarter of an hour.
    conn.commit()
    print(f"{len(rows)} eligible matches "
          f"({sum(1 for r in rows if r['has_structure'])} already have "
          f"evidence)\n", flush=True)

    client = r2_client() if args.extract else None
    done = failed = 0
    for row in rows:
        match_id = row["id"]
        folder = args.workdir / match_id
        cached = folder / args.evidence
        if not cached.is_file():
            cached = folder / "evidence.json"

        # A cache that cannot be persisted is worse than none: it makes the
        # extract pass skip the match forever. Move it aside and rebuild.
        if cached.is_file() and not cache_is_current(cur, match_id, cached):
            conn.commit()
            if not args.extract:
                print(f"{match_id[:8]} cache is stale (match was recut); "
                      f"re-run with --extract", flush=True)
                continue
            cached.rename(cached.with_suffix(".stale.json"))
            # And the match.json with it. fetch_match_media only downloads
            # when the file is absent, so re-extracting from the stale copy
            # reproduces the stale TIMES exactly and fails alignment again
            # by the same 1-3 seconds. The rally boundaries live in
            # match.json; the evidence is only as current as that file is.
            stale_match = folder / "match.json"
            if stale_match.is_file():
                stale_match.rename(folder / "match.stale.json")
            print(f"{match_id[:8]} cache was stale, rebuilding from a "
                  f"fresh match.json", flush=True)
            cached = folder / args.evidence
        conn.commit()

        if not cached.is_file():
            if not args.extract:
                continue
            try:
                media = fetch_match_media(client, row, folder)
                if media is None:
                    print(f"{match_id[:8]} skip: no usable calibration",
                          flush=True)
                    continue
                started = time.perf_counter()
                subprocess.run(
                    [str(RTMPOSE_PY), str(EXTRACTOR),
                     "--clips-dir", str(folder),
                     "--match-json", str(media),
                     "--output", str(folder / args.evidence),
                     "--model", str(RTMPOSE_MODEL),
                     "--device", "cpu",
                     "--samples", str(args.samples)],
                    check=True, timeout=40 * 60,
                    stdout=subprocess.DEVNULL,
                )
                cached = folder / args.evidence
                print(f"{match_id[:8]} extracted in "
                      f"{time.perf_counter() - started:.0f}s", flush=True)
            except Exception as exc:                          # noqa: BLE001
                print(f"{match_id[:8]} FAILED: "
                      f"{type(exc).__name__}: {str(exc)[:90]}", flush=True)
                failed += 1
                continue

        try:
            evidence = json.loads(cached.read_text())
            confirmed = sum(
                1 for c in (evidence.get("side_changes") or [])
                if c.get("confirmed")
            )
            outcome = persist_evidence(conn, cur, match_id, evidence)
        except Exception as exc:                              # noqa: BLE001
            outcome, confirmed = (
                f"FAILED: {type(exc).__name__}: {str(exc)[:90]}", 0)
            conn.rollback()
            failed += 1
        print(f"{match_id[:8]} {str(row['opponent_name'])[:18]:<18} "
              f"{confirmed} change(s)  {outcome}", flush=True)
        if not outcome.startswith(("skipped", "FAILED")):
            done += 1

    print(f"\n{done} persisted, {failed} failed")


if __name__ == "__main__":
    main()

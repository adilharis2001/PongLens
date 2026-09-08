#!/usr/bin/env python3
"""Re-anchor cut_t0 for points whose start was adjusted before adjust_point.

points.cut_t0 is where a point's PADDED clip starts inside the cut video:
source t0 minus the point's effective pre pad (playhead.ts, the anchoring
fact). Until migration 20260906174457 an Adjust moved t0 and left cut_t0
where it was, so every cut-clock rule placed the serve wrong by exactly the
amount the start had moved, on every replay.

For every ORIGINAL point (one the pipeline cut, so match.json in R2 carries
its birth values by idx) the correct anchor is recoverable:

    cut_t0 = json.cut_t0 + (max(0, t0_now - effPre_now) - json.clip_t0)

where json.clip_t0 is the padded start the clip was actually cut at (already
clamped at 0) and effPre_now honours a tight_start flag the point may have
gained since (a split parent keeps its idx). Split children and inserted
cards have no match.json entry and are left alone: their anchors were set
at birth and only drift if adjusted afterwards, which adjust_point now
handles going forward.

Only rows whose stored anchor differs from the recomputed one by more than
0.01 s are written. Idempotent; --dry-run prints what would change.

Run from worker/:
    venv/bin/python backfill_cut_t0.py [--dry-run] [--limit N] [--match ID]
"""

from __future__ import annotations

import argparse
import json
import os
import tempfile

import psycopg2.extras

try:
    from . import worker
except ImportError:  # Direct execution from worker/.
    import worker

TIGHT_PAD = 0.3
FROZEN_PRE = {"tight": 0.5, "normal": 1.0, "loose": 1.6}


def list_matches(conn, limit: int | None, match_id: str | None) -> list[dict]:
    sql = (
        "select m.id::text as match_id, m.match_json_path, m.clip_pads, "
        "       j.options->>'strictness' as strictness "
        "from public.matches m "
        "left join public.jobs j on j.id = m.job_id "
        "where m.match_json_path is not null "
        "and exists (select 1 from public.points p "
        "            where p.match_id = m.id and p.cut_t0 is not null) "
    )
    params: list = []
    if match_id:
        sql += "and m.id = %s "
        params.append(match_id)
    sql += "order by m.created_at"
    if limit:
        sql += " limit %s"
        params.append(int(limit))
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, params)
        return [dict(r) for r in cur.fetchall()]


def load_match_json(client, path: str, workdir: str) -> dict | None:
    loc = worker.parse_r2_path(path)
    if not loc:
        return None
    local = os.path.join(workdir, "match.json")
    try:
        client.download_file(loc[0], loc[1], local)
        with open(local) as fh:
            return json.load(fh)
    except Exception as e:  # noqa: BLE001 — reported, not fatal
        print(f"  skip: match.json unreadable ({e})")
        return None


def pre_pad(row: dict, mj: dict) -> float:
    pads = row.get("clip_pads")
    if isinstance(pads, dict) and isinstance(pads.get("pre"), (int, float)):
        return float(pads["pre"])
    jpads = (mj.get("options") or {}).get("clip_pads") or {}
    if isinstance(jpads.get("pre"), (int, float)):
        return float(jpads["pre"])
    return FROZEN_PRE.get(row.get("strictness") or "normal", 1.0)


def backfill_match(conn, client, row: dict, dry_run: bool) -> tuple[int, int]:
    """Returns (checked, changed)."""
    with tempfile.TemporaryDirectory(prefix="cut-t0-") as workdir:
        mj = load_match_json(client, row["match_json_path"], workdir)
    if not mj:
        return 0, 0
    by_idx = {}
    for p in mj.get("points") or []:
        # Present is not the same as known: a match.json written before the
        # cut clock was stamped carries the keys with null in them, and a
        # null birth anchor is no birth record at all. Such a point is left
        # alone for the same reason a split child is.
        if all(isinstance(p.get(k), (int, float))
               for k in ("idx", "clip_t0", "cut_t0")):
            by_idx[int(p["idx"])] = p
    pre = pre_pad(row, mj)
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "select id::text, idx, t0, cut_t0, tight_start "
            "from public.points where match_id = %s and cut_t0 is not null "
            "and t0 is not null order by idx",
            (row["match_id"],),
        )
        points = [dict(r) for r in cur.fetchall()]
    checked = changed = 0
    for p in points:
        j = by_idx.get(int(p["idx"]))
        if not j:
            continue   # split child or inserted card: no birth record
        checked += 1
        eff_pre = min(pre, TIGHT_PAD) if p["tight_start"] else pre
        anchor_now = max(0.0, float(p["t0"]) - eff_pre)
        correct = max(0.0, float(j["cut_t0"]) + (anchor_now - float(j["clip_t0"])))
        correct = round(correct, 2)
        if abs(correct - float(p["cut_t0"])) <= 0.01:
            continue
        changed += 1
        print(f"  {'would move' if dry_run else 'move'} point idx {p['idx']}: "
              f"cut_t0 {float(p['cut_t0']):.2f} -> {correct:.2f} "
              f"(t0 {float(p['t0']):.2f}, birth t0 {float(j.get('t0', 0)):.2f})")
        if dry_run:
            continue
        with conn.cursor() as cur:
            cur.execute(
                "update public.points set cut_t0 = %s "
                "where id = %s and cut_t0 = %s",
                (correct, p["id"], p["cut_t0"]),
            )
    return checked, changed


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--match", default=None, help="one match id")
    args = ap.parse_args()

    conn = worker.connect()
    client = worker.r2()
    rows = list_matches(conn, args.limit, args.match)
    print(f"{len(rows)} match(es) with a match.json and anchored points")
    total_checked = total_changed = 0
    for row in rows:
        print(f"match {row['match_id']}")
        checked, changed = backfill_match(conn, client, row, args.dry_run)
        total_checked += checked
        total_changed += changed
    print(f"done: {total_checked} original point(s) checked, "
          f"{total_changed} anchor(s) {'would be ' if args.dry_run else ''}moved")


if __name__ == "__main__":
    main()

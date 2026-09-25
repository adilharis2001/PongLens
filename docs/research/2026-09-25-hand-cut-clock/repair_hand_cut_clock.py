"""Repair the published clock of hand cuts made before the 2026-09-25 fix.

NOT RUN. Written with the measurements in this folder; REPAIR-PLAN.md says
when and how, and what each step writes.

Four subcommands, one match at a time:

  timeline  read-only for production, heavy locally. Re-runs the hand
            lane's own cmd_cut on the original from the segments match.json
            stores (the method the memory note cut-video-seekability used
            to re-cut matches with exact parity), at nice 19. When the video
            it makes is the published cut byte for byte, its measured part
            offsets are the published clock exactly. Writes
            <ops>/<match>/timeline.json.
  plan      read-only. The segment starts: the re-run's when it reproduced
            the cut, each checked against the picture readings in
            measure_drift.py's drift.json; the pictures' medians otherwise.
            Each point's corrected cut_t0. Writes <ops>/<match>/plan.json.
  apply     WRITES. Backs up match.json locally, uploads the corrected
            match.json (measured cut_segment_offsets, corrected cut_t0),
            then in ONE database transaction moves every point's cut_t0 and
            flags the clips worth re-cutting (edited = true), which is the
            reclip trigger's own request. Refuses if anything changed since
            the plan. --dry-run prints every write and makes none.
  rollback  WRITES. Puts match.json and every cut_t0 back from the plan and
            the backup, and points any re-cut clip back at its original
            NN.mp4 (which the reclip never deletes).

Each segment's start is the median of every picture reading of it (one
0.5 s into the segment, two per point in it), and the match is refused
unless all of these hold:
  1. every reading of a segment lies within 1.25 frames of that median,
     and the segment's own reading matched with cost <= MAX_COST;
  2. where the segment's first keyframe is an unambiguous part boundary
     (cmd_cut's fixed 60-frame GOP restarts at every part), it lies within
     1.25 frames of the median: the second, independent reading;
  3. the first segment starts within 0.1 s of zero, and each part runs
     between -1.25 frames and +100 ms past its window;
  4. the last segment ends inside the cut video;
  5. with a re-run: it reproduced the published cut byte for byte, used the
     same segments, and every offset it measured lies within 1.25 frames of
     the pictures' median.

    worker/venv/bin/python -B repair_hand_cut_clock.py timeline <inventory.json> <match>
    worker/venv/bin/python -B repair_hand_cut_clock.py plan <inventory.json> <match>
    worker/venv/bin/python -B repair_hand_cut_clock.py apply <match> [--dry-run]
    worker/venv/bin/python -B repair_hand_cut_clock.py rollback <match> [--dry-run]

Environment: HC_DRIFT_DIR (measurements, default /private/tmp/claude-501/
hc-drift), HC_REPAIR_OPS (plans and backups, default ~/Library/Caches/
PongLens/hand-cut-clock-repair-20260925, which a restart does not wipe),
DATABASE_URL or the Keychain item ponglens-db-url (apply and rollback only).
"""
from __future__ import annotations

import hashlib
import json
import os
import statistics
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(REPO / "worker"))
import cut_timeline  # noqa: E402  (the worker's own clock arithmetic)
import r2ro  # noqa: E402

OPS = Path(os.environ.get(
    "HC_REPAIR_OPS",
    Path.home() / "Library/Caches/PongLens/hand-cut-clock-repair-20260925"))
MAX_COST = 0.02
RECUT_THRESHOLD_S = 0.1
METHOD = "frame-match-repair-v1"


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _get(path: str) -> bytes:
    bucket, key = r2ro.split(path)
    body = r2ro.client().get_object(Bucket=bucket, Key=key)["Body"]
    try:
        return body.read()
    finally:
        body.close()


# ---------------------------------------------------------------------------
# plan (read-only)
# ---------------------------------------------------------------------------
def segment_readings(drift: dict) -> dict[int, list[float]]:
    """Every reading of where each segment's first kept second lands in the
    cut: the reading 0.5 s into the segment, and two per point (0.5 s into
    the rally, 0.3 s before its end), each turned back into a segment start.
    A point's drift is (true start) - (published start), and its published
    cut_t0 already carries the plan's two-decimal rounding, so the start it
    implies is drift + cut_t0 - (clip_t0 - a)."""
    segs = drift["segments"]
    out = {s["i"]: [float(s["measured"])] for s in segs}
    for p in drift["points"]:
        a = segs[p["segment"]]["a"]
        base = p["cut_t0_db"] - (p["clip_t0"] - a)
        for name in ("start", "end"):
            out[p["segment"]].append(base + p[f"drift_{name}"])
    return out


def build_plan(row: dict, match_json: bytes, drift: dict, cut_duration: float,
               cut_head: dict, rerun: dict | None = None) -> dict:
    mj = json.loads(match_json)
    if mj.get("pipeline") != "hand-v1":
        raise SystemExit("not a hand cut")
    if "cut_segment_offsets" in mj:
        raise SystemExit("match.json already carries a measured clock")
    segments = [(float(a), float(b)) for a, b in mj["cut_segments"]]
    segs = drift["segments"]
    if [(s["a"], s["b"]) for s in segs] != segments:
        raise SystemExit("drift.json was measured on different segments")
    frame = float(drift["frame_s"])
    # One frame either way is the resolution of a picture match, and the
    # encoder's frame-rate conversion moves a segment's mapping by a frame
    # here and there inside a segment (04f1b393, segment index 4).
    agree = 1.25 * frame
    problems = []
    offsets = []
    readings = segment_readings(drift)
    for s in segs:
        values = sorted(readings[s["i"]])
        start = statistics.median(values)
        worst = max(abs(v - start) for v in values)
        if worst > agree:
            problems.append(f"segment {s['i']}: readings spread {worst:.4f}s")
        if s["cost"] > MAX_COST:
            problems.append(f"segment {s['i']}: weak picture match (cost {s['cost']})")
        gap = s["keyframe"] - start
        if s["keyframe_boundary"] and not -agree <= gap <= agree:
            problems.append(f"segment {s['i']}: its first keyframe is "
                            f"{gap:+.4f}s from the picture's reading")
        offsets.append(round(start, 6))
    method, timing = "frame-match-repair-v1", None
    if rerun is not None:
        # The cut re-run from its stored segments is the published file
        # byte for byte, so its measured parts ARE the published clock, to
        # the microsecond; the picture medians become the cross-check.
        if not rerun.get("reproduced"):
            problems.append("the re-run cut is not the published file")
        elif rerun["cut_segments"] != [[a, b] for a, b in segments]:
            problems.append("the re-run cut used other segments")
        else:
            for i, (got, pic) in enumerate(zip(rerun["cut_segment_offsets"], offsets)):
                if abs(got - pic) > agree:
                    problems.append(f"segment {i}: re-run {got:.4f}s, picture {pic:.4f}s")
            offsets = [round(float(v), 6) for v in rerun["cut_segment_offsets"]]
            method = "mp4-concat-measured-v1"
            timing = dict(rerun["cut_timing"], reproduced_sha256=rerun["cut_sha256"])
    if not 0.0 <= offsets[0] <= 0.1:
        problems.append(f"first segment starts at {offsets[0]}")
    for i in range(len(offsets) - 1):
        a, b = segments[i]
        excess = offsets[i + 1] - offsets[i] - (b - a)
        if not -agree <= excess <= 0.1:
            problems.append(f"segment {i}: part runs {excess:+.4f}s past its window")
    last_end = offsets[-1] + segments[-1][1] - segments[-1][0]
    if last_end > cut_duration + 0.05:
        problems.append(f"last segment ends at {last_end:.3f}, cut is {cut_duration:.3f}")

    by_idx = {int(p["idx"]): p for p in mj["points"]}
    points = []
    for p in row["points"]:
        idx = int(p["idx"])
        mp = by_idx[idx]
        clip_t0 = float(mp["clip_t0"])
        new = round(cut_timeline.position(segments, offsets, clip_t0), 6)
        old = float(p["cut_t0"])
        if abs(old - float(mp["cut_t0"])) > 1e-6:
            problems.append(f"point {idx}: database and match.json disagree")
        points.append({
            "id": p["id"], "idx": idx, "t0": float(p["t0"]), "t1": float(p["t1"]),
            "clip_t0": clip_t0, "old_cut_t0": old, "new_cut_t0": new,
            "shift_s": round(new - old, 6),
            "clip_path": p.get("clip_path"),
            "recut": abs(new - old) >= RECUT_THRESHOLD_S,
        })
    return {
        "match": row["match"], "user": row["user"],
        "match_json_path": row["match_json_path"], "cut_path": row["cut_path"],
        "processing_version_id": row["processing_version_id"],
        "match_json_sha256": _sha(match_json),
        "cut_etag": cut_head["ETag"], "cut_bytes": cut_head["ContentLength"],
        "cut_duration_s": cut_duration,
        "cut_segments": [[a, b] for a, b in segments],
        "cut_segment_offsets": offsets,
        "method": method,
        "cut_timing": timing,
        "frame_s": frame,
        "points": points,
        "problems": problems,
    }


def cmd_plan(inventory: str, prefix: str) -> None:
    row = next(r for r in json.load(open(inventory)) if r["match"].startswith(prefix))
    key = row["match"][:8]
    drift = json.loads((r2ro.LOCAL_ROOT / key / "drift.json").read_text())
    match_json = _get(row["match_json_path"])
    cut_head = r2ro.head(row["cut_path"])
    local_cut = r2ro.fetch(row["cut_path"], r2ro.LOCAL_ROOT / key / "cut.mp4")
    cut_duration = float(json.loads(subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
         "json", str(local_cut)]))["format"]["duration"])
    rerun_path = OPS / key / "timeline.json"
    rerun = json.loads(rerun_path.read_text()) if rerun_path.exists() else None
    plan = build_plan(row, match_json, drift, cut_duration, cut_head, rerun)
    out = OPS / key
    out.mkdir(parents=True, exist_ok=True)
    (out / "plan.json").write_text(json.dumps(plan, indent=1) + "\n")
    shifts = [p["shift_s"] for p in plan["points"]]
    print(f"{key}: {len(plan['points'])} points, shift {min(shifts):+.3f} to "
          f"{max(shifts):+.3f}s, {sum(p['recut'] for p in plan['points'])} clips to "
          f"re-cut, clock from {plan['method']}, "
          f"{len(plan['problems'])} problem(s)")
    for problem in plan["problems"]:
        print("  REFUSED:", problem)


def _file_sha(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def cmd_timeline(inventory: str, prefix: str) -> None:
    """Read-only for production: re-run the hand lane's own cmd_cut on the
    original (by presigned URL) from the segments match.json stores, at
    the lowest CPU priority, and keep its measured timeline only if the
    video it made is the published cut byte for byte."""
    row = next(r for r in json.load(open(inventory)) if r["match"].startswith(prefix))
    key = row["match"][:8]
    work = OPS / key / "rerun"
    work.mkdir(parents=True, exist_ok=True)
    (work / "match.json").write_bytes(_get(row["match_json_path"]))
    published = r2ro.fetch(row["cut_path"], r2ro.LOCAL_ROOT / key / "cut.mp4")
    out = work / "result.mp4"
    subprocess.run(
        ["nice", "-n", "19", sys.executable, "-B",
         str(REPO / "worker" / "points_pipeline.py"), "cut",
         "--video", r2ro.presign(row["raw_path"]), "--out", str(out),
         "--segments", str(work / "match.json")],
        check=True, cwd=work)
    timeline = json.loads((work / "result.mp4.timeline.json").read_text())
    got, want = _file_sha(out), _file_sha(published)
    timeline.update(reproduced=got == want, cut_sha256=got,
                    published_sha256=want)
    (OPS / key / "timeline.json").write_text(json.dumps(timeline, indent=1) + "\n")
    subprocess.run(["rm", "-rf", str(work)], check=True)
    print(f"{key}: re-run {'IS' if got == want else 'is NOT'} the published cut; "
          f"last segment measured at {timeline['cut_segment_offsets'][-1]:.4f}s")


# ---------------------------------------------------------------------------
# apply / rollback (write)
# ---------------------------------------------------------------------------
def _connect():
    import psycopg2
    url = os.environ.get("DATABASE_URL") or subprocess.check_output(
        ["security", "find-generic-password", "-a", "openclaw", "-s",
         "ponglens-db-url", "-w"], text=True).strip()
    conn = psycopg2.connect(url)
    conn.autocommit = False
    return conn


def corrected_match_json(plan: dict, match_json: bytes) -> dict:
    """The worker's own reconciliation (cut_timeline.apply) with the
    measured offsets, so the file is exactly what a hand cut published
    after the fix would carry."""
    timing = plan.get("cut_timing") or {"method": plan.get("method", METHOD),
                                        "duration_s": plan["cut_duration_s"],
                                        "format_start_s": 0.0}
    timeline = {"schema": 1, "cut_segments": plan["cut_segments"],
                "cut_segment_offsets": plan["cut_segment_offsets"],
                "cut_timing": dict(timing, repaired="2026-09-25")}
    fixed = cut_timeline.apply(json.loads(match_json), timeline)
    for p in fixed["points"]:
        # apply() fills rally_end_cut_s from rally_end_s, which a hand cut
        # never has; leave the published file's shape alone.
        if p.get("rally_end_cut_s") is None and "rally_end_cut_s" not in \
                next(q for q in json.loads(match_json)["points"]
                     if q["idx"] == p["idx"]):
            p.pop("rally_end_cut_s", None)
    want = {p["idx"]: p["new_cut_t0"] for p in plan["points"]}
    for p in fixed["points"]:
        if abs(p["cut_t0"] - want[int(p["idx"])]) > 1e-6:
            raise SystemExit(f"point {p['idx']}: reconciliation disagrees with the plan")
    return fixed


def _check_database(cur, plan: dict) -> None:
    """Lock the match row (the same lock every worker publication takes)
    and refuse anything that moved since the plan, or a re-cut in flight:
    process_reclip claims a clip by id and times alone, so a job running
    underneath this would overwrite what is written here."""
    cur.execute("select active_processing_version_id::text, cut_path, "
                "match_json_path from public.matches where id = %s for update",
                (plan["match"],))
    version, cut_path, mj_path = cur.fetchone()
    if version != plan["processing_version_id"]:
        raise SystemExit("the match has a new processing version; re-plan")
    if cut_path != plan["cut_path"] or mj_path != plan["match_json_path"]:
        raise SystemExit("the match points at another cut or match.json; re-plan")
    cur.execute("select count(*) from public.jobs where kind = 'reclip' "
                "and status in ('queued', 'processing') "
                "and options->>'match_id' = %s", (plan["match"],))
    if cur.fetchone()[0]:
        raise SystemExit("a clip re-cut is queued or running for this match; "
                         "wait for it to finish")


def cmd_apply(prefix: str, dry_run: bool) -> None:
    key = prefix[:8]
    plan = json.loads((OPS / key / "plan.json").read_text())
    if plan["problems"]:
        raise SystemExit("the plan was refused; see plan.json problems")
    current = _get(plan["match_json_path"])
    if _sha(current) != plan["match_json_sha256"]:
        raise SystemExit("match.json changed since the plan; re-plan")
    if r2ro.head(plan["cut_path"])["ETag"] != plan["cut_etag"]:
        raise SystemExit("the cut video changed since the plan; re-plan")
    fixed = corrected_match_json(plan, current)
    body = json.dumps(fixed).encode()
    backup = OPS / key / "match.json.before"
    statements = [
        ("update public.points set cut_t0 = %s, edited = (edited or %s) "
         "where id = %s and match_id = %s and processing_version_id = %s "
         "and not deleted and t0 = %s and t1 = %s and cut_t0 = %s",
         (p["new_cut_t0"], p["recut"], p["id"], plan["match"],
          plan["processing_version_id"], p["t0"], p["t1"], p["old_cut_t0"]))
        for p in plan["points"]]
    if dry_run:
        print(f"would back up match.json ({len(current)} bytes) to {backup}")
        print(f"would upload corrected match.json ({len(body)} bytes) to "
              f"{plan['match_json_path']}")
        print(f"would run {len(statements)} guarded updates in one transaction, "
              f"{sum(p['recut'] for p in plan['points'])} with edited = true")
        for sql, args in statements[:3] + statements[-2:]:
            print("  ", sql.replace("%s", "{}").format(*[repr(a) for a in args]))
        return
    backup.write_bytes(current)
    bucket, obj = r2ro.split(plan["match_json_path"])
    r2ro.client().put_object(Bucket=bucket, Key=obj, Body=body,
                             ContentType="application/json")
    conn = _connect()
    try:
        with conn.cursor() as cur:
            _check_database(cur, plan)
            for sql, args in statements:
                cur.execute(sql, args)
                if cur.rowcount != 1:
                    raise SystemExit(f"point {args[2]} changed since the plan; "
                                     "nothing committed, match.json already "
                                     "corrected (run rollback or re-plan)")
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()
    print(f"{key}: {len(statements)} points moved onto the measured clock; "
          f"{sum(p['recut'] for p in plan['points'])} clips requested for re-cut")


def cmd_rollback(prefix: str, dry_run: bool) -> None:
    key = prefix[:8]
    plan = json.loads((OPS / key / "plan.json").read_text())
    backup = (OPS / key / "match.json.before").read_bytes()
    if _sha(backup) != plan["match_json_sha256"]:
        raise SystemExit("the backup is not the file the plan was made from")
    if dry_run:
        print(f"would restore match.json ({len(backup)} bytes) and "
              f"{len(plan['points'])} cut_t0 values; re-cut clips point back "
              "at their original NN.mp4")
        return
    conn = _connect()
    try:
        with conn.cursor() as cur:
            _check_database(cur, plan)
            for p in plan["points"]:
                # edited = false first, so restoring the original clip does
                # not ask for another re-cut.
                cur.execute(
                    "update public.points set cut_t0 = %s, edited = false, "
                    "clip_path = %s where id = %s and match_id = %s "
                    "and processing_version_id = %s "
                    "and cut_t0 = %s and t0 = %s and t1 = %s",
                    (p["old_cut_t0"], p["clip_path"], p["id"], plan["match"],
                     plan["processing_version_id"], p["new_cut_t0"], p["t0"],
                     p["t1"]))
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()
    bucket, obj = r2ro.split(plan["match_json_path"])
    r2ro.client().put_object(Bucket=bucket, Key=obj, Body=backup,
                             ContentType="application/json")
    print(f"{key}: restored")


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    cmd, rest = argv[0], argv[1:]
    dry = "--dry-run" in rest
    rest = [a for a in rest if a != "--dry-run"]
    if cmd == "timeline":
        cmd_timeline(rest[0], rest[1])
    elif cmd == "plan":
        cmd_plan(rest[0], rest[1])
    elif cmd == "apply":
        cmd_apply(rest[0], dry)
    elif cmd == "rollback":
        cmd_rollback(rest[0], dry)
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

#!/usr/bin/env python3
"""Build the game-end research page: what fired, what did not, and why.

The earlier page showed the detector's candidates and asked whether each
was real. That answered "is this fire right" and left the more important
question — everything the detector never fired on — invisible. This one
shows the whole scored corpus: every boundary the owner's own scoring
proves, whether the detector found it, and the frames either side so a
miss can be judged by eye rather than argued about.

Two passes, because the two things it needs live in different virtual
environments: the database truth needs psycopg2 (worker/venv) and the
video frames need cv2 (the rtmpose venv), and neither has the other's
packages.

  worker/venv/bin/python -m worker.build_game_end_page --dump
  ~/Library/Caches/PongLens/rtmpose-production/venv/bin/python \\
      worker/build_game_end_page.py --render --out docs/research/gameend.html
"""

from __future__ import annotations

import argparse
import base64
import html
import json
from pathlib import Path
from typing import Any

DEFAULT_CACHE = Path.home() / "ponglens-research-work" / "game-end-eval"
DUMP = DEFAULT_CACHE / "page-data.json"
FRAME_W = 240
JPEG_QUALITY = 62


# --- pass one: truth, scores and what to show -------------------------------

def dump(cache: Path, out: Path, config: dict | None) -> None:
    import sys

    import psycopg2
    import psycopg2.extras

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from worker.eval_side_changes import (
        keychain, load_truth, rescore_from_summaries, score_match,
    )

    conn = psycopg2.connect(keychain("ponglens-db-url"))
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        "select id::text, opponent_name, match_type from public.matches"
    )
    meta = {r["id"]: dict(r) for r in cur.fetchall()}

    matches = []
    for folder in sorted(cache.iterdir()):
        evidence_path = folder / "evidence.json"
        if folder.is_file() or not evidence_path.exists():
            continue
        truth = load_truth(cur, folder.name)
        if not truth["boundaries"]:
            continue
        evidence = json.loads(evidence_path.read_text())
        try:
            result = rescore_from_summaries(evidence, config)
        except Exception as error:                        # noqa: BLE001
            result = {**evidence, "status": "error",
                      "reason": f"{type(error).__name__}: {error}"}
        score = score_match(result, truth)
        by_idx = {int(p["idx"]): p for p in result.get("points") or []}
        fired = [
            c for c in result.get("side_changes") or [] if c.get("confirmed")
        ]
        # Pair each fire and each boundary with the two rallies a reviewer
        # has to look at, in match.json's own numbering — never the
        # database's, which on a reprocessed match names other rallies.
        wrong_gaps = {
            tuple(f["gap"]) for f in score["false_positives"]
        }
        order = sorted(by_idx)
        position = {idx: i for i, idx in enumerate(order)}

        def neighbours(idx: int, direction: int, count: int = 3) -> list[int]:
            """Up to `count` rallies running away from the break.

            One rally either side is not enough to judge a changeover.
            The cut is not perfect: the rally next to a break is often the
            one that caught a player walking to fetch the ball, or half of
            a fused pair, and a single frame of it shows an empty table.
            Three gives a reviewer something to average over.
            """
            start = position.get(idx)
            if start is None:
                return [idx]
            picked = []
            for step in range(count):
                at = start + direction * step
                if 0 <= at < len(order):
                    picked.append(order[at])
            return picked if direction < 0 else picked

        cases = []
        for change in fired:
            after = by_idx.get(int(change["after_idx"])) or {}
            before = by_idx.get(int(change["before_idx"])) or {}
            gap = (round(float(after.get("t1", 0)), 1),
                   round(float(before.get("t0", 0)), 1))
            cases.append({
                # A fire that matched a scored boundary is shown as a hit;
                # one that did not is shown as wrong. Both get frames,
                # because "wrong" here sometimes means the scoring drifted
                # and the detector found the real changeover.
                "kind": "wrong" if gap in wrong_gaps else "hit",
                "after_idx": int(change["after_idx"]),
                "before_idx": int(change["before_idx"]),
                "before": neighbours(int(change["after_idx"]), -1),
                "after": neighbours(int(change["before_idx"]), +1),
                "confidence": change.get("confidence"),
                "components": change.get("components") or {},
            })
        for miss in score["misses"]:
            after = int(miss["idx"])
            later = sorted(i for i in by_idx if i > after)
            nxt = later[0] if later else after
            cases.append({
                "kind": "miss",
                "after_idx": after,
                "before_idx": nxt,
                "before": neighbours(after, -1),
                "after": neighbours(nxt, +1),
                "tier": miss["tier"],
                "gap": [miss["gap_t0"], miss["gap_t1"]],
            })
        info = meta.get(folder.name, {})
        matches.append({
            "match": folder.name,
            "opponent": info.get("opponent_name"),
            "type": info.get("match_type"),
            "status": result.get("status"),
            "reason": result.get("reason"),
            "separability": result.get("separability"),
            "contradiction": result.get("contradiction"),
            "qualified": sum(
                1 for p in result.get("points") or [] if p.get("qualified")
            ),
            "points": len(result.get("points") or []),
            "truth": score["true_boundaries"],
            "hits": score["hits_tolerant"],
            "drift_hits": score["drift_hits"],
            "false_positives": len(score["false_positives"]),
            "fully_scored": truth["fully_scored"],
            "cases": cases,
        })
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"matches": matches}, indent=1, default=str))
    print(f"wrote {out} ({len(matches)} matches)")


# --- pass two: frames and HTML ----------------------------------------------

def _point_row(match: dict, idx: int) -> dict | None:
    for point in match.get("points") or []:
        if int(point["idx"]) == idx:
            return point
    return None


def clip_for(folder: Path, match: dict, idx: int) -> Path | None:
    point = _point_row(match, idx)
    if point is None:
        return None
    name = str(point.get("clip") or "").split("/")[-1]
    candidate = folder / name
    if candidate.is_file():
        return candidate
    fallback = folder / f"point-{idx:03d}.mp4"
    return fallback if fallback.is_file() else None


def rally_frames(folder: Path, match: dict, idx: int, count: int = 2):
    """The frames the DETECTOR reads, not fractions of the clip.

    The page used to grab 35% and 75% of the way through a clip, which is
    not where the rally is. Clips carry about 1.2s of head pad and 1.3s of
    tail pad around a median 3.8s of play, so three quarters of the way
    in is often after the point ended — a player already walking to fetch
    the ball, or an empty table. That is exactly what a reviewer was
    being shown and asked to judge.

    point_frames is the extractor's own rule: 0.4 to 3.2 seconds after
    serve contact, falling back to the played middle of the clip when the
    assembler found no serve. Showing what the detector saw is also the
    only fair way to ask whether the detector was right.
    """
    import cv2

    from extract_side_changes_rtmpose import point_frames

    clip = clip_for(folder, match, idx)
    point = _point_row(match, idx)
    if clip is None or point is None:
        return []
    capture = cv2.VideoCapture(str(clip))
    try:
        if not capture.isOpened():
            return []
        total = int(round(capture.get(cv2.CAP_PROP_FRAME_COUNT)))
        fps = float(capture.get(cv2.CAP_PROP_FPS)) or 30.0
        wanted, source = point_frames(point, total, fps, 5)
        if not wanted:
            return []
        # The middle of the window, then its ends, so one frame is the
        # most representative one available and two is a spread.
        chosen = [wanted[len(wanted) // 2]]
        if count > 1 and len(wanted) > 1:
            chosen.append(wanted[-1] if count == 2 else wanted[0])
        out = []
        for number in chosen[:count]:
            capture.set(cv2.CAP_PROP_POS_FRAMES, number)
            ok, image = capture.read()
            if not ok or image is None:
                continue
            height, width = image.shape[:2]
            if width > FRAME_W:
                image = cv2.resize(
                    image, (FRAME_W, int(round(height * FRAME_W / width))),
                    interpolation=cv2.INTER_AREA)
            ok, buffer = cv2.imencode(
                ".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
            if ok:
                out.append((base64.b64encode(buffer.tobytes()).decode("ascii"),
                            f"rally {idx}"
                            + ("" if source == "serve" else " (no serve found)")))
        return out
    finally:
        capture.release()


def img(data: str | None, label: str) -> str:
    if not data:
        return f'<div class="noframe">{html.escape(label)}</div>'
    return (f'<figure><img src="data:image/jpeg;base64,{data}" alt="">'
            f"<figcaption>{html.escape(label)}</figcaption></figure>")


def render(cache: Path, data: dict, out: Path, limit_cases: int) -> None:
    matches = data["matches"]
    truth_total = sum(m["truth"] for m in matches)
    hits = sum(m["hits"] for m in matches)
    wrong = sum(m["false_positives"] for m in matches if m["fully_scored"])
    precision = hits / (hits + wrong) if hits + wrong else 0.0
    recall = hits / truth_total if truth_total else 0.0

    rows = []
    for m in matches:
        covered = m["qualified"] / max(m["points"], 1)
        state = ("good" if m["hits"] == m["truth"] and not m["false_positives"]
                 else "bad" if m["hits"] == 0 else "part")
        # Plain English beats a decimal nobody can calibrate. The
        # separability figure was on the page and it does not predict
        # anything worth acting on — measured 2026-08-27 across the
        # competitive corpus, it correlates +0.19 with whether a match
        # works, and the MIDDLE third of it does better than the top
        # third. It stays in the JSON as a diagnostic and comes off the
        # table.
        missed = m["truth"] - m["hits"]
        verdict = (
            "everything found"
            if missed == 0 and not m["false_positives"] else
            "found nothing" if m["hits"] == 0 else
            f"missed {missed}" if missed and not m["false_positives"] else
            f"{m['false_positives']} wrong" if not missed else
            f"missed {missed}, {m['false_positives']} wrong"
        )
        rows.append(
            f'<tr class="{state}">'
            f'<td class="mono">{html.escape(m["match"][:8])}</td>'
            f'<td>{html.escape(str(m["opponent"] or "—"))}</td>'
            f'<td>{html.escape(str(m["type"] or "—"))}</td>'
            f'<td class="num">{m["points"]}</td>'
            f'<td class="num">{covered:.0%}</td>'
            f'<td class="num">{m["hits"]} of {m["truth"]}</td>'
            f'<td>{html.escape(verdict)}</td>'
            f'<td class="why">{html.escape(str(m["reason"] or ""))}</td>'
            "</tr>"
        )

    blocks = []
    shown = 0
    available = sum(len(m["cases"]) for m in matches)
    # Failures first: a page that opens on forty correct answers buries
    # the only part anyone can act on.
    order = {"wrong": 0, "miss": 1, "hit": 2}
    matches = sorted(matches, key=lambda m: min(
        (order.get(c["kind"], 9) for c in m["cases"]), default=9))
    for m in matches:
        if not m["cases"]:
            continue
        m = {**m, "cases": sorted(
            m["cases"], key=lambda c: order.get(c["kind"], 9))}
        match_json = cache / m["match"] / "match.json"
        if not match_json.exists():
            continue
        parsed = json.loads(match_json.read_text())
        folder = cache / m["match"]
        for case in m["cases"]:
            if shown >= limit_cases:
                break
            shown += 1
            case_id = f'{m["match"][:8]}@{case["after_idx"]}'
            kind = case["kind"]
            head = {
                "hit": f'found it — confidence {case.get("confidence")}',
                "wrong": f'fired here, and your scoring has no game '
                         f'ending — confidence {case.get("confidence")}',
                "miss": f'your scoring says a game ended here and the '
                        f'detector said nothing ({case.get("tier")})',
            }.get(kind, kind)
            before = []
            for idx in reversed(case.get("before") or [case["after_idx"]]):
                before.extend(rally_frames(folder, parsed, idx))
            after = []
            for idx in case.get("after") or [case["before_idx"]]:
                after.extend(rally_frames(folder, parsed, idx))
            if not before and not after:
                shown -= 1
                continue
            detail = json.dumps(
                case.get("components") or {"gap": case.get("gap")},
                default=str)
            blocks.append(f"""
<article class="case {kind}" data-case="{html.escape(case_id)}">
  <header>
    <span class="tag {kind}">{kind}</span>
    <b>{html.escape(m["opponent"] or m["match"][:8])}</b>
    <span class="mono">{html.escape(m["match"][:8])}</span>
    <span class="head">{html.escape(head)}</span>
  </header>
  <div class="pair">
    <div class="side"><h4>three rallies before the break</h4>
      <div class="frames">{"".join(img(d, c) for d, c in before)}</div></div>
    <div class="side"><h4>three rallies after it</h4>
      <div class="frames">{"".join(img(d, c) for d, c in after)}</div></div>
  </div>
  <div class="verdicts">
    <button data-v="swapped">they swapped ends</button>
    <button data-v="same">same ends</button>
    <button data-v="unclear">can't tell</button>
  </div>
  <pre class="detail">{html.escape(detail)}</pre>
</article>""")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(PAGE.format(
        precision=f"{precision:.0%}", recall=f"{recall:.0%}",
        hits=hits, truth=truth_total, wrong=wrong,
        matches=len(matches), rows="\n".join(rows),
        cases="\n".join(blocks), shown=shown,
        truncated=(
            f" Showing {shown} of {available}; the rest are correct calls "
            f"further down the list." if shown < available else ""),
    ))
    print(f"wrote {out} ({shown} cases, {len(matches)} matches)")


PAGE = """<!doctype html><meta charset="utf-8">
<title>Game boundaries — what the detector finds</title>
<style>
:root {{ color-scheme: dark; }}
body {{ background:#0b0b0d; color:#e7e7ea; font:15px/1.55 -apple-system,
  BlinkMacSystemFont,"Segoe UI",sans-serif; margin:0; padding:32px 28px 96px; }}
h1 {{ font-size:26px; margin:0 0 6px; }}
h2 {{ font-size:19px; margin:40px 0 12px; }}
h4 {{ font-size:13px; color:#9a9aa2; margin:0 0 6px; font-weight:500; }}
.lede {{ color:#9a9aa2; max-width:70ch; }}
.score {{ display:flex; gap:28px; margin:22px 0 8px; flex-wrap:wrap; }}
.score div {{ background:#141418; border:1px solid #26262c; border-radius:12px;
  padding:14px 18px; min-width:120px; }}
.score b {{ display:block; font-size:26px; }}
.score span {{ color:#9a9aa2; font-size:13px; }}
table {{ border-collapse:collapse; width:100%; font-size:13.5px; }}
th,td {{ text-align:left; padding:6px 10px; border-bottom:1px solid #1e1e24; }}
th {{ color:#9a9aa2; font-weight:500; }}
td.num {{ text-align:right; font-variant-numeric:tabular-nums; }}
td.why {{ color:#9a9aa2; font-size:12.5px; max-width:44ch; }}
.mono {{ font-family:ui-monospace,SFMono-Regular,Menlo,monospace; color:#8f8f98; }}
tr.good td:nth-child(6), tr.good td:nth-child(7) {{ color:#5fd08a; }}
tr.bad  td:nth-child(6), tr.bad  td:nth-child(7) {{ color:#e07a6a; }}
tr.part td:nth-child(6), tr.part td:nth-child(7) {{ color:#e0c46a; }}
.case {{ border:1px solid #26262c; border-radius:14px; padding:16px 18px;
  margin:16px 0; background:#141418; }}
.case.miss {{ border-color:#4a3030; }}
.case.wrong {{ border-color:#4a3a20; }}
.case header {{ display:flex; gap:14px; align-items:baseline; flex-wrap:wrap;
  margin-bottom:12px; }}
.tag {{ font-size:11px; text-transform:uppercase; letter-spacing:.06em;
  padding:2px 8px; border-radius:999px; }}
.tag.miss {{ background:#3a1d1d; color:#e0a08f; }}
.tag.hit {{ background:#1d3a29; color:#8fe0b0; }}
.tag.wrong {{ background:#3a3018; color:#e0c46a; }}
.head {{ color:#9a9aa2; font-size:13px; }}
.pair {{ display:flex; gap:20px; flex-wrap:wrap; }}
.frames {{ display:flex; gap:6px; flex-wrap:wrap; max-width:min(46vw,760px); }}
figure {{ margin:0; }}
img {{ display:block; border-radius:8px; max-width:100%; }}
figcaption {{ color:#71717a; font-size:11px; padding-top:4px; }}
.noframe {{ width:180px; height:110px; display:grid; place-items:center;
  border:1px dashed #33333a; border-radius:8px; color:#71717a; font-size:12px; }}
.verdicts {{ display:flex; gap:8px; margin-top:12px; }}
.verdicts button {{ background:transparent; color:#e7e7ea; font:inherit;
  font-size:13px; border:1px solid #33333a; border-radius:999px;
  padding:5px 14px; cursor:pointer; }}
.verdicts button:hover {{ border-color:#5a5a66; }}
.verdicts button.on {{ background:#2b4a6f; border-color:#2b4a6f; }}
.detail {{ color:#71717a; font-size:11.5px; margin:10px 0 0;
  white-space:pre-wrap; word-break:break-all; }}
#out {{ position:fixed; right:20px; bottom:20px; background:#1b1b21;
  border:1px solid #33333a; border-radius:12px; padding:12px 16px;
  max-width:340px; font-size:13px; }}
#out button {{ background:#2b4a6f; color:#fff; border:0; border-radius:999px;
  padding:6px 14px; font:inherit; font-size:13px; cursor:pointer;
  margin-top:8px; }}
</style>
<h1>Game boundaries</h1>
<p class="lede">A game ending is the one thing this looks for: when a
game finishes, the two players walk round and swap ends of the table, and
that swap is visible even with no score on screen. Below is every game
ending your own scoring proves, across {matches} matches, and whether the
detector saw it. None of this is in the app.</p>

<div class="score">
  <div><b>{recall}</b><span>of real boundaries found<br>({hits} of {truth})</span></div>
  <div><b>{precision}</b><span>of what it fires on is right<br>({wrong} wrong)</span></div>
</div>

<h2>Match by match</h2>
<p class="lede"><b>Both players spotted</b> is the share of rallies where
the detector got a clean read on a player at each end of the table. It
cannot find a changeover in a rally it could not read, so this is the
ceiling on everything else — but a high number does not guarantee a good
result, only make one possible.</p>
<p class="lede"><b>Found</b> counts the game endings your own scoring
proves, so "4 of 5" means your scoring shows five games ending and the
detector called four of them.</p>
<table>
<tr><th>match</th><th>opponent</th><th>type</th><th>rallies</th>
<th>both players spotted</th><th>found</th><th>how it went</th>
<th>why not</th></tr>
{rows}
</table>

<h2>Look for yourself</h2>
<p class="lede">Each block shows the last rally before a break and the
first one after it. If the two players are at opposite ends between them,
a game ended there. Amber blocks are where the detector fired and your
scoring disagrees; red is where your scoring says a game ended and the
detector stayed quiet. Those two are the ones worth your time. Tap a
verdict and send me the block from the corner.{truncated}</p>
<p class="lede">Frames come from between 0.4 and 3.2 seconds after the
serve, which is the same moment the detector reads the players at — mid
rally, when both are at their own ends. Three rallies are shown either
side because the rally right next to a break is often the one the cut got
wrong.</p>
{cases}

<div id="out">
  <div id="count">no verdicts yet</div>
  <button onclick="copyAll()">copy verdicts</button>
</div>
<script>
const verdicts = {{}};
document.querySelectorAll('.case').forEach(card => {{
  card.querySelectorAll('.verdicts button').forEach(b => {{
    b.onclick = () => {{
      card.querySelectorAll('.verdicts button').forEach(o => o.classList.remove('on'));
      b.classList.add('on');
      verdicts[card.dataset.case] = b.dataset.v;
      document.getElementById('count').textContent =
        Object.keys(verdicts).length + ' of {shown} judged';
    }};
  }});
}});
function copyAll() {{
  navigator.clipboard.writeText(JSON.stringify(verdicts, null, 1));
  document.getElementById('count').textContent = 'copied';
}}
</script>
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--data", type=Path, default=DUMP)
    parser.add_argument("--dump", action="store_true")
    parser.add_argument("--render", action="store_true")
    parser.add_argument("--config", type=str, default=None)
    parser.add_argument("--limit-cases", type=int, default=220)
    parser.add_argument(
        "--out", type=Path, default=Path("docs/research/gameend.html"))
    args = parser.parse_args()
    if args.dump:
        dump(args.cache, args.data,
             json.loads(args.config) if args.config else None)
    if args.render:
        render(args.cache, json.loads(args.data.read_text()),
               args.out, args.limit_cases)
    if not args.dump and not args.render:
        parser.error("pass --dump (worker venv) or --render (rtmpose venv)")


if __name__ == "__main__":
    main()

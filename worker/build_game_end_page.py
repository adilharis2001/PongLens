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
FRAME_W = 330
JPEG_QUALITY = 66


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
                "confidence": change.get("confidence"),
                "components": change.get("components") or {},
            })
        for miss in score["misses"]:
            after = int(miss["idx"])
            later = sorted(i for i in by_idx if i > after)
            cases.append({
                "kind": "miss",
                "after_idx": after,
                "before_idx": later[0] if later else after,
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

def clip_for(folder: Path, match: dict, idx: int) -> Path | None:
    for point in match.get("points") or []:
        if int(point["idx"]) != idx:
            continue
        name = str(point.get("clip") or "").split("/")[-1]
        candidate = folder / name
        if candidate.is_file():
            return candidate
        fallback = folder / f"point-{idx:03d}.mp4"
        return fallback if fallback.is_file() else None
    return None


def frame_b64(clip: Path | None, fraction: float) -> str | None:
    import cv2

    if clip is None:
        return None
    capture = cv2.VideoCapture(str(clip))
    try:
        if not capture.isOpened():
            return None
        count = int(round(capture.get(cv2.CAP_PROP_FRAME_COUNT)))
        if count <= 0:
            return None
        capture.set(cv2.CAP_PROP_POS_FRAMES,
                    min(count - 1, max(0, int(round(count * fraction)))))
        ok, image = capture.read()
    finally:
        capture.release()
    if not ok or image is None:
        return None
    height, width = image.shape[:2]
    if width > FRAME_W:
        image = cv2.resize(image, (FRAME_W, int(round(height * FRAME_W / width))),
                           interpolation=cv2.INTER_AREA)
    ok, buffer = cv2.imencode(".jpg", image,
                              [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    return base64.b64encode(buffer.tobytes()).decode("ascii") if ok else None


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
        rows.append(
            f'<tr class="{state}">'
            f'<td class="mono">{html.escape(m["match"][:8])}</td>'
            f'<td>{html.escape(str(m["opponent"] or "—"))}</td>'
            f'<td>{html.escape(str(m["type"] or "—"))}</td>'
            f'<td class="num">{m["points"]}</td>'
            f'<td class="num">{covered:.0%}</td>'
            f'<td class="num">{m["separability"] or "—"}</td>'
            f'<td class="num">{m["hits"]} of {m["truth"]}</td>'
            f'<td class="num">{m["false_positives"] or ""}</td>'
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
            after = clip_for(folder, parsed, case["after_idx"])
            before = clip_for(folder, parsed, case["before_idx"])
            case_id = f'{m["match"][:8]}@{case["after_idx"]}'
            kind = case["kind"]
            head = {
                "hit": f'found it — confidence {case.get("confidence")}',
                "wrong": f'fired here, and your scoring has no game '
                         f'ending — confidence {case.get("confidence")}',
                "miss": f'your scoring says a game ended here and the '
                        f'detector said nothing ({case.get("tier")})',
            }.get(kind, kind)
            detail = json.dumps(
                case.get("components") or {"gap": case.get("gap")},
                default=str)
            blocks.append(f"""
<article class="case {kind}" data-case="{html.escape(case_id)}">
  <header>
    <span class="tag {kind}">{kind}</span>
    <b>{html.escape(m["opponent"] or m["match"][:8])}</b>
    <span class="mono">{html.escape(m["match"][:8])}</span>
    <span>rally {case["after_idx"]} &rarr; {case["before_idx"]}</span>
    <span class="head">{html.escape(head)}</span>
  </header>
  <div class="pair">
    <div class="side"><h4>last rally before the break</h4><div class="frames">
      {img(frame_b64(after, 0.35), "early")}{img(frame_b64(after, 0.75), "late")}
    </div></div>
    <div class="side"><h4>first rally after it</h4><div class="frames">
      {img(frame_b64(before, 0.35), "early")}{img(frame_b64(before, 0.75), "late")}
    </div></div>
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
tr.good td:nth-child(7) {{ color:#5fd08a; }}
tr.bad  td:nth-child(7) {{ color:#e07a6a; }}
tr.part td:nth-child(7) {{ color:#e0c46a; }}
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
.frames {{ display:flex; gap:8px; }}
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
<p class="lede">Every game boundary your own scoring proves, across {matches}
matches, and whether the detector found it. A boundary is a game ending:
the players walk round the table and swap ends. Nothing here is in the app.</p>

<div class="score">
  <div><b>{recall}</b><span>of real boundaries found<br>({hits} of {truth})</span></div>
  <div><b>{precision}</b><span>of what it fires on is right<br>({wrong} wrong)</span></div>
</div>

<h2>Match by match</h2>
<table>
<tr><th>match</th><th>opponent</th><th>type</th><th>rallies</th>
<th>both players seen</th><th>how different they look</th>
<th>found</th><th>wrong</th><th>why not</th></tr>
{rows}
</table>

<h2>Look for yourself</h2>
<p class="lede">Each block shows the last rally before a break and the
first one after it. If the two players are at opposite ends between them,
a game ended there. Amber blocks are where the detector fired and your
scoring disagrees; red is where your scoring says a game ended and the
detector stayed quiet. Those two are the ones worth your time. Tap a
verdict and send me the block from the corner.{truncated}</p>
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

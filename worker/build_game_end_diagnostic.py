#!/usr/bin/env python3
"""Build the "what the detector sees" page.

The review page answers whether a candidate is right. This one answers
the prior question: is the detector even looking in the right place. For
each sampled frame it draws the table it found, the two end lines it
splits players by, every person it detected, which one it chose for each
end and why it rejected the rest — then the torso crop it read the
player's appearance from, with the colour it actually extracted.

Built because coverage collapses off-venue (PingPod qualifies 70-100% of
points, LYTTC and Westchester 2-47%) and the numbers alone cannot say
whether that is the table, the person detector, the end split, or the
torso crop. Contrast a healthy match with a starving one and the answer
should be visible.

Usage (from the repo root, with the rtmpose venv):

  ~/Library/Caches/PongLens/rtmpose-production/venv/bin/python \
      worker/build_game_end_diagnostic.py \
      --cache ~/ponglens-research-work/game-end-eval \
      --match 86f880b9 98be5eb5 9e15ed10 \
      --out docs/research/gameend-seen.html
"""

from __future__ import annotations

import argparse
import base64
import html
import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np

if __package__:
    from .extract_match_structure_rtmpose import (
        _clip_metadata, _clip_path, _create_pose_model, _read_frame,
        _scaled_corners,
    )
    from .extract_side_changes_rtmpose import (
        DET_MODEL_URL, NEAR_TABLE_FACTOR, TORSO_MIN_CONF, _create_det_model,
        _named_corners, choose_players, dedupe_boxes, point_sample_frames,
        torso_signature_v2,
    )
    from .side_change import DEFAULT_CONFIG, summarize_point_side
else:
    from extract_match_structure_rtmpose import (
        _clip_metadata, _clip_path, _create_pose_model, _read_frame,
        _scaled_corners,
    )
    from extract_side_changes_rtmpose import (
        DET_MODEL_URL, NEAR_TABLE_FACTOR, TORSO_MIN_CONF, _create_det_model,
        _named_corners, choose_players, dedupe_boxes, point_sample_frames,
        torso_signature_v2,
    )
    from side_change import DEFAULT_CONFIG, summarize_point_side

OUT_W = 760
CROP_W = 120

TABLE = (255, 210, 60)      # the quad
NEAR_LINE = (120, 255, 120)  # A-B
FAR_LINE = (255, 130, 255)   # C-D
CHOSEN = (110, 255, 110)
OTHER = (150, 150, 150)
REJECT = (90, 90, 220)


def b64(image: np.ndarray, width: int = OUT_W) -> str:
    height = image.shape[0] * width // max(1, image.shape[1])
    if image.shape[1] != width:
        image = cv2.resize(image, (width, height),
                           interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 78])
    return base64.b64encode(buf.tobytes()).decode("ascii") if ok else ""


def annotate(image, corners, chosen) -> np.ndarray:
    vis = image.copy()
    named = _named_corners(corners)
    quad = np.array([named[k] for k in "ABCD"], np.int32)
    cv2.polylines(vis, [quad], True, TABLE, 2)
    cv2.line(vis, tuple(np.int32(named["A"])), tuple(np.int32(named["B"])),
             NEAR_LINE, 3)
    cv2.line(vis, tuple(np.int32(named["C"])), tuple(np.int32(named["D"])),
             FAR_LINE, 3)
    for key in "ABCD":
        x, y = np.int32(named[key])
        cv2.circle(vis, (x, y), 5, TABLE, -1)
        cv2.putText(vis, key, (x + 6, y - 6), cv2.FONT_HERSHEY_SIMPLEX,
                    0.6, TABLE, 2)
    for record in chosen.get("boxes") or []:
        x0, y0, x1, y1 = [int(v) for v in record["box"]]
        verdict = record["verdict"]
        colour = (CHOSEN if verdict.startswith("CHOSEN")
                  else REJECT if "too far" in verdict else OTHER)
        cv2.rectangle(vis, (x0, y0), (x1, y1), colour, 2)
        ax, ay = [int(v) for v in record["anchor"]]
        cv2.circle(vis, (ax, ay), 4, colour, -1)
        # The allowance is the rule: within 1.1x your own height of the
        # table. Drawing it makes "too far" arguable rather than opaque.
        cv2.circle(vis, (ax, ay), int(record["allowance"]), colour, 1)
        cv2.putText(vis, verdict, (x0, max(14, y0 - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, colour, 1)
    return vis


def swatch(bgr: list[float] | None) -> str:
    if not bgr:
        return '<div class="sw none">none</div>'
    b, g, r = [max(0, min(255, int(round(v * 255)))) for v in bgr]
    return (f'<div class="sw" style="background:rgb({r},{g},{b})">'
            f'{r},{g},{b}</div>')


def run(cache: Path, wanted: list[str], per_match: int) -> list[dict]:
    pose = _create_pose_model(
        Path("/Users/adil/Library/Caches/PongLens/rtmpose-production/"
             "end2end.onnx"), "onnxruntime", "cpu")[0]
    det = _create_det_model(DET_MODEL_URL, "onnxruntime", "cpu")
    out = []
    for folder in sorted(cache.iterdir()):
        if not folder.is_dir():
            continue
        if wanted and not any(folder.name.startswith(w) for w in wanted):
            continue
        match_path = folder / "match.json"
        if not match_path.is_file():
            continue
        match = json.loads(match_path.read_text())
        calibration = match.get("calibration") or {}
        if calibration.get("ok") is False or not calibration.get(
            "table_corners_px"
        ):
            out.append({"match": folder.name, "fatal":
                        "no table calibration — the stage cannot run"})
            continue
        evidence = None
        if (folder / "evidence.json").is_file():
            evidence = json.loads((folder / "evidence.json").read_text())
        points = sorted(match.get("points") or [],
                        key=lambda p: int(p["idx"]))
        summaries = {int(p["idx"]): p
                     for p in (evidence or {}).get("points") or []}
        # Spread the sample across the match, and prefer showing points
        # that FAILED to qualify — those are what needs explaining.
        failed = [p for p in points
                  if not (summaries.get(int(p["idx"])) or {}).get(
                      "qualified", False)]
        pool = failed or points
        step = max(1, len(pool) // per_match)
        picks = pool[::step][:per_match]
        for point in picks:
            idx = int(point["idx"])
            try:
                clip = _clip_path(folder, point)
            except FileNotFoundError:
                continue
            fps, count, width, height = _clip_metadata(clip)
            cal = calibration
            if "size" not in cal:
                src = match.get("source") or {}
                cal = {**cal, "size": [int(src.get("width") or width),
                                       int(src.get("height") or height)]}
            corners = _scaled_corners(cal, width, height)
            frames = point_sample_frames(count, 3)
            cap = cv2.VideoCapture(str(clip))
            shots, crops = [], {"near": [], "far": []}
            try:
                for f in frames:
                    image = _read_frame(cap, f)
                    if image is None:
                        continue
                    boxes = dedupe_boxes([[float(v) for v in b]
                                          for b in det(image)])
                    chosen = choose_players(boxes, corners)
                    shots.append({"img": b64(annotate(image, corners, chosen)),
                                  "boxes": chosen.get("boxes") or [],
                                  "n": len(boxes)})
                    sides = [s for s in ("near", "far")
                             if chosen.get(s) is not None]
                    if not sides:
                        continue
                    kpts, scores = pose(image, bboxes=np.asarray(
                        [chosen[s] for s in sides], dtype=np.float32))
                    for i, side in enumerate(sides):
                        sig = torso_signature_v2(image, kpts[i], scores[i])
                        pts = [kpts[i][j] for j in (5, 6, 11, 12)
                               if float(scores[i][j]) >= TORSO_MIN_CONF]
                        crop_b64 = None
                        if len(pts) >= 3:
                            xs = [p[0] for p in pts]
                            ys = [p[1] for p in pts]
                            x0, x1 = int(max(0, min(xs))), int(min(width, max(xs)) + 1)
                            y0, y1 = int(max(0, min(ys))), int(min(height, max(ys)) + 1)
                            if x1 - x0 > 4 and y1 - y0 > 4:
                                crop_b64 = b64(image[y0:y1, x0:x1], CROP_W)
                        crops[side].append({
                            "crop": crop_b64, "sig": sig,
                            "joints": int(sum(
                                1 for j in (5, 6, 11, 12)
                                if float(scores[i][j]) >= TORSO_MIN_CONF)),
                        })
            finally:
                cap.release()
            stored = summaries.get(idx) or {}
            out.append({
                "match": folder.name, "idx": idx, "shots": shots,
                "crops": crops,
                "qualified": stored.get("qualified"),
                "near": stored.get("near"), "far": stored.get("far"),
                "coverage": (evidence or {}).get("coverage"),
                "foreshortening": (evidence or {}).get("foreshortening"),
            })
    return out


TABLE_CHOICES = [
    ("right", "Table is right"),
    ("wrong-table", "It found the wrong table"),
    ("not-a-table", "That is not a table"),
    ("loose", "Right table, sloppy corners"),
]
PLAYER_CHOICES = [
    ("both", "Both players right"),
    ("near-wrong", "Near is wrong"),
    ("far-wrong", "Far is wrong"),
    ("both-wrong", "Both wrong"),
    ("ends-swapped", "Ends are the wrong way round"),
    ("not-playing", "Picked someone not playing"),
]


def buttons(group: str, key: str, choices) -> str:
    return "".join(
        f'<button type="button" data-group="{group}" data-key="{html.escape(key)}"'
        f' data-v="{v}">{html.escape(label)}</button>'
        for v, label in choices)


def render(cases: list[dict], seeded: dict) -> str:
    by_match: dict[str, list[dict]] = {}
    for case in cases:
        by_match.setdefault(case["match"], []).append(case)

    blocks = []
    for match, group in by_match.items():
        short = match[:8]
        fatal = next((c["fatal"] for c in group if c.get("fatal")), None)
        head = group[0]
        cov = head.get("coverage") or {}
        meta = (f"coverage {cov.get('qualified')}/{cov.get('total')} · "
                f"camera {head.get('foreshortening')}"
                if not fatal else "")
        if fatal:
            blocks.append(
                f'<section class="match"><h2>{html.escape(short)}</h2>'
                f'<p class="bad">{html.escape(fatal)}</p></section>')
            continue

        points = []
        for case in group:
            shots = "".join(
                f'<figure><img src="data:image/jpeg;base64,{s["img"]}" alt="">'
                f'<figcaption>{s["n"]} people detected</figcaption></figure>'
                for s in case["shots"])
            sides = ""
            for side in ("near", "far"):
                summary = case.get(side) or {}
                items = "".join(
                    '<div class="crop">'
                    + (f'<img src="data:image/jpeg;base64,{c["crop"]}" alt="">'
                       if c.get("crop")
                       else '<div class="sw none">no torso</div>')
                    + swatch(c.get("sig"))
                    + f'<div class="tiny">{c["joints"]}/4 joints</div></div>'
                    for c in case["crops"][side]) or (
                    '<div class="tiny bad">nothing read at this end</div>')
                ok = summary.get("ok")
                sides += (
                    f'<div class="side"><h4>{side} end — '
                    + ("<span class=good>qualified</span>" if ok
                       else "<span class=bad>not qualified</span>")
                    + (f' · spread {summary.get("spread")} '
                       f'(limit {DEFAULT_CONFIG["spread_max"]})'
                       if summary.get("spread") is not None else "")
                    + f'</h4><div class="crops">{items}</div></div>')
            key = f"{short}@{case['idx']}"
            points.append(f"""
  <section class="case" data-key="{html.escape(key)}">
    <h3>point {case['idx']}
      {'<span class=good>qualified</span>' if case.get('qualified')
       else '<span class=bad>rejected</span>'}</h3>
    <div class="shots">{shots}</div>
    <div class="grid">{sides}</div>
    <div class="ask">
      <span class="q">The players it picked</span>
      <div class="opts">{buttons('players', key, PLAYER_CHOICES)}</div>
    </div>
  </section>""")

        blocks.append(f"""
<section class="match" data-match="{html.escape(short)}">
  <header>
    <h2>{html.escape(short)}</h2>
    <div class="meta">{meta}</div>
    <div class="ask">
      <span class="q">The table it found</span>
      <div class="opts">{buttons('table', short, TABLE_CHOICES)}</div>
    </div>
    <textarea data-note="{html.escape(short)}" rows="2"
      placeholder="Anything else about this match — what it should have
found, what is different about this venue"></textarea>
  </header>
  {''.join(points)}
</section>""")

    seed_json = json.dumps(seeded)
    n_tables = len([m for m in by_match])
    n_points = len([c for c in cases if not c.get("fatal")])
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>What the detector sees</title>
<style>
:root {{ color-scheme: dark; }}
body {{ margin:0; padding:24px; background:#09090b; color:#e4e4e7;
  font:15px/1.55 ui-sans-serif,-apple-system,Segoe UI,Roboto,sans-serif; }}
h1 {{ font-size:22px; margin:0 0 6px; }}
.legend {{ display:flex; gap:14px; flex-wrap:wrap; font-size:12px;
  color:#a1a1aa; margin-bottom:22px; }}
.key {{ display:inline-block; width:11px; height:11px; border-radius:2px;
  margin-right:5px; vertical-align:-1px; }}
.match {{ border:1px solid #27272a; border-radius:14px; padding:16px;
  margin-bottom:24px; background:#0e0e10; scroll-margin-top:96px; }}
.match > header {{ border-bottom:1px solid #27272a; padding-bottom:14px;
  margin-bottom:6px; }}
.case {{ border-top:1px solid #1c1c1f; padding:16px 0 4px;
  scroll-margin-top:96px; }}
h2 {{ font-size:16px; margin:0 0 4px; font-weight:600; }}
h3 {{ font-size:13px; margin:0 0 10px; font-weight:600; }}
h4 {{ font-size:12px; margin:0 0 8px; font-weight:600; color:#a1a1aa;
  text-transform:uppercase; letter-spacing:.05em; }}
.meta {{ font-size:12px; color:#71717a; margin-bottom:12px; }}
.ask {{ margin-top:12px; }}
.q {{ display:block; font-size:12px; color:#a1a1aa; margin-bottom:6px;
  text-transform:uppercase; letter-spacing:.05em; font-weight:600; }}
.opts {{ display:flex; gap:8px; flex-wrap:wrap; }}
button {{ font:inherit; font-size:14px; padding:7px 15px; border-radius:999px;
  border:1px solid #3f3f46; background:transparent; color:#e4e4e7;
  cursor:pointer; }}
button:hover {{ border-color:#52525b; }}
button[aria-pressed="true"] {{ border-color:#22d3ee; color:#22d3ee;
  background:rgba(34,211,238,.08); }}
textarea {{ width:100%; margin-top:12px; background:#141417; color:#e4e4e7;
  border:1px solid #3f3f46; border-radius:8px; padding:9px 11px;
  font:inherit; font-size:14px; resize:vertical; box-sizing:border-box; }}
textarea:focus {{ outline:none; border-color:#52525b; }}
.bar {{ position:sticky; top:0; z-index:5; background:#09090b;
  padding:12px 0 14px; border-bottom:1px solid #27272a; margin-bottom:22px;
  display:flex; align-items:center; gap:12px; flex-wrap:wrap; }}
.bar .grow {{ flex:1; }}
.done[data-done="1"] {{ opacity:.55; }}
.shots {{ display:flex; gap:10px; flex-wrap:wrap; }}
figure {{ margin:0; }} img {{ border-radius:8px; display:block;
  max-width:100%; }}
figcaption {{ font-size:11px; color:#71717a; margin-top:4px; }}
.grid {{ display:grid; grid-template-columns:1fr 1fr; gap:16px;
  margin-top:14px; }}
@media (max-width:820px) {{ .grid {{ grid-template-columns:1fr; }} }}
.crops {{ display:flex; gap:10px; flex-wrap:wrap; }}
.crop {{ text-align:center; }}
.sw {{ width:120px; height:26px; border-radius:5px; font-size:10px;
  line-height:26px; color:#000; font-weight:600; margin-top:4px; }}
.sw.none {{ background:#27272a; color:#71717a; }}
.tiny {{ font-size:11px; color:#71717a; margin-top:2px; }}
.good {{ color:#4ade80; }} .bad {{ color:#f87171; }}
</style></head><body>
<div class="bar">
  <div class="grow">
    <h1>What the detector sees</h1>
    <div class="meta" style="margin:0">
      Answered <strong id="tally">0</strong> of {n_tables} tables and
      {n_points} points
    </div>
  </div>
  <button type="button" id="copy">Copy feedback</button>
</div>
<div class="legend">
  <span><i class="key" style="background:rgb(60,210,255)"></i>table it found
    (A near-left, B near-right, C far-right, D far-left)</span>
  <span><i class="key" style="background:rgb(120,255,120)"></i>near end line
    A-B</span>
  <span><i class="key" style="background:rgb(255,130,255)"></i>far end line
    C-D</span>
  <span><i class="key" style="background:rgb(110,255,110)"></i>chosen as a
    player</span>
  <span><i class="key" style="background:rgb(150,150,150)"></i>a person, not
    chosen</span>
  <span><i class="key" style="background:rgb(220,90,90)"></i>rejected as too
    far from the table</span>
</div>
<p class="meta">A person belongs to the table when their feet land within
{NEAR_TABLE_FACTOR}x their own height of it — that is the thin circle. Their
end is whichever end line is nearer. The colour under each torso is what the
appearance comparison actually uses.</p>
{''.join(blocks)}
<script>
const KEY = 'ponglens-gameend-seen';
// Answers already given are baked in, so a rebuild keeps them even when
// opened from a different origin. Anything in localStorage is newer.
const store = Object.assign({seed_json},
  JSON.parse(localStorage.getItem(KEY) || '{{}}'));
function save() {{ localStorage.setItem(KEY, JSON.stringify(store)); }}
function slot(group, key) {{
  store[group] = store[group] || {{}};
  return store[group];
}}
function refresh() {{
  let n = 0;
  for (const g of ['table', 'players'])
    n += Object.keys(store[g] || {{}}).length;
  document.getElementById('tally').textContent = n;
  for (const el of document.querySelectorAll('.case')) {{
    el.classList.add('done');
    el.dataset.done = (store.players || {{}})[el.dataset.key] ? '1' : '0';
  }}
}}
for (const b of document.querySelectorAll('button[data-group]')) {{
  const g = b.dataset.group, k = b.dataset.key;
  b.addEventListener('click', () => {{
    const s = slot(g, k);
    s[k] = s[k] === b.dataset.v ? undefined : b.dataset.v;
    if (!s[k]) delete s[k];
    save();
    for (const other of document.querySelectorAll(
      `button[data-group="${{g}}"][data-key="${{CSS.escape(k)}}"]`))
      other.setAttribute('aria-pressed', String(s[k] === other.dataset.v));
    refresh();
  }});
  b.setAttribute('aria-pressed',
    String(((store[g] || {{}})[k]) === b.dataset.v));
}}
for (const t of document.querySelectorAll('textarea[data-note]')) {{
  const k = t.dataset.note;
  t.value = (store.notes || {{}})[k] || '';
  t.addEventListener('input', () => {{
    store.notes = store.notes || {{}};
    if (t.value.trim()) store.notes[k] = t.value.trim();
    else delete store.notes[k];
    save();
  }});
}}
document.getElementById('copy').addEventListener('click', async () => {{
  await navigator.clipboard.writeText(JSON.stringify(store, null, 2));
  const b = document.getElementById('copy');
  b.textContent = 'Copied';
  setTimeout(() => (b.textContent = 'Copy feedback'), 1200);
}});
refresh();
</script>
</body></html>"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--match", nargs="*", default=[])
    parser.add_argument("--per-match", type=int, default=4)
    parser.add_argument(
        "--feedback", type=Path, default=None,
        help="JSON of answers already given, baked in so a rebuild does "
             "not ask for them again")
    args = parser.parse_args()
    seeded = json.loads(args.feedback.read_text()) if args.feedback else {}
    cases = run(args.cache.expanduser(), args.match, args.per_match)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(render(cases, seeded))
    print(f"{len(cases)} points -> {args.out} "
          f"({args.out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()

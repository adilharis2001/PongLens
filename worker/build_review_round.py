"""The next review round: what is still missed, and what is still unjudged.

Three sections, in the order they are worth Adil's time.

  1. The changeovers still missed, drawn with the table in the RIGHT
     place. The previous page put the quad off the edge of the frame on
     50 of 62 matches, so every "the far player was not detected" note
     that came back was about the drawing rather than the detector.
  2. The fires a tighter spread gate would add. It recovers two known
     changeovers and adds three nobody has seen; the three decide it.
  3. Every fire in a match nobody has reviewed. Precision reads 100%, and
     it reads 100% over the two thirds of fires that have been looked at.
     This section is the other third.

Runs in the rtmpose venv, which has cv2 and rtmlib.
"""
from __future__ import annotations

import argparse
import base64
import html
import json
import sys
from pathlib import Path
from typing import Any

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_missed_page import (            # noqa: E402
    CACHE, draw_frame, encode, rally_view)
from extract_side_changes_rtmpose import (  # noqa: E402
    DET_MODEL_URL, _create_det_model, calibration_with_size)
from side_change import (                   # noqa: E402
    detect_side_changes, merge_config, summarize_point_side)

DESCRIPTOR = "lab+legs_lab"
SHIPPED: dict[str, float] = {}
TIGHTER = {"spread_max": 0.089}
CONTEXT = 3          # rallies either side of the break


def rebuild(evidence: dict, spread_max: float) -> list[dict]:
    parts = DESCRIPTOR.split("+")
    points = []
    for point in evidence.get("points") or []:
        bank = point.get("bank") or {}
        out = dict(point)
        out.pop("bank", None)
        for side in ("near", "far"):
            frames = []
            for frame in bank.get(side) or []:
                if (frame.get("_amb") or [0.0])[0] > 0.5:
                    continue
                vector: list[float] = []
                for part in parts:
                    piece = frame.get(part)
                    if not piece:
                        vector = []
                        break
                    vector.extend(piece)
                if vector:
                    frames.append(vector)
            out[side] = (summarize_point_side(frames, spread_max)
                         if frames else None)
        out["qualified"] = bool(
            out["near"] and out["far"]
            and out["near"]["ok"] and out["far"]["ok"])
        points.append(out)
    return points


CAUSES = (
    ("swapped", "they swapped ends"),
    ("same", "same ends, no change"),
    ("unclear", "cannot tell"),
)

PAGE = """<!doctype html><meta charset="utf-8">
<title>Game ends — round two</title>
<style>
:root {{ color-scheme: dark; }}
body {{ background:#0b0b0d; color:#e8e8ea; margin:0;
  font:15px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif; }}
main {{ max-width:1180px; margin:0 auto; padding:34px 22px 90px; }}
h1 {{ font-size:26px; margin:0 0 6px; }}
h2 {{ font-size:19px; margin:44px 0 8px; }}
.lede {{ color:#9a9aa2; margin:0 0 22px; max-width:70ch; }}
.mono {{ font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:13px; color:#9a9aa2; }}
.case {{ border:1px solid #26262c; border-radius:12px; padding:16px 16px 12px;
  margin:0 0 18px; background:#0f0f12; }}
.case[data-kind="tighter"] {{ border-color:#2b4a6f; }}
.case[data-kind="unjudged"] {{ border-color:#3f3a24; }}
header {{ display:flex; gap:14px; align-items:baseline; flex-wrap:wrap;
  margin:0 0 10px; }}
header b {{ font-size:16px; }}
.why {{ color:#e0c46a; font-size:14px; margin:2px 0 14px; }}
.pair {{ display:grid; grid-template-columns:1fr 1fr; gap:16px; }}
h4 {{ font-size:13px; color:#9a9aa2; margin:0 0 6px; font-weight:500; }}
.frames {{ display:flex; gap:6px; }}
figure {{ margin:0; flex:1 1 0; min-width:0; }}
img {{ width:100%; display:block; border-radius:5px; }}
.rally {{ margin:0 0 8px; }}
.state {{ color:#71717a; font-size:11.5px; padding-top:3px; }}
.verdicts {{ display:flex; gap:8px; margin:12px 0 0; flex-wrap:wrap; }}
.verdicts button {{ background:#17171b; color:#c8c8ce; cursor:pointer;
  padding:6px 14px; font:inherit; font-size:13px;
  border:1px solid #33333a; border-radius:999px; }}
.verdicts button[aria-pressed="true"] {{ background:#2a4a2a;
  border-color:#3f7a3f; color:#dfefdf; }}
.note {{ display:block; width:100%; margin:10px 0 0; background:#141418;
  border:1px solid #2a2a31; border-radius:8px; color:#e8e8ea;
  padding:8px 12px; font:inherit; font-size:13px; }}
.bar {{ position:fixed; right:18px; bottom:18px; }}
.bar button {{ background:#1d1d22; color:#e8e8ea; border:1px solid #3a3a42;
  border-radius:999px; padding:9px 18px; font:inherit; cursor:pointer; }}
@media (max-width:820px) {{ .pair {{ grid-template-columns:1fr; }} }}
</style>
<main>
<h1>Game ends — round two</h1>
<p class="lede">The table is drawn in the right place this time. On the
last page it was scaled wrong and landed off the edge of the picture on
most matches, so the boxes said nobody was detected when the detector was
finding both players. Blue outline is the table, green the near player,
amber the far one.</p>
{sections}
</main>
<div class="bar"><button id="copy">copy answers</button></div>
<script>
document.querySelectorAll('.verdicts button').forEach(b => {{
  b.onclick = () => {{
    b.closest('.verdicts').querySelectorAll('button')
      .forEach(o => o.setAttribute('aria-pressed', o === b));
  }};
}});
document.getElementById('copy').onclick = () => {{
  const out = {{}};
  document.querySelectorAll('.case').forEach(c => {{
    const picked = c.querySelector('.verdicts button[aria-pressed="true"]');
    const note = c.querySelector('.note').value.trim();
    if (picked || note) {{
      out[c.dataset.case] = {{}};
      if (picked) out[c.dataset.case].verdict = picked.dataset.v;
      if (note) out[c.dataset.case].note = note;
    }}
  }});
  navigator.clipboard.writeText(JSON.stringify(out, null, 1));
  document.getElementById('copy').textContent =
    Object.keys(out).length + ' copied';
}};
</script>
"""


def section(title: str, lede: str, cases: list[dict], kind: str) -> str:
    if not cases:
        return ""
    blocks = [f"<h2>{html.escape(title)}</h2>"
              f'<p class="lede">{lede}</p>']
    for case in cases:
        def strip(rallies):
            return "".join(
                '<div class="rally"><div class="frames">'
                + "".join(f'<figure><img src="data:image/jpeg;base64,{f}"'
                          f' alt=""></figure>' for f in r["frames"])
                + f'</div><div class="state">rally {r["idx"]} — '
                  f'{html.escape(r["state"])}</div></div>'
                for r in rallies)
        buttons = "".join(
            f'<button data-v="{k}">{html.escape(t)}</button>'
            for k, t in CAUSES)
        blocks.append(f"""
<article class="case" data-case="{html.escape(case['id'])}"
         data-kind="{kind}">
  <header><b>{html.escape(case['opponent'] or case['match'][:8])}</b>
    <span class="mono">{html.escape(case['match'][:8])}</span>
    <span class="mono">{html.escape(str(case['type'] or '—'))}</span>
    <span class="mono">break after rally {case['idx']}</span></header>
  <div class="why">{html.escape(case['why'])}</div>
  <div class="pair">
    <div><h4>before the break</h4>{strip(case['before'])}</div>
    <div><h4>after it</h4>{strip(case['after'])}</div>
  </div>
  <div class="verdicts">{buttons}</div>
  <input class="note" placeholder="anything you can see that it cannot?">
</article>""")
    return "\n".join(blocks)


def build(det, cache: Path, match_id: str, idx: int, spread: float,
          why: str, meta: dict) -> dict | None:
    folder = cache / match_id
    parsed = json.loads((folder / "match.json").read_text())
    calibration = calibration_with_size(parsed, 1920, 1080)
    evidence = json.loads((folder / "evidence-v4.json").read_text())
    points = rebuild(evidence, spread)
    summaries = {int(p["idx"]): p for p in points}
    order = sorted(summaries)
    if idx not in summaries:
        order_at = min(range(len(order)), key=lambda i: abs(order[i] - idx))
    else:
        order_at = order.index(idx)
    before_idx = order[max(0, order_at - CONTEXT + 1):order_at + 1]
    after_idx = order[order_at + 1:order_at + 1 + CONTEXT]
    before = [r for r in (rally_view(det, folder, parsed, calibration,
                                     i, summaries) for i in before_idx) if r]
    after = [r for r in (rally_view(det, folder, parsed, calibration,
                                    i, summaries) for i in after_idx) if r]
    if not before and not after:
        return None
    return {"id": f"{match_id[:8]}@{idx}", "match": match_id,
            "opponent": meta.get("opponent"), "type": meta.get("type"),
            "idx": idx, "why": why, "before": before, "after": after}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=CACHE)
    parser.add_argument("--targets", type=Path, required=True)
    parser.add_argument("--out", type=Path,
                        default=Path("docs/research/gameend-round2.html"))
    parser.add_argument("--det-model", default=DET_MODEL_URL)
    args = parser.parse_args()

    targets = json.loads(args.targets.read_text())
    folders = {d.name[:8]: d.name for d in args.cache.iterdir() if d.is_dir()}
    meta = {}
    page_data = args.cache / "page-data.json"
    if page_data.is_file():
        for m in json.loads(page_data.read_text())["matches"]:
            meta[m["match"][:8]] = {"opponent": m.get("opponent"),
                                    "type": m.get("type")}

    det = _create_det_model(args.det_model, "onnxruntime", "cpu")
    built: dict[str, list[dict]] = {}
    for group, entries in targets.items():
        spread = TIGHTER["spread_max"] if group == "tighter" else 0.130
        built[group] = []
        for entry in entries:
            key = entry["id"] if isinstance(entry, dict) else entry
            why = entry.get("why", "") if isinstance(entry, dict) else ""
            m8, _, index = key.partition("@")
            if m8 not in folders:
                print(f"  {key} no folder")
                continue
            case = build(det, args.cache, folders[m8], int(index), spread,
                         why, meta.get(m8, {}))
            if case:
                built[group].append(case)
                print(f"  {group} {key}", flush=True)

    sections = "\n".join([
        section("The changeovers still missed",
                "Both players are usually read perfectly well here and the "
                "change is still not called. This is the short list now.",
                built.get("missed", []), "missed"),
        section("Three fires a tighter gate would add",
                "Tightening one threshold recovers two changeovers we know "
                "are real, and produces these three as well. If they are "
                "real the threshold moves; if not it stays.",
                built.get("tighter", []), "tighter"),
        section("Fires in matches nobody has reviewed",
                "Precision reads 100%, over the fires that have been "
                "looked at. These are the rest of them, and they are the "
                "only thing that can move that number.",
                built.get("unjudged", []), "unjudged"),
    ])
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(PAGE.format(sections=sections))
    total = sum(len(v) for v in built.values())
    print(f"wrote {args.out} ({total} cases, "
          f"{args.out.stat().st_size / 1e6:.1f}MB)")


if __name__ == "__main__":
    main()

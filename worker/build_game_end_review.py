#!/usr/bin/env python3
"""Build the game-end (side-change) review page.

Every candidate boundary the detector considered, shown as the frames it
actually compared: the last point before the gap beside the first point
after it. If the players swapped ends, you can see it. If they did not,
the candidate is wrong and one click says so.

Deliberately works in match.json's OWN timebase and never touches the
points table. The 2026-08-26 failure was exactly that mixture — evidence
keyed by match.json idx, pinned onto database rows of the same idx, which
on a reprocessed match are different rallies. A review page that repeats
the mistake would show the wrong frames and teach us the wrong thing.

Usage (from the repo root, with the rtmpose venv for cv2):

  ~/Library/Caches/PongLens/rtmpose-production/venv/bin/python \
      worker/build_game_end_review.py \
      --cache ~/ponglens-research-work/game-end-eval \
      --out docs/research/gameend.html
"""

from __future__ import annotations

import argparse
import base64
import html
import json
from pathlib import Path
from typing import Any

import cv2

FRAME_W = 420
JPEG_QUALITY = 72


def clip_for(cache: Path, match: dict, idx: int) -> Path | None:
    for point in match.get("points") or []:
        if int(point["idx"]) != idx:
            continue
        name = str(point.get("clip") or "").split("/")[-1]
        candidate = cache / name
        if candidate.is_file():
            return candidate
        fallback = cache / f"point-{idx:03d}.mp4"
        return fallback if fallback.is_file() else None
    return None


def frame_b64(clip: Path, fraction: float) -> str | None:
    capture = cv2.VideoCapture(str(clip))
    try:
        if not capture.isOpened():
            return None
        count = int(round(capture.get(cv2.CAP_PROP_FRAME_COUNT)))
        if count <= 0:
            return None
        capture.set(
            cv2.CAP_PROP_POS_FRAMES,
            min(count - 1, max(0, int(round(count * fraction)))),
        )
        ok, image = capture.read()
    finally:
        capture.release()
    if not ok or image is None:
        return None
    height, width = image.shape[:2]
    if width > FRAME_W:
        image = cv2.resize(
            image,
            (FRAME_W, int(round(height * FRAME_W / width))),
            interpolation=cv2.INTER_AREA,
        )
    ok, buffer = cv2.imencode(
        ".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY]
    )
    if not ok:
        return None
    return base64.b64encode(buffer.tobytes()).decode("ascii")


def collect(cache: Path) -> list[dict[str, Any]]:
    cases = []
    for evidence_path in sorted(cache.glob("*/evidence.json")):
        folder = evidence_path.parent
        match_path = folder / "match.json"
        if not match_path.is_file():
            continue
        evidence = json.loads(evidence_path.read_text())
        match = json.loads(match_path.read_text())
        if evidence.get("algorithm") != "side-change-v2":
            continue
        summaries = {int(p["idx"]): p for p in evidence.get("points") or []}
        for change in evidence.get("side_changes") or []:
            after_idx = int(change["after_idx"])
            before_idx = int(change["before_idx"])
            after_clip = clip_for(cache=folder, match=match, idx=after_idx)
            before_clip = clip_for(cache=folder, match=match, idx=before_idx)
            if not after_clip or not before_clip:
                continue
            after_summary = summaries.get(after_idx) or {}
            before_summary = summaries.get(before_idx) or {}
            gap = None
            if after_summary.get("t1") is not None and before_summary.get(
                "t0"
            ) is not None:
                gap = round(
                    float(before_summary["t0"]) - float(after_summary["t1"]), 1
                )
            cases.append(
                {
                    "case_id": f"{folder.name[:8]}@{after_idx}",
                    "match": folder.name,
                    "after_idx": after_idx,
                    "before_idx": before_idx,
                    "confirmed": bool(change.get("confirmed")),
                    "confidence": change.get("confidence"),
                    "components": change.get("components") or {},
                    "gap_s": gap,
                    "foreshortening": evidence.get("foreshortening"),
                    "coverage": evidence.get("coverage") or {},
                    "frames": {
                        "after_early": frame_b64(after_clip, 0.3),
                        "after_late": frame_b64(after_clip, 0.7),
                        "before_early": frame_b64(before_clip, 0.3),
                        "before_late": frame_b64(before_clip, 0.7),
                    },
                }
            )
    return cases


def img(data: str | None, label: str) -> str:
    if not data:
        return f'<div class="miss">{html.escape(label)} — no frame</div>'
    return (
        f'<figure><img src="data:image/jpeg;base64,{data}" alt="">'
        f"<figcaption>{html.escape(label)}</figcaption></figure>"
    )


def render(cases: list[dict[str, Any]]) -> str:
    blocks = []
    for case in cases:
        components = case["components"]
        chips = [
            ("confirmed" if case["confirmed"] else "withheld"),
            f"confidence {case['confidence']}",
            f"gap {case['gap_s']}s" if case["gap_s"] is not None else "gap ?",
            f"margin {components.get('margin')}",
            f"stable {components.get('pre_stable_pairs')} before / "
            f"{components.get('post_stable_pairs')} after",
            f"camera {case['foreshortening']}",
        ]
        chip_html = "".join(
            f'<span class="chip">{html.escape(str(c))}</span>' for c in chips
        )
        coverage = case["coverage"]
        blocks.append(
            f"""
<section class="case" data-case="{html.escape(case['case_id'])}"
         data-confirmed="{'1' if case['confirmed'] else '0'}">
  <header>
    <h2>{html.escape(case['match'][:8])} · point {case['after_idx']}
        &rarr; {case['before_idx']}</h2>
    <div class="chips">{chip_html}</div>
    <div class="meta">qualified {coverage.get('qualified')} of
        {coverage.get('total')} points</div>
  </header>
  <div class="grid">
    <div class="side">
      <h3>Before the gap — point {case['after_idx']}</h3>
      <div class="frames">
        {img(case['frames']['after_early'], 'early')}
        {img(case['frames']['after_late'], 'late')}
      </div>
    </div>
    <div class="side">
      <h3>After the gap — point {case['before_idx']}</h3>
      <div class="frames">
        {img(case['frames']['before_early'], 'early')}
        {img(case['frames']['before_late'], 'late')}
      </div>
    </div>
  </div>
  <div class="verdicts">
    <button type="button" data-v="swapped">They swapped</button>
    <button type="button" data-v="same">Same ends</button>
    <button type="button" data-v="unclear">Can't tell</button>
  </div>
</section>"""
        )

    confirmed = sum(1 for c in cases if c["confirmed"])
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Game end review</title>
<style>
:root {{ color-scheme: dark; }}
body {{ margin:0; padding:24px; background:#09090b; color:#e4e4e7;
  font:15px/1.55 ui-sans-serif,-apple-system,Segoe UI,Roboto,sans-serif; }}
h1 {{ font-size:22px; margin:0 0 4px; }}
.tally {{ position:sticky; top:0; z-index:5; background:#09090b;
  padding:12px 0 16px; border-bottom:1px solid #27272a; margin-bottom:24px; }}
.tally strong {{ font-variant-numeric:tabular-nums; }}
.case {{ border:1px solid #27272a; border-radius:12px; padding:16px;
  margin-bottom:20px; background:#111113; }}
.case[data-done="1"] {{ opacity:.5; }}
h2 {{ font-size:15px; margin:0 0 8px; font-weight:600; }}
h3 {{ font-size:12px; margin:0 0 8px; font-weight:600; color:#a1a1aa;
  text-transform:uppercase; letter-spacing:.06em; }}
.chips {{ display:flex; flex-wrap:wrap; gap:6px; margin-bottom:6px; }}
.chip {{ font-size:11px; padding:2px 8px; border:1px solid #3f3f46;
  border-radius:999px; color:#a1a1aa; }}
.meta {{ font-size:12px; color:#71717a; }}
.grid {{ display:grid; grid-template-columns:1fr 1fr; gap:16px;
  margin:14px 0; }}
@media (max-width:820px) {{ .grid {{ grid-template-columns:1fr; }} }}
.frames {{ display:flex; gap:8px; }}
figure {{ margin:0; flex:1; }}
img {{ width:100%; border-radius:8px; display:block; }}
figcaption {{ font-size:11px; color:#71717a; margin-top:4px; }}
.miss {{ flex:1; padding:24px; text-align:center; color:#71717a;
  border:1px dashed #3f3f46; border-radius:8px; font-size:12px; }}
.verdicts {{ display:flex; gap:8px; flex-wrap:wrap; }}
button {{ font:inherit; font-size:14px; padding:7px 16px; border-radius:999px;
  border:1px solid #3f3f46; background:transparent; color:#e4e4e7;
  cursor:pointer; }}
button:hover {{ border-color:#52525b; }}
button[aria-pressed="true"] {{ border-color:#22d3ee; color:#22d3ee; }}
#copy {{ margin-left:auto; }}
.top {{ display:flex; align-items:center; gap:12px; }}
</style></head><body>
<div class="tally">
  <div class="top">
    <div>
      <h1>Game end review</h1>
      <div class="meta">{len(cases)} candidates, {confirmed} of them
        confirmed by the detector</div>
    </div>
    <button type="button" id="copy">Copy results</button>
  </div>
  <div class="meta" style="margin-top:8px">
    Judged <strong id="done">0</strong> of {len(cases)} ·
    confirmed candidates correct <strong id="prec">–</strong>
  </div>
</div>
{''.join(blocks)}
<script>
const KEY = 'ponglens-gameend-verdicts';
const store = JSON.parse(localStorage.getItem(KEY) || '{{}}');
function refresh() {{
  const cases = [...document.querySelectorAll('.case')];
  let done = 0, cHit = 0, cTotal = 0;
  for (const el of cases) {{
    const v = store[el.dataset.case];
    el.dataset.done = v ? '1' : '0';
    if (v) done++;
    if (el.dataset.confirmed === '1' && v && v !== 'unclear') {{
      cTotal++;
      if (v === 'swapped') cHit++;
    }}
  }}
  document.getElementById('done').textContent = done;
  document.getElementById('prec').textContent =
    cTotal ? `${{cHit}}/${{cTotal}} (${{Math.round(100 * cHit / cTotal)}}%)` : '–';
}}
for (const el of document.querySelectorAll('.case')) {{
  for (const b of el.querySelectorAll('.verdicts button')) {{
    b.addEventListener('click', () => {{
      const id = el.dataset.case;
      store[id] = store[id] === b.dataset.v ? undefined : b.dataset.v;
      if (!store[id]) delete store[id];
      localStorage.setItem(KEY, JSON.stringify(store));
      for (const other of el.querySelectorAll('.verdicts button')) {{
        other.setAttribute('aria-pressed',
          String(store[id] === other.dataset.v));
      }}
      refresh();
    }});
    b.setAttribute('aria-pressed',
      String(store[el.dataset.case] === b.dataset.v));
  }}
}}
document.getElementById('copy').addEventListener('click', async () => {{
  await navigator.clipboard.writeText(JSON.stringify(store, null, 2));
  const b = document.getElementById('copy');
  b.textContent = 'Copied';
  setTimeout(() => (b.textContent = 'Copy results'), 1200);
}});
refresh();
</script>
</body></html>"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    cases = collect(args.cache.expanduser())
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(render(cases))
    size_mb = args.out.stat().st_size / 1e6
    print(
        f"{len(cases)} candidates "
        f"({sum(1 for c in cases if c['confirmed'])} confirmed) "
        f"-> {args.out} ({size_mb:.1f} MB)"
    )


if __name__ == "__main__":
    main()

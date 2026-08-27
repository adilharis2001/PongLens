#!/usr/bin/env python3
"""The changeovers the detector missed, with what it saw at each one.

Adil confirmed by eye that 22 real changeovers went uncalled. Showing him
those frames again would only repeat the question. This page answers the
next one: at each miss, WHY did nothing fire — and it does that by
re-running the detector over exactly those rallies and drawing what it
picked, so a wrong choice is visible rather than inferred.

Three things per case:

  * the frames, with the table outlined and the two people the detector
    chose boxed on them — green for the near player, amber for the far
    one, grey for everyone else it looked at and rejected;
  * a plain-English reason, computed from the evidence rather than
    guessed: whether the rallies either side were unreadable, whether
    they read as the same arrangement, or whether the change was seen and
    refused;
  * somewhere to write down what you can see that the machine cannot.

Runs in the rtmpose venv (needs cv2, rtmlib and the ONNX models). Reads
JSON only, so it never touches the database.

  ~/Library/Caches/PongLens/rtmpose-production/venv/bin/python \\
      worker/build_missed_page.py --out docs/research/gameend-missed.html
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

# Flat imports on purpose. `import worker.side_change` resolves `worker`
# to worker.py, which pulls in boto3 and psycopg2 — neither of which the
# rtmpose venv has, and neither of which this page needs.
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from extract_side_changes_rtmpose import (  # noqa: E402
    DET_MODEL_URL, _create_det_model, _named_corners, _scaled_corners,
    choose_players, dedupe_boxes, point_frames,
)
from side_change import (  # noqa: E402
    _link_margin, detect_side_changes, merge_config, point_qualified,
    summarize_point_side, switch_cost,
)

CACHE = Path.home() / "ponglens-research-work" / "game-end-eval"
FRAME_W = 300
JPEG_QUALITY = 70
DESCRIPTOR = "lab+legs_lab"
SPREAD_MAX = 0.130


def rebuild(evidence: dict, name: str, spread_max: float) -> list[dict]:
    """Point summaries on the chosen descriptor, from the stored bank.

    A local copy rather than an import from sweep_descriptors, which
    reaches the database for truth and cannot load in this environment.
    """
    parts = name.split("+")
    points = []
    for point in evidence.get("points") or []:
        bank = point.get("bank") or {}
        rebuilt = dict(point)
        rebuilt.pop("bank", None)
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
            rebuilt[side] = (
                summarize_point_side(frames, spread_max) if frames else None)
        rebuilt["qualified"] = bool(
            rebuilt["near"] and rebuilt["far"]
            and rebuilt["near"]["ok"] and rebuilt["far"]["ok"])
        points.append(rebuilt)
    return points


# --- why nothing fired -------------------------------------------------------

def diagnose(points: list[dict], result: dict, idx: int) -> dict[str, Any]:
    """Why no change was placed at the break after rally `idx`.

    Computed from the evidence, not guessed. Every branch here is a
    different thing to fix, and telling them apart is the whole point of
    the page: "the players were never readable" and "the players were
    readable and looked the same" lead to opposite work.
    """
    config = merge_config(result.get("config"))
    qualified = [p for p in points if point_qualified(p)]
    if len(qualified) < 4:
        return {"kind": "coverage",
                "text": "this match had almost no rallies where both "
                        "players could be read at all"}
    before = [p for p in qualified if int(p["idx"]) <= idx]
    after = [p for p in qualified if int(p["idx"]) > idx]
    window = [p for p in points
              if abs(int(p["idx"]) - idx) <= 3]
    readable = sum(1 for p in window if point_qualified(p))
    if not before or not after:
        return {"kind": "coverage",
                "text": "no readable rally on one side of the break"}
    a, b = before[-1], after[0]
    reach = int(b["idx"]) - int(a["idx"])
    margin = _link_margin(a, b)
    detail = {
        "compared": f'{a["idx"]} vs {b["idx"]}',
        "reached_over": reach - 1,
        "readable_nearby": f"{readable} of {len(window)}",
    }
    if reach - 1 > int(config.get("link_max_skip", 8)):
        return {"kind": "coverage", "detail": detail,
                "text": f"the nearest readable rallies either side are "
                        f"{reach - 1} rallies apart, too far to compare"}
    if readable <= 2:
        return {"kind": "coverage", "detail": detail,
                "text": f"only {readable} of the {len(window)} rallies "
                        f"around the break could be read"}
    # It could compare them. What did the comparison say?
    changes = result.get("side_changes") or []
    nearby = [c for c in changes
              if abs(int(c["after_idx"]) - idx) <= 4]
    penalty = switch_cost(
        (float(b["t0"]) - float(a["t1"]))
        if a.get("t1") is not None and b.get("t0") is not None else None,
        config)
    detail["margin"] = round(-margin["margin"], 4)
    detail["needed"] = round(penalty, 4)
    if nearby:
        best = max(nearby, key=lambda c: c["confidence"])
        detail["confidence"] = best["confidence"]
        if not best.get("confirmed"):
            return {"kind": "refused", "detail": detail,
                    "text": f"it did see a change here and refused it — "
                            f"confidence {best['confidence']}, needs "
                            f"{config['min_confidence']}"}
        return {"kind": "misplaced", "detail": detail,
                "text": f"it placed a change at rally "
                        f"{best['after_idx']} instead, "
                        f"{abs(int(best['after_idx']) - idx)} rallies away"}
    if margin["margin"] > 0:
        return {"kind": "appearance", "detail": detail,
                "text": "the players either side of the break read as the "
                        "SAME arrangement — their colours did not swap"}
    return {"kind": "weak", "detail": detail,
            "text": "the swap was the better reading but not by enough to "
                    "pay for a change"}


# --- what it looked at -------------------------------------------------------

def draw_frame(image, corners, chosen) -> np.ndarray:
    picture = image.copy()
    try:
        named = _named_corners(corners)
        quad = np.asarray([named[k] for k in "ABCD"], np.int32)
        cv2.polylines(picture, [quad], True, (210, 180, 90), 2)
    except Exception:                                    # noqa: BLE001
        pass
    for box in chosen.get("boxes") or []:
        x0, y0, x1, y1 = [int(round(v)) for v in box["box"]]
        verdict = box.get("verdict") or ""
        if verdict.startswith("CHOSEN as the near"):
            colour, width = (110, 220, 140), 3
        elif verdict.startswith("CHOSEN as the far"):
            colour, width = (110, 200, 240), 3
        elif verdict.startswith("WOULD PICK"):
            colour, width = (110, 160, 240), 2
        elif verdict == "too far from the table":
            colour, width = (90, 90, 110), 1
        else:
            colour, width = (150, 150, 160), 1
        cv2.rectangle(picture, (x0, y0), (x1, y1), colour, width)
    return picture


def encode(image) -> str:
    height, width = image.shape[:2]
    if width > FRAME_W:
        image = cv2.resize(image, (FRAME_W, int(round(height * FRAME_W / width))),
                           interpolation=cv2.INTER_AREA)
    ok, buffer = cv2.imencode(".jpg", image,
                              [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    return base64.b64encode(buffer.tobytes()).decode("ascii") if ok else ""


def rally_view(det_model, folder: Path, match: dict, calibration: dict,
               idx: int, summaries: dict) -> dict | None:
    point = next((p for p in match.get("points") or []
                  if int(p["idx"]) == idx), None)
    if point is None:
        return None
    name = str(point.get("clip") or "").split("/")[-1]
    clip = folder / name
    if not clip.is_file():
        clip = folder / f"point-{idx:03d}.mp4"
    if not clip.is_file():
        return None
    capture = cv2.VideoCapture(str(clip))
    try:
        if not capture.isOpened():
            return None
        total = int(round(capture.get(cv2.CAP_PROP_FRAME_COUNT)))
        fps = float(capture.get(cv2.CAP_PROP_FPS)) or 30.0
        wanted, _ = point_frames(point, total, fps, 5)
        if not wanted:
            return None
        pictures = []
        for number in (wanted[len(wanted) // 2], wanted[-1]):
            capture.set(cv2.CAP_PROP_POS_FRAMES, number)
            ok, image = capture.read()
            if not ok or image is None:
                continue
            height, width = image.shape[:2]
            corners = _scaled_corners(calibration, width, height)
            boxes = dedupe_boxes([list(map(float, b))
                                  for b in det_model(image)])
            chosen = choose_players(boxes, corners)
            pictures.append(encode(draw_frame(image, corners, chosen)))
    finally:
        capture.release()
    summary = summaries.get(idx) or {}
    near, far = summary.get("near"), summary.get("far")
    if near and far and near.get("ok") and far.get("ok"):
        state = "both players read"
    elif near is None and far is None:
        state = "neither player found"
    elif near is None:
        state = "no near player found"
    elif far is None:
        state = "no far player found"
    elif not near.get("ok") and not far.get("ok"):
        state = "both players kept changing colour"
    elif not near.get("ok"):
        state = "the near player kept changing colour"
    else:
        state = "the far player kept changing colour"
    return {"idx": idx, "frames": pictures, "state": state}


PAGE = """<!doctype html><meta charset="utf-8">
<title>The changeovers it missed</title>
<style>
:root {{ color-scheme: dark; }}
body {{ background:#0b0b0d; color:#e7e7ea; font:15px/1.55 -apple-system,
  BlinkMacSystemFont,"Segoe UI",sans-serif; margin:0; padding:32px 28px 120px; }}
h1 {{ font-size:26px; margin:0 0 6px; }}
h2 {{ font-size:19px; margin:36px 0 10px; }}
h4 {{ font-size:13px; color:#9a9aa2; margin:0 0 6px; font-weight:500; }}
.lede {{ color:#9a9aa2; max-width:74ch; }}
.key {{ display:flex; gap:18px; flex-wrap:wrap; margin:18px 0 6px;
  font-size:13px; color:#9a9aa2; }}
.key span b {{ display:inline-block; width:11px; height:11px;
  border-radius:3px; margin-right:6px; vertical-align:-1px; }}
.groups {{ display:flex; gap:14px; flex-wrap:wrap; margin:18px 0 8px; }}
.groups div {{ background:#141418; border:1px solid #26262c;
  border-radius:12px; padding:12px 16px; min-width:150px; }}
.groups b {{ display:block; font-size:24px; }}
.groups span {{ color:#9a9aa2; font-size:12.5px; }}
.case[data-kind="candidate"] {{ border-color:#2b4a6f; }}
.case {{ border:1px solid #4a3030; border-radius:14px; padding:16px 18px;
  margin:16px 0; background:#141418; }}
.case header {{ display:flex; gap:12px; align-items:baseline;
  flex-wrap:wrap; margin-bottom:4px; }}
.mono {{ font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  color:#8f8f98; }}
.why {{ color:#e0c46a; font-size:14px; margin:6px 0 14px; }}
.why .kind {{ font-size:11px; text-transform:uppercase; letter-spacing:.06em;
  background:#3a3018; color:#e0c46a; padding:2px 8px; border-radius:999px;
  margin-right:8px; }}
.pair {{ display:flex; gap:22px; flex-wrap:wrap; }}
.rally {{ margin-bottom:10px; }}
.frames {{ display:flex; gap:6px; }}
figure {{ margin:0; }}
img {{ display:block; border-radius:8px; max-width:100%; }}
figcaption {{ color:#71717a; font-size:11px; padding-top:3px; }}
.state {{ color:#9a9aa2; font-size:12px; }}
.verdicts {{ display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; }}
.verdicts button {{ background:transparent; color:#e7e7ea; font:inherit;
  font-size:13px; border:1px solid #33333a; border-radius:999px;
  padding:5px 14px; cursor:pointer; }}
.verdicts button:hover {{ border-color:#5a5a66; }}
.verdicts button.on {{ background:#2b4a6f; border-color:#2b4a6f; }}
.note {{ margin-top:10px; width:100%; max-width:640px; background:#0f0f13;
  color:#e7e7ea; border:1px solid #33333a; border-radius:10px;
  padding:8px 12px; font:inherit; font-size:13px; }}
.detail {{ color:#71717a; font-size:11.5px; margin:10px 0 0;
  white-space:pre-wrap; }}
#out {{ position:fixed; right:20px; bottom:20px; background:#1b1b21;
  border:1px solid #33333a; border-radius:12px; padding:12px 16px;
  max-width:340px; font-size:13px; }}
#out button {{ background:#2b4a6f; color:#fff; border:0; border-radius:999px;
  padding:6px 14px; font:inherit; font-size:13px; cursor:pointer;
  margin-top:8px; }}
</style>
<h1>The changeovers it missed</h1>
<p class="lede">{missed} game endings you confirmed are real, that the
detector said nothing about. Each one is re-run here so you can see what
it was looking at: the table is outlined, and every person it considered
is boxed.</p>

<div class="key">
  <span><b style="background:#8cdc6e"></b>picked as the near player</span>
  <span><b style="background:#f0c86e"></b>picked as the far player</span>
  <span><b style="background:#f0a06e"></b>would have picked, refused as too
    similar in size to someone else</span>
  <span><b style="background:#9696a0"></b>looked at, not picked</span>
  <span><b style="background:#5a5a6e"></b>too far from the table</span>
  <span><b style="background:#5ab4d2"></b>the table</span>
</div>

<h2>Why nothing fired</h2>
<div class="groups">{groups}</div>
<p class="lede">These are computed from the evidence, not guessed, and
they need opposite fixes. <b>Could not read the players</b> means the
rallies around the break never gave a usable read on both ends — look at
whether the right people are boxed. <b>Read them as the same</b> means it
saw both players clearly and their colours did not appear to swap. <b>Saw
it and refused</b> means the change was found and did not clear the
confidence bar.</p>

{cases}

<div id="out">
  <div id="count">nothing marked yet</div>
  <button onclick="copyAll()">copy notes</button>
</div>
<script>
const out = {{}};
function touch(id) {{ out[id] = out[id] || {{}}; return out[id]; }}
function tally() {{
  document.getElementById('count').textContent =
    Object.keys(out).length + ' of {count} marked';
}}
document.querySelectorAll('.case').forEach(card => {{
  const id = card.dataset.case;
  card.querySelectorAll('.verdicts button').forEach(b => {{
    b.onclick = () => {{
      card.querySelectorAll('.verdicts button').forEach(o =>
        o.classList.remove('on'));
      b.classList.add('on');
      touch(id).cause = b.dataset.v;
      tally();
    }};
  }});
  const note = card.querySelector('.note');
  note.oninput = () => {{
    const text = note.value.trim();
    if (text) {{ touch(id).note = text; }} else if (out[id]) {{ delete out[id].note; }}
    tally();
  }};
}});
function copyAll() {{
  navigator.clipboard.writeText(JSON.stringify(out, null, 1));
  document.getElementById('count').textContent = 'copied';
}}
</script>
"""

CAUSES = (
    ("wrong-person", "it boxed the wrong person"),
    ("not-detected", "a player was not detected at all"),
    ("look-alike", "the two players look too similar"),
    ("table-wrong", "the table outline is wrong"),
    ("no-swap", "they did not actually swap here"),
    ("hard-to-see", "too dark, blurry or far away"),
)


def render(cases: list[dict], extra: list[dict], out: Path) -> None:
    groups = {}
    for case in cases:
        groups[case["why"]["kind"]] = groups.get(case["why"]["kind"], 0) + 1
    labels = {
        "coverage": "could not read the players",
        "appearance": "read them as the same",
        "refused": "saw it and refused",
        "weak": "swap was likelier, not by enough",
        "misplaced": "put the change elsewhere",
    }
    group_html = "".join(
        f'<div><b>{count}</b><span>{html.escape(labels.get(kind, kind))}'
        f"</span></div>"
        for kind, count in sorted(groups.items(), key=lambda kv: -kv[1])
    )
    blocks = []
    for case in cases + extra:
        def strip(rallies):
            out_html = []
            for rally in rallies:
                frames = "".join(
                    f'<figure><img src="data:image/jpeg;base64,{f}" alt="">'
                    f"</figure>" for f in rally["frames"])
                out_html.append(
                    f'<div class="rally"><div class="frames">{frames}</div>'
                    f'<div class="state">rally {rally["idx"]} — '
                    f'{html.escape(rally["state"])}</div></div>')
            return "".join(out_html)

        buttons = "".join(
            f'<button data-v="{key}">{html.escape(text)}</button>'
            for key, text in CAUSES)
        blocks.append(f"""
<article class="case" data-case="{html.escape(case['id'])}"
         data-kind="{html.escape(case['why']['kind'])}">
  <header>
    <b>{html.escape(case['opponent'] or case['match'][:8])}</b>
    <span class="mono">{html.escape(case['match'][:8])}</span>
    <span class="mono">{html.escape(str(case['type'] or '—'))}</span>
    <span class="mono">break after rally {case['idx']}</span>
  </header>
  <div class="why"><span class="kind">{html.escape(
      labels.get(case['why']['kind'], case['why']['kind']))}</span>
    {html.escape(case['why']['text'])}</div>
  <div class="pair">
    <div><h4>before the break</h4>{strip(case['before'])}</div>
    <div><h4>after it</h4>{strip(case['after'])}</div>
  </div>
  <div class="verdicts">{buttons}</div>
  <input class="note" placeholder="what do you see that it does not?">
  <pre class="detail">{html.escape(json.dumps(
      case['why'].get('detail') or {{}}, default=str))}</pre>
</article>""")
    out.parent.mkdir(parents=True, exist_ok=True)
    if extra:
        at = len(cases)
        blocks.insert(at, EXTRA_HEADING.format(count=len(extra)))
    out.write_text(PAGE.format(count=len(cases) + len(extra),
                               missed=len(cases), groups=group_html,
                               cases="\n".join(blocks)))
    print(f"wrote {out} ({len(cases)} misses, {len(extra)} candidates)")


EXTRA_HEADING = """
<h2>And {count} it would fire on if we loosened the bar</h2>
<p class="lede">Seven of the misses above sit just under the verification
threshold. Dropping it recovers eight of them — and adds these, which
nobody has looked at. If they are real changeovers the bar comes down; if
they are not, it stays where it is. That is the whole question.</p>
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=CACHE)
    parser.add_argument(
        "--verdicts", type=Path,
        default=Path("docs/research/2026-08-27-game-end-verdicts.json"))
    parser.add_argument(
        "--out", type=Path,
        default=Path("docs/research/gameend-missed.html"))
    parser.add_argument("--det-model", default=DET_MODEL_URL)
    parser.add_argument("--include-unclear", action="store_true")
    parser.add_argument(
        "--with-candidates", action="store_true",
        help=("also show the fires a looser verification bar would add, "
              "so one review settles whether to loosen it"))
    args = parser.parse_args()

    verdicts = json.loads(args.verdicts.read_text())
    page = json.loads((args.cache / "page-data.json").read_text())["matches"]
    wanted = {"swapped"} | ({"unclear"} if args.include_unclear else set())
    targets = []
    for match in page:
        for case in match["cases"]:
            key = f'{match["match"][:8]}@{case["after_idx"]}'
            if case["kind"] == "miss" and verdicts.get(key) in wanted:
                targets.append((match, case, key))
    print(f"{len(targets)} confirmed misses to show", flush=True)

    # The fires a looser bar would add. Seven of the confirmed misses sit
    # at a verify margin of 0.002 to 0.008 against a floor of 0.008 —
    # just under it. Dropping the floor recovers eight of the 22 and adds
    # about fifteen fires nobody has looked at, and THAT is the reason
    # not to simply ship the looser number: precision on judged fires
    # would still read 100% while fifteen unjudged ones carry the risk.
    # Showing them here settles it in one round rather than two.
    LOOSE = {"verify_margin": 0.002, "switch_penalty": 0.008,
             "confidence_scale": 0.016, "min_confidence": 0.35}
    candidates = []
    if args.with_candidates:
        for match in page:
            evidence_path = args.cache / match["match"] / "evidence.json"
            if not evidence_path.exists():
                continue
            points = rebuild(json.loads(evidence_path.read_text()),
                             DESCRIPTOR, SPREAD_MAX)
            tight = {
                int(c["after_idx"])
                for c in detect_side_changes(points, None)["side_changes"]
                if c["confirmed"]
            }
            for change in detect_side_changes(points, LOOSE)["side_changes"]:
                idx = int(change["after_idx"])
                key = f'{match["match"][:8]}@{idx}'
                if (not change["confirmed"] or idx in tight
                        or key in verdicts):
                    continue
                candidates.append((match, idx, key, change))
        print(f"{len(candidates)} extra fires a looser bar would add",
              flush=True)

    det_model = _create_det_model(args.det_model, "onnxruntime", "cpu")
    cases = []
    for match, case, key in targets:
        folder = args.cache / match["match"]
        parsed = json.loads((folder / "match.json").read_text())
        calibration = parsed.get("calibration") or {}
        evidence = json.loads((folder / "evidence.json").read_text())
        points = rebuild(evidence, DESCRIPTOR, SPREAD_MAX)
        result = detect_side_changes(points, None)
        summaries = {int(p["idx"]): p for p in points}
        before = [r for r in (
            rally_view(det_model, folder, parsed, calibration, i, summaries)
            for i in reversed(case.get("before") or [case["after_idx"]])
        ) if r]
        after = [r for r in (
            rally_view(det_model, folder, parsed, calibration, i, summaries)
            for i in (case.get("after") or [case["before_idx"]])
        ) if r]
        if not before and not after:
            continue
        cases.append({
            "id": key, "match": match["match"], "opponent": match["opponent"],
            "type": match["type"], "idx": case["after_idx"],
            "why": diagnose(points, result, int(case["after_idx"])),
            "before": before, "after": after,
        })
        print(f"  {key} {cases[-1]['why']['kind']}", flush=True)

    extra = []
    for match, idx, key, change in candidates:
        folder = args.cache / match["match"]
        parsed = json.loads((folder / "match.json").read_text())
        calibration = parsed.get("calibration") or {}
        points = rebuild(
            json.loads((folder / "evidence.json").read_text()),
            DESCRIPTOR, SPREAD_MAX)
        summaries = {int(p["idx"]): p for p in points}
        order = sorted(summaries)
        at = order.index(idx) if idx in summaries else None
        if at is None:
            continue
        before_idx = [order[i] for i in range(max(0, at - 2), at + 1)][::-1]
        after_idx = [order[i]
                     for i in range(at + 1, min(len(order), at + 4))]
        before = [r for r in (
            rally_view(det_model, folder, parsed, calibration, i, summaries)
            for i in before_idx) if r]
        after = [r for r in (
            rally_view(det_model, folder, parsed, calibration, i, summaries)
            for i in after_idx) if r]
        if not before and not after:
            continue
        extra.append({
            "id": key, "match": match["match"], "opponent": match["opponent"],
            "type": match["type"], "idx": idx,
            "why": {"kind": "candidate",
                    "text": "a looser verification bar would fire here — "
                            "did they swap?",
                    "detail": change.get("components")},
            "before": before, "after": after,
        })
        print(f"  + {key}", flush=True)
    render(cases, extra, args.out)


if __name__ == "__main__":
    main()

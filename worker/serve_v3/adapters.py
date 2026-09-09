"""Production's inputs, in the shapes the ported lab code expects.

Two structures, because the rule reads the players two different ways:

  `people`  every box the detector found, as FRACTIONS of the pose window,
            keyed by video frame index. The serve rule asks "was the ball
            inside anybody's box at this frame".
  `overlay` the same boxes named by end, with the distances production's
            own `choose_players` computed. `servedwell` asks "whose end was
            the ball dwelling at", and it deliberately re-derives the end
            from the table's own end lines rather than trusting the near/far
            labels, because on a camera that separates the players left to
            right those labels swap mid-serve.

Both are built here rather than written by the pose pass, so the pose pass
stays a record of what it saw and this stays a statement about how the serve
rule reads it.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from extract_side_changes_rtmpose import choose_players        # noqa: E402

CORNER_KEYS = ("A_near_1", "B_near_2", "C_far_2", "D_far_1")


def _boxes_of(frame):
    """Every box the detector found at this sample, in window pixels.

    `all` is written by the pose pass from 2026-09-09. A players file made
    before that carries only the two chosen players, and the caller is told
    so, because the person rules see fewer bystanders and answer differently.
    """
    if frame.get("all"):
        return [list(map(float, b))[:4] for b in frame["all"]]
    out = []
    for side in ("near", "far"):
        rec = frame.get(side)
        if rec and rec.get("box"):
            out.append([float(v) for v in rec["box"][:4]])
    return out


def people_inputs(players, corners_px, fps, people_fps=None):
    """(people, overlay, complete) from the pose pass's own output.

    `people_fps` exists for the parity fixture and nothing else. In the
    worker the boxes and the ball come off one video and share one clock, so
    it is None and `fps` is used for both. In the lab they do not: the person
    boxes are keyed by frame index on the people file's own rate and the ball
    track runs on the crop's, and the two differ by up to 0.05 fps. Without
    this the fixture cannot reproduce the lab exactly, and a fixture that
    cannot is not evidence.
    """
    people_fps = float(people_fps or fps)
    rect = players.get("rect")
    if not rect or len(rect) != 4:
        raise ValueError("the players file carries no window rectangle")
    ox, oy, w, h = (float(v) for v in rect)
    if w <= 0 or h <= 0:
        raise ValueError(f"the players window is empty: {rect}")
    corners_win = {k: [float(corners_px[k][0]) - ox, float(corners_px[k][1]) - oy]
                   for k in CORNER_KEYS}
    frames_by_index = {}
    rows = []
    complete = True
    for frame in players.get("frames") or []:
        t = float(frame["t"])
        boxes = _boxes_of(frame)
        if not frame.get("all"):
            complete = False
        if not boxes:
            continue
        frames_by_index[str(int(round(t * people_fps)))] = [
            [b[0] / w, b[1] / h, b[2] / w, b[3] / h] for b in boxes]
        named = []
        for rec in choose_players(boxes, corners_win).get("boxes", []):
            if rec.get("verdict") == "too far from the table":
                continue
            end = "near" if rec["d_near"] <= rec["d_far"] else "far"
            named.append([[round(float(v), 1) for v in rec["box"]], end,
                          round(float(rec["height"]), 1),
                          round(float(rec["d_near"]), 1),
                          round(float(rec["d_far"]), 1)])
        rows.append([round(t, 2), named])
    people = {"fps": people_fps, "crop": [ox, oy, w, h], "frames": frames_by_index}
    overlay = {"video": [w, h], "crop": [ox, oy, w, h], "frames": rows}
    return people, overlay, complete

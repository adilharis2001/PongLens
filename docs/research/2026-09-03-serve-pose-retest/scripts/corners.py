"""Resolve a clip's table quad in CLIP pixels. The trap this exists for:

`calibration.table_corners_px` is stored in whatever space the calibrator
ran in, and `calibration.size` says which — EXCEPT when it is null, which
means source pixels. The July harness read `size or [clip_w, clip_h]`, so a
null size silently meant "already clip space", and a 1920x1080 quad was
applied to a 720x406 clip. The quad then sits entirely off the frame, every
person measures as too far from the table, and the run reports no players
rather than an error.

Production's CURRENT calibration is preferred over the July snapshot's,
because three of the five matches have been recalibrated by the keypoint
detector since; the other two still carry the retired pink-rim quad and are
marked so they can be judged by eye rather than trusted.
"""
import json


def resolve(corners, size, source_wh, clip_wh):
    """Corners -> clip pixels, whatever space they were stored in."""
    if not corners:
        return None
    ref = size or source_wh          # null size means SOURCE pixels
    rw, rh = float(ref[0]), float(ref[1])
    cw, ch = float(clip_wh[0]), float(clip_wh[1])
    if rw <= 0 or rh <= 0:
        return None
    return {str(k): [float(v[0]) * cw / rw, float(v[1]) * ch / rh]
            for k, v in corners.items()}


def canonical(corners):
    """Rename to the A/B/C/D the side-change code expects."""
    out = {}
    for k, v in (corners or {}).items():
        kl = str(k).lower()
        letter = kl[0].upper()
        if letter in "ABCD":
            out[letter] = v
    return out if set(out) == set("ABCD") else None


def load_prod(path):
    return json.load(open(path))

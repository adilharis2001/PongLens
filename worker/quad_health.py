"""Label-free health check for a table calibration quad.

Step 2 and step 4 of the calibration ladder:

    1. primary calibrator (the pink-rim one)
    2. health check on its result          <-- this module
    3. if unhealthy -> vision fallback
    4. health check again                  <-- this module
    5. if still unhealthy -> degrade gracefully

Everything here runs at upload time, before any human has scored anything.
No signal reads points.deleted, kept/deleted spans, scored_at_cut_s, or any
other label. Verified by re-running the whole corpus with det=None and
gate_core=None: identical scores, no verdict flips.

WHAT IT MEASURES
----------------
One number: `edge_worst`, the minimum over the quad's four sides of the
fraction of that side lying within 0.003*width px of a Canny edge in the
median background frame. Construction reused verbatim from
vision_table_calibration._edge_support, which already ships.

The idea is narrow and worth stating plainly: a table has four visible
edges. A quad that has been dragged onto a banner, spread across a hall,
or slid off a corner puts at least one of its sides across open floor,
where there is no gradient underneath it. That side's support collapses
while the other three stay high, so the MINIMUM is the discriminative
statistic and the mean is not.

HOW WELL IT WORKS, BY WHAT IT IS ASKED TO JUDGE
-----------------------------------------------
These two numbers are very different and the difference matters:

  Pink-rim primary output (the failure this was built for)
      28 quads: 20 wrong, all 20 rejected; 8 correct, all 8 passed.
      Every one of the 8 scored a perfect 1.000. Clean separation.

  Vision-fallback output
      34 quads: accuracy 0.735. Eight WRONG quads passed, three of them
      at a perfect 1.000 (adil_2f71, ishaan_dffa, jason_9a81). One good
      quad was destroyed (santosh_6b7b at 0.433).

The reason for the gap is structural, not statistical: vision_calibrate
already validates its own proposals with this same _edge_support measure
(MIN_TOTAL_EDGE_SUPPORT, MIN_SINGLE_EDGE_SUPPORT). Step 4 therefore
re-applies the test the candidate was already selected to pass. It still
earns its place -- on the study corpus it traded 1 good quad for 8 fewer
wrong ones -- but it is a coarse backstop, not the sharp instrument that
step 2 is. Do not quote a single accuracy figure for both.

THRESHOLD PROVENANCE, STATED HONESTLY
-------------------------------------
EDGE_LO/EDGE_HI put the decision at edge_worst = 0.725. That is the
midpoint of the window (0.7143, 0.7380) measured on the study corpus,
whose LOWER bound is the highest-scoring WRONG quad in that corpus
(jake_cb0e) and whose upper bound is the lowest correct quad above it
(prabhas_abcd). The threshold is therefore fitted in-sample, to both
classes, on 45 matches across 4 venues. An earlier version of this
docstring claimed it was derived from the correct class alone; that was
wrong.

Consequences to keep in mind:
  - The window is 0.024 wide. Held-out selection (leave-one-out,
    leave-video-out, leave-venue-out) gives ~0.935 accuracy, not the
    in-sample 0.961.
  - kumar_a0f7 passes at 0.7342, inside the window. A cut anywhere in
    (0.7342, 0.7380) loses that fix.
  - Re-measure as venues accumulate. This is the first thing that should
    move when the corpus grows.

KNOWN BLIND SPOTS
-----------------
  - Neighbouring table. A quad fitted accurately to the table beside
    yours scores 1.000 and passes. Nothing in this module can see the
    difference, and no ball signal tested could either. That case belongs
    to the activity gate and the split ROI.
  - Transposed axes. A quad that traces the table perfectly but calls a
    long side the near end line scores 1.000 (jason_9a81 does exactly
    this). The homography then has the table 2.74 m across and 1.525 m
    along and the net axis runs the wrong way -- the one error the
    net-crossing rule and the serve detector cannot survive. Fixing it
    belongs in _canonical_calibration_geometry / canonicalize_table_quad,
    not here.
  - Barrel distortion bows a real table edge away from the straight quad
    side (ali_a52a, 0.305). A white line over a grey apron gives a broken
    Canny response (kumar_a0f7, bradley_f5a5, 0.684). Both read as
    unhealthy; both cost one vision call.

WHAT WAS TRIED AND REJECTED (numbers in health.md)
  - Ball containment in the table corridor: ANTI-DISCRIMINATIVE. An
    oversized wrong quad swallows the whole bounce cloud, so containment
    RISES as the quad gets worse. Wrong quads scored a higher median
    (0.92) than correct ones (0.89); the wrong-table quad jason_5bd2
    scored 0.96.
  - Rectangle consistency (implied focal / aspect, Zhang-He): a real
    signal but the wrong gate here. It adds no recall over edge support,
    and as a rescue it admits the corner_off family, whose aspect is a
    near-perfect 1.875 -- sliding a corner outward within the table's
    plane preserves rectangle consistency while putting a side across
    bare floor, which is precisely what edges catch.
  - Bounce-cloud centring: anti-discriminative, because it inherits
    activity_gate's own failure mode. Computed and reported as a
    diagnostic; DOES NOT GATE.

INPUTS ARE ALREADY IN HAND at both call sites. Prefer a FULL-RESOLUTION
median background: the tolerance radius is 0.003 * background width, so a
half-size frame doubles the effective tolerance in source terms and the
decision window is only 0.024 wide.
"""
from __future__ import annotations

import math

import numpy as np

# --- tunables ---------------------------------------------------------------
# Ramping edge_worst 0.60 -> 0.85 puts the score-0.5 decision at 0.725.
# Fitted in-sample on 45 matches / 4 venues; see THRESHOLD PROVENANCE above.
EDGE_LO, EDGE_HI = 0.60, 0.85     # worst-side edge support ramp
MIN_ANGLE_DEG = 12.0              # degenerate-shape guard
MIN_AREA_FRAC, MAX_AREA_FRAC = 0.0015, 0.45
THRESHOLD = 0.50                  # score < THRESHOLD  =>  unhealthy


def _ramp(x: float, lo: float, hi: float) -> float:
    """0 at lo, 1 at hi, linear between. Works for hi < lo (inverted)."""
    if hi == lo:
        return 1.0 if x >= hi else 0.0
    return float(min(1.0, max(0.0, (x - lo) / (hi - lo))))


def edge_support(image, corners) -> dict:
    """Fraction of each quad side that runs along a real image edge.

    Same construction as vision_table_calibration._edge_support.
    """
    import cv2
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 45, 135)
    dist = cv2.distanceTransform((edges == 0).astype(np.uint8), cv2.DIST_L2, 3)
    radius = max(3, round(image.shape[1] * 0.003))
    c = np.asarray(corners, np.float64)
    fracs = []
    for i in range(4):
        a, b = c[i], c[(i + 1) % 4]
        n = max(2, int(round(float(np.linalg.norm(b - a)))))
        pts = np.linspace(a, b, n)
        xs = np.clip(np.rint(pts[:, 0]).astype(int), 0, image.shape[1] - 1)
        ys = np.clip(np.rint(pts[:, 1]).astype(int), 0, image.shape[0] - 1)
        fracs.append(float(np.mean(dist[ys, xs] <= radius)))
    return {"fracs": [round(v, 4) for v in fracs],
            "mean": float(np.mean(fracs)),
            "worst": float(np.min(fracs))}


def _shape_ok(src, width, height) -> tuple[bool, str]:
    pts = [np.asarray(p, np.float64) for p in src]
    cross, angles = [], []
    for i in range(4):
        p0, p1, p2 = pts[i - 1], pts[i], pts[(i + 1) % 4]
        v1, v2 = p0 - p1, p2 - p1
        n1, n2 = np.linalg.norm(v1), np.linalg.norm(v2)
        if n1 < 1e-6 or n2 < 1e-6:
            return False, "degenerate side"
        angles.append(math.degrees(math.acos(
            float(np.clip(np.dot(v1, v2) / (n1 * n2), -1, 1)))))
        cross.append(float(v1[0] * v2[1] - v1[1] * v2[0]))
    if not (all(c > 0 for c in cross) or all(c < 0 for c in cross)):
        return False, "quad is not convex"
    if min(angles) < MIN_ANGLE_DEG:
        return False, f"corner angle {min(angles):.0f} deg too sharp"
    area = 0.5 * abs(sum(
        src[i][0] * src[(i + 1) % 4][1] - src[(i + 1) % 4][0] * src[i][1]
        for i in range(4)))
    frac = area / float(width * height)
    if not (MIN_AREA_FRAC <= frac <= MAX_AREA_FRAC):
        return False, f"area {frac:.4f} of frame implausible"
    return True, ""


CORNER_KEYS = ("A_near_1", "B_near_2", "C_far_2", "D_far_1")


def as_quad(corners) -> np.ndarray:
    """Accept either a 4x2 sequence or calibrate()'s corners_px dict."""
    if isinstance(corners, dict):
        return np.asarray([corners[k] for k in CORNER_KEYS], np.float32)
    return np.asarray(corners, np.float32)


def quad_health(corners, background, det=None, width=None, height=None,
                gate_core=None) -> dict:
    """Score a candidate quad in [0, 1]. Lower is worse.

    corners     4x2 px, OR calibrate()/vision_calibrate()'s corners_px dict
    background  median-background BGR frame; FULL RESOLUTION preferred
    width,height  SOURCE frame size; the background may be smaller
    det         {frame: (x, y)} ball detections, optional (diagnostic only)
    gate_core   activity_gate()["core"] bbox, optional (diagnostic only)

    Returns {"score", "healthy", "reasons", "parts"}.

    NOTE ON THE NO-BACKGROUND CASE: this returns healthy=False, i.e. it
    discards a calibration it could not check. That is fail-CLOSED, and it
    is the opposite of the convention used for email suppression lookups
    elsewhere in this codebase. It is deliberate here -- the whole point of
    the ladder is that an unverified quad is worse than no quad, because
    the split ROI and the crossing rule silently believe whatever they are
    given. But it means a decode failure costs the calibration, so the
    caller should make sure a background is actually available rather than
    relying on this branch.
    """
    import points_pipeline as pp

    if background is None:
        return {"score": 0.0, "healthy": False,
                "reasons": ["no background frame available for health check"],
                "parts": {}}
    if width is None or height is None:
        height, width = background.shape[:2]

    corners = as_quad(corners)
    reasons, parts = [], {}

    # -- 0. the quad must survive canonicalisation ------------------------
    try:
        src, H, _e, _rect = pp._canonical_calibration_geometry(corners)
    except Exception as exc:                                # noqa: BLE001
        return {"score": 0.0, "healthy": False,
                "reasons": [f"canonicalisation failed: {exc}"],
                "parts": {}}

    # -- 1. shape sanity ---------------------------------------------------
    ok, why = _shape_ok(src, width, height)
    if not ok:
        return {"score": 0.0, "healthy": False, "reasons": [why],
                "parts": {}}

    # -- 2. edge support: is this a real table? ---------------------------
    # `corners` are in SOURCE pixels; the background may be a downscaled
    # representative frame. Scale the quad into the background's own pixel
    # space before measuring.
    bh_, bw_ = background.shape[:2]
    fx, fy = bw_ / float(width), bh_ / float(height)
    src_bg = np.asarray(src, np.float64) * np.array([fx, fy])
    es = edge_support(background, src_bg)
    s_edge = _ramp(es["worst"], EDGE_LO, EDGE_HI)
    parts["edge_worst"] = round(es["worst"], 4)
    parts["edge_mean"] = round(es["mean"], 4)
    parts["s_edge"] = round(s_edge, 4)
    parts["bg_scale"] = round(float(fx), 4)
    if s_edge < 1.0:
        reasons.append(
            f"weakest side only {es['worst']:.2f} supported by image edges "
            f"(sides {es['fracs']})")

    # -- 3. bounce-cloud centring: DIAGNOSTIC ONLY, does not gate ---------
    # Kept because it is the only handle on the neighbour-table blind spot,
    # but it does not enter the score: on this dataset it was
    # anti-discriminative (see the module docstring).
    if det and gate_core is not None:
        try:
            cx0, cx1, cy0, cy1 = gate_core
            centre = np.array([[(cx0 + cx1) / 2.0, (cy0 + cy1) / 2.0, 1.0]])
            q = centre @ np.asarray(H, np.float64).T
            w = q[0, 2] if abs(q[0, 2]) > 1e-9 else 1e-9
            u, v = q[0, 0] / w, q[0, 1] / w
            parts["core_ctr_off"] = round(
                math.hypot(u / pp.W_M - 0.5, v / pp.L_M - 0.5), 4)
        except Exception:                                   # noqa: BLE001
            pass

    score = s_edge
    return {"score": round(float(score), 4),
            "healthy": score >= THRESHOLD,
            "reasons": reasons, "parts": parts}

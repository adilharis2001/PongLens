"""Turn a 13-channel table-keypoint heatmap into one table quad.

The obvious reading of these heatmaps — take each channel's strongest
response — is the thing that fails in a club. Every channel picks its own
peak, neighbouring tables answer to the same semantics, and the result is
thirteen points drawn from two or three DIFFERENT tables. On the 62
hand-marked matches of the 2026-08-16 corpus, 56 of them had at least one
keypoint sitting on a table nobody was playing on. That is the whole reason
the naive reading scored a superb 0.38% median with 22 catastrophic
failures and nothing in between.

So instead: take several peaks per channel, then look for the set of peaks
that agree on ONE metric table. A homography from the real 2.740 x 1.525 m
table to the image explains eleven of the thirteen keypoints exactly — the
two net-top points sit 0.1525 m above the plane and are dropped — which
makes "agree on one table" a concrete, checkable statement rather than a
feeling. The winning fit also repairs any keypoint whose own peak was
wrong, because the answer comes from the homography and not from the peaks.

One rule for every image, never a per-venue tweak: most inlier weight wins,
then, among the tables that a real camera could be looking at, the largest.
Measured 0.27% median corner error, 0 gross failures, 59/62 good.
"""

from __future__ import annotations

import math

import cv2
import numpy as np

try:
    from . import table_keypoint_camera as camera
except ImportError:                                  # run as a script
    import table_keypoint_camera as camera  # type: ignore


TABLE_LENGTH_M = 2.740
TABLE_WIDTH_M = 1.525
NET_OVERHANG_M = 0.1525                  # the net juts past each side line

# The eleven keypoints that lie IN the table plane, by channel index. The two
# omitted channels (9, 10) are the net's top corners, which stand above the
# plane and so cannot be explained by a plane-to-image homography.
WORLD = {
    0: (-TABLE_LENGTH_M / 2, TABLE_WIDTH_M / 2),                  # near left
    1: (-TABLE_LENGTH_M / 2, -TABLE_WIDTH_M / 2),                 # near right
    2: (0.0, TABLE_WIDTH_M / 2),                                  # centre left
    3: (0.0, -TABLE_WIDTH_M / 2),                                 # centre right
    4: (TABLE_LENGTH_M / 2, TABLE_WIDTH_M / 2),                   # far left
    5: (TABLE_LENGTH_M / 2, -TABLE_WIDTH_M / 2),                  # far right
    6: (0.0, TABLE_WIDTH_M / 2 + NET_OVERHANG_M),                 # net left foot
    7: (0.0, -(TABLE_WIDTH_M / 2 + NET_OVERHANG_M)),              # net right foot
    8: (0.0, 0.0),                                                # net centre foot
    11: (-TABLE_LENGTH_M / 2, 0.0),                               # near centre
    12: (TABLE_LENGTH_M / 2, 0.0),                                # far centre
}
IN_PLANE = sorted(WORLD)

# near-left, near-right, far-right, far-left: one loop round the table, and
# the same A/B/C/D the rest of the pipeline means by those letters.
CORNERS = [0, 1, 5, 4]

# Minimal sets used to seed a homography. Each is four points in general
# position; between them they cover the cases where only the near half, only
# the far half, or only the middle of the table is legible — which is what a
# player standing in front of the near corners actually does to a frame.
SEEDS = [
    (0, 1, 5, 4), (0, 1, 3, 2), (2, 3, 5, 4), (0, 1, 7, 6), (6, 7, 5, 4),
    (11, 12, 2, 3), (11, 12, 6, 7), (0, 1, 12, 8), (4, 5, 11, 8),
    (0, 3, 5, 2), (1, 2, 4, 3), (0, 1, 5, 12), (0, 11, 5, 4),
]

DEFAULTS = {
    "peaks_per_channel": 5,
    "tolerance_fraction": 0.10,
    "tolerance_min": 8.0,
    "tolerance_max": 40.0,
    "weight_band": 0.90,
    "max_clusters": 8,
    "same_table_iou": 0.5,
    "min_camera_height_m": 0.35,
}


# ---------------------------------------------------------------------------
# Heatmap -> candidate keypoints
# ---------------------------------------------------------------------------
def peaks_from_heatmap(heatmap, k=5, absolute_min=0.12, relative_min=0.25,
                       suppression=4):
    """Up to k subpixel local maxima per channel, in heatmap cell units."""
    channels, height, width = heatmap.shape
    out: dict[int, list[tuple[float, float, float]]] = {}
    for channel in range(channels):
        plane = heatmap[channel]
        threshold = max(absolute_min, relative_min * float(plane.max()))
        # A cell is a local maximum when it equals its own 3x3 dilation.
        dilated = cv2.dilate(plane, np.ones((3, 3), np.uint8))
        ys, xs = np.where((plane >= dilated - 1e-9) & (plane >= threshold))
        values = plane[ys, xs]
        picked: list[tuple[int, int]] = []
        out.setdefault(channel, [])
        for index in np.argsort(-values):
            y, x = int(ys[index]), int(xs[index])
            value = float(values[index])
            if any((y - py) ** 2 + (x - px) ** 2 < suppression ** 2
                   for py, px in picked):
                continue
            dx, dy = _subpixel_offset(plane, x, y, width, height)
            picked.append((y, x))
            out[channel].append((x + dx, y + dy, value))
            if len(out[channel]) >= k:
                break
    return out


def _subpixel_offset(plane, x, y, width, height):
    """DARK-style offset from the 3x3 log-heatmap around an integer peak.

    A heatmap cell is eight source pixels wide at this resolution, so
    rounding to the cell centre alone would cost more accuracy than every
    other step in this file combined.
    """
    if not (0 < x < width - 1 and 0 < y < height - 1):
        return 0.0, 0.0
    patch = np.log(np.clip(plane[y - 1:y + 2, x - 1:x + 2], 1e-6, None))
    gx = 0.5 * (patch[1, 2] - patch[1, 0])
    gy = 0.5 * (patch[2, 1] - patch[0, 1])
    hxx = patch[1, 2] - 2 * patch[1, 1] + patch[1, 0]
    hyy = patch[2, 1] - 2 * patch[1, 1] + patch[0, 1]
    dx = float(np.clip(-gx / hxx, -1, 1)) if hxx < -1e-9 else 0.0
    dy = float(np.clip(-gy / hyy, -1, 1)) if hyy < -1e-9 else 0.0
    return dx, dy


def to_canvas(peaks, heatmap_shape, canvas=(1920, 1080)):
    """Heatmap cells -> the canvas the model is evaluated on."""
    _channels, height, width = heatmap_shape
    sx, sy = canvas[0] / width, canvas[1] / height
    return {
        channel: [((x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5, value)
                  for x, y, value in found]
        for channel, found in peaks.items()
    }


# ---------------------------------------------------------------------------
# Quad geometry
# ---------------------------------------------------------------------------
def signed_area(quad) -> float:
    total = 0.0
    for i in range(4):
        x1, y1 = quad[i]
        x2, y2 = quad[(i + 1) % 4]
        total += x1 * y2 - x2 * y1
    return total / 2.0


def is_convex(quad) -> bool:
    signs = []
    for i in range(4):
        ax, ay = quad[i]
        bx, by = quad[(i + 1) % 4]
        cx, cy = quad[(i + 2) % 4]
        # NumPy 2 removed the 2-D cross product, so the z component is
        # written out. An exception here silently killed a whole blind run.
        signs.append(np.sign((bx - ax) * (cy - by) - (by - ay) * (cx - bx)))
    return abs(sum(signs)) == 4


def edge_lengths(quad) -> list[float]:
    return [math.dist(quad[i], quad[(i + 1) % 4]) for i in range(4)]


def quad_ok(quad, canvas) -> bool:
    """The loosest possible sanity gate: is this a quadrilateral at all?

    Deliberately permissive. It runs inside the hypothesis loop where a real
    table must survive every camera angle in the corpus, so the sharp
    per-frame judgement lives in frame_verdict() instead.
    """
    if not is_convex(quad):
        return False
    area = abs(signed_area(quad))
    if area < 0.004 * canvas[0] * canvas[1]:     # smaller than a distant table
        return False
    if area > 0.9 * canvas[0] * canvas[1]:
        return False
    lengths = edge_lengths(quad)
    if min(lengths) < 1e-6 or max(lengths) / min(lengths) > 12:
        return False
    return True


def same_table(quad_a, quad_b, threshold=0.5) -> bool:
    """Two hypotheses describe one table when their quads overlap well."""
    a = np.asarray(quad_a, np.float32)
    b = np.asarray(quad_b, np.float32)
    intersection, _points = cv2.intersectConvexConvex(a, b)
    union = abs(signed_area(quad_a)) + abs(signed_area(quad_b)) - intersection
    return union > 0 and intersection / union >= threshold


def project(H, ids):
    world = np.array([[WORLD[i][0], WORLD[i][1], 1.0] for i in ids]).T
    values = np.asarray(H, dtype=np.float64) @ world
    return (values[:2] / values[2]).T


def _tolerance_for(quad, params) -> float:
    """How far a keypoint may sit from where the fit says it should be.

    Scaled to the table's own apparent size rather than to the picture: a
    table fifteen metres away occupies a tenth of the pixels and its
    keypoints are correspondingly closer together, so a fixed pixel budget
    would let a distant table collect inliers it has not earned.
    """
    scale = math.sqrt(abs(signed_area(quad)) + 1e-6)
    return float(np.clip(params["tolerance_fraction"] * scale,
                         params["tolerance_min"], params["tolerance_max"]))


def _score(H, candidates, tolerance):
    """Inlier weight: per in-plane channel, the best peak within tolerance of
    where this homography says that keypoint must be, weighted by activation."""
    predicted = project(H, IN_PLANE)
    total, count, residuals, used = 0.0, 0, [], {}
    for index, channel in enumerate(IN_PLANE):
        ex, ey = predicted[index]
        best = None
        for x, y, value in candidates.get(channel, []):
            distance = math.hypot(x - ex, y - ey)
            if distance <= tolerance and (best is None or value > best[2]):
                best = (x, y, value, distance)
        if best is not None:
            total += min(best[2], 1.2)      # one blazing channel cannot carry a fit
            count += 1
            residuals.append(best[3])
            used[channel] = best[:3]
    return total, count, used, residuals


def _refine(H, candidates, canvas, params, rounds=5):
    """Least squares over the current inliers, re-select, repeat."""
    for _ in range(rounds):
        quad = project(H, CORNERS)
        tolerance = _tolerance_for(quad, params)
        _total, count, used, _residuals = _score(H, candidates, tolerance)
        if count < 4:
            break
        source = np.array([WORLD[c] for c in used], np.float32)
        target = np.array([used[c][:2] for c in used], np.float32)
        refined, _mask = cv2.findHomography(source, target, 0)
        if refined is None or not np.all(np.isfinite(refined)):
            break
        if not quad_ok(project(refined, CORNERS), canvas):
            break
        H = refined
    return H


def fit_table(heatmap, canvas=(1920, 1080), **overrides):
    """The best single-table explanation of one heatmap stack, or None.

    Every surviving hypothesis is a projection of the real table, so a frame
    with three tables in it produces three CLUSTERS of hypotheses rather than
    one blurred average of all three.
    """
    params = dict(DEFAULTS)
    params.update({k: v for k, v in overrides.items() if v is not None})
    candidates = to_canvas(
        peaks_from_heatmap(heatmap, k=params["peaks_per_channel"]),
        heatmap.shape, canvas)

    hypotheses = []
    for seed in SEEDS:
        lists = [candidates.get(channel, []) for channel in seed]
        if any(not entries for entries in lists):
            continue
        source = np.array([WORLD[channel] for channel in seed], np.float32)
        for a in lists[0]:
            for b in lists[1]:
                for c in lists[2]:
                    for d in lists[3]:
                        target = np.array(
                            [a[:2], b[:2], c[:2], d[:2]], np.float32)
                        try:
                            H = cv2.getPerspectiveTransform(source, target)
                        except cv2.error:
                            continue
                        if not np.all(np.isfinite(H)):
                            continue
                        quad = project(H, CORNERS)
                        if not quad_ok(quad, canvas):
                            continue
                        total, count, _used, _residuals = _score(
                            H, candidates, _tolerance_for(quad, params))
                        if count < 4:
                            continue
                        hypotheses.append((total, H, quad))
    if not hypotheses:
        return None

    # One cluster per table in the picture, each represented by its best
    # hypothesis so far.
    hypotheses.sort(key=lambda item: -item[0])
    clusters = []
    for total, H, quad in hypotheses:
        if any(same_table(quad, existing[2], params["same_table_iou"])
               for existing in clusters):
            continue
        clusters.append((total, H, quad))
        if len(clusters) >= params["max_clusters"]:
            break

    # Refine each candidate table BEFORE comparing them, so the comparison is
    # between the best each one can do rather than between two seed accidents.
    refined = []
    for _total, H, seed_quad in clusters:
        improved = _refine(H, candidates, canvas, params)
        quad = project(improved, CORNERS)
        if not quad_ok(quad, canvas):
            improved, quad = H, seed_quad
        total, count, used, residuals = _score(
            improved, candidates, _tolerance_for(quad, params))
        cameras = camera.camera_candidates(improved, canvas)
        height = max((c["height"] for c in cameras), default=None)
        refined.append({
            "H": improved,
            "quad": quad,
            "weight": total,
            "inliers": count,
            "used": used,
            "residuals": residuals,
            "area": abs(signed_area(quad)),
            # No camera at all means "cannot judge", which is not the same as
            # "implausible" and must not be treated as a rejection.
            "plausible": (not cameras
                          or height >= params["min_camera_height_m"]),
            "camera_height": height,
        })

    # A table that refined onto another table's answer is not a second table.
    deduped = []
    for entry in sorted(refined, key=lambda r: -r["weight"]):
        if any(same_table(entry["quad"], kept["quad"], params["same_table_iou"])
               for kept in deduped):
            continue
        deduped.append(entry)

    best_weight = max(entry["weight"] for entry in deduped)
    live = [e for e in deduped if e["weight"] >= params["weight_band"] * best_weight]
    plausible = [e for e in live if e["plausible"]] or live
    chosen = max(plausible, key=lambda e: e["area"])

    quad = [[float(x), float(y)] for x, y in chosen["quad"]]
    # One winding for every image. Near-left, near-right, far-right, far-left
    # runs the same way round the picture whenever the camera is above the
    # table, which it is in every frame of this footage.
    if signed_area(quad) > 0:
        quad = [quad[0], quad[3], quad[2], quad[1]]

    return {
        "quad": quad,
        "inliers": chosen["inliers"],
        "weight": float(chosen["weight"]),
        "inlier_channels": sorted(chosen["used"]),
        "median_residual": (float(np.median(chosen["residuals"]))
                            if chosen["residuals"] else None),
        "area": float(chosen["area"]),
        "tables_seen": len(deduped),
        "camera_height": chosen["camera_height"],
        "homography": np.asarray(chosen["H"], dtype=float).tolist(),
    }


# ---------------------------------------------------------------------------
# Per-frame judgement
# ---------------------------------------------------------------------------
# Thresholds from the 660-frame convergence study (33 matches x 20 frames);
# see docs/research/2026-08-16-table-detection/CONVERGENCE_FINDINGS.md.
#
# The edge ratio is by far the strongest single signal at 0.94 AUC. The
# fitter's own internal limit of 12 exists so a real table survives every
# camera angle during hypothesis generation; as a JUDGEMENT it is far too
# loose, and 4 is where wrong answers start and right ones have stopped.
MIN_INLIER_WEIGHT = 6.0
MAX_CORNER_OVERSHOOT = 0.05      # of the image diagonal, outside the picture
MAX_EDGE_RATIO = 4.0


def frame_verdict(result, width: int, height: int) -> tuple[bool, str]:
    """Is one frame's answer worth pooling? Returns (keep, reason).

    This is the geometry half of the design. It cannot be dropped in favour
    of pooling alone: on `cb0e7027`, eight of twenty frames land on the
    NEIGHBOURING table and agree with each other to 0.16% — tighter than the
    five correct frames — so a vote returns a confident 40% error and only
    this function notices that every one of those eight puts a corner far
    outside the picture. The converse also holds: on `431837d2` all seven
    wrong frames pass every test here and only the vote saves the match.
    Neither mechanism covers the other's blind spot.
    """
    if result is None:
        return False, "no fit"
    quad = result["quad"]
    if result.get("weight", 0.0) < MIN_INLIER_WEIGHT:
        return False, f"weak support ({result.get('weight', 0):.1f})"

    diagonal = math.hypot(width, height)
    overshoot = 0.0
    for x, y in quad:
        overshoot = max(overshoot, -x, x - width, -y, y - height)
    if overshoot > MAX_CORNER_OVERSHOOT * diagonal:
        return False, f"corner {overshoot / diagonal:.0%} outside the picture"

    lengths = edge_lengths(quad)
    if min(lengths) <= 1e-6:
        return False, "degenerate edge"
    ratio = max(lengths) / min(lengths)
    if ratio > MAX_EDGE_RATIO:
        return False, f"edge ratio {ratio:.1f}"
    return True, "ok"


# ---------------------------------------------------------------------------
# Pooling across frames
# ---------------------------------------------------------------------------
MIN_SURVIVING_FRAMES = 3
MIN_WINNER_SHARE = 0.5


def pool_frames(results, iou=0.5):
    """One answer from many frames, or None with a reason.

    Frames that survived frame_verdict() are grouped by which table they
    describe and the largest group wins, represented by its medoid — the
    member closest to all the others, which is a real observation rather
    than an average of two tables.

    A plain medoid over ALL frames never converges no matter how many are
    added, because a medoid over a bimodal set is tie-broken toward the
    failures. Filter first, then cluster, then take the largest group.
    """
    kept = [r for r in results if r is not None]
    if len(kept) < MIN_SURVIVING_FRAMES:
        return None, (f"only {len(kept)} usable frame(s), "
                      f"need {MIN_SURVIVING_FRAMES}")

    groups: list[list[dict]] = []
    for result in kept:
        for group in groups:
            if same_table(result["quad"], group[0]["quad"], iou):
                group.append(result)
                break
        else:
            groups.append([result])

    groups.sort(key=len, reverse=True)
    winner = groups[0]
    share = len(winner) / len(kept)
    if share < MIN_WINNER_SHARE:
        return None, (f"frames disagree: biggest group {len(winner)} of "
                      f"{len(kept)} ({share:.0%})")
    # An exact tie clears the half-share bar — eight frames on each of two
    # tables is 50% — and picking one of them is then a coin toss dressed
    # up as a measurement. The study's three wrong-table matches all had a
    # clear plurality (12/7, 11/7, 10/6/3/1), so refusing ties changes no
    # measured outcome and closes the one case where the rule as written
    # would have answered without evidence.
    if len(groups) > 1 and len(groups[1]) == len(winner):
        return None, (f"frames split evenly between two tables "
                      f"({len(winner)} each of {len(kept)})")

    medoid = _medoid(winner)
    return {
        "quad": medoid["quad"],
        "homography": medoid.get("homography"),
        "frames_used": len(winner),
        "frames_kept": len(kept),
        "agreement": share,
        "spread_px": _spread(winner, medoid),
        "tables_seen": max(r.get("tables_seen", 1) for r in winner),
        "weight": medoid.get("weight"),
    }, "ok"


def _corner_distance(a, b) -> float:
    return float(np.median([math.dist(p, q)
                            for p, q in zip(a["quad"], b["quad"])]))


def _medoid(group):
    if len(group) == 1:
        return group[0]
    totals = [sum(_corner_distance(a, b) for b in group if b is not a)
              for a in group]
    return group[int(np.argmin(totals))]


def _spread(group, medoid) -> float:
    if len(group) == 1:
        return 0.0
    return float(np.median([_corner_distance(member, medoid)
                            for member in group if member is not medoid]))

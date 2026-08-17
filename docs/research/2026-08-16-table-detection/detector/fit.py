"""Turn a 13-channel heatmap stack into one table quad.

The single-argmax reading of these heatmaps fails in a club, because each
channel picks its own strongest response and neighbouring tables answer to the
same semantics. So: take several peaks per channel, then look for the set of
peaks that agree on one metric table. A homography from the 2.740 x 1.525 m
model to the image explains eleven of the thirteen keypoints exactly (the two
net-top points sit 0.1525 m above the plane and are dropped), so "agree on one
table" is a concrete, checkable statement and the winning fit also repairs any
keypoint whose own peak was wrong.

One rule for every image: most inlier weight wins, then the larger table.
"""
import json
import math
import os

import cv2
import numpy as np

import cam

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(os.path.dirname(HERE), 'detector')

L, W = 2.74, 1.525
OVER = 0.1525  # net overhang past the side line

# the eleven keypoints that lie in the table plane, in their channel order
WORLD = {
    0: (-L / 2, W / 2),          # close left
    1: (-L / 2, -W / 2),         # close right
    2: (0.0, W / 2),             # centre left
    3: (0.0, -W / 2),            # centre right
    4: (L / 2, W / 2),           # far left
    5: (L / 2, -W / 2),          # far right
    6: (0.0, W / 2 + OVER),      # net left foot
    7: (0.0, -(W / 2 + OVER)),   # net right foot
    8: (0.0, 0.0),               # net centre foot
    11: (-L / 2, 0.0),           # close centre
    12: (L / 2, 0.0),            # far centre
}
INPLANE = sorted(WORLD)
CORNERS = [0, 1, 5, 4]  # close-left, close-right, far-right, far-left: one loop

# minimal sets used to seed a homography. Every one is four points in general
# position, and between them they cover the cases where only the near half,
# only the far half, or only the middle of the table is legible.
SEEDS = [
    (0, 1, 5, 4), (0, 1, 3, 2), (2, 3, 5, 4), (0, 1, 7, 6), (6, 7, 5, 4),
    (11, 12, 2, 3), (11, 12, 6, 7), (0, 1, 12, 8), (4, 5, 11, 8),
    (0, 3, 5, 2), (1, 2, 4, 3), (0, 1, 5, 12), (0, 11, 5, 4),
]


def peaks_from_heatmap(hm, k=5, abs_thr=0.12, rel_thr=0.25, nms=4):
    """Local maxima per channel, subpixel-refined, in heatmap cell units."""
    C, H, Wd = hm.shape
    out = {}
    for c in range(C):
        m = hm[c]
        gmax = float(m.max())
        thr = max(abs_thr, rel_thr * gmax)
        # 3x3 dilation: a cell is a local max if it equals the local maximum
        d = cv2.dilate(m, np.ones((3, 3), np.uint8))
        ys, xs = np.where((m >= d - 1e-9) & (m >= thr))
        vals = m[ys, xs]
        order = np.argsort(-vals)
        picked = []
        for i in order:
            y, x, v = int(ys[i]), int(xs[i]), float(vals[i])
            if any((y - py) ** 2 + (x - px) ** 2 < nms * nms for py, px, _ in picked):
                continue
            # DARK-style subpixel offset from the 3x3 log-heatmap
            dx = dy = 0.0
            if 0 < x < Wd - 1 and 0 < y < H - 1:
                p = np.log(np.clip(m[y - 1:y + 2, x - 1:x + 2], 1e-6, None))
                gx = 0.5 * (p[1, 2] - p[1, 0])
                gy = 0.5 * (p[2, 1] - p[0, 1])
                hxx = p[1, 2] - 2 * p[1, 1] + p[1, 0]
                hyy = p[2, 1] - 2 * p[1, 1] + p[0, 1]
                if hxx < -1e-9:
                    dx = float(np.clip(-gx / hxx, -1, 1))
                if hyy < -1e-9:
                    dy = float(np.clip(-gy / hyy, -1, 1))
            picked.append((y, x, v))
            out.setdefault(c, []).append((x + dx, y + dy, v))
            if len(out[c]) >= k:
                break
        out.setdefault(c, [])
    return out


def to_canvas(pk, hm_shape, canvas=(1920, 1080)):
    """Heatmap cells -> the 1920x1080 canvas the model is evaluated on."""
    _C, H, Wd = hm_shape
    sx, sy = canvas[0] / Wd, canvas[1] / H
    return {c: [((x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5, v) for x, y, v in lst]
            for c, lst in pk.items()}


def _convex(q):
    s = []
    for i in range(4):
        ax, ay = q[i]
        bx, by = q[(i + 1) % 4]
        cx, cy = q[(i + 2) % 4]
        s.append(np.sign((bx - ax) * (cy - by) - (by - ay) * (cx - bx)))
    return abs(sum(s)) == 4


def _area(q):
    a = 0.0
    for i in range(4):
        x1, y1 = q[i]
        x2, y2 = q[(i + 1) % 4]
        a += x1 * y2 - x2 * y1
    return a / 2


def project(H, ids):
    w = np.array([[WORLD[i][0], WORLD[i][1], 1.0] for i in ids]).T
    v = H @ w
    return (v[:2] / v[2]).T


def tol_for(q, tol_frac, tol_min, tol_max):
    """How far a keypoint may sit from where the fit says it is.

    Scaled to the table's own apparent size, not to the picture: a table
    fifteen metres away occupies a tenth of the pixels and its keypoints are
    correspondingly tighter together, so a fixed pixel budget lets a distant
    table collect inliers it has not earned."""
    return float(np.clip(tol_frac * math.sqrt(abs(_area(q)) + 1e-6), tol_min, tol_max))


def score_H(H, cand, tol, canvas):
    """Inlier weight: for each in-plane channel, the best peak within tol of
    where this homography says the keypoint must be, weighted by activation."""
    pts = project(H, INPLANE)
    total, n, resid = 0.0, 0, []
    used = {}
    for (i, ch) in enumerate(INPLANE):
        ex, ey = pts[i]
        best = None
        for (x, y, v) in cand.get(ch, []):
            d = math.hypot(x - ex, y - ey)
            if d <= tol and (best is None or v > best[2]):
                best = (x, y, v, d)
        if best is not None:
            total += min(best[2], 1.2)
            n += 1
            resid.append(best[3])
            used[ch] = best[:3]
    return total, n, used, resid


def quad_ok(q, canvas):
    if not _convex(q):
        return False
    a = abs(_area(q))
    if a < 0.004 * canvas[0] * canvas[1]:      # smaller than a distant table
        return False
    if a > 0.9 * canvas[0] * canvas[1]:
        return False
    e = [math.dist(q[i], q[(i + 1) % 4]) for i in range(4)]
    if min(e) < 1e-6 or max(e) / min(e) > 12:
        return False
    return True


def _same_table(qa, qb, thr=0.5):
    """Two hypotheses describe the same table if their quads overlap well."""
    a = np.array(qa, np.float32)
    b = np.array(qb, np.float32)
    inter, _p = cv2.intersectConvexConvex(a, b)
    aa, ab = abs(_area(qa)), abs(_area(qb))
    union = aa + ab - inter
    return union > 0 and inter / union >= thr


def _refine(H, cand, tol, canvas, rounds=4):
    used = score_H(H, cand, tol, canvas)[2]
    for _ in range(rounds):
        if len(used) < 4:
            break
        src = np.array([WORLD[c] for c in used], np.float32)
        dst = np.array([used[c][:2] for c in used], np.float32)
        Hn, _m = cv2.findHomography(src, dst, 0)
        if Hn is None or not np.all(np.isfinite(Hn)):
            break
        q = project(Hn, CORNERS)
        if not quad_ok(q, canvas):
            break
        tot, n, used2, resid = score_H(Hn, cand, tol, canvas)
        if n < 4:
            break
        H, used = Hn, used2
    return H


def _refine2(H, cand, canvas, P, rounds=5):
    """Least squares over the current inliers, re-select, repeat."""
    for _ in range(rounds):
        q = project(H, CORNERS)
        tol = tol_for(q, P['tol_frac'], P['tol_min'], P['tol_max'])
        tot, n, used, resid = score_H(H, cand, tol, canvas)
        if n < 4:
            break
        src = np.array([WORLD[c] for c in used], np.float32)
        dst = np.array([used[c][:2] for c in used], np.float32)
        Hn, _m = cv2.findHomography(src, dst, 0)
        if Hn is None or not np.all(np.isfinite(Hn)):
            break
        if not quad_ok(project(Hn, CORNERS), canvas):
            break
        H = Hn
    return H


DEFAULTS = dict(k=5, tol_frac=0.10, tol_min=8.0, tol_max=40.0, beta=0.90,
                max_clusters=8, iou=0.5, min_cam_height=0.35)


def fit_table(hm, canvas=(1920, 1080), debug=False, **kw):
    """Best single-table explanation of one heatmap stack.

    Every surviving hypothesis is a projection of the real 2.740 x 1.525 m
    table, so a frame with three tables in it produces three clusters of
    hypotheses rather than one blurred average. Two rules, applied to every
    image alike, then pick between them: a table has to be well supported by
    the heatmaps, and among the well supported ones the nearest is the one
    being played on.
    """
    P = dict(DEFAULTS)
    P.update({a: b for a, b in kw.items() if b is not None})
    cand = to_canvas(peaks_from_heatmap(hm, k=P['k']), hm.shape, canvas)

    hyps = []
    for seed in SEEDS:
        lists = [cand.get(c, []) for c in seed]
        if any(len(x) == 0 for x in lists):
            continue
        src = np.array([WORLD[c] for c in seed], np.float32)
        for a in lists[0]:
            for b in lists[1]:
                for c_ in lists[2]:
                    for d in lists[3]:
                        dst = np.array([a[:2], b[:2], c_[:2], d[:2]], np.float32)
                        try:
                            H = cv2.getPerspectiveTransform(src, dst)
                        except cv2.error:
                            continue
                        if not np.all(np.isfinite(H)):
                            continue
                        q = project(H, CORNERS)
                        if not quad_ok(q, canvas):
                            continue
                        tol = tol_for(q, P['tol_frac'], P['tol_min'], P['tol_max'])
                        tot, n, used, resid = score_H(H, cand, tol, canvas)
                        if n < 4:
                            continue
                        hyps.append((tot, H, q))
    if not hyps:
        return None

    # one cluster per table in the picture, represented by its best hypothesis
    hyps.sort(key=lambda h: -h[0])
    clusters = []
    for tot, H, q in hyps:
        if any(_same_table(q, c[2], P['iou']) for c in clusters):
            continue
        clusters.append((tot, H, q))
        if len(clusters) >= P['max_clusters']:
            break

    # refine each candidate table before comparing them, so the comparison is
    # between the best each can do rather than between two seed accidents
    ref = []
    for tot, H, _q in clusters:
        Hr = _refine2(H, cand, canvas, P)
        qr = project(Hr, CORNERS)
        if not quad_ok(qr, canvas):
            Hr, qr = H, _q
        tol = tol_for(qr, P['tol_frac'], P['tol_min'], P['tol_max'])
        t2, n2, used2, resid2 = score_H(Hr, cand, tol, canvas)
        cams = cam.camera_check(Hr, canvas)
        # a camera has to be above the table to see its surface at all; a quad
        # stitched out of two different tables usually implies one that is not
        plausible = (not cams) or max(c['height'] for c in cams) >= P['min_cam_height']
        ref.append(dict(H=Hr, quad=qr, weight=t2, n=n2, used=used2,
                        resid=resid2, area=abs(_area(qr)), plausible=plausible,
                        cam_height=max((c['height'] for c in cams), default=None)))
    # a table that refined onto another table's answer is not a separate table
    keep = []
    for r in sorted(ref, key=lambda r: -r['weight']):
        if any(_same_table(r['quad'], s['quad'], P['iou']) for s in keep):
            continue
        keep.append(r)
    ref = keep

    best_w = max(r['weight'] for r in ref)
    live = [r for r in ref if r['weight'] >= P['beta'] * best_w]
    ok = [r for r in live if r['plausible']] or live
    chosen = max(ok, key=lambda r: r['area'])

    H = chosen['H']
    quad = [[float(x), float(y)] for x, y in chosen['quad']]
    # one winding for every image: close-left, close-right, far-right, far-left
    # runs the same way round the picture whenever the camera is above the
    # table, which it is in all of this footage.
    if _area(quad) > 0:
        quad = [quad[0], quad[3], quad[2], quad[1]]
    out = {
        'quad': quad,
        'inliers': chosen['n'],
        'weight': float(chosen['weight']),
        'inlier_channels': sorted(chosen['used']),
        'median_resid': float(np.median(chosen['resid'])) if chosen['resid'] else None,
        'area': float(chosen['area']),
        'n_tables': len(ref),
        'cam_height': chosen['cam_height'],
        'H': H.tolist(),
    }
    if debug:
        out['clusters'] = [{'weight': float(r['weight']), 'area': float(r['area']),
                            'inliers': r['n'], 'plausible': r['plausible'],
                            'cam_height': r['cam_height'],
                            'quad': [[float(x), float(y)] for x, y in r['quad']]}
                           for r in sorted(ref, key=lambda r: -r['weight'])]
    return out

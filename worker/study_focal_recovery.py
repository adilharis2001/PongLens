"""Can the live gate solve the lens from the quad and stay suspicious?

The live table check's gate today takes the phone's reported lens as
truth and uses the orthonormality residual of K^-1 H as its lie
detector. Solving the focal from the quad instead (Zhang's two
single-plane constraints) would make a re-photographed screen a valid
test rig and immunise the gate against lens misreports — but it spends
one of the two constraints on the solve, so the study's question is
whether what remains still refuses garbage.

Reads table_calibration_review read-only, same as mine_record_poses.

    venv/bin/python study_focal_recovery.py
"""

from __future__ import annotations

import importlib.util
import math

import numpy as np

spec = importlib.util.spec_from_file_location("mrp", "mine_record_poses.py")
mrp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mrp)

L, W = 2.740, 1.525
RNG = np.random.default_rng(20260825)


def zhang_candidates(H, cx, cy):
    return mrp.focal_candidates(H, cx, cy)


def residual_known_f(H, f, cx, cy):
    """The Swift gate's lie detector, mirrored: orthonormality of K^-1 H."""
    K = np.array([[f, 0, cx], [0, f, cy], [0, 0, 1.0]])
    M = np.linalg.inv(K) @ H
    best = None
    for sign in (1.0, -1.0):
        Ms = M * sign
        n0, n1 = np.linalg.norm(Ms[:, 0]), np.linalg.norm(Ms[:, 1])
        if n0 < 1e-12 or n1 < 1e-12:
            continue
        s = 2.0 / (n0 + n1)
        r0, r1 = Ms[:, 0] * s, Ms[:, 1] * s
        res = (abs(np.linalg.norm(r0) - 1) + abs(np.linalg.norm(r1) - 1)
               + abs(float(np.dot(r0 / np.linalg.norm(r0),
                                  r1 / np.linalg.norm(r1)))))
        if best is None or res < best:
            best = res
    return best


def pose_bounds_ok(pose):
    if pose is None:
        return False
    x, y, z = pose
    behind = mrp.NEAR_X - x
    return 0.2 < behind < 9 and 0.15 < z < 3 and abs(y) < 8


def solve_new_gate(corners, wpx, hpx):
    """The proposed gate: solve f, keep the second constraint as the check.

    Returns (accepted, detail dict)."""
    img = np.asarray(corners, dtype=np.float64)
    H = mrp.homography(mrp.WORLD_CORNERS, img)
    cands = zhang_candidates(H, wpx / 2, hpx / 2)
    if len(cands) < 2:
        return False, {"why": "fewer than two focal candidates"}
    f1, f2 = cands[0], cands[1]
    agree = abs(f1 - f2) / ((f1 + f2) / 2)
    f = math.sqrt(f1 * f2)
    # Sanity: horizontal FOV between 40 and 110 degrees for this width.
    fov = 2 * math.degrees(math.atan(wpx / (2 * f)))
    pose = mrp.camera_centre(H, f, wpx / 2, hpx / 2)
    ok = agree < AGREE_T and 40 <= fov <= 110 and pose_bounds_ok(pose)
    return ok, {"agree": agree, "fov": fov, "pose": pose}


def old_gate(corners, f_true, wpx, hpx):
    img = np.asarray(corners, dtype=np.float64)
    H = mrp.homography(mrp.WORLD_CORNERS, img)
    res = residual_known_f(H, f_true, wpx / 2, hpx / 2)
    if res is None or res >= 0.35:
        return False
    pose = mrp.camera_centre(H, f_true, wpx / 2, hpx / 2)
    return pose_bounds_ok(pose)


def garbage_variants(img, all_quads, idx):
    """The failure shapes the detector actually produces."""
    img = np.asarray(img, dtype=np.float64)
    out = {}
    out["rotated"] = np.roll(img, 1, axis=0)             # end-for-end error
    out["rewound"] = img[[1, 0, 3, 2]]                    # mirrored winding
    d = np.linalg.norm(img.max(0) - img.min(0))
    shift = img.copy()
    k = int(RNG.integers(0, 4))
    ang = RNG.uniform(0, 2 * np.pi)
    shift[k] += 0.15 * d * np.array([np.cos(ang), np.sin(ang)])
    out["one corner moved"] = shift                       # single bad channel
    other = np.asarray(all_quads[(idx + 7) % len(all_quads)][0], float)
    out["stitched"] = np.vstack([img[:2], other[2:]])     # two tables at once
    lo, hi = img.min(0), img.max(0)
    out["random quad"] = RNG.uniform(lo, hi, size=(4, 2))
    return out


rows = mrp.fetch_rows()
seen = set()
quads = []
for mid, corners, w, h, verdict, placement, venue, dup in rows:
    if verdict in ("no_table", "unusable"):
        continue
    if dup is not None:
        if dup in seen:
            continue
        seen.add(dup)
    if mrp.pose_for(corners, w, h) is None:
        continue
    quads.append((corners, w, h, str(mid)[:8]))

print(f"{len(quads)} corpus quads\n")

# f_true for the old-gate simulation: the focal the corrected quad itself
# solves to (geometric mean) — the best available stand-in for the lens
# that really filmed each upload.
f_true = {}
for i, (c, w, h, mid) in enumerate(quads):
    H = mrp.homography(mrp.WORLD_CORNERS, np.asarray(c, float))
    cands = zhang_candidates(H, w / 2, h / 2)
    f_true[i] = math.sqrt(cands[0] * cands[1]) if len(cands) >= 2 else (
        cands[0] if cands else None)

# --- Threshold sweep on candidate agreement ---------------------------------
print("TRUE QUADS — two-candidate focal agreement (the new lie detector)")
agrees = []
for c, w, h, mid in quads:
    H = mrp.homography(mrp.WORLD_CORNERS, np.asarray(c, float))
    cands = zhang_candidates(H, w / 2, h / 2)
    if len(cands) >= 2:
        agrees.append(abs(cands[0] - cands[1]) / ((cands[0] + cands[1]) / 2))
    else:
        agrees.append(float("inf"))
agrees = np.array(agrees)
for q in (50, 85, 95, 100):
    print(f"   p{q:<3} {np.percentile(agrees[np.isfinite(agrees)], q):.3f}")
print(f"   no second candidate: {int(np.sum(~np.isfinite(agrees)))}")

for AGREE_T in (0.15, 0.25, 0.35, 0.50):
    ta = sum(1 for i, (c, w, h, m) in enumerate(quads)
             if solve_new_gate(c, w, h)[0])
    print(f"\nAGREE_T = {AGREE_T:.2f}   true accepted {ta}/{len(quads)}")
    print(f"   {'garbage':<18} {'old gate refuses':>17} {'new gate refuses':>17}")
    fams = {}
    for i, (c, w, h, mid) in enumerate(quads):
        for name, g in garbage_variants(c, quads, i).items():
            old_ref = not old_gate(g, f_true[i], w, h) if f_true[i] else True
            new_ref = not solve_new_gate(g, w, h)[0]
            a, b, n = fams.get(name, (0, 0, 0))
            fams[name] = (a + old_ref, b + new_ref, n + 1)
    for name, (o, nw, n) in fams.items():
        print(f"   {name:<18} {o:>13}/{n:<3} {nw:>13}/{n:<3}")

# --- Noise robustness: the live model's corners are not hand-marks ----------
AGREE_T = 0.35
print("\nNOISE — true quads + Gaussian corner noise, new gate acceptance")
print("(live-model corners are noisy; a gate that refuses noisy-but-right")
print(" quads would go silent at the venue)")
for sigma_pct in (0.5, 1.0, 2.0):
    acc = 0
    trials = 0
    for c, w, h, mid in quads:
        img = np.asarray(c, float)
        d = np.linalg.norm(img.max(0) - img.min(0))
        for _ in range(5):
            noisy = img + RNG.normal(0, sigma_pct / 100 * d, size=(4, 2))
            acc += solve_new_gate(noisy, w, h)[0]
            trials += 1
    print(f"   sigma {sigma_pct:.1f}% of diagonal   accepted {acc}/{trials}")

# --- Variant B: the server's own recipe — try each candidate, accept if ----
# --- ANY yields a sane lens and an in-bounds pose (no agreement demand) ----
def gate_any(corners, wpx, hpx):
    img = np.asarray(corners, dtype=np.float64)
    H = mrp.homography(mrp.WORLD_CORNERS, img)
    for f in zhang_candidates(H, wpx / 2, hpx / 2):
        fov = 2 * math.degrees(math.atan(wpx / (2 * f)))
        if not (40 <= fov <= 110):
            continue
        if pose_bounds_ok(mrp.camera_centre(H, f, wpx / 2, hpx / 2)):
            return True
    return False


print("\nVARIANT B — any candidate with sane lens and in-bounds pose")
ta = sum(1 for c, w, h, m in quads if gate_any(c, w, h))
print(f"   true accepted {ta}/{len(quads)}")
fams = {}
for i, (c, w, h, mid) in enumerate(quads):
    for name, g in garbage_variants(c, quads, i).items():
        old_ref = not old_gate(g, f_true[i], w, h) if f_true[i] else True
        new_ref = not gate_any(g, w, h)
        a, b, n = fams.get(name, (0, 0, 0))
        fams[name] = (a + old_ref, b + new_ref, n + 1)
print(f"   {'garbage':<18} {'old gate refuses':>17} {'variant B refuses':>18}")
for name, (o, nw, n) in fams.items():
    print(f"   {name:<18} {o:>13}/{n:<3} {nw:>14}/{n:<3}")

print("\n   noise on true quads, variant B acceptance")
for sigma_pct in (0.5, 1.0, 2.0):
    acc = 0; trials = 0
    for c, w, h, mid in quads:
        img = np.asarray(c, float)
        d = np.linalg.norm(img.max(0) - img.min(0))
        for _ in range(5):
            noisy = img + RNG.normal(0, sigma_pct / 100 * d, size=(4, 2))
            acc += gate_any(noisy, w, h); trials += 1
    print(f"   sigma {sigma_pct:.1f}%   accepted {acc}/{trials}")

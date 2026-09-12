"""CPU-only sampled camera-view comparison. A warning, never a content gate.

Thresholds were tested against ten fixed-camera recordings and synthetic
movement/obstruction controls. Sparse samples cannot locate movement within a
point. Low-feature and unreadable footage return unknown, not a refusal.
"""
from __future__ import annotations
import argparse
import json
import math
import os
from pathlib import Path
import cv2
import numpy as np

def bg_mask(shape: tuple[int, int]) -> np.ndarray:
    h, w = shape
    mask = np.zeros((h, w), dtype=np.uint8)
    # Static venue background: full top 58%, plus side columns below it.
    mask[: int(0.58 * h), :] = 255
    mask[:, : int(0.18 * w)] = 255
    mask[:, int(0.82 * w) :] = 255
    # Avoid timestamps/phone UI at the extreme rim.
    rim = 5
    mask[:rim, :] = 0
    mask[-rim:, :] = 0
    mask[:, :rim] = 0
    mask[:, -rim:] = 0
    return mask


def features(image: np.ndarray) -> tuple[list, np.ndarray | None]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    detector = cv2.SIFT_create(nfeatures=1600, contrastThreshold=0.018,
                               edgeThreshold=12)
    return detector.detectAndCompute(gray, bg_mask(gray.shape))


def masked_gradient_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Median normalized edge correlation over static-background tiles."""
    ga = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY)
    gb = cv2.cvtColor(b, cv2.COLOR_BGR2GRAY)
    ga = cv2.resize(ga, (256, 144), interpolation=cv2.INTER_AREA)
    gb = cv2.resize(gb, (256, 144), interpolation=cv2.INTER_AREA)
    ga = cv2.Laplacian(ga, cv2.CV_32F, ksize=3)
    gb = cv2.Laplacian(gb, cv2.CV_32F, ksize=3)
    mask = bg_mask(ga.shape)
    vals = []
    for y in range(0, 144, 36):
        for x in range(0, 256, 32):
            m = mask[y:y + 36, x:x + 32] > 0
            if m.mean() < 0.6:
                continue
            xa = ga[y:y + 36, x:x + 32][m]
            xb = gb[y:y + 36, x:x + 32][m]
            xa = xa - xa.mean()
            xb = xb - xb.mean()
            denom = float(np.linalg.norm(xa) * np.linalg.norm(xb))
            if denom > 1e-6:
                vals.append(float(np.dot(xa, xb) / denom))
    return float(np.median(vals)) if vals else 0.0


def compare(a: np.ndarray, b: np.ndarray, fa=None, fb=None) -> dict:
    h, w = a.shape[:2]
    diag = math.hypot(w, h)
    if fa is None:
        fa = features(a)
    if fb is None:
        fb = features(b)
    ka, da = fa
    kb, db = fb
    result = {
        "keypoints_a": len(ka), "keypoints_b": len(kb), "mutual_matches": 0,
        "inliers": 0, "inlier_ratio": 0.0, "coverage": 0.0,
        "identity_fraction_3px": 0.0, "median_raw_disp_px": None,
        "affine_disp_fraction": None, "scale": None, "rotation_deg": None,
        "edge_similarity": masked_gradient_similarity(a, b),
    }
    if da is None or db is None or len(da) < 3 or len(db) < 3:
        return result
    matcher = cv2.BFMatcher(cv2.NORM_L2)
    ab = matcher.knnMatch(da, db, k=2)
    ba = matcher.knnMatch(db, da, k=2)
    good_ab = {m.queryIdx: m for m, n in ab if m.distance < 0.72 * n.distance}
    good_ba = {m.queryIdx: m for m, n in ba if m.distance < 0.72 * n.distance}
    mutual = [m for m in good_ab.values()
              if m.trainIdx in good_ba and good_ba[m.trainIdx].trainIdx == m.queryIdx]
    result["mutual_matches"] = len(mutual)
    if len(mutual) < 3:
        return result
    pa = np.float32([ka[m.queryIdx].pt for m in mutual])
    pb = np.float32([kb[m.trainIdx].pt for m in mutual])
    disp = np.linalg.norm(pb - pa, axis=1)
    result["identity_fraction_3px"] = float(np.mean(disp <= 3.0))
    result["median_raw_disp_px"] = float(np.median(disp))
    matrix, inlier_mask = cv2.estimateAffinePartial2D(
        pa, pb, method=cv2.RANSAC, ransacReprojThreshold=2.5,
        maxIters=3000, confidence=0.995, refineIters=10,
    )
    if matrix is None or inlier_mask is None:
        return result
    keep = inlier_mask.ravel().astype(bool)
    result["inliers"] = int(keep.sum())
    result["inlier_ratio"] = float(keep.mean())
    occupied = set()
    for x, y in pa[keep]:
        occupied.add((min(int(x / w * 4), 3), min(int(y / h * 3), 2)))
    result["coverage"] = len(occupied) / 12.0
    grid = np.float32([
        [0, 0], [w / 2, 0], [w, 0], [0, h / 2], [w / 2, h / 2],
        [w, h / 2], [0, h], [w / 2, h], [w, h],
    ])
    warped = cv2.transform(grid[None, :, :], matrix)[0]
    result["affine_disp_fraction"] = float(np.median(
        np.linalg.norm(warped - grid, axis=1)) / diag)
    a00, a10 = float(matrix[0, 0]), float(matrix[1, 0])
    result["scale"] = math.hypot(a00, a10)
    result["rotation_deg"] = math.degrees(math.atan2(a10, a00))
    return result


def classify(metric: dict, disp_threshold: float = 0.012) -> str:
    reliable = (metric["inliers"] >= 24 and metric["inlier_ratio"] >= 0.45
                and metric["coverage"] >= 0.25)
    if reliable:
        return "shifted" if metric["affine_disp_fraction"] >= disp_threshold else "same"
    # Incompatible background is evidence only when matching and direct edge
    # agreement both collapse. It remains a warning-level observation.
    if (metric["keypoints_a"] >= 100 and metric["keypoints_b"] >= 100
            and metric["mutual_matches"] < 10
            and metric["edge_similarity"] < 0.08):
        return "incompatible"
    return "unknown"


def sequence_verdict(states: list[str]) -> dict:
    changed = [s in {"shifted", "incompatible"} for s in states]
    runs = []
    start = None
    for idx, value in enumerate(changed + [False]):
        if value and start is None:
            start = idx
        elif not value and start is not None:
            runs.append((start, idx - 1))
            start = None
    longest = max((end - begin + 1 for begin, end in runs), default=0)
    # Two changed samples at the very start/end can be setup or teardown.
    # Require three there; two consecutive interior samples are sustained.
    warning_runs = [
        (begin, end) for begin, end in runs
        if end - begin + 1 >= (3 if begin == 0 or end == len(states) - 1 else 2)
    ]
    return {
        "warning": bool(warning_runs),
        "changed_count": sum(changed),
        "longest_changed_run": longest,
        "unknown_count": sum(s == "unknown" for s in states),
        "changed_runs": runs,
        "warning_runs": warning_runs,
    }


def assess_sequence(frames: list[np.ndarray]) -> tuple[list[str], list[dict], dict]:
    """Assess a sequence without assuming the first sampled frame is good.

    The reference is the frame with the most independently registered
    same-view peers. An incompatible frame counts as changed only when it has
    a same-view peer outside the dominant group; that prevents an obstruction
    or low-feature frame from being called a new camera view.
    """
    feats = [features(x) for x in frames]
    pairs = {}
    pair_rows = []
    same_degree = [0] * len(frames)
    for left in range(len(frames)):
        for right in range(left + 1, len(frames)):
            metric = compare(frames[left], frames[right], feats[left], feats[right])
            pair_state = classify(metric)
            metric["pair_state"] = pair_state
            metric["left_index"] = left
            metric["right_index"] = right
            pairs[(left, right)] = metric
            pair_rows.append(metric)
            if pair_state == "same":
                same_degree[left] += 1
                same_degree[right] += 1

    # Prefer a central frame on ties, so an equally large opening/closing view
    # does not make sample 0 special.
    reference = min(range(len(frames)),
                    key=lambda i: (-same_degree[i], abs(i - (len(frames) - 1) / 2)))

    def pair_state(a: int, b: int) -> str:
        if a == b:
            return "same"
        return pairs[(min(a, b), max(a, b))]["pair_state"]

    dominant = [i for i in range(len(frames))
                if i == reference or pair_state(i, reference) == "same"]
    outside = [i for i in range(len(frames)) if i not in dominant]
    states = ["same" if i in dominant else "unknown" for i in range(len(frames))]
    cross_votes = {}
    for idx in outside:
        votes = [pair_state(idx, peer) for peer in dominant]
        shifted = votes.count("shifted")
        incompatible = votes.count("incompatible")
        same = votes.count("same")
        known = shifted + incompatible + same
        needed = min(2, len(dominant))
        changed_fraction = (shifted + incompatible) / known if known else 0.0
        has_stable_outside_peer = any(
            other != idx and pair_state(idx, other) == "same" for other in outside)
        if shifted >= needed and changed_fraction >= 0.60:
            states[idx] = "shifted"
        elif (incompatible >= needed and changed_fraction >= 0.60
              and has_stable_outside_peer):
            states[idx] = "incompatible"
        cross_votes[str(idx)] = {
            "same": same, "shifted": shifted, "incompatible": incompatible,
            "unknown": votes.count("unknown"),
            "stable_outside_peer": has_stable_outside_peer,
        }
    detail = {
        "reference_index": reference,
        "same_degree": same_degree,
        "dominant_indices": dominant,
        "outside_indices": outside,
        "cross_votes": cross_votes,
    }
    return states, pair_rows, detail


def check_frames(samples, window_start_s, window_end_s):
    """Return bounded observations on the original video's clock.

    Each change is bracketed by actual samples. Nothing invents an exact
    transition time, an affected point, or a claim that processing failed.
    """
    result = {"schema": 1, "status": "unknown", "reason_code": "invalid_samples",
              "sample_count": len(samples) if isinstance(samples, (list, tuple)) else 0,
              "sample_timestamps_s": [],
              "window_start_s": window_start_s, "window_end_s": window_end_s,
              "changes": [], "evidence": []}
    try:
        if not isinstance(samples, (list, tuple)):
            return result
        stamps = [float(sample[0]) for sample in samples]
        result["sample_timestamps_s"] = stamps
        if (not math.isfinite(window_start_s) or not math.isfinite(window_end_s)
                or window_start_s < 0 or window_end_s <= window_start_s
                or any(not math.isfinite(t) or not window_start_s <= t <= window_end_s
                       for t in stamps)
                or any(a >= b for a, b in zip(stamps, stamps[1:]))):
            return result
        if len(samples) < 8:
            result["reason_code"] = "too_few_samples"
            return result
        if len(samples) > 16:
            return result
        frames = [cv2.imread(str(path)) for _, path in samples]
        if any(frame is None for frame in frames):
            result["reason_code"] = "unreadable_samples"
            return result
        if any(frame.shape != frames[0].shape for frame in frames):
            result["reason_code"] = "inconsistent_dimensions"
            return result
        # The caller supplies 512px stills; keep this API bounded for other
        # local callers without changing the aspect ratio.
        if frames[0].shape[1] > 512:
            h, w = frames[0].shape[:2]
            frames = [cv2.resize(frame, (512, max(1, round(h * 512 / w))))
                      for frame in frames]
        cv2.setNumThreads(1)
        states, _, detail = assess_sequence(frames)
        verdict = sequence_verdict(states)
        result["evidence"] = [{"sample_s": t, "state": state}
                              for t, state in zip(stamps, states)]
        brackets = set()
        for begin, end in verdict["warning_runs"]:
            if begin > 0:
                brackets.add((begin - 1, begin))
            if end + 1 < len(stamps):
                brackets.add((end, end + 1))
        if brackets:
            result.update(status="changed", reason_code="sustained_view_shift",
                          changes=[{"before_s": stamps[a], "after_s": stamps[b],
                                    "kind": "shift"} for a, b in sorted(brackets)])
        elif len(detail["dominant_indices"]) >= math.ceil(2 * len(frames) / 3):
            result.update(status="stable", reason_code="dominant_static_background")
        else:
            result["reason_code"] = "insufficient_feature_evidence"
    except Exception:
        result.update(status="unknown", reason_code="comparison_unavailable",
                      changes=[], evidence=[])
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples-json", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    if os.environ.get("PONGLENS_MATCH_RELEASE"):
        from match_release import verify_unchanged
        verify_unchanged(os.environ["PONGLENS_MATCH_RELEASE"])
    data = json.loads(Path(args.samples_json).read_text())
    result = check_frames(data["samples"], data["window_start_s"], data["window_end_s"])
    Path(args.out).write_text(json.dumps(result, allow_nan=False))


if __name__ == "__main__":
    main()

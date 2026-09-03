#!/usr/bin/env python3
"""Compute candidate changeover signals from break footage, and score them.

Everything here reads `breaks.json` written by break_extract.py — the
people standing in the gaps between rallies — and asks one question per
signal: does this number separate a break where the players swapped ends
from a break where they did not?

The signals fall into five families, and they are deliberately not all
sensible. A family that measures nothing is worth the twenty lines it
costs, because the alternative is arguing about it later.

    occupancy   which end of the table has somebody at it, over time
    tracks      link the detections frame to frame and follow people
    lateral     how far outside the sidelines anyone walks
    appearance  what people look like early vs late in the break
    trivial     duration and crowd size, the baselines to beat

Truth is Adil's own review of 141 breaks (judged_boundaries), extended
with true negatives from fully scored matches, where the score itself
proves no game ended.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any, Iterable, Sequence

HERE = Path(__file__).resolve().parent
sys.path[:] = [p for p in sys.path if Path(p or ".").resolve() != HERE]
sys.path.insert(0, str(HERE.parent))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from worker.extract_side_changes_rtmpose import (  # noqa: E402
    NEAR_TABLE_FACTOR, _named_corners, _quad_distance,
)

WORKDIR = Path.home() / "ponglens-research-work" / "break-study"
# What production already computes for the same break, so every signal
# here is measured against the thing it would have to beat rather than
# against zero.
EVALDIR = Path.home() / "ponglens-research-work" / "game-end-eval"
TABLE_W_M, TABLE_L_M = 1.525, 2.740
# The net, in metres from the near end line. Crossing it is what
# "changed ends" means.
MID = TABLE_L_M / 2.0
VACANT_S = 1.5
# How far from the table somebody can stand and still be a player. The
# near side is generous because a defender backs a long way off; the
# lateral bound is what keeps the next table's game out of it.
Y_MIN_M, Y_MAX_M = -6.0, 9.0
X_ABS_M = 5.0


def homography(named: dict) -> np.ndarray:
    """Image pixels to metres on the table plane.

    A, B, C, D are near-left, near-right, far-right, far-left, so y runs
    0 at the near end line to 2.740 at the far one and a player standing
    behind their own end reads negative.

    This replaces a first attempt that interpolated between the two end
    lines and called the ratio "depth". That ratio is projective, not
    metric: it explodes towards the camera, and a near player standing a
    normal two metres back from their own end read 5.08 on a corpus
    where the far player reads 0.00. Any fixed band over it throws away
    the near player on exactly the cameras that see him best.
    """
    src = np.float32([named[k] for k in "ABCD"])
    dst = np.float32([[0.0, 0.0], [TABLE_W_M, 0.0],
                      [TABLE_W_M, TABLE_L_M], [0.0, TABLE_L_M]])
    return cv2.getPerspectiveTransform(src, dst)


def to_metres(H: np.ndarray, px: float, py: float):
    """Table-plane metres, or None at or behind the horizon."""
    v = H @ np.array([px, py, 1.0], dtype=np.float64)
    if abs(v[2]) < 1e-9:
        return None
    x, y = v[0] / v[2], v[1] / v[2]
    if not (np.isfinite(x) and np.isfinite(y)):
        return None
    return float(x), float(y)


# --- geometry ---------------------------------------------------------------

def plausible(people: Sequence[dict], named: dict,
              H: np.ndarray | None = None) -> list[dict]:
    """People who could be one of the two players, not a passer-by.

    Two rules. The production one — within NEAR_TABLE_FACTOR of your own
    height of the quad, measured in image space over 144 hand-labelled
    frames — and a metric box around the table, which is what keeps the
    next table's match out on a venue with eight of them in view.

    Each kept person gains `xm`/`ym`, their position on the table plane
    in metres, and `side`: True at the near end.
    """
    H = homography(named) if H is None else H
    out = []
    for p in people:
        box = p["box"]
        ax, ay = (box[0] + box[2]) / 2.0, box[3]
        h = max(1.0, p["h"])
        if _quad_distance(ax, ay, named) > NEAR_TABLE_FACTOR * h:
            continue
        m = to_metres(H, ax, ay)
        if m is None:
            continue
        xm, ym = m
        if not (Y_MIN_M <= ym <= Y_MAX_M) or abs(xm - TABLE_W_M / 2) > X_ABS_M:
            continue
        q = dict(p)
        q["xm"], q["ym"] = xm, ym
        q["side"] = ym < MID
        out.append(q)
    return out


def _iou(a: Sequence[float], b: Sequence[float]) -> float:
    ix0, iy0 = max(a[0], b[0]), max(a[1], b[1])
    ix1, iy1 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0.0, ix1 - ix0), max(0.0, iy1 - iy0)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(1e-6, (a[2] - a[0]) * (a[3] - a[1]))
    area_b = max(1e-6, (b[2] - b[0]) * (b[3] - b[1]))
    return inter / (area_a + area_b - inter)


def link(frames: list[dict], named: dict, max_skip: int = 3) -> list[list]:
    """Greedy frame-to-frame tracks in IMAGE space.

    Image space, not table space, on purpose: depth is a projective
    ratio, so a metre of walking is worth several times as much depth
    near the camera as it is at the far end, and any gate expressed in
    depth is either too tight at one end or useless at the other. Boxes
    overlap frame to frame at 2 Hz whatever the perspective.
    """
    tracks: list[dict] = []
    H = homography(named)
    for fi, frame in enumerate(frames):
        people = plausible(frame["people"], named, H)
        pairs = []
        for pi, person in enumerate(people):
            for ti, track in enumerate(tracks):
                if fi - track["last_frame"] > max_skip:
                    continue
                last = track["items"][-1][1]
                iou = _iou(person["box"], last["box"])
                h = max(last["h"], person["h"])
                cx_a = (person["box"][0] + person["box"][2]) / 2.0
                cx_b = (last["box"][0] + last["box"][2]) / 2.0
                near = math.hypot(cx_a - cx_b, person["box"][3]
                                  - last["box"][3]) / h
                if iou < 0.10 and near > 0.9:
                    continue
                pairs.append((-(iou + max(0.0, 1.0 - near)), pi, ti))
        pairs.sort()
        used_p: set[int] = set()
        used_t: set[int] = set()
        for _, pi, ti in pairs:
            if pi in used_p or ti in used_t:
                continue
            used_p.add(pi)
            used_t.add(ti)
            tracks[ti]["items"].append((fi, people[pi]))
            tracks[ti]["last_frame"] = fi
        for pi, person in enumerate(people):
            if pi in used_p:
                continue
            tracks.append({"items": [(fi, person)], "last_frame": fi})
    return [t["items"] for t in tracks]


def height_split(all_heights: Sequence[float]) -> float:
    """Box height that separates the near player from the far one.

    Two 1-D clusters on log height, Lloyd's algorithm from the extremes.
    Height rather than ground position because the table hides the far
    player's feet: their box stops at the table edge, so the foot point
    projects to the NEAR end line and both players come out on the same
    side of the net — measured on one match in eight windows of ten.
    Height has no such failure. It is read off the person's own box, and
    on a fixed camera the near player is around four times the size of
    the far one.
    """
    hs = np.log(np.asarray([h for h in all_heights if h > 4], dtype=float))
    if hs.size < 4:
        return float("nan")
    lo, hi = float(hs.min()), float(hs.max())
    if hi - lo < 0.2:
        return float("nan")
    a, b = lo, hi
    for _ in range(25):
        mid = (a + b) / 2.0
        left, right = hs[hs <= mid], hs[hs > mid]
        if left.size == 0 or right.size == 0:
            break
        a, b = float(left.mean()), float(right.mean())
    return float(math.exp((a + b) / 2.0))


# --- appearance -------------------------------------------------------------

BANDS = ("head", "torso", "shorts", "legs", "shoes")


def band_vec(person: dict, bands: Iterable[str], chroma: bool) -> np.ndarray | None:
    lab = person.get("lab") or {}
    vals: list[float] = []
    for b in bands:
        v = lab.get(b)
        if not v:
            return None
        vals.extend(v[1:] if chroma else v)
    return np.asarray(vals, dtype=np.float32)


def mean_vec(people: Sequence[dict], bands, chroma) -> np.ndarray | None:
    vs = [band_vec(p, bands, chroma) for p in people]
    vs = [v for v in vs if v is not None]
    return np.mean(vs, axis=0) if vs else None


def swap_score(nb, na, fb, fa) -> float | None:
    """Positive when the two ends look like they exchanged occupants.

    d(near-before, near-after) + d(far-before, far-after)
      - d(near-before, far-after) - d(far-before, near-after)

    which is the same comparison the production detector makes across a
    break, computed here on break frames instead of rally frames.
    """
    if any(v is None for v in (nb, na, fb, fa)):
        return None
    def d(a, b):
        return float(np.linalg.norm(a - b))
    return (d(nb, na) + d(fb, fa)) - (d(nb, fa) + d(fb, na))


def ends(frames: list[dict], named: dict, share: float = 0.3,
         split: float = float("nan"), per: list | None = None):
    """Near/far people from the first and last slice of the window.

    Which end somebody is at is decided by box height against the
    match's own two-cluster split, falling back to the biggest person in
    the frame when no split could be found.
    """
    n = len(frames)
    if n < 4:
        return None
    k = max(1, int(round(n * share)))
    per = per if per is not None else [
        plausible(fr["people"], named) for fr in frames]

    def side(chunk, want_near):
        out = []
        for ppl in chunk:
            if not ppl:
                continue
            if split == split:
                for p in ppl:
                    if (p["h"] >= split) == want_near:
                        out.append(p)
            else:
                ranked = sorted(ppl, key=lambda q: -q["h"])
                pick = ranked[0] if want_near else (
                    ranked[-1] if len(ranked) > 1 else None)
                if pick is not None:
                    out.append(pick)
        return out
    early, late = per[:k], per[-k:]
    return {
        "near_before": side(early, True), "near_after": side(late, True),
        "far_before": side(early, False), "far_after": side(late, False),
    }


# --- features ---------------------------------------------------------------

def features(window: dict, named: dict, hz: float,
             split: float = float("nan")) -> dict[str, float]:
    frames = window.get("frames") or []
    f: dict[str, float] = {}
    f["duration"] = float(window["duration"])
    f["n_frames"] = float(len(frames))
    if not frames:
        return f

    H = homography(named)
    per = [plausible(fr["people"], named, H) for fr in frames]
    counts = [len(p) for p in per]
    f["mean_people"] = float(np.mean(counts))
    f["max_people"] = float(max(counts))
    f["raw_mean_people"] = float(np.mean([len(fr["people"]) for fr in frames]))

    if split == split:
        near = [any(p["h"] >= split for p in ppl) for ppl in per]
        far = [any(p["h"] < split for p in ppl) for ppl in per]
    else:
        near = [any(p["side"] for p in ppl) for ppl in per]
        far = [any(not p["side"] for p in ppl) for ppl in per]
    n = len(frames)
    f["frac_near_occupied"] = sum(near) / n
    f["frac_far_occupied"] = sum(far) / n
    f["frac_both"] = sum(a and b for a, b in zip(near, far)) / n
    f["frac_empty"] = sum((not a) and (not b) for a, b in zip(near, far)) / n

    def longest_run(flags) -> float:
        best = run = 0
        for v in flags:
            run = run + 1 if not v else 0
            best = max(best, run)
        return best / hz
    f["longest_near_vacant_s"] = longest_run(near)
    f["longest_far_vacant_s"] = longest_run(far)
    f["both_vacated"] = float(
        f["longest_near_vacant_s"] >= VACANT_S
        and f["longest_far_vacant_s"] >= VACANT_S)

    tracks = link(frames, named)
    long_tracks = [t for t in tracks if len(t) >= 3]

    # --- scale exchange -----------------------------------------------
    #
    # The far player's feet are behind the table on every side-on camera,
    # so their box stops at the table edge and the foot point projects to
    # the NEAR end line: on one match both players read ym under the net
    # in eight windows out of ten. Box HEIGHT does not have that problem.
    # It is a pure ratio on one person's own box, it needs no ground
    # plane, and on a fixed camera it separates the ends by a factor of
    # four (726px near against 161px far on the frame checked by eye).
    #
    # So the question "did they swap" becomes "did the big one become
    # small while the small one became big", which is one comparison per
    # track and never asks where the ground is.
    def edge_h(track, first: bool) -> float:
        items = track[:3] if first else track[-3:]
        return float(np.median([p["h"] for _, p in items]))

    ratios = []
    for t in long_tracks:
        h0, h1 = edge_h(t, True), edge_h(t, False)
        if h0 > 4 and h1 > 4:
            ratios.append((math.log(h1 / h0), len(t), t))
    f["n_scale_tracks"] = float(len(ratios))
    if ratios:
        f["max_log_h_rise"] = max(r for r, _, _ in ratios)
        f["max_log_h_drop"] = -min(r for r, _, _ in ratios)
        # Both must happen for a swap: somebody walked towards the camera
        # AND somebody walked away from it.
        f["scale_exchange"] = min(f["max_log_h_rise"], f["max_log_h_drop"])
        spanning = [(r, t) for r, ln, t in ratios
                    if t[0][0] <= 1 and t[-1][0] >= len(frames) - 2]
        if len(spanning) >= 2:
            rs = sorted(r for r, _ in spanning)
            f["scale_exchange_spanning"] = min(-rs[0], rs[-1])
        if len(spanning) >= 1:
            f["spanning_max_abs_log_h"] = max(abs(r) for r, _ in spanning)

    # Frame-level: the biggest and smallest plausible person at each end
    # of the window. If the pair swapped, the big one is now the small one.
    def pair_h(chunk) -> tuple[float, float] | None:
        hs = sorted((p["h"] for ppl in chunk for p in ppl), reverse=True)
        return (hs[0], hs[-1]) if len(hs) >= 2 else None
    k = max(1, len(per) // 4)
    a, b = pair_h(per[:k]), pair_h(per[-k:])
    if a and b:
        f["h_ratio_start"] = a[0] / max(1.0, a[1])
        f["h_ratio_end"] = b[0] / max(1.0, b[1])
        f["h_ratio_change"] = abs(math.log(
            f["h_ratio_end"] / max(1e-6, f["h_ratio_start"])))
    f["n_tracks"] = float(len(tracks))
    f["n_tracks_long"] = float(len(long_tracks))

    spans, crossings_nf, crossings_fn, end_to_end, wide = [], 0, 0, 0, 0
    longest_len, longest_change, longest_flip = 0, 0.0, 0.0
    around = 0
    cross_times: list[float] = []
    spanning_flip = 0
    for t in long_tracks:
        depths = [p["ym"] for _, p in t]
        lats = [p["xm"] / TABLE_W_M for _, p in t]
        spans.append(max(depths) - min(depths))
        first_side = depths[0] < MID
        last_side = depths[-1] < MID
        if first_side != last_side:
            if first_side:
                crossings_nf += 1
            else:
                crossings_fn += 1
            # Where the path met the net line. A person cannot walk
            # through the table, so a crossing that happens between the
            # sidelines is a tracking error — two people swapped for one
            # another — not somebody changing ends.
            for (fa, pa), (fb, pb) in zip(t, t[1:]):
                if (pa["ym"] < MID) != (pb["ym"] < MID):
                    cross_times.append(fa / hz)
                    lat = (pa["xm"] + pb["xm"]) / 2.0
                    if lat < -0.2 or lat > TABLE_W_M + 0.2:
                        around += 1
                    break
            # Present at both ends of the window AND on the other side:
            # this is the one player held all the way through.
            if t[0][0] <= 1 and t[-1][0] >= len(frames) - 2:
                spanning_flip += 1
        if (depths[0] < 0.2 and depths[-1] > TABLE_L_M - 0.2) or \
           (depths[0] > TABLE_L_M - 0.2 and depths[-1] < 0.2):
            end_to_end += 1
        if lats and (min(lats) < -0.25 or max(lats) > 1.25):
            wide += 1
        if len(t) > longest_len:
            longest_len = len(t)
            longest_change = abs(depths[-1] - depths[0])
            longest_flip = float(first_side != last_side)
    # Total path walked, not just the net displacement. A player who
    # goes round the table and comes back has a small span and a large
    # path; a changeover is the opposite. Both are worth having.
    walks = []
    for t in long_tracks:
        d = 0.0
        for (_, a_), (_, b_) in zip(t, t[1:]):
            d += math.hypot(b_["xm"] - a_["xm"], b_["ym"] - a_["ym"])
        walks.append(d)
    walks.sort(reverse=True)
    f["walk_total_m"] = float(sum(walks))
    f["walk_top1_m"] = float(walks[0]) if walks else 0.0
    f["walk_top2_m"] = float(sum(walks[:2]))
    f["walk_min_of_top2_m"] = float(walks[1]) if len(walks) > 1 else 0.0
    # Path length grows with the length of the window whatever anybody
    # does, so the same numbers again as a rate. A changeover is not
    # "more walking happened", it is "they walked somewhere".
    secs = max(1e-6, f["duration"])
    f["walk_total_m_per_s"] = f["walk_total_m"] / secs
    f["walk_top1_m_per_s"] = f["walk_top1_m"] / secs
    f["walk_min_of_top2_m_per_s"] = f["walk_min_of_top2_m"] / secs
    f["max_depth_span"] = float(max(spans)) if spans else 0.0
    f["sum_top2_depth_span"] = float(sum(sorted(spans, reverse=True)[:2]))
    f["n_cross_near_to_far"] = float(crossings_nf)
    f["n_cross_far_to_near"] = float(crossings_fn)
    f["n_crossings"] = float(crossings_nf + crossings_fn)
    f["crossing_pair"] = float(crossings_nf >= 1 and crossings_fn >= 1)
    f["n_end_to_end"] = float(end_to_end)
    f["n_wide"] = float(wide)
    f["longest_track_s"] = longest_len / hz
    f["longest_track_ym_change"] = float(longest_change)
    f["longest_track_flipped"] = longest_flip
    f["longest_track_coverage"] = longest_len / n
    f["n_crossings_around"] = float(around)
    f["crossing_pair_around"] = float(
        around >= 2 and crossings_nf >= 1 and crossings_fn >= 1)
    f["n_spanning_flip"] = float(spanning_flip)
    f["cross_time_spread_s"] = (
        float(max(cross_times) - min(cross_times)) if len(cross_times) > 1
        else 0.0)
    f["frac_two_players"] = sum(1 for c in counts if c >= 2) / n
    third = max(1, n // 3)
    mid_near = near[third:2 * third] or near
    mid_far = far[third:2 * third] or far
    f["mid_frac_empty"] = sum(
        (not a) and (not b) for a, b in zip(mid_near, mid_far)) / len(mid_near)
    f["ends_occupied_at_both_edges"] = float(
        (near[0] or far[0]) and (near[-1] or far[-1]))

    lat_all = [p["xm"] / TABLE_W_M for ppl in per for p in ppl]
    f["max_lateral_excursion"] = float(
        max((max(0.0, l - 1.0, -l) for l in lat_all), default=0.0))

    # The idea this whole study set out to test: keep hold of ONE player
    # across the break. Both players are never at the same end, so if a
    # single track runs from the first frame to the last and its box
    # height crosses the near/far split, the pair swapped — and it stays
    # true when the OTHER player walks out of shot entirely, which is the
    # case that defeats every before-and-after comparison.
    if split == split:
        spanning_h = []
        for t in long_tracks:
            if t[0][0] > 1 or t[-1][0] < len(frames) - 2:
                continue
            h0 = float(np.median([p["h"] for _, p in t[:3]]))
            h1 = float(np.median([p["h"] for _, p in t[-3:]]))
            spanning_h.append((h0 >= split) != (h1 >= split))
        f["n_spanning_tracks"] = float(len(spanning_h))
        f["held_player_flipped"] = float(any(spanning_h))
        f["n_held_flipped"] = float(sum(spanning_h))

    # Where in the break to look. The shipped detector compares the
    # rally before with the rally after, so its evidence sits at the two
    # EDGES of this window; 'edges' below is that same position measured
    # with this descriptor, which is what separates "a better place to
    # look" from "a better thing to measure".
    for tag, share in (("edges", 0.08), ("quarter", 0.25), ("half", 0.5)):
        ev = ends(frames, named, share=share, split=split, per=per)
        if not ev:
            continue
        v = swap_score(*[mean_vec(ev[k], ("torso", "shorts"), True)
                         for k in ("near_before", "near_after",
                                   "far_before", "far_after")])
        if v is not None:
            f[f"app_swap_body_{tag}"] = v

    e = ends(frames, named, split=split, per=per)
    if e:
        for name, bands, chroma in (
            ("torso", ("torso",), True),
            ("head", ("head",), True),
            ("shorts", ("shorts",), True),
            ("shoes", ("shoes",), True),
            ("body", ("torso", "shorts"), True),
            ("full", BANDS, True),
            ("full_l", BANDS, False),
        ):
            s = swap_score(*[mean_vec(e[k], bands, chroma) for k in (
                "near_before", "near_after", "far_before", "far_after")])
            if s is not None:
                f[f"app_swap_{name}"] = s
        # Is this break one where the two players can be told apart at
        # all? A margin means nothing when both are in black: the same
        # gate the production detector calls separability.
        nb_ = mean_vec(e["near_before"], ("torso", "shorts"), True)
        fb_ = mean_vec(e["far_before"], ("torso", "shorts"), True)
        if nb_ is not None and fb_ is not None:
            apart = float(np.linalg.norm(nb_ - fb_))
            within = []
            for key in ("near_before", "far_before", "near_after",
                        "far_after"):
                vs = [band_vec(p, ("torso", "shorts"), True) for p in e[key]]
                vs = [v for v in vs if v is not None]
                if len(vs) >= 2:
                    m = np.mean(vs, axis=0)
                    within.append(float(np.mean(
                        [np.linalg.norm(v - m) for v in vs])))
            f["player_apart"] = apart
            if within:
                spread = float(np.mean(within))
                f["player_separability"] = apart / max(1e-6, spread)
                for name in ("body", "full", "torso"):
                    raw = f.get(f"app_swap_{name}")
                    if raw is not None:
                        f[f"app_swap_{name}_norm"] = raw / max(1e-6, spread)

        hb = [np.mean([p["h"] for p in e[k]]) if e[k] else None
              for k in ("near_before", "near_after", "far_before", "far_after")]
        if all(v is not None for v in hb):
            nb, na, fb, fa = hb
            f["height_swap"] = (abs(nb - na) + abs(fb - fa)) - (
                abs(nb - fa) + abs(fb - na))
    return f


# --- truth ------------------------------------------------------------------

def production_margins(match_id: str) -> dict[int, float]:
    """The live detector's own same-vs-swap margin for each break.

    Positive is 'same', negative is 'swapped': it is swap_cost minus
    same_cost over the rally frames either side. This is the number the
    shipped detector actually decides on, so it is the baseline any
    break-footage signal has to beat.
    """
    for name in ("evidence-v4.json", "evidence.json"):
        path = EVALDIR / match_id / name
        if path.is_file():
            try:
                data = json.loads(path.read_text())
            except Exception:                                # noqa: BLE001
                return {}
            return {int(p["a_idx"]): float(p["margin"])
                    for p in data.get("pairs") or []
                    if p.get("margin") is not None and p.get("adjacent")}
    return {}


def labels(considered: Sequence[str]) -> dict[str, dict]:
    from worker.judged_boundaries import TOLERANCE, boundaries
    return {"tolerance": TOLERANCE, "truth": boundaries()}


SCORING_TRUTH = WORKDIR / "scoring-truth.json"
# Scored boundaries drift one to four rallies behind the changeover they
# record, so a break this close to one is never called a clean negative
# even though only breaks within `tol` can claim it as a positive.
GUARD = 5


def scoring_truth() -> dict[str, dict]:
    if SCORING_TRUTH.is_file():
        return json.loads(SCORING_TRUTH.read_text())
    return {}


def label_windows(match8: str, after_idxs: Sequence[int], truth: dict,
                  tol: int, scored: dict | None = None) -> dict[int, str]:
    """One positive per judged boundary, not one per nearby break.

    The tolerance exists so a fire a rally or two off still counts as
    finding a changeover. Reusing it as a LABEL makes every break within
    three rallies of a boundary a positive, which on one match turned
    three changeovers into ten and filled the positive class with breaks
    where nobody moved. Each boundary claims its single closest break;
    the other breaks inside the tolerance are ambiguous and are dropped
    from the measurement rather than counted either way.
    """
    info = truth.get(match8)
    out = {i: "unknown" for i in after_idxs}
    score = (scored or {}).get(match8) or {}
    if not info and not score:
        return out
    info = info or {"real": [], "same": []}
    # Where the owner's scoring and his own viewing disagree, the video
    # wins — that is what game_end_override has meant since 021. So a
    # scored boundary he looked at and called 'same' is not a positive.
    groups = list(info["real"])
    for b in score.get("boundary_after_idx") or []:
        if any(abs(b - i) <= tol for i in info["same"]):
            continue
        if any(abs(b - g) <= tol for grp in info["real"] for g in grp):
            continue
        groups.append([b])
    claimed: set[int] = set()
    for group in groups:
        near = [(min(abs(i - g) for g in group), i) for i in after_idxs
                if any(abs(i - g) <= tol for g in group)]
        if not near:
            continue
        near.sort()
        claimed.add(near[0][1])
        out[near[0][1]] = "swapped"
        for _, i in near[1:]:
            out[i] = "ambiguous"
    for i in after_idxs:
        if out[i] != "unknown":
            continue
        if any(abs(i - j) <= tol for j in info["same"]):
            out[i] = "same"
            continue
        clear = all(abs(i - g) > GUARD for group in groups for g in group)
        if not clear:
            out[i] = "ambiguous"
        elif score.get("fully_scored"):
            # Every game in this match was scored, so every boundary is
            # known and a break far from all of them is a proven negative
            # rather than merely an unreviewed one.
            out[i] = "clean"
        else:
            out[i] = "quiet"
    return out


# --- scoring ----------------------------------------------------------------

def auc(pos: Sequence[float], neg: Sequence[float]) -> float:
    """Mann-Whitney U as a fraction; 0.5 is a coin, 1.0 is perfect."""
    if not pos or not neg:
        return float("nan")
    allv = sorted([(v, 0) for v in neg] + [(v, 1) for v in pos])
    ranks: dict[int, float] = {}
    i = 0
    order = 0.0
    while i < len(allv):
        j = i
        while j + 1 < len(allv) and allv[j + 1][0] == allv[i][0]:
            j += 1
        avg = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            ranks[k] = avg
        i = j + 1
    rsum = sum(ranks[k] for k, (_, lab) in enumerate(allv) if lab == 1)
    n1, n0 = len(pos), len(neg)
    return (rsum - n1 * (n1 + 1) / 2.0) / (n1 * n0)


def best_split(pos: Sequence[float], neg: Sequence[float]) -> dict:
    """Best single threshold, reported at the operating point that matters.

    Precision first: a false 'the players changed ends' marker on a
    match where they did not is the failure a user actually sees.
    """
    vals = sorted(set(list(pos) + list(neg)))
    best = {"acc": 0.0, "thr": None, "recall": 0.0, "precision": 0.0,
            "direction": ">="}
    for direction in (">=", "<="):
        for v in vals:
            if direction == ">=":
                tp = sum(1 for x in pos if x >= v)
                fp = sum(1 for x in neg if x >= v)
            else:
                tp = sum(1 for x in pos if x <= v)
                fp = sum(1 for x in neg if x <= v)
            fn, tn = len(pos) - tp, len(neg) - fp
            acc = (tp + tn) / (len(pos) + len(neg))
            if acc > best["acc"]:
                best = {
                    "acc": acc, "thr": v, "direction": direction,
                    "recall": tp / len(pos) if pos else 0.0,
                    "precision": tp / (tp + fp) if (tp + fp) else 0.0,
                    "tp": tp, "fp": fp, "fn": fn, "tn": tn,
                }
    return best


def _fit_logistic(X: np.ndarray, y: np.ndarray, steps: int = 4000,
                  lr: float = 0.2, l2: float = 1.0) -> np.ndarray:
    w = np.zeros(X.shape[1])
    n = max(1, len(y))
    for _ in range(steps):
        z = X @ w
        pr = 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30)))
        grad = X.T @ (pr - y) / n + l2 * w / n
        w -= lr * grad
    return w


def combine(rows: list[dict], pos_lab: str, neg_labs: set[str],
            names: Sequence[str]) -> None:
    """Score a combination honestly: never test on a match it trained on.

    With ~60 changeovers spread over 22 matches, a model fitted and
    scored on the same rows would report whatever it was asked to. Every
    match's rows are predicted by a model that never saw that match, so
    the number below is what a new upload would get.
    """
    use = [r for r in rows
           if (r["label"] == pos_lab or r["label"] in neg_labs)
           and all(isinstance(r.get(k), float) for k in names)]
    if len(use) < 30:
        print(f"\ncombination {names}: only {len(use)} usable rows")
        return
    y = np.array([1.0 if r["label"] == pos_lab else 0.0 for r in use])
    raw = np.array([[r[k] for k in names] for r in use])
    mu, sd = raw.mean(axis=0), raw.std(axis=0) + 1e-9
    X = np.hstack([(raw - mu) / sd, np.ones((len(use), 1))])
    matches = sorted({r["match"] for r in use})
    scores = np.zeros(len(use))
    for m in matches:
        te = np.array([r["match"] == m for r in use])
        if te.all() or y[~te].sum() < 2 or (1 - y[~te]).sum() < 2:
            scores[te] = np.nan
            continue
        w = _fit_logistic(X[~te], y[~te])
        scores[te] = X[te] @ w
    ok = ~np.isnan(scores)
    sp = list(scores[ok & (y == 1)])
    sn = list(scores[ok & (y == 0)])
    if len(sp) < 5 or len(sn) < 5:
        print(f"\ncombination {names}: too few after CV")
        return
    r100, _ = recall_at_precision(sp, sn, 1.0)
    r95, _ = recall_at_precision(sp, sn, 0.95)
    print(f"\nleave-one-match-out combination of {list(names)}")
    print(f"  {len(sp)} changeovers / {len(sn)} negatives   "
          f"AUC {auc(sp, sn):.3f}   R@P100 {r100:.3f}   R@P95 {r95:.3f}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path,
                    default=WORKDIR / "signals.json")
    ap.add_argument("--detail", action="store_true")
    ap.add_argument("--negatives", default="clean",
                    choices=["clean", "clean+quiet", "same"])
    args = ap.parse_args()

    truth_info = labels([])
    truth, tol = truth_info["truth"], truth_info["tolerance"]
    scored = scoring_truth()

    rows = []
    for folder in sorted(WORKDIR.iterdir()):
        bj = folder / "breaks.json"
        if not bj.is_file():
            continue
        data = json.loads(bj.read_text())
        named = _named_corners(data["corners"])
        hz = float(data.get("sample_hz") or 2.0)
        split = height_split([
            p["h"] for w in data["windows"] for fr in w.get("frames") or []
            for p in plausible(fr["people"], named)])
        match8 = folder.name[:8]
        prod = production_margins(folder.name)
        marks = label_windows(
            match8, [w["after_idx"] for w in data["windows"]], truth, tol,
            scored)
        for window in data["windows"]:
            lab = marks[window["after_idx"]]
            row = {"match": match8, "after_idx": window["after_idx"],
                   "label": lab, "fore": data.get("foreshortening")}
            row.update(features(window, named, hz, split))
            if window["after_idx"] in prod:
                # Negated so that, like every other signal here, bigger
                # means more like a swap.
                row["prod_swap_margin"] = -prod[window["after_idx"]]
            rows.append(row)

    args.out.write_text(json.dumps(rows))
    report(rows, args.negatives, args.detail)


def recall_at_precision(pos: Sequence[float], neg: Sequence[float],
                        want: float) -> tuple[float, float | None]:
    """Most positives findable without dropping below `want` precision.

    This is the number that decides whether a signal is shippable. The
    product only draws a marker when it is confident, so a signal worth
    having is one that can be trusted at a threshold, not one with a
    good average.
    """
    best_rec, best_thr = 0.0, None
    for direction in (1, -1):
        vals = sorted({direction * v for v in list(pos) + list(neg)})
        for v in vals:
            tp = sum(1 for x in pos if direction * x >= v)
            fp = sum(1 for x in neg if direction * x >= v)
            if tp == 0:
                continue
            prec = tp / (tp + fp)
            if prec >= want and tp / len(pos) > best_rec:
                best_rec = tp / len(pos)
                best_thr = direction * v
    return best_rec, best_thr


def report(rows: list[dict], negatives: str, detail: bool = False) -> None:
    ok_neg = {"same", "clean"}
    if negatives == "clean+quiet":
        ok_neg.add("quiet")
    if negatives == "same":
        ok_neg = {"same"}
    pos = [r for r in rows if r["label"] == "swapped"]
    neg = [r for r in rows if r["label"] in ok_neg]
    counts = {k: sum(1 for r in rows if r["label"] == k) for k in
              ("swapped", "same", "clean", "quiet", "ambiguous", "unknown")}
    print(f"{len(rows)} break windows across "
          f"{len({r['match'] for r in rows})} matches")
    print(f"  {counts['swapped']} changeovers, "
          f"{counts['clean']} proven-quiet (fully scored match), "
          f"{counts['same']} judged 'same', {counts['quiet']} unreviewed, "
          f"{counts['ambiguous']} too close to call (dropped)")
    print(f"  scoring: {len(pos)} positive vs {len(neg)} negative\n")
    keys = [k for k in rows[0] if isinstance(rows[0].get(k), float)]
    keys = sorted({k for r in rows for k, v in r.items()
                   if isinstance(v, float)})
    scored = []
    for k in keys:
        p = [r[k] for r in pos if isinstance(r.get(k), float)]
        n = [r[k] for r in neg if isinstance(r.get(k), float)]
        if len(p) < 5 or len(n) < 5:
            continue
        a = auc(p, n)
        b = best_split(p, n)
        scored.append((abs(a - 0.5), a, k, b, len(p), len(n)))
    scored.sort(reverse=True)
    print(f"{'signal':30} {'AUC':>6} {'acc':>6} {'R@P100':>7} {'R@P95':>7} "
          f" n")
    print("-" * 72)
    for _, a, k, b, np_, nn in scored:
        p_ = [r[k] for r in pos if isinstance(r.get(k), float)]
        n_ = [r[k] for r in neg if isinstance(r.get(k), float)]
        r100, _t = recall_at_precision(p_, n_, 1.0)
        r95, _t = recall_at_precision(p_, n_, 0.95)
        print(f"{k:30} {a:6.3f} {b['acc']:6.3f} {r100:7.3f} {r95:7.3f} "
              f" {np_}/{nn}")

    # A long break is already most of the answer: on this corpus
    # duration alone separates at AUC 0.91, because a changeover simply
    # takes longer than picking the ball up. So any signal has to be
    # shown to add something ON TOP of knowing how long the break was,
    # not merely to correlate with a changeover. Comparing only within
    # duration-matched groups is the cheap way to ask that.
    dur_pos = [r["duration"] for r in pos]
    dur_neg = [r["duration"] for r in neg]
    edges = np.quantile(dur_pos + dur_neg, [0.0, 0.25, 0.5, 0.75, 1.0])
    print("\nSame-length breaks only (duration-matched, pooled over "
          f"quartiles at {[round(float(e),1) for e in edges[1:-1]]}s):")
    strat = []
    for k in keys:
        num = den = 0.0
        used_p = used_n = 0
        for lo, hi in zip(edges[:-1], edges[1:]):
            sp = [r[k] for r in pos
                  if lo <= r["duration"] <= hi and isinstance(r.get(k), float)]
            sn = [r[k] for r in neg
                  if lo <= r["duration"] <= hi and isinstance(r.get(k), float)]
            if len(sp) < 2 or len(sn) < 2:
                continue
            a = auc(sp, sn)
            w = len(sp) * len(sn)
            num += a * w
            den += w
            used_p += len(sp)
            used_n += len(sn)
        if den and used_p >= 5:
            strat.append((abs(num / den - 0.5), num / den, k, used_p, used_n))
    strat.sort(reverse=True)
    print(f"  {'signal':30} {'AUC|dur':>8}   n")
    for _, a, k, up, un in strat[:14]:
        print(f"  {k:30} {a:8.3f}   {up}/{un}")

    # The operational question, asked directly. A detector would only
    # ever look at a break that is already long — the short ones are
    # somebody retrieving the ball — so the honest test is: given a long
    # break, did they change ends? Negatives here are the long breaks
    # where they did not, which are the ones that would produce a false
    # marker.
    for floor in (8.0, 12.0):
        lp = [r for r in pos if r["duration"] >= floor]
        ln = [r for r in neg if r["duration"] >= floor]
        if len(lp) < 5 or len(ln) < 5:
            print(f"\nBreaks >= {floor:.0f}s: {len(lp)} pos / {len(ln)} neg "
                  f"— too few to score")
            continue
        print(f"\nBreaks >= {floor:.0f}s only: {len(lp)} pos / {len(ln)} neg")
        sub = []
        for k in keys:
            a_ = [r[k] for r in lp if isinstance(r.get(k), float)]
            b_ = [r[k] for r in ln if isinstance(r.get(k), float)]
            if len(a_) < 5 or len(b_) < 5:
                continue
            sub.append((abs(auc(a_, b_) - 0.5), auc(a_, b_), k, a_, b_))
        sub.sort(reverse=True)
        print(f"  {'signal':30} {'AUC':>6} {'R@P100':>7} {'R@P95':>7}   n")
        for _, a_, k, ap, an in sub[:12]:
            r100, t100 = recall_at_precision(ap, an, 1.0)
            r95, _ = recall_at_precision(ap, an, 0.95)
            print(f"  {k:30} {a_:6.3f} {r100:7.3f} {r95:7.3f}   "
                  f"{len(ap)}/{len(an)}")

    # The question that decides whether any of this ships. Production
    # already compares the rally before a break with the rally after, and
    # that comparison is the baseline. What matters is not whether break
    # footage separates changeovers on its own, but whether it separates
    # them for reasons production does not already have.
    for names in (
        ("prod_swap_margin",),
        ("duration",),
        ("scale_exchange",),
        ("prod_swap_margin", "duration"),
        ("prod_swap_margin", "scale_exchange"),
        ("prod_swap_margin", "duration", "scale_exchange"),
        ("prod_swap_margin", "duration", "sum_top2_depth_span",
         "max_lateral_excursion"),
        ("prod_swap_margin", "duration", "scale_exchange",
         "max_lateral_excursion", "sum_top2_depth_span"),
        ("prod_swap_margin", "duration", "scale_exchange",
         "max_lateral_excursion", "sum_top2_depth_span",
         "app_swap_full_l"),
    ):
        combine(rows, "swapped",
                {"clean", "same"} | ({"quiet"} if negatives == "clean+quiet"
                                     else set()), names)

    if detail:
        print("\nEvery changeover, with what each family of signal saw:")
        print(f"  {'break':16} {'secs':>6} {'walk':>6} {'scale':>6} "
              f"{'appear':>7} {'prod':>7}")
        for r in sorted(pos, key=lambda r: (r["match"], r["after_idx"])):
            def g(k):
                v = r.get(k)
                return f"{v:6.2f}" if isinstance(v, float) else "     -"
            print(f"  {r['match']}@{r['after_idx']:<6} "
                  f"{r['duration']:6.1f} {g('walk_min_of_top2_m')} "
                  f"{g('scale_exchange')} {g('app_swap_full_l'):>7} "
                  f"{g('prod_swap_margin'):>7}")

    # Side-on cameras see the walk; end-on ones see it head on and the
    # near player fills the frame. Whether a signal survives that split
    # decides if it is one rule or two.
    for name, keep in (("side-on (fore >= 0.5)",
                        lambda r: (r.get("fore") or 0) >= 0.5),
                       ("end-on  (fore <  0.5)",
                        lambda r: (r.get("fore") or 0) < 0.5)):
        sp = [r for r in pos if keep(r)]
        sn = [r for r in neg if keep(r)]
        if len(sp) < 4 or len(sn) < 4:
            print(f"\n{name}: {len(sp)} pos / {len(sn)} neg — too few")
            continue
        print(f"\n{name}: {len(sp)} pos / {len(sn)} neg")
        sub = []
        for k in keys:
            a_ = [r[k] for r in sp if isinstance(r.get(k), float)]
            b_ = [r[k] for r in sn if isinstance(r.get(k), float)]
            if len(a_) < 4 or len(b_) < 4:
                continue
            sub.append((abs(auc(a_, b_) - 0.5), auc(a_, b_), k, a_, b_))
        sub.sort(reverse=True)
        for _, a_, k, ap, an in sub[:8]:
            r100, _t = recall_at_precision(ap, an, 1.0)
            print(f"  {k:28} AUC {a_:5.3f}  R@P100 {r100:5.3f}")


if __name__ == "__main__":
    main()

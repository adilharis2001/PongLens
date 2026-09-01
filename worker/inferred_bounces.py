"""Admin-only evidence for table bounces the production detector missed.

This module is deliberately pure: callers provide one card's observations
and hard events, and receive an additive JSON envelope.  Nothing here mutates
the point assembler's evidence or feeds a decision back into production.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal, Mapping

import numpy as np

try:  # package import in tests; direct import in worker scripts
    from .points_v2 import (BOUNCE_MOTION_PX, BOUNCE_REVERSAL_PX, L_M,
                            NET_V, PRIOR_CROSS_MAX, PRIOR_CROSS_WINDOW_S,
                            W_M, project)
except ImportError:  # pragma: no cover - exercised by worker entry points
    from points_v2 import (BOUNCE_MOTION_PX, BOUNCE_REVERSAL_PX, L_M,
                           NET_V, PRIOR_CROSS_MAX, PRIOR_CROSS_WINDOW_S,
                           W_M, project)


SCHEMA_VERSION = 1
DETECTOR_VERSION = "shadow-v1.5"
CONSTRAINT_GATE_ENABLED = False
MAX_CANDIDATES_PER_CARD = 8

TIME_METHODS = {
    "weak_reversal",
    "subthreshold_curvature",
    "occlusion_bridge",
    "serve_flight_order",
}
TABLE_POSITION_METHODS = {"observed_contact_frame", "two_sided_track_fit"}
CONTEXTS = {"serve_first_bounce", "mid_rally", "unknown"}
CONFIDENCE_TIERS = {"high", "medium", "diagnostic"}
PREFERRED_HYPOTHESES = {
    "latent_bounce",
    "continuous_airborne",
    "indeterminate",
}
MISS_REASONS = {
    "below_reversal_threshold",
    "below_motion_threshold",
    "track_gap_at_event",
    "candidate_not_offered",
    "masked_for_evaluation",
    "unknown",
}
CONSTRAINT_MODES = {"hard_z0", "display_only"}


def _finite(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) \
        and math.isfinite(float(value))


def _require_finite(name: str, value: object) -> float:
    if not _finite(value):
        raise ValueError(f"{name} must be finite")
    return float(value)


@dataclass(frozen=True)
class Observation:
    t: float
    x_px: float
    y_px: float
    confidence: float | None
    measured: bool

    def __post_init__(self) -> None:
        for name in ("t", "x_px", "y_px"):
            _require_finite(f"observation.{name}", getattr(self, name))
        if self.confidence is not None:
            _require_finite("observation.confidence", self.confidence)


@dataclass(frozen=True)
class HardBounce:
    t: float
    x_px: float
    y_px: float
    u_m: float | None
    v_m: float | None
    on_surface: bool

    def __post_init__(self) -> None:
        for name in ("t", "x_px", "y_px"):
            _require_finite(f"hard_bounce.{name}", getattr(self, name))
        if (self.u_m is None) != (self.v_m is None):
            raise ValueError("hard_bounce table coordinates must be complete")
        if self.u_m is not None:
            _require_finite("hard_bounce.u_m", self.u_m)
            _require_finite("hard_bounce.v_m", self.v_m)


@dataclass(frozen=True)
class KnownContact:
    t: float
    kind: Literal["paddle", "net", "unknown"]
    confidence: float

    def __post_init__(self) -> None:
        _require_finite("known_contact.t", self.t)
        value = _require_finite("known_contact.confidence", self.confidence)
        if self.kind not in {"paddle", "net", "unknown"}:
            raise ValueError("known_contact.kind is invalid")
        if not 0.0 <= value <= 1.0:
            raise ValueError("known_contact.confidence must be in 0..1")


@dataclass(frozen=True)
class CardInput:
    t0: float
    t1: float
    fps: float
    width_px: float
    height_px: float
    observations: tuple[Observation, ...]
    hard_bounces: tuple[HardBounce, ...]
    crossings: tuple[float, ...]
    audio_impacts: tuple[tuple[float, float], ...]
    homography: np.ndarray
    accepted_serve_bounces: tuple[float, ...] = ()
    known_contacts: tuple[KnownContact, ...] = ()
    calibration_healthy: bool = True

    def __post_init__(self) -> None:
        for name in ("t0", "t1", "fps", "width_px", "height_px"):
            _require_finite(f"card.{name}", getattr(self, name))
        if self.t1 <= self.t0:
            raise ValueError("card bounds must be ordered")
        if self.fps <= 0 or self.width_px <= 0 or self.height_px <= 0:
            raise ValueError("card dimensions and fps must be positive")

        observations = tuple(sorted(tuple(self.observations), key=lambda o: o.t))
        if any(o.t < self.t0 or o.t > self.t1 for o in observations):
            raise ValueError("observation outside card bounds")
        hard_bounces = tuple(sorted(tuple(self.hard_bounces), key=lambda b: b.t))
        if any(b.t < self.t0 or b.t > self.t1 for b in hard_bounces):
            raise ValueError("hard bounce outside card bounds")

        crossings = tuple(sorted(_require_finite("crossing", t)
                                 for t in self.crossings))
        audio_impacts = tuple(sorted(
            (_require_finite("audio time", t),
             _require_finite("audio strength", strength))
            for t, strength in self.audio_impacts
        ))
        accepted = tuple(sorted(_require_finite("accepted serve bounce", t)
                                for t in self.accepted_serve_bounces))
        contacts = tuple(sorted(tuple(self.known_contacts), key=lambda c: c.t))
        homography = np.array(self.homography, dtype=float, copy=True)
        if homography.shape != (3, 3) or not np.isfinite(homography).all():
            raise ValueError("homography must be a finite 3x3 matrix")
        homography.setflags(write=False)

        object.__setattr__(self, "observations", observations)
        object.__setattr__(self, "hard_bounces", hard_bounces)
        object.__setattr__(self, "crossings", crossings)
        object.__setattr__(self, "audio_impacts", audio_impacts)
        object.__setattr__(self, "accepted_serve_bounces", accepted)
        object.__setattr__(self, "known_contacts", contacts)
        object.__setattr__(self, "homography", homography)


@dataclass(frozen=True)
class CandidateSeed:
    estimate_s: float
    interval_s: tuple[float, float]
    method: Literal[
        "weak_reversal",
        "subthreshold_curvature",
        "occlusion_bridge",
        "serve_flight_order",
    ]
    source_strength: float

    def __post_init__(self) -> None:
        estimate = _require_finite("candidate estimate", self.estimate_s)
        lo = _require_finite("candidate interval start", self.interval_s[0])
        hi = _require_finite("candidate interval end", self.interval_s[1])
        strength = _require_finite("candidate source strength",
                                   self.source_strength)
        if self.method not in TIME_METHODS:
            raise ValueError("candidate method is invalid")
        if lo > estimate or estimate > hi:
            raise ValueError("candidate estimate must lie inside interval")
        if not 0.0 <= strength <= 1.0:
            raise ValueError("candidate source strength must be in 0..1")


@dataclass(frozen=True)
class HypothesisComparison:
    preferred: Literal[
        "latent_bounce", "continuous_airborne", "indeterminate"
    ]
    continuous_airborne_cost: float
    latent_bounce_cost: float
    margin: float
    estimate_s: float
    interval_s: tuple[float, float]


def empty_envelope() -> dict:
    """A successful shadow run that found no candidate."""
    return {
        "schema_version": SCHEMA_VERSION,
        "detector_version": DETECTOR_VERSION,
        "clock": "source_seconds",
        "candidates": [],
    }


def candidate_id(estimate_s: float, context: str) -> str:
    _require_finite("candidate time", estimate_s)
    if context not in CONTEXTS:
        raise ValueError("candidate context is invalid")
    return f"ib-{float(estimate_s):.3f}-{context}"


def _record(value: object, name: str) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{name} must be an object")
    return value


def _require_keys(record: Mapping[str, object], name: str,
                  required: set[str]) -> None:
    missing = required.difference(record)
    if missing:
        raise ValueError(f"{name} missing {', '.join(sorted(missing))}")


def _normalized(name: str, value: object) -> float:
    number = _require_finite(name, value)
    if not 0.0 <= number <= 1.0:
        raise ValueError(f"{name} must be in 0..1")
    return number


def _diagnostic_items(value: object, name: str) -> None:
    if not isinstance(value, list):
        raise ValueError(f"{name} must be a list")
    for index, raw in enumerate(value):
        item = _record(raw, f"{name}[{index}]")
        _require_keys(item, f"{name}[{index}]", {"kind", "strength"})
        if not isinstance(item["kind"], str) or not item["kind"]:
            raise ValueError(f"{name}[{index}].kind must be non-empty")
        _normalized(f"{name}[{index}].strength", item["strength"])
        if "detail" in item and not isinstance(item["detail"], str):
            raise ValueError(f"{name}[{index}].detail must be text")
        for key, item_value in item.items():
            if key not in {"kind", "strength", "detail"}:
                _require_finite(f"{name}[{index}].{key}", item_value)


def validate_candidate(candidate: object) -> dict:
    """Validate one serialized schema-v1 candidate and return it unchanged."""
    value = _record(candidate, "candidate")
    _require_keys(value, "candidate", {
        "id", "time", "table_position", "context", "confidence",
        "hypothesis_comparison", "support", "vetoes",
        "normal_detector_miss", "trajectory_constraint",
    })
    if not isinstance(value["id"], str) or not value["id"]:
        raise ValueError("candidate.id must be non-empty")

    time = _record(value["time"], "time")
    _require_keys(time, "time", {"estimate_s", "interval_s", "method"})
    estimate = _require_finite("time.estimate_s", time["estimate_s"])
    interval = time["interval_s"]
    if not isinstance(interval, (list, tuple)) or len(interval) != 2:
        raise ValueError("time.interval_s must contain two values")
    lo = _require_finite("time.interval_s[0]", interval[0])
    hi = _require_finite("time.interval_s[1]", interval[1])
    if lo > estimate or estimate > hi:
        raise ValueError("time estimate must lie inside interval")
    if time["method"] not in TIME_METHODS:
        raise ValueError("time.method is invalid")

    position = value["table_position"]
    if position is not None:
        position = _record(position, "table_position")
        expected = {"u_m", "v_m", "uncertainty_radius_m", "method"}
        if set(position) != expected:
            raise ValueError("table_position must be complete")
        for key in ("u_m", "v_m", "uncertainty_radius_m"):
            _require_finite(f"table_position.{key}", position[key])
        if float(position["uncertainty_radius_m"]) < 0:
            raise ValueError("table_position uncertainty must be non-negative")
        if position["method"] not in TABLE_POSITION_METHODS:
            raise ValueError("table_position.method is invalid")

    if value["context"] not in CONTEXTS:
        raise ValueError("context is invalid")

    confidence = _record(value["confidence"], "confidence")
    _require_keys(confidence, "confidence", {"score", "tier"})
    _normalized("confidence.score", confidence["score"])
    if confidence["tier"] not in CONFIDENCE_TIERS:
        raise ValueError("confidence.tier is invalid")

    comparison = _record(value["hypothesis_comparison"],
                         "hypothesis_comparison")
    _require_keys(comparison, "hypothesis_comparison", {
        "preferred", "continuous_airborne_cost", "latent_bounce_cost",
        "margin",
    })
    if comparison["preferred"] not in PREFERRED_HYPOTHESES:
        raise ValueError("hypothesis_comparison.preferred is invalid")
    for key in ("continuous_airborne_cost", "latent_bounce_cost", "margin"):
        _require_finite(f"hypothesis_comparison.{key}", comparison[key])

    _diagnostic_items(value["support"], "support")
    _diagnostic_items(value["vetoes"], "vetoes")

    miss = _record(value["normal_detector_miss"], "normal_detector_miss")
    _require_keys(miss, "normal_detector_miss", {"reason", "detail"})
    if miss["reason"] not in MISS_REASONS or not isinstance(miss["detail"], str):
        raise ValueError("normal_detector_miss is invalid")

    constraint = _record(value["trajectory_constraint"],
                         "trajectory_constraint")
    _require_keys(constraint, "trajectory_constraint", {
        "safe_to_constrain_z0", "mode", "reason",
    })
    safe = constraint["safe_to_constrain_z0"]
    if not isinstance(safe, bool) or constraint["mode"] not in CONSTRAINT_MODES \
            or not isinstance(constraint["reason"], str):
        raise ValueError("trajectory_constraint is invalid")
    if safe != (constraint["mode"] == "hard_z0"):
        raise ValueError("trajectory_constraint mode disagrees with safety")

    return candidate  # type: ignore[return-value]


def continuous_runs(observations: tuple[Observation, ...], fps: float,
                    *, max_gap_frames: float = 4.0) \
        -> list[tuple[Observation, ...]]:
    """Split measured positions at the same four-frame boundary as Admin."""
    if not observations:
        return []
    max_gap = max_gap_frames / fps
    runs: list[list[Observation]] = [[observations[0]]]
    for observation in observations[1:]:
        if observation.t - runs[-1][-1].t > max_gap + 1e-9:
            runs.append([])
        runs[-1].append(observation)
    return [tuple(run) for run in runs]


def _near_hard_bounce(card: CardInput, t: float) -> bool:
    # The event detector and the fitted reversal do not necessarily choose
    # the same source frame.  One frame was too tight on Young 2 and let an
    # accepted bounce at 343.38 reappear as an "inferred" event at 343.417.
    # A 1.5-frame reconciliation window absorbs timestamp quantization while
    # remaining far below the physical spacing of two table bounces.
    tolerance = 1.5 / card.fps + 1e-9
    existing = tuple(bounce.t for bounce in card.hard_bounces) \
        + card.accepted_serve_bounces
    return any(abs(existing_t - t) <= tolerance for existing_t in existing)


def _weak_reversal_seeds(card: CardInput) -> list[CandidateSeed]:
    scale = card.width_px / 1920.0
    reversal_gate = BOUNCE_REVERSAL_PX * scale
    motion_gate = BOUNCE_MOTION_PX * scale
    observations = card.observations
    seeds = []
    for i in range(2, len(observations) - 2):
        window = observations[i - 2:i + 3]
        if any((b.t - a.t) * card.fps > 3.0 + 0.15
               for a, b in zip(window, window[1:])):
            continue
        centre = window[2]
        if centre.y_px < window[1].y_px or centre.y_px < window[3].y_px:
            continue
        left = centre.y_px - window[0].y_px
        right = centre.y_px - window[4].y_px
        motion = math.hypot(centre.x_px - window[1].x_px,
                            centre.y_px - window[1].y_px)
        normal_accepts = (left >= reversal_gate and right >= reversal_gate
                          and motion >= motion_gate)
        if normal_accepts or _near_hard_bounce(card, centre.t):
            continue
        reversal_strength = min(1.0, max(0.0, min(left, right))
                                / max(reversal_gate, 1e-9))
        motion_strength = min(1.0, motion / max(motion_gate, 1e-9))
        strength = max(0.2, 0.65 * reversal_strength
                       + 0.35 * motion_strength)
        seeds.append(CandidateSeed(
            centre.t, (window[0].t, window[4].t),
            "weak_reversal", strength
        ))
    return seeds


def _curvature_seeds(card: CardInput) -> list[CandidateSeed]:
    seeds = []
    for run in continuous_runs(card.observations, card.fps):
        if len(run) < 7:
            continue
        for i in range(3, len(run) - 3):
            window = run[i - 3:i + 4]
            ts = np.asarray([o.t for o in window], dtype=float)
            ys = np.asarray([o.y_px for o in window], dtype=float)
            origin = float(ts[3])
            coeff = np.polyfit(ts - origin, ys, 2)
            if coeff[0] >= -1e-9:
                continue
            vertex = origin - coeff[1] / (2.0 * coeff[0])
            if not window[2].t <= vertex <= window[4].t:
                continue
            if _near_hard_bounce(card, vertex):
                continue
            spread = float(np.ptp(ys))
            strength = min(1.0, max(0.2, spread /
                                    max(2.0 * BOUNCE_REVERSAL_PX, 1e-9)))
            seeds.append(CandidateSeed(
                vertex, (window[0].t, window[6].t),
                "subthreshold_curvature", strength,
            ))
    return seeds


def _occlusion_seeds(card: CardInput) -> list[CandidateSeed]:
    seeds = []
    observations = card.observations
    for i, (before, after) in enumerate(zip(observations, observations[1:])):
        gap_frames = (after.t - before.t) * card.fps
        if gap_frames <= 4.0 + 0.15 or gap_frames > 12.0 + 0.15:
            continue
        if i < 2 or len(observations) - (i + 1) < 3:
            continue
        estimate = (before.t + after.t) / 2.0
        if _near_hard_bounce(card, estimate):
            continue
        inbound_dy = before.y_px - observations[i - 1].y_px
        outbound_dy = observations[i + 2].y_px - after.y_px
        if inbound_dy <= 0 or outbound_dy >= 0:
            continue
        duration_strength = min(1.0, (gap_frames - 4.0) / 8.0)
        seeds.append(CandidateSeed(
            estimate, (before.t, after.t), "occlusion_bridge",
            max(0.35, duration_strength),
        ))
    return seeds


def _serve_flight_order_seeds(card: CardInput) -> list[CandidateSeed]:
    seeds = []
    surface = [bounce for bounce in card.hard_bounces
               if bounce.on_surface and bounce.v_m is not None]
    for landing in surface:
        prior_crossings = [t for t in card.crossings if t < landing.t]
        if not prior_crossings:
            continue
        crossing = prior_crossings[-1]
        before = [o for o in card.observations if o.t < crossing]
        if len(before) < 3:
            continue
        projected = [project(card.homography, o.x_px, o.y_px)
                     for o in before[:min(5, len(before))]]
        projected = [p for p in projected if p is not None]
        if len(projected) < 3:
            continue
        origin_v = float(np.median([p[1] for p in projected]))
        origin_side = -1 if origin_v < NET_V else 1
        landing_side = -1 if float(landing.v_m) < NET_V else 1
        if origin_side == landing_side:
            continue
        if any(bounce.on_surface and bounce.v_m is not None
               and bounce.t < landing.t
               and (-1 if float(bounce.v_m) < NET_V else 1) == origin_side
               for bounce in surface):
            continue
        start = before[0].t
        estimate = start + 0.45 * (crossing - start)
        if estimate <= card.t0 or _near_hard_bounce(card, estimate):
            continue
        half_frame = 1.0 / card.fps
        seeds.append(CandidateSeed(
            estimate, (max(card.t0, estimate - half_frame),
                       min(crossing, estimate + half_frame)),
            "serve_flight_order", 0.55,
        ))
    return seeds


def deduplicate_candidate_seeds(seeds: list[CandidateSeed], *, fps: float) \
        -> list[CandidateSeed]:
    """Collapse only estimates within one frame, not uncertainty overlap."""
    precedence = {
        "weak_reversal": 0,
        "subthreshold_curvature": 1,
        "occlusion_bridge": 2,
        "serve_flight_order": 3,
    }
    proposed = list(seeds)
    proposed.sort(key=lambda seed: (precedence[seed.method],
                                    -seed.source_strength, seed.estimate_s))
    kept: list[CandidateSeed] = []
    for seed in proposed:
        duplicate = any(
            abs(seed.estimate_s - prior.estimate_s) <= 1.0 / fps
            for prior in kept
        )
        if not duplicate:
            kept.append(seed)
    kept.sort(key=lambda seed: seed.estimate_s)
    return kept[:MAX_CANDIDATES_PER_CARD]


def generate_candidate_seeds(card: CardInput) -> list[CandidateSeed]:
    """Broad proposals; audio deliberately cannot propose an event."""
    proposed = (
        _weak_reversal_seeds(card)
        + _curvature_seeds(card)
        + _occlusion_seeds(card)
        + _serve_flight_order_seeds(card)
    )
    return deduplicate_candidate_seeds(proposed, fps=card.fps)


def _observation_weights(observations: tuple[Observation, ...]) -> np.ndarray:
    values = []
    for observation in observations:
        if observation.measured and observation.confidence is not None:
            values.append(min(25.0, max(0.25, observation.confidence)))
        else:
            values.append(1.0)
    weights = np.asarray(values, dtype=float)
    return weights / max(float(np.mean(weights)), 1e-9)


def _robust_fit(design: np.ndarray, values: np.ndarray,
                base_weights: np.ndarray) -> tuple[np.ndarray, float]:
    weights = np.array(base_weights, dtype=float, copy=True)
    beta = np.zeros(design.shape[1], dtype=float)
    for _ in range(3):
        root = np.sqrt(weights)
        beta, *_ = np.linalg.lstsq(design * root[:, None],
                                   values * root, rcond=None)
        residual = values - design @ beta
        scale = 1.4826 * float(np.median(np.abs(
            residual - np.median(residual))))
        if scale <= 1e-12:
            break
        limit = 1.345 * scale
        huber = np.minimum(1.0, limit / np.maximum(np.abs(residual), 1e-12))
        weights = base_weights * huber
    residual = values - design @ beta
    rss = float(np.sum(weights * residual * residual)
                / max(float(np.mean(weights)), 1e-9))
    return beta, rss


def _bic(rss: float, n: int, parameters: int) -> float:
    return n * math.log(max(rss / max(n, 1), 1e-12)) \
        + parameters * math.log(max(n, 2))


def _comparison_at(observations: tuple[Observation, ...], candidate_t: float,
                   width_px: float, height_px: float) \
        -> tuple[float, float, bool]:
    tau = np.asarray([o.t - candidate_t for o in observations], dtype=float)
    ones = np.ones(len(observations), dtype=float)
    continuous = np.column_stack((ones, tau, tau * tau))
    positive = np.maximum(tau, 0.0)
    latent_y = np.column_stack((ones, tau, tau * tau,
                                positive, positive * positive))
    xs = np.asarray([o.x_px / width_px for o in observations], dtype=float)
    ys = np.asarray([o.y_px / height_px for o in observations], dtype=float)
    weights = _observation_weights(observations)
    _, x_rss = _robust_fit(continuous, xs, weights)
    y_continuous, y_cont_rss = _robust_fit(continuous, ys, weights)
    y_latent, y_lat_rss = _robust_fit(latent_y, ys, weights)
    continuous_cost = _bic(x_rss, len(xs), 3) \
        + _bic(y_cont_rss, len(ys), 3)
    latent_cost = _bic(x_rss, len(xs), 3) \
        + _bic(y_lat_rss, len(ys), 5)
    inbound_slope = float(y_latent[1])
    outbound_slope = float(y_latent[1] + y_latent[3])
    reversal = inbound_slope > 1e-7 and outbound_slope < -1e-7
    # Retain the fit variables while making the physical reversal explicit.
    _ = y_continuous
    return continuous_cost, latent_cost, reversal


def compare_hypotheses(
    observations: tuple[Observation, ...],
    *,
    candidate_t: float,
    width_px: float,
    height_px: float,
    interval_s: tuple[float, float] | None = None,
    fps: float = 30.0,
) -> HypothesisComparison:
    """Compare one smooth flight with a continuous joined bounce model."""
    if len(observations) < 7:
        raise ValueError("at least seven observations are required")
    if width_px <= 0 or height_px <= 0 or fps <= 0:
        raise ValueError("source dimensions and fps must be positive")
    if interval_s is None:
        times = np.asarray([float(candidate_t)])
    else:
        lo, hi = interval_s
        if lo > candidate_t or candidate_t > hi:
            raise ValueError("candidate time must lie inside interval")
        step = 1.0 / (3.0 * fps)
        times = np.arange(lo, hi + step * 0.5, step)
        times = times[(times >= lo - 1e-12) & (times <= hi + 1e-12)]
        times = np.unique(np.append(times, [lo, candidate_t, hi]))

    fits = []
    for t in times:
        continuous_cost, latent_cost, reversal = _comparison_at(
            observations, float(t), width_px, height_px
        )
        fits.append((float(t), continuous_cost, latent_cost, reversal))
    best = min(fits, key=lambda fit: fit[2])
    estimate, continuous_cost, latent_cost, reversal = best
    margin = continuous_cost - latent_cost
    if margin > 2.0 and reversal:
        preferred = "latent_bounce"
    elif margin < -2.0 or not reversal:
        preferred = "continuous_airborne"
    else:
        preferred = "indeterminate"

    accepted_times = [fit[0] for fit in fits
                      if fit[2] <= latent_cost + 2.0]
    return HypothesisComparison(
        preferred=preferred,
        continuous_airborne_cost=continuous_cost,
        latent_bounce_cost=latent_cost,
        margin=margin,
        estimate_s=estimate,
        interval_s=(min(accepted_times), max(accepted_times)),
    )


def _clamp01(value: float) -> float:
    return min(1.0, max(0.0, float(value)))


def _local_observations(card: CardInput, t: float) -> tuple[Observation, ...]:
    local = tuple(o for o in card.observations if abs(o.t - t) <= 0.36)
    return local if len(local) >= 7 else card.observations


def _projected_side(card: CardInput, observations: tuple[Observation, ...]) \
        -> int | None:
    positions = [project(card.homography, o.x_px, o.y_px)
                 for o in observations]
    positions = [p for p in positions if p is not None
                 and -0.3 <= p[1] <= L_M + 0.3]
    if not positions:
        return None
    median_v = float(np.median([p[1] for p in positions]))
    return -1 if median_v < NET_V else 1


def _serve_landing(card: CardInput, t: float, origin_side: int | None) \
        -> HardBounce | None:
    if origin_side is None:
        return None
    for bounce in card.hard_bounces:
        if bounce.t <= t or not bounce.on_surface or bounce.v_m is None:
            continue
        landing_side = -1 if float(bounce.v_m) < NET_V else 1
        if landing_side == origin_side:
            continue
        if any(t < crossing < bounce.t for crossing in card.crossings):
            return bounce
    return None


def _context(card: CardInput, t: float) \
        -> tuple[str, HardBounce | None, int | None]:
    prior_crossing = sum(
        1 for crossing in card.crossings
        if t - PRIOR_CROSS_WINDOW_S <= crossing < t - 0.05
    ) > PRIOR_CROSS_MAX
    if prior_crossing or any(b < t - 0.05
                             for b in card.accepted_serve_bounces):
        return "mid_rally", None, None

    before = tuple(o for o in card.observations if o.t < t)[-5:]
    origin_side = _projected_side(card, before)
    landing = _serve_landing(card, t, origin_side)
    accepted_near = any(abs(b - t) <= 0.20
                        for b in card.accepted_serve_bounces)
    if landing is not None and not accepted_near:
        return "serve_first_bounce", landing, origin_side
    return "unknown", None, origin_side


def _two_sided_prediction(observations: tuple[Observation, ...], t: float) \
        -> tuple[tuple[float, float], tuple[float, float]] | None:
    before = [o for o in observations if o.t <= t][-5:]
    after = [o for o in observations if o.t >= t][:5]
    if len(before) < 3 or len(after) < 3:
        return None

    def predict(rows: list[Observation]) -> tuple[float, float]:
        ts = np.asarray([o.t - t for o in rows], dtype=float)
        degree = min(2, len(rows) - 1)
        x_coeff = np.polyfit(ts, [o.x_px for o in rows], degree)
        y_coeff = np.polyfit(ts, [o.y_px for o in rows], degree)
        return float(np.polyval(x_coeff, 0.0)), float(np.polyval(y_coeff, 0.0))

    return predict(before), predict(after)


def _table_position(card: CardInput, t: float,
                    interval: tuple[float, float]) -> dict | None:
    if not card.calibration_healthy:
        return None
    predicted = _two_sided_prediction(card.observations, t)
    if predicted is None:
        return None
    inbound_px, outbound_px = predicted
    inbound = project(card.homography, *inbound_px)
    outbound = project(card.homography, *outbound_px)
    if inbound is None or outbound is None:
        return None
    spread = math.dist(inbound, outbound)
    if spread > 0.24:
        return None
    estimate = (float((inbound[0] + outbound[0]) / 2.0),
                float((inbound[1] + outbound[1]) / 2.0))
    if not (0.0 <= estimate[0] <= W_M and 0.0 <= estimate[1] <= L_M):
        return None

    interval_spread = 0.0
    for bound in interval:
        if abs(bound - t) <= 1e-9:
            continue
        at_bound = _two_sided_prediction(card.observations, bound)
        if at_bound is None:
            return None
        projected_bound = [project(card.homography, *pixels)
                           for pixels in at_bound]
        if any(position is None for position in projected_bound):
            return None
        interval_spread = max(
            interval_spread,
            *(math.dist(estimate, position) for position in projected_bound
              if position is not None),
        )
    if interval_spread > 0.24:
        return None

    pixel_offsets = [
        project(card.homography, inbound_px[0] + 1.0, inbound_px[1]),
        project(card.homography, inbound_px[0], inbound_px[1] + 1.0),
    ]
    pixel_error = max(
        (math.dist(inbound, p) for p in pixel_offsets if p is not None),
        default=0.0,
    )
    observed = any(abs(o.t - t) <= 0.5 / card.fps
                   for o in card.observations)
    return {
        "u_m": round(estimate[0], 4),
        "v_m": round(estimate[1], 4),
        "uncertainty_radius_m": round(
            spread / 2.0 + pixel_error + interval_spread, 4
        ),
        "method": ("observed_contact_frame" if observed
                   else "two_sided_track_fit"),
    }


def _known_contact_vetoes(card: CardInput, t: float) -> list[dict]:
    vetoes = []
    for contact in card.known_contacts:
        window = 0.10 if contact.kind == "paddle" else 0.12
        if contact.kind in {"paddle", "net"} and abs(contact.t - t) <= window:
            vetoes.append({
                "kind": f"{contact.kind}_contact",
                "strength": round(_clamp01(contact.confidence), 4),
                "offset_s": round(contact.t - t, 4),
            })
    return vetoes


def _motion_vetoes(card: CardInput, t: float, context: str,
                   position: dict | None, landing: HardBounce | None) \
        -> list[dict]:
    vetoes = _known_contact_vetoes(card, t)
    if not card.calibration_healthy:
        vetoes.append({"kind": "unhealthy_calibration", "strength": 1.0})
    if context == "serve_first_bounce" and landing is not None:
        later_crossings = [crossing for crossing in card.crossings
                           if landing.t < crossing <= landing.t + 1.5]
        if later_crossings and min(later_crossings) - landing.t >= 0.8:
            vetoes.append({"kind": "possible_handoff_reverse_flight",
                           "strength": 0.8})
        if (position is not None and landing.u_m is not None
                and landing.v_m is not None and landing.t > t
                and math.dist(
                    (float(position["u_m"]), float(position["v_m"])),
                    (float(landing.u_m), float(landing.v_m)),
                ) / (landing.t - t) > 35.0):
            vetoes.append({"kind": "impossible_speed", "strength": 1.0})

    prior = None
    local_observations = [observation for observation in card.observations
                          if t - 0.36 <= observation.t <= t + 0.36]
    for observation in local_observations:
        if prior is not None:
            dt = observation.t - prior.t
            normalized_jump = math.hypot(
                (observation.x_px - prior.x_px) / card.width_px,
                (observation.y_px - prior.y_px) / card.height_px,
            )
            if dt <= 4.0 / card.fps + 1e-9 and normalized_jump > 0.18:
                vetoes.append({"kind": "identity_jump", "strength": 1.0})
                break
        prior = observation
    return vetoes


def _nearest_audio(card: CardInput, t: float) -> tuple[float, float] | None:
    if not card.audio_impacts:
        return None
    nearest = min(card.audio_impacts, key=lambda impact: abs(impact[0] - t))
    return nearest if abs(nearest[0] - t) <= 0.12 else None


def _supports(card: CardInput, seed: CandidateSeed,
              comparison: HypothesisComparison, context: str,
              landing: HardBounce | None, position: dict | None) \
        -> tuple[list[dict], dict[str, float]]:
    model = _clamp01((comparison.margin - 2.0) / 20.0) \
        if comparison.preferred == "latent_bounce" else 0.0
    before_measured = any(o.measured and o.t < comparison.estimate_s
                          for o in card.observations)
    after_measured = any(o.measured and o.t > comparison.estimate_s
                         for o in card.observations)
    continuity = 1.0 if before_measured and after_measured else 0.35
    context_strength = 1.0 if context != "unknown" else 0.2
    audio = _nearest_audio(card, comparison.estimate_s)
    audio_strength = _clamp01(audio[1]) if audio else 0.0
    spatial = 0.0
    if position is not None:
        spatial = _clamp01(
            1.0 - float(position["uncertainty_radius_m"]) / 0.24
        )

    method_kind = {
        "weak_reversal": "weak_visual_reversal",
        "subthreshold_curvature": "subthreshold_curvature",
        "occlusion_bridge": "occlusion_reappearance",
        "serve_flight_order": "serve_flight_order",
    }[seed.method]
    support = [
        {"kind": "latent_model_margin", "strength": round(model, 4),
         "margin": round(comparison.margin, 6)},
        {"kind": method_kind, "strength": round(seed.source_strength, 4)},
        {"kind": "two_sided_track", "strength": round(continuity, 4)},
    ]
    if audio is not None:
        support.append({
            "kind": "audio_impact", "strength": round(audio_strength, 4),
            "offset_s": round(audio[0] - comparison.estimate_s, 4),
        })
    if landing is not None:
        support.append({
            "kind": "opposite_half_landing", "strength": 1.0,
            "landing_offset_s": round(landing.t - comparison.estimate_s, 4),
        })
    if context == "mid_rally":
        support.append({"kind": "active_rally_context", "strength": 1.0})
    if position is not None:
        support.append({"kind": "two_sided_spatial_agreement",
                        "strength": round(spatial, 4)})
    return support, {
        "model": model,
        "visual": seed.source_strength,
        "continuity": continuity,
        "context": context_strength,
        "audio": audio_strength,
        "spatial": spatial,
    }


def _miss_explanation(card: CardInput, seed: CandidateSeed) -> dict:
    if seed.method == "occlusion_bridge":
        return {
            "reason": "track_gap_at_event",
            "detail": "The event interval crosses a break in the seen track.",
        }
    if seed.method == "serve_flight_order":
        return {
            "reason": "candidate_not_offered",
            "detail": "Flight order implied an event the local detector did not offer.",
        }
    nearest = min(range(len(card.observations)),
                  key=lambda i: abs(card.observations[i].t - seed.estimate_s))
    if 2 <= nearest <= len(card.observations) - 3:
        window = card.observations[nearest - 2:nearest + 3]
        centre = window[2]
        scale = card.width_px / 1920.0
        left = centre.y_px - window[0].y_px
        right = centre.y_px - window[4].y_px
        motion = math.hypot(centre.x_px - window[1].x_px,
                            centre.y_px - window[1].y_px)
        if min(left, right) < BOUNCE_REVERSAL_PX * scale:
            return {
                "reason": "below_reversal_threshold",
                "detail": "The visual reversal did not clear the normal gate.",
            }
        if motion < BOUNCE_MOTION_PX * scale:
            return {
                "reason": "below_motion_threshold",
                "detail": "The ball-centre motion did not clear the normal gate.",
            }
    return {
        "reason": "candidate_not_offered",
        "detail": "The broader physical candidate was absent from the normal local list.",
    }


def _prediction_error(observations: tuple[Observation, ...], held: Observation,
                      candidate_t: float, latent: bool) -> float:
    tau = np.asarray([o.t - candidate_t for o in observations], dtype=float)
    ones = np.ones(len(observations), dtype=float)
    positive = np.maximum(tau, 0.0)
    design = (np.column_stack((ones, tau, tau * tau, positive,
                               positive * positive)) if latent
              else np.column_stack((ones, tau, tau * tau)))
    values = np.asarray([o.y_px for o in observations], dtype=float)
    beta, _ = _robust_fit(design, values,
                          _observation_weights(observations))
    held_tau = held.t - candidate_t
    row = ([1.0, held_tau, held_tau * held_tau,
            max(held_tau, 0.0), max(held_tau, 0.0) ** 2]
           if latent else [1.0, held_tau, held_tau * held_tau])
    return (held.y_px - float(np.asarray(row) @ beta)) ** 2


def _holdout_wins(observations: tuple[Observation, ...], t: float) \
        -> tuple[bool, bool]:
    results = []
    for inbound in (True, False):
        side = [o for o in observations if (o.t < t if inbound else o.t > t)]
        if not side or len(observations) < 8:
            results.append(False)
            continue
        held = min(side, key=lambda o: abs(o.t - t))
        training = tuple(o for o in observations if o is not held)
        continuous = _prediction_error(training, held, t, False)
        latent = _prediction_error(training, held, t, True)
        results.append(math.isfinite(latent) and latent < continuous)
    return bool(results[0]), bool(results[1])


def _constraint_verdict(*, gate_enabled: bool, tier: str, context: str,
                        vetoes: list[dict], observations: tuple[Observation, ...],
                        t: float, interval: tuple[float, float],
                        position: dict | None,
                        holdout_wins: tuple[bool, bool]) -> dict:
    measured_before = any(o.measured and o.t < t for o in observations)
    measured_after = any(o.measured and o.t > t for o in observations)
    reason = None
    if not gate_enabled:
        reason = "The global shadow constraint gate is disabled."
    elif tier != "high":
        reason = "Event confidence is below the high tier."
    elif context == "unknown":
        reason = "Event context is unknown."
    elif vetoes:
        reason = "An event-level veto is present."
    elif not measured_before or not measured_after:
        reason = "measured BlurBall confidence is required on both sides."
    elif interval[1] - interval[0] > 0.08 + 1e-9:
        reason = "The event-time interval is wider than 0.08 seconds."
    elif position is None:
        reason = "No defensible table coordinate is available."
    elif float(position["uncertainty_radius_m"]) > 0.12:
        reason = "Table-coordinate uncertainty exceeds 0.12 metres."
    elif not all(holdout_wins):
        reason = "The latent fit did not win both holdout checks."
    if reason is not None:
        return {"safe_to_constrain_z0": False, "mode": "display_only",
                "reason": reason}
    return {"safe_to_constrain_z0": True, "mode": "hard_z0",
            "reason": "All event, coordinate, holdout, and global gates passed."}


def infer_card_bounces(
    card: CardInput,
    *,
    constraint_gate_enabled: bool = CONSTRAINT_GATE_ENABLED,
) -> dict:
    """Return schema-v1 inferred-bounce evidence for one Admin card."""
    built = []
    for seed in generate_candidate_seeds(card):
        local = _local_observations(card, seed.estimate_s)
        if len(local) < 7:
            continue
        comparison = compare_hypotheses(
            local,
            candidate_t=seed.estimate_s,
            width_px=card.width_px,
            height_px=card.height_px,
            interval_s=seed.interval_s,
            fps=card.fps,
        )
        event_t = comparison.estimate_s
        if _near_hard_bounce(card, event_t):
            continue
        interval = (
            min(seed.interval_s[0], comparison.interval_s[0]),
            max(seed.interval_s[1], comparison.interval_s[1]),
        )
        context, landing, _origin_side = _context(card, event_t)
        position = _table_position(card, event_t, interval)
        vetoes = _motion_vetoes(card, event_t, context, position, landing)
        support, strengths = _supports(
            card, seed, comparison, context, landing, position
        )
        strong_vetoes = {
            "paddle_contact", "net_contact", "near_net_reversal",
            "possible_handoff_reverse_flight", "rally_running",
            "impossible_speed", "identity_jump",
        }
        veto_penalty = sum(0.35 if veto["kind"] in strong_vetoes else 0.15
                           for veto in vetoes)
        score = _clamp01(
            0.35 * strengths["model"]
            + 0.20 * strengths["visual"]
            + 0.15 * strengths["continuity"]
            + 0.15 * strengths["context"]
            + 0.10 * strengths["audio"]
            + 0.05 * strengths["spatial"]
            - veto_penalty
        )
        tier = "high" if score >= 0.82 else (
            "medium" if score >= 0.62 else "diagnostic"
        )
        if tier == "high" and any(v["kind"] in strong_vetoes for v in vetoes):
            tier = "medium"
        holdouts = _holdout_wins(local, event_t)
        support.extend([
            {"kind": "inbound_holdout_win",
             "strength": 1.0 if holdouts[0] else 0.0},
            {"kind": "outbound_holdout_win",
             "strength": 1.0 if holdouts[1] else 0.0},
        ])
        constraint = _constraint_verdict(
            gate_enabled=constraint_gate_enabled,
            tier=tier,
            context=context,
            vetoes=vetoes,
            observations=local,
            t=event_t,
            interval=interval,
            position=position,
            holdout_wins=holdouts,
        )
        serialized_interval = [
            math.floor(interval[0] * 1_000_000.0) / 1_000_000.0,
            math.ceil(interval[1] * 1_000_000.0) / 1_000_000.0,
        ]
        candidate = {
            "id": candidate_id(event_t, context),
            "time": {
                "estimate_s": round(event_t, 6),
                "interval_s": serialized_interval,
                "method": seed.method,
            },
            "table_position": position,
            "context": context,
            "confidence": {"score": round(score, 4), "tier": tier},
            "hypothesis_comparison": {
                "preferred": comparison.preferred,
                "continuous_airborne_cost": round(
                    comparison.continuous_airborne_cost, 6
                ),
                "latent_bounce_cost": round(comparison.latent_bounce_cost, 6),
                "margin": round(comparison.margin, 6),
            },
            "support": support,
            "vetoes": vetoes,
            "normal_detector_miss": _miss_explanation(card, seed),
            "trajectory_constraint": constraint,
        }
        validate_candidate(candidate)
        built.append(candidate)

    built.sort(key=lambda candidate: (
        -float(candidate["confidence"]["score"]),
        float(candidate["time"]["estimate_s"]),
        str(candidate["id"]),
    ))
    envelope = empty_envelope()
    envelope["candidates"] = built[:MAX_CANDIDATES_PER_CARD]
    return envelope

"""Pure service-motion features anchored to a confirmed first bounce.

The analyzer deliberately receives no score, player identity, or first-server
truth. It compares physical near/far players inside a short pre-bounce window
and abstains unless one player has a coherent toss, racket, and ball sequence.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
import math
from typing import Any, Mapping, Sequence


@dataclass(frozen=True)
class ServiceMotionThresholds:
    lookback_s: float = 1.0
    lookahead_s: float = 0.1
    minimum_score: float = 3.0
    minimum_margin: float = 1.1
    minimum_samples: int = 4
    minimum_pose_confidence: float = 0.3
    sustained_frames: int = 3


DEFAULT_SERVICE_MOTION_THRESHOLDS = ServiceMotionThresholds()


def _point(
    player: Mapping[str, Any],
    index: int,
    minimum_confidence: float,
) -> tuple[float, float] | None:
    keypoints = player.get("kpts") or []
    if len(keypoints) <= index or len(keypoints[index]) < 3:
        return None
    x, y, confidence = keypoints[index][:3]
    if float(confidence) < minimum_confidence:
        return None
    return float(x), float(y)


def _distance(
    left: tuple[float, float],
    right: tuple[float, float],
) -> float:
    return math.hypot(left[0] - right[0], left[1] - right[1])


def _mean(points: Sequence[tuple[float, float]]) -> tuple[float, float]:
    return (
        sum(point[0] for point in points) / len(points),
        sum(point[1] for point in points) / len(points),
    )


def _torso_scale(
    player: Mapping[str, Any],
    minimum_confidence: float,
) -> float | None:
    shoulders = [
        point
        for index in (5, 6)
        if (point := _point(player, index, minimum_confidence)) is not None
    ]
    hips = [
        point
        for index in (11, 12)
        if (point := _point(player, index, minimum_confidence)) is not None
    ]
    if len(shoulders) != 2:
        return None
    candidates = [_distance(shoulders[0], shoulders[1])]
    if hips:
        candidates.append(abs(_mean(hips)[1] - _mean(shoulders)[1]))
    scale = max(candidates)
    return scale if scale > 1e-6 else None


def _audio_candidates(
    raw: Sequence[Mapping[str, Any] | Sequence[float] | float],
) -> list[tuple[float, float]]:
    output = []
    for item in raw:
        if isinstance(item, Mapping):
            output.append(
                (
                    float(item["t"]),
                    max(0.0, float(item.get("confidence") or 0.0)),
                )
            )
        elif isinstance(item, Sequence) and not isinstance(item, (str, bytes)):
            output.append(
                (
                    float(item[0]),
                    max(0.0, float(item[1]) if len(item) > 1 else 1.0),
                )
            )
        else:
            output.append((float(item), 1.0))
    return sorted(output)


def _player_samples(
    side: str,
    frames: Sequence[int],
    detections: Mapping[int, Sequence[float]],
    poses: Mapping[int, Mapping[str, Mapping[str, Any]]],
    fps: float,
    minimum_confidence: float,
) -> list[dict[str, Any]]:
    samples = []
    for frame in frames:
        frame_poses = poses.get(frame)
        if frame_poses is None:
            frame_poses = poses.get(frame - 1) or poses.get(frame + 1)
        player = (frame_poses or {}).get(side)
        if not player:
            continue
        scale = _torso_scale(player, minimum_confidence)
        wrists = [
            _point(player, index, minimum_confidence) for index in (9, 10)
        ]
        if scale is None or any(wrist is None for wrist in wrists):
            continue
        ball_raw = detections.get(frame)
        ball = (
            (float(ball_raw[0]), float(ball_raw[1]))
            if ball_raw is not None and len(ball_raw) >= 2
            else None
        )
        assert wrists[0] is not None and wrists[1] is not None
        samples.append(
            {
                "frame": int(frame),
                "t": float(frame) / fps,
                "scale": scale,
                "wrists": (wrists[0], wrists[1]),
                "ball": ball,
            }
        )
    return samples


def _range(values: Sequence[float]) -> float:
    return max(values) - min(values) if values else 0.0


def _motion_features(samples: Sequence[Mapping[str, Any]], fps: float) -> dict:
    if len(samples) < 2:
        return {
            "valid_samples": len(samples),
            "score": 0.0,
            "onset_t": None,
            "contact_t": None,
        }

    wrist_y = [
        [float(sample["wrists"][index][1]) for sample in samples]
        for index in (0, 1)
    ]
    wrist_xy = [
        [
            (
                float(sample["wrists"][index][0]),
                float(sample["wrists"][index][1]),
            )
            for sample in samples
        ]
        for index in (0, 1)
    ]
    median_scale = sorted(float(sample["scale"]) for sample in samples)[
        len(samples) // 2
    ]
    toss_index = max(
        (0, 1),
        key=lambda index: wrist_y[index][0] - min(wrist_y[index]),
    )
    racket_index = 1 - toss_index
    toss_rise = max(
        0.0,
        (wrist_y[toss_index][0] - min(wrist_y[toss_index])) / median_scale,
    )

    toss_up_speed = 0.0
    racket_speeds = []
    ball_speeds = []
    motion_families = []
    ball_distances = []
    ball_y = []
    contact_candidates = []
    for index, sample in enumerate(samples):
        ball = sample["ball"]
        if ball is not None:
            ball_y.append(float(ball[1]))
            ball_distances.append(
                min(
                    _distance(ball, wrist) / float(sample["scale"])
                    for wrist in sample["wrists"]
                )
            )
        if index == 0:
            racket_speeds.append(0.0)
            ball_speeds.append(0.0)
            motion_families.append(set())
            continue
        delta_t = max(
            1.0 / fps,
            float(sample["t"]) - float(samples[index - 1]["t"]),
        )
        scale = max(
            1e-6,
            (float(sample["scale"]) + float(samples[index - 1]["scale"]))
            / 2.0,
        )
        toss_velocity = (
            wrist_y[toss_index][index - 1] - wrist_y[toss_index][index]
        ) / delta_t / scale
        toss_up_speed = max(toss_up_speed, toss_velocity)
        racket_speed = (
            _distance(
                wrist_xy[racket_index][index],
                wrist_xy[racket_index][index - 1],
            )
            / delta_t
            / scale
        )
        racket_speeds.append(racket_speed)
        previous_ball = samples[index - 1]["ball"]
        ball_speed = 0.0
        ball_rising = False
        if ball is not None and previous_ball is not None:
            ball_speed = _distance(ball, previous_ball) / delta_t / scale
            ball_rising = (
                float(previous_ball[1]) - float(ball[1])
            ) / scale >= 0.035
        ball_speeds.append(ball_speed)
        families = set()
        if toss_velocity >= 0.4:
            families.add("toss")
        if racket_speed >= 0.45:
            families.add("racket")
        if ball_rising:
            families.add("ball")
        if (
            ball is not None
            and min(
                _distance(ball, wrist) / float(sample["scale"])
                for wrist in sample["wrists"]
            )
            <= 0.9
        ):
            families.add("ball_near")
        motion_families.append(families)
        contact_candidates.append(
            (
                racket_speed + 0.35 * ball_speed,
                float(sample["t"]),
            )
        )

    racket_range = (
        math.hypot(
            _range([point[0] for point in wrist_xy[racket_index]]),
            _range([point[1] for point in wrist_xy[racket_index]]),
        )
        / median_scale
    )
    ball_rise = (
        max(0.0, ball_y[0] - min(ball_y)) / median_scale if ball_y else 0.0
    )
    nearest_ball = min(ball_distances) if ball_distances else math.inf
    departure = (
        max(0.0, ball_distances[-1] - min(ball_distances))
        if len(ball_distances) >= 2
        else 0.0
    )
    coherent_runs = []
    for index in range(len(motion_families)):
        families = set().union(
            *motion_families[index : index + 3]
        )
        active_frames = sum(
            len(item) >= 2 for item in motion_families[index : index + 3]
        )
        if len(families) >= 2 and active_frames >= 2:
            coherent_runs.append(index)
    onset_t = (
        round(float(samples[coherent_runs[0]]["t"]), 4)
        if coherent_runs
        else None
    )
    contact_t = (
        round(max(contact_candidates, key=lambda item: (item[0], item[1]))[1], 4)
        if contact_candidates
        else None
    )

    score = 0.0
    score += 1.2 if toss_rise >= 0.45 else 0.0
    score += 0.8 if toss_up_speed >= 1.1 else 0.0
    score += 1.0 if racket_range >= 0.35 else 0.0
    score += 1.0 if nearest_ball <= 0.8 else 0.0
    score += 1.0 if ball_rise >= 0.55 else 0.0
    score += 0.8 if departure >= 0.65 else 0.0
    if onset_t is None:
        score = min(score, 2.5)

    return {
        "valid_samples": len(samples),
        "toss_rise": round(toss_rise, 4),
        "toss_up_speed": round(toss_up_speed, 4),
        "racket_range": round(racket_range, 4),
        "nearest_ball_wrist": (
            round(nearest_ball, 4) if math.isfinite(nearest_ball) else None
        ),
        "ball_rise": round(ball_rise, 4),
        "ball_departure": round(departure, 4),
        "score": round(score, 4),
        "onset_t": onset_t,
        "contact_t": contact_t,
    }


def analyze_service_motion(
    detections: Mapping[int, Sequence[float]],
    poses: Mapping[int, Mapping[str, Mapping[str, Any]]],
    fps: float,
    first_bounce_t: float,
    audio_candidates: Sequence[
        Mapping[str, Any] | Sequence[float] | float
    ] = (),
    thresholds: ServiceMotionThresholds = DEFAULT_SERVICE_MOTION_THRESHOLDS,
) -> dict[str, Any]:
    """Compare physical players inside a bounded pre-bounce interval."""

    if fps <= 0 or first_bounce_t < 0:
        raise ValueError("fps must be positive and first bounce non-negative")
    first_frame = max(
        0,
        int(math.ceil((first_bounce_t - thresholds.lookback_s) * fps)),
    )
    last_frame = int(
        math.floor((first_bounce_t + thresholds.lookahead_s) * fps)
    )
    frames = sorted(
        frame
        for frame in poses
        if first_frame <= int(frame) <= last_frame
    )
    features = {
        side: _motion_features(
            _player_samples(
                side,
                frames,
                detections,
                poses,
                fps,
                thresholds.minimum_pose_confidence,
            ),
            fps,
        )
        for side in ("near", "far")
    }
    scores = {
        side: float(features[side].get("score") or 0.0)
        for side in ("near", "far")
    }
    ranked = sorted(scores, key=lambda side: scores[side], reverse=True)
    best, other = ranked
    best_features = features[best]
    margin = scores[best] - scores[other]
    high_confidence = (
        scores[best] >= thresholds.minimum_score
        and margin >= thresholds.minimum_margin
        and int(best_features.get("valid_samples") or 0)
        >= thresholds.minimum_samples
        and best_features.get("onset_t") is not None
    )
    audio = _audio_candidates(audio_candidates)
    contact_t = best_features.get("contact_t")
    if high_confidence and audio and contact_t is not None:
        nearby = [
            item
            for item in audio
            if 0 <= first_bounce_t - item[0] <= 0.23
            and abs(item[0] - float(contact_t)) <= 0.15
        ]
        if nearby:
            contact_t = round(
                min(
                    nearby,
                    key=lambda item: (
                        abs(item[0] - float(contact_t)),
                        -item[1],
                    ),
                )[0],
                4,
            )
    return {
        "version": 1,
        "status": "high_confidence" if high_confidence else "withheld",
        "side": best if high_confidence else None,
        "onset_t": best_features.get("onset_t") if high_confidence else None,
        "contact_t": contact_t if high_confidence else None,
        "confidence": (
            round(
                min(
                    0.999,
                    0.75
                    + min(0.149, margin / 20.0)
                    + min(0.1, scores[best] / 100.0),
                ),
                4,
            )
            if high_confidence
            else 0.0
        ),
        "scores": {side: round(value, 4) for side, value in scores.items()},
        "features": features,
        "reason": (
            "coherent_service_motion"
            if high_confidence
            else "service_motion_absent_or_ambiguous"
        ),
        "thresholds": asdict(thresholds),
    }

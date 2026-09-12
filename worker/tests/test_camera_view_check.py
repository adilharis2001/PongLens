from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from camera_view_check import check_frames


WIDTH = 512
HEIGHT = 288


def _scene(seed: int = 7) -> np.ndarray:
    rng = np.random.default_rng(seed)
    image = rng.integers(20, 215, size=(HEIGHT, WIDTH, 3), dtype=np.uint8)
    image = cv2.GaussianBlur(image, (3, 3), 0)
    for x in range(24, WIDTH, 52):
        cv2.line(image, (x, 8), (x, HEIGHT - 8), (235, 235, 235), 2)
    for y in range(18, HEIGHT, 42):
        cv2.line(image, (8, y), (WIDTH - 8, y), (35, 45, 55), 2)
    cv2.putText(image, "PONGLENS CLUB", (135, 58), cv2.FONT_HERSHEY_SIMPLEX,
                0.8, (245, 245, 245), 2, cv2.LINE_AA)
    return image


def _with_players(image: np.ndarray, index: int) -> np.ndarray:
    out = image.copy()
    x = 180 + (index * 19) % 120
    cv2.rectangle(out, (x, 92), (x + 48, 270), (24, 40, 220), -1)
    cv2.circle(out, (x + 24, 78), 22, (100, 170, 225), -1)
    return out


def _shift(image: np.ndarray, *, dx: float = 0.03, dy: float = -0.02,
           scale: float = 1.0) -> np.ndarray:
    matrix = cv2.getRotationMatrix2D((WIDTH / 2, HEIGHT / 2), 0, scale)
    matrix[0, 2] += dx * WIDTH
    matrix[1, 2] += dy * HEIGHT
    return cv2.warpAffine(image, matrix, (WIDTH, HEIGHT),
                          borderMode=cv2.BORDER_REFLECT)


def _write_samples(tmp_path: Path, images: list[np.ndarray],
                   start_s: float = 300.0) -> list[tuple[float, str]]:
    samples = []
    for index, image in enumerate(images):
        path = tmp_path / f"sample-{index:02d}.jpg"
        assert cv2.imwrite(str(path), image)
        samples.append((start_s + index * 10.0, str(path)))
    return samples


def _ordinary_sequence() -> list[np.ndarray]:
    base = _scene()
    return [_with_players(base, index) for index in range(12)]


def _assert_common_contract(result: dict, samples: list[tuple[float, str]]) -> None:
    assert result["schema"] == 1
    assert result["sample_count"] == len(samples)
    assert result["sample_timestamps_s"] == [sample[0] for sample in samples]
    assert result["status"] in {"changed", "stable", "unknown"}
    assert isinstance(result["changes"], list)


def test_invalid_sample_container_fails_open():
    result = check_frames(None, 300.0, 410.0)

    assert result["schema"] == 1
    assert result["status"] == "unknown"
    assert result["reason_code"] == "invalid_samples"
    assert result["sample_count"] == 0
    assert result["changes"] == []


def test_blank_frames_are_unknown_not_moved(tmp_path: Path):
    images = [np.full((HEIGHT, WIDTH, 3), 18, dtype=np.uint8) for _ in range(12)]
    samples = _write_samples(tmp_path, images)

    result = check_frames(samples, 300.0, 410.0)

    _assert_common_contract(result, samples)
    assert result["status"] == "unknown"
    assert result["reason_code"] == "insufficient_feature_evidence"
    assert result["changes"] == []


def test_fewer_than_eight_frames_is_unknown(tmp_path: Path):
    samples = _write_samples(tmp_path, _ordinary_sequence()[:7])

    result = check_frames(samples, 300.0, 360.0)

    _assert_common_contract(result, samples)
    assert result["status"] == "unknown"
    assert result["reason_code"] == "too_few_samples"
    assert result["changes"] == []


def test_missing_frame_is_unknown_and_never_a_shift(tmp_path: Path):
    samples = _write_samples(tmp_path, _ordinary_sequence())
    samples[6] = (samples[6][0], str(tmp_path / "missing.jpg"))

    result = check_frames(samples, 300.0, 410.0)

    _assert_common_contract(result, samples)
    assert result["status"] == "unknown"
    assert result["reason_code"] == "unreadable_samples"
    assert result["changes"] == []


def test_two_different_setup_views_at_start_do_not_warn(tmp_path: Path):
    images = _ordinary_sequence()
    images[0] = _shift(images[0], dx=0.03, dy=-0.02)
    images[1] = _shift(images[1], dx=0.0, dy=0.0, scale=1.05)
    samples = _write_samples(tmp_path, images)

    result = check_frames(samples, 300.0, 410.0)

    _assert_common_contract(result, samples)
    assert result["status"] == "stable"
    assert result["reason_code"] == "dominant_static_background"
    assert result["changes"] == []


def test_one_sample_camera_bump_then_return_does_not_warn(tmp_path: Path):
    images = _ordinary_sequence()
    images[6] = _shift(images[6], dx=0.03, dy=-0.02)
    samples = _write_samples(tmp_path, images)

    result = check_frames(samples, 300.0, 410.0)

    _assert_common_contract(result, samples)
    assert result["status"] == "stable"
    assert result["reason_code"] == "dominant_static_background"
    assert result["changes"] == []


def test_sustained_shift_warns_and_returns_only_a_time_bracket(tmp_path: Path):
    images = _ordinary_sequence()
    images[6:] = [_shift(image, dx=0.03, dy=-0.02) for image in images[6:]]
    samples = _write_samples(tmp_path, images)

    result = check_frames(samples, 300.0, 410.0)

    _assert_common_contract(result, samples)
    assert result["status"] == "changed"
    assert result["reason_code"] == "sustained_view_shift"
    assert result["changes"] == [{
        "before_s": 350.0,
        "after_s": 360.0,
        "kind": "shift",
    }]
    assert "at_s" not in result["changes"][0]
    assert len(result["evidence"]) == 12


def test_trim_window_uses_absolute_original_video_timestamps(tmp_path: Path):
    images = _ordinary_sequence()
    images[6:] = [_shift(image, dx=0.03, dy=-0.02) for image in images[6:]]
    samples = _write_samples(tmp_path, images, start_s=900.0)

    result = check_frames(samples, 895.0, 1015.0)

    _assert_common_contract(result, samples)
    assert result["window_start_s"] == 895.0
    assert result["window_end_s"] == 1015.0
    assert result["changes"] == [{
        "before_s": 950.0,
        "after_s": 960.0,
        "kind": "shift",
    }]


def test_unrelated_high_texture_frames_do_not_turn_no_matches_into_movement(
        tmp_path: Path):
    images = [_scene(seed) for seed in range(12)]
    samples = _write_samples(tmp_path, images)

    result = check_frames(samples, 300.0, 410.0)

    _assert_common_contract(result, samples)
    assert result["status"] == "unknown"
    assert result["reason_code"] == "insufficient_feature_evidence"
    assert result["changes"] == []

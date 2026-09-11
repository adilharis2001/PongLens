"""The body-based end trim: the guards, and parity with the frozen model."""

import json
import os

import numpy as np
import pytest

from rally_tail import (
    FEATURE_ORDER,
    MAX_TRIM_S,
    MIN_TRIM_S,
    PAD_S,
    load_model,
    play_features,
    play_probability,
    rally_tail_end,
    trimmed_end,
)


def _pose(box, kp_y=None, score=0.9):
    """One frame of one player. Keypoints sit inside the box; the y offsets
    only have to be self-consistent for the ratios to be defined."""
    x1, y1, x2, y2 = box
    h = y2 - y1
    cx = (x1 + x2) / 2.0
    rows = []
    for j in range(17):
        frac = 0.5 if kp_y is None else kp_y
        rows.append([cx, y1 + frac * h, score])
    return {"box": box, "kp": np.array(rows, dtype=float)}


# ------------------------------------------------------------- the guards --

def test_no_reading_leaves_the_card_alone():
    assert trimmed_end(10.0, None) is None


def test_a_small_change_is_not_worth_a_recut():
    # the rally stopped 9.0, pad puts the end at 11.5, later than t1 -> no trim
    assert trimmed_end(10.0, 9.0) is None
    # a trim smaller than the floor is refused
    assert trimmed_end(10.0, 10.0 - PAD_S - MIN_TRIM_S + 0.01) is None


def test_a_real_overrun_is_trimmed_to_the_rally_plus_the_pad():
    # tail + pad (19.0) is inside the cap (18.0 at the earliest), so the pad
    # is what decides the new end.
    assert trimmed_end(20.0, 16.5) == pytest.approx(16.5 + PAD_S)


def test_the_cap_binds_before_the_pad_on_a_long_overrun():
    """A card five seconds too long only loses two. That is deliberate: the
    cap is what bounds the damage when the model is wrong, and it costs some
    of the trim on the very worst cards to buy that."""
    assert trimmed_end(20.0, 15.0) == pytest.approx(20.0 - MAX_TRIM_S)
    assert 15.0 + PAD_S < 20.0 - MAX_TRIM_S


def test_no_ending_can_move_further_than_the_cap():
    # the model says the rally stopped at 1.0, which would take 19 seconds off
    assert trimmed_end(20.0, 1.0) == pytest.approx(20.0 - MAX_TRIM_S)


def test_the_trim_never_lengthens_a_card():
    for t1 in (5.0, 12.0, 30.0):
        for tail in (0.0, 4.0, 11.0, 29.0, 40.0):
            new = trimmed_end(t1, tail)
            assert new is None or new < t1


# --------------------------------------------------------- reading the end --

def _ramp(play_from, play_to, n=120, t0=0.0, dt=0.1):
    T = t0 + np.arange(n) * dt
    p = np.where((T >= play_from) & (T <= play_to), 0.9, 0.05)
    return T, p


def test_the_end_is_the_end_of_the_rally():
    T, p = _ramp(2.0, 8.0)
    assert rally_tail_end(T, p, 0.0, 12.0) == pytest.approx(8.0, abs=0.15)


def test_a_later_flicker_does_not_become_the_end():
    """A card that overruns picks up the next knock-up. The longest run is
    the rally; the flicker after it is exactly what the trim is removing."""
    T, p = _ramp(2.0, 8.0)
    p[(T > 10.0) & (T < 10.4)] = 0.9          # four frames of something else
    assert rally_tail_end(T, p, 0.0, 12.0) == pytest.approx(8.0, abs=0.15)


def test_a_card_with_no_play_in_it_returns_nothing():
    T = np.arange(120) * 0.1
    assert rally_tail_end(T, np.full(120, 0.05), 0.0, 12.0) is None


def test_it_never_reads_outside_the_card():
    T, p = _ramp(2.0, 20.0, n=300)
    assert rally_tail_end(T, p, 0.0, 6.0) <= 6.0


def test_a_card_with_no_frames_returns_nothing():
    T = np.arange(50) * 0.1
    assert rally_tail_end(T, np.full(50, 0.9), 90.0, 95.0) is None


# ---------------------------------------------------------------- the model --

def test_the_frozen_model_matches_the_feature_order():
    model = load_model()
    assert list(model["features"]) == list(FEATURE_ORDER)
    # one weight per feature plus the bias column
    assert len(model["weights"]) == len(FEATURE_ORDER) + 1
    assert len(model["mu"]) == len(FEATURE_ORDER)
    assert len(model["sd"]) == len(FEATURE_ORDER)


def test_a_feature_we_cannot_read_argues_neither_way():
    """A missing column standardises to its own mean, so an unreadable frame
    lands on the model's bias rather than on a confident answer."""
    model = load_model()
    X = np.array([model["mu"], [np.nan] * len(FEATURE_ORDER)], dtype=float)
    p = play_probability(X, model)
    assert p[0] == pytest.approx(p[1], abs=1e-12)


def test_features_come_back_in_the_frozen_order():
    n = 60
    T = np.arange(n) * 0.1
    poses = {s: [_pose((10.0, 20.0, 40.0, 100.0)) for _ in range(n)]
             for s in ("near", "far")}
    X, names = play_features(T, poses)
    assert tuple(names) == FEATURE_ORDER
    assert X.shape == (n, len(FEATURE_ORDER))


def test_a_side_that_is_never_seen_does_not_crash():
    n = 60
    T = np.arange(n) * 0.1
    poses = {"near": [_pose((10.0, 20.0, 40.0, 100.0)) for _ in range(n)],
             "far": [None] * n}
    X, _ = play_features(T, poses)
    assert X.shape == (n, len(FEATURE_ORDER))
    p = play_probability(X, load_model())
    assert np.all(np.isfinite(p))


def test_poses_that_do_not_line_up_with_the_clock_are_refused():
    T = np.arange(10) * 0.1
    poses = {"near": [None] * 9, "far": [None] * 10}
    with pytest.raises(ValueError):
        play_features(T, poses)


def test_the_features_do_not_consult_a_table():
    """Checked because the whole stage depends on it: an end-on match often
    has no calibration at all, and must still get its endings trimmed."""
    import inspect

    import rally_tail

    src = inspect.getsource(rally_tail)
    for word in ("corners", "homography", "calibration", "table_frame"):
        assert f"def {word}" not in src

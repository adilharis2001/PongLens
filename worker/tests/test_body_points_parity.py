"""The frozen body model reproduces the cards it was frozen with.

The inputs are too large for the repo (3 to 14 MB of skeletons a match), so
they live beside the other model files on the Mac Studio, mirrored to R2:

    ~/ponglens-models/body-poses/<match>/players.json   the skeletons
    ~/ponglens-models/body-poses/<match>/ball.json      crossings, table
                                                        bounce times, serve
                                                        stamps, corners,
                                                        duration, first ball
                                                        card start

`worker/body_model/v1/fixture.json` holds the cards `body_points.assemble`
produced from exactly those inputs when the model was frozen. This test
rebuilds every match and asserts the cards card for card to 0.05 s. Skipped
where the inputs are not on this machine.
"""
from __future__ import annotations

import json
import os
import sys
from types import SimpleNamespace

import numpy as np
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
WORKER = os.path.dirname(HERE)
sys.path.insert(0, WORKER)

import body_points  # noqa: E402

INPUTS = os.path.expanduser(os.environ.get("PONGLENS_BODY_POSES",
                                           "~/ponglens-models/body-poses"))
FIXTURE = os.path.join(WORKER, "body_model", body_points.MODEL_VERSION, "fixture.json")


def _evidence(ball):
    return SimpleNamespace(cross=np.asarray(ball["crossings"], float),
                           bt_table=np.asarray(ball["bt_table"], float),
                           serves=sorted(float(x) for x in ball["serves"]))


@pytest.mark.skipif(not os.path.exists(FIXTURE), reason="no frozen fixture")
def test_frozen_model_reproduces_fixture():
    fixture = json.load(open(FIXTURE))
    model = body_points.load_model()
    assert model["sha"] == body_points.BF.CODE_SHA
    checked = 0
    for m, want in fixture["matches"].items():
        d = os.path.join(INPUTS, m)
        if not (os.path.exists(os.path.join(d, "players.json"))
                and os.path.exists(os.path.join(d, "ball.json"))):
            continue
        players = json.load(open(os.path.join(d, "players.json")))
        ball = json.load(open(os.path.join(d, "ball.json")))
        cards, info = body_points.assemble(
            players, ball["corners"], _evidence(ball), ball["duration"],
            first_ball_t0=ball.get("first_ball_t0"), model=model)
        got = [(round(c["t0"], 2), round(c["t1"], 2)) for c in cards]
        exp = [(round(c["t0"], 2), round(c["t1"], 2)) for c in want["cards"]]
        assert len(got) == len(exp), f"{m}: {len(got)} cards, fixture has {len(exp)}"
        for (a, b), (x, y) in zip(got, exp):
            assert abs(a - x) <= 0.05 and abs(b - y) <= 0.05, f"{m}: {a}-{b} vs {x}-{y}"
        checked += 1
    if checked == 0:
        pytest.skip("frozen inputs not on this machine")


def test_guards_refuse_one_player():
    """A video with one visible player is not a body-detector match."""
    T = np.arange(0, 60, 0.1)
    frames = [{"t": float(t), "near": {"box": [0, 0, 100, 300],
                                       "kp": [[50, 10 + 15 * j, 0.9] for j in range(17)]}}
              for t in T]
    with pytest.raises(body_points.BodyPointsUnavailable):
        body_points.read_players({"rect": [0, 0, 1920, 1080], "frames": frames})
        raise body_points.BodyPointsUnavailable("both players seen in only 0%")

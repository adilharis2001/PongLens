"""The ported serve detector gives the lab's own answer, match for match.

The lab built these rules over two months against Adil's scoring, and the
port copied the code rather than re-expressing it precisely so that this test
can exist: forty measured settings and five interacting filters do not
survive a paraphrase, and a port that "looks equivalent" is not evidence.

`worker/serve_v3/fixture.json` holds the serve contacts and dead-ball runs
the lab produced on 2026-09-09 for thirteen matches. The inputs are too large
for the repo and live beside the body-model inputs on the Mac Studio:

    ~/ponglens-models/serve-v3/<match>/ball.json     track, crossings, corners
    ~/ponglens-models/serve-v3/<match>/players.json  the person boxes

Skipped where those are not on this machine, so the suite still runs in a
checkout that has never seen them.
"""
from __future__ import annotations

import json
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
WORKER = os.path.dirname(HERE)
sys.path.insert(0, WORKER)

import serve_v3  # noqa: E402

INPUTS = os.path.expanduser(os.environ.get("PONGLENS_SERVE_V3",
                                           "~/ponglens-models/serve-v3"))
FIXTURE = os.path.join(WORKER, "serve_v3", "fixture.json")

# The lab's people boxes are keyed on the people file's own frame rate and its
# ball track on the crop's, and the two differ by up to 0.05 fps. Production
# has one clock for both, so `people_fps` exists for this test alone.
TOL_S = 0.001


def _cases():
    if not os.path.exists(FIXTURE):
        return []
    fixture = json.load(open(FIXTURE))
    out = []
    for m in sorted(fixture["matches"]):
        d = os.path.join(INPUTS, m)
        if (os.path.exists(os.path.join(d, "ball.json"))
                and os.path.exists(os.path.join(d, "players.json"))):
            out.append(m)
    return out


CASES = _cases()


@pytest.mark.skipif(not CASES, reason="the frozen serve inputs are not on this machine")
@pytest.mark.parametrize("match", CASES)
def test_port_reproduces_the_lab(match):
    fixture = json.load(open(FIXTURE))["matches"][match]
    d = os.path.join(INPUTS, match)
    ball = json.load(open(os.path.join(d, "ball.json")))
    players = json.load(open(os.path.join(d, "players.json")))
    track = {int(f): (float(x), float(y)) for f, (x, y) in ball["track"].items()}
    out = serve_v3.detect(ball["corners"], track, ball["cross"], players,
                          ball["fps"], ball["duration"],
                          people_fps=ball.get("people_fps"))
    got = [round(c, 3) for c, _a, _s in out["serves"]]
    want = [round(float(t), 3) for t in fixture["serves"]]
    assert len(got) == len(want), (
        f"{match}: the port found {len(got)} serves, the lab {len(want)}")
    for a, b in zip(got, want):
        assert abs(a - b) <= TOL_S, f"{match}: serve at {b} came back as {a}"
    dead_got = [(round(a, 3), round(b, 3)) for a, b in out["dead"]]
    dead_want = [(round(float(a), 3), round(float(b), 3)) for a, b in fixture["dead"]]
    assert len(dead_got) == len(dead_want), (
        f"{match}: {len(dead_got)} dead-ball runs against the lab's {len(dead_want)}")
    for x, y in zip(dead_got, dead_want):
        assert abs(x[0] - y[0]) <= TOL_S and abs(x[1] - y[1]) <= TOL_S, (
            f"{match}: dead run {y} came back as {x}")


@pytest.mark.skipif(not CASES, reason="the frozen serve inputs are not on this machine")
def test_the_bounce_finder_is_put_back():
    """The serve rule borrows points_v2.bounces and must give it back.

    `holepatch` widens the bounce finder's hole tolerance for everything in
    the process. The ball pipeline runs in the same process, so a patch left
    installed would change its reading of every bounce for the rest of the
    job — silently, and only on matches where the serve detector ran.
    """
    import points_v2
    before = points_v2.bounces
    match = CASES[0]
    d = os.path.join(INPUTS, match)
    ball = json.load(open(os.path.join(d, "ball.json")))
    players = json.load(open(os.path.join(d, "players.json")))
    track = {int(f): (float(x), float(y)) for f, (x, y) in ball["track"].items()}
    serve_v3.detect(ball["corners"], track, ball["cross"], players,
                    ball["fps"], ball["duration"], people_fps=ball.get("people_fps"))
    assert points_v2.bounces is before

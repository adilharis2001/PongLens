"""The two edges the ball may move on a body card (spec 2026-09-09).

Small, made-up cards: this is about the rule, not about a match. The
thirteen-match evidence is in the research record; what has to hold here is
that the pass never invents, removes or splits a card, and never moves an
edge it has no evidence for.
"""
from __future__ import annotations

import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import body_points as BP  # noqa: E402
import points_v2 as V2    # noqa: E402

DUR = 600.0


def run(cards, serves=(), cross=(), bt=(), dead=(), **kw):
    return BP.anchor_and_close([dict(c) for c in cards], list(serves),
                               np.asarray(cross, float), np.asarray(bt, float),
                               list(dead), DUR, **dict(dict(anchor=True, close=True), **kw))


def card(t0, t1, **kw):
    return dict(dict(t0=t0, t1=t1, serve_s=None, why="bodies",
                     end_evidence_s=None), **kw)


def test_a_card_the_ball_says_nothing_about_is_untouched():
    out, info = run([card(10.0, 20.0)])
    assert out[0]["t0"] == 10.0 and out[0]["t1"] == 20.0
    assert info == dict(anchored=0, closed=0, closed_on_dead=0)


def test_the_start_goes_to_the_serve():
    out, info = run([card(10.0, 25.0)], serves=[14.0], cross=[15.0, 16.0])
    assert out[0]["t0"] == 14.0 - V2.HEAD_LEAD
    assert out[0]["serve_s"] == 14.0
    assert info["anchored"] == 1
    assert "started at the serve" in out[0]["why"]


def test_the_start_is_pulled_back_as_well_as_forward():
    """A card that opened INSIDE the set-up gets its head back."""
    out, _ = run([card(13.5, 25.0)], serves=[14.0], cross=[15.0])
    assert out[0]["t0"] == 14.0 - V2.HEAD_LEAD < 13.5


def test_a_start_never_reaches_into_the_card_before_it():
    out, _ = run([card(10.0, 20.0), card(20.6, 30.0)],
                 serves=[21.0], cross=[22.0])
    assert out[0]["t1"] == 20.0
    assert out[1]["t0"] >= 20.0 + V2.MIN_GAP_S
    assert out[1]["t0"] <= 21.0


def test_a_serve_too_far_from_the_start_is_not_this_card_s():
    out, info = run([card(10.0, 40.0)], serves=[30.0], cross=[31.0])
    assert out[0]["t0"] == 10.0 and info["anchored"] == 0


def test_the_end_follows_the_last_thing_the_ball_did():
    out, info = run([card(10.0, 30.0)], cross=[12.0, 14.0, 18.0], anchor=False)
    assert out[0]["t1"] == 18.0 + BP.END_BUF_S
    assert out[0]["end_evidence_s"] == 18.0
    assert info["closed"] == 1


def test_a_dead_ball_ends_the_point_before_the_ball_stops_moving():
    """The dribble goes on being detected; the point ended when it began."""
    out, info = run([card(10.0, 30.0)], serves=[11.0], cross=[12.0, 14.0],
                    bt=[15.5, 16.0, 16.4, 16.9], dead=[(15.5, 17.0)])
    assert out[0]["t1"] == 15.5 + BP.END_BUF_S
    assert info["closed_on_dead"] == 1
    assert "went dead" in out[0]["why"]


def test_a_ball_that_crosses_the_net_again_was_not_dead():
    out, info = run([card(10.0, 30.0)], serves=[11.0],
                    cross=[12.0, 14.0, 19.0], bt=[15.5, 16.0],
                    dead=[(15.5, 17.0)])
    assert info["closed_on_dead"] == 0
    assert out[0]["t1"] == 19.0 + BP.END_BUF_S


def test_the_end_is_never_pushed_out():
    out, _ = run([card(10.0, 14.0)], cross=[13.9], anchor=False)
    assert out[0]["t1"] == 14.0


def test_a_card_is_never_cut_below_the_minimum():
    out, _ = run([card(10.0, 12.0)], serves=[11.9], cross=[11.95])
    assert out[0]["t1"] - out[0]["t0"] >= V2.MIN_CARD_S


def test_the_pass_neither_adds_nor_removes_cards():
    cards = [card(10.0, 20.0), card(25.0, 35.0), card(40.0, 50.0)]
    out, _ = run(cards, serves=[11.0, 26.0, 41.0],
                 cross=[12.0, 27.0, 42.0], bt=[13.0, 28.0, 43.0])
    assert len(out) == len(cards)
    assert [round(c["t0"], 2) for c in out] == sorted(round(c["t0"], 2) for c in out)


def test_both_rules_off_is_a_no_op():
    cards = [card(10.0, 20.0)]
    out, info = run(cards, serves=[11.0], cross=[12.0], anchor=False, close=False)
    assert out == cards and info["anchored"] == 0 and info["closed"] == 0

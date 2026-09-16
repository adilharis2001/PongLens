from __future__ import annotations

import copy
import os
import sys


HERE = os.path.dirname(os.path.abspath(__file__))
WORKER = os.path.dirname(HERE)
sys.path.insert(0, WORKER)

from admin_serve_attribution import enrich_card  # noqa: E402


def _card(**changes):
    card = {
        "serve_arrival_s": 10.0,
        "serve_half": "near",
        "serve_bounces": None,
        "bounces": [],
    }
    card.update(changes)
    return card


def test_matching_bounce_pair_is_the_strongest_evidence():
    original = _card(
        serve_bounces=[10.2, 10.6],
        bounces=[{"t": 10.2, "v": 2.1, "onSurface": True}],
    )

    got = enrich_card(original, held_half="near")

    assert got["serve_half"] == "far"
    assert got["serve_half_v3"] == "near"
    assert got["serve_half_source"] == "bounce_pair"
    assert got["serve_half_confidence"] == "high"
    assert original["serve_half"] == "near"


def test_held_ball_is_used_when_there_is_no_matching_pair():
    got = enrich_card(_card(), held_half="far")

    assert got["serve_half"] == "far"
    assert got["serve_half_v3"] == "near"
    assert got["serve_half_source"] == "held_ball"
    assert got["serve_half_confidence"] == "high"


def test_visible_bounce_is_preserved_as_a_low_confidence_fallback():
    got = enrich_card(_card(), held_half=None)

    assert got["serve_half"] == "near"
    assert got["serve_half_v3"] == "near"
    assert got["serve_half_source"] == "visible_bounce"
    assert got["serve_half_confidence"] == "low"


def test_pair_from_a_different_flight_is_ignored():
    got = enrich_card(
        _card(
            serve_bounces=[12.2, 12.6],
            bounces=[{"t": 12.2, "v": 2.1, "onSurface": True}],
        ),
        held_half="near",
    )

    assert got["serve_half"] == "near"
    assert got["serve_half_source"] == "held_ball"


def test_no_server_evidence_remains_unanswered():
    original = _card(serve_arrival_s=None, serve_half=None)
    before = copy.deepcopy(original)

    got = enrich_card(original, held_half=None)

    assert got["serve_half"] is None
    assert got["serve_half_v3"] is None
    assert got["serve_half_source"] is None
    assert got["serve_half_confidence"] is None
    assert original == before

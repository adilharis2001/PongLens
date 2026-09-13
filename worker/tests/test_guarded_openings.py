"""Opening trims must preserve the reviewed preparation and existing play."""
import copy
import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import body_points as bp


def card(start=10., end=30., **kw):
    return dict(t0=start, t1=end, serve_s=None, why='bodies', end_evidence_s=None, **kw)


def edges(cards=None, serves=(15.,), cross=(16., 18.), bt=(), **kw):
    return bp._guarded_anchor_and_close(cards or [card()], list(serves), list(cross), list(bt), [], 60., **kw)[0]


def test_later_serve_removes_waiting_without_changing_end_or_stamp():
    actual = edges()
    assert actual == [dict(t0=13.4, t1=19.5, serve_s=None,
                           why='bodies, ended where the ball stopped', end_evidence_s=18.)]


@pytest.mark.parametrize('cross,bt', [((13.5,18.),()), ((18.,),(13.5,))])
def test_first_activity_keeps_one_point_two_seconds_of_preparation(cross, bt):
    actual = edges(cross=cross, bt=bt)
    assert actual[0]['t0'] == pytest.approx(12.6)
    assert actual[0]['t1'] == 19.5


@pytest.mark.parametrize('cross,bt', [((12.,18.),()), ((18.,),(12.,)), ((9.8,18.),())])
def test_activity_in_removed_padded_video_vetoes_trim(cross, bt):
    assert edges(cross=cross, bt=bt)[0]['t0'] == 10.


def test_existing_serve_keeps_its_preparation():
    cards=[dict(card(),serve_s=12.)]
    assert edges(cards)[0]['t0'] == 10.


def test_anchor_disabled_keeps_body_start():
    assert edges(anchor=False)[0]['t0'] == 10.


def test_no_serve_keeps_body_start():
    assert edges(serves=())[0]['t0'] == 10.


def test_no_activity_still_preserves_serve_runup():
    actual=edges(cross=(),close=False)
    assert actual[0]['t0'] == 13.4
    assert actual[0]['t1'] == 30.


def test_input_cards_are_not_mutated():
    cards=[card()]; before=copy.deepcopy(cards)
    edges(cards)
    assert cards == before


def test_reviewed_toss_and_mid_rally_regressions():
    import json
    import points_v2 as v2
    fixtures=json.loads((Path(__file__).parent/'fixtures/guarded_openings.json').read_text())
    for fixture in fixtures:
        d=fixture['inputs']
        actual=bp._guarded_anchor_and_close(
            *[d[k] for k in ('cards','serves','cross','bt_table','dead','duration')],
            bt_endline=d['bt_endline'])[0]
        assert v2.resolve(actual) == fixture['expected'], fixture['name']


def test_join_changes_retain_baseline_cards():
    before=[card(),card(35.,45.)]
    proposed=[card(13.4),card(38.4,45.)]
    old=[dict(left_index=0,right_index=1,accepted=True)]
    new=[dict(left_index=0,right_index=1,accepted=False)]
    assert bp._preserve_joined_cards(before,proposed,old,new) == before


@pytest.mark.parametrize('proposed', [[card(13.4,29.)], [], [card(29.9)], [card(float('nan'))]])
def test_invalid_or_different_ending_proposal_retains_baseline(proposed):
    before=[card()]
    assert bp._preserve_joined_cards(before,proposed,[],[]) == before


def test_joined_output_only_copies_opening_even_if_evidence_differs():
    before=[card()]
    proposed=[dict(card(13.4),serve_s=15.,why='different',end_evidence_s=18.)]
    assert bp._preserve_joined_cards(before,proposed,[],[]) == [dict(card(),t0=13.4)]


def test_trim_cannot_pass_existing_end_evidence():
    before=[dict(card(),end_evidence_s=12.)]
    proposed=[dict(card(13.4),end_evidence_s=None)]
    assert bp._preserve_joined_cards(before,proposed,[],[]) == before

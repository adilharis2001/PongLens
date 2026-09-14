"""Ending evidence may shorten a tail; it must never discard another rally."""
import copy
import sys
from pathlib import Path

import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import net_endings as N


def sequence(first=15.0, second=15.3, last=None, **overrides):
    row=dict(first=first,last=second if last is None else last,
             half='near',n_bounces=2,bounces=[{'t':first},{'t':second}],
             net_motion={'t':first-.1,'absorbed':True,'reversed':False,
                         'in_wps':1.,'out_wps':.2},arcs=[{'gap':.05,'rise_w':.02}])
    row.update(overrides)
    return row


def card(a=10.,b=20.,**overrides):
    return dict(t0=a,t1=b,serve_s=10.6,end_evidence_s=18.5,why='bodies',**overrides)


def test_net_tail_shortens_without_changing_identity_or_input():
    cards=[card()];before=copy.deepcopy(cards)
    out,info=N.refine_endings(cards,[sequence()],[12.,14.],[])
    assert cards==before
    assert len(out)==1 and out[0]['t0']==10. and out[0]['serve_s']==10.6
    assert out[0]['t1']==pytest.approx(15.8)
    assert info['trimmed']==1
    assert out[0]['net_ending']['confirmed']==15.3


def test_any_later_crossing_preserves_whole_rally_even_with_later_serve():
    cards=[card()]
    out,info=N.refine_endings(cards,[sequence()],[12.,14.,18.],[17.])
    assert out==cards and info['trimmed']==0


def test_shorter_padding_cannot_admit_a_previously_ineligible_sequence():
    # second+.2 could shorten to15.5, but reviewed eligibilityfirst+.8 cannot.
    cards=[card(b=15.9)]
    assert N.refine_endings(cards,[sequence()],[12.],[])[0]==cards


def test_proposal_requires_whole_maximal_chain_inside_card():
    cards=[card()]
    assert N.refine_endings(cards,[sequence(last=21.)],[12.],[])[0]==cards


def test_serve_setup_bounces_do_not_end_a_point():
    cards=[card()]
    assert N.refine_endings(cards,[sequence(first=10.9,second=11.2)],[10.8],[])[0]==cards


def test_later_candidate_does_not_reinterpret_first_split_as_ending():
    cards=[card(b=30.)]
    assert N.refine_endings(cards,[sequence(),sequence(27.,27.3)],
                            [12.,18.,25.],[17.6])[0]==cards


def test_invalid_or_missing_track_leaves_cards_unchanged():
    assert N.extract_sequences({}, {},30.,1920.,[])==[]
    with pytest.raises(ValueError):
        N.extract_sequences({0:(0.,0.)},{},0.,1920.,[])


def test_winner_is_camera_side_and_does_not_require_player_score():
    pred=N.predict_winner(card(),[sequence()],[12.,14.],[10.6])
    assert pred['winner_side']=='far'
    assert pred['status']=='predicted'
    assert pred['evaluated_t0']==10. and pred['evaluated_t1']==20.


def test_crossing_after_claimed_net_contact_invalidates_winner_cause():
    seq=sequence();seq['net_motion']['t']=14.6
    pred=N.predict_winner(card(),[seq],[12.,14.9],[10.6])
    assert pred['winner_side'] is None
    assert pred['reason']=='crossing_after_net_motion'


def test_multiple_distinct_bounce_episodes_abstain_on_whole_card_winner():
    pred=N.predict_winner(card(),[sequence(12.,12.3),sequence()],
                          [11.,14.],[10.6])
    assert pred['status']=='abstained' and pred['winner_side'] is None
    assert pred['evidence']['terminal_event_winner_side']=='far'


def test_no_net_evidence_is_explicit_abstention():
    pred=N.predict_winner(card(),[],[12.,14.],[10.6])
    assert pred['status']=='abstained' and pred['winner_side'] is None
    assert pred['reason']=='no_terminal_net_sequence'


def test_optional_end_processing_failure_keeps_all_existing_cards():
    from types import SimpleNamespace
    cards=[card()]
    out,predictions,info=N.process_cards(cards,SimpleNamespace(track={0:(1,2)},fps=0,cross=[]),{'invalid':[0,0]},1920.,[])
    assert out==cards
    assert predictions[0]['status']=='error' and predictions[0]['winner_side'] is None
    assert info['status']=='error'


def test_prediction_finalization_uses_published_window_and_preserves_context():
    pred=N.predict_winner(card(),[sequence()],[12.,14.],[10.6])
    row=N.finalize_prediction(pred,3,10.,15.79)
    assert row['idx']==3 and row['evaluated_t1']==15.79
    assert row['evidence']['analysis_t1']==20.
    assert pred['evaluated_t1']==20.


@pytest.mark.parametrize('cross,serves', [([float('nan')],[]),([float('inf')],[]),([[12.,13.]],[]),([],[float('nan')])])
def test_malformed_event_times_cannot_remove_continuation_veto(cross,serves):
    with pytest.raises(ValueError):
        N.refine_endings([card()],[sequence()],cross,serves)


def test_malformed_crossings_fail_open_before_extracting_sequences(monkeypatch):
    from types import SimpleNamespace
    cards = [card()]
    corners = dict(A_near_1=[0,1], B_near_2=[1,1], C_far_2=[1,0], D_far_1=[0,0])
    monkeypatch.setattr(N.V, 'bounces', lambda *args: pytest.fail('invalid evidence reached bounce detector'))
    out, predictions, info = N.process_cards(cards, SimpleNamespace(
        track={0:(.5,.5)}, fps=30, cross=[float('nan')]), corners, 1920, [])
    assert out == cards
    assert info['status'] == 'error'
    assert predictions[0]['status'] == 'error'

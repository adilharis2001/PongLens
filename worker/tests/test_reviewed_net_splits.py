"""A verified restart must survive without accepting a live-rally gap."""
import copy
import sys
from pathlib import Path

import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import net_endings as N
sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_net_endings import card, sequence


def test_reviewed_split_retains_both_points_and_resets_second_serve():
    original = [card(b=30.)]
    before = copy.deepcopy(original)
    out, terminals, info = N.split_cards(original, [sequence()], [12., 14., 19., 25.], [10.6, 18.])
    assert original == before
    assert [(c['t0'], c['t1'], c['serve_s']) for c in out] == [(10., 15.8, 10.6), (16.4, 30., 18.)]
    assert info['added_cards'] == 1
    assert out[0]['end_evidence_s'] == 15.8
    assert out[1]['end_evidence_s'] == 18.5
    assert 10. in terminals


def test_recursive_split_preserves_third_point():
    out, _, info = N.split_cards([card(b=40.)], [sequence(), sequence(25., 25.3)],
                                 [12., 14., 19., 23., 29., 35.], [10.6, 18., 28.])
    assert [(c['t0'], c['t1']) for c in out] == [(10.,15.8),(16.4,25.8),(26.4,40.)]
    assert info['added_cards'] == 2


@pytest.mark.parametrize('cross,serves', [([12.,14.,16.,19.],[18.]), ([12.,14.,19.],[]), ([12.,14.],[18.])])
def test_live_crossing_or_unconfirmed_restart_keeps_original_card(cross, serves):
    original = [card(b=30.)]
    assert N.split_cards(original,[sequence()],cross,serves)[0] == original


def test_three_low_bounces_can_split_but_two_without_net_cannot():
    two = sequence(net_motion=None)
    three = sequence(last=15.6,n_bounces=3,bounces=[{'t':15.},{'t':15.3},{'t':15.6}],net_motion=None)
    original = [card(b=30.)]
    assert len(N.split_cards(original,[two],[12.,14.,19.],[18.])[0]) == 1
    out, terminals, _ = N.split_cards(original,[three],[12.,14.,19.],[18.])
    assert len(out) == 2
    # Without net-motion evidence the winner must remain unknown.
    pred = N.predict_winner(out[0],[three],[12.,14.],[10.6], terminal=terminals[10.])
    assert pred['winner_side'] is None and pred['status'] == 'abstained'


def test_new_first_card_can_get_its_own_winner_prediction():
    seq = sequence()
    out, terminals, _ = N.split_cards([card(b=30.)],[seq],[12.,14.,19.],[10.6,18.])
    pred = N.predict_winner(out[0],[seq],[12.,14.,19.],[10.6,18.],terminal=terminals[10.])
    assert pred['status'] == 'predicted' and pred['winner_side'] == 'far'
    assert pred['evaluated_t1'] == 15.8
    assert pred['method_version'] == 'net-splits-v1'


def test_malformed_event_evidence_never_opens_a_gap():
    with pytest.raises(ValueError):
        N.split_cards([card(b=30.)],[sequence()],[float('nan')],[18.])


def test_fast_reversal_can_split_on_three_bounces_but_cannot_predict_winner():
    seq = sequence(last=15.6,n_bounces=3,bounces=[{'t':15.},{'t':15.3},{'t':15.6}],
                   net_motion={'t':14.9,'absorbed':False,'reversed':True,'in_wps':1.,'out_wps':-2.})
    out, terminals, _ = N.split_cards([card(b=30.)],[seq],[12.,14.,19.],[10.6,18.])
    assert len(out) == 2
    pred = N.predict_winner(out[0],[seq],[12.,14.,19.],[10.6,18.],terminal=terminals[10.])
    assert pred['winner_side'] is None and pred['status'] == 'abstained'


def test_split_predictions_survive_private_sidecar_validation(tmp_path):
    import json
    import point_winner_predictions as P
    seq = sequence()
    out, terminals, _ = N.split_cards([card(b=30.)],[seq],[12.,14.,19.],[10.6,18.])
    points = [dict(idx=i,t0=c['t0'],t1=c['t1']) for i,c in enumerate(out)]
    predictions = [N.finalize_prediction(N.predict_winner(c,[seq],[12.,14.,19.],[10.6,18.],
                                terminal=terminals.get(c['t0'])),i,c['t0'],c['t1']) for i,c in enumerate(out)]
    (tmp_path/P.SIDECAR).write_text(json.dumps(dict(schema_version=1,points=predictions)))
    rows = P.load_predictions(tmp_path,points)
    assert [r['status'] for r in rows] == ['predicted','abstained']
    assert [r['method_version'] for r in rows] == ['net-splits-v1','net-endings-v1']

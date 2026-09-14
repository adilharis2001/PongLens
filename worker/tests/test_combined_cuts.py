"""Owner-labelled actual detector windows, not invented timing expectations."""
import json
import sys
from pathlib import Path
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import combined_cuts as C
FIXTURES=Path(__file__).parent/'fixtures/combined_cuts'


def test_archived_ball_track_preserves_confirmed_live_first_rally():
    import net_endings as N
    import points_v2 as V
    data=json.loads((FIXTURES.parent/'net_continuation_first_rally.json').read_text())
    track={row[0]:row[1:] for row in data['track']}
    cross=V.crossings(track,V.homography_from_corners(data['corners']),data['fps'])
    seq=N.extract_sequences(track,data['corners'],data['fps'],data['width'],cross)
    assert len(seq)==1 and seq[0]['n_bounces']==2
    assert seq[0]['first']==pytest.approx(12.166984957488554)
    context=dict(crossings=cross,bounces=[f/data['fps'] for f,x,y in V.bounces(track)],
                 sequences=seq,body_T=[],body_p=[],candidate_features=[],
                 motifs=[],long_bounces=[],cards_gap4=[])
    result=C.propose(context,[dict(idx=2,t0=9.48,t1=15.97,serve_s=10.19)])
    assert [[c['t0'],c['t1']] for c in result['cards']]==[[9.48,15.97]]


def test_crossed_net_episode_cannot_shorten_yu_yu_lin_first_rally():
    # Saved production terminal evidence. Owner confirmed live play beyond
    # 13.12s. The alleged contact precedes a crossing to the bounce pair.
    seq=dict(first=12.166984957488554,last=12.300321778940484,n_bounces=2,
             half='far',bounces=[{'t':12.166984957488554}, {'t':12.300321778940484}],
             net_motion={'t':11.833642903858731, 'u':-.1292734197834753,
                         'v':1.1242619368982854, 'absorbed':True,'reversed':True,
                         'in_wps':-4.571565224639072,'out_wps':1.6173428398395535})
    # 13.30 is retained by the original full-rally diagnostic; the new
    # per-card diagnostic stops at 13.12 and cannot show this continuation.
    context=dict(crossings=[11.07,11.73,11.90,12.87,13.30],
                 bounces=[11.,11.33,11.77,12.17,12.30,12.90],
                 body_T=[],body_p=[],sequences=[seq],candidate_features=[],
                 motifs=[],long_bounces=[],cards_gap4=[])
    base=[dict(idx=2,t0=9.48,t1=15.97,serve_s=10.19)]
    result=C.propose(context,base)
    assert [[c['t0'],c['t1']] for c in result['cards']]==[[9.48,15.97]]
    assert result['tails']==[]


def test_two_close_bounces_without_crossing_still_shorten_net_ending():
    # Do not solve the regression by banning rapid double bounces or all tails.
    seq=dict(first=12.17,last=12.30,n_bounces=2,half='far',
             bounces=[{'t':12.17},{'t':12.30}],net_motion={'t':11.83})
    context=dict(crossings=[11.07,11.73],bounces=[12.17,12.30],
                 body_T=[],body_p=[],sequences=[seq],candidate_features=[],
                 motifs=[],long_bounces=[],cards_gap4=[])
    result=C.propose(context,[dict(idx=2,t0=9.48,t1=15.97,serve_s=10.19)])
    assert [[c['t0'],c['t1']] for c in result['cards']]==[[9.48,13.12]]
    assert len(result['tails'])==1


def test_isolated_cleanup_crossings_do_not_undo_a_net_ending():
    # A stopped ball can be passed back later. Unlike the live exchange in
    # Yu Yu Lin, these crossings are not a rapid continuing exchange.
    seq=dict(first=12.17,last=12.30,n_bounces=2,half='far',
             bounces=[{'t':12.17},{'t':12.30}],net_motion={'t':11.83,'u':-.13})
    context=dict(crossings=[11.90,12.66,13.70],bounces=[12.17,12.30],
                 body_T=[],body_p=[],sequences=[seq],candidate_features=[],
                 motifs=[],long_bounces=[],cards_gap4=[])
    result=C.propose(context,[dict(idx=2,t0=9.48,t1=15.97,serve_s=10.19)])
    assert [[c['t0'],c['t1']] for c in result['cards']]==[[9.48,13.12]]


def test_in_table_net_contact_is_outside_surgical_fix_scope():
    # Some genuine net endings include quick ball returns. Do not extend
    # those while fixing an off-table contact misidentified as a net event.
    seq=dict(first=12.17,last=12.30,n_bounces=2,half='far',
             bounces=[{'t':12.17},{'t':12.30}],net_motion={'t':11.83,'u':.67})
    context=dict(crossings=[11.90,12.87,13.30],bounces=[12.17,12.30],
                 body_T=[],body_p=[],sequences=[seq],candidate_features=[],
                 motifs=[],long_bounces=[],cards_gap4=[])
    result=C.propose(context,[dict(idx=2,t0=9.48,t1=15.97,serve_s=10.19)])
    assert [[c['t0'],c['t1']] for c in result['cards']]==[[9.48,13.12]]

@pytest.mark.parametrize('path',sorted(FIXTURES.glob('*.json')),ids=lambda p:p.stem)
def test_owner_reviewed_attempts(path):
    f=json.loads(path.read_text())
    before=json.dumps(f,sort_keys=True)
    result=C.propose(f['context'],f['baseline'])
    assert [[c['t0'],c['t1']] for c in result['cards']]==f['expected_windows']
    assert json.dumps(f,sort_keys=True)==before

def test_service_hold_protects_a_short_failed_attempt():
    f=json.loads((FIXTURES/'8cb54f9f-51.json').read_text())
    s=next(s for s in f['context']['candidate_features'] if abs(s['contact']-704.73)<.01)
    s.update(held_start=s['contact']-1,held_end=s['contact']-.4,held_side=s['side'])
    assert len(C.propose(f['context'],f['baseline'])['cards'])==2


def test_metadata_is_rebuilt_for_each_attempt():
    f=json.loads((FIXTURES/'6d55dfb7-21.json').read_text())
    raw=C.propose(f['context'],f['baseline'])
    cards=C.final_cards(raw,f['baseline'])
    assert len(cards)==4
    for c in cards:
        assert set(c)<=set(['t0','t1','serve_s','why','end_evidence_s'])
        assert c['serve_s'] is None or c['t0']-1<=c['serve_s']<=c['t1']
        assert c['end_evidence_s'] is None or c['t0']<=c['end_evidence_s']<=c['t1']
    assert cards[1]['serve_s']!=cards[0]['serve_s']


def test_metadata_does_not_inherit_winner_or_cut_clock():
    parent=dict(idx=1,t0=0.,t1=20.,serve_s=1.,end_evidence_s=19.,
                cut_t0=80.,winner='near',clip_t0=79.7)
    raw=dict(cards=[dict(parent,t1=7.),dict(parent,t0=10.)],
             decisions=[dict(original_card=1,right_start=10.,serve=11.)])
    first,second=C.final_cards(raw,[parent])
    assert first['serve_s']==1. and first['end_evidence_s'] is None
    assert second['serve_s']==11. and second['end_evidence_s']==19.
    assert 'cut_t0' not in first and 'winner' not in second


def test_missing_evidence_keeps_original_cards_and_predictions():
    cards=[dict(t0=1.,t1=9.)];predictions=[dict(winner_side='far')]
    actual,private,info=C.process_cards(cards,predictions,None,None,1920,[],None,None,[])
    assert actual is cards and private is predictions
    assert info['status']=='not_applied'


def test_evidence_error_keeps_original_cards_and_predictions():
    from types import SimpleNamespace
    cards=[dict(t0=1.,t1=9.)];predictions=[dict(winner_side='far')]
    actual,private,info=C.process_cards(cards,predictions,SimpleNamespace(),{'bad':1},1920,
                                      [],{'present':True},{'present':True},[])
    assert actual is cards and private is predictions
    assert info['status']=='error'


def test_private_prediction_uses_selected_terminal_after_clip_trim():
    import net_endings as N
    f=json.loads((FIXTURES/'50caea29-44.json').read_text())
    result=C.propose(f['context'],f['baseline'])
    cards=C.final_cards(result,f['baseline'])
    card=cards[0]
    assert N.predict_winner(card,f['context']['sequences'],f['context']['crossings'],[])['status']=='abstained'
    terminal=C.terminal_for_card(result,card)
    assert terminal is not None
    prediction=N.predict_winner(card,f['context']['sequences'],f['context']['crossings'],[],terminal=terminal)
    assert prediction['status']=='predicted'
    assert terminal['confirmed']<=card['t1']


def test_terminal_of_first_child_is_not_used_for_second():
    f=json.loads((FIXTURES/'6d55dfb7-21.json').read_text())
    result=C.propose(f['context'],f['baseline'])
    for card in C.final_cards(result,f['baseline']):
        terminal=C.terminal_for_card(result,card)
        if terminal:
            assert card['t0']<=terminal['sequence']['first']<=terminal['confirmed']<=card['t1']

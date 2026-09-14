"""Owner-labelled actual detector windows, not invented timing expectations."""
import json
import sys
from pathlib import Path
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import combined_cuts as C
FIXTURES=Path(__file__).parent/'fixtures/combined_cuts'

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

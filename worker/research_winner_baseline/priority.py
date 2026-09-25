"""Frozen machine rule extraction; no dataset access or fitting."""
from . import stroke
from . import same_shot as experiment


NET_VETOES={'net_settling_half_unresolved','net_or_rally_phase_ambiguous','post_contact_low_bounce_sequence'}

def predict(f,corners,phase_result):
    recovered=stroke.recover(f,corners)
    augmented=dict(f,candidates=sorted(f['candidates']+recovered,key=lambda c:c['t']))
    result=experiment.analyze(augmented,corners)
    raw_winner=result['winner'];raw_reason=result['reason']
    result.update(association_winner=raw_winner,association_reason=raw_reason,
                  branch='same_shot' if raw_winner is not None else 'unresolved')
    if phase_result['branch']=='existing_net':
        result.update(winner=phase_result['winner'],reason=phase_result['reason'],
                      branch='existing_net',net_evidence=phase_result['evidence'])
    elif phase_result['reason'] in NET_VETOES:
        result.update(winner=None,reason=phase_result['reason'],branch='unresolved')
    return result

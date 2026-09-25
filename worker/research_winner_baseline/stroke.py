"""Frozen machine rule extraction; no dataset access or fitting."""
from research_contact_recovery import recover
from . import reversal as base


def predict(f,corners):
    added=recover(f,corners)
    augmented=dict(f,candidates=sorted(f['candidates']+added,key=lambda c:c['t']))
    verdict=base.predict(augmented)
    return dict(idx=f['idx'],window=[f['start'],f['end']],added_contacts=added,
                last_contact=verdict.get('last_reversal'),raw_winner=verdict['raw_winner'],
                guarded_winner=verdict['guarded_winner'],reasons=verdict['reasons'],
                receiving_bounces=verdict.get('receiving_bounce_candidates',[]),physical_end_s=None)

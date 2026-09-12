"""Frozen, owner-reviewed narrow continuation rule. No model fitting.

Positive body, ball and table evidence must all bridge a short seam.
Never move the outside edges or first serve, and never refine a joined
card again. Net-roll false joins remain a known, reviewed limitation.
"""
import copy
import math
from bisect import bisect_right

import numpy as np

POLICY = 'agreement_plus_table_supported_continuation_v2'


def join_supported_continuations(cards, T, p, near, far, events, dead_runs, *,
                                 table_bounces, support=.8, max_event_gap=1.2,
                                 min_play=.6, max_missing=.6):
    T, p, near, far = [np.asarray(x) for x in (T,p,near,far)]
    if not (len(T) == len(p) == len(near) == len(far)):
        raise ValueError('observation lengths differ')
    if len(T) < 2 or not np.isfinite(T).all() or not (np.diff(T) > 0).all():
        raise ValueError('observation clock must be finite and increasing')
    dt = float(np.median(np.diff(T)))
    ev = np.asarray(sorted(set(float(x) for x in events if math.isfinite(float(x)))))
    bt = sorted(set(float(x) for x in table_bounces if math.isfinite(float(x))))
    for i,card in enumerate(cards):
        if not all(math.isfinite(card[k]) for k in ('t0','t1')) or card['t1'] <= card['t0']:
            raise ValueError('invalid card')
        if i and cards[i-1]['t1'] > card['t0']:
            raise ValueError('source cards must be ordered and nonoverlapping')

    def decision(left, right):
        a,b = left['t1'],right['t0']
        d = dict(gap=[a,b],accepted=False)

        def reject(reason):
            d['reason'] = reason
            return d

        if b-a <= 0 or b-a > 2*support+1e-8:
            return reject('gap outside narrow repair scope')
        ix = np.flatnonzero((T >= a) & (T <= b))
        if len(ix) < 2 or T[ix[0]] > a+dt*1.5 or T[ix[-1]] < b-dt*1.5:
            return reject('insufficient clock coverage')
        if np.max(np.diff(T[ix])) > dt*1.5:
            return reject('missing time samples')
        q = p[ix]
        d['minimum_play'] = float(np.min(q)) if np.isfinite(q).all() else None
        if not np.isfinite(q).all() or np.min(q) < min_play:
            return reject('low or unknown body play')
        for name,v in [('near',near),('far',far)]:
            present = v[ix].astype(bool)
            d[name+'_present'] = int(present.sum())
            run = worst = 0
            for seen in present:
                run = 0 if seen else run+1
                worst = max(worst,run)
            if present.sum() < 2 or worst*dt >= max_missing-1e-8:
                return reject('insufficient observed '+name+' player')
        if any(float(start) <= b+support and float(end) >= a-support for start,end in dead_runs):
            return reject('detected dead ball nearby')
        bridge = ev[(ev >= a-support) & (ev <= b+support)]
        d['bridge_events'] = bridge.tolist()
        mid = (a+b)/2
        if len(bridge) < 2 or not np.any(bridge <= mid) or not np.any(bridge > mid):
            return reject('ball events do not straddle seam')
        if bridge[0] > a+support or bridge[-1] < b-support or np.max(np.diff(bridge)) > max_event_gap+1e-8:
            return reject('ball event chain interrupted')
        i = bisect_right(bt,mid)
        pair = bt[i-1:i+1] if 0 < i < len(bt) else []
        d['table_bounce_pair'] = pair
        if not pair or pair[0] < a-support or pair[1] > b+support or pair[1]-pair[0] > max_event_gap+1e-8:
            return reject('table play does not bridge seam')
        d.update(accepted=True,reason='body, ball and table bounce pair support removed seam')
        return d

    out,decisions = [],[]
    for i,card in enumerate(cards):
        if i:
            d = decision(cards[i-1],card)
            d.update(left_index=i-1,right_index=i)
            decisions.append(d)
            if d['accepted']:
                out[-1]['t1'] = card['t1']
                out[-1]['end_evidence_s'] = card.get('end_evidence_s')
                phrase = 'continuation seam restored'
                why = out[-1].get('why') or 'bodies'
                out[-1]['why'] = why if phrase in why else why+', '+phrase
                continue
        out.append(copy.deepcopy(card))
    return out,decisions

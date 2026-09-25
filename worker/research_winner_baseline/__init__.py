"""Portable fresh machine baseline; no fitting, score labels, files or services.

Only `decide` is the public boundary. See README for the explicit distinction
between this recomputation and historical cached baseline decisions.
"""
from collections.abc import Mapping
import math
from research_winner_runtime import normalize_input
from . import net, stroke, phase, priority, frame_exit, association

CONTRACT = 'copied-worker-fresh-baseline-v1'


def _number(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise ValueError('Expected finite numeric evidence')
    return float(v)


def _time(v):
    v = _number(v)
    if v < 0:
        raise ValueError('Negative source time')
    return v


def _mapping(v):
    if not isinstance(v, Mapping):
        raise ValueError('Expected evidence object')
    return v


def _sequence(v):
    if not isinstance(v, (list, tuple)):
        raise ValueError('Expected evidence sequence')
    return v


def _ordered(values):
    if any(a > b for a, b in zip(values, values[1:])):
        raise ValueError('Evidence must retain chronological order')


def normalize_corpus(corpus):
    """Allowlist whole-recording machine context; do not infer missing evidence.

    The upstream generator owns full-recording coverage and provenance. Unknown
    annotations and corpus `serves` are never passed into these frozen rules.
    """
    c = _mapping(corpus)
    if not isinstance(c.get('provenance'), str) or not c['provenance'].strip():
        raise ValueError('Machine corpus provenance required')
    crossings = [_time(t) for t in _sequence(c['crossings'])]
    _ordered(crossings)
    sequences = []
    for item in _sequence(c['sequences']):
        s = _mapping(item)
        clean = dict(first=_time(s['first']), last=_time(s['last']), half=s['half'])
        if clean['half'] not in ('near', 'far') or clean['first'] > clean['last']:
            raise ValueError('Invalid net sequence extent or half')
        count = s['n_bounces']
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            raise ValueError('Invalid bounce count')
        bounces = []
        for value in _sequence(s['bounces']):
            b = _mapping(value)
            out = dict(t=_time(b['t']), v=_number(b['v']), half=b['half'])
            if out['half'] not in ('near', 'far') or not clean['first'] <= out['t'] <= clean['last']:
                raise ValueError('Invalid settling bounce')
            for k in ('f', 'u'):
                if k in b:
                    out[k] = _number(b[k])
            if 'xy' in b:
                xy = [_number(v) for v in _sequence(b['xy'])]
                if len(xy) != 2:
                    raise ValueError('Invalid bounce position')
                out['xy'] = xy
            bounces.append(out)
        if count != len(bounces):
            raise ValueError('Bounce count differs from evidence')
        _ordered([b['t'] for b in bounces])
        arcs = []
        for value in _sequence(s['arcs']):
            a = _mapping(value)
            arcs.append({k: _number(a[k]) for k in ('gap', 'rise_w')})
        motion = s['net_motion']
        if motion is not None:
            m = _mapping(motion)
            motion = dict(t=_time(m['t']), in_wps=_number(m['in_wps']), out_wps=_number(m['out_wps']))
            for k in ('absorbed', 'reversed'):
                if not isinstance(m[k], bool):
                    raise ValueError('Net motion flags must be booleans')
                motion[k] = m[k]
            for k in ('u', 'v'):
                if k in m:
                    motion[k] = _number(m[k])
        clean.update(n_bounces=count, bounces=bounces, arcs=arcs, net_motion=motion)
        sequences.append(clean)
    _ordered([s['first'] for s in sequences])
    return dict(sequences=sequences, crossings=crossings, provenance=c['provenance'])


def decide(row, corpus):
    """Recompute net/legal/association parts; outgoing inference belongs downstream.

    An unavailable response deliberately lacks the required baseline fields, so
    the winner runtime cannot mistake missing upstream evidence for abstention.
    """
    unavailable = dict(contract=CONTRACT, status='unavailable', reason='invalid_machine_input')
    try:
        r = _mapping(row)
        clean = normalize_input(dict(features=r['features'], corners=r['corners'],
                                     serve_s=r.get('serve_s'), contacts=[]))
        c = normalize_corpus(corpus)
        f = clean['features']
        placement = r['features'].get('placement_available', True)
        if not isinstance(placement, bool):
            raise ValueError('Placement availability must be explicit boolean')
        # idx is diagnostic only in the original reversal functions. Never import
        # point identity into the portable decision path.
        f.update(idx=0, placement_available=placement)
    except (KeyError, TypeError, ValueError, AttributeError):
        return unavailable
    card = dict(t0=f['start'], t1=f['end'], serve_s=clean['serve_s'])
    seq, cross = c['sequences'], c['crossings']
    # This is deliberately the frozen fresh E.baseline path: no corpus serves.
    nr = dict(prediction=net.predict_winner(card, seq, cross, []),
              sequences=[s for s in seq if card['t0'] <= s['first'] and s['last'] <= card['t1']])
    pr = phase.decide(stroke.predict(f, clean['corners']), nr, f['candidates'], cross)
    ss = priority.predict(f, clean['corners'], pr)
    extra = frame_exit.additional(f, clean['corners'], ss)
    associated = association.decide(card, seq, [t for t in cross if t <= f['end']], [],
                                    f['candidates'], clean['corners'], f['fps'])
    return dict(contract=CONTRACT, status='available',
                existing_net=ss['winner'] if ss['branch'] == 'existing_net' else None,
                legacy=extra['winner'] or ss['winner'],
                new_net_association=associated['winner'],
                net_veto=ss['reason'] in priority.NET_VETOES,
                provenance=dict(rules=CONTRACT, context=c['provenance'], serves='not used'),
                diagnostics=dict(net=nr['prediction'], phase=pr, same_shot=ss,
                                 frame_exit=extra, association=associated))

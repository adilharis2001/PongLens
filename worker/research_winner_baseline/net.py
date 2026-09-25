"""Frozen machine rule extraction; no dataset access or fitting."""
import numpy as np


METHOD_VERSION = 'net-endings-v1'

SPLIT_VERSION = 'net-splits-v1'

def _event_times(values):
    """Reject broken evidence rather than silently losing a continuation veto."""
    try:
        times = np.asarray(values, dtype=float)
    except (TypeError, ValueError) as exc:
        raise ValueError('invalid event timestamps') from exc
    if times.ndim != 1 or not np.all(np.isfinite(times)) or np.any(times < 0):
        raise ValueError('invalid event timestamps')
    return times

def _eligible(sequence):
    m = sequence.get('net_motion')
    return bool(sequence['n_bounces']>=2 and m and
                (m['absorbed'] or (m['reversed'] and abs(m['out_wps'])<abs(m['in_wps']))))

def _proposal(card, sequences, crossings, serves, *, low_bounce_splits=False):
    """Frozen first-proposal selection, including split candidates as vetoes."""
    for seq in sequences:
        eligible = _eligible(seq)
        if not (card['t0']<=seq['first'] and seq['last']<=card['t1'] and
                (eligible or (low_bounce_splits and seq['n_bounces']>=3))):
            continue
        first = seq['first']; confirmed = seq['bounces'][1]['t']
        if first < max(card['t0']+1,(card.get('serve_s') or card['t0'])+.8):
            continue
        end = max(first+.8,confirmed+.2)
        if end>=card['t1']-.2:
            continue
        later_cross = [t for t in crossings if confirmed+.2<t<card['t1']]
        if later_cross:
            later_serve = [s for s in serves if confirmed+.8<s<card['t1']-1]
            if not later_serve:
                continue
            serve = min(later_serve); right = serve-1.6
            if right<end+.1 or any(confirmed+.2<t<right for t in later_cross):
                continue
            if not any(serve+.15<t<=min(serve+2.5,card['t1']) for t in later_cross):
                continue
            return dict(kind='split',sequence=seq,confirmed=confirmed,end=end,
                        restart=right,serve=serve)
        if eligible:
            return dict(kind='ending',sequence=seq,confirmed=confirmed,end=end)
    return None

def predict_winner(card,sequences,crossings,serves, *, terminal=None):
    """Independent research prediction; never receive or change a user score.

    A terminal-event hypothesis is retained even when it cannot represent
    one point, so private evaluation can separate detector and card errors.
    """
    crossings, serves = _event_times(crossings), _event_times(serves)
    result = dict(method='net_low_bounces',method_version=METHOD_VERSION,
                  status='abstained',winner_side=None,reason='no_terminal_net_sequence',
                  evaluated_t0=float(card['t0']),evaluated_t1=float(card['t1']),evidence={})
    p = terminal if terminal is not None else _proposal(card,sequences,crossings,serves)
    if terminal is not None:
        result['method_version'] = SPLIT_VERSION
    if not p or p['kind']!='ending':
        return result
    seq = p['sequence']; net = seq['net_motion']; confirmed = p['confirmed']
    if not _eligible(seq):
        result['reason'] = 'net_motion_unavailable' if net is None else 'net_motion_unconfirmed'
        return result
    winner = 'far' if seq['half']=='near' else 'near'
    result['evidence'] = dict(terminal_event_winner_side=winner,
                              first_bounce_s=seq['first'],confirming_bounce_s=confirmed,
                              bounce_half=seq['half'],bounce_count=seq['n_bounces'],
                              net_motion=net,arcs=seq['arcs'],confidence_calibrated=False)
    # A later crossing makes the alleged net event stale, even if a later
    # sequence still safely supports shortening the final tail.
    if any(net['t']+.12<t<seq['first'] for t in crossings):
        result['reason']='crossing_after_net_motion';return result
    prior = [s for s in sequences if card['t0']<=s['first'] and
             s['last']<=seq['first']-1.]
    interior_serves = [s for s in serves if card['t0']<=s<=confirmed]
    if prior or len(interior_serves)>1:
        result['reason']='multiple_rallies_possible';return result
    result.update(status='predicted',winner_side=winner,reason='terminal_net_low_bounces')
    return result

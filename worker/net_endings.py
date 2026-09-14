"""Reviewed net-associated dead-ball tails, never a new split or a score.

Camera near/far is defined by the named table corners. A homography of an
image observation is a heuristic, not a measured physical net collision.
"""
from __future__ import annotations

import math
import numpy as np
import points_v2 as V

METHOD_VERSION = 'net-endings-v1'


def _event_times(values):
    """Reject broken evidence rather than silently losing a continuation veto."""
    try:
        times = np.asarray(values, dtype=float)
    except (TypeError, ValueError) as exc:
        raise ValueError('invalid event timestamps') from exc
    if times.ndim != 1 or not np.all(np.isfinite(times)) or np.any(times < 0):
        raise ValueError('invalid event timestamps')
    return times


def extract_sequences(track, corners, fps, width, crossings):
    """Find the frozen low-bounce sequences once on the whole source track."""
    if not math.isfinite(fps) or fps <= 0 or not math.isfinite(width) or width <= 0:
        raise ValueError('invalid detection scale or frame rate')
    cross = _event_times(crossings)
    if not track:
        return []
    quad = np.asarray([corners[k] for k in
                       ('A_near_1','B_near_2','C_far_2','D_far_1')], float)
    if quad.shape != (4, 2) or not np.all(np.isfinite(quad)):
        raise ValueError('invalid table corners')
    tw = (np.linalg.norm(quad[1]-quad[0])+np.linalg.norm(quad[3]-quad[2]))/2
    axis = (quad[2]+quad[3]-quad[0]-quad[1])/2
    length = np.linalg.norm(axis)
    if tw <= 1e-6 or length <= 1e-6:
        raise ValueError('degenerate table')
    axis /= length
    H = V.homography_from_corners(corners)
    frames = np.asarray(sorted(track))
    times = frames / fps
    xy = np.asarray([track[int(f)] for f in frames], float)
    if xy.shape != (len(frames), 2) or not np.all(np.isfinite(xy)):
        raise ValueError('invalid ball track')
    uv = np.asarray([V.project(H, *p) or [np.nan, np.nan] for p in xy])
    on = []
    for f,x,y in V.bounces(track,width/1920.):
        projected = V.project(H,x,y)
        if projected is None:
            continue
        u,v = projected
        if -.15 <= u <= V.W_M+.15 and -.15 <= v <= V.L_M+.15:
            on.append(dict(f=int(f),t=float(f/fps),xy=[float(x),float(y)],
                           u=float(u),v=float(v),half='near' if v<V.L_M/2 else 'far'))
    candidates = []
    for i, first in enumerate(on):
        chain = [first]; arcs = []
        for bounce in on[i+1:i+5]:
            previous = chain[-1]
            mask = (times >= previous['t']-1e-6)&(times <= bounce['t']+1e-6)
            tt = times[mask]
            if (bounce['half'] != first['half'] or
                    not .10 <= bounce['t']-previous['t'] <= .85 or len(tt)<3):
                break
            gap = float(max(np.diff(tt)))
            rise = float((min(previous['xy'][1],bounce['xy'][1])-min(xy[mask,1]))/tw)
            if (gap>.12 or rise<-.01 or rise>.1133 or
                    np.any((cross>previous['t'])&(cross<bounce['t']))):
                break
            chain.append(bounce); arcs.append(dict(gap=gap,rise_w=rise))
        if len(chain)<2:
            continue
        near = ((times >= first['t']-.8)&(times <= first['t']+.05)&
                (uv[:,0]>=-.15)&(uv[:,0]<=V.W_M+.15)&
                (np.abs(uv[:,1]-V.L_M/2)<.45))
        motion = []
        for j in np.where(near)[0]:
            pre = np.where((times>=times[j]-.18)&(times<=times[j]-.035))[0]
            post = np.where((times>=times[j]+.035)&(times<=times[j]+.20))[0]
            if len(pre)<2 or len(post)<2:
                continue
            if np.max(np.diff(times[pre[0]:post[-1]+1]))>.12:
                continue
            incoming = float(np.polyfit(times[pre]-times[j],xy[pre]@axis,1)[0]/tw)
            outgoing = float(np.polyfit(times[post]-times[j],xy[post]@axis,1)[0]/tw)
            toward = incoming>0 if first['half']=='near' else incoming<0
            absorbed = abs(outgoing)<=.4*abs(incoming)
            reversed_ = incoming*outgoing<0
            if toward and abs(incoming)>=.25 and (absorbed or reversed_):
                motion.append(dict(t=float(times[j]),v=float(uv[j,1]),u=float(uv[j,0]),
                                   in_wps=incoming,out_wps=outgoing,
                                   absorbed=bool(absorbed),reversed=bool(reversed_)))
        # Preserve the reviewed ordering: select closest motion, THEN apply
        # the slower-reversal guard at proposal time. Do not search for a
        # different eligible motion after this one is rejected.
        net = min(motion,key=lambda m:abs(m['v']-V.L_M/2)) if motion else None
        candidate = dict(first=first['t'],last=chain[-1]['t'],n_bounces=len(chain),
                         half=first['half'],bounces=chain,arcs=arcs,net_motion=net)
        if candidates and candidate['first']<candidates[-1]['last']-.02:
            continue
        candidates.append(candidate)
    return candidates


def _eligible(sequence):
    m = sequence.get('net_motion')
    return bool(sequence['n_bounces']>=2 and m and
                (m['absorbed'] or (m['reversed'] and abs(m['out_wps'])<abs(m['in_wps']))))


def _proposal(card, sequences, crossings, serves):
    """Frozen first-proposal selection, including split candidates as vetoes."""
    for seq in sequences:
        if not (card['t0']<=seq['first'] and seq['last']<=card['t1'] and _eligible(seq)):
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
            return dict(kind='split',sequence=seq,confirmed=confirmed,end=end)
        return dict(kind='ending',sequence=seq,confirmed=confirmed,end=end)
    return None


def refine_endings(cards, sequences, crossings, serves):
    """Shorten approved terminal tails only; never change starts/count/joins."""
    crossings, serves = _event_times(crossings), _event_times(serves)
    out = []; trimmed = 0; split_vetoes = 0
    for card in cards:
        p = _proposal(card,sequences,crossings,serves)
        if p and p['kind']=='split':
            split_vetoes += 1
        if not p or p['kind']!='ending' or p['end']-card['t0']<V.MIN_CARD_S:
            out.append(dict(card)); continue
        seq = p['sequence']
        c = dict(card,t1=p['end'])
        # Retain the previous observed-end metadata where still inside the
        # clip; shortening a tail must not introduce a new earlier UI stop.
        if c.get('end_evidence_s') is not None:
            c['end_evidence_s'] = min(c['end_evidence_s'],p['end'])
        c['net_ending'] = dict(method_version=METHOD_VERSION,first=seq['first'],
                               confirmed=p['confirmed'],original_t1=card['t1'])
        out.append(c); trimmed += 1
    return out,dict(method_version=METHOD_VERSION,trimmed=trimmed,
                    split_proposals_preserved=split_vetoes)


def predict_winner(card,sequences,crossings,serves):
    """Independent research prediction; never receive or change a user score.

    A terminal-event hypothesis is retained even when it cannot represent
    one point, so private evaluation can separate detector and card errors.
    """
    crossings, serves = _event_times(crossings), _event_times(serves)
    result = dict(method='net_low_bounces',method_version=METHOD_VERSION,
                  status='abstained',winner_side=None,reason='no_terminal_net_sequence',
                  evaluated_t0=float(card['t0']),evaluated_t1=float(card['t1']),evidence={})
    p = _proposal(card,sequences,crossings,serves)
    if not p or p['kind']!='ending':
        return result
    seq = p['sequence']; net = seq['net_motion']; confirmed = p['confirmed']
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


def process_cards(cards,evidence,corners,width,serves):
    """Optional postprocessing fails open without replacing body assembly."""
    try:
        track = getattr(evidence,'track',None)
        if not track or not corners:
            reason = 'ball_track_unavailable' if not track else 'calibration_unavailable'
            predictions = [dict(predict_winner(c,[],[],[]),reason=reason) for c in cards]
            return [dict(c) for c in cards],predictions,dict(status='unavailable',reason=reason,trimmed=0)
        cross = list(evidence.cross)
        sequences = extract_sequences(track,corners,evidence.fps,width,cross)
        predictions = [predict_winner(c,sequences,cross,serves) for c in cards]
        out,info = refine_endings(cards,sequences,cross,serves)
        return out,predictions,dict(info,status='used')
    except Exception as exc:
        predictions = [dict(predict_winner(c,[],[],[]),status='error',
                            reason='net_evidence_error',evidence={'error_type':type(exc).__name__}) for c in cards]
        return [dict(c) for c in cards],predictions,dict(status='error',reason='net_evidence_error',trimmed=0)


def finalize_prediction(prediction,index,t0,t1):
    """Freeze final serialized bounds separately from the analyzed context."""
    import copy
    if prediction is None:
        prediction = dict(method='net_low_bounces',method_version=METHOD_VERSION,
                          status='abstained',winner_side=None,reason='pipeline_not_supported',
                          evaluated_t0=t0,evaluated_t1=t1,evidence={})
    row = copy.deepcopy(prediction)
    row['evidence'].update(analysis_t0=row['evaluated_t0'],analysis_t1=row['evaluated_t1'])
    row.update(idx=int(index),evaluated_t0=round(float(t0),2),evaluated_t1=round(float(t1),2))
    return row

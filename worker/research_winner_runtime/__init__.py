"""Offline copied-worker winner scorer, contract version 1.

No file/network access, fitting, owner outcomes or implicit model selection.
Caller supplies machine-only upstream contacts and rule decisions; see README.
"""
import math
from collections.abc import Mapping
import numpy as np
from . import contact, flight, trajectory, history

CONTRACT = 'copied-worker-winner-v1'
EVENT_FIELDS = ('kind', 't', 'side', 'x', 'y', 'u', 'v', 'visual_confidence')
CORNERS = ('A_near_1', 'B_near_2', 'C_far_2', 'D_far_1')


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError('Expected finite machine numeric input')
    return float(value)


def normalize_input(row):
    """Copy an explicit allowlist; validate units and preserve chronological order.

    Track x/y are fractions of source width/height; event x/y are source pixels.
    Event u/v retain physical table metres (1.525 x 2.74), never unit-square UV.
    Times are seconds on one original source clock. No retiming or sorting.
    """
    f = row['features']
    clean = {k: _number(f[k]) for k in ('start', 'end', 'width', 'height', 'fps')}
    if clean['end'] <= clean['start'] or min(clean[k] for k in ('width', 'height', 'fps')) <= 0:
        raise ValueError('Invalid point extent or source dimensions')
    clean['track'] = []
    if not isinstance(f['track'], (list, tuple)):
        raise ValueError('Track must be an array of observations')
    for observation in f['track']:
        if len(observation) < 3:
            raise ValueError('Track observation requires time and normalized x/y')
        p = [_number(v) for v in observation[:4]]
        if not (0 <= p[1] <= 1 and 0 <= p[2] <= 1):
            raise ValueError('Track coordinates must be normalized source coordinates')
        if not clean['start'] <= p[0] <= clean['end']:
            raise ValueError('Track time outside source point window')
        if clean['track'] and p[0] <= clean['track'][-1][0]:
            raise ValueError('Track times must be unique and chronological')
        clean['track'].append(p)
    def events(values):
        if not isinstance(values, (list, tuple)):
            raise ValueError('Machine events must be an array')
        result = []
        for value in values:
            if not isinstance(value, Mapping):
                raise ValueError('Machine event must be an object')
            e = {k: value.get(k) for k in EVENT_FIELDS}
            if e['kind'] not in ('bounce', 'contact') or e['side'] not in (None, 'near', 'far'):
                raise ValueError('Unknown machine event kind or camera side')
            for k in ('t', 'x', 'y'):
                e[k] = _number(e[k])
            for k in ('u', 'v', 'visual_confidence'):
                if e[k] is not None:
                    e[k] = _number(e[k])
            if not clean['start'] <= e['t'] <= clean['end']:
                raise ValueError('Event time outside source point window')
            if result and e['t'] < result[-1]['t']:
                raise ValueError('Events must retain chronological order')
            result.append(e)
        return result
    clean['candidates'] = events(f['candidates'])
    corners = {k: [_number(v) for v in row['corners'][k]] for k in CORNERS}
    if any(len(v) != 2 for v in corners.values()):
        raise ValueError('Corners require source pixel x/y')
    if contact.geometry(corners) is None:
        raise ValueError('Degenerate table geometry')
    contact.homography(corners)
    contacts = events(row['contacts'])
    if any(event['kind'] != 'contact' for event in contacts):
        raise ValueError('Contact input must contain paddle-contact events only')
    return dict(features=clean, corners=corners, contacts=contacts,
                serve_s=None if row.get('serve_s') is None else _number(row['serve_s']))


def predict_score(values, model):
    """Frozen logistic inference with imputation plus missing-value indicators."""
    x = np.asarray(values, float)
    p = model['preprocess']
    med = np.asarray(p['medians'], float)
    means = np.asarray(p['means'], float)
    scales = np.asarray(p['scales'], float)
    if x.ndim != 1 or x.shape != med.shape or means.shape != (2 * len(x),) or scales.shape != means.shape:
        raise ValueError('Model feature dimensions do not match contract')
    if not all(np.isfinite(a).all() for a in (med, means, scales)) or (scales <= 0).any():
        raise ValueError('Invalid model preprocessing')
    missing = ~np.isfinite(x)
    z = (np.r_[np.where(missing, med, x), missing.astype(float)] - means) / scales
    if 'constant' in model:
        q = _number(model['constant'])
        if not 0 <= q <= 1:
            raise ValueError('Invalid model constant')
        return q
    coefficients = np.asarray(model['coefficients'], float)
    if coefficients.shape != z.shape or not np.isfinite(coefficients).all():
        raise ValueError('Invalid model coefficients')
    logit = float(z @ coefficients + _number(model['intercept']))
    return 1 / (1 + math.exp(-logit)) if logit >= 0 else math.exp(logit) / (1 + math.exp(logit))


def validate_artifact(artifact, *, allow_evaluation=False):
    if artifact.get('purpose') == 'held_recording_evaluation' and not allow_evaluation:
        raise ValueError('Held-recording model is an evaluation fixture, not an unseen-recording model')
    if artifact.get('purpose') not in ('held_recording_evaluation', 'unseen_recording_research'):
        raise ValueError('Model purpose must be explicit')
    if artifact.get('contract') != CONTRACT or not artifact.get('provenance'):
        raise ValueError('Model contract and provenance are required')
    if artifact.get('pose') != 'none':
        raise ValueError('This runtime contract does not support pose')
    for name, size in (('contact_model', 21), ('winner_model', 66)):
        predict_score([None] * size, artifact[name])
    predict_score([None] * 19, artifact['outgoing']['model'])
    for threshold in (artifact['selection']['threshold'], artifact['outgoing']['selection']['threshold']):
        if threshold is not None and not 0 <= _number(threshold) <= 1.000001:
            raise ValueError('Invalid frozen threshold')
    return artifact


def combine(existing_net=None, outgoing=None, legacy=None, new_net_association=None, hybrid=None):
    for branch, winner in (('existing_net', existing_net), ('outgoing', outgoing),
                           ('legacy', legacy), ('new_net_association', new_net_association), ('hybrid', hybrid)):
        if winner not in (None, 'near', 'far'):
            raise ValueError('Winner must be a camera side or explicit abstention')
        if winner is not None:
            return winner, branch
    return None, 'abstain'


def score_point(row, artifact, baseline, *, allow_evaluation=False):
    """Run real feature extraction and inference against explicit upstream evidence.

    baseline contains existing_net, legacy, new_net_association, net_veto and
    provenance. It never contains a precomputed outgoing or hybrid decision.
    Empty/invalid required input abstains; malformed model artifacts raise.
    """
    result = dict(contract=CONTRACT, winner=None, branch='abstain', abstention_reason=None,
                  score_kind='uncalibrated model score; not final-winner probability')
    needed = ('existing_net', 'legacy', 'new_net_association', 'net_veto', 'provenance')
    if not isinstance(baseline, Mapping) or any(k not in baseline for k in needed) or not baseline.get('provenance'):
        return dict(result, abstention_reason='upstream_baseline_unavailable')
    if not isinstance(baseline['net_veto'], bool):
        return dict(result, abstention_reason='invalid_upstream_baseline')
    try:
        combine(**{k: baseline[k] for k in ('existing_net', 'legacy', 'new_net_association')})
        r = normalize_input(row)
    except (KeyError, TypeError, ValueError, np.linalg.LinAlgError):
        return dict(result, abstention_reason='invalid_machine_input')
    if not r['features']['track']:
        return dict(result, abstention_reason='no_ball_observations')
    validate_artifact(artifact, allow_evaluation=allow_evaluation)
    events = [contact.event_features(r, b) for b in r['features']['candidates'] if b['kind'] == 'bounce']
    cq = [predict_score(e['features'], artifact['contact_model']) for e in events]
    reference, base = contact.sequence_features(r, events, [q >= .1 for q in cq])
    path = trajectory.reconstruct(r)
    h = history.summarize(history.decode(history.build_nodes(r, path, None)))
    features = (base or [None] * 54) + [v * (1 if reference == 'near' else -1) for v in h['features']]
    q = predict_score(features, artifact['winner_model']) if reference else None
    confidence = max(q, 1-q) if q is not None else None
    threshold = artifact['selection']['threshold']
    winner = (reference if q >= .5 else contact.opp(reference)) if reference else None
    hybrid = winner if confidence is not None and threshold is not None and confidence >= threshold else None
    ex = flight.extract(r['features'], r['corners'], r['contacts'], r['serve_s'])
    eligible = ex['eligible'] and baseline['existing_net'] is None and not baseline['net_veto']
    outq = predict_score(ex['features'], artifact['outgoing']['model']) if eligible else None
    outt = artifact['outgoing']['selection']['threshold']
    out = ex['receiver'] if outq is not None and outt is not None and outq >= outt else None
    final, branch = combine(baseline['existing_net'], out, baseline['legacy'], baseline['new_net_association'], hybrid)
    result.update(winner=final, branch=branch,
                  abstention_reason=None if final else 'no_reference' if reference is None else 'below_frozen_thresholds',
                  reference=reference, features=features, raw_score=q, decision_score=confidence,
                  threshold=threshold, hybrid_winner=hybrid, contact_scores=cq,
                  outgoing=dict(winner=out, raw_score=outq, threshold=outt, extraction=ex),
                  history=h, path=path, provenance=dict(model=artifact['provenance'],
                  model_purpose=artifact['purpose'], upstream=baseline['provenance'], pose='none'))
    return result

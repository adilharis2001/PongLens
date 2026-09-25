"""Offline copied-point orchestration with independent scoring/export windows.

process_copied_point never trims observations for a start proposal. It scores
original machine evidence, then reports a separate export boundary. No live
worker, database, detector, frame-map, publication or release integration.
"""
from collections.abc import Mapping
from math import isfinite
from numbers import Real

from numpy.linalg import LinAlgError
from research_contact_recovery import recover_contacts
from research_serve_start import correct_start
from research_winner_baseline import decide
from research_winner_runtime import normalize_input, score_point

CONTRACT = 'offline-copied-point-v1'


def _nonnegative(value, name):
    if isinstance(value, bool) or not isinstance(value, Real) or not isfinite(value) or value < 0:
        raise ValueError(f'{name} must be finite nonnegative seconds')
    return float(value)


def _export_inputs(bounds, padding, start, end):
    if not isinstance(bounds, Mapping) or not isinstance(padding, Mapping):
        raise ValueError('Original export bounds and padding must be objects')
    try:
        lo = _nonnegative(bounds['start'], 'export start')
        hi = _nonnegative(bounds['end'], 'export end')
        pre = _nonnegative(padding['pre'], 'pre padding')
        post = _nonnegative(padding['post'], 'post padding')
    except KeyError as error:
        raise ValueError('Original export start/end and pre/post padding are required') from error
    if not lo <= start < end <= hi:
        raise ValueError('Original export bounds must contain the structural window')
    # Original media/segment bounds may have clipped some configured padding.
    if start - lo > pre + 1e-8 or hi - end > post + 1e-8:
        raise ValueError('Original export bounds exceed the supplied padding')
    return lo, hi, pre, post


def process_copied_point(row, artifact, corpus, *, proposal=None,
                         export_bounds, padding, allow_evaluation=False):
    """Return separate scoring_decision/scoring_window and export_window.

    row contains ORIGINAL features/corners/serve_s in source seconds, normalized
    track positions, and source-pixel machine candidates. Supplied contacts,
    identities and owner metadata are ignored; contacts are recovered afresh.
    corpus is complete-recording machine net/crossing context. artifact is the
    explicit frozen runtime model; held-recording fixtures require opt-in.

    proposal is optional {start, pair}, where pair has first, monotonicity and
    between_machine_contacts. Its guard uses original recovered contact times
    and original machine serve_s. Missing/bad pair evidence preserves the start.
    export_bounds supplies the ORIGINAL padded {start,end}; padding supplies
    ORIGINAL {pre,post}. Clipped padding is allowed. Invalid bounds/padding or
    an accepted start at/after the original end raise ValueError, not a score.
    All inputs are copied/allowlisted. No corrected start enters the scorer.
    """
    try:
        if not isinstance(row, Mapping):
            raise ValueError('Original machine input must be an object')
        clean = normalize_input(dict(features=row['features'], corners=row['corners'],
                                     serve_s=row.get('serve_s'), contacts=[]))
        placement = row['features'].get('placement_available', True)
        if not isinstance(placement, bool):
            raise ValueError('Invalid machine placement availability')
    except (KeyError, TypeError, AttributeError, ValueError, LinAlgError) as error:
        raise ValueError('Invalid original machine input') from error
    f = clean['features']
    start = _nonnegative(f['start'], 'original structural start')
    end = _nonnegative(f['end'], 'original structural end')
    lo, hi, pre, post = _export_inputs(export_bounds, padding, start, end)
    if proposal is not None and not isinstance(proposal, Mapping):
        raise ValueError('Start proposal must be an object or absent')
    f['placement_available'] = placement
    clean['contacts'] = recover_contacts(f, clean['corners'])
    proposed = proposal.get('start') if proposal is not None else start
    pair = proposal.get('pair') if proposal is not None else None
    correction = correct_start(start, proposed, pair,
                               [c['t'] for c in clean['contacts']], clean['serve_s'])
    export_start = float(correction['start'])
    if not start <= export_start < end:
        raise ValueError('Accepted export structural start must precede the original end')

    # These calls receive only the unchanged original structural window/evidence.
    baseline = decide(clean, corpus)
    decision = score_point(clean, artifact, baseline, allow_evaluation=allow_evaluation)
    return dict(contract=CONTRACT,
                scoring_window=dict(start=start, end=end),
                scoring_decision=decision,
                export_window=dict(start=max(lo, export_start - pre), end=hi,
                                   structural_start=export_start, structural_end=end,
                                   pre=pre, post=post),
                export_reasons=list(correction['reasons']))

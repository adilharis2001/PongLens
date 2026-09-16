"""Conservative, opt-in whole-export cleanup; never feeds the rally assembler.

The filtered track is a second opinion used only to veto wholly unsupported
exports. Original evidence remains authoritative for every retained boundary.
"""
import math

METHOD_VERSION = 'whole-clip-cleanup-v1'


def _distance(point, quad):
    x, y = point
    signs, distances = [], []
    for a, b in zip(quad, quad[1:] + quad[:1]):
        dx, dy = b[0]-a[0], b[1]-a[1]
        signs.append(dx*(y-a[1])-dy*(x-a[0]))
        t = max(0, min(1, ((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy or 1)))
        distances.append(math.hypot(x-a[0]-t*dx, y-a[1]-t*dy))
    if all(v >= 0 for v in signs) or all(v <= 0 for v in signs):
        return 0.
    return min(distances)


def filter_track(track, fps, quad):
    """Frozen reviewed tracklet rule; returns a new mapping, never edits input."""
    width = math.dist(quad[0], quad[1])
    if fps <= 0 or width <= 0 or not all(math.isfinite(v) for p in quad for v in p):
        raise ValueError('invalid table or frame rate')
    groups = []
    for frame, point in sorted(track.items()):
        if not all(math.isfinite(v) for v in (frame, *point)):
            raise ValueError('invalid track observation')
        previous = groups[-1][-1] if groups else None
        dt = (frame/fps - previous[0]/fps) if previous else None
        if (previous is None or dt <= 0 or dt > .15 or
                math.dist(point, previous[1]) > 16.3*width*dt):
            groups.append([])
        groups[-1].append((frame, point))
    return {f: p for group in groups
            if any(_distance(p, quad) <= .35*width for _, p in group)
            for f, p in group}


def retained_indices(*, points, segments, raw_events, clean_events, serves):
    """Select whole components, preserving every point if inputs are incomplete."""
    keep_all = list(range(len(points)))
    try:
        times = [*raw_events, *clean_events, *serves]
        if not all(math.isfinite(float(t)) for t in times):
            return keep_all
        if any(not all(math.isfinite(float(p[k])) for k in ('t0', 't1')) or
               p['t1'] <= p['t0'] for p in points):
            return keep_all
        if any(not (math.isfinite(a) and math.isfinite(b) and b > a)
               for a, b in segments):
            return keep_all
        if any(left[1] >= right[0] for left, right in zip(segments, segments[1:])):
            return keep_all
        # Missing, partial or ambiguous component membership must never drop a card.
        members = [[i for i, p in enumerate(points) if a <= p['t0'] < p['t1'] <= b]
                   for a, b in segments]
        flattened = [i for group in members for i in group]
        if sorted(flattened) != keep_all:
            return keep_all
        removed = set()
        for group in members:
            if not group:
                continue
            unsupported = True
            for i in group:
                p = points[i]
                lo, hi = p['t0'], p['t1']
                if (p.get('serve_s') is not None or
                    any(lo-1.6 <= t <= hi for t in serves) or
                    any(lo-.03 <= t <= hi+.03 for t in clean_events) or
                    not any(lo <= t <= hi for t in raw_events)):
                    unsupported = False
                    break
            if unsupported:
                removed.update(group)
        return [i for i in keep_all if i not in removed]
    except (TypeError, ValueError, KeyError, OverflowError):
        return keep_all


def process_cards(cards, segments, evidence, corners, width, players, v3_serves):
    """Second opinion after final assembly; exporter reindexes retained cards."""
    import time
    started = time.monotonic()
    info = dict(method_version=METHOD_VERSION, status='not_applied', removed_cards=0)
    if evidence is None or corners is None or v3_serves is None:
        return cards, dict(info, reason='required_evidence_unavailable')
    try:
        import points_v2
        import serve_v3
        quad = [list(corners[k]) for k in sorted(corners)]
        if len(quad) != 4:
            raise ValueError('invalid table')
        track = filter_track(evidence.track, evidence.fps, quad)
        clean = points_v2.Evidence({}, corners, None, evidence.fps,
                                   evidence.duration, width, track=track)
        clean_v3 = serve_v3.detect(corners, clean.track, clean.cross, players,
                                   evidence.fps, evidence.duration, width=width)
        # Compare exactly the serialized clocks used in the owner review.
        events = lambda e: [round(float(t), 2) for t in [*e.cross, *e.bt_table]]
        serves = [round(float(t), 2) for t in [*evidence.serves, *clean.serves,
                  *v3_serves, *(s[0] for s in clean_v3['serves'])]]
        windows = [dict(t0=round(int(c['t0']*evidence.fps)/evidence.fps,2),
                        t1=round(int(c['t1']*evidence.fps)/evidence.fps,2),
                        serve_s=c.get('serve_s')) for c in cards]
        segments = [[round(a,2), round(b,2)] for a,b in segments]
        indices = retained_indices(points=windows, segments=segments,
                                   raw_events=events(evidence), clean_events=events(clean),
                                   serves=serves)
        if not indices:
            return cards, dict(info, reason='would_remove_every_card')
        removed = [i for i in range(len(cards)) if i not in indices]
        return [cards[i] for i in indices], dict(info, status='used',
            removed_cards=len(removed), removed_windows=[windows[i] for i in removed],
            retained_track_points=len(track), original_track_points=len(evidence.track),
            seconds=round(time.monotonic()-started,3))
    except Exception as exc:
        return cards, dict(info, status='error', reason=type(exc).__name__,
                           seconds=round(time.monotonic()-started,3))

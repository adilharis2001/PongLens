"""Dataset contract for the local active-ball pilot. Coordinates are source pixels."""
import math


def validate_dataset(rows, allow_shared_venues=False):
    ids, matches, venues, recordings = set(), {}, {}, {}
    for r in rows:
        if r['id'] in ids:
            raise ValueError('duplicate sample id')
        ids.add(r['id'])
        split = r['split']
        if split not in ('train', 'validation', 'test'):
            raise ValueError('invalid split')
        digest=r.get('source_sha256')
        if digest:
            if digest in recordings and recordings[digest] != split:
                raise ValueError('recording leaks between splits')
            recordings[digest]=split
        mappings = [('match_id', matches)]
        if not allow_shared_venues:
            mappings.append(('venue', venues))
        for key, mapping in mappings:
            value = r[key]
            if not value:
                raise ValueError(f'missing {key}')
            if value in mapping and mapping[value] != split:
                raise ValueError(f'{key} leaks between splits')
            mapping[value] = split
        w, h = r['width'], r['height']
        if w <= 0 or h <= 0 or r['frame'] < 0 or not math.isfinite(r['time_s']) or r['time_s'] < 0:
            raise ValueError('invalid source dimensions or time')
        label = r.get('label')
        if label is None:
            continue
        state = label['state']
        if state not in ('visible', 'hidden', 'absent', 'unsure'):
            raise ValueError('invalid visibility state')
        x, y = label.get('x'), label.get('y')
        if state == 'visible':
            if not all(isinstance(n, (int, float)) and not isinstance(n, bool) and math.isfinite(n) for n in (x, y)) or not (0 <= x < w and 0 <= y < h):
                raise ValueError('visible coordinates outside source frame')
        elif x is not None or y is not None:
            raise ValueError('non-visible label cannot carry coordinates')
    return rows


def training_rows(rows):
    validate_dataset(rows)
    return [r for r in rows if r['split'] == 'train' and r.get('label')
            and r['label'].get('provenance') == 'human'
            and r['label']['state'] != 'unsure']

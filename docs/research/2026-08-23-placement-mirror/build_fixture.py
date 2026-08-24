"""Rebuild src/lib/placement/fixtures/table-orientation.json.

Real corner pixels and real bounces from two matches, each bounce carrying
BOTH its pixel position and its table coordinate, so a test can work out
from the picture which side of the table a ball is on. Bounces within 25 cm
of the centre line are dropped: one 2 cm from the middle tests rounding.

Inputs are the two matches' match.json, pulled from R2.
"""
import json, os, sys

W = 1.525
SRC = sys.argv[1] if len(sys.argv) > 1 else "."
out = {"note": "...", "matches": []}
for name, mid, cam in (
    ('chris',  'ec6490f4-b835-4d82-882a-8fb2f1abc2e5', 'side camera, near end at image-left'),
    ('julian', '7e02fbb9-a3af-4686-84bc-d4b961ab9fed', 'side camera, near end at image-right')):
    m = json.load(open(f'{SRC}/{name}.json'))
    C = m['calibration']['table_corners_px']
    bounces = []
    for p in m['points']:
        pl = p.get('placement')
        if not pl or pl.get('v') != 3:
            continue
        for c in pl.get('candidates') or []:
            if c.get('kind') != 'bounce':
                continue
            u, v, x, y = c.get('u'), c.get('v'), c.get('x'), c.get('y')
            if None in (u, v, x, y) or abs(u - W / 2) < 0.25:
                continue
            if not (0 <= u <= W and 0 <= v <= 2.74):
                continue
            bounces.append({"u": round(u, 4), "v": round(v, 4),
                            "x": round(x, 2), "y": round(y, 2)})
    step = max(1, len(bounces) // 80)
    out["matches"].append({
        "id": name, "matchId": mid, "camera": cam,
        "corners": {k: [round(v[0], 2), round(v[1], 2)] for k, v in C.items()},
        "bounces": bounces[::step][:80],
    })
json.dump(out, sys.stdout, indent=1)

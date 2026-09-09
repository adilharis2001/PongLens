"""Apply once no bodyfirst run is in flight (bodyfeat's cache key is its own text):
two more ball columns (on-table bounce tempo, half alternation) and a veto that
can use the alternation."""
import os
L = "/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad/poseretest"
p = f"{L}/bodyfeat.py"; s = open(p).read()
old = '''def ball_crossings(m):'''
new = '''def ball_bounces_on(m):
    """[(t, v)] on-table bounces, v metres along the table (net at L/2)."""
    p = f"{HERE}/ballx_{m}.json"
    if not os.path.exists(p):
        return np.zeros((0, 2))
    b = json.load(open(p)).get("bounces_on") or []
    return np.asarray(sorted(b), float).reshape(-1, 2)


def ball_crossings(m):'''
assert s.count(old) == 1; s = s.replace(old, new)
old = '''        add("ball_since_cross", since)
        add("ball_tempo3", tempo)
'''
new = '''        add("ball_since_cross", since)
        add("ball_tempo3", tempo)
        # On-table bounces in the last 3 s, and how many times they changed
        # halves. A lob rally the net detector misses (the ball crosses high)
        # still bounces near, far, near; pre-serve knocking stays on one half.
        bo = ball_bounces_on(m)
        btempo = np.zeros(len(T)); alt = np.zeros(len(T))
        if len(bo):
            bt = bo[:, 0]; half = np.sign(bo[:, 1] - 1.37)
            hi = np.searchsorted(bt, T, side="right"); lo = np.searchsorted(bt, T - 3.0, side="right")
            btempo = (hi - lo).astype(float)
            changes = np.concatenate([[0.0], (half[1:] != half[:-1]).astype(float)])
            cs = np.concatenate([[0.0], np.cumsum(changes)])
            alt = cs[hi] - cs[lo]
        add("ball_bounce_tempo3", btempo)
        add("ball_alt3", alt)
'''
assert s.count(old) == 1; s = s.replace(old, new); open(p, "w").write(s)
p = f"{L}/bodyfirst.py"; s = open(p).read()
old = '''    ball_floor=0.0, ball_floor_tempo=2.0,
'''
new = '''    ball_floor=0.0, ball_floor_tempo=2.0,
    ball_floor_alt=0.0,                    # >0: the floor also holds while table bounces alternate halves this often in 3 s
'''
assert s.count(old) == 1; s = s.replace(old, new)
old = '''        if c["ball_floor"] > 0 and "ball_tempo3" in names:
            tempo = X[:, names.index("ball_tempo3")]
            p = np.where(tempo >= c["ball_floor_tempo"], np.maximum(p, c["ball_floor"]), p)
'''
new = '''        if c["ball_floor"] > 0 and "ball_tempo3" in names:
            alive = X[:, names.index("ball_tempo3")] >= c["ball_floor_tempo"]
            if c["ball_floor_alt"] > 0 and "ball_alt3" in names:
                alive = alive | (X[:, names.index("ball_alt3")] >= c["ball_floor_alt"])
            p = np.where(alive, np.maximum(p, c["ball_floor"]), p)
'''
assert s.count(old) == 1; s = s.replace(old, new); open(p, "w").write(s)
import ast; ast.parse(open(f"{L}/bodyfeat.py").read()); ast.parse(open(f"{L}/bodyfirst.py").read())
print("ball2 patches applied, syntax ok")

"""Points from the two bodies, with the ball switched off entirely.

    python bodyfirst.py <run> <match> [<match> ...] [--holdout a,b] [--fam base,zone,...]
                        [--dump] [--set key=value ...]

The ball pipeline finds a point by finding its serve. This finds a point the
way a person watching from the side does: the two players are at their ends,
they are busy, and they are busy IN TURN. Then it stops when they stop.

Two things separate this from the body fallback that already exists:

  1. A POINT HAS A LENGTH. Measured over the corpus's 687 scored points, a
     point runs 6.2 s from the serve to the winner's press, and 90% of them
     are between 3.4 and 12.5 s. That is a far tighter distribution than any
     per-frame signal, and it is the same at every venue. Reading the frames
     one at a time and smoothing throws it away; carrying it as a duration
     prior through the decode is what stops two points being glued into a
     thirteen-second one, and what stops a two-second twitch becoming a card.

  2. WHAT IT LOOKS AT. Busy-ness alone cannot tell a rally from a player
     walking back with the ball. A rally has a BEAT and the players take
     TURNS, and both of them are standing at their own end while it happens.
     See bodyfeat.py for the families.

The decode is a hidden semi-Markov model: the match is a chain of alternating
PLAY and GAP stretches, each stretch scored by its frames' log-odds plus how
likely a stretch of that length is. Viterbi over stretches, not frames.
"""
import hashlib, json, os, sys
import numpy as np
import bodyfeat

HERE = os.path.dirname(os.path.abspath(__file__))

# Log-normal fits to the corpus's own 687 points and 672 gaps.
CFG = dict(
    play_mu=1.846, play_sd=0.382,          # median 6.3 s
    gap_mu=1.435, gap_sd=0.876,            # median 4.2 s, long tail
    play_min=2.5, play_max=26.0,
    gap_min=0.6, gap_max=150.0,
    dur_w=1.0,                             # how hard the length prior pushes
    obs_w=1.0,                             # ...against the frames themselves
    bias=0.0,                              # + makes PLAY cheaper everywhere
    l2=1e-3, iters=500, lr=0.5,
    on_w=0.0, off_w=0.0,                   # how much a boundary's own look counts
    edge_tol=0.4,                          # a frame this close to a real boundary IS one
    edge_far=1.5,                          # ...and one this far away is certainly not
    adapt=0.0,                             # 0 off; 1 fully re-centre the priors on this match
    adapt_max=0.4,                         # ...but never by more than this in log space (x1.5)
    adapt_min_segs=15,
    snap_on=0.0, snap_off=0.0,             # seconds: pull a boundary to its own best moment
    knots=0,                               # >0: bend each feature at this many quantiles
    calib=0.0,                             # 1: put this match's confidence on the training scale
    knockup=0.0,                           # MEASURED DEAD -- see drop_knockup
    knockup_gap=1.5,                       # a gap this long is the space between two points
    knockup_max_s=360.0,                   # ...and the knock-up cannot run past this
    knockup_ratio=1.5,                     # ...and must be busier than the match that follows

    pad0=0.4, pad1=0.8,                    # a card opens a little before and shuts after
    # THE BALL AS A VETO ON ENDING. While the ball is crossing the net at rally
    # tempo (>= ball_floor_tempo crossings in the last 3 s) the play reading
    # cannot fall below ball_floor, so the decoder cannot end the point. A
    # learned weight on the same columns moved the ends only a little
    # (2026-09-08): the body features that say "player deep behind the
    # table" outweigh two ball columns in a linear model. 0 = off.
    ball_floor=0.0, ball_floor_tempo=2.0,
    ball_floor_alt=0.0,                    # >0: the floor also holds while table bounces alternate halves this often in 3 s
)


def _cfg(over):
    c = dict(CFG)
    for kv in over:
        k, v = kv.split("=", 1)
        c[k] = float(v) if k not in ("fam",) else v
    return c


def labels(T, m, run):
    """PLAY / DEAD / unknown per frame, from the scorekeeper's own cards."""
    rows = json.load(open(f"/tmp/v3exp/{run}/{m}/compare.json"))["rows"]
    pts = sorted((r["prod_t0"], r.get("tap") or r["prod_t1"], r["prod_t1"])
                 for r in rows if r.get("kind") == "point")
    dele = [(r["prod_t0"], r["prod_t1"]) for r in rows
            if r.get("kind") == "junk" and r.get("prod_t0") is not None]
    y = np.full(len(T), -1)
    for i, t in enumerate(T):
        if t < 3 or t > T[-1] - 3: continue
        if any(a <= t <= b for a, b in dele): continue
        if any(t0 + 1.0 <= t <= min(tap, t1) - 0.5 for t0, tap, t1 in pts): y[i] = 1
        elif not any(t0 - 1.0 <= t <= t1 + 1.0 for t0, tap, t1 in pts): y[i] = 0
    return y, pts


def _bend(X, knots):
    """Let each feature bend. A straight line through stance width says wider
    is always more like a rally; what is actually true is that a stance goes on
    widening up to a point and then the reading is just a bad box. Adding
    max(0, x - k) at a few of the feature's own quantiles lets the fit change
    slope there without any of the machinery of a tree, and the knots come from
    the TRAINING matches only, so nothing about the test match reaches it."""
    if knots is None: return X
    cols = [X]
    for j, ks in enumerate(knots):
        for k in ks:
            cols.append(np.maximum(0.0, X[:, j] - k))
    return np.column_stack(cols)


def fit(X, y, c):
    nk = int(c.get("knots", 0))
    knots = None
    if nk > 0:
        qs = np.linspace(0, 100, nk + 2)[1:-1]
        knots = [np.unique(np.nanpercentile(X[:, j], qs)) for j in range(X.shape[1])]
    Xb = _bend(X, knots)
    mu = np.nanmean(Xb, axis=0); sd = np.nanstd(Xb, axis=0) + 1e-6
    Z = np.nan_to_num((Xb - mu) / sd); Z = np.column_stack([Z, np.ones(len(Z))])
    w = np.zeros(Z.shape[1])
    for _ in range(int(c["iters"])):
        p = 1 / (1 + np.exp(-Z @ w))
        w -= c["lr"] * (Z.T @ (p - y) / len(y) + c["l2"] * w)
    return (w, knots), mu, sd


def predict(X, w, mu, sd):
    w, knots = w if isinstance(w, tuple) else (w, None)
    Z = np.nan_to_num((_bend(X, knots) - mu) / sd); Z = np.column_stack([Z, np.ones(len(Z))])
    return 1 / (1 + np.exp(-Z @ w))


def edge_features(T, X):
    """The same look at the bodies, plus HOW IT IS CHANGING across the moment.

    A boundary is not a state, it is a change: before a serve both players are
    settled and still, a second later they are not; at the end of a point the
    two of them stop together. A frame on its own cannot show that, so each
    frame is given the difference across it at half a second and at a second
    and a half."""
    dt = float(np.median(np.diff(T)))
    cols = [X]
    for lag in (0.5, 1.5):
        k = max(1, int(round(lag / dt)))
        fwd = np.vstack([X[k:], np.repeat(X[-1:], k, axis=0)])
        bwd = np.vstack([np.repeat(X[:1], k, axis=0), X[:-k]])
        cols.append(fwd - bwd)
    return np.column_stack(cols)


def edge_labels(T, pts, which, c):
    """1 at a real boundary, 0 well away from any, -1 in between."""
    ts = [(q[0] if which == "on" else min(q[1], q[2])) for q in pts]
    y = np.full(len(T), -1)
    for i, t in enumerate(T):
        d = min((abs(t - x) for x in ts), default=1e9)
        if d <= c["edge_tol"]: y[i] = 1
        elif d >= c["edge_far"]: y[i] = 0
    return y


def _edgekey(m, others, c, run):
    """A boundary model is settled by: whose frames trained it, what counted as
    a boundary, and the two files that built the features. Anything else moving
    would be a different model wearing the same cache entry."""
    # Only the code that BUILDS the model, not this whole file: keyed on the
    # file, every edit to the decoder throws away every boundary model and a
    # sweep pays for them all again.
    import inspect
    src = hashlib.sha1(
        (hashlib.sha1(open(bodyfeat.__file__, "rb").read()).hexdigest()
         + "".join(inspect.getsource(f) for f in (edge_features, edge_labels, fit, predict))
         ).encode()).hexdigest()[:12]
    key = json.dumps([m, sorted(others), run, c["edge_tol"], c["edge_far"],
                      c["l2"], c["iters"], c["lr"], src], sort_keys=True)
    return hashlib.sha1(key.encode()).hexdigest()[:16]


def edge_logodds(m, others, data, c, run):
    """Per-frame log-odds that a point STARTS / ENDS at each moment, from a pair
    of models trained on the other matches. Cached, because a sweep over the
    decoder's knobs re-fits the identical pair every time otherwise."""
    cp = f"/tmp/v3exp/bodyedge/{_edgekey(m, others, c, run)}.npz"
    if os.path.exists(cp):
        d = np.load(cp); return d["on"], d["off"]
    T, X = data[m][0], data[m][1]
    Xe = edge_features(T, X)
    Xe_tr = {k: edge_features(data[k][0], data[k][1]) for k in others}
    out = {}
    for kind in ("on", "off"):
        ye = {k: edge_labels(data[k][0], data[k][3], kind, c) for k in others}
        Xt = np.vstack([Xe_tr[k][ye[k] >= 0] for k in others])
        yt = np.concatenate([ye[k][ye[k] >= 0] for k in others])
        we, mue, sde = fit(Xt, yt, c)
        q = np.clip(predict(Xe, we, mue, sde), 1e-6, 1 - 1e-6)
        out[kind] = np.log(q / (1 - q))
    os.makedirs("/tmp/v3exp/bodyedge", exist_ok=True)
    # np.savez APPENDS .npz when the name does not already end in it, so a
    # temp file called <name>.npz.<pid> is written as <name>.npz.<pid>.npz and
    # the rename that follows looks for a file that was never created.
    tmp = f"{cp[:-4]}.{os.getpid()}.npz"
    np.savez(tmp, on=out["on"], off=out["off"]); os.replace(tmp, cp)
    return out["on"], out["off"]


def _logdur(n_frames, dt, mu, sd, lo, hi, w):
    """log density of a stretch of this many frames, as a lookup over 1..hi."""
    d = np.arange(1, n_frames + 1) * dt
    out = np.full(n_frames, -1e9)
    ok = (d >= lo) & (d <= hi)
    z = (np.log(np.maximum(d, 1e-6)) - mu) / sd
    out[ok] = (-0.5 * z * z - np.log(np.maximum(d, 1e-6)) - np.log(sd))[ok]
    return w * out


def calibrate(p, ref):
    """Put one match's confidence on the same scale as the matches that trained
    the model.

    The decoder compares a stretch's log-odds against a length prior, so what
    counts is the SIZE of the log-odds, not just their order. A model trained on
    six venues and applied to a seventh can be right about which moments are
    rallies and still read them all at 0.6 instead of 0.9 -- a booth is lit
    differently, the far player is smaller, the boxes are noisier. The decoder
    then finds fewer points everywhere, and the failure looks like a bad model
    rather than a bad scale. Matching the middle and the spread of this match's
    log-odds to the training matches' own is a monotone rescaling: it cannot
    change which moment looks more like a rally than which, and it uses no
    label from the match it is applied to."""
    ell = np.log(np.clip(p, 1e-6, 1 - 1e-6) / np.clip(1 - p, 1e-6, 1 - 1e-6))
    med = np.median(ell); iqr = np.subtract(*np.percentile(ell, [75, 25])) or 1.0
    out = (ell - med) / iqr * ref[1] + ref[0]
    return 1 / (1 + np.exp(-out))


def decode(T, p, c, on=None, off=None):
    """The best alternating chain of PLAY and GAP stretches over the match.

    `on` and `off` are per-frame log-odds that a point STARTS / ENDS there. A
    play stretch is paid for its frames, for being a plausible length, and for
    opening and closing where the bodies say a point opens and closes."""
    n = len(T); dt = float(np.median(np.diff(T)))
    ell = c["obs_w"] * np.log(np.clip(p, 1e-6, 1 - 1e-6) / np.clip(1 - p, 1e-6, 1 - 1e-6)) + c["bias"]
    S = np.concatenate([[0.0], np.cumsum(ell)])
    maxP = min(n, int(round(c["play_max"] / dt))); minP = max(1, int(round(c["play_min"] / dt)))
    maxG = min(n, int(round(c["gap_max"] / dt))); minG = max(1, int(round(c["gap_min"] / dt)))
    lp = _logdur(maxP, dt, c["play_mu"], c["play_sd"], c["play_min"], c["play_max"], c["dur_w"])
    lg = _logdur(maxG, dt, c["gap_mu"], c["gap_sd"], c["gap_min"], c["gap_max"], c["dur_w"])
    NEG = -1e18
    # best[s][j]: best score for frames 0..j-1 ending with a finished stretch of state s
    best = [np.full(n + 1, NEG), np.full(n + 1, NEG)]
    back = [np.full(n + 1, -1, dtype=np.int32), np.full(n + 1, -1, dtype=np.int32)]
    # j OUTER, state INNER: a stretch ending at j is built on a stretch of the
    # OTHER state ending at i < j, so both states have to be finished for every
    # earlier frame before either is asked for at this one. Walking the states
    # on the outside leaves the first of them reading an empty table, and the
    # whole decode comes back with no segments at all.
    for j in range(1, n + 1):
        for s, (mn, mx, ld) in enumerate(((minG, maxG, lg), (minP, maxP, lp))):
            i_lo = max(0, j - mx); i_hi = j - mn
            if i_hi < i_lo: continue
            idx = np.arange(i_lo, i_hi + 1)
            obs = (S[j] - S[idx]) if s == 1 else 0.0
            if s == 1:
                if on is not None and c["on_w"]: obs = obs + c["on_w"] * on[idx]
                if off is not None and c["off_w"]: obs = obs + c["off_w"] * off[min(j, n) - 1]
            prev = best[1 - s][idx].copy()
            prev[idx == 0] = 0.0                            # the match may begin here
            cand = prev + obs + ld[j - idx - 1]
            k = int(np.argmax(cand))
            if cand[k] > NEG / 2:
                best[s][j] = cand[k]; back[s][j] = int(idx[k])
    # walk back from whichever state ends the match better
    s = int(best[1][n] > best[0][n])
    if best[s][n] <= NEG / 2: return []
    segs = []; j = n
    while j > 0:
        i = int(back[s][j])
        if i < 0: break
        if s == 1: segs.append((float(T[i]), float(T[min(j, n) - 1])))
        j = i; s = 1 - s
    return sorted(segs)


def decode_adaptive(T, p, c, on=None, off=None):
    """Decode twice: once with the corpus's own lengths, then again with this
    MATCH's lengths.

    A point is six seconds everywhere, but the space between two points is not:
    at a PingPod booth the players stay at the table and serve again inside two
    seconds, and in a club hall somebody walks to the barrier for the ball. A
    single gap prior fitted across both is too long for one and too short for
    the other, and a gap prior that is too long is exactly what glues two points
    into one card. The first pass is only there to measure this match; the
    second is the one that counts. Nothing outside the match is used, so this
    stays honest on a match nobody has seen."""
    segs = decode(T, p, c, on, off)
    if c["adapt"] <= 0 or len(segs) < c["adapt_min_segs"]:
        return segs
    pl = np.log([max(b - a, 0.5) for a, b in segs])
    gp = np.log([max(segs[i + 1][0] - segs[i][1], 0.3) for i in range(len(segs) - 1)])
    c2 = dict(c)
    for key, obs in (("play_mu", pl), ("gap_mu", gp)):
        want = float(np.median(obs))
        shift = np.clip(want - c[key], -c["adapt_max"], c["adapt_max"])
        c2[key] = c[key] + c["adapt"] * shift
    return decode(T, p, c2, on, off)


def drop_knockup(segs, c, duration):
    """The knock-up is play with no points in it.

    Before a match starts the two of them hit the ball back and forth without
    scoring, and every body signal reads that as play, because it IS play. What
    it does not have is POINTS: no serve, no winner, no walking to fetch, so no
    gaps. The decoder, told a point lasts six seconds, chops the knock-up into
    six-second pieces butted end to end -- and on the corpus 50 of the 83
    segments that hold no point are exactly that, sitting before the first one.

    So the match starts at the first segment after which the spaces between
    segments start looking like the spaces between points. Two guards, both
    learned from the ball version of this rule nearly shipping broken: it can
    never reach past knockup_max_s, and what it drops must be denser in
    segments than what it keeps, so a match that simply opens at speed keeps
    its first points.

    MEASURED DEAD, and worth keeping for the reason. It removed 1 stray segment
    of 48 and cost 6 real points. Looking at what is actually there: on four of
    the nine matches Adil starts scoring three minutes in (Louis 220 s, Rob
    215 s, Koko 2 196 s, Terry 2 192 s), and what runs before that is not a
    knock-up at all -- it is practice POINTS, with gaps of 1.3 to 5.7 s, the
    same shape as the scored ones. There is nothing in the bodies to find,
    because there is nothing different happening. The 48 segments are real
    table tennis the owner chose not to score, and the honest way to report
    them is separately from the ones inside the match, which number 27 against
    the ball pipeline's 34."""
    if c["knockup"] <= 0 or len(segs) < 8:
        return segs
    gaps = [segs[i + 1][0] - segs[i][1] for i in range(len(segs) - 1)]
    start = 0
    for i in range(len(gaps)):
        nxt = gaps[i:i + 5]
        if len(nxt) >= 3 and sum(1 for g in nxt if g >= c["knockup_gap"]) >= len(nxt) - 1:
            start = i
            break
    if start == 0:
        return segs
    cut = segs[start][0]
    if cut > c["knockup_max_s"]:
        return segs
    rest = max(duration - cut, 1e-6)
    r_in = start / max(cut / 60.0, 1e-6)
    r_out = (len(segs) - start) / (rest / 60.0)
    if r_out > 0 and r_in / r_out < c["knockup_ratio"]:
        return segs
    return segs[start:]


def snap_edges(T, segs, c, on=None, off=None):
    """Put each boundary where the boundary model says it is.

    Measured on Rowel against Adil's own serve taps, the onset model finds the
    serve to 0.84 s at the 90th percentile -- better than production's own
    ball-based card start -- while the finished segmentation's opening wanders
    by 2.0 s. So the model knows and the decode is not listening: inside the
    decode a boundary's own look competes with a whole stretch of frames and
    loses. Reading it once more at the end, over a window narrow enough that a
    segment cannot swallow its neighbour, is what turns the better estimate
    into a better card."""
    if not segs or (c["snap_on"] <= 0 and c["snap_off"] <= 0):
        return segs
    out = []
    for k, (a, b) in enumerate(segs):
        lo_gap = a - (segs[k - 1][1] if k else -1e9)
        hi_gap = (segs[k + 1][0] if k + 1 < len(segs) else 1e9) - b
        if on is not None and c["snap_on"] > 0:
            w = min(c["snap_on"], max(0.0, lo_gap - 0.3), max(0.0, (b - a) / 3.0))
            sel = (T >= a - w) & (T <= a + w)
            if sel.sum() >= 3: a = float(T[sel][int(np.argmax(on[sel]))])
        if off is not None and c["snap_off"] > 0:
            w = min(c["snap_off"], max(0.0, hi_gap - 0.3), max(0.0, (b - a) / 3.0))
            sel = (T >= b - w) & (T <= b + w)
            if sel.sum() >= 3: b = float(T[sel][int(np.argmax(off[sel]))])
        if b > a: out.append((a, b))
    return out


def cards(T, p, c):
    return [dict(t0=max(0.0, a - c["pad0"]), t1=b + c["pad1"], serve_s=None,
                 why="bodies", end_evidence_s=b) for a, b in decode(T, p, c)]


def score(pts, segs):
    """found / fused / split / stray, the way pose_play.py counted them."""
    def covers(seg, pt):
        t0, tap, t1 = pt; a, b = seg
        return a <= min(tap, t1) and b >= t0 + 1.0
    found = sum(1 for q in pts if any(covers(s, q) for s in segs))
    fused = sum(1 for s in segs if sum(1 for q in pts if covers(s, q)) >= 2)
    split = sum(1 for q in pts if sum(1 for s in segs if covers(s, q)) >= 2)
    stray = sum(1 for s in segs if not any(s[0] <= q[2] and s[1] >= q[0] for q in pts))
    # POINTS caught in a shared segment, not the segments themselves: the ruler
    # counts what the owner has to do, and every point in a glued card is one
    # more split for them.
    fused_pts = sum(1 for q in pts
                    if any(sum(1 for r in pts if covers(s, r)) >= 2 for s in segs if covers(s, q)))
    clean = sum(1 for q in pts
                if sum(1 for s in segs if covers(s, q)) == 1
                and sum(1 for r in pts if covers(next(s for s in segs if covers(s, q)), r)) == 1)
    d0, d1 = [], []
    for q in pts:
        cov = [s for s in segs if covers(s, q)]
        if len(cov) == 1: d0.append(cov[0][0] - q[0]); d1.append(cov[0][1] - min(q[1], q[2]))
    # ADIL'S RULER: a point with no card is the expensive failure, everything
    # else is a keystroke or two. Same weights as the ball pipeline's edit cost,
    # so a body number and a ball number can be put side by side.
    cost = 5 * (len(pts) - found) + 2 * fused_pts + split + stray
    return dict(points=len(pts), found=found, clean=clean, fused=fused, fused_pts=fused_pts,
                split=split, stray=stray, segs=len(segs), cost=cost,
                d0=float(np.median(d0)) if d0 else float("nan"),
                d1=float(np.median(d1)) if d1 else float("nan"),
                d0p90=float(np.percentile(np.abs(d0), 90)) if d0 else float("nan"),
                d1p90=float(np.percentile(np.abs(d1), 90)) if d1 else float("nan"))


def main():
    run = sys.argv[1]
    args = sys.argv[2:]
    fam = bodyfeat.FAMILIES
    if "--fam" in args: fam = tuple(args[args.index("--fam") + 1].split(","))
    hold = set()
    if "--holdout" in args: hold = {x for x in args[args.index("--holdout") + 1].split(",") if x}
    over = [args[i + 1] for i, a in enumerate(args) if a == "--set"]
    c = _cfg(over)
    skip = set()
    for i, a in enumerate(args):
        if a.startswith("--") and i + 1 < len(args) and not args[i + 1].startswith("--"): skip.add(i + 1)
    MS = [a for i, a in enumerate(args) if not a.startswith("--") and i not in skip]
    data = {}
    for m in MS:
        T, X, names = bodyfeat.features(m, fam)
        y, pts = labels(T, m, run)
        data[m] = (T, X, y, pts)
    tot = dict(points=0, found=0, clean=0, fused=0, fused_pts=0, split=0, stray=0, segs=0, cost=0)
    print(f"features: {len(names)} in {','.join(fam)}")
    print(f"{'match':10s} {'points':>6s} {'found':>6s} {'clean':>6s} {'fusedP':>6s} {'split':>6s} "
          f"{'stray':>6s} {'segs':>5s} {'cost':>5s}  {'start':>6s} {'end':>6s}   {'acc':>4s} {'auc':>5s}")
    rows = {}
    for m in MS:
        T, X, y, pts = data[m]
        others = [k for k in MS if k != m and k not in hold]
        Xtr = np.vstack([data[k][1][data[k][2] >= 0] for k in others])
        ytr = np.concatenate([data[k][2][data[k][2] >= 0] for k in others])
        w, mu, sd = fit(Xtr, ytr, c)
        p = predict(X, w, mu, sd)
        if c["ball_floor"] > 0 and "ball_tempo3" in names:
            alive = X[:, names.index("ball_tempo3")] >= c["ball_floor_tempo"]
            if c["ball_floor_alt"] > 0 and "ball_alt3" in names:
                alive = alive | (X[:, names.index("ball_alt3")] >= c["ball_floor_alt"])
            p = np.where(alive, np.maximum(p, c["ball_floor"]), p)
        if c["calib"] > 0:
            ptr = np.concatenate([predict(data[k][1], w, mu, sd) for k in others])
            etr = np.log(np.clip(ptr, 1e-6, 1 - 1e-6) / np.clip(1 - ptr, 1e-6, 1 - 1e-6))
            ref = (float(np.median(etr)), float(np.subtract(*np.percentile(etr, [75, 25])) or 1.0))
            p = calibrate(p, ref)
        lab = y >= 0
        acc = float(np.mean((p[lab] > 0.5) == (y[lab] == 1)))
        pos, neg = p[y == 1], p[y == 0]
        auc = float(np.mean([np.mean(pos > v) for v in neg])) if len(pos) and len(neg) else float("nan")
        on = off = None
        if c["on_w"] or c["off_w"] or c["snap_on"] or c["snap_off"]:
            on, off = edge_logodds(m, others, data, c, run)
        segs = snap_edges(T, decode_adaptive(T, p, c, on, off), c, on, off)
        segs = drop_knockup(segs, c, float(T[-1]))
        s = score(pts, segs); s["acc"] = acc; s["auc"] = auc; rows[m] = s
        if "--dump" in args:
            os.makedirs(f"{HERE}/bodyfirst", exist_ok=True)
            np.savez(f"{HERE}/bodyfirst/bf_{m}.npz", T=T, p=p,
                     segs=np.array(segs, dtype=float).reshape(-1, 2),
                     train=np.array(sorted(others)))
        tag = "  HELD OUT" if m in hold else ""
        print(f"{m:10s} {s['points']:6d} {s['found']:6d} {s['clean']:6d} {s['fused_pts']:6d} {s['split']:6d} "
              f"{s['stray']:6d} {s['segs']:5d} {s['cost']:5d}  {s['d0']:+6.1f} {s['d1']:+6.1f}   {acc*100:4.0f} {auc:5.2f}{tag}")
        if m not in hold:
            for k in tot: tot[k] += s[k]
    print(f"{'TOTAL':10s} {tot['points']:6d} {tot['found']:6d} {tot['clean']:6d} {tot['fused_pts']:6d} "
          f"{tot['split']:6d} {tot['stray']:6d} {tot['segs']:5d} {tot['cost']:5d}")
    json.dump({m: rows[m] for m in MS}, open(f"/tmp/v3exp/bodyfirst_{run}.json", "w"), indent=1)


if __name__ == "__main__":
    main()

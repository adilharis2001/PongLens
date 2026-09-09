"""Points from the players: the body-first card assembler.

Production port of the lab's `bodyfirst.py` (model and decoder) and of the
confirm-mode refinements in `sweep_dead._bf_refine` (scratchpad/poseretest,
2026-09-08). Spec: docs/superpowers/specs/2026-09-08-body-first-points-worker-design.md.

    cards = assemble(players, corners_px, evidence, first_ball_card_t0, duration)

`players` is the dict `extract_players_rtmpose.py` wrote, `corners_px` the
table calibration (None when there is no table), `evidence` the ball side's
`points_v2.Evidence` (or None), and the result is a list of cards in the
shape `cmd_points` already consumes: t0, t1, serve_s, why, end_evidence_s.

The model is FROZEN in `body_model/<version>/`: `model.npz` (logistic weights
over the feature columns, their means and spreads, the settings), `edge.npz`
(the onset and ending boundary models), and `features.sha`, the hash of
`body_features.py` at training time. `load_model` refuses a hash that does
not match the code it is running with: a model that reads different columns
than it was trained on fails silently otherwise.

Everything the decoder does is deterministic; there is no fitting at run
time. Fitting lives in `train()` at the bottom and is only ever called by the
freeze script in the research record.
"""
from __future__ import annotations

import json
import os

import numpy as np

import body_features as BF
import points_v2 as V2

HERE = os.path.dirname(os.path.abspath(__file__))


def _current_version() -> str:
    """Which frozen model runs: the environment, else the one line in
    body_model/CURRENT, else v1. A file rather than code so a new freeze can
    be switched in between two jobs without restarting the worker (the
    points child imports this module fresh on every run)."""
    v = os.environ.get("PONGLENS_BODY_MODEL")
    if v:
        return v
    try:
        with open(os.path.join(HERE, "body_model", "CURRENT")) as fh:
            v = fh.read().strip()
            if v:
                return v
    except OSError:
        pass
    return "v1"


MODEL_VERSION = _current_version()
MODEL_DIR = os.path.join(HERE, "body_model", MODEL_VERSION)

# ---------------------------------------------------------------------------
# settings, the lab's CFG with the shipped overrides applied
# ---------------------------------------------------------------------------
CFG = dict(
    # log-normal fits to the corpus's own 687 points and 672 gaps
    play_mu=1.846, play_sd=0.382,          # median 6.3 s
    gap_mu=1.435, gap_sd=0.876,            # median 4.2 s, long tail
    play_min=1.5, play_max=26.0,           # play_min loosened 2.5 -> 1.5 (2026-09-08)
    gap_min=0.6, gap_max=150.0,
    dur_w=4.0,                             # the length prior, loosened 8 -> 4
    obs_w=1.0,
    bias=0.5,                              # PLAY made cheaper everywhere, 0 -> 0.5
    l2=1e-3, iters=500, lr=0.5,
    edge_tol=0.4, edge_far=1.5,
    snap_on=1.0, snap_off=0.0,             # pull a start to the onset model's best moment
    # THE BALL AS A VETO ON ENDING: while >= ball_floor_tempo crossings fell in
    # the last 3 s the play reading cannot drop below ball_floor.
    ball_floor=0.6, ball_floor_tempo=3.0,
    pad0=0.4, pad1=0.8,                    # a card opens a little before and shuts after
)
FAMILIES = BF.DEPLOYED_FAMILIES

# The ball's statements about a body stretch (sweep_dead._bf_refine, the four
# that survived measurement; switches hard-wired to the shipped values).
SERVE_STAMP = True          # stamp the first serve inside a card
SPLIT_S = 6.0               # two serves this far apart inside one card is two points
EXTEND_GAP_S = 1.2          # keep an end open while ball events keep coming this close
EXTEND_PMIN = 0.3           # ...and the play reading stays at least this
END_PAD_S = 0.8             # seconds after the last event the extension keeps
QUIET_RULE = True           # drop a card with no crossing and no table bounce inside it
AFTER_FIRST = True          # no body card before the ball pipeline's first card

# Guards. Each falls open to the ball cards, with its reason in the note.
MIN_BOTH_PLAYERS_SHARE = 0.40   # frames with both players / sampled frames


class BodyPointsUnavailable(Exception):
    """The body assembler declined; the caller keeps the ball cards."""


# ---------------------------------------------------------------------------
# model
# ---------------------------------------------------------------------------
def _bend(X, knots):
    if knots is None:
        return X
    cols = [X]
    for j, ks in enumerate(knots):
        for k in ks:
            cols.append(np.maximum(0.0, X[:, j] - k))
    return np.column_stack(cols)


def predict(X, w, mu, sd, knots=None):
    Z = np.nan_to_num((_bend(X, knots) - mu) / sd)
    Z = np.column_stack([Z, np.ones(len(Z))])
    return 1 / (1 + np.exp(-Z @ w))


def load_model(model_dir=MODEL_DIR):
    """The frozen weights, checked against the feature code."""
    sha = open(os.path.join(model_dir, "features.sha")).read().strip()
    if sha != BF.CODE_SHA:
        raise BodyPointsUnavailable(
            f"body model {os.path.basename(model_dir)} was trained on feature code "
            f"{sha}, this worker runs {BF.CODE_SHA}")
    m = np.load(os.path.join(model_dir, "model.npz"), allow_pickle=True)
    e = np.load(os.path.join(model_dir, "edge.npz"), allow_pickle=True)
    names = [str(x) for x in m["names"]]
    cfg = json.loads(str(m["cfg"]))
    return dict(
        names=names, cfg=cfg, families=tuple(str(x) for x in m["families"]),
        w=m["w"], mu=m["mu"], sd=m["sd"],
        on=(e["on_w"], e["on_mu"], e["on_sd"]), off=(e["off_w"], e["off_mu"], e["off_sd"]),
        version=os.path.basename(model_dir), sha=sha)


# ---------------------------------------------------------------------------
# the decoder (bodyfirst.py, verbatim in behaviour)
# ---------------------------------------------------------------------------
def _logdur(n_frames, dt, mu, sd, lo, hi, w):
    d = np.arange(1, n_frames + 1) * dt
    out = np.full(n_frames, -1e9)
    ok = (d >= lo) & (d <= hi)
    z = (np.log(np.maximum(d, 1e-6)) - mu) / sd
    out[ok] = (-0.5 * z * z - np.log(np.maximum(d, 1e-6)) - np.log(sd))[ok]
    return w * out


def decode(T, p, c):
    """The best alternating chain of PLAY and GAP stretches over the match."""
    n = len(T); dt = float(np.median(np.diff(T)))
    ell = c["obs_w"] * np.log(np.clip(p, 1e-6, 1 - 1e-6) / np.clip(1 - p, 1e-6, 1 - 1e-6)) + c["bias"]
    S = np.concatenate([[0.0], np.cumsum(ell)])
    maxP = min(n, int(round(c["play_max"] / dt))); minP = max(1, int(round(c["play_min"] / dt)))
    maxG = min(n, int(round(c["gap_max"] / dt))); minG = max(1, int(round(c["gap_min"] / dt)))
    lp = _logdur(maxP, dt, c["play_mu"], c["play_sd"], c["play_min"], c["play_max"], c["dur_w"])
    lg = _logdur(maxG, dt, c["gap_mu"], c["gap_sd"], c["gap_min"], c["gap_max"], c["dur_w"])
    NEG = -1e18
    best = [np.full(n + 1, NEG), np.full(n + 1, NEG)]
    back = [np.full(n + 1, -1, dtype=np.int32), np.full(n + 1, -1, dtype=np.int32)]
    # j OUTER, state INNER: a stretch ending at j is built on a stretch of the
    # other state ending at i < j, so both states must be finished for every
    # earlier frame before either is asked for at this one.
    for j in range(1, n + 1):
        for s, (mn, mx, ld) in enumerate(((minG, maxG, lg), (minP, maxP, lp))):
            i_lo = max(0, j - mx); i_hi = j - mn
            if i_hi < i_lo:
                continue
            idx = np.arange(i_lo, i_hi + 1)
            obs = (S[j] - S[idx]) if s == 1 else 0.0
            prev = best[1 - s][idx].copy()
            prev[idx == 0] = 0.0
            cand = prev + obs + ld[j - idx - 1]
            k = int(np.argmax(cand))
            if cand[k] > NEG / 2:
                best[s][j] = cand[k]; back[s][j] = int(idx[k])
    s = int(best[1][n] > best[0][n])
    if best[s][n] <= NEG / 2:
        return []
    segs = []; j = n
    while j > 0:
        i = int(back[s][j])
        if i < 0:
            break
        if s == 1:
            segs.append((float(T[i]), float(T[min(j, n) - 1])))
        j = i; s = 1 - s
    return sorted(segs)


def edge_features(T, X):
    """The same look at the bodies, plus how it is changing across the moment."""
    dt = float(np.median(np.diff(T)))
    cols = [X]
    for lag in (0.5, 1.5):
        k = max(1, int(round(lag / dt)))
        fwd = np.vstack([X[k:], np.repeat(X[-1:], k, axis=0)])
        bwd = np.vstack([np.repeat(X[:1], k, axis=0), X[:-k]])
        cols.append(fwd - bwd)
    return np.column_stack(cols)


def edge_logodds(T, X, model):
    Xe = edge_features(T, X)
    out = {}
    for kind in ("on", "off"):
        w, mu, sd = model[kind]
        q = np.clip(predict(Xe, w, mu, sd), 1e-6, 1 - 1e-6)
        out[kind] = np.log(q / (1 - q))
    return out["on"], out["off"]


def snap_edges(T, segs, c, on=None, off=None):
    """Put each boundary where the boundary model says it is, within a window
    narrow enough that a segment cannot swallow its neighbour."""
    if not segs or (c["snap_on"] <= 0 and c["snap_off"] <= 0):
        return segs
    out = []
    for k, (a, b) in enumerate(segs):
        lo_gap = a - (segs[k - 1][1] if k else -1e9)
        hi_gap = (segs[k + 1][0] if k + 1 < len(segs) else 1e9) - b
        if on is not None and c["snap_on"] > 0:
            w = min(c["snap_on"], max(0.0, lo_gap - 0.3), max(0.0, (b - a) / 3.0))
            sel = (T >= a - w) & (T <= a + w)
            if sel.sum() >= 3:
                a = float(T[sel][int(np.argmax(on[sel]))])
        if off is not None and c["snap_off"] > 0:
            w = min(c["snap_off"], max(0.0, hi_gap - 0.3), max(0.0, (b - a) / 3.0))
            sel = (T >= b - w) & (T <= b + w)
            if sel.sum() >= 3:
                b = float(T[sel][int(np.argmax(off[sel]))])
        if b > a:
            out.append((a, b))
    return out


# ---------------------------------------------------------------------------
# reading a match
# ---------------------------------------------------------------------------
def read_players(players):
    """(T, raw, share_both): the samples, the per-side frames, and the share
    of samples with both players present."""
    T, raw = BF.load_players(players)
    if len(T) < 20:
        raise BodyPointsUnavailable(f"only {len(T)} pose samples")
    both = sum(1 for a, b in zip(raw["near"], raw["far"]) if a is not None and b is not None)
    return T, raw, both / len(T)


def play_probability(T, raw, corners, crossings, model):
    """Per-sample play reading from the frozen model, with the ball floor."""
    c = model["cfg"]
    X, names, _fams = BF.features(T, raw, corners, crossings=crossings, families=model["families"])
    if names != model["names"]:
        raise BodyPointsUnavailable("feature columns differ from the frozen model's")
    p = predict(X, model["w"], model["mu"], model["sd"])
    if c["ball_floor"] > 0 and "ball_tempo3" in names:
        alive = X[:, names.index("ball_tempo3")] >= c["ball_floor_tempo"]
        p = np.where(alive, np.maximum(p, c["ball_floor"]), p)
    return p, X


def segments(T, p, X, model):
    c = model["cfg"]
    on, off = edge_logodds(T, X, model)
    return snap_edges(T, decode(T, p, c), c, on, off)


def _pmin(T, p, a, b):
    i0, i1 = np.searchsorted(T, a), np.searchsorted(T, b)
    return float(p[i0:i1].min()) if i1 > i0 else 1.0


def refine(cards, T, p, duration, cross, bt_table, serves, first_ball_t0=None):
    """What the ball has to say about a stretch the bodies found: four
    statements, none of which may invent a card."""
    cr = np.asarray(sorted(float(x) for x in cross), float)
    bt = np.asarray(sorted(float(x) for x in bt_table), float)
    sv = sorted(float(x) for x in serves)
    out = []
    cards = sorted(cards, key=lambda c: c["t0"])
    for ci, c in enumerate(cards):
        t0, t1 = c["t0"], c["t1"]
        nxt_t0 = cards[ci + 1]["t0"] if ci + 1 < len(cards) else float(duration)
        inside = [x for x in sv if t0 <= x <= t1]
        if QUIET_RULE:
            seen = len(cr[(cr >= t0) & (cr <= t1)]) + len(bt[(bt >= t0) & (bt <= t1)])
            if not seen:
                continue
        cuts = []
        if SPLIT_S > 0 and len(inside) >= 2:
            last = inside[0]
            for x in inside[1:]:
                if x - last >= SPLIT_S:
                    cuts.append(x)
                last = x
        parts, a = [], t0
        for x in cuts:
            b = max(a + V2.MIN_CARD_S, x - V2.HEAD_LEAD)
            if b >= t1:
                break
            parts.append((a, b))
            a = b + V2.MIN_GAP_S
        parts.append((a, t1))
        for a, b in parts:
            d = dict(c); d["t0"], d["t1"] = a, b
            if d.get("end_evidence_s") is not None and not (a <= d["end_evidence_s"] <= b):
                d["end_evidence_s"] = None
            ins = [x for x in sv if a <= x <= b]
            if SERVE_STAMP and ins:
                d["serve_s"] = ins[0]
                d["why"] = "bodies, serve seen"
            if EXTEND_GAP_S > 0:
                ev = sorted([float(x) for x in cr] + [float(x) for x in bt])
                end = d["t1"]
                cap = nxt_t0 - V2.MIN_DEAD_S
                nxt_sv = [x for x in sv if x > end]
                if nxt_sv:
                    cap = min(cap, nxt_sv[0] - V2.MIN_DEAD_S)
                j = int(np.searchsorted(ev, end, side="right"))
                if j > 0 and end - ev[j - 1] <= EXTEND_GAP_S:
                    t = ev[j - 1]
                    while (j < len(ev) and ev[j] - t <= EXTEND_GAP_S
                           and ev[j] + END_PAD_S <= cap):
                        if EXTEND_PMIN > 0 and _pmin(T, p, t, ev[j]) < EXTEND_PMIN:
                            break
                        t = ev[j]; j += 1
                    new_end = min(t + END_PAD_S, cap)
                    if new_end > d["t1"] + 0.05:
                        d["t1"] = new_end
                        d["end_evidence_s"] = t
                        d["why"] = d["why"] + ", end kept open by the ball"
            V2.clamp_evidence(d)
            if d["t1"] - d["t0"] >= V2.MIN_CARD_S:
                out.append(d)
    if AFTER_FIRST and first_ball_t0 is not None:
        out = [d for d in out if d["t1"] > first_ball_t0]
    return out


def assemble(players, corners_px, evidence, duration, first_ball_t0=None, model=None):
    """The body cards for one match, or raise BodyPointsUnavailable.

    Returns (cards, info): the resolved card list and a dict describing the
    run for the match note (samples, share of frames with both players,
    segments before and after the ball's refinements, model version)."""
    model = model or load_model()
    T, raw, share = read_players(players)
    if share < MIN_BOTH_PLAYERS_SHARE:
        raise BodyPointsUnavailable(
            f"both players seen in only {share:.0%} of samples")
    cross = evidence.cross if evidence is not None else np.zeros(0)
    bt_table = evidence.bt_table if evidence is not None else np.zeros(0)
    serves = evidence.serves if evidence is not None else []
    if corners_px is None:
        raise BodyPointsUnavailable("no table corners and no stand-in quad")
    p, X = play_probability(T, raw, corners_px, cross, model)
    segs = segments(T, p, X, model)
    if not segs:
        raise BodyPointsUnavailable("the decoder found no play at all")
    c = model["cfg"]
    cards = [dict(t0=max(0.0, a - c["pad0"]), t1=min(float(duration), b + c["pad1"]),
                  serve_s=None, why="bodies", end_evidence_s=b) for a, b in segs]
    refined = refine(cards, T, p, duration, cross, bt_table, serves, first_ball_t0)
    resolved = V2.resolve(refined)
    info = dict(samples=int(len(T)), both_share=round(share, 3), segments=len(segs),
                cards=len(resolved), stamped=sum(1 for d in resolved if d.get("serve_s") is not None),
                model=model["version"], features=model["sha"])
    return resolved, info


# ---------------------------------------------------------------------------
# training, used only by the freeze script (docs/research/.../scripts)
# ---------------------------------------------------------------------------
def fit(X, y, c):
    mu = np.nanmean(X, axis=0); sd = np.nanstd(X, axis=0) + 1e-6
    Z = np.nan_to_num((X - mu) / sd); Z = np.column_stack([Z, np.ones(len(Z))])
    w = np.zeros(Z.shape[1])
    for _ in range(int(c["iters"])):
        q = 1 / (1 + np.exp(-Z @ w))
        w -= c["lr"] * (Z.T @ (q - y) / len(y) + c["l2"] * w)
    return w, mu, sd


def edge_labels(T, pts, which, c):
    """1 at a real boundary, 0 well away from any, -1 in between.
    pts: [(t0, tap_or_t1, t1)] scored points."""
    ts = [(q[0] if which == "on" else min(q[1], q[2])) for q in pts]
    y = np.full(len(T), -1)
    for i, t in enumerate(T):
        d = min((abs(t - x) for x in ts), default=1e9)
        if d <= c["edge_tol"]: y[i] = 1
        elif d >= c["edge_far"]: y[i] = 0
    return y


def train(data, out_dir, c=CFG, families=FAMILIES):
    """Fit the play model and the two boundary models on every match given
    and write the frozen files. data: {m: (T, X, y, pts, names)} where y is
    the per-sample PLAY/DEAD/unknown label (1/0/-1)."""
    names = None
    for m, (T, X, y, pts, nm) in data.items():
        if names is None:
            names = list(nm)
        elif list(nm) != names:
            raise ValueError(f"{m}: feature names differ")
    Xtr = np.vstack([d[1][d[2] >= 0] for d in data.values()])
    ytr = np.concatenate([d[2][d[2] >= 0] for d in data.values()])
    w, mu, sd = fit(Xtr, ytr, c)
    edge = {}
    Xe = {m: edge_features(d[0], d[1]) for m, d in data.items()}
    for kind in ("on", "off"):
        ye = {m: edge_labels(d[0], d[3], kind, c) for m, d in data.items()}
        Xt = np.vstack([Xe[m][ye[m] >= 0] for m in data])
        yt = np.concatenate([ye[m][ye[m] >= 0] for m in data])
        edge[kind] = fit(Xt, yt, c)
    os.makedirs(out_dir, exist_ok=True)
    np.savez(os.path.join(out_dir, "model.npz"), w=w, mu=mu, sd=sd,
             names=np.array(names), families=np.array(list(families)),
             cfg=np.array(json.dumps(c)), trained_on=np.array(sorted(data)))
    np.savez(os.path.join(out_dir, "edge.npz"),
             on_w=edge["on"][0], on_mu=edge["on"][1], on_sd=edge["on"][2],
             off_w=edge["off"][0], off_mu=edge["off"][1], off_sd=edge["off"][2])
    with open(os.path.join(out_dir, "features.sha"), "w") as fh:
        fh.write(BF.CODE_SHA + "\n")
    return dict(names=names, cfg=c, families=tuple(families), w=w, mu=mu, sd=sd,
                on=edge["on"], off=edge["off"], version=os.path.basename(out_dir), sha=BF.CODE_SHA)

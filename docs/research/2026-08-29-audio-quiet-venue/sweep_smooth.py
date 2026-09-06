"""How long a window does the in-play score need before it stops flickering?

A rally lasts a few seconds and a gap a few tens of seconds, so a decision
taken every quarter second on a quarter second of evidence is far noisier
than the thing it is trying to describe. This sweeps the smoothing length
and reports the operating point that matters: with 99% of rally seconds
kept, how much gap goes.
"""
import os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acoustics as AC, corpus as CO, envelope as EN, inplay as IP
from eval_inplay import label_track, STEP_S

SLUGS = ["cebaa6d4", "c27e196d", "6e1b6ea6", "d59d7610", "9e15ed10"]

cache = {}
for slug in SLUGS:
    doc = CO.load(slug)
    samples, rate = AC.read_wav(doc["wav"])
    cache[slug] = (EN.envelopes(samples, rate), doc)
    print(f"loaded {slug}", flush=True)

def track(env, smooth):
    t, z = env["times"], env["high"]["z"]
    grid = np.arange(t[0] + smooth / 2, t[-1] - smooth / 2, STEP_S)
    idx = np.searchsorted(t, np.stack([grid - smooth / 2, grid + smooth / 2]))
    c = np.concatenate([[0.0], np.cumsum(z)])
    return grid, (c[idx[1]] - c[idx[0]]) / np.maximum(idx[1] - idx[0], 1)

print("\nsmoothing   AUC    gap dropped at 99% rally kept   at 97%   at 95%")
for smooth in (0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0, 8.0):
    S, L = [], []
    for slug in SLUGS:
        env, doc = cache[slug]
        grid, sc = track(env, smooth)
        lab, _ = label_track(doc, grid)
        S.append(sc[lab >= 0]); L.append(lab[lab >= 0])
    S = np.concatenate(S); L = np.concatenate(L)
    pos, neg = S[L == 1], S[L == 0]
    a = AC.auc(pos, neg)
    line = f"  {smooth:4.1f}s   {a:.3f}  "
    for target in (0.99, 0.97, 0.95):
        th = np.quantile(pos, 1 - target)
        line += f"   {np.mean(neg < th)*100:6.1f}%"
    print(line, flush=True)

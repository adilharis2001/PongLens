"""Is the ball in play right now? Judged against Adil's own taps.

`point_boundaries` holds, for six matches, the moment he pressed to mark a
serve and the moment he pressed to award the point. Between one point's
end and the next one's start, nobody at this table is rallying. That gives
labelled seconds without anyone watching a video: in-play windows and gap
windows, on the same clock as the audio.

Every window is described by how many loud knocks it holds, how loud, how
evenly spaced, and how much the knocks look like a repeating pattern
rather than scattered noise. Rate alone was measured at 1.2-1.6x between
the two classes and killed the last study. The claim being tested here is
that the STRUCTURE of the knocks separates them even when the count does
not.

Windows are shrunk half a second at each end because the taps themselves
are only good to about 0.7 s, and a window that straddles the boundary
would be labelled by a coin toss.
"""
import json, os, sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acoustics as AC
import corpus as CO
import envelope as EN

WIN_S = 1.5
HOP_S = 0.5
SHRINK_S = 0.5


def ioi_features(times, amps):
    """What the SPACING of the knocks looks like."""
    out = {"n": len(times), "ioi_med": np.nan, "ioi_cv": np.nan,
           "ioi_in_rally_band": 0.0, "amp_alt": np.nan}
    if len(times) < 3:
        return out
    d = np.diff(np.sort(times))
    d = d[d > 0.01]
    if len(d) < 2:
        return out
    out["ioi_med"] = float(np.median(d))
    out["ioi_cv"] = float(np.std(d) / max(np.mean(d), 1e-6))
    # a rally's knocks land 0.12-0.9 s apart; scattered room noise does not
    out["ioi_in_rally_band"] = float(np.mean((d >= 0.12) & (d <= 0.90)))
    if len(amps) >= 4:
        a = np.asarray(amps, float)
        # do loud and soft alternate, the way paddle and table do
        out["amp_alt"] = float(np.mean(np.sign(np.diff(a))[:-1]
                                       * np.sign(np.diff(a))[1:] < 0))
    return out


def periodicity(env, rate, hop=EN.HOP):
    """How much the onset curve repeats itself, at rally tempos."""
    x = env - env.mean()
    if len(x) < 8 or np.allclose(x, 0):
        return 0.0, np.nan
    ac = np.correlate(x, x, mode="full")[len(x) - 1:]
    if ac[0] <= 0:
        return 0.0, np.nan
    ac = ac / ac[0]
    lo = max(1, int(0.12 * rate / hop))
    hi = min(len(ac) - 1, int(0.90 * rate / hop))
    if hi <= lo:
        return 0.0, np.nan
    k = int(np.argmax(ac[lo:hi])) + lo
    return float(ac[k]), float(k * hop / rate)


def describe(env, t0, t1, thresholds=(4.0, 6.0, 8.0)):
    times, rate = env["times"], env["rate"]
    m = (times >= t0) & (times < t1)
    if m.sum() < 8:
        return None
    span = t1 - t0
    f = {}
    for name in ("ball", "high", "low"):
        z = env[name]["z"][m]
        f[f"{name}_max"] = float(np.max(z))
        f[f"{name}_p90"] = float(np.percentile(z, 90))
        f[f"{name}_mean"] = float(np.mean(z))
        for th in thresholds:
            idx = EN.peaks(z, rate, th)
            f[f"{name}_n{int(th)}"] = len(idx) / span
        idx = EN.peaks(z, rate, 5.0)
        tt = times[m][idx] if len(idx) else np.array([])
        aa = z[idx] if len(idx) else np.array([])
        for k, v in ioi_features(tt, aa).items():
            f[f"{name}_{k}"] = v
        p, lag = periodicity(z, rate)
        f[f"{name}_period"] = p
        f[f"{name}_lag"] = lag if np.isfinite(lag) else 0.0
    f["hi_lo_max"] = f["high_max"] - f["low_max"]
    f["ball_lo_max"] = f["ball_max"] - f["low_max"]
    return f


def windows_for(doc):
    """(t0, t1, label) on whichever clock the audio uses."""
    b = [x for x in doc["boundaries"] if not x.get("deleted")]
    key = ("start_cut_s", "end_cut_s") if doc["clock"] == "cut" else \
          ("start_source_s", "end_source_s")
    spans = [(float(x[key[0]]), float(x[key[1]])) for x in b
             if x.get(key[0]) is not None and x.get(key[1]) is not None]
    spans.sort()
    out = []
    for s, e in spans:
        t = s + SHRINK_S
        while t + WIN_S <= e - SHRINK_S:
            out.append((t, t + WIN_S, 1)); t += HOP_S
    for (s0, e0), (s1, e1) in zip(spans, spans[1:]):
        t = e0 + SHRINK_S
        while t + WIN_S <= s1 - SHRINK_S:
            out.append((t, t + WIN_S, 0)); t += HOP_S
    return out


def main():
    out_path = sys.argv[1]
    slugs = sys.argv[2:] or ["cebaa6d4", "c27e196d", "6e1b6ea6",
                             "d59d7610", "9e15ed10"]
    everything = []
    for slug in slugs:
        doc = CO.load(slug)
        if doc is None or not doc["wav"]:
            print(f"{slug}: no audio"); continue
        wins = windows_for(doc)
        if len(wins) < 40:
            print(f"{slug}: only {len(wins)} windows"); continue
        samples, rate = AC.read_wav(doc["wav"])
        print(f"{slug} {str(doc['match']['venue'])[:16]:16s} "
              f"{str(doc['match']['opponent_name'])[:10]:10s} "
              f"{len(samples)/rate:.0f}s audio ({doc['clock']} clock), "
              f"{len(wins)} windows…", flush=True)
        env = EN.envelopes(samples, rate)
        rows = []
        for t0, t1, label in wins:
            f = describe(env, t0, t1)
            if f is None:
                continue
            rows.append({"slug": slug, "venue": doc["match"]["venue"],
                         "t0": t0, "label": label, **f})
        keys = [k for k in rows[0] if k not in ("slug", "venue", "t0", "label")]
        pos = [r for r in rows if r["label"] == 1]
        neg = [r for r in rows if r["label"] == 0]
        scored = sorted(((AC.auc([r[k] for r in pos], [r[k] for r in neg]), k)
                         for k in keys), key=lambda kv: -abs(kv[0] - 0.5))
        print(f"   in-play {len(pos)}  gap {len(neg)}   best separators:")
        for a, k in scored[:8]:
            print(f"      {k:24s} AUC {a:.3f}   "
                  f"in-play med {np.median([r[k] for r in pos]):8.3f}   "
                  f"gap med {np.median([r[k] for r in neg]):8.3f}")
        everything.extend(rows)
        print(flush=True)
    json.dump(everything, open(out_path, "w"))
    print(f"{len(everything)} windows written to {out_path}")


if __name__ == "__main__":
    main()

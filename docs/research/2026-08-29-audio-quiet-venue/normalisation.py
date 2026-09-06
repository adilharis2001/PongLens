"""The 1.2-1.6x ratio, recomputed both ways on the same audio.

CLAUDE.md records, as a settled fact: "Between points the room is nearly
as loud as during them... with nobody at this table playing, the detector
still fires 2.1-4.0 impacts a second against 3.1-4.9 while the ball is in
play. A ratio of 1.2 to 1.6 is the whole explanation, and it does not
improve with a better detector."

That number was produced by a detector that scores each frame against the
median and spread of its own +/- 0.75 s neighbourhood. Half a second either
side of a ball strike, during a rally, is other ball strikes — so the
reference rises exactly where the signal does, and the strike is divided
by its own neighbours. In a genuinely quiet gap the reference collapses to
the room's hiss and any small sound clears the bar.

So the claim being checked is not about the room. It is that the ratio is
a property of the normaliser. Same audio, same band, same peak picker,
same windows; the only thing that changes is whether the reference window
is 0.75 s or 30 s.

If the ratio moves a lot, the sentence in CLAUDE.md is measuring the tool
rather than the venue, and the door it closed should be reopened.
"""
import os, sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "..", "2026-08-28-audio-bounce-confirmation"))
import acoustics as AC, corpus as CO, envelope as EN

SLUGS = ["cebaa6d4", "c27e196d", "d59d7610", "9e15ed10"]
SHRINK = 0.5


def local_z(signal, rate, hop, background_s=0.75):
    """The previous study's normaliser, reproduced exactly."""
    span = max(1, int(round(background_s * rate / hop)))
    step = max(1, span // 8)
    starts = np.arange(0, len(signal), step)
    med, mad = [], []
    for s in starts:
        b = signal[max(0, s - span):s + span]
        if len(b) == 0:
            med.append(0.0); mad.append(0.0); continue
        m = np.median(b); med.append(m); mad.append(np.median(np.abs(b - m)))
    grid = np.arange(len(signal))
    mf = np.interp(grid, starts, med)
    sf = np.maximum(np.interp(grid, starts, mad) * 1.4826, 1e-6)
    sf = np.maximum(sf, np.percentile(sf, 25))
    return (signal - mf) / sf


def main():
    print("                        LOCAL reference (+/-0.75s)      GLOBAL reference (30s)")
    print("match                  in-play  gap   ratio        in-play  gap   ratio    AUC")
    rows = []
    for slug in SLUGS:
        doc = CO.load(slug)
        if doc is None or not doc["wav"] or doc["clock"] != "source":
            continue
        samples, rate = AC.read_wav(doc["wav"])
        mag, freqs = EN.spectrogram(samples, rate)
        f = EN.flux(mag, freqs, EN.HIGH_BAND)
        t = EN.frame_times(mag.shape[0], rate)
        zl = local_z(f, rate, EN.HOP)
        zg = EN.global_z(f, rate)
        spans = sorted((float(b["start_source_s"]), float(b["end_source_s"]))
                       for b in doc["boundaries"] if not b.get("deleted")
                       and b.get("start_source_s") is not None)
        play = np.zeros(len(t), bool)
        for a, b in spans:
            play |= (t >= a + SHRINK) & (t <= b - SHRINK)
        gap = np.zeros(len(t), bool)
        for (a0, b0), (a1, b1) in zip(spans, spans[1:]):
            gap |= (t > b0 + SHRINK) & (t < a1 - SHRINK)
        play_s = float(play.sum()) * EN.HOP / rate
        gap_s = float(gap.sum()) * EN.HOP / rate
        cells = []
        for z, th in ((zl, 3.0), (zg, 6.0)):
            idx = EN.peaks(z, rate, th)
            pt = t[idx]
            inp = sum(int(((pt >= a + SHRINK) & (pt <= b - SHRINK)).sum())
                      for a, b in spans)
            ing = sum(int(((pt > b0 + SHRINK) & (pt < a1 - SHRINK)).sum())
                      for (a0, b0), (a1, b1) in zip(spans, spans[1:]))
            cells.append((inp / play_s, ing / gap_s))
        # how separable are one-second windows, on each curve
        def win_auc(z):
            w = int(round(1.5 * rate / EN.HOP))
            c = np.concatenate([[0.0], np.cumsum(z)])
            mid = np.arange(w, len(z) - w, int(round(0.5 * rate / EN.HOP)))
            val = (c[mid + w // 2] - c[mid - w // 2]) / w
            tm = t[mid]
            p = np.zeros(len(tm), bool); g = np.zeros(len(tm), bool)
            for a, b in spans:
                p |= (tm >= a + SHRINK) & (tm <= b - SHRINK)
            for (a0, b0), (a1, b1) in zip(spans, spans[1:]):
                g |= (tm > b0 + SHRINK) & (tm < a1 - SHRINK)
            return AC.auc(val[p], val[g])
        al, ag = win_auc(zl), win_auc(zg)
        rows.append((slug, doc["match"]["venue"], cells, al, ag))
        print(f"{slug} {str(doc['match']['venue'])[:12]:12s} "
              f"{cells[0][0]:6.1f} {cells[0][1]:5.1f}  {cells[0][0]/cells[0][1]:5.2f}x"
              f"        {cells[1][0]:6.1f} {cells[1][1]:5.1f}  {cells[1][0]/cells[1][1]:5.2f}x"
              f"   {ag:.3f}", flush=True)
    print()
    lr = [c[0][0] / c[0][1] for _s, _v, c, _a, _b in rows]
    gr = [c[1][0] / c[1][1] for _s, _v, c, _a, _b in rows]
    print(f"  ratio with the local reference : {min(lr):.2f}x to {max(lr):.2f}x"
          f"   (CLAUDE.md records 1.2x to 1.6x)")
    print(f"  ratio with a 30-second reference: {min(gr):.2f}x to {max(gr):.2f}x")
    print(f"  window AUC, local  {np.median([a for *_x, a, _b in rows]):.3f}")
    print(f"  window AUC, global {np.median([b for *_x, _a, b in rows]):.3f}")


if __name__ == "__main__":
    main()

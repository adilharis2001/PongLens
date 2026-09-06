"""Is the 0.15-0.45 tolerance gap populated, and can it cost a card?

Two different pads ask "is this bounce on the table":

    PAIR_SURFACE_PAD_M = 0.45   serve detection (points_v2.py:82)
    0.15 hardcoded              Evidence.bt_table (points_v2.py:539)

They agreed until 2026-08-28, when the serve pad was widened to 0.45 and the
other was left alone. `on_own_table` reads bt_table and runs LAST, so in
principle a card anchored on a serve the wide pad rescued can be deleted by
the narrow one after resolve has already let it trim a neighbour.

For that to happen the card needs EVERY bounce outside 0.15. Measured here:
how many bounces fall in the band at all, how many accepted serve pairs
depend on it (both bounces would fail at 0.15), and how many cards anchored
on one have no other bounce inside 0.15 to save them.
"""
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from reload import load, stages                                # noqa: E402
import points_v2 as V2                                         # noqa: E402


def pad_ok(u, v, pad):
    return (u is not None and -pad <= u <= V2.W_M + pad
            and -pad <= v <= V2.L_M + pad)


rows = []
for path in sys.argv[1:]:
    b, E = load(path)
    if E is None:
        continue
    s = stages(E)
    uv = {round(t, 2): (u, v) for t, u, v in E.bounce_uv()}
    n_band = n15 = n45 = 0
    for t, (u, v) in uv.items():
        a, c = pad_ok(u, v, 0.15), pad_ok(u, v, 0.45)
        n15 += a
        n45 += c
        n_band += (c and not a)

    # the accepted serve motifs, re-derived from the shipped rule so the
    # pair's own two bounces are known rather than guessed from the contact
    from points_v2 import serve_motifs
    bnc = []
    for t, _f in b["bounces"]:
        f = int(round(float(t) * E.fps))
        p = E.track.get(f)
        if p:
            bnc.append((f, p[0], p[1]))
    motifs = serve_motifs(E.track, sorted(bnc), E.H, E.fps, E.scale, E.cross)
    dep = []
    for m in motifs:
        b1, b2 = round(m["bounce1_s"], 2), round(m["bounce2_s"], 2)
        u1 = uv.get(b1, (None, None))
        u2 = uv.get(b2, (None, None))
        if not pad_ok(*u1, 0.15) or not pad_ok(*u2, 0.15):
            dep.append(m)

    # cards anchored on a band-dependent serve, with nothing inside 0.15
    naked = 0
    for c in s["resolved"]:
        if c.get("serve_s") is None:
            continue
        if not any(abs(c["serve_s"] - m["contact_s"]) < 0.02 for m in dep):
            continue
        ts = [float(t) for t in E.bt if c["t0"] <= t <= c["t1"]]
        if not any(pad_ok(*uv.get(round(t, 2), (None, None)), 0.15) for t in ts):
            naked += 1
    rows.append({
        "mid": (b.get("match_id") or os.path.basename(path)[:-5])[:8],
        "venue": b.get("venue"), "bounces": len(uv), "on15": n15,
        "on45": n45, "band": n_band, "motifs": len(motifs),
        "band_dependent": len(dep), "naked_cards": naked,
    })

print(f"{'mid':9s} {'venue':16s} {'bnc':>5s} {'on.15':>6s} {'on.45':>6s} {'band':>5s} "
      f"{'serves':>6s} {'need band':>9s} {'naked cards':>11s}")
T = {}
for r in rows:
    print(f"{r['mid']:9s} {str(r['venue'])[:16]:16s} {r['bounces']:5d} {r['on15']:6d} "
          f"{r['on45']:6d} {r['band']:5d} {r['motifs']:6d} {r['band_dependent']:9d} "
          f"{r['naked_cards']:11d}")
    for k in ("bounces", "on15", "on45", "band", "motifs", "band_dependent", "naked_cards"):
        T[k] = T.get(k, 0) + r[k]
print("\nTOTAL:", T)

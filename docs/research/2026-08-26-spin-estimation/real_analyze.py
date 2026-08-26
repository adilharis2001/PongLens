"""Robust re-analysis of the extracted real labeled serves.

The raw tracks contain tracker teleports (confusers) and some serve
pairs are actually pre-serve ball-bouncing. Apply the hygiene production
would need: chunk the track at teleports, robust-fit window velocities,
gate on physical plausibility, and only then compare spin labels.
"""
import json
import numpy as np

def chunks(track, max_jump_m=0.45, max_gap_s=0.10):
    """Split (t,u,v) samples at teleports/gaps; return list of arrays."""
    out, cur = [], []
    for s in track:
        if cur:
            dt = s[0] - cur[-1][0]
            d = np.hypot(s[1] - cur[-1][1], s[2] - cur[-1][2])
            lim = max_jump_m * max(1.0, dt / 0.034)
            if dt > max_gap_s or d > lim:
                if len(cur) >= 3:
                    out.append(np.array(cur))
                cur = []
        cur.append(s)
    if len(cur) >= 3:
        out.append(np.array(cur))
    return out

def robust_vel(track, lo, hi):
    """Robust straight-line velocity over window [lo,hi]: LS fit on u(t)
    and v(t) with one outlier-rejection round. Needs >= 3 samples from a
    single chunk."""
    best = None
    for ch in chunks(track):
        m = (ch[:, 0] >= lo) & (ch[:, 0] <= hi)
        seg = ch[m]
        if len(seg) < 3:
            continue
        t = seg[:, 0] - seg[0, 0]
        A = np.stack([t, np.ones_like(t)], axis=1)
        cu, *_ = np.linalg.lstsq(A, seg[:, 1], rcond=None)
        cv, *_ = np.linalg.lstsq(A, seg[:, 2], rcond=None)
        ru = seg[:, 1] - A @ cu
        rv = seg[:, 2] - A @ cv
        r = np.hypot(ru, rv)
        keep = r < max(0.06, 2.5 * np.median(r) + 1e-9)
        if keep.sum() >= 3 and keep.sum() < len(seg):
            cu, *_ = np.linalg.lstsq(A[keep], seg[keep, 1], rcond=None)
            cv, *_ = np.linalg.lstsq(A[keep], seg[keep, 2], rcond=None)
        n = int(keep.sum())
        resid = float(np.mean(np.hypot(seg[:, 1] - A @ cu,
                                       seg[:, 2] - A @ cv)))
        cand = dict(vu=float(cu[0]), vv=float(cv[0]),
                    speed=float(np.hypot(cu[0], cv[0])), n=n, resid=resid)
        if best is None or cand["n"] > best["n"]:
            best = cand
    return best

def main():
    rows = json.load(open("out/real_serves.json"))
    W = 0.20
    out = []
    for r in rows:
        tr = r["track"]
        hop_T = r["hop_t"]
        pre = robust_vel(tr, -W, -0.005)
        post = robust_vel(tr, 0.02, min(W, hop_T * 0.6))
        rec = dict(id=r["id"][:8], key=r["key"], spin=r["spin"],
                   sidespin=r["sidespin"], hop_t=hop_T,
                   hop_speed=r.get("hop_speed"))
        ok = True
        why = []
        b1, b2 = r.get("b1_uv"), r.get("b2_uv")
        if b1 and b2 and b1[1] is not None and b2[1] is not None:
            if (b1[1] - 1.37) * (b2[1] - 1.37) > 0:
                ok = False; why.append("pair same half")
            hop_len = float(np.hypot(b2[0] - b1[0], b2[1] - b1[1]))
            hop_spd = hop_len / hop_T
            if not (0.8 < hop_spd < 15):
                ok = False; why.append(f"hop_spd {hop_spd:.1f}")
            rec["hop_speed"] = hop_spd
        if not (0.2 < hop_T < 1.0):
            ok = False; why.append(f"hop_t {hop_T:.2f}")
        if pre is None or post is None:
            ok = False; why.append("no window fit")
        else:
            rec["pre_speed"] = pre["speed"]
            rec["post_speed"] = post["speed"]
            rec["pre_n"], rec["post_n"] = pre["n"], post["n"]
            rec["pre_resid"], rec["post_resid"] = pre["resid"], post["resid"]
            if not (0.5 < pre["speed"] < 20 and 0.3 < post["speed"] < 20):
                ok = False; why.append(
                    f"speeds {pre['speed']:.1f}/{post['speed']:.1f}")
            elif pre["resid"] > 0.20 or post["resid"] > 0.20:
                ok = False; why.append("high resid")
            else:
                rec["ratio1"] = post["speed"] / pre["speed"]
                # heading change across the bounce
                h1 = np.arctan2(pre["vv"], pre["vu"])
                h2 = np.arctan2(post["vv"], post["vu"])
                d = h2 - h1
                while d > np.pi: d -= 2 * np.pi
                while d < -np.pi: d += 2 * np.pi
                rec["kick1_deg"] = float(np.degrees(d))
                if abs(rec["kick1_deg"]) > 75:
                    ok = False; why.append(f"kick {rec['kick1_deg']:.0f}")
        rec["ok"] = ok
        rec["why"] = ";".join(why)
        out.append(rec)

    good = [r for r in out if r["ok"]]
    print(f"{len(good)}/{len(out)} pass hygiene gates\n")
    print(f"{'id':<10}{'key':<15}{'spin':<6}{'side':<6}{'ratio1':>7}"
          f"{'kick1':>7}{'pre':>6}{'post':>6}{'hop_t':>7}{'hopspd':>7}")
    for r in sorted(good, key=lambda r: (r["spin"] or "z", r["ratio1"])):
        print(f"{r['id']:<10}{r['key']:<15}{str(r['spin']):<6}"
              f"{str(r['sidespin']):<6}{r['ratio1']:>7.2f}"
              f"{r['kick1_deg']:>7.1f}{r['pre_speed']:>6.1f}"
              f"{r['post_speed']:>6.1f}{r['hop_t']:>7.2f}"
              f"{(r['hop_speed'] or float('nan')):>7.2f}")
    print("\nrejected:")
    for r in out:
        if not r["ok"]:
            print(f"  {r['id']} {str(r['spin']):<5} {r['why']}")

    for feat in ["ratio1", "hop_t", "hop_speed"]:
        b = np.array([r[feat] for r in good
                      if r["spin"] == "back" and r.get(feat)])
        t = np.array([r[feat] for r in good
                      if r["spin"] == "top" and r.get(feat)])
        if len(b) >= 3 and len(t) >= 2:
            print(f"\n{feat}: back {b.mean():.2f}+/-{b.std():.2f} (n={len(b)})"
                  f"  top {t.mean():.2f}+/-{t.std():.2f} (n={len(t)})")
    json.dump(out, open("out/real_features_clean.json", "w"))

if __name__ == "__main__":
    main()

"""What the two bodies are doing, from pose_<m>.json alone. No ball, no audio.

    import bodyfeat; T, X, names = bodyfeat.features("f3237587")

Everything here is scale-free, so a feature means the same thing on a camera
eight metres away as on one behind the near player: lengths are in TABLE WIDTHS
or in the player's own standing height, speeds are per second, and every window
is given in seconds. That is the whole reason a rule built on one venue has a
chance on another.

The families, and what each is FOR:

  base    how busy each player is -- the six pose_play.py already had, kept
          verbatim so a number stays comparable with the old fallback.
  zone    where each player is STANDING, against the table itself. Between
          points somebody walks off to fetch the ball; during one, both are at
          their own end. This is the family that should kill a stray segment.
  rhythm  a rally has a BEAT. The wrist speed rises and falls once a stroke,
          and the two players take turns, so the near player's beat leads the
          far player's by roughly half a cycle. Walking to pick a ball up has
          no beat at all. This is the family that should separate two points
          glued together, because the beat stops between them.
  pair    the two players TOGETHER: both busy, both present, facing each other.
          One player alone being busy is somebody fetching a ball.

Frames are the pose file's own 10 fps. Keypoints arrive in WINDOW pixels and
are put back into source pixels here, because the table corners are in source
pixels and every zone feature is measured against them.
"""
import hashlib, json, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
# HOW WIDE THE AVERAGE IS, in seconds either side. Half a second is the right
# window for "is a rally happening" and the wrong one for "did it just stop":
# measured on the corpus, the gaps the segmenter fails to see have a median
# length of 1.2 s, and an average a whole second wide cannot see a 1.2 s hole
# at all. The decoder has its own idea of how long a point lasts, so smoothing
# here is not what holds the segments together and can be given up cheaply.
SMOOTH_S = float(os.environ.get("V3_BF_SMOOTH", "0.5"))
KP = dict(nose=0, ls=5, rs=6, le=7, re=8, lw=9, rw=10, lh=11, rh=12, lk=13, rk=14, la=15, ra=16)
FAMILIES = ("base", "zone", "rhythm", "pair", "snap",
            "ready", "serve", "floor", "walk", "mirror", "away", "ball", "bounce")
MIN_KP = 0.3          # a keypoint scored under this is not there


def quad(m):
    """The table's four corners in source pixels, near end first."""
    C = json.load(open(f"{HERE}/real_calib.json"))
    full = next(k for k in C if k.startswith(m))
    q = C[full]["corners"]
    return [np.array(q[k], dtype=float) for k in ("A_near_1", "B_near_2", "C_far_2", "D_far_1")]


def table_frame(m):
    """Origin at the near-end middle, u along the table away from the camera,
    v across it. Returns (origin, u, v, length_px, width_px) with u and v unit."""
    A, B, C, D = quad(m)
    near = (A + B) / 2.0; far = (C + D) / 2.0
    L = far - near; length = float(np.linalg.norm(L)); u = L / max(length, 1e-6)
    W = (B - A) + (C - D); width = float(np.linalg.norm(B - A) + np.linalg.norm(C - D)) / 2.0
    v = W / max(float(np.linalg.norm(W)), 1e-6)
    return near, u, v, length, width


def ball_bounces_on(m):
    """[(t, v)] on-table bounces, v metres along the table (net at L/2)."""
    p = f"{HERE}/ballx_{m}.json"
    if not os.path.exists(p):
        return np.zeros((0, 2))
    b = json.load(open(p)).get("bounces_on") or []
    return np.asarray(sorted(b), float).reshape(-1, 2)


def ball_crossings(m):
    """Net crossing times (s) from ballx_<m>.json, or an empty array. The ONE
    thing here that is not a body: it exists because the bodies read a player
    deep behind the table as dead time, and on those rallies the ball is the
    only witness that the point is still on (2026-09-08, Wayne Wei 21, 11, 60)."""
    p = f"{HERE}/ballx_{m}.json"
    if not os.path.exists(p):
        return np.zeros(0)
    return np.asarray(sorted(json.load(open(p))["crossings"]), float)


def load(m):
    """T (seconds) and, per side, a per-frame dict or None."""
    P = json.load(open(f"{HERE}/pose_{m}.json"))
    fps = float(P["fps"]); rx, ry = float(P["rect"][0]), float(P["rect"][1])
    keys = sorted(int(k) for k in P["frames"])
    T = np.array([k / fps for k in keys], dtype=float)
    out = {"near": [], "far": []}
    for k in keys:
        rec = P["frames"][str(k)]
        for side in ("near", "far"):
            r = rec.get(side)
            if not r:
                out[side].append(None); continue
            b = r["box"]
            box = (b[0] + rx, b[1] + ry, b[2] + rx, b[3] + ry)
            kp = np.array([[x + rx, y + ry, s] for x, y, s in r["kp"]], dtype=float)
            out[side].append({"box": box, "kp": kp})
    return T, out


def _pt(kp, j):
    return kp[j, :2] if kp[j, 2] >= MIN_KP else None


def _mean(pts):
    ps = [p for p in pts if p is not None]
    return np.mean(ps, axis=0) if ps else None


def _percol(raw_side, m):
    """Per-frame quantities for one player, before any smoothing."""
    near0, u, v, length, width = table_frame(m)
    n = len(raw_side)
    z = lambda: np.full(n, np.nan)
    bh = z(); cen = np.full((n, 2), np.nan); ground = np.full((n, 2), np.nan)
    torso = z(); stance = z(); hands = z(); knee = z(); headx = z()
    armspan = z(); wristy = z()
    aspect = z(); hipfoot = z(); kneerat = z(); headup = z(); tilt = z()
    hiw = z(); low = z(); wspread = z(); reach = z(); fold = z()
    wr = [None] * n
    for i, f in enumerate(raw_side):
        if f is None: continue
        b = f["box"]; kp = f["kp"]
        h = max(1.0, b[3] - b[1]); bh[i] = h
        sh = [_pt(kp, KP["ls"]), _pt(kp, KP["rs"])]; hp = [_pt(kp, KP["lh"]), _pt(kp, KP["rh"])]
        wrist = [p for p in (_pt(kp, KP["lw"]), _pt(kp, KP["rw"])) if p is not None]
        ank = [_pt(kp, KP["la"]), _pt(kp, KP["ra"])]; kn = [_pt(kp, KP["lk"]), _pt(kp, KP["rk"])]
        shc = _mean(sh); hpc = _mean(hp); c = _mean(sh + hp)
        if c is not None: cen[i] = c
        # WHERE THE PLAYER IS STANDING: the ankles if they are visible, the
        # bottom of the box otherwise. Never the body centre -- a player who
        # crouches has not moved, and depth must not read that as a step.
        g = _mean([p for p in ank if p is not None])
        ground[i] = g if g is not None else np.array([(b[0] + b[2]) / 2.0, b[3]])
        if shc is not None and hpc is not None: torso[i] = (hpc[1] - shc[1]) / h
        if all(p is not None for p in ank): stance[i] = abs(ank[0][0] - ank[1][0]) / h
        if hpc is not None and wrist: hands[i] = np.mean([hpc[1] - p[1] for p in wrist]) / h
        if hpc is not None and any(p is not None for p in kn):
            knee[i] = (np.mean([p[1] for p in kn if p is not None]) - hpc[1]) / h
        if shc is not None and (nz := _pt(kp, KP["nose"])) is not None:
            headx[i] = (nz[0] - shc[0]) / h
        if len(wrist) == 2: armspan[i] = float(np.linalg.norm(wrist[0] - wrist[1])) / h
        if shc is not None and wrist: wristy[i] = np.mean([shc[1] - p[1] for p in wrist]) / h
        wr[i] = wrist
        # ---- quantities the newer families need, all dimensionless or in h --
        aspect[i] = (b[3] - b[1]) / max(1.0, b[2] - b[0])
        ankc = _mean([p for p in ank if p is not None])
        if hpc is not None and ankc is not None:
            drop = ankc[1] - hpc[1]
            hipfoot[i] = drop / h
            kn_ok = [p for p in kn if p is not None]
            # WHERE THE KNEE SITS ALONG THE HIP-TO-ANKLE DROP. Half way is a
            # straight leg; a bent knee rides high because the hip has come
            # down to meet it. A ratio, so no camera distance survives in it.
            if kn_ok and drop > 1e-6:
                kneerat[i] = (np.mean([p[1] for p in kn_ok]) - hpc[1]) / drop
        if hpc is not None and (nz := _pt(kp, KP["nose"])) is not None:
            headup[i] = (hpc[1] - nz[1]) / h
        if shc is not None and hpc is not None:
            vert = abs(hpc[1] - shc[1])
            if vert > 1e-6: tilt[i] = abs(hpc[0] - shc[0]) / vert
        if hpc is not None and wrist:
            hiw[i] = max((hpc[1] - p[1]) / h for p in wrist)      # the RAISED hand
            low[i] = min((hpc[1] - p[1]) / h for p in wrist)
        if len(wrist) == 2: wspread[i] = abs(wrist[0][1] - wrist[1][1]) / h
        if ankc is not None and wrist:
            reach[i] = max((p[1] - ankc[1]) / h for p in wrist)   # + = below the feet
        # how folded the bat arm is: 0 straight, 1 fully closed
        folds = []
        for sj, ej, wj in (("ls", "le", "lw"), ("rs", "re", "rw")):
            a1, a2, a3 = _pt(kp, KP[sj]), _pt(kp, KP[ej]), _pt(kp, KP[wj])
            if a1 is None or a2 is None or a3 is None: continue
            lim = float(np.linalg.norm(a1 - a2)) + float(np.linalg.norm(a2 - a3))
            if lim > 1e-6: folds.append(1.0 - float(np.linalg.norm(a1 - a3)) / lim)
        if folds: fold[i] = max(folds)
    return dict(bh=bh, cen=cen, ground=ground, torso=torso, stance=stance, hands=hands,
                knee=knee, headx=headx, armspan=armspan, wristy=wristy, wr=wr,
                aspect=aspect, hipfoot=hipfoot, kneerat=kneerat, headup=headup, tilt=tilt,
                hiw=hiw, low=low, wspread=wspread, reach=reach, fold=fold)


def _speed(pos, T, bh, max_gap=2):
    """Speed of a point, in the player's own heights per second."""
    n = len(T); out = np.full(n, np.nan)
    ok = np.where(~np.isnan(pos[:, 0]))[0]
    for a, b in zip(ok, ok[1:]):
        if b - a <= max_gap and bh[b] > 0:
            out[b] = float(np.linalg.norm(pos[b] - pos[a])) / bh[b] / max(T[b] - T[a], 1e-6)
    return out


def _wrist_speed(wr, T, bh, max_gap=2):
    n = len(T); out = np.full(n, np.nan); prev = None
    for i in range(n):
        w = wr[i]
        if not w: prev = None; continue
        if prev is not None and i - prev[1] <= max_gap and bh[i] > 0:
            d = [float(np.linalg.norm(a - b)) for a in w for b in prev[0]]
            out[i] = min(d) / bh[i] / max(T[i] - T[prev[1]], 1e-6)
        prev = (w, i)
    return out


def _win(T, secs):
    dt = float(np.median(np.diff(T)))
    return max(1, int(round(secs / dt)))


def _roll(x, k, fn=np.nanmean, minn=2):
    n = len(x); out = np.full(n, np.nan)
    for i in range(n):
        seg = x[max(0, i - k): i + k + 1]
        if np.sum(~np.isnan(seg)) >= minn: out[i] = fn(seg)
    return out


def _beat(x, T, win_s=1.5, lo_s=0.25, hi_s=1.2):
    """How strongly a signal repeats: the best autocorrelation at a stroke's
    own period, over a window either side. A rally has one; walking does not."""
    dt = float(np.median(np.diff(T))); k = _win(T, win_s)
    lo, hi = max(1, int(round(lo_s / dt))), max(2, int(round(hi_s / dt)))
    n = len(x); out = np.full(n, np.nan)
    y = np.where(np.isnan(x), np.nan, x)
    for i in range(n):
        seg = y[max(0, i - k): i + k + 1]
        good = ~np.isnan(seg)
        if good.sum() < 2 * hi: continue
        s = np.where(good, seg, np.nanmean(seg[good])) - np.nanmean(seg[good])
        d = float(np.dot(s, s))
        if d <= 1e-9: out[i] = 0.0; continue
        best = 0.0
        for lag in range(lo, min(hi, len(s) - 2) + 1):
            r = float(np.dot(s[:-lag], s[lag:])) / d
            if r > best: best = r
        out[i] = best
    return out


def _alternation(a, b, T, win_s=1.5, lo_s=0.15, hi_s=0.9):
    """Do the two players TAKE TURNS? The best correlation between one's
    activity and the other's, shifted by up to about one stroke, either way."""
    dt = float(np.median(np.diff(T))); k = _win(T, win_s)
    lo, hi = max(1, int(round(lo_s / dt))), max(2, int(round(hi_s / dt)))
    n = len(T); out = np.full(n, np.nan)
    for i in range(n):
        s0, s1 = max(0, i - k), min(n, i + k + 1)
        x, y = a[s0:s1], b[s0:s1]
        good = ~np.isnan(x) & ~np.isnan(y)
        if good.sum() < 2 * hi: continue
        x = np.where(good, x, np.nan); y = np.where(good, y, np.nan)
        mx, my = np.nanmean(x), np.nanmean(y)
        x = np.nan_to_num(x - mx); y = np.nan_to_num(y - my)
        nx, ny = float(np.dot(x, x)) ** 0.5, float(np.dot(y, y)) ** 0.5
        if nx < 1e-6 or ny < 1e-6: out[i] = 0.0; continue
        best = 0.0
        for lag in range(lo, min(hi, len(x) - 2) + 1):
            for p, q in ((x[:-lag], y[lag:]), (y[:-lag], x[lag:])):
                r = float(np.dot(p, q)) / (nx * ny)
                if r > best: best = r
        out[i] = best
    return out



def _straight(pos, T, bh, win_s=1.0):
    """How much of the ground point's travel went SOMEWHERE, over a window.

    Net displacement divided by the path walked to make it. A rally is a
    shuffle: metres of path, no net displacement, so this sits near zero. A
    player walking to fetch a ball spends every step going the same way, so it
    sits near one. Returned with the speed it was walked at, in the player's
    own heights per second, because a slow straight drift is not a walk."""
    n = len(T); k = _win(T, win_s / 2.0)
    st = np.full(n, np.nan); sp = np.full(n, np.nan)
    step = np.full(n, np.nan)
    ok = ~np.isnan(pos[:, 0])
    for i in range(1, n):
        if ok[i] and ok[i - 1]: step[i] = float(np.linalg.norm(pos[i] - pos[i - 1]))
    for i in range(n):
        a, b = max(0, i - k), min(n - 1, i + k)
        if not (ok[a] and ok[b]) or bh[i] <= 0: continue
        path = np.nansum(step[a + 1:b + 1])
        net = float(np.linalg.norm(pos[b] - pos[a]))
        if path > 1e-6: st[i] = net / path
        sp[i] = net / bh[i] / max(T[b] - T[a], 1e-6)
    return st, sp


def _corr(a, b, T, win_s=1.0):
    """Signed rolling correlation of two per-frame signals."""
    n = len(T); k = _win(T, win_s); out = np.full(n, np.nan)
    for i in range(n):
        x, y = a[max(0, i - k): i + k + 1], b[max(0, i - k): i + k + 1]
        good = ~np.isnan(x) & ~np.isnan(y)
        if good.sum() < 5: continue
        x, y = x[good] - np.mean(x[good]), y[good] - np.mean(y[good])
        nx, ny = float(np.dot(x, x)) ** 0.5, float(np.dot(y, y)) ** 0.5
        out[i] = 0.0 if nx < 1e-9 or ny < 1e-9 else float(np.dot(x, y)) / (nx * ny)
    return out


def _tosses(P, T, gsp):
    """When a hand went from the waist to above the shoulder, standing still.

    That is a service toss, and it is the one gesture in table tennis that
    belongs to exactly one moment: the frame before a point. Measured against
    the player's OWN hip and shoulder, so a camera eight metres away sees the
    same rise as one behind the table."""
    dt = float(np.median(np.diff(T))); back = max(1, int(round(0.7 / dt)))
    out = []
    for side in ("near", "far"):
        h = P[side]["hiw"]                    # raised wrist, in heights above the hip
        g = gsp[side]
        for i in range(back, len(T)):
            if not (h[i] > 0.30): continue
            w = h[i - back:i]
            if np.all(np.isnan(w)) or np.nanmin(w) > 0.10: continue
            q = g[max(0, i - back):i + 1]
            if np.all(np.isnan(q)) or np.nanmedian(q) > 0.8: continue
            if out and side == out[-1][1] and T[i] - out[-1][0] < 1.0: continue
            out.append((float(T[i]), side))
    return sorted(out)


def _srcver():
    """THE CACHE IS KEYED ON THIS FILE'S OWN TEXT. Edit a feature, add one to a
    family, change a window: the key moves and the next run recomputes. Keyed on
    the family names alone, an afternoon of measurements silently compares new
    rules against yesterday's numbers."""
    return hashlib.sha1(open(__file__, "rb").read()).hexdigest()[:10]


def features(m, families=FAMILIES, cache=True):
    """The requested families' columns, selected out of the match's full matrix.

    EVERY family is computed and cached together, once per match, and a subset
    is a column selection over it. An ablation therefore costs one decode, not
    one feature build, and -- the part that matters -- `--fam base,zone` gets
    the IDENTICAL numbers it would have got building only those two, because
    the blocks run in a fixed order and standardising is per column."""
    want = tuple(f for f in FAMILIES if f in families)
    T, X, names, fams = _all(m, cache=cache)
    keep = [i for i, f in enumerate(fams) if f in want]
    return T, X[:, keep], [names[i] for i in keep]


def _all(m, cache=True):
    cp = f"/tmp/v3exp/bodyfeat/{m}_ALL_s{SMOOTH_S:g}_{_srcver()}.npz"
    if cache and os.path.exists(cp):
        d = np.load(cp, allow_pickle=True)
        return d["T"], d["X"], list(d["names"]), list(d["fams"])
    fam = FAMILIES
    T, raw = load(m)
    near0, u, v, length, width = table_frame(m)
    P = {s: _percol(raw[s], m) for s in ("near", "far")}
    dt = float(np.median(np.diff(T)))
    k_half = _win(T, SMOOTH_S)
    cols, names, fams = [], [], []
    cur = [""]

    def add(nm, x):
        cols.append(x); names.append(nm); fams.append(cur[0])

    sp, wsp = {}, {}
    for side in ("near", "far"):
        p = P[side]
        sp[side] = _speed(p["cen"], T, p["bh"])
        wsp[side] = _wrist_speed(p["wr"], T, p["bh"])

    if "base" in fam:
        cur[0] = "base"
        for side in ("near", "far"):
            p = P[side]
            for nm, x in (("torso_speed", sp[side]), ("wrist_speed", wsp[side]),
                          ("torso", p["torso"]), ("stance", p["stance"]),
                          ("hands", p["hands"]), ("knee", p["knee"])):
                add(f"{side}_{nm}", _roll(x, k_half))
            add(f"{side}_torso_speed_sd", _roll(sp[side], k_half, np.nanstd))
            add(f"{side}_torso_sd", _roll(p["torso"], k_half, np.nanstd))

    if "zone" in fam:
        cur[0] = "zone"
        for side in ("near", "far"):
            g = P[side]["ground"]
            d = g - near0[None, :]
            depth = (d @ u) / max(length, 1e-6)       # 0 near end, 1 far end
            lat = (d @ v) / max(width, 1e-6)          # table widths across
            add(f"{side}_depth", _roll(depth, k_half))
            add(f"{side}_lat", _roll(np.abs(lat), k_half))
            # HOW FAR FROM WHERE THEY USUALLY STAND. A player at their own end
            # all match has a depth that barely moves; the one who has walked
            # off to fetch the ball is the outlier, and the match's own median
            # is the only reference that travels between venues.
            med = np.nanmedian(depth)
            add(f"{side}_depth_off", _roll(np.abs(depth - med), k_half))
            add(f"{side}_lat_speed", _roll(np.abs(np.gradient(_roll(lat, k_half), T)), k_half))
            add(f"{side}_present", _roll(np.where(np.isnan(P[side]["bh"]), 0.0, 1.0), _win(T, 1.0)))
        dn = (P["near"]["ground"] - near0[None, :]) @ u / max(length, 1e-6)
        df = (P["far"]["ground"] - near0[None, :]) @ u / max(length, 1e-6)
        add("pair_separation", _roll(np.abs(df - dn), k_half))

    if "rhythm" in fam:
        cur[0] = "rhythm"
        both = np.nanmax(np.column_stack([wsp["near"], wsp["far"]]), axis=1)
        add("beat_wrist", _beat(both, T))
        add("beat_near_wrist", _beat(wsp["near"], T))
        add("beat_near_lat", _beat(P["near"]["cen"][:, 0] / np.where(P["near"]["bh"] > 0, P["near"]["bh"], np.nan), T,
                                   win_s=2.0, lo_s=0.4, hi_s=2.0))
        add("alternation", _alternation(wsp["near"], wsp["far"], T))
        # STROKES PER SECOND: a peak in the wrist speed is a stroke. Counted
        # over three seconds, a rally sits near two and a half and dead time
        # near zero.
        pk = np.zeros(len(T))
        for side in ("near", "far"):
            x = _roll(wsp[side], max(1, _win(T, 0.15)))
            thr = np.nanpercentile(x, 60)
            for i in range(1, len(x) - 1):
                if x[i] > thr and x[i] >= x[i - 1] and x[i] > x[i + 1]: pk[i] += 1
        add("strokes_s", _roll(pk, _win(T, 1.5), np.nansum, minn=1) / 3.0)

    if "pair" in fam:
        cur[0] = "pair"
        act = {s: _roll(np.nanmax(np.column_stack([sp[s], wsp[s] / 3.0]), axis=1), k_half) for s in ("near", "far")}
        a, b = act["near"], act["far"]
        add("both_active", np.fmin(a, b))
        add("either_active", np.fmax(a, b))
        add("activity_gap", np.abs(a - b))
        add("both_moving", np.nan_to_num(sp["near"]) * np.nan_to_num(sp["far"]))
        for side in ("near", "far"):
            add(f"{side}_headx_speed", _roll(np.abs(np.gradient(_roll(P[side]["headx"], k_half), T)), k_half))
            add(f"{side}_wristy", _roll(P[side]["wristy"], k_half))


    # ---- everything below is measured against the player's own body or the
    # ---- table, never against a pixel count. ------------------------------
    gsp = {sd: _speed(P[sd]["ground"], T, P[sd]["bh"]) for sd in ("near", "far")}
    dep, lat = {}, {}
    for sd in ("near", "far"):
        d = P[sd]["ground"] - near0[None, :]
        dep[sd] = (d @ u) / max(length, 1e-6)
        lat[sd] = (d @ v) / max(width, 1e-6)

    if "ready" in fam:
        cur[0] = "ready"
        # A PLAYER WHO IS ABOUT TO BE HIT AT looks different from a player
        # standing about: knees folded, torso tipped in, bat hand up and the
        # arm bent. Between points every one of those relaxes.
        for sd in ("near", "far"):
            pz = P[sd]
            add(f"{sd}_knee_ratio", _roll(pz["kneerat"], k_half))
            add(f"{sd}_hip_over_foot", _roll(pz["hipfoot"], k_half))
            add(f"{sd}_torso_tilt", _roll(pz["tilt"], k_half))
            add(f"{sd}_arm_fold", _roll(pz["fold"], k_half))
            add(f"{sd}_bat_up", _roll(pz["hiw"], k_half))
            # THE CONJUNCTION, because the model that reads this is linear and
            # cannot build one: the bat is up AND the feet are not travelling.
            still = np.exp(-np.nan_to_num(_roll(gsp[sd], k_half), nan=1.0) / 0.5)
            add(f"{sd}_ready", np.nan_to_num(_roll(pz["hiw"], k_half)) * still)
            # hands busy while the feet stay put -- a rally; the reverse is a walk
            add(f"{sd}_hands_not_feet", np.nan_to_num(_roll(wsp[sd], k_half)) * still)

    if "serve" in fam:
        cur[0] = "serve"
        toss = _tosses(P, T, gsp)
        ts = np.array([q[0] for q in toss]) if toss else np.zeros(0)
        since = np.full(len(T), 12.0); until = np.full(len(T), 12.0)
        if len(ts):
            for i, t in enumerate(T):
                b = ts[ts <= t]; a = ts[ts >= t]
                if len(b): since[i] = min(12.0, t - b[-1])
                if len(a): until[i] = min(12.0, a[0] - t)
        add("since_toss", since)
        add("until_toss", until)
        # the rise itself, in the player's own heights per second
        for sd in ("near", "far"):
            rise = np.full(len(T), np.nan); hiw = P[sd]["hiw"]
            gr = np.gradient(np.nan_to_num(_roll(hiw, max(1, _win(T, 0.15))), nan=0.0), T)
            rise = np.maximum(gr, 0.0)
            add(f"{sd}_hand_rise", _roll(rise, k_half, np.nanmax))
            add(f"{sd}_wrist_spread", _roll(P[sd]["wspread"], k_half))
        # ONE of them planted at their end while the other waits: the server.
        add("stillest", _roll(np.fmin(gsp["near"], gsp["far"]), k_half))

    if "floor" in fam:
        cur[0] = "floor"
        # PICKING THE BALL UP. The hips go down, the head follows, a hand goes
        # below the feet and the whole box turns square. All four are ratios.
        for sd in ("near", "far"):
            pz = P[sd]
            hf = pz["hipfoot"]; med = np.nanmedian(hf)
            add(f"{sd}_hip_drop", _roll(med - hf, k_half))          # + = crouched
            add(f"{sd}_head_over_hip", _roll(pz["headup"], k_half))
            add(f"{sd}_hand_to_floor", _roll(pz["reach"], k_half))
            asp = pz["aspect"]; amed = np.nanmedian(asp)
            add(f"{sd}_box_squat", _roll(amed - asp, k_half))
        add("any_bending", np.fmax(np.nan_to_num(_roll(np.nanmedian(P["near"]["hipfoot"]) - P["near"]["hipfoot"], k_half)),
                                   np.nan_to_num(_roll(np.nanmedian(P["far"]["hipfoot"]) - P["far"]["hipfoot"], k_half))))

    if "walk" in fam:
        cur[0] = "walk"
        # WALKING NEVER HAPPENS DURING A POINT. A rally is a shuffle that ends
        # where it started; fetching a ball is metres in one direction.
        w = {}
        for sd in ("near", "far"):
            st1, sp1 = _straight(P[sd]["ground"], T, P[sd]["bh"], 1.0)
            st2, sp2 = _straight(P[sd]["ground"], T, P[sd]["bh"], 2.0)
            add(f"{sd}_straight_1s", _roll(st1, k_half))
            add(f"{sd}_straight_2s", _roll(st2, k_half))
            w[sd] = _roll(np.nan_to_num(st2) * np.nan_to_num(sp2), k_half)
            add(f"{sd}_walking", w[sd])
        add("anyone_walking", np.fmax(np.nan_to_num(w["near"]), np.nan_to_num(w["far"])))

    if "mirror" in fam:
        cur[0] = "mirror"
        # THE BALL IS THE THING THAT COUPLES THEM. Cross-court and the two
        # slide the same way together; between points nothing links them.
        ln = _roll(lat["near"], k_half); lf = _roll(lat["far"], k_half)
        add("lat_corr_2s", _corr(ln, lf, T, 1.0))
        add("lat_corr_abs", np.abs(_corr(ln, lf, T, 1.0)))
        vn = np.gradient(np.nan_to_num(ln), T); vf = np.gradient(np.nan_to_num(lf), T)
        add("lat_speed_product", _roll(vn * vf, k_half))
        add("lat_speed_both", _roll(np.fmin(np.abs(vn), np.abs(vf)), k_half))
        add("depth_corr_2s", _corr(_roll(dep["near"], k_half), _roll(dep["far"], k_half), T, 1.0))

    if "away" in fam:
        cur[0] = "away"
        # SOMEBODY HAS GONE. A hinge, not a position -- the linear model can
        # read "how far outside the playing box" only if it is handed it.
        home = {}
        for sd in ("near", "far"):
            out_l = np.maximum(np.abs(lat[sd]) - 0.75, 0.0)
            far_d = np.maximum(dep[sd] - 1.25, 0.0) + np.maximum(-0.25 - dep[sd], 0.0)
            add(f"{sd}_out_sideways", _roll(out_l, k_half))
            add(f"{sd}_out_lengthways", _roll(far_d, k_half))
            miss = np.where(np.isnan(P[sd]["bh"]), 1.0, 0.0)
            add(f"{sd}_missing_3s", _roll(miss, _win(T, 1.5)))
            home[sd] = np.exp(-(np.nan_to_num(out_l) + np.nan_to_num(far_d)))
        add("both_home", home["near"] * home["far"])

    if "snap" in fam:
        cur[0] = "snap"
        # THE SAME SIGNALS AT A TENTH OF THE SMOOTHING. Everything above is
        # averaged over a second, which is the right window for "is a rally
        # happening" and the wrong one for "did it just stop". Between two
        # points at a booth the players stay at the table and the next serve
        # comes inside two seconds, so the only thing separating them is a
        # stillness under a second long. Each is divided by that player's OWN
        # busy level over the whole match, so "quiet" means quiet for this
        # player on this camera.
        k_snap = max(1, _win(T, 0.15))
        act = {}
        for side in ("near", "far"):
            a = _roll(np.nanmax(np.column_stack([sp[side], wsp[side] / 3.0]), axis=1), k_snap)
            ref = np.nanpercentile(a, 70)
            act[side] = a / max(float(ref), 1e-6)
            add(f"{side}_snap", act[side])
        q = np.fmin(act["near"], act["far"])
        add("snap_both_quiet", q)
        quiet = np.nan_to_num(q, nan=1.0) < 0.5
        run = np.zeros(len(T)); acc = 0.0
        for i in range(len(T)):
            acc = acc + dt if quiet[i] else 0.0
            run[i] = min(acc, 4.0)
        add("snap_quiet_run", run)
        k1 = max(1, _win(T, 1.0))
        e = np.fmax(act["near"], act["far"])
        pre = np.array([np.nanmean(e[max(0, i - k1):i + 1]) if i > 0 else np.nan for i in range(len(T))])
        post = np.array([np.nanmean(e[i:i + k1 + 1]) for i in range(len(T))])
        add("snap_drop", pre - post)
        add("snap_pre", pre)
        add("snap_post", post)

    if "ball" in fam:
        # THE BALL AS A WITNESS. Two columns: how long since the ball last
        # crossed the net (capped at 4 s: after that it is simply "not lately"),
        # and how many crossings in the last three seconds (a rally's tempo).
        # Dead time is bounces on one half and no crossings; a rally with a
        # player deep behind the table is crossings at tempo with the bodies
        # reading low, which is exactly the case the body model gets wrong.
        cur[0] = "ball"
        bx = ball_crossings(m)
        since = np.full(len(T), 4.0); tempo = np.zeros(len(T))
        if len(bx):
            idx = np.searchsorted(bx, T, side="right")
            has = idx > 0
            since[has] = np.minimum(T[has] - bx[idx[has] - 1], 4.0)
            lo = np.searchsorted(bx, T - 3.0, side="right")
            tempo = (idx - lo).astype(float)
        add("ball_since_cross", since)
        add("ball_tempo3", tempo)

    if "bounce" in fam:
        # Its own family, measured 2026-09-08: as learned columns the bounces
        # glue 48 more points into shared cards (the server bouncing the ball
        # before a serve is a bounce too) for 4 more points found. Kept for the
        # record; not in the deployed families.
        cur[0] = "bounce"
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

    X = np.column_stack(cols)
    os.makedirs("/tmp/v3exp/bodyfeat", exist_ok=True)
    if cache: np.savez_compressed(cp, T=T, X=X, names=np.array(names), fams=np.array(fams))
    return T, X, names, fams


if __name__ == "__main__":
    import sys
    for m in sys.argv[1:]:
        T, X, names = features(m, cache=False)
        print(f"{m}: {X.shape[0]} frames x {X.shape[1]} features over {T[-1]:.0f}s")
        for i, nm in enumerate(names):
            c = X[:, i]
            print(f"    {nm:26s} nan {100*np.mean(np.isnan(c)):4.1f}%  "
                  f"p10 {np.nanpercentile(c,10):8.3f}  med {np.nanmedian(c):8.3f}  p90 {np.nanpercentile(c,90):8.3f}")

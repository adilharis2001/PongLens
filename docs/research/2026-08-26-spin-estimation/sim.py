"""Forward simulator for table tennis ball flight + bounce, observed by a
side-on 30 FPS camera.

World frame: x along the table length [0, 2.74], y across the width
[0, 1.525], z up, table surface at z = 0.  Matches the PongLens placement
convention (u = across, v = along) up to axis naming: here we call the
long axis x and the short axis y; when features are exported we map back
to (u, v).

Physics:
    a = g + a_drag + a_magnus
    a_drag   = -kD * |v| * v                     kD = 0.5 rho Cd A / m
    a_magnus = kM(|w|,|v|) * (w x v)             saturating lift curve

Bounce (Cross-style, slip vs grip):
    normal:     vz' = -ez vz
    tangential: contact-point slip s = v_t - r (w x n)_t
        grip if mu (1+ez) |vz| >= (2/7) |s|:
            v_t' = v_t - (2/7) s        (angular momentum about contact pt)
        else slip:
            v_t' = v_t - mu (1+ez) |vz| s_hat
    spin update from the same tangential impulse.

Camera: pinhole, side-on placement with jittered pose, 1920x1080.
Observations: ball center projected to pixels at 30 fps with phase
jitter, Gaussian pixel noise, dropouts.  A plane homography H maps table
plane world points to pixels; H^-1 applied to a ball pixel is exactly
what the production system can do today (valid only when the ball is
near the table plane).
"""

import numpy as np

# --- constants -------------------------------------------------------------
M = 0.0027          # kg
R = 0.02            # m
A = np.pi * R * R
RHO = 1.204
CD = 0.40
KD = 0.5 * RHO * CD * A / M          # ~0.112 1/m
G = np.array([0.0, 0.0, -9.81])
TABLE_L = 2.74
TABLE_W = 1.525
NET_H = 0.1525
EZ = 0.90           # normal restitution ball-table
MU = 0.25           # ball-table friction
CL_SLOPE = 0.60     # Cl ~ CL_SLOPE * S for small spin ratio S = R|w|/|v|
CL_MAX = 0.42       # saturation

def magnus_accel(w, v):
    speed = np.linalg.norm(v)
    wmag = np.linalg.norm(w)
    if speed < 1e-6 or wmag < 1e-6:
        return np.zeros(3)
    S = R * wmag / speed
    Cl = min(CL_SLOPE * S, CL_MAX)
    # |F| = 0.5 rho A Cl v^2, direction (w x v)/|w x v|
    f = 0.5 * RHO * A * Cl * speed * speed
    cross = np.cross(w, v)
    n = np.linalg.norm(cross)
    if n < 1e-9:
        return np.zeros(3)
    return (f / M) * cross / n

def accel(v, w):
    return G - KD * np.linalg.norm(v) * v + magnus_accel(w, v)

def bounce(v, w):
    """Return v', w' after table impact. n = +z."""
    vz = v[2]
    v_t = np.array([v[0], v[1], 0.0])
    n = np.array([0.0, 0.0, 1.0])
    # contact point slip velocity (bottom of ball)
    s = v_t - R * np.cross(w, n)
    s[2] = 0.0
    smag = np.linalg.norm(s)
    Jn = (1.0 + EZ) * abs(vz)          # normal impulse / m
    v2 = v.copy()
    w2 = w.copy()
    v2[2] = -EZ * vz
    if smag < 1e-9:
        return v2, w2
    # thin spherical shell: I = (2/3) m R^2, grip cap = k/(1+k) = 2/5
    if MU * Jn >= (2.0 / 5.0) * smag:
        # grip: slip driven to zero during contact -> v' = 0.6 v + 0.4 R w
        dv_t = -(2.0 / 5.0) * s
    else:
        dv_t = -MU * Jn * s / smag
    v2[0] += dv_t[0]
    v2[1] += dv_t[1]
    # angular impulse: dw = -(3/(2R)) * (n x dv_t)  (I = 2/3 m R^2)
    dw = -(3.0 / (2.0 * R)) * np.cross(n, dv_t)
    w2 = w2 + dw
    return v2, w2

def simulate(p0, v0, w0, t_max=2.5, dt=1e-3, stop_below=None, max_bounces=3):
    """RK4 integration with bounce events. Spin constant in flight
    (decay is slow at these Reynolds numbers), updated at each bounce.
    Returns dict with dense arrays t, p (N,3), v (N,3), and bounce list
    [(t, x, y, v_in, v_out, w_in, w_out)]."""
    p, v, w = p0.astype(float).copy(), v0.astype(float).copy(), w0.astype(float).copy()
    ts, ps, vs = [0.0], [p.copy()], [v.copy()]
    bounces = []
    t = 0.0
    while t < t_max:
        # RK4 on (p, v)
        def f(pv):
            return np.concatenate([pv[3:], accel(pv[3:], w)])
        pv = np.concatenate([p, v])
        k1 = f(pv); k2 = f(pv + 0.5 * dt * k1)
        k3 = f(pv + 0.5 * dt * k2); k4 = f(pv + dt * k3)
        pv2 = pv + (dt / 6.0) * (k1 + 2 * k2 + 2 * k3 + k4)
        t2 = t + dt
        if pv2[2] < R and pv2[5] < 0.0:
            # crossed the table plane going down: locate impact by lerp
            a_ = (p[2] - R) / max(p[2] - pv2[2], 1e-12)
            tc = t + a_ * dt
            pc = p + a_ * (pv2[:3] - p)
            vc = v + a_ * (pv2[3:] - v)
            on_table = (0.0 <= pc[0] <= TABLE_L) and (0.0 <= pc[1] <= TABLE_W)
            v_new, w_new = bounce(vc, w)
            bounces.append(dict(t=tc, x=pc[0], y=pc[1], v_in=vc.copy(),
                                v_out=v_new.copy(), w_in=w.copy(),
                                w_out=w_new.copy(), on_table=on_table))
            p = pc.copy(); p[2] = R
            v, w = v_new, w_new
            t = tc
            if not on_table or len(bounces) >= max_bounces:
                ts.append(t); ps.append(p.copy()); vs.append(v.copy())
                break
        else:
            p, v = pv2[:3], pv2[3:]
            t = t2
        ts.append(t); ps.append(p.copy()); vs.append(v.copy())
        if stop_below is not None and p[2] < stop_below:
            break
    return dict(t=np.array(ts), p=np.array(ps), v=np.array(vs), bounces=bounces)

# --- camera ---------------------------------------------------------------

def look_at(cam_pos, target, up=np.array([0.0, 0.0, 1.0])):
    fwd = target - cam_pos
    fwd = fwd / np.linalg.norm(fwd)
    right = np.cross(fwd, up); right /= np.linalg.norm(right)
    down = np.cross(fwd, right)   # image y grows downward
    Rw2c = np.stack([right, down, fwd])   # rows
    return Rw2c

class Camera:
    def __init__(self, pos, target, fx=1400.0, w=1920, h=1080):
        self.pos = np.asarray(pos, float)
        self.Rw2c = look_at(self.pos, np.asarray(target, float))
        self.fx = fx
        self.cx, self.cy = w / 2.0, h / 2.0
        self.w, self.h = w, h

    def project(self, pw):
        pc = self.Rw2c @ (np.asarray(pw, float) - self.pos)
        if pc[2] <= 0.05:
            return None
        return np.array([self.fx * pc[0] / pc[2] + self.cx,
                         self.fx * pc[1] / pc[2] + self.cy])

    def homography(self):
        """H mapping table-plane (x, y, 1) -> pixel (u, v, 1)."""
        import numpy.linalg as la
        src = []
        dst = []
        for (x, y) in [(0, 0), (TABLE_L, 0), (TABLE_L, TABLE_W), (0, TABLE_W)]:
            px = self.project(np.array([x, y, 0.0]))
            src.append([x, y]); dst.append(px)
        src = np.array(src, float); dst = np.array(dst, float)
        # DLT
        rows = []
        for (x, y), (u, v) in zip(src, dst):
            rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y, -u])
            rows.append([0, 0, 0, x, y, 1, -v * x, -v * y, -v])
        _, _, Vt = la.svd(np.array(rows))
        H = Vt[-1].reshape(3, 3)
        return H / H[2, 2]

class CameraRT:
    """Camera from explicit rotation (world->cam) and position."""
    def __init__(self, Rw2c, pos, fx, w=1920, h=1080):
        self.Rw2c = Rw2c
        self.pos = pos
        self.fx = fx
        self.cx, self.cy = w / 2.0, h / 2.0
        self.w, self.h = w, h
    project = Camera.project
    homography = Camera.homography

def camera_from_H(H, fx, w=1920, h=1080):
    """Recover full camera pose from the table-plane homography plus
    assumed intrinsics — the production-realistic path (quad + iPhone
    focal length). H maps (x, y, 1) on the table plane to pixels."""
    K = np.array([[fx, 0, w / 2.0], [0, fx, h / 2.0], [0, 0, 1.0]])
    M = np.linalg.inv(K) @ H
    l1, l2 = np.linalg.norm(M[:, 0]), np.linalg.norm(M[:, 1])
    lam = 2.0 / (l1 + l2)
    r1 = M[:, 0] * lam
    r2 = M[:, 1] * lam
    t = M[:, 2] * lam
    if t[2] < 0:                      # table must be in front of camera
        r1, r2, t = -r1, -r2, -t
    r3 = np.cross(r1, r2)
    R = np.stack([r1, r2, r3], axis=1)
    # nearest rotation matrix
    U, _, Vt = np.linalg.svd(R)
    R = U @ Vt
    if np.linalg.det(R) < 0:
        R = U @ np.diag([1, 1, -1]) @ Vt
    Rw2c = R
    pos = -R.T @ t
    return CameraRT(Rw2c, pos, fx, w, h)

def sample_side_camera(rng, side=+1):
    """Side-on-ish camera like PongLens guidance: a few metres from the
    side line, phone height chest-to-tripod, small yaw jitter."""
    d = rng.uniform(2.2, 4.5)              # distance from table side
    along = rng.uniform(0.7, 2.0)          # position along table length
    height = rng.uniform(1.0, 2.0)
    y = -d if side > 0 else TABLE_W + d
    pos = np.array([along, y, height])
    target = np.array([TABLE_L / 2 + rng.uniform(-0.4, 0.4),
                       TABLE_W / 2, rng.uniform(0.0, 0.4)])
    fx = rng.uniform(1250.0, 1600.0)       # iPhone wide-ish at 1080p
    return Camera(pos, target, fx=fx)

def observe(traj, cam, rng, fps=30.0, px_noise=2.0, p_drop=0.15,
            blur_extra=True):
    """Sample the dense trajectory at camera frame instants.
    Returns list of (t, u_px, v_px, p_true) for frames with a detection."""
    t0 = rng.uniform(0.0, 1.0 / fps)       # phase
    out = []
    t_end = traj["t"][-1]
    k = 0
    tq = t0
    while tq <= t_end:
        i = np.searchsorted(traj["t"], tq)
        i = min(i, len(traj["t"]) - 1)
        p = traj["p"][i]
        v = traj["v"][i]
        px = cam.project(p)
        if px is not None and 0 <= px[0] < cam.w and 0 <= px[1] < cam.h:
            if rng.uniform() > p_drop:
                sigma = px_noise
                if blur_extra:
                    # motion blur grows noise with image-plane speed
                    dist = np.linalg.norm(p - cam.pos)
                    px_per_s = cam.fx * np.linalg.norm(v) / max(dist, 0.5)
                    # streak length at 1/120 s shutter, centroid jitter ~ len/6
                    streak = px_per_s / 120.0
                    sigma = np.hypot(px_noise, streak / 6.0)
                obs = px + rng.normal(0.0, sigma, 2)
                out.append(dict(t=tq, px=obs, p_true=p.copy(), sigma=sigma))
        tq += 1.0 / fps
        k += 1
    return out

def image_to_table(H_inv, px):
    q = H_inv @ np.array([px[0], px[1], 1.0])
    return q[:2] / q[2]

"""Generate a labeled dataset of simulated serves observed at 30 FPS.

Each sample: a legal-ish serve (first bounce on server half, second on
receiver half after clearing the net region), a randomized side-on
camera, 30 fps pixel observations with noise/dropout, the plane
homography, and ground-truth spin.

Labels:
  topback in {top, none, back}   (component along axis perp. to flight, horizontal)
  side    in {L, none, R}        (component about vertical axis)
  strength in {light, med, heavy} by |w| (rps): 15-35 / 35-65 / 65-110
"""
import numpy as np
import json
import sys
from sim import (simulate, sample_side_camera, observe, image_to_table,
                 TABLE_L, TABLE_W, NET_H, R)

RPS = 2 * np.pi

def sample_spin(rng):
    topback = rng.choice(["top", "none", "back"])
    side = rng.choice(["L", "none", "R"])
    if topback == "none" and side == "none":
        strength = "none"
        mag = rng.uniform(0.0, 8.0) * RPS      # residual wobble
    else:
        strength = rng.choice(["light", "med", "heavy"])
        lo, hi = dict(light=(15, 35), med=(35, 65), heavy=(65, 110))[strength]
        mag = rng.uniform(lo, hi) * RPS
    # axis: combine topback (horizontal, perp to flight) and side (vertical)
    a = np.zeros(3)
    if topback == "top":
        a[1] = 1.0
    elif topback == "back":
        a[1] = -1.0
    if side == "L":
        a[2] = 1.0
    elif side == "R":
        a[2] = -1.0
    if np.linalg.norm(a) < 1e-9:
        a = rng.normal(0, 1, 3)               # random axis for "none"
    a = a / np.linalg.norm(a)
    # jitter the axis ~12 deg
    j = rng.normal(0, 0.2, 3)
    a = a + j
    a = a / np.linalg.norm(a)
    return topback, side, strength, mag, a

def spin_world(axis_local, heading):
    """axis_local: y = left-of-flight (topspin +), z = up (side L +).
    Rotate into world by flight heading (about z)."""
    c, s = np.cos(heading), np.sin(heading)
    Rz = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
    # local frame: x' = flight dir, y' = left of flight, z' = up
    return Rz @ axis_local

def sample_serve(rng):
    """Serve from near end (x~0) toward +x, or reversed. Returns traj or None."""
    reverse = rng.uniform() < 0.5
    x0 = rng.uniform(-0.30, 0.05)
    y0 = rng.uniform(0.15, TABLE_W - 0.15)
    z0 = rng.uniform(0.20, 0.45)
    heading = rng.uniform(-0.35, 0.35)        # radians, mostly along +x
    speed = rng.uniform(2.8, 7.5)
    vx = speed * np.cos(heading)
    vy = speed * np.sin(heading)
    vz = rng.uniform(-2.2, 0.8)
    topback, side, strength, mag, axis_local = sample_spin(rng)
    w = mag * spin_world(axis_local, heading)
    p0 = np.array([x0, y0, z0 + 0.0])         # z above table plane
    v0 = np.array([vx, vy, vz])
    tr = simulate(p0, np.array([vx, vy, vz]), w, t_max=2.2, dt=1.5e-3)
    bl = [b for b in tr["bounces"]]
    if len(bl) < 2:
        return None
    b1, b2 = bl[0], bl[1]
    if not (b1["on_table"] and b1["x"] < TABLE_L / 2 - 0.05):
        return None
    if not (b2["on_table"] and b2["x"] > TABLE_L / 2 + 0.05):
        return None
    if reverse:
        # mirror world through table centre (x -> L-x, y -> W-y)
        tr["p"][:, 0] = TABLE_L - tr["p"][:, 0]
        tr["p"][:, 1] = TABLE_W - tr["p"][:, 1]
        tr["v"][:, :2] *= -1
        for b in bl:
            b["x"] = TABLE_L - b["x"]; b["y"] = TABLE_W - b["y"]
            b["v_in"][:2] *= -1; b["v_out"][:2] *= -1
        # spin: w_z unchanged by 180deg rotation about z? Rotation by pi
        # about z: (wx,wy,wz) -> (-wx,-wy,wz). Labels are flight-relative
        # so topback/side stay the same.
    return dict(traj=tr, b1=b1, b2=b2, w=w, labels=dict(
        topback=topback, side=side, strength=strength,
        mag_rps=mag / RPS), reverse=reverse)

def build(n, seed=0, px_noise=2.0, p_drop=0.15, out_path=None):
    rng = np.random.default_rng(seed)
    samples = []
    tries = 0
    while len(samples) < n and tries < n * 20:
        tries += 1
        s = sample_serve(rng)
        if s is None:
            continue
        cam = sample_side_camera(rng, side=+1 if rng.uniform() < 0.5 else -1)
        obs = observe(s["traj"], cam, rng, px_noise=px_noise, p_drop=p_drop)
        if len(obs) < 6:
            continue
        H = cam.homography()
        Hinv = np.linalg.inv(H)
        rec = dict(
            labels=s["labels"],
            w_true=s["w"].tolist(),
            b1=dict(t=s["b1"]["t"], x=s["b1"]["x"], y=s["b1"]["y"],
                    v_in=s["b1"]["v_in"].tolist(), v_out=s["b1"]["v_out"].tolist()),
            b2=dict(t=s["b2"]["t"], x=s["b2"]["x"], y=s["b2"]["y"],
                    v_in=s["b2"]["v_in"].tolist(), v_out=s["b2"]["v_out"].tolist()),
            obs=[dict(t=o["t"], px=o["px"].tolist(),
                      p_true=o["p_true"].tolist()) for o in obs],
            H=H.tolist(),
            cam=dict(pos=cam.pos.tolist(), fx=cam.fx),
        )
        samples.append(rec)
        if len(samples) % 250 == 0:
            print(f"  {len(samples)}/{n} (tries {tries})", flush=True)
    if out_path:
        with open(out_path, "w") as f:
            json.dump(samples, f)
    return samples

if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
    out = sys.argv[2] if len(sys.argv) > 2 else "out/serves.json"
    build(n, out_path=out)
    print("done")

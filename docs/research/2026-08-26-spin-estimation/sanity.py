"""Smoke tests: does the physics reproduce known table tennis behavior,
and what does the 30 FPS frame budget look like for realistic shots."""
import numpy as np
from sim import simulate, TABLE_L, TABLE_W, R

def shot(vx, vz, wy, y=TABLE_W/2, x0=0.1, z0=0.35, wz=0.0):
    """Launch toward +x. wy>0 topspin, wy<0 backspin, wz sidespin."""
    return simulate(np.array([x0, y, z0]), np.array([vx, 0.0, vz]),
                    np.array([0.0, wy, wz]))

print("=== bounce response vs spin (ball arriving at bounce) ===")
print(f"{'case':<22}{'v_in_x':>8}{'v_out_x':>9}{'ratio':>7}{'v_out_z':>9}")
for name, wy in [("heavy topspin +100rps", 2*np.pi*100),
                 ("medium topspin +50rps", 2*np.pi*50),
                 ("no spin", 0.0),
                 ("medium backspin -50rps", -2*np.pi*50),
                 ("heavy backspin -100rps", -2*np.pi*100)]:
    tr = shot(6.0, -1.0, wy)
    if tr["bounces"]:
        b = tr["bounces"][0]
        print(f"{name:<22}{b['v_in'][0]:>8.2f}{b['v_out'][0]:>9.2f}"
              f"{b['v_out'][0]/b['v_in'][0]:>7.2f}{b['v_out'][2]:>9.2f}")

print()
print("=== sidespin lateral kick at bounce ===")
for name, wz in [("right side +60rps", 2*np.pi*60), ("none", 0.0),
                 ("left side -60rps", -2*np.pi*60)]:
    tr = shot(6.0, -1.0, 0.0, wz=wz)
    if tr["bounces"]:
        b = tr["bounces"][0]
        import math
        h_in = math.degrees(math.atan2(b["v_in"][1], b["v_in"][0]))
        h_out = math.degrees(math.atan2(b["v_out"][1], b["v_out"][0]))
        print(f"{name:<18} heading in {h_in:6.1f} deg -> out {h_out:6.1f} deg"
              f"  (kick {h_out-h_in:+.1f})")

print()
print("=== Magnus effect on flight (drop over 1.37 m of travel) ===")
for name, wy in [("topspin +80rps", 2*np.pi*80), ("no spin", 0.0),
                 ("backspin -80rps", -2*np.pi*80)]:
    tr = simulate(np.array([0.1, TABLE_W/2, 0.30]),
                  np.array([8.0, 0.0, 0.5]), np.array([0.0, wy, 0.0]))
    # height when x crosses mid-table
    i = np.searchsorted(tr["p"][:, 0], 0.1 + 1.37)
    if i < len(tr["p"]):
        print(f"{name:<16} z at +1.37m: {tr['p'][i,2]:.3f} m "
              f"(t={tr['t'][i]*1000:.0f} ms)")

print()
print("=== 30 FPS frame budget ===")
print("shot type          speed   dist to bounce   flight time   frames@30")
cases = [("slow serve",      5.0, 0.8), ("fast serve",     9.0, 1.2),
         ("push",            4.5, 1.3), ("drive",         12.0, 1.8),
         ("loop",            17.0, 2.0), ("smash",         25.0, 2.3)]
for name, v, d in cases:
    tt = d / v
    print(f"{name:<18}{v:>5.1f}m/s {d:>10.1f}m {tt*1000:>12.0f}ms"
          f"{tt*30:>10.1f}")

print()
print("=== serve hop: bounce1 -> bounce2 observations at 30fps ===")
tr = shot(4.2, -0.8, -2*np.pi*40, z0=0.30)   # backspin serve
bl = tr["bounces"]
if len(bl) >= 2:
    hop = bl[1]["t"] - bl[0]["t"]
    print(f"backspin serve: hop duration {hop*1000:.0f} ms = {hop*30:.1f} frames,"
          f" b1 x={bl[0]['x']:.2f}, b2 x={bl[1]['x']:.2f}")
tr = shot(5.5, -0.5, 2*np.pi*40, z0=0.30)    # topspin serve
bl = tr["bounces"]
if len(bl) >= 2:
    hop = bl[1]["t"] - bl[0]["t"]
    print(f"topspin serve:  hop duration {hop*1000:.0f} ms = {hop*30:.1f} frames,"
          f" b1 x={bl[0]['x']:.2f}, b2 x={bl[1]['x']:.2f}")

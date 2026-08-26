"""Better report figures: joint bounce-plane physics view + real data."""
import json
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

def fig_bounce_plane(recs, path="out/fig_bounce_plane.png"):
    """Horizontal speed in vs out of bounce 1, colored by top/back —
    the physics signal at its cleanest (true velocities)."""
    fig, axes = plt.subplots(1, 2, figsize=(12.5, 4.6))
    ax = axes[0]
    colors = dict(top="tab:red", none="tab:gray", back="tab:blue")
    for cls in ["none", "top", "back"]:
        xs, ys = [], []
        for r in recs:
            if r["labels"]["topback"] != cls or r["labels"]["side"] != "none":
                continue
            vi = r["b1"]["v_in"]; vo = r["b1"]["v_out"]
            xs.append(np.hypot(vi[0], vi[1]))
            ys.append(np.hypot(vo[0], vo[1]))
        ax.scatter(xs, ys, s=8, alpha=0.5, c=colors[cls], label=cls)
    lim = [0, 8]
    ax.plot(lim, lim, "k--", lw=0.8, alpha=0.5)
    ax.set_xlim(lim); ax.set_ylim(lim)
    ax.set_xlabel("horizontal speed INTO bounce 1 (m/s)")
    ax.set_ylabel("horizontal speed OUT of bounce 1 (m/s)")
    ax.set_title("what the bounce knows (true velocities)", fontsize=11)
    ax.legend(title="serve spin")

    ax = axes[1]
    from features import extract
    for cls in ["none", "top", "back"]:
        xs, ys = [], []
        for r in recs[:1500]:
            if r["labels"]["topback"] != cls or r["labels"]["side"] != "none":
                continue
            f = extract(r)
            if f["pre1_speed"] and f["post1_speed"] and \
               not np.isnan(f["pre1_speed"]) and not np.isnan(f["post1_speed"]):
                xs.append(f["pre1_speed"]); ys.append(f["post1_speed"])
        ax.scatter(xs, ys, s=8, alpha=0.5, c=colors[cls], label=cls)
    ax.plot(lim, lim, "k--", lw=0.8, alpha=0.5)
    ax.set_xlim(lim); ax.set_ylim(lim)
    ax.set_xlabel("measured ground speed before bounce (m/s)")
    ax.set_ylabel("measured ground speed after bounce (m/s)")
    ax.set_title("same signal at 30 fps + noise + homography", fontsize=11)
    plt.tight_layout()
    plt.savefig(path, dpi=140)
    print("wrote", path)

def fig_real(path="out/fig_real.png"):
    rows = json.load(open("out/real_scale.json"))
    labeled = [r for r in json.load(open("out/real_features_clean.json"))
               if r.get("ok") and r.get("ratio1")]
    fig, ax = plt.subplots(figsize=(9, 4.2))
    r = np.array([x["ratio1"] for x in rows])
    ax.hist(r, bins=np.arange(0, 1.7, 0.1), color="#8fb4d9",
            edgecolor="white", label="detector serves, 4 matches (n=35)")
    for i, x in enumerate(labeled):
        ax.axvline(x["ratio1"], color="tab:blue", lw=2, alpha=0.8,
                   label="hand-labeled backspin serve" if i == 0 else None)
    ax.axvspan(0.0, 0.55, color="tab:blue", alpha=0.06)
    ax.axvspan(0.95, 1.6, color="tab:red", alpha=0.06)
    ax.text(0.22, 7.6, "backspin band\n(physics)", fontsize=9,
            color="tab:blue", ha="center")
    ax.text(1.25, 7.6, "topspin band\n(physics)", fontsize=9,
            color="tab:red", ha="center")
    ax.set_xlabel("ground-speed ratio across the serve's first bounce (post/pre)")
    ax.set_ylabel("serves")
    ax.set_title("real 30 fps footage: bounce speed ratios, clean measurements",
                 fontsize=11)
    ax.legend(loc="upper right", fontsize=8)
    per = {}
    for x in rows:
        per.setdefault(x["key"], []).append(x["ratio1"])
    txt = "\n".join(f"{k}: median {np.median(v):.2f} (n={len(v)})"
                    for k, v in per.items())
    ax.text(0.985, 0.55, txt, transform=ax.transAxes, fontsize=8,
            va="top", ha="right", family="monospace",
            bbox=dict(fc="white", ec="#ccc"))
    plt.tight_layout()
    plt.savefig(path, dpi=140)
    print("wrote", path)

if __name__ == "__main__":
    recs = json.load(open("out/serves.json"))
    fig_bounce_plane(recs)
    fig_real()

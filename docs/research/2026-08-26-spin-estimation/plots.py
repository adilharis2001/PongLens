"""Figures for the spin study report."""
import json
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from features import ground_track, extract
from sim import TABLE_L, TABLE_W

def table_outline(ax):
    ax.plot([0, TABLE_L, TABLE_L, 0, 0], [0, 0, TABLE_W, TABLE_W, 0],
            color="#333", lw=1.2)
    ax.plot([TABLE_L / 2, TABLE_L / 2], [0, TABLE_W], color="#777",
            lw=1.0, ls="--")
    ax.set_aspect("equal")
    ax.set_xlim(-0.6, TABLE_L + 0.6)
    ax.set_ylim(-0.45, TABLE_W + 0.45)

def fig_tracks(recs, path="out/fig_tracks.png"):
    fig, axes = plt.subplots(1, 3, figsize=(15, 3.4))
    cases = [("topback", "top", "tab:red", "topspin"),
             ("topback", "back", "tab:blue", "backspin"),
             ("side", "L", "tab:green", "left sidespin")]
    for ax, (key, val, color, title) in zip(axes, cases):
        table_outline(ax)
        n = 0
        for r in recs:
            L = r["labels"]
            if L[key] != val or L["strength"] not in ("med", "heavy"):
                continue
            other = "side" if key == "topback" else "topback"
            if L[other] != "none":
                continue
            ts, gs = ground_track(r)
            m = (ts >= r["b1"]["t"] - 0.2) & (ts <= r["b2"]["t"] + 0.35)
            ax.plot(gs[m, 0], gs[m, 1], "-o", color=color, ms=2.5,
                    lw=0.8, alpha=0.55)
            ax.plot(r["b1"]["x"], r["b1"]["y"], "k^", ms=5)
            ax.plot(r["b2"]["x"], r["b2"]["y"], "kv", ms=5)
            n += 1
            if n >= 8:
                break
        ax.set_title(f"{title} (homography ground tracks)", fontsize=10)
    plt.tight_layout()
    plt.savefig(path, dpi=140)
    print("wrote", path)

def fig_features(recs, path="out/fig_features.png"):
    rows = []
    for r in recs:
        f = extract(r)
        f["labels"] = r["labels"]
        rows.append(f)
    fig, axes = plt.subplots(1, 3, figsize=(15, 3.6))

    ax = axes[0]
    for val, color in [("top", "tab:red"), ("none", "tab:gray"),
                       ("back", "tab:blue")]:
        xs = [f["ratio1"] for f in rows
              if f["labels"]["topback"] == val and not np.isnan(f["ratio1"])]
        ax.hist(xs, bins=np.linspace(0, 2.2, 40), alpha=0.55, label=val,
                color=color, density=True)
    ax.set_xlabel("ground-speed ratio across bounce 1 (post/pre)")
    ax.legend(); ax.set_title("bounce speed ratio by top/back", fontsize=10)

    ax = axes[1]
    for val, color in [("L", "tab:green"), ("none", "tab:gray"),
                       ("R", "tab:orange")]:
        xs = [f["curv_hop"] for f in rows
              if f["labels"]["side"] == val and not np.isnan(f["curv_hop"])]
        ax.hist(xs, bins=np.linspace(-0.12, 0.12, 40), alpha=0.55,
                label=val, color=color, density=True)
    ax.set_xlabel("signed hop curvature (left of travel +)")
    ax.legend(); ax.set_title("flight curvature by sidespin", fontsize=10)

    ax = axes[2]
    for val, color in [("light", "#bbd"), ("med", "#88b"), ("heavy", "#225")]:
        xs = [f["labels"] and f["ratio1"] for f in rows
              if f["labels"]["strength"] == val
              and f["labels"]["topback"] == "top"
              and not np.isnan(f["ratio1"])]
        ax.hist(xs, bins=np.linspace(0.4, 2.2, 30), alpha=0.6, label=val,
                color=color, density=True)
    ax.set_xlabel("bounce-1 speed ratio (topspin serves)")
    ax.legend(); ax.set_title("strength separation, topspin", fontsize=10)
    plt.tight_layout()
    plt.savefig(path, dpi=140)
    print("wrote", path)

if __name__ == "__main__":
    recs = json.load(open("out/serves.json"))
    fig_tracks(recs)
    fig_features(recs)

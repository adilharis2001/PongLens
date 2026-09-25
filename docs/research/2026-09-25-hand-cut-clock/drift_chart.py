"""drift.svg for REPAIR-PLAN.md: how far each point's published position
runs ahead of the real video, point by point, for every live hand cut.

    worker/venv/bin/python -B drift_chart.py
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
data = json.loads((HERE / "measurements.json").read_text())

W, H = 760, 360
L, R, T, B = 64, 160, 28, 48
X_MAX, Y_MAX = 100, 0.65
LONG = {"623c09c6": "#2563eb", "7ba06eb1": "#d97706",
        "06deeba4": "#059669", "9acef67c": "#dc2626"}
SHORT = "#9ca3af"


def x(i):
    return L + (W - L - R) * i / X_MAX


def y(v):
    return T + (H - T - B) * (1 - v / Y_MAX)


parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
         f'font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="12">',
         f'<rect width="{W}" height="{H}" fill="#ffffff"/>']
for v in (0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6):
    parts.append(f'<line x1="{L}" x2="{W - R}" y1="{y(v):.1f}" y2="{y(v):.1f}" '
                 f'stroke="#e5e7eb"/>')
    parts.append(f'<text x="{L - 8}" y="{y(v) + 4:.1f}" text-anchor="end" '
                 f'fill="#374151">{v:.1f} s</text>')
for i in (1, 20, 40, 60, 80, 99):
    parts.append(f'<text x="{x(i):.1f}" y="{H - B + 18}" text-anchor="middle" '
                 f'fill="#374151">{i}</text>')
parts.append(f'<text x="{(L + W - R) / 2:.1f}" y="{H - 10}" text-anchor="middle" '
             f'fill="#111827">point number in the match</text>')
parts.append(f'<text x="{L}" y="16" fill="#111827">published position is this far '
             f'EARLY against the real video</text>')
# The line where a clip starts on the previous kept moment.
parts.append(f'<line x1="{L}" x2="{W - R}" y1="{y(0.15):.1f}" y2="{y(0.15):.1f}" '
             f'stroke="#111827" stroke-dasharray="4 4"/>')
parts.append(f'<text x="{W - R + 6}" y="{y(0.15) + 4:.1f}" fill="#111827">'
             f'clip opens on</text>')
parts.append(f'<text x="{W - R + 6}" y="{y(0.15) + 18:.1f}" fill="#111827">'
             f'the previous moment</text>')
for key, detail in data["detail"].items():
    pts = detail["point_drift"]
    colour = LONG.get(key, SHORT)
    path = " ".join(f"{'M' if i == 0 else 'L'}{x(i + 1):.1f},{y(v):.1f}"
                    for i, v in enumerate(pts))
    parts.append(f'<path d="{path}" fill="none" stroke="{colour}" '
                 f'stroke-width="{2 if key in LONG else 1.5}"/>')
    if key in LONG:
        last = len(pts)
        # Labels sit in the right margin at each line's final height, so
        # they never cross another line.
        parts.append(f'<line x1="{x(last):.1f}" x2="{W - R + 2}" '
                     f'y1="{y(pts[-1]):.1f}" y2="{y(pts[-1]):.1f}" '
                     f'stroke="{colour}" stroke-dasharray="1 3"/>')
        parts.append(f'<text x="{W - R + 6}" y="{y(pts[-1]) + 4:.1f}" '
                     f'fill="{colour}">{key} ({pts[-1]:.2f} s)</text>')
parts.append(f'<text x="{x(26):.1f}" y="{y(0.02) - 6:.1f}" fill="#6b7280">'
             f'four short hand cuts, under 0.1 s</text>')
parts.append("</svg>")
(HERE / "drift.svg").write_text("\n".join(parts) + "\n")
print("wrote", HERE / "drift.svg")

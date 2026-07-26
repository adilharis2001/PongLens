#!/usr/bin/env python3
"""Render a local-only placement-v2 versus placement-v3 match report."""

from __future__ import annotations

import argparse
import html
import json
import math
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Mapping, Sequence

import cv2
import numpy as np


REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from worker.placement_reconstruction import reconstruct_placement  # noqa: E402
from worker.points_pipeline import Px, fit_play  # noqa: E402


W_M = 1.525
L_M = 2.74
NET_V = L_M / 2.0
SVG_W = 240
SVG_H = 360
TABLE_X = 40
TABLE_Y = 36
TABLE_W = 160
TABLE_H = 280


def load_detections(path: Path) -> dict[int, tuple[float, float]]:
    detections = {}
    with path.open() as handle:
        for line in handle:
            record = json.loads(line)
            if record.get("x") is not None and record.get("y") is not None:
                detections[int(record["f"])] = (
                    float(record["x"]),
                    float(record["y"]),
                )
    return detections


def calibration_matrix(calibration: Mapping[str, Any]) -> np.ndarray:
    corners = calibration["table_corners_px"]
    source = np.asarray(
        [
            corners["A_near_1"],
            corners["B_near_2"],
            corners["C_far_2"],
            corners["D_far_1"],
        ],
        dtype=np.float32,
    )
    destination = np.asarray(
        [[0.0, 0.0], [W_M, 0.0], [W_M, L_M], [0.0, L_M]],
        dtype=np.float32,
    )
    return cv2.getPerspectiveTransform(source, destination)


def _svg_point(u: float, v: float) -> tuple[float, float]:
    x = TABLE_X + TABLE_W * float(u) / W_M
    y = TABLE_Y + TABLE_H * (1.0 - float(v) / L_M)
    return (
        min(max(x, TABLE_X - 14), TABLE_X + TABLE_W + 14),
        min(max(y, TABLE_Y - 16), TABLE_Y + TABLE_H + 16),
    )


def _svg_shell(content: str, status: str | None = None) -> str:
    status_text = (
        f'<text x="120" y="18" text-anchor="middle" '
        f'font-size="11" font-weight="700" fill="#a1a1aa">'
        f"{html.escape(status or '')}</text>"
        if status
        else ""
    )
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SVG_W} {SVG_H}">
<rect width="{SVG_W}" height="{SVG_H}" rx="12" fill="#111119"/>
{status_text}
<rect x="{TABLE_X}" y="{TABLE_Y}" width="{TABLE_W}" height="{TABLE_H}" rx="5"
 fill="#0f2557" stroke="#cbd5e1" stroke-width="2"/>
<line x1="{TABLE_X}" y1="{TABLE_Y + TABLE_H / 2}" x2="{TABLE_X + TABLE_W}"
 y2="{TABLE_Y + TABLE_H / 2}" stroke="#f8fafc" stroke-width="2.5"
 stroke-dasharray="5 3"/>
<line x1="{TABLE_X + TABLE_W / 2}" y1="{TABLE_Y}"
 x2="{TABLE_X + TABLE_W / 2}" y2="{TABLE_Y + TABLE_H}"
 stroke="#64748b" stroke-width="1"/>
{content}
<text x="120" y="338" text-anchor="middle" font-size="11" fill="#a1a1aa">near</text>
<text x="120" y="32" text-anchor="middle" font-size="11" fill="#a1a1aa">far</text>
</svg>"""


def render_v2_svg(point: Mapping[str, Any]) -> str:
    placement = point.get("placement") or {}
    bounces = placement.get("bounces") or []
    content = []
    previous = None
    for index, bounce in enumerate(bounces):
        if bounce.get("role") == "serve_1":
            continue
        current = _svg_point(bounce["u"], bounce["v"])
        color = "#22d3ee" if bounce.get("hitter_side") == "near" else "#f59e0b"
        if previous is not None:
            content.append(
                f'<line x1="{previous[0]:.1f}" y1="{previous[1]:.1f}" '
                f'x2="{current[0]:.1f}" y2="{current[1]:.1f}" '
                f'stroke="{color}" stroke-width="2" opacity=".78"/>'
            )
        content.append(
            f'<circle cx="{current[0]:.1f}" cy="{current[1]:.1f}" r="5" '
            f'fill="{color}" stroke="#0c1222"/>'
        )
        previous = current
    return _svg_shell("".join(content), "Current v2")


def render_v3_svg(
    hypothesis: Mapping[str, Any],
    server_side: str,
) -> str:
    if hypothesis.get("status") == "unavailable":
        message = (
            '<text x="120" y="172" text-anchor="middle" font-size="12" '
            'font-weight="700" fill="#d4d4d8">Trajectory unavailable</text>'
            '<text x="120" y="192" text-anchor="middle" font-size="10" '
            'fill="#a1a1aa">insufficient reliable evidence</text>'
        )
        status = (
            f"Placement v3 · unavailable · "
            f"{float(hypothesis.get('confidence', 0)):.0%}"
        )
        return _svg_shell(message, status)

    hard_reasons = hypothesis.get("hard_reasons") or []
    if hard_reasons:
        message = (
            '<text x="120" y="172" text-anchor="middle" font-size="12" '
            'font-weight="700" fill="#fde68a">Trajectory suppressed</text>'
            '<text x="120" y="192" text-anchor="middle" font-size="10" '
            'fill="#a1a1aa">hard sequence contradiction</text>'
        )
        status = (
            f"Placement v3 · review · "
            f"{float(hypothesis.get('confidence', 0)):.0%}"
        )
        return _svg_shell(message, status)

    content = []
    previous = None
    shots = hypothesis.get("shots") or []
    for index, shot in enumerate(shots):
        landing = shot.get("landing")
        color = "#22d3ee" if shot.get("hitter_side") == "near" else "#f59e0b"
        if shot.get("phase") == "serve" and landing:
            previous = _svg_point(
                W_M / 2,
                0.0 if server_side == "near" else L_M,
            )
        current = (
            _svg_point(landing["u"], landing["v"])
            if landing
            and landing.get("u") is not None
            and landing.get("v") is not None
            else None
        )
        if previous is not None and current is not None:
            content.append(
                f'<line x1="{previous[0]:.1f}" y1="{previous[1]:.1f}" '
                f'x2="{current[0]:.1f}" y2="{current[1]:.1f}" '
                f'stroke="{color}" stroke-width="2" opacity=".82"/>'
            )
        if current is not None:
            content.append(
                f'<circle cx="{current[0]:.1f}" cy="{current[1]:.1f}" '
                f'r="5" fill="{color}" stroke="#0c1222"/>'
            )
            content.append(
                f'<text x="{current[0]:.1f}" y="{current[1] + 2.5:.1f}" '
                f'text-anchor="middle" font-size="7" fill="#0c1222" '
                f'font-weight="800">{"S" if index == 0 else index + 1}</text>'
            )

        terminal = shot.get("terminal")
        terminal_anchor = current or previous
        if terminal and terminal_anchor:
            if terminal.get("kind") == "net":
                terminal_end = (terminal_anchor[0], TABLE_Y + TABLE_H / 2)
            else:
                receiver = "far" if shot.get("hitter_side") == "near" else "near"
                edge = _svg_point(
                    landing.get("u", W_M / 2) if landing else W_M / 2,
                    L_M if receiver == "far" else 0.0,
                )
                terminal_end = (
                    edge[0],
                    edge[1] - 12 if receiver == "far" else edge[1] + 12,
                )
            content.append(
                f'<line x1="{terminal_anchor[0]:.1f}" '
                f'y1="{terminal_anchor[1]:.1f}" x2="{terminal_end[0]:.1f}" '
                f'y2="{terminal_end[1]:.1f}" stroke="#f87171" '
                f'stroke-width="1.7" stroke-dasharray="3 2.5"/>'
            )
            x, y = terminal_end
            content.append(
                f'<path d="M{x - 4:.1f} {y - 4:.1f} L{x + 4:.1f} {y + 4:.1f} '
                f'M{x - 4:.1f} {y + 4:.1f} L{x + 4:.1f} {y - 4:.1f}" '
                f'stroke="#f87171" stroke-width="2"/>'
            )
        previous = current or previous

    if shots and shots[-1].get("landing") and not shots[-1].get("terminal"):
        final = shots[-1]["landing"]
        if final.get("u") is not None and final.get("v") is not None:
            x, y = _svg_point(final["u"], final["v"])
            content.append(
                f'<circle cx="{x:.1f}" cy="{y:.1f}" r="8" fill="none" '
                f'stroke="#34d399" stroke-width="2.5"/>'
            )
    status = (
        f"Placement v3 · {hypothesis.get('status', 'unavailable')} · "
        f"{float(hypothesis.get('confidence', 0)):.0%}"
    )
    return _svg_shell("".join(content), status)


def build_report(
    match: Mapping[str, Any],
    reconstructions: Sequence[Mapping[str, Any]],
) -> str:
    by_index = {int(item["idx"]): item for item in reconstructions}
    statuses = Counter(
        item["hypothesis"].get("status", "unavailable")
        for item in reconstructions
    )
    impossible = sum(
        1
        for item in reconstructions
        if item["hypothesis"].get("status") == "ready"
        and any(
            reason.startswith("serve_")
            and reason not in {"serve_incomplete"}
            for reason in item["hypothesis"].get("hard_reasons", [])
        )
    )
    hard_serve_contradictions = sum(
        1
        for item in reconstructions
        if any(
            reason.startswith("serve_")
            and reason != "serve_incomplete"
            for reason in item["hypothesis"].get("hard_reasons", [])
        )
    )
    rows = []
    for point in match.get("points", []):
        idx = int(point["idx"])
        item = by_index[idx]
        hypothesis = item["hypothesis"]
        reasons = hypothesis.get("reasons") or []
        reason_text = ", ".join(reason.replace("_", " ") for reason in reasons)
        v2_svg = render_v2_svg(point)
        rows.append(
            f"""<section class="point-row">
<header><h2>Point {idx}</h2><span class="badge {hypothesis.get('status')}">
{html.escape(hypothesis.get('status', 'unavailable'))}</span></header>
<p class="meta">Server: {html.escape(item['server_side'])}
 ({html.escape(item['selection_source'])}) · confidence
 {float(hypothesis.get('confidence', 0)):.0%}</p>
<div class="maps"><article><h3>Current v2</h3>{v2_svg}</article>
<article><h3>Placement v3</h3><img src="{html.escape(item['svg_file'])}"
 alt="Placement v3 for point {idx}"/></article></div>
<p class="reasons">{html.escape(reason_text or 'No reconstruction warnings.')}</p>
</section>"""
        )

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Vaibhab placement v2/v3 comparison</title>
<style>
body{{margin:0;background:#0d0d13;color:#e4e4e7;font:14px system-ui,sans-serif}}
main{{max-width:1100px;margin:auto;padding:28px 18px 60px}}
h1{{font-size:24px;margin:0 0 8px}} .summary{{color:#a1a1aa;margin-bottom:24px}}
.point-row{{border:1px solid #2a2a36;border-radius:16px;background:#15151e;
padding:18px;margin:16px 0}} header{{display:flex;align-items:center;gap:10px}}
h2{{font-size:17px;margin:0}} h3{{font-size:13px;color:#a1a1aa;text-align:center}}
.badge{{border-radius:999px;padding:3px 8px;font-size:11px;text-transform:uppercase}}
.ready{{background:#064e3b;color:#a7f3d0}} .review{{background:#78350f;color:#fde68a}}
.unavailable{{background:#3f3f46;color:#d4d4d8}} .meta,.reasons{{color:#a1a1aa}}
.maps{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}}
article{{min-width:0}} article svg,article img{{display:block;width:100%;max-width:280px;
margin:auto}} @media(max-width:620px){{.maps{{grid-template-columns:1fr}}}}
</style></head><body><main>
<h1>Placement reconstruction comparison</h1>
<p class="summary">{len(reconstructions)} points · {statuses['ready']} ready ·
 {statuses['review']} review · {statuses['unavailable']} unavailable ·
 {impossible} confidently impossible serves ·
 {hard_serve_contradictions} suppressed serve contradictions</p>
{''.join(rows)}
</main></body></html>"""


def _load_server_fixture(path: Path | None) -> tuple[dict[int, str], dict[int, list]]:
    if path is None:
        return {}, {}
    fixture = json.loads(path.read_text())
    servers = {
        int(point["idx"]): point["server_side"]
        for point in fixture.get("points", [])
    }
    impacts = {
        int(point["idx"]): point.get("audio_impacts", [])
        for point in fixture.get("points", [])
    }
    return servers, impacts


def _load_audio_candidates(path: Path | None) -> list[dict[str, float]]:
    if path is None:
        return []
    payload = json.loads(path.read_text())
    return [
        {
            "t": float(candidate.get("t", candidate.get("time_s"))),
            "confidence": float(candidate.get("confidence", 1.0)),
        }
        for candidate in payload.get("candidates", payload)
    ]


def _infer_server_from_v2(point: Mapping[str, Any]) -> str | None:
    placement = point.get("placement") or {}
    if placement.get("v") != 2:
        return None
    bounces = placement.get("bounces") or []
    serve = next(
        (
            bounce
            for bounce in bounces
            if bounce.get("role") in {"serve_1", "serve_2"}
        ),
        None,
    )
    return serve.get("hitter_side") if serve else None


def generate_report(
    match_path: Path,
    blurball_path: Path,
    output: Path,
    server_truth_path: Path | None = None,
    audio_path: Path | None = None,
) -> list[dict[str, Any]]:
    match = json.loads(match_path.read_text())
    detections = load_detections(blurball_path)
    source = match["source"]
    fps = float(source["fps"])
    width = int(source["width"])
    px = Px(width)
    H = calibration_matrix(match["calibration"])
    axis = tuple(float(value) for value in match["calibration"]["length_axis"])
    server_truth, fixture_impacts = _load_server_fixture(server_truth_path)
    full_audio = _load_audio_candidates(audio_path)
    reconstructions = []
    output.mkdir(parents=True, exist_ok=True)

    for point in match["points"]:
        idx = int(point["idx"])
        f0 = max(0, int(math.floor(float(point["t0"]) * fps)))
        f1 = int(math.ceil(float(point["t1"]) * fps)) + 1
        point_det = {
            frame: detections[frame]
            for frame in range(f0, f1)
            if frame in detections
        }
        track = fit_play(point_det, H, axis, f0, f1, fps, px) or {
            "segments": [],
            "bounces": [],
            "hits": [],
        }
        impacts = fixture_impacts.get(idx)
        if impacts is None:
            impacts = [
                impact
                for impact in full_audio
                if float(point["t0"]) <= impact["t"] <= float(point["t1"])
            ]
        placement = reconstruct_placement(
            point_det,
            H,
            axis,
            track,
            point.get("suggestion"),
            f0,
            f1,
            fps,
            width,
            impacts,
        )
        if idx in server_truth:
            server_side = server_truth[idx]
            selection_source = "narrated truth"
        else:
            server_side = _infer_server_from_v2(point)
            selection_source = "inferred from current v2"
            if server_side is None:
                server_side = max(
                    placement["hypotheses"],
                    key=lambda side: placement["hypotheses"][side]["confidence"],
                )
                selection_source = "inferred from v3 confidence"
        hypothesis = placement["hypotheses"][server_side]
        svg_file = f"point-{idx:02d}.svg"
        (output / svg_file).write_text(
            render_v3_svg(hypothesis, server_side) + "\n"
        )
        reconstructions.append(
            {
                "idx": idx,
                "server_side": server_side,
                "selection_source": selection_source,
                "hypothesis": hypothesis,
                "placement_v3": placement,
                "svg_file": svg_file,
            }
        )

    reconstructed_match = {
        "source_match_version": match.get("version"),
        "placement_version": 3,
        "points": reconstructions,
    }
    (output / "reconstructed-match.json").write_text(
        json.dumps(reconstructed_match, indent=2) + "\n"
    )
    (output / "index.html").write_text(build_report(match, reconstructions))
    return reconstructions


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--match-json", required=True, type=Path)
    parser.add_argument("--blurball", required=True, type=Path)
    parser.add_argument("--server-truth", type=Path)
    parser.add_argument("--audio-impacts", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    results = generate_report(
        args.match_json,
        args.blurball,
        args.output,
        server_truth_path=args.server_truth,
        audio_path=args.audio_impacts,
    )
    statuses = Counter(item["hypothesis"]["status"] for item in results)
    print(
        f"Wrote {len(results)} points to {args.output} "
        f"(ready={statuses['ready']}, review={statuses['review']}, "
        f"unavailable={statuses['unavailable']})"
    )


if __name__ == "__main__":
    main()

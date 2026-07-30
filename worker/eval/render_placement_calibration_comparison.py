#!/usr/bin/env python3
"""Render a sanitized local review of placement calibration A/B results."""

from __future__ import annotations

import argparse
import html
import json
import shutil
from pathlib import Path
from typing import Any, Mapping, Sequence


CORNER_NAMES = ("A_near_1", "B_near_2", "C_far_2", "D_far_1")
ZONES = (
    "deep_left",
    "deep_middle",
    "deep_right",
    "medium_left",
    "medium_middle",
    "medium_right",
    "short_left",
    "short_middle",
    "short_right",
)
TABLE_WIDTH_M = 1.525
TABLE_LENGTH_M = 2.74


def _safe_case_root(
    experiment_root: Path,
    case: Mapping[str, Any],
) -> Path:
    root = (experiment_root / str(case["root"])).resolve()
    if not root.is_relative_to(experiment_root.resolve()):
        raise ValueError("case root escapes experiment root")
    return root


def _copy_case_asset(
    case_root: Path,
    relative_path: str,
    destination: Path,
) -> str:
    source = (case_root / relative_path).resolve()
    if not source.is_relative_to(case_root.resolve()):
        raise ValueError("report asset escapes case root")
    if not source.is_file() or source.stat().st_size == 0:
        raise ValueError(f"report asset is unavailable: {relative_path}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    return str(destination.relative_to(destination.parent.parent))


def _sanitized_historical(historical: Mapping[str, Any] | None) -> dict:
    signatures = set()
    distinct = []
    duplicates = 0
    for item in (historical or {}).get("cases") or []:
        signature = tuple(str(value) for value in item.get("image_sha256") or [])
        if not signature:
            continue
        if signature in signatures:
            duplicates += 1
            continue
        signatures.add(signature)
        accuracy = item.get("accuracy") or {}
        distinct.append(
            {
                "label": f"Historical setup {len(distinct) + 1}",
                "accepted": bool(
                    (item.get("calibration") or {}).get("accepted")
                ),
                "accuracy_status": str(
                    accuracy.get("status") or "not_measured"
                ),
                "median_reference_ratio": accuracy.get("median_ratio"),
                "maximum_reference_ratio": accuracy.get("maximum_ratio"),
            }
        )
    return {
        "distinct_frame_sets": len(distinct),
        "duplicates_excluded": duplicates,
        "cases": distinct,
    }


def _sanitize_case(
    case: Mapping[str, Any],
    prepared: Mapping[str, Any],
    index: int,
    experiment_root: Path,
    report_dir: Path,
) -> dict:
    label = f"Chris Match {index}"
    case_root = _safe_case_root(experiment_root, prepared)
    assets = report_dir / "assets"
    frame_name = f"match-{index}-frame.jpg"
    _copy_case_asset(
        case_root,
        str(case["representative_image"]),
        assets / frame_name,
    )
    changed_points = []
    for changed in (case.get("placement") or {}).get("changed_points") or []:
        identity = changed.get("identity") or {}
        point_idx = int(identity["point_idx"])
        clip_name = f"match-{index}-point-{point_idx:03d}.mp4"
        _copy_case_asset(
            case_root,
            str(changed["clip"]),
            assets / clip_name,
        )
        changed_points.append(
            {
                "point_idx": point_idx,
                "server_side": str(identity.get("server_side") or ""),
                "shot_seq": int(identity.get("shot_seq") or 0),
                "phase": str(identity.get("phase") or ""),
                "hitter_side": str(identity.get("hitter_side") or ""),
                "displacement_cm": float(changed["displacement_cm"]),
                "current": {
                    key: changed["current"].get(key)
                    for key in ("u", "v", "zone", "near_boundary")
                },
                "proposed": {
                    key: changed["proposed"].get(key)
                    for key in ("u", "v", "zone", "near_boundary")
                },
                "clip": f"assets/{clip_name}",
            }
        )
    openai = case.get("openai") or {}
    provider = openai.get("provider") or {}
    return {
        "label": label,
        "image_size": list(case["image_size"]),
        "source_size": list(case["source_size"]),
        "frame": f"assets/{frame_name}",
        "current_calibration": case.get("current_calibration"),
        "proposed_calibration": case.get("proposed_calibration"),
        "corner_displacement": case.get("corner_displacement") or {},
        "openai": {
            "consensus": openai.get("consensus") or {},
            "calibration": openai.get("calibration") or {},
            "estimated_usd": float(provider.get("estimated_usd") or 0.0),
        },
        "placement": {
            key: (case.get("placement") or {}).get(key)
            for key in (
                "current_status",
                "proposed_status",
                "current_trusted_landings",
                "proposed_trusted_landings",
                "matched_landings",
                "current_only_landings",
                "proposed_only_landings",
                "displacement_cm",
                "lateral_flips",
                "depth_flips",
                "zone_flips",
                "zone_flip_rate",
                "boundary_entries",
                "boundary_exits",
                "current_zones",
                "proposed_zones",
            )
        },
        "changed_points": changed_points,
    }


def _fmt(value: Any, digits: int = 1, suffix: str = "") -> str:
    if value is None:
        return "—"
    return f"{float(value):.{digits}f}{suffix}"


def _zone_label(zone: str) -> str:
    return str(zone).replace("_", " ").title()


def _outline_svg(case: Mapping[str, Any]) -> str:
    image_width, image_height = (int(value) for value in case["image_size"])
    source_width, source_height = (int(value) for value in case["source_size"])

    def polygon(calibration: Mapping[str, Any] | None, css_class: str) -> str:
        corners = (calibration or {}).get("table_corners_px") or {}
        if not all(name in corners for name in CORNER_NAMES):
            return ""
        points = []
        for name in CORNER_NAMES:
            x, y = corners[name]
            points.append(
                f"{float(x) * image_width / source_width:.2f},"
                f"{float(y) * image_height / source_height:.2f}"
            )
        return (
            f'<polygon class="{css_class}" points="'
            + " ".join(points)
            + '"/>'
        )

    return (
        f'<svg class="frame-overlay" viewBox="0 0 {image_width} {image_height}" '
        'role="img" aria-label="Current and OpenAI table outlines">'
        f'<image href="{html.escape(str(case["frame"]))}" width="{image_width}" '
        f'height="{image_height}" preserveAspectRatio="none"/>'
        f'{polygon(case.get("current_calibration"), "outline-current")}'
        f'{polygon(case.get("proposed_calibration"), "outline-openai")}'
        "</svg>"
    )


def _heat_map(counts: Mapping[str, Any], title: str) -> str:
    maximum = max([int(value) for value in counts.values()] or [1])
    cells = []
    for zone in ZONES:
        count = int(counts.get(zone) or 0)
        alpha = 0.10 + 0.75 * count / maximum if count else 0.04
        cells.append(
            '<div class="heat-cell" '
            f'style="--heat:{alpha:.3f}"><span>{html.escape(_zone_label(zone))}'
            f"</span><strong>{count}</strong></div>"
        )
    return (
        '<section class="heat-panel">'
        f"<h4>{html.escape(title)}</h4>"
        f'<div class="heat-grid">{"".join(cells)}</div></section>'
    )


def _point_map(item: Mapping[str, Any], title: str, css_class: str) -> str:
    u = min(max(float(item.get("u") or 0.0), 0.0), TABLE_WIDTH_M)
    v = min(max(float(item.get("v") or 0.0), 0.0), TABLE_LENGTH_M)
    x = 20 + u / TABLE_WIDTH_M * 180
    y = 20 + (1 - v / TABLE_LENGTH_M) * 324
    return (
        '<section class="point-map">'
        f"<h5>{html.escape(title)}</h5>"
        '<svg viewBox="0 0 220 364" aria-label="Landing position">'
        '<rect x="20" y="20" width="180" height="324" rx="6" class="table"/>'
        '<line x1="110" y1="20" x2="110" y2="344" class="center"/>'
        '<line x1="20" y1="182" x2="200" y2="182" class="net"/>'
        f'<circle cx="{x:.2f}" cy="{y:.2f}" r="8" class="{css_class}"/>'
        "</svg>"
        f'<p>{html.escape(_zone_label(str(item.get("zone") or "unknown")))}</p>'
        "</section>"
    )


def _changed_point_card(item: Mapping[str, Any]) -> str:
    return (
        '<article class="changed-point">'
        f'<header><div><p class="eyebrow">Point {int(item["point_idx"])}</p>'
        f'<h4>Shot {int(item["shot_seq"])} moved '
        f'{_fmt(item["displacement_cm"], 1, " cm")}</h4></div>'
        f'<span>{html.escape(str(item["phase"]).title())}</span></header>'
        '<div class="paired-maps">'
        f'{_point_map(item["current"], "Current map", "marker-current")}'
        f'{_point_map(item["proposed"], "OpenAI map", "marker-openai")}'
        "</div>"
        f'<video controls preload="metadata" playsinline src="'
        f'{html.escape(str(item["clip"]))}"></video>'
        "</article>"
    )


def _case_html(case: Mapping[str, Any]) -> str:
    placement = case["placement"]
    consensus = case["openai"]["consensus"]
    accepted = bool(case.get("proposed_calibration"))
    if accepted:
        calibration_status = "OpenAI calibration accepted"
        reason = (
            f'Median proposal drift '
            f'{_fmt(consensus.get("median_drift_ratio"), 2, "% of diagonal")}'
        )
    else:
        calibration_status = "OpenAI calibration withheld"
        reason = str(consensus.get("reason") or "no accepted consensus").replace(
            "_", " "
        )
    changed = "".join(
        _changed_point_card(item) for item in case["changed_points"]
    ) or '<p class="empty">No matched landing crossed a zone boundary.</p>'
    return (
        '<section class="match-section">'
        f'<header class="match-header"><div><p class="eyebrow">'
        f'{html.escape(str(case["label"]))}</p><h2>{calibration_status}</h2>'
        f"<p>{html.escape(reason)}</p></div>"
        f'<div class="metric"><strong>{_fmt((case["corner_displacement"] or {}).get("median_px"), 1, " px")}</strong>'
        "<span>median corner difference</span></div></header>"
        '<div class="legend"><span class="current">Current calibration</span>'
        '<span class="openai">OpenAI consensus</span></div>'
        f'{_outline_svg(case)}'
        '<div class="match-metrics">'
        f'<p><strong>{placement.get("matched_landings") or 0}</strong>'
        "<span>matched trusted landings</span></p>"
        f'<p><strong>{_fmt((placement.get("displacement_cm") or {}).get("median"), 1, " cm")}</strong>'
        "<span>median landing movement</span></p>"
        f'<p><strong>{placement.get("zone_flips") or 0}</strong>'
        "<span>nine-zone flips</span></p>"
        f'<p><strong>{_fmt(case["openai"].get("estimated_usd"), 3, " USD")}</strong>'
        "<span>three proposal trials</span></p></div>"
        '<div class="heat-pair">'
        f'{_heat_map(placement.get("current_zones") or {}, "Current heat map")}'
        f'{_heat_map(placement.get("proposed_zones") or {}, "OpenAI heat map")}'
        "</div>"
        '<section class="changed-list"><h3>Calibration-sensitive points</h3>'
        f"{changed}</section></section>"
    )


def _recommendation(summary: Mapping[str, Any]) -> tuple[str, str]:
    accepted = int(summary.get("accepted_openai_calibrations") or 0)
    matches = int(summary.get("matches") or 0)
    flips = int(summary.get("zone_flips") or 0)
    matched = int(summary.get("matched_landings") or 0)
    if accepted < 2:
        return (
            "Do not advance the automatic fallback yet",
            f"Only {accepted} of {matches} Chris matches produced a stable "
            "accepted OpenAI calibration.",
        )
    if flips:
        return (
            "Advance to a frozen, manually reviewed holdout",
            f"{flips} of {matched} matched landings changed nine-zone cell. "
            "Those points need visual adjudication before either calibration "
            "is called more accurate.",
        )
    return (
        "Calibration is stable but had little heat-map effect",
        f"OpenAI calibration was accepted for {accepted} of {matches} matches, "
        "with no matched landing changing nine-zone cell.",
    )


def _render_html(report_data: Mapping[str, Any]) -> str:
    summary = report_data["summary"]
    title, explanation = _recommendation(summary)
    rate = summary.get("zone_flip_rate") or {}
    historical = report_data["historical"]
    cases = "".join(_case_html(case) for case in report_data["cases"])
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>PongLens · Placement calibration A/B</title>
<style>
:root{{--bg:#090b11;--panel:#111520;--line:#283044;--text:#f4f7fb;
--muted:#9aa7ba;--cyan:#22d3ee;--orange:#f97316}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);
font:14px/1.45 Inter,ui-sans-serif,system-ui,sans-serif}}
main{{max-width:1120px;margin:auto;padding:34px 18px 80px}}h1,h2,h3,h4,h5,p{{margin-top:0}}
.eyebrow{{color:#67e8f9;font-size:11px;font-weight:800;text-transform:uppercase;
letter-spacing:.08em;margin-bottom:6px}}.hero{{background:linear-gradient(145deg,#121827,#0d111b);
border:1px solid var(--line);border-radius:22px;padding:24px;margin-bottom:22px}}
.hero h1{{font-size:clamp(25px,5vw,44px);line-height:1.05;margin-bottom:12px}}
.hero>p{{max-width:800px;color:var(--muted)}}.summary-grid,.match-metrics{{
display:grid;grid-template-columns:repeat(4,1fr);gap:10px}}.summary-grid article,
.match-metrics p{{background:#0c1018;border:1px solid var(--line);border-radius:14px;
padding:13px;margin:0;display:grid;gap:3px}}.summary-grid strong,.match-metrics strong{{
font-size:20px}}.summary-grid span,.match-metrics span{{font-size:11px;color:var(--muted)}}
.recommendation{{margin-top:14px;border-left:3px solid var(--cyan);padding:10px 14px;
background:#0c121b;border-radius:0 12px 12px 0}}.recommendation p{{color:var(--muted);
margin:4px 0 0}}.historical{{color:var(--muted);font-size:12px;margin:12px 0 0}}
.match-section{{border:1px solid var(--line);border-radius:22px;background:var(--panel);
padding:20px;margin-top:18px}}.match-header{{display:flex;justify-content:space-between;
gap:20px;align-items:start}}.match-header p{{color:var(--muted)}}.metric{{text-align:right;
display:grid}}.metric strong{{font-size:22px}}.metric span{{color:var(--muted);
font-size:11px}}.legend{{display:flex;gap:18px;font-size:11px;margin:8px 0}}
.legend span:before{{content:"";display:inline-block;width:18px;height:3px;margin-right:6px;
vertical-align:middle}}.legend .current:before{{background:var(--cyan)}}
.legend .openai:before{{background:var(--orange)}}.frame-overlay{{display:block;width:100%;
max-height:620px;background:#06080c;border-radius:15px;border:1px solid var(--line)}}
.outline-current,.outline-openai{{fill:none;stroke-width:3}}.outline-current{{stroke:var(--cyan)}}
.outline-openai{{stroke:var(--orange);stroke-dasharray:9 5}}.match-metrics{{margin-top:12px}}
.heat-pair,.paired-maps{{display:grid;grid-template-columns:1fr 1fr;gap:12px}}
.heat-pair{{margin-top:12px}}.heat-panel,.changed-point{{background:#0c1018;
border:1px solid var(--line);border-radius:15px;padding:13px}}.heat-grid{{display:grid;
grid-template-columns:repeat(3,1fr);gap:4px}}.heat-cell{{min-height:60px;
background:rgba(34,211,238,var(--heat));border-radius:7px;padding:7px;display:grid;
align-content:space-between}}.heat-cell span{{font-size:9px;color:#d4dce8}}
.heat-cell strong{{font-size:17px}}.changed-list{{margin-top:20px}}.changed-point{{
margin-top:10px}}.changed-point header{{display:flex;justify-content:space-between;gap:10px}}
.changed-point header>span{{font-size:11px;color:var(--muted)}}.point-map{{text-align:center;
border:1px solid #252d3e;border-radius:12px;padding:9px}}.point-map svg{{height:230px;
max-width:100%}}.point-map .table{{fill:#132d5b;stroke:#b8c5da;stroke-width:2}}
.point-map .center{{stroke:#7890b2;opacity:.5}}.point-map .net{{stroke:#fff;
stroke-width:2;stroke-dasharray:5 4}}.marker-current{{fill:var(--cyan)}}
.marker-openai{{fill:var(--orange)}}.point-map p{{font-size:11px;color:var(--muted)}}
video{{display:block;width:100%;margin-top:10px;border-radius:12px;background:#000}}
.empty{{color:var(--muted)}}footer{{color:var(--muted);font-size:11px;margin-top:24px}}
@media(max-width:760px){{.summary-grid,.match-metrics{{grid-template-columns:1fr 1fr}}
.heat-pair,.paired-maps{{grid-template-columns:1fr}}.match-header{{display:block}}
.metric{{text-align:left;margin-bottom:10px}}main{{padding-inline:12px}}}}
</style></head><body><main>
<section class="hero"><p class="eyebrow">Read-only placement experiment</p>
<h1>Comparison, not ground truth</h1>
<p>The same points and BlurBall detections were reconstructed with the stored
table calibration and a stable OpenAI-assisted proposal. A disagreement shows
calibration sensitivity; it does not prove which arm is correct.</p>
<div class="summary-grid">
<article><strong>{int(summary.get("accepted_openai_calibrations") or 0)} / {int(summary.get("matches") or 0)}</strong><span>accepted OpenAI calibrations</span></article>
<article><strong>{int(summary.get("matched_landings") or 0)}</strong><span>matched trusted landings</span></article>
<article aria-label="{int(rate.get("numerator") or 0)} / {int(rate.get("denominator") or 0)} matched landings changed zone"><strong>{int(rate.get("numerator") or 0)} / {int(rate.get("denominator") or 0)}</strong><span>matched landings changed zone</span></article>
<article><strong>{_fmt(summary.get("estimated_usd"),3," USD")}</strong><span>new provider spend</span></article>
</div><div class="recommendation"><strong>{html.escape(title)}</strong>
<p>{html.escape(explanation)}</p></div>
<p class="historical">{historical["distinct_frame_sets"]} distinct historical frame set{"s" if historical["distinct_frame_sets"] != 1 else ""};
{historical["duplicates_excluded"]} duplicate excluded.</p></section>
{cases}
<footer>Calibration can change where a detected event maps. It cannot recover a
missing ball, paddle contact, bounce, server label, or net-terminal event.</footer>
</main></body></html>"""


def render_report(
    cases_payload: Mapping[str, Any],
    comparison: Mapping[str, Any],
    experiment_root: Path,
    report_dir: Path,
    *,
    historical: Mapping[str, Any] | None = None,
) -> tuple[str, dict]:
    experiment_root = Path(experiment_root).resolve()
    report_dir = Path(report_dir).resolve()
    report_dir.mkdir(parents=True, exist_ok=True)
    prepared_by_id = {
        str(case["match_id"]): case
        for case in cases_payload.get("cases") or []
    }
    raw_cases = comparison.get("cases") or []
    if set(prepared_by_id) != {
        str(case.get("match_id")) for case in raw_cases
    }:
        raise ValueError("prepared and comparison case IDs differ")
    sanitized_cases = [
        _sanitize_case(
            case,
            prepared_by_id[str(case["match_id"])],
            index,
            experiment_root,
            report_dir,
        )
        for index, case in enumerate(raw_cases, start=1)
    ]
    raw_summary = comparison.get("summary") or {}
    report_data = {
        "version": 1,
        "summary": {
            key: raw_summary.get(key)
            for key in (
                "matches",
                "accepted_openai_calibrations",
                "matched_landings",
                "zone_flips",
                "zone_flip_rate",
                "estimated_usd",
            )
        },
        "historical": _sanitized_historical(historical),
        "cases": sanitized_cases,
    }
    html_text = _render_html(report_data)
    (report_dir / "report-data.json").write_text(
        json.dumps(report_data, indent=2) + "\n"
    )
    (report_dir / "index.html").write_text(html_text)
    return html_text, report_data


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--comparison", type=Path, required=True)
    parser.add_argument("--historical-results", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    cases = json.loads(args.cases.read_text())
    comparison = json.loads(args.comparison.read_text())
    historical = (
        json.loads(args.historical_results.read_text())
        if args.historical_results
        else None
    )
    render_report(
        cases,
        comparison,
        args.cases.resolve().parent,
        args.output_dir,
        historical=historical,
    )
    print(f"wrote placement calibration report to {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

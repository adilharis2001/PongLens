#!/usr/bin/env python3
"""Run local RTMPose evaluation and render the calibration review page."""

from __future__ import annotations

import argparse
import copy
import html
import json
import math
import subprocess
import time
from pathlib import Path

import cv2
import numpy as np


CORNER_NAMES = ("A_near_1", "B_near_2", "C_far_2", "D_far_1")
COLORS = {
    "reference": (34, 197, 94),
    "trial_1": (246, 130, 59),
    "trial_2": (247, 85, 168),
    "trial_3": (11, 158, 245),
    "accepted": (68, 68, 239),
}


def _case_root(experiment_root: Path, case: dict) -> Path:
    root = (experiment_root / str(case["root"])).resolve()
    if not root.is_relative_to(experiment_root.resolve()):
        raise ValueError("case root escapes the experiment directory")
    return root


def _scaled_source_corners(case: dict, corners: list) -> dict:
    image_width, image_height = (float(value) for value in case["image_size"])
    source_width, source_height = (
        float(value) for value in case["source_size"]
    )
    scale = np.asarray(
        [source_width / image_width, source_height / image_height],
        dtype=float,
    )
    points = np.asarray(corners, dtype=float) * scale
    return {
        name: [round(float(point[0]), 3), round(float(point[1]), 3)]
        for name, point in zip(CORNER_NAMES, points)
    }


def _length_axis(corners: dict) -> list[float]:
    A, B, C, D = (
        np.asarray(corners[name], dtype=float) for name in CORNER_NAMES
    )
    axis = ((D - A) + (C - B)) / 2.0
    norm = float(np.linalg.norm(axis))
    if not math.isfinite(norm) or norm <= 1e-8:
        raise ValueError("accepted calibration has a degenerate length axis")
    axis /= norm
    return [round(float(axis[0]), 8), round(float(axis[1]), 8)]


def run_structure(
    case: dict,
    accepted: dict,
    experiment_root: Path,
    *,
    rtmpose_python: Path,
    rtmpose_model: Path,
    backend: str = "onnxruntime",
    device: str = "mps",
    command_runner=subprocess.run,
) -> dict:
    """Run RTMPose against a local match copy only."""
    if not accepted.get("accepted"):
        return {
            "status": "not_run",
            "reason": accepted.get("reason") or "calibration_rejected",
        }
    root = _case_root(Path(experiment_root), case)
    original_path = root / str(case["match_json"])
    original = json.loads(original_path.read_text())
    local = copy.deepcopy(original)
    clip_pads = (local.get("options") or {}).get("clip_pads") or {}
    clip_pre = float(clip_pads.get("pre", 0.0))
    clip_post = float(clip_pads.get("post", 0.0))
    if (
        not math.isfinite(clip_pre)
        or not math.isfinite(clip_post)
        or clip_pre < 0
        or clip_post < 0
    ):
        raise ValueError("match clip padding is invalid")
    source_duration = float(
        (local.get("source") or {}).get("duration") or math.inf
    )
    prepared_points = []
    clips_dir = root / str(case["clips"])
    for point in case.get("points") or []:
        idx = int(point["idx"])
        clip_name = f"point-{idx:03d}.mp4"
        if not (clips_dir / clip_name).is_file():
            raise FileNotFoundError(
                f"prepared point {idx} has no local evaluation clip"
            )
        prepared_points.append(
            {
                "idx": idx,
                "t0": float(point["t0"]),
                "t1": float(point["t1"]),
                "clip_t0": max(0.0, float(point["t0"]) - clip_pre),
                "clip_t1": min(
                    source_duration,
                    float(point["t1"]) + clip_post,
                ),
                "clip": clip_name,
            }
        )
    if not prepared_points:
        raise ValueError("prepared case contains no evaluation points")
    local["points"] = prepared_points
    corners = _scaled_source_corners(case, accepted["corners"])
    local["calibration"] = {
        "ok": True,
        "size": list(case["source_size"]),
        "table_corners_px": corners,
        "length_axis": _length_axis(corners),
        "note": "read-only OpenAI calibration experiment",
    }
    downstream_dir = root / "downstream"
    downstream_dir.mkdir(parents=True, exist_ok=True)
    local_match_path = downstream_dir / "match.json"
    local_match_path.write_text(json.dumps(local, indent=2) + "\n")
    output_path = downstream_dir / "match-structure.json"
    script = Path(__file__).resolve().parents[1] / "extract_match_structure_rtmpose.py"
    command = [
        str(rtmpose_python),
        str(script),
        "--clips-dir",
        str(clips_dir),
        "--blurball",
        str(root / str(case["blurball"])),
        "--match-json",
        str(local_match_path),
        "--output",
        str(output_path),
        "--model",
        str(rtmpose_model),
        "--backend",
        backend,
        "--device",
        device,
    ]
    started = time.perf_counter()
    completed = command_runner(
        command,
        capture_output=True,
        text=True,
        timeout=30 * 60,
    )
    wall_s = round(time.perf_counter() - started, 6)
    if completed.returncode != 0 or not output_path.is_file():
        return {
            "status": "failed",
            "reason": "rtmpose_command_failed",
            "returncode": int(completed.returncode),
            "stderr_tail": str(completed.stderr or "")[-2000:],
            "wall_s": wall_s,
        }
    evidence = json.loads(output_path.read_text())
    return {
        "status": str(evidence.get("status") or "failed"),
        "reason": evidence.get("reason"),
        "wall_s": wall_s,
        "evidence": evidence,
    }


def _draw_quad(
    image: np.ndarray,
    corners,
    color: tuple[int, int, int],
    label: str,
) -> None:
    points = np.rint(np.asarray(corners, dtype=float)).astype(np.int32)
    if points.shape != (4, 2):
        return
    cv2.polylines(image, [points], True, color, 3, cv2.LINE_AA)
    for point in points:
        cv2.circle(image, tuple(point), 5, color, -1, cv2.LINE_AA)
    anchor = tuple(points[0] + np.asarray([6, -6]))
    cv2.putText(
        image,
        label,
        anchor,
        cv2.FONT_HERSHEY_SIMPLEX,
        0.52,
        color,
        2,
        cv2.LINE_AA,
    )


def render_overlays(
    case: dict,
    result: dict,
    experiment_root: Path,
    assets_dir: Path,
) -> list[Path]:
    root = _case_root(Path(experiment_root), case)
    output = assets_dir / str(case["match_id"])
    output.mkdir(parents=True, exist_ok=True)
    reference = result.get("reference") or {}
    reference_corners = reference.get("corners") or {}
    paths = []
    for image_record in case.get("images") or []:
        source = root / str(image_record["path"])
        image = cv2.imread(str(source))
        if image is None:
            raise RuntimeError(f"could not read report image: {source.name}")
        if set(reference_corners) == set(CORNER_NAMES):
            _draw_quad(
                image,
                [reference_corners[name] for name in CORNER_NAMES],
                COLORS["reference"],
                "Reference",
            )
        for index, trial in enumerate(result.get("trials") or [], start=1):
            proposal = trial.get("proposal") or {}
            corners = proposal.get("corners") or {}
            if set(corners) == set(CORNER_NAMES):
                _draw_quad(
                    image,
                    [corners[name] for name in CORNER_NAMES],
                    COLORS[f"trial_{index}"],
                    f"Trial {index}",
                )
        accepted = result.get("calibration") or {}
        if accepted.get("accepted") and accepted.get("corners"):
            _draw_quad(
                image,
                accepted["corners"],
                COLORS["accepted"],
                "Accepted",
            )
        destination = output / f"{source.stem}-overlay.jpg"
        if not cv2.imwrite(
            str(destination),
            image,
            [cv2.IMWRITE_JPEG_QUALITY, 92],
        ):
            raise RuntimeError("could not write report overlay")
        paths.append(destination)
    return paths


def _safe_number(value, digits: int = 4) -> str:
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return f"{float(value):.{digits}f}"
    return "—"


def duplicate_image_groups(cases: list[dict]) -> list[list[str]]:
    """Return match groups that use the exact same prepared frame set."""
    by_signature: dict[tuple[str, ...], list[str]] = {}
    for case in cases:
        signature = tuple(
            str(image.get("sha256") or "")
            for image in case.get("images") or []
        )
        if not signature or any(not digest for digest in signature):
            continue
        by_signature.setdefault(signature, []).append(str(case["match_id"]))
    return [
        match_ids
        for match_ids in by_signature.values()
        if len(match_ids) > 1
    ]


def _image_signature(case: dict) -> tuple[str, ...]:
    return tuple(
        str(image.get("sha256") or "")
        for image in case.get("images") or []
    )


def _sanitized_case(result: dict) -> dict:
    downstream = result.get("downstream") or {}
    evidence = downstream.get("evidence") or {}
    return {
        "match_id": str(result.get("match_id") or ""),
        "calibration": result.get("calibration") or {},
        "consensus": result.get("consensus") or {},
        "accuracy": result.get("accuracy") or {},
        "provider": {
            "model": (result.get("provider") or {}).get("model"),
            "request_count": (result.get("provider") or {}).get(
                "request_count"
            ),
            "estimated_usd": (result.get("provider") or {}).get(
                "estimated_usd"
            ),
        },
        "trials": [
            {
                "index": trial.get("index"),
                "status": trial.get("status"),
                "proposal": trial.get("proposal"),
                "validation": trial.get("validation"),
                "latency_s": trial.get("latency_s"),
                "estimated_usd": trial.get("estimated_usd"),
            }
            for trial in result.get("trials") or []
        ],
        "downstream": {
            "status": downstream.get("status"),
            "reason": downstream.get("reason"),
            "wall_s": downstream.get("wall_s"),
            "first_server": evidence.get("first_server"),
            "end_changes": evidence.get("end_changes") or [],
            "coverage": evidence.get("coverage") or {},
            "compute": evidence.get("compute") or {},
        },
    }


def _case_card(case: dict, result: dict, report_dir: Path) -> str:
    match_id = html.escape(str(case["match_id"]))
    role = html.escape(
        str(case.get("role") or "sample").replace("_", " ").title()
    )
    accuracy = result.get("accuracy") or {}
    calibration = result.get("calibration") or {}
    downstream = result.get("downstream") or {}
    evidence = downstream.get("evidence") or {}
    first_server = evidence.get("first_server") or {}
    truth = case.get("truth") or {}
    detected_side = first_server.get("side")
    user_side = truth.get("user_side")
    detected_owner = None
    if detected_side in {"near", "far"} and user_side in {"near", "far"}:
        detected_owner = (
            "user" if detected_side == user_side else "opponent"
        )
    truth_server = truth.get("first_server")
    agreement = (
        "Correct"
        if detected_owner and truth_server and detected_owner == truth_server
        else "Incorrect"
        if detected_owner and truth_server
        else "Not available"
    )
    changes = evidence.get("end_changes") or []
    coverage = evidence.get("coverage") or {}
    high_confidence = int(coverage.get("high_confidence") or 0)
    coverage_total = int(coverage.get("total") or 0)
    coverage_text = (
        f"{high_confidence}/{coverage_total}"
        if coverage_total
        else "Not available"
    )
    scores = calibration.get("scores") or {}
    overlays = [
        f"assets/{match_id}/{Path(image['path']).stem}-overlay.jpg"
        for image in case.get("images") or []
    ]
    images = "".join(
        f'<figure><img src="{html.escape(path)}" alt="Calibration overlay">'
        f"<figcaption>{html.escape(Path(path).stem)}</figcaption></figure>"
        for path in overlays
    )
    change_text = (
        ", ".join(
            f"{change.get('after_idx')}–{change.get('before_idx')}"
            for change in changes
        )
        if changes
        else "None"
    )
    return f"""
    <section class="case">
      <div class="case-head">
        <div><p class="eyebrow">Match · {role}</p><h2>{match_id[:8]}</h2></div>
        <span class="badge">{html.escape(str(accuracy.get("status") or "not measured"))}</span>
      </div>
      <div class="metrics">
        <article><h3>Calibration result</h3>
          <p class="result">{'Accepted' if calibration.get('accepted') else 'Withheld'}</p>
          <dl>
            <dt>Reason</dt><dd>{html.escape(str(calibration.get('reason') or '—'))}</dd>
            <dt>Median reference error</dt><dd>{_safe_number(accuracy.get('median_ratio'), 3)}</dd>
            <dt>Maximum reference error</dt><dd>{_safe_number(accuracy.get('maximum_ratio'), 3)}</dd>
            <dt>Edge support</dt><dd>{_safe_number(scores.get('edge_support'), 3)}</dd>
            <dt>Activity overlap</dt><dd>{_safe_number(scores.get('activity_overlap'), 3)}</dd>
          </dl>
        </article>
        <article><h3>RTMPose diagnostic (not scored accuracy)</h3>
          <p class="result">{html.escape(str(downstream.get('status') or 'not run'))}</p>
          <dl>
            <dt>First server</dt><dd>{html.escape(str(first_server.get('side') or 'withheld'))}</dd>
            <dt>First-server agreement</dt><dd>{agreement}</dd>
            <dt>High-confidence coverage</dt><dd>{coverage_text}</dd>
            <dt>Side-swap intervals</dt><dd>{html.escape(change_text)}</dd>
            <dt>Elapsed</dt><dd>{_safe_number((evidence.get('compute') or {}).get('elapsed_s'), 2)} s</dd>
            <dt>Inference</dt><dd>{_safe_number((evidence.get('compute') or {}).get('inference_s'), 2)} s</dd>
          </dl>
        </article>
        <article><h3>Provider</h3>
          <p class="result">{html.escape(str((result.get('provider') or {}).get('model') or '—'))}</p>
          <dl>
            <dt>Requests</dt><dd>{html.escape(str((result.get('provider') or {}).get('request_count') or 3))}</dd>
            <dt>Estimated cost</dt><dd>${_safe_number((result.get('provider') or {}).get('estimated_usd'), 5)}</dd>
          </dl>
        </article>
      </div>
      <div class="legend">
        <span class="reference">Reference</span>
        <span class="trial1">Trial 1</span>
        <span class="trial2">Trial 2</span>
        <span class="trial3">Trial 3</span>
        <span class="accepted">Accepted consensus</span>
      </div>
      <div class="images">{images}</div>
    </section>
    """


def render_report(
    cases_payload: dict,
    results_payload: dict,
    experiment_root: Path,
) -> Path:
    report_dir = Path(experiment_root) / "report"
    assets_dir = report_dir / "assets"
    report_dir.mkdir(parents=True, exist_ok=True)
    cases_by_id = {
        str(case["match_id"]): case for case in cases_payload["cases"]
    }
    cards = []
    sanitized = {
        "version": 1,
        "experiment_spend": results_payload.get("experiment_spend"),
        "cases": [],
    }
    for result in results_payload["cases"]:
        match_id = str(result["match_id"])
        case = cases_by_id[match_id]
        render_overlays(case, result, Path(experiment_root), assets_dir)
        cards.append(_case_card(case, result, report_dir))
        sanitized["cases"].append(_sanitized_case(result))
    (report_dir / "report-data.json").write_text(
        json.dumps(sanitized, indent=2) + "\n"
    )
    result_by_id = {
        str(result["match_id"]): result
        for result in results_payload["cases"]
    }
    signature_passes: dict[tuple[str, ...], list[bool]] = {}
    for case in cases_payload["cases"]:
        result = result_by_id[str(case["match_id"])]
        passed = bool(result.get("calibration", {}).get("accepted")) and (
            result.get("accuracy") or {}
        ).get("status") == "passes_reference_gate"
        signature_passes.setdefault(_image_signature(case), []).append(passed)
    distinct_count = len(signature_passes)
    distinct_passed = sum(all(statuses) for statuses in signature_passes.values())
    selected_cost = sum(
        float((result.get("provider") or {}).get("estimated_usd") or 0.0)
        for result in results_payload["cases"]
    )
    spend = results_payload.get("experiment_spend") or {}
    minimum_recorded = float(
        spend.get("minimum_recorded_usd") or selected_cost
    )
    unmetered_failed = int(spend.get("unmetered_failed_requests") or 0)
    failed_word = "call was" if unmetered_failed == 1 else "calls were"
    spend_note = (
        f"${_safe_number(minimum_recorded, 5)} minimum recorded across all "
        f"attempts; {unmetered_failed} earlier failed {failed_word} not "
        "metered by the first runner."
    )
    duplicate_notes = []
    for group in duplicate_image_groups(cases_payload["cases"]):
        labels = " and ".join(html.escape(match_id[:8]) for match_id in group)
        duplicate_notes.append(
            f"{labels} use the same three prepared frames; the control "
            "therefore measures repeatability, not a separate scene."
        )
    duplicate_warning = (
        f'<p class="warning">{" ".join(duplicate_notes)}</p>'
        if duplicate_notes
        else ""
    )
    document = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>PongLens · OpenAI table calibration check</title>
  <style>
    :root {{ color-scheme: dark; --bg:#08111f; --panel:#111d2e; --line:#26364d; --muted:#94a3b8; }}
    * {{ box-sizing:border-box; }}
    body {{ margin:0; font-family:Inter,ui-sans-serif,system-ui,sans-serif; background:var(--bg); color:#f8fafc; }}
    main {{ width:min(1440px,94vw); margin:0 auto; padding:48px 0 80px; }}
    h1 {{ font-size:clamp(2rem,5vw,4.5rem); line-height:.95; max-width:900px; margin:10px 0 18px; }}
    .intro {{ color:var(--muted); max-width:780px; font-size:1.05rem; }}
    .summary {{ font-size:1.05rem; font-weight:700; margin:24px 0 0; }}
    .warning {{ margin:28px 0 46px; padding:16px 18px; border:1px solid #854d0e; border-radius:14px; background:#42200655; }}
    .case {{ border-top:1px solid var(--line); padding:40px 0 56px; }}
    .case-head {{ display:flex; justify-content:space-between; align-items:end; gap:20px; }}
    .case-head h2 {{ margin:0; font-size:2rem; }}
    .eyebrow {{ text-transform:uppercase; letter-spacing:.12em; color:var(--muted); font-size:.72rem; margin:0 0 6px; }}
    .badge {{ border:1px solid var(--line); border-radius:999px; padding:8px 12px; color:#cbd5e1; }}
    .metrics {{ display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin:22px 0; }}
    article {{ background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:18px; }}
    article h3 {{ color:var(--muted); font-size:.78rem; text-transform:uppercase; letter-spacing:.1em; margin:0; }}
    .result {{ font-size:1.5rem; margin:9px 0 18px; }}
    dl {{ display:grid; grid-template-columns:1fr auto; gap:8px 16px; margin:0; font-size:.9rem; }}
    dt {{ color:var(--muted); }} dd {{ margin:0; text-align:right; }}
    .legend {{ display:flex; flex-wrap:wrap; gap:14px; margin:20px 0 12px; color:#cbd5e1; font-size:.85rem; }}
    .legend span::before {{ content:""; display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:6px; }}
    .reference::before {{ background:#22c55e; }} .trial1::before {{ background:#3b82f6; }}
    .trial2::before {{ background:#a855f7; }} .trial3::before {{ background:#f59e0b; }}
    .accepted::before {{ background:#ef4444; }}
    .images {{ display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }}
    figure {{ margin:0; background:#020617; border:1px solid var(--line); border-radius:14px; overflow:hidden; }}
    img {{ display:block; width:100%; height:auto; }} figcaption {{ padding:9px 12px; color:var(--muted); font-size:.8rem; }}
    @media(max-width:850px) {{ .metrics,.images {{ grid-template-columns:1fr; }} main {{ padding-top:28px; }} }}
  </style>
</head>
<body><main>
  <p class="eyebrow">Focused engineering evaluation</p>
  <h1>Can ordinary video frames recover the table?</h1>
  <p class="intro">Calibration accuracy and downstream player-structure diagnostics are reported separately. A convincing outline does not count as a successful serve or side-swap result.</p>
  <p class="summary">{distinct_passed}/{distinct_count} distinct frame sets passed · {len(results_payload['cases'])} runs shown</p>
  <p class="intro">Selected final runs: ${_safe_number(selected_cost, 5)}. {spend_note}</p>
  <p class="warning">Three matches are a focused engineering check, not a statistically representative accuracy study.</p>
  <p class="warning">This is an exploratory, post-hoc tuned result. The geometry threshold changed after the target samples were inspected; a fresh holdout with frozen settings is required before any production decision. RTMPose side-swap intervals have no reviewed boundary ground truth here, so they are diagnostics, not measured accuracy.</p>
  {duplicate_warning}
  {''.join(cards)}
</main></body></html>
"""
    index = report_dir / "index.html"
    index.write_text(document)
    return index


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--experiment-root", type=Path, required=True)
    parser.add_argument("--run-rtmpose", action="store_true")
    parser.add_argument("--rtmpose-python", type=Path)
    parser.add_argument("--rtmpose-model", type=Path)
    parser.add_argument("--backend", default="onnxruntime")
    parser.add_argument("--device", default="mps")
    args = parser.parse_args()
    root = args.experiment_root.resolve()
    cases = json.loads((root / "cases.json").read_text())
    results = json.loads((root / "experiment-results.json").read_text())
    references = json.loads((root / "references.json").read_text())
    cases_by_id = {str(case["match_id"]): case for case in cases["cases"]}
    references_by_id = {
        str(reference["match_id"]): reference
        for reference in references["cases"]
    }
    for result in results["cases"]:
        match_id = str(result["match_id"])
        result["reference"] = references_by_id[match_id]
        if args.run_rtmpose:
            if not args.rtmpose_python or not args.rtmpose_model:
                parser.error(
                    "--rtmpose-python and --rtmpose-model are required "
                    "with --run-rtmpose"
                )
            result["downstream"] = run_structure(
                cases_by_id[match_id],
                result["calibration"],
                root,
                rtmpose_python=args.rtmpose_python,
                rtmpose_model=args.rtmpose_model,
                backend=args.backend,
                device=args.device,
            )
    evaluated = root / "evaluated-results.json"
    evaluated.write_text(json.dumps(results, indent=2) + "\n")
    index = render_report(cases, results, root)
    print(index)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

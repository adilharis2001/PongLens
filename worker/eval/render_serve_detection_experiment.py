#!/usr/bin/env python3
"""Render an anonymous, static serve-detection review application."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path
from typing import Any, Mapping


ARM_LABELS = {
    "wrist_baseline": "Wrist baseline",
    "geometry": "Geometry",
    "geometry_audio": "Geometry + audio",
    "geometry_audio_motion": "Geometry + audio + motion",
    "vision_api": "Vision referee",
}
PRIVATE_KEYS = frozenset(
    {
        "match_id",
        "first_server",
        "confirmed_winner",
        "user_side",
        "email",
        "name",
        "note",
    }
)


def _inside(root: Path, path: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def copy_asset(
    report_dir: Path,
    source: Path,
    *,
    source_root: Path,
    output_name: str | None = None,
) -> str:
    """Copy or hardlink one source-root asset into the report."""

    report_dir = Path(report_dir).resolve()
    source_root = Path(source_root).resolve()
    source = Path(source)
    resolved = (
        source.resolve()
        if source.is_absolute()
        else (source_root / source).resolve()
    )
    if not _inside(source_root, resolved):
        raise ValueError("asset path escapes source root")
    if not resolved.is_file():
        raise FileNotFoundError(resolved)
    assets = report_dir / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    name = output_name or resolved.name
    destination = (assets / name).resolve()
    if not _inside(assets, destination):
        raise ValueError("asset destination escapes report directory")
    if not destination.exists():
        try:
            os.link(resolved, destination)
        except OSError:
            shutil.copy2(resolved, destination)
    return destination.relative_to(report_dir).as_posix()


def _safe_prediction(prediction: Mapping[str, Any]) -> dict[str, Any]:
    allowed = (
        "status",
        "server_side",
        "confidence",
        "score_margin",
        "reason",
        "serve",
        "evidence",
        "frame_window",
        "ball_detection_count",
        "audio_impact_count",
        "motion_status",
        "motion_changed_decision",
        "wall_s",
        "peak_rss_bytes",
        "api_status",
        "api_evidence",
        "source",
    )
    return {
        key: prediction[key]
        for key in allowed
        if key in prediction and key not in PRIVATE_KEYS
    }


def _anonymous_data(
    cases: Mapping[str, Any],
    results: Mapping[str, Any],
    report_dir: Path,
    source_root: Path,
    *,
    scores: Mapping[str, Any] | None = None,
    prediction_sha256: str = "",
) -> dict[str, Any]:
    arm_points = {
        arm: {
            str(point.get("point_key")): point
            for point in data.get("points", [])
            if isinstance(point, Mapping)
        }
        for arm, data in (results.get("arms") or {}).items()
        if isinstance(data, Mapping)
    }
    points = []
    for case in cases.get("cases") or []:
        if not isinstance(case, Mapping):
            continue
        case_key = str(case.get("case_key") or "")
        if not case_key.startswith("case-"):
            raise ValueError("report requires anonymous case keys")
        for point in case.get("points") or []:
            if not isinstance(point, Mapping):
                continue
            point_key = str(point.get("point_key") or "")
            if not point_key.startswith(case_key + "-point-"):
                raise ValueError("report requires anonymous point keys")
            clip_path = copy_asset(
                report_dir,
                Path(str(point["clip_path"])),
                source_root=source_root,
                output_name=point_key + Path(str(point["clip_path"])).suffix,
            )
            points.append(
                {
                    "case_key": case_key,
                    "point_key": point_key,
                    "idx": int(point.get("idx") or 0),
                    "clip_path": clip_path,
                    "duration": float(point.get("duration") or 0.0),
                    "table_corners": point.get("table_corners") or [],
                    "calibration_size": point.get("calibration_size") or [],
                    "predictions": {
                        arm: _safe_prediction(predictions[point_key])
                        for arm, predictions in arm_points.items()
                        if point_key in predictions
                    },
                }
            )
    summaries = {
        arm: {
            "label": ARM_LABELS.get(arm, arm.replace("_", " ").title()),
            "summary": dict(data.get("summary") or {}),
        }
        for arm, data in (results.get("arms") or {}).items()
        if isinstance(data, Mapping)
    }
    return {
        "version": 1,
        "run_id": str(results.get("run_id") or ""),
        "git_commit": str(results.get("git_commit") or ""),
        "prediction_sha256": prediction_sha256,
        "summaries": summaries,
        "points": points,
        "scores": dict(scores or {}),
        "timing": dict(results.get("timing") or {}),
        "dependency_ledger": [
            {
                "component": str(dependency.get("name") or ""),
                "version": str(dependency.get("version") or ""),
                "license": str(dependency.get("license") or ""),
            }
            for dependency in results.get("dependency_ledger") or []
            if isinstance(dependency, Mapping)
        ],
    }


HTML = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Serve detection lab</title>
  <style>
    :root { color-scheme: dark; --ink:#f4f5f0; --muted:#9ca39c;
      --panel:#171b19; --line:#2b312d; --green:#a9f5ca;
      --amber:#ffd79a; --red:#ff9e9e; --blue:#9fd9ff; }
    * { box-sizing:border-box } body { margin:0; background:#0d100f;
      color:var(--ink); font:14px/1.45 ui-sans-serif,system-ui,-apple-system;
    }
    header { position:sticky; top:0; z-index:3; background:#0d100fe8;
      backdrop-filter:blur(16px); border-bottom:1px solid var(--line);
      padding:18px 24px; display:flex; align-items:center; gap:18px; }
    h1 { font-size:18px; margin:0 } h2 { font-size:16px; margin:0 0 12px }
    .sub { color:var(--muted); font-size:12px } .grow { flex:1 }
    button,select,input,textarea { font:inherit; color:var(--ink);
      background:#202521; border:1px solid #3a423c; border-radius:9px;
      padding:8px 10px; } button { cursor:pointer }
    button.primary { background:#d7ffe7; color:#102117; border-color:#d7ffe7 }
    main { display:grid; grid-template-columns:280px minmax(0,1fr);
      gap:18px; padding:18px; max-width:1500px; margin:auto; }
    aside,.panel { background:var(--panel); border:1px solid var(--line);
      border-radius:14px; } aside { position:sticky; top:86px;
      align-self:start; max-height:calc(100vh - 105px); overflow:auto;
      padding:12px; } .metric { padding:12px; border-bottom:1px solid var(--line) }
    .metric:last-child { border:0 } .metric strong { display:block;
      font-size:20px } .point-button { width:100%; text-align:left;
      margin:3px 0; display:flex; justify-content:space-between }
    .point-button.active { border-color:var(--green); background:#213129 }
    .status { font-size:11px; border-radius:99px; padding:2px 7px;
      background:#29312c; color:var(--muted) }
    .status.high_confidence { color:var(--green) }
    .status.needs_review { color:var(--amber) }
    .content { display:grid; gap:18px }
    .panel { padding:18px } .video-wrap { position:relative; background:#050706;
      border-radius:10px; overflow:hidden } video { width:100%; max-height:64vh;
      display:block } canvas { position:absolute; inset:0; width:100%; height:100%;
      pointer-events:none } .arm-grid { display:grid;
      grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:10px }
    .arm { border:1px solid var(--line); border-radius:10px; padding:12px }
    .arm.selected { border-color:var(--green) } .arm-name { font-weight:700 }
    .events { display:flex; flex-wrap:wrap; gap:7px; margin-top:10px }
    .event { background:#222824; border-radius:99px; padding:4px 8px;
      color:var(--blue) } .label-grid { display:grid;
      grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px }
    label { display:grid; gap:5px; color:var(--muted) }
    label.wide { grid-column:1/-1 } textarea { min-height:70px; resize:vertical }
    .checks { display:flex; flex-wrap:wrap; gap:10px }
    .checks label { display:flex; align-items:center; gap:6px }
    .empty { color:var(--muted); padding:25px; text-align:center }
    @media(max-width:850px){main{grid-template-columns:1fr}
      aside{position:static;max-height:none}.label-grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
<header>
  <div><h1>Serve detection lab</h1><div class="sub" id="run"></div></div>
  <div class="grow"></div>
  <select id="filter" aria-label="Filter points">
    <option value="all">All points</option>
    <option value="high_confidence">Automated</option>
    <option value="needs_review">Withheld</option>
    <option value="unavailable">Unavailable</option>
    <option value="labeled">Labeled</option>
  </select>
  <button id="export" class="primary">Export references</button>
</header>
<main>
  <aside><div id="metrics"></div><div id="points"></div></aside>
  <section class="content">
    <div class="panel" id="viewer"><div class="empty">Choose a point</div></div>
    <div class="panel"><h2>Ablation evidence</h2>
      <div class="sub">Compare Geometry, Geometry + audio, and Geometry + audio + motion.</div>
      <div class="arm-grid" id="arms"></div></div>
    <div class="panel">
      <h2>Mark actual serve</h2>
      <div class="label-grid">
        <label>Server side<select id="server"><option value="">Unmarked</option>
          <option value="near">Near</option><option value="far">Far</option>
          <option value="none">No observable serve</option></select></label>
        <label>Serve contact (seconds)<input id="contact" type="number"
          min="0" step="0.01" placeholder="Use current video time"></label>
        <label>Visibility<select id="visibility"><option value="">Unmarked</option>
          <option value="clear">Clear</option><option value="partial">Partial</option>
          <option value="hidden">Hidden</option></select></label>
        <label>Quick action<button id="mark-time">Use current video time</button></label>
        <div class="wide checks">
          <label><input id="bounce1" type="checkbox"> First bounce visible</label>
          <label><input id="bounce2" type="checkbox"> Second bounce visible</label>
          <label><input id="walking" type="checkbox"> Walking/retrieval</label>
          <label><input id="handoff" type="checkbox"> Ball handoff/toss</label>
          <label><input id="badcut" type="checkbox"> Bad point cut</label>
        </div>
        <label class="wide">Notes<textarea id="note"
          placeholder="What actually happened?"></textarea></label>
      </div>
    </div>
  </section>
</main>
<script>
const STORE = "ponglens-serve-references-v1";
let data, active, labels = JSON.parse(localStorage.getItem(STORE) || "{}");
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>(
  {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const armLabel = k => data.summaries[k]?.label || k.replaceAll("_"," ");
const primary = p => p.predictions.geometry_audio || p.predictions.geometry || {};
function persist(){
  localStorage.setItem(STORE, JSON.stringify(labels));
}
function currentLabel(){
  return labels[active.point_key] || {point_key:active.point_key,
    serve_contact_t:null,server_side:null,visibility:null,
    first_bounce_visible:null,second_bounce_visible:null,
    hard_negatives:[],note:""};
}
function save(){
  if(!active)return;
  const neg=[]; if($("walking").checked)neg.push("walking_or_retrieval");
  if($("handoff").checked)neg.push("ball_handoff");
  if($("badcut").checked)neg.push("bad_point_cut");
  labels[active.point_key]={point_key:active.point_key,
    serve_contact_t:$("contact").value===""?null:Number($("contact").value),
    server_side:$("server").value||null,visibility:$("visibility").value||null,
    first_bounce_visible:$("bounce1").checked,
    second_bounce_visible:$("bounce2").checked,hard_negatives:neg,
    note:$("note").value}; persist(); renderList();
}
function loadLabel(){
  const l=currentLabel(); $("server").value=l.server_side||"";
  $("contact").value=l.serve_contact_t??""; $("visibility").value=l.visibility||"";
  $("bounce1").checked=l.first_bounce_visible===true;
  $("bounce2").checked=l.second_bounce_visible===true;
  $("walking").checked=(l.hard_negatives||[]).includes("walking_or_retrieval");
  $("handoff").checked=(l.hard_negatives||[]).includes("ball_handoff");
  $("badcut").checked=(l.hard_negatives||[]).includes("bad_point_cut");
  $("note").value=l.note||"";
}
function renderMetrics(){
  $("metrics").innerHTML=Object.entries(data.summaries).map(([key,v])=>{
    const s=v.summary||{}; return `<div class="metric"><span>${esc(v.label)}</span>
      <strong>${s.high_confidence||0}/${s.total||0}</strong>
      <span class="sub">automated · ${Number(s.wall_s||0).toFixed(1)}s</span></div>`;
  }).join("");
}
function filtered(){
  const f=$("filter").value;
  return data.points.filter(p=>f==="all"||(f==="labeled"?!!labels[p.point_key]:
    primary(p).status===f));
}
function renderList(){
  $("points").innerHTML=filtered().map(p=>{const pred=primary(p);
    return `<button class="point-button ${active?.point_key===p.point_key?"active":""}"
      data-key="${esc(p.point_key)}"><span>${esc(p.point_key)}</span>
      <span class="status ${esc(pred.status)}">${labels[p.point_key]?"✓ ": ""}${esc(pred.status||"—")}</span></button>`;
  }).join("")||`<div class="empty">No matching points</div>`;
  document.querySelectorAll(".point-button").forEach(b=>b.onclick=()=>selectPoint(b.dataset.key));
}
function eventPills(pred){
  const s=pred.serve||{}, rows=[];
  if(Number.isFinite(s.contact_t))rows.push(["contact",s.contact_t]);
  if(Number.isFinite(s.first_bounce?.t))rows.push(["bounce 1",s.first_bounce.t]);
  if(Number.isFinite(s.second_bounce?.t))rows.push(["bounce 2",s.second_bounce.t]);
  return rows.map(([n,t])=>`<button class="event" data-time="${t}">${n} ${t.toFixed(2)}s</button>`).join("");
}
function renderArms(){
  $("arms").innerHTML=Object.entries(active.predictions).map(([key,p])=>
    `<div class="arm ${p.status==="high_confidence"?"selected":""}">
      <div class="arm-name">${esc(armLabel(key))}</div>
      <div><span class="status ${esc(p.status)}">${esc(p.status||"—")}</span>
       ${p.server_side?` · ${esc(p.server_side)} server`:""}</div>
      <div class="sub">${esc(p.reason||"No reason recorded")}</div>
      <div class="events">${eventPills(p)}</div>
      <div class="sub">margin ${Number(p.score_margin||0).toFixed(2)}
       · ${Number(p.wall_s||0).toFixed(3)}s</div></div>`).join("");
  document.querySelectorAll(".event").forEach(b=>b.onclick=()=>{
    const v=$("video"); v.currentTime=Number(b.dataset.time); v.play();
  });
}
function drawTable(){
  const v=$("video"), c=$("overlay"), corners=active.table_corners||[];
  if(!v||corners.length!==4)return; c.width=v.clientWidth; c.height=v.clientHeight;
  const naturalW=(active.calibration_size||[])[0]||v.videoWidth;
  const naturalH=(active.calibration_size||[])[1]||v.videoHeight;
  const sx=c.width/naturalW, sy=c.height/naturalH, x=c.getContext("2d");
  x.clearRect(0,0,c.width,c.height); x.beginPath();
  corners.forEach((p,i)=>i?x.lineTo(p[0]*sx,p[1]*sy):x.moveTo(p[0]*sx,p[1]*sy));
  x.closePath(); x.strokeStyle="#a9f5ca"; x.lineWidth=2; x.stroke();
}
function selectPoint(key){
  active=data.points.find(p=>p.point_key===key); if(!active)return;
  $("viewer").innerHTML=`<div class="video-wrap"><video id="video" controls
    preload="metadata" src="${encodeURI(active.clip_path)}"></video>
    <canvas id="overlay"></canvas></div><div class="sub">${esc(active.point_key)}
    · ${Number(active.duration||0).toFixed(2)} seconds</div>`;
  $("video").onloadedmetadata=drawTable; window.onresize=drawTable;
  renderArms(); loadLabel(); renderList();
}
["server","contact","visibility","bounce1","bounce2","walking","handoff","badcut","note"]
  .forEach(id=>$(id).addEventListener("change",save));
$("note").addEventListener("input",save);
$("mark-time").onclick=()=>{if($("video")){$("contact").value=$("video").currentTime.toFixed(2);save()}};
$("filter").onchange=renderList;
$("export").onclick=()=>{
  const payload={version:1,run_id:data.run_id,prediction_sha256:data.prediction_sha256,
    exported_at:new Date().toISOString(),
    points:data.points.map(p=>labels[p.point_key]||{point_key:p.point_key,
      serve_contact_t:null,server_side:null,visibility:null,
      first_bounce_visible:null,second_bounce_visible:null,hard_negatives:[],note:""})};
  const a=document.createElement("a");a.href=URL.createObjectURL(
    new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}));
  a.download="serve-references.json";a.click();URL.revokeObjectURL(a.href);
};
fetch("report-data.json").then(r=>r.json()).then(d=>{data=d;
  $("run").textContent=`${data.run_id} · ${data.points.length} points`;
  renderMetrics();renderList();if(data.points[0])selectPoint(data.points[0].point_key);
});
</script>
</body>
</html>
"""


def render_report(
    cases: Mapping[str, Any],
    results: Mapping[str, Any],
    report_dir: Path,
    *,
    source_root: Path | None = None,
    scores: Mapping[str, Any] | None = None,
    prediction_sha256: str = "",
) -> Path:
    """Write a self-contained static review report."""

    report_dir = Path(report_dir).resolve()
    report_dir.mkdir(parents=True, exist_ok=True)
    source_root = (
        Path(source_root).resolve()
        if source_root is not None
        else report_dir.parent.resolve()
    )
    payload = _anonymous_data(
        cases,
        results,
        report_dir,
        source_root,
        scores=scores,
        prediction_sha256=prediction_sha256,
    )
    serialized = json.dumps(payload, indent=2, sort_keys=True)
    for private_key in PRIVATE_KEYS:
        if f'"{private_key}"' in serialized:
            raise ValueError(f"private report field detected: {private_key}")
    (report_dir / "report-data.json").write_text(serialized + "\n")
    (report_dir / "index.html").write_text(HTML)
    return report_dir


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--scores", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    cases = json.loads((root / "serve-cases.json").read_text())
    results = json.loads(args.results.resolve().read_text())
    scores = (
        json.loads(args.scores.resolve().read_text())
        if args.scores
        else None
    )
    output = args.output.resolve() if args.output else root / "report"
    render_report(
        cases,
        results,
        output,
        source_root=root,
        scores=scores,
        prediction_sha256=hashlib.sha256(
            args.results.resolve().read_bytes()
        ).hexdigest(),
    )
    print(json.dumps({"report": str(output / "index.html")}, indent=2))


if __name__ == "__main__":
    main()

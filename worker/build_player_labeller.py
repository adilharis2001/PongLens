#!/usr/bin/env python3
"""Click-to-label page: which two people are actually playing.

Every geometric rule tried so far picks the wrong person in a busy hall,
and each new rule has been argued from a handful of frames. This asks
for the answer directly: a few frames per match, every detected person
drawn as a numbered box, and two clicks to say which is the near player
and which the far. What comes back is a labelled set big enough to ask
what the players have in common that the onlookers do not.

Deliberately covers NON-PingPod uploads across every owner, because
PingPod is the one venue where the current rules already work and is
therefore the one venue that teaches nothing.

Downloads only the clips it samples, not whole matches.

  worker/venv/bin/python -m worker.build_player_labeller \
      --out docs/research/players.html --per-match 5
"""
from __future__ import annotations
import argparse, base64, html, json, math, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent
CACHE = Path.home() / "ponglens-research-work" / "player-labels"


def db():
    import psycopg2, psycopg2.extras
    url = subprocess.check_output(
        ["security", "find-generic-password", "-a", "openclaw",
         "-s", "ponglens-db-url", "-w"], text=True).strip()
    c = psycopg2.connect(url)
    return c, c.cursor(cursor_factory=psycopg2.extras.RealDictCursor)


def r2():
    import boto3
    acct = subprocess.check_output(
        ["security", "find-generic-password", "-a", "openclaw",
         "-s", "ponglens-r2-account", "-w"], text=True).strip()
    key = subprocess.check_output(
        ["security", "find-generic-password", "-a", "openclaw",
         "-s", "ponglens-r2-key-id", "-w"], text=True).strip()
    sec = subprocess.check_output(
        ["security", "find-generic-password", "-a", "openclaw",
         "-s", "ponglens-r2-secret", "-w"], text=True).strip()
    return boto3.client("s3",
        endpoint_url=f"https://{acct}.r2.cloudflarestorage.com",
        aws_access_key_id=key, aws_secret_access_key=sec, region_name="auto")


def matches(cur, limit):
    cur.execute("""
      select m.id, m.match_json_path, coalesce(lower(m.venue),'(none)') as venue,
             u.email,
             (select count(*) from points p where p.match_id=m.id
               and coalesce(p.deleted,false)=false) as pts
      from matches m join auth.users u on u.id=m.user_id
      where m.status='ready' and m.match_json_path is not null
        and lower(coalesce(m.venue,'')) not like 'pingpod%'
      order by venue, m.created_at""")
    rows = [r for r in cur.fetchall() if r["pts"] >= 20]
    return rows[:limit] if limit else rows


def collect(rows, per_match):
    sys.path.insert(0, str(REPO))
    import cv2
    from extract_match_structure_rtmpose import (
        _clip_metadata, _read_frame, _scaled_corners)
    from extract_side_changes_rtmpose import (
        DET_MODEL_URL, _create_det_model, dedupe_boxes, point_frames,
        _named_corners, _segment_distance, _quad_distance, _line_y_at)
    det = _create_det_model(DET_MODEL_URL, "onnxruntime", "cpu")
    out = []
    for row in rows:
        mid = str(row["id"])
        folder = CACHE / mid
        folder.mkdir(parents=True, exist_ok=True)
        bucket, key = row["match_json_path"].removeprefix("r2://").split("/", 1)
        mj = folder / "match.json"
        try:
            match = json.loads(mj.read_text())
        except Exception as exc:
            print(f"  {mid[:8]} skipped: {exc}"); continue
        cal = match.get("calibration") or {}
        if not cal.get("table_corners_px"):
            print(f"  {mid[:8]} skipped: no calibration"); continue
        pts = sorted(match.get("points") or [], key=lambda p: int(p["idx"]))
        if not pts: continue
        step = max(1, len(pts) // per_match)
        picks = pts[::step][:per_match]
        prefix = key.rsplit("/", 1)[0]
        frames_out = []
        for point in picks:
            clip_name = str(point.get("clip") or "").split("/")[-1]
            if not clip_name: continue
            local = folder / clip_name
            if not local.exists():
                continue
            try:
                fps, n, w, h = _clip_metadata(local)
            except Exception:
                continue
            c = cal if "size" in cal else {
                **cal, "size": [int((match.get("source") or {}).get("width") or w),
                                int((match.get("source") or {}).get("height") or h)]}
            corners = _scaled_corners(c, w, h); named = _named_corners(corners)
            idxs, anchor = point_frames(point, n, fps, 3)
            cap = cv2.VideoCapture(str(local))
            img = _read_frame(cap, idxs[len(idxs) // 2] if idxs else n // 2)
            cap.release()
            if img is None: continue
            people = []
            for b in dedupe_boxes([[float(v) for v in q] for q in det(img)]):
                ax = (b[0] + b[2]) / 2; ay = b[3]; ht = max(1.0, b[3] - b[1])
                nm = ((named["A"][0]+named["B"][0])/2, (named["A"][1]+named["B"][1])/2)
                fm = ((named["C"][0]+named["D"][0])/2, (named["C"][1]+named["D"][1])/2)
                axis = (fm[0]-nm[0], fm[1]-nm[1]); alen = math.hypot(*axis) or 1.0
                halfw = math.hypot(named["A"][0]-named["B"][0],
                                   named["A"][1]-named["B"][1])/2 or 1.0
                people.append(dict(
                    box=[round(v,1) for v in b], h=round(ht,1),
                    lat=round(abs((ax-nm[0])*axis[1]-(ay-nm[1])*axis[0])/alen/halfw,3),
                    along=round(((ax-nm[0])*axis[0]+(ay-nm[1])*axis[1])/(alen*alen),3),
                    qd=round(_quad_distance(ax,ay,named),1),
                    below=bool(ay > _line_y_at(ax, named["A"], named["B"])),
                    dn=round(_segment_distance(ax,ay,named["A"],named["B"]),1),
                    df=round(_segment_distance(ax,ay,named["C"],named["D"]),1)))
            if len(people) < 2: continue
            vis = img.copy()
            for i, p in enumerate(people):
                x0,y0,x1,y1 = [int(v) for v in p["box"]]
                cv2.rectangle(vis,(x0,y0),(x1,y1),(90,200,255),2)
                cv2.putText(vis,str(i+1),(x0+3,max(16,y0+18)),
                            cv2.FONT_HERSHEY_SIMPLEX,0.6,(90,200,255),2)
            quad = __import__("numpy").array([named[k] for k in "ABCD"], dtype="int32")
            cv2.polylines(vis,[quad],True,(255,210,60),2)
            ok, buf = cv2.imencode(".jpg", vis, [cv2.IMWRITE_JPEG_QUALITY, 74])
            frames_out.append(dict(idx=int(point["idx"]), anchor=anchor,
                w=w, h=h, people=people,
                img=base64.b64encode(buf.tobytes()).decode() if ok else ""))
        if frames_out:
            out.append(dict(match=mid, venue=row["venue"],
                            owner=row["email"].split("@")[0], frames=frames_out))
            print(f"  {mid[:8]} {row['venue']:<16} {len(frames_out)} frames")
    return out


def render(data):
    blocks = []
    total = sum(len(m["frames"]) for m in data)
    for m in data:
        short = m["match"][:8]
        cards = []
        for fr in m["frames"]:
            boxes = "".join(
                f'<i class="hit" data-i="{i}" style="left:{p["box"][0]/fr["w"]*100:.3f}%;'
                f'top:{p["box"][1]/fr["h"]*100:.3f}%;'
                f'width:{(p["box"][2]-p["box"][0])/fr["w"]*100:.3f}%;'
                f'height:{(p["box"][3]-p["box"][1])/fr["h"]*100:.3f}%"'
                f'><span>{i+1}</span></i>'
                for i, p in enumerate(fr["people"]))
            picker = "".join(
                f'<button class="pick" data-i="{i}">{i+1}</button>'
                for i in range(len(fr["people"])))
            key = f"{short}@{fr['idx']}"
            cards.append(f'''
  <div class="frame" data-key="{key}">
    <div class="wrap"><img src="data:image/jpeg;base64,{fr['img']}" alt="">
      {boxes}</div>
    <div class="picker">{picker}</div>
    <div class="row">
      <span class="lbl">point {fr['idx']}</span>
      <span class="state" data-state>click a box: 1st = NEAR, 2nd = FAR</span>
      <button class="mini" data-none>No two players visible</button>
      <button class="mini" data-clear>Clear</button>
    </div>
  </div>''')
        blocks.append(f'''
<section class="match">
  <h2>{html.escape(short)} · {html.escape(m["venue"])}
      <span class="who">{html.escape(m["owner"])}</span></h2>
  <div class="frames">{"".join(cards)}</div>
</section>''')
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Label the players</title><style>
:root{{color-scheme:dark}}
body{{margin:0;padding:22px;background:#09090b;color:#e4e4e7;
 font:15px/1.5 ui-sans-serif,-apple-system,Segoe UI,Roboto,sans-serif}}
h1{{font-size:21px;margin:0 0 4px}}
.bar{{position:sticky;top:0;z-index:9;background:#09090b;padding:12px 0 13px;
 border-bottom:1px solid #27272a;margin-bottom:18px;display:flex;gap:12px;
 align-items:center;flex-wrap:wrap}}
.bar .grow{{flex:1}}
.howto{{border:1px solid #27272a;border-left:3px solid #22d3ee;border-radius:10px;
 padding:12px 16px;margin-bottom:18px;max-width:70ch;font-size:14px;color:#a1a1aa}}
.match{{border:1px solid #27272a;border-radius:12px;padding:14px;margin-bottom:18px;
 background:#0e0e10;scroll-margin-top:92px}}
h2{{font-size:15px;margin:0 0 10px}}
.who{{font-size:12px;color:#71717a;font-weight:400;margin-left:6px}}
.frames{{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px}}
.wrap{{position:relative;line-height:0}}
img{{width:100%;border-radius:8px;display:block}}
.hit{{position:absolute;background:transparent;border:2px solid rgba(160,160,170,.75);
 border-radius:4px;pointer-events:none;padding:0}}
.hit[data-hi]{{border-color:#fff;background:rgba(255,255,255,.14)}}
.picker{{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}}
button.pick{{font:inherit;font-size:13px;font-weight:600;min-width:30px;
 padding:4px 8px;border-radius:7px;border:1px solid #3f3f46;background:#141417;
 color:#e4e4e7;cursor:pointer}}
button.pick:hover{{border-color:#a1a1aa}}
button.pick[data-sel="near"]{{border-color:#4ade80;color:#4ade80;
 background:rgba(74,222,128,.15)}}
button.pick[data-sel="far"]{{border-color:#f0abfc;color:#f0abfc;
 background:rgba(240,171,252,.15)}}
.hit span{{position:absolute;left:2px;top:2px;font-size:10px;font-weight:700;
 color:#5eead4;background:rgba(0,0,0,.55);padding:0 3px;border-radius:3px}}
.hit[data-sel="near"]{{border-color:#4ade80;background:rgba(74,222,128,.22)}}
.hit[data-sel="far"]{{border-color:#f0abfc;background:rgba(240,171,252,.22)}}
.hit[data-sel] span::after{{content:attr(data-tag);margin-left:3px}}
.row{{display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap}}
.lbl{{font-size:12px;color:#71717a}}
.state{{font-size:12px;color:#a1a1aa;flex:1}}
.state[data-done]{{color:#4ade80}}
button.mini{{font:inherit;font-size:12px;padding:3px 10px;border-radius:999px;
 border:1px solid #3f3f46;background:transparent;color:#a1a1aa;cursor:pointer}}
button.mini:hover{{border-color:#52525b;color:#e4e4e7}}
button.mini[aria-pressed="true"]{{border-color:#fbbf24;color:#fbbf24}}
#copy{{font:inherit;font-size:14px;padding:7px 16px;border-radius:999px;
 border:1px solid #3f3f46;background:transparent;color:#e4e4e7;cursor:pointer}}
</style></head><body>
<div class="bar"><div class="grow"><h1>Label the players</h1>
<div class="lbl">Done <strong id="n">0</strong> of {total} frames</div></div>
<button id="copy">Copy labels</button></div>
<div class="howto">Under each frame is a numbered button per person detected. Hover one to
highlight that box in the picture, then click it. First click marks the
<strong>near</strong> player, second the <strong>far</strong>. Click again
to unset.
Every non-PingPod upload is here, several frames each, so a frame that catches
a changeover or a stoppage is fine — just mark it "No two players visible"
and move on.</div>
{"".join(blocks)}
<script>
const KEY='ponglens-player-labels';
const S=JSON.parse(localStorage.getItem(KEY)||'{{}}');
function paint(f){{
  const k=f.dataset.key, v=S[k]||{{}}, st=f.querySelector('[data-state]');
  f.querySelectorAll('.hit').forEach(b=>{{
    const i=+b.dataset.i;
    if(v.near===i){{b.dataset.sel='near';b.querySelector('span').dataset.tag='NEAR';}}
    else if(v.far===i){{b.dataset.sel='far';b.querySelector('span').dataset.tag='FAR';}}
    else{{delete b.dataset.sel;delete b.querySelector('span').dataset.tag;}}
  }});
  f.querySelectorAll('.pick').forEach(b=>{{
    const i=+b.dataset.i;
    if(v.near===i) b.dataset.sel='near';
    else if(v.far===i) b.dataset.sel='far';
    else delete b.dataset.sel;
  }});
  f.querySelector('[data-none]').setAttribute('aria-pressed',String(!!v.none));
  const done=v.none||(v.near!=null&&v.far!=null);
  if(done) st.setAttribute('data-done',''); else st.removeAttribute('data-done');
  st.textContent = v.none ? 'no two players' :
    (v.near!=null&&v.far!=null) ? `near #${{v.near+1}} · far #${{v.far+1}}` :
    (v.near!=null) ? `near #${{v.near+1}} — now click the far player` :
    'click a number: 1st = NEAR, 2nd = FAR';
}}
function tally(){{
  let n=0; for(const k in S){{const v=S[k]; if(v.none||(v.near!=null&&v.far!=null))n++;}}
  document.getElementById('n').textContent=n;
  localStorage.setItem(KEY,JSON.stringify(S));
}}
document.querySelectorAll('.frame').forEach(f=>{{
  const k=f.dataset.key; S[k]=S[k]||{{}};
  f.querySelectorAll('.pick').forEach(b=>{{
    const hl=f.querySelector(`.hit[data-i="${{b.dataset.i}}"]`);
    b.addEventListener('mouseenter',()=>hl&&hl.setAttribute('data-hi',''));
    b.addEventListener('mouseleave',()=>hl&&hl.removeAttribute('data-hi'));
  }});
  f.querySelectorAll('.pick').forEach(b=>b.addEventListener('click',()=>{{
    const v=S[k], i=+b.dataset.i; delete v.none;
    if(v.near===i) delete v.near;
    else if(v.far===i) delete v.far;
    else if(v.near==null) v.near=i;
    else if(v.far==null) v.far=i;
    else {{v.near=i; delete v.far;}}
    paint(f); tally();
  }}));
  f.querySelector('[data-none]').addEventListener('click',()=>{{
    const v=S[k]; if(v.none) delete v.none; else {{S[k]={{none:true}};}}
    paint(f); tally();
  }});
  f.querySelector('[data-clear]').addEventListener('click',()=>{{
    S[k]={{}}; paint(f); tally();
  }});
  paint(f);
}});
tally();
document.getElementById('copy').addEventListener('click',async()=>{{
  const out={{}}; for(const k in S){{const v=S[k];
    if(v.none||(v.near!=null&&v.far!=null)) out[k]=v;}}
  await navigator.clipboard.writeText(JSON.stringify(out));
  const b=document.getElementById('copy'); b.textContent='Copied';
  setTimeout(()=>b.textContent='Copy labels',1200);
}});
</script></body></html>'''


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--per-match", type=int, default=5)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--matches-json", type=Path, default=None,
                    help="pre-dumped match list; the rtmpose venv has "
                         "OpenCV but no database driver, so the query "
                         "runs separately in the worker venv")
    ap.add_argument("--dump-matches", type=Path, default=None)
    ap.add_argument("--fetch", type=Path, default=None,
                    help="download match.json and the sampled clips for "
                         "every match in this list (worker venv: it has "
                         "boto3 and psycopg2, the rtmpose venv has cv2)")
    a = ap.parse_args()
    if a.dump_matches:
        conn, cur = db()
        rows = matches(cur, a.limit)
        a.dump_matches.write_text(json.dumps([
            {k: str(v) for k, v in r.items()} for r in rows]))
        print(f"{len(rows)} matches -> {a.dump_matches}")
        return
    if a.fetch:
        rows = json.loads(a.fetch.read_text())
        client = r2(); got = 0
        for row in rows:
            mid = str(row["id"]); folder = CACHE / mid
            folder.mkdir(parents=True, exist_ok=True)
            bucket, key = row["match_json_path"].removeprefix(
                "r2://").split("/", 1)
            mj = folder / "match.json"
            try:
                if not mj.exists():
                    client.download_file(bucket, key, str(mj))
                match = json.loads(mj.read_text())
            except Exception as exc:
                print(f"  {mid[:8]} match.json failed: {exc}"); continue
            if not (match.get("calibration") or {}).get("table_corners_px"):
                print(f"  {mid[:8]} no calibration"); continue
            pts = sorted(match.get("points") or [],
                         key=lambda q: int(q["idx"]))
            if not pts: continue
            step = max(1, len(pts) // a.per_match)
            prefix = key.rsplit("/", 1)[0]
            n = 0
            for point in pts[::step][:a.per_match]:
                name = str(point.get("clip") or "").split("/")[-1]
                if not name: continue
                local = folder / name
                if local.exists(): n += 1; continue
                try:
                    client.download_file(bucket, f"{prefix}/{name}", str(local))
                    n += 1
                except Exception:
                    pass
            got += 1
            print(f"  {mid[:8]} {row['venue']:<16} {n} clips")
        print(f"fetched {got} matches into {CACHE}")
        return
    if a.matches_json:
        rows = json.loads(a.matches_json.read_text())
        for r in rows: r["pts"] = int(r["pts"])
    else:
        conn, cur = db()
        rows = matches(cur, a.limit)
    if a.limit: rows = rows[:a.limit]
    print(f"{len(rows)} non-PingPod matches")
    data = collect(rows, a.per_match)
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / "features.json").write_text(json.dumps(data and [
        {"match": m["match"], "venue": m["venue"], "owner": m["owner"],
         "frames": [{"idx": f["idx"], "anchor": f["anchor"], "w": f["w"],
                     "h": f["h"], "people": f["people"]} for f in m["frames"]]}
        for m in data]))
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(render(data))
    print(f"\n{len(data)} matches, {sum(len(m['frames']) for m in data)} frames "
          f"-> {a.out} ({a.out.stat().st_size/1e6:.1f} MB)")
    print(f"features -> {CACHE/'features.json'}")


if __name__ == "__main__":
    main()

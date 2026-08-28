"""Build the page for judging how aggressive the rally-end trim is.

One row per point, each with its own clip and two markers on the timeline:
where the video ends today, and where it would end with the trim. Sorted
by how much is being taken, so the worst cases are the first thing on
screen rather than something to scroll for.

The question this page has to answer is not "how much time is saved" —
that is already measured. It is "does the trim ever cut the shot that won
the point", and only eyes can answer it, so every row plays the last few
seconds and stops where the trim would.

  python -m worker.build_rally_end_review --match <uuid> [...] \
      --out docs/research/rally-end-review.html
"""
from __future__ import annotations

import argparse
import html
import json
import urllib.error
import urllib.request

CLIP_PRE_DEFAULT = 1.2
CLIP_POST_DEFAULT = 1.3
TABLE_W_M, TABLE_L_M, EDGE_PAD_M = 1.525, 2.74, 0.15


def on_table(c: dict) -> bool:
    u, v = c.get("u"), c.get("v")
    if not isinstance(u, (int, float)) or not isinstance(v, (int, float)):
        return False
    return (-EDGE_PAD_M <= u <= TABLE_W_M + EDGE_PAD_M
            and -EDGE_PAD_M <= v <= TABLE_L_M + EDGE_PAD_M)


def collect(conn, match_id: str, buffer_s: float) -> dict | None:
    from .worker import r2, R2_MEDIA_BUCKET

    cur = conn.cursor()
    cur.execute("""select opponent_name, venue, match_json_path, clip_pads,
                          user_side, created_at
                   from public.matches where id=%s""", (match_id,))
    row = cur.fetchone()
    if row is None or not row[2]:
        return None
    opponent, venue, mj_path, clip_pads, user_side, created = row
    key = mj_path.replace(f"r2://{R2_MEDIA_BUCKET}/", "")
    try:
        mj = json.loads(r2().get_object(
            Bucket=R2_MEDIA_BUCKET, Key=key)["Body"].read())
    except Exception:                              # noqa: BLE001
        return None
    pre = (clip_pads or {}).get("pre", CLIP_PRE_DEFAULT)
    post = (clip_pads or {}).get("post", CLIP_POST_DEFAULT)

    cur.execute("""select id, idx, t0, t1, placement, rally_end_cut_s,
                          clip_path, confirmed_winner, is_let
                   from public.points
                   where match_id=%s and deleted is not true
                   order by idx""", (match_id,))
    points = []
    for pid, idx, t0, t1, placement, rec, clip, winner, is_let in cur.fetchall():
        if t0 is None or t1 is None or not clip:
            continue
        t0, t1 = float(t0), float(t1)
        # Clip-relative clocks: the file opens at t0 - pre, so everything
        # below is measured from there. Mixing this with the cut clock is
        # the mistake this codebase makes most, so nothing here touches it.
        c0 = max(0.0, t0 - pre)
        clip_len = (t1 + post) - c0
        cands = (placement or {}).get("candidates") or []
        hits = [c for c in cands
                if on_table(c) and isinstance(c.get("t"), (int, float))
                and t0 <= c["t"] <= t1]
        end_s = max((c["t"] for c in hits), default=None)
        if end_s is None:
            continue
        # The same guard the players apply: an ending that does not explain
        # where the point already ends is the last bounce the detector
        # managed to see, not the moment the rally stopped. Showing those
        # rows would be showing trims that never happen.
        if t1 - end_s > 2.7:
            continue
        rally_in_clip = float(end_s) - c0
        trimmed = rally_in_clip + buffer_s
        # points.clip_path stores the full r2:// URI, not the object key.
        # Signing the URI signs a key that does not exist, and presigning
        # never checks — every URL comes back looking perfectly normal and
        # 400s on first byte.
        clip_key = clip.replace(f"r2://{R2_MEDIA_BUCKET}/", "", 1)
        try:
            url = r2().generate_presigned_url(
                "get_object",
                Params={"Bucket": R2_MEDIA_BUCKET, "Key": clip_key,
                        "ResponseContentDisposition": "inline"},
                ExpiresIn=7 * 86400,
            )
        except Exception:                          # noqa: BLE001
            continue
        points.append({
            "id": str(pid), "idx": idx, "url": url,
            "clipLen": round(clip_len, 2),
            "rallyEnd": round(rally_in_clip, 2),
            "trimmedEnd": round(min(trimmed, clip_len), 2),
            "saved": round(max(0.0, clip_len - trimmed), 2),
            "winner": winner, "isLet": bool(is_let),
            "bounces": len(hits),
        })
    return {
        "id": match_id, "opponent": opponent or "—", "venue": venue or "—",
        "userSide": user_side, "played": str(created)[:10],
        "scored": sum(1 for p in points if p["winner"]),
        "pre": pre, "post": post,
        "duration": round((mj.get("source") or {}).get("duration", 0), 1),
        "points": points,
    }


PAGE = """<!doctype html>
<meta charset="utf-8">
<title>Rally-end trim review</title>
<style>
 :root {{ color-scheme: dark; --edge:#26262b; --dim:#8b8b93; --cyan:#4dd6e8;
          --amber:#f0b45e; }}
 body {{ margin:0; background:#0b0b0d; color:#e8e8ea; font:15px/1.55
         ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif; }}
 main {{ max-width:1100px; margin:0 auto; padding:32px 20px 80px; }}
 h1 {{ font-size:26px; margin:0 0 6px; }}
 .sub {{ color:var(--dim); max-width:70ch; margin:0 0 26px; }}
 .bar {{ display:flex; flex-wrap:wrap; gap:8px; margin:18px 0 24px; }}
 button {{ background:#141418; color:#c9c9d1; border:1px solid var(--edge);
           border-radius:999px; padding:7px 14px; font:inherit; font-size:13px;
           cursor:pointer; }}
 button.on {{ border-color:var(--cyan); color:var(--cyan);
              background:rgba(77,214,232,.12); }}
 .stat {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
          gap:12px; margin-bottom:26px; }}
 .stat div {{ border:1px solid var(--edge); border-radius:12px; padding:12px 14px;
              background:#101014; }}
 .stat b {{ display:block; font-size:22px; font-variant-numeric:tabular-nums; }}
 .stat span {{ color:var(--dim); font-size:12px; }}
 .row {{ border:1px solid var(--edge); border-radius:14px; background:#101014;
         padding:14px; margin-bottom:14px; display:grid;
         grid-template-columns:minmax(0,420px) minmax(0,1fr); gap:16px; }}
 @media (max-width:760px) {{ .row {{ grid-template-columns:1fr; }} }}
 video {{ width:100%; border-radius:10px; background:#000; display:block; }}
 .meta {{ font-size:13px; }}
 .meta h3 {{ margin:0 0 8px; font-size:15px; }}
 .kv {{ display:grid; grid-template-columns:auto 1fr; gap:2px 12px;
        font-variant-numeric:tabular-nums; }}
 .kv span:nth-child(odd) {{ color:var(--dim); }}
 .track {{ position:relative; height:26px; margin:12px 0 8px;
           background:#1a1a20; border-radius:6px; overflow:hidden; }}
 .keep {{ position:absolute; inset:0 auto 0 0; background:rgba(77,214,232,.22); }}
 .cutpart {{ position:absolute; inset:0 0 0 auto; background:rgba(240,180,94,.18); }}
 .mark {{ position:absolute; top:0; bottom:0; width:2px; background:var(--cyan); }}
 .legend {{ color:var(--dim); font-size:12px; }}
 .tag {{ display:inline-block; border:1px solid var(--edge); border-radius:999px;
         padding:2px 9px; font-size:11px; color:var(--dim); margin-right:6px; }}
 .big {{ color:var(--amber); }}
 .stopped {{ color:var(--cyan); font-size:12px; margin-left:8px; }}
 h2 {{ font-size:17px; margin:34px 0 4px; }}
 .mnote {{ color:var(--dim); font-size:13px; margin:0 0 14px; }}
</style>
<main>
<h1>Rally-end trim review</h1>
<p class="sub">Each clip starts four seconds before the proposed end and
stops there, so what you are judging is the last moment of the rally. Press
the button to watch the whole clip instead. Every point ends today at the
padded clip end, which carries
2.6 seconds after the last bounce on the table so a winner tap lands inside
it. On a match nobody scores there is no tap coming. Each row below plays
its clip and stops where the trim would, with a {buffer}s buffer after the
rally. The cyan line is the proposed end; the amber band is what gets
dropped. Sorted by how much is taken, so the most aggressive cuts are
first.</p>
<p class="sub"><b>What to watch for:</b> the trim is wrong if the clip stops
before the shot that decided the point — most likely on a rally that ended
with a ball hit long or wide, which never touches the table again.</p>
<div class="stat">{stats}</div>
<div class="bar">{filters}</div>
{body}
</main>
<script>
// preload="metadata" often finishes BEFORE this script runs, so waiting on
// loadedmetadata alone silently never seeks and every clip starts at zero.
function whenReady(v, fn) {{
  if (v.readyState >= 1) fn();
  else v.addEventListener('loadedmetadata', fn, {{ once: true }});
}}
document.querySelectorAll('video').forEach(v => {{
  const end = parseFloat(v.dataset.end);
  const from = Math.max(0, end - 4);
  const label = v.closest('.row').querySelector('.stopped');
  whenReady(v, () => {{ v.currentTime = from; }});
  v.addEventListener('play', () => {{ if (label) label.hidden = true; }});
  v.addEventListener('timeupdate', () => {{
    if (v.dataset.mode === 'trim' && v.currentTime >= end) {{
      v.pause();
      v.currentTime = end;
      if (label) label.hidden = false;
    }}
  }});
}});
document.querySelectorAll('[data-toggle]').forEach(b => {{
  b.addEventListener('click', () => {{
    const v = document.getElementById(b.dataset.toggle);
    const trim = v.dataset.mode !== 'trim';
    v.dataset.mode = trim ? 'trim' : 'full';
    b.textContent = trim ? 'Stopping at the trim' : 'Playing the whole clip';
    b.classList.toggle('on', trim);
    whenReady(v, () => {{
      v.currentTime = trim ? Math.max(0, parseFloat(v.dataset.end) - 4) : 0;
      v.play();
    }});
  }});
}});
document.querySelectorAll('[data-filter]').forEach(b => {{
  b.addEventListener('click', () => {{
    const f = b.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(x =>
      x.classList.toggle('on', x === b));
    document.querySelectorAll('.row').forEach(r => {{
      const big = parseFloat(r.dataset.saved) >= 2.5;
      const unscored = r.dataset.scored === '0';
      r.style.display =
        f === 'all' || (f === 'big' && big) || (f === 'unscored' && unscored)
          ? '' : 'none';
    }});
  }});
}});
</script>
"""


def render(matches: list[dict], buffer_s: float) -> str:
    allp = [(m, p) for m in matches for p in m["points"]]
    allp.sort(key=lambda mp: -mp[1]["saved"])
    saved = [p["saved"] for _, p in allp]
    total = sum(saved)
    med = sorted(saved)[len(saved) // 2] if saved else 0

    stats = "".join([
        f"<div><b>{len(allp)}</b><span>points with an observed ending</span></div>",
        f"<div><b>{total / 60:.1f} min</b><span>dropped in total</span></div>",
        f"<div><b>{med:.2f}s</b><span>median per point</span></div>",
        f"<div><b>{max(saved, default=0):.2f}s</b><span>largest single trim</span></div>",
        f"<div><b>{buffer_s}s</b><span>buffer after the rally</span></div>",
    ])
    filters = ("<button data-filter='all' class='on'>All "
               f"{len(allp)}</button>"
               "<button data-filter='big'>Trims over 2.5s "
               f"{sum(1 for s in saved if s >= 2.5)}</button>"
               "<button data-filter='unscored'>Unscored matches "
               f"{sum(1 for m, _ in allp if m['scored'] == 0)}</button>")

    rows = []
    for m, p in allp:
        keep_pc = 100 * p["trimmedEnd"] / max(p["clipLen"], 1e-6)
        big = " big" if p["saved"] >= 2.5 else ""
        tags = f"<span class='tag'>{html.escape(m['opponent'])} · point {p['idx']}</span>"
        if not m["scored"]:
            tags += "<span class='tag'>match never scored</span>"
        if p["isLet"]:
            tags += "<span class='tag'>let</span>"
        rows.append(f"""
<div class="row" data-saved="{p['saved']}" data-scored="{m['scored']}">
  <div>
    <video id="v{p['id']}" src="{html.escape(p['url'])}" controls preload="metadata"
           data-end="{p['trimmedEnd']}" data-mode="trim"></video>
  </div>
  <div class="meta">
    <h3>{tags}</h3>
    <div class="track">
      <div class="keep" style="width:{keep_pc:.2f}%"></div>
      <div class="cutpart" style="width:{100 - keep_pc:.2f}%"></div>
      <div class="mark" style="left:{keep_pc:.2f}%"></div>
    </div>
    <p class="legend">Cyan is kept, amber is dropped.</p>
    <div class="kv">
      <span>Clip today</span><span>{p['clipLen']:.2f}s</span>
      <span>Last bounce on the table</span><span>{p['rallyEnd']:.2f}s</span>
      <span>Proposed end</span><span>{p['trimmedEnd']:.2f}s</span>
      <span>Dropped</span><span class="{big.strip()}">{p['saved']:.2f}s</span>
      <span>Bounces counted</span><span>{p['bounces']}</span>
    </div>
    <p><button data-toggle="v{p['id']}" class="on">Stopping at the trim</button>
       <span class="stopped" hidden>stopped at the proposed end</span></p>
  </div>
</div>""")

    head = []
    for m in matches:
        head.append(
            f"<h2>{html.escape(m['opponent'])} — {html.escape(m['venue'])}</h2>"
            f"<p class='mnote'>{len(m['points'])} points with an ending · "
            f"{'never scored' if not m['scored'] else str(m['scored']) + ' scored'}"
            f" · {m['played']}</p>")
    return PAGE.format(buffer=buffer_s, stats=stats, filters=filters,
                       body="".join(rows))


def first_byte_ok(url: str) -> tuple[bool, str]:
    """Fetch one byte, so a page of dead links cannot ship again.

    Presigning does not check that the key exists, so a wrong key produces
    URLs that look perfectly normal and 400 the moment a browser asks for
    video. The only way to know is to ask for some.
    """
    req = urllib.request.Request(url, headers={"Range": "bytes=0-99"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read(100)
            if not body:
                return False, "empty body"
            return True, f"{r.status}, {r.headers.get('Content-Type')}"
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}"
    except Exception as exc:                       # noqa: BLE001
        return False, str(exc)


def main(argv=None) -> None:
    from .worker import connect

    ap = argparse.ArgumentParser()
    ap.add_argument("--match", action="append", default=[], required=True)
    ap.add_argument("--buffer", type=float, default=0.5)
    ap.add_argument("--out", default="docs/research/rally-end-review.html")
    args = ap.parse_args(argv)

    conn = connect()
    matches = []
    for mid in args.match:
        m = collect(conn, mid, args.buffer)
        if m is None:
            print(f"{mid[:8]}  skipped")
            continue
        print(f"{mid[:8]}  {m['opponent']:14s} {len(m['points']):4d} points, "
              f"{sum(p['saved'] for p in m['points']) / 60:.1f} min dropped")
        matches.append(m)
    probe = next((p for m in matches for p in m["points"]), None)
    if probe is None:
        print("no points to show")
        return
    ok, detail = first_byte_ok(probe["url"])
    print(f"\nclip URL check: {'OK' if ok else 'FAILED'} ({detail})")
    if not ok:
        raise SystemExit(
            "refusing to write a page whose videos will not play")

    with open(args.out, "w") as fh:
        fh.write(render(matches, args.buffer))
    print(f"-> {args.out}")


if __name__ == "__main__":
    main()

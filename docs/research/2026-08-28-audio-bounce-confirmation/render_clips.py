"""The clips, with the sound drawn underneath them and moving in time.

  ./venv/bin/python render_clips.py <cards.json> <out.html>

Written into the serve-review folder so it sits beside `clipsun/` and the
videos load with no copying. Open it at http://localhost:8899/audio.html

Each card is one point. Press play and the line sweeps the sound while the
video runs, so every mark can be checked by eye and ear at once:

  * the blue curve is the onset strength the detector actually computed;
  * an amber bar is a moment the detector called an impact;
  * a green dot is a table bounce the ball tracker found, a purple dot a
    paddle contact, and a red ring means that event projects somewhere
    off the table — which is what "no landing" really means.

Nothing here is recomputed for display. The curve, the bars and the dots
are the same numbers the experiment was measured on.
"""
import html
import json
import os
import sys
from collections import Counter

REASONS = {
    "travelled_backwards": "Ball went backwards",
    "same_side_of_net": "Both bounces same side",
    "pair_too_far_apart": "Bounces too far apart",
    "bounce_too_near_net": "Bounce too near the net",
    "rally_already_running": "Rally already running",
    "no_apex": "No arc between bounces",
}

CSS = """
*{box-sizing:border-box}
body{margin:0;background:#09090b;color:#e4e4e7;
  font:15px/1.6 ui-sans-serif,-apple-system,system-ui,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:30px 18px 120px}
h1{font-size:27px;margin:0 0 10px;letter-spacing:-.02em}
p{color:#a1a1aa;max-width:80ch}
p b,strong{color:#e4e4e7}
code{font:12.5px ui-monospace,Menlo,monospace;background:#18181b;
  padding:1px 5px;border-radius:4px;color:#d4d4d8}
.legend{display:flex;flex-wrap:wrap;gap:16px;margin:16px 0 6px;
  font-size:13px;color:#a1a1aa}
.legend span{display:flex;align-items:center;gap:6px}
.k{width:12px;height:12px;border-radius:50%;display:inline-block}
.kbar{width:3px;height:14px;border-radius:1px;display:inline-block}
.chips{display:flex;flex-wrap:wrap;gap:7px;margin:18px 0 8px}
.chip{background:#18181b;border:1px solid #27272a;color:#a1a1aa;
  border-radius:999px;padding:6px 13px;font:13px inherit;cursor:pointer}
.chip.on{background:#164e63;border-color:#22d3ee;color:#ecfeff}
.chip b{color:#e4e4e7;margin-left:5px}
.card{background:#101012;border:1px solid #1f1f23;border-radius:13px;
  margin:0 0 18px;overflow:hidden}
header{display:flex;align-items:center;gap:10px;padding:11px 14px;
  border-bottom:1px solid #1f1f23;flex-wrap:wrap;font-size:13px;color:#71717a}
header .n{color:#52525b;font:12px ui-monospace,monospace;min-width:30px}
header b{color:#e4e4e7;font-size:14px}
.tag{font-size:12px;padding:3px 9px;border-radius:999px;background:#27272a;
  color:#d4d4d8}
.body{display:grid;grid-template-columns:minmax(0,1fr);gap:0}
.vid{background:#000;position:relative}
video{width:100%;display:block;max-height:52vh;background:#000}
.plot{position:relative;background:#0b0b0d;border-top:1px solid #1f1f23;
  cursor:crosshair}
canvas{width:100%;height:132px;display:block}
.head{position:absolute;top:0;bottom:0;width:1px;background:#22d3ee;
  pointer-events:none;box-shadow:0 0 6px #22d3ee}
.foot{display:flex;gap:14px;flex-wrap:wrap;align-items:center;
  padding:9px 14px;font-size:12.5px;color:#71717a;
  border-top:1px solid #1f1f23}
.foot .warn{color:#f87171}
.foot .ok{color:#4ade80}
button.play{background:#18181b;border:1px solid #27272a;color:#e4e4e7;
  border-radius:999px;padding:5px 15px;font:13px inherit;cursor:pointer}
.count{color:#52525b;font-size:13px}
.hint{font-size:13px;color:#52525b;margin-top:6px}
.burned{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));
  gap:12px;margin:14px 0 6px}
.burned figure{margin:0}
.burned video{width:100%;border-radius:9px;border:1px solid #1f1f23}
.burned figcaption{font-size:12px;color:#71717a;padding:5px 2px 0}
"""

JS = """
const CARDS = __DATA__;
const wrap = document.getElementById('cards');
const COL = {hi:'#38bdf8', bar:'#f59e0b', bar2:'#52525b', bounce:'#4ade80',
             contact:'#a78bfa', off:'#f87171', card:'rgba(255,255,255,.05)'};

function draw(cv, c) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  g.clearRect(0, 0, W, H);
  const x = t => t / c.span * W;
  const top = 8, bot = H - 26;

  // the window the assembler called a point
  g.fillStyle = COL.card;
  g.fillRect(x(c.card[0]), 0, Math.max(1, x(c.card[1]) - x(c.card[0])), H);

  // quieter band behind, in grey, so the two can be compared
  const line = (series, colour, width) => {
    g.beginPath();
    series.forEach((v, i) => {
      const px = i / (series.length - 1) * W;
      const py = bot - (v / 100) * (bot - top);
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    });
    g.strokeStyle = colour; g.lineWidth = width; g.stroke();
  };
  line(c.lo, '#3f3f46', 1);
  line(c.hi, COL.hi, 1.2);

  // every impact the detector picked
  c.plo.forEach(([t]) => {
    g.fillStyle = COL.bar2; g.fillRect(x(t), bot, 1, 8);
  });
  c.phi.forEach(([t, z]) => {
    g.fillStyle = COL.bar;
    g.globalAlpha = Math.min(1, 0.35 + z / 24);
    g.fillRect(x(t), top, 1.5, bot - top);
    g.globalAlpha = 1;
  });

  // what the ball tracker saw
  c.ev.forEach(e => {
    const px = x(e.t), py = e.kind === 'bounce' ? bot + 13 : bot + 13;
    g.beginPath(); g.arc(px, py, 5, 0, 7);
    g.fillStyle = e.kind === 'bounce' ? COL.bounce : COL.contact;
    g.fill();
    if (!e.on) {
      g.beginPath(); g.arc(px, py, 8, 0, 7);
      g.strokeStyle = COL.off; g.lineWidth = 2; g.stroke();
    }
  });

  // one second gridlines
  g.strokeStyle = '#1f1f23'; g.lineWidth = 1;
  for (let s = 1; s < c.span; s++) {
    g.beginPath(); g.moveTo(x(s), bot); g.lineTo(x(s), bot + 4); g.stroke();
  }
}

function build(c, n) {
  const el = document.createElement('section');
  el.className = 'card';
  el.dataset.reason = c.reason;
  el.dataset.match = c.match;
  const off = c.ev.filter(e => !e.on).length;
  el.innerHTML = `
    <header><span class="n">${n}</span>
      <span class="tag">${REASON[c.reason] || c.reason}</span>
      <b>${c.who}</b><span>${c.label} · point ${c.idx} ·
      ${c.a.toFixed(1)}s into the match · ${c.span.toFixed(1)}s long</span>
    </header>
    <div class="body">
      <div class="vid"><video preload="metadata" playsinline controls
        src="clipsun/${c.clip}"></video></div>
      <div class="plot"><canvas></canvas><div class="head"
        style="left:0"></div></div>
      <div class="foot">
        <button class="play">play from the start</button>
        <span><b style="color:#f59e0b">${c.phi.length}</b> impacts heard
          (10 kHz+)</span>
        <span><b style="color:#52525b">${c.plo.length}</b> at 1.5–8 kHz</span>
        <span class="ok">${c.ev.length - off} ball events on the table</span>
        <span class="${off ? 'warn' : ''}">${off} projecting off it</span>
        <span>${(c.phi.length / c.span).toFixed(1)} impacts a second</span>
      </div>
    </div>`;
  const cv = el.querySelector('canvas');
  const vid = el.querySelector('video');
  const head = el.querySelector('.head');
  const plot = el.querySelector('.plot');
  let drawn = false, raf = 0;
  const ensure = () => { if (!drawn) { draw(cv, c); drawn = true; } };
  new IntersectionObserver((es, o) => {
    if (es[0].isIntersecting) { ensure(); o.disconnect(); }
  }).observe(cv);
  const tick = () => {
    head.style.left = (vid.currentTime / c.span * 100) + '%';
    if (!vid.paused && !vid.ended) raf = requestAnimationFrame(tick);
  };
  vid.addEventListener('play', () => { ensure(); tick(); });
  vid.addEventListener('pause', () => cancelAnimationFrame(raf));
  vid.addEventListener('seeked', tick);
  vid.addEventListener('timeupdate', tick);
  plot.addEventListener('click', ev => {
    const r = plot.getBoundingClientRect();
    vid.currentTime = (ev.clientX - r.left) / r.width * c.span;
    tick();
  });
  el.querySelector('.play').addEventListener('click', () => {
    document.querySelectorAll('video').forEach(v => { if (v !== vid) v.pause(); });
    vid.currentTime = 0; vid.play();
  });
  window.addEventListener('resize', () => { drawn = false; ensure(); });
  return el;
}

const REASON = __REASONS__;
let active = '';
function render() {
  wrap.innerHTML = '';
  let n = 0;
  CARDS.forEach(c => {
    if (active && c.reason !== active && c.match !== active) return;
    wrap.appendChild(build(c, ++n));
  });
  document.getElementById('count').textContent = n + ' clips shown';
}
document.querySelectorAll('.chip').forEach(ch => {
  ch.onclick = () => {
    document.querySelectorAll('.chip').forEach(o => o.classList.remove('on'));
    active = ch.dataset.k === active ? '' : ch.dataset.k;
    if (active) ch.classList.add('on');
    render();
  };
});
render();
"""


def main():
    cards_path, out_path = sys.argv[1], sys.argv[2]
    cards = json.load(open(cards_path))
    by_reason = Counter(c["reason"] for c in cards)
    by_match = Counter(c["match"] for c in cards)
    names = {c["match"]: f"{c['who']} · {c['label']}" for c in cards}

    peaks = sum(len(c["phi"]) for c in cards)
    events = sum(len(c["ev"]) for c in cards)
    off = sum(1 for c in cards for e in c["ev"] if not e["on"])
    seconds = sum(c["span"] for c in cards)

    chips = ["<button class='chip' data-k=''>every clip"
             f"<b>{len(cards)}</b></button>"]
    for reason, n in by_reason.most_common():
        chips.append(f"<button class='chip' data-k='{reason}'>"
                     f"{html.escape(REASONS.get(reason, reason))}"
                     f"<b>{n}</b></button>")
    for match, n in by_match.most_common():
        chips.append(f"<button class='chip' data-k='{match}'>"
                     f"{html.escape(names[match])}<b>{n}</b></button>")

    head = f"""
<div class='wrap'>
<h1>What the sound looks like, next to the video</h1>
<p>These are the {len(cards)} clips from the serve-review page &mdash; points
where the pipeline found no serve at all. Press play on any of them. The
line sweeps the sound as the video runs, so you can watch and listen at the
same time and judge for yourself how much the audio is worth.</p>
<p><b>Nothing here is recomputed for display.</b> The curve, the bars and the
dots are the same numbers the experiment was measured on: the onset
strength the detector computed, the peaks it picked, and the events the
production extractor found in this clip's own ball track.</p>
<div class='legend'>
  <span><i class='kbar' style='background:#38bdf8;width:12px;height:3px'></i>
    loudness of sharp sounds, 10 kHz and above</span>
  <span><i class='kbar' style='background:#3f3f46;width:12px;height:3px'></i>
    the same at 1.5&ndash;8 kHz</span>
  <span><i class='kbar' style='background:#f59e0b'></i> a sound the detector
    called an impact</span>
  <span><i class='k' style='background:#4ade80'></i> table bounce seen by the
    ball tracker</span>
  <span><i class='k' style='background:#a78bfa'></i> paddle contact</span>
  <span><i class='k' style='background:#4ade80;box-shadow:0 0 0 2px #f87171'>
    </i> ball event that lands off the table</span>
</div>
<p class='hint'>Click anywhere on the graph to jump the video there. The
faint vertical band is the window the assembler called a point.</p>
<p><b>Across all {len(cards)} clips: {peaks:,} sounds were called impacts in
{seconds / 60:.0f} minutes of video</b> &mdash; about
{peaks / seconds:.1f} a second &mdash; against {events:,} events the ball
tracker found, <b>{off:,} of which ({off / max(1, events) * 100:.0f}%) project
somewhere off the table.</b> That second number is the whole problem: when
the tracker locks onto the next table along, the sound of that bounce is
just as real and just as loud as ours.</p>
<h2 style='font-size:19px;margin:34px 0 8px;padding-top:20px;
  border-top:1px solid #1f1f23'>Eight of them as plain video files</h2>
<p>Same thing with the graph and the playhead burned in, if you would
rather just watch. These are in <code>burned/</code> beside this page.</p>
<div id='burned' class='burned'></div>
<div class='chips'>{''.join(chips)}</div>
<h2 style='font-size:19px;margin:34px 0 8px;padding-top:20px;
  border-top:1px solid #1f1f23'>Every clip</h2>
<div class='count' id='count'></div>
<div id='cards'></div>
</div>
"""
    burned_dir = os.path.join(os.path.dirname(out_path), "burned")
    burned = sorted(f for f in os.listdir(burned_dir)
                    if f.endswith(".mp4")) if os.path.isdir(burned_dir) else []
    by_index = {c["i"]: c for c in cards}
    tiles = []
    for name in burned:
        card = by_index.get(int(name.split("_")[0]))
        off = sum(1 for e in card["ev"] if not e["on"]) if card else 0
        caption = (f"{card['who']} &middot; {REASONS.get(card['reason'], card['reason'])}"
                   f" &middot; {len(card['phi'])} sounds, {off} ball events off "
                   f"the table" if card else name)
        tiles.append(f"<figure><video controls preload='metadata' "
                     f"src='burned/{name}'></video>"
                     f"<figcaption>{caption}</figcaption></figure>")
    page_burned = "".join(tiles)

    script = (JS.replace("__DATA__", json.dumps(cards, separators=(",", ":")))
                .replace("__REASONS__", json.dumps(REASONS)))
    page = ("<!doctype html><html lang='en'><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<title>Sound against the video</title><style>" + CSS
            + "</style></head><body>"
            + head.replace("<div id='burned' class='burned'></div>",
                           f"<div class='burned'>{page_burned}</div>")
            + "<script>" + script
            + "</script></body></html>")
    open(out_path, "w").write(page)
    print(f"{out_path}  {os.path.getsize(out_path) / 1e6:.1f} MB, "
          f"{len(cards)} clips")


if __name__ == "__main__":
    main()

"""The review page, with the whole fused card and the evidence drawn on it."""
import base64, html, json, os
from collections import Counter

OUT = ("/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/"
       "dd63c93b-843c-4cc1-9306-421c75c875dd/scratchpad/twenty-second-cap.html")
splits = json.load(open("splits.json"))
OV = json.load(open("overlay.json"))
W_M, L_M, NET_V = 1.525, 2.74, 1.37
GOOD = "both halves scored: the split was right"
BAD = "only the SECOND half scored: the first holds a rally with no winner"
JUNK = "only the first half scored, second deleted: the second was junk"
AMB = "only the FIRST half scored, second kept but unscored"
NONE = "neither half scored"
KEY = {BAD: ("cut", "A rally cut in half", "var(--gone)"),
       GOOD: ("right", "Two points, correctly separated", "var(--found)"),
       AMB: ("amb", "First half scored, second left alone", "var(--warm)"),
       JUNK: ("junk", "A point and a leftover", "var(--toss)"),
       NONE: ("none", "Neither half scored", "var(--muted)")}
ORDER = [BAD, GOOD, AMB, JUNK, NONE]
shown = [s for s in splits if s.get("full") and f"{s['mid'][:8]}-{s['a_idx']}" in OV]
counts = Counter(s["klass"] for s in shown)


def ms(t):
    m = int(t) // 60
    return f"{m}:{t - 60 * m:05.2f}"


def b64(p):
    return base64.b64encode(open(p, "rb").read()).decode()


def strip_svg(d):
    """A ruler under the video: the two cards, every event, the cut, the taps."""
    W, H = 1000, 46
    def x(t):
        return max(0.0, min(1.0, t / d["dur"])) * W
    p = [f'<svg class="strip" viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="img" '
         f'aria-label="timeline of this card">']
    p.append(f'<rect x="0" y="0" width="{W}" height="{H}" fill="var(--sunk)"/>')
    p.append(f'<rect x="{x(d["a0"]):.1f}" y="4" width="{x(d["a1"])-x(d["a0"]):.1f}" height="12" '
             f'rx="3" fill="var(--ring)" opacity=".33"/>')
    p.append(f'<rect x="{x(d["b0"]):.1f}" y="4" width="{x(d["b1"])-x(d["b0"]):.1f}" height="12" '
             f'rx="3" fill="var(--warm)" opacity=".33"/>')
    for c in d["crossings"]:
        p.append(f'<rect x="{x(c):.1f}" y="19" width="1.6" height="9" fill="var(--ring)" opacity=".85"/>')
    for b in d["bounces"]:
        col = "var(--found)" if b["on"] else "var(--gone)"
        p.append(f'<rect x="{x(b["t"]):.1f}" y="29" width="1.6" height="9" fill="{col}" opacity=".9"/>')
    for t in d["taps"]:
        p.append(f'<path d="M{x(t):.1f} {H-1} l-4 -7 h8 z" fill="var(--ink)"/>')
    p.append(f'<rect x="{x(d["a1"]):.1f}" y="0" width="2.2" height="{H}" fill="#f05050"/>')
    p.append(f'<rect class="play-head-r" x="0" y="0" width="1.4" height="{H}" fill="var(--ink)" opacity=".55"/>')
    p.append('</svg>')
    return "".join(p)


def table_svg(d):
    """Where every bounce landed, seen from above."""
    PAD, SC = 12, 62
    W, H = W_M * SC + PAD * 2, L_M * SC + PAD * 2
    p = [f'<svg class="tbl" viewBox="0 0 {W:.0f} {H:.0f}" role="img" aria-label="bounces on the table">']
    p.append(f'<rect x="{PAD}" y="{PAD}" width="{W_M*SC:.0f}" height="{L_M*SC:.0f}" rx="3" '
             f'fill="var(--sunk)" stroke="var(--line)"/>')
    p.append(f'<line x1="{PAD}" y1="{PAD + NET_V*SC:.0f}" x2="{PAD + W_M*SC:.0f}" y2="{PAD + NET_V*SC:.0f}" '
             f'stroke="var(--muted)" stroke-dasharray="4 3"/>')
    for b in d["bounces"]:
        if b["u"] is None:
            continue
        cx, cy = PAD + b["u"] * SC, PAD + b["v"] * SC
        if not (-30 < cx < W + 30 and -30 < cy < H + 30):
            continue
        col = "var(--found)" if b["on"] else "var(--gone)"
        op = ".9" if b["half"] == 0 else ".55"
        p.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="3.4" fill="{col}" opacity="{op}"/>')
    p.append(f'<text x="{PAD}" y="{H-2:.0f}" font-size="9" fill="var(--muted)">near</text>')
    p.append(f'<text x="{PAD}" y="{PAD-3}" font-size="9" fill="var(--muted)">far</text>')
    p.append('</svg>')
    return "".join(p)


items = []
for s in sorted(shown, key=lambda s: (ORDER.index(s["klass"]), s["owner"], s["created"], s["a_idx"])):
    cid = f"{s['mid'][:8]}-{s['a_idx']}"
    d = OV[cid]
    slug, title, colour = KEY[s["klass"]]
    lab = f"{s['owner'].split()[0]} v {s['opp']} · {s['created']}"
    taps = (f"{s['taps_a']} winner tap{'s' if s['taps_a'] != 1 else ''} in the first card, "
            f"{s['taps_b']} in the second")
    items.append(f'''
<article class="card" data-id="{cid}" data-klass="{slug}" data-overlay="on"
         data-match="{html.escape(lab)}" data-t="{s['a_idx']}">
  <header>
    <span class="tag" style="--c:{colour}">{html.escape(title)}</span>
    <span class="who">{html.escape(lab)}</span>
    <span class="at">points {s['a_idx']} and {s['b_idx']}</span>
  </header>
  <p class="facts">
    One card of <b>{s['span']:.1f}s</b>, cut at <b>{ms(s['a1'])}</b> into
    {ms(s['a0'])}&ndash;{ms(s['a1'])} and {ms(s['b0'])}&ndash;{ms(s['b1'])}.
    This is the whole of it, from the original upload. {html.escape(taps)}.
  </p>
  <div class="stage">
    <video src="data:video/mp4;base64,{b64(s['full'])}" loop muted playsinline controls preload="none"></video>
    <canvas class="ov"></canvas>
  </div>
  <div class="stripwrap">{strip_svg(d)}<span class="play-head"></span></div>
  <div class="under">
    <div class="left">
      <p class="read">press play</p>
      <p class="legend"><i class="k blue"></i>first card <i class="k purp"></i>second card
        <i class="k red"></i>the cut <i class="k grn"></i>bounce on the table
        <i class="k org"></i>bounce off it <i class="k line"></i>net crossing
        <i class="k tri"></i>your winner tap</p>
      <button class="btn toggle" aria-pressed="true">Hide the tracking</button>
    </div>
    {table_svg(d)}
  </div>
  <div class="verdict">
    <button data-v="cut" aria-pressed="false">One rally, cut</button>
    <button data-v="two" aria-pressed="false">Two points</button>
    <button data-v="unsure" aria-pressed="false">Can't tell</button>
  </div>
</article>''')

chips = "".join(
    f'<button class="chip" data-filter="{KEY[k][0]}" aria-pressed="{"true" if k == BAD else "false"}" '
    f'style="--c:{KEY[k][2]}">{html.escape(KEY[k][1])} <b>{counts[k]}</b></button>'
    for k in ORDER if counts[k])
chips += f'<button class="chip" data-filter="all" aria-pressed="false">Everything <b>{len(shown)}</b></button>'

have = [s for s in splits if s.get("ev_gap") is not None and s["klass"] in (GOOD, BAD)]
sweep = ""
for g in (2.0, 3.0, 4.0, 5.0):
    pv = sum(1 for s in have if s["klass"] == BAD and s["ev_gap"] < g)
    lo = sum(1 for s in have if s["klass"] == GOOD and s["ev_gap"] < g)
    sweep += (f"<tr><td>{g:.1f}s</td><td class='num'>{pv} of {sum(1 for s in have if s['klass']==BAD)}</td>"
              f"<td class='num'>{lo} of {sum(1 for s in have if s['klass']==GOOD)}</td></tr>")
def band(k):
    v = sorted(s["ev_gap"] for s in have if s["klass"] == k)
    return f"{v[len(v)//4]:.1f}s", f"{v[len(v)//2]:.1f}s", f"{v[3*len(v)//4]:.1f}s"
gq, gm, gp = band(GOOD); bq, bm, bp = band(BAD)
allc = Counter(s["klass"] for s in splits)

css = open("/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/"
           "dd63c93b-843c-4cc1-9306-421c75c875dd/scratchpad/crop-serve-diff.html").read()
css = css.split("<style>")[1].split("</style>")[0]

doc = f'''<title>The twenty-second cap</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>{css}
.note a {{ color: var(--ring); }}
.verdict {{ grid-template-columns: 1fr 1fr 1fr; }}
.tag {{ background: color-mix(in srgb, var(--c) 16%, transparent); color: var(--c); }}
.facts {{ margin: 0 0 12px; font-size: 13.5px; color: var(--muted); line-height: 1.55; }}
.facts b {{ color: var(--ink); font-variant-numeric: tabular-nums; }}
.stage {{ position: relative; line-height: 0; }}
.stage video {{ width: 100%; display: block; border-radius: 8px; }}
canvas.ov {{ position: absolute; inset: 0; pointer-events: none; border-radius: 8px; }}
.stripwrap {{ position: relative; margin: 8px 0 10px; }}
svg.strip {{ width: 100%; height: 46px; display: block; border-radius: 5px; cursor: pointer; }}
.play-head {{ position: absolute; top: 0; bottom: 0; width: 2px; background: var(--ink);
              opacity: .75; pointer-events: none; }}
.under {{ display: flex; gap: 16px; align-items: flex-start; margin: 0 0 12px; }}
.under .left {{ flex: 1; min-width: 0; }}
svg.tbl {{ width: 88px; flex: none; }}
.read {{ margin: 0 0 8px; font-size: 12.5px; color: var(--ink); font-variant-numeric: tabular-nums; }}
.legend {{ margin: 0 0 10px; font-size: 11.5px; color: var(--muted); line-height: 1.9; }}
.legend .k {{ display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin: 0 4px 0 10px;
              vertical-align: -1px; }}
.legend .k:first-child {{ margin-left: 0; }}
.k.blue {{ background: var(--ring); opacity: .5; }} .k.purp {{ background: var(--warm); opacity: .5; }}
.k.red {{ background: #f05050; }} .k.grn {{ background: var(--found); }} .k.org {{ background: var(--gone); }}
.k.line {{ background: var(--ring); }} .k.tri {{ background: var(--ink); }}
.toggle {{ font-size: 12px; padding: 4px 11px; }}
.bar {{ position: sticky; top: 0; z-index: 5; background: var(--ground); padding: 12px 0; margin: 0 0 22px;
        border-bottom: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }}
.chip {{ font: inherit; font-size: 13px; color: var(--ink); background: var(--surface);
         border: 1px solid var(--line); border-left: 3px solid var(--c, var(--line)); border-radius: 999px;
         padding: 6px 13px; cursor: pointer; display: inline-flex; gap: 7px; align-items: center; }}
.chip b {{ font-variant-numeric: tabular-nums; color: var(--muted); font-weight: 600; }}
.chip:hover {{ border-color: var(--ring); }}
.chip[aria-pressed="true"] {{ background: var(--ink); color: var(--ground); }}
.chip[aria-pressed="true"] b {{ color: var(--ground); opacity: .7; }}
.barspace {{ margin-left: auto; display: flex; gap: 14px; align-items: center; font-size: 13px; color: var(--muted); }}
.two {{ display: grid; gap: 18px; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); margin: 0 0 30px; }}
.panel {{ background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; }}
.panel h3 {{ font-size: 14px; margin: 0 0 10px; }}
.panel table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
.panel td, .panel th {{ padding: 5px 6px; border-bottom: 1px solid var(--line); text-align: left; }}
.panel th {{ font-size: 11px; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); font-weight: 600; }}
.panel td.num {{ text-align: right; font-variant-numeric: tabular-nums; }}
.panel p {{ margin: 10px 0 0; font-size: 13px; color: var(--muted); line-height: 1.5; }}
</style>
<div class="wrap">
<p class="eyebrow">Card assembly &middot; the rule that splits long cards</p>
<h1>The twenty-second cap</h1>
<p class="lede">
No card may run past twenty seconds. One that does is cut at its quietest
moment and handed over as two. Here is every card that rule split across your
scored matches, shown <strong>whole</strong> &mdash; the full fused span, taken
from the original upload rather than the processed video, so you can watch the
first rally begin and end and see for yourself whether the second one is a new
point. The red flash and the red line on the ruler are where the cut was made.
</p>
<p class="lede">
The ball's tracked position is drawn over the picture with its last
three-quarters of a second as a trail, the table and net as the pipeline
measured them, and each bounce as a ring &mdash; green on the table, orange
off it. Underneath, the ruler shows both cards, every bounce and net crossing,
and your own winner taps; click it to jump. The small table beside it plots
where each bounce landed in metres.
</p>
<p class="lede">
I sorted these by where your winner taps fell, which is an inference about your
intent, not a fact. Disagree freely; the buttons are yours and
<strong>Copy my marks</strong> hands them back to me.
</p>

<div class="two">
  <div class="panel">
    <h3>What your scoring says about all {len(splits)} splits</h3>
    <table><tr><th>reading</th><th>count</th></tr>
    {"".join(f"<tr><td>{html.escape(KEY[k][1])}</td><td class='num'>{allc[k]}</td></tr>" for k in ORDER)}
    </table>
    <p>{len(shown)} of them are shown here. The rest are on matches whose original upload
    or table calibration is no longer held, so the full span cannot be rebuilt.</p>
  </div>
  <div class="panel">
    <h3>Why my proposed fix failed</h3>
    <table><tr><th></th><th>quarter</th><th>median</th><th>three quarters</th></tr>
    <tr><td>split was right</td><td class="num">{gq}</td><td class="num">{gm}</td><td class="num">{gp}</td></tr>
    <tr><td>a rally was cut</td><td class="num">{bq}</td><td class="num">{bm}</td><td class="num">{bp}</td></tr>
    </table>
    <p>Time at the cut with no bounce and no net crossing. I wanted to split only where play had
    visibly stopped, but the two readings sit on top of each other and the correct splits are the
    quieter ones. As a rule:</p>
    <table><tr><th>only split past</th><th>bad splits stopped</th><th>good splits lost</th></tr>{sweep}</table>
    <p>Every setting gives up more than it saves. Watch a few with the tracking on and you will see
    why: the ball goes untracked for seconds while the rally is still being played.</p>
  </div>
</div>

<div class="bar">
  {chips}
  <span class="barspace"><span id="n-shown"></span><span id="pos">&ndash;</span>
    <button class="btn" id="copy">Copy my marks</button><span id="copied"></span></span>
</div>
<textarea id="fallback" hidden rows="8" aria-label="Results to copy"></textarea>

<div class="grid">{"".join(items)}</div>
</div>
<script>
window.OVERLAY = {json.dumps(OV, separators=(",", ":"))};
{open("page.js").read()}
{open("overlay.js").read()}
</script>
'''
open(OUT, "w").write(doc)
print("page", f"{os.path.getsize(OUT) / 1e6:.2f} MB")
print("shown:", dict(counts), "of", dict(allc))

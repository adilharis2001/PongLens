"""A page to check the 20-second cap test by eye.

Every split the rule made across the scored matches, with the clip that
spans the cut, what Adil's own scoring said about it, and room to disagree.
"""
import base64, html, json, os
from collections import Counter

OUT = ("/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/"
       "dd63c93b-843c-4cc1-9306-421c75c875dd/scratchpad/twenty-second-cap.html")
splits = json.load(open("splits.json"))
GOOD = "both halves scored: the split was right"
BAD = "only the SECOND half scored: the first holds a rally with no winner"
JUNK = "only the first half scored, second deleted: the second was junk"
AMB = "only the FIRST half scored, second kept but unscored"
NONE = "neither half scored"
KEY = {BAD: ("cut", "A rally cut in half", "var(--gone)"),
       GOOD: ("right", "Two points, correctly separated", "var(--found)"),
       JUNK: ("junk", "A point and a leftover", "var(--toss)"),
       AMB: ("amb", "First half scored, second left alone", "var(--warm)"),
       NONE: ("none", "Neither half scored", "var(--muted)")}
ORDER = [BAD, GOOD, AMB, JUNK, NONE]
counts = Counter(s["klass"] for s in splits)


def ms(t):
    m = int(t) // 60
    return f"{m}:{t - 60 * m:05.2f}"


def b64(p):
    return base64.b64encode(open(p, "rb").read()).decode()


def label(s):
    return f"{s['owner'].split()[0]} v {s['opp']} · {s['created']}"


css = open("/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/"
           "dd63c93b-843c-4cc1-9306-421c75c875dd/scratchpad/crop-serve-diff.html").read()
css = css.split("<style>")[1].split("</style>")[0]
script = open("page.js").read()

items = []
for s in sorted(splits, key=lambda s: (ORDER.index(s["klass"]), s["owner"], s["created"], s["a_idx"])):
    slug, title, colour = KEY[s["klass"]]
    clip = f"clips_s/{s['mid'][:8]}_{s['a_idx']}_{s['b_idx']}.mp4"
    video = (f'<video src="data:video/mp4;base64,{b64(clip)}" loop muted playsinline controls preload="none"></video>'
             if os.path.exists(clip) else '<p class="note in">No clip.</p>')
    gapline = ("no per-card evidence stored for this match" if s.get("ev_gap") is None else
               f"{s['ev_gap']:.1f}s with no bounce and no net crossing at the cut")
    taps = (f"{s['taps_a']} winner tap{'s' if s['taps_a'] != 1 else ''} in the first card, "
            f"{s['taps_b']} in the second")
    items.append(f'''
<article class="card" data-id="{s['mid'][:8]}-{s['a_idx']}" data-klass="{slug}"
         data-match="{html.escape(label(s))}" data-t="{s['a_idx']}">
  <header>
    <span class="tag" style="--c:{colour}">{html.escape(title)}</span>
    <span class="who">{html.escape(label(s))}</span>
    <span class="at">points {s['a_idx']} and {s['b_idx']}</span>
  </header>
  <p class="facts">
    One card of <b>{s['span']:.1f}s</b> was cut at {ms(s['a1'])}, into
    {ms(s['a0'])}–{ms(s['a1'])} and {ms(s['b0'])}–{ms(s['b1'])}.<br>
    {html.escape(taps)} · {html.escape(gapline)}
  </p>
  {video}
  <p class="note in">The picture flashes cyan at the cut. Was the rally still going?</p>
  <div class="verdict">
    <button data-v="cut" aria-pressed="false">One rally, cut</button>
    <button data-v="two" aria-pressed="false">Two points</button>
    <button data-v="unsure" aria-pressed="false">Can't tell</button>
  </div>
</article>''')

chips = "".join(
    f'<button class="chip" data-filter="{KEY[k][0]}" aria-pressed="{"true" if k == BAD else "false"}" '
    f'style="--c:{KEY[k][2]}">{html.escape(KEY[k][1])} <b>{counts[k]}</b></button>' for k in ORDER)
chips += f'<button class="chip" data-filter="all" aria-pressed="false">Everything <b>{len(splits)}</b></button>'

n_matches = len({s['mid'] for s in splits})
judged = [s for s in splits if s["klass"] in (GOOD, BAD)]
have = [s for s in splits if s.get("ev_gap") is not None and s["klass"] in (GOOD, BAD)]
sweep = ""
for g in (2.0, 3.0, 4.0, 5.0):
    prevented = sum(1 for s in have if s["klass"] == BAD and s["ev_gap"] < g)
    lost = sum(1 for s in have if s["klass"] == GOOD and s["ev_gap"] < g)
    sweep += (f"<tr><td>{g:.1f}s</td><td class='num'>{prevented} of "
              f"{sum(1 for s in have if s['klass']==BAD)}</td><td class='num'>{lost} of "
              f"{sum(1 for s in have if s['klass']==GOOD)}</td></tr>")


def band(k):
    v = sorted(s["ev_gap"] for s in have if s["klass"] == k)
    return f"{v[len(v)//4]:.1f}s" , f"{v[len(v)//2]:.1f}s", f"{v[3*len(v)//4]:.1f}s"


gq, gm, gp = band(GOOD)
bq, bm, bp = band(BAD)

doc = f'''<title>The twenty-second cap</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>{css}
.note a {{ color: var(--ring); }}
.verdict {{ grid-template-columns: 1fr 1fr 1fr; }}
.tag {{ background: color-mix(in srgb, var(--c) 16%, transparent); color: var(--c); }}
.facts {{ margin: 0 0 12px; font-size: 13.5px; color: var(--muted); line-height: 1.55; }}
.facts b {{ color: var(--ink); font-variant-numeric: tabular-nums; }}
.bar {{ position: sticky; top: 0; z-index: 5; background: var(--ground); padding: 12px 0; margin: 0 0 22px;
        border-bottom: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }}
.chip {{ font: inherit; font-size: 13px; color: var(--ink); background: var(--surface);
         border: 1px solid var(--line); border-left: 3px solid var(--c, var(--line));
         border-radius: 999px; padding: 6px 13px; cursor: pointer; display: inline-flex; gap: 7px; align-items: center; }}
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
No card is allowed to run past twenty seconds. One that does is cut at its
quietest moment and handed over as two. This is every time that rule fired
across your scored matches &mdash; {len(splits)} splits in {n_matches} matches
&mdash; with the clip that spans each cut, so you can check the reading yourself.
</p>
<p class="lede">
I sorted them by where your own winner taps fell, which is a guess about your
intent rather than a fact. If a split has a tap in each half I called it right;
if only the second half has one, the first holds the opening of a rally with no
winner, which is what a rally cut in half looks like. Disagree freely &mdash;
the buttons under each clip are yours and the counts update as you go.
</p>

<div class="two">
  <div class="panel">
    <h3>What your scoring says about the {len(splits)} splits</h3>
    <table><tr><th>reading</th><th>count</th></tr>
    {"".join(f"<tr><td>{html.escape(KEY[k][1])}</td><td class='num'>{counts[k]}</td></tr>" for k in ORDER)}
    </table>
    <p>Of the {len(judged) + counts[JUNK] + counts[AMB]} with any scoring evidence, the rule is right about
    70% of the time and cuts a live rally about 17% of the time.</p>
  </div>
  <div class="panel">
    <h3>Why my proposed fix failed</h3>
    <table><tr><th></th><th>quarter</th><th>median</th><th>three quarters</th></tr>
    <tr><td>split was right</td><td class="num">{gq}</td><td class="num">{gm}</td><td class="num">{gp}</td></tr>
    <tr><td>a rally was cut</td><td class="num">{bq}</td><td class="num">{bm}</td><td class="num">{bp}</td></tr>
    </table>
    <p>That is the quiet at the cut &mdash; time with no bounce and no net crossing. I wanted to split only
    where play had visibly stopped, but the two readings sit on top of each other, and the correct splits are
    the quieter ones. Swept as a rule:</p>
    <table><tr><th>only split past</th><th>bad splits stopped</th><th>good splits lost</th></tr>{sweep}</table>
    <p>Every setting gives up more than it saves. Inside these cards the ball goes untracked for seconds while
    the rally is still being played, so silence means the detector lost the ball, not that the point ended.</p>
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
{script}
</script>
'''
open(OUT, "w").write(doc)
print("page", f"{os.path.getsize(OUT) / 1e6:.2f} MB ->", OUT)
print("classes:", dict(counts))

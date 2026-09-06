"""The night's work as one page, with the audio the claims rest on.

Numbers alone are not checkable by the person who has to decide what to do
with them. Every claim here that could be checked by ear is given the audio
to check it with, and the listening test is blind — the classifier's answer
is hidden until the row is clicked — because a label next to a sound is a
suggestion, not a test.
"""
import html, json, os

W = "/Users/adil/ponglens-research-work"
SNIP = json.load(open(f"{W}/snippets.json"))
OUT = "/Users/adil/Desktop/ponglens-audio-night2.html"

TRIED = [
    ("Tell this table's ball from the room", "0.82 – 0.88 AUC in a booth",
     "works", "Trained with no hand labelling at all: knocks vision confirmed "
     "during a rally against knocks between two point cards. Falls to 0.71–0.80 "
     "in an open hall and to chance at Westchester."),
    ("Feed that into placement", "+7 serves, +2 by chance",
     "works", "62.2% to 63.5% of serves drawing a dot, 8 gained and 1 lost. "
     "Randomising the impact times still gives +2, so about +5 is really the audio."),
    ("Find the start and end of a rally", "61–72% within a second",
     "part", "Only usable once the train is filtered by the classifier — at LYTTC "
     "it goes from 6% to 61%. Production already anchors about 75% of serves, so "
     "this does not beat what ships."),
    ("Trim the pad inside a clip", "0.42 AUC — below chance",
     "dead", "The seconds either side of a point are full of ball-on-table sounds: "
     "the server bouncing the ball, the loose ball afterwards. A microphone cannot "
     "tell those from a rally bounce."),
    ("Tell a bat from the table", "0.56 AUC",
     "dead", "The published work gets 0.97 with a directional microphone at half a "
     "metre. From a phone across the room the distinction is gone."),
    ("Tell the near half from the far half", "0.55 – 0.60 AUC, sign flips",
     "dead", "The far end is 2.7 m further away so it should be quieter and duller. "
     "How hard the ball was hit is a bigger effect than how far away it was, and it "
     "points the other way in some matches."),
    ("Hear the ball go dead after a point", "+0.04 lift over chance",
     "dead", "A loose ball's bounces decay geometrically and it is plainly visible. "
     "But runs that look geometric happen constantly by coincidence, and the decay "
     "ratios of real ones match a time-shifted control exactly."),
    ("Recognise a serve by its shape", "0.64 – 0.78 AUC",
     "dead", "A serve is the one stroke with two bounces and no bat between. Against "
     "the second before it — the only comparison that would help — it is weak."),
    ("Find rallies with no card", "8 minutes over 14 matches",
     "dead", "The track lights up on 91–99% of cards it should. What it flags with no "
     "card at all is short and rare."),
]

VENUES = [
    ("PingPod booths", "91%", "51%", "0.82 – 0.88", 7),
    ("LYTTC hall", "80%", "44%", "0.71 – 0.80", 4),
    ("Westchester TTC (end-on)", "~50%", "~28%", "0.48 – 0.64", 8),
]


def audio(b64, cls=""):
    return (f'<audio class="{cls}" controls preload="none" '
            f'src="data:audio/mpeg;base64,{b64}"></audio>')


def main():
    knocks = SNIP["knocks"][:]
    order = sorted(range(len(knocks)), key=lambda i: (knocks[i]["t"] * 7919) % 1000)
    rows = []
    for n, i in enumerate(order):
        k = knocks[i]
        rows.append(
            f'<tr class="knock" data-truth="{k["truth"]}" data-score="{k["score"]:.2f}">'
            f'<td class="num">{n+1}</td>'
            f'<td>{audio(k["b64"])}</td>'
            f'<td class="verdict"><button class="reveal">show</button>'
            f'<span class="hidden ans">{"this table&rsquo;s ball" if k["truth"]=="ball" else "the room"}'
            f' &middot; scored {k["score"]:.2f}</span></td>'
            f'<td class="muted">{html.escape(str(k["venue"]))} &middot; '
            f'{html.escape(str(k["opp"]))}</td></tr>')
    knock_rows = "\n".join(rows)

    pairs = "\n".join(
        f'<div class="pair"><div class="pairhead">{html.escape(str(p["venue"]))} '
        f'&middot; {html.escape(str(p["opp"]))}</div>'
        f'<div class="two"><div><span class="lbl rally">rally</span>{audio(p["rally"])}</div>'
        f'<div><span class="lbl pad">the pad, seconds earlier</span>{audio(p["pad"])}</div>'
        f'</div></div>' for p in SNIP["pairs"])

    loose = "\n".join(
        f'<div class="pair"><div class="pairhead">{html.escape(str(l["venue"]))} '
        f'&middot; {html.escape(str(l["opp"]))} &middot; from half a second before '
        f'the winner tap</div>{audio(l["b64"])}</div>' for l in SNIP["loose"])

    tried = "\n".join(
        f'<tr class="s-{s}"><td>{html.escape(t)}</td><td class="res">{html.escape(r)}</td>'
        f'<td class="muted">{html.escape(d)}</td></tr>' for t, r, s, d in TRIED)

    venues = "\n".join(
        f'<tr><td>{html.escape(v)}</td><td>{a}</td><td>{b}</td><td>{c}</td>'
        f'<td class="muted">{n} matches</td></tr>' for v, a, b, c, n in VENUES)

    page = f"""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Audio, tried again on the quiet venues</title>
<style>
:root {{ --bg:#0b0a09; --panel:#141210; --line:#2a2724; --ink:#e8e4e0;
        --dim:#9a938c; --cyan:#5ad8e6; --amber:#f5bd38; --red:#f07171;
        --green:#7ade4a; }}
* {{ box-sizing:border-box; }}
body {{ margin:0; background:var(--bg); color:var(--ink);
  font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }}
.wrap {{ max-width:940px; margin:0 auto; padding:48px 22px 120px; }}
h1 {{ font-size:30px; margin:0 0 6px; letter-spacing:-0.01em; }}
h2 {{ font-size:20px; margin:52px 0 4px; letter-spacing:-0.01em; }}
p {{ color:var(--dim); max-width:70ch; }}
p.lead {{ color:var(--ink); font-size:17px; }}
table {{ width:100%; border-collapse:collapse; margin:18px 0; font-size:14px; }}
th {{ text-align:left; color:var(--dim); font-weight:600; padding:8px 10px;
  border-bottom:1px solid var(--line); font-size:12px; text-transform:uppercase;
  letter-spacing:0.06em; }}
td {{ padding:10px; border-bottom:1px solid var(--line); vertical-align:middle; }}
.muted {{ color:var(--dim); }}
.num {{ color:var(--dim); width:36px; }}
.res {{ white-space:nowrap; font-variant-numeric:tabular-nums; }}
.s-works .res {{ color:var(--green); }}
.s-part .res {{ color:var(--amber); }}
.s-dead .res {{ color:var(--red); }}
audio {{ height:32px; width:100%; max-width:280px; vertical-align:middle; }}
.panel {{ background:var(--panel); border:1px solid var(--line);
  border-radius:12px; padding:20px 22px; margin:18px 0; }}
.reveal {{ background:none; border:1px solid var(--line); color:var(--dim);
  border-radius:999px; padding:4px 14px; font-size:13px; cursor:pointer; }}
.reveal:hover {{ color:var(--ink); border-color:var(--dim); }}
.hidden {{ display:none; }}
.ans {{ font-size:13px; }}
.pair {{ background:var(--panel); border:1px solid var(--line); border-radius:12px;
  padding:14px 16px; margin:10px 0; }}
.pairhead {{ font-size:12px; color:var(--dim); margin-bottom:8px;
  text-transform:uppercase; letter-spacing:0.06em; }}
.two {{ display:grid; grid-template-columns:1fr 1fr; gap:16px; }}
@media (max-width:640px) {{ .two {{ grid-template-columns:1fr; }} }}
.lbl {{ display:block; font-size:13px; margin-bottom:4px; }}
.lbl.rally {{ color:var(--cyan); }}
.lbl.pad {{ color:var(--amber); }}
@media (max-width:700px) {{
  /* wide content scrolls inside itself; the page never scrolls sideways */
  table {{ display:block; overflow-x:auto; white-space:nowrap; }}
  table td.muted {{ white-space:normal; min-width:22ch; }}
  audio {{ min-width:200px; }}
}}
code {{ background:var(--panel); padding:1px 6px; border-radius:5px;
  font-size:13px; color:var(--cyan); }}
.tally {{ display:flex; gap:26px; margin-top:14px; font-size:13px; color:var(--dim); }}
.tally b {{ color:var(--ink); font-size:22px; display:block;
  font-variant-numeric:tabular-nums; }}
pre {{ background:var(--panel); border:1px solid var(--line); border-radius:10px;
  padding:14px 16px; overflow-x:auto; font-size:13px; color:var(--ink); }}
</style></head><body><div class="wrap">

<h1>Audio, tried again on the quiet venues</h1>
<p class="muted">29 August 2026 &middot; 19 matches &middot; PingPod, LYTTC and
Westchester TTC</p>

<p class="lead">You were right that the venue matters, and it is measurable:
in a PingPod booth the audio agrees with what the camera saw far more often
than it does in an open hall. One new thing came out of the night — a way to
tell this table's ball from the rest of the room, learned without labelling
anything by hand — and it moves serve placement by about a percentage point.
Five other ideas were tried properly and are dead, each with a number behind
it.</p>

<h2>Everything that was tried</h2>
<table><thead><tr><th>Idea</th><th>Result</th><th>What it means</th></tr></thead>
<tbody>{tried}</tbody></table>

<h2>Listen for yourself</h2>
<p>This is the one thing that works. Thirty-six single knocks, in random
order, half of them a ball striking this table during a rally and half of them
something else in the room. The classifier's answer is hidden until you press
<em>show</em>, so you can make your own call first.</p>
<table><thead><tr><th>#</th><th>Sound</th><th>What it was</th><th>Match</th></tr>
</thead><tbody>{knock_rows}</tbody></table>

<h2>Why trimming the clip does not work</h2>
<p>Each pair is two seconds of rally and two seconds from the pad a moment
earlier, out of the same point. The pad is not quiet — it is the server
bouncing the ball on the table, which to a microphone is the same event as a
rally bounce. That is why every audio signal in this study, combined, lands
at 0.42 on telling them apart, and below 0.5 means the pad sounds
<em>more</em> like a ball than the rally does.</p>
{pairs}

<h2>The ball going dead</h2>
<p>After a point the ball bounces loose, losing the same fraction of its
energy each time, so the gaps between bounces shrink by a constant ratio —
around 0.86, which is where a ping-pong ball's bounce should put it. You can
hear it clearly. It still does not work as a detector: runs that look like
this happen constantly by coincidence among three knocks a second, and the
decay ratios of the real ones match a time-shifted control exactly.</p>
<pre>0.36  0.31  0.27  0.23  0.21  0.18  0.15   seconds between bounces
   0.86  0.87  0.85  0.91  0.86  0.83      each gap over the one before</pre>
{loose}

<h2>The venues, side by side</h2>
<p>At three audio knocks per second of rally, against the shipped pipeline's
own visual events.</p>
<table><thead><tr><th>Venue</th><th>Audio hears what the camera saw</th>
<th>Audio knocks the camera accounts for</th><th>Ball-vs-room AUC</th><th></th>
</tr></thead><tbody>{venues}</tbody></table>
<p>Westchester is both end-on and a busy hall, so those two things cannot be
separated there and nothing here claims to. What is clear is that audio has
nothing to offer that match: the classifier is at chance in that room.</p>

<h2>The placement result</h2>
<p>The same 527 scored points the earlier study used, and the same production
function. The only change is that placement is handed the knocks that sound
like this table's ball, instead of every knock the detector found.</p>
<div class="panel"><div class="tally">
<div><b>328</b>drawing today</div>
<div><b>335</b>with the filter</div>
<div><b>8</b>gained</div>
<div><b>1</b>lost</div>
<div><b>330</b>with the times randomised</div>
</div></div>
<p>Sliding the same knocks 7.31 seconds along the clock still gains 2, because
part of the change is structural rather than acoustic. So about five of the
seven are really the audio. That is roughly one percentage point of serve
placement coverage — genuine, verified against a control, and small.</p>

<h2>What I would not try again</h2>
<p>Porting the classifier from the published work. It reaches 0.97 separating
racket from table from floor, but with a directional microphone half a metre
to two metres away; from a phone across the room the same distinction measures
0.56 here, over thirteen matches, using labels the pipeline already owns.
Anything resting on which half of the table a sound came from — how hard the
ball was hit swamps how far away it was. And the loose-ball idea above, which
is the most attractive dead end of the set.</p>

<script>
document.querySelectorAll(".reveal").forEach(function (b) {{
  b.addEventListener("click", function () {{
    b.classList.add("hidden");
    b.nextElementSibling.classList.remove("hidden");
  }});
}});
</script>
</div></body></html>"""
    open(OUT, "w").write(page)
    print(f"{OUT}  {os.path.getsize(OUT)/1e6:.1f} MB")


if __name__ == "__main__":
    main()

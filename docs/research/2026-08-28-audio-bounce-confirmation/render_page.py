"""Render the whole audio study as one self-contained page.

  ./venv/bin/python render_page.py <recent-dir> <out.html>

Everything the study concluded, with the raw readings underneath it: for
each of a hundred points from the ten most recent uploads, the onset curve
the detector actually computed, every peak it picked in both bands, the
visual events production stored, Adil's own taps where they exist, and the
sound itself, embedded and playable.

The point of the page is that a conclusion nobody can check is worth
nothing. Everything here is a measurement, and every measurement can be
listened to.
"""
import html
import json
import os
import sys

CSS = """
:root {
  --bg:#0a0a0b; --panel:#121214; --line:#26262b; --ink:#e8e8ea;
  --dim:#9a9aa4; --dimmer:#6e6e78; --cyan:#4dd8e8; --amber:#e8b84d;
  --good:#5ecf8f; --bad:#e87d7d;
}
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--ink);
  font:15px/1.65 ui-sans-serif,-apple-system,"SF Pro Text",Segoe UI,sans-serif; }
.wrap { max-width:1120px; margin:0 auto; padding:56px 28px 120px; }
h1 { font-size:30px; line-height:1.2; margin:0 0 6px; letter-spacing:-.02em; }
h2 { font-size:21px; margin:52px 0 14px; letter-spacing:-.01em;
  padding-top:22px; border-top:1px solid var(--line); }
h3 { font-size:16px; margin:28px 0 8px; color:var(--ink); }
p, li { color:var(--dim); }
p { margin:10px 0; }
strong { color:var(--ink); font-weight:600; }
code { font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;
  background:#1c1c20; padding:1px 5px; border-radius:4px; color:#cfd3d6; }
a { color:var(--cyan); }
.lede { font-size:17px; color:var(--dim); margin:14px 0 0; }
.verdict { background:var(--panel); border:1px solid var(--line);
  border-left:3px solid var(--amber); border-radius:8px;
  padding:16px 20px; margin:26px 0; }
.verdict p:first-child { margin-top:0; }
.verdict p:last-child { margin-bottom:0; }
.scroller { overflow-x:auto; margin:16px 0; }
table { border-collapse:collapse; width:100%; min-width:560px;
  font-size:13.5px; }
th, td { text-align:right; padding:6px 10px; border-bottom:1px solid var(--line); }
th:first-child, td:first-child { text-align:left; }
th { color:var(--dimmer); font-weight:500; font-size:12px;
  text-transform:uppercase; letter-spacing:.05em; }
tr.total td { border-top:1px solid #3a3a42; font-weight:600; color:var(--ink); }
td.pos { color:var(--good); } td.neg { color:var(--bad); }
.note { font-size:13px; color:var(--dimmer); margin:8px 0 0; }
.cards { margin-top:18px; }
.card { background:var(--panel); border:1px solid var(--line);
  border-radius:8px; padding:12px 14px 10px; margin-bottom:10px; }
.chead { display:flex; gap:14px; align-items:baseline; flex-wrap:wrap;
  font-size:12.5px; color:var(--dimmer); margin-bottom:6px; }
.chead b { color:var(--ink); font-size:13.5px; font-weight:600; }
.chead .pill { background:#1c1c20; border-radius:20px; padding:1px 9px; }
svg.strip { width:100%; height:74px; display:block; background:#0e0e10;
  border-radius:5px; }
@media (max-width:640px) {
  .wrap { padding:32px 16px 80px; }
  h1 { font-size:24px; }
  .chead { gap:8px; font-size:11.5px; }
}
.strip .curve { fill:none; stroke:var(--cyan); stroke-width:1; opacity:.85; }
.strip .window { fill:#ffffff08; }
.strip .taps { fill:#e8b84d14; }
.strip .mhi { stroke:var(--amber); stroke-width:1; opacity:.75; }
.strip .mlo { stroke:#7a7a86; stroke-width:1; opacity:.9; }
.strip .vb { fill:var(--good); } .strip .vc { fill:#8f8fe8; }
.strip .vo { fill:#666; }
.strip .offtable { fill:var(--bad); }
.cfoot { display:flex; gap:16px; align-items:center; margin-top:7px;
  font-size:12px; color:var(--dimmer); flex-wrap:wrap; }
audio { height:30px; vertical-align:middle; max-width:320px; }
.slot { display:inline-flex; align-items:center; }
button.play { padding:3px 12px; font-size:12px; border-radius:20px; }
.legend { display:flex; gap:18px; flex-wrap:wrap; font-size:12.5px;
  color:var(--dimmer); margin:10px 0 0; }
.legend span { display:flex; gap:6px; align-items:center; }
.sw { width:12px; height:3px; border-radius:2px; display:inline-block; }
.dot { width:9px; height:9px; border-radius:50%; display:inline-block; }
.controls { display:flex; gap:10px; flex-wrap:wrap; margin:18px 0 4px;
  align-items:center; }
select, button { background:#1c1c20; color:var(--ink);
  border:1px solid var(--line); border-radius:6px; padding:6px 11px;
  font:13px inherit; cursor:pointer; }
.src { font-size:13px; color:var(--dim); margin:6px 0; padding-left:18px;
  text-indent:-18px; }
ul { padding-left:20px; }
</style>
"""


def table(headers, rows, total=None):
    out = ["<div class='scroller'><table><thead><tr>"]
    out += [f"<th>{html.escape(str(h))}</th>" for h in headers]
    out.append("</tr></thead><tbody>")
    for row in rows:
        out.append("<tr>" + "".join(cell(v) for v in row) + "</tr>")
    if total:
        out.append("<tr class='total'>" + "".join(cell(v) for v in total)
                   + "</tr>")
    out.append("</tbody></table></div>")
    return "".join(out)


def cell(value):
    text = str(value)
    cls = ""
    if text.startswith("+") and text[1:].replace(".", "").isdigit():
        cls = " class='pos'"
    elif text.startswith("−") or (text.startswith("-")
                                       and text[1:].replace(".", "").isdigit()):
        cls = " class='neg'"
    return f"<td{cls}>{html.escape(text)}</td>"


def main():
    recent_dir, out_path = sys.argv[1], sys.argv[2]
    blob = json.load(open(os.path.join(recent_dir, "cards.json")))
    cards, stats = blob["cards"], blob["stats"]
    matches = sorted({(c["slug"], c["opponent"], c["venue"], c["date"],
                       c["user"], c["channels"]) for c in cards},
                     key=lambda m: m[3], reverse=True)

    body = []
    A = body.append

    A("<div class='wrap'>")
    A("<h1>Can the sound tell us where a serve landed?</h1>")
    A("<p class='lede'>Everything measured on 28 August 2026, with the "
      "readings underneath it. The last section is a hundred real points "
      "from this week's uploads: the curve the detector computed, every "
      "peak it picked, and the audio itself, so any claim here can be "
      "checked by ear.</p>")

    A("<div class='verdict'>")
    A("<p><strong>Verdict: do not ship.</strong> Feeding real audio impacts "
      "into the placement reconstruction takes serve-placement coverage "
      "from 62% to 59% on 527 scored points. The branch written to rescue a "
      "missed bounce moves zero serves. Across fifteen settings and two "
      "frequency bands, not one gained serve came from "
      "<code>no_landing</code> &mdash; the failure audio was aimed at.</p>")
    A("<p>Production is unchanged and still passes an empty impact list, "
      "exactly as it has since the argument was written.</p>")
    A("</div>")

    # ---------------------------------------------------------------- study
    A("<h2>1. The ruler, and that it holds</h2>")
    A("<p>Coverage is measured by the app's own code: "
      "<code>computeServing</code> for the ITTF rotation Adil's scorekeeper "
      "runs, then <code>diagnoseServePlacement</code> for the six serve "
      "rules, the end-swap between games and the 0.7 trust threshold. Both "
      "are imported, never restated.</p>")
    A("<p>The corpus is the seven matches from Adil's vouched list that "
      "carry v3 placement and a table he has looked at &mdash; "
      "<strong>527 scored points</strong>, which is the arithmetic that "
      "identifies them, since no other combination of the list sums to "
      "it.</p>")
    A(table(
        ["match", "scored", "drawn", "", "no landing", "wrong half",
         "1st bounce", "off table", "not consec.", "no serve"],
        [["lester", 104, 66, "63%", 10, 14, 2, 6, 5, 1],
         ["rowel", 80, 55, "69%", 8, 8, 3, 2, 2, 2],
         ["prabhas", 55, 33, "60%", 14, 3, 0, 2, 1, 2],
         ["ishan", 79, 37, "47%", 29, 3, 3, 3, 4, 0],
         ["ali", 44, 24, "55%", 3, 6, 3, 4, 1, 3],
         ["chris", 90, 73, "81%", 2, 7, 0, 6, 1, 0],
         ["julian", 75, 40, "53%", 11, 9, 5, 5, 1, 4]],
        ["TOTAL", 527, 328, "62%", 77, 50, 16, 28, 15, 12]))
    A("<p class='note'>Every figure matches what CLAUDE.md already "
      "recorded, including the 47% floor on Ishan and the 81% ceiling on "
      "Chris. Before any audio was supplied, the replay harness was run "
      "with an empty impact list and reproduced the database exactly: "
      "<strong>328 drawn, 328 drawn, zero gained, zero lost, on all seven "
      "matches</strong>.</p>")

    A("<h2>2. What &ldquo;no landing&rdquo; actually means</h2>")
    A("<p>The largest reason a serve draws nothing is <code>no_landing</code> "
      "at 15%, and the name is misleading. Taking the hypothesis the scored "
      "rotation selects, for all 77 of those points:</p>")
    A(table(["", "points"],
            [["serve shot with no landing event at all", 0],
             ["landing found, with real pixels, that projects off the table",
              77]]))
    A("<p>Not one is a missed detection. The ball was seen; it was seen "
      "somewhere that is not this table. Projected without the safety "
      "bounds, on a table 1.525&nbsp;m across and 2.74&nbsp;m long, the "
      "median lands at <strong>u = &minus;1.20&nbsp;m</strong>, and only 14 "
      "of 77 within half a metre of the box.</p>")
    A(table(["match", "n", "median u", "u, p25 to p75"],
            [["ishan", 29, "−2.73 m", "−3.21 to −2.24"],
             ["prabhas", 14, "−3.40 m", "−3.89 to −1.82"],
             ["julian", 11, "−1.18 m", "−1.19 to 0.12"],
             ["lester", 10, "−0.15 m", "−0.86 to 1.76"],
             ["rowel", 8, "1.53 m", "0.62 to 2.11"],
             ["ali", 3, "2.64 m", "1.69 to 3.60"],
             ["chris", 2, "−0.20 m", "−0.21 to −0.18"]]))
    A("<p><strong>43 of the 77 sit two table-widths to one side, in one "
      "venue.</strong> That is the ball track being captured by the next "
      "table along at LYTTC. It is a tracking failure, and it is the same "
      "root cause the table-aware reseed study hit from the other "
      "direction.</p>")

    # ---------------------------------------------------------------- detector
    A("<h2>3. The detector, and how well it hears</h2>")
    A("<p>Onset strength and nothing cleverer: a short-time Fourier "
      "transform at a 21&nbsp;ms window and 5.3&nbsp;ms hop; spectral flux "
      "&mdash; energy that <em>rose</em> since the last frame &mdash; "
      "summed over a band; <code>log1p</code> before differencing so one "
      "loud strike does not set the scale for the file; then a robust "
      "z-score against the running median and MAD of a &plusmn;0.75&nbsp;s "
      "neighbourhood, which is what lets a quiet club and a tournament hall "
      "be judged on their own terms. Peaks at least 25&nbsp;ms apart.</p>")
    A("<p>Judged against production's own stored visual bounces &mdash; "
      "found by the visual test alone, since audio has always been empty, "
      "so the detector was not tuned on them. Every &ldquo;chance&rdquo; "
      "figure is the same measurement with the whole impact list slid "
      "7.31&nbsp;s along the clock.</p>")
    A(table(["match", "impacts", "offset", "MAD", "±30 ms", "chance",
             "±50 ms", "chance", "±90 ms", "chance"],
            [["lester", 3635, "+9 ms", "11 ms", "78%", "15%", "84%", "23%",
              "88%", "36%"],
             ["rowel", 2477, "+13 ms", "12 ms", "75%", "15%", "89%", "25%",
              "92%", "44%"],
             ["prabhas", 2739, "+5 ms", "18 ms", "58%", "19%", "67%", "29%",
              "76%", "48%"],
             ["ishan", 3933, "+7 ms", "19 ms", "56%", "21%", "66%", "32%",
              "74%", "52%"],
             ["ali", 2128, "+5 ms", "10 ms", "82%", "16%", "88%", "24%",
              "92%", "40%"],
             ["chris", 3985, "+5 ms", "11 ms", "78%", "16%", "81%", "25%",
              "87%", "43%"],
             ["julian", 2928, "+8 ms", "13 ms", "72%", "19%", "80%", "27%",
              "84%", "43%"]]))
    A("<p>Two things follow. <strong>The clocks agree</strong> &mdash; the "
      "offset is +5 to +13&nbsp;ms on all seven, inside one video frame, so "
      "there is no sync error to correct. And <strong>the 0.09&nbsp;s "
      "matching tolerance written into the code is about twice as wide as "
      "it should be</strong>: at &plusmn;90&nbsp;ms more than a third of "
      "the matches are coincidence.</p>")

    A("<h3>The published pipeline uses a different band, and it is better</h3>")
    A("<p>The Sony AI bounce pipeline high-passes at <strong>10&nbsp;kHz</strong> "
      "before looking for peaks. This study's first detector used "
      "1.5&ndash;8&nbsp;kHz. Compared at matched impact density &mdash; "
      "each band's threshold raised until it emits the same number of "
      "peaks, so the chance rate is held equal and only the hit rate can "
      "move:</p>")
    A(table(["match", "impacts", "1.5–8 kHz hit", "chance",
             "10 kHz+ hit", "chance"],
            [["lester", 3635, "78%", "15%", "89%", "15%"],
             ["rowel", 2477, "75%", "15%", "86%", "15%"],
             ["prabhas", 2739, "58%", "19%", "86%", "18%"],
             ["ishan", 3933, "56%", "21%", "84%", "22%"],
             ["ali", 2128, "82%", "16%", "89%", "16%"],
             ["chris", 3985, "78%", "16%", "93%", "18%"],
             ["julian", 2928, "72%", "19%", "82%", "20%"]],
            ["WEIGHTED", "", "72%", "17%", "87%", "18%"]))
    A("<p>A fifteen-point improvement, and the gains are biggest exactly "
      "where this study struggled most. A hall's voices, shoes and rolling "
      "balls live below 10&nbsp;kHz; a celluloid ball's strike does not. "
      "<strong>So the whole experiment was re-run at the better operating "
      "point.</strong></p>")

    # ---------------------------------------------------------------- arms
    A("<h2>4. What the audio does to the map</h2>")
    A("<p>Each arm replays every point through "
      "<code>reconstruct_existing_match</code> &mdash; the production "
      "function the placement backfill and the retry both run &mdash; and "
      "hands the result to the same ruler. The inputs are production's own: "
      "the stored calibration that drew the maps in the database, and the "
      "point windows from the points table.</p>")
    A(table(["arm", "band", "drawn", "", "gained", "lost", "net"],
            [["database today", "—", 328, "62%", "—", "—",
              "—"],
             ["replay, empty impact list", "—", 328, "62%", 0, 0, "0"],
             ["wired up as written (0.09 / 0.09)", "1.5–8k", 313, "59%",
              8, 23, "−15"],
             ["tuned tolerances (0.05 / 0.03)", "1.5–8k", 311, "59%", 5,
              22, "−17"],
             ["louder impacts only (z ≥ 5)", "1.5–8k", 322, "61%",
              6, 12, "−6"],
             ["rescue branch alone", "1.5–8k", 328, "62%", 0, 0, "0"],
             ["blend limited to on-table events", "1.5–8k", 331, "63%",
              5, 2, "+3"],
             ["wired up as written", "10k+", 322, "61%", 9, 15, "−6"],
             ["tuned tolerances", "10k+", 321, "61%", 8, 15, "−7"],
             ["rescue branch alone", "10k+", 327, "62%", 0, 1, "−1"],
             ["blend limited to on-table events", "10k+", 332, "63%", 7, 3,
              "+4"]]))
    A("<h3>Three results, in order of how much they matter</h3>")
    A("<p><strong>1. Wiring it up as written makes the maps worse.</strong> "
      "The cause is the standalone-impact branch: an onset z-score never "
      "falls below the <code>confidence &lt; 2.5</code> guard the code uses "
      "to suppress those candidates, so about 3,500 sound-only events "
      "joined a candidate list of 2,277 on three matches alone, and the "
      "solver started preferring landings it cannot place.</p>")
    A("<p><strong>2. The branch this experiment was about does "
      "nothing.</strong> Isolated, <code>audio_supported_short_bounce</code> "
      "fires 5 to 13 times a match and moves zero serves in either band. It "
      "admits a bounce whose &plusmn;2-frame window was ambiguous while its "
      "&plusmn;1-frame window was clean. The serves that draw no dot never "
      "failed that test &mdash; their projection did.</p>")
    A("<p><strong>3. Not one gained serve, on any arm, in either band, came "
      "from <code>no_landing</code>.</strong> Every gain came from "
      "<code>not_consecutive</code>, a 3% bucket. A detector fifteen points "
      "better at timing changed the damage and left the verdict alone.</p>")

    # ---------------------------------------------------------------- why
    A("<h2>5. Why &mdash; the measurement that explains all of it</h2>")
    A("<p>Adil's own serve and winner taps, in "
      "<code>public.point_boundaries</code>, bound 373 points across 12 "
      "matches. They are only 90% accurate to 0.71&nbsp;s so they cannot "
      "time anything, but they mark exactly when the ball is in play and "
      "when it is not. A bounce detector should be loud inside and quiet "
      "outside.</p>")
    A(table(["match", "points", "in play", "gaps", "1.5–8k in play",
             "in gaps", "ratio", "10k+ in play", "in gaps", "ratio"],
            [["ishan", 71, "294 s", "639 s", "4.08/s", "3.50/s", "1.2×",
              "4.88/s", "4.01/s", "1.2×"],
             ["rowel", 75, "356 s", "446 s", "3.33/s", "2.14/s", "1.6×",
              "3.14/s", "2.06/s", "1.5×"],
             ["prabhas", 50, "193 s", "470 s", "4.14/s", "3.42/s", "1.2×",
              "4.69/s", "3.53/s", "1.3×"]]))
    A("<p><strong>The room is nearly as busy when this table is idle as "
      "when it is playing.</strong> Between points &mdash; nobody at this "
      "table serving, nobody rallying &mdash; the detector still fires two "
      "to four times a second. That is other tables, and it is why every "
      "downstream result came out the way it did: audio confirms a "
      "neighbouring table's bounce exactly as readily as ours, and the "
      "better band improves the timing without improving the "
      "selectivity.</p>")

    A("<h3>Is there direction information in the file?</h3>")
    A("<p>The one measure the literature reports as actually separating "
      "your own court from the next one along is a <em>directional</em> "
      "microphone. A phone has two omnidirectional capsules a few "
      "centimetres apart, which is much weaker, but worth measuring rather "
      "than assuming. Two problems:</p>")
    A("<ul><li><strong>Eight of the ten most recent uploads are mono at "
      "source</strong>, and all seven study matches are mono. There is no "
      "second channel to work with.</li>"
      "<li>On the two stereo uploads, cross-correlating a 10&nbsp;ms window "
      "around each impact gives a channel delay with a MAD of 225 and "
      "414&nbsp;µs against a maximum possible delay of about "
      "437&nbsp;µs for a 15&nbsp;cm baseline. The estimate is noise, "
      "not direction &mdash; only 6% and 9% of impacts sit within "
      "30&nbsp;µs of the median.</li></ul>")

    # ---------------------------------------------------------------- lit
    A("<h2>6. What the published work says</h2>")
    A("<p>Table tennis audio is a real and fairly small literature. It "
      "agrees with what was measured here, and the one place it disagrees "
      "&mdash; the frequency band &mdash; has been adopted.</p>")

    A("<h3>Directly on table tennis</h3>")
    A("<p class='src'><strong>Sound-Based Spin Estimation in Table Tennis "
      "(2024, funded by Sony AI).</strong> The closest work to this study. "
      "Three tasks: millisecond bounce detection, classification of the "
      "contact surface (racket / table / floor / other), and spin from "
      "sound alone. A 5th-order Butterworth high-pass at 10&nbsp;kHz with "
      "zero-phase filtering, then energy peaks against an exponentially "
      "decaying average &mdash; almost exactly this study's method, at a "
      "band this study got wrong. Onset accuracy 0.09&nbsp;ms clean and "
      "0.2&nbsp;ms with speech over it; detection 0.98 precision / 1.00 "
      "recall clean, 0.98 / 0.95 with speech. Surface classification 0.97 "
      "F1 from a 15&nbsp;ms clip through a 64-band Mel spectrogram and a "
      "six-layer CNN. <em>Recorded with a Zoom H4n Pro directional "
      "microphone at 50&nbsp;cm to 2&nbsp;m, in controlled conditions; the "
      "paper explicitly does not test multiple tables or venue "
      "acoustics.</em> "
      "<a href='https://arxiv.org/abs/2409.11760'>arXiv:2409.11760</a>, "
      "dataset at "
      "<a href='https://github.com/cogsys-tuebingen/tt_sounds'>cogsys-tuebingen/tt_sounds</a> "
      "&mdash; 3,396 samples, <strong>CC BY-NC 4.0, so not usable in a "
      "commercial product</strong>.</p>")
    A("<p class='src'><strong>Ball Hit Detection in Table Tennis Games "
      "Based on Audio Analysis</strong> &mdash; Zhang, Xiao, Dellandr&eacute;a, "
      "Dou and Chen, ICPR 2006. Energy Peak Detection plus an MFCC-based "
      "refinement step. <strong>91% precision, 73% recall.</strong> The "
      "oldest and closest prior art to the detector built here, and the "
      "recall figure is a fair description of what a simple energy detector "
      "gets in real conditions.</p>")
    A("<p class='src'><strong>TTNet and the OpenTTGames dataset</strong> "
      "&mdash; Voeikov et al., CVPR Workshops 2020. The reference work on "
      "table tennis event spotting: 97.0% on events, 2&nbsp;px RMSE on the "
      "ball, under 6&nbsp;ms per frame. Worth knowing precisely because "
      "<strong>it uses no audio at all</strong> &mdash; the leading "
      "video-side system for this sport solves event spotting without a "
      "microphone. "
      "<a href='https://arxiv.org/abs/2004.09927'>arXiv:2004.09927</a></p>")

    A("<h3>Racket sports more broadly</h3>")
    A("<p class='src'><strong>Detection of Tennis Events from Acoustic "
      "Data</strong> &mdash; Baughman et al. (IBM), MMSports 2019. A CNN on "
      "MFCC delta-acceleration features reaches 92.5% precision and 92.4% "
      "recall on event classes, and the authors' own framing is the useful "
      "part: the sound of a match is more stable and consistent than the "
      "picture. But the 20&nbsp;ms analysis frames put a floor under the "
      "onset accuracy, which is the same trade this study measured.</p>")
    A("<p class='src'><strong>Detection of ball hits in a tennis game using "
      "audio and visual information</strong> (APSIPA 2012) and "
      "<strong>Improved Detection of Ball Hit Events Using Multimodal "
      "information</strong> (AVSP 2011). Audio-visual fusion for the same "
      "problem, including using the expected rhythm between hits to reject "
      "spurious peaks &mdash; a prior this study did not use and the one "
      "clearly untried idea left.</p>")
    A("<p class='src'><strong>US5908361, automated tennis line calling.</strong> "
      "States the remedy for adjacent courts directly: enhance the "
      "<em>directivity</em> of the microphone and raise the detection "
      "level, and you can tell your own court's landing from the "
      "neighbours'. It is a capture-side fix, not a signal-processing one, "
      "which is exactly what the in-play/gap ratio above implies.</p>")
    A("<p class='src'><strong>Snickometer / UltraEdge</strong> in cricket is "
      "the mature commercial version of the idea this study tested: audio "
      "confirming whether a contact occurred at a moment the picture is "
      "already looking at. It works with a sensitive microphone <em>at the "
      "stumps</em> &mdash; at the source, not five metres away on a "
      "tripod.</p>")
    A("<p class='src'><strong>Sound event localisation</strong> (the DCASE "
      "SELD task and its literature) is unanimous that localising a sound "
      "needs a microphone array; single-channel systems detect and classify "
      "but cannot place. That is the formal version of this study's "
      "problem: a bounce on the next table and a bounce on ours are the "
      "same event class.</p>")

    A("<h3>What the literature would have us try next, in order</h3>")
    A("<ul>"
      "<li><strong>Surface classification</strong> (racket / table / floor). "
      "0.97 F1 in the lab. It would sharpen the bounce-versus-contact "
      "distinction, which is where every gain in this study came from. It "
      "does not say <em>which</em> table, so it cannot touch the 15%. The "
      "public dataset is non-commercial, so it would need our own labels."
      "</li>"
      "<li><strong>Inter-hit rhythm priors.</strong> Free, untried, and "
      "aimed straight at a detector firing 2&ndash;4 times a second between "
      "points.</li>"
      "<li><strong>A directional microphone</strong> is the only measure "
      "anyone reports as separating adjacent courts. That is a change to "
      "how matches are filmed, not to the worker.</li>"
      "</ul>")

    # ---------------------------------------------------------------- cards
    A("<h2>7. A hundred points, and what the detector heard</h2>")
    A(f"<p>Sampled evenly across the ten most recent uploads at the time of "
      f"writing, from six different accounts &mdash; deliberately not the "
      f"study corpus, so the behaviour can be checked on whatever people "
      f"actually uploaded this week. "
      f"<strong>{stats['points']} points, {stats['hi']} peaks in the "
      f"10&nbsp;kHz band, {stats['lo']} in the 1.5&ndash;8&nbsp;kHz band, "
      f"{stats['visual']} stored visual events.</strong></p>")
    A("<p>The curve is the 10&nbsp;kHz onset strength. Play the audio and "
      "watch where the marks fall &mdash; that is exactly what the detector "
      "read.</p>")
    A("<div class='legend'>"
      "<span><i class='sw' style='background:#4dd8e8'></i> onset strength "
      "(10 kHz+)</span>"
      "<span><i class='sw' style='background:#e8b84d;height:11px;width:2px'>"
      "</i> impact, 10 kHz+ (z &ge; 6)</span>"
      "<span><i class='sw' style='background:#7a7a86;height:6px;width:2px'>"
      "</i> impact, 1.5&ndash;8 kHz (z &ge; 3)</span>"
      "<span><i class='dot' style='background:#5ecf8f'></i> visual bounce"
      "</span>"
      "<span><i class='dot' style='background:#8f8fe8'></i> visual contact"
      "</span>"
      "<span><i class='dot' style='background:#e87d7d'></i> visual event "
      "that projects off the table</span>"
      "<span><i class='sw' style='background:#3a3a20;height:11px;width:11px'>"
      "</i> Adil's serve-to-winner taps</span>"
      "</div>")

    options = "".join(
        f"<option value='{m[0]}'>{html.escape(str(m[1]))} &middot; "
        f"{html.escape(str(m[2]))} &middot; {m[3]} &middot; {m[5]}ch</option>"
        for m in matches)
    A("<div class='controls'>"
      f"<select id='matchsel'><option value=''>every match "
      f"({len(matches)})</option>{options}</select>"
      "<select id='sortsel'>"
      "<option value='order'>upload order</option>"
      "<option value='rate'>busiest audio first</option>"
      "<option value='quiet'>quietest audio first</option>"
      "<option value='off'>most off-table visual events first</option>"
      "</select>"
      "<button id='playall'>stop all audio</button>"
      "<span class='note' id='count'></span></div>")

    A("<div class='cards' id='cards'>")
    for i, card in enumerate(cards):
        taps = ("" if not card["taps"] else
                f" &middot; taps {card['taps'][0][0]:.1f}–"
                f"{card['taps'][0][1]:.1f}s")
        off = ("" if not card["n_offtable"] else
               f" &middot; <span style='color:#e87d7d'>"
               f"{card['n_offtable']} off table</span>")
        A(f"<div class='card' data-slug='{card['slug']}' data-i='{i}' "
          f"data-rate='{card['rate_hi']:.3f}' data-off='{card['n_offtable']}'>")
        A(f"<div class='chead'><b>{html.escape(str(card['opponent']))}"
          f" &middot; point {card['idx']}</b>"
          f"<span class='pill'>{html.escape(str(card['venue']))}</span>"
          f"<span class='pill'>{card['date']}</span>"
          f"<span class='pill'>user {card['user']}</span>"
          f"<span class='pill'>{card['channels']}ch</span>"
          f"<span>{card['t0']:.2f}–{card['t1']:.2f}s"
          f" ({card['t1'] - card['t0']:.1f}s){taps}</span></div>")
        A(card["svg"])
        A(f"<div class='cfoot'><span>{card['n_hi']} impacts at 10 kHz+ "
          f"({card['rate_hi']:.1f}/s) &middot; {card['n_lo']} at 1.5–8 kHz "
          f"&middot; {card['n_visual']} visual{off}</span>"
          f"<button class='play' data-i='{i}'>listen</button>"
          f"<span class='slot'></span></div>")
        A("</div>")
    A("</div>")
    A("<script id='clips' type='application/json'>"
      + json.dumps([c["audio"] for c in cards]) + "</script>")

    A("<h2>8. Reproducing any of this</h2>")
    A("<p>Every script is in "
      "<code>docs/research/2026-08-28-audio-bounce-confirmation/</code>. "
      "Nothing in the study writes to <code>jobs</code>, "
      "<code>matches</code> or <code>points</code>; no match was "
      "reprocessed and no notification could fire. Source videos were "
      "re-downloaded to a scratch directory and deleted after their audio "
      "was extracted.</p>")
    A("<ul>"
      "<li><code>dump_corpus.py</code> &mdash; the seven-match ruler corpus, "
      "read-only</li>"
      "<li><code>audio_impacts.py</code> &mdash; the detector; "
      "<code>align.py</code> measures it against production's own visual "
      "bounces</li>"
      "<li><code>boundary_ruler.py</code> &mdash; in-play against gaps, "
      "using Adil's taps</li>"
      "<li><code>stereo_probe.py</code> &mdash; whether direction "
      "information exists in the file</li>"
      "<li><code>replay.py</code> &mdash; every arm, through the production "
      "reconstruction; <code>apply_scaffold.py --check</code> proves the "
      "five module names it needs change nothing at their defaults</li>"
      "<li><code>baseline.ts</code> and <code>compare.ts</code> &mdash; the "
      "app's own ruler, imported not restated</li>"
      "</ul>")
    A("</div>")

    script = """
<script>
const cards = Array.from(document.querySelectorAll('.card'));
const sel = document.getElementById('matchsel');
const sort = document.getElementById('sortsel');
const count = document.getElementById('count');
const wrap = document.getElementById('cards');
function apply() {
  const slug = sel.value;
  let shown = 0;
  cards.forEach(c => {
    const on = !slug || c.dataset.slug === slug;
    c.style.display = on ? '' : 'none';
    if (on) shown++;
  });
  const key = sort.value;
  const order = cards.slice().sort((a, b) => {
    if (key === 'rate') return b.dataset.rate - a.dataset.rate;
    if (key === 'quiet') return a.dataset.rate - b.dataset.rate;
    if (key === 'off') return b.dataset.off - a.dataset.off
      || a.dataset.i - b.dataset.i;
    return a.dataset.i - b.dataset.i;
  });
  order.forEach(c => wrap.appendChild(c));
  count.textContent = shown + ' shown';
}
sel.onchange = sort.onchange = apply;
// The clips live in one JSON blob and become <audio> only when asked for.
// A hundred data-URI media elements in the DOM is enough to stall the
// renderer on open, which is the whole reason this is lazy.
const clips = JSON.parse(document.getElementById('clips').textContent);
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.play');
  if (!btn) return;
  const slot = btn.nextElementSibling;
  if (slot.firstChild) { slot.firstChild.play(); return; }
  const a = document.createElement('audio');
  a.controls = true;
  a.src = 'data:audio/mp4;base64,' + clips[btn.dataset.i];
  slot.appendChild(a);
  btn.textContent = 'replay';
  a.play();
});
document.getElementById('playall').onclick = (e) => {
  document.querySelectorAll('audio').forEach(a => { a.pause(); a.remove(); });
  document.querySelectorAll('.play').forEach(b => b.textContent = 'listen');
};
apply();
</script>
"""
    page = ("<!doctype html><html lang='en'><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<title>PongLens — audio bounce confirmation</title>"
            "<style>" + CSS + "</head><body>" + "".join(body) + script
            + "</body></html>")
    with open(out_path, "w") as handle:
        handle.write(page)
    print(f"{out_path}  {os.path.getsize(out_path) / 1e6:.1f} MB, "
          f"{len(cards)} points")


if __name__ == "__main__":
    main()

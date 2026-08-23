import base64, json
head = open("head.html").read()
payload = open("payload.json").read()
bg = base64.b64encode(open("bg.jpg","rb").read()).decode()
d = json.loads(payload)["d"]
c = d["counts"]

BODY = f"""
<div class="wrap">
<div class="eyebrow">Placement research &middot; Chris &middot; PingPod &middot; 22 Aug 2026</div>
<h1>Only {c['now']} of {c['live']} points get a placement map. The tracking is not the reason.</h1>
<p class="lede">Ninety-eight scored points, a table found perfectly, and the ball
located on almost all of them. Twelve maps come out the other end. This walks
through where the other eighty-six go, and what it would take to get them back.</p>

<div class="cards">
  <div class="card"><div class="k">Scored points</div><div class="v num">{c['live']}</div>
    <div class="s">9 deleted, 8 lets kept</div></div>
  <div class="card"><div class="k">Mapped today</div><div class="v num">{c['now']}</div>
    <div class="s">{c['landingsNow']} landings plotted</div></div>
  <div class="card hi"><div class="k">Strong evidence</div><div class="v num">87</div>
    <div class="s">score alone clears the bar</div></div>
  <div class="card"><div class="k">Reachable</div><div class="v num">{c['F']}</div>
    <div class="s">{c['landingsF']} landings, rules relaxed</div></div>
</div>
<div class="note"><p><strong>The table was never the problem.</strong> The keypoint
detector agreed on 14 of 14 frames with 0.9&nbsp;px spread, so every bounce that
reached the map had a trustworthy quad to land on.</p></div>

<h2>The confidence number is a cap, not a measurement</h2>
<p>This is the part worth reading twice. Each point gets a score from the evidence,
and that score becomes a confidence through a sigmoid. Then, before anything is
shown, the worker does this:</p>
<div class="note"><p><code>if hard_reasons: confidence = min(confidence, 0.69)</code><br>
<code>elif blocked_from_ready: confidence = min(confidence, 0.71)</code></p></div>
<p>The app then hides anything below <code>0.70</code>. So a point whose evidence
scored <strong>0.94</strong> is written to the database as <strong>0.69</strong>
because one rule fired, and 0.69 is under the line by a hundredth. The number you
see is not what the tracker thought. It is the rule's verdict wearing a
percentage.</p>
<p><strong>Median raw confidence across these 98 points is 0.871.</strong> Median
stored confidence is 0.690. That gap is entirely the cap.</p>

<h2>Three locks in series</h2>
<p>A point has to pass all three to be drawn, and they are not independent.</p>
<div class="scroll"><table>
<thead><tr><th>Lock</th><th>Where</th><th>Rule</th><th class="n">Survivors</th></tr></thead>
<tbody>
<tr><td>Evidence</td><td>worker</td><td>sigmoid(score/4) &ge; 0.72</td><td class="n">87</td></tr>
<tr><td>Eleven veto rules</td><td>worker</td><td>any one blocks <code>ready</code> outright</td><td class="n">18</td></tr>
<tr><td>Server match</td><td>app</td><td>the hypothesis for the <em>scored</em> server, not the better one</td><td class="n">12</td></tr>
</tbody></table></div>
<p>The middle lock does almost all the killing. And the third is worth noticing:
23 hypotheses reach <code>ready</code>, but only the one matching the scored
server counts, so six of them are discarded while a perfectly good map sits on
the other side of the point.</p>

<h2>Which rules are actually firing</h2>
<p>Counted on the hypothesis the app would use. Several rules fire together on the
same point, so these do not sum to 98.</p>
<div class="scroll"><table>
<thead><tr><th>Reason</th><th class="n">Points</th><th>What it is about</th><th>Does it move a landing?</th></tr></thead>
<tbody>
<tr><td><code>contact_too_close_after_landing</code></td><td class="n">41</td><td>racket contact timing</td><td>No</td></tr>
<tr><td><code>unexpected_hitter</code></td><td class="n">33</td><td>who hit it</td><td>No</td></tr>
<tr><td><code>contact_missing_before_landing</code></td><td class="n">33</td><td>racket contact missing</td><td>No</td></tr>
<tr><td><code>terminal_observation_missing</code></td><td class="n">28</td><td>how the point ended</td><td>No</td></tr>
<tr><td><code>landing_missing_before_contact</code></td><td class="n">25</td><td>rally ordering</td><td>No</td></tr>
<tr><td><code>later_evidence_after_terminal</code></td><td class="n">22</td><td>events after the end</td><td>No</td></tr>
<tr><td><code>landing_on_hitter_half</code></td><td class="n">19</td><td>geometry of a landing</td><td><strong>Yes</strong></td></tr>
<tr><td><code>terminal_inferred_from_suggestion</code></td><td class="n">11</td><td>how the point ended</td><td>No</td></tr>
<tr><td><code>non_alternating_contacts</code></td><td class="n">6</td><td>rally ordering</td><td>No</td></tr>
</tbody></table></div>
<div class="note"><p><strong>Eight of the nine are about the rally story, not about
where the ball hit the table.</strong> The map draws bounce landings. It does not
draw racket contacts, and the code says so explicitly: contacts happen above the
table plane, so projecting them is meaningless. Yet a missing contact, or a
contact that came a little too soon after a bounce, throws away every landing in
the point.</p></div>

<h2>What each relaxation is worth</h2>
<p>Every row below was produced by recomputing the statuses and then running the
app's own <code>collectTrustedPlacementObservations</code> over the result. The
recomputation reproduces all 212 stored hypotheses exactly before anything is
varied, so these are the real numbers, not a model of them.</p>
<div class="scroll"><table>
<thead><tr><th>Change</th><th class="n">Points mapped</th><th class="n">Landings</th><th class="n">vs today</th></tr></thead>
<tbody>
<tr><td>Today</td><td class="n">12</td><td class="n">29</td><td class="n">&mdash;</td></tr>
<tr><td>Stop vetoing on contact detection</td><td class="n">23</td><td class="n">75</td><td class="n">&times;1.9</td></tr>
<tr><td>Stop vetoing on how the point ended</td><td class="n">18</td><td class="n">38</td><td class="n">&times;1.5</td></tr>
<tr><td>Both of the above</td><td class="n">38</td><td class="n">114</td><td class="n">&times;3.2</td></tr>
<tr><td>&hellip; and treat serve-order as soft</td><td class="n">40</td><td class="n">117</td><td class="n">&times;3.3</td></tr>
<tr class="best"><td><strong>Judge on evidence only</strong></td><td class="n"><strong>76</strong></td><td class="n"><strong>235</strong></td><td class="n"><strong>&times;6.3</strong></td></tr>
</tbody></table></div>
<p>Seventy-six of 98 is 78%. That is the number a person would call reasonable,
and it needs no new tracking, no new model and no re-processing. The data is
already sitting in the match file.</p>

<h2>Are the recovered landings any good?</h2>
<p>This is the question that decides whether any of the above is safe, so it is
worth being blunt about what is and is not proven here.</p>
<div class="scroll"><table>
<thead><tr><th></th><th class="n">Landings</th><th class="n">On the table</th><th class="n">Median confidence</th><th class="n">Serves on table</th></tr></thead>
<tbody>
<tr><td>Drawn today</td><td class="n">29</td><td class="n">100%</td><td class="n">0.82</td><td class="n">10 / 10</td></tr>
<tr><td>Recovered</td><td class="n">206</td><td class="n">100%</td><td class="n">0.82</td><td class="n">59 / 59</td></tr>
</tbody></table></div>
<p>Every recovered landing projects inside the physical table, at the same
confidence as the ones already trusted, and every recovered serve lands on the
table rather than in the net or off the end. If these were noise, they would
scatter. They do not.</p>
<p><strong>What that does not prove:</strong> that each landing is in the
<em>right</em> place. On-table is a plausibility check, not accuracy. The point
explorer below is there so the geometry can be judged by eye, and that is the
step I would want done before any of this ships.</p>

<h2>Every point, and what the tracker saw</h2>
<p>Each card is one scored point. Left is the table from above with the bounces
the tracker found; right is the camera view with the detected quad and the same
bounces where they were seen. Click any point for the full reasoning.</p>
<div class="legend">
  <span><b style="background:var(--ok)"></b>landing used by the map</span>
  <span><b style="background:var(--accent)"></b>bounce projected onto the table</span>
  <span><b style="background:var(--bad)"></b>bounce that would not project</span>
</div>
<div class="controls" id="controls"></div>
<div class="grid" id="grid"></div>
<p class="meta" id="count"></p>

<h2>What I would do</h2>
<ul>
<li><strong>Split the gate in two.</strong> One judgement for "is this landing in
the right place", which is all the map needs, and a separate one for "do we
understand this rally", which is what the eleven rules actually test. Today the
second silently vetoes the first.</li>
<li><strong>Gate per landing, not per point.</strong> A rally with eight bounces
where one contact is ambiguous currently loses all eight. Dropping the one shot
in question keeps the rest, and the aggregate map is a distribution, so it
tolerates a gap far better than it tolerates absence.</li>
<li><strong>Stop encoding a verdict as a probability.</strong> Capping to 0.69 so
it lands under a 0.70 filter makes the number unreadable and couples the worker
to a UI constant. Keep the evidence confidence honest and carry the veto as its
own field.</li>
<li><strong>Use the better hypothesis when the scored server disagrees.</strong>
Six ready maps are discarded for this reason alone. Either the scoring or the
attribution is wrong on those points, and both are knowable.</li>
</ul>
<p>The first two are worth about 76 of 98 on this match by themselves. None of it
requires touching the tracker.</p>
<hr class="rule">
<p class="meta">Generated from match ec6490f4 &middot; match.json v3, points_pipeline v2
&middot; counts produced by the app's own filter, not a re-implementation.</p>
</div>
"""

SCRIPT = """
<script>
const P = __PAYLOAD__;
const BG = "data:image/jpeg;base64,__BG__";
const D = P.d, PTS = D.points, Q = P.quad;
const W = 1.525, L = 2.740;
const blockSet = new Set(P.blockers);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

// ---- table map: 1.525 x 2.740 m seen from above
function tableSVG(p, big) {
  const pad = 16, sc = big ? 92 : 62;
  const w = W * sc + pad * 2, h = L * sc + pad * 2;
  const X = (u) => pad + u * sc, Y = (v) => pad + v * sc;
  const used = new Set();
  (p.shots || []).forEach((s) => {
    if (s.landing && s.landing.u != null) used.add(s.landing.u + "," + s.landing.v);
  });
  let o = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Bounces on the table">`;
  o += `<rect x="${pad}" y="${pad}" width="${W*sc}" height="${L*sc}" rx="3"
    fill="var(--felt)" opacity=".45" stroke="var(--table)" stroke-width="1.6"/>`;
  o += `<line x1="${pad}" y1="${Y(L/2)}" x2="${pad+W*sc}" y2="${Y(L/2)}"
    stroke="var(--table)" stroke-width="1.6"/>`;
  o += `<line x1="${X(W/2)}" y1="${pad}" x2="${X(W/2)}" y2="${pad+L*sc}"
    stroke="var(--table)" stroke-width=".6" opacity=".45" stroke-dasharray="3 3"/>`;
  (p.cands || []).forEach((cd) => {
    if (cd.u == null || cd.v == null) return;
    const isUsed = used.has(cd.u + "," + cd.v);
    o += `<circle cx="${X(cd.u).toFixed(1)}" cy="${Y(cd.v).toFixed(1)}"
      r="${isUsed ? (big?5.5:3.8) : (big?3.6:2.4)}"
      fill="${isUsed ? "var(--ok)" : "var(--accent)"}"
      opacity="${isUsed ? .95 : .5}"/>`;
  });
  const nulls = (p.cands || []).filter((cd) => cd.u == null).length;
  if (nulls) o += `<text x="${w-pad}" y="${h-5}" text-anchor="end"
    font-size="${big?12:9}" fill="var(--bad)" font-family="var(--mono)">
    ${nulls} off&#8209;table</text>`;
  return o + "</svg>";
}

// ---- camera view: real frame, detected quad, bounces where they were seen
const KEYS = ["A_near_1","B_near_2","C_far_2","D_far_1"];
// Crop to the detected table plus a margin. The full 1920x1080 frame renders
// the table about 40 px wide in a card, which shows nothing.
const CROP = (() => {
  const s = 0.5;
  const xs = KEYS.map((k) => Q[k][0]*s), ys = KEYS.map((k) => Q[k][1]*s);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const mx = (x1-x0)*0.16, my = Math.max((y1-y0)*0.55, 34);
  return { x: x0-mx, y: y0-my, w: (x1-x0)+mx*2, h: (y1-y0)+my*2 };
})();
function camSVG(p, big) {
  const s = 0.5;
  const q = KEYS.map((k) => (Q[k][0]*s).toFixed(1)+","+(Q[k][1]*s).toFixed(1)).join(" ");
  const k = CROP.w / (big ? 460 : 150);          // keep marks a constant size
  let o = `<svg viewBox="${CROP.x.toFixed(1)} ${CROP.y.toFixed(1)}
    ${CROP.w.toFixed(1)} ${CROP.h.toFixed(1)}" role="img"
    aria-label="What the camera saw">`;
  o += `<image href="${BG}" x="0" y="0" width="960" height="540" opacity=".78"/>`;
  o += `<polygon points="${q}" fill="var(--accent)" fill-opacity=".16"
    stroke="var(--accent)" stroke-width="${(1.8*k).toFixed(2)}"/>`;
  (p.cands || []).forEach((cd) => {
    const bad = cd.u == null;
    o += `<circle cx="${(cd.x*s).toFixed(1)}" cy="${(cd.y*s).toFixed(1)}"
      r="${(4.2*k).toFixed(2)}" fill="none"
      stroke="${bad?"var(--bad)":"var(--ok)"}"
      stroke-width="${(1.7*k).toFixed(2)}" opacity=".95"/>`;
  });
  return o + "</svg>";
}

function confBar(p) {
  const raw = p.raw == null ? 0 : p.raw, shown = p.conf == null ? 0 : p.conf;
  const capped = Math.abs(raw - shown) > 0.005;
  return `<div class="bar"><i style="width:${(raw*100).toFixed(0)}%"></i>
    <span class="cap" style="left:70%"></span></div>
    <div class="meta">evidence <span class="num">${raw.toFixed(2)}</span>
    &nbsp;&rarr;&nbsp; stored <span class="num">${shown.toFixed(2)}</span>
    ${capped ? '<span class="chip block" style="margin-left:6px">capped</span>' : ""}
    <span style="float:right">cut&#8209;off 0.70</span></div>`;
}

function card(p) {
  return `<article class="pt ${p.plottedNow ? "on" : ""}" data-idx="${p.idx}"
    tabindex="0" role="button" aria-label="Point ${p.idx}">
    <div class="hd"><span class="id">Point ${p.idx}</span>
      <span class="st ${p.status}">${p.status}</span></div>
    <div class="two">${tableSVG(p,false)}${camSVG(p,false)}</div>
    ${confBar(p)}
    <div class="meta">${p.plottedNow
      ? '<span class="chip ok">drawn today</span>'
      : p.plottedF ? '<span class="chip hard">recoverable</span>'
      : '<span class="chip">low evidence</span>'}
      ${(p.cands||[]).length} bounces</div>
  </article>`;
}

const FILTERS = [
  ["all", "All 98", () => true],
  ["now", "Drawn today", (p) => p.plottedNow],
  ["rec", "Recoverable", (p) => !p.plottedNow && p.plottedF],
  ["weak", "Genuinely weak", (p) => !p.plottedNow && !p.plottedF],
  ["contact", "Blocked on contact", (p) =>
     (p.reasons||[]).some((r) => P.contact.includes(r))],
  ["term", "Blocked on ending", (p) =>
     (p.reasons||[]).some((r) => P.terminal.includes(r))],
];
let active = "all";
function render() {
  const f = FILTERS.find((x) => x[0] === active)[2];
  const rows = PTS.filter(f);
  document.getElementById("grid").innerHTML = rows.map(card).join("");
  document.getElementById("count").textContent =
    `${rows.length} of ${PTS.length} points shown`;
}
document.getElementById("controls").innerHTML = FILTERS.map(([k,label,f]) =>
  `<button class="f" data-k="${k}" aria-pressed="${k===active}">${label}
   <span class="num">${PTS.filter(f).length}</span></button>`).join("");
document.getElementById("controls").addEventListener("click", (e) => {
  const b = e.target.closest("button.f"); if (!b) return;
  active = b.dataset.k;
  [...document.querySelectorAll("button.f")].forEach((x) =>
    x.setAttribute("aria-pressed", String(x.dataset.k === active)));
  render();
});

const dlg = document.createElement("dialog");
dlg.innerHTML = '<button class="close" aria-label="Close">&times;</button><div class="dlg"></div>';
document.body.appendChild(dlg);
dlg.querySelector(".close").addEventListener("click", () => dlg.close());
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

function open(idx) {
  const p = PTS.find((x) => x.idx === idx); if (!p) return;
  const chips = (list, cls) => list.map((r) =>
    `<span class="chip ${cls || (blockSet.has(r) ? "block" : "")}">${esc(r)}</span>`).join("");
  const shots = (p.shots||[]).map((s) =>
    `<tr><td class="n">${s.seq}</td><td>${esc(s.phase)}</td>
     <td>${esc(s.hitter||"?")}</td>
     <td class="n">${s.landing && s.landing.u!=null
        ? s.landing.u.toFixed(2)+", "+s.landing.v.toFixed(2) : "&mdash;"}</td>
     <td class="n">${s.conf==null?"":s.conf.toFixed(2)}</td></tr>`).join("");
  dlg.querySelector(".dlg").innerHTML = `
    <div class="eyebrow">Point ${p.idx} &middot; game ${p.game+1}
      &middot; ${p.t0}s&ndash;${p.t1}s</div>
    <h3 style="margin-top:0;font-size:19px">${esc(p.how||"unscored")}
      &mdash; ${esc(p.winner||"?")} won</h3>
    <p style="font-size:13.5px">Server ${esc(p.server||"?")} on the
      <strong>${esc(p.serverSide||"?")}</strong> side; you are on the
      ${esc(p.userSide)} side this game.
      ${p.plottedNow ? "This point <strong>is</strong> on the map today."
        : p.plottedF ? "Blocked today, but the evidence carries it."
        : "The evidence is genuinely thin here."}</p>
    ${confBar(p)}
    <div class="two" style="margin:14px 0">${tableSVG(p,true)}${camSVG(p,true)}</div>
    <h3>Why it is where it is</h3>
    <div>${p.hard.length ? chips(p.hard,"hard") : ""}
      ${chips((p.reasons||[]).filter((r)=>!p.hard.includes(r)))}</div>
    <h3>Shots the tracker reconstructed</h3>
    <div class="scroll"><table><thead><tr><th>#</th><th>Phase</th><th>Hitter</th>
      <th class="n">Landing u,v</th><th class="n">Conf</th></tr></thead>
      <tbody>${shots || '<tr><td colspan="5">none</td></tr>'}</tbody></table></div>`;
  dlg.showModal();
}
document.getElementById("grid").addEventListener("click", (e) => {
  const c = e.target.closest(".pt"); if (c) open(Number(c.dataset.idx));
});
document.getElementById("grid").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const c = e.target.closest(".pt"); if (c) { e.preventDefault(); open(Number(c.dataset.idx)); }
});
render();
</script>
"""
SCRIPT = SCRIPT.replace("__PAYLOAD__", payload).replace("__BG__", bg)
open("placement-review.html","w").write(head + BODY + SCRIPT)
import os; print("wrote", os.path.getsize("placement-review.html"), "bytes")

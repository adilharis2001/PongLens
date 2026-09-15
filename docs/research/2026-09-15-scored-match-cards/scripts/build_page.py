import json, os, html
from collections import Counter
SP = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SP, "out")
chart = json.load(open(os.path.join(OUT, "chart.json")))
rows = json.load(open(os.path.join(OUT, "rows.json")))
examples = json.load(open(os.path.join(OUT, "examples.json")))
c6 = json.load(open(os.path.join(OUT, "chart6.json")))
ENDING_GATE = {"lester":71,"rowel":69,"prabhas":85,"ishan":41,"ali":44,"chris_aug22":78,"julian_aug23":58,"yuyulin":64,"brian":57,"anton":65,"vaibhav_sep4":55,"chris_aug14":70,"julian_oct25":67,"terry2":71,"vaibhav_wtc":20,"chris_jul26b":77,"chris_jul26a":90,"chris_jul26c":82,"julian_aug11_pinkrim":62}
W, L = 1.525, 2.74; NET = L / 2

LABEL = {
 "lester": "Lester · Pingpod · 27 Aug", "rowel": "Rowel · Pingpod · Oct 25", "prabhas": "Prabhas · LYTTC · 10 Aug",
 "ishan": "Ishan · LYTTC · 10 Aug", "ali": "Ali · LYTTC · 11 Aug", "chris_aug22": "Chris · Pingpod · 22 Aug",
 "julian_aug23": "Julian · Pingpod · 23 Aug", "yuyulin": "Yu Yu Lin · Westchester · 29 Aug", "brian": "Brian · US Nationals · 5 Jul",
 "anton": "Anton · Pingpod · 7 Sep", "vaibhav_sep4": "Vaibhav · Pingpod · 4 Sep", "chris_aug14": "Chris · Pingpod · 14 Aug",
 "julian_oct25": "Julian · PingPod Dobro · Oct 25", "terry2": "Terry 2 · Westchester · Oct 25", "vaibhav_wtc": "Vaibhav · Westchester · 22 Jul",
 "chris_jul26b": "Chris · PingPod · 26 Jul (b)", "chris_jul26a": "Chris · PingPod · 26 Jul (a)", "chris_jul26c": "Chris · PingPod · 26 Jul (c)",
 "julian_aug11_pinkrim": "Julian · PingPod · 11 Aug (old table)",
}
ORDER = [m["slug"] for m in chart["matches"]]
# measured in analysis.txt / analysis3.txt (same run, same corpus)
NEAR_SHARE = {"lester":45,"rowel":46,"prabhas":53,"ishan":49,"ali":43,"chris_aug22":54,"julian_aug23":44,"yuyulin":48,"brian":64,"anton":66,"vaibhav_sep4":43,"chris_aug14":52,"julian_oct25":53,"terry2":59,"vaibhav_wtc":84,"chris_jul26b":53,"chris_jul26a":43,"chris_jul26c":46,"julian_aug11_pinkrim":44}
SIDE = {"lester":(56,2,531),"rowel":(40,3,419),"prabhas":(29,3,237),"ishan":(23,0,322),"ali":(0,3,179),"chris_aug22":(54,4,510),"julian_aug23":(0,35,354),"yuyulin":(27,0,430),"brian":(39,0,319),"anton":(16,3,200),"vaibhav_sep4":(108,11,493),"chris_aug14":(51,3,500),"julian_oct25":(37,3,228),"terry2":(7,6,90),"vaibhav_wtc":(53,3,122),"chris_jul26b":(0,16,185),"chris_jul26a":(0,10,146),"chris_jul26c":(0,12,183),"julian_aug11_pinkrim":(3,56,550)}
NOISE = [("Off the table entirely", 28, "drop (already excluded)"), ("Within 83 ms of a racket contact", 14, "drop from rally maps"),
         ("Within 8 cm of a table edge", 14, "drop the edge band"), ("Within 15 cm of the net", 6, "drop unless net error"),
         ("Before the serve's first bounce", 5, "drop"), ("Repeated in one spot (3+ in 2 s)", 5, "drop"), ("Any of the above", 40, "")]

def esc(s): return html.escape(str(s))

# ---------- serve ruler per match from rows.json
serve_by = {}
for r in rows:
    d = serve_by.setdefault(r["slug"], Counter()); d[r["serve"]] += 1; d["pts"] += 1

# ---------- heat table of card coverage
def heat_cell(v, n):
    p = 100 * v / n if n else 0
    # sequential blue ramp steps (light/dark handled by CSS alpha over accent) -> use opacity band classes
    band = 0 if p < 20 else 1 if p < 40 else 2 if p < 60 else 3 if p < 80 else 4
    return f'<td class="hc b{band}" title="{v} of {n} points"><span>{p:.0f}%</span></td>'
heat_rows = []
for m in chart["matches"]:
    n = m["points"]; s = m["slug"]
    cov6 = c6["per"].get(s, {}).get("covered", 0)
    gate = ENDING_GATE[s]
    end_cell = heat_cell(m["ending"], n) if gate >= 70 else f'<td class="hc b0 hidden-card" title="self-check {gate}%: fewer than 70% of endings on the loser half"><span>hidden</span></td>'
    heat_rows.append(f'<tr><th scope="row">{esc(LABEL[s])}</th><td class="num">{n}</td>'
                     + heat_cell(m["serve"], n) + heat_cell(cov6, n) + end_cell + f'<td class="num dim">{gate}%</td></tr>')
T = chart["totals"]
cov6_total = sum(v.get("covered", 0) for v in c6["per"].values())
gated_pts = sum(m["points"] for m in chart["matches"] if ENDING_GATE[m["slug"]] >= 70)
gated_end = sum(m["ending"] for m in chart["matches"] if ENDING_GATE[m["slug"]] >= 70)
heat_total = (f'<tr class="total"><th scope="row">All 19 matches</th><td class="num">{T["points"]}</td>'
              + heat_cell(T["serve_drawn"], T["points"]) + heat_cell(cov6_total, T["points"]) + f'<td class="hc b3" title="{gated_end} of {gated_pts} points on the 8 matches that pass"><span>{100*gated_end/gated_pts:.0f}%</span></td><td class="num dim">8 of 19 pass</td></tr>')

# ---------- table diagram of where noise sits
def table_svg_noise():
    # top-down table, near end at bottom. scale 120 px per metre
    s = 120; pad_l, pad_r, pad_t, pad_b = 200, 200, 70, 70
    tw, tl = W * s, L * s
    ox, oy = pad_l, pad_t
    vw, vh = tw + pad_l + pad_r, tl + pad_t + pad_b
    e = chart["edge"]; ec = chart["edge_contact"]; dc = chart["depth_contact"]
    parts = [f'<svg viewBox="0 0 {vw:.0f} {vh:.0f}" role="img" aria-label="Top-down table with noise counts by edge and depth band" class="fig">']
    parts.append(f'<rect x="0" y="0" width="{vw:.0f}" height="{vh:.0f}" fill="var(--surface)"/>')
    # depth bins, drawn far (top) to near (bottom): bin 5 is at top
    maxshare = 0.33
    for bi in range(6):
        nc, tot = dc[str(bi)]
        share = nc / tot if tot else 0
        y = oy + tl - (bi + 1) * tl / 6
        alpha = 0.08 + 0.8 * min(1, share / maxshare)
        parts.append(f'<rect x="{ox:.1f}" y="{y:.1f}" width="{tw:.1f}" height="{tl/6:.1f}" fill="var(--s2)" fill-opacity="{alpha:.2f}" stroke="var(--surface)" stroke-width="2"><title>{tot} bounces in this band, {share*100:.0f}% within 83 ms of a racket contact</title></rect>')
        parts.append(f'<text x="{ox + tw/2:.1f}" y="{y + tl/12 + 5:.1f}" text-anchor="middle" class="lbl-on">{share*100:.0f}% near a contact <tspan class="lbl-dim">· {tot}</tspan></text>')
    parts.append(f'<rect x="{ox:.1f}" y="{oy:.1f}" width="{tw:.1f}" height="{tl:.1f}" fill="none" stroke="var(--ink-strong)" stroke-width="2"/>')
    parts.append(f'<line x1="{ox:.1f}" y1="{oy + tl/2:.1f}" x2="{ox + tw:.1f}" y2="{oy + tl/2:.1f}" stroke="var(--ink-strong)" stroke-width="2" stroke-dasharray="6 4"/>')
    parts.append(f'<text x="{ox + tw + 10:.1f}" y="{oy + tl/2 + 4:.1f}" class="lbl">net</text>')
    # edge annotations
    def ann(x, y, anchor, title, n, c):
        share = 100 * c / n if n else 0
        return (f'<text x="{x:.1f}" y="{y:.1f}" text-anchor="{anchor}" class="lbl-strong">{title}</text>'
                f'<text x="{x:.1f}" y="{y+16:.1f}" text-anchor="{anchor}" class="lbl">{n} bounces within 8 cm</text>'
                f'<text x="{x:.1f}" y="{y+32:.1f}" text-anchor="{anchor}" class="lbl {"lbl-warn" if share >= 30 else ""}">{share:.0f}% near a contact</text>')
    parts.append(ann(ox + tw/2, 22, "middle", "Far end line", e["far end line"], ec["far end line"]))
    parts.append(ann(ox + tw/2, oy + tl + 24, "middle", "Near end line (camera side)", e["near end line"], ec["near end line"]))
    parts.append(ann(ox - 12, oy + tl/2 - 20, "end", "Camera-left sideline", e["camera-left sideline"], ec["camera-left sideline"]))
    parts.append(ann(ox + tw + 12, oy + tl/2 + 60, "start", "Camera-right sideline", e["camera-right sideline"], ec["camera-right sideline"]))
    parts.append(f'<text x="{ox - 12:.1f}" y="{oy + tl - 8:.1f}" text-anchor="end" class="lbl-dim">camera ↓</text>')
    parts.append('</svg>')
    return "".join(parts)

# ---------- horizontal bar charts
def hbars(data, series, title, xmax=100, ref=None, band=None, unit="%", height_per=26, legend=True, fmt=lambda v: f"{v:.0f}"):
    """data: list of (label, [v1, v2, ...]); series: list of (name, css var)."""
    lw = 230; pw = 440; pad_r = 60; rh = height_per
    n = len(data); k = len(series)
    bh = max(6, (rh - 8) / k)
    vh = 30 + n * rh + 30
    vw = lw + pw + pad_r
    p = [f'<svg viewBox="0 0 {vw} {vh:.0f}" role="img" aria-label="{esc(title)}" class="fig">']
    p.append(f'<rect x="0" y="0" width="{vw}" height="{vh:.0f}" fill="var(--surface)"/>')
    x0 = lw; y0 = 30
    def X(v): return x0 + pw * v / xmax
    for t in range(0, xmax + 1, 25 if xmax == 100 else xmax // 4):
        p.append(f'<line x1="{X(t):.1f}" y1="{y0-6}" x2="{X(t):.1f}" y2="{y0 + n*rh:.0f}" stroke="var(--grid)" stroke-width="1"/>')
        p.append(f'<text x="{X(t):.1f}" y="{y0-12}" text-anchor="middle" class="lbl-dim">{t}{unit}</text>')
    if band:
        p.append(f'<rect x="{X(band[0]):.1f}" y="{y0-6}" width="{X(band[1]) - X(band[0]):.1f}" height="{n*rh + 6:.0f}" fill="var(--s3)" fill-opacity="0.10"/>')
    for i, (label, vals) in enumerate(data):
        y = y0 + i * rh
        p.append(f'<text x="{lw - 12}" y="{y + rh/2 + 4:.1f}" text-anchor="end" class="lbl">{esc(label)}</text>')
        for j, v in enumerate(vals):
            yy = y + 4 + j * bh
            w = max(0, X(v) - x0)
            p.append(f'<rect x="{x0}" y="{yy:.1f}" width="{w:.1f}" height="{bh - 2:.1f}" rx="0" fill="{series[j][1]}"><title>{esc(label)} — {esc(series[j][0])}: {fmt(v)}{unit}</title></rect>')
            p.append(f'<text x="{X(v) + 6:.1f}" y="{yy + bh/2 + 3:.1f}" class="lbl-dim num">{fmt(v)}</text>')
    if ref is not None:
        p.append(f'<line x1="{X(ref):.1f}" y1="{y0-6}" x2="{X(ref):.1f}" y2="{y0 + n*rh:.0f}" stroke="var(--ink-strong)" stroke-width="1.5" stroke-dasharray="4 3"/>')
    if legend and k > 1:
        lx = x0
        for name, col in series:
            p.append(f'<rect x="{lx}" y="{vh-16:.0f}" width="12" height="12" fill="{col}"/>')
            p.append(f'<text x="{lx+16}" y="{vh-6:.0f}" class="lbl">{esc(name)}</text>')
            lx += 16 + 8 * len(name) + 24
    p.append('</svg>')
    return "".join(p)

def stacked(data, series, title, height_per=26):
    lw = 230; pw = 440; pad_r = 40; rh = height_per; n = len(data)
    vh = 30 + n * rh + 30; vw = lw + pw + pad_r; x0 = lw; y0 = 30
    p = [f'<svg viewBox="0 0 {vw} {vh:.0f}" role="img" aria-label="{esc(title)}" class="fig">', f'<rect x="0" y="0" width="{vw}" height="{vh:.0f}" fill="var(--surface)"/>']
    for t in range(0, 101, 25):
        p.append(f'<line x1="{x0 + pw*t/100:.1f}" y1="{y0-6}" x2="{x0 + pw*t/100:.1f}" y2="{y0 + n*rh:.0f}" stroke="var(--grid)"/>')
        p.append(f'<text x="{x0 + pw*t/100:.1f}" y="{y0-12}" text-anchor="middle" class="lbl-dim">{t}%</text>')
    for i, (label, vals) in enumerate(data):
        y = y0 + i * rh; acc = 0
        p.append(f'<text x="{lw - 12}" y="{y + rh/2 + 4:.1f}" text-anchor="end" class="lbl">{esc(label)}</text>')
        for j, v in enumerate(vals):
            w = pw * v / 100
            p.append(f'<rect x="{x0 + pw*acc/100:.1f}" y="{y+5}" width="{max(0, w-2):.1f}" height="{rh-10}" fill="{series[j][1]}"><title>{esc(label)} — {esc(series[j][0])}: {v:.0f}%</title></rect>')
            if j == 0 and w > 30:
                p.append(f'<text x="{x0 + 6}" y="{y + rh/2 + 4:.1f}" class="lbl-on num">{v:.0f}%</text>')
            acc += v
    lx = x0
    for name, col in series:
        p.append(f'<rect x="{lx}" y="{vh-16:.0f}" width="12" height="12" fill="{col}"/>'); p.append(f'<text x="{lx+16}" y="{vh-6:.0f}" class="lbl">{esc(name)}</text>'); lx += 16 + 7.5 * len(name) + 24
    p.append('</svg>'); return "".join(p)

# data for charts
side_data = [(LABEL[s], [100 * SIDE[s][0] / SIDE[s][2], 100 * SIDE[s][1] / SIDE[s][2]]) for s in ORDER]
near_data = [(LABEL[s], [NEAR_SHARE[s]]) for s in ORDER]
serve_data = []
for s in ORDER:
    d = serve_by[s]; n = d["pts"]
    drawn = 100 * d["drawn"] / n
    notontable = 100 * (d["no_landing"] + d["off_table"]) / n
    misread = 100 * (d["wrong_half"] + d["first_bounce_wrong_half"]) / n
    other = max(0, 100 - drawn - notontable - misread)
    serve_data.append((LABEL[s], [drawn, notontable, misread, other]))
dur = chart["dur"]
dur_data = [(k, [100 * dur[k][1] / dur[k][0]]) for k in ("short <3s", "mid 3-6s", "long 6s+")]
dur_labels = {"short <3s": f"Under 3 s · {dur['short <3s'][0]} points", "mid 3-6s": f"3 to 6 s · {dur['mid 3-6s'][0]} points", "long 6s+": f"Over 6 s · {dur['long 6s+'][0]} points"}
dur_data = [(dur_labels[k], v) for k, v in dur_data]
noise_data = [(n, [v]) for n, v, _ in NOISE]
BUCKETS = ("short <3s", "mid 3-6s", "long 6s+"); BL = {"short <3s": "Under 3 s", "mid 3-6s": "3 to 6 s", "long 6s+": "Over 6 s"}
len_data = [(BL[b], [100 * c6["dur"][f"your serve|{b}"][1] / c6["dur"][f"your serve|{b}"][0], 100 * c6["dur"][f"their serve|{b}"][1] / c6["dur"][f"their serve|{b}"][0]]) for b in BUCKETS]
len_n = {b: (c6["dur"][f"your serve|{b}"][0], c6["dur"][f"their serve|{b}"][0]) for b in BUCKETS}
def thirds(lst):
    s = sorted(x for x, _ in lst); n = len(s); q1, q3 = s[n//3], s[2*n//3]
    out = []
    for name, lo, hi in (("Slow", 0, q1), ("Medium", q1, q3), ("Fast", q3, 99)):
        sel = [w for x, w in lst if lo <= x < hi]; out.append((name, 100 * sum(sel) / len(sel), len(sel), lo, hi))
    return out
sp_you = thirds(c6["speed"]["your serve"]); sp_them = thirds(c6["speed"]["their serve"])
speed_data = [(f"{a[0]} · {a[3]:.1f} to {min(a[4], 9.9):.1f} m/s", [a[1], b[1]]) for a, b in zip(sp_you, sp_them)]
k_data = [("No return landing seen (k = 0)", [62]), ("One return landing (k = 1)", [67]), ("Two (k = 2)", [74]), ("Three or more", [68]), ("k = 0 and the rally ended within 1 s", [67])]


# ---------- example point diagrams
def example_svg(e, caption):
    s = 170; pad = 30; tw, tl = W * s, L * s
    vw, vh = tw + 2 * pad + 470, tl + 2 * pad
    ox, oy = pad, pad
    b = [c for c in e["cands"] if c["kind"] == "bounce"]
    sfb_t = next((c["t"] for c in b if c["sfb"]), None)
    p = [f'<svg viewBox="0 0 {vw:.0f} {vh:.0f}" role="img" aria-label="{esc(caption)}" class="fig ex">', f'<rect x="0" y="0" width="{vw:.0f}" height="{vh:.0f}" fill="var(--surface)"/>']
    p.append(f'<rect x="{ox}" y="{oy}" width="{tw:.1f}" height="{tl:.1f}" fill="var(--table)" stroke="var(--ink-strong)" stroke-width="1.5"/>')
    p.append(f'<line x1="{ox}" y1="{oy + tl/2:.1f}" x2="{ox + tw:.1f}" y2="{oy + tl/2:.1f}" stroke="var(--ink-strong)" stroke-width="1.5" stroke-dasharray="5 3"/>')
    p.append(f'<text x="{ox + tw/2:.1f}" y="{oy + tl + 16:.1f}" text-anchor="middle" class="lbl-dim">camera side</text>')
    legend_rows = []
    prev = None; idx = 0
    for c in b:
        idx += 1
        cls = "ok"; note = "rally bounce"
        if c["sfb"] or c["sland"]: cls = "serve"; note = "serve bounce"
        elif sfb_t is not None and c["t"] < sfb_t: cls = "bad"; note = "before the serve"
        elif c["nc"]: cls = "bad"; note = "racket contact"
        elif c["u"] is not None and abs(c["v"] - NET) <= 0.15: cls = "bad"; note = "net band"
        elif prev is not None and c["t"] - prev > 1.5: cls = "bad"; note = f"{c['t']-prev:.1f} s gap: dead play"
        prev = c["t"]
        if c["u"] is None:
            legend_rows.append((idx, "off", f"{c['t']:.2f} s", "off the table"))
            continue
        # draw, near end at bottom: v=0 at bottom
        x = ox + c["u"] / W * tw; y = oy + tl - c["v"] / L * tl
        x = min(max(x, ox - 10), ox + tw + 10); y = min(max(y, oy - 10), oy + tl + 10)
        p.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="11" class="dot {cls}"><title>#{idx} at {c["t"]:.2f} s: {note}</title></circle>')
        p.append(f'<text x="{x:.1f}" y="{y + 4:.1f}" text-anchor="middle" class="dotn">{idx}</text>')
        legend_rows.append((idx, cls, f"{c['t']:.2f} s", note))
    lx = ox + tw + 30; ly = oy + 8
    p.append(f'<text x="{lx}" y="{ly}" class="lbl-strong">{esc(caption)}</text>')
    for i, (n, cls, t, note) in enumerate(legend_rows[:14]):
        yy = ly + 24 + i * 19
        p.append(f'<circle cx="{lx + 7}" cy="{yy - 4}" r="6" class="dot {cls}"/>')
        p.append(f'<text x="{lx + 22}" y="{yy}" class="lbl"><tspan class="num">{n:>2}</tspan>  {t}  {esc(note)}</text>')
    if len(legend_rows) > 14:
        p.append(f'<text x="{lx + 22}" y="{ly + 24 + 14*19}" class="lbl-dim">… {len(legend_rows) - 14} more</text>')
    p.append('</svg>'); return "".join(p)

ex_by = {e["idx"]: e for e in examples}
ex_html = "".join([
    example_svg(ex_by[3], "Point 3: racket contact read as a bounce"),
    example_svg(ex_by[23], "Point 23: dead play after the point"),
    example_svg(ex_by[6], "Point 6: a rally kept, one net-band dot dropped"),
])

NOW = [
 ("Tap a heat map cell, see its points", "The points behind a zone's number, each opening the point detail view", "—", "The dots already carry their point ids; no new data"),
 ("Point length, by whose serve", "Win rate in points under 3 s, 3 to 6 s, over 6 s, on your serve and on theirs", "83%", "On their serve you win 43% of points under 3 s and 56% over 6 s"),
 ("Serve speed", "Slow, medium, fast from the two serve bounces, with win rate", "57%", "Your slow serves win 39%, your fast serves 56%"),
 ("Serve variety", "How spread your serves are and the zone you go to most, you against them", "57%", "Top zone share runs 20 to 48% across the corpus"),
 ("Where points ended", "The last landing before your score tap, on the loser's half", "62% on 8 of 19 matches", "Shown only where 70%+ of endings land on the loser's half; hidden on Brian-type cameras"),
]
LATER = [
 ("Receive error rate", "Points lost on the return of serve, by serve zone", "The receiver lost only 65% of the time when no return landing was seen, even with a time gate"),
 ("Ended on the third ball", "Points the server lost on their first attack", "72% agreement with the score"),
 ("Rally length in shots", "Strokes per point", "The return bounce is missed on half of the points that show no return"),
 ("Attack or push, by shot speed", "Fast shots against slow ones, from contact to landing", "Contact time exists, the hitting position does not, and the contact detector fires on about a third of shots"),
 ("Rally heat map", "Every landing in the rally, per player", "The bounce chain stays clean on 45 to 55% of drawn serves"),
]
now_rows = "".join(f'<tr><th scope="row">{esc(a)}</th><td>{esc(b)}</td><td class="num">{esc(c)}</td><td class="dim">{esc(d)}</td></tr>' for a, b, c, d in NOW)
later_rows = "".join(f'<tr><th scope="row">{esc(a)}</th><td>{esc(b)}</td><td class="dim">{esc(c)}</td></tr>' for a, b, c in LATER)

RULES = [
 ("Off the table", "Projects outside the table and its safety band", "28%", "Already dropped"),
 ("Racket contact read as a bounce", "Within 83 ms of a detected contact. 60% of near-end-line bounces, 33% of the nearest 46 cm", "14%", "Drop from rally maps. Touches 8% of drawn serves, so check by eye before applying to serves"),
 ("One-sided sideline pile-up", "10 to 43% of in-table bounces sit within 8 cm of one sideline, about 1% on the other", "~12%", "Drop the 8 cm edge band"),
 ("Net band", "Within 15 cm of the net", "6%", "Drop unless the point ended in the net"),
 ("Pre-serve taps, parked ball", "Before the serve's first bounce, or 3+ bounces in one spot within 2 s", "5% + 5%", "Drop"),
 ("Dead play after the point", "17% of bounce-to-bounce gaps exceed 1 s", "—", "Cut after the worker's rally end, drop a trailing bounce 1.5 s after the last"),
 ("Halves must alternate", "After the serve pair, landings alternate halves", "—", "Stop at the first violation, do not guess"),
 ("Truth gates from the score", "Serve's first bounce on the server's half. Last landing on the loser's half (65% pass)", "—", "Reject the point's serve or ending when it fails"),
 ("Match-level density", "Near and far share of in-table bounces outside 40 to 60%", "3 of 19 matches", "Hide rally maps for that match"),
]
rule_rows = "".join(f'<tr><th scope="row">{esc(a)}</th><td>{esc(b)}</td><td class="num">{esc(c)}</td><td>{esc(d)}</td></tr>' for a, b, c, d in RULES)

S1, S2, S3, S4 = "var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)"
page = f"""<title>Scored Match Cards</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">
<style>
:root {{
  --ground:#f4f6f9; --surface:#ffffff; --surface-2:#eef1f6; --edge:#d9dee8; --grid:#e6eaf1; --table:#e8f7fb;
  --ink:#12141a; --ink-2:#4b5263; --ink-3:#7a8194; --ink-strong:#12141a; --accent:#0e7490; --accent-ink:#ffffff;
  --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100; --warn:#b45309; --good:#047857; --later:#6b7280;
  --h0:rgba(42,120,214,.08); --h1:rgba(42,120,214,.20); --h2:rgba(42,120,214,.36); --h3:rgba(42,120,214,.56); --h4:rgba(42,120,214,.78);
}}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{
  --ground:#0a0a0f; --surface:#14141c; --surface-2:#1b1b26; --edge:#262633; --grid:#222231; --table:#0f2a33;
  --ink:#f4f4f5; --ink-2:#a1a1aa; --ink-3:#71717a; --ink-strong:#e4e4e7; --accent:#22d3ee; --accent-ink:#0a0a0f;
  --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --warn:#f59e0b; --good:#34d399; --later:#9ca3af;
  --h0:rgba(57,135,229,.10); --h1:rgba(57,135,229,.24); --h2:rgba(57,135,229,.40); --h3:rgba(57,135,229,.58); --h4:rgba(57,135,229,.80);
}} }}
:root[data-theme="dark"] {{
  --ground:#0a0a0f; --surface:#14141c; --surface-2:#1b1b26; --edge:#262633; --grid:#222231; --table:#0f2a33;
  --ink:#f4f4f5; --ink-2:#a1a1aa; --ink-3:#71717a; --ink-strong:#e4e4e7; --accent:#22d3ee; --accent-ink:#0a0a0f;
  --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --warn:#f59e0b; --good:#34d399; --later:#9ca3af;
  --h0:rgba(57,135,229,.10); --h1:rgba(57,135,229,.24); --h2:rgba(57,135,229,.40); --h3:rgba(57,135,229,.58); --h4:rgba(57,135,229,.80);
}}
body {{ background:var(--ground); color:var(--ink); font-family:"Geist", ui-sans-serif, system-ui, sans-serif; font-size:15px; line-height:1.5; margin:0; }}
main {{ max-width: 920px; margin: 0 auto; padding: 40px 20px 72px; display:flex; flex-direction:column; gap:44px; }}
h1 {{ font-size: 28px; font-weight:600; letter-spacing:-0.01em; margin:0 0 6px; text-wrap:balance; }}
h2 {{ font-size: 18px; font-weight:600; margin:0; text-wrap:balance; }}
.eyebrow {{ font-family:"Geist Mono", ui-monospace, monospace; font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--ink-3); margin:0 0 8px; }}
.summary {{ background:var(--surface); border:1px solid var(--edge); border-left:3px solid var(--accent); padding:18px 22px; font-size:17px; line-height:1.55; max-width:72ch; }}
.summary p {{ margin:0 0 10px; }} .summary p:last-child {{ margin:0; }}
section {{ display:flex; flex-direction:column; gap:14px; }}
.note {{ color:var(--ink-2); font-size:14px; max-width:72ch; margin:0; }}
.tbl {{ overflow-x:auto; border:1px solid var(--edge); background:var(--surface); }}
table {{ border-collapse:collapse; width:100%; font-size:14px; }}
th, td {{ text-align:left; padding:9px 12px; border-bottom:1px solid var(--edge); vertical-align:top; }}
thead th {{ font-family:"Geist Mono", ui-monospace, monospace; font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-3); font-weight:500; background:var(--surface-2); }}
tbody th {{ font-weight:500; white-space:nowrap; }}
tr:last-child td, tr:last-child th {{ border-bottom:none; }}
.num {{ font-family:"Geist Mono", ui-monospace, monospace; font-variant-numeric:tabular-nums; white-space:nowrap; }}
.dim {{ color:var(--ink-2); }}
.pill {{ display:inline-block; font-size:12px; font-weight:500; padding:2px 10px; border-radius:999px; border:1px solid; white-space:nowrap; }}
.pill.ship {{ color:var(--good); border-color:var(--good); }} .pill.beta {{ color:var(--warn); border-color:var(--warn); }} .pill.later {{ color:var(--later); border-color:var(--later); }}
.hc {{ text-align:right; }} .hc span {{ font-family:"Geist Mono", ui-monospace, monospace; font-variant-numeric:tabular-nums; }}
.hc.b0 {{ background:var(--h0); }} .hc.b1 {{ background:var(--h1); }} .hc.b2 {{ background:var(--h2); }} .hc.b3 {{ background:var(--h3); }} .hc.b4 {{ background:var(--h4); }}
.hc.b3 span, .hc.b4 span {{ color:#fff; }}
.hc.hidden-card span {{ color:var(--ink-3); font-style:italic; }}
tr.total th, tr.total td {{ border-top:2px solid var(--edge); font-weight:600; }}
.figwrap {{ overflow-x:auto; border:1px solid var(--edge); background:var(--surface); }}
.fig {{ display:block; width:100%; height:auto; min-width:640px; }}
.fig.ex {{ min-width:560px; }}
.lbl {{ font-family:"Geist", ui-sans-serif, sans-serif; font-size:12.5px; fill:var(--ink-2); }}
.lbl-strong {{ font-family:"Geist", ui-sans-serif, sans-serif; font-size:13px; font-weight:600; fill:var(--ink); }}
.lbl-dim {{ font-family:"Geist", ui-sans-serif, sans-serif; font-size:11.5px; fill:var(--ink-3); }}
.lbl-on {{ font-family:"Geist", ui-sans-serif, sans-serif; font-size:12.5px; font-weight:500; fill:var(--ink); }}
.lbl-warn {{ fill:var(--warn); font-weight:600; }}
.dot.serve {{ fill:var(--accent); stroke:var(--surface); stroke-width:1.5; }} .dot.ok {{ fill:var(--s1); stroke:var(--surface); stroke-width:1.5; }} .dot.bad {{ fill:var(--s2); stroke:var(--surface); stroke-width:1.5; }} .dot.off {{ fill:var(--ink-3); }}
.dotn {{ font-family:"Geist Mono", ui-monospace, monospace; font-size:9px; font-weight:500; fill:#fff; }}
.grid2 {{ display:grid; grid-template-columns:1fr 1fr; gap:14px; }}
@media (max-width:760px) {{ .grid2 {{ grid-template-columns:1fr; }} }}
.decision {{ display:grid; grid-template-columns:1fr 1fr; gap:14px; }}
@media (max-width:760px) {{ .decision {{ grid-template-columns:1fr; }} }}
.decision > div {{ background:var(--surface); border:1px solid var(--edge); padding:16px 18px; }}
.decision h3 {{ font-size:15px; margin:0 0 8px; font-weight:600; }}
.decision ul {{ margin:0; padding-left:18px; color:var(--ink-2); font-size:14px; }} .decision li {{ margin:4px 0; }}
.decision .pick {{ border-color:var(--accent); }}
footer {{ color:var(--ink-3); font-size:13px; max-width:72ch; }}
svg text {{ pointer-events:none; }}
</style>
<main>
  <header>
    <p class="eyebrow">PongLens · placement after scoring · 15 Sep 2026</p>
    <h1>What to show once a match is scored</h1>
    <div class="summary">
      <p>Serve placement and the heat map already cover serve depth and direction, so the cards to add are point length by whose serve, serve speed, serve variety, and where points ended on matches that pass a self-check, plus tapping a heat map cell to open its points.</p>
      <p>Receive errors, third-ball outcomes, rally length in shots and attack versus push are not possible yet: the return-of-serve bounce is missed a third of the time, so a receive-error card would be wrong one point in three.</p>
      <p>Across 19 scored matches and 1,320 points the new cards cover 57 to 83% of points from data already stored, gated on 75% scored, with the fix to the bounce detector coming second.</p>
    </div>
  </header>

  <section>
    <p class="eyebrow">1 · The cards</p>
    <h2>Possible now, beside serve placement and the heat map</h2>
    <div class="tbl"><table>
      <thead><tr><th>Card</th><th>What the player sees</th><th>Coverage</th><th>Evidence from the corpus</th></tr></thead>
      <tbody>{now_rows}</tbody>
    </table></div>
    <h2>Not yet</h2>
    <div class="tbl"><table>
      <thead><tr><th>Card</th><th>What it would show</th><th>Why not</th></tr></thead>
      <tbody>{later_rows}</tbody>
    </table></div>
    <p class="note">Coverage is the share of scored points that pass every filter, over the whole corpus. Point length runs from the serve's first bounce to the earlier of the worker's rally end and your score tap, so dead play after the point cannot stretch it. The manual serve spin and length fields are filled on 1 of 19 matches, so nothing here depends on them.</p>
  </section>

  <section>
    <p class="eyebrow">2 · Coverage by match</p>
    <h2>How much of each match the shippable cards would show</h2>
    <div class="tbl"><table>
      <thead><tr><th>Match</th><th>Scored points</th><th>Serve speed, variety</th><th>Point length</th><th>Where points ended</th><th>Ending self-check</th></tr></thead>
      <tbody>{"".join(heat_rows)}{heat_total}</tbody>
    </table></div>
    <p class="note">The self-check is the share of a match's endings that land on the loser's half; the ending card shows only where it reaches 70%. Brian, Terry 2 and the Westchester Vaibhav match have poor tables or camera angles and sit at the bottom of every column.</p>
  </section>

  <section>
    <p class="eyebrow">3 · The noise</p>
    <h2>What to reject, measured on 9,400 bounce candidates</h2>
    <div class="tbl"><table>
      <thead><tr><th>Rule</th><th>Signature</th><th>Share</th><th>Action</th></tr></thead>
      <tbody>{rule_rows}</tbody>
    </table></div>
    <div class="figwrap">{hbars(noise_data, [("share of bounce candidates", S2)], "Noise signatures", xmax=50, height_per=30, legend=False)}</div>
    <div class="figwrap">{table_svg_noise()}</div>
    <p class="note">Above: how many bounce candidates each signature catches; the rows overlap. Below it: where the racket-contact problem lives. The camera-side player's stroke is a lowest point in the picture, exactly what the bounce detector looks for, and it projects onto the near end line or the nearest strip of the table.</p>
  </section>

  <section>
    <p class="eyebrow">4 · The sideline pile-up</p>
    <h2>One sideline collects 10 to 43% of in-table bounces, the other about 1%</h2>
    <div class="figwrap">{hbars(side_data, [("camera-left sideline", S1), ("camera-right sideline", S2)], "Sideline share per match", xmax=50, unit="%", height_per=30)}</div>
    <p class="note">Which sideline piles up flips with where the camera stands, not with who is playing. A ball in the air projects onto the table away from the camera, so racket contacts and mid-flight dips land on the far sideline. Real edge balls are about 1% of shots, which is what the quiet side shows.</p>
  </section>

  <section>
    <p class="eyebrow">5 · Density by half</p>
    <h2>Near-half share of in-table bounces, per match</h2>
    <div class="figwrap">{hbars(near_data, [("near half share", S1)], "Near-half share", xmax=100, ref=50, band=(40, 60), height_per=26, legend=False)}</div>
    <p class="note">A rally alternates halves, so a match should sit near 50%. The shaded band is the proposed 40 to 60% tolerance. Brian, Anton and the Westchester Vaibhav match fall outside it and should not get rally maps until the detector improves.</p>
  </section>

  <section>
    <p class="eyebrow">6 · The serve ruler today</p>
    <h2>Why a serve draws no dot</h2>
    <div class="figwrap">{stacked(serve_data, [("drawn", S1), ("ball not on this table", S2), ("serve misread", S4), ("other", S3)], "Serve placement outcomes per match")}</div>
    <p class="note">Ball not on this table means the landing projected off the table or onto a neighbouring one, the LYTTC problem. Serve misread means the landing or first bounce was on the wrong half, which the scored rotation catches. The reconstruction's own guess at who served agrees with the score only 65% of the time, so every card except the two timing and ending cards needs the 75% scored gate.</p>
  </section>

  <section>
    <p class="eyebrow">7 · Two of the new cards, already answering</p>
    <h2>Adil's win rate by point length, on his serve and on theirs</h2>
    <div class="figwrap">{hbars(len_data, [("your serve", S1), ("their serve", S2)], "Win rate by point length and server", xmax=100, ref=50, height_per=44)}</div>
    <p class="note">Point counts: under 3 s {len_n["short <3s"][0]} on your serve and {len_n["short <3s"][1]} on theirs, 3 to 6 s {len_n["mid 3-6s"][0]} and {len_n["mid 3-6s"][1]}, over 6 s {len_n["long 6s+"][0]} and {len_n["long 6s+"][1]}. On their serve the short points are where you lose and the long ones where you win, which is the return-of-serve story without needing a single return bounce.</p>
    <h2>Server's win rate by serve speed</h2>
    <div class="figwrap">{hbars(speed_data, [("your serves", S1), ("their serves", S2)], "Server win rate by serve speed", xmax=100, ref=50, height_per=44)}</div>
    <p class="note">Speed is the distance between the serve's two bounces divided by the time between them, both on the table plane, so it needs nothing after the serve. Your slow serves are punished and your fast ones win; theirs win at every speed. Thirds are drawn per player.</p>
  </section>

  <section>
    <p class="eyebrow">8 · Why the first three balls cannot be scored yet</p>
    <h2>Does the number of return bounces agree with who lost?</h2>
    <div class="figwrap">{hbars(k_data, [("agreement with the score", S4)], "Agreement between bounce count and scored loser", xmax=100, ref=90, height_per=34, legend=False)}</div>
    <p class="note">If no return landed, the receiver should have lost; with one return landing, the server; and so on. Agreement sits at 62 to 74% and a time gate does not lift it. Half of the points that show no return actually continued past 1.5 s, so the return bounce was missed. The dashed line is where a card could be trusted.</p>
    <div class="tbl"><table>
      <thead><tr><th>Your score tap against the worker's rally end</th><th>Value</th></tr></thead>
      <tbody>
        <tr><th scope="row">Points with both</th><td class="num">934</td></tr>
        <tr><th scope="row">Tap after the rally end, median</th><td class="num">1.33 s</td></tr>
        <tr><th scope="row">Rally end later than the tap, so dead play sits inside it</th><td class="num">20%</td></tr>
        <tr><th scope="row">Rally end more than 4 s before the tap</th><td class="num">0%</td></tr>
      </tbody>
    </table></div>
    <p class="note">The point-length card therefore ends a point at the earlier of the two, so that 20% cannot stretch a point.</p>
  </section>

  <section>
    <p class="eyebrow">9 · Three points from Chris, 22 Aug</p>
    <h2>What the filters remove and what they keep</h2>
    <div class="figwrap">{ex_html}</div>
    <p class="note">Blue is kept, orange is rejected, cyan is the serve pair. Numbers follow detection order; the list gives the time inside the clip and the reason.</p>
  </section>

  <section>
    <p class="eyebrow">10 · The decision</p>
    <h2>Fix the source data first, or ship on filtered data?</h2>
    <div class="decision">
      <div class="pick"><h3>Ship now on filtered data</h3><ul>
        <li>Four cards plus the heat map tap-through, 57 to 83% coverage, no worker change.</li>
        <li>Filters applied at read time, the same pattern as the serves-only flag: every past match benefits and rollback is one setting.</li>
        <li>The scored rotation is the trusted server on every card that needs one.</li>
        <li>Each card says “n of N points” so the gap is visible, never invented.</li>
      </ul></div>
      <div><h3>Then fix, in this order</h3><ul>
        <li>Separate racket contacts from table bounces in the candidate extractor, and stop missing the return bounce. Unlocks receive errors, third-ball outcomes, rally length and rally heat maps.</li>
        <li>Reject the neighbouring table's ball at LYTTC. Worth up to 16 points of serve coverage there.</li>
        <li>Lower the 3-pixel rise and fall threshold for the far half, where the ball moves less on screen.</li>
        <li>Read the full ball track from match.json to time each shot from contact to landing, which is what attack against push needs.</li>
      </ul></div>
    </div>
  </section>

  <footer>Corpus: 19 matches with a scored winner on 75% or more of points and v3 placement, 1,320 scored points, 9,400 bounce candidates and 3,900 contact candidates. Who served comes from the app's own rotation code; serve dots from its own six serve rules. Hand-marked boundaries exist for Rowel, Prabhas and Ishan and were used to check the dead-play tail. No production data was changed.</footer>
</main>
"""
open(os.path.join(SP, "scored-match-cards.html"), "w").write(page)
print("wrote", len(page), "bytes")

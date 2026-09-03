"""Rebuild the cut-short page with the reason for each ending.

Same clips, same card ids (so the marks already in Adil's browser survive),
his hundred verdicts seeded in, and a filter across the five causes the
second pass named.
"""
import base64, html, json, os, re

W = "/tmp/serve-diag/census"
OUT = ("/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/"
       "dd63c93b-843c-4cc1-9306-421c75c875dd/scratchpad/cut-short-list.html")
rows = json.load(open(f"{W}/validate_list.json"))
verd = {(r["match_id"], r["point"]): r["verdict"]
        for r in json.load(open(f"{W}/verdicts_joined.json"))}
# causes.json is keyed by the match label the census used, not by id
causes = {(c["match"], c["pt"]): c for c in json.load(open("/tmp/serve-diag/eighteen/causes.json"))}

# The five families, in the order they matter. The one-line squeeze case
# belongs with the serve family: same trigger, different branch.
FAMILY = {
    "cut back for a serve that was detected next": "serve",
    "squeezed to the shortest a rally may be": "serve",
    "the 20-second cap cut the rally in half": "cap",
    "the 2.6s tail, measured from the last bounce it counted": "tail",
    "your own split": "hand",
    "the rally chain broke on a gap between net crossings": "chain",
}
FAMILIES = [
    ("serve", "A serve was read mid-rally",
     "The detector marked a serve while the point was still going. A serve's card has to open 1.6 seconds "
     "before the ball is struck, and no two cards may touch, so this card's tail was pulled back to make room. "
     "The rally never ended here; only the card did."),
    ("cap", "The rally passed twenty seconds",
     "No single card may run longer than twenty seconds. A rally that goes past it is cut at its quietest "
     "moment and handed over as two cards, 1.2 seconds apart."),
    ("tail", "The tail was measured from the wrong bounce",
     "A card ends 2.6 seconds after the last bounce on the table, but only bounces within two seconds of the "
     "last net crossing are counted. Bounces outside that window are ignored even when the ball is plainly "
     "still in play."),
    ("hand", "You cut it here yourself",
     "These boundaries were made in the app, not by the pipeline. The row that follows each one starts at the "
     "same instant."),
    ("chain", "The chain of net crossings broke",
     "A rally is followed as a run of net crossings no more than three seconds apart. One gap ran longer, so "
     "everything after it was dropped and the ending was measured from a bounce well before the real one."),
]
COLOUR = {"serve": "var(--mid)", "cap": "var(--warm)", "tail": "var(--toss)",
          "hand": "var(--muted)", "chain": "var(--gone)"}


def mmss(t):
    return f"{int(t) // 60}:{int(t) % 60:02d}"


def b64(p):
    return base64.b64encode(open(p, "rb").read()).decode()


for r in rows:
    key = (r["match_id"], r["point"])
    r["verdict"] = verd.get(key, "")
    c = causes.get((r["match"], r["point"]))
    r["family"] = FAMILY.get(c["cause"]) if c else ""
    r["cause_name"] = c["cause"] if c else ""
    r["cause_detail"] = (c.get("detail_v2") or c["detail"]) if c else ""
    p = f"{W}/clips/{r['match_id'][:8]}_{r['point']}.mp4"
    r["clip"] = p if os.path.exists(p) else None

counts = {f: sum(1 for r in rows if r["family"] == f) for f, _, _ in FAMILIES}
n_real = sum(1 for r in rows if r["verdict"] == "real")
n_no = sum(1 for r in rows if r["verdict"] == "no")
n_unsure = sum(1 for r in rows if r["verdict"] == "unsure")

css = open("/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/"
           "dd63c93b-843c-4cc1-9306-421c75c875dd/scratchpad/crop-serve-diff.html").read()
css = css.split("<style>")[1].split("</style>")[0]
script = open("/tmp/serve-diag/eighteen/page/page2.js").read()

items = []
for r in sorted(rows, key=lambda r: (r["family"] == "", r["family"], r["match"], r["point"])):
    admin = f"https://www.ponglens.com/admin/uploads/{r['match_id']}"
    fam = r["family"]
    label = {"real": "cut short", "no": "two separate points", "unsure": "could not tell"}.get(r["verdict"], "unmarked")
    tone = {"real": "gained", "no": "lost", "unsure": "lost"}.get(r["verdict"], "lost")
    video = (f'<video src="data:video/mp4;base64,{b64(r["clip"])}" loop muted playsinline controls preload="metadata"></video>'
             if r["clip"] else '<p class="note in">No processed video for this card.</p>')
    reason = ""
    if fam:
        title = next(t for k, t, _ in FAMILIES if k == fam)
        reason = (f'<p class="reason" style="--c:{COLOUR[fam]}"><b>{html.escape(title)}.</b> '
                  f'{html.escape(r["cause_detail"])}</p>')
    items.append(f'''
<article class="card" data-id="{html.escape(r['match_id'][:8] + '-' + str(r['point']))}"
         data-cause="{fam}" data-verdict-seed="{r['verdict']}" data-cause-name="{html.escape(r['cause_name'])}"
         data-match="{html.escape(r['match'])}" data-t="{r['point']}">
  <header>
    <span class="tag {tone}">{label}</span>
    <span class="who">{html.escape(r['match'])}</span>
    <span class="at">point {r['point']} &middot; ends {mmss(r['t1'])}</span>
  </header>
  {reason}
  {video}
  <p class="note in">The picture flashes cyan the instant the card ends &middot;
     <a href="{admin}" target="_blank" rel="noopener">open this match in admin</a></p>
  <div class="verdict">
    <button data-v="real" aria-pressed="false">Cut short</button>
    <button data-v="no" aria-pressed="false">Two points</button>
    <button data-v="unsure" aria-pressed="false">Can't tell</button>
  </div>
</article>''')

chips = [('<button class="chip" data-filter="real" aria-pressed="true">'
          f'Cut short <b>{n_real}</b></button>')]
for key, title, _ in FAMILIES:
    chips.append(f'<button class="chip" data-filter="{key}" aria-pressed="false" style="--c:{COLOUR[key]}">'
                 f'{html.escape(title)} <b>{counts[key]}</b></button>')
chips.append(f'<button class="chip" data-filter="no" aria-pressed="false">Two separate points <b>{n_no}</b></button>')
if n_unsure:
    chips.append(f'<button class="chip" data-filter="unsure" aria-pressed="false">Could not tell <b>{n_unsure}</b></button>')
chips.append(f'<button class="chip" data-filter="all" aria-pressed="false">Everything <b>{len(rows)}</b></button>')

legend = "".join(
    f'<div class="why"><h3 style="--c:{COLOUR[k]}">{html.escape(t)} <span>{counts[k]}</span></h3>'
    f'<p>{html.escape(d)}</p></div>' for k, t, d in FAMILIES)

seed = json.dumps({f"{r['match_id'][:8]}-{r['point']}": r["verdict"] for r in rows if r["verdict"]})

doc = f'''<title>Points cut before they ended</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>{css}
.note a {{ color: var(--ring); }}
.verdict {{ grid-template-columns: 1fr 1fr 1fr; }}
.bar {{ position: sticky; top: 0; z-index: 5; background: var(--ground);
        padding: 12px 0; margin: 0 0 22px; border-bottom: 1px solid var(--line);
        display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }}
.chip {{ font: inherit; font-size: 13px; color: var(--ink); background: var(--surface);
         border: 1px solid var(--line); border-radius: 999px; padding: 6px 13px;
         cursor: pointer; display: inline-flex; gap: 7px; align-items: center; }}
.chip b {{ font-variant-numeric: tabular-nums; color: var(--muted); font-weight: 600; }}
.chip[style*="--c"] {{ border-left: 3px solid var(--c); }}
.chip:hover {{ border-color: var(--ring); }}
.chip[aria-pressed="true"] {{ background: var(--ink); color: var(--ground); border-color: var(--ink); }}
.chip[aria-pressed="true"] b {{ color: var(--ground); opacity: 0.7; }}
.barspace {{ margin-left: auto; display: flex; gap: 14px; align-items: center;
             font-size: 13px; color: var(--muted); }}
.reason {{ margin: 0 0 12px; padding: 10px 13px; background: var(--sunk);
           border-left: 3px solid var(--c); border-radius: 0 8px 8px 0;
           font-size: 14px; line-height: 1.5; }}
.reason b {{ color: var(--c); }}
.whys {{ display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
         margin: 0 0 30px; }}
.why {{ background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }}
.why h3 {{ font-size: 14px; margin: 0 0 6px; padding-left: 10px; border-left: 3px solid var(--c);
           display: flex; justify-content: space-between; gap: 10px; }}
.why h3 span {{ color: var(--muted); font-variant-numeric: tabular-nums; }}
.why p {{ margin: 0; font-size: 13px; color: var(--muted); line-height: 1.5; }}
</style>
<div class="wrap">
<p class="eyebrow">Card assembly &middot; endings</p>
<h1>Points cut before they ended</h1>
<p class="lede">
You marked a hundred of these. Eighteen were genuinely cut while the point was
still going, and each of those eighteen now carries the reason the card ended
where it did, read from what the pipeline recorded on the day it cut the match.
Every time below is minutes and seconds into that match's video, so you can
scrub to it. Use the filters to move between the causes.
</p>
<p class="lede">
One thing worth knowing before you check these against the admin page: that page
recomputes the serve mark with today's rules, so a card can show no serve there
and still have had one when the match was cut. Three of the six below are exactly
that, and today's rules already leave them whole.
</p>
<p class="lede">
Each clip runs from four seconds before the cut into what the processed video
plays next, and flashes cyan at the moment the card ends. Your marks are still
here and can still be changed &mdash; <kbd>R</kbd> cut short, <kbd>N</kbd> two
points, <kbd>U</kbd> can't tell, <kbd>J</kbd>/<kbd>K</kbd> to move,
<kbd>Space</kbd> to play.
</p>

<h2>The five causes</h2>
<div class="whys">{legend}</div>

<div class="bar">
  {"".join(chips)}
  <span class="barspace"><span id="n-shown">18 cards</span><span id="pos">–</span>
    <button class="btn" id="copy">Copy results</button><span id="copied"></span></span>
</div>
<textarea id="fallback" hidden rows="8" aria-label="Results to copy"></textarea>

<div class="grid">{"".join(items)}</div>
</div>
<script>
window.SEED_MARKS = {seed};
window.SEED_VERSION = 'causes-2026-09-03';
{script}
</script>
'''
open(OUT, "w").write(doc)
print("counts", counts, "real", n_real, "no", n_no, "unsure", n_unsure)
print("page", f"{os.path.getsize(OUT) / 1e6:.2f} MB ->", OUT)

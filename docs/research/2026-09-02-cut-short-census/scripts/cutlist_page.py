"""The cut-short list as something Adil can watch and mark.

Each row becomes a clip cut from the match's own processed video: the
last four seconds of the card, then what the cut plays next. Cards are
concatenated in the processed video, so the boundary is exactly where a
viewer would feel the point end early. The clip flashes cyan at the cut.

Clips come straight off R2 by range request — ffmpeg seeks a presigned
URL — so nothing large is downloaded. Verdicts reuse the labelling page's
script with its own storage key.
"""
import base64, html, json, os, re, subprocess, sys
import boto3, psycopg2

W = "/tmp/serve-diag/census"
CLIPS = f"{W}/clips"
OUT = ("/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/"
       "dd63c93b-843c-4cc1-9306-421c75c875dd/scratchpad/cut-short-list.html")
os.makedirs(CLIPS, exist_ok=True)
rows = json.load(open(f"{W}/validate_list.json"))


def keychain(service):
    r = subprocess.run(["security", "find-generic-password", "-a", "openclaw", "-s", service, "-w"],
                       capture_output=True, text=True)
    return r.stdout.strip()


def r2():
    env = {}
    for line in open("/Users/adil/Desktop/Projects/PongLens/.env.local"):
        m = re.match(r'^([A-Z0-9_]+)=(.*)$', line.strip())
        if m:
            env[m.group(1)] = m.group(2).strip('"').strip("'")
    return boto3.client(
        "s3", endpoint_url=f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=env["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"], region_name="auto")


def mmss(t):
    return f"{int(t) // 60}:{int(t) % 60:02d}"


conn = psycopg2.connect(os.environ.get("DATABASE_URL") or keychain("ponglens-db-url"))
cur = conn.cursor()
mids = sorted({r["match_id"] for r in rows})
cur.execute("select id::text, cut_path, (clip_pads->>'pre')::float from matches where id = any(%s::uuid[])", (mids,))
match_meta = {mid: dict(cut=cut, pre=pre or 0.3) for mid, cut, pre in cur.fetchall()}
cur.execute("select match_id::text, idx, t0, t1, cut_t0 from points where match_id = any(%s::uuid[]) order by match_id, t0",
            (mids,))
cards = {}
for mid, idx, t0, t1, cut_t0 in cur.fetchall():
    cards.setdefault(mid, []).append(dict(idx=idx, t0=float(t0), t1=float(t1), cut_t0=float(cut_t0) if cut_t0 is not None else None))
conn.close()

c = r2()
urls = {}
for mid, m in match_meta.items():
    if m["cut"]:
        key = m["cut"].replace("r2://ponglens-media/", "")
        urls[mid] = c.generate_presigned_url("get_object", Params={"Bucket": "ponglens-media", "Key": key}, ExpiresIn=3600)

made = 0
for r in rows:
    mid = r["match_id"]
    lst = cards.get(mid, [])
    me = next((k for k in lst if k["idx"] == r["point"]), None)
    if not me or me["cut_t0"] is None or mid not in urls:
        r["clip"] = None
        continue
    pre = match_meta[mid]["pre"]
    cut_end = me["cut_t0"] + pre + (me["t1"] - me["t0"])
    nxt = next((k for k in lst if k["t0"] > me["t0"]), None)
    cut_next = nxt["cut_t0"] + pre if (nxt and nxt["cut_t0"] is not None) else cut_end
    start = max(0.0, cut_end - 4.0)
    length = min(12.0, max(6.0, (cut_next - start) + 3.0))
    mark = cut_end - start
    out = f"{CLIPS}/{mid[:8]}_{r['point']}.mp4"
    if not os.path.exists(out) or os.path.getsize(out) < 5000:
        vf = (f"scale=640:-2,drawbox=x=0:y=0:w=iw:h=ih:color=cyan@0.85:t=5:"
              f"enable='between(t,{mark:.2f},{mark + 0.5:.2f})'")
        res = subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{start:.3f}", "-i", urls[mid],
                              "-t", f"{length:.2f}", "-vf", vf, "-r", "24", "-c:v", "libx264",
                              "-preset", "veryfast", "-crf", "32", "-an", "-movflags", "+faststart", out],
                             capture_output=True, text=True, timeout=300)
        if res.returncode != 0:
            r["clip"] = None
            continue
    r["clip"] = out
    r["next_point_label"] = nxt["idx"] if nxt else None
    made += 1
    if made % 20 == 0:
        print(f"  {made} clips", flush=True)
print(f"{made} clips of {len(rows)} rows")

# ---- page ---------------------------------------------------------------
css = open("/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/"
           "dd63c93b-843c-4cc1-9306-421c75c875dd/scratchpad/crop-serve-diff.html").read()
css = css.split("<style>")[1].split("</style>")[0]
script = (open("/tmp/serve-diag/gl_page.js").read()
          .replace("ponglens-cropdiff-v1", "ponglens-cutshort-v1")
          .replace("ponglens-cropdiff-seed", "ponglens-cutshort-seed"))

def b64(p):
    return base64.b64encode(open(p, "rb").read()).decode()

items = []
for r in rows:
    admin = f"https://www.ponglens.com/admin/uploads/{r['match_id']}"
    grade = r["grade"]
    nxt = f" &middot; the cut continues into card {r['next_point_label']}" if r.get("next_point_label") else ""
    video = (f'<video src="data:video/mp4;base64,{b64(r["clip"])}" loop muted playsinline controls preload="metadata"></video>'
             if r.get("clip") else '<p class="note in">No processed video available for this card.</p>')
    items.append(f'''
<article class="card" data-id="{html.escape(r['match_id'][:8] + '-' + str(r['point']))}" data-kind="{grade}"
         data-match="{html.escape(r['match'])}" data-t="{r['point']}">
  <header>
    <span class="tag {'gained' if grade == 'confirmed' else 'lost'}">{grade}</span>
    <span class="who">{html.escape(r['match'])}</span>
    <span class="at">point {r['point']} &middot; ends {mmss(r['t1'])}</span>
  </header>
  <p class="note in">{html.escape(r['why'])}{nxt} &middot; <a href="{admin}" target="_blank" rel="noopener">open in admin</a></p>
  {video}
  <div class="verdict">
    <button data-v="real" aria-pressed="false">Cut short, same point</button>
    <button data-v="no" aria-pressed="false">Two separate points</button>
    <button data-v="unsure" aria-pressed="false">Can't tell</button>
  </div>
</article>''')

n_conf = sum(1 for r in rows if r["grade"] == "confirmed")
doc = f'''<title>Points cut before they ended</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>{css}
.note a {{ color: var(--ring); }}
.verdict {{ grid-template-columns: 1fr 1fr 1fr; }}
</style>
<div class="wrap">
<p class="eyebrow">Card assembly &middot; endings</p>
<h1>Points cut before they ended</h1>
<p class="lede">
Every ready match uploaded since 22 August, all accounts. Each clip is cut from
the match's own processed video: the last four seconds of the card, then
whatever the cut plays next. The picture flashes cyan at the exact moment the
card ends, so what you are judging is simple &mdash; <strong>was the point still
going when the flash came?</strong>
</p>
<p class="lede">
<strong>Confirmed</strong> means your own data already says the rally carried
on (a winner tap well past the end, a scored card followed by a fragment you
deleted, or a lob proven from the full-frame ball track). <strong>Likely</strong>
is a signature that agreed with your taps about two times in three, so expect
roughly one in three to be a genuine new point. End-on matches are left out of
the likely grade. Point numbers are the ones you see in the app; the admin link
opens the match.
</p>
<p class="lede">
Keys: <kbd>R</kbd> cut short, <kbd>N</kbd> two points, <kbd>U</kbd> can't tell,
<kbd>J</kbd>/<kbd>K</kbd> move, <kbd>Space</kbd> play. Marking jumps to the next
unmarked clip. When you are done, press <strong>Copy results</strong> and paste it
into the chat.
</p>

<div class="bar">
  <span class="count detail">cut short <b id="n-real">0</b></span>
  <span class="count detail" hidden>warm up <b id="n-warmup">0</b></span>
  <span class="count detail" hidden>ball toss <b id="n-toss">0</b></span>
  <span class="count detail" hidden>mid rally <b id="n-midrally">0</b></span>
  <span class="count detail">two points <b id="n-false">0</b></span>
  <span class="count detail">can't tell <b id="n-unsure">0</b></span>
  <span class="count">left <b id="n-left">0</b></span>
  <select id="filter" aria-label="Which clips to show">
    <option value="all">All {len(rows)} cards</option>
    <option value="confirmed">Only confirmed ({n_conf})</option>
    <option value="likely">Only likely ({len(rows) - n_conf})</option>
    <option value="todo">Only what is unmarked</option>
  </select>
  <button class="btn" id="resume">Go to the next unmarked clip</button>
  <button class="btn" id="copy">Copy results</button>
  <button class="btn" id="reset">Clear marks</button>
  <span id="copied"></span>
</div>
<textarea id="fallback" hidden rows="8" aria-label="Results to copy"></textarea>

<div class="grid">{"".join(items)}</div>
</div>
<script>
{script}
</script>
'''
open(OUT, "w").write(doc)
print("page", f"{os.path.getsize(OUT) / 1e6:.1f} MB")

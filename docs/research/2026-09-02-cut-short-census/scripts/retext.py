"""Rewrite each cause as a sentence with times you can scrub to.

Every number is mm:ss into the video the player shows, never raw seconds.
"""
import json, os, sys
sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/worker")
import points_v2 as V2

def ms(t):
    m = int(t) // 60
    return f"{m}:{t - 60 * m:05.2f}"

W = "/tmp/serve-diag/census"
causes = json.load(open("causes.json"))
rows = {(r["match"], r["point"]): r for r in json.load(open(f"{W}/verdicts_joined.json"))}
sj = {}
for c in causes:
    mid = rows[(c["match"], c["pt"])]["match_id"]
    if mid not in sj:
        sj[mid] = json.load(open(f"{W}/{mid}.serves.json"))
    c["mid"] = mid

# replayed above: does today's assembler still make this cut?
TODAY = {("Anton / untitled (26 Aug, 81 cards)", 13): "whole",
         ("Anton / untitled (26 Aug, 81 cards)", 18): "whole",
         ("Anton / untitled (26 Aug, 81 cards)", 61): "whole",
         ("Adil / Anton m4 (02 Sep, 69 cards)", 65): "same"}
FAMILY = {"cut back for a serve that was detected next": "serve",
          "squeezed to the shortest a rally may be": "serve",
          "the 20-second cap cut the rally in half": "cap",
          "the 2.6s tail, measured from the last bounce it counted": "tail",
          "your own split": "hand",
          "the rally chain broke on a gap between net crossings": "chain"}

for c in causes:
    mid = c["mid"]
    P = sorted(json.load(open(f"mj/{mid}.json"))["points"], key=lambda p: p["t0"])
    C = min(P, key=lambda p: abs(p["t0"] - rows[(c["match"], c["pt"])]["db"]["me"]["t0"]))
    i = P.index(C); N = P[i + 1] if i + 1 < len(P) else None
    cards = sorted(sj[mid]["cards"], key=lambda k: k["t0"])
    sc = min(cards, key=lambda k: abs(k["t0"] - C["t0"]))
    tb = [b["t"] for b in sc["bounces"] if b.get("onTable")]
    xs = sc.get("crossings") or []
    fam = FAMILY[c["cause"]]
    c["family"] = fam
    c["t0"], c["t1"] = C["t0"], C["t1"]
    today = TODAY.get((c["match"], c["pt"]))
    tail_now = f" Left alone it would have run to {ms(tb[-1] + V2.TAIL_AFTER_BOUNCE)}." if tb else ""
    if fam == "serve":
        if c["cause"].startswith("squeezed"):
            t = (f"Two serves were read only {N['serve_s'] - C['serve_s']:.1f} seconds apart, at "
                 f"{ms(C['serve_s'])} and {ms(N['serve_s'])}. A card may not be shorter than 1.5 seconds of "
                 f"rally, so this one was compressed to exactly that and ends at {ms(C['t1'])}, while the second "
                 f"of those serves is really a stroke in the middle of the same point.")
        else:
            t = (f"The detector read a serve at {ms(N['serve_s'])}. A serve's card has to open 1.6 seconds before "
                 f"the ball is struck, at {ms(N['t0'])}, and no two cards may touch, so this card was cut 1.2 "
                 f"seconds earlier still, at {ms(C['t1'])}.{tail_now} Nothing happened to the rally; only the card ended.")
        if today == "whole":
            t += (" The serve rule changed on 28 August, after this match was cut. Replayed with today's rules the "
                  "detector finds no serve there and the two cards stay one — which is also why the admin page "
                  "shows no serve on the next point: it recomputes rather than showing what was used on the day.")
        elif today == "same":
            t += " Today's rules read the same serve, so this one would still be cut here."
    elif fam == "cap":
        span_end = N["t1"] if N else C["t1"]
        cut = (C["t1"] + N["t0"]) / 2 if N else C["t1"]
        t = (f"This card and the next are one rally, {span_end - C['t0']:.1f} seconds long, running from "
             f"{ms(C['t0'])} to {ms(span_end)}. No single card may pass 20 seconds, so it was cut at its quietest "
             f"moment, {ms(cut)}, and handed over as two cards 1.2 seconds apart.")
    elif fam == "tail":
        counted = [t_ for t_ in tb if not xs or t_ <= xs[-1] + 2.0]
        late = [t_ for t_ in tb if xs and t_ > xs[-1] + 2.0]
        t = (f"A card ends 2.6 seconds after the last bounce on the table it counts. Here that was {ms(counted[-1])}, "
             f"giving {ms(C['t1'])}.")
        if late:
            t += (f" {len(late)} further bounce{'s' if len(late) > 1 else ''} at "
                  f"{', '.join(ms(x) for x in late)} were ignored, because only bounces within 2 seconds of the last "
                  f"net crossing ({ms(xs[-1])}) are counted — so the card ended on a ball that was still in play.")
        elif xs and xs[-1] > counted[-1]:
            t += (f" The ball crossed the net again at {ms(xs[-1])}, after that bounce, so the card in fact ran only "
                  f"{C['t1'] - xs[-1]:.1f} seconds past the last sign of the rally rather than 2.6.")
        else:
            seen = sc.get("seen") or []
            after = [(a, b) for a, b in zip([s[1] for s in seen], [s[0] for s in seen[1:]])
                     if a >= counted[-1] and b - a > 0.35]
            lost = f" the ball was lost for {max(b - a for a, b in after):.1f} seconds and" if after else ""
            t += (f" After that bounce{lost} nothing further was seen to bounce on the table or cross the net, so "
                  f"there was nothing to carry the ending on, and the 2.6 seconds ran out while the point was "
                  f"still being played.")
    elif fam == "hand":
        t = (f"You cut here yourself in the app. The row that follows begins at the same instant, {ms(C['t1'])}, "
             f"with no gap, which is the signature of a split made by hand rather than by the pipeline.")
    else:
        gap = [(a, b) for a, b in zip(xs, xs[1:]) if b - a > V2.CROSS_GAP_S]
        a, b = gap[0]
        after = [x for x in tb if x > (tb[-1] if not tb else 0) - 99 and x > a + 1.5]
        t = (f"The ball's crossings of the net were caught at {ms(a)} and then not again until {ms(b)}, a gap of "
             f"{b - a:.1f} seconds against the 3.0 a rally is allowed to pause. Everything after that gap was "
             f"dropped, so the ending was measured from a bounce at {ms([x for x in tb if x <= a + 2.0][-1])} and "
             f"the card closed at {ms(C['t1'])} — while the ball went on bouncing on the table at "
             f"{', '.join(ms(x) for x in tb[-3:])}.")
    c["detail_v2"] = t

json.dump(causes, open("causes.json", "w"), indent=1)
for c in sorted(causes, key=lambda c: (c["family"], c["match"])):
    print(f"\n[{c['family']}] {c['match']} point {c['pt']} — card ends {ms(c['t1'])}\n  {c['detail_v2']}")

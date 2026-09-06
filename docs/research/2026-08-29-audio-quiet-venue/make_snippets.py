"""Cut the audio the claims rest on, so they can be checked by ear.

Three sets:

  knocks   — single strikes, 0.4 s each, half of them scored above 0.9 by
             the ball-versus-room classifier and half below 0.1, shuffled
             and unlabelled in the page so the listener is not led;
  pairs    — three seconds of rally and three seconds of the pad beside
             it, from the same point, which is the comparison the
             pad-trimming measurement failed at;
  loose    — the seconds after a winner tap, where the free-bouncing ball
             can be heard decaying.
"""
import base64, json, os, subprocess, sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acoustics as AC, corpus as CO
from soundclass import fit_logistic, predict, FEATS

PEAKS = json.load(open("/Users/adil/ponglens-research-work/peaks_cache.json"))
OUT = "/Users/adil/ponglens-research-work/snippets"


def cut(wav, t0, dur, dest):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t0:.3f}",
                    "-t", f"{dur:.3f}", "-i", wav, "-ac", "1", "-ar", "44100",
                    "-c:a", "libmp3lame", "-b:a", "96k", dest], check=True)
    return base64.b64encode(open(dest, "rb").read()).decode()


def main():
    os.makedirs(OUT, exist_ok=True)
    rng = np.random.default_rng(11)
    out = {"knocks": [], "pairs": [], "loose": []}
    for slug in ("cebaa6d4", "77fc4dee", "d59d7610"):
        doc = CO.load(slug)
        wav = doc["wav"]
        rows = PEAKS[slug]["rows"]
        train = [r for s, d in PEAKS.items() if s != slug for r in d["rows"]
                 if r["label"] >= 0]
        m = fit_logistic([[r[k] for k in FEATS] for r in train],
                         [r["label"] for r in train])
        sc = predict(m, [[r[k] for k in FEATS] for r in rows])
        venue = doc["match"]["venue"]
        opp = doc["match"]["opponent_name"]

        hi = [i for i in range(len(rows)) if sc[i] > 0.90 and rows[i]["label"] == 1]
        lo = [i for i in range(len(rows)) if sc[i] < 0.10 and rows[i]["label"] == 0]
        for pool, truth in ((hi, "ball"), (lo, "room")):
            for i in rng.choice(pool, size=min(6, len(pool)), replace=False):
                r = rows[int(i)]
                dest = os.path.join(OUT, f"k_{slug}_{int(i)}.mp3")
                out["knocks"].append({
                    "slug": slug, "venue": venue, "opp": opp,
                    "t": r["t"], "truth": truth, "score": float(sc[int(i)]),
                    "z": r["z"], "b64": cut(wav, max(0, r["t"] - 0.12), 0.40, dest)})

        spans = sorted((float(b["start_source_s"]), float(b["end_source_s"]))
                       for b in doc["boundaries"] if not b.get("deleted")
                       and b.get("start_source_s") is not None)
        cards = sorted((float(p["t0"]), float(p["t1"])) for p in doc["points"]
                       if not p["deleted"] and p["t0"] is not None)
        picked = 0
        for (a, b) in spans:
            if picked >= 3:
                break
            card = next((c for c in cards if c[0] <= a and c[1] >= b), None)
            if card is None or b - a < 3.5 or a - card[0] < 2.0:
                continue
            out["pairs"].append({
                "slug": slug, "venue": venue, "opp": opp,
                "rally_t": a + 0.8, "pad_t": card[0],
                "rally": cut(wav, a + 0.8, 2.0, os.path.join(OUT, f"r_{slug}_{picked}.mp3")),
                "pad": cut(wav, card[0], 2.0, os.path.join(OUT, f"p_{slug}_{picked}.mp3"))})
            out["loose"].append({
                "slug": slug, "venue": venue, "opp": opp, "t": b,
                "b64": cut(wav, b - 0.5, 4.0, os.path.join(OUT, f"l_{slug}_{picked}.mp3"))})
            picked += 1
        print(f"{slug}: {picked} pairs", flush=True)
    json.dump(out, open("/Users/adil/ponglens-research-work/snippets.json", "w"))
    total = sum(len(x["b64"]) for x in out["knocks"]) + \
            sum(len(x["rally"]) + len(x["pad"]) for x in out["pairs"]) + \
            sum(len(x["b64"]) for x in out["loose"])
    print(f"{len(out['knocks'])} knocks, {len(out['pairs'])} rally/pad pairs, "
          f"{len(out['loose'])} loose-ball clips, {total/1e6:.1f} MB of base64")


if __name__ == "__main__":
    main()

"""Score the real-match test: pose against the rotation, by arm.

Three answers per card, all in near/far:

  TRUTH      the ITTF rotation over the owner's own scoring (computeServing)
  BALL       the shipped serve rule's own server_side for the motif it
             accepted — recovered from the evidence bundle, since
             production never persists it
  POSE       the service-motion analyzer on v2 person boxes

The split that matters is the arm. On ANCHORED cards the ball rule already
found the serve, so pose is redundant unless it is more accurate. On
UNANCHORED cards the ball rule found nothing, so anything pose gets right is
new coverage — and anything it gets wrong is a card anchored on a lie.
"""
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))


def tally(rows, key):
    dec = cor = 0
    for r in rows:
        s = r.get(key)
        if s:
            dec += 1
            cor += (s == r["truth"])
    n = len(rows)
    return n, dec, cor


def line(name, t):
    n, d, c = t
    return (f"  {name:14s} called {d:3d}/{n:3d} ({d/n*100 if n else 0:5.1f}%)   "
            f"right {c:3d}/{d:3d} ({c/d*100 if d else 0:5.1f}%)")


def main(path):
    res = json.load(open(path))
    calib = json.load(open(f"{HERE}/real_calib.json"))["89b35ee0-01f9-4c01-a966-6305b6e96d4a"]
    ball_sides = json.load(open(f"{HERE}/ball_sides.json"))
    rows = []
    for pid, r in res.items():
        if not r.get("truth") or not r.get("scored"):
            continue
        mp = calib["points"].get(str(r["idx"])) or {}
        ss = mp.get("serve_s")
        ball = ball_sides.get(str(round(float(ss), 2))) if ss is not None else None
        rows.append({"idx": r["idx"], "arm": r["arm"], "truth": r["truth"],
                     "pose": (r["best"] or {}).get("side"),
                     "conf": (r["best"] or {}).get("confidence"),
                     "ball": ball, "frames": r["posed_frames"],
                     "windows": r["windows_tried"]})
    anch = [r for r in rows if r["arm"] == "anchored"]
    unan = [r for r in rows if r["arm"] == "unanchored"]
    print(f"Yu Yu Lin, Westchester TTC — {len(rows)} scored cards "
          f"({len(anch)} anchored, {len(unan)} unanchored)")
    print(f"truth balance: {dict(Counter(r['truth'] for r in rows))}\n")
    print("ANCHORED — the ball rule already found the serve")
    print(line("ball rule", tally(anch, "ball")))
    print(line("pose (v2)", tally(anch, "pose")))
    print("\nUNANCHORED — the ball rule found no serve at all")
    print(line("ball rule", tally(unan, "ball")))
    print(line("pose (v2)", tally(unan, "pose")))
    print("\nPOOLED")
    print(line("ball rule", tally(rows, "ball")))
    print(line("pose (v2)", tally(rows, "pose")))

    # a coin flip on this corpus, for scale
    maj = Counter(r["truth"] for r in rows).most_common(1)[0]
    print(f"\nalways answering '{maj[0]}' would score {maj[1]}/{len(rows)} "
          f"= {maj[1]/len(rows)*100:.1f}%")

    print("\nUNANCHORED cards, one line each (the arm that decides this)")
    for r in sorted(unan, key=lambda x: x["idx"]):
        mark = "-" if not r["pose"] else ("RIGHT" if r["pose"] == r["truth"] else "WRONG")
        print(f"  idx {r['idx']:3d} truth={r['truth']:4s} pose={str(r['pose']):4s} "
              f"{mark:5s} conf={r['conf'] if r['conf'] is not None else 0:.2f} "
              f"({r['frames']} frames, {r['windows']} windows tried)")
    json.dump(rows, open(f"{HERE}/real_scored.json", "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1])

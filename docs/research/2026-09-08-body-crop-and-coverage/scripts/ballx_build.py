"""Net crossings for every match of the body corpus, computed ONE way: the lab's own
dwell-confirmed detector (points_v2.crossings) over the ball track the page's
overlay.json carries, in that overlay's crop pixels with its own corners. Written to
ballx_<m>.json. Where a crossings bundle exists its crossings are compared, so the
overlay-derived list is known to be the same signal before it becomes a feature."""
import sys, os, json, glob, numpy as np
sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/worker")
import points_v2 as V2
HERE = os.path.dirname(os.path.abspath(__file__))
S = "/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad"
MS = "89b35ee0 77fc4dee d15aad4d bfc9b31b 10322849 f3237587 2eab3e3d cebaa6d4 7e02fbb9 5fd822ec 95a07786 5c90151a 1c08539e".split()
for m in MS:
    ov = json.load(open(glob.glob(f"{S}/v3deploy/public/research/v3-serve-detector/{m}-*/overlay.json")[0]))
    fps = float(ov["fps"]); H = V2.homography_from_corners({k: tuple(v) for k, v in ov["corners"].items()})
    track = {}
    for row in ov["ball"]:
        t, x, y = row[0], row[1], row[2]
        track[int(round(t * fps))] = (float(x), float(y))
    cr = [float(t) for t in V2.crossings(track, H, fps)]
    note = ""
    bp = glob.glob(f"{S}/servemiss/bundles/crossings/{m}-*.json")
    if bp:
        bc = sorted(json.load(open(bp[0]))["crossings"])
        a = np.array(cr); b = np.array(bc)
        match = sum(1 for t in b if len(a) and np.min(np.abs(a - t)) <= 0.15) if len(b) else 0
        note = f"bundle {len(bc)} crossings, {match} of them within 0.15 s of an overlay-derived one; overlay-derived {len(cr)}"
    # on-table bounces with v (metres along the table; the net is at L/2): a rally
    # alternates halves, pre-serve knocking stays on one half
    bon = [[float(b[0]), float(b[5])] for b in ov["bounces"] if b[3] == 1 and b[5] is not None]
    tmp = f"{HERE}/ballx_{m}.json.tmp"
    json.dump({"match": m, "fps": fps, "source": "overlay ball track -> points_v2.crossings; overlay on-table bounces",
               "crossings": cr, "bounces_on": sorted(bon)}, open(tmp, "w"))
    os.replace(tmp, f"{HERE}/ballx_{m}.json")
    print(f"{m}: {len(cr)} crossings over {ov['ball'][-1][0]:.0f} s   {note}")

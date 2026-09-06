"""Data for the side-by-side page: what each run saw, on the same clips.

One claim is being shown, and only one: BEFORE a serve, the uncropped run
sees no ball over the table, and the cropped run does. Everything on the
page exists to let that be checked or refuted by eye.

Both tracks are converted into the clip's own seconds and pixels, so they
can be drawn over the same video.
"""
import json
import os
import shutil
import sys

WORKER = "/Users/adil/Desktop/Projects/PongLens/worker"
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, WORKER)
sys.path.insert(0, os.path.join(HERE, "../servemiss/scripts"))
import points_v2 as V2                                            # noqa: E402
from points_v2 import build_track, homography_from_corners, load_multi, project
from reload import load as load_bundle                            # noqa: E402

M = "89b35ee0-01f9-4c01-a966-6305b6e96d4a"
PAD = 0.20


def track_points(track, H, fps, src_w, clip_w, clip_h, src_h):
    """[(t, x, y, over_table)] in SOURCE seconds and CLIP pixels."""
    kx, ky = clip_w / src_w, clip_h / src_h
    out = []
    for f in sorted(track):
        x, y = track[f]
        p = project(H, x, y)
        over = bool(p and -PAD <= p[0] <= V2.W_M + PAD
                    and -PAD <= p[1] <= V2.L_M + PAD)
        out.append((f / fps, x * kx, y * ky, over))
    return out


def main(outdir):
    outdir = os.path.abspath(outdir)
    os.makedirs(f"{outdir}/clips", exist_ok=True)
    calib = json.load(open(f"{HERE}/real_calib.json"))[M]
    pts = calib["points"]
    truth = json.load(open(f"{HERE}/phase1_truth.json"))
    old_cards = json.load(open(f"{HERE}/emerge_cards_{M[:8]}.json"))
    src = calib["source"]
    H = homography_from_corners({k: tuple(v) for k, v in calib["corners"].items()})

    b, E = load_bundle(f"{HERE}/../servemiss/bundles/crossings/{M}.json")
    new_track = build_track(load_multi(f"{HERE}/crop/{M[:8]}_shifted.jsonl"), 1.0)

    boxes = json.load(open(f"{HERE}/real_boxes_{M[:8]}.json"))
    dims = next(iter(boxes.values()))
    CW, CH = dims["w"], dims["h"]

    old_pts = track_points(E.track, E.H, E.fps, src["width"], CW, CH, src["height"])
    new_pts = track_points(new_track, H, 30.0, src["width"], CW, CH, src["height"])

    serve_by_idx = {r["idx"]: r.get("serve_local")
                    for r in truth["hit"] if r.get("serve_local") is not None}
    miss = {r["idx"] for r in truth["miss"]}

    quad = [[calib["corners"][k][0] / src["width"],
             calib["corners"][k][1] / src["height"]]
            for k in sorted(calib["corners"])]

    data = {}
    for c in boxes.values():
        idx = c["idx"]
        p = pts.get(str(idx)) or {}
        if not p:
            continue
        t0, t1 = float(p["t0"]), float(p["t1"])
        ct0 = float(p.get("clip_t0") or t0)
        srcf = os.path.join(HERE, "real", "clips", M[:8], f"{idx}.mp4")
        dst = f"{outdir}/clips/{idx}.mp4"
        if os.path.exists(srcf) and not os.path.exists(dst):
            shutil.copy2(srcf, dst)
        if not os.path.exists(dst):
            continue

        def cut(pointlist):
            return [[round(t - ct0, 3), round(x / CW, 5), round(y / CH, 5),
                     1 if over else 0]
                    for t, x, y, over in pointlist
                    if -0.4 <= t - ct0 <= (t1 - ct0) + 0.4]

        data[idx] = {
            "clip": f"clips/{idx}.mp4",
            "len": round(t1 - ct0, 2),
            "old": cut(old_pts), "new": cut(new_pts),
            "serve": serve_by_idx.get(idx),
            "was_missed": idx in miss,
            "old_flash": (old_cards.get(str(idx)) or {}).get("emerge_local") or [],
            "has_prod_serve": (old_cards.get(str(idx)) or {}).get("has_serve"),
            "quad": quad,
        }
    open(f"{outdir}/data.js", "w").write("window.CMP=" + json.dumps(data) + ";")
    print(f"{len(data)} cards -> {outdir}/data.js")
    n = sum(1 for d in data.values() if d["serve"] is not None)
    print(f"  {n} carry a serve time you confirmed")


if __name__ == "__main__":
    main(sys.argv[1])

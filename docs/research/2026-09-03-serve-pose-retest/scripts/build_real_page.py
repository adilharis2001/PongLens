"""Review page for the real-match test.

One card per scored point, grouped by arm, because the arms answer
different questions and should not be scrolled together by accident.
Each card draws the table quad, every person the detector found with the
verdict it gave them, the pose skeleton that came back, the ball, and what
each of the three answers was — the rotation's truth, the ball rule's own
server call, and pose's.
"""
import json
import os
import shutil
import sys
from pathlib import Path

HERE = Path(os.path.dirname(os.path.abspath(__file__)))


def nb(b, w, h):
    return [round(b[0] / w, 5), round(b[1] / h, 5),
            round(b[2] / w, 5), round(b[3] / h, 5)]


def main(match, outdir):
    outdir = Path(outdir); (outdir / "clips").mkdir(parents=True, exist_ok=True)
    boxes = json.load(open(HERE / f"real_boxes_{match[:8]}.json"))
    poses = json.load(open(HERE / f"real_poses_{match[:8]}.json"))
    calib = json.load(open(HERE / "real_calib.json"))[match]
    ball_sides = json.load(open(HERE / "ball_sides.json"))
    bundle_path = HERE / f"../servemiss/bundles/crossings/{match}.json"
    bundle = json.load(open(bundle_path)) if bundle_path.exists() else None
    src_w = calib["source"]["width"]

    data = {}
    for pid, c in boxes.items():
        pr = poses.get(pid) or {}
        if not c.get("scored"):
            continue
        w, h = c["w"], c["h"]
        src = Path(c["clip"])
        dst = outdir / "clips" / f"{c['idx']}.mp4"
        if src.exists() and not dst.exists():
            shutil.copy2(src, dst)
        corners = c["corners"]
        order = sorted(corners)          # A, B, C, D
        quad = [[round(corners[k][0] / w, 5), round(corners[k][1] / h, 5)]
                for k in order]
        frames = {}
        for f, fr in c["frames"].items():
            frames[f] = {
                "t": fr["t"],
                "people": [{"b": nb(p["box"], w, h), "v": p["verdict"]}
                           for p in fr["people"]],
                "near": nb(fr["near"], w, h) if fr.get("near") else None,
                "far": nb(fr["far"], w, h) if fr.get("far") else None,
            }
        kp = {}
        for f, sides in (pr.get("keypoints") or {}).items():
            kp[f] = {sd: [[round(x / w, 5), round(y / h, 5), s]
                          for x, y, s in (pts or [])]
                     for sd, pts in sides.items() if pts}
        mp = calib["points"].get(str(c["idx"])) or {}
        ct0 = mp.get("clip_t0") or 0.0
        ball = []
        if bundle:
            k = w / float(src_w)
            for t, x, y in bundle["track"]:
                lt = float(t) - float(ct0)
                if -0.5 <= lt <= 8.0:
                    ball.append([round(lt, 3), round(x * k / w, 5), round(y * k / h, 5)])
        ss = mp.get("serve_s")
        best = pr.get("best") or {}
        data[pid] = {
            "clip": f"clips/{c['idx']}.mp4", "idx": c["idx"], "fps": c["fps"],
            "arm": c["arm"], "truth": c["truth"], "quad": quad,
            "frames": frames, "kp": kp, "ball": ball,
            "labels": {"contact": None if ss is None else round(float(ss) - float(ct0), 3),
                       "b1": c.get("fb_local")},
            "ball_side": ball_sides.get(str(round(float(ss), 2))) if ss is not None else None,
            "pose": {"side": best.get("side"), "conf": best.get("confidence"),
                     "reason": best.get("reason"), "fb": best.get("fb")},
            "windows": pr.get("windows_tried"),
        }
    (outdir / "data.js").write_text("window.REAL = " + json.dumps(data) + ";")
    print(f"{len(data)} cards -> {outdir}/data.js")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

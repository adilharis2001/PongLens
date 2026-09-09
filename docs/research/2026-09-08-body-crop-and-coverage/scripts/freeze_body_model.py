"""Freeze the body model from the lab's thirteen matches into the worker.

    <worker venv python> freeze_body_model.py <worker dir> <lab dir> <poses tag> <out version>

    e.g. freeze_body_model.py scratchpad/bodyworker/worker scratchpad/poseretest w15 v1

Reads, per match: pose_<m>_<tag>.json (skeletons on the production window),
real_calib.json (table corners, source px), ballx_<m>.json (net crossings and
on-table bounces), the V3 overlay's serve stamps, and the scorekeeper's
labels from /tmp/v3exp/VFINAL2/<m>/compare.json (bodyfirst.labels). Trains
the play model and the two boundary models on ALL matches with the shipped
settings, writes worker/body_model/<version>/, then runs body_points.assemble
on every match and writes fixture.json, and copies the inputs the parity
test needs to ~/ponglens-models/body-poses/<m>/.
"""
import glob
import json
import os
import sys
from types import SimpleNamespace

import numpy as np

worker, lab, tag, version = sys.argv[1:5]
sys.path.insert(0, worker)
sys.path.insert(0, lab)
import body_features as BF          # noqa: E402
import body_points as BP            # noqa: E402
import bodyfirst                    # noqa: E402  (labels only)

S = os.path.dirname(os.path.abspath(lab))
MS = "89b35ee0 77fc4dee d15aad4d bfc9b31b 10322849 f3237587 2eab3e3d cebaa6d4 7e02fbb9 5fd822ec 95a07786 5c90151a 1c08539e".split()
CAL = json.load(open(f"{lab}/real_calib.json"))
OUT = os.path.join(worker, "body_model", version)
STORE = os.path.expanduser("~/ponglens-models/body-poses")


def corners(m):
    full = next(k for k in CAL if k.startswith(m))
    return CAL[full]["corners"]


def overlay(m):
    p = glob.glob(f"{S}/bodyfix/public/research/v3-serve-detector/{m}*/overlay.json")[0]
    return json.load(open(p))


data = {}
inputs = {}
for m in MS:
    pf = f"{lab}/pose_{m}_{tag}.json"
    if not os.path.exists(pf):
        pf = f"{lab}/pose_{m}.json"
        print(f"{m}: no {tag} poses, using pose_{m}.json")
    players = json.load(open(pf))
    T, raw = BF.load_players(players)
    bx = json.load(open(f"{lab}/ballx_{m}.json"))
    cross = sorted(bx["crossings"])
    bt_table = sorted(b[0] for b in bx.get("bounces_on") or [])
    ov = overlay(m)
    serves = sorted(s[1] for s in ov["serves"])
    X, names, _ = BF.features(T, raw, corners(m), crossings=cross, families=BP.FAMILIES)
    y, pts = bodyfirst.labels(T, m, "VFINAL2")
    data[m] = (T, X, y, pts, names)
    # what the first ball card would be in production: the earliest V3 card
    rows = json.load(open(glob.glob(f"{S}/bodyfix/public/research/v3-serve-detector/{m}*/compare.json")[0]))["rows"]
    first = min((c["t0"] for r in rows for c in r["mine"]), default=None)
    inputs[m] = dict(players=players, ball=dict(crossings=cross, bt_table=bt_table, serves=serves,
                                                corners=corners(m), duration=float(T[-1]) + 1.0,
                                                first_ball_t0=first))
    print(f"{m}: {len(T)} samples, {X.shape[1]} features, {int((y == 1).sum())} play / {int((y == 0).sum())} dead labels")

model = BP.train(data, OUT)
print(f"frozen {version}: {len(model['names'])} features, sha {model['sha']}, trained on {len(data)} matches -> {OUT}")

fixture = {"version": version, "features_sha": model["sha"], "matches": {}}
for m in MS:
    inp = inputs[m]
    ev = SimpleNamespace(cross=np.asarray(inp["ball"]["crossings"], float),
                         bt_table=np.asarray(inp["ball"]["bt_table"], float),
                         serves=inp["ball"]["serves"])
    cards, info = BP.assemble(inp["players"], inp["ball"]["corners"], ev, inp["ball"]["duration"],
                              first_ball_t0=inp["ball"]["first_ball_t0"], model=model)
    fixture["matches"][m] = {"cards": [dict(t0=round(c["t0"], 3), t1=round(c["t1"], 3),
                                            serve_s=c.get("serve_s"), why=c.get("why")) for c in cards],
                             "info": info}
    d = os.path.join(STORE, m); os.makedirs(d, exist_ok=True)
    json.dump(inp["players"], open(os.path.join(d, "players.json"), "w"))
    json.dump(inp["ball"], open(os.path.join(d, "ball.json"), "w"))
    print(f"{m}: {len(cards)} cards, {info['stamped']} stamped, both players {info['both_share']:.0%}")
json.dump(fixture, open(os.path.join(OUT, "fixture.json"), "w"), indent=0)
print("fixture written; inputs stored under", STORE)

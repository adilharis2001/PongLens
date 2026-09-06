"""Where the audio and the ruler meet: one clock, one list of events."""
import json, os

import numpy as np

WORK = "/Users/adil/ponglens-research-work"
RULER = os.path.join(WORK, "ruler")
AUDIO_DIRS = [os.path.join(WORK, d) for d in
              ("audio-study", "audio-recent", "audio-quiet", "audio-endon")]
# The pre-keypoint study named its folders after the opponent.
BY_SLUG = {"77fc4dee": "lester", "cebaa6d4": "rowel", "9e15ed10": "prabhas",
           "d59d7610": "ishan", "a52a6612": "ali", "ec6490f4": "chris",
           "7e02fbb9": "julian"}
TABLE_L = 2.74
NET_V = TABLE_L / 2


def audio_path(slug):
    for d in AUDIO_DIRS:
        for name in (slug, BY_SLUG.get(slug, "")):
            if not name:
                continue
            p = os.path.join(d, name, "audio.wav")
            if os.path.exists(p):
                info = os.path.join(d, name, "info.json")
                clock = json.load(open(info))["clock"] if os.path.exists(info) else "source"
                return p, clock
    return None, None


def load(slug):
    """Ruler + audio path + the clock the audio is on."""
    path = os.path.join(RULER, f"{slug}.json")
    if not os.path.exists(path):
        return None
    doc = json.load(open(path))
    wav, clock = audio_path(slug)
    doc["wav"], doc["clock"] = wav, clock
    doc["slug"] = slug
    return doc


def to_audio_clock(doc):
    """event time -> seconds into the wav, for whichever clock it holds.

    Inverting the point_boundaries view: a card begins at `t0 - pre` in
    source seconds and at `cut_t0` in cut seconds, so

        cut = source - t0 + pre + cut_t0

    Leaving the pre-pad out shifts everything by 1.2 s, which at three
    events a second is enough to make agreement with vision land exactly
    on chance — which is what it did.
    """
    if doc["clock"] != "cut":
        return lambda ev: ev["t"]
    pre = float(doc["match"].get("pre_pad") or 1.2)
    by_point = {p["id"]: p for p in doc["points"]}
    def convert(ev):
        p = by_point.get(ev["point_id"])
        if not p or p["cut_t0"] is None or p["t0"] is None:
            return None
        return float(p["cut_t0"]) + pre + (float(ev["t"]) - float(p["t0"]))
    return convert


def all_slugs():
    return sorted(f[:-5] for f in os.listdir(RULER) if f.endswith(".json"))


def bounces(doc, min_vis=0.0, need_uv=True):
    out = []
    conv = to_audio_clock(doc)
    for ev in doc["events"]:
        if ev["kind"] != "bounce":
            continue
        if need_uv and (ev["u"] is None or ev["v"] is None):
            continue
        if (ev["vis"] or 0) < min_vis:
            continue
        t = conv(ev)
        if t is None:
            continue
        out.append(dict(ev, ta=t))
    return out

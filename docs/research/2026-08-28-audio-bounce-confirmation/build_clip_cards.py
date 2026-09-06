"""Line the sound up against the picture, one clip at a time.

  ./venv/bin/python build_clip_cards.py <out.json>

The serve-review page at localhost:8899 already holds 175 cards where the
pipeline found no serve, and each one carries everything needed to check
the audio claim against the video: the clip on disk, the ball track, the
detected bounces, the table quad, and — the part that makes it work — the
clip's start time in source seconds, so the match audio can be lined up
with the picture to the millisecond.

For each card this computes:

  * the onset-strength curve across the whole clip, in both bands, from the
    match's own audio;
  * every peak the detector picks, with its z-score;
  * every event the PRODUCTION extractor finds in that clip's ball track —
    table bounces and paddle contacts, each marked with whether it projects
    onto the real table or somewhere off it.

That last one is `extract_candidates` from placement_reconstruction,
imported and run on the card's own track, so the marks on the page are the
events the shipped code sees and not a second opinion about them.
"""
import json
import os
import sys

import numpy as np

REPO = "/Users/adil/Desktop/Projects/PongLens"
sys.path.insert(0, os.path.join(REPO, "worker"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import audio_impacts as AUDIO
from placement_backfill import calibration_matrix
from placement_reconstruction import extract_candidates
from points_pipeline import _canonical_calibration_geometry

REVIEW = "/Users/adil/Desktop/ponglens-serve-review"
# Where each match's audio lives. Seven came from the recent-uploads pull,
# two are study-corpus matches already on disk under their own names.
AUDIO_DIRS = {
    "25765e26": "audio-recent/25765e26", "47b83b9b": "audio-recent/47b83b9b",
    "74542390": "audio-recent/74542390", "77fc4dee": "audio-recent/77fc4dee",
    "840b4635": "audio-recent/840b4635", "9ef09000": "audio-recent/9ef09000",
    "bfc9b31b": "audio-recent/bfc9b31b",
    "7e02fbb9": "audio-study/julian", "ec6490f4": "audio-study/chris",
}
ROOT = "/Users/adil/ponglens-research-work"
CURVE_POINTS = 700          # one per screen pixel is plenty


def load_cards():
    page = open(os.path.join(REVIEW, "unanchored.html")).read()
    start = page.index("const C =")
    end = page.index(";", start)
    return json.loads(page[start + len("const C ="):end])


def events_for(card):
    """The production extractor's own view of this clip's ball track."""
    fps = float(card["fps"])
    detections = {}
    for t, x, y in card["track"]:
        detections[int(round(float(t) * fps))] = (float(x), float(y))
    if len(detections) < 8:
        return []
    corners = {k: tuple(v) for k, v in card["quad"].items()}
    try:
        _src, H, axis, _reordered = _canonical_calibration_geometry(corners)
    except Exception:
        H = calibration_matrix({"table_corners_px": card["quad"]})
        axis = (1.0, 0.0)
    frames = sorted(detections)
    try:
        cands = extract_candidates(detections, np.asarray(H).tolist(),
                                   tuple(float(v) for v in axis),
                                   frames[0], frames[-1] + 1, fps,
                                   int(card["w"]), [])
    except Exception as exc:
        print(f"    extract failed: {exc}")
        return []
    out = []
    for c in cands:
        if c["kind"] not in ("bounce", "contact"):
            continue
        out.append({
            "t": round(float(c["t"]), 3),
            "kind": c["kind"],
            "on": c.get("u") is not None and c.get("v") is not None,
            "u": c.get("u"), "v": c.get("v"),
            "conf": c.get("visual_confidence"),
        })
    return out


def main():
    out_path = sys.argv[1]
    cards = load_cards()
    print(f"{len(cards)} cards")
    cache = {}
    built = []
    for i, card in enumerate(cards):
        match = card["match"]
        rel = AUDIO_DIRS.get(match)
        if rel is None:
            print(f"  {i:3d} {match}: no audio, skipped")
            continue
        if match not in cache:
            wav = os.path.join(ROOT, rel, "audio.wav")
            print(f"  loading audio for {match}…", flush=True)
            samples, rate = AUDIO.read_wav(wav)
            magnitude, freqs = AUDIO.spectrogram(samples, rate)
            hi = AUDIO.local_z(AUDIO.flux(magnitude, freqs, AUDIO.HIGH_BAND), rate)
            lo = AUDIO.local_z(AUDIO.flux(magnitude, freqs, AUDIO.BALL_BAND), rate)
            times = np.arange(len(hi)) * AUDIO.HOP / rate + AUDIO.WINDOW / 2 / rate
            cache[match] = {
                "rate": rate, "hi": hi, "lo": lo, "times": times,
                "peaks_hi": [(AUDIO.frame_time(k, rate), float(hi[k]))
                             for k in AUDIO.pick_peaks(hi, rate, 6.0)],
                "peaks_lo": [(AUDIO.frame_time(k, rate), float(lo[k]))
                             for k in AUDIO.pick_peaks(lo, rate, 3.0)],
            }
        audio = cache[match]
        a, b = float(card["a"]), float(card["b"])
        mask = (audio["times"] >= a) & (audio["times"] <= b)
        if mask.sum() < 10:
            print(f"  {i:3d} {match}: clip outside the audio, skipped")
            continue
        # The curve is stored as small integers on a fixed scale, so the
        # page can draw it without carrying a megabyte of floats per clip.
        # 0..100 maps z = 0..20; anything louder is simply full height.
        def compress(series):
            values = series[mask]
            step = max(1, len(values) // CURVE_POINTS)
            values = values[::step]
            return [int(min(100, max(0, v / 20.0 * 100))) for v in values]

        span = b - a
        built.append({
            "i": i + 1,
            "clip": card["clip"],
            "match": match,
            "who": card["who"],
            "label": card["label"],
            "reason": card["reason"],
            "idx": card["idx"],
            "a": round(a, 3), "b": round(b, 3), "span": round(span, 3),
            "card": [round(card["card_t0"] - a, 3),
                     round(card["card_t1"] - a, 3)],
            "w": card["w"], "h": card["h"], "fps": card["fps"],
            "hi": compress(audio["hi"]),
            "lo": compress(audio["lo"]),
            "phi": [[round(t - a, 3), round(c, 1)]
                    for t, c in audio["peaks_hi"] if a <= t <= b],
            "plo": [[round(t - a, 3), round(c, 1)]
                    for t, c in audio["peaks_lo"] if a <= t <= b],
            "ev": events_for(card),
            "bounces": [round(float(t), 3) for t in (card.get("bounces") or [])],
        })
        if (i + 1) % 25 == 0:
            print(f"  {i + 1} done", flush=True)
    json.dump(built, open(out_path, "w"), separators=(",", ":"))
    total_ev = sum(len(c["ev"]) for c in built)
    print(f"\n{len(built)} cards written to {out_path} "
          f"({os.path.getsize(out_path) / 1e6:.1f} MB)")
    print(f"{sum(len(c['phi']) for c in built)} audio peaks (10 kHz+), "
          f"{sum(len(c['plo']) for c in built)} (1.5-8 kHz), "
          f"{total_ev} visual events "
          f"({sum(1 for c in built for e in c['ev'] if not e['on'])} of them "
          f"projecting off the table)")


if __name__ == "__main__":
    main()

"""Adil's two guesses about the sound, measured rather than assumed.

  ./venv/bin/python intuitions.py <corpus-dir> <work-dir> [slug ...]

A. "In a large hall the loudest ball strike should still be the table
   nearest the camera." If that holds, impacts landing on OUR table's
   bounces should be louder than the impacts that land on nothing — the
   other tables, the room, the chatter.

B. "Players often stomp on the serve, which may be a separate and coarser
   cue." Tested in its own band: 40-250 Hz, where a foot on a sports floor
   lives and a celluloid ball does not. The reference is the serve's own
   first bounce, taken from production's stored placement, and the answer
   only means something beside the shifted control on the row below it —
   with peaks this dense, a wide window catches something by chance.

Neither result changes the main measurement. They say what the sound is
made of, which is what tells you where to look next if it fails.
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audio_impacts as AUDIO
from align import deltas, stored_events

SERVE_WINDOWS = [0.25, 0.5, 1.0]


def serve_first_bounces(corpus, slug):
    """Every serve's own first bounce, from both hypotheses.

    Both read the same candidate list, so a serve the two ends agree on
    contributes one time; where they disagree, both are kept. This is a
    reference for "a serve happened near here", not for whose it was.
    """
    rows = json.load(open(os.path.join(corpus, f"{slug}.json")))
    times = set()
    for point in rows["points"]:
        if point["deleted"]:
            continue
        placement = point.get("placement") or {}
        for hypothesis in (placement.get("hypotheses") or {}).values():
            for shot in hypothesis.get("shots") or []:
                if shot.get("phase") != "serve":
                    continue
                first = shot.get("serve_first_bounce")
                if first and first.get("t") is not None:
                    times.add(round(float(first["t"]), 3))
    return np.array(sorted(times))


def main():
    corpus, work = sys.argv[1], sys.argv[2]
    slugs = sys.argv[3:] or [m["slug"] for m in
                             json.load(open(os.path.join(corpus, "manifest.json")))]
    for slug in slugs:
        wav = os.path.join(work, slug, "audio.wav")
        if not os.path.exists(wav):
            print(f"{slug}: no audio yet")
            continue
        print(f"\n=== {slug} ===")

        # A. loudness of matched vs unmatched impacts
        impacts = AUDIO.detect(wav)
        times = np.array([i["t"] for i in impacts])
        conf = np.array([i["confidence"] for i in impacts])
        events = np.concatenate([stored_events(corpus, slug, "bounce"),
                                 stored_events(corpus, slug, "contact")])
        matched = np.zeros(len(impacts), dtype=bool)
        if len(events):
            index = np.searchsorted(times, np.sort(events))
            for shift in (-1, 0):
                probe = np.clip(index + shift, 0, len(times) - 1)
                close = np.abs(times[probe] - np.sort(events)) <= 0.05
                matched[probe[close]] = True
        print(f"  A. {matched.sum()} of {len(impacts)} impacts sit on one of "
              f"this table's own events")
        for name, sel in (("on our table", matched), ("everything else", ~matched)):
            if sel.sum():
                q = np.percentile(conf[sel], [50, 75, 90])
                print(f"     {name:16s} n={sel.sum():5d}  median z {q[0]:5.1f}"
                      f"   p75 {q[1]:5.1f}   p90 {q[2]:5.1f}")

        # B. stomps, in their own band
        serves = serve_first_bounces(corpus, slug)
        low = AUDIO.detect(wav, threshold=3.0, band=AUDIO.STOMP_BAND)
        print(f"  B. {len(low)} low-band ({AUDIO.STOMP_BAND[0]:.0f}-"
              f"{AUDIO.STOMP_BAND[1]:.0f} Hz) peaks, {len(serves)} serve "
              f"first bounces")
        if len(serves) and len(low):
            d = deltas(serves, low)
            control = deltas(serves, [{"t": i["t"] + 7.31} for i in low])
            row, null = "     near a serve:", "     by chance:  "
            for window in SERVE_WINDOWS:
                row += f"  {window:.2f}s {np.mean(np.abs(d) <= window) * 100:4.0f}%"
                null += f"  {window:.2f}s {np.mean(np.abs(control) <= window) * 100:4.0f}%"
            print(row); print(null)
            print(f"     median gap {np.median(d[np.abs(d) <= 1.0]) * 1000:+.0f} ms")


if __name__ == "__main__":
    main()

"""Does the detector hear the bounces vision already found, and when?

  ./venv/bin/python align.py <corpus-dir> <work-dir> [slug ...]

Before audio can rescue a bounce vision missed, it has to agree with vision
about the bounces they both saw. The reference is production's own stored
candidate list — every `kind: bounce` in points.placement was found by the
visual test alone, because audio_impacts has always been empty — so this
compares the detector against events nobody tuned it on.

Three things come out, and all three are needed before the tolerance in
extract_candidates (0.09s, never once exercised against a real impact) can
be called right or wrong:

  * the OFFSET, the median signed gap. A clock error shows up here as a
    constant, and would otherwise be read as the detector being poor;
  * the SPREAD around it, which is what a matching tolerance has to cover;
  * the HIT RATE at a range of tolerances.

The contact candidates are reported separately. A bat strike and a table
bounce are different sounds, and lumping them hides which one is being
matched.
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audio_impacts as AUDIO

TOLERANCES = [0.02, 0.03, 0.05, 0.07, 0.09, 0.12, 0.15, 0.20]


def stored_events(corpus, slug, kind):
    rows = json.load(open(os.path.join(corpus, f"{slug}.json")))
    out = []
    for point in rows["points"]:
        if point["deleted"]:
            continue
        placement = point.get("placement") or {}
        for candidate in placement.get("candidates") or []:
            if candidate.get("kind") == kind:
                out.append(float(candidate["t"]))
    return np.array(sorted(out))


def deltas(events, impacts):
    """Signed gap from each visual event to its nearest impact."""
    if len(events) == 0 or len(impacts) == 0:
        return np.array([])
    times = np.array([i["t"] for i in impacts])
    index = np.searchsorted(times, events)
    best = np.full(len(events), np.inf)
    for shift in (-1, 0):
        probe = np.clip(index + shift, 0, len(times) - 1)
        gap = times[probe] - events
        take = np.abs(gap) < np.abs(best)
        best[take] = gap[take]
    return best


def report(name, events, impacts, shift=7.31):
    """`shift` slides every impact along the clock to give the null its own
    row. With 2-3 impacts a second, a +/-90 ms window catches something by
    chance more than a third of the time, and a hit rate quoted without
    that number reads as accuracy when much of it is arithmetic."""
    d = deltas(events, impacts)
    control = deltas(events, [{"t": i["t"] + shift} for i in impacts])
    if len(d) == 0:
        print(f"  {name}: nothing to compare")
        return None
    near = d[np.abs(d) <= 0.25]
    offset = float(np.median(near)) if len(near) else float("nan")
    spread = float(np.median(np.abs(near - offset))) if len(near) else float("nan")
    print(f"  {name}: {len(events)} events, offset {offset * 1000:+.0f} ms, "
          f"MAD {spread * 1000:.0f} ms")
    row = "    hit rate:"
    for tol in TOLERANCES:
        row += f"  {tol * 1000:.0f}ms {np.mean(np.abs(d) <= tol) * 100:4.0f}%"
    print(row)
    row = "    centred: "
    for tol in TOLERANCES:
        row += f"  {tol * 1000:.0f}ms {np.mean(np.abs(d - offset) <= tol) * 100:4.0f}%"
    print(row)
    row = "    by chance:"
    for tol in TOLERANCES:
        row += f"  {tol * 1000:.0f}ms {np.mean(np.abs(control) <= tol) * 100:4.0f}%"
    print(row)
    return offset


def main():
    corpus, work = sys.argv[1], sys.argv[2]
    slugs = sys.argv[3:] or [m["slug"] for m in
                             json.load(open(os.path.join(corpus, "manifest.json")))]
    for slug in slugs:
        wav = os.path.join(work, slug, "audio.wav")
        if not os.path.exists(wav):
            print(f"{slug}: no audio yet")
            continue
        impacts = AUDIO.detect(wav)
        print(f"\n=== {slug} — {len(impacts)} impacts ===")
        report("table bounces", stored_events(corpus, slug, "bounce"), impacts)
        report("bat contacts ", stored_events(corpus, slug, "contact"), impacts)


if __name__ == "__main__":
    main()

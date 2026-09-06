"""The detector against Adil's own serve and winner taps.

  ./venv/bin/python boundary_ruler.py <work-dir> [slug=match-id ...]

`public.point_boundaries` holds, for 373 points across 12 matches, the
moment Adil tapped the serve and the moment he tapped the winner, both
clocks pre-converted. CLAUDE.md is emphatic that these taps are only 90%
accurate to 0.71 s and cannot resolve fine timing, so nothing here uses
them as a stopwatch.

What they do give exactly is a window in which the ball is definitely in
play, and a longer stretch between points in which it is definitely not. A
bounce detector should be loud inside and quiet outside, and the ratio of
the two is a precision measure needing no frame-accurate truth. It is also
the only measure in this study independent of the ball track, the table
quad and the placement rules alike.
"""
import os
import subprocess
import sys

import numpy as np
import psycopg2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audio_impacts as AUDIO

BANDS = {"1.5-8 kHz": (AUDIO.BALL_BAND, 3.0), "10 kHz+": (AUDIO.HIGH_BAND, 6.0)}


def keychain(service):
    return subprocess.check_output(
        ["security", "find-generic-password", "-a", "openclaw",
         "-s", service, "-w"]).decode().strip()


def boundaries(match_id):
    conn = psycopg2.connect(os.environ.get("DATABASE_URL")
                            or keychain("ponglens-db-url"))
    conn.set_session(readonly=True)
    with conn.cursor() as cur:
        cur.execute("""select start_source_s, end_source_s
                       from public.point_boundaries
                       where match_id = %s and not deleted and usable
                         and start_source_s is not null
                         and end_source_s is not null
                       order by start_source_s""", (match_id,))
        return [(float(a), float(b)) for a, b in cur.fetchall()]


def main():
    work = sys.argv[1]
    pairs = [arg.split("=") for arg in sys.argv[2:]]
    print("Impacts per second while the ball is in play, against the gaps")
    print("between points. Both windows come from Adil's own taps.\n")
    header = f"{'match':9s} {'points':>7s} {'play s':>8s} {'gap s':>8s}"
    for name in BANDS:
        header += f" | {name + ' play':>16s}{'gap':>7s}{'ratio':>7s}"
    print(header)
    for slug, match_id in pairs:
        wav = os.path.join(work, slug, "audio.wav")
        if not os.path.exists(wav):
            print(f"{slug:9s} no audio")
            continue
        windows = boundaries(match_id)
        if not windows:
            print(f"{slug:9s} no boundaries")
            continue
        samples, rate = AUDIO.read_wav(wav)
        magnitude, freqs = AUDIO.spectrogram(samples, rate)
        duration = len(samples) / rate
        in_play = sum(b - a for a, b in windows)
        # A second of guard either side, so a tap landing late cannot put a
        # rally stroke into the "nothing is happening" bucket.
        guard = [(a - 1.0, b + 1.0) for a, b in windows]
        gap = duration - sum(b - a for a, b in guard)
        row = f"{slug:9s} {len(windows):7d} {in_play:8.0f} {gap:8.0f}"
        for name, (band, threshold) in BANDS.items():
            z = AUDIO.local_z(AUDIO.flux(magnitude, freqs, band), rate)
            times = np.array([AUDIO.frame_time(i, rate)
                              for i in AUDIO.pick_peaks(z, rate, threshold)])
            inside = sum(int(((times >= a) & (times <= b)).sum())
                         for a, b in windows)
            outside = len(times) - sum(int(((times >= a) & (times <= b)).sum())
                                       for a, b in guard)
            r_in = inside / in_play if in_play else 0.0
            r_out = outside / gap if gap else 0.0
            row += (f" | {r_in:15.2f}{r_out:7.2f}"
                    f"{(r_in / r_out if r_out else 0):7.1f}")
        print(row, flush=True)


if __name__ == "__main__":
    main()

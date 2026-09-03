#!/usr/bin/env python3
"""What the microphone heard, over a whole match, for the card timeline.

    <ttvid venv>/python card_audio.py --video <path> --out <audio.json>

The admin portal draws four rows against each card: what the ear heard,
what the ball detector saw, which of those the pipeline called a bounce,
and where it put the serve. Three of the four already exist in the
assembler's evidence dump. This produces the first.

The detector is the one the research pilot already runs
(research_audio_candidates): a 10 kHz high-pass, per-millisecond energy,
and a peak wherever that energy clears an adaptive baseline. Imported, not
copied — the point of the row is to show what the pipeline's own ear does,
and a second implementation would quietly become a different ear. Ten
kilohertz rather than the 1.5-8 kHz band an earlier pass used: measured at
87% against production's visual bounces where the wider band scored 72%.

Runs under the TTVid vendor interpreter, which is where scipy lives, in the
same way blurball inference and the points pipeline do. The worker's own
environment stays free of it.

TWO THINGS THAT WOULD BE WRONG IF DONE THE OBVIOUS WAY.

  The clock. Times must come out on the SAME clock the assembler worked in,
  which means this has to be handed the exact file the assembler was handed
  — the trimmed working copy, not the stored raw. A match trimmed to start
  four minutes in would otherwise put every impact four minutes early, and
  a timeline that is confidently wrong is worse than no timeline.

  The frame grid. research_audio_candidates reports a peak's time as its
  frame index times one millisecond, but a frame is round(44100/1000) = 44
  samples, which is 0.9977 ms. Over the five-second clips it was written
  for that is 5 ms and invisible. Over a 25-minute match it is 3.4 seconds.
  Times here are computed from the sample count instead.

Memory is bounded by design. An hour of 44.1 kHz mono is 635 MB decoded and
several times that inside a filter, on a machine that is also processing
someone's upload, so the audio is streamed and filtered a couple of minutes
at a time with real audio either side of each block for the filter to settle
into. Only the two small per-frame arrays are kept whole.
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np
from scipy import signal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from research_audio_candidates import (  # noqa: E402
    ENERGY_FRAME_MS, HIGHPASS_HZ, TARGET_SAMPLE_RATE, adaptive_threshold,
    frame_mean_absolute,
)

SR = TARGET_SAMPLE_RATE
# 44 samples, exactly as the research detector frames it.
ENERGY_SAMPLES = round(SR * ENERGY_FRAME_MS / 1000)
# The drawn envelope. 40 ms is 1764 samples exactly at 44.1 kHz, and a card
# ten seconds long becomes 250 bars — more than a phone can paint. A finer
# bin would cost payload and show nothing, because an impact is a peak in
# the tick row, not a feature of the envelope.
DISPLAY_MS = 40
DISPLAY_SAMPLES = round(SR * DISPLAY_MS / 1000)

# Both frame grids must line up on every block boundary or the frame index
# drifts against the sample count and the whole point of the block above is
# lost. lcm(44, 1764) = 19404 samples = 0.44 s.
GRID = np.lcm(ENERGY_SAMPLES, DISPLAY_SAMPLES)
BLOCK = int(GRID * 250)          # ~110 s
# Real audio either side of each block for the filter to settle into. A
# fifth-order Butterworth at 10 kHz is quiet again within a few hundred
# samples; a tenth of a second is generous.
SETTLE = int(GRID * 10)

# A peak may not sit within this many milliseconds of the last one — the
# research detector's own spacing, in its own units.
PEAK_DISTANCE_FRAMES = round(60 / ENERGY_FRAME_MS)


def _stream(path, chunk_samples=1 << 20):
    """Decoded mono float32, a megabyte at a time, straight off ffmpeg."""
    proc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1",
         "-ar", str(SR), "-f", "f32le", "pipe:1"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    want = chunk_samples * 4
    try:
        while True:
            buf = proc.stdout.read(want)
            if not buf:
                break
            yield np.frombuffer(buf, dtype="<f4")
    finally:
        proc.stdout.close()
        err = proc.stderr.read().decode("utf-8", "replace").strip()
        proc.wait()
    if proc.returncode not in (0, None):
        raise RuntimeError(f"ffmpeg could not decode {path}: {err}")


def _frames(path):
    """Per-frame loudness for the whole file, in two grids.

    Returns (energy, envelope): the high-passed 1 ms energy the peak
    detector reads, and the raw 40 ms envelope the page draws. Both are
    indexed from the start of the file, so a frame index times its own
    sample count is an exact time.
    """
    sos = signal.butter(5, HIGHPASS_HZ, btype="highpass", fs=SR, output="sos")
    energy, envelope = [], []
    buf = np.zeros(0, dtype=np.float32)
    tail = np.zeros(0, dtype=np.float32)   # settled audio behind the block

    def take(core, look):
        seg = np.concatenate([tail, core, look])
        hp = signal.sosfiltfilt(sos, seg).astype(np.float32)
        hp = hp[len(tail):len(tail) + len(core)]
        energy.append(frame_mean_absolute(hp, ENERGY_SAMPLES))
        envelope.append(frame_mean_absolute(core, DISPLAY_SAMPLES))

    for chunk in _stream(path):
        buf = np.concatenate([buf, chunk])
        while len(buf) >= BLOCK + SETTLE:
            core, look = buf[:BLOCK], buf[BLOCK:BLOCK + SETTLE]
            take(core, look)
            tail = core[-SETTLE:].copy()
            buf = buf[BLOCK:].copy()
    # The last partial block, cut back to whole frames. What falls off the
    # end is under half a second of the very end of the video.
    usable = len(buf) // GRID * GRID
    if usable:
        take(buf[:usable], np.zeros(0, dtype=np.float32))

    if not energy:
        return np.zeros(0), np.zeros(0)
    return np.concatenate(energy), np.concatenate(envelope)


def analyze(path):
    """Every impact in the file, and an envelope to draw them against."""
    energy, envelope = _frames(path)
    if not len(energy):
        raise RuntimeError(f"no audio decoded from {path}")

    threshold = adaptive_threshold(energy)
    peaks, _ = signal.find_peaks(energy, height=threshold,
                                distance=PEAK_DISTANCE_FRAMES)
    impacts = [
        [round(float(i) * ENERGY_SAMPLES / SR, 3),
         round(float(energy[i] / max(threshold[i], 1e-12)), 1)]
        for i in peaks
    ]

    # Normalised the way the research page does it: against the 99.5th
    # percentile, so one clipped shout does not flatten a whole match. Held
    # as 0-100 integers, which is a third of the JSON of two decimals and
    # is the same picture at any size a screen can draw.
    scale = float(np.quantile(envelope, 0.995)) if len(envelope) else 0.0
    if scale <= 1e-12:
        wave = [0] * len(envelope)
    else:
        wave = np.clip(envelope / scale * 100.0, 0, 100).round().astype(int)
        wave = wave.tolist()

    return {
        "detector": "hf10k_ema_v1",
        "bin_s": round(DISPLAY_SAMPLES / SR, 5),
        "duration": round(len(energy) * ENERGY_SAMPLES / SR, 2),
        "wave": wave,
        "impacts": impacts,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--video", required=True,
                    help="the file the ASSEMBLER saw, trimmed as it was")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    blob = analyze(args.video)
    with open(args.out, "w") as fh:
        json.dump(blob, fh, separators=(",", ":"))
    rate = (len(blob["impacts"]) / blob["duration"]) if blob["duration"] else 0
    print(f"audio: {len(blob['impacts'])} impacts over "
          f"{blob['duration']:.0f}s ({rate:.1f}/s), "
          f"{len(blob['wave'])} envelope bins -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

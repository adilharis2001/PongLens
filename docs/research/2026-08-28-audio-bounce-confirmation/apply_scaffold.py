"""Re-apply (or remove) the measurement scaffold in placement_reconstruction.

  ./venv/bin/python apply_scaffold.py --apply | --remove | --check

The study reverted production when its first answer was "do not ship", so
the five module names replay.py needs are not in the tree. This applies
them mechanically instead of by hand, and --check proves they change
nothing at their defaults by running the real extract_candidates against
the committed copy on the same input, with and without impacts.
"""
import argparse
import importlib.util
import json
import os
import random
import subprocess
import sys

TARGET = "/Users/adil/Desktop/Projects/PongLens/worker/placement_reconstruction.py"

NAMES = '''# How close an audio impact has to be to count as the same event, and
# which of the three audio mechanisms run. Every default is what the
# module has always done, so with audio_impacts=[] — every production run
# to date — nothing here can change an outcome.
#
# RESCUE admits a bounce that failed the visual test. BLEND raises the
# confidence of events that already exist, including ones with no table
# coordinates, which cannot be drawn and can only displace one that can.
# IMPACT_CANDIDATES invents an event where there is sound and no visual
# evidence at all.
AUDIO_BLEND_TOLERANCE_S = 0.09
AUDIO_RESCUE_TOLERANCE_S = 0.09
AUDIO_BLEND_ENABLED = True
AUDIO_IMPACT_CANDIDATES_ENABLED = True
AUDIO_BLEND_REQUIRES_TABLE_COORDS = False


def _audio_time(impact):'''

EDITS = [
    ("def _audio_time(impact: Any) -> tuple[float, float]:", NAMES.replace(
        "def _audio_time(impact):",
        "def _audio_time(impact: Any) -> tuple[float, float]:")),
    ("                and nearest_audio_delta <= 0.09",
     "                and nearest_audio_delta <= AUDIO_RESCUE_TOLERANCE_S"),
    ("""    for event in candidates:
        match = _attach_audio(event, impacts, tolerance_s=0.09)""",
     """    for event in candidates:
        if not AUDIO_BLEND_ENABLED or (
            AUDIO_BLEND_REQUIRES_TABLE_COORDS
            and (event.get("u") is None or event.get("v") is None)
        ):
            event["audio_confidence"] = 0.0
            continue
        match = _attach_audio(
            event, impacts, tolerance_s=AUDIO_BLEND_TOLERANCE_S)"""),
    ("""    for index, (audio_t, confidence) in enumerate(impacts):
        if index in used_audio:""",
     """    for index, (audio_t, confidence) in enumerate(impacts):
        if not AUDIO_IMPACT_CANDIDATES_ENABLED:
            break
        if index in used_audio:"""),
]


def check():
    """The defaults must reproduce the committed function exactly."""
    scratch = os.path.dirname(os.path.abspath(__file__))
    old = "/tmp/_committed_reconstruction.py"
    with open(old, "w") as handle:
        subprocess.run(["git", "show", "HEAD:worker/placement_reconstruction.py"],
                       cwd="/Users/adil/Desktop/Projects/PongLens",
                       stdout=handle, check=True)
    sys.path.insert(0, "/Users/adil/Desktop/Projects/PongLens/worker")
    import placement_reconstruction as new
    from placement_backfill import calibration_matrix
    spec = importlib.util.spec_from_file_location("committed", old)
    ref = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ref)
    H = calibration_matrix({"table_corners_px": {
        "A_near_1": [470.8, 619.2], "B_near_2": [613.8, 755.0],
        "C_far_2": [1178.0, 551.3], "D_far_1": [967.5, 513.9]}}).tolist()
    random.seed(11)
    det, x, y = {}, 700.0, 600.0
    for frame in range(900):
        x += random.uniform(-14, 14)
        y += random.uniform(-11, 11)
        det[frame] = (max(100.0, min(1800.0, x)), max(80.0, min(1000.0, y)))
    impacts = [{"t": round(t, 3), "confidence": round(random.uniform(.5, 6), 2)}
               for t in [i * .11 + random.uniform(-.03, .03) for i in range(260)]]
    ok = True
    for audio in ([], impacts):
        a = ref.extract_candidates(det, H, (1., 0.), 0, 900, 30., 1920, audio)
        b = new.extract_candidates(det, H, (1., 0.), 0, 900, 30., 1920, audio)
        same = json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
        print(f"  impacts={'empty' if not audio else len(audio)}: "
              f"{len(a)} candidates, identical={same}")
        ok &= same
    print("DEFAULTS REPRODUCE THE COMMITTED FUNCTION" if ok else "DIFFERS")
    return ok


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--remove", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.remove:
        subprocess.run(["git", "checkout", "worker/placement_reconstruction.py"],
                       cwd="/Users/adil/Desktop/Projects/PongLens", check=True)
        print("reverted to the committed version")
        return
    if args.apply:
        source = open(TARGET).read()
        if "AUDIO_BLEND_ENABLED" in source:
            print("scaffold already applied")
        else:
            for old, new in EDITS:
                assert old in source, f"anchor not found: {old[:60]}"
                source = source.replace(old, new, 1)
            open(TARGET, "w").write(source)
            print("scaffold applied")
    if args.check or args.apply:
        check()


if __name__ == "__main__":
    main()

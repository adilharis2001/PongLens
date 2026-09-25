"""Compare a windowed BlurBall run with a full run of the same video.

    python windowed_equality.py FULL.jsonl WINDOWED.jsonl

WINDOWED.jsonl.frames.json (written by worker/blurball_windowed.py) says
which frames were required and which were computed. Every line inside a
window must be byte-identical to the full run; warm-up frames may differ
(they never did in the runs recorded in RELEASE-PLAN.md); frames never
computed must carry no detection. Exit status 1 on any difference.
"""
import bisect
import json
import sys


def main(full_path, windowed_path):
    full = open(full_path).read().splitlines()
    windowed = open(windowed_path).read().splitlines()
    side = json.load(open(windowed_path + ".frames.json"))
    times = side["frame_times"]
    if not len(full) == len(windowed) == side["frame_count"]:
        print(f"frame counts differ: full {len(full)}, windowed {len(windowed)}")
        return 1
    inside = set()
    for a, b in side["windows"]:
        first = bisect.bisect_left(times, a - 1e-9)
        last = bisect.bisect_right(times, b + 1e-9) - 1
        inside.update(range(first, last + 1))
    differing = [i for i in sorted(inside) if full[i] != windowed[i]]
    computed = set()
    for a, b in side["computed_frames"]:
        computed.update(range(a, b))
    warm = computed - inside
    warm_differing = [i for i in sorted(warm) if full[i] != windowed[i]]
    never = set(range(len(full))) - computed
    never_clean = all(json.loads(windowed[i])["x"] is None
                      and json.loads(windowed[i])["c"] == [] for i in never)
    print(f"frames {len(full)}; inside windows {len(inside)}, differing {len(differing)}"
          f"{' ' + str(differing[:10]) if differing else ''}; warm-up {len(warm)}, "
          f"differing {len(warm_differing)}; never computed {len(never)}, "
          f"all empty {never_clean}; passes {side['passes']}")
    return 1 if differing or not never_clean else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))

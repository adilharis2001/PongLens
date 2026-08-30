#!/bin/bash
# Backfill the per-card serve diagnosis so /admin/uploads/<id> can show it.
#
# The diagnosis needs the ball track, the bounces and the net crossings, and
# production keeps none of them: they live for a few seconds inside the
# assembler and are discarded. Recovering them means running the assembler
# again over the original video, which is what research_reprocess does —
# and it writes NOTHING to jobs, matches or points, so a player whose match
# is in this list never learns it ran.
#
# One match at a time, diagnosis published as soon as each finishes, so the
# admin portal fills up while this is still working rather than all at the
# end. Roughly 20 minutes a match: ~13 of that is blurball inference over
# the whole video, and the rest is the download and the assembler.
#
# `nice` on purpose. The production worker shares this machine and a real
# upload must not queue behind a backfill.
#
# Resumable: a match whose serves.json is already in R2 is skipped, so this
# can be stopped and restarted freely.
#
#   worker/backfill_serve_misses.sh worker/backfill-ids.txt
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKER="$REPO/worker"
PY="$WORKER/venv/bin/python"
# Resolved to an absolute path BEFORE the cd below, or a relative argument
# stops resolving the moment the working directory changes.
IDS_FILE="${1:-$WORKER/backfill-ids.txt}"
case "$IDS_FILE" in /*) ;; *) IDS_FILE="$(cd "$(dirname "$IDS_FILE")" && pwd)/$(basename "$IDS_FILE")" ;; esac
WORKROOT="${BACKFILL_WORKROOT:-/Users/adil/Desktop/Projects/PongLens/.backfill-work}"
PREFIX="research/crossings"   # only used for the reprocess bundle
PUBLISHED_PREFIX="points"     # where publish_card_diagnosis writes
LOG="$WORKER/backfill-serve-misses.log"
STATE="$WORKER/backfill-serve-misses.state"

mkdir -p "$WORKROOT"
touch "$STATE"
cd "$WORKER" || exit 1

say() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

# read -r in a loop, not mapfile: macOS ships bash 3.2, where mapfile does
# not exist and the script dies before it starts.
IDS=()
while IFS= read -r line; do
  case "$line" in ''|\#*) continue ;; esac
  IDS+=("$line")
done < "$IDS_FILE"
say "backfill starting — ${#IDS[@]} matches, workroot $WORKROOT"

# Which ones are already published? One listing beats one HEAD per match.
DONE_REMOTE=$("$PY" - "$PUBLISHED_PREFIX" <<'PYEOF' 2>/dev/null
import sys
sys.path.insert(0, ".")
from research_reprocess import MEDIA_BUCKET, config, s3_client
s3 = s3_client(config())
token, out = None, []
while True:
    kw = {"Bucket": MEDIA_BUCKET, "Prefix": sys.argv[1] + "/"}
    if token:
        kw["ContinuationToken"] = token
    r = s3.list_objects_v2(**kw)
    for o in r.get("Contents", []):
        # points/<user_id>/<match_id>/serves.json
        if o["Key"].endswith("/serves.json"):
            out.append(o["Key"].split("/")[-2])
    token = r.get("NextContinuationToken")
    if not r.get("IsTruncated"):
        break
print("\n".join(out))
PYEOF
)
say "already published: $(echo "$DONE_REMOTE" | grep -c . ) matches"

i=0
for ID in "${IDS[@]}"; do
  i=$((i + 1))
  if grep -qx "$ID" "$STATE" 2>/dev/null; then
    say "[$i/${#IDS[@]}] $ID — skipped, done earlier in this run"; continue
  fi
  if echo "$DONE_REMOTE" | grep -qx "$ID"; then
    say "[$i/${#IDS[@]}] $ID — skipped, already in R2"
    echo "$ID" >> "$STATE"; continue
  fi

  say "[$i/${#IDS[@]}] $ID — reprocessing"
  START=$(date +%s)

  # --skip-video: the admin page draws on the match's own cut video, so the
  # 960w review encode the research page needs is pure cost here.
  if nice -n 10 "$PY" research_reprocess.py "$ID" \
        --workroot "$WORKROOT" --skip-video --prefix "$PREFIX" >>"$LOG" 2>&1; then
    if nice -n 10 "$PY" publish_card_diagnosis.py \
          --workroot "$WORKROOT" "$ID" >>"$LOG" 2>&1; then
      echo "$ID" >> "$STATE"
      say "[$i/${#IDS[@]}] $ID — published in $((($(date +%s) - START) / 60)) min"
    else
      say "[$i/${#IDS[@]}] $ID — reprocess ok but diagnosis FAILED"
    fi
  else
    # A match with no table, or detections too old to carry candidates,
    # produces no evidence dump. That is an answer, not a crash: skip it
    # and keep going rather than stranding the other thirty-eight.
    say "[$i/${#IDS[@]}] $ID — reprocess FAILED (see log), moving on"
  fi

  # Keep evidence.json and drop everything else. The dump is ~1 MB and is
  # the expensive half of this job — the clips and the blurball jsonl are a
  # few hundred MB a match and are never read again. Keeping the dump means
  # a rule change can be re-published in seconds instead of re-running
  # blurball over thirty-nine videos.
  if [ -d "${WORKROOT:?}/$ID" ]; then
    find "${WORKROOT:?}/$ID" -mindepth 1 -maxdepth 1 \
      ! -name evidence.json ! -name serves.json -exec rm -rf {} + 2>/dev/null
  fi
done

say "backfill finished — $(grep -c . "$STATE") of ${#IDS[@]} published"

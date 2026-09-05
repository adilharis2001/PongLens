#!/bin/bash
#
# The morning outreach run. Discovery, then enrichment. Nothing else.
#
# It does not draft messages, and that is deliberate: Adil decides who is
# worth writing to and presses the button himself on /marketing/coach-outreach.
# A worker that pre-wrote messages would be guessing at that decision.
#
# It never sends anything either. There is no send path in this repo at all
# for Instagram, because Meta's penalty for DM automation is the account,
# and that account carries his own match videos.
#
# Runs under launchd through an AppleScript wrapper app, because a bare
# /bin/bash spawned by launchd cannot read ~/Desktop under macOS TCC. See
# the README beside this file.
#
#   scripts/marketing/outreach-morning.sh [--dry-run]

set -uo pipefail

REPO="/Users/adil/Desktop/Projects/PongLens"
STATE="$REPO/scripts/marketing/outreach-state.json"
LOG_DIR="$REPO/scripts/marketing/logs"
NODE="/opt/homebrew/bin/node"
DRY=""
[ "${1:-}" = "--dry-run" ] && DRY="--dry-run"

mkdir -p "$LOG_DIR"
STAMP="$(date +%Y-%m-%d)"
LOG="$LOG_DIR/$STAMP.log"
# Taken before anything runs, and used at the end to ask the database what
# arrived while we were working. Counting inside discovery would count
# upserts, which include coaches already on the list from a previous run.
SINCE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

cd "$REPO" || { say "FATAL cannot enter $REPO"; exit 1; }

# Six English term sets, one per run, so a run is not the same search over
# and over. Instagram returns roughly the same thirty accounts for a given
# phrase, so the way to find new people is to ask a different question.
# Three runs a week means the six sets come round every fortnight, which is
# about how long it takes for a search to have anything new in it anyway.
TERM_SETS=(en en-city-us en-city-us2 en-uk en-academy en-junior)
if [ -f "$STATE" ]; then
  DAY_INDEX=$("$NODE" -e "try{console.log(JSON.parse(require('fs').readFileSync('$STATE','utf8')).next_index||0)}catch(e){console.log(0)}")
else
  DAY_INDEX=0
fi
TERM_SET="${TERM_SETS[$DAY_INDEX]}"
NEXT_INDEX=$(( (DAY_INDEX + 1) % ${#TERM_SETS[@]} ))

say "start, terms=$TERM_SET (index $DAY_INDEX of ${#TERM_SETS[@]}) ${DRY:+DRY RUN}"
say "commit $(git rev-parse --short HEAD)"

STATUS="succeeded"

say "discovery"
if ! "$NODE" scripts/marketing/discover.mjs --terms "$TERM_SET" --limit 30 $DRY >>"$LOG" 2>&1; then
  say "discovery FAILED"
  STATUS="failed"
fi

# Enrichment runs even when discovery failed part way: whatever did land is
# still worth placing, and it only touches rows that have never been enriched.
say "enrichment"
if ! "$NODE" --experimental-strip-types scripts/marketing/enrich.mjs --limit 60 $DRY >>"$LOG" 2>&1; then
  say "enrichment FAILED"
  STATUS="failed"
fi

if [ -z "$DRY" ]; then
  "$NODE" -e "
    const fs = require('fs');
    let state = {};
    try { state = JSON.parse(fs.readFileSync('$STATE','utf8')); } catch (e) {}
    state.next_index = $NEXT_INDEX;
    state.last_run = new Date().toISOString();
    state.last_status = '$STATUS';
    state.history = [{ at: state.last_run, terms: '$TERM_SET', status: '$STATUS' }]
      .concat(state.history || []).slice(0, 30);
    fs.writeFileSync('$STATE', JSON.stringify(state, null, 2) + '\n');
  "
fi

# The digest goes out even when the run failed, because a morning with no
# mail should mean the machine was off, not that the search broke quietly.
say "digest"
if ! "$NODE" --experimental-strip-types scripts/marketing/notify.mjs \
      --since "$SINCE" --status "$STATUS" --terms "$TERM_SET" $DRY >>"$LOG" 2>&1; then
  say "digest FAILED (run itself was $STATUS)"
fi

say "done, $STATUS. next run uses ${TERM_SETS[$NEXT_INDEX]}"
[ "$STATUS" = "succeeded" ] || exit 1

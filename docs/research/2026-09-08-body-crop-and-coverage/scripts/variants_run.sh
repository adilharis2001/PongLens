#!/bin/bash
F=/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad/fullframe
PY=/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python
run(){ TAG=$1 EXTRA="$2" $F/variant_pages.sh; echo "=== compare13 $1 ($2) ==="; $PY $F/compare13.py $1; echo "=== verdicts_check $1 ==="; $PY $F/verdicts_check.py $F/pages_$1 body-detector 2>&1 | grep -c ORPHAN | sed 's/^/orphans: /'; $PY $F/verdicts_check.py $F/pages_$1 body-detector 2>&1 | grep "ORPHAN\|of 303" ; }
run loose "--set bias=0.5 --set dur_w=4.0 --set play_min=1.5"
run bias05 "--set bias=0.5"
echo "VARIANTS DONE"

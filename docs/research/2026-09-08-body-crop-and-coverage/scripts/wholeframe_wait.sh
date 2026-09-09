#!/bin/bash
F=/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad/fullframe
until grep -q "WHOLEFRAME ALL DONE" $F/wholeframe_all.log 2>/dev/null; do sleep 30; done
sleep 5
cat $F/wholeframe_all.log
echo "=== compare13 wholeframe ==="
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python $F/compare13.py wholeframe
echo "=== verdicts_check ==="
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python $F/verdicts_check.py $F/pages_wholeframe body-detector 2>&1 | tail -30
echo "=== onset witness on whole-frame edge models ==="
cd $F/.. && EDGE_DIR=$F/bodyedge_wholeframe DUMP_DIR=$F/dumps_wholeframe V3_BF_SMOOTH=0.5 /Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python $F/serve_witness.py 2>&1 | grep -v "^   {" | head -40
echo "WAIT DONE"

#!/bin/bash
# Adopt the ball-family model: lab dumps, snapshot, README deploy command, page payloads
# into the deploy worktree (not committed here; commit + push by hand after reading the diff).
S=/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad
L=$S/poseretest; F=$S/fullframe; W=$S/bodyfix; TAG="${1:-ball}"
set -e
# Adil's row calls must all find their row in the new payloads, or we stop here.
/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python $F/verdicts_pull.py body-detector
/usr/bin/python3 $F/verdicts_check.py $F/pages_$TAG body-detector | tee $F/verdicts_check_$TAG.log
if grep -q "^  ORPHAN" $F/verdicts_check_$TAG.log; then echo "STOP: a stored call would lose its row (apply any REKEY-SQL lines above, then re-run)"; exit 2; fi
cp $F/verdicts_body-detector.json ~/Library/Caches/PongLens/body-lab/verdicts/body-detector_before_adopt_$TAG.json
cd $L
rm -rf bodyfirst && mkdir bodyfirst && cp $F/dumps_$TAG/bf_*.npz bodyfirst/
rm -rf $F/deployed_bodyfirst_noball && cp -r $F/deployed_bodyfirst $F/deployed_bodyfirst_noball
rm -rf $F/deployed_bodyfirst && cp -r bodyfirst $F/deployed_bodyfirst
/usr/bin/python3 - <<'EOF'
p="BODYFIRST_README.md"; s=open(p).read()
if "--fam rhythm,floor,snap,ball" not in s:
    s=s.replace("--fam rhythm,floor,snap ", "--fam rhythm,floor,snap,ball --set ball_floor=0.6 --set ball_floor_tempo=3 ",1); open(p,"w").write(s); print("README deploy command updated")
EOF
for f in $F/pages_$TAG/*-*.json; do id=$(basename $f .json); mkdir -p $W/public/research/body-detector/$id; cp $f $W/public/research/body-detector/$id/compare.json; done
cp $F/pages_$TAG/index.json $W/public/research/body-detector/index.json
# the export dir should carry the same payloads as the deploy worktree
for f in $F/pages_$TAG/*-*.json; do id=$(basename $f .json); cp $f $S/v3deploy/public/research/body-detector/$id/compare.json; done
cp $F/pages_$TAG/index.json $S/v3deploy/public/research/body-detector/index.json
cd $W && git status --short -- public/research/body-detector | head -12
echo "ADOPTED $TAG (not committed)"

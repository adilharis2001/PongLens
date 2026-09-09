#!/bin/zsh
# Coverage lever: the decoder's length prior and minimum point length. Same deploy
# command, no --dump, one --set at a time. Waits for the corpus run so pose files
# and caches are in their deployed state.
setopt nullglob
S=/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad
L=$S/poseretest; F=$S/fullframe
PY=/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python
LOG=$F/sweep_decoder.log
log(){ echo "[$(date +%H:%M:%S)] $*" >> $LOG }
cd $L || exit 1
until grep -q "HOLD ALL DONE" $F/hold_all.log 2>/dev/null; do sleep 30; done
while pgrep -f hold_all.sh >/dev/null; do sleep 10; done; sleep 5
MS="89b35ee0 77fc4dee d15aad4d bfc9b31b 10322849 f3237587 2eab3e3d cebaa6d4 7e02fbb9 5fd822ec 95a07786 5c90151a 1c08539e"
HOLD=5fd822ec,95a07786,5c90151a,1c08539e
run(){ tag=$1; shift
  log "$tag: $*"
  V3_BF_SMOOTH=0.5 nice -n 12 $PY bodyfirst.py VFINAL2 ${=MS} --holdout $HOLD --fam rhythm,floor,snap --set dur_w=8.0 --set snap_on=1.0 "$@" > $F/sweep_$tag.log 2>&1; log "  exit $?"
}
run base
run durw4 --set dur_w=4.0
run durw2 --set dur_w=2.0
run durw1 --set dur_w=1.0
run pmin15 --set play_min=1.5
run durw4_pmin15 --set dur_w=4.0 --set play_min=1.5
run bias05 --set bias=0.5
run bias05_durw4 --set bias=0.5 --set dur_w=4.0
run bias1 --set bias=1.0
log "SWEEP DONE"

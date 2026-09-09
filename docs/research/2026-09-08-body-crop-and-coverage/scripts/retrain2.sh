#!/bin/bash
S=/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad
L=$S/poseretest; F=$S/fullframe
PY=/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python
LOG=$F/retrain2.log
log(){ echo "[$(date +%H:%M:%S)] $*" >> $LOG; }
cd $L || exit 1
MS="89b35ee0 77fc4dee d15aad4d bfc9b31b 10322849 f3237587 2eab3e3d cebaa6d4 7e02fbb9 5fd822ec 95a07786 5c90151a 1c08539e"
HOLD=5fd822ec,95a07786,5c90151a,1c08539e
run(){ tag=$1; shift; log "$tag: $*"; V3_BF_SMOOTH=0.5 nice -n 12 "$PY" bodyfirst.py VFINAL2 $MS --holdout $HOLD --set dur_w=8.0 --set snap_on=1.0 "$@" > $F/rt_$tag.log 2>&1; log "  exit $?"; }
run floor50_t2 --fam rhythm,floor,snap,ball --set ball_floor=0.5
run floor60_t2 --fam rhythm,floor,snap,ball --set ball_floor=0.6
run floor60_t3 --fam rhythm,floor,snap,ball --set ball_floor=0.6 --set ball_floor_tempo=3
run floor75_t2 --fam rhythm,floor,snap,ball --set ball_floor=0.75
run knots3 --fam rhythm,floor,snap,ball --set knots=3
run floor60_t2_noballfam --fam rhythm,floor,snap,ball --set ball_floor=0.6 --set l2=1e-3
log "RETRAIN2 DONE"

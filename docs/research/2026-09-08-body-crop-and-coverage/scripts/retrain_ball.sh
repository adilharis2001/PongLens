#!/bin/bash
# The body model with and without the ball-witness family, same 13 matches, same
# settings as the deploy command, no --dump. The first run recomputes every
# feature cache (the source hash moved), so "base" must reproduce sweep_base.log.
S=/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad
L=$S/poseretest; F=$S/fullframe
PY=/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python
LOG=$F/retrain_ball.log
log(){ echo "[$(date +%H:%M:%S)] $*" >> $LOG; }
cd $L || exit 1
MS="89b35ee0 77fc4dee d15aad4d bfc9b31b 10322849 f3237587 2eab3e3d cebaa6d4 7e02fbb9 5fd822ec 95a07786 5c90151a 1c08539e"
HOLD=5fd822ec,95a07786,5c90151a,1c08539e
run(){ tag=$1; shift; log "$tag: $*"; V3_BF_SMOOTH=0.5 nice -n 12 "$PY" bodyfirst.py VFINAL2 $MS --holdout $HOLD --set dur_w=8.0 --set snap_on=1.0 "$@" > $F/rt_$tag.log 2>&1; log "  exit $?"; }
run base --fam rhythm,floor,snap
run ball --fam rhythm,floor,snap,ball
run ball_durw4 --fam rhythm,floor,snap,ball --set dur_w=4.0
run ball_bias05 --fam rhythm,floor,snap,ball --set bias=0.5
log "RETRAIN DONE"

#!/bin/zsh
# The ball's four statements about a body card, each on its own, on the deployed
# dumps and on the bias=0.5/dur_w=4 dumps. Nine bundle matches, three pages at a time.
setopt nullglob
S=/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad
L=$S/poseretest; F=$S/fullframe
PY=/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python
LOG=$F/refine_run.log
log(){ echo "[$(date +%H:%M:%S)] $*" >> $LOG }
cd $L || exit 1
MS="89b35ee0 77fc4dee d15aad4d bfc9b31b 10322849 f3237587 2eab3e3d cebaa6d4 7e02fbb9 5fd822ec 95a07786 5c90151a 1c08539e"
HOLD=5fd822ec,95a07786,5c90151a,1c08539e
WITH="10322849 1c08539e 2eab3e3d 5c90151a 5fd822ec 77fc4dee 95a07786 cebaa6d4 f3237587"
restore(){ rm -rf bodyfirst; cp -r $F/deployed_bodyfirst bodyfirst; }
trap restore EXIT
# config name -> env
typeset -A CFG
CFG[quiet]="V3_BF_NOCROSS=quiet"
CFG[split]="V3_BF_SERVE=1 V3_BF_SPLIT=3.0"
CFG[endcross]="V3_BF_END=cross"
CFG[endboth]="V3_BF_END=both"
CFG[afterfirst]="V3_BF_AFTER_FIRST=1"
CFG[tidy]="V3_BF_NOCROSS=quiet V3_BF_SERVE=1 V3_BF_SPLIT=3.0 V3_BF_AFTER_FIRST=1"
CFG[tidyend]="V3_BF_NOCROSS=quiet V3_BF_SERVE=1 V3_BF_SPLIT=3.0 V3_BF_AFTER_FIRST=1 V3_BF_END=cross"
runset(){ # set-name configs...
  setn=$1; shift
  for cfg in "$@"; do
    log "$setn/$cfg: ${CFG[$cfg]}"
    export RF_ENV="${CFG[$cfg]}" RF_OUT=$F/rf_${setn}_${cfg}_ RF_LOG=$LOG RF_LAB=$L
    for m in ${=WITH}; do echo $m; done | xargs -P 3 -n 1 $F/rf_one.sh
    log "  done"
  done
}
restore
runset base quiet split endcross endboth afterfirst tidy tidyend
log "dump bias=0.5 dur_w=4"
V3_BF_SMOOTH=0.5 nice -n 12 $PY bodyfirst.py VFINAL2 ${=MS} --holdout $HOLD --fam rhythm,floor,snap --set dur_w=8.0 --set snap_on=1.0 --set bias=0.5 --set dur_w=4.0 --dump > $F/bf_bias2.log 2>&1; log "  exit $?"
runset bias quiet split afterfirst tidy tidyend
restore
log "REFINE DONE"

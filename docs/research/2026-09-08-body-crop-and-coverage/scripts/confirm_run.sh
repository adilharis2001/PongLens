#!/bin/zsh
# Can the ball split what a cheaper play bias glues? Body cards alone vs body cards
# refined by the serve detector (V3_BODYFIRST=confirm), on the deployed dumps and on
# the bias=0.5 dur_w=4 dumps. Only the nine matches whose crossings bundle survived.
setopt nullglob
S=/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad
L=$S/poseretest; F=$S/fullframe
PY=/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python
LOG=$F/confirm_run.log
log(){ echo "[$(date +%H:%M:%S)] $*" >> $LOG }
cd $L || exit 1
while pgrep -f "sweep_decoder.sh|hold_all.sh" >/dev/null; do sleep 10; done
MS="89b35ee0 77fc4dee d15aad4d bfc9b31b 10322849 f3237587 2eab3e3d cebaa6d4 7e02fbb9 5fd822ec 95a07786 5c90151a 1c08539e"
HOLD=5fd822ec,95a07786,5c90151a,1c08539e
WITH="10322849 1c08539e 2eab3e3d 5c90151a 5fd822ec 77fc4dee 95a07786 cebaa6d4 f3237587"
restore(){ rm -rf bodyfirst; cp -r $F/deployed_bodyfirst bodyfirst; }
trap restore EXIT
restore
for m in ${=WITH}; do
  log "base+confirm $m"; V3_MATCH=$m V3_BODYFIRST=confirm CMP_OUT=$F/cf_basec_$m /usr/bin/python3 build_compare_page.py > $F/cf_basec_$m.log 2>&1; log "  exit $?"
done
log "dump bias=0.5 dur_w=4"
V3_BF_SMOOTH=0.5 nice -n 12 $PY bodyfirst.py VFINAL2 ${=MS} --holdout $HOLD --fam rhythm,floor,snap --set dur_w=8.0 --set snap_on=1.0 --set bias=0.5 --set dur_w=4.0 --dump > $F/bf_bias.log 2>&1; log "  exit $?"
for m in ${=WITH}; do
  log "bias $m"; V3_MATCH=$m V3_BODYFIRST=1 CMP_OUT=$F/cf_bias_$m /usr/bin/python3 build_compare_page.py > $F/cf_bias_$m.log 2>&1; log "  exit $?"
  log "bias+confirm $m"; V3_MATCH=$m V3_BODYFIRST=confirm CMP_OUT=$F/cf_biasc_$m /usr/bin/python3 build_compare_page.py > $F/cf_biasc_$m.log 2>&1; log "  exit $?"
done
restore
log "CONFIRM DONE"

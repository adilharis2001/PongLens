#!/bin/bash
# The retrained model (ball family) on the page ruler: dump with the new family,
# export the nine bundle matches with the deployed settings + the end rule, score,
# restore the lab's dumps. Run only after rt_table.py says the family helps.
S=/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad
L=$S/poseretest; F=$S/fullframe; V=$S/v3deploy/public/research
PY=/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python
LOG=$F/ball_pages.log
log(){ echo "[$(date +%H:%M:%S)] $*" >> $LOG; }
cd $L || exit 1
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1
MS="89b35ee0 77fc4dee d15aad4d bfc9b31b 10322849 f3237587 2eab3e3d cebaa6d4 7e02fbb9 5fd822ec 95a07786 5c90151a 1c08539e"
HOLD=5fd822ec,95a07786,5c90151a,1c08539e
WITH="10322849 1c08539e 2eab3e3d 5c90151a 5fd822ec 77fc4dee 95a07786 cebaa6d4 f3237587"
EXTRA="${1:-}"   # e.g. "--set bias=0.5"
TAG="${2:-ball}"
restore(){ rm -rf bodyfirst; cp -r $F/deployed_bodyfirst bodyfirst; }
trap restore EXIT
# keep the current page payloads safe
mkdir -p $F/fixed_export_keep; for d in $V/body-detector/*/; do cp $d/compare.json $F/fixed_export_keep/$(basename $d).json; done
log "dump with the ball family $EXTRA"
V3_BF_SMOOTH=0.5 nice -n 12 "$PY" bodyfirst.py VFINAL2 $MS --holdout $HOLD --fam rhythm,floor,snap,ball --set dur_w=8.0 --set snap_on=1.0 $EXTRA --dump > $F/bf_${TAG}_dump.log 2>&1; log "  exit $?"
mkdir -p $F/dumps_$TAG; cp bodyfirst/bf_*.npz $F/dumps_$TAG/
export V3_EXPORT_NAME=body-detector V3_EXPORT_ONLY=compare
FIX="V3_BODYFIRST=confirm V3_BF_SERVE=1 V3_BF_SPLIT=6.0 V3_BF_NOCROSS=quiet V3_BODY_SRV=0.80 V3_BF_EXTEND=both V3_BF_EXTEND_GAP=1.2 V3_BF_EXTEND_PMIN=0.3 V3_BF_AFTER_FIRST=1"
log "pages, nine"
for M in $WITH; do env V3_MATCH=$M $FIX nice -n 12 "$PY" run_match.py --export > /tmp/v3exp/bodyexport_$M.log 2>&1 & done; wait
mkdir -p $F/pages_$TAG; for d in $V/body-detector/*/; do cp $d/compare.json $F/pages_$TAG/$(basename $d).json; done; cp $V/body-detector/index.json $F/pages_$TAG/index.json
# put the shipped payloads back in the export dir so nothing else picks these up by accident
for f in $F/fixed_export_keep/*.json; do id=$(basename $f .json); cp $f $V/body-detector/$id/compare.json; done
restore
log "BALL PAGES DONE $TAG"

#!/bin/bash
# Whole-frame poses for every match: swap pose files, purge the feature + edge caches
# (they are keyed on code, not on pose data), re-run the DEPLOY dump command, export the 13
# pages with the deploy switches, park everything under fullframe/pages_wholeframe, then put
# the lab back exactly as deployed.
S=/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad
L=$S/poseretest; F=$S/fullframe; V=$S/v3deploy/public/research
PY=/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python
LOG=$F/wholeframe_all.log; TAG=wholeframe
log(){ echo "[$(date +%H:%M:%S)] $*" >> $LOG; }
cd $L || exit 1
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1
MS="89b35ee0 77fc4dee d15aad4d bfc9b31b 10322849 f3237587 2eab3e3d cebaa6d4 7e02fbb9 5fd822ec 95a07786 5c90151a 1c08539e"
HOLD=5fd822ec,95a07786,5c90151a,1c08539e
# snapshots of the deployed lab state
mkdir -p $F/deployed_poses
for m in $MS; do [ -f $F/deployed_poses/pose_$m.json ] || cp pose_$m.json $F/deployed_poses/pose_$m.json; done
[ -d $F/deployed_bodyfirst ] || cp -r bodyfirst $F/deployed_bodyfirst
[ -d $F/deployed_bodyedge ] || cp -r /tmp/v3exp/bodyedge $F/deployed_bodyedge
mkdir -p $F/fixed_export_keep; for d in $V/body-detector/*/; do cp $d/compare.json $F/fixed_export_keep/$(basename $d).json; done
restore(){
  for m in $MS; do cp $F/deployed_poses/pose_$m.json pose_$m.json; done
  rm -rf bodyfirst; cp -r $F/deployed_bodyfirst bodyfirst
  rm -rf /tmp/v3exp/bodyedge; cp -r $F/deployed_bodyedge /tmp/v3exp/bodyedge
  for m in $MS; do rm -f /tmp/v3exp/bodyfeat/${m}_ALL_s0.5_*.npz; done
  for f in $F/fixed_export_keep/*.json; do id=$(basename $f .json); cp $f $V/body-detector/$id/compare.json; done
  log "lab restored to deployed state"
}
trap restore EXIT
SW=""
for m in $MS; do
  if [ -s pose_${m}_full.json ]; then cp pose_${m}_full.json pose_$m.json; SW="$SW $m"; rm -f /tmp/v3exp/bodyfeat/${m}_ALL_s0.5_*.npz; fi
done
log "swapped to whole-frame poses:$SW"
rm -rf /tmp/v3exp/bodyedge; mkdir -p /tmp/v3exp/bodyedge
log "dump (deploy command) on whole-frame poses"
V3_BF_SMOOTH=0.5 nice -n 12 "$PY" bodyfirst.py VFINAL2 $MS --holdout $HOLD --fam rhythm,floor,snap,ball --set ball_floor=0.6 --set ball_floor_tempo=3 --set dur_w=8.0 --set snap_on=1.0 --dump > $F/bf_${TAG}_dump.log 2>&1; log "  exit $?"
grep -E "^(TOTAL|[0-9a-f]{8} )" $F/bf_${TAG}_dump.log >> $LOG
mkdir -p $F/dumps_$TAG; cp bodyfirst/bf_*.npz $F/dumps_$TAG/
cp -r /tmp/v3exp/bodyedge $F/bodyedge_$TAG
export V3_EXPORT_NAME=body-detector V3_EXPORT_ONLY=compare
FIX="V3_BODYFIRST=confirm V3_BF_SERVE=1 V3_BF_SPLIT=6.0 V3_BF_NOCROSS=quiet V3_BODY_SRV=0.80 V3_BF_EXTEND=both V3_BF_EXTEND_GAP=1.2 V3_BF_EXTEND_PMIN=0.3 V3_BF_AFTER_FIRST=1"
log "pages, thirteen"
for M in $MS; do env V3_MATCH=$M $FIX nice -n 12 "$PY" run_match.py --export > /tmp/v3exp/bodyexport_$M.log 2>&1 & done; wait
mkdir -p $F/pages_$TAG; for d in $V/body-detector/*/; do cp $d/compare.json $F/pages_$TAG/$(basename $d).json; done; cp $V/body-detector/index.json $F/pages_$TAG/index.json
log "WHOLEFRAME ALL DONE"

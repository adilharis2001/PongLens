#!/bin/bash
# 1. prove the sweep_dead.py patch is inert with the switch off (Lester, unpatched vs patched)
# 2. baseline export, today's bundles, deployed settings, nine matches -> base_export/
# 3. Wayne Wei: full-frame poses become the lab's poses; re-dump
# 4. fixed export: deployed settings + ball-continuity end + after-first, nine matches
# 5. Wayne's skeletons for the page from the full-frame poses
S=/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad
L=$S/poseretest; F=$S/fullframe; V=$S/v3deploy/public/research
PY=/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python
LOG=$F/fixed_export.log
log(){ echo "[$(date +%H:%M:%S)] $*" >> $LOG; }
cd $L || exit 1
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1
export V3_EXPORT_NAME=body-detector V3_EXPORT_ONLY=compare
DEPLOYED="V3_BODYFIRST=confirm V3_BF_SERVE=1 V3_BF_SPLIT=6.0 V3_BF_NOCROSS=quiet V3_BODY_SRV=0.80"
FIX="$DEPLOYED V3_BF_EXTEND=both V3_BF_EXTEND_GAP=1.2 V3_BF_EXTEND_PMIN=0.3 V3_BF_AFTER_FIRST=1"
WITH="10322849 1c08539e 2eab3e3d 5c90151a 5fd822ec 77fc4dee 95a07786 cebaa6d4 f3237587"
runexport(){ # env-string matches...
  envs=$1; shift
  for M in "$@"; do env V3_MATCH=$M $envs nice -n 12 "$PY" run_match.py --export > /tmp/v3exp/bodyexport_$M.log 2>&1 & done
  wait
}
# 1
cp sweep_dead.py $F/sweep_dead_patched.py; cp $F/sweep_dead_before_extend.py sweep_dead.py
log "1. unpatched Lester"; runexport "$DEPLOYED" 77fc4dee
cp $V/body-detector/77fc4dee-*/compare.json $F/unpatched_77fc4dee.json
cp $F/sweep_dead_patched.py sweep_dead.py
# 2
log "2. baseline, patched, deployed settings, nine"; runexport "$DEPLOYED" $WITH
mkdir -p $F/base_export; for d in $V/body-detector/*/; do id=$(basename $d); cp $d/compare.json $F/base_export/$id.json; done
/usr/bin/python3 - >> $LOG 2>&1 <<'EOF'
import json, glob
a = json.load(open(glob.glob("/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad/fullframe/unpatched_77fc4dee.json")[0]))
b = json.load(open(glob.glob("/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad/fullframe/base_export/77fc4dee-*.json")[0]))
ca = sorted((c["t0"], c["t1"]) for r in a["rows"] for c in (r.get("mine") or [])); cb = sorted((c["t0"], c["t1"]) for r in b["rows"] for c in (r.get("mine") or []))
print("  INERT CHECK Lester: cards identical:", ca == cb, len(ca), len(cb))
EOF
# 3
log "3. Wayne Wei -> full-frame poses, re-dump"
[ -f pose_95a07786_window.json ] || cp pose_95a07786.json pose_95a07786_window.json
cp pose_95a07786_full.json pose_95a07786.json
rm -f /tmp/v3exp/bodyfeat/95a07786_ALL_s0.5_*.npz
MS="89b35ee0 77fc4dee d15aad4d bfc9b31b 10322849 f3237587 2eab3e3d cebaa6d4 7e02fbb9 5fd822ec 95a07786 5c90151a 1c08539e"
V3_BF_SMOOTH=0.5 nice -n 12 "$PY" bodyfirst.py VFINAL2 $MS --holdout 5fd822ec,95a07786,5c90151a,1c08539e --fam rhythm,floor,snap --set dur_w=8.0 --set snap_on=1.0 --dump > $F/bf_wayne_fullframe_dump.log 2>&1; log "  dump exit $? : $(grep -E '^95a07786' $F/bf_wayne_fullframe_dump.log | tail -1)"
rm -rf $F/deployed_bodyfirst_window; cp -r $F/deployed_bodyfirst $F/deployed_bodyfirst_window; rm -rf $F/deployed_bodyfirst; cp -r bodyfirst $F/deployed_bodyfirst
cp $F/deployed_poses/pose_95a07786.json $F/deployed_poses/pose_95a07786_window.json; cp pose_95a07786.json $F/deployed_poses/pose_95a07786.json
# 4
log "4. fixed export, nine"; runexport "$FIX" $WITH
for M in $WITH; do tail -2 /tmp/v3exp/bodyexport_$M.log | head -1 >> $LOG; done
# 5
log "5. Wayne skeletons from the full-frame poses"
V3_MATCH=95a07786 "$PY" export_pose.py > $F/wayne_pose_export.log 2>&1; log "  export_pose exit $?"
log "EXPORT DONE"

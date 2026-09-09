#!/bin/bash
# The Wayne re-dump failed because the EDGE cache for Wayne still held the window
# run's 6149 samples. Purge it, dump again, re-export Wayne with the fix, rebuild
# the manifest, refresh the lab snapshot.
S=/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad
L=$S/poseretest; F=$S/fullframe
PY=/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python
LOG=$F/wayne_redo.log
log(){ echo "[$(date +%H:%M:%S)] $*" >> $LOG; }
cd $L || exit 1
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 VECLIB_MAXIMUM_THREADS=1
MS="89b35ee0 77fc4dee d15aad4d bfc9b31b 10322849 f3237587 2eab3e3d cebaa6d4 7e02fbb9 5fd822ec 95a07786 5c90151a 1c08539e"
k=$(V3_BF_SMOOTH=0.5 "$PY" - <<'EOF'
import bodyfirst
MS="89b35ee0 77fc4dee d15aad4d bfc9b31b 10322849 f3237587 2eab3e3d cebaa6d4 7e02fbb9 5fd822ec 95a07786 5c90151a 1c08539e".split()
hold={"5fd822ec","95a07786","5c90151a","1c08539e"}; m="95a07786"
print(bodyfirst._edgekey(m, [x for x in MS if x!=m and x not in hold], bodyfirst._cfg(["dur_w=8.0","snap_on=1.0"]), "VFINAL2"))
EOF
)
log "edge key for Wayne: $k"; rm -f /tmp/v3exp/bodyedge/$k.npz /tmp/v3exp/bodyfeat/95a07786_ALL_s0.5_*.npz
V3_BF_SMOOTH=0.5 nice -n 12 "$PY" bodyfirst.py VFINAL2 $MS --holdout 5fd822ec,95a07786,5c90151a,1c08539e --fam rhythm,floor,snap --set dur_w=8.0 --set snap_on=1.0 --dump > $F/bf_wayne_fullframe_dump2.log 2>&1; log "dump exit $? : $(grep -E '^95a07786' $F/bf_wayne_fullframe_dump2.log | tail -1)"
rm -rf $F/deployed_bodyfirst; cp -r bodyfirst $F/deployed_bodyfirst
export V3_EXPORT_NAME=body-detector V3_EXPORT_ONLY=compare
env V3_MATCH=95a07786 V3_BODYFIRST=confirm V3_BF_SERVE=1 V3_BF_SPLIT=6.0 V3_BF_NOCROSS=quiet V3_BODY_SRV=0.80 V3_BF_EXTEND=both V3_BF_EXTEND_GAP=1.2 V3_BF_EXTEND_PMIN=0.3 V3_BF_AFTER_FIRST=1 nice -n 12 "$PY" run_match.py --export > /tmp/v3exp/bodyexport_95a07786.log 2>&1; log "wayne export exit $? : $(tail -2 /tmp/v3exp/bodyexport_95a07786.log | head -1)"
V3_MATCH=95a07786 "$PY" export_pose.py > $F/wayne_pose_export2.log 2>&1; log "export_pose exit $?"
log "WAYNE REDO DONE"

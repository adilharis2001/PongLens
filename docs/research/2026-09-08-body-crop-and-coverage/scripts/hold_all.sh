#!/bin/zsh
# The identity fix (pose_fix.py hold) on every match of the body corpus, one at a
# time: swap the fixed pose file in, re-dump with the deploy command, build the
# page, restore. Lester and Wayne Wei already have their hold runs.
setopt nullglob
S=/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad
L=$S/poseretest; F=$S/fullframe; D=$F/deployed_poses
PY=/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python
LOG=$F/hold_all.log
log(){ echo "[$(date +%H:%M:%S)] $*" >> $LOG }
cd $L || exit 1
mkdir -p $D
MS="89b35ee0 77fc4dee d15aad4d bfc9b31b 10322849 f3237587 2eab3e3d cebaa6d4 7e02fbb9 5fd822ec 95a07786 5c90151a 1c08539e"
HOLD=5fd822ec,95a07786,5c90151a,1c08539e
for m in ${=MS}; do [ -f $D/pose_$m.json ] || cp pose_$m.json $D/pose_$m.json; done
[ -d $F/deployed_bodyfirst ] || cp -r bodyfirst $F/deployed_bodyfirst
[ -d $F/deployed_bodyedge ] || cp -r /tmp/v3exp/bodyedge $F/deployed_bodyedge
edgekey(){
  V3_BF_SMOOTH=0.5 $PY - "$1" <<'EOF'
import sys, bodyfirst
m=sys.argv[1]
MS="89b35ee0 77fc4dee d15aad4d bfc9b31b 10322849 f3237587 2eab3e3d cebaa6d4 7e02fbb9 5fd822ec 95a07786 5c90151a 1c08539e".split()
hold={"5fd822ec","95a07786","5c90151a","1c08539e"}
others=[k for k in MS if k!=m and k not in hold]
print(bodyfirst._edgekey(m, others, bodyfirst._cfg(["dur_w=8.0","snap_on=1.0"]), "VFINAL2"))
EOF
}
CUR=""
restore_all(){
  local mm; for mm in ${=MS}; do cp $D/pose_$mm.json pose_$mm.json; done
  rm -rf bodyfirst; cp -r $F/deployed_bodyfirst bodyfirst
  rm -rf /tmp/v3exp/bodyedge; cp -r $F/deployed_bodyedge /tmp/v3exp/bodyedge
  [ -n "$CUR" ] && { rm -f /tmp/v3exp/bodyfeat/${CUR}_ALL_s0.5_*.npz; k=$(edgekey $CUR 2>/dev/null | tail -1); [ -n "$k" ] && rm -f /tmp/v3exp/bodyedge/$k.npz; }
}
trap restore_all EXIT
for m in ${=MS}; do
  [ -d $F/hold_$m ] && { log "skip $m: done"; continue }
  restore_all; CUR=$m
  rm -f /tmp/v3exp/bodyfeat/${m}_ALL_s0.5_*.npz; k=$(edgekey $m 2>/dev/null | tail -1); [ -n "$k" ] && rm -f /tmp/v3exp/bodyedge/$k.npz
  log "$m pose_fix: $(/usr/bin/python3 $F/pose_fix.py $D/pose_$m.json pose_$m.json hold 2>&1 | tail -1)"
  V3_BF_SMOOTH=0.5 nice -n 12 $PY bodyfirst.py VFINAL2 ${=MS} --holdout $HOLD --fam rhythm,floor,snap --set dur_w=8.0 --set snap_on=1.0 --dump > $F/bf_hold_$m.log 2>&1; log "  bodyfirst exit $? : $(grep -E "^$m" $F/bf_hold_$m.log | tail -1)"
  cp bodyfirst/bf_$m.npz $F/bf_hold_$m.npz
  V3_MATCH=$m V3_BODYFIRST=1 CMP_OUT=$F/hold_$m /usr/bin/python3 build_compare_page.py > $F/page_hold_$m.log 2>&1; log "  page exit $?"
done
rm -rf /tmp/v3exp/bodyedge; cp -r $F/deployed_bodyedge /tmp/v3exp/bodyedge
log "HOLD ALL DONE"

#!/bin/zsh
# Correct body-card experiment: the compare page READS bodyfirst/bf_<m>.npz, so each
# variant must re-run bodyfirst.py --dump (the deploy command, verbatim) with the
# variant's pose file in place, then build the page. Deployed state is snapshotted
# and restored after every variant.
setopt nullglob
S=/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad
L=$S/poseretest; F=$S/fullframe
PY=/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python
LOG=$F/redo.log
log(){ echo "[$(date +%H:%M:%S)] $*" >> $LOG }
cd $L || exit 1
until grep -q "LESTER FULL DONE" $F/lester_full.log 2>/dev/null; do sleep 30; done
while pgrep -f lester_full.sh >/dev/null; do sleep 10; done; sleep 15
log "start; lester_full.sh finished"
[ -s pose_77fc4dee_full.json ] || { log "no Lester full pose file"; }
# snapshots of the deployed state
[ -d $F/deployed_bodyfirst ] || cp -r bodyfirst $F/deployed_bodyfirst
[ -d $F/deployed_bodyedge ] || cp -r /tmp/v3exp/bodyedge $F/deployed_bodyedge
[ -f $F/pose_95a07786_deployed.json ] || cp pose_95a07786.json $F/pose_95a07786_deployed.json
[ -f $F/pose_77fc4dee_deployed.json ] || cp pose_77fc4dee.json $F/pose_77fc4dee_deployed.json
MS="89b35ee0 77fc4dee d15aad4d bfc9b31b 10322849 f3237587 2eab3e3d cebaa6d4 7e02fbb9 5fd822ec 95a07786 5c90151a 1c08539e"
HOLD=5fd822ec,95a07786,5c90151a,1c08539e
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
purge_m(){ rm -f /tmp/v3exp/bodyfeat/${1}_ALL_s0.5_*.npz; k=$(edgekey $1 2>/dev/null | tail -1); [ -n "$k" ] && rm -f /tmp/v3exp/bodyedge/$k.npz; }
restore_all(){
  cp $F/pose_95a07786_deployed.json pose_95a07786.json
  cp $F/pose_77fc4dee_deployed.json pose_77fc4dee.json
  rm -rf bodyfirst; cp -r $F/deployed_bodyfirst bodyfirst
  rm -rf /tmp/v3exp/bodyedge; cp -r $F/deployed_bodyedge /tmp/v3exp/bodyedge
  purge_m 95a07786; purge_m 77fc4dee
}
trap restore_all EXIT
# identity-fixed pose files, made up front
for spec in "95a07786 $F/pose_95a07786_deployed.json hold" "95a07786 pose_95a07786_full.json fullhold" \
            "77fc4dee $F/pose_77fc4dee_deployed.json hold" "77fc4dee $F/pose_77fc4dee_deployed.json nan" \
            "77fc4dee pose_77fc4dee_full.json fullhold"; do
  set -- ${=spec}; m=$1; src=$2; tag=$3; mode=${tag#full}
  [ -s $src ] || { log "skip $m $tag: no $src"; continue }
  log "pose_fix $m $tag: $(/usr/bin/python3 $F/pose_fix.py $src $F/pose_${m}_$tag.json $mode 2>&1 | tail -1)"
done
variant(){ # name m posefile pagedir
  name=$1; m=$2; src=$3; out=$4
  [ -s $src ] || { log "skip $name: no $src"; return }
  restore_all
  cp $src pose_${m}.json
  log "$name: bodyfirst"
  V3_BF_SMOOTH=0.5 nice -n 12 $PY bodyfirst.py VFINAL2 ${=MS} --holdout $HOLD --fam rhythm,floor,snap --set dur_w=8.0 --set snap_on=1.0 --dump > $F/bf_$name.log 2>&1; log "  bodyfirst exit $? : $(grep -E "^$m" $F/bf_$name.log | tail -1)"
  cp bodyfirst/bf_${m}.npz $F/bf_$name.npz
  log "$name: page"
  V3_MATCH=$m V3_BODYFIRST=1 CMP_OUT=$out /usr/bin/python3 build_compare_page.py > $F/page_$name.log 2>&1; log "  page exit $?"
}
# 0. reproduce the deployed dumps from the deployed poses (must be identical)
variant base 95a07786 $F/pose_95a07786_deployed.json $F/base_95a07786
cp bodyfirst/bf_77fc4dee.npz $F/bf_base_lester.npz
/usr/bin/python3 - >> $LOG 2>&1 <<'EOF'
import numpy as np
F="/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad/fullframe"
for a,b in (("bf_base.npz","deployed_bodyfirst/bf_95a07786.npz"),("bf_base_lester.npz","deployed_bodyfirst/bf_77fc4dee.npz")):
    A=np.load(f"{F}/{a}",allow_pickle=True); B=np.load(f"{F}/{b}",allow_pickle=True)
    print("  REPRO", a, "p equal:", np.array_equal(A["p"],B["p"]), "segs equal:", np.array_equal(A["segs"],B["segs"]), "max|dp|", float(np.max(np.abs(A["p"]-B["p"]))) if A["p"].shape==B["p"].shape else "shape differs")
EOF
# 1. the questions
variant wayne_full     95a07786 pose_95a07786_full.json        $F/body_95a07786
variant lester_full    77fc4dee pose_77fc4dee_full.json        $F/lester_full
variant lester_hold    77fc4dee $F/pose_77fc4dee_hold.json     $F/lester_hold
variant lester_fullhold 77fc4dee $F/pose_77fc4dee_fullhold.json $F/lester_fullhold
variant lester_nan     77fc4dee $F/pose_77fc4dee_nan.json      $F/lester_nan
variant wayne_hold     95a07786 $F/pose_95a07786_hold.json     $F/wayne_hold
variant wayne_fullhold 95a07786 $F/pose_95a07786_fullhold.json $F/wayne_fullhold
log "ALL REDO DONE"

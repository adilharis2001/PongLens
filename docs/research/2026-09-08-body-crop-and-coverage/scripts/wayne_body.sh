#!/bin/zsh
# After the full-frame poses exist: build the body cards from them (pose file swapped in, caches purged), then restore.
S=/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad
L=$S/poseretest; m=95a07786
cd $L || exit 1
while ! grep -q "DONE" $S/fullframe/wayne.log; do sleep 30; done
[ -s pose_${m}_full.json ] || { echo "no full-frame pose file"; exit 1; }
restore() { [ -f pose_${m}_wide.json ] && mv pose_${m}_wide.json pose_${m}.json; [ -d /tmp/v3exp/bodyedge_bak ] && { rm -rf /tmp/v3exp/bodyedge; mv /tmp/v3exp/bodyedge_bak /tmp/v3exp/bodyedge; }; [ -f bodyfirst/bf_${m}_wide.npz ] && mv bodyfirst/bf_${m}_wide.npz bodyfirst/bf_${m}.npz; }
trap restore EXIT
mv pose_${m}.json pose_${m}_wide.json; cp pose_${m}_full.json pose_${m}.json
rm -f /tmp/v3exp/bodyfeat/${m}_*; [ -d /tmp/v3exp/bodyedge ] && mv /tmp/v3exp/bodyedge /tmp/v3exp/bodyedge_bak; mkdir -p /tmp/v3exp/bodyedge
cp bodyfirst/bf_${m}.npz bodyfirst/bf_${m}_wide.npz
echo "[$(date +%H:%M:%S)] body cards from FULL-FRAME poses"
V3_MATCH=$m V3_BODYFIRST=1 CMP_OUT=$S/fullframe/body_$m /usr/bin/python3 build_compare_page.py > $S/fullframe/body_$m.log 2>&1; echo "  exit $?"
cp bodyfirst/bf_${m}.npz $S/fullframe/bf_${m}_full.npz 2>/dev/null
rm -f /tmp/v3exp/bodyfeat/${m}_*
echo "[$(date +%H:%M:%S)] BODY DONE"

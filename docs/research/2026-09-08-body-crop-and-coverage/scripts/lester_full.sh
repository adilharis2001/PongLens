#!/bin/zsh
# Lester on the FULL frame: poses over the existing full-frame boxes, then body cards (plain and with the identity fix).
S=/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad
L=$S/poseretest; m=77fc4dee
RTM="$HOME/Library/Caches/PongLens/rtmpose-production/venv/bin/python"
export DET_MODEL="$HOME/.cache/rtmlib/hub/checkpoints/rtmdet_m_8xb32-100e_coco-obj365-person-235e8209.onnx"
export POSE_MODEL="$HOME/Library/Caches/PongLens/rtmpose-production/end2end.onnx"
cd $L || exit 1
while ! grep -q "RAW DONE 0" $S/fullframe/lester_raw.log 2>/dev/null; do sleep 30; done
while ! grep -q "LESTER DONE" $S/fullframe/lester_fix.log 2>/dev/null; do sleep 30; done
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 crop/${m}_raw.mov)
corners=$(/usr/bin/python3 -c "
import json; C=json.load(open('real_calib.json')); k=[x for x in C if x.startswith('$m')][0]; print(json.dumps(C[k]['corners']))")
echo "[$(date +%H:%M:%S)] Lester poses on the full frame (boxes reused), ${dur}s"
"$RTM" pose_match.py crop/${m}_raw.mov pose_${m}_full.json --rect 0,0,1920,1080 --corners "$corners" --offset -0.033 --duration "$dur" --out-fps 29.97 --sample-fps 10 --boxes people_${m}_full.json > $S/fullframe/pose_full_$m.log 2>&1; echo "  exit $?"
[ -s pose_${m}_full.json ] || { echo "no full pose file"; exit 1; }
restore() { [ -f pose_${m}_wide.json ] && mv pose_${m}_wide.json pose_${m}.json; [ -d /tmp/v3exp/bodyedge_bak ] && { rm -rf /tmp/v3exp/bodyedge; mv /tmp/v3exp/bodyedge_bak /tmp/v3exp/bodyedge; }; [ -f bodyfirst/bf_${m}_wide.npz ] && mv bodyfirst/bf_${m}_wide.npz bodyfirst/bf_${m}.npz; rm -f /tmp/v3exp/bodyfeat/${m}_*; }
trap restore EXIT
cp pose_${m}.json pose_${m}_wide.json; cp bodyfirst/bf_${m}.npz bodyfirst/bf_${m}_wide.npz
[ -d /tmp/v3exp/bodyedge ] && mv /tmp/v3exp/bodyedge /tmp/v3exp/bodyedge_bak
for v in full fullhold; do
  if [ $v = full ]; then cp pose_${m}_full.json pose_${m}.json; else /usr/bin/python3 $S/fullframe/pose_fix.py pose_${m}_full.json pose_${m}.json hold; fi
  rm -f /tmp/v3exp/bodyfeat/${m}_*; rm -rf /tmp/v3exp/bodyedge; mkdir -p /tmp/v3exp/bodyedge
  echo "[$(date +%H:%M:%S)] Lester body cards, $v"
  V3_MATCH=$m V3_BODYFIRST=1 CMP_OUT=$S/fullframe/lester_$v /usr/bin/python3 build_compare_page.py > $S/fullframe/lester_$v.log 2>&1; echo "  exit $?"
  cp bodyfirst/bf_${m}.npz $S/fullframe/bf_${m}_$v.npz 2>/dev/null
done
echo "[$(date +%H:%M:%S)] LESTER FULL DONE"

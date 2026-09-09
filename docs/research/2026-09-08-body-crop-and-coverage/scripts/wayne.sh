#!/bin/zsh
# Full-frame person boxes + poses for Wayne Wei (95a07786), no window.
S=/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad
L=$S/poseretest; m=95a07786
RTM="$HOME/Library/Caches/PongLens/rtmpose-production/venv/bin/python"
export DET_MODEL="$HOME/.cache/rtmlib/hub/checkpoints/rtmdet_m_8xb32-100e_coco-obj365-person-235e8209.onnx"
export POSE_MODEL="$HOME/Library/Caches/PongLens/rtmpose-production/end2end.onnx"
cd $L || exit 1
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 crop/${m}_raw.mov)
corners=$(/usr/bin/python3 -c "
import json; C=json.load(open('real_calib.json')); k=[x for x in C if x.startswith('$m')][0]; print(json.dumps(C[k]['corners']))")
echo "[$(date +%H:%M:%S)] boxes on the FULL frame 0,0,1920,1080, ${dur}s @ 60fps"
"$RTM" people_match2.py crop/${m}_raw.mov people_${m}_full.json --offset 0 --duration "$dur" --out-fps 60 --rect 0,0,1920,1080 > $S/fullframe/people_full_$m.log 2>&1; echo "  exit $?"
echo "[$(date +%H:%M:%S)] poses, boxes reused"
"$RTM" pose_match.py crop/${m}_raw.mov pose_${m}_full.json --rect 0,0,1920,1080 --corners "$corners" --offset 0 --duration "$dur" --out-fps 60 --sample-fps 10 --boxes people_${m}_full.json > $S/fullframe/pose_full_$m.log 2>&1; echo "  exit $?"
echo "[$(date +%H:%M:%S)] DONE"

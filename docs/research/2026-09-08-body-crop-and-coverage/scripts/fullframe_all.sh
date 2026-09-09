#!/bin/zsh
# Whole-frame person boxes and poses for every corpus match that still lacks them.
# Sequential, low priority; each match is skipped once its pose_<m>_full.json exists.
# Adil approved the compute on 2026-09-08 ("go ahead and do it").
S=/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad
L=$S/poseretest; F=$S/fullframe
RTM="$HOME/Library/Caches/PongLens/rtmpose-production/venv/bin/python"
export DET_MODEL="$HOME/.cache/rtmlib/hub/checkpoints/rtmdet_m_8xb32-100e_coco-obj365-person-235e8209.onnx"
export POSE_MODEL="$HOME/Library/Caches/PongLens/rtmpose-production/end2end.onnx"
LOG=$F/fullframe_all.log
log(){ echo "[$(date +%H:%M:%S)] $*" >> $LOG }
cd $L || exit 1
# most early endings first
for m in 5c90151a 1c08539e 10322849 2eab3e3d 5fd822ec f3237587 cebaa6d4 d15aad4d bfc9b31b 7e02fbb9; do
  [ -s pose_${m}_full.json ] && { log "$m: poses exist, skip"; continue }
  [ -s crop/${m}_raw.mov ] || { log "$m: no raw, skip"; continue }
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 crop/${m}_raw.mov)
  read fps offset <<< "$(/usr/bin/python3 -c "
import json; w=json.load(open('people_${m}_wide.json')); print(w['fps'], w.get('offset') or 0)")"
  corners=$(/usr/bin/python3 -c "
import json; C=json.load(open('real_calib.json')); k=[x for x in C if x.startswith('$m')][0]; print(json.dumps(C[k]['corners']))")
  if [ ! -s people_${m}_full.json ]; then
    log "$m: boxes on the whole frame, ${dur}s @ ${fps}fps"
    nice -n 15 "$RTM" people_match2.py crop/${m}_raw.mov people_${m}_full.json --offset $offset --duration "$dur" --out-fps $fps --rect 0,0,1920,1080 > $F/people_full_$m.log 2>&1; log "  boxes exit $?"
    [ -s people_${m}_full.json ] || { log "  no boxes file, skipping poses"; continue }
  fi
  log "$m: poses, boxes reused"
  nice -n 15 "$RTM" pose_match.py crop/${m}_raw.mov pose_${m}_full.json --rect 0,0,1920,1080 --corners "$corners" --offset $offset --duration "$dur" --out-fps $fps --sample-fps 10 --boxes people_${m}_full.json > $F/pose_full_$m.log 2>&1; log "  poses exit $?"
done
log "FULLFRAME ALL DONE"

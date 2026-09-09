#!/bin/bash
S=/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad
L=$S/poseretest; F=$S/fullframe; PY=/Users/adil/Desktop/Projects/PongLens/worker/venv/bin/python
LOG=$F/rebuild_three.log; log(){ echo "[$(date +%H:%M:%S)] $*" >> $LOG; }
cd $L
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 V3_EXPORT_NAME=body-detector V3_EXPORT_ONLY=compare
for m in d15aad4d bfc9b31b 7e02fbb9; do
  cp $S/v3deploy/public/research/body-detector/$m-*/compare.json $F/page_before_$m.json
  log "$m: bundle"; /usr/bin/python3 bundle_from_overlay.py $m >> $LOG 2>&1
  log "$m: export"; env V3_MATCH=$m V3_BODYFIRST=confirm V3_BF_SERVE=1 V3_BF_SPLIT=6.0 V3_BF_NOCROSS=quiet V3_BODY_SRV=0.80 V3_BF_EXTEND=both V3_BF_EXTEND_GAP=1.2 V3_BF_EXTEND_PMIN=0.3 V3_BF_AFTER_FIRST=1 nice -n 12 "$PY" run_match.py --export > /tmp/v3exp/bodyexport_$m.log 2>&1; log "  exit $? : $(tail -2 /tmp/v3exp/bodyexport_$m.log | head -1)"
done
log "THREE DONE"

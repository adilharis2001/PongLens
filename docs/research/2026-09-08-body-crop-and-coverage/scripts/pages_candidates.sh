#!/bin/bash
F=/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad/fullframe
cd $F
./ball_pages.sh "--set ball_floor=0.5" floor50 > pc_floor50.out 2>&1
./ball_pages.sh "--set ball_floor=0.6 --set ball_floor_tempo=3" floor60t3 > pc_floor60t3.out 2>&1
echo "[$(date +%H:%M:%S)] CANDIDATES DONE" >> $F/pages_candidates.log

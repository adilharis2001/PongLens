#!/bin/bash
# Keep-score logic checks. No simulator, no Xcode scheme, no network — the
# files under test import Foundation and nothing else, so this is a plain
# swiftc build of five sources plus the cases.
#
#   ios/Tests/run.sh
set -euo pipefail
cd "$(dirname "$0")"
CORE=../PongLens/PongLens/Core
OUT=$(mktemp -d)/scorelogic
swiftc -O -o "$OUT" \
  "$CORE/Models.swift" \
  "$CORE/Placement.swift" \
  "$CORE/Serving.swift" \
  "$CORE/GameScore.swift" \
  "$CORE/Playhead.swift" \
  "$CORE/ScoreLogic.swift" \
  ScoreLogicTests.swift ServePlacementTests.swift main.swift
"$OUT"

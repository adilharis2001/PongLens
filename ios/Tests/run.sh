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
  "$CORE/Scorecard.swift" \
  "$CORE/Starred.swift" \
  "$CORE/Playhead.swift" \
  "$CORE/InsertGeometry.swift" \
  "$CORE/ScoreLogic.swift" \
  "$CORE/Highlights.swift" \
  "$CORE/CameraGuideGate.swift" \
  "$CORE/SideChanges.swift" \
  "$CORE/SpokenScore.swift" \
  "$CORE/ScoreCapture.swift" \
  ScoreLogicTests.swift ServePlacementTests.swift StarredTests.swift \
  HighlightsTests.swift CameraGuideGateTests.swift \
  RallyEndTests.swift SideChangeTests.swift ServingTests.swift InsertGeometryTests.swift \
  SpokenScoreTests.swift ScoreCaptureTests.swift main.swift
"$OUT"

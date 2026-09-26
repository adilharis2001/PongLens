#!/bin/bash
# The app's headless checks. No simulator, no Xcode scheme, no network: the
# files under test import Foundation and nothing else, so this is a plain
# swiftc build of the Core sources plus the cases, then the sub-suites.
#
#   ios/Tests/run.sh
set -euo pipefail
cd "$(dirname "$0")"
CORE=../PongLens/PongLens/Core
OUT=$(mktemp -d)/scorelogic
swiftc -O -o "$OUT" \
  "$CORE/Models.swift" \
  "$CORE/SampleMatch.swift" \
  "$CORE/Placement.swift" \
  "$CORE/MatchAnalysis.swift" \
  "$CORE/ScoredCards.swift" \
  "$CORE/Serving.swift" \
  "$CORE/GameScore.swift" \
  "$CORE/Scorecard.swift" \
  "$CORE/Starred.swift" \
  "$CORE/Playhead.swift" \
  "$CORE/InsertGeometry.swift" \
  "$CORE/ScoreLogic.swift" \
  "$CORE/CameraGuideGate.swift" \
  "$CORE/SideChanges.swift" \
  "$CORE/SpokenScore.swift" \
  "$CORE/ScoreCapture.swift" \
  "$CORE/ScorerState.swift" \
  "$CORE/CanonicalScoreCommands.swift" \
  "$CORE/Linkify.swift" \
  "$CORE/AllowanceLimit.swift" \
  "$CORE/UserFacingError.swift" \
  "$CORE/LessonPreview.swift" \
  "$CORE/PlayerCoachModel.swift" \
  "$CORE/CoachActions.swift" \
  "$CORE/MatchPointLink.swift" \
  "$CORE/SignupSource.swift" \
  "$CORE/ProcessingFeedback.swift" \
  "$CORE/ProcessingEstimate.swift" \
  "$CORE/FeedbackBoard.swift" \
  "$CORE/HandCutPlan.swift" \
  "$CORE/CutPlan.swift" \
  "$CORE/DeviceCutJob.swift" \
  "$CORE/LocalVideoIndex.swift" \
  "$CORE/HandCut.swift" \
  "$CORE/MarkLandscape.swift" \
  "$CORE/CutAgain.swift" \
  "$CORE/HandCutPlayback.swift" \
  "$CORE/UploadProcessingRequest.swift" \
  "$CORE/TrimWindow.swift" \
  ScoreLogicTests.swift FeedbackBoardTests.swift ServePlacementTests.swift StarredTests.swift \
  HighlightsTests.swift PlayerTakeoverTests.swift CameraGuideGateTests.swift \
  RallyEndTests.swift SideChangeTests.swift ServingTests.swift InsertGeometryTests.swift SpokenScoreTests.swift ScoreCaptureTests.swift ScorerStateTests.swift CanonicalScoreCommandsTests.swift LinkifyTests.swift AllowanceRecoveryTests.swift UserFacingErrorTests.swift MatchToolsTests.swift LessonPreviewTests.swift CoachActionsTests.swift MatchPointLinkTests.swift SignupSourceTests.swift ProcessingFeedbackTests.swift ScoredCardsTests.swift HandCutVideoTests.swift HandCutTests.swift CutPlanTests.swift DeviceCutTests.swift MarkLandscapeTests.swift CutAgainTests.swift HandCutPlaybackTests.swift UploadCutChoiceTests.swift TrimWindowTests.swift main.swift
"$OUT"

# Suites with an entry point of their own (@main, or a main.swift beside
# their own run.sh) cannot share the binary above, so each builds and runs
# alone. A failure in any of them fails this script.
RECOVERY_OUT=$(mktemp -d)/recovery
swiftc -o "$RECOVERY_OUT" "$CORE/UploadProcessingRequest.swift" UploadProcessingRecoveryTests.swift
"$RECOVERY_OUT"
for suite in ProcessingAvailability ProcessingEstimate ImportedProcessingObservation LessonVideo; do
  bash "$suite/run.sh"
done

import Foundation

// Entry point only — the cases live in ScoreLogicTests.swift. swiftc allows
// top-level statements in main.swift and nowhere else.

runAllChecks()
runServePlacementParityChecks()
runPlacementHeatMapChecks()
runStarredTests()
runAutomaticHighlightsChecks()
runMatchToolsChecks()
runHighlightPlayerSourceChecks()
runCameraGuideGateChecks()
runRallyEndParityChecks()
runSideChangeParityChecks()
runServingParityChecks()
runInsertGeometryParityChecks()
runSpokenScoreChecks()
runScoreCaptureChecks()
runLinkifyTests()
runStandardGameChecks()
runAllowanceRecoveryChecks()
runUserFacingErrorChecks()
runLessonPreviewChecks()

print("\n\(checks - failures)/\(checks) checks passed")
if failures > 0 {
    print("\(failures) FAILED")
    exit(1)
}
print("all green")

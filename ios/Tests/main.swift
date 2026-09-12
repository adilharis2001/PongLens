import Foundation

// Entry point only — the cases live in ScoreLogicTests.swift. swiftc allows
// top-level statements in main.swift and nowhere else.

Task { @MainActor in
    await runScorerStateChecks()
    if ProcessInfo.processInfo.environment["SCORER_ONLY"] != "1" {
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
        runCoachActionsChecks()
        runMatchPointLinkChecks()
        runSignupSourceChecks()
        runProcessingFeedbackChecks()
    }

    print("\n\(checks - failures)/\(checks) checks passed")
    if failures > 0 {
        print("\(failures) FAILED")
        exit(1)
    }
    print("all green")
    exit(0)
}

dispatchMain()

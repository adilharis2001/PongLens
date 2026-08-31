import Foundation

// Entry point only — the cases live in ScoreLogicTests.swift. swiftc allows
// top-level statements in main.swift and nowhere else.

runAllChecks()
runServePlacementParityChecks()
runPlacementHeatMapChecks()
runStarredTests()
runHighlightsParityChecks()
runCameraGuideGateChecks()
runRallyEndParityChecks()
runSideChangeParityChecks()
runServingParityChecks()
runInsertGeometryParityChecks()

print("\n\(checks - failures)/\(checks) checks passed")
if failures > 0 {
    print("\(failures) FAILED")
    exit(1)
}
print("all green")

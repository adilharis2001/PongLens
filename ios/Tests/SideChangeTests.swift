import Foundation

// The game-end marker rule exists twice — src/app/match/[id]/
// sideChanges.ts is the original, Core/SideChanges.swift the port — and it
// has eight rules that all look reasonable when read wrongly. So this
// replays the web module's OWN recorded answers through the Swift side:
// fixtures/side-change-markers.json is written by the TypeScript test
// itself, so the two are never compared against a second reading of the
// same paragraph.
//
// Same arrangement as the serve, highlights and rally-end parity checks,
// and for the same reason: two hand-written suites agreeing only proves
// both authors read the spec the same way, which is how the placement
// mirror survived a passing test for eight months.

private struct MarkerFixture: Decodable {
    struct Pt: Decodable {
        let id: UUID
        let t1: Double?
        let game_end_override: String?
        let side_change_dismissed: Bool
    }
    struct Expect: Decodable {
        let pointId: UUID
        let confidence: Double
        let anchor: String
    }
    struct Case: Decodable {
        let name: String
        let evidence: MatchStructure?
        let points: [Pt]
        let boundary_after: [UUID]
        let enabled: Bool
        let scored_type: Bool
        let expect: [Expect]
    }
    let cases: [Case]
}

func runSideChangeParityChecks() {
    print("\n— side-change markers, against the web's own answers —")
    let url = URL(fileURLWithPath: "fixtures/side-change-markers.json")
    guard let data = try? Data(contentsOf: url) else {
        check(false, "side-change fixture loads")
        return
    }
    guard let fixture = try? JSONDecoder().decode(MarkerFixture.self, from: data)
    else {
        check(false, "side-change fixture decodes")
        return
    }
    check(fixture.cases.count >= 18, "fixture has cases")

    for testCase in fixture.cases {
        let rallies = testCase.points.map {
            SideChanges.Rally(
                id: $0.id,
                t1: $0.t1,
                gameEndOverride: $0.game_end_override
                    .flatMap(GameEndOverride.init(rawValue:)),
                sideChangeDismissed: $0.side_change_dismissed
            )
        }
        let got = SideChanges.visible(
            evidence: testCase.evidence,
            visiblePoints: rallies,
            boundaryAfter: Set(testCase.boundary_after),
            enabled: testCase.enabled,
            scoredType: testCase.scored_type
        )
        let want = testCase.expect
        guard got.count == want.count else {
            check(
                false,
                "\(testCase.name): \(want.count) marker(s), got \(got.count)"
            )
            continue
        }
        var ok = true
        for (marker, expected) in zip(got, want) {
            if marker.pointId != expected.pointId { ok = false }
            if marker.anchor.rawValue != expected.anchor { ok = false }
            if abs(marker.confidence - expected.confidence) > 1e-9 { ok = false }
        }
        check(ok, testCase.name)
    }
}

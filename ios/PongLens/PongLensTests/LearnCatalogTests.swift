import XCTest
@testable import PongLens

final class LearnCatalogTests: XCTestCase {
    private func loadStore() throws -> LearnCatalogStore {
        let resourceURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("PongLens/Resources/learn-catalog.json")
        return try LearnCatalogStore(data: Data(contentsOf: resourceURL))
    }

    func testCatalogContainsEveryIOSChapterForEachAudience() throws {
        let store = try loadStore()

        XCTAssertEqual(store.chapters(for: .player).count, 9)
        XCTAssertEqual(store.chapters(for: .coach).count, 8)
    }

    func testCoachSearchExcludesPaidReviews() throws {
        let store = try loadStore()

        XCTAssertTrue(store.search("paid review", audience: .coach).isEmpty)
    }

    func testChapterNumbersAreDerivedFromVisibleSourceOrder() throws {
        let store = try loadStore()

        XCTAssertEqual(
            store.numberedChapters(for: .coach).map(\.number),
            Array(1...8)
        )
    }

    func testRelatedGuidesRemainInsideTheSelectedAudience() throws {
        let store = try loadStore()
        let guide = try XCTUnwrap(
            store.guides(for: .coach).first { $0.slug == "review-student-match" }
        )

        let related = store.related(for: guide, audience: .coach)

        XCTAssertFalse(related.isEmpty)
        XCTAssertTrue(related.allSatisfy { $0.audience == .coach })
    }

    func testSearchIncludesSectionTipsAndBullets() throws {
        let store = try loadStore()

        XCTAssertEqual(
            store.search("processing choices lock", audience: .player).map(\.slug),
            ["upload-a-video"]
        )
        XCTAssertEqual(
            store.search("connected duplicate", audience: .coach).map(\.slug),
            ["add-connect-student"]
        )
    }

    func testAudienceFollowsTheActiveWorkspace() {
        XCTAssertEqual(LearnAudience(workspace: .player), .player)
        XCTAssertEqual(LearnAudience(workspace: .coach), .coach)
    }

    func testEachAudienceUsesItsOwnTutorialProgressKey() {
        XCTAssertEqual(LearnAudience.player.progressKey, "player_tutorial_started")
        XCTAssertEqual(LearnAudience.coach.progressKey, "coach_tutorial_started")
    }

    func testLegacyTutorialProgressCountsForPlayersOnly() {
        let legacyProgress = ["tutorial_started": true]

        XCTAssertTrue(LearnAudience.player.started(in: legacyProgress))
        XCTAssertFalse(LearnAudience.coach.started(in: legacyProgress))
    }

    func testAudienceProgressDoesNotLeakBetweenCourses() {
        let playerProgress = ["player_tutorial_started": true]
        let coachProgress = ["coach_tutorial_started": true]

        XCTAssertTrue(LearnAudience.player.started(in: playerProgress))
        XCTAssertFalse(LearnAudience.coach.started(in: playerProgress))
        XCTAssertTrue(LearnAudience.coach.started(in: coachProgress))
        XCTAssertFalse(LearnAudience.player.started(in: coachProgress))
    }

    func testLegacyPlayerCompletionStillWritesTheNewKeyOnFirstPlayback() {
        XCTAssertTrue(LearnAudience.player.needsProgressWrite(in: [
            "tutorial_started": true,
        ]))
        XCTAssertFalse(LearnAudience.player.needsProgressWrite(in: [
            "player_tutorial_started": true,
            "tutorial_started": true,
        ]))
    }

    func testTutorialRouteCarriesItsAudience() {
        XCTAssertEqual(LearnVideosRoute(.player).audience, .player)
        XCTAssertEqual(LearnVideosRoute(.coach).audience, .coach)
    }

    func testLearnAudienceSwitchUsesTheWorkspaceSwitcherEligibility() {
        XCTAssertTrue(LearnAudienceAccess.canSwitch(
            isCoach: true, coachesAnyone: false, metadataCoach: false,
            playerSetupPending: false
        ))
        XCTAssertTrue(LearnAudienceAccess.canSwitch(
            isCoach: false, coachesAnyone: true, metadataCoach: false,
            playerSetupPending: false
        ))
        XCTAssertTrue(LearnAudienceAccess.canSwitch(
            isCoach: false, coachesAnyone: false, metadataCoach: true,
            playerSetupPending: false
        ))
        XCTAssertFalse(LearnAudienceAccess.canSwitch(
            isCoach: false, coachesAnyone: false, metadataCoach: false,
            playerSetupPending: false
        ))
    }

    func testPendingPlayerSetupSuppressesTheLearnAudienceSwitch() {
        XCTAssertFalse(LearnAudienceAccess.canSwitch(
            isCoach: true, coachesAnyone: true, metadataCoach: true,
            playerSetupPending: true
        ))
    }

    @MainActor
    func testTutorialRequestIdentifiesCoursePlatformAndChapter() throws {
        let data = try JSONEncoder().encode(
            TutorialURLRequest(course: .coach, slug: "coach-feedback")
        )
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: String]
        )

        XCTAssertEqual(object, [
            "course": "coach",
            "platform": "ios",
            "slug": "coach-feedback",
        ])
    }
}

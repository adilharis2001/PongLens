import AVFoundation
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

    func testPlayerIOSCatalogExcludesWebOnlyYouTubeImport() throws {
        let store = try loadStore()
        let playerGuides = store.guides(for: .player)
        let uploadGuide = try XCTUnwrap(
            playerGuides.first { $0.slug == "upload-a-video" }
        )

        XCTAssertFalse(playerGuides.contains { $0.slug == "upload-from-youtube" })
        XCTAssertTrue(store.search("youtube", audience: .player).isEmpty)
        XCTAssertFalse(
            store.related(for: uploadGuide, audience: .player)
                .contains { $0.slug == "upload-from-youtube" }
        )
        XCTAssertFalse(store.groups(for: .player).contains { $0.lowercased().contains("youtube") })
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

    func testTutorialProgressWaitsForObservedPlaybackTime() {
        var gate = TutorialProgressGate()

        XCTAssertFalse(gate.shouldWrite(
            currentSeconds: 0, isPlaying: true, alreadyRecorded: false
        ))
        XCTAssertFalse(gate.shouldWrite(
            currentSeconds: 0.5, isPlaying: false, alreadyRecorded: false
        ))
        XCTAssertFalse(gate.shouldWrite(
            currentSeconds: .infinity, isPlaying: true, alreadyRecorded: false
        ))
        XCTAssertTrue(gate.shouldWrite(
            currentSeconds: 0.25, isPlaying: true, alreadyRecorded: false
        ))
    }

    func testTutorialProgressWritesOnlyOncePerCourseScreen() {
        var gate = TutorialProgressGate()

        XCTAssertTrue(gate.shouldWrite(
            currentSeconds: 0.25, isPlaying: true, alreadyRecorded: false
        ))
        XCTAssertFalse(gate.shouldWrite(
            currentSeconds: 1.0, isPlaying: true, alreadyRecorded: false
        ))
    }

    func testRecordedTutorialProgressConsumesTheFirstPlaybackWithoutWriting() {
        var gate = TutorialProgressGate()

        XCTAssertFalse(gate.shouldWrite(
            currentSeconds: 0.25, isPlaying: true, alreadyRecorded: true
        ))
        XCTAssertFalse(gate.shouldWrite(
            currentSeconds: 1.0, isPlaying: true, alreadyRecorded: false
        ))
    }

    @MainActor
    func testCoachEntryChooserOffersWritingAndAudioOnly() {
        let choices = CoachNewEntryChoice.available
        let visibleCopy = choices
            .flatMap { [$0.title, $0.detail] }
            .joined(separator: " ")
            .lowercased()

        XCTAssertEqual(choices.map(\.kind), [.write, .audio])
        XCTAssertFalse(visibleCopy.contains("video"))
        XCTAssertFalse(visibleCopy.contains("coming soon"))
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

    func testTutorialChapterLoadFailureStaysAttachedToTheRequestedChapter() {
        var state = TutorialChapterLoadState()
        let first = state.begin(index: 0)
        XCTAssertTrue(state.succeed(first))
        XCTAssertEqual(state.selectedIndex, 0)
        XCTAssertTrue(state.isReady)

        let second = state.begin(index: 3)
        XCTAssertEqual(state.selectedIndex, 3)
        XCTAssertTrue(state.isLoading)
        XCTAssertFalse(state.fail(first), "a stale request cannot replace the selected chapter")
        XCTAssertTrue(state.fail(second))
        XCTAssertEqual(state.failedIndex, 3)
        XCTAssertFalse(state.isReady)
    }

    func testRetryStartsAUniqueLoadForTheFailedChapter() {
        var state = TutorialChapterLoadState()
        let failedRequest = state.begin(index: 2)
        XCTAssertTrue(state.fail(failedRequest))

        let retry = state.begin(index: 2)
        XCTAssertNotEqual(retry, failedRequest)
        XCTAssertEqual(state.selectedIndex, 2)
        XCTAssertTrue(state.isLoading)
        XCTAssertNil(state.failedIndex)
    }

    @MainActor
    func testStartingAChapterLoadPausesAndClearsThePreviousPlayerItem() {
        let player = AVPlayer()
        player.replaceCurrentItem(with: AVPlayerItem(
            url: URL(fileURLWithPath: "/tmp/previous-tutorial.mp4")
        ))

        resetTutorialPlayerForChapterLoad(player)

        XCTAssertEqual(player.rate, 0)
        XCTAssertNil(player.currentItem)
    }
}

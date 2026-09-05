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

    #if DEBUG
    func testTutorialCaptureScenarioParsesOnlyExactLaunchValues() {
        XCTAssertEqual(
            TutorialCaptureScenario.parse(arguments: [
                "PongLens", "--tutorial-capture", "player-record",
            ]),
            .playerRecord
        )
        XCTAssertEqual(
            TutorialCaptureScenario.parse(arguments: [
                "PongLens", "--tutorial-capture", "coach-audio-lesson",
            ]),
            .coachAudioLesson
        )
        XCTAssertNil(TutorialCaptureScenario.parse(arguments: ["PongLens"]))
        XCTAssertNil(TutorialCaptureScenario.parse(arguments: [
            "PongLens", "--tutorial-capture",
        ]))
        XCTAssertNil(TutorialCaptureScenario.parse(arguments: [
            "PongLens", "--tutorial-capture", "coach-video-lesson",
        ]))
    }

    func testTutorialCaptureTimelinesHaveDeterministicRealScreenPhases() {
        XCTAssertEqual(TutorialCaptureScenario.playerRecord.phase(at: 0), .ready)
        XCTAssertEqual(TutorialCaptureScenario.playerRecord.phase(at: 2.5), .settings)
        XCTAssertEqual(TutorialCaptureScenario.playerRecord.phase(at: 5), .recording)
        XCTAssertEqual(TutorialCaptureScenario.playerRecord.phase(at: 8), .paused)
        XCTAssertEqual(TutorialCaptureScenario.playerRecord.phase(at: 10.5), .handoff)

        XCTAssertEqual(TutorialCaptureScenario.coachAudioLesson.phase(at: 0), .ready)
        XCTAssertEqual(TutorialCaptureScenario.coachAudioLesson.phase(at: 10), .recording)
        XCTAssertEqual(TutorialCaptureScenario.coachAudioLesson.phase(at: 19), .paused)
        XCTAssertEqual(TutorialCaptureScenario.coachAudioLesson.phase(at: 27), .writingUp)
        XCTAssertEqual(TutorialCaptureScenario.coachAudioLesson.phase(at: 34), .transcriptReview)
        XCTAssertEqual(TutorialCaptureScenario.coachAudioLesson.phase(at: 41), .review)
    }

    func testCoachTutorialReviewPhasesSelectBothRealReviewTabs() {
        XCTAssertEqual(
            LessonRecordScreen.tutorialReviewTab(for: .transcriptReview)?.rawValue,
            "Transcript"
        )
        XCTAssertEqual(
            LessonRecordScreen.tutorialReviewTab(for: .review)?.rawValue,
            "Notes"
        )
        XCTAssertNil(LessonRecordScreen.tutorialReviewTab(for: .writingUp))
    }

    func testPlayerTutorialCaptureCannotPrepareScoreListenerFromSettingsObserver() throws {
        let sourceURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("PongLens/Screens/RecordScreen.swift")
        let source = try String(contentsOf: sourceURL, encoding: .utf8)
        let observerStart = try XCTUnwrap(
            source.range(of: ".onChange(of: settings.callOutScore)")
        )
        let observerTail = source[observerStart.lowerBound...]
        let observerEnd = try XCTUnwrap(observerTail.range(of: ".onDisappear"))
        let observer = String(observerTail[..<observerEnd.lowerBound])

        XCTAssertTrue(
            observer.contains("guard !tutorialCaptureActive else { return }"),
            "The spoken-score settings observer must not prepare ScoreListener during tutorial capture"
        )
        XCTAssertTrue(
            observer.contains("#if DEBUG") && observer.contains("#endif"),
            "The capture-only observer guard must stay excluded from Release"
        )
    }

    func testEveryTutorialCaptureHookIsInsideADebugCompilationBranch() throws {
        let sourceRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("PongLens")
        let relativePaths = [
            "Core/TutorialCaptureScenario.swift",
            "App/Router.swift",
            "App/RootView.swift",
            "Screens/RecordScreen.swift",
            "Screens/LessonRecordScreen.swift",
        ]

        for relativePath in relativePaths {
            let source = try String(
                contentsOf: sourceRoot.appendingPathComponent(relativePath),
                encoding: .utf8
            )
            let hookLines = debugProtection(of: source)
                .filter { $0.text.localizedCaseInsensitiveContains("tutorialCapture") }

            XCTAssertFalse(hookLines.isEmpty, "\(relativePath) has no tutorial capture hook")
            XCTAssertTrue(
                hookLines.allSatisfy(\.isDebugProtected),
                "\(relativePath) exposes a tutorial capture hook outside #if DEBUG"
            )
        }
    }

    private func debugProtection(of source: String) -> [(text: String, isDebugProtected: Bool)] {
        struct Branch {
            let parentProtected: Bool
            let conditionIsDebug: Bool
            var activeProtected: Bool
        }

        var stack: [Branch] = []
        var protected = false
        var result: [(String, Bool)] = []

        for rawLine in source.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(rawLine)
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("#if ") {
                let isDebug = trimmed == "#if DEBUG"
                stack.append(Branch(
                    parentProtected: protected,
                    conditionIsDebug: isDebug,
                    activeProtected: protected || isDebug
                ))
                protected = stack.last?.activeProtected ?? protected
            } else if trimmed == "#else", var branch = stack.popLast() {
                branch.activeProtected = branch.conditionIsDebug
                    ? branch.parentProtected
                    : branch.activeProtected
                stack.append(branch)
                protected = branch.activeProtected
            } else if trimmed == "#endif", let branch = stack.popLast() {
                protected = branch.parentProtected
            } else {
                result.append((line, protected))
            }
        }
        return result
    }
    #endif

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

    func testCoachSupportRoutesResolveInsteadOfOpeningAnEmptyDestination() {
        XCTAssertEqual(
            AppRouteDestination.resolve("learn", workspace: .coach),
            .learn
        )
        XCTAssertEqual(
            AppRouteDestination.resolve("learn-videos", workspace: .coach),
            .tutorialVideos(.coach)
        )
        XCTAssertEqual(
            AppRouteDestination.resolve("feedback", workspace: .coach),
            .feedback(matchId: nil)
        )
    }

    func testPlayerTutorialStringRouteKeepsThePlayerCourse() {
        XCTAssertEqual(
            AppRouteDestination.resolve("learn-videos", workspace: .player),
            .tutorialVideos(.player)
        )
    }

    func testMatchFeedbackRouteCarriesItsMatchInEitherWorkspace() {
        let matchId = UUID(uuidString: "5ba641bf-aef2-4d38-9f1a-9281e53d6bce")!

        XCTAssertEqual(
            AppRouteDestination.resolve(
                "feedback:\(matchId.uuidString.lowercased())",
                workspace: .coach
            ),
            .feedback(matchId: matchId)
        )
        XCTAssertEqual(
            AppRouteDestination.resolve(
                "feedback:\(matchId.uuidString.lowercased())",
                workspace: .player
            ),
            .feedback(matchId: matchId)
        )
        XCTAssertEqual(
            AppRouteDestination.resolve("feedback:not-a-match-id", workspace: .coach),
            .unknown
        )
    }

    func testGuideStringRouteUsesTheActiveWorkspaceCatalog() throws {
        let store = try loadStore()

        guard case .guide(let guide) = AppRouteDestination.resolve(
            "guide:coaching-workspace",
            workspace: .coach,
            catalog: store
        ) else {
            return XCTFail("The coach guide route did not resolve")
        }
        XCTAssertEqual(guide.audience, .coach)
        XCTAssertEqual(guide.slug, "coaching-workspace")
        XCTAssertEqual(
            AppRouteDestination.resolve(
                "guide:coaching-workspace",
                workspace: .player,
                catalog: store
            ),
            .unknown
        )
    }

    func testDirectGuideRelatedLinksAreRegisteredAtBothNavigationRoots() throws {
        let sourceRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("PongLens")
        let registrar = try String(
            contentsOf: sourceRoot.appendingPathComponent("App/AppRoute.swift"),
            encoding: .utf8
        )
        let learnScreen = try String(
            contentsOf: sourceRoot.appendingPathComponent("Screens/LearnScreen.swift"),
            encoding: .utf8
        )

        // A direct guide route skips LearnScreen. The typed links rendered
        // by its Keep going section must therefore be owned by the roots.
        XCTAssertTrue(learnScreen.contains("NavigationLink(value: next)"))
        XCTAssertTrue(registrar.contains("navigationDestination(for: LearnGuide.self)"))
        XCTAssertFalse(learnScreen.contains("navigationDestination(for: LearnGuide.self)"))
        for root in ["MainTabView.swift", "CoachTabView.swift"] {
            let source = try String(
                contentsOf: sourceRoot.appendingPathComponent("App/\(root)"),
                encoding: .utf8
            )
            XCTAssertTrue(source.contains(".appRoutes()"), root)
        }
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
    func testDismissDuringDelayedTutorialLoadCannotInstallPlayback() async {
        var state = TutorialChapterLoadState()
        let request = state.begin(index: 1)
        let player = AVPlayer()
        var installedObserver = false
        var startedPlayback = false
        let delayedResponse = Task {
            await Task.yield()
            return URL(fileURLWithPath: "/tmp/late-tutorial.mp4")
        }

        state.cancel()
        let url = await delayedResponse.value
        let accepted = finishTutorialPlayerLoadIfCurrent(
            request: request,
            state: &state,
            player: player,
            url: url,
            installObserver: { installedObserver = true },
            startPlayback: { startedPlayback = true }
        )

        XCTAssertFalse(accepted)
        XCTAssertNil(state.selectedIndex)
        XCTAssertFalse(state.isLoading)
        XCTAssertNil(player.currentItem)
        XCTAssertFalse(installedObserver)
        XCTAssertFalse(startedPlayback)
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

import XCTest
import SwiftUI
@testable import PongLens

@MainActor
final class MatchIssueTests: XCTestCase {
    func testMissingRallyOffersCanDescribeEitherEndWithoutInventingANeighbor() {
        let start = InsertSeamPair(id: UUID(), prev: nil, next: nil, prevNumber: nil, nextNumber: 1)
        let end = InsertSeamPair(id: UUID(), prev: nil, next: nil, prevNumber: 12, nextNumber: nil)
        XCTAssertNil(start.prevNumber)
        XCTAssertEqual(start.nextNumber, 1)
        XCTAssertEqual(end.prevNumber, 12)
        XCTAssertNil(end.nextNumber)
    }

    private let matchId = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
    private let issueId = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!

    private func state(role: String = "owner", status: String = "ready", minutes: Int? = 24,
                       issueStatus: String? = nil, returned: Int? = nil) throws -> MatchIssueState {
        var json: [String: Any] = [
            "role": role, "matchStatus": status, "activeIssue": NSNull(),
            "refundableMinutes": minutes as Any? ?? NSNull(),
            "canPositive": true, "canProblem": true, "canReprocess": true, "canRefund": true,
            "events": [["id": "33333333-3333-4333-8333-333333333333", "issueId": issueId.uuidString,
                        "kind": "submitted", "playerNote": "", "createdAt": "2026-09-07T12:00:00Z"]],
        ]
        if let issueStatus {
            json["activeIssue"] = [
                "id": issueId.uuidString, "matchId": matchId.uuidString, "kind": "reprocess",
                "status": issueStatus, "message": "The first rally is missing.", "resolution": "none",
                "playerNote": "We are checking the cut.", "refundableMinutes": returned as Any? ?? NSNull(),
                "createdAt": "2026-09-07T12:00:00Z", "updatedAt": "2026-09-07T12:00:00Z",
            ] as [String: Any]
        }
        return try JSONDecoder().decode(MatchIssueState.self, from: JSONSerialization.data(withJSONObject: json))
    }

    func testAPIResponseDecodesCamelCaseAndSafeHistory() throws {
        let decoded = try state(issueStatus: "pending")
        XCTAssertEqual(decoded.matchStatus, .ready)
        XCTAssertEqual(decoded.activeIssue?.matchId, matchId)
        XCTAssertEqual(decoded.events.first?.issueId, issueId)
        XCTAssertEqual(decoded.events.first?.kind, "submitted")
        XCTAssertEqual(decoded.refundableMinutes, 24)
    }

    func testOwnerReadyChoicesUseExactServerAmount() throws {
        XCTAssertEqual(try state().choices, [.reprocess, .refund])
        XCTAssertEqual(MatchIssueChoice.refund.label(minutes: 24), "Request 24 minutes back")
        XCTAssertEqual(MatchIssueChoice.refund.label(minutes: 1), "Request 1 minute back")
        XCTAssertEqual(try state(minutes: 0).choices, [.reprocess])
        XCTAssertEqual(try state(minutes: nil).choices, [.reprocess])
    }

    func testServerCapabilitiesCanWithdrawEachOwnerChoice() throws {
        var decoded = try state()
        decoded.canPositive = false
        decoded.canReprocess = false
        decoded.canRefund = false
        // No remedy left: a plain report, never a sheet with nothing on it.
        XCTAssertEqual(decoded.choices, [.problem])
        decoded.canProblem = false
        XCTAssertTrue(decoded.choices.isEmpty)
    }

    func testCoachAndRawAreReportOnlyEvenWithOwnerFlags() throws {
        XCTAssertEqual(try state(role: "coach").choices, [.problem])
        for status in ["uploaded", "processing", "failed"] {
            XCTAssertEqual(try state(status: status).choices, [.problem])
        }
        var coach = try state(role: "coach")
        coach.canProblem = false
        XCTAssertTrue(coach.choices.isEmpty)
    }

    func testPendingAndTerminalRequestsDoNotOfferDuplicateRemedies() throws {
        for status in ["pending", "reprocess_queued", "reprocessing", "candidate_ready",
                       "resolved_reprocessed", "resolved_refunded", "declined", "execution_failed"] {
            XCTAssertTrue(try state(issueStatus: status).choices.isEmpty, status)
        }
        XCTAssertFalse(try state(issueStatus: "recorded").choices.isEmpty)
        XCTAssertFalse(try state(issueStatus: "cancelled").choices.isEmpty)
    }

    func testPollingOnlyFollowsActiveExecution() throws {
        for status in ["pending", "reprocess_queued", "reprocessing", "candidate_ready"] {
            XCTAssertTrue(try state(issueStatus: status).shouldPoll, status)
        }
        for status in ["recorded", "resolved_reprocessed", "resolved_refunded",
                       "declined", "execution_failed", "cancelled"] {
            XCTAssertFalse(try state(issueStatus: status).shouldPoll, status)
        }
        XCTAssertTrue(try state(issueStatus: "pending").canCancel)
        XCTAssertFalse(try state(role: "coach", issueStatus: "pending").canCancel)
        XCTAssertFalse(try state(issueStatus: "reprocess_queued").canCancel)
    }

    private func match(version: String,
                       opponentName: String = "A long tournament opponent name with several extra training details",
                       userSide: String = "near") throws -> MatchRow {
        let json = """
        {"id":"\(matchId)","user_id":"\(issueId)","played_at":"2026-09-07", "status":"ready",
         "opponent_name":"\(opponentName)","user_side":"\(userSide)",
         "created_at":"2026-09-07T12:00:00Z", "active_processing_version_id":"\(version)"}
        """
        return try JSONDecoder().decode(MatchRow.self, from: Data(json.utf8))
    }

    private func point(_ id: UUID, winner: String?) throws -> MatchPoint {
        let json: [String: Any] = ["id": id.uuidString, "match_id": matchId.uuidString, "idx": 0,
            "is_let": false, "starred": false, "deleted": false, "edited": false,
            "tight_start": false, "tight_end": false, "confirmed_winner": winner as Any? ?? NSNull()]
        return try JSONDecoder().decode(MatchPoint.self, from: JSONSerialization.data(withJSONObject: json))
    }

    func testPublishAndRestoreReplacePointStateAndMediaWithoutCopyingOldAnnotations() async throws {
        let old = try match(version: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        let new = try match(version: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
        let oldPoint = try point(UUID(), winner: "user")
        let newPoint = try point(UUID(), winner: nil)
        var current = old
        var loads = 0
        let model = MatchDetailModel(client: MatchDetailClient(
            match: { _ in current },
            snapshot: { row in
                loads += 1
                let original = row.activeProcessingVersionId == old.activeProcessingVersionId
                return MatchDetailSnapshot(points: [original ? oldPoint : newPoint],
                    videoURL: URL(string: original ? "https://example.com/old" : "https://example.com/new"), matchStructure: nil)
            }
        ))
        await model.load(old)
        XCTAssertEqual(model.points.first?.confirmedWinner, .user)
        current = new
        let published = await model.refreshActiveVersion(matchId)
        XCTAssertNotNil(published)
        XCTAssertEqual(model.points.map(\.id), [newPoint.id])
        XCTAssertNil(model.points.first?.confirmedWinner)
        XCTAssertEqual(model.videoURL?.lastPathComponent, "new")
        current = old
        let restored = await model.refreshActiveVersion(matchId)
        XCTAssertNotNil(restored)
        XCTAssertEqual(model.points.map(\.id), [oldPoint.id])
        XCTAssertEqual(model.points.first?.confirmedWinner, .user)
        XCTAssertEqual(model.videoURL?.lastPathComponent, "old")
        XCTAssertEqual(loads, 3)
    }

    func testUnrelatedRefreshDoesNotReloadMediaPointsOrIssueDraft() async throws {
        let row = try match(version: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        var loads = 0
        let media = MatchDetailModel(client: MatchDetailClient(match: { _ in row }, snapshot: { _ in
            loads += 1
            return MatchDetailSnapshot(points: [], videoURL: URL(string: "https://example.com/signed"), matchStructure: nil)
        }))
        await media.load(row)
        let unchanged = await media.refreshActiveVersion(matchId)
        XCTAssertNil(unchanged)
        XCTAssertEqual(loads, 1)
        let initial = try state()
        let issue = MatchIssueModel(matchId: matchId, client: MatchIssueClient(load: { _ in initial },
            submit: { _, _ in throw URLError(.badServerResponse) }, cancel: { _, _ in throw URLError(.badServerResponse) }))
        issue.message = "My unfinished explanation"
        issue.choice = .reprocess
        await issue.load()
        XCTAssertEqual(issue.message, "My unfinished explanation")
        XCTAssertEqual(issue.choice, .reprocess)
    }

    func testPublicationBetweenPointReadAndSigningRefreshesBeforeRetryingMedia() async throws {
        let old = try match(version: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        let new = try match(version: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
        let replacementPoint = try point(UUID(), winner: nil)
        var current = old
        var requested: [UUID?] = []
        let model = MatchDetailModel(client: MatchDetailClient(match: { _ in current }, snapshot: { row in
            requested.append(row.activeProcessingVersionId)
            if row.activeProcessingVersionId == old.activeProcessingVersionId {
                current = new // publish after the old point read, before signing
                throw APIError.http(409, "Match version changed")
            }
            return MatchDetailSnapshot(points: [replacementPoint], videoURL: URL(string: "https://example.com/new"), matchStructure: nil)
        }))
        let result = await model.load(old)
        XCTAssertEqual(result?.activeProcessingVersionId, new.activeProcessingVersionId)
        XCTAssertEqual(requested, [old.activeProcessingVersionId, new.activeProcessingVersionId])
        XCTAssertEqual(model.points.map(\.id), [replacementPoint.id])
        XCTAssertEqual(model.videoURL?.lastPathComponent, "new")
        XCTAssertNil(model.error)
    }

    func testDetailsOrSideSaveRefetchAdoptsPublishedRowWithItsOwnPointsAndMedia() async throws {
        let old = try match(version: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        let saved = try match(version: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                              opponentName: "Saved opponent", userSide: "far")
        let oldPoint = try point(UUID(), winner: "user")
        let newPoint = try point(UUID(), winner: nil)
        var server = old
        let model = MatchDetailModel(client: MatchDetailClient(match: { _ in server }, snapshot: { row in
            let original = row.activeProcessingVersionId == old.activeProcessingVersionId
            return MatchDetailSnapshot(points: [original ? oldPoint : newPoint],
                videoURL: URL(string: original ? "https://example.com/old" : "https://example.com/new"), matchStructure: nil)
        }))
        await model.load(old)
        // The save succeeds, then publication lands before its row refetch.
        server = saved
        let adopted = await model.refetchMatch(matchId)
        XCTAssertEqual(model.currentMatch, adopted)
        XCTAssertEqual(adopted?.opponentName, "Saved opponent")
        XCTAssertEqual(adopted?.userSide, "far")
        XCTAssertEqual(adopted?.activeProcessingVersionId, saved.activeProcessingVersionId)
        XCTAssertEqual(model.loadedVersionId, saved.activeProcessingVersionId)
        XCTAssertEqual(model.points.map(\.id), [newPoint.id])
        XCTAssertNil(model.points.first?.confirmedWinner)
        XCTAssertEqual(model.videoURL?.lastPathComponent, "new")
    }

    func testSameVersionSaveAdoptsDetailsWithoutReplacingLocalPointsOrSignedMedia() async throws {
        let old = try match(version: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        let saved = try match(version: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                              opponentName: "Saved opponent", userSide: "far")
        let oldPoint = try point(UUID(), winner: "user")
        var server = old
        var snapshotLoads = 0
        let model = MatchDetailModel(client: MatchDetailClient(match: { _ in server }, snapshot: { _ in
            snapshotLoads += 1
            return MatchDetailSnapshot(points: [oldPoint], videoURL: URL(string: "https://example.com/signed-old"), matchStructure: nil)
        }))
        await model.load(old)
        model.points[0].starred = true
        server = saved
        let adopted = await model.refetchMatch(matchId)
        XCTAssertEqual(model.currentMatch, adopted)
        XCTAssertEqual(adopted?.opponentName, "Saved opponent")
        XCTAssertEqual(adopted?.userSide, "far")
        XCTAssertEqual(snapshotLoads, 1, "a metadata save must not remint or replace playback")
        XCTAssertEqual(model.points.first?.starred, true)
        XCTAssertEqual(model.videoURL?.lastPathComponent, "signed-old")
    }

    func testSaveRefetchKeepsTheOldRowWhenThePublishedSnapshotCannotLoad() async throws {
        let old = try match(version: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        let new = try match(version: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
        let oldPoint = try point(UUID(), winner: "user")
        var server = old
        let model = MatchDetailModel(client: MatchDetailClient(match: { _ in server }, snapshot: { row in
            if row.activeProcessingVersionId != old.activeProcessingVersionId { throw URLError(.cannotLoadFromNetwork) }
            return MatchDetailSnapshot(points: [oldPoint], videoURL: URL(string: "https://example.com/old"), matchStructure: nil)
        }))
        await model.load(old)
        server = new
        let adopted = await model.refetchMatch(matchId)
        XCTAssertEqual(model.currentMatch, adopted)
        XCTAssertEqual(adopted?.activeProcessingVersionId, old.activeProcessingVersionId)
        XCTAssertEqual(model.loadedVersionId, old.activeProcessingVersionId)
        XCTAssertEqual(model.points.map(\.id), [oldPoint.id])
        XCTAssertEqual(model.videoURL?.lastPathComponent, "old")
        XCTAssertNotNil(model.error)
    }

    func testAutomaticRefundRequiresARealReceiptAndStaysPrivateFromCoach() throws {
        let json = """
        {"role":"owner","matchStatus":"failed","activeIssue":null,"refundableMinutes":0,
         "canPositive":false,"canProblem":true,"canReprocess":false,"canRefund":false,"events":[],
         "automaticRefund":{"minutes":11,"receiptIds":["9007199254740993"]}}
        """
        let decoded = try JSONDecoder().decode(MatchIssueState.self, from: Data(json.utf8))
        XCTAssertEqual(decoded.automaticRefundMessage, "11 processing minutes were returned automatically after processing failed.")
        XCTAssertNil(try state(status: "failed", minutes: 0).automaticRefundMessage)
        let coach = try JSONDecoder().decode(MatchIssueState.self, from: Data(json.replacingOccurrences(of: "\"owner\"", with: "\"coach\"").utf8))
        XCTAssertNil(coach.automaticRefundMessage)
    }

    func testDatabaseReceiptFixturePreservesBigintLedgerIdentity() throws {
        // database.test.ts checks this fixture against match_issue_state on
        // real Postgres, including IDs above JavaScript's safe integer range.
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "automatic-refund", withExtension: "json"))
        let receipt = try JSONDecoder().decode(MatchIssueState.AutomaticRefund.self, from: Data(contentsOf: url))
        XCTAssertEqual(receipt.minutes, 15)
        XCTAssertEqual(receipt.receiptIds, ["9007199254740993", "9223372036854775807"])
    }

    func testBaselineHostedAllowanceAndNotesTeardown() async throws {
        // Baseline components, no transport or processing-feedback model.
        // Exercises the same UIKit-hosted SwiftUI teardown as the snapshots.
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let window = UIWindow(windowScene: scene)
        window.frame = scene.coordinateSpace.bounds
        window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil }
        for _ in 0..<4 {
            let host = UIHostingController(rootView: BaselineTeardownFixture())
            window.rootViewController = host
            host.view.frame = window.bounds
            try await Task.sleep(for: .milliseconds(300))
            window.rootViewController = UIHostingController(rootView: Text("Closed"))
            try await Task.sleep(for: .milliseconds(300))
        }
    }

    func testFeedbackScreenFixtureSnapshots() async throws {
        // Actual SwiftUI screen, fake transport only. No account is signed in.
        let row = try match(version: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let window = UIWindow(windowScene: scene)
        window.frame = scene.coordinateSpace.bounds
        window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil }
        for (name, role, status, issue) in [
            ("ready-owner", "owner", "ready", nil),
            ("raw-owner", "owner", "uploaded", nil),
            ("coach-report", "coach", "ready", nil),
            ("pending", "owner", "ready", "pending"),
            ("reprocessing", "owner", "ready", "reprocessing"),
            ("candidate-ready", "owner", "ready", "candidate_ready"),
            ("refunded", "owner", "ready", "resolved_refunded"),
            ("published", "owner", "ready", "resolved_reprocessed"),
            ("restored", "owner", "ready", "resolved_reprocessed"),
            ("automatic-refund", "owner", "failed", nil),
        ] as [(String, String, String, String?)] {
            var fixture = try state(role: role, status: status, minutes: 11, issueStatus: issue, returned: 11)
            if issue == nil { fixture.events = [] }
            if name == "restored" {
                fixture.events = [MatchIssueEvent(id: UUID(), issueId: issueId, kind: "restored", playerNote: "Restored the original cut.", createdAt: "2026-09-07T14:00:00Z")]
            }
            if name == "automatic-refund" {
                let json = """
                {"role":"owner","matchStatus":"failed","activeIssue":null,"refundableMinutes":0,
                 "canPositive":false,"canProblem":true,"canReprocess":false,"canRefund":false,"events":[],
                 "automaticRefund":{"minutes":11,"receiptIds":["9007199254740993"]}}
                """
                fixture = try JSONDecoder().decode(MatchIssueState.self, from: Data(json.utf8))
            }
            let view = MatchProcessingFeedbackScreen(matchId: matchId,
                client: MatchIssueClient(load: { _ in fixture }, submit: { _, _ in throw URLError(.notConnectedToInternet) }, cancel: { _, _ in throw URLError(.notConnectedToInternet) }),
                mediaClient: MatchDetailClient(match: { _ in row }, snapshot: { _ in MatchDetailSnapshot(points: [], videoURL: nil, matchStructure: nil) }))
            let host = UIHostingController(rootView: view)
            window.rootViewController = host
            host.view.frame = window.bounds
            // Wait for SwiftUI's real task/layout pass, not remote media.
            try await Task.sleep(for: .milliseconds(300))
            host.view.layoutIfNeeded()
            let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
                window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
            }
            let attachment = XCTAttachment(image: image)
            attachment.name = "match-feedback-\(name)-\(Int(window.bounds.width))x\(Int(window.bounds.height))"
            attachment.lifetime = .keepAlways
            add(attachment)
            XCTAssertGreaterThan(image.size.width, 300)
        }
    }

    func testRefundConfirmationUsesReturnedAmountNotCurrentEligibility() throws {
        let refunded = try state(minutes: 0, issueStatus: "resolved_refunded", returned: 24)
        XCTAssertEqual(refunded.statusMessage, "24 processing minutes were returned to your account.")
        let coach = try state(role: "coach", issueStatus: "resolved_refunded", returned: 24)
        XCTAssertEqual(coach.statusMessage, "The request has been reviewed.")
    }

    func testRestoredHistoryDescribesThePreviousActiveVersion() throws {
        var restored = try state(issueStatus: "resolved_reprocessed")
        restored.events = [MatchIssueEvent(id: UUID(), issueId: issueId, kind: "restored", playerNote: "Restored the original cut.", createdAt: "2026-09-07T14:00:00Z")]
        XCTAssertEqual(restored.statusLabel, "Previous version restored")
        XCTAssertEqual(restored.statusMessage, "The previous version is now active.")
        XCTAssertEqual(restored.rowTrailing, "Previous version restored")
        XCTAssertTrue(restored.choices.isEmpty)
    }

    func testFeedbackRoutesStaySeparateInBothNavigationRoots() {
        for workspace in [AppState.Workspace.player, .coach] {
            XCTAssertEqual(AppRouteDestination.resolve("match-feedback:\(matchId)", workspace: workspace), .matchFeedback(matchId))
            XCTAssertEqual(AppRouteDestination.resolve("feedback", workspace: workspace), .feedback(matchId: nil))
            XCTAssertEqual(AppRouteDestination.resolve("match-feedback:bad-id", workspace: workspace), .unknown)
        }
    }

    func testSnakeCaseOwnerNotificationDecodingOpensMatchFeedbackWithoutLibraryLookup() throws {
        for kind in ["match_issue_reported", "match_issue_updated"] {
            let json = """
            {"id":"33333333-3333-4333-8333-333333333333","kind":"\(kind)",
             "match_id":"\(matchId)","title":"Request updated","body":null,
             "href":"/match/\(matchId)/feedback","group_count":1,"read_at":null,"created_at":"2026-09-07T12:00:00Z"}
            """
            let row = try JSONDecoder().decode(NotificationRow.self, from: Data(json.utf8))
            XCTAssertEqual(row.matchFeedbackId, matchId)
            XCTAssertTrue(NotificationsStore.supportedKinds.contains(kind))
        }
    }

    func testAdminReprocessNotificationsKeepTheirAdminDestination() throws {
        for kind in ["match_reprocess_ready", "match_reprocess_failed"] {
            let issueId = UUID()
            let json = """
            {"id":"33333333-3333-4333-8333-333333333333","kind":"\(kind)",
             "match_id":"\(matchId)","title":"Replacement updated","body":null,
             "href":"/admin/issues/\(issueId)","group_count":1,"read_at":null,"created_at":"2026-09-07T12:00:00Z"}
            """
            let row = try JSONDecoder().decode(NotificationRow.self, from: Data(json.utf8))
            XCTAssertNil(row.matchFeedbackId)
            XCTAssertTrue(row.opensHrefDirectly)
            XCTAssertTrue(NotificationsStore.supportedKinds.contains(kind))
        }
    }

    @MainActor
    func testFailedSubmissionKeepsDraftAndReusesIdempotencyKey() async throws {
        let initial = try state()
        var attempts: [MatchIssueSubmission] = []
        let client = MatchIssueClient(
            load: { _ in initial },
            submit: { _, input in attempts.append(input); throw URLError(.networkConnectionLost) },
            cancel: { _, _ in throw URLError(.networkConnectionLost) }
        )
        let model = MatchIssueModel(matchId: matchId, client: client)
        await model.load()
        model.choice = .reprocess
        model.message = "  The first rally is missing.  "
        await model.submit()
        XCTAssertEqual(model.choice, .reprocess)
        XCTAssertEqual(model.message, "  The first rally is missing.  ")
        XCTAssertNotNil(model.error)
        XCTAssertFalse(model.busy)
        await model.submit()
        XCTAssertEqual(attempts.count, 2)
        XCTAssertEqual(attempts.first?.idempotencyKey, attempts.last?.idempotencyKey)
        XCTAssertEqual(attempts.first?.message, "The first rally is missing.")
        model.message = "Different problem"
        await model.submit()
        XCTAssertNotEqual(attempts[1].idempotencyKey, attempts[2].idempotencyKey)
    }

    @MainActor
    func testReportRequiresMessageAndPositiveDoesNotSendHiddenDraft() async throws {
        let coach = try state(role: "coach")
        let model = MatchIssueModel(matchId: matchId, client: MatchIssueClient(
            load: { _ in coach }, submit: { _, _ in XCTFail("Empty report sent"); throw URLError(.badServerResponse) },
            cancel: { _, _ in throw URLError(.badServerResponse) }
        ))
        await model.load()
        XCTAssertEqual(model.selectedChoice, .problem)
        XCTAssertFalse(model.canSubmit)
        await model.submit()
        model.message = "Missing rally"
        XCTAssertTrue(model.canSubmit)
        let attempt = MatchIssueSubmission(choice: .positive, message: "A previous draft")
        XCTAssertEqual(attempt.message, "")
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(attempt)) as? [String: String])
        XCTAssertEqual(object["kind"], "positive")
        XCTAssertNotNil(object["idempotencyKey"])
        XCTAssertNil(object["idempotency_key"])
    }
}

private struct BaselineTeardownFixture: View {
    @State private var notes = NotesStore()
    var body: some View {
        ScrollView {
            AllowanceRequestRow(resource: "minutes")
            Text("\(notes.notes.count) notes")
        }
        .refreshable { notes.loaded = true }
    }
}

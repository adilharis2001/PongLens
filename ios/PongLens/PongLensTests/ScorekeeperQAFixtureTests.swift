#if DEBUG && targetEnvironment(simulator)
import Foundation
import XCTest
@testable import PongLens

@MainActor
final class ScorekeeperQAFixtureTests: XCTestCase {
    private let firstPoint = UUID(uuidString: "33333333-3333-4333-8333-000000000001")!

    func testConfigurationRequiresExactFlagAndClampsDelay() {
        XCTAssertNil(ScorekeeperQAConfiguration.parse(arguments: ["PongLens"]))
        XCTAssertNil(ScorekeeperQAConfiguration.parse(arguments: ["PongLens", "--qa-scorekeeper-extra"]))

        let configuration = ScorekeeperQAConfiguration.parse(arguments: [
            "PongLens", "--qa-scorekeeper", "--qa-delay-ms", "45000",
            "--qa-fail-write", "2", "--qa-start-point", "3",
        ])

        XCTAssertEqual(configuration?.delayMilliseconds, 30_000)
        XCTAssertEqual(configuration?.failureOrdinal, 2)
        XCTAssertEqual(configuration?.startPoint, 3)
    }

    func testValidatorAcceptsOnlyKnownPointAndThreeCoupledFields() throws {
        let request = try request(
            pointID: firstPoint,
            body: [
                "confirmed_winner": "opponent",
                "is_let": false,
                "scored_at_cut_s": 6.25,
            ]
        )

        let write = try ScorekeeperQARequestValidator.validate(request)

        XCTAssertEqual(write.pointID, firstPoint)
        XCTAssertEqual(write.fields.confirmedWinner, "opponent")
        XCTAssertEqual(write.fields.isLet, false)
        XCTAssertEqual(write.fields.scoredAtCutS, 6.25)
    }

    func testFixtureURLSessionMaterializesAndAcceptsDataTaskBody() async throws {
        guard ScorekeeperQAFixture.isEnabled else {
            throw XCTSkip("Requires --qa-scorekeeper")
        }
        let request = try request(
            pointID: firstPoint,
            body: [
                "confirmed_winner": "opponent",
                "is_let": false,
                "scored_at_cut_s": 6.25,
            ]
        )

        let (_, response) = try await ScorekeeperQAFixture.urlSession.data(for: request)

        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 204)
        let accepted = ScorekeeperQAFixture.store.snapshot().events.last {
            $0.phase == .accepted && $0.pointID == firstPoint
        }
        XCTAssertEqual(accepted?.confirmedWinner, "opponent")
        XCTAssertEqual(accepted?.isLet, false)
        XCTAssertEqual(accepted?.scoredAtCutS, 6.25)
    }

    func testValidatorRejectsUnknownTargetsAndPayloadShapes() throws {
        let unknownPoint = UUID(uuidString: "44444444-4444-4444-8444-444444444444")!
        XCTAssertThrowsError(try ScorekeeperQARequestValidator.validate(request(
            pointID: unknownPoint,
            body: [
                "confirmed_winner": NSNull(),
                "is_let": false,
                "scored_at_cut_s": NSNull(),
            ]
        )))

        XCTAssertThrowsError(try ScorekeeperQARequestValidator.validate(request(
            pointID: firstPoint,
            body: [
                "confirmed_winner": "user",
                "is_let": false,
                "scored_at_cut_s": 6,
                "deleted": true,
            ]
        )))

        XCTAssertThrowsError(try ScorekeeperQARequestValidator.validate(request(
            pointID: firstPoint,
            body: [
                "confirmed_winner": "user",
                "is_let": true,
                "scored_at_cut_s": 6,
            ]
        )))

        XCTAssertThrowsError(try ScorekeeperQARequestValidator.validate(request(
            pointID: firstPoint,
            body: [
                "confirmed_winner": NSNull(),
                "is_let": 0,
                "scored_at_cut_s": NSNull(),
            ]
        )))
    }

    func testFailureOrdinalDoesNotAdvanceAcceptedRemoteState() throws {
        let logURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
        let store = ScorekeeperQAStore(
            delayMilliseconds: 0,
            failureOrdinal: 2,
            eventsURL: logURL
        )
        let first = try store.begin(request(
            pointID: firstPoint,
            body: [
                "confirmed_winner": "opponent",
                "is_let": false,
                "scored_at_cut_s": 6.5,
            ]
        ))
        store.finish(first)
        let second = try store.begin(request(
            pointID: firstPoint,
            body: [
                "confirmed_winner": NSNull(),
                "is_let": true,
                "scored_at_cut_s": NSNull(),
            ]
        ))
        store.finish(second)

        let snapshot = store.snapshot()
        XCTAssertEqual(first.result, .accepted)
        XCTAssertEqual(second.result, .failed)
        XCTAssertEqual(snapshot.remote[firstPoint]?.confirmedWinner, "opponent")
        XCTAssertEqual(snapshot.remote[firstPoint]?.isLet, false)
        XCTAssertEqual(snapshot.remote[firstPoint]?.scoredAtCutS, 6.5)
        XCTAssertEqual(snapshot.events.map(\.phase), [
            .submitted, .accepted, .submitted, .failed,
        ])
        XCTAssertEqual(snapshot.unexpectedRequestCount, 0)
    }

    func testUnknownRequestIsCountedAndNeverSubmitted() throws {
        let logURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
        let store = ScorekeeperQAStore(
            delayMilliseconds: 0,
            failureOrdinal: nil,
            eventsURL: logURL
        )
        var request = URLRequest(url: URL(string: "https://www.ponglens.com/api/media-url")!)
        request.httpMethod = "POST"

        XCTAssertThrowsError(try store.begin(request))
        let snapshot = store.snapshot()
        XCTAssertEqual(snapshot.unexpectedRequestCount, 1)
        XCTAssertEqual(snapshot.events.map(\.phase), [.unexpected])
    }

    // MARK: - Answering a card twice

    func testCutValidatorAcceptsTheTwoCutCallsAndRefusesEverythingElse() throws {
        let split = try ScorekeeperQARequestValidator.validateCut(rpc(
            "split_point",
            body: ["p_id": firstPoint.uuidString.lowercased(),
                   "at_t": 4.4, "child_cut_t0": 4.1]
        ))
        XCTAssertEqual(
            split, .split(parent: firstPoint, atT: 4.4, childCutT0: 4.1)
        )

        // An unknown card, a stray key and a wrong type are each refused, so
        // the cut path cannot become a way to write anything else.
        XCTAssertThrowsError(try ScorekeeperQARequestValidator.validateCut(rpc(
            "split_point",
            body: ["p_id": UUID().uuidString.lowercased(),
                   "at_t": 4.4, "child_cut_t0": 4.1]
        )))
        XCTAssertThrowsError(try ScorekeeperQARequestValidator.validateCut(rpc(
            "split_point",
            body: ["p_id": firstPoint.uuidString.lowercased(),
                   "at_t": 4.4, "child_cut_t0": 4.1, "deleted": true]
        )))
        XCTAssertThrowsError(try ScorekeeperQARequestValidator.validateCut(rpc(
            "split_point",
            body: ["p_id": firstPoint.uuidString.lowercased(),
                   "at_t": "4.4", "child_cut_t0": 4.1]
        )))
        XCTAssertThrowsError(try ScorekeeperQARequestValidator.validateCut(rpc(
            "merge_points", body: ["p_ids": []]
        )))
    }

    func testSplitMovesTheParentsEndAndMintsTheHalfThatGetsScored() throws {
        let store = ScorekeeperQAStore(
            delayMilliseconds: 0,
            failureOrdinal: nil,
            eventsURL: FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString)
        )
        let second = UUID(uuidString: "33333333-3333-4333-8333-000000000002")!

        // Point 2 runs 10 to 16 in source seconds, cut-anchored at 9.
        let body = try XCTUnwrap(store.applyCut(
            .split(parent: second, atT: 11.9, childCutT0: 11.6)
        ))
        let child = try JSONDecoder().decode(MatchPoint.self, from: body)

        XCTAssertEqual(child.t0, 11.9, "the new half starts where the cut fell")
        XCTAssertEqual(child.t1, 16, "and keeps the card's own end")
        XCTAssertEqual(child.cutT0, 11.6)
        XCTAssertEqual(child.edited, true)
        XCTAssertEqual(child.tightStart, true)
        XCTAssertNil(child.confirmedWinner, "it is the half still unanswered")

        // The half only exists once it is minted, and scoring it is then a
        // legal write — that pairing is what makes one tap able to do both.
        XCTAssertNoThrow(try ScorekeeperQARequestValidator.validate(request(
            pointID: child.id,
            body: [
                "confirmed_winner": "user",
                "is_let": false,
                "scored_at_cut_s": NSNull(),
            ]
        )))

        // A cut outside the card's own window is refused, the way the real
        // function's window check refuses it.
        XCTAssertNil(store.applyCut(
            .split(parent: second, atT: 99, childCutT0: 20)
        ))

        // And Undo puts the two halves back together.
        XCTAssertNotNil(store.applyCut(.unsplit(
            parent: second, child: child.id, parentT1: 16,
            tightEnd: false, edited: false
        )))
        XCTAssertEqual(store.snapshot().cutCount, 2)
        XCTAssertNil(
            store.snapshot().remote[child.id],
            "the rejoined half stops existing, and its answer goes with it"
        )
    }

    private func rpc(_ name: String, body: [String: Any]) throws -> URLRequest {
        var request = URLRequest(
            url: URL(string: "http://127.0.0.1:54321/rest/v1/rpc/\(name)")!
        )
        request.httpMethod = "POST"
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }

    private func request(pointID: UUID, body: [String: Any]) throws -> URLRequest {
        var request = URLRequest(
            url: URL(string: "http://127.0.0.1:54321/rest/v1/points?id=eq.\(pointID.uuidString.lowercased())")!
        )
        request.httpMethod = "PATCH"
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }
}
#endif

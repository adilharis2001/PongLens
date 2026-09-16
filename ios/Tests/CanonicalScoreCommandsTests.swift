import Foundation

@MainActor
func runCanonicalScoreCommandChecks() async {
    suite("canonical command decoding") {
        let json = """
        {"ok":true,"requestId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","revision":8,
         "snapshot":{"matchId":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","revision":8,
         "status":"current","points":[{"pointId":"cccccccc-cccc-cccc-cccc-cccccccccccc",
         "confirmedWinner":"user","skipKind":null}]},"payload":{"pointId":"cccccccc-cccc-cccc-cccc-cccccccccccc"}}
        """
        let decoded = try! JSONDecoder().decode(
            CanonicalScoreCommandResponse.self, from: Data(json.utf8))
        check(decoded.ok && decoded.revision == 8, "success response decodes")
        check(decoded.snapshot?.points.first?.confirmedWinner == "user", "snapshot point decodes")
    }

    print("\ncanonical command retry and fallback")
    do {
        let match = UUID(uuidString: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")!
        let request = UUID(uuidString: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")!
        var seen: [String] = []
        var attempts = 0
        let transport = CanonicalScoreCommandTransport(
            matchId: match, revision: 7, enabled: true, requestId: { request }
        ) { _, params in
            attempts += 1
            if case .string(let value) = params["p_request_id"] { seen.append(value) }
            if attempts == 1 { throw URLError(.timedOut) }
            return CanonicalScoreCommandResponse(
                ok: true, requestId: request, revision: 8, snapshot: nil,
                payload: nil, code: nil)
        }
        var legacyCalls = 0
        let result = await transport.execute("set_point_outcome_v2", args: [:]) {
            legacyCalls += 1
            return true
        }
        if case .canonical = result { check(true, "retry succeeds canonically") }
        else { check(false, "retry succeeds canonically") }
        check(seen == [request.uuidString.lowercased(), request.uuidString.lowercased()],
              "one request id is reused across retry")
        check(legacyCalls == 0, "ambiguous transport never invokes legacy")
        check(transport.revision == 8, "successful response advances revision")

        let disabled = CanonicalScoreCommandTransport(
            matchId: match, revision: 8, enabled: true
        ) { _, _ in
            CanonicalScoreCommandResponse(
                ok: false, requestId: nil, revision: nil, snapshot: nil,
                payload: nil, code: "not_enabled")
        }
        let fallback = await disabled.execute("set_point_outcome_v2", args: [:]) { "legacy" }
        if case .legacy(let value) = fallback {
            check(value == "legacy", "not_enabled alone uses legacy")
        } else { check(false, "not_enabled alone uses legacy") }
    }

    print("\ncanonical match revision serialization")
    do {
        let match = UUID(uuidString: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")!
        var expected: [Int] = []
        let transport = CanonicalScoreCommandTransport(
            matchId: match, revision: 3, enabled: true
        ) { _, params in
            if case .number(let value) = params["p_expected_revision"] {
                expected.append(Int(value))
            }
            let next = expected.count == 1 ? 4 : 5
            return CanonicalScoreCommandResponse(
                ok: true, requestId: UUID(), revision: next,
                snapshot: nil, payload: nil, code: nil)
        }
        async let first = transport.execute("one", args: [:]) { false }
        async let second = transport.execute("two", args: [:]) { false }
        _ = await (first, second)
        check(expected == [3, 4], "concurrent actions consume successive revisions")
        check(transport.revision == 5, "serialized actions retain latest revision")
    }

    print("\ncanonical rejection and conflict safety")
    do {
        let match = UUID(uuidString: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")!
        var rejectedLegacyCalls = 0
        let rejected = CanonicalScoreCommandTransport(
            matchId: match, revision: 5, enabled: true
        ) { _, _ in
            CanonicalScoreCommandResponse(
                ok: false, requestId: nil, revision: nil, snapshot: nil,
                payload: nil, code: "not_owner")
        }
        let rejectedResult = await rejected.execute("set_point_outcome_v2", args: [:]) {
            rejectedLegacyCalls += 1
            return true
        }
        if case .rejected(let code) = rejectedResult {
            check(code == "not_owner", "authorization rejection remains typed")
        } else { check(false, "authorization rejection remains typed") }
        check(rejectedLegacyCalls == 0, "authorization rejection never invokes legacy")

        var transportAttempts = 0
        var transportLegacyCalls = 0
        let unreachable = CanonicalScoreCommandTransport(
            matchId: match, revision: 5, enabled: true
        ) { _, _ in
            transportAttempts += 1
            throw URLError(.networkConnectionLost)
        }
        let transportResult = await unreachable.execute("split_point_v2", args: [:]) {
            transportLegacyCalls += 1
            return true
        }
        if case .transportError = transportResult {
            check(true, "exhausted retry returns transport error")
        } else { check(false, "exhausted retry returns transport error") }
        check(transportAttempts == 2, "transport makes exactly one retry")
        check(transportLegacyCalls == 0, "ambiguous network failure never invokes legacy")

        let conflictSnapshot = CanonicalScoreSnapshot(
            matchId: match,
            revision: 9,
            status: "current",
            points: [CanonicalScoreSnapshotPoint(
                pointId: UUID(uuidString: "cccccccc-cccc-cccc-cccc-cccccccccccc")!,
                confirmedWinner: "opponent",
                skipKind: nil
            )]
        )
        var conflictLegacyCalls = 0
        let conflicted = CanonicalScoreCommandTransport(
            matchId: match, revision: 5, enabled: true
        ) { _, _ in
            CanonicalScoreCommandResponse(
                ok: false, requestId: nil, revision: 9,
                snapshot: conflictSnapshot, payload: nil, code: "score_conflict")
        }
        let conflictResult = await conflicted.execute("merge_points_v2", args: [:]) {
            conflictLegacyCalls += 1
            return true
        }
        if case .conflict(let snapshot) = conflictResult {
            check(snapshot == conflictSnapshot, "conflict returns authoritative snapshot")
        } else { check(false, "conflict returns authoritative snapshot") }
        check(conflicted.revision == 9, "conflict advances local revision clock")
        check(conflictLegacyCalls == 0, "conflict never invokes legacy")
    }

    print("\ncanonical native mutation coverage")
    do {
        let match = UUID(uuidString: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")!
        let commands = [
            "set_point_outcome_v2", "set_first_server_v2",
            "set_server_override_v2", "set_game_boundary_v2",
            "set_point_visibility_v2", "split_point_v2", "unsplit_point_v2",
            "merge_points_v2", "adjust_point_v2", "insert_point_v2",
        ]
        var seen: [String] = []
        var nextRevision = 1
        let transport = CanonicalScoreCommandTransport(
            matchId: match, revision: 0, enabled: true
        ) { name, _ in
            seen.append(name)
            defer { nextRevision += 1 }
            return CanonicalScoreCommandResponse(
                ok: true, requestId: UUID(), revision: nextRevision,
                snapshot: nil, payload: nil, code: nil)
        }
        for command in commands {
            let result = await transport.execute(command, args: [:]) { false }
            if case .canonical = result { check(true, "\(command) uses canonical transport") }
            else { check(false, "\(command) uses canonical transport") }
        }
        check(seen == commands, "all native score and structure commands retain order")
        check(transport.revision == commands.count, "all native commands share one revision clock")
    }
}

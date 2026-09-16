import Foundation

/// JSON values accepted by Supabase RPC parameters and returned in command
/// payloads. Kept independent of the Supabase SDK so command semantics are
/// covered by the fast Swift suite.
enum CanonicalJSON: Codable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([CanonicalJSON])
    case object([String: CanonicalJSON])

    init(from decoder: Decoder) throws {
        let box = try decoder.singleValueContainer()
        if box.decodeNil() { self = .null }
        else if let value = try? box.decode(Bool.self) { self = .bool(value) }
        else if let value = try? box.decode(Double.self) { self = .number(value) }
        else if let value = try? box.decode(String.self) { self = .string(value) }
        else if let value = try? box.decode([CanonicalJSON].self) { self = .array(value) }
        else { self = .object(try box.decode([String: CanonicalJSON].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var box = encoder.singleValueContainer()
        switch self {
        case .null: try box.encodeNil()
        case .bool(let value): try box.encode(value)
        case .number(let value): try box.encode(value)
        case .string(let value): try box.encode(value)
        case .array(let value): try box.encode(value)
        case .object(let value): try box.encode(value)
        }
    }

    static func uuid(_ value: UUID) -> CanonicalJSON {
        .string(value.uuidString.lowercased())
    }
}

func decodeCanonicalPayload<T: Decodable>(
    _ response: CanonicalScoreCommandResponse,
    key: String,
    as type: T.Type = T.self
) -> T? {
    guard case .object(let payload)? = response.payload,
          let value = payload[key],
          let data = try? JSONEncoder().encode(value)
    else { return nil }
    return try? JSONDecoder().decode(type, from: data)
}

struct CanonicalCompletedGame: Codable, Equatable {
    let gameNumber: Int
    let scoreUser: Int
    let scoreOpponent: Int
    let winner: String?
    let closingPointId: UUID
    let boundarySource: String
}

struct CanonicalScoreSnapshotMatch: Codable, Equatable {
    let gamesUser: Int
    let gamesOpponent: Int
    let currentGameNumber: Int
    let currentScoreUser: Int
    let currentScoreOpponent: Int
    let completedGames: [CanonicalCompletedGame]
    let visiblePointCount: Int
    let answeredPointCount: Int
    let skippedPointCount: Int
    let allVisiblePointsAnswered: Bool
    let firstServer: String?
    let firstServerSource: String?
    let ordering: String

    static let empty = CanonicalScoreSnapshotMatch(
        gamesUser: 0, gamesOpponent: 0, currentGameNumber: 1,
        currentScoreUser: 0, currentScoreOpponent: 0, completedGames: [],
        visiblePointCount: 0, answeredPointCount: 0, skippedPointCount: 0,
        allVisiblePointsAnswered: false, firstServer: nil,
        firstServerSource: nil, ordering: "source_time")
}

struct CanonicalScoreSnapshotPoint: Codable, Equatable {
    let pointId: UUID
    let revision: Int
    let timelineOrdinal: Int
    let displayNumber: Int
    let gameNumber: Int
    let scoreUserBefore: Int
    let scoreOpponentBefore: Int
    let scoreUserAfter: Int
    let scoreOpponentAfter: Int
    let confirmedWinner: String?
    let skipKind: String?
    let resolvedServer: String?
    let serverSource: String
    let serveNumberInBlock: Int?
    let endsGame: Bool
    let gameBoundarySource: String?
    let resolvedGameWinner: String?
    let allVisiblePointsAnsweredThroughHere: Bool

    init(
        pointId: UUID,
        revision: Int = 0,
        timelineOrdinal: Int = 0,
        displayNumber: Int = 1,
        gameNumber: Int = 1,
        scoreUserBefore: Int = 0,
        scoreOpponentBefore: Int = 0,
        scoreUserAfter: Int = 0,
        scoreOpponentAfter: Int = 0,
        confirmedWinner: String?,
        skipKind: String?,
        resolvedServer: String? = nil,
        serverSource: String = "unresolved",
        serveNumberInBlock: Int? = nil,
        endsGame: Bool = false,
        gameBoundarySource: String? = nil,
        resolvedGameWinner: String? = nil,
        allVisiblePointsAnsweredThroughHere: Bool = false
    ) {
        self.pointId = pointId
        self.revision = revision
        self.timelineOrdinal = timelineOrdinal
        self.displayNumber = displayNumber
        self.gameNumber = gameNumber
        self.scoreUserBefore = scoreUserBefore
        self.scoreOpponentBefore = scoreOpponentBefore
        self.scoreUserAfter = scoreUserAfter
        self.scoreOpponentAfter = scoreOpponentAfter
        self.confirmedWinner = confirmedWinner
        self.skipKind = skipKind
        self.resolvedServer = resolvedServer
        self.serverSource = serverSource
        self.serveNumberInBlock = serveNumberInBlock
        self.endsGame = endsGame
        self.gameBoundarySource = gameBoundarySource
        self.resolvedGameWinner = resolvedGameWinner
        self.allVisiblePointsAnsweredThroughHere = allVisiblePointsAnsweredThroughHere
    }
}

struct CanonicalScoreSnapshot: Codable, Equatable {
    let matchId: UUID
    let revision: Int
    let status: String
    let match: CanonicalScoreSnapshotMatch
    let points: [CanonicalScoreSnapshotPoint]

    enum CodingKeys: String, CodingKey {
        case matchId, revision, status, match, points
    }

    init(from decoder: Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        matchId = try box.decode(UUID.self, forKey: .matchId)
        revision = try box.decode(Int.self, forKey: .revision)
        status = try box.decode(String.self, forKey: .status)
        match = try box.decode(CanonicalScoreSnapshotMatch.self, forKey: .match)
        points = try box.decode([CanonicalScoreSnapshotPoint].self, forKey: .points)
        guard status == "current" || status == "empty" else {
            throw DecodingError.dataCorruptedError(
                forKey: .status, in: box,
                debugDescription: "Unsupported canonical score status")
        }
        guard points.allSatisfy({ $0.revision == revision }) else {
            throw DecodingError.dataCorruptedError(
                forKey: .points, in: box,
                debugDescription: "Canonical score snapshot mixes revisions")
        }
    }

    init(
        matchId: UUID,
        revision: Int,
        status: String,
        match: CanonicalScoreSnapshotMatch = .empty,
        points: [CanonicalScoreSnapshotPoint]
    ) {
        self.matchId = matchId
        self.revision = revision
        self.status = status
        self.match = match
        self.points = points
    }
}

struct CanonicalScoreCommandResponse: Codable, Equatable {
    let ok: Bool
    let requestId: UUID?
    let revision: Int?
    let snapshot: CanonicalScoreSnapshot?
    let payload: CanonicalJSON?
    let code: String?
}

struct CanonicalScoreReadResponse: Codable, Equatable {
    let ok: Bool
    let snapshot: CanonicalScoreSnapshot?
    let code: String?
}

enum CanonicalScoreReadExecution: Equatable {
    case canonical(CanonicalScoreSnapshot)
    case legacy(String)
}

/// One typed, read-only boundary for the dormant canonical reader canary.
/// A caller changes display state only for `.canonical`; every unavailable,
/// disabled or malformed response retains the established local fold.
struct CanonicalScoreReader {
    typealias RPC = (UUID) async throws -> CanonicalScoreReadResponse
    let rpc: RPC

    init(rpc: @escaping RPC) { self.rpc = rpc }

    func load(
        matchId: UUID,
        expectedRevision: Int? = nil
    ) async -> CanonicalScoreReadExecution {
        let response: CanonicalScoreReadResponse
        do {
            response = try await rpc(matchId)
        } catch {
            return .legacy("transport_error")
        }
        guard response.ok else {
            switch response.code {
            case "not_enabled", "not_found", "unavailable":
                return .legacy(response.code!)
            default:
                return .legacy("invalid_response")
            }
        }
        guard let snapshot = response.snapshot,
              snapshot.matchId == matchId,
              snapshot.points.allSatisfy({ $0.revision == snapshot.revision })
        else { return .legacy("invalid_response") }
        if let expectedRevision, snapshot.revision != expectedRevision {
            return .legacy("revision_changed")
        }
        return .canonical(snapshot)
    }
}

/// The exact owner-scoring inputs the established native folds read. Kept
/// narrow so shadow diagnostics cannot carry notes, tags, media or timing
/// evidence beyond the source ordering key.
struct CanonicalReaderLegacyPoint {
    let id: UUID
    let idx: Int
    let t0: Double?
    let deleted: Bool
    let isLet: Bool
    let confirmedHow: String?
    let confirmedWinner: Winner?
    let serverOverride: Winner?
    let gameEndOverride: GameEndOverride?
    let gameWinnerOverride: Winner?

    init(
        id: UUID, idx: Int, t0: Double?, deleted: Bool, isLet: Bool,
        confirmedHow: String?, confirmedWinner: Winner?,
        serverOverride: Winner?, gameEndOverride: GameEndOverride?,
        gameWinnerOverride: Winner?
    ) {
        self.id = id
        self.idx = idx
        self.t0 = t0
        self.deleted = deleted
        self.isLet = isLet
        self.confirmedHow = confirmedHow
        self.confirmedWinner = confirmedWinner
        self.serverOverride = serverOverride
        self.gameEndOverride = gameEndOverride
        self.gameWinnerOverride = gameWinnerOverride
    }

    init(_ point: MatchPoint) {
        self.init(
            id: point.id, idx: point.idx, t0: point.t0,
            deleted: point.deleted, isLet: point.isLet,
            confirmedHow: point.confirmedHow,
            confirmedWinner: point.confirmedWinner,
            serverOverride: point.serverOverride,
            gameEndOverride: point.gameEndOverride,
            gameWinnerOverride: point.gameWinnerOverride)
    }
}

struct CanonicalScoreReaderParity: Equatable {
    let revision: Int
    let matches: Bool
    let mismatchedMatchFields: Int
    let mismatchedPoints: Int
    let canonicalPointCount: Int
    let legacyPointCount: Int
}

/// Native shadow comparison against the existing score and serve folds.
/// Only aggregate counts leave this function; no point ids or source rows are
/// returned in the diagnostic.
func compareCanonicalScoreReader(
    _ canonical: CanonicalScoreSnapshot,
    firstServer: Winner?,
    points: [CanonicalReaderLegacyPoint]
) -> CanonicalScoreReaderParity {
    let active = points.filter { !$0.deleted }
    let ordered = active.sorted { left, right in
        if let lt = left.t0, let rt = right.t0, lt != rt { return lt < rt }
        if left.idx != right.idx { return left.idx < right.idx }
        return left.id.uuidString < right.id.uuidString
    }
    let serving = computeServingInputs(
        ordered.map {
            ServeInput(
                id: $0.id, serverOverride: $0.serverOverride,
                isLet: $0.isLet, confirmedWinner: $0.confirmedWinner,
                gameEndOverride: $0.gameEndOverride)
        },
        firstServer: firstServer)

    var walk = BoundaryWalk()
    var gameNumber = 1
    var gamesUser = 0
    var gamesOpponent = 0
    var answeredCount = 0
    var skippedCount = 0
    var answeredThrough = true
    var completed: [CanonicalCompletedGame] = []
    var mismatchedPoints = 0
    var seenCanonical = Set<UUID>()
    let canonicalById = Dictionary(
        uniqueKeysWithValues: canonical.points.map { ($0.pointId, $0) })

    for (ordinal, point) in ordered.enumerated() {
        let beforeUser = walk.you
        let beforeOpponent = walk.them
        let winner = point.isLet ? nil : point.confirmedWinner
        let answered = point.isLet || winner != nil
        answeredThrough = answeredThrough && answered
        if point.isLet { skippedCount += 1 }
        if winner != nil { answeredCount += 1 }

        let ended = stepBoundaryWalk(
            &walk, winner: winner, override: point.gameEndOverride)
        let afterUser = ended?.you ?? walk.you
        let afterOpponent = ended?.them ?? walk.them
        let boundarySource: String? = ended == nil
            ? nil
            : (point.gameEndOverride == .end
                ? "owner_end_override" : "automatic_score")
        let gameWinner = ended.map {
            point.gameWinnerOverride ?? resolvedGameWinner($0)
        } ?? nil
        let skipKind: String? = point.isLet
            ? (point.confirmedHow == "misrecorded" || point.confirmedHow == "other"
                ? point.confirmedHow : "let")
            : nil
        let serve = serving[point.id]
        let serverSource: String = point.serverOverride != nil
            ? "owner_override"
            : (serve?.server != nil ? "rotation" : "unresolved")

        if let state = canonicalById[point.id] {
            seenCanonical.insert(point.id)
            let differs =
                state.timelineOrdinal != ordinal ||
                state.displayNumber != ordinal + 1 ||
                state.gameNumber != gameNumber ||
                state.scoreUserBefore != beforeUser ||
                state.scoreOpponentBefore != beforeOpponent ||
                state.scoreUserAfter != afterUser ||
                state.scoreOpponentAfter != afterOpponent ||
                state.confirmedWinner != winner?.rawValue ||
                state.skipKind != skipKind ||
                state.resolvedServer != serve?.server?.rawValue ||
                state.serverSource != serverSource ||
                state.endsGame != (ended != nil) ||
                state.gameBoundarySource != boundarySource ||
                state.resolvedGameWinner != gameWinner?.rawValue ||
                state.allVisiblePointsAnsweredThroughHere != answeredThrough
            if differs { mismatchedPoints += 1 }
        } else {
            mismatchedPoints += 1
        }

        if let ended, let boundarySource {
            let resolved = point.gameWinnerOverride ?? resolvedGameWinner(ended)
            completed.append(CanonicalCompletedGame(
                gameNumber: gameNumber, scoreUser: ended.you,
                scoreOpponent: ended.them, winner: resolved?.rawValue,
                closingPointId: point.id, boundarySource: boundarySource))
            if resolved == .user { gamesUser += 1 }
            else if resolved == .opponent { gamesOpponent += 1 }
            gameNumber += 1
        }
    }
    mismatchedPoints += canonical.points.filter {
        !seenCanonical.contains($0.pointId)
    }.count

    let expectedFirstServer = firstServer?.rawValue
    let matchChecks = [
        canonical.match.gamesUser == gamesUser,
        canonical.match.gamesOpponent == gamesOpponent,
        canonical.match.currentGameNumber == gameNumber,
        canonical.match.currentScoreUser == walk.you,
        canonical.match.currentScoreOpponent == walk.them,
        canonical.match.completedGames == completed,
        canonical.match.visiblePointCount == ordered.count,
        canonical.match.answeredPointCount == answeredCount,
        canonical.match.skippedPointCount == skippedCount,
        canonical.match.allVisiblePointsAnswered == (!ordered.isEmpty && answeredThrough),
        canonical.match.firstServer == expectedFirstServer,
        canonical.match.firstServerSource == (expectedFirstServer == nil ? nil : "user"),
        canonical.match.ordering == (ordered.allSatisfy { $0.t0 != nil }
            ? "source_time" : "legacy_idx"),
    ]
    let mismatchedMatchFields = matchChecks.filter { !$0 }.count
    return CanonicalScoreReaderParity(
        revision: canonical.revision,
        matches: mismatchedMatchFields == 0 && mismatchedPoints == 0,
        mismatchedMatchFields: mismatchedMatchFields,
        mismatchedPoints: mismatchedPoints,
        canonicalPointCount: canonical.points.count,
        legacyPointCount: ordered.count)
}

enum CanonicalScoreExecution<T> {
    case canonical(CanonicalScoreCommandResponse)
    case legacy(T)
    case conflict(CanonicalScoreSnapshot)
    case rejected(String)
    case transportError
}

/// One revision clock per open match. Calls are serialized because the
/// revision covers the whole match, not one point. A request UUID is minted
/// once and reused for the single network retry; ambiguous failures never
/// fall through to a legacy write that could apply the action twice.
@MainActor
final class CanonicalScoreCommandTransport {
    typealias RPC = (String, [String: CanonicalJSON]) async throws -> CanonicalScoreCommandResponse

    let matchId: UUID
    private(set) var revision: Int
    private let enabled: Bool
    private let rpc: RPC
    private let requestId: () -> UUID
    private var busy = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    init(
        matchId: UUID,
        revision: Int,
        enabled: Bool,
        requestId: @escaping () -> UUID = UUID.init,
        rpc: @escaping RPC
    ) {
        self.matchId = matchId
        self.revision = revision
        self.enabled = enabled
        self.requestId = requestId
        self.rpc = rpc
    }

    private func acquire() async {
        if !busy {
            busy = true
            return
        }
        await withCheckedContinuation { continuation in
            waiters.append(continuation)
        }
    }

    private func release() {
        if waiters.isEmpty {
            busy = false
        } else {
            waiters.removeFirst().resume()
        }
    }

    func execute<T>(
        _ name: String,
        args: [String: CanonicalJSON],
        legacy: () async -> T
    ) async -> CanonicalScoreExecution<T> {
        guard enabled else { return .legacy(await legacy()) }
        await acquire()
        defer { release() }

        let stableRequestId = requestId()
        var params = args
        params["p_match_id"] = .uuid(matchId)
        params["p_request_id"] = .uuid(stableRequestId)
        params["p_expected_revision"] = .number(Double(revision))

        var response: CanonicalScoreCommandResponse?
        for _ in 0..<2 {
            do {
                response = try await rpc(name, params)
                break
            } catch {
                response = nil
            }
        }
        guard let response else { return .transportError }
        if response.ok, let nextRevision = response.revision {
            revision = nextRevision
            return .canonical(response)
        }
        switch response.code {
        case "not_enabled":
            return .legacy(await legacy())
        case "score_conflict":
            guard let snapshot = response.snapshot else { return .transportError }
            revision = snapshot.revision
            return .conflict(snapshot)
        case let code?:
            return .rejected(code)
        default:
            return .transportError
        }
    }
}

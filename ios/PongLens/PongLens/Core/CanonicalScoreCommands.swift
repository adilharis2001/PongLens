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

struct CanonicalScoreSnapshotPoint: Codable, Equatable {
    let pointId: UUID
    let confirmedWinner: String?
    let skipKind: String?

    enum CodingKeys: String, CodingKey {
        case pointId, confirmedWinner, skipKind
    }
}

struct CanonicalScoreSnapshot: Codable, Equatable {
    let matchId: UUID
    let revision: Int
    let status: String
    let points: [CanonicalScoreSnapshotPoint]
}

struct CanonicalScoreCommandResponse: Codable, Equatable {
    let ok: Bool
    let requestId: UUID?
    let revision: Int?
    let snapshot: CanonicalScoreSnapshot?
    let payload: CanonicalJSON?
    let code: String?
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

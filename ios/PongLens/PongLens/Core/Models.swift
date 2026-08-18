import Foundation

// Mirrors src/lib/types.ts — the schema contract.

enum MatchStatus: String, Codable {
    case uploaded, processing, ready, failed
}

struct CountRow: Codable, Hashable {
    let count: Int
}

struct MatchRow: Codable, Identifiable, Hashable {
    let id: UUID
    let userId: UUID
    let opponentName: String?
    let venue: String?
    let matchType: String?
    let playedAt: String
    let status: MatchStatus
    let thumbPath: String?
    let cutPath: String?
    let rawPath: String?
    let durationS: Double?
    let originalName: String?
    let userSide: String?
    let firstServer: String?
    let clipPads: ClipPad?
    let createdAt: String
    let points: [CountRow]?

    var pointCount: Int { points?.first?.count ?? 0 }

    enum CodingKeys: String, CodingKey {
        case id, venue, status, points
        case userId = "user_id"
        case opponentName = "opponent_name"
        case matchType = "match_type"
        case playedAt = "played_at"
        case thumbPath = "thumb_path"
        case cutPath = "cut_path"
        case rawPath = "raw_path"
        case durationS = "duration_s"
        case originalName = "original_name"
        case userSide = "user_side"
        case firstServer = "first_server"
        case clipPads = "clip_pads"
        case createdAt = "created_at"
    }

    static let librarySelect =
        "id,user_id,opponent_name,venue,match_type,played_at,status,thumb_path,cut_path,raw_path,duration_s,original_name,user_side,first_server,clip_pads,created_at,points(count)"
}

/// Full point row for the match screen and player. Mirrors src/lib/types.ts
/// Point (placement JSON deferred to the placement task).
struct MatchPoint: Codable, Identifiable, Hashable {
    let id: UUID
    let matchId: UUID
    let idx: Int
    let t0: Double?
    let t1: Double?
    let cutT0: Double?
    let server: Winner?
    let serverOverride: Winner?
    let isLet: Bool
    let confirmedWinner: Winner?
    let confirmedHow: String?
    let starred: Bool
    let deleted: Bool
    let edited: Bool
    let tightStart: Bool
    let tightEnd: Bool
    let gameEndOverride: GameEndOverride?
    let gameWinnerOverride: Winner?
    let scoredAtCutS: Double?

    enum CodingKeys: String, CodingKey {
        case id, idx, t0, t1, server, starred, deleted, edited
        case matchId = "match_id"
        case cutT0 = "cut_t0"
        case serverOverride = "server_override"
        case isLet = "is_let"
        case confirmedWinner = "confirmed_winner"
        case confirmedHow = "confirmed_how"
        case tightStart = "tight_start"
        case tightEnd = "tight_end"
        case gameEndOverride = "game_end_override"
        case gameWinnerOverride = "game_winner_override"
        case scoredAtCutS = "scored_at_cut_s"
    }

    static let matchSelect =
        "id,match_id,idx,t0,t1,cut_t0,server,server_override,is_let,confirmed_winner,confirmed_how,starred,deleted,edited,tight_start,tight_end,game_end_override,game_winner_override,scored_at_cut_s"

    /// Duration of the rally itself, in seconds.
    var rallySeconds: Double? {
        guard let t0, let t1 else { return nil }
        return max(0, t1 - t0)
    }
}

/// Narrow point row for score computation. The full player-facing point
/// model comes with the match screen.
struct PointRow: Codable, Identifiable, Hashable {
    let id: UUID
    let matchId: UUID
    let idx: Int
    let t0: Double?
    let confirmedWinner: Winner?
    let isLet: Bool?
    let deleted: Bool?
    let gameEndOverride: GameEndOverride?
    let gameWinnerOverride: Winner?

    enum CodingKeys: String, CodingKey {
        case id, idx, t0, deleted
        case matchId = "match_id"
        case confirmedWinner = "confirmed_winner"
        case isLet = "is_let"
        case gameEndOverride = "game_end_override"
        case gameWinnerOverride = "game_winner_override"
    }

    static let scoreSelect =
        "id,match_id,idx,t0,confirmed_winner,is_let,deleted,game_end_override,game_winner_override"
}

struct JobRow: Codable, Identifiable, Hashable {
    let id: UUID
    let status: String
    let kind: String
    let progress: Int
    let originalName: String?
    let options: Options?
    let createdAt: String

    struct Options: Codable, Hashable {
        let matchId: String?
        enum CodingKeys: String, CodingKey { case matchId = "match_id" }
    }

    enum CodingKeys: String, CodingKey {
        case id, status, kind, progress, options
        case originalName = "original_name"
        case createdAt = "created_at"
    }
}

// MARK: - Dates

enum PGDate {
    private static let noFraction: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ssXXXXX"
        return f
    }()

    /// Parses a Postgres timestamptz string, tolerating any fraction length.
    static func parse(_ iso: String) -> Date? {
        var s = iso
        if let dot = s.firstIndex(of: ".") {
            let rest = s[dot...]
            if let tzStart = rest.firstIndex(where: { $0 == "+" || $0 == "Z" || $0 == "-" }) {
                s = String(s[..<dot]) + String(rest[tzStart...])
            } else {
                s = String(s[..<dot]) + "Z"
            }
        }
        if s.hasSuffix("Z") == false, s.range(of: "[+-]\\d\\d:?\\d\\d$", options: .regularExpression) == nil {
            s += "Z"
        }
        return noFraction.date(from: s)
    }

    /// "Jul 23, 2026"
    static func shortDate(_ iso: String) -> String {
        guard let d = parse(iso) else { return "" }
        return d.formatted(.dateTime.month(.abbreviated).day().year())
    }

    /// "7:03 PM"
    static func shortTime(_ iso: String) -> String {
        guard let d = parse(iso) else { return "" }
        return d.formatted(.dateTime.hour().minute())
    }
}

// MARK: - Match title (port of src/lib/matchTitle.ts — never stored, always derived)

enum MatchTitle {
    static let typeLabel: [String: String] = [
        "drills": "Drills", "practice": "Practice", "match": "Match",
        "league": "League", "tournament": "Tournament",
    ]

    private static func untitledHead(_ playedAt: String) -> String {
        let t = PGDate.shortTime(playedAt)
        return t.isEmpty ? "Match" : "Match · \(t)"
    }

    static func parts(
        opponentName: String?, venue: String?, playedAt: String,
        matchType: String? = nil, pointCount: Int? = nil
    ) -> (primary: String, secondary: String) {
        var head: [String] = []
        let opp = (opponentName ?? "").trimmingCharacters(in: .whitespaces)
        let v = (venue ?? "").trimmingCharacters(in: .whitespaces)
        if !opp.isEmpty { head.append(opp) }
        if !v.isEmpty { head.append(v) }
        if head.isEmpty { head.append(untitledHead(playedAt)) }

        var tail: [String] = [PGDate.shortDate(playedAt)]
        if let matchType, let label = typeLabel[matchType] { tail.append(label) }
        if let pointCount, pointCount > 0 {
            tail.append("\(pointCount) point\(pointCount == 1 ? "" : "s")")
        }
        return (head.joined(separator: " · "), tail.joined(separator: " · "))
    }

    static func parts(for match: MatchRow) -> (primary: String, secondary: String) {
        parts(
            opponentName: match.opponentName, venue: match.venue,
            playedAt: match.playedAt, matchType: match.matchType,
            pointCount: match.pointCount
        )
    }
}

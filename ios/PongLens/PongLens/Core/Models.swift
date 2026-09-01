import Foundation

// Mirrors src/lib/types.ts — the schema contract.

enum MatchStatus: String, Codable {
    case uploaded, processing, ready, failed
}

struct CountRow: Codable, Hashable {
    let count: Int
}

/// The slice of matches.match_structure (051) the app reads.
///
/// Mirrors src/lib/types.ts MatchStructureEvidence, cut down to what a
/// screen renders: the per-point summaries and pair verdicts are
/// diagnostics and ride to R2 beside match.json instead. Every field is
/// optional because this column has carried three different shapes — the
/// retired RTMPose v1 experiment, the v2 detector, and null — and a match
/// that fails to decode is a match that will not open.
struct MatchStructure: Codable, Hashable {
    let status: String?
    let sideChanges: [SideChange]?

    /// One detection: between these two rallies the players swapped ends.
    /// `confirmed` is the detector's own precision gate — anything else is
    /// diagnostics and must never reach a screen.
    struct SideChange: Codable, Hashable {
        let afterPointId: UUID?
        /// End of the rally before the gap, in SOURCE seconds. Carried so
        /// a detection still has a position when its rally is deleted.
        let gapT0: Double?
        let confidence: Double?
        let confirmed: Bool?

        enum CodingKeys: String, CodingKey {
            case confidence, confirmed
            case afterPointId = "after_point_id"
            case gapT0 = "gap_t0"
        }
    }

    enum CodingKeys: String, CodingKey {
        case status
        case sideChanges = "side_changes"
    }
}


struct MatchRow: Codable, Identifiable, Hashable {
    let id: UUID
    let userId: UUID
    let jobId: UUID?
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
    let placementStatus: String?
    /// The game-end detector's evidence (140/146). Optional and defaulted
    /// so every construction of MatchRow in tests and previews stands.
    var matchStructure: MatchStructure? = nil
    /// Scores called out at the phone while recording (152). Reference
    /// only: never feeds the scorekeeper or the analysis.
    var spokenScores: [SpokenGameScore]? = nil
    let createdAt: String
    let points: [CountRow]?

    var pointCount: Int { points?.first?.count ?? 0 }

    enum CodingKeys: String, CodingKey {
        case id, venue, status, points
        case userId = "user_id"
        case jobId = "job_id"
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
        case placementStatus = "placement_status"
        case matchStructure = "match_structure"
        case spokenScores = "spoken_scores"
        case createdAt = "created_at"
    }

    static let librarySelect =
        "id,user_id,job_id,opponent_name,venue,match_type,played_at,status,thumb_path,cut_path,raw_path,duration_s,original_name,user_side,first_server,clip_pads,placement_status,spoken_scores,created_at,points(count)"

    /// One match, opened. Adds the game-end detector's evidence, which the
    /// library list has no use for — it is a JSONB blob per row and the
    /// list fetches every match the player owns.
    static let detailSelect = librarySelect + ",match_structure"
}


/// The slice of the worker's umpire suggestion the app reads: the bat
/// contact count. The rest of the suggestion stays server-side.
struct PointSuggestionLite: Codable, Hashable {
    let nHits: Int?
    enum CodingKeys: String, CodingKey {
        case nHits = "n_hits"
    }
}

/// Full point row for the match screen and player. Mirrors src/lib/types.ts
/// Point (placement JSON deferred to the placement task).
struct MatchPoint: Codable, Identifiable, Hashable {
    let id: UUID
    let matchId: UUID
    let idx: Int
    var t0: Double?
    var t1: Double?
    let cutT0: Double?
    let server: Winner?
    var serverOverride: Winner?
    var isLet: Bool
    var confirmedWinner: Winner?
    var confirmedHow: String?
    var starred: Bool
    var deleted: Bool
    var edited: Bool
    var tightStart: Bool
    var tightEnd: Bool
    var gameEndOverride: GameEndOverride?
    var gameWinnerOverride: Winner?
    /// Owner hid the detected side-change marker that sits after this
    /// point (146). Display only — never read by the boundary walk.
    ///
    /// OPTIONAL rather than `Bool = false`, and the default is not the
    /// reason: Swift's synthesized Decodable init does not use property
    /// defaults, so a non-optional Bool throws keyNotFound on any payload
    /// without the key — which is every fixture, every preview, and any
    /// select that has not been updated yet. Optional decodes to nil and
    /// reads as false at the one place that asks.
    var sideChangeDismissed: Bool? = nil
    var scoredAtCutS: Double?
    /// Admin serve-start label (089). Read so the pad's control can show
    /// which rallies already carry one; the time itself never goes on the
    /// pad, since the scrubber already shows a clock and two clocks that can
    /// disagree read as a bug.
    var serveStartAtCutS: Double?
    /// The last moment the ball was PLAYED, in cut seconds (143): the last
    /// bounce on the user's own table, or a bat touch after it when there
    /// is one — a defender standing metres back means the ball is in the
    /// air for over a second between the two. Measured by the worker, never
    /// by a person, and nil wherever nothing was seen. t1 pads it so a
    /// winner tap lands inside; an unscored point has no tap coming, so
    /// this is where its playback can stop instead.
    var rallyEndCutS: Double?
    var lossReasons: [String]?
    var direction: String?
    var misreadKind: String?
    var serveSpin: String?
    var serveSidespin: Bool?
    var serveLength: String?
    var placementFlagged: Bool?
    /// Where this rally's clip lives. Read only to know WHETHER there is
    /// one — the URL itself is always signed through /api/media-url. About
    /// one visible point in twelve has none (the pipeline dropped it), and
    /// a Share row that offers a video which does not exist is worse than
    /// one that says so.
    let clipPath: String?
    let placement: PlacementData?
    /// The umpire suggestion, read ONLY for its hit count — the highlight
    /// picker's receipt that a "long rally" actually contained rallying.
    /// Defaulted so every existing memberwise construction stands.
    var suggestion: PointSuggestionLite? = nil

    var hasClip: Bool { clipPath != nil }

    /// Displayed server until the serving.ts rotation port lands: the
    /// owner's override, else the worker's guess.
    var displayServer: Winner? { serverOverride ?? server }

    enum CodingKeys: String, CodingKey {
        case id, idx, t0, t1, server, starred, deleted, edited, direction, placement
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
        case sideChangeDismissed = "side_change_dismissed"
        case scoredAtCutS = "scored_at_cut_s"
        case serveStartAtCutS = "serve_start_at_cut_s"
        case rallyEndCutS = "rally_end_cut_s"
        case lossReasons = "loss_reasons"
        case misreadKind = "misread_kind"
        case serveSpin = "serve_spin"
        case serveSidespin = "serve_sidespin"
        case serveLength = "serve_length"
        case placementFlagged = "placement_flagged"
        case clipPath = "clip_path"
        case suggestion
    }

    static let matchSelect =
        "id,match_id,idx,t0,t1,cut_t0,server,server_override,is_let,confirmed_winner,confirmed_how,starred,deleted,edited,tight_start,tight_end,game_end_override,game_winner_override,side_change_dismissed,scored_at_cut_s,serve_start_at_cut_s,loss_reasons,direction,misread_kind,serve_spin,serve_sidespin,serve_length,placement_flagged,clip_path,placement,suggestion"

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
    var server: Winner?
    var serverOverride: Winner?
    var starred: Bool?

    init(
        id: UUID, matchId: UUID, idx: Int, t0: Double?,
        confirmedWinner: Winner?, isLet: Bool?, deleted: Bool?,
        gameEndOverride: GameEndOverride?, gameWinnerOverride: Winner?,
        server: Winner? = nil, serverOverride: Winner? = nil, starred: Bool? = nil
    ) {
        self.id = id
        self.matchId = matchId
        self.idx = idx
        self.t0 = t0
        self.confirmedWinner = confirmedWinner
        self.isLet = isLet
        self.deleted = deleted
        self.gameEndOverride = gameEndOverride
        self.gameWinnerOverride = gameWinnerOverride
        self.server = server
        self.serverOverride = serverOverride
        self.starred = starred
    }

    enum CodingKeys: String, CodingKey {
        case id, idx, t0, deleted, server, starred
        case matchId = "match_id"
        case confirmedWinner = "confirmed_winner"
        case isLet = "is_let"
        case gameEndOverride = "game_end_override"
        case gameWinnerOverride = "game_winner_override"
        case serverOverride = "server_override"
    }

    static let scoreSelect =
        "id,match_id,idx,t0,confirmed_winner,is_let,deleted,game_end_override,game_winner_override,server,server_override,starred"
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

struct NoteRow: Codable, Identifiable, Hashable {
    let id: UUID
    let matchId: UUID
    let pointId: UUID?
    let authorId: UUID
    var body: String
    let audioPath: String?
    let imagePath: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, body
        case matchId = "match_id"
        case pointId = "point_id"
        case authorId = "author_id"
        case audioPath = "audio_path"
        case imagePath = "image_path"
        case createdAt = "created_at"
    }
}

struct NoteAuthor: Codable, Hashable {
    let authorId: UUID
    let name: String?

    enum CodingKeys: String, CodingKey {
        case name
        case authorId = "author_id"
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

    /// The types where nobody is keeping score, so serve rotation is not
    /// being followed and every serve affordance is noise.
    static let nonMatchTypes: Set<String> = ["drills", "practice"]

    /// Does serve mean anything for this footage?
    ///
    /// Keyed on the STORED match_type rather than on which button started
    /// the recording, so changing the type on the match page changes the
    /// behaviour with it, in both directions, with nothing to migrate.
    /// An unset type reads as a match, which is what every row created
    /// before this existed is.
    static func tracksServe(_ matchType: String?) -> Bool {
        guard let matchType, !matchType.isEmpty else { return true }
        return !nonMatchTypes.contains(matchType)
    }
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

/// Which door was used to start a recording. It picks the starting
/// match_type and the processing defaults, and then stops mattering:
/// match_type is the stored truth from that point on.
enum MatchKind {
    case match
    case practice

    /// Offering all five types behind both doors is how you end up with a
    /// drills session labelled "Tournament". Each door offers only what it
    /// can honestly be.
    var types: [String] {
        switch self {
        case .match: ["match", "league", "tournament"]
        case .practice: ["practice", "drills"]
        }
    }

    var defaultType: String {
        switch self {
        case .match: "match"
        case .practice: "practice"
        }
    }

    /// Practice footage does not earn its processing minutes back: there is
    /// no score to keep and no serve to map. Both toggles start off and the
    /// owner turns them on deliberately. A match keeps whatever they set in
    /// Record settings, which is the setting doing its job rather than this
    /// overriding it.
    var forcesProcessingOff: Bool { self == .practice }
}

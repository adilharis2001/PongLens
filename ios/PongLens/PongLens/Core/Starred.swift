import Foundation

/// The Starred points shelf: every point the owner has starred, across
/// every match, in one call.
///
/// starred_points() (134) numbers each point within its match and orders
/// the whole set, so nothing here sorts. Grouping walks the rows in the
/// order they arrived and starts a new group when the match id changes,
/// which is only correct BECAUSE the RPC ordered by match. Re-sort them
/// and this quietly produces two groups for one match.

struct StarredPointRow: Codable, Identifiable, Hashable {
    let id: UUID
    let matchId: UUID
    /// Position among the match's VISIBLE points — the number the match
    /// screen prints, not points.idx.
    let displayNo: Int
    let t0: Double?
    let t1: Double?
    let hasClip: Bool
    let confirmedWinner: Winner?
    let confirmedHow: String?
    let direction: String?
    let lossReasons: [String]?
    let isLet: Bool
    /// Timing changed and the clip is being recut, so it may not play yet.
    let edited: Bool
    let opponentName: String?
    let venue: String?
    let playedAt: String
    let matchType: String?
    let hasThumb: Bool

    enum CodingKeys: String, CodingKey {
        case id, t0, t1, direction, venue
        case matchId = "match_id"
        case displayNo = "display_no"
        case hasClip = "has_clip"
        case confirmedWinner = "confirmed_winner"
        case confirmedHow = "confirmed_how"
        case lossReasons = "loss_reasons"
        case isLet = "is_let"
        case edited
        case opponentName = "opponent_name"
        case playedAt = "played_at"
        case matchType = "match_type"
        case hasThumb = "has_thumb"
    }

    /// Seconds of rally, or nil when the timing is missing.
    var rallySeconds: Double? {
        guard let t0, let t1, t1 > t0 else { return nil }
        return t1 - t0
    }

    var durationLabel: String? {
        guard let secs = rallySeconds else { return nil }
        return String(format: "%.1fs", secs)
    }

    /// The frame a tile shows. The clip opens on the pre-serve pad, so
    /// second zero is a player standing still — the same picture on every
    /// tile. A second and a half in is the ball in the air; short rallies
    /// clamp to their own midpoint rather than to a frame they lack.
    var posterTime: Double {
        guard let secs = rallySeconds else { return 1.2 }
        return min(1.5, max(0.4, secs / 2))
    }
}

enum StarredOutcome {
    case won, lost, skipped, unscored
}

extension StarredPointRow {
    var outcome: StarredOutcome {
        if isLet { return .skipped }
        switch confirmedWinner {
        case .user: return .won
        case .opponent: return .lost
        case nil: return .unscored
        }
    }

    var outcomeLabel: String {
        switch outcome {
        case .won: "I won"
        case .lost: "They won"
        case .skipped: skipChipLabel(confirmedHow)
        case .unscored: "Not scored"
        }
    }

    /// The second line, when there is one. Since 062 nothing writes
    /// confirmed_how on a SCORED point — the reasons a point was lost moved
    /// to loss_reasons — so a scored point reads its reasons from there and
    /// a skipped one still reads its reason from confirmed_how.
    func reasonLabel(custom: [CustomReason]) -> String? {
        if isLet { return nil } // already said by outcomeLabel
        return lossReasonsSummary(lossReasons, custom: custom)
            ?? howLabel(confirmedHow)
    }

    var directionLabel: String? {
        switch direction {
        case "fh": "Forehand side"
        case "bh": "Backhand side"
        case "mid": "Middle"
        default: nil
        }
    }
}

struct StarredGroup: Identifiable, Hashable {
    let matchId: UUID
    let playedAt: String
    let hasThumb: Bool
    /// "Julian · Pingpod"
    let title: String
    /// "Aug 22, 2026 · Match"
    let subtitle: String
    var points: [StarredPointRow]

    var id: UUID { matchId }
}

func groupStarred(_ rows: [StarredPointRow]) -> [StarredGroup] {
    var groups: [StarredGroup] = []
    for row in rows {
        if groups.last?.matchId != row.matchId {
            let parts = MatchTitle.parts(
                opponentName: row.opponentName, venue: row.venue,
                playedAt: row.playedAt, matchType: row.matchType
            )
            groups.append(
                StarredGroup(
                    matchId: row.matchId, playedAt: row.playedAt,
                    hasThumb: row.hasThumb, title: parts.primary,
                    subtitle: parts.secondary, points: []
                )
            )
        }
        groups[groups.count - 1].points.append(row)
    }
    return groups
}

/// "67 points · 21 matches" — a count, not a description of the page.
func starredSummaryLine(_ rows: [StarredPointRow]) -> String {
    let matches = Set(rows.map(\.matchId)).count
    return "\(rows.count) point\(rows.count == 1 ? "" : "s") · "
        + "\(matches) match\(matches == 1 ? "" : "es")"
}

// MARK: - Picking points across matches (2026-09-22)
//
// The web twin is src/app/starred/starred.ts (the bar) and
// src/lib/starredSelection.ts (the limits); starred.test.ts and
// StarredTests.swift check the same cases.

enum StarredSelection {
    /// A link names up to this many points (share_links_check says so too).
    static let linkMaxPoints = 100
    /// A video renders up to this many (enqueue_selection_reel says so too).
    static let videoMaxPoints = 60
    /// Instagram takes a minute in a Reel.
    static let instagramMaxSeconds: Double = 60
}

/// "0:28", "1:05" — the m:ss every phone shows for a length.
func clockLabel(_ seconds: Double) -> String {
    let s = max(0, Int(seconds.rounded()))
    return "\(s / 60):" + String(format: "%02d", s % 60)
}

/// Total rally time of a set of points, in seconds (missing timing adds 0).
func selectionSeconds(_ rows: [StarredPointRow]) -> Double {
    rows.reduce(0) { $0 + ($1.rallySeconds ?? 0) }
}

/// The selection bar: "3 points · 0:28".
func selectionSummary(_ rows: [StarredPointRow]) -> String {
    "\(rows.count) point\(rows.count == 1 ? "" : "s") · "
        + clockLabel(selectionSeconds(rows))
}

/// The picked rows in shelf order, whatever order they were tapped in: the
/// video and the link play them the way the shelf lists them.
func selectedInShelfOrder(
    _ rows: [StarredPointRow], _ selected: Set<UUID>
) -> [StarredPointRow] {
    rows.filter { selected.contains($0.id) }
}

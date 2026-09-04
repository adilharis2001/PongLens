import Foundation
import Supabase

/// Game scores for somebody else's matches.
///
/// Two surfaces need them and neither is the player's own library: a
/// coach's student page, and the head start offered while inviting a
/// coach. ScoresStore is the wrong tool for both — it walks the caller's
/// own matches and computes a season of pressure and streak statistics,
/// which is a great deal of work to get one pair of numbers.
///
/// The walk itself is `computeMatchScore`, the same one the player's app
/// runs everywhere else and the same one the web reads through
/// useScoreChips. A coach and a player must never be looking at two
/// different scores for one match; that is worth more than any saving
/// from computing it a cheaper way.
struct MatchScoreChip: Hashable {
    let you: Int
    let them: Int
    /// Every rally has a winner. False means the score will still move,
    /// which the caller should say rather than print a number as final.
    let complete: Bool
}

enum CoachMatchScores {
    /// Reads in chunks the way ScoresStore does: PostgREST caps a filter
    /// list, and a student with a season of matches would otherwise send
    /// one enormous query.
    static func load(matchIds: [UUID]) async -> [UUID: MatchScoreChip] {
        guard !matchIds.isEmpty else { return [:] }
        var byMatch: [UUID: [PointRow]] = [:]

        var start = 0
        while start < matchIds.count {
            let chunk = Array(matchIds[start..<min(start + 50, matchIds.count)])
            start += 50
            var page = 0
            while true {
                do {
                    let rows: [PointRow] = try await supa
                        .from("points")
                        .select(PointRow.scoreSelect)
                        .in("match_id", values: chunk.map { $0.uuidString.lowercased() })
                        .order("match_id")
                        .order("idx")
                        .range(from: page * 1000, to: page * 1000 + 999)
                        .execute()
                        .value
                    for row in rows {
                        byMatch[row.matchId, default: []].append(row)
                    }
                    if rows.count < 1000 { break }
                    page += 1
                } catch {
                    break
                }
            }
        }

        var out: [UUID: MatchScoreChip] = [:]
        for (matchId, rows) in byMatch {
            let visible = sortPoints(rows.filter { !($0.deleted ?? false) })
            // Nothing scored is not a score of nil-nil: a match nobody has
            // been through yet should show no chip at all.
            guard visible.contains(where: { $0.confirmedWinner != nil }) else {
                continue
            }
            let score = computeMatchScore(visible)
            let unscored = visible.contains {
                $0.confirmedWinner == nil && !($0.isLet ?? false)
            }
            out[matchId] = MatchScoreChip(
                you: score.gamesYou,
                them: score.gamesThem,
                complete: !unscored && !score.games.isEmpty
            )
        }
        return out
    }
}

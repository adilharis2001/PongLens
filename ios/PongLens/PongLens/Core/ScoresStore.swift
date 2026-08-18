import Foundation
import Supabase

/// Games scores for library cards, computed client-side from points through
/// the same walk the match page uses — mirroring the web, which chunks 50
/// match ids per query and pages 1000 rows (the PostgREST cap).
@Observable
final class ScoresStore {
    struct Entry: Hashable {
        let gamesYou: Int
        let gamesThem: Int
        let confirmedCount: Int
        let pointCount: Int
        let unscoredCount: Int
    }

    private(set) var scores: [UUID: Entry] = [:]
    private var loading = false

    func load(for matchIds: [UUID]) async {
        guard !loading, !matchIds.isEmpty else { return }
        loading = true
        defer { loading = false }

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

        for (matchId, rows) in byMatch {
            let visible = sortPoints(rows.filter { !($0.deleted ?? false) })
            let score = computeMatchScore(visible)
            let unscored = visible.filter {
                !($0.isLet ?? false) && $0.confirmedWinner == nil
            }.count
            scores[matchId] = Entry(
                gamesYou: score.gamesYou,
                gamesThem: score.gamesThem,
                confirmedCount: score.confirmedCount,
                pointCount: visible.count,
                unscoredCount: unscored
            )
        }
    }
}

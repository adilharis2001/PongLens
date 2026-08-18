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
        var serveWon = 0
        var served = 0
        var receiveWon = 0
        var received = 0
        var anyStarred = false

        /// A match counts toward the record only when fully scored — every
        /// point decided (mirrors the web's aggregation rule).
        var fullyScored: Bool { confirmedCount > 0 && unscoredCount == 0 }
        var won: Bool? {
            guard fullyScored, gamesYou != gamesThem else { return nil }
            return gamesYou > gamesThem
        }
    }

    private(set) var scores: [UUID: Entry] = [:]
    private var loading = false

    func load(for matches: [MatchRow]) async {
        let matchIds = matches.map(\.id)
        let firstServers = Dictionary(
            uniqueKeysWithValues: matches.map {
                ($0.id, $0.firstServer.flatMap(Winner.init(rawValue:)))
            }
        )
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
            var entry = Entry(
                gamesYou: score.gamesYou,
                gamesThem: score.gamesThem,
                confirmedCount: score.confirmedCount,
                pointCount: visible.count,
                unscoredCount: unscored
            )
            entry.anyStarred = visible.contains { $0.starred == true }
            let serving = computeServingInputs(
                visible.map(\.serveInput),
                firstServer: firstServers[matchId] ?? nil
            )
            for p in visible where !(p.isLet ?? false) && p.confirmedWinner != nil {
                switch serving[p.id]?.server {
                case .user:
                    entry.served += 1
                    if p.confirmedWinner == .user { entry.serveWon += 1 }
                case .opponent:
                    entry.received += 1
                    if p.confirmedWinner == .user { entry.receiveWon += 1 }
                case nil:
                    break
                }
            }
            scores[matchId] = entry
        }
    }
}

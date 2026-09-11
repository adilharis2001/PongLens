import Foundation

/// A first-party link into a match, in the shape the server writes it:
/// `/match/<match id>`, with `?p=<point id>` when the link is about one
/// rally rather than the whole match.
///
/// The notifications trigger writes it (migration 031, a coach's note), the
/// note feed and Ask answers carry it, and the web's MatchView reads `?p=`
/// to open that point's own view. Every iOS surface that follows one of
/// these links has to take it apart the same way, or the same notification
/// lands in two different places depending on which list it was tapped in —
/// which is exactly what it did: the bell dropped the point and opened the
/// top of the match, while the journal's copy of this parse opened the
/// point (Adil, 2026-09-10).
struct MatchPointLink: Equatable {
    let matchId: UUID
    let pointId: UUID?

    /// Nil when the href is not a match link, or names something that is not
    /// a match id. A query it does not recognise is not a failure: anything
    /// but `p=` is ignored and the link still opens the match, because
    /// refusing to open it would be a worse answer than opening it at the
    /// top.
    init?(href: String) {
        guard href.hasPrefix("/match/") else { return nil }
        let pieces = href.dropFirst("/match/".count).split(separator: "?", maxSplits: 1)
        guard let first = pieces.first,
              let matchId = UUID(uuidString: String(first))
        else { return nil }
        self.matchId = matchId
        self.pointId = pieces.count > 1 ? Self.point(in: pieces[1]) : nil
    }

    private static func point(in query: Substring) -> UUID? {
        for pair in query.split(separator: "&") where pair.hasPrefix("p=") {
            return UUID(uuidString: String(pair.dropFirst(2)))
        }
        return nil
    }
}

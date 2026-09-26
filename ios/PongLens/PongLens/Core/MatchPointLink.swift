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

/// Where tapping a bell row goes, worked out from the row alone so the
/// playing root, the coaching root and the tests all read one answer.
///
/// A failed cut or upload used to open nothing on iPhone: its row carried
/// only a link (`/match/<id>` or `/upload`), no match id, and the bell only
/// followed match ids (post-rollout audit G, 2026-09-26). The database now
/// writes the match id when the match exists, and a row without one still
/// opens the match its link names.
enum BellDestination: Equatable {
    /// A page the root maps itself (Account, the Feedback board, Coaching),
    /// or a web-only one (admin review).
    case href(String)
    /// The private report about how a match was processed.
    case matchFeedback(UUID)
    /// A match, and the point inside it when the row names one.
    case match(UUID, pointId: UUID?)
    /// The upload screen: an upload or an import that failed.
    case upload

    static let feedbackKinds: Set<String> = ["match_issue_reported", "match_issue_updated"]

    init(kind: String, matchId: UUID?, href: String) {
        // Admin review is web-only work: its link wins over the match id,
        // which would otherwise open the ordinary match.
        if href.hasPrefix("/admin/") {
            self = .href(href)
            return
        }
        if Self.feedbackKinds.contains(kind), let matchId {
            self = .matchFeedback(matchId)
            return
        }
        let link = MatchPointLink(href: href)
        if let id = matchId ?? link?.matchId {
            self = .match(id, pointId: link?.pointId)
            return
        }
        self = Self.isUpload(href) ? .upload : .href(href)
    }

    /// `/upload`, the link every failed upload and import carries.
    static func isUpload(_ href: String) -> Bool {
        href == "/upload" || href.hasPrefix("/upload?") || href.hasPrefix("/upload#")
    }
}

import Foundation
import Supabase

/// The parts of the sample match that need something beyond Foundation: the
/// dismissal rows, and the "has this player scored one of their own yet"
/// question that reads the score store.
///
/// Split out of `SampleMatch.swift` on 2026-09-18. That file is compiled by
/// `ios/Tests/run.sh`, a plain swiftc build with no Swift Package Manager
/// dependencies, because `Models.swift` names a match with `SampleMatch.title`.
/// While the two halves sat together, one `import Supabase` stopped the whole
/// logic-check suite from building. The words and the pure rules stay there;
/// anything with a dependency belongs here.
extension SampleMatch {
    /// Has this player finished scoring a match of their own? Same meaning as
    /// the library's score chip: every point answered.
    static func hasOwnScoredMatch(
        ownMatches: [MatchRow],
        scores: [UUID: ScoresStore.Entry]
    ) -> Bool {
        ownMatches.contains { scores[$0.id]?.fullyScored == true }
    }

    /// Has this account removed the sample from its own library? One row,
    /// theirs alone: the match itself is ours and never moves.
    static func isDismissed() async -> Bool {
        struct Row: Decodable { let user_id: UUID }
        let rows: [Row]? = try? await supa
            .from("sample_match_dismissals")
            .select("user_id")
            .limit(1)
            .execute()
            .value
        return (rows?.isEmpty == false)
    }

    /// Remove it for this account only. Nothing is deleted.
    static func dismiss(userId: UUID) async -> Bool {
        do {
            try await supa
                .from("sample_match_dismissals")
                .insert(["user_id": userId.uuidString])
                .execute()
            return true
        } catch {
            return false
        }
    }
}

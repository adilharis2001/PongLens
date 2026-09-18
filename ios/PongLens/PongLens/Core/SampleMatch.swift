import Foundation
import Supabase

/// The sample match: one finished match every signed-in account can read.
///
/// It is ONE match, owned by us and read by everybody (the database opens it
/// through `has_match_access`), so a new account pays no storage for it and
/// nobody can change it: every write policy stays owner-scoped.
///
/// It shows on Home and in the library until the player has scored a match of
/// their own, and Account → Support keeps a way back to it after that. The
/// words live here so iOS and web say the same thing (src/lib/sampleMatch.ts).
enum SampleMatch {
    static let chip = "Demo"
    /// Named for what it is, not for who played in it.
    static let title = "PongLens demo match"
    static let cta = "View sample match"
    static let firstStep = "Review the sample match"
    static let note = "A real match between the two of us who built PongLens."
    /// The two players, unnamed, wherever the analysis would use real names.
    static let nearLabel = "Player 1"
    static let farLabel = "Player 2"
    /// Notes on the sample are ours, signed PongLens.
    static let noteAuthor = "PongLens"

    /// The pair of labels in the app's own "me / them" terms, so a card
    /// that would say "Me" and "Anton" says "Player 2" and "Player 1"
    /// instead. The uploader's own side comes first, exactly as the maps
    /// are drawn: whoever uploaded is at the bottom.
    static func labels(userSide: String?) -> (you: String, them: String) {
        userSide == "near" ? (nearLabel, farLabel) : (farLabel, nearLabel)
    }

    static func isSample(_ match: MatchRow) -> Bool { match.isSample == true }

    /// The match itself, if the account can see one.
    static func find(in matches: [MatchRow]) -> MatchRow? {
        matches.first { isSample($0) }
    }

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

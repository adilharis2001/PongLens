import Foundation

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
    static let doorTitle = "See a finished match first"
    static let doorBody = "Ours, already processed and scored."
    static let doorCTA = "Open the sample match"
    static let accountRow = "View sample match"
    static let note = "A real match between the two of us who built PongLens."

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
}

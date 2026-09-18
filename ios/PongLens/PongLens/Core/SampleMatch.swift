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
///
/// Foundation only, on purpose. `Models.swift` reads `title` when it names a
/// match, and `ios/Tests/run.sh` compiles that file with a plain swiftc
/// invocation that has no Swift Package Manager dependencies. An `import
/// Supabase` here takes the whole logic-check suite down with it, which is
/// what happened on 2026-09-18. Everything that needs the network or the
/// score store lives in `SampleMatchStore.swift` instead.
enum SampleMatch {
    static let chip = "Demo"
    /// Named for what it is, not for who played in it.
    static let title = "PongLens Demo Match"
    static let cta = "View sample match"
    static let firstStep = "Review the sample match"
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
}

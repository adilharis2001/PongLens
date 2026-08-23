import Foundation

/// Whether the "Who served first?" sheet has been waved away for a match.
///
/// The rotation for a whole match hangs off that one answer, so the pad
/// asks for it the first time you score a match that has not got one. But
/// a question you have already declined is not a question any more, and
/// asking again on every entry is the behaviour of something that is not
/// listening. Declining is recorded here; answering writes the match row
/// and nothing needs recording.
enum FirstServerPrompt {
    private static let key = "firstServerSkipped"

    private static var skipped: Set<String> {
        Set(UserDefaults.standard.stringArray(forKey: key) ?? [])
    }

    static func isSkipped(_ matchId: UUID) -> Bool {
        skipped.contains(matchId.uuidString)
    }

    static func markSkipped(_ matchId: UUID) {
        var next = skipped
        next.insert(matchId.uuidString)
        UserDefaults.standard.set(Array(next), forKey: key)
    }
}

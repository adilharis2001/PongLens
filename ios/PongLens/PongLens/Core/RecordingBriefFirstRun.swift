import Foundation

/// The stateful half of the recording-brief rule: reads both copies of the
/// count, asks `RecordingBriefGate`, and writes the answer back.
///
/// The rule itself is in CameraGuideGate.swift, with no storage and no
/// Supabase in it, so it can be checked against the same table of cases
/// the web port is checked against. This file is the part that cannot be
/// tested without a session, and it is deliberately thin.
///
/// Seen means FINISHED. `markDone` is called from the last page's button
/// and nowhere else, so a brief that was quit halfway comes back from page
/// one at the next door.
///
/// Twin of src/components/RecordingBriefFirstRun.tsx.
@MainActor
enum RecordingBriefFirstRun {
    /// Should the brief open itself now.
    ///
    /// - Parameter hasAnyMatch: nil when the library has not finished
    ///   loading. Unknown is treated as "do not show": guessing false
    ///   there would interrupt exactly the accounts the back-fill exists
    ///   to skip, and a new account that taps that fast simply meets the
    ///   brief at its next door.
    static func shouldShow(app: AppState, hasAnyMatch: Bool?) -> Bool {
        guard let userId = app.userId, let hasAnyMatch else { return false }
        let key = storageKey(userId)
        let decision = RecordingBriefGate.gate(
            seen: CameraGuideGate.readSeenCount(
                account: app.metadataValue(RecordingBriefGate.metadataKey),
                device: UserDefaults.standard.object(forKey: key)
            ),
            hasAnyMatch: hasAnyMatch
        )
        if let seed = decision.seed { persist(seed, key: key, app: app) }
        return decision.show
    }

    /// The last page's button was tapped.
    static func markDone(app: AppState) {
        guard let userId = app.userId else { return }
        persist(RecordingBriefGate.done, key: storageKey(userId), app: app)
    }

    /// Lowercased to match the id the web half keys on. The two stores
    /// never actually meet, but a key that reads differently on each
    /// platform is a trap laid for whoever next has to compare them.
    private static func storageKey(_ userId: UUID) -> String {
        RecordingBriefGate.storageKey(userId: userId.uuidString.lowercased())
    }

    private static func persist(_ value: Int, key: String, app: AppState) {
        // Locally first, and unconditionally. The likeliest place on earth
        // to be opening the recorder is a sports hall with bad wifi; if the
        // account write is the only one, it fails there and the brief
        // returns a second time.
        UserDefaults.standard.set(value, forKey: key)
        Task { await app.setMetadataInt(RecordingBriefGate.metadataKey, value) }
    }
}

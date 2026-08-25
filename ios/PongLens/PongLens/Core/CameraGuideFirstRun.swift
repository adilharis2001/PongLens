import Foundation

/// The stateful half of the camera-guide rule: reads both copies of the
/// count, asks `CameraGuideGate`, and writes the answer back.
///
/// The rule itself is next door in CameraGuideGate.swift, with no
/// storage and no Supabase in it, so it can be checked against the same
/// table of cases the web port is checked against. This file is the part
/// that cannot be tested without a session, and it is deliberately thin.
///
/// Twin of src/components/CameraGuideFirstRun.tsx.
@MainActor
enum CameraGuideFirstRun {
    /// At most one automatic showing per launch. In memory on purpose:
    /// "this launch" is exactly as long as the process lives, and the two
    /// showings are meant to land on two separate occasions rather than
    /// two minutes apart on the way from Record to Upload.
    private static var shownThisLaunch = false

    /// Should the guide open itself now — and record it if so.
    ///
    /// - Parameter hasAnyMatch: nil when the library has not finished
    ///   loading. Unknown is treated as "do not show": guessing false
    ///   there would interrupt exactly the accounts the back-fill exists
    ///   to skip, and a new account that taps that fast simply meets the
    ///   sheet at its next door.
    static func shouldAutoShow(app: AppState, hasAnyMatch: Bool?) -> Bool {
        guard let userId = app.userId, let hasAnyMatch else { return false }

        // Lowercased to match the id the web half keys on. The two stores
        // never actually meet — UserDefaults is the app, localStorage is
        // the browser — but a key that reads differently on each platform
        // is a trap laid for whoever next has to compare them.
        let key = CameraGuideGate.storageKey(userId: userId.uuidString.lowercased())
        let decision = CameraGuideGate.gate(
            seen: CameraGuideGate.readSeenCount(
                account: app.metadataValue(CameraGuideGate.metadataKey),
                device: UserDefaults.standard.object(forKey: key)
            ),
            hasAnyMatch: hasAnyMatch,
            shownThisSession: shownThisLaunch
        )

        if let persist = decision.persist {
            // Locally first, and unconditionally. The likeliest place on
            // earth to be opening the recorder is a sports hall with bad
            // wifi; if the account write is the only one, it fails there
            // and the sheet returns a third and a fourth time.
            UserDefaults.standard.set(persist, forKey: key)
            Task { await app.setMetadataInt(CameraGuideGate.metadataKey, persist) }
        }
        if decision.show { shownThisLaunch = true }
        return decision.show
    }
}

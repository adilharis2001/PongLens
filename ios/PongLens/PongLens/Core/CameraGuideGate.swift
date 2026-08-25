import Foundation

/// How often a first-run account is shown "Where to place the camera"
/// without asking for it.
///
/// Where the camera goes decides whether the pipeline finds any points at
/// all, so the sheet now opens on its own at the three doors out of the
/// New match chooser. Twice, then never again — long enough to be read,
/// short enough that it never becomes the thing you swipe away on the way
/// to somewhere else.
///
/// Twin of `src/lib/cameraGuideGate.ts`. Both are checked against the same
/// table of cases in `ios/Tests/fixtures/camera-guide-gate.json`, rather
/// than each being read against the same paragraph — which is exactly how
/// the placement mirror survived eight months wrong in two files at once.
///
/// Manual opens are deliberately NOT counted. The "How to record" trigger
/// stays on every screen it is on today and spends nothing, because the
/// two automatic showings are worth saving for the moment somebody is
/// standing at a table about to film.
enum CameraGuideGate {
    static let maxShowings = 2

    /// Lives beside first_steps_dismissed and tutorial_started.
    static let metadataKey = "camera_guide_seen"

    /// The device-local mirror, keyed by user id because one simulator and
    /// one browser both get shared between accounts.
    static func storageKey(userId: String) -> String {
        "pl-camera-guide-seen:\(userId)"
    }

    struct Decision: Equatable {
        /// Open the sheet now, unasked.
        let show: Bool
        /// Write this to both copies, or nil when nothing needs writing.
        let persist: Int?
    }

    static func coerce(_ value: Any?) -> Int? {
        guard let value, !(value is NSNull) else { return nil }
        if let n = value as? Int { return n >= 0 ? n : nil }
        if let d = value as? Double {
            guard d.isFinite, d >= 0 else { return nil }
            return Int(d.rounded(.down))
        }
        if let s = value as? String {
            let t = s.trimmingCharacters(in: .whitespaces)
            // ASCII digits only, to match the /^\d+$/ the web rule uses.
            guard !t.isEmpty, t.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
            return Int(t)
        }
        return nil
    }

    /// The count, read from both copies at once.
    ///
    /// The account copy (user_metadata) is what makes "twice" mean twice
    /// for the person rather than twice per device. The device copy is
    /// what holds the cap when the network does not: the likeliest place
    /// on earth to be opening the recorder is a sports hall with bad wifi,
    /// and if the write to Supabase fails there, an account-only counter
    /// never moves and the sheet comes back a third and a fourth time.
    ///
    /// nil — and only nil — means neither copy has ever been written,
    /// which is what separates a new account from one seeded to zero.
    static func readSeenCount(account: Any?, device: Any?) -> Int? {
        let a = coerce(account)
        let d = coerce(device)
        if a == nil, d == nil { return nil }
        return max(a ?? 0, d ?? 0)
    }

    /// - Parameters:
    ///   - seen: `readSeenCount`, nil when never recorded
    ///   - hasAnyMatch: does the account already have footage in it
    ///   - shownThisSession: has one already opened this launch
    static func gate(seen: Int?, hasAnyMatch: Bool, shownThisSession: Bool) -> Decision {
        var effective = seen
        var seed: Int?

        // Back-fill. Nobody has a counter on the day this ships, so
        // without this every existing account gets interrupted twice —
        // including accounts with forty matches that plainly know where
        // the camera goes.
        //
        // Keyed on ABSENT, never on zero. A genuinely new account that has
        // just recorded its first match sits at 1 and must still get its
        // second showing, so "already has footage" can only be asked once,
        // before the counter exists.
        if seen == nil, hasAnyMatch {
            effective = maxShowings
            seed = maxShowings
        }

        // At most one automatic showing per launch. Without it, tapping
        // Record and then Upload in the same five minutes spends the whole
        // budget two minutes apart and the second showing teaches nothing.
        if shownThisSession { return Decision(show: false, persist: seed) }

        let count = effective ?? 0
        if count < maxShowings {
            return Decision(show: true, persist: count + 1)
        }
        return Decision(show: false, persist: seed)
    }
}

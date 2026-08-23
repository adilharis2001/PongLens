import Foundation

/// First-time gesture hints for the player, per device. Port of
/// src/app/match/[id]/gestureHints.ts.
///
/// The contract: a hint appears at most twice, one hint at a time, and dies
/// forever the first time its gesture is actually used. Feedback does the
/// long-term teaching; hints only cover discovery, and the gestures sheet
/// is the replay path — so nothing ever needs to nag.
enum GestureHint: String, CaseIterable {
    /// Double-tap the sides to skip a rally.
    case doubleTap = "dtap"
    /// Hold a side for temporary speed.
    case hold
    /// The first auto-pause in Keep score.
    case score
}

enum GestureHints {
    private static let shownKey = "ponglens.gestureHints.shown"
    private static let doneKey = "ponglens.gestureHints.done"
    private static let maxShows = 2

    private static var shown: [String: Int] {
        get { UserDefaults.standard.dictionary(forKey: shownKey) as? [String: Int] ?? [:] }
        set { UserDefaults.standard.set(newValue, forKey: shownKey) }
    }

    private static var done: [String: Bool] {
        get { UserDefaults.standard.dictionary(forKey: doneKey) as? [String: Bool] ?? [:] }
        set { UserDefaults.standard.set(newValue, forKey: doneKey) }
    }

    static func eligible(_ hint: GestureHint) -> Bool {
        done[hint.rawValue] != true && (shown[hint.rawValue] ?? 0) < maxShows
    }

    static func markShown(_ hint: GestureHint) {
        var s = shown
        s[hint.rawValue] = (s[hint.rawValue] ?? 0) + 1
        shown = s
    }

    /// The gesture was used for real: its hint never shows again.
    static func markDone(_ hint: GestureHint) {
        guard done[hint.rawValue] != true else { return }
        var d = done
        d[hint.rawValue] = true
        done = d
    }

    /// What to teach on this open, if anything: the double tap first, then
    /// hold-for-speed once the double tap is learned or spent.
    static func nextWatchHint() -> GestureHint? {
        if eligible(.doubleTap) { return .doubleTap }
        if eligible(.hold) { return .hold }
        return nil
    }

    static func message(_ hint: GestureHint) -> String {
        switch hint {
        case .doubleTap: "Double-tap the sides to skip a point, the middle to see it again"
        case .hold: "Hold a side for slow motion or double speed"
        case .score: "Tap who won this point"
        }
    }
}

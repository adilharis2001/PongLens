import CoreGraphics

/// Which third of the picture a double tap landed in.
///
/// Port of `src/app/match/[id]/tapZone.ts`, kept deliberately dumb so the
/// two platforms cannot drift: the boundaries are the whole behaviour.
///
/// The split used to be halves — left went back a point, right went
/// forward. Thirds keep both of those exactly where they were, so nobody's
/// muscle memory breaks, and give the middle to replaying the rally on
/// screen: the thing people reach for most often and the only one of the
/// three with no gesture at all.
///
/// NOT used by press-and-hold, which keeps its own left/right halves. Two
/// different gestures do not need the same boundary, and thirds there
/// would leave the middle of the frame unable to change speed.
enum TapZone {
    case prev
    case replay
    case next

    /// - Parameters:
    ///   - x: Tap position measured from the left of the picture.
    ///   - width: The picture's width in the same units.
    ///
    /// A zero or negative width is a surface that has not been measured
    /// yet. That answers `.replay`, the harmless one: replaying the rally
    /// already on screen is a no-op you can see, where a mis-resolved
    /// "next" would silently move you somewhere you did not ask to go.
    static func of(x: CGFloat, width: CGFloat) -> TapZone {
        guard width > 0 else { return .replay }
        let fraction = x / width
        if fraction < 1.0 / 3 { return .prev }
        if fraction > 2.0 / 3 { return .next }
        return .replay
    }
}

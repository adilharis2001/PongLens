import Foundation

// Port of src/app/match/[id]/markLandscape.ts: "Mark the points" on a
// phone held sideways, where every zone goes. The approved landscape
// board's renderVals() arithmetic, number for number
// (docs/superpowers/specs/2026-09-24-ios-hand-cut-landscape-mockup.dc.html),
// so the web and the iPhone build the same screen from one statement of it:
//
//   - a solid top bar, 42 tall, across the whole width
//   - a solid bottom bar, 41 tall plus the bottom safe area
//   - between them the picture, as wide as its aspect ratio allows inside
//     the height left, with a rail either side at least 96 wide
//   - 12 of margin inside the left and right safe areas
//
// MarkLandscapeTests.swift holds the web test's cases.

struct MarkLandscapeInsets: Equatable {
    var left: Double = 0
    var right: Double = 0
    var bottom: Double = 0
}

struct MarkLandscape: Equatable {
    static let topBarH = 42.0
    static let bottomBarH = 41.0
    /// Space between a rail and the picture, and between tiles in a rail.
    static let railGap = 8.0
    /// A rail is never narrower than this: Scorekeeper's floor.
    static let minRail = 96.0
    /// Inside the left and right safe areas, before the first zone.
    static let sideMargin = 12.0
    /// The Let tile, shorter than Me and Them.
    static let letH = 44.0

    /// Width the rails, the picture and the bars' contents share.
    let avail: Double
    /// Left edge of that width (the left safe area plus the margin).
    let x0: Double
    /// Height between the two bars.
    let midH: Double
    let boxW: Double
    let boxH: Double
    /// A rail's share of the width, gap included, and its tiles' width.
    let rail: Double
    let tileW: Double
    /// Top of the rails and the picture, centred between the bars.
    let yMid: Double
    let leftX: Double
    let picX: Double
    let rightX: Double
    let bottomTop: Double
    let bottomH: Double
    let pairFont: Double
    let answerFont: Double
    /// Me and Them are this tall; Let is `letH`.
    let answerH: Double
    /// Each tile of a two-tile pair.
    let pairHalf: Double

    /// The layout for a `w` x `h` screen with the given safe areas.
    /// `aspect` is the video's width over height; a nonsense value falls
    /// back to the board's 16:9.
    init(w: Double, h: Double, insets: MarkLandscapeInsets = MarkLandscapeInsets(),
         aspect: Double = 16.0 / 9.0) {
        let sl = insets.left
        let sr = insets.right
        let sb = insets.bottom
        let ar = aspect > 0 && aspect.isFinite ? aspect : 16.0 / 9.0

        avail = w - sl - sr - 2 * Self.sideMargin
        midH = h - sb - Self.topBarH - Self.bottomBarH
        boxW = max(0, min(avail - 2 * Self.minRail, midH * ar))
        boxH = boxW / ar
        rail = max(Self.minRail, (avail - boxW) / 2)
        tileW = rail - Self.railGap
        x0 = sl + Self.sideMargin
        yMid = Self.topBarH + (midH - boxH) / 2
        leftX = x0
        picX = x0 + rail
        rightX = picX + boxW + Self.railGap
        bottomTop = Self.topBarH + midH
        bottomH = Self.bottomBarH + sb
        pairFont = tileW >= 150 ? 22 : tileW >= 100 ? 19 : 16
        answerFont = tileW >= 150 ? 30 : tileW >= 100 ? 26 : 22
        answerH = (boxH - 2 * Self.railGap - Self.letH) / 2
        pairHalf = (boxH - Self.railGap) / 2
    }

    // MARK: - The right rail

    enum Tone: String { case lit, unlit, off }

    enum Action: String {
        case beginCutting, beginReview, keepMarking, reviewPoints
        case begin, reset, end, adjust, confirm, resume
    }

    struct PairTile: Equatable {
        let label: String
        let action: Action
        let tone: Tone
        /// Share of the rail's height: 1 is the whole rail.
        let share: Double
    }

    /// The right rail's tiles, top to bottom: the pair, in the same two
    /// slots whatever they mean, or the gate before the session starts.
    static func railPair(
        started: Bool, opened: HandCutOpenAs, reviewing: Bool, adjusting: Bool, open: Bool
    ) -> [PairTile] {
        if !started {
            if opened == .choice {
                return [
                    PairTile(label: "Keep marking", action: .keepMarking, tone: .lit, share: 0.58),
                    PairTile(label: "Review the points", action: .reviewPoints, tone: .unlit, share: 0.42),
                ]
            }
            return opened == .review
                ? [PairTile(label: "Begin review", action: .beginReview, tone: .lit, share: 1)]
                : [PairTile(label: "Begin Cutting", action: .beginCutting, tone: .lit, share: 1)]
        }
        if reviewing {
            return adjusting
                ? [
                    PairTile(label: "Confirm", action: .confirm, tone: .lit, share: 0.5),
                    PairTile(label: "Resume", action: .resume, tone: .off, share: 0.5),
                ]
                : [
                    PairTile(label: "Adjust", action: .adjust, tone: .lit, share: 0.5),
                    PairTile(label: "Resume", action: .resume, tone: .unlit, share: 0.5),
                ]
        }
        return open
            ? [
                PairTile(label: "Reset", action: .reset, tone: .unlit, share: 0.5),
                PairTile(label: "End Point", action: .end, tone: .lit, share: 0.5),
            ]
            : [
                PairTile(label: "Begin Point", action: .begin, tone: .lit, share: 0.5),
                PairTile(label: "End Point", action: .end, tone: .off, share: 0.5),
            ]
    }

    /// A tile's height for a rail `boxH` tall.
    static func pairTileHeight(_ tile: PairTile, count: Int, boxH: Double) -> Double {
        if count <= 1 { return boxH }
        return (boxH - railGap * Double(count - 1)) * tile.share
    }
}

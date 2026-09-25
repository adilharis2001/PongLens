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
        case beginCutting, beginReview, keepMarking, reviewPoints, startAgain
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
    /// `startAgain` adds the outlined Start again under the gate, when a
    /// processed match is marked again and marks exist (cut again contract).
    static func railPair(
        started: Bool, opened: HandCutOpenAs, reviewing: Bool, adjusting: Bool, open: Bool,
        startAgain: Bool = false
    ) -> [PairTile] {
        if !started {
            let again = PairTile(
                label: MarkerCopy.startAgain, action: .startAgain, tone: .unlit, share: 0.26)
            if opened == .choice {
                return startAgain
                    ? [
                        PairTile(label: "Keep marking", action: .keepMarking, tone: .lit, share: 0.44),
                        PairTile(label: "Review the points", action: .reviewPoints, tone: .unlit, share: 0.3),
                        again,
                    ]
                    : [
                        PairTile(label: "Keep marking", action: .keepMarking, tone: .lit, share: 0.58),
                        PairTile(label: "Review the points", action: .reviewPoints, tone: .unlit, share: 0.42),
                    ]
            }
            // A draft with points still to call reaches the gate only when a
            // processed match is marked again; it carries on from the first
            // point without a winner (markLandscape.ts, the same tiles).
            let first = opened == .review
                ? PairTile(label: "Begin review", action: .beginReview, tone: .lit, share: 1)
                : opened == .scoring
                    ? PairTile(label: "Keep marking", action: .beginCutting, tone: .lit, share: 1)
                    : PairTile(label: "Begin Cutting", action: .beginCutting, tone: .lit, share: 1)
            guard startAgain else { return [first] }
            return [PairTile(label: first.label, action: first.action, tone: .lit, share: 0.74), again]
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
                PairTile(label: MarkerCopy.backToLastPoint, action: .reset, tone: .unlit, share: 0.5),
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

// MARK: - The marker's words

/// Words the marker shows in more than one place (portrait pad, landscape
/// board, the match page's accordion), kept together so they cannot drift.
enum MarkerCopy {
    /// The button that undoes a Begin tap made too early (Adil, 2026-09-25:
    /// it used to read "Reset").
    static let backToLastPoint = "Back to last point"
    /// Marking a processed match again, at the gate (cut again contract).
    static let startAgain = "Start again"

    /// The Score switch's label: what the pass is, on or off (Adil,
    /// 2026-09-25). Practice and drills can only be cut.
    static func scoreLabel(on: Bool, practice: Bool) -> String {
        on && !practice ? "Cut and score" : "Cut only"
    }

    /// The one line under the switch, where there is room for it: the
    /// accordion on the match page and in More options.
    static func scoreDetail(on: Bool, practice: Bool) -> String {
        if practice { return "Scoring is for matches." }
        return on ? "Say who won each point as you go." : "Mark where each rally starts and ends."
    }
}

// MARK: - The portrait pad

/// How the portrait pad's controls share their height. The pass fills the
/// pad, the pair above the answers 3:2. The gate does not: its buttons are
/// ordinary buttons at the top of the pad, the same as the web's (Adil,
/// 2026-09-25, build 239: stretched to fill the pad, "Begin Cutting" read as
/// a giant slab; he chose the plain buttons back over a full pad).
struct MarkPortraitPad: Equatable {
    static let gap = 10.0
    static let padding = 12.0
    /// The tool row and the footer.
    static let rowH = 44.0
    static let refusalH = 16.0
    /// The gate's buttons, as the web's (h-16 and h-12).
    static let primaryH = 64.0
    static let secondaryH = 48.0

    /// The pass: the pair and the answers (0 when cutting only).
    static func pass(height: Double, refusal: Bool, answers: Bool) -> (pair: Double, answers: Double) {
        let refusalBlock = refusal ? refusalH + gap : 0
        let fixed = 2 * padding + refusalBlock + rowH + gap + rowH + gap + (answers ? gap : 0)
        let flex = max(0, height - fixed)
        let pair = answers ? max(64, flex * 3 / 5) : max(64, flex)
        return (pair, answers ? max(56, flex * 2 / 5) : 0)
    }

    /// The gate: `buttons` is 1 or 2. Fixed heights whatever the pad; the
    /// space under them stays empty until the pass begins.
    static func gate(
        height: Double, refusal: Bool, buttons: Int, startAgain: Bool
    ) -> (primary: Double, secondary: Double) {
        (primaryH, buttons > 1 ? secondaryH : 0)
    }
}

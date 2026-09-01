import Foundation

// Port of src/app/match/[id]/insertGeometry.ts — where a card for a rally
// the cutter dropped can go, and where it lands in the cut video.
//
// THE COORDINATE SPACE IS SOURCE SECONDS, unlike every other clip surface
// in the app. Within one point's span the cut keeps source duration intact,
// so Split and Adjust use one linear map and work in cut seconds. Across a
// SEAM that stops holding: the cutter removed footage, so the cut jumps
// while the source runs on. Measured over 9,433 seams in production, 55%
// are continuous and the rest drop anywhere from a fraction of a second to
// over a minute. Source seconds are the only axis the whole neighbourhood
// shares.

/// What the geometry needs from a neighbouring card.
struct InsertNeighbour {
    let id: UUID
    let t0: Double
    let t1: Double
    let cutT0: Double
    let tightStart: Bool
    let tightEnd: Bool
}

extension MatchPoint {
    var insertNeighbour: InsertNeighbour? {
        guard let t0, let t1, let cutT0 else { return nil }
        return InsertNeighbour(
            id: id, t0: t0, t1: t1, cutT0: cutT0,
            tightStart: tightStart, tightEnd: tightEnd
        )
    }
}

struct InsertSpan {
    /// rally start / end in CUT seconds
    let rallyStart: Double
    let rallyEnd: Double
    /// source seconds
    let t0: Double
    let t1: Double
}

func insertSpanOf(_ p: InsertNeighbour?, pad: ClipPad) -> InsertSpan? {
    guard let p else { return nil }
    let eff = effectivePad(pad, tightStart: p.tightStart, tightEnd: p.tightEnd)
    let rallyStart = p.cutT0 + eff.pre
    return InsertSpan(
        rallyStart: rallyStart,
        rallyEnd: rallyStart + max(0, p.t1 - p.t0),
        t0: p.t0, t1: p.t1
    )
}

struct Seam {
    /// the whole neighbourhood, in source seconds
    let from: Double
    let to: Double
    /// the hole between the two cards, in source seconds
    let gapFrom: Double
    let gapTo: Double
    /// source seconds in the gap that are NOT in the cut video
    let removed: Double
    /// the cut is unbroken here: everything in the gap is watchable
    let continuous: Bool
    let prev: InsertSpan?
    let next: InsertSpan?
}

/// Room to show either side when a card is missing on one side.
private let OPEN_END_S = 15.0
/// Below this, "removed" is padding arithmetic rather than lost footage.
private let CONTINUOUS_S = 0.25

func seamBetween(
    _ prevPoint: InsertNeighbour?, _ nextPoint: InsertNeighbour?, pad: ClipPad
) -> Seam? {
    let prev = insertSpanOf(prevPoint, pad: pad)
    let next = insertSpanOf(nextPoint, pad: pad)
    if prev == nil && next == nil { return nil }
    let gapFrom = prev?.t1 ?? (next!.t0 - OPEN_END_S)
    let gapTo = next?.t0 ?? (prev!.t1 + OPEN_END_S)
    // What the cut dropped between the two rallies: how far the source
    // travelled between the rally starts, less how far the cut did.
    var removed = 0.0
    if let prev, let next {
        removed = max(0, next.t0 - prev.t0 - (next.rallyStart - prev.rallyStart))
    }
    return Seam(
        from: prev?.t0 ?? gapFrom,
        to: next?.t1 ?? gapTo,
        gapFrom: gapFrom, gapTo: gapTo,
        removed: removed,
        continuous: removed < CONTINUOUS_S,
        prev: prev, next: next
    )
}

/// Source second -> cut second. Inside either rally the map is exact;
/// inside the hole there is no answer, so it holds at the seam — the frame
/// where the cut jumps from one card to the other.
func sourceToCut(_ seam: Seam, _ s: Double) -> Double {
    if let prev = seam.prev, s <= prev.t1 { return prev.rallyStart + (s - prev.t0) }
    if let next = seam.next, s >= next.t0 { return next.rallyStart + (s - next.t0) }
    if let prev = seam.prev { return prev.rallyEnd }
    if let next = seam.next { return next.rallyStart }
    return 0
}

/// Whether a source second is footage this video can show.
func playableAt(_ seam: Seam, _ s: Double) -> Bool {
    if seam.continuous { return true }
    if let prev = seam.prev, s <= prev.t1 { return true }
    if let next = seam.next, s >= next.t0 { return true }
    return false
}

struct InsertWindow { var t0: Double; var t1: Double }

/// The shortest thing that can be a rally. Matches insert_point's guard.
let INSERT_MIN_LEN_S = 0.5
/// How much of each neighbour the new card must leave behind. Matches
/// insert_point's "swallows the previous/next point" guard.
let INSERT_EDGE_S = 0.3

func insertBounds(_ seam: Seam) -> (lo: Double, hi: Double) {
    (
        lo: seam.prev.map { $0.t0 + INSERT_EDGE_S } ?? seam.from,
        hi: seam.next.map { $0.t1 - INSERT_EDGE_S } ?? seam.to
    )
}

private func round2(_ v: Double) -> Double { (v * 100).rounded() / 100 }

func clampInsertWindow(_ seam: Seam, _ w: InsertWindow) -> InsertWindow {
    let b = insertBounds(seam)
    var t0 = min(max(w.t0, b.lo), b.hi - INSERT_MIN_LEN_S)
    var t1 = max(min(w.t1, b.hi), b.lo + INSERT_MIN_LEN_S)
    if t1 - t0 < INSERT_MIN_LEN_S { t1 = t0 + INSERT_MIN_LEN_S }
    t0 = round2(t0); t1 = round2(t1)
    return InsertWindow(t0: t0, t1: t1)
}

/// Where the handles open: the gap when there is a real one, otherwise
/// straddling the seam — a rally smeared across its neighbours has to be
/// dragged out of them.
func defaultInsertWindow(_ seam: Seam) -> InsertWindow {
    let gap = seam.gapTo - seam.gapFrom
    if gap >= 1.5 { return InsertWindow(t0: seam.gapFrom, t1: seam.gapTo) }
    let mid = (seam.gapFrom + seam.gapTo) / 2
    return clampInsertWindow(seam, InsertWindow(t0: mid - 0.75, t1: mid + 0.75))
}

func moveInsertHandle(
    _ seam: Seam, _ w: InsertWindow, edge: InsertEdge, to: Double
) -> InsertWindow {
    let b = insertBounds(seam)
    switch edge {
    case .start:
        return InsertWindow(
            t0: round2(min(max(to, b.lo), w.t1 - INSERT_MIN_LEN_S)), t1: w.t1)
    case .end:
        return InsertWindow(
            t0: w.t0, t1: round2(max(min(to, b.hi), w.t0 + INSERT_MIN_LEN_S)))
    }
}

enum InsertEdge { case start, end }

/// The new card's cut_t0 — the span start, so the rally start less the pad
/// the clip is actually cut with. NOT optional: the Keep-score strip skips
/// any point without one, so a card created without it would be invisible
/// in the very screen it was created from.
func insertCutT0(_ seam: Seam, _ w: InsertWindow, pad: ClipPad) -> Double {
    let eff = effectivePad(
        pad, tightStart: seam.prev != nil, tightEnd: seam.next != nil)
    return max(0, round2(sourceToCut(seam, w.t0) - eff.pre))
}

/// Four seconds, low on purpose. The first cut was eight, reasoned from a
/// rally plus its surrounding pauses — and blind to the case that actually
/// hurts: a missed serve is re-served within a couple of seconds, so the gap
/// that swallowed one is short. Nothing signals that a point was eaten, so
/// the choice is only where to put an arbitrary line. Measured over 9,433
/// seams, eight offers on ~13 of a 73-card match and four on ~33.
let GAP_WORTH_OFFERING_S = 4.0

func gapWorthOffering(
    _ prevPoint: InsertNeighbour?, _ nextPoint: InsertNeighbour?, pad: ClipPad
) -> Seam? {
    guard prevPoint != nil, nextPoint != nil,
          let seam = seamBetween(prevPoint, nextPoint, pad: pad),
          seam.prev != nil, seam.next != nil
    else { return nil }
    return seam.gapTo - seam.gapFrom >= GAP_WORTH_OFFERING_S ? seam : nil
}

/// One "+" offer in the Keep-score strip: the two cards a missing rally
/// would sit between. Identifiable on the card it precedes, so the sheet
/// can be presented with `.sheet(item:)`.
struct InsertSeamPair: Identifiable {
    let id: UUID
    let prev: MatchPoint
    let next: MatchPoint
    /// Their numbers on the strip, so the sheet can show the real chips.
    let prevNumber: Int
    let nextNumber: Int
}

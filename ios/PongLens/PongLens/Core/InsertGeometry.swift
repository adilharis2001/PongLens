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
    guard let seam = seamBetween(prevPoint, nextPoint, pad: pad) else { return nil }
    // A seam with only ONE neighbour is the start or the end of the match and
    // always offers: a rally missing after the last card was unreachable
    // until 2026-08-31, because the offer was only ever drawn BETWEEN two
    // cards. Whether that trailing footage exists is not knowable here, so
    // the sheet clamps to the file's real length once it loads.
    if seam.prev == nil || seam.next == nil { return seam }
    return seam.gapTo - seam.gapFrom >= GAP_WORTH_OFFERING_S ? seam : nil
}

/// One "+" offer in the Keep-score strip: the two cards a missing rally
/// would sit between. Identifiable on the card it precedes, so the sheet
/// can be presented with `.sheet(item:)`.
struct InsertSeamPair: Identifiable {
    let id: UUID
    /// Nil at the start of the match; `next` is nil at the end of it.
    let prev: MatchPoint?
    let next: MatchPoint?
    /// Their numbers on the strip, so the sheet can show the real chips.
    let prevNumber: Int?
    let nextNumber: Int?
}

/// Whether the cut video can actually show this card, or whether the
/// ScoreKeeper has to play the card's OWN clip instead.
///
/// The cut video is never re-assembled. An inserted card gets a cutT0 so the
/// strip can show it, but if the seam it went into had footage removed, that
/// footage is not in the cut file — so playing from its cutT0 plays whatever
/// comes next and the rally is silently skipped. Terry 2, card 45: 12.5s
/// removed at its seam, 14.5s of rally, and the cut jumps straight from card
/// 44's end to card 46's start.
///
/// The test is room: between the previous rally's END and the next rally's
/// START the cut holds some seconds, and if that is less than this card's
/// own duration the cut cannot be showing it. A normally cut card always has
/// room, because the cut was built around it.
func needsOwnClip(
    _ prevPoint: InsertNeighbour?,
    _ point: InsertNeighbour?,
    _ nextPoint: InsertNeighbour?,
    pad: ClipPad,
    /// The cut file's real length, when the caller has the metadata. Only
    /// the one-sided cases need it: a card at the match's edge has a file
    /// edge where a neighbour would be.
    cutDuration: Double? = nil
) -> Bool {
    guard let selfSpan = insertSpanOf(point, pad: pad) else { return false }
    let prev = insertSpanOf(prevPoint, pad: pad)
    let next = insertSpanOf(nextPoint, pad: pad)
    let needed = selfSpan.t1 - selfSpan.t0
    // Half a second of slack throughout: pads and rounding move these by
    // fractions, and a false positive costs a needless file swap.
    if let prev, let next {
        return next.rallyStart - prev.rallyEnd + 0.5 < needed
    }
    // A card at the start or the end of the match: the room is bounded by
    // the file itself, so it needs the cut's real duration. A neighbour
    // that EXISTS but cannot anchor (legacy, no cutT0) is not a file edge —
    // that stays "cannot tell", which keeps the cut as the default.
    guard let cutDuration, cutDuration > 0 else { return false }
    if let prev, nextPoint == nil {
        return cutDuration - prev.rallyEnd + 0.5 < needed
    }
    if let next, prevPoint == nil {
        return next.rallyStart + 0.5 < needed
    }
    return false
}

/// Which cards, over a whole timeline, the cut video cannot show.
///
/// `rows` is the PHYSICAL timeline — deleted cards included, because their
/// footage still occupies the cut and they are true brackets for how much
/// room a seam holds. Order does not matter; anything without a cut anchor
/// is ignored.
///
/// A RETROFITTED card must never bracket its neighbours. insert_point and
/// split_point both mint idx = max + 1, so a card whose idx is larger than
/// a later card's was added to the timeline after the cut was built — and
/// its span can describe footage the cut does not hold. On the Terry seam,
/// bracketing naively with the insert flagged real card 46 as unplayable,
/// because the insert's 14.5s virtual span overhangs 46's room. The room a
/// neighbour has is always measured between cards the cut was BUILT from.
/// (Known miss, accepted: two separate rallies inserted into one seam can
/// each fit the seam's room alone and neither gets flagged.)
func ownClipIds(
    _ rows: [MatchPoint], pad: ClipPad, cutDuration: Double? = nil
) -> Set<UUID> {
    let cut = rows
        .compactMap { p -> (n: InsertNeighbour, idx: Int)? in
            guard let n = p.insertNeighbour else { return nil }
            return (n, p.idx)
        }
        .sorted { $0.n.cutT0 < $1.n.cutT0 }
    // idx of the earliest-created card AFTER each position; a card created
    // later than something that follows it was retrofitted in.
    var minIdxAfter = [Int](repeating: Int.max, count: cut.count)
    if cut.count >= 2 {
        for i in stride(from: cut.count - 2, through: 0, by: -1) {
            minIdxAfter[i] = min(cut[i + 1].idx, minIdxAfter[i + 1])
        }
    }
    let retro = cut.enumerated().map { i, p in p.idx > minIdxAfter[i] }
    var out = Set<UUID>()
    for i in cut.indices {
        var prev: InsertNeighbour?
        for j in stride(from: i - 1, through: 0, by: -1) where !retro[j] {
            prev = cut[j].n
            break
        }
        var next: InsertNeighbour?
        for j in (i + 1)..<cut.count where !retro[j] {
            next = cut[j].n
            break
        }
        // A card the cut was BUILT around never detours, whatever its
        // local geometry says. The room heuristic misreads hand-edited
        // overlaps — on Terry 2, card idx 26 sits against a neighbour
        // whose adjusted span overlaps its own, room measured 4.8s for a
        // 5.5s rally, and the cut shows the card perfectly well. Only a
        // card with the retrofit signature may take a two-sided detour;
        // the match's edges keep the file-end test for everyone, because
        // the file edge is a hard fact — a real first or last card never
        // trips it, and a tail insert (idx max+1, in order, so not
        // inverted) is exactly what it exists to catch.
        if prev != nil, next != nil, !retro[i] { continue }
        if needsOwnClip(prev, cut[i].n, next, pad: pad, cutDuration: cutDuration) {
            out.insert(cut[i].n.id)
        }
    }
    return out
}

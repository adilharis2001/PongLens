import Foundation

// Port of the Keep-score decision rules that live in Player.tsx as memos
// and callbacks. They are pulled out as free functions on purpose: every
// one of them is a rule the web tuned against real sessions, and a rule
// buried in a SwiftUI body cannot be checked against its original. The
// harness in ios/Tests/ScoreLogicTests.swift runs each of these against
// the same cases the web reasons about.
//
// Nothing here touches AVPlayer, Supabase or SwiftUI.

// MARK: - Footage extents

/// A half-open span of cut-video seconds.
struct TimeSpan: Equatable {
    var start: Double
    var end: Double
}

/// Deleted rallies as footage extents, merged. Their span is dead
/// everywhere: playback jumps out of it and no landing may sit inside it.
///
/// The extent stops at the next VISIBLE point's padded start when that
/// comes first — a deleted point's post pad overhangs the neighbour it was
/// cut against, and skipping into the middle of a live rally would be
/// worse than playing the dead frames.
func deletedSpans(
    all: [MatchPoint], visible: [MatchPoint], pad: ClipPad
) -> [TimeSpan] {
    let starts = visible.compactMap(\.cutT0).sorted()
    var out: [TimeSpan] = []
    for p in all where p.deleted {
        guard let cutT0 = p.cutT0, var end = paddedEnd(p, pad) else { continue }
        if let next = starts.first(where: { $0 > cutT0 }) { end = min(end, next) }
        if end > cutT0 { out.append(TimeSpan(start: cutT0, end: end)) }
    }
    out.sort { $0.start < $1.start }
    var merged: [TimeSpan] = []
    for s in out {
        if var last = merged.last, s.start <= last.end {
            last.end = max(last.end, s.end)
            merged[merged.count - 1] = last
        } else {
            merged.append(s)
        }
    }
    return merged
}

/// Rallies marked Skipped, as footage extents. Deleted footage is dead
/// everywhere; a let happened and is still in the timeline, so score mode
/// must be able to land on one and change its mind. Watch mode plays past
/// them — sitting through a let is the one thing nobody re-watches for.
func letSpans(_ points: [MatchPoint], pad: ClipPad) -> [TimeSpan] {
    points
        .filter { $0.isLet && $0.cutT0 != nil }
        .compactMap { p -> TimeSpan? in
            guard let cutT0 = p.cutT0, let end = paddedEnd(p, pad) else { return nil }
            return TimeSpan(start: cutT0, end: end)
        }
        .sorted { $0.start < $1.start }
}

/// End of the span `t` sits inside, or nil. The epsilon keeps a jump that
/// landed exactly on an end from matching that same span again.
func spanEnd(_ spans: [TimeSpan], at t: Double) -> Double? {
    for s in spans {
        if t < s.start { break } // sorted: nothing later can contain t
        if t < s.end - 0.05 { return s.end }
    }
    return nil
}

/// Where a landing at `t` should actually put the playhead: pushed out of
/// any deleted span, and never left in the dead lead before the first
/// visible point.
///
/// `alwaysToFirst` is true in score mode always — landing in the lead
/// leaves every pad button dimmed with no chip, which reads as a broken
/// screen rather than as "nothing here yet". Watch mode only snaps when
/// deleted footage is actually in that lead; an untouched pre-match pad is
/// real footage and still plays.
func snapLanding(
    _ t: Double, spans: [TimeSpan], firstPointStart: Double?, alwaysToFirst: Bool
) -> Double {
    var out = t
    for s in spans {
        if out < s.start { break }
        if out < s.end { out = s.end }
    }
    if let first = firstPointStart, out < first,
       alwaysToFirst || spans.contains(where: { $0.end > out && $0.start < first }) {
        out = first
    }
    return out
}

// MARK: - Which rally the surface is about

/// A rally that still needs an answer. Its stop is the answer beat rather
/// than the end of its clip.
func isUnscored(_ p: MatchPoint) -> Bool {
    !p.isLet && p.confirmedWinner == nil && p.cutT0 != nil
}

/// The rally the surface is ABOUT at time `t` — one answer shared by the
/// chip ring, the ticker score and tap targeting, so they can never
/// disagree.
///
/// The plain WYSIWYG resolver flips to the next rally the moment the
/// playhead reaches its padded start, which on close-together cuts happens
/// BEFORE the previous rally's stop fires. The number under the ring then
/// jumped forward, the video stopped a beat later and the pin dragged it
/// back: a visible stutter on every point, and for that half second a tap
/// answered the wrong rally.
///
/// So while a rally still has a stop coming, it stays the target. `hold` is
/// only true in score/play — watch mode has no stops and should follow the
/// picture. A run that STARTED at or after the previous rally's end
/// (chevron, chip, answer-advance) never holds: you are watching the new
/// one.
func targetAt(
    _ ps: [MatchPoint], at t: Double, pad: ClipPad,
    hold: Bool, runStart: Double?, firedId: UUID?
) -> MatchPoint? {
    let cur = playingPointId(ps, at: t).flatMap { id in ps.first { $0.id == id } }
    guard let cur else {
        return armedPointId(ps, at: t, pad).flatMap { id in ps.first { $0.id == id } }
    }
    guard hold else { return cur }
    guard let i = ps.firstIndex(where: { $0.id == cur.id }), i > 0 else { return cur }
    let prev = ps[i - 1]
    guard prev.id != firedId else { return cur }
    let stop = isUnscored(prev)
        ? pauseEnd(prev, pad, nextStart: nextCutStart(ps, after: prev))
        : paddedEnd(prev, pad)
    guard let stop, let rEnd = rallyEnd(prev, pad), t < stop else { return cur }
    guard let runStart, runStart < rEnd else { return cur }
    return prev
}

/// Whether a rally's stop may pause THIS playback run.
///
/// Two conditions, and the second is not implied by the first. The run must
/// have started before the rally's deciding shot — you cannot be stopped for
/// a shot you did not watch. And the run must not have started inside a
/// LATER rally's span: on adjacent cuts a rally's boundary pokes past the
/// next rally's padded start, so a chevron or an answer-advance landing on
/// the next rally would be hijacked by the previous rally's overhanging
/// boundary, pausing again within a second of play() and reading as a
/// frozen play button.
func runWatched(
    _ p: MatchPoint, points: [MatchPoint], runStart: Double?, pad: ClipPad
) -> Bool {
    guard let runStart, let rEnd = rallyEnd(p, pad), runStart < rEnd - 0.05 else {
        return false
    }
    let startCut = playingPointId(points, at: runStart)
        .flatMap { id in points.first { $0.id == id } }?.cutT0
    guard let startCut, let own = p.cutT0 else { return true }
    return startCut <= own
}

// MARK: - Advance

/// How much clip has to be left before an answer plays it out instead of
/// jumping. Answering early with real footage still to run should not
/// throw away frames nobody has looked at.
let TAIL_WATCH_S = 3.5

enum AdvanceMove: Equatable {
    /// Play the rest of this clip, then jump when the playhead reaches `end`.
    case playTail(end: Double)
    /// Straight to the next visible rally's padded start.
    case jump(to: Double)
    /// Nothing after this rally — stay put and keep playing.
    case stay
}

/// The web's advanceFrom, as a decision. `now` is the playhead at the
/// moment of the answer.
func advanceMove(
    from p: MatchPoint, now: Double, nextStart: Double?, pad: ClipPad
) -> AdvanceMove {
    if let own = paddedEnd(p, pad), own - now > TAIL_WATCH_S {
        return .playTail(end: own)
    }
    guard let next = nextStart else { return .stay }
    return .jump(to: next)
}

// MARK: - Does this clip hold two rallies?

/// A quiet stretch has to be at least this long to read as "between points".
let FUSED_MIN_GAP_S = 1.5
/// Play on both sides means at least this many detections each side.
let FUSED_MIN_SIDE_EVENTS = 2

/// The best place to cut a clip that looks like two points, in CUT-video
/// seconds, or nil when nothing about it looks fused.
///
/// The cutter splits on quiet, so two points played back to back can land
/// in one clip. The reviewer answers the first rally, the pad advances, and
/// the second is never seen — which surfaces much later as a serve rotation
/// that stops matching, or a game that ends at 10.
///
/// The evidence is already in the row: points.placement carries every
/// detected bounce and contact with a timestamp, so a quiet stretch with
/// real play on both sides of it is the gap the cutter missed. This is a
/// HINT, never an action. It decides WHERE a split lands once a human asks
/// for one, and how confidently the offer is worded.
func fusedSplitCut(_ p: MatchPoint, _ pad: ClipPad) -> Double? {
    guard let cutT0 = p.cutT0, let t0 = p.t0, let t1 = p.t1 else { return nil }
    guard case .v3(let data)? = p.placement else { return nil }
    let times = (data.candidates ?? [])
        .compactMap(\.t)
        .filter(\.isFinite)
        .sorted()
    guard times.count >= FUSED_MIN_SIDE_EVENTS * 2 else { return nil }

    var best: (at: Double, gap: Double)?
    for i in (FUSED_MIN_SIDE_EVENTS - 1)..<(times.count - FUSED_MIN_SIDE_EVENTS) {
        let gap = times[i + 1] - times[i]
        guard gap >= FUSED_MIN_GAP_S else { continue }
        let at = times[i] + gap / 2
        // A gap at the very edge is the pre or post pad, not a second rally.
        guard at > t0 + SPLIT_EDGE_S, at < t1 - SPLIT_EDGE_S else { continue }
        if best == nil || gap > best!.gap { best = (at, gap) }
    }
    guard let best else { return nil }

    let eff = effectivePad(pad, tightStart: p.tightStart, tightEnd: p.tightEnd)
    let anchor = max(0, t0 - eff.pre)
    return ((cutT0 + (best.at - anchor)) * 100).rounded() / 100
}

// MARK: - Game boundary control

/// What the pad's one boundary button says and does. The label always
/// names what the tap DOES, never what is currently true.
struct BoundaryControl: Equatable {
    enum Move: Equatable {
        /// Reopen the game that closes at this point ('continue', or clear
        /// an explicit 'end').
        case reopen(UUID)
        /// Pin an explicit 'end' on this point.
        case pinEnd(UUID)
    }
    var label: String
    var accessibility: String
    /// A game ends at the anchor — the button is lit.
    var endsHere: Bool
    /// A just-answered point crossed a held-open game's real end. The
    /// button glows for a beat rather than floating a pill over the video.
    var attention: Bool
    var move: Move
}

/// Everything the control needs to decide, gathered so the decision itself
/// stays pure.
struct BoundaryInputs {
    /// The game that closed within the last few seconds of a live answer,
    /// and the point it closed after. The freshest fact, so it wins.
    var freshlyClosedPointId: UUID?
    /// The rally the surface is about.
    var displayTargetId: UUID?
    var displayTargetOverride: GameEndOverride?
    /// Points that close a game in the FULL match walk.
    var boundaryAfter: Set<UUID>
    /// A point answered in the last few seconds while a 'continue' held the
    /// game open past its auto condition.
    var endedNudgePointId: UUID?
    /// The last scored point up to the playhead, when the game on screen is
    /// held open and so will never close by itself.
    var heldOpenEndTargetId: UUID?
}

/// The single control for the whole game boundary, ordered so the freshest
/// fact wins:
///
///   a game just closed             -> "Didn't end"  (reopen, keep counting)
///   a game ends at this rally      -> "Didn't end"  (reopen it here)
///   an answer crossed a held-open
///   game's real end                -> "Game ended"  (close there, lit)
///   a game is held open            -> "Game ended"  (close at the last
///                                     scored point)
///   anywhere else                  -> "Game ended"  (close after this rally)
///
/// Returns nil only when there is no rally to anchor on at all.
func boundaryControl(_ i: BoundaryInputs) -> BoundaryControl? {
    if let fresh = i.freshlyClosedPointId {
        return BoundaryControl(
            label: "Didn't end",
            accessibility: "The game did not end here, keep counting",
            endsHere: true, attention: false, move: .reopen(fresh)
        )
    }
    if let anchor = i.displayTargetId, i.boundaryAfter.contains(anchor) {
        return BoundaryControl(
            label: "Didn't end",
            accessibility: "The game did not end at this point, keep counting",
            endsHere: true, attention: false, move: .reopen(anchor)
        )
    }
    if let nudge = i.endedNudgePointId {
        return BoundaryControl(
            label: "Game ended",
            accessibility: "Mark the game as ended at the point just answered",
            endsHere: false, attention: true, move: .pinEnd(nudge)
        )
    }
    if let held = i.heldOpenEndTargetId {
        return BoundaryControl(
            label: "Game ended",
            accessibility: "Mark the game as ended here",
            endsHere: false, attention: false, move: .pinEnd(held)
        )
    }
    guard let anchor = i.displayTargetId else { return nil }
    return BoundaryControl(
        label: "Game ended",
        accessibility: "Mark the game as ended after this point",
        endsHere: false, attention: false, move: .pinEnd(anchor)
    )
}

/// The override to write for a reopen: an explicit 'end' is cleared back to
/// automatic, an automatic close is held open with 'continue'.
func reopenOverride(_ current: GameEndOverride?) -> GameEndOverride? {
    current == .end ? nil : .continue
}

/// The manual-end target while the game on screen is held OPEN past its
/// auto condition — you crossed 11, tapped "Didn't end", and kept counting.
/// In that state nothing will close the game by itself, so the way out is
/// to end it at the point most recently scored, even after the video has
/// moved on. Nil during ordinary counting: a game that has not crossed 11
/// does not need a manual end.
func heldOpenEndTarget(
    points: [MatchPoint], upToIndex: Int, walkOpen: Bool, boundaryAfter: Set<UUID>
) -> UUID? {
    guard walkOpen, upToIndex >= 0 else { return nil }
    var last: MatchPoint?
    for i in 0...min(upToIndex, points.count - 1) {
        let p = points[i]
        if !p.isLet, p.confirmedWinner != nil { last = p }
    }
    guard let last, !boundaryAfter.contains(last.id) else { return nil }
    return last.id
}

/// After pinning 'end' on a point: re-run the walk with that pin forced on,
/// and report the closing score when the 11-clear-by-2 rule cannot name a
/// winner. A pinned end at 10-7 (points lost to a cut) proves nothing, and
/// a game the score cannot call counts for nobody — so ask.
func unprovenGameAt(_ pointId: UUID, points: [PointRow]) -> GameSummary? {
    var walk = BoundaryWalk()
    for p in points {
        let winner: Winner? = (p.isLet ?? false) ? nil : p.confirmedWinner
        let override: GameEndOverride? = p.id == pointId ? .end : p.gameEndOverride
        let ended = stepBoundaryWalk(&walk, winner: winner, override: override)
        if p.id == pointId {
            guard let ended, gameWinner(ended) == nil else { return nil }
            return ended
        }
    }
    return nil
}

// MARK: - Undo

/// One reversible step of a scoring session. The web keeps the same four
/// shapes; a single point snapshot cannot express them, because restoring
/// an override must not touch the winner and restoring a delete has to
/// replay the footage.
enum ScoreUndo: Equatable {
    /// A winner, skip or star tap.
    case tap(pointId: UUID, winner: Winner?, isLet: Bool, scoredAt: Double?, starred: Bool)
    /// A soft delete. cutT0 is kept because the point leaves the visible
    /// list, so the seek target has to travel with the entry.
    case delete(pointId: UUID, cutT0: Double?)
    /// A game-boundary override. Never moves playback, so undo doesn't either.
    case override(pointId: UUID, previous: GameEndOverride?, previousWinner: Winner?)
    /// "Match starts here" swept the earlier points away.
    case bulkDelete(pointIds: [UUID], cutT0: Double?)
}

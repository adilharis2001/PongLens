import Foundation

// Watching a hand-cut match through (Adil, 2026-09-25): the full-match
// player plays exactly what the player marked, point after point, with hard
// cuts. Each kept point plays from its mark's start to its mark's end and
// goes straight to the next kept point's start; the pads the worker cut
// around every point (1.2 s before, 1.3 s after, 0.15 s either side of a
// merged window) and anything between two windows are never shown. Lets and
// deleted points are skipped, as they already are. Automatic matches are not
// touched.
//
// This file is the span list, Foundation only, so ios/Tests/run.sh checks it.
// The player walks it with `tapeMove` (ScoreLogic.swift), the highlights
// tape's own single skip rule, so there is one answer to "what plays at t".

/// One kept point of a hand-cut match, on the cut video's clock.
struct MarkedSpan: Equatable {
    let pointId: UUID
    /// The player's Begin Point mark.
    let start: Double
    /// The player's End Point mark.
    let end: Double
    /// A card added after the cut whose footage is not in the cut file: it
    /// plays from its own clip (the takeover's detour), on the same virtual
    /// clock, so its span is the same arithmetic.
    let ownClip: Bool

    var timeSpan: TimeSpan { TimeSpan(start: start, end: end) }
}

enum HandCutPlayback {
    /// How far past a mark a join may land to find a frame it can show at
    /// once: under two frames at 30 fps, so the serve toss is never cut.
    static let joinTolerance = 0.05

    /// A match cut by hand plays as marked; every other match as it always has.
    static func isHandCut(cutSource: String?) -> Bool { cutSource == "manual" }

    /// Where the mark's start sits in the cut. A point's clip begins `pre`
    /// before the mark (its effective pad, as `rallyEnd` reads it), except
    /// where that would be before the start of the video: the worker clamps
    /// the window at 0, so `cut_t0` is the video's first frame and the mark
    /// is `t0` seconds after it.
    static func markStart(_ p: MatchPoint, pad: ClipPad) -> Double? {
        guard let cutT0 = p.cutT0, let t0 = p.t0 else { return nil }
        let pre = effectivePad(pad, tightStart: p.tightStart, tightEnd: p.tightEnd).pre
        return cutT0 + (t0 - max(0, t0 - pre))
    }

    /// Where the mark's end sits: the start plus the marked length. This is
    /// `rallyEnd()` (Playhead.swift) for every point whose window was not
    /// clamped at 0; for the one that was, `rallyEnd` would run on by the
    /// clamped amount into the pad after the point.
    static func markEnd(_ p: MatchPoint, pad: ClipPad) -> Double? {
        guard let start = markStart(p, pad: pad), let t0 = p.t0, let t1 = p.t1 else { return nil }
        return start + max(0, t1 - t0)
    }

    /// The tape: every kept point, in the order it plays. `points` is the
    /// timeline (deleted cards may be in it and are dropped here); `ownClips`
    /// are the cards the player detours for.
    static func spans(_ points: [MatchPoint], pad: ClipPad, ownClips: Set<UUID> = []) -> [MarkedSpan] {
        points
            .filter { !$0.deleted && !$0.isLet }
            .compactMap { p -> MarkedSpan? in
                guard let start = markStart(p, pad: pad), let end = markEnd(p, pad: pad),
                      end > start + 0.05 else { return nil }
                return MarkedSpan(pointId: p.id, start: start, end: end, ownClip: ownClips.contains(p.id))
            }
            .sorted { $0.start < $1.start }
    }

    /// Where a landing belongs on the tape: inside a kept point it stays, in
    /// the footage between two it moves on to the next one's start, and past
    /// the last it stays where it is (playback then stops there).
    static func landing(_ t: Double, on spans: [MarkedSpan]) -> Double {
        if case .jump(let to) = tapeMove(spans.map(\.timeSpan), at: t) { return to }
        return t
    }

    /// The span that starts the next kept point after the given one.
    static func next(after id: UUID, in spans: [MarkedSpan]) -> MarkedSpan? {
        guard let i = spans.firstIndex(where: { $0.pointId == id }) else { return nil }
        return spans[(i + 1)...].first { $0.start >= spans[i].start }
    }
}

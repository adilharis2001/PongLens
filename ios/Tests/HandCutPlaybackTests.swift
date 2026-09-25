import Foundation

// Core/HandCutPlayback.swift: a hand-cut match watched through plays exactly
// the marks, with hard cuts (Adil, 2026-09-25).

private func point(
    _ n: Int, cutT0: Double?, t0: Double?, t1: Double?,
    isLet: Bool = false, deleted: Bool = false, tightStart: Bool = false
) -> MatchPoint {
    MatchPoint(
        id: UUID(uuidString: String(format: "00000000-0000-4000-8000-%012d", n))!,
        matchId: UUID(), idx: n, t0: t0, t1: t1, cutT0: cutT0,
        server: nil, serverOverride: nil, isLet: isLet,
        confirmedWinner: nil, confirmedHow: nil,
        starred: false, deleted: deleted, edited: false,
        tightStart: tightStart, tightEnd: false,
        gameEndOverride: nil, gameWinnerOverride: nil,
        scoredAtCutS: nil, lossReasons: nil, direction: nil,
        misreadKind: nil, serveSpin: nil, serveSidespin: nil,
        serveLength: nil, placementFlagged: nil, clipPath: nil,
        placement: nil
    )
}

func runHandCutPlaybackChecks() {
    print("\n— a hand-cut match plays as marked —")
    let pad = ClipPad(pre: 1.2, post: 1.3)

    // The first point's window was clamped at 0: the mark sits t0 into the cut.
    let clamped = point(1, cutT0: 0, t0: 0.5, t1: 7.5)
    // Two points whose windows merged in the cut (continuous footage).
    let a = point(2, cutT0: 8.95, t0: 20, t1: 29)
    let b = point(3, cutT0: 20.25, t0: 30.1, t1: 38)
    let let4 = point(4, cutT0: 31.0, t0: 45, t1: 50, isLet: true)
    let gone = point(5, cutT0: 40.0, t0: 60, t1: 66, deleted: true)
    let c = point(6, cutT0: 50.0, t0: 80, t1: 88)
    // Added after the cut: its footage lives in its own clip, on the same
    // virtual clock.
    let inserted = point(7, cutT0: 63.0, t0: 100, t1: 104)
    let noAnchor = point(8, cutT0: nil, t0: 120, t1: 126)

    near(HandCutPlayback.markStart(clamped, pad: pad), 0.5, "clamped at 0: the mark is t0 into the cut")
    near(HandCutPlayback.markEnd(clamped, pad: pad), 7.5, "clamped at 0: the end is t1 into the cut")
    near(rallyEnd(clamped, pad), 8.2, "rallyEnd would have run on by the clamped 0.7 s")
    near(HandCutPlayback.markStart(a, pad: pad), 10.15, "cut_t0 plus the pre pad")
    near(HandCutPlayback.markEnd(a, pad: pad), 19.15, "the end mark")
    near(HandCutPlayback.markEnd(a, pad: pad), rallyEnd(a, pad)!, "equal to rallyEnd when not clamped")
    let tight = point(9, cutT0: 70, t0: 90, t1: 95, tightStart: true)
    near(HandCutPlayback.markStart(tight, pad: pad), 70.3, "a split-born start uses its tight pad")

    let spans = HandCutPlayback.spans(
        [clamped, a, b, let4, gone, c, inserted, noAnchor], pad: pad, ownClips: [inserted.id]
    )
    eq(spans.map(\.pointId), [clamped.id, a.id, b.id, c.id, inserted.id],
       "kept points only: no let, no deleted point, nothing without an anchor")
    eq(spans.first { $0.pointId == inserted.id }?.ownClip, true, "an inserted card plays its own clip")
    eq(spans.first { $0.pointId == c.id }?.ownClip, false, "a cut card plays from the cut")
    near(spans.first { $0.pointId == inserted.id }?.start, 64.2, "the inserted card's mark on the virtual clock")

    let tape = spans.map(\.timeSpan)
    // Within a point: nothing happens.
    eq(tapeMove(tape, at: 12), .stay, "inside a kept point")
    // At a mark's end: straight to the next mark, pads and gap unseen.
    eq(tapeMove(tape, at: 19.15), .jump(to: 21.45), "End mark to the next Begin mark")
    // A let between two kept points is jumped as part of the gap.
    eq(tapeMove(tape, at: 29.5), .jump(to: 51.2), "the let and the deleted point are never shown")
    eq(tapeMove(tape, at: 0), .jump(to: 0.5), "before the first mark: straight to it")
    eq(tapeMove(tape, at: 69), .end, "past the last mark the tape ends")

    eq(HandCutPlayback.landing(20.3, on: spans), 21.45, "a landing on the pad moves to the mark")
    eq(HandCutPlayback.landing(15, on: spans), 15, "a landing inside a point stays")
    eq(HandCutPlayback.landing(80, on: spans), 80, "a landing past the end stays")
    eq(HandCutPlayback.next(after: b.id, in: spans)?.pointId, c.id, "the next kept point")
    eq(HandCutPlayback.next(after: inserted.id, in: spans)?.pointId, nil, "nothing after the last")

    check(HandCutPlayback.isHandCut(cutSource: "manual"), "manual cuts play as marked")
    check(!HandCutPlayback.isHandCut(cutSource: "automatic"), "automatic matches are unchanged")
    check(!HandCutPlayback.isHandCut(cutSource: nil), "an unknown cut is unchanged")

    // A degenerate mark (no length) is not a span to stop on.
    eq(HandCutPlayback.spans([point(10, cutT0: 5, t0: 10, t1: 10)], pad: pad), [],
       "a zero-length mark plays nothing")
}

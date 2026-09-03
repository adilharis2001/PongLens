import Foundation

// Parity checks for Core/InsertGeometry.swift against the web's
// src/app/match/[id]/insertGeometry.test.ts. The fixture is THE REAL SEAM:
// cards 2 and 3 of the Jose Suarez match (Westchester, 2026-08-29), where
// the cutter dropped both of the owner's serves — 24.1 seconds of source
// between the two rallies, 23.1 of which never reached the cut.

private let PAD = ClipPad(pre: 1.0, post: 1.6)

private func nb(
    _ t0: Double, _ t1: Double, _ cutT0: Double,
    tightStart: Bool = false, tightEnd: Bool = false
) -> InsertNeighbour {
    InsertNeighbour(
        id: UUID(), t0: t0, t1: t1, cutT0: cutT0,
        tightStart: tightStart, tightEnd: tightEnd)
}

private func r2(_ v: Double) -> Double { (v * 100).rounded() / 100 }

private let JOSE_PREV = nb(24.47, 33.77, 20.02)
private let JOSE_NEXT = nb(57.87, 64.77, 30.32)

func runInsertGeometryParityChecks() {
    print("\ninsert geometry (parity with insertGeometry.test.ts)")

    let prevSpan = insertSpanOf(JOSE_PREV, pad: PAD)!
    check(r2(prevSpan.rallyStart) == 21.02, "span rally start")
    check(r2(prevSpan.rallyEnd) == 30.32, "span rally end")

    let tight = insertSpanOf(nb(10, 20, 5, tightStart: true), pad: PAD)!
    check(r2(tight.rallyStart) == 5.3, "a split edge keeps a sliver of pad")

    let seam = seamBetween(JOSE_PREV, JOSE_NEXT, pad: PAD)!
    check(r2(seam.gapFrom) == 33.77, "gap starts where the last rally ended")
    check(r2(seam.gapTo) == 57.87, "gap ends where the next rally starts")
    check(r2(seam.gapTo - seam.gapFrom) == 24.1, "the Jose gap is 24.1s")
    check(r2(seam.removed) == 23.1, "23.1s of it never reached the cut")
    check(seam.continuous == false, "so the seam is not continuous")
    check(r2(seam.from) == 24.47 && r2(seam.to) == 64.77, "neighbourhood bounds")

    let cont = seamBetween(nb(10, 20, 4), nb(21, 30, 15), pad: PAD)!
    check(r2(cont.removed) == 0, "a continuous seam drops nothing")
    check(cont.continuous, "and reports itself continuous")

    check(r2(sourceToCut(seam, 24.47)) == 21.02, "maps inside the previous rally")
    check(r2(sourceToCut(seam, 33.77)) == 30.32, "maps to its end")
    check(r2(sourceToCut(seam, 57.87)) == 31.32, "maps inside the next rally")
    check(r2(sourceToCut(seam, 45)) == 30.32, "holds at the seam inside the hole")
    check(playableAt(seam, 45) == false, "the hole is not watchable")
    check(playableAt(seam, 30) && playableAt(seam, 60), "the rallies are")
    check(playableAt(cont, 20.5), "all of a continuous seam is watchable")

    let w = defaultInsertWindow(seam)
    check(r2(w.t0) == 33.77 && r2(w.t1) == 57.87, "handles open on the gap")

    let smeared = seamBetween(nb(10, 20, 4), nb(20.4, 30, 15), pad: PAD)!
    let sw = defaultInsertWindow(smeared)
    check(sw.t0 < 20.2 && sw.t1 > 20.2, "a smeared rally opens straddling the seam")

    let b = insertBounds(seam)
    check(r2(b.lo) == 24.77 && r2(b.hi) == 64.47, "handles cannot swallow a neighbour")
    let clamped = clampInsertWindow(seam, InsertWindow(t0: 0, t1: 999))
    check(r2(clamped.t0) == 24.77 && r2(clamped.t1) == 64.47, "and are clamped to that")

    let base = InsertWindow(t0: 33.77, t1: 57.87)
    check(r2(moveInsertHandle(seam, base, edge: .start, to: 28).t0) == 28,
          "the start handle reaches into the previous rally")
    check(r2(moveInsertHandle(seam, base, edge: .end, to: 62).t1) == 62,
          "the end handle reaches into the next one")
    check(r2(moveInsertHandle(seam, base, edge: .start, to: 99).t0) == r2(57.87 - 0.5),
          "handles cannot cross")

    check(r2(insertCutT0(seam, w, pad: PAD)) == 30.02,
          "the new card lands between its neighbours in the cut")
    check(insertCutT0(seam, w, pad: PAD) > JOSE_PREV.cutT0
          && insertCutT0(seam, w, pad: PAD) < JOSE_NEXT.cutT0,
          "strictly between the two anchors, so the strip shows it")

    check(gapWorthOffering(JOSE_PREV, JOSE_NEXT, pad: PAD) != nil,
          "the Jose seam is worth offering a plus on")
    check(gapWorthOffering(nb(10, 20, 4), nb(21.2, 30, 15), pad: PAD) == nil,
          "ordinary between-point time is not")
    check(gapWorthOffering(nb(10, 20, 4), nb(24.5, 30, 15), pad: PAD) != nil,
          "a quickly re-served miss is, which eight seconds was blind to")
    check(gapWorthOffering(nb(10, 20, 4), nb(23.5, 30, 15), pad: PAD) == nil,
          "just under the line stays quiet")
    // TERRY 2, CARD 45 — the inserted card that played the wrong rally.
    // Card 44 ends at cut 678.9, card 46 starts at 690.6, and the 14.5s
    // rally between them had 12.5s removed at its seam: the cut holds 11.7s
    // there and cannot be showing it.
    let tPrev = nb(860.0, 868.4, 670.5)
    let tInsert = nb(880.9, 895.4, 678.9)
    let tNext = nb(895.4, 904.3, 690.6)
    check(needsOwnClip(tPrev, tInsert, tNext, pad: PAD),
          "an insert into a cut-away seam plays its own clip")
    check(!needsOwnClip(tPrev, tNext, nb(906, 915, 701.2), pad: PAD),
          "a normally cut card is shown by the cut video")
    check(!needsOwnClip(nb(10, 20, 4), nb(21, 29, 15), nb(30, 40, 24), pad: PAD),
          "an insert into a continuous seam stays on the cut")
    check(!needsOwnClip(nil, tInsert, tNext, pad: PAD),
          "and it says no when it cannot tell")

    check(gapWorthOffering(nil, JOSE_NEXT, pad: PAD) != nil,
          "the start of the match always offers")
    check(gapWorthOffering(JOSE_PREV, nil, pad: PAD) != nil,
          "and so does the end, where a missed final serve hides")

    // ---- one-sided seams: the match's edges, where the file itself is
    //      the missing neighbour. The Kyle (cropped) shape.
    let last = nb(895.4, 904.3, 690.6) // rally end at cut 700.5
    let added = nb(910.0, 914.0, 700.2) // 4s rally
    check(needsOwnClip(last, added, nil, pad: PAD, cutDuration: 701.8),
          "a tail insert past the cut's end needs its own clip")
    check(!needsOwnClip(last, added, nil, pad: PAD),
          "without the duration it cannot tell, and stays on the cut")
    check(!needsOwnClip(nil, nb(10, 18, 0), nb(25, 31, 12.3),
                        pad: PAD, cutDuration: 600),
          "the real first card never trips the edge rule")
    check(!needsOwnClip(nb(500, 507, 570), nb(512, 519, 579.3), nil,
                        pad: PAD, cutDuration: 588.9),
          "the real last card never trips the edge rule")

    // ---- ownClipIds over the whole timeline. The trap this pins: the
    //      insert's 14.5s virtual span overhangs card 46's room, so naive
    //      bracketing flags a REAL card. The idx rule (insert_point mints
    //      max+1) keeps the retrofit out of everyone else's brackets.
    let c45 = UUID()
    let terry = [
        mp(44, 860.0, 868.4, 670.5),
        mp(75, 880.9, 895.4, 678.9, id: c45), // the insert
        mp(45, 895.4, 904.3, 690.6),
        mp(46, 906.0, 915.0, 701.2),
    ]
    check(ownClipIds(terry, pad: PAD, cutDuration: 720) == [c45],
          "ownClipIds flags the insert and never its real neighbours")

    // Terry 2, cards idx 25/26/27 verbatim: 27's adjusted span starts
    // BEFORE 26 ends, so the room heuristic measures less room than
    // rally — and the cut shows 26 perfectly well. Only the retrofit
    // signature may take a two-sided detour.
    let overlap = [
        mp(25, 343.28, 348.48, 268.22),
        mp(26, 349.68, 355.18, 274.63),
        mp(27, 354.68, 364.24, 278.23, tightEnd: true),
        mp(73, 364.24, 373.79, 287.79, tightStart: true),
        mp(28, 374.99, 379.99, 298.54),
    ]
    check(ownClipIds(overlap, pad: ClipPad(pre: 0.3, post: 0.4),
                     cutDuration: 710.7).isEmpty,
          "a hand-edited overlap never flags a real card")

    let plain = [
        mp(0, 10, 18, 0),
        mp(1, 25, 31, 12.3),
        mp(2, 40, 49, 21.5),
    ]
    check(ownClipIds(plain, pad: PAD, cutDuration: 33.1).isEmpty,
          "ownClipIds is quiet on an untouched timeline")
    // A split-born card (idx max+1, footage contiguous in the cut) is
    // retrofitted by idx but has room, so it stays on the cut too.
    let split = [
        mp(0, 10, 18, 0),
        mp(3, 25, 28, 12.3, tightEnd: true),
        mp(4, 28.5, 31, 15.1, tightStart: true),
        mp(2, 40, 49, 21.5),
    ]
    check(ownClipIds(split, pad: PAD, cutDuration: 33.1).isEmpty,
          "a split child with room stays on the cut")
}

/// A full MatchPoint for ownClipIds, which needs idx and clipPath beside
/// the geometry fields.
private func mp(
    _ idx: Int, _ t0: Double, _ t1: Double, _ cutT0: Double,
    tightStart: Bool = false, tightEnd: Bool = false, id: UUID = UUID()
) -> MatchPoint {
    MatchPoint(
        id: id, matchId: UUID(), idx: idx,
        t0: t0, t1: t1, cutT0: cutT0,
        server: nil, serverOverride: nil, isLet: false,
        confirmedWinner: nil, confirmedHow: nil, starred: false,
        deleted: false, edited: false,
        tightStart: tightStart, tightEnd: tightEnd,
        gameEndOverride: nil, gameWinnerOverride: nil,
        scoredAtCutS: nil, serveStartAtCutS: nil,
        lossReasons: nil, direction: nil, misreadKind: nil,
        serveSpin: nil, serveSidespin: nil, serveLength: nil,
        placementFlagged: nil, clipPath: "c", placement: nil
    )
}

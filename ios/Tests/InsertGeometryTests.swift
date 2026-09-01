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
    check(gapWorthOffering(nil, JOSE_NEXT, pad: PAD) == nil,
          "and nothing is offered at the ends of the match")
}

import Foundation

// Core/MarkLandscape.swift against the same cases as
// src/app/match/[id]/markLandscape.test.ts: the approved board's own
// renderVals() arithmetic, copied line for line, must agree with the port
// everywhere, not only on the three boards drawn.

private struct Board {
    let avail, midH, boxW, boxH, rail, tileW, x0, yMid, leftX, picX, rightX: Double
    let bigFs, aFs, aH, half, botTop, botHeight: Double
}

private func board(_ w: Double, _ h: Double, _ sl: Double, _ sr: Double, _ sb: Double) -> Board {
    let topH = 42.0, botH = 41.0, gap = 8.0
    let avail = w - sl - sr - 24
    let midH = h - sb - topH - botH
    let boxW = min(avail - 192, midH * 16 / 9)
    let boxH = boxW * 9 / 16
    let rail = max(96, (avail - boxW) / 2)
    let tileW = rail - gap
    let x0 = sl + 12
    let yMid = topH + (midH - boxH) / 2
    let leftX = x0, picX = x0 + rail, rightX = picX + boxW + gap
    let bigFs: Double = tileW >= 150 ? 22 : (tileW >= 100 ? 19 : 16)
    let aFs: Double = tileW >= 150 ? 30 : (tileW >= 100 ? 26 : 22)
    let letH = 44.0
    let aH = (boxH - 2 * gap - letH) / 2
    let half = (boxH - gap) / 2
    return Board(avail: avail, midH: midH, boxW: boxW, boxH: boxH, rail: rail, tileW: tileW,
                 x0: x0, yMid: yMid, leftX: leftX, picX: picX, rightX: rightX,
                 bigFs: bigFs, aFs: aFs, aH: aH, half: half,
                 botTop: topH + midH, botHeight: botH + sb)
}

private func closeTo(_ a: Double, _ b: Double, _ what: String) {
    check(abs(a - b) < 1e-9, "\(what): \(a) vs \(b)")
}

private func sameAsBoard(_ w: Double, _ h: Double, _ sl: Double, _ sr: Double, _ sb: Double) {
    let g = MarkLandscape(w: w, h: h, insets: MarkLandscapeInsets(left: sl, right: sr, bottom: sb))
    let b = board(w, h, sl, sr, sb)
    let at = "\(w)x\(h) (\(sl),\(sr),\(sb))"
    closeTo(g.avail, b.avail, "\(at) avail")
    closeTo(g.midH, b.midH, "\(at) midH")
    // The board has no floor at zero; every real phone is far above it.
    closeTo(g.boxW, max(0, b.boxW), "\(at) boxW")
    closeTo(g.boxH, max(0, b.boxW) * 9 / 16, "\(at) boxH")
    closeTo(g.rail, b.rail, "\(at) rail")
    closeTo(g.tileW, b.tileW, "\(at) tileW")
    closeTo(g.x0, b.x0, "\(at) x0")
    closeTo(g.yMid, b.yMid, "\(at) yMid")
    closeTo(g.leftX, b.leftX, "\(at) leftX")
    closeTo(g.picX, b.picX, "\(at) picX")
    closeTo(g.rightX, b.rightX, "\(at) rightX")
    closeTo(g.bottomTop, b.botTop, "\(at) bottomTop")
    closeTo(g.bottomH, b.botHeight, "\(at) bottomH")
    closeTo(g.answerH, b.aH, "\(at) answerH")
    closeTo(g.pairHalf, b.half, "\(at) pairHalf")
    check(g.pairFont == b.bigFs, "\(at) pairFont")
    check(g.answerFont == b.aFs, "\(at) answerFont")
}

func runMarkLandscapeChecks() {
    print("\nmark the points, landscape geometry (parity with markLandscape.ts)")

    // The three approved boards: iPhone 12 with its safe areas, mobile web
    // rotated, mobile web full screen.
    sameAsBoard(844, 390, 47, 47, 21)
    sameAsBoard(852, 348, 0, 0, 0)
    sameAsBoard(660, 393, 0, 0, 0)

    // Across phone sizes and safe areas.
    for w in [568.0, 640, 667, 736, 812, 844, 852, 874, 896, 926, 932, 956] {
        for h in [320.0, 340, 348, 375, 390, 393, 414, 430, 440] {
            for (sl, sr, sb) in [(0.0, 0.0, 0.0), (47, 47, 21), (59, 59, 21), (0, 44, 0)] {
                sameAsBoard(w, h, sl, sr, sb)
            }
        }
    }

    // iPhone 12: the numbers the web test pins.
    let g = MarkLandscape(w: 844, h: 390, insets: MarkLandscapeInsets(left: 47, right: 47, bottom: 21))
    eq(g.avail, 726, "iPhone 12 avail")
    eq(g.midH, 286, "iPhone 12 midH")
    closeTo(g.boxW, 286 * 16 / 9, "iPhone 12 boxW")
    eq(g.boxH, 286, "iPhone 12 boxH")
    closeTo(g.rail, (726 - 286 * 16 / 9) / 2, "iPhone 12 rail")
    eq(g.x0, 59, "iPhone 12 x0")
    eq(g.yMid, MarkLandscape.topBarH, "iPhone 12 yMid")
    eq(g.bottomTop, 328, "iPhone 12 bottomTop")
    eq(g.bottomH, 62, "iPhone 12 bottomH")
    eq(g.pairFont, 19, "iPhone 12 pairFont")
    eq(g.answerFont, 26, "iPhone 12 answerFont")
    eq(g.answerH, (286 - 2 * MarkLandscape.railGap - MarkLandscape.letH) / 2, "iPhone 12 answerH")

    // 660 x 393: capped by width, rails at their floor.
    let s = MarkLandscape(w: 660, h: 393)
    eq(s.rail, MarkLandscape.minRail, "660 rail at the floor")
    eq(s.tileW, MarkLandscape.minRail - MarkLandscape.railGap, "660 tile")
    eq(s.boxW, 660 - 24 - 2 * MarkLandscape.minRail, "660 boxW")
    eq(s.boxH, s.boxW * 9 / 16, "660 boxH")
    closeTo(s.yMid, MarkLandscape.topBarH + (s.midH - s.boxH) / 2, "660 centred")
    eq(s.pairFont, 16, "660 pairFont")
    eq(s.answerFont, 22, "660 answerFont")

    // Zones tile the width with nothing overlapping.
    for (w, h, sl, sr, sb) in [(844.0, 390.0, 47.0, 47.0, 21.0), (852, 348, 0, 0, 0),
                               (660, 393, 0, 0, 0), (932, 430, 59, 59, 21)] {
        let z = MarkLandscape(w: w, h: h, insets: MarkLandscapeInsets(left: sl, right: sr, bottom: sb))
        closeTo(z.leftX + z.tileW + MarkLandscape.railGap, z.picX, "\(w) left rail to picture")
        closeTo(z.picX + z.boxW + MarkLandscape.railGap, z.rightX, "\(w) picture to right rail")
        closeTo(z.rightX + z.tileW, z.x0 + z.avail, "\(w) right rail to the margin")
        check(z.yMid >= MarkLandscape.topBarH, "\(w) below the top bar")
        check(z.yMid + z.boxH <= z.bottomTop + 1e-9, "\(w) above the bottom bar")
        closeTo(z.bottomTop + z.bottomH, h, "\(w) bottom bar reaches the edge")
        check(z.tileW >= MarkLandscape.minRail - MarkLandscape.railGap, "\(w) tile floor")
    }

    // Another aspect ratio gets its own box; a nonsense one falls back.
    let four = MarkLandscape(w: 852, h: 348, aspect: 4.0 / 3.0)
    let midH = 348 - MarkLandscape.topBarH - MarkLandscape.bottomBarH
    eq(four.boxH, midH, "4:3 fills the height")
    closeTo(four.boxW, midH * 4 / 3, "4:3 boxW")
    closeTo(four.rail, (828 - four.boxW) / 2, "4:3 rail")
    closeTo(MarkLandscape(w: 852, h: 348, aspect: 0).boxW, MarkLandscape(w: 852, h: 348).boxW, "fallback aspect")

    // Too small for the rails: an empty picture, never a negative one.
    let tiny = MarkLandscape(w: 200, h: 120)
    eq(tiny.boxW, 0, "tiny boxW")
    eq(tiny.boxH, 0, "tiny boxH")

    // The right rail, state by state.
    func labels(_ started: Bool, _ opened: HandCutOpenAs, _ reviewing: Bool, _ adjusting: Bool, _ open: Bool) -> [String] {
        MarkLandscape.railPair(started: started, opened: opened, reviewing: reviewing,
                               adjusting: adjusting, open: open)
            .map { "\($0.label):\($0.tone.rawValue)" }
    }
    eq(labels(false, .fresh, false, false, false), ["Begin Cutting:lit"], "gate, fresh")
    eq(labels(false, .review, false, false, false), ["Begin review:lit"], "gate, review")
    eq(labels(false, .choice, false, false, false), ["Keep marking:lit", "Review the points:unlit"], "gate, choice")
    eq(labels(true, .fresh, false, false, false), ["Begin Point:lit", "End Point:off"], "marking")
    eq(labels(true, .fresh, false, false, true), ["Back to last point:unlit", "End Point:lit"], "rally open")
    eq(labels(true, .fresh, true, false, false), ["Adjust:lit", "Resume:unlit"], "selected")
    eq(labels(true, .fresh, true, true, false), ["Confirm:lit", "Resume:off"], "adjusting")
    eq(labels(true, .fresh, true, false, true), ["Adjust:lit", "Resume:unlit"], "selected outranks open")

    // Tile heights follow the board.
    let boxH = 265.0
    let choice = MarkLandscape.railPair(started: false, opened: .choice, reviewing: false, adjusting: false, open: false)
    closeTo(MarkLandscape.pairTileHeight(choice[0], count: 2, boxH: boxH), (boxH - 8) * 0.58, "keep marking")
    closeTo(MarkLandscape.pairTileHeight(choice[1], count: 2, boxH: boxH), (boxH - 8) * 0.42, "review the points")
    let pair = MarkLandscape.railPair(started: true, opened: .fresh, reviewing: false, adjusting: false, open: false)
    closeTo(MarkLandscape.pairTileHeight(pair[0], count: 2, boxH: boxH), (boxH - 8) / 2, "half")
    let gate = MarkLandscape.railPair(started: false, opened: .fresh, reviewing: false, adjusting: false, open: false)
    eq(MarkLandscape.pairTileHeight(gate[0], count: 1, boxH: boxH), boxH, "gate fills the rail")

    runMarkerGateCaptionChecks()
}

/// What Keep marking and Start again say under them when the marker opens
/// on points already there (post-rollout audit B, approved 2026-09-26),
/// portrait and landscape from one statement.
private func runMarkerGateCaptionChecks() {
    eq(MarkerCopy.keepMarkingUncalled, "Start from the points already here and fix or score each one.",
       "Keep marking, some points without a winner")
    eq(MarkerCopy.keepMarkingCalled, "Carry on from the last point to the end of the match.",
       "Keep marking, every point called")
    eq(MarkerCopy.startAgainDetail, "Clear every point and mark the whole match yourself.", "Start again")
    eq(MarkerCopy.keepMarkingDetail(.scoring), MarkerCopy.keepMarkingUncalled, "the scoring gate's line")
    eq(MarkerCopy.keepMarkingDetail(.choice), MarkerCopy.keepMarkingCalled, "the choice gate's line")
    eq(MarkerCopy.keepMarkingDetail(.fresh), nil, "Begin Cutting has no line")
    eq(MarkerCopy.keepMarkingDetail(.review), nil, "Begin review has no line")
    for words in [MarkerCopy.keepMarkingUncalled, MarkerCopy.keepMarkingCalled, MarkerCopy.startAgainDetail] {
        let lower = " " + words.lowercased() + " "
        check(!lower.contains("free") && !lower.contains(" mac") && !lower.contains("iphone")
              && !lower.contains("phone") && !lower.contains(" ai ") && !words.contains("\u{2014}"),
              "no free, Mac, iPhone, phone, AI or em dash: \(words)")
    }

    // The landscape tiles carry the same lines as a smaller second line.
    func details(_ opened: HandCutOpenAs, again: Bool) -> [String] {
        MarkLandscape.railPair(started: false, opened: opened, reviewing: false,
                               adjusting: false, open: false, startAgain: again)
            .map { "\($0.label):\($0.detail ?? "-")" }
    }
    eq(details(.scoring, again: true),
       ["Keep marking:\(MarkerCopy.keepMarkingUncalled)", "Start again:\(MarkerCopy.startAgainDetail)"],
       "scoring gate: both lines")
    eq(details(.choice, again: true),
       ["Keep marking:\(MarkerCopy.keepMarkingCalled)", "Review the points:-",
        "Start again:\(MarkerCopy.startAgainDetail)"],
       "choice gate with Start again: Keep marking and Start again say what they do")
    eq(details(.choice, again: false),
       ["Keep marking:\(MarkerCopy.keepMarkingCalled)", "Review the points:-"],
       "choice gate on an unprocessed match: Keep marking's line")
    eq(details(.review, again: true), ["Begin review:-", "Start again:\(MarkerCopy.startAgainDetail)"],
       "review gate: only Start again has a line")
    eq(details(.fresh, again: false), ["Begin Cutting:-"], "a fresh pass has no lines")
    // Once the pass has started no tile has a second line.
    for (reviewing, adjusting, open) in [(false, false, false), (false, false, true), (true, false, false), (true, true, false)] {
        check(MarkLandscape.railPair(started: true, opened: .scoring, reviewing: reviewing,
                                     adjusting: adjusting, open: open, startAgain: true)
                .allSatisfy { $0.detail == nil },
              "no second line during the pass (\(reviewing), \(adjusting), \(open))")
    }
}

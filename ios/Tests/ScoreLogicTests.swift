import Foundation

// Headless checks for the Keep-score rules. These files have no UIKit,
// AVFoundation or Supabase in them on purpose, so this compiles and runs
// with plain swiftc in about a second — see run.sh.
//
// The game-score cases mirror src/app/match/[id]/gameScore.test.ts case for
// case. A port that agrees with its original on the original's own numbers
// is the only kind that can be trusted, and these numbers were argued out
// once already.

// MARK: - Harness

var failures = 0
var checks = 0

func check(_ ok: Bool, _ what: String, file: StaticString = #file, line: UInt = #line) {
    checks += 1
    if !ok {
        failures += 1
        print("  FAIL  \(what)   (line \(line))")
    }
}

func eq<T: Equatable>(_ a: T, _ b: T, _ what: String, line: UInt = #line) {
    checks += 1
    if a != b {
        failures += 1
        print("  FAIL  \(what)\n        got      \(a)\n        expected \(b)   (line \(line))")
    }
}

/// Seconds, compared the way seconds should be. Asserting exact Double
/// equality on pad arithmetic tests the FPU, not the rule.
func near(_ a: Double?, _ b: Double, _ what: String, line: UInt = #line) {
    checks += 1
    if a == nil || abs(a! - b) > 0.0005 {
        failures += 1
        print("  FAIL  \(what)\n        got      \(String(describing: a))\n        expected ~\(b)   (line \(line))")
    }
}

func suite(_ name: String, _ body: () -> Void) {
    print("\n\(name)")
    body()
}

// MARK: - Builders

func mkPoint(
    _ n: Int,
    winner: Winner? = nil,
    override: GameEndOverride? = nil,
    winnerOverride: Winner? = nil,
    isLet: Bool = false,
    deleted: Bool = false,
    starred: Bool = false,
    cutT0: Double? = nil,
    t0: Double? = nil,
    t1: Double? = nil,
    tightStart: Bool = false,
    tightEnd: Bool = false,
    placement: PlacementData? = nil
) -> MatchPoint {
    MatchPoint(
        id: uuid(n), matchId: uuid(9999), idx: n,
        t0: t0 ?? Double(n), t1: t1 ?? Double(n) + 1, cutT0: cutT0,
        server: nil, serverOverride: nil, isLet: isLet,
        confirmedWinner: winner, confirmedHow: nil, starred: starred,
        deleted: deleted, edited: false, tightStart: tightStart, tightEnd: tightEnd,
        gameEndOverride: override, gameWinnerOverride: winnerOverride,
        scoredAtCutS: nil, lossReasons: nil, direction: nil, misreadKind: nil,
        serveSpin: nil, serveSidespin: nil, serveLength: nil,
        placementFlagged: nil, placement: placement
    )
}

/// A v3 placement carrying nothing but detection times, which is all
/// fusedSplitCut reads.
func detections(_ times: [Double]) -> PlacementData {
    let hyp = HYP_JSON
    let list = times.map { "{\"t\":\($0)}" }.joined(separator: ",")
    let json = "{\"v\":3,\"status\":\"ready\",\"candidates\":[" + list
        + "],\"hypotheses\":{\"near\":" + hyp + ",\"far\":" + hyp + "}}"
    return try! JSONDecoder().decode(PlacementData.self, from: Data(json.utf8))
}

let HYP_JSON = "{\"status\":\"ready\",\"shots\":[],\"hard_reasons\":[],\"reasons\":[]}"

func uuid(_ n: Int) -> UUID {
    UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", n))!
}

func row(_ p: MatchPoint) -> PointRow {
    PointRow(
        id: p.id, matchId: p.matchId, idx: p.idx, t0: p.t0,
        confirmedWinner: p.confirmedWinner, isLet: p.isLet, deleted: p.deleted,
        gameEndOverride: p.gameEndOverride, gameWinnerOverride: p.gameWinnerOverride
    )
}

/// The web test's own notation: U/T/. per point, a trailing E or C pins
/// that point's override.
func build(_ seq: String) -> [MatchPoint] {
    var out: [MatchPoint] = []
    let chars = Array(seq)
    var i = 0
    while i < chars.count {
        let c = chars[i]
        var override: GameEndOverride?
        if i + 1 < chars.count, chars[i + 1] == "E" {
            override = .end; i += 1
        } else if i + 1 < chars.count, chars[i + 1] == "C" {
            override = .continue; i += 1
        }
        out.append(mkPoint(
            out.count,
            winner: c == "U" ? .user : c == "T" ? .opponent : nil,
            override: override
        ))
        i += 1
    }
    return out
}

func score(_ seq: String) -> MatchScore {
    computeMatchScore(build(seq).map(row))
}

let NORMAL = ClipPad(pre: 1.0, post: 1.6)

// MARK: - gameScore.test.ts, ported

// MARK: - Cases

func runAllChecks() {
    suite("gameWinner needs 11 and a clear two") {
        eq(gameWinner(GameSummary(you: 11, them: 3, winnerOverride: nil)), .user, "11-3")
        eq(gameWinner(GameSummary(you: 9, them: 11, winnerOverride: nil)), .opponent, "9-11")
        eq(gameWinner(GameSummary(you: 13, them: 11, winnerOverride: nil)), .user, "13-11")
        eq(gameWinner(GameSummary(you: 11, them: 10, winnerOverride: nil)), nil, "11-10 decides nothing")
        eq(gameWinner(GameSummary(you: 8, them: 10, winnerOverride: nil)), nil, "8-10")
        eq(gameWinner(GameSummary(you: 0, them: 0, winnerOverride: nil)), nil, "0-0")
    }

    suite("an auto boundary always names a winner") {
        let s = score("UUUUUUUUUUUTTT")
        eq(s.games.count, 1, "one game closed")
        eq(s.games[0], GameSummary(you: 11, them: 0, winnerOverride: nil), "11-0")
        eq(s.gamesYou, 1, "games to you")
        eq(s.gamesThem, 0, "games to them")
        eq(s.current, GameSummary(you: 0, them: 3, winnerOverride: nil), "current game")
    }

    suite("11-9 closes the game, and 12-10 closes it after a deuce") {
        // The exact cases Adil named. 11-9 is a clear two; 11-10 is not, so the
        // game runs on until someone is two clear again.
        let clean = score("UUUUUUUUUUU" + "TTTTTTTTT")   // 11-9 reached at point 11
        eq(clean.games.count, 1, "11-9 sequence closes at 11-0 first")

        let deuce = score("UTUTUTUTUTUTUTUTUTUT" + "UU")  // 10-10 then 12-10
        eq(deuce.games.count, 1, "a deuce closes only on the clear two")
        eq(deuce.games[0], GameSummary(you: 12, them: 10, winnerOverride: nil), "12-10")
        eq(deuce.gamesYou, 1, "the deuce game goes to you")
    }

    suite("a pinned end on a barely scored game counts for nobody") {
        let s = score("UUUUUUUUUUU" + "...T........E")
        eq(s.games.count, 2, "two games")
        eq(s.games[1], GameSummary(you: 0, them: 1, winnerOverride: nil), "0-1")
        eq(s.gamesYou, 1, "still one game to you")
        eq(s.gamesThem, 0, "a lead over nothing is not a game")
    }

    suite("a pinned end on a finished game still counts") {
        let s = score("UUUUUUUUUUUC" + "TTTTTTTTTE")
        eq(s.games.count, 1, "one game")
        eq(s.games[0], GameSummary(you: 11, them: 9, winnerOverride: nil), "11-9")
        eq(s.gamesYou, 1, "the score proves it")
    }

    suite("a continue holds the game open past the auto rule") {
        let s = score("UUUUUUUUUUCUTTT")
        eq(s.games.count, 0, "nothing closed")
        eq(s.current, GameSummary(you: 11, them: 3, winnerOverride: nil), "still counting")
        check(s.open, "the walk reports the game held open")
    }

    suite("an owner-named winner makes an unprovable pinned game count") {
        var pts = build("UUUUUUUUUUU" + "UUUT.......E")
        pts[pts.count - 1].gameWinnerOverride = .opponent
        let s = computeMatchScore(pts.map(row))
        eq(s.games.count, 2, "two games")
        eq(s.games[1], GameSummary(you: 3, them: 1, winnerOverride: .opponent), "named winner rides the summary")
        eq(s.gamesYou, 1, "one each")
        eq(s.gamesThem, 1, "the named game counts")
        eq(s.boundaryAfter[pts[pts.count - 1].id]?.winnerOverride, .opponent, "the divider carries it too")
    }

    suite("resolvedGameWinner: the named winner beats the heuristic") {
        eq(resolvedGameWinner(GameSummary(you: 3, them: 1, winnerOverride: nil)), nil, "unprovable, unnamed")
        eq(resolvedGameWinner(GameSummary(you: 3, them: 1, winnerOverride: .opponent)), .opponent, "unprovable, named")
        eq(resolvedGameWinner(GameSummary(you: 11, them: 6, winnerOverride: nil)), .user, "provable, unnamed")
        eq(resolvedGameWinner(GameSummary(you: 11, them: 6, winnerOverride: .opponent)), .opponent, "a name always wins")
    }

    suite("the boundary button names the tap, and every tap has an inverse") {
        let quiet = boundaryAction(override: nil, walkEndsHere: false)
        eq(quiet.label, "Game ended", "nothing here: offer to end it")
        eq(quiet.next, .end, "and the tap pins it")

        let auto = boundaryAction(override: nil, walkEndsHere: true)
        eq(auto.label, "Didn't end", "11-9: the walk closed it, so offer to reopen")
        eq(auto.next, .continue, "held open")

        let reopened = boundaryAction(override: .continue, walkEndsHere: false)
        eq(reopened.label, "Game ended", "reopened: offer to close again")
        eq(reopened.next, nil, "clearing back to automatic is enough")

        let pinned = boundaryAction(override: .end, walkEndsHere: false)
        eq(pinned.label, "Didn't end", "a point you ended yourself offers the undo")
        eq(pinned.next, nil, "by clearing the pin")
    }

    suite("every boundary tap is its own undo") {
        let reachable: [(GameEndOverride?, Bool)] = [
            (nil, false), (nil, true), (.continue, true), (.end, false),
        ]
        func walkSays(_ o: GameEndOverride?, _ auto: Bool) -> Bool {
            o == .end ? true : o == .continue ? false : auto
        }
        for (override, auto) in reachable {
            let first = boundaryAction(override: override, walkEndsHere: walkSays(override, auto))
            let second = boundaryAction(override: first.next, walkEndsHere: walkSays(first.next, auto))
            check(first.label != second.label, "tap flips the label from \(String(describing: override)) auto=\(auto)")
            check(first.next != override, "tap does not write back what it started from (\(String(describing: override)))")
        }
    }

    // MARK: - Boundary control precedence (Player.tsx boundaryControl)

    suite("boundary control precedence") {
        let a = uuid(1), b = uuid(2), c = uuid(3)

        let fresh = boundaryControl(BoundaryInputs(
            freshlyClosedPointId: a, displayTargetId: b, displayTargetOverride: nil,
            boundaryAfter: [], endedNudgePointId: c, heldOpenEndTargetId: c
        ))
        eq(fresh?.label, "Didn't end", "a game that just closed outranks everything")
        eq(fresh?.move, .reopen(a), "and retargets at the closing point, not the playhead")
        eq(fresh?.endsHere, true, "lit")

        let atRally = boundaryControl(BoundaryInputs(
            freshlyClosedPointId: nil, displayTargetId: b, displayTargetOverride: nil,
            boundaryAfter: [b], endedNudgePointId: c, heldOpenEndTargetId: c
        ))
        eq(atRally?.label, "Didn't end", "a game ending at this rally offers the reopen")
        eq(atRally?.move, .reopen(b), "on the rally on screen")

        let nudge = boundaryControl(BoundaryInputs(
            freshlyClosedPointId: nil, displayTargetId: b, displayTargetOverride: nil,
            boundaryAfter: [], endedNudgePointId: c, heldOpenEndTargetId: a
        ))
        eq(nudge?.label, "Game ended", "an answer crossing the real end offers to close it")
        eq(nudge?.move, .pinEnd(c), "at the point just answered")
        eq(nudge?.attention, true, "and the button glows")

        let held = boundaryControl(BoundaryInputs(
            freshlyClosedPointId: nil, displayTargetId: b, displayTargetOverride: nil,
            boundaryAfter: [], endedNudgePointId: nil, heldOpenEndTargetId: a
        ))
        eq(held?.move, .pinEnd(a), "a held-open game closes at the last scored point")
        eq(held?.attention, false, "quietly")

        let plain = boundaryControl(BoundaryInputs(
            freshlyClosedPointId: nil, displayTargetId: b, displayTargetOverride: nil,
            boundaryAfter: [], endedNudgePointId: nil, heldOpenEndTargetId: nil
        ))
        eq(plain?.label, "Game ended", "anywhere else: close after this rally")
        eq(plain?.move, .pinEnd(b), "on the rally on screen")

        let nothing = boundaryControl(BoundaryInputs(
            freshlyClosedPointId: nil, displayTargetId: nil, displayTargetOverride: nil,
            boundaryAfter: [], endedNudgePointId: nil, heldOpenEndTargetId: nil
        ))
        eq(nothing == nil, true, "no rally to anchor on: no control")
    }

    suite("reopenOverride") {
        eq(reopenOverride(.end), nil, "an explicit end clears back to automatic")
        eq(reopenOverride(nil), .continue, "an automatic close is held open")
        eq(reopenOverride(.continue), .continue, "already open stays open")
    }

    suite("heldOpenEndTarget") {
        // 11-0 held open with a continue, then two more points scored.
        let pts = build("UUUUUUUUUUUC" + "TU")
        let s = computeMatchScore(pts.map(row))
        check(s.open, "the game is held open")
        let target = heldOpenEndTarget(
            points: pts, upToIndex: pts.count - 1, walkOpen: true,
            boundaryAfter: Set(s.boundaryAfter.keys)
        )
        eq(target, pts[pts.count - 1].id, "targets the last scored point")

        let closed = heldOpenEndTarget(
            points: pts, upToIndex: pts.count - 1, walkOpen: false,
            boundaryAfter: Set(s.boundaryAfter.keys)
        )
        eq(closed, nil, "not offered during ordinary counting")

        // The last scored point already closing a game hides the offer.
        let ptsB = build("UUUUUUUUUUUC" + "TUE")
        let sB = computeMatchScore(ptsB.map(row))
        let hidden = heldOpenEndTarget(
            points: ptsB, upToIndex: ptsB.count - 1, walkOpen: sB.open,
            boundaryAfter: Set(sB.boundaryAfter.keys)
        )
        eq(hidden, nil, "hidden once that point already ends a game")
    }

    suite("unprovenGameAt") {
        // A pinned end at 3-1 proves nothing: ask.
        let pts = build("UUUT.......")
        let asked = unprovenGameAt(pts[pts.count - 1].id, points: pts.map(row))
        eq(asked, GameSummary(you: 3, them: 1, winnerOverride: nil), "asks at 3-1")

        // A pinned end at 11-2 proves itself: don't ask.
        let clean = build("UUUUUUUUUUUTT")
        let quiet = unprovenGameAt(clean[10].id, points: clean.map(row))
        eq(quiet, nil, "never asks when the score decides it")
    }

    // MARK: - Advance

    suite("advanceMove") {
        // paddedEnd = cut_t0 + pre + (t1-t0) + post = 10 + 1 + 4 + 1.6 = 16.6
        let p = mkPoint(1, cutT0: 10, t0: 100, t1: 104)
        near(paddedEnd(p, NORMAL), 16.6, "padded end")

        eq(advanceMove(from: p, now: 16.2, nextStart: 20, pad: NORMAL), .jump(to: 20),
           "answering at the pause boundary jumps to the next rally")
        eq(advanceMove(from: p, now: 12.0, nextStart: 20, pad: NORMAL), .playTail(end: 16.6),
           "answering early with more than 3.5s left plays the clip out")
        eq(advanceMove(from: p, now: 13.2, nextStart: 20, pad: NORMAL), .jump(to: 20),
           "just inside the threshold jumps")
        eq(advanceMove(from: p, now: 16.5, nextStart: nil, pad: NORMAL), .stay,
           "the last rally has nowhere to go")
    }

    // MARK: - Footage extents

    suite("deletedSpans merge and clamp") {
        let visible = [mkPoint(3, cutT0: 30, t0: 300, t1: 302)]
        let deleted = [
            mkPoint(1, deleted: true, cutT0: 10, t0: 100, t1: 104),   // -> 16.6
            mkPoint(2, deleted: true, cutT0: 16, t0: 160, t1: 164),   // -> 22.6, overlaps
        ]
        let spans = deletedSpans(all: deleted + visible, visible: visible, pad: NORMAL)
        eq(spans.count, 1, "overlapping deletes merge into one span")
        eq(spans[0], TimeSpan(start: 10, end: 22.6), "merged extent")

        // A delete whose post pad overhangs the next visible rally is clamped.
        let tight = [mkPoint(1, deleted: true, cutT0: 10, t0: 100, t1: 118)]
        let neighbour = [mkPoint(2, cutT0: 25, t0: 250, t1: 252)]
        let clamped = deletedSpans(all: tight + neighbour, visible: neighbour, pad: NORMAL)
        near(clamped[0].end, 25, "clamped to the next visible padded start")
    }

    suite("spanEnd") {
        let spans = [TimeSpan(start: 10, end: 20), TimeSpan(start: 30, end: 40)]
        eq(spanEnd(spans, at: 15), 20, "inside the first span")
        eq(spanEnd(spans, at: 35), 40, "inside the second")
        eq(spanEnd(spans, at: 25), nil, "between spans")
        eq(spanEnd(spans, at: 5), nil, "before them all")
        eq(spanEnd(spans, at: 19.99), nil, "a landing on the end does not re-match")
    }

    suite("snapLanding") {
        let spans = [TimeSpan(start: 10, end: 20)]
        eq(snapLanding(15, spans: spans, firstPointStart: 5, alwaysToFirst: true), 20,
           "pushed out of deleted footage")
        eq(snapLanding(25, spans: spans, firstPointStart: 5, alwaysToFirst: true), 25,
           "left alone outside it")
        eq(snapLanding(2, spans: [], firstPointStart: 30, alwaysToFirst: true), 30,
           "score mode never opens in the dead lead")
        eq(snapLanding(2, spans: [], firstPointStart: 30, alwaysToFirst: false), 2,
           "watch mode plays an untouched pre-match pad")
        eq(snapLanding(2, spans: [TimeSpan(start: 3, end: 8)], firstPointStart: 30, alwaysToFirst: false), 30,
           "unless there is deleted footage in that lead")
    }

    suite("letSpans are score-mode landable, watch-mode skippable") {
        let pts = [
            mkPoint(1, isLet: true, cutT0: 10, t0: 100, t1: 104),
            mkPoint(2, cutT0: 30, t0: 300, t1: 302),
        ]
        let spans = letSpans(pts, pad: NORMAL)
        eq(spans.count, 1, "only the let")
        eq(spans[0], TimeSpan(start: 10, end: 16.6), "its padded extent")
    }

    // MARK: - Playhead constants (playhead.ts parity)

    suite("playhead extents") {
        let p = mkPoint(1, cutT0: 10, t0: 100, t1: 104)
        near(rallyEnd(p, NORMAL), 15.0, "rallyEnd = cut_t0 + pre + rally")
        near(paddedEnd(p, NORMAL), 16.6, "paddedEnd adds the whole post pad")
        near(pauseEnd(p, NORMAL, nextStart: nil), 16.2, "pauseEnd adds the 1.2s beat")
        near(pauseEnd(p, NORMAL, nextStart: 16.0), 15.95, "clamped just before a dense next start")
        near(pauseEnd(p, NORMAL, nextStart: 15.0), 15.0, "never earlier than the rally end")

        let split = mkPoint(2, cutT0: 10, t0: 100, t1: 104, tightStart: true, tightEnd: true)
        near(rallyEnd(split, NORMAL), 14.3, "a split-born edge uses the 0.3 tight pad")
        near(paddedEnd(split, NORMAL), 14.6, "both edges tight")
    }

    suite("fusedSplitCut finds the gap the cutter missed") {
        // A ten second point: play, a three second lull, play again.
        let times: [Double] = [100.2, 100.8, 101.4, 102.0, 105.0, 105.6, 106.2, 106.8]
        let fused = mkPoint(1, cutT0: 10, t0: 100, t1: 110, placement: detections(times))
        // rallyStart is 11, so source 103.5 lands at cut 11 + 3.5.
        near(fusedSplitCut(fused, NORMAL), 14.5, "the midpoint of the longest quiet stretch")

        let steady = mkPoint(2, cutT0: 10, t0: 100, t1: 110,
                             placement: detections([100.2, 100.8, 101.4, 102.0, 102.6, 103.2]))
        eq(fusedSplitCut(steady, NORMAL), nil, "continuous play is one rally")

        eq(fusedSplitCut(mkPoint(3, cutT0: 10, t0: 100, t1: 110), NORMAL), nil,
           "no detections, no evidence")

        // Detections in the pre pad — warm-up bounces before the serve —
        // put the quiet stretch against the point's own edge, where it is
        // the pad rather than a second rally.
        let edge = mkPoint(4, cutT0: 10, t0: 100, t1: 110,
                           placement: detections([99.0, 99.2, 99.3, 99.4, 101.1, 101.3, 101.5, 101.7]))
        eq(fusedSplitCut(edge, NORMAL), nil, "a gap centred on the edge is the pad")

        eq(fusedSplitCut(mkPoint(5, cutT0: 10, t0: 100, t1: 110,
                                 placement: detections([100.2, 105.0, 105.6])), NORMAL), nil,
           "too few detections on one side to call it play")
    }

    suite("targetAt holds the previous rally while its stop is still coming") {
        // Two rallies cut tight: point 2's padded start (19) lands BEFORE
        // point 1's answer beat (20.2), which is the whole reason the rule
        // exists.
        let pts = [
            mkPoint(1, cutT0: 10, t0: 100, t1: 108),   // rally end 19, stop 20.2
            mkPoint(2, cutT0: 19, t0: 200, t1: 204),
        ]
        near(rallyEnd(pts[0], NORMAL), 19.0, "the first rally ends where the second starts")
        near(pauseEnd(pts[0], NORMAL, nextStart: 19), 19.0, "clamped to the dense next start")

        // Clamped flush, so widen the gap a touch to get a real overlap.
        let tight = [
            mkPoint(1, cutT0: 10, t0: 100, t1: 108),   // stop 20.2 with room
            mkPoint(2, cutT0: 19.5, t0: 200, t1: 204),
        ]
        near(pauseEnd(tight[0], NORMAL, nextStart: 19.5), 19.45, "the stop overhangs the next start")

        let hold = { (t: Double, runStart: Double?, fired: UUID?) in
            targetAt(tight, at: t, pad: NORMAL, hold: true, runStart: runStart, firedId: fired)?.id
        }
        eq(hold(19.4, 12, nil), tight[0].id,
           "inside the overlap the previous rally is still the target")
        eq(hold(19.5, 12, nil), tight[1].id,
           "past its stop the next rally takes over")
        eq(hold(19.4, 12, tight[0].id), tight[1].id,
           "a boundary already consumed does not hold")
        eq(hold(19.4, 19.5, nil), tight[1].id,
           "a run that started at the new rally is watching the new rally")
        eq(hold(19.4, nil, nil), tight[1].id,
           "no run in progress, no hold")
        eq(targetAt(tight, at: 19.4, pad: NORMAL, hold: false, runStart: 12, firedId: nil)?.id,
           tight[1].id, "watch mode follows the picture")

        // An ANSWERED previous rally holds to its clip end, not the beat.
        let answered = [
            mkPoint(1, winner: .user, cutT0: 10, t0: 100, t1: 108), // padded end 20.6
            mkPoint(2, cutT0: 19.5, t0: 200, t1: 204),
        ]
        eq(targetAt(answered, at: 20.4, pad: NORMAL, hold: true, runStart: 12, firedId: nil)?.id,
           answered[0].id, "an answered rally holds to the end of its clip")

        eq(targetAt(pts, at: 5, pad: NORMAL, hold: true, runStart: nil, firedId: nil)?.id, nil,
           "before the first rally there is nothing to answer")
    }

    suite("runWatched needs the deciding shot and the right starting rally") {
        let pts = [
            mkPoint(1, cutT0: 10, t0: 100, t1: 108),   // rally end 19
            mkPoint(2, cutT0: 19.5, t0: 200, t1: 204), // rally end 25.5
        ]
        check(runWatched(pts[0], points: pts, runStart: 12, pad: NORMAL),
              "a run through the rally may stop at its end")
        check(!runWatched(pts[0], points: pts, runStart: 19.0, pad: NORMAL),
              "a run starting at the deciding shot did not watch it")
        check(!runWatched(pts[0], points: pts, runStart: nil, pad: NORMAL),
              "no run, no stop")
        check(!runWatched(pts[0], points: pts, runStart: 19.4, pad: NORMAL),
              "a run that began inside the NEXT rally is never hijacked backwards")
        check(runWatched(pts[1], points: pts, runStart: 19.4, pad: NORMAL),
              "that same run does stop at its own rally's end")
    }

    suite("playingPointId is WYSIWYG with a 0.25s lead") {
        let pts = [
            mkPoint(1, cutT0: 10, t0: 100, t1: 104),
            mkPoint(2, cutT0: 20, t0: 200, t1: 204),
        ]
        eq(playingPointId(pts, at: 5), nil, "before the first point")
        eq(playingPointId(pts, at: 9.8), pts[0].id, "flips a quarter second early")
        eq(playingPointId(pts, at: 15), pts[0].id, "inside the first")
        eq(playingPointId(pts, at: 19.9), pts[1].id, "flips to the next at its padded start")
        eq(playingPointId(pts, at: 999), pts[1].id, "stays on the last")
    }
}

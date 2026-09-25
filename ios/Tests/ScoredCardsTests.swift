import Foundation

// The video cards' arithmetic, checked against the same cases the web
// module's tests use (src/lib/placement/scoredCards.test.ts). The gate is
// the highlights' gate: 3 of 4 opens, 2 of 3 does not, 41 of 98 needs 74.

private func decodePoint(_ json: String) -> MatchPoint? {
    try? JSONDecoder().decode(MatchPoint.self, from: Data(json.utf8))
}

private func pointJSON(
    id: String, winner: String?, rallyEnd: Double? = nil, tap: Double? = nil,
    isLet: Bool = false, placement: String? = nil, t0: Double = 100, t1: Double = 105
) -> String {
    let winnerField = winner.map { "\"confirmed_winner\": \"\($0)\"," } ?? ""
    let rallyField = rallyEnd.map { "\"rally_end_cut_s\": \($0)," } ?? ""
    let tapField = tap.map { "\"scored_at_cut_s\": \($0)," } ?? ""
    let placementField = placement.map { "\"placement\": \($0)," } ?? ""
    return """
    {"id": "\(id)", "match_id": "11111111-1111-1111-1111-111111111111", "idx": 1,
     "t0": \(t0), "t1": \(t1), "cut_t0": 50, "is_let": \(isLet), "starred": false,
     "deleted": false, "edited": false, "tight_start": false, "tight_end": false,
     \(winnerField) \(rallyField) \(tapField) \(placementField)
     "server": null}
    """
}

private func uuid(_ n: Int) -> String {
    String(format: "%08x-0000-4000-8000-000000000000", n)
}

/// A serve from the near end: first bounce on the near half, landing on the
/// far half, consecutive candidates, plus whatever extra bounces follow.
/// `refused` swaps the two halves, so the app's serve rules turn it down.
private func placementJSON(
    extra: [(u: Double?, v: Double?, t: Double, kind: String)] = [], refused: Bool = false
) -> String {
    let firstV = refused ? 2.0 : 0.6
    let landingV = refused ? 0.6 : 2.2
    let extras = extra.enumerated().map { index, e in
        let u = e.u.map { "\($0)" } ?? "null"
        let v = e.v.map { "\($0)" } ?? "null"
        return "{\"id\": \"x\(index)\", \"kind\": \"\(e.kind)\", \"t\": \(e.t), \"u\": \(u), \"v\": \(v)}"
    }.joined(separator: ",")
    let serve = """
    {"id": "shot-1", "seq": 1, "phase": "serve", "hitter_side": "near", "contact_t": null, "contact": null,
     "serve_first_bounce": {"event_id": "c1", "t": 100.0, "u": 0.7, "v": \(firstV), "confidence": 0.9},
     "landing": {"event_id": "c2", "t": 100.4, "u": 0.7, "v": \(landingV), "confidence": 0.9},
     "terminal": null, "confidence": 0.9}
    """
    return """
    {"v": 3, "status": "ready",
     "candidates": [{"id": "c1", "kind": "bounce", "t": 100.0, "u": 0.7, "v": \(firstV)},
                    {"id": "c2", "kind": "bounce", "t": 100.4, "u": 0.7, "v": \(landingV)}\(extras.isEmpty ? "" : "," + extras)],
     "hypotheses": {
       "near": {"status": "ready", "confidence": 0.9, "server_side": "near", "shots": [\(serve)], "hard_reasons": [], "reasons": []},
       "far": {"status": "unavailable", "confidence": 0.1, "server_side": "far", "shots": [], "hard_reasons": [], "reasons": []}
     }}
    """
}

func runScoredCardsChecks() {
    print("\n— scored cards —")

    // The gate, in the SQL's integer arithmetic.
    func gate(_ scored: Int, _ of: Int) -> ScoredCardsGate {
        var points: [MatchPoint] = []
        for i in 0..<of {
            guard let p = decodePoint(pointJSON(id: uuid(i + 1), winner: i < scored ? "user" : nil)) else {
                check(false, "gate fixture point decodes"); return ScoredCardsGate(scored: 0, eligible: 0, share: 0, required: 0, open: false)
            }
            points.append(p)
        }
        if let letPoint = decodePoint(pointJSON(id: uuid(900), winner: nil, isLet: true)) { points.append(letPoint) }
        return scoredCardsGate(points)
    }
    check(gate(3, 4).open, "3 of 4 scored opens the gate")
    check(!gate(2, 4).open, "2 of 4 scored does not")
    check(gate(3, 4).eligible == 4, "a let is not a scoreable point")
    check(!gate(2, 3).open, "2 of 3 does not open (integer rule, not a rounded percent)")
    check(gate(41, 98).required == 74, "41 of 98 asks for 74")
    check(gate(74, 98).open && !gate(73, 98).open, "74 of 98 opens, 73 does not")

    // Clocks: source = t0 - pre - cut_t0 + cut seconds.
    if let p = decodePoint(pointJSON(id: uuid(1), winner: "user", rallyEnd: 55, tap: 53)) {
        check(cutToSource(p, prePad: 1, cutS: 60) == 109, "cut clock to source clock uses the padded clip start")
        check(pointEndSource(p, prePad: 1) == 102, "a point ends at the earlier of the rally end and the score tap")
    } else {
        check(false, "clock fixture point decodes")
    }
    if let p = decodePoint(pointJSON(id: uuid(2), winner: "user", rallyEnd: 52, tap: 53)) {
        check(pointEndSource(p, prePad: 1) == 101, "the rally end wins when it comes first")
    }
    if let p = decodePoint(pointJSON(id: uuid(3), winner: "user")) {
        check(pointEndSource(p, prePad: 1) == nil, "no ending without a rally end or a tap")
    }

    // The last clean bounce ignores contacts, the net band and dead play.
    let placement = try? JSONDecoder().decode(PlacementV3Data.self, from: Data(placementJSON(extra: [
        (0.6, 0.5, 101.0, "bounce"),      // real landing on the near half
        (0.6, 1.30, 101.3, "bounce"),     // net band
        (0.5, 2.6, 101.6, "bounce"),      // racket contact read as a bounce
        (0.5, 2.6, 101.62, "contact"),
        (0.9, 2.4, 104.0, "bounce"),      // ball rolling about long after
    ]).utf8))
    if let placement {
        check(lastCleanBounce(placement, end: 105)?.t == 101.0, "the last clean bounce skips the net band, the contact and dead play")
        check(lastCleanBounce(placement, end: 100.5)?.t == 100.4, "an earlier ending keeps only the serve bounces")
    } else {
        check(false, "placement fixture decodes")
    }

    // The whole computation on a small match: point length bands and the
    // endings self-check, the user serving from the near end and losing.
    var points: [MatchPoint] = []
    var serving: [UUID: ServeInfo] = [:]
    var gameIndex: [UUID: Int] = [:]
    for i in 0..<10 {
        // Eight endings on the near (loser's) half, two on the far half.
        let v = i < 8 ? 0.3 : 2.5
        let json = pointJSON(
            id: uuid(100 + i), winner: "opponent", rallyEnd: 52.5,
            placement: placementJSON(extra: [(0.4, v, 101.0, "bounce")])
        )
        guard let p = decodePoint(json) else { check(false, "match fixture point decodes"); return }
        points.append(p)
        serving[p.id] = ServeInfo(server: .user, source: .rotation, isLet: false)
        gameIndex[p.id] = 0
    }
    let result = computeScoredCards(
        points: points, userSide: "near", gameIndexByPoint: gameIndex,
        serving: serving, prePad: { _ in 1 }
    )
    check(result != nil, "a fully scored match computes")
    check(result?.pointLength.covered == 10, "every point has a length")
    check(result?.pointLength.mine.first?.lost == 10, "all ten are under 3 s on the user's serve, all lost")
    check(result?.endings.considered == 10 && result?.endings.agreed == 8, "eight of ten endings sit on the loser's half")
    check(result?.endings.shown == true, "80% agreement shows the endings card")
    check(result?.endings.lost == 8 && result?.endings.won == 0, "the endings are the user's losses")
    check(result?.serveSpeedMine.count == 3, "ten identical-speed serves still split into three bands")
    check(result?.varietyMine?.count == 10 && result?.varietyMine?.zonesUsed == 1, "ten serves to one zone")

    // Game filter narrows the cards, never the gate.
    var filtered = gameIndex
    filtered[points[0].id] = 1
    let game1 = computeScoredCards(
        points: points, userSide: "near", gameIndexByPoint: filtered,
        serving: serving, prePad: { _ in 1 }, gameFilter: 1
    )
    check(game1?.gate.scored == 10 && game1?.pointLength.considered == 1, "a game filter narrows the cards but never the gate")

    runHandCutPointLengthChecks()
    runAnalysisToolRowChecks()
}

/// The Tools row for the analysis section, by the web's rule (MatchView:
/// `scored || placementMappedPoints > 0`). QA 2026-09-25: a hand-cut
/// practice match had the row and an empty section under it.
private func runAnalysisToolRowChecks() {
    check(AnalysisToolRow.shown(scoredType: true, mappedPoints: 0), "a match that keeps a score has the row")
    check(!AnalysisToolRow.shown(scoredType: false, mappedPoints: 0),
          "a practice with nothing mapped has no row, whatever the analysis status")
    check(AnalysisToolRow.shown(scoredType: false, mappedPoints: 4), "a practice with mapped points has it")
    eq(AnalysisToolRow.unscoredTrailing(mappedPoints: 4), "4 points mapped", "and says how many, as the web does")
    eq(AnalysisToolRow.unscoredTrailing(mappedPoints: 1), "1 point mapped", "one point is singular")
    let unplaced = (0..<5).compactMap { decodePoint(pointJSON(id: uuid(700 + $0), winner: nil)) }
    eq(mappedPointCount(unplaced, userSide: "near", gameIndexByPoint: [:], serving: [:], servesOnly: true), 0,
       "points with no placement map nothing")
    eq(mappedPointCount(unplaced, userSide: nil, gameIndexByPoint: [:], serving: [:], servesOnly: false), 0,
       "and nothing is mapped without an end")
}

/// Hand cuts (cut_source = "manual"): the owner's marks are the point. The
/// End Point tap (t1) is the end, the start mark (t0) is the start wherever
/// the ball gave no serve time, and point length needs no side. The same
/// cases as src/lib/placement/scoredCards.test.ts.
private func runHandCutPointLengthChecks() {
    func points(_ specs: [(winner: String, t0: Double, t1: Double, tap: Double?, placement: String?)]) -> [MatchPoint] {
        specs.enumerated().compactMap { index, spec in
            decodePoint(pointJSON(
                id: uuid(500 + index), winner: spec.winner, tap: spec.tap,
                placement: spec.placement, t0: spec.t0, t1: spec.t1
            ))
        }
    }
    func run(_ points: [MatchPoint], userSide: String?, trusted: Bool = true, handCut: Bool = true) -> ScoredCardsResult? {
        computeScoredCards(
            points: points, userSide: userSide,
            gameIndexByPoint: Dictionary(uniqueKeysWithValues: points.map { ($0.id, 0) }),
            serving: Dictionary(uniqueKeysWithValues: points.map {
                ($0.id, ServeInfo(server: .user, source: .rotation, isLet: false))
            }),
            prePad: { _ in 1 }, placementTrusted: trusted, handCut: handCut
        )
    }
    func bands(_ result: ScoredCardsResult?) -> [[Int]] {
        (result?.pointLength.mine ?? []).map { [$0.won, $0.lost] }
    }

    // From the marks alone: no side, no ball. Lengths run from 2 s after
    // the mark (the serve), never under 0.5 s: 0.5 s, 2.5 s, 5 s, 7 s.
    let marked = points([
        ("user", 100, 102, nil, nil),
        ("opponent", 200, 204.5, nil, nil),
        ("user", 300, 307, nil, nil),
        ("user", 400, 409, nil, nil),
    ])
    check(marked.count == 4, "hand-cut fixture points decode")
    let fromMarks = run(marked, userSide: nil, trusted: false)
    check(fromMarks != nil, "a hand cut computes without a side")
    check(fromMarks?.pointLength.covered == 4 && fromMarks?.pointLength.considered == 4, "every marked point has a length")
    check(bands(fromMarks) == [[1, 1], [1, 0], [1, 0]], "a hand cut times each point from its marks")
    check(HAND_CUT_MARK_TO_SERVE_S == 2 && handCutServeStart(100, 106) == 102
          && abs(handCutServeStart(100, 101.2) - 100.7) < 1e-9 && handCutServeStart(100, 100.2) == 100,
          "a hand cut's mark is moved on to where the serve lands")
    check(fromMarks?.serveSpeedMine.isEmpty == true && fromMarks?.serveSpeedTheirs.isEmpty == true
          && fromMarks?.endings.considered == 0, "nothing that needs the ball or the side")
    check(run(marked, userSide: "near", handCut: false)?.pointLength.covered == 0,
          "the same points as an automatic cut, with no rally end or tap, have no length")

    // The End Point tap is the end, not a later score tap (cut 60 -> 109).
    let tapped = points((0..<3).map { _ in ("user", 100, 102, 60, nil) })
    check(bands(run(tapped, userSide: "near")) == [[3, 0], [0, 0], [0, 0]], "a hand cut ends at the End Point tap, not at a later score tap")

    // A late Begin tap: the serve's first bounce (100.0) is before the mark
    // (101.5). From the bounce it is 3.5 s; from the mark it would be 2 s.
    let late = points((0..<3).map { _ in ("user", 101.5, 103.5, nil, placementJSON()) })
    check(bands(run(late, userSide: "near")) == [[0, 0], [3, 0], [0, 0]], "a hand cut uses the ball's serve time where it has one")
    check(bands(run(late, userSide: "near", trusted: false)) == [[3, 0], [0, 0], [0, 0]], "before the analysis is trusted, the mark is the start")
    check(bands(run(late, userSide: nil)) == [[3, 0], [0, 0], [0, 0]], "without a side there is no serve to read, so the mark again")

    // A refused serve: an automatic cut would fall back to the first table
    // bounce (100.0, 3.5 s); the hand cut's own marks say 0.5 s.
    let refused = points((0..<3).map { _ in ("user", 101.5, 103.5, nil, placementJSON(refused: true)) })
    check(bands(run(refused, userSide: "near")) == [[3, 0], [0, 0], [0, 0]], "a hand cut with no trusted serve starts at the mark, not the first bounce")

    // Still behind the scored gate.
    let unscored = points([("user", 100, 102, nil, nil)])
        + [decodePoint(pointJSON(id: uuid(599), winner: nil, t0: 200, t1: 202))].compactMap { $0 }
    check(run(unscored, userSide: nil) == nil, "a hand cut still waits for the scored gate")
}

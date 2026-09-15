import Foundation

// The video cards' arithmetic, checked against the same cases the web
// module's tests use (src/lib/placement/scoredCards.test.ts). The gate is
// the highlights' gate: 3 of 4 opens, 2 of 3 does not, 41 of 98 needs 74.

private func decodePoint(_ json: String) -> MatchPoint? {
    try? JSONDecoder().decode(MatchPoint.self, from: Data(json.utf8))
}

private func pointJSON(
    id: String, winner: String?, rallyEnd: Double? = nil, tap: Double? = nil,
    isLet: Bool = false, placement: String? = nil
) -> String {
    let winnerField = winner.map { "\"confirmed_winner\": \"\($0)\"," } ?? ""
    let rallyField = rallyEnd.map { "\"rally_end_cut_s\": \($0)," } ?? ""
    let tapField = tap.map { "\"scored_at_cut_s\": \($0)," } ?? ""
    let placementField = placement.map { "\"placement\": \($0)," } ?? ""
    return """
    {"id": "\(id)", "match_id": "11111111-1111-1111-1111-111111111111", "idx": 1,
     "t0": 100, "t1": 105, "cut_t0": 50, "is_let": \(isLet), "starred": false,
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
private func placementJSON(extra: [(u: Double?, v: Double?, t: Double, kind: String)] = []) -> String {
    let extras = extra.enumerated().map { index, e in
        let u = e.u.map { "\($0)" } ?? "null"
        let v = e.v.map { "\($0)" } ?? "null"
        return "{\"id\": \"x\(index)\", \"kind\": \"\(e.kind)\", \"t\": \(e.t), \"u\": \(u), \"v\": \(v)}"
    }.joined(separator: ",")
    let serve = """
    {"id": "shot-1", "seq": 1, "phase": "serve", "hitter_side": "near", "contact_t": null, "contact": null,
     "serve_first_bounce": {"event_id": "c1", "t": 100.0, "u": 0.7, "v": 0.6, "confidence": 0.9},
     "landing": {"event_id": "c2", "t": 100.4, "u": 0.7, "v": 2.2, "confidence": 0.9},
     "terminal": null, "confidence": 0.9}
    """
    return """
    {"v": 3, "status": "ready",
     "candidates": [{"id": "c1", "kind": "bounce", "t": 100.0, "u": 0.7, "v": 0.6},
                    {"id": "c2", "kind": "bounce", "t": 100.4, "u": 0.7, "v": 2.2}\(extras.isEmpty ? "" : "," + extras)],
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
}

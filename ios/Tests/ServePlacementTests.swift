import Foundation

// The web and the phone must draw the SAME serve map for the same match.
//
// collectServePlacementObservations exists twice — once in TypeScript, once
// in Swift — and nothing about the two implementations forces them to
// agree. A divergence here is not a crash and not a blank screen; it is the
// owner seeing 79 serves in the browser and 74 on their phone, or one dot
// on the wrong side of the net, with nothing anywhere saying which is
// right. So it is a test, not an assumption.
//
// The fixture is the Chris match (98 scored points, PingPod, 22 Aug) with
// every field the rule does not read stripped out. `expected` in it is the
// WEB collector's own output, produced by running the real TypeScript
// module: this compares the port against the original rather than against
// a second reading of the spec.
//
// Regenerating it: see docs/research/2026-08-23-placement-yield/.

private struct ParityFixture: Decodable {
    struct Point: Decodable {
        let id: UUID
        let gameIndex: Int
        let server: String?
        let placement: PlacementData?

        enum CodingKeys: String, CodingKey {
            case id, server, placement
            case gameIndex = "game_index"
        }
    }

    struct Expected: Decodable, Hashable {
        let pointId: UUID
        let shotSeq: Int
        let filter: String
        let u: Double
        let v: Double
        let serverWon: Bool?

        enum CodingKeys: String, CodingKey {
            case filter, u, v
            case pointId = "point_id"
            case shotSeq = "shot_seq"
            case serverWon = "server_won"
        }
    }

    struct Tally: Decodable { let total: Int; let scored: Int; let won: Int }

    let userSide: String
    let points: [MatchPoint]
    let expected: [Expected]
    let expectedZones: [String: [String: Tally]]

    enum CodingKeys: String, CodingKey {
        case userSide, points, expected
        case expectedZones = "expected_zones"
    }
}

/// Comparable to a rounded millimetre. The two languages do the same
/// arithmetic in the same order, but asserting bit equality on Doubles
/// across two runtimes tests the FPU rather than the rule.
private struct Landing: Hashable, CustomStringConvertible {
    let point: UUID
    let seq: Int
    let filter: String
    let u: Int
    let v: Int

    init(point: UUID, seq: Int, filter: String, u: Double, v: Double) {
        self.point = point
        self.seq = seq
        self.filter = filter
        self.u = Int((u * 1000).rounded())
        self.v = Int((v * 1000).rounded())
    }

    var description: String {
        "\(point.uuidString.prefix(8)) #\(seq) \(filter) (\(u), \(v))"
    }
}

private func filterName(_ f: PlacementAggregateFilter) -> String {
    switch f {
    case .myServes: "myServes"
    case .theirServes: "theirServes"
    case .myRally: "myRally"
    case .theirRally: "theirRally"
    }
}

func runServePlacementParityChecks() {
    let url = URL(fileURLWithPath: "fixtures/serve-parity.json")
    guard let data = try? Data(contentsOf: url) else {
        check(false, "fixture fixtures/serve-parity.json is readable")
        return
    }
    let fixture: ParityFixture
    do {
        fixture = try JSONDecoder().decode(ParityFixture.self, from: data)
    } catch {
        check(false, "fixture decodes into MatchPoint: \(error)")
        return
    }

    // The extra decode of the same file is what reads game_index and
    // server, which live beside the MatchPoint fields rather than on them.
    struct Sidecar: Decodable { let points: [ParityFixture.Point] }
    guard let sidecar = try? JSONDecoder().decode(Sidecar.self, from: data) else {
        check(false, "fixture sidecar decodes")
        return
    }

    eq(fixture.points.count, 98, "fixture carries every live point")
    check(!fixture.expected.isEmpty, "fixture carries the web's own answer")

    var gameIndexByPoint: [UUID: Int] = [:]
    var serving: [UUID: ServeInfo] = [:]
    for point in sidecar.points {
        gameIndexByPoint[point.id] = point.gameIndex
        if let server = point.server.flatMap(Winner.init(rawValue:)) {
            serving[point.id] = ServeInfo(
                server: server, source: .rotation, isLet: false)
        }
    }

    let observations = collectServePlacementObservations(
        points: fixture.points,
        userSide: fixture.userSide,
        gameIndexByPoint: gameIndexByPoint,
        serving: serving
    )

    let mine = Set(observations.map {
        Landing(point: $0.pointId, seq: $0.shotSeq,
                filter: filterName($0.filter), u: $0.u, v: $0.v)
    })
    let theirs = Set(fixture.expected.map {
        Landing(point: $0.pointId, seq: $0.shotSeq,
                filter: $0.filter, u: $0.u, v: $0.v)
    })

    eq(observations.count, fixture.expected.count,
       "the port draws as many serves as the web does")
    eq(mine.count, theirs.count, "no duplicate landings on either side")

    let onlyHere = mine.subtracting(theirs).sorted { $0.description < $1.description }
    let onlyWeb = theirs.subtracting(mine).sorted { $0.description < $1.description }
    check(onlyHere.isEmpty,
          "nothing drawn on the phone that the web refuses: \(onlyHere.prefix(5))")
    check(onlyWeb.isEmpty,
          "nothing drawn on the web that the phone refuses: \(onlyWeb.prefix(5))")

    // A serve is one landing per point, so these must agree. If they ever
    // stop, the port has started emitting rally shots.
    eq(trustedPlacementPointCount(observations), observations.count,
       "one serve per point")

    // Whose serve, counted. A systematic flip would keep every count above
    // identical and put every dot on the wrong player.
    let mineCount = observations.filter { $0.filter == .myServes }.count
    let theirCount = fixture.expected.filter { $0.filter == "myServes" }.count
    eq(mineCount, theirCount, "the two agree about whose serves are whose")
    check(observations.allSatisfy { $0.filter == .myServes || $0.filter == .theirServes },
          "serve mode never emits a rally landing")

    // The heat map squares, on the same real match. Zone classification and
    // the win counts exist twice now, and "he won 11 of the 13 he served to
    // my backhand" is a number a player changes their receive over — a port
    // that puts it in the wrong square is worse than no map at all.
    for (name, filter) in [("myServes", PlacementAggregateFilter.myServes),
                           ("theirServes", .theirServes)] {
        guard let want = fixture.expectedZones[name] else {
            check(false, "fixture carries \(name) zone tallies"); continue
        }
        let got = placementZoneTallies(observations, filter: filter)
        var mismatches: [String] = []
        for (key, tally) in want {
            let parts = key.split(separator: "_")
            let depth: PlacementDepth = parts[0] == "short" ? .short
                : parts[0] == "medium" ? .medium : .deep
            let lateral: PlacementLateral = parts[1] == "left" ? .left
                : parts[1] == "middle" ? .middle : .right
            let mine = got[PlacementZone(depth: depth, lateral: lateral)]
                ?? PlacementZoneTally()
            if mine.total != tally.total || mine.scored != tally.scored
                || mine.won != tally.won {
                mismatches.append(
                    "\(key): phone \(mine.won)/\(mine.scored) of \(mine.total), "
                    + "web \(tally.won)/\(tally.scored) of \(tally.total)")
            }
        }
        check(mismatches.isEmpty,
              "\(name) squares match the web: \(mismatches.prefix(3))")
        let webTotal = want.values.reduce(0) { $0 + $1.total }
        let phoneTotal = got.values.reduce(0) { $0 + $1.total }
        eq(phoneTotal, webTotal, "\(name): same number of landings binned")
    }
}

// The heat map's numbers, held to the web's.
//
// Zone classification and the win tallies exist twice now, and the whole
// point of the squares is a number a player will act on: "he won 10 of the
// 10 he served to my backhand" changes how you receive. A port that puts
// those in the wrong square, or counts an unscored point as a loss, is
// worse than no map.
func runPlacementHeatMapChecks() {
    let W = TABLE_W, L = TABLE_L

    // Thirds across, and depth measured from the NET into the receiver's
    // half — so "deep" is the far end of their side, not the far end of
    // the table.
    let incoming = PlacementAggregateFilter.theirServes   // lands on my half
    eq(placementZone(u: 0.2, v: 0.2, filter: incoming)?.lateral, .left,
       "u near 0 is the left third")
    eq(placementZone(u: 0.2, v: 0.2, filter: incoming)?.depth, .deep,
       "just off my own end line is DEEP for an incoming serve")
    eq(placementZone(u: W - 0.2, v: L / 2 - 0.1, filter: incoming)?.lateral,
       .right, "u near the width is the right third")
    eq(placementZone(u: 0.76, v: L / 2 - 0.1, filter: incoming)?.depth, .short,
       "just under the net is SHORT")
    check(placementZone(u: 0.76, v: L / 2 + 0.4, filter: incoming) == nil,
          "a landing on the wrong half has no zone")

    let outgoing = PlacementAggregateFilter.myServes      // lands on their half
    eq(placementZone(u: 0.2, v: L - 0.2, filter: outgoing)?.depth, .deep,
       "for my own serve, deep is THEIR end line")

    // Tallies: won, lost and unscored in one square.
    let id = UUID()
    let zone = PlacementZone(depth: .deep, lateral: .left)
    func obs(_ won: Bool?) -> TrustedPlacementObservation {
        TrustedPlacementObservation(
            pointId: UUID(), shotSeq: 1, filter: incoming,
            u: 0.2, v: 0.2, serverWon: won
        )
    }
    let tallies = placementZoneTallies(
        [obs(true), obs(true), obs(false), obs(nil)], filter: incoming
    )
    eq(tallies[zone]?.total, 4, "every landing counts toward the total")
    eq(tallies[zone]?.scored, 3, "the unscored point is not scored")
    eq(tallies[zone]?.won, 2, "two of the three scored points were won")
    check(placementZonesAreScored(tallies), "this view can show a win rate")

    // An unscored point is NOT a point the server lost.
    let none = placementZoneTallies([obs(nil), obs(nil)], filter: incoming)
    eq(none[zone]?.total, 2, "unscored landings still show as landings")
    eq(none[zone]?.won, 0, "and contribute no wins")
    check(!placementZonesAreScored(none),
          "with nothing scored there is no win rate to show")

    // Wrong filter, wrong map.
    eq(placementZoneTallies([obs(true)], filter: .myServes).count, 0,
       "a filter with no observations tallies nothing")

    eq(placementHeatMapTitle(scored: true), "Heat map (won / total)",
       "the title carries the only explanation the numbers get")
    eq(placementHeatMapTitle(scored: false), "Heat map",
       "and says nothing it cannot back up")
    _ = id
}

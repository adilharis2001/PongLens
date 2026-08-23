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

        enum CodingKeys: String, CodingKey {
            case filter, u, v
            case pointId = "point_id"
            case shotSeq = "shot_seq"
        }
    }

    let userSide: String
    let points: [MatchPoint]
    let expected: [Expected]
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
}

import Foundation

// The cards a match earns once most of it is scored. A port of
// src/lib/placement/scoredCards.ts; keep the two in step, and keep the
// reasoning there (the file's header) in mind before loosening anything.
//
// Everything here reads data the worker already stored and the owner's own
// scoring. The score is the trusted record: who served comes from the
// rotation, who won from the confirmed winner, and where a point ended from
// the owner's own tap. The placement JSON supplies the serve's two bounces
// and the candidate bounces, and every rule below refuses what the camera
// got wrong rather than guessing more.
//
// A hand-cut match (cut_source = "manual") has no rally end and no
// detector, but the owner marked every point: the End Point tap (t1) is its
// ending and the start mark (t0) its start wherever the ball gave no serve
// time. Point length is the one card that needs neither the ball nor the
// owner's side, so a hand cut gets it from its marks alone.

/// Share of scoreable points that must carry a winner before any card shows.
/// The same bar as the highlights, and the same arithmetic as
/// public.highlight_generation_eligibility. Change both or neither.
let SCORED_CARDS_MIN_SHARE = 0.75
/// A bounce this close to a detected racket contact is the contact.
let NEAR_CONTACT_S = 0.085
/// A bounce this close to the net line is a net cord or a ball in flight.
let NET_BAND_M = 0.15
/// A trailing bounce this long after the previous one is dead play.
let DEAD_PLAY_GAP_S = 1.5
/// Endings show only where the last bounce agrees with the score this often.
let ENDINGS_MIN_AGREEMENT = 0.7
let ENDINGS_MIN_POINTS = 10
/// Same floor the analysis deck uses: two data points are not a pattern.
let SCORED_CARDS_MIN_SAMPLES = 3

private let NET_V_M = TABLE_L / 2

struct ScoredCardsGate: Hashable {
    let scored: Int
    /// Scoreable points: live, and not a let.
    let eligible: Int
    let share: Double
    /// How many scored points the bar asks for, rounded up like the SQL.
    let required: Int
    let open: Bool
}

func scoredCardsGate(_ points: [MatchPoint]) -> ScoredCardsGate {
    let eligible = points.filter { !$0.deleted && !$0.isLet }
    let scored = eligible.filter { $0.confirmedWinner != nil }.count
    let n = eligible.count
    return ScoredCardsGate(
        scored: scored,
        eligible: n,
        share: n > 0 ? Double(scored) / Double(n) : 0,
        required: (n * 3 + 3) / 4,
        // Integer arithmetic, as the SQL does it: 3 of 4 opens, 2 of 3 does not.
        open: n > 0 && scored * 4 >= n * 3
    )
}

/// Cut-video seconds → source-video seconds, the clock the placement
/// candidates carry. cut_t0 is the padded clip start on the cut clock and
/// t0 minus the effective pre pad is the same instant on the source clock
/// (Playhead.swift, the anchoring fact).
func cutToSource(_ point: MatchPoint, prePad: Double, cutS: Double) -> Double? {
    guard let t0 = point.t0, let cutT0 = point.cutT0 else { return nil }
    return t0 - prePad - cutT0 + cutS
}

/// When the point ended: the earlier of the worker's rally end and the
/// owner's score tap. On one point in five the rally end sits after the
/// tap (dead play); the tap bounds it.
func pointEndSource(_ point: MatchPoint, prePad: Double) -> Double? {
    [point.rallyEndCutS, point.scoredAtCutS]
        .compactMap { $0 }
        .compactMap { cutToSource(point, prePad: prePad, cutS: $0) }
        .min()
}

func readableZone(_ zone: PlacementZone) -> String {
    "\(zone.depth) \(zone.lateral)"
}

struct SpeedBand: Hashable {
    let label: String
    var won: Int
    var lost: Int
    /// Band edges in km/h along the table; nil at the open ends.
    let fromKmh: Double?
    let toKmh: Double?
}

struct VarietyZone: Hashable {
    let zone: PlacementZone
    let label: String
    let count: Int
}

struct VarietySummary: Hashable {
    let count: Int
    let zonesUsed: Int
    let top: [VarietyZone]
    let topShare: Double
}

struct PointLengthResult: Hashable {
    /// Points on the uploader's serve, one tally per length band.
    let mine: [Tally]
    /// Points on the opponent's serve.
    let theirs: [Tally]
    let covered: Int
    let considered: Int
}

struct EndingsResult: Hashable {
    /// Points with a usable last bounce and an ending.
    let considered: Int
    /// ... whose last bounce sits on the loser's half, as it must.
    let agreed: Int
    let agreement: Double
    let shown: Bool
    /// Endings on the uploader's half: points they lost.
    let lostCounts: [PlacementZone: Int]
    /// Endings on the opponent's half: points the uploader won.
    let wonCounts: [PlacementZone: Int]
    let lost: Int
    let won: Int
}

struct ScoredCardsResult {
    let gate: ScoredCardsGate
    let pointLength: PointLengthResult
    let serveSpeedMine: [SpeedBand]
    let serveSpeedTheirs: [SpeedBand]
    let varietyMine: VarietySummary?
    let varietyTheirs: VarietySummary?
    let endings: EndingsResult
}

private func insideTable(_ u: Double, _ v: Double) -> Bool {
    u >= 0 && u <= TABLE_W && v >= 0 && v <= TABLE_L
}

private func halfOf(_ v: Double) -> String { v < NET_V_M ? "near" : "far" }

private struct ScoredContext {
    let point: MatchPoint
    let server: Winner
    /// Nil only on a hand cut whose owner has not said which end they
    /// played from; such a point never carries placement.
    let serverSide: String?
    let userPhysical: String?
    let loserSide: String?
    let placement: PlacementV3Data?
    /// The serve as the app's own six rules drew it, or nil.
    let drawn: TrustedPlacementObservation?
    let end: Double?
    /// A hand cut's start mark (t0, source clock); nil on an automatic cut.
    let markStart: Double?
}

private func serveShot(_ ctx: ScoredContext) -> PlacementShot? {
    guard let data = ctx.placement, let serverSide = ctx.serverSide else { return nil }
    return selectPlacementHypothesis(data, serverSide: serverSide)?
        .shots.first { $0.phase == "serve" }
}

/// How far a hand cut's start mark sits before the serve's first bounce,
/// where an automatic point's length starts. Measured 2026-09-25 on the
/// first two hand cuts given detailed analysis (75 points): median 2.1 s
/// and 1.8 s. Twin of HAND_CUT_MARK_TO_SERVE_S in scoredCards.ts.
let HAND_CUT_MARK_TO_SERVE_S = 2.0
/// Every marked point keeps at least this much length (an ace is short).
let HAND_CUT_MIN_LENGTH_S = 0.5

func handCutServeStart(_ markStart: Double, _ end: Double) -> Double {
    max(markStart, min(markStart + HAND_CUT_MARK_TO_SERVE_S, end - HAND_CUT_MIN_LENGTH_S))
}

private let LENGTH_BANDS: [(label: String, max: Double)] = [
    ("Under 3 s", 3), ("3 to 6 s", 6), ("Over 6 s", .infinity),
]

private func pointLength(_ contexts: [ScoredContext]) -> PointLengthResult {
    var mine = LENGTH_BANDS.map { Tally(label: $0.label, won: 0, lost: 0) }
    var theirs = mine
    var covered = 0
    for ctx in contexts {
        guard let end = ctx.end else { continue }
        var start: Double?
        if ctx.drawn != nil, let t = serveShot(ctx)?.serveFirstBounce?.t {
            start = t
        } else if let mark = ctx.markStart {
            // A hand cut with no serve time from the ball: the owner's start
            // mark, moved on to where the serve lands.
            start = handCutServeStart(mark, end)
        } else if let data = ctx.placement {
            // No trusted serve: the first bounce seen on the table before the
            // point ended. Later than the real start by a shot at most.
            start = (data.candidates ?? [])
                .filter { $0.kind == "bounce" }
                .sorted { ($0.t ?? 0) < ($1.t ?? 0) }
                .first { c in
                    guard let u = c.u, let v = c.v, let t = c.t else { return false }
                    return insideTable(u, v) && t < end
                }?.t
        }
        guard let start else { continue }
        let duration = end - start
        if duration < 0.3 { continue }
        covered += 1
        let band = LENGTH_BANDS.firstIndex { duration < $0.max } ?? LENGTH_BANDS.count - 1
        let won = ctx.point.confirmedWinner == .user
        if ctx.server == .user {
            if won { mine[band].won += 1 } else { mine[band].lost += 1 }
        } else {
            if won { theirs[band].won += 1 } else { theirs[band].lost += 1 }
        }
    }
    return PointLengthResult(mine: mine, theirs: theirs, covered: covered, considered: contexts.count)
}

/// Speed along the table between the serve's two bounces. Both bounces sit
/// on the table plane, so both are measured rather than inferred, and the
/// number needs nothing that happens after the serve.
private func serveSpeedMs(_ ctx: ScoredContext) -> Double? {
    guard ctx.drawn != nil, let serve = serveShot(ctx),
          let first = serve.serveFirstBounce, let landing = serve.landing,
          let u0 = first.u, let v0 = first.v, let t0 = first.t,
          let u1 = landing.u, let v1 = landing.v, let t1 = landing.t
    else { return nil }
    let dt = t1 - t0
    let distance = ((u1 - u0) * (u1 - u0) + (v1 - v0) * (v1 - v0)).squareRoot()
    if dt <= 0.05 || dt >= 1.5 || distance <= 0.2 { return nil }
    return distance / dt
}

/// Thirds of one player's serves, slowest to fastest, each with the
/// uploader's share won.
private func speedBands(_ samples: [(speed: Double, won: Bool)]) -> [SpeedBand] {
    if samples.count < SCORED_CARDS_MIN_SAMPLES { return [] }
    let sorted = samples.map(\.speed).sorted()
    let n = sorted.count
    let q1 = sorted[n / 3]
    let q3 = sorted[(2 * n) / 3]
    let edges: [(label: String, lo: Double, hi: Double)] = [
        ("Slow", -.infinity, q1), ("Medium", q1, q3), ("Fast", q3, .infinity),
    ]
    return edges.map { edge in
        let selected = samples.filter { $0.speed >= edge.lo && $0.speed < edge.hi }
        return SpeedBand(
            label: edge.label,
            won: selected.filter(\.won).count,
            lost: selected.filter { !$0.won }.count,
            fromKmh: edge.lo == -.infinity ? nil : edge.lo * 3.6,
            toKmh: edge.hi == .infinity ? nil : edge.hi * 3.6
        )
    }
}

private func variety(_ zones: [PlacementZone]) -> VarietySummary? {
    if zones.count < SCORED_CARDS_MIN_SAMPLES { return nil }
    var counts: [PlacementZone: Int] = [:]
    for zone in zones { counts[zone, default: 0] += 1 }
    let top = counts
        .sorted { a, b in
            a.value != b.value
                ? a.value > b.value
                : readableZone(a.key) < readableZone(b.key)
        }
        .prefix(3)
        .map { VarietyZone(zone: $0.key, label: readableZone($0.key), count: $0.value) }
    return VarietySummary(
        count: zones.count,
        zonesUsed: counts.count,
        top: Array(top),
        topShare: Double(top.first?.count ?? 0) / Double(zones.count)
    )
}

/// The last bounce of a point that the camera can be believed about.
///
/// Drops bounces that are really racket contacts, bounces in the net band,
/// anything after the point ended, and a trailing bounce long after the one
/// before it (the ball rolling about after the point). What is left is the
/// last landing, and it must sit on the loser's half: the loser is the
/// player who failed to return it. That check is independent of the camera
/// and is what gates the card.
func lastCleanBounce(_ data: PlacementV3Data, end: Double) -> PlacementCandidate? {
    let sorted = (data.candidates ?? [])
        .filter { $0.t != nil }
        .sorted { $0.t! < $1.t! }
    let contacts = sorted.filter { $0.kind == "contact" }
    var clean = sorted.filter { c in
        guard c.kind == "bounce", let u = c.u, let v = c.v, let t = c.t else { return false }
        if !insideTable(u, v) { return false }
        if abs(v - NET_V_M) <= NET_BAND_M { return false }
        if t > end + 0.2 { return false }
        return !contacts.contains { abs(($0.t ?? 0) - t) <= NEAR_CONTACT_S }
    }
    while clean.count >= 2,
          let last = clean[clean.count - 1].t, let prev = clean[clean.count - 2].t,
          last - prev > DEAD_PLAY_GAP_S {
        clean.removeLast()
    }
    return clean.last
}

private func endings(_ contexts: [ScoredContext]) -> EndingsResult {
    var lostCounts: [PlacementZone: Int] = [:]
    var wonCounts: [PlacementZone: Int] = [:]
    var considered = 0
    var agreed = 0
    var lost = 0
    var won = 0
    for ctx in contexts {
        guard let data = ctx.placement, let end = ctx.end,
              let loserSide = ctx.loserSide, let userPhysical = ctx.userPhysical,
              let last = lastCleanBounce(data, end: end),
              let u = last.u, let v = last.v
        else { continue }
        considered += 1
        guard halfOf(v) == loserSide else { continue }
        agreed += 1
        let lostByUser = loserSide == userPhysical
        let n = normalizePlacementCoordinates(u: u, v: v, userPhysicalSide: userPhysical)
        guard let zone = placementZone(u: n.u, v: n.v, filter: lostByUser ? .theirRally : .myRally)
        else { continue }
        if lostByUser {
            lostCounts[zone, default: 0] += 1
            lost += 1
        } else {
            wonCounts[zone, default: 0] += 1
            won += 1
        }
    }
    let agreement = considered > 0 ? Double(agreed) / Double(considered) : 0
    return EndingsResult(
        considered: considered, agreed: agreed, agreement: agreement,
        shown: considered >= ENDINGS_MIN_POINTS && agreement >= ENDINGS_MIN_AGREEMENT,
        lostCounts: lostCounts, wonCounts: wonCounts, lost: lost, won: won
    )
}

/// Nil when the gate is closed, or when the owner's side is unknown on an
/// automatic cut; a hand cut's point length needs only its marks. `gameFilter`
/// narrows the cards to one game (0-based); the gate always reads the whole
/// match. `handCut` is cut_source = "manual": the End Point tap is each
/// point's end and the start mark stands in for a serve time the ball did not
/// give.
func computeScoredCards(
    points: [MatchPoint],
    userSide: String?,
    gameIndexByPoint: [UUID: Int],
    serving: [UUID: ServeInfo],
    prePad: (MatchPoint) -> Double,
    placementTrusted: Bool = true,
    gameFilter: Int? = nil,
    handCut: Bool = false
) -> ScoredCardsResult? {
    let gate = scoredCardsGate(points)
    guard gate.open, userSide != nil || handCut else { return nil }
    let live = points.filter { !$0.deleted }
    let drawn: [UUID: TrustedPlacementObservation] = userSide.map { side in
        Dictionary(
            collectServePlacementObservations(
                points: live, userSide: side, gameIndexByPoint: gameIndexByPoint, serving: serving
            ).map { ($0.pointId, $0) },
            uniquingKeysWith: { first, _ in first }
        )
    } ?? [:]

    var contexts: [ScoredContext] = []
    for point in live {
        if point.isLet { continue }
        guard let winner = point.confirmedWinner else { continue }
        guard let server = serving[point.id]?.server else { continue }
        let gameIndex = gameIndexByPoint[point.id] ?? 0
        if let gameFilter, gameIndex != gameFilter { continue }
        let userPhysical = userSide.map { physicalSideForGame($0, gameIndex: gameIndex) }
        let serverSide = userPhysical.map { server == .user ? $0 : otherSide($0) }
        let winnerSide = userPhysical.map { winner == .user ? $0 : otherSide($0) }
        // Placement is drawn from one end of the table, so without the side
        // it cannot be read at all.
        var placement: PlacementV3Data?
        if userPhysical != nil, placementTrusted, point.placementFlagged != true,
           case .v3(let data)? = point.placement {
            placement = data
        }
        contexts.append(ScoredContext(
            point: point, server: server, serverSide: serverSide,
            userPhysical: userPhysical, loserSide: winnerSide.map { otherSide($0) },
            placement: placement,
            drawn: placement == nil ? nil : drawn[point.id],
            // A hand cut ends where the owner tapped End Point, on the same
            // source clock as the placement candidates.
            end: handCut ? point.t1 : pointEndSource(point, prePad: prePad(point)),
            markStart: handCut ? point.t0 : nil
        ))
    }

    var speedMine: [(speed: Double, won: Bool)] = []
    var speedTheirs: [(speed: Double, won: Bool)] = []
    var zonesMine: [PlacementZone] = []
    var zonesTheirs: [PlacementZone] = []
    for ctx in contexts {
        if let speed = serveSpeedMs(ctx) {
            let sample = (speed: speed, won: ctx.point.confirmedWinner == .user)
            if ctx.server == .user { speedMine.append(sample) } else { speedTheirs.append(sample) }
        }
        if let observation = ctx.drawn,
           let zone = placementZone(u: observation.u, v: observation.v, filter: observation.filter) {
            if ctx.server == .user { zonesMine.append(zone) } else { zonesTheirs.append(zone) }
        }
    }

    return ScoredCardsResult(
        gate: gate,
        pointLength: pointLength(contexts),
        serveSpeedMine: speedBands(speedMine),
        serveSpeedTheirs: speedBands(speedTheirs),
        varietyMine: variety(zonesMine),
        varietyTheirs: variety(zonesTheirs),
        endings: endings(contexts)
    )
}

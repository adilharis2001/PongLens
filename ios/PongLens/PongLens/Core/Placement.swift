import Foundation

// Placement payloads on points.placement — three generations (see
// src/lib/types.ts): v1 flat bounce list, v2 role-tagged bounces, v3
// hypotheses with per-shot events. Coordinates are meters in the worker
// frame: u across the table width (0…1.525), v along the length
// (0…2.74, 0 = near end line).
//
// u = 0 is corner A: the NEAR end, the camera's LEFT — which is the near
// player's own left, because the near end is by construction the one lower
// in the frame, so that player faces away from the camera. This comment
// claimed the opposite until 2026-08-23 and every placement map in the app
// was mirrored left to right. See normalizePlacementCoordinates.

let TABLE_W = 1.525
let TABLE_L = 2.74

struct PlacementEvent: Codable, Hashable {
    let u: Double?
    let v: Double?
    let confidence: Double?
    /// Which detection this is, keyed into PlacementV3Data.candidates.
    /// The serve rule needs it to ask whether two bounces are adjacent.
    let eventId: String?

    enum CodingKeys: String, CodingKey {
        case u, v, confidence
        case eventId = "event_id"
    }
}

struct PlacementTerminal: Codable, Hashable {
    let kind: String // net | out | winner_landing | no_return
    let u: Double?
    let v: Double?
}

struct PlacementShot: Codable, Hashable {
    let seq: Int
    let phase: String // serve | rally | final
    let hitterSide: String // near | far
    let contact: PlacementEvent?
    let serveFirstBounce: PlacementEvent?
    let landing: PlacementEvent?
    let terminal: PlacementTerminal?
    let confidence: Double?

    enum CodingKeys: String, CodingKey {
        case seq, phase, contact, landing, terminal, confidence
        case hitterSide = "hitter_side"
        case serveFirstBounce = "serve_first_bounce"
    }
}

struct PlacementHypothesis: Codable, Hashable {
    let status: String // ready | review | unavailable
    let confidence: Double?
    let serverSide: String?
    let shots: [PlacementShot]
    let hardReasons: [String]
    let reasons: [String]

    enum CodingKeys: String, CodingKey {
        case status, confidence, shots, reasons
        case serverSide = "server_side"
        case hardReasons = "hard_reasons"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = try c.decode(String.self, forKey: .status)
        confidence = try c.decodeIfPresent(Double.self, forKey: .confidence)
        serverSide = try c.decodeIfPresent(String.self, forKey: .serverSide)
        shots = try c.decodeIfPresent([PlacementShot].self, forKey: .shots) ?? []
        hardReasons = try c.decodeIfPresent([String].self, forKey: .hardReasons) ?? []
        reasons = try c.decodeIfPresent([String].self, forKey: .reasons) ?? []
    }
}

struct PlacementHypotheses: Codable, Hashable {
    let near: PlacementHypothesis
    let far: PlacementHypothesis
}

/// One detection on the v3 timeline. The timestamp alone answers the
/// cutter's question — a stretch with no detections, with real play on
/// both sides of it, is the between-points gap it missed (see
/// fusedSplitCut). The id and kind are what the serve rule reads: which
/// touches of the table happened, and in what order.
struct PlacementCandidate: Codable, Hashable {
    let id: String?
    let kind: String?
    let t: Double?
}

struct PlacementV3Data: Codable, Hashable {
    let v: Int
    let status: String
    let candidates: [PlacementCandidate]?
    let hypotheses: PlacementHypotheses
}

struct PlacementBounceV2Row: Codable, Hashable {
    let seq: Int
    let u: Double
    let v: Double
    let role: String // serve_1 | serve_2 | rally | final
    let hitterSide: String?
    let finalKind: String?

    enum CodingKeys: String, CodingKey {
        case seq, u, v, role
        case hitterSide = "hitter_side"
        case finalKind = "final_kind"
    }
}

struct PlacementBounceV1Row: Codable, Hashable {
    let u: Double
    let v: Double
    let side: String?
}

enum PlacementData: Codable, Hashable {
    case v1([PlacementBounceV1Row])
    case v2([PlacementBounceV2Row])
    case v3(PlacementV3Data)

    private enum Keys: String, CodingKey { case v, bounces }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        let version = try container.decodeIfPresent(Int.self, forKey: .v)
        switch version {
        case 3:
            self = .v3(try PlacementV3Data(from: decoder))
        case 2:
            self = .v2(try container.decode([PlacementBounceV2Row].self, forKey: .bounces))
        default:
            self = .v1(try container.decode([PlacementBounceV1Row].self, forKey: .bounces))
        }
    }

    func encode(to encoder: Encoder) throws {
        // Never written from the app.
    }
}

// MARK: - Orientation

/// Players change ends every game: the physical camera-frame side the user
/// occupies in game `gameIndex` (0-based). sides.ts port.
func physicalSideForGame(_ userSide: String, gameIndex: Int) -> String {
    gameIndex % 2 == 0 ? userSide : (userSide == "near" ? "far" : "near")
}

func otherSide(_ side: String) -> String { side == "near" ? "far" : "near" }

/// Normalized (x, y) on the drawn table, 0…1, y increasing downward.
/// Invariant: the user sits at the BOTTOM and the user's left is map left.
/// user-near mirrors u; user-far keeps u and flips v (180° rotation).
/// A match with no side set draws the camera's own view (near at bottom).
func placementXY(u: Double, v: Double, userSide: String?) -> (x: Double, y: Double) {
    if userSide == "far" {
        return (x: u / TABLE_W, y: v / TABLE_L)
    }
    return (x: 1 - u / TABLE_W, y: 1 - v / TABLE_L)
}

// MARK: - Render model (lib/placement/placementModel.ts port)

struct PlacementMapPointM: Hashable {
    let u: Double
    let v: Double
}

struct PlacementRenderSegment: Identifiable, Hashable {
    let id: Int // shot index — stable within one rally
    let shotNumber: Int
    let hitterSide: String
    let phase: String // serve | rally | final
    let from: PlacementMapPointM?
    let to: PlacementMapPointM?
    let fromContext: Bool
    let serveFirstBounce: PlacementMapPointM?
    let carryTo: PlacementMapPointM?
    let terminal: PlacementTerminal?
    let confidence: Double
}

struct PlacementRenderModel {
    let status: String
    let segments: [PlacementRenderSegment]
    let shownCount: Int
    let totalCount: Int
}

private let MAX_CARRY = 3.0
private let MAX_OFF_TABLE_U = 0.12

private func plausibleU(_ p: PlacementMapPointM) -> Bool {
    p.u >= -MAX_OFF_TABLE_U && p.u <= TABLE_W + MAX_OFF_TABLE_U
}

/// Extend the flight THROUGH a bounce to the far baseline — a bounce leaves
/// the top-down heading unchanged, so the same straight line continues.
private func carryThrough(
    from: PlacementMapPointM, landing: PlacementMapPointM, baselineV: Double
) -> PlacementMapPointM? {
    let dv = landing.v - from.v
    guard abs(dv) >= 1e-6 else { return nil }
    let t = (baselineV - landing.v) / dv
    guard t > 0, t <= MAX_CARRY else { return nil }
    let carried = PlacementMapPointM(
        u: landing.u + t * (landing.u - from.u), v: baselineV
    )
    return plausibleU(carried) ? carried : nil
}

/// The serve's origin, extrapolated BACKWARD from its first bounce.
private func serveOrigin(
    firstBounce: PlacementMapPointM, landing: PlacementMapPointM, baselineV: Double
) -> PlacementMapPointM? {
    let dv = landing.v - firstBounce.v
    guard abs(dv) >= 1e-6 else { return nil }
    let t = (baselineV - firstBounce.v) / dv
    guard t < 0, t >= -MAX_CARRY else { return nil }
    let origin = PlacementMapPointM(
        u: firstBounce.u + t * (landing.u - firstBounce.u), v: baselineV
    )
    return plausibleU(origin) ? origin : nil
}

// MARK: - Match-level aggregate (lib/placement/placementAggregate.ts port)

let PLACEMENT_AGGREGATE_TRUST_THRESHOLD = 0.7

enum PlacementAggregateFilter {
    case myServes, theirServes, myRally, theirRally

    /// These two land on the user's half of the normalized table.
    var landsOnUsersHalf: Bool { self == .theirServes || self == .theirRally }
}

/// One landing the aggregate trusts: normalized so the user's end is v = 0
/// and the user's left is u = 0, exactly like the web collector.
struct TrustedPlacementObservation: Hashable {
    let pointId: UUID
    let shotSeq: Int
    let filter: PlacementAggregateFilter
    let u: Double
    let v: Double
}

/// Web coordinates put the user at the bottom of the drawn table: mirror u
/// for a near-side user, flip v for a far-side one.
/// Worker frame → drawn map, oriented for the player at the bottom: their
/// left is the map's left and their own end is the bottom.
///
/// A port of normalizePlacementCoordinates in
/// src/lib/placement/placementAggregate.ts, where the full derivation is
/// written down. u flips for the far player and not for the near one
/// because u = 0 is the near player's own left sideline.
func normalizePlacementCoordinates(
    u: Double, v: Double, userPhysicalSide: String
) -> (u: Double, v: Double) {
    userPhysicalSide == "near" ? (u, v) : (TABLE_W - u, TABLE_L - v)
}

/// The web's zone classifier, used here only as the validity gate it also
/// is there: on the table, and on the half this filter's shots land on.
private func placementLandingOnExpectedHalf(
    u: Double, v: Double, filter: PlacementAggregateFilter
) -> Bool {
    guard u >= 0, u <= TABLE_W, v >= 0, v <= TABLE_L else { return false }
    let net = TABLE_L / 2
    let distanceFromNet = filter.landsOnUsersHalf ? net - v : v - net
    return distanceFromNet >= 0
}

/// A point the owner flagged stops feeding every map — the flag is an
/// override on the aggregate's inputs, not a comment.
func unflaggedPlacementPoints(_ points: [MatchPoint]) -> [MatchPoint] {
    points.contains { $0.placementFlagged == true }
        ? points.filter { $0.placementFlagged != true }
        : points
}

/// Every landing trusted enough for the match-level maps: ready hypothesis,
/// every confidence at or above the threshold, hitter matching the serve
/// rotation, landing on the half that filter promises.
func collectTrustedPlacementObservations(
    points: [MatchPoint],
    userSide: String?,
    gameIndexByPoint: [UUID: Int],
    serving: [UUID: ServeInfo]
) -> [TrustedPlacementObservation] {
    guard let userSide else { return [] }

    var observations: [TrustedPlacementObservation] = []
    for point in points {
        guard !point.deleted, case .v3(let data)? = point.placement else { continue }

        let gameIndex = gameIndexByPoint[point.id] ?? 0
        let userPhysicalSide = physicalSideForGame(userSide, gameIndex: gameIndex)
        guard let server = serving[point.id]?.server else { continue }
        let serverSide = server == .user ? userPhysicalSide : otherSide(userPhysicalSide)
        guard
            let hypothesis = selectPlacementHypothesis(data, serverSide: serverSide),
            hypothesis.status == "ready",
            (hypothesis.confidence ?? 0) >= PLACEMENT_AGGREGATE_TRUST_THRESHOLD,
            hypothesis.hardReasons.isEmpty
        else { continue }

        for shot in hypothesis.shots {
            guard
                let landing = shot.landing,
                (shot.confidence ?? 0) >= PLACEMENT_AGGREGATE_TRUST_THRESHOLD,
                (landing.confidence ?? 0) >= PLACEMENT_AGGREGATE_TRUST_THRESHOLD,
                let u = landing.u, let v = landing.v
            else { continue }
            let expectedHitter = shot.seq % 2 == 1 ? serverSide : otherSide(serverSide)
            guard shot.hitterSide == expectedHitter else { continue }

            let mine = expectedHitter == userPhysicalSide
            let filter: PlacementAggregateFilter = shot.phase == "serve"
                ? (mine ? .myServes : .theirServes)
                : (mine ? .myRally : .theirRally)
            let normalized = normalizePlacementCoordinates(
                u: u, v: v, userPhysicalSide: userPhysicalSide
            )
            guard placementLandingOnExpectedHalf(
                u: normalized.u, v: normalized.v, filter: filter
            ) else { continue }

            observations.append(TrustedPlacementObservation(
                pointId: point.id, shotSeq: shot.seq, filter: filter,
                u: normalized.u, v: normalized.v
            ))
        }
    }
    return observations
}

func trustedPlacementPointCount(_ observations: [TrustedPlacementObservation]) -> Int {
    Set(observations.map(\.pointId)).count
}

// MARK: - Serves

/// How late a serve's landing may be when its own first bounce was never
/// found and there is nothing to measure from. Zero-based, so 1 means
/// "the first or second bounce of the point".
private let SERVE_LANDING_MAX_BOUNCE_INDEX = 1

private func halfForV(_ v: Double) -> String { v < TABLE_L / 2 ? "near" : "far" }

private func insideTheTable(u: Double, v: Double) -> Bool {
    u >= 0 && u <= TABLE_W && v >= 0 && v <= TABLE_L
}

/// Every time the ball touched the table in this point, in order. Read
/// from the candidates — what was actually detected, before any story was
/// fitted to them.
private func bounceOrdinals(_ data: PlacementV3Data) -> [String: Int] {
    var ordinals: [String: Int] = [:]
    let bounces = (data.candidates ?? [])
        .filter { $0.kind == "bounce" && $0.id != nil }
        .sorted { ($0.t ?? 0) < ($1.t ?? 0) }
    for (index, candidate) in bounces.enumerated() {
        ordinals[candidate.id!] = index
    }
    return ordinals
}

/// Where each serve landed. A PORT of collectServePlacementObservations in
/// src/lib/placement/placementAggregate.ts, and the two are held to the
/// same fixtures in PlacementTests — a silent divergence here is the same
/// match showing one map on the phone and another on the web.
///
/// Six questions, all about the landing:
///
///   1. the point has a server from the scored rotation
///   2. the serve has a landing with real coordinates
///   3. the landing is on the RECEIVER's half
///   4. the landing is inside the physical table
///   5. the landing is the very next bounce after the serve's own first
///      bounce (or, with no first bounce found, the first or second
///      bounce of the point)
///   6. the serve's own first bounce, when found, is on the SERVER's half
///
/// Deliberately NOT required: a "ready" hypothesis, a confidence floor,
/// an empty hardReasons, or any of the eleven rally blockers. Those ask
/// whether we understood the RALLY, which is the wrong question for a map
/// of where serves land, and any one of them discards the whole point.
func collectServePlacementObservations(
    points: [MatchPoint],
    userSide: String?,
    gameIndexByPoint: [UUID: Int],
    serving: [UUID: ServeInfo]
) -> [TrustedPlacementObservation] {
    guard let userSide else { return [] }

    var observations: [TrustedPlacementObservation] = []
    for point in points {
        guard !point.deleted, case .v3(let data)? = point.placement else { continue }

        let gameIndex = gameIndexByPoint[point.id] ?? 0
        let userPhysicalSide = physicalSideForGame(userSide, gameIndex: gameIndex)

        // 1. Who served, from the scored rotation.
        guard let server = serving[point.id]?.server else { continue }
        let serverSide = server == .user ? userPhysicalSide : otherSide(userPhysicalSide)
        let receiverSide = otherSide(serverSide)

        guard
            let hypothesis = selectPlacementHypothesis(data, serverSide: serverSide),
            let serve = hypothesis.shots.first(where: { $0.phase == "serve" })
        else { continue }

        // 2. A landing with real coordinates.
        guard let landing = serve.landing, let u = landing.u, let v = landing.v
        else { continue }

        // 3 and 4. On the receiver's half, and on the table at all. A serve
        // that projects off the table is a calibration failure, not a short
        // serve, and it is what makes a map look broken.
        guard insideTheTable(u: u, v: v) else { continue }
        guard halfForV(v) == receiverSide else { continue }

        // 6. The independent read of who served. If first_server is wrong,
        // every serve flips to the wrong player at once.
        let first = serve.serveFirstBounce
        if let firstV = first?.v, halfForV(firstV) != serverSide { continue }

        // 5. The two bounces are CONSECUTIVE: nothing else touched the
        // table in between. Counting from the START of the point instead
        // looks right and is not — clips open before the serve, so a ball
        // bounced before serving, or the tail of the previous rally inside
        // the clip pad, would throw the serve away.
        let ordinals = bounceOrdinals(data)
        guard let landingId = landing.eventId,
              let landingOrdinal = ordinals[landingId] else { continue }
        if let firstId = first?.eventId, let firstOrdinal = ordinals[firstId] {
            guard landingOrdinal - firstOrdinal == 1 else { continue }
        } else {
            guard landingOrdinal <= SERVE_LANDING_MAX_BOUNCE_INDEX else { continue }
        }

        let filter: PlacementAggregateFilter =
            serverSide == userPhysicalSide ? .myServes : .theirServes
        let normalized = normalizePlacementCoordinates(
            u: u, v: v, userPhysicalSide: userPhysicalSide
        )
        guard placementLandingOnExpectedHalf(
            u: normalized.u, v: normalized.v, filter: filter
        ) else { continue }

        observations.append(TrustedPlacementObservation(
            pointId: point.id, shotSeq: serve.seq, filter: filter,
            u: normalized.u, v: normalized.v
        ))
    }
    return observations
}

enum PlacementNoticeMode { case hidden, review }

func placementHypothesisNotice(
    _ h: PlacementHypothesis
) -> (mode: PlacementNoticeMode, message: String)? {
    if h.status == "unavailable" || !h.hardReasons.isEmpty {
        return (.hidden, "A placement map couldn't be generated for this point because the ball path was difficult to track.")
    }
    if h.status == "review" {
        return (.review, "This placement map may be less accurate because the ball path was difficult to track.")
    }
    return nil
}

/// Pick the hypothesis to draw: the rotation's answer when it has one,
/// otherwise the clear winner on confidence — or nil when too close to call.
func selectPlacementHypothesis(
    _ data: PlacementV3Data, serverSide: String?
) -> PlacementHypothesis? {
    if let serverSide {
        return serverSide == "near" ? data.hypotheses.near : data.hypotheses.far
    }
    let ordered = [data.hypotheses.near, data.hypotheses.far]
        .filter { $0.hardReasons.isEmpty }
        .sorted { ($0.confidence ?? 0) > ($1.confidence ?? 0) }
    guard let best = ordered.first, best.status != "unavailable" else { return nil }
    if ordered.count > 1,
       (best.confidence ?? 0) - (ordered[1].confidence ?? 0) < 0.18 {
        return nil
    }
    return best
}

private func eventPoint(_ e: PlacementEvent?) -> PlacementMapPointM? {
    guard let e, let u = e.u, let v = e.v else { return nil }
    return PlacementMapPointM(u: u, v: v)
}

private func terminalPoint(_ t: PlacementTerminal?) -> PlacementMapPointM? {
    guard let t, let u = t.u, let v = t.v else { return nil }
    return PlacementMapPointM(u: u, v: v)
}

func buildPlacementRenderModel(
    _ hypothesis: PlacementHypothesis, through: Int?
) -> PlacementRenderModel {
    if hypothesis.status == "unavailable" || !hypothesis.hardReasons.isEmpty {
        return PlacementRenderModel(
            status: hypothesis.status, segments: [], shownCount: 0, totalCount: 0
        )
    }
    let shots = hypothesis.shots.sorted { $0.seq < $1.seq }
    func phase(_ shot: PlacementShot, _ index: Int) -> String {
        if shot.phase == "serve" { return "serve" }
        if shot.phase == "final" { return "final" }
        return index == shots.count - 1 ? "final" : "rally"
    }
    let shownCount = through.map { max(0, min($0, shots.count)) } ?? shots.count

    var segments: [PlacementRenderSegment] = []
    var carriedFrom: PlacementMapPointM?

    for (index, shot) in shots.enumerated() {
        let landing = eventPoint(shot.landing)
        let receiverBaseline = shot.hitterSide == "near" ? TABLE_L : 0

        var from: PlacementMapPointM?
        var fromContext = false
        var fromDerived = true
        if shot.phase == "serve" {
            let firstBounce = eventPoint(shot.serveFirstBounce)
            let serverBaseline = hypothesis.serverSide == "near" ? 0 : TABLE_L
            if let firstBounce, let landing {
                from = serveOrigin(
                    firstBounce: firstBounce, landing: landing, baselineV: serverBaseline
                )
            }
            if from == nil, landing != nil {
                from = PlacementMapPointM(u: TABLE_W / 2, v: serverBaseline)
                fromDerived = false
            }
        } else if let carried = carriedFrom {
            from = carried
        } else {
            for previous in stride(from: index - 1, through: 0, by: -1) {
                guard let priorLanding = eventPoint(shots[previous].landing) else { continue }
                from = priorLanding
                fromContext = previous >= shownCount
                break
            }
        }

        carriedFrom = if let from, let landing, fromDerived {
            carryThrough(from: from, landing: landing, baselineV: receiverBaseline)
        } else {
            nil
        }

        guard index < shownCount else { continue }
        guard landing != nil || shot.terminal != nil else { continue }
        segments.append(PlacementRenderSegment(
            id: index,
            shotNumber: index + 1,
            hitterSide: shot.hitterSide,
            phase: phase(shot, index),
            from: from,
            to: landing,
            fromContext: fromContext,
            serveFirstBounce: shot.phase == "serve" ? eventPoint(shot.serveFirstBounce) : nil,
            carryTo: carriedFrom,
            terminal: shot.terminal,
            confidence: shot.confidence ?? 1
        ))
    }

    return PlacementRenderModel(
        status: hypothesis.status,
        segments: segments,
        shownCount: shownCount,
        totalCount: shots.count
    )
}

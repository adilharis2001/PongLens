import Foundation

// Placement payloads on points.placement — three generations (see
// src/lib/types.ts): v1 flat bounce list, v2 role-tagged bounces, v3
// hypotheses with per-shot events. Coordinates are meters in the worker
// frame: u across the table width (0…1.525, 0 = the near player's
// image-right sideline), v along the length (0…2.74, 0 = near end line).

let TABLE_W = 1.525
let TABLE_L = 2.74

struct PlacementEvent: Codable, Hashable {
    let u: Double?
    let v: Double?
    let confidence: Double?
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

    enum CodingKeys: String, CodingKey {
        case seq, phase, contact, landing, terminal
        case hitterSide = "hitter_side"
        case serveFirstBounce = "serve_first_bounce"
    }
}

struct PlacementHypothesis: Codable, Hashable {
    let status: String // ready | review | unavailable
    let confidence: Double?
    let serverSide: String?
    let shots: [PlacementShot]

    enum CodingKeys: String, CodingKey {
        case status, confidence, shots
        case serverSide = "server_side"
    }
}

struct PlacementHypotheses: Codable, Hashable {
    let near: PlacementHypothesis
    let far: PlacementHypothesis
}

struct PlacementV3Data: Codable, Hashable {
    let v: Int
    let status: String
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

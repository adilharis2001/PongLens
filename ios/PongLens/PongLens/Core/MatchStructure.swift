import Foundation

/// Detected game ends (side-change-v2, migration 140) — the port of
/// src/app/match/[id]/matchStructure.ts's v2 half.
///
/// The worker watches the two players between consecutive points; when
/// they persistently swap table ends, it stores a side_change on
/// matches.match_structure. Under the rules that is how a game ends —
/// except the deciding game's switch at 5 points, which an unscored
/// match cannot distinguish, so this is "very likely a game boundary",
/// never certainty. Display only: nothing here feeds scoring, serving
/// or game numbering, and the indicator disappears the moment the owner
/// scores a point or pins a boundary themselves.

struct SideChange: Codable, Hashable {
    let afterPointId: UUID?
    let gapT0: Double?
    let confidence: Double
    let confirmed: Bool

    enum CodingKeys: String, CodingKey {
        case afterPointId = "after_point_id"
        case gapT0 = "gap_t0"
        case confidence, confirmed
    }
}

/// The slice of matches.match_structure this app reads. v1 evidence
/// (rtmpose-match-structure-v1, the retired 2026-07 experiment) decodes
/// too but carries no side_changes, so it renders nothing.
struct MatchStructureLite: Codable, Hashable {
    let status: String?
    let algorithm: String?
    let sideChanges: [SideChange]?

    enum CodingKeys: String, CodingKey {
        case status, algorithm
        case sideChanges = "side_changes"
    }
}

enum MatchStructure {
    /// Whether detected game-end indicators may show at all: the
    /// app_config flag, competitive content only (match / league /
    /// tournament — a missing type FAILS SAFE to none), and the match
    /// is UNSCORED (no confirmed winner, no pinned boundary anywhere).
    static func gameEndIndicatorsEligible(
        matchType: String?,
        points: [MatchPoint],
        flagOn: Bool
    ) -> Bool {
        guard flagOn else { return false }
        guard matchType == "match" || matchType == "league"
            || matchType == "tournament" else { return false }
        return points.allSatisfy {
            $0.confirmedWinner == nil && $0.gameEndOverride == nil
        }
    }

    /// point id -> the confirmed detected side change sitting AFTER that
    /// visible point. Placement is by point id when the referenced point
    /// is still visible, else by time (gap start against t1), so the
    /// indicator survives the owner deleting the junk card the worker
    /// referenced. A change after the final visible point is dropped.
    static func resolveDetectedGameEnds(
        visible: [MatchPoint],
        evidence: MatchStructureLite?
    ) -> [UUID: SideChange] {
        guard let evidence,
              evidence.algorithm == "side-change-v2",
              evidence.status == "ready" else { return [:] }
        var out: [UUID: SideChange] = [:]
        let positions = Dictionary(
            uniqueKeysWithValues: visible.enumerated().map {
                ($0.element.id, $0.offset)
            }
        )
        for change in evidence.sideChanges ?? [] where change.confirmed {
            var position = change.afterPointId.flatMap { positions[$0] }
            if position == nil, let gapT0 = change.gapT0 {
                position = visible.lastIndex {
                    guard let t1 = $0.t1 else { return false }
                    return t1 <= gapT0 + 0.5
                }
            }
            guard let index = position, index < visible.count - 1 else {
                continue
            }
            let id = visible[index].id
            if let existing = out[id],
               existing.confidence >= change.confidence {
                continue
            }
            out[id] = change
        }
        return out
    }
}

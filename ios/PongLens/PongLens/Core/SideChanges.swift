import Foundation

/// Which detected side-change markers get drawn, and where.
///
/// Port of src/app/match/[id]/sideChanges.ts. The worker watches the two
/// players and records where they swapped ends of the table; under the
/// rules that is how a game ends. This decides which of those detections
/// becomes a marker on screen.
///
/// THE MARKER NEVER CHANGES THE SCORE. It is not folded into the boundary
/// walk in GameScore.swift, and a match nobody touches scores exactly as
/// it did before this existed. The only way detector evidence reaches the
/// score is the owner tapping "Game ended here", which writes the same
/// points.game_end_override = 'end' they could have pinned by hand.
///
/// The rule exists twice, so it is measured against the web's own output
/// rather than against a second reading of the spec:
/// ios/Tests/fixtures/side-change-markers.json is written BY the
/// TypeScript tests and asserted here by SideChangeTests.
enum SideChanges {
    /// What the marker says. "Players changed ends" rather than "Game end
    /// detected", because in a deciding game the players swap at 5 points
    /// and the detector cannot tell that from a game ending — there is no
    /// score to consult, and on an unscored match we do not even know it
    /// is the deciding game. This wording is true in every case; the
    /// interpretation moves into the sheet, where the button says "Game
    /// ended here" and the judgement is the owner's.
    static let label = "Players changed ends"

    /// The short form, for the Keep-score ticker where four characters is
    /// the budget (the score divider's pill holds "11-7" at 9pt).
    static let shortLabel = "ends"

    /// How near a real game boundary silences a detected one, in visible
    /// rallies either side.
    ///
    /// Three, because three is what the owner's own scoring drifts by.
    /// Over 49 confirmed fires, six landed one to four rallies from the
    /// scored boundary and every one of those six fired on a LONGER break
    /// than the score had — the changeover is the long gap, and the score
    /// is what moved. Two dividers three rallies apart are the same event
    /// drawn twice, so the one the score proves wins.
    ///
    /// This is what makes the marker fade as a match gets scored: an
    /// unscored match shows every detection, and each goes quiet as the
    /// scorer reaches the game it belongs to.
    static let scoreBoundarySuppress = 3

    /// Slack when matching a gap time to a rally's end, in SOURCE seconds.
    static let gapMatchTolerance = 0.25

    enum Anchor: String, Codable, Equatable {
        /// The rally the detector named is still here.
        case pointID = "point_id"
        /// It has been deleted; the position came from the gap time.
        case gapTime = "gap_time"
    }

    struct Marker: Equatable {
        let pointId: UUID
        let confidence: Double
        let anchor: Anchor
    }

    /// One rally, reduced to what the rule reads. A protocol rather than
    /// MatchPoint itself so the fixture can drive the same code the
    /// screens do.
    struct Rally: Equatable {
        let id: UUID
        let t1: Double?
        let gameEndOverride: GameEndOverride?
        let sideChangeDismissed: Bool
    }

    /// Rules, in the order they are applied. Each is here because of
    /// something that went wrong, in this project or the research behind it.
    ///
    ///  1. flag off                  -> nothing at all
    ///  2. not a scored match type   -> nothing (drills and practice:
    ///                                  players routinely do not swap)
    ///  3. evidence not 'ready'      -> nothing (a withheld match is one
    ///                                  the detector refused, and refusing
    ///                                  is the feature)
    ///  4. change not confirmed      -> skip (the rest is diagnostics)
    ///  5. anchor to a visible rally -> by id, else from gap_t0, else drop
    ///  6. a real boundary within 3  -> drop (the score proved it)
    ///  7. an owner answer within 3  -> drop (they have ruled here)
    ///  8. dismissed on the anchor   -> drop
    ///
    /// Six and seven look alike and are not the same test: a 'continue'
    /// pin satisfies seven and produces no boundary at all, so six alone
    /// would let it through.
    static func visible(
        evidence: MatchStructure?,
        visiblePoints: [Rally],
        boundaryAfter: Set<UUID>,
        enabled: Bool,
        scoredType: Bool
    ) -> [Marker] {
        guard enabled, scoredType else { return [] }                    // 1, 2
        guard let evidence, evidence.status == "ready" else { return [] } // 3
        let changes = evidence.sideChanges ?? []
        if changes.isEmpty { return [] }

        var positionById: [UUID: Int] = [:]
        for (index, point) in visiblePoints.enumerated() {
            positionById[point.id] = index
        }

        var markers: [Marker] = []
        var claimed = Set<Int>()

        for change in changes {
            guard change.confirmed == true else { continue }            // 4

            var position: Int?
            var anchor = Anchor.pointID
            if let id = change.afterPointId {
                position = positionById[id]
            }
            if position == nil, let gap = change.gapT0 {
                // The named rally has been deleted since. Its END time is
                // still a place in the match, and both clocks are SOURCE
                // seconds with alignment established worker-side, so the
                // last rally that finished by then is the same position.
                let limit = gap + gapMatchTolerance
                for index in stride(from: visiblePoints.count - 1, through: 0, by: -1) {
                    if let t1 = visiblePoints[index].t1, t1 <= limit {
                        position = index
                        anchor = .gapTime
                        break
                    }
                }
            }
            guard let position else { continue }                        // 5
            // The last rally has nothing after it, so there is no
            // "between" for a marker to sit in.
            if position >= visiblePoints.count - 1 { continue }
            if claimed.contains(position) { continue }

            let lower = max(0, position - scoreBoundarySuppress)
            let upper = min(visiblePoints.count - 1, position + scoreBoundarySuppress)
            var silenced = false
            for index in lower...upper {
                let point = visiblePoints[index]
                if boundaryAfter.contains(point.id) { silenced = true; break }  // 6
                if point.gameEndOverride != nil { silenced = true; break }      // 7
            }
            if silenced { continue }
            if visiblePoints[position].sideChangeDismissed { continue }  // 8

            claimed.insert(position)
            markers.append(Marker(
                pointId: visiblePoints[position].id,
                confidence: change.confidence ?? 0,
                anchor: anchor
            ))
        }
        return markers
    }

    /// Markers keyed by the rally they follow: one lookup per row rather
    /// than a scan per row.
    static func byPoint(
        evidence: MatchStructure?,
        visiblePoints: [MatchPoint],
        boundaryAfter: Set<UUID>,
        enabled: Bool,
        scoredType: Bool
    ) -> [UUID: Marker] {
        let rallies = visiblePoints.map {
            Rally(id: $0.id, t1: $0.t1,
                  gameEndOverride: $0.gameEndOverride,
                  sideChangeDismissed: $0.sideChangeDismissed ?? false)
        }
        let found = visible(
            evidence: evidence, visiblePoints: rallies,
            boundaryAfter: boundaryAfter, enabled: enabled,
            scoredType: scoredType
        )
        return Dictionary(uniqueKeysWithValues: found.map { ($0.pointId, $0) })
    }
}


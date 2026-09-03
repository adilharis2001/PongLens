import Foundation

// Port of src/app/match/[id]/serving.ts — ITTF serve rotation, the source
// of truth for "who served". Folds through the SAME boundary walk as
// computeMatchScore so score dividers and serve rotation can never
// disagree about where a game ends.

enum ServeSource {
    case rotation, override, auto
}

struct ServeInfo {
    let server: Winner?
    let source: ServeSource
    let isLet: Bool
}

func otherServer(_ s: Winner) -> Winner {
    s == .user ? .opponent : .user
}

/// The fields the rotation walk actually reads — both point row shapes
/// can produce it.
struct ServeInput {
    let id: UUID
    let serverOverride: Winner?
    let isLet: Bool
    let confirmedWinner: Winner?
    let gameEndOverride: GameEndOverride?
}

extension MatchPoint {
    var serveInput: ServeInput {
        ServeInput(
            id: id, serverOverride: serverOverride, isLet: isLet,
            confirmedWinner: confirmedWinner, gameEndOverride: gameEndOverride
        )
    }
}

extension PointRow {
    var serveInput: ServeInput {
        ServeInput(
            id: id, serverOverride: serverOverride, isLet: isLet ?? false,
            confirmedWinner: confirmedWinner, gameEndOverride: gameEndOverride
        )
    }
}

/// What the pipeline thinks about who served first, from the per-point
/// `server` the detector wrote. Port of serving.ts's firstServerGuess.
///
/// Only a guess, and it is only ever offered as one — the rotation for a
/// whole match hangs off this answer, so it is not written without being
/// confirmed.
func firstServerGuess(_ visiblePoints: [MatchPoint], userSide: String?) -> Winner? {
    guard let userSide, userSide == "near" || userSide == "far" else { return nil }
    // Points 1 and 2 share a server under ITTF rotation, so agreement
    // confirms the vote; on a split (or a single sample) trust the first.
    let detected = visiblePoints.compactMap(\.server).prefix(2)
    guard let vote = detected.first else { return nil }
    let servedSide = vote == .user ? "near" : "far"
    return servedSide == userSide ? .user : .opponent
}

/// Compute the displayed server for each visible point.
/// `visiblePoints` must be the timeline: non-deleted, in order.
func computeServing(
    _ visiblePoints: [MatchPoint],
    firstServer: Winner?
) -> [UUID: ServeInfo] {
    computeServingInputs(visiblePoints.map(\.serveInput), firstServer: firstServer)
}

func computeServingInputs(
    _ visiblePoints: [ServeInput],
    firstServer: Winner?
) -> [UUID: ServeInfo] {
    var result: [UUID: ServeInfo] = [:]
    var cur = firstServer
    var gameFirst = firstServer
    var servesInBlock = 0
    var walk = BoundaryWalk()

    for p in visiblePoints {
        if let anchor = p.serverOverride {
            // A CONTRADICTING override starts a new 2-serve block here and
            // flips the game's first-server parity with it. An override
            // that AGREES is a pure pin and changes nothing. See the long
            // note in serving.ts for why the block restarts: the commonest
            // cause of a wrong rotation is a rally the cut MISSED, which is
            // a block boundary that moved, and preserving the phase there
            // costs an override on every remaining card instead of one.
            if cur == nil || anchor != cur {
                if cur != nil, let first = gameFirst {
                    gameFirst = otherServer(first)
                }
                servesInBlock = 0
            }
            cur = anchor
            if gameFirst == nil { gameFirst = cur }
        }

        if p.isLet {
            // Skipped: same server serves again; no rotation or score
            // advance — but a positional boundary override still closes
            // the game here.
            result[p.id] = ServeInfo(
                server: cur,
                source: p.serverOverride != nil ? .override : (cur != nil ? .rotation : .auto),
                isLet: true
            )
            if stepBoundaryWalk(&walk, winner: nil, override: p.gameEndOverride) != nil {
                servesInBlock = 0
                if let first = gameFirst {
                    gameFirst = otherServer(first)
                    cur = gameFirst
                }
            }
            continue
        }

        result[p.id] = ServeInfo(
            server: cur,
            source: p.serverOverride != nil ? .override : (cur != nil ? .rotation : .auto),
            isLet: false
        )

        servesInBlock += 1
        let ended = stepBoundaryWalk(
            &walk, winner: p.confirmedWinner, override: p.gameEndOverride
        )
        let deuce = walk.you >= 10 && walk.them >= 10
        if cur != nil, servesInBlock >= (deuce ? 1 : 2) {
            cur = otherServer(cur!)
            servesInBlock = 0
        }
        if ended != nil {
            servesInBlock = 0
            if let first = gameFirst {
                gameFirst = otherServer(first)
                cur = gameFirst
            }
        }
    }
    return result
}

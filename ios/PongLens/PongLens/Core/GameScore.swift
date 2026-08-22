import Foundation

// Port of src/app/match/[id]/gameScore.ts — the single boundary authority.
// Semantics mirror the web exactly: 11 with 2 clear, positional overrides
// ('end' closes regardless, 'continue' suppresses the auto rule until a
// later explicit 'end'), skipped/unscored points contribute nothing to the
// count but their overrides are still consumed.

enum Winner: String, Codable {
    case user, opponent
}

enum GameEndOverride: String, Codable {
    case end
    case `continue`
}

struct GameSummary: Hashable {
    var you: Int
    var them: Int
    var winnerOverride: Winner?
}

struct GameBoundary: Hashable {
    let game: Int
    let you: Int
    let them: Int
    let winnerOverride: Winner?
}

let GAME_TARGET = 11
let CLEAR_BY = 2

/// Who won a completed game — or nil when the score can't prove it.
func gameWinner(_ g: GameSummary) -> Winner? {
    if max(g.you, g.them) < GAME_TARGET { return nil }
    if abs(g.you - g.them) < CLEAR_BY { return nil }
    return g.you > g.them ? .user : .opponent
}

/// gameWinner with the owner's answer folded in — a human answer beats the
/// heuristic.
func resolvedGameWinner(_ g: GameSummary) -> Winner? {
    g.winnerOverride ?? gameWinner(g)
}

struct BoundaryWalk {
    var you = 0
    var them = 0
    /// A 'continue' override is active: auto boundaries stay suppressed
    /// until an explicit 'end' closes the game.
    var open = false
}

/// Fold one VISIBLE point into the walk. Returns the completed game's final
/// score when a game ends AT this point, resetting the walk — else nil.
func stepBoundaryWalk(
    _ walk: inout BoundaryWalk,
    winner: Winner?,
    override: GameEndOverride?
) -> GameSummary? {
    if winner == .user { walk.you += 1 }
    else if winner == .opponent { walk.them += 1 }

    let ends: Bool
    switch override {
    case .end:
        ends = true
    case .continue:
        walk.open = true
        ends = false
    case nil:
        if walk.open {
            ends = false
        } else if winner == nil {
            ends = false
        } else {
            ends = gameWinner(GameSummary(you: walk.you, them: walk.them)) != nil
        }
    }
    guard ends else { return nil }
    let final = GameSummary(you: walk.you, them: walk.them)
    walk.you = 0
    walk.them = 0
    walk.open = false
    return final
}

struct MatchScore {
    var games: [GameSummary] = []
    var current = GameSummary(you: 0, them: 0)
    var confirmedCount = 0
    var gamesYou = 0
    var gamesThem = 0
    var boundaryAfter: [UUID: GameBoundary] = [:]
    var openAfter: Set<UUID> = []
    var open = false
}

func computeMatchScore(_ orderedPoints: [PointRow]) -> MatchScore {
    var score = MatchScore()
    var walk = BoundaryWalk()
    for p in orderedPoints {
        let winner: Winner? = (p.isLet ?? false) ? nil : p.confirmedWinner
        if winner != nil { score.confirmedCount += 1 }
        if var ended = stepBoundaryWalk(&walk, winner: winner, override: p.gameEndOverride) {
            if let named = p.gameWinnerOverride { ended.winnerOverride = named }
            score.games.append(ended)
            score.boundaryAfter[p.id] = GameBoundary(
                game: score.games.count, you: ended.you, them: ended.them,
                winnerOverride: ended.winnerOverride
            )
        } else if walk.open {
            score.openAfter.insert(p.id)
        }
    }
    score.current = GameSummary(you: walk.you, them: walk.them)
    score.gamesYou = score.games.filter { resolvedGameWinner($0) == .user }.count
    score.gamesThem = score.games.filter { resolvedGameWinner($0) == .opponent }.count
    score.open = walk.open
    return score
}

/// The game-boundary control's offer for one point. The label names what
/// the tap DOES, never what is currently true — "Game ended" closes a game
/// here, "Didn't end" reopens one that closes here. `endsHere` is the lit
/// state: a game ends at this point as the walk currently stands.
///
/// Every tap is its own inverse. Reopening an automatic close writes
/// 'continue'; reopening one you pinned yourself just clears the pin, since
/// automatic already ends the game there.
func boundaryAction(
    override: GameEndOverride?, walkEndsHere: Bool
) -> (label: String, next: GameEndOverride?, endsHere: Bool) {
    let endsHere = override == .end ? true : override == .continue ? false : walkEndsHere
    if endsHere {
        return ("Didn't end", override == .end ? nil : .continue, true)
    }
    return ("Game ended", override == .continue ? nil : .end, false)
}

/// Timeline order: by source-video time, worker idx as tiebreak/fallback.
func sortPoints(_ points: [PointRow]) -> [PointRow] {
    points.sorted { a, b in
        if let ta = a.t0, let tb = b.t0, ta != tb { return ta < tb }
        return a.idx < b.idx
    }
}

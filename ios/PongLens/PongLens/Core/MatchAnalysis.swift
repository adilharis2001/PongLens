import Foundation

// Port of matchStats.ts and matchAnalysis.ts — the numbers behind the
// match analysis cards. Every input is user-confirmed or rotation-derived:
// a point counts only once it is SCORED, and the server per point comes
// from the ITTF rotation, so these agree with the chip on the point.
// "You" is always the uploader.

struct Rate: Hashable {
    let played: Int
    let won: Int
    /// Whole-number win % over `played`, nil when there is nothing to
    /// divide by — callers render an honest dash.
    var pct: Int? {
        played > 0 ? Int((Double(won) / Double(played) * 100).rounded()) : nil
    }
}

struct MatchStatsSummary {
    /// Stats only mean something once a full game is on the board: a
    /// handful of points reads as "100% on serve" and misleads.
    let hasData: Bool
    let serverKnown: Bool
    let won: Int
    let lost: Int
    let serve: Rate
    let receive: Rate
    let gamesYou: Int
    let gamesThem: Int
    /// Scored points that also say HOW they ended — drives the nudge.
    let detailed: Int
    let pressure: Rate
    let bounceBack: Rate

    var scored: Int { won + lost }
}

struct MomentumStep: Hashable {
    let diff: Int
    let game: Int
    let endsGame: Bool
}

struct BestRun: Hashable {
    let len: Int
    let who: Winner
}

struct Tally: Hashable {
    let label: String
    var won: Int
    var lost: Int
}

struct ReasonCount: Hashable {
    let label: String
    let count: Int
}

struct MatchAnalysisResult {
    struct Momentum {
        var steps: [MomentumStep] = []
        var peak = 0
        var trough = 0
        var bestRun: BestRun?
        var leadChanges = 0
    }

    struct ServeCuts {
        var mineSpins: [Tally] = []
        var mineLengths: [Tally] = []
        var mineCount = 0
        var theirSpins: [Tally] = []
        var theirCount = 0
        /// Points where the serve was described at all.
        var described = 0
    }

    struct Mistakes {
        var reasons: [ReasonCount] = []
        var totalLost = 0
        var reasonsGiven = 0
    }

    var momentum = Momentum()
    var serve = ServeCuts()
    var mistakes = Mistakes()
}

/// Order the cuts read in, rather than by whatever the data happened to hit.
let SPIN_ORDER = [
    "Side-under", "Side-top", "Sidespin", "Backspin", "Topspin", "No spin",
]
let LENGTH_ORDER = ["Short", "Half-long", "Long"]

func serveSpinLabelFor(_ spin: String?, sidespin: Bool?) -> String? {
    if sidespin == true {
        return spin == "back" ? "Side-under" : spin == "top" ? "Side-top" : "Sidespin"
    }
    guard let spin else { return nil }
    return SERVE_SPINS.first { $0.value == spin }?.label
}

func serveLengthLabelFor(_ length: String?) -> String? {
    guard let length else { return nil }
    return SERVE_LENGTHS.first { $0.value == length }?.label
}

private func tallyList(_ map: [String: Tally], order: [String]) -> [Tally] {
    let seen = order.compactMap { map[$0] }
    let extra = map.values.filter { !order.contains($0.label) }
    return seen + extra
}

func computeMatchStats(
    _ points: [MatchPoint],
    serving: [UUID: ServeInfo],
    score: MatchScore
) -> MatchStatsSummary {
    var won = 0, lost = 0
    var servePlayed = 0, serveWon = 0
    var recvPlayed = 0, recvWon = 0
    var pressurePlayed = 0, pressureWon = 0
    var bouncePlayed = 0, bounceWon = 0
    var lastWasLoss = false
    var detailed = 0
    var walk = BoundaryWalk()

    for p in points {
        // Skipped points score nothing, but their positional boundary
        // override still folds through the walk.
        if p.isLet || p.confirmedWinner == nil {
            _ = stepBoundaryWalk(&walk, winner: nil, override: p.gameEndOverride)
            continue
        }
        let iWon = p.confirmedWinner == .user
        if p.confirmedHow != nil { detailed += 1 }
        // The score ENTERING the point decides whether it was pressure.
        if walk.you >= 9 || walk.them >= 9 {
            pressurePlayed += 1
            if iWon { pressureWon += 1 }
        }
        if lastWasLoss {
            bouncePlayed += 1
            if iWon { bounceWon += 1 }
        }
        lastWasLoss = !iWon
        _ = stepBoundaryWalk(&walk, winner: p.confirmedWinner, override: p.gameEndOverride)

        if iWon { won += 1 } else { lost += 1 }

        switch serving[p.id]?.server {
        case .user:
            servePlayed += 1
            if iWon { serveWon += 1 }
        case .opponent:
            recvPlayed += 1
            if iWon { recvWon += 1 }
        case nil:
            break
        }
    }

    return MatchStatsSummary(
        hasData: score.gamesYou + score.gamesThem > 0,
        serverKnown: servePlayed + recvPlayed > 0,
        won: won, lost: lost,
        serve: Rate(played: servePlayed, won: serveWon),
        receive: Rate(played: recvPlayed, won: recvWon),
        gamesYou: score.gamesYou, gamesThem: score.gamesThem,
        detailed: detailed,
        pressure: Rate(played: pressurePlayed, won: pressureWon),
        bounceBack: Rate(played: bouncePlayed, won: bounceWon)
    )
}

func computeMatchAnalysis(
    _ points: [MatchPoint],
    serving: [UUID: ServeInfo],
    customReasons: [UUID: String] = [:]
) -> MatchAnalysisResult {
    var result = MatchAnalysisResult()
    var diff = 0, game = 0, prevSign = 0
    var runLen = 0
    var runWho: Winner?

    var mySpin: [String: Tally] = [:]
    var myLength: [String: Tally] = [:]
    var theirSpin: [String: Tally] = [:]
    var reasonCounts: [String: Int] = [:]
    var reasonOrder: [String] = []
    var walk = BoundaryWalk()

    for p in points {
        if p.isLet || p.confirmedWinner == nil {
            let ended = stepBoundaryWalk(&walk, winner: nil, override: p.gameEndOverride)
            if ended != nil { game += 1 }
            continue
        }

        let iWon = p.confirmedWinner == .user
        diff += iWon ? 1 : -1
        if diff > result.momentum.peak { result.momentum.peak = diff }
        if diff < result.momentum.trough { result.momentum.trough = diff }

        // A lead change is the differential CROSSING level, not touching it.
        let sign = diff == 0 ? 0 : (diff > 0 ? 1 : -1)
        if sign != 0, prevSign != 0, sign != prevSign { result.momentum.leadChanges += 1 }
        if sign != 0 { prevSign = sign }

        let who: Winner = iWon ? .user : .opponent
        if who == runWho {
            runLen += 1
        } else {
            runWho = who
            runLen = 1
        }
        // Strictly greater, so ties keep the earliest run.
        if result.momentum.bestRun == nil || runLen > result.momentum.bestRun!.len {
            result.momentum.bestRun = BestRun(len: runLen, who: who)
        }

        let ended = stepBoundaryWalk(&walk, winner: p.confirmedWinner, override: p.gameEndOverride)
        result.momentum.steps.append(
            MomentumStep(diff: diff, game: game, endsGame: ended != nil)
        )
        if ended != nil { game += 1 }

        // Serve cuts: only where the serve was described AND the rotation
        // knows whose serve it was.
        let spin = serveSpinLabelFor(p.serveSpin, sidespin: p.serveSidespin)
        let length = serveLengthLabelFor(p.serveLength)
        let server = serving[p.id]?.server
        if spin != nil || length != nil, let server {
            result.serve.described += 1
            func bump(_ map: inout [String: Tally], _ label: String) {
                var t = map[label] ?? Tally(label: label, won: 0, lost: 0)
                if iWon { t.won += 1 } else { t.lost += 1 }
                map[label] = t
            }
            if server == .user {
                result.serve.mineCount += 1
                if let spin { bump(&mySpin, spin) }
                if let length { bump(&myLength, length) }
            } else {
                result.serve.theirCount += 1
                // Length is broken out for YOUR serves only: it is the
                // dimension you can change. Against theirs, reading the
                // spin is the skill.
                if let spin { bump(&theirSpin, spin) }
            }
        }

        if !iWon {
            result.mistakes.totalLost += 1
            if let reasons = p.lossReasons, !reasons.isEmpty {
                result.mistakes.reasonsGiven += 1
                for r in reasons {
                    if reasonCounts[r] == nil { reasonOrder.append(r) }
                    reasonCounts[r, default: 0] += 1
                }
            }
        }
    }

    result.serve.mineSpins = tallyList(mySpin, order: SPIN_ORDER)
    result.serve.mineLengths = tallyList(myLength, order: LENGTH_ORDER)
    result.serve.theirSpins = tallyList(theirSpin, order: SPIN_ORDER)

    // Most frequent first; ties keep the order they were met in.
    result.mistakes.reasons = reasonOrder
        .map { value in
            ReasonCount(
                label: lossReasonDisplayLabel(value, custom: customReasons),
                count: reasonCounts[value] ?? 0
            )
        }
        .enumerated()
        .sorted { a, b in
            a.element.count == b.element.count
                ? a.offset < b.offset : a.element.count > b.element.count
        }
        .map(\.element)

    return result
}

/// A stored reason value as words. Custom pills carry their own label; a
/// pill the owner has since deleted still has to read as something.
func lossReasonDisplayLabel(_ value: String, custom: [UUID: String]) -> String {
    if value.hasPrefix("custom:") {
        let raw = String(value.dropFirst("custom:".count))
        if let id = UUID(uuidString: raw), let label = custom[id] { return label }
        return "Removed reason"
    }
    return LOSS_REASON_LABELS[value] ?? value
}

/// The Tools row's right side. Deliberately not a bare percentage: what
/// matters at that level is how much of the analysis you have earned.
func statsRowSummary(_ stats: MatchStatsSummary) -> String {
    let scored = stats.scored
    if scored == 0 { return "Score points to unlock" }
    if !stats.hasData { return "Finish a game to unlock" }
    if stats.detailed == 0 { return "\(scored) scored · add detail" }
    if stats.detailed < scored { return "\(stats.detailed)/\(scored) detailed" }
    return "\(scored) points · complete"
}

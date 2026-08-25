import Foundation

/// The automatic highlight picker — the Swift copy of
/// src/app/match/[id]/highlights.ts, which is the original.
///
/// The phone needs the same picks the server renders, before any network
/// round trip: the Tools row's summary ("5 rallies · 0:48") and the
/// preview playback both come from here. The rule therefore exists twice,
/// and the guard against the two drifting is the parity fixture
/// (ios/Tests/fixtures/highlights-parity.json): the web picker's own
/// output over a real match, which HighlightsTests replays through this
/// file. Change either side, regenerate the fixture
/// (node --experimental-strip-types scripts/highlights-fixture.ts), and
/// the other side's test names what drifted.
///
/// The rule itself: rally length is the quality signal; a starred rally
/// or the one that closed the last completed game outranks plain length;
/// selection FILLS the time budget greedily by rank (a count-based rule
/// measured out at 51s for "top 3" against a 20s Story); the picks come
/// back in match order so the score band walks forward.
enum Highlights {
    static let storyBudgetS = 20.0
    static let reelBudgetS = 60.0
    static let longBudgetS = 120.0

    struct Picks {
        /// The chosen points, in match order.
        let points: [MatchPoint]
        /// Sum of the chosen clips' seconds (rally plus context pads).
        let totalS: Double
    }

    private static func round2(_ v: Double) -> Double {
        (v * 100).rounded() / 100
    }

    /// `ordered` must be the match's VISIBLE points in timeline order —
    /// the same list every score walk consumes. Lets fold into the walk
    /// but are never picked.
    static func pick(
        _ ordered: [MatchPoint], pad: ClipPad, budgetS: Double
    ) -> Picks {
        var walk = BoundaryWalk()
        var lastGameEnd: UUID?
        struct Candidate {
            let p: MatchPoint
            let s: Double
            let starred: Bool
        }
        var eligible: [Candidate] = []
        for p in ordered {
            let winner: Winner? = p.isLet ? nil : p.confirmedWinner
            if stepBoundaryWalk(&walk, winner: winner,
                                override: p.gameEndOverride) != nil {
                lastGameEnd = p.id
            }
            guard p.clipPath != nil, !p.isLet,
                  let t0 = p.t0, let t1 = p.t1 else { continue }
            let eff = effectivePad(pad, tightStart: p.tightStart,
                                   tightEnd: p.tightEnd)
            let s = round2(t1 - t0 + eff.pre + eff.post)
            if s <= 0 { continue }
            eligible.append(Candidate(p: p, s: s, starred: p.starred))
        }

        let ranked = eligible.sorted { a, b in
            let ta = (a.starred || a.p.id == lastGameEnd) ? 0 : 1
            let tb = (b.starred || b.p.id == lastGameEnd) ? 0 : 1
            if ta != tb { return ta < tb }
            if a.s != b.s { return a.s > b.s }
            return a.p.idx < b.p.idx
        }

        var chosen = Set<UUID>()
        var total = 0.0
        for c in ranked where total + c.s <= budgetS + 1e-9 {
            chosen.insert(c.p.id)
            total = round2(total + c.s)
        }
        return Picks(points: ordered.filter { chosen.contains($0.id) },
                     totalS: total)
    }

    /// The Tools row's trailing text: "5 rallies · 0:48", or nil when the
    /// match has nothing to pick from (the row then reads as pending).
    static func summary(_ picks: Picks) -> String? {
        guard !picks.points.isEmpty else { return nil }
        let n = picks.points.count
        let s = Int(picks.totalS.rounded())
        return "\(n) \(n == 1 ? "rally" : "rallies") · "
            + String(format: "%d:%02d", s / 60, s % 60)
    }
}

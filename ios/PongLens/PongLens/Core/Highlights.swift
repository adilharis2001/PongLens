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
/// The rule itself (reordered 2026-08-25): rally length is the quality
/// signal; a long rally must look GENUINE where the worker recorded ball
/// contacts (few contacts drops it to the back — no data reads as
/// genuine); up to two starred rallies, the longest of them, keep a nod
/// ahead of plain length; selection FILLS the time budget greedily by
/// rank (a count-based rule measured out at 51s for "top 3" against a
/// 20s Story); the picks come back in match order.
enum Highlights {
    static let storyBudgetS = 20.0
    static let reelBudgetS = 60.0
    static let longBudgetS = 150.0

    struct Picks {
        /// The chosen points, in match order.
        let points: [MatchPoint]
        /// Sum of the chosen clips' seconds (rally plus context pads).
        let totalS: Double
    }

    private static func round2(_ v: Double) -> Double {
        (v * 100).rounded() / 100
    }

    /// Ball-contact detections recorded for this rally, when the worker
    /// has them (placement v3 candidates). nil = no signal — and no
    /// signal must read as genuine, never as suspect.
    private static func contactCount(_ p: MatchPoint) -> Int? {
        guard case .v3(let data)? = p.placement else { return nil }
        return data.candidates?.count
    }

    /// `ordered` must be the match's VISIBLE points in timeline order.
    /// Lets are never picked.
    static func pick(
        _ ordered: [MatchPoint], pad: ClipPad, budgetS: Double
    ) -> Picks {
        struct Candidate {
            let p: MatchPoint
            let s: Double
            let starred: Bool
            let genuine: Bool
        }
        var eligible: [Candidate] = []
        for p in ordered {
            guard p.clipPath != nil, !p.isLet,
                  let t0 = p.t0, let t1 = p.t1 else { continue }
            let eff = effectivePad(pad, tightStart: p.tightStart,
                                   tightEnd: p.tightEnd)
            let rallyLen = t1 - t0
            let s = round2(rallyLen + eff.pre + eff.post)
            if s <= 0 { continue }
            // Roughly one recorded contact per six seconds is a LOW bar
            // for a real rally — the point is catching the thirty-second
            // "rally" with two contacts, not grading normal ones.
            let genuine: Bool
            if let contacts = contactCount(p) {
                genuine = contacts >= max(2, Int(rallyLen / 6))
            } else {
                genuine = true
            }
            eligible.append(Candidate(p: p, s: s, starred: p.starred,
                                      genuine: genuine))
        }

        // Up to two starred rallies — the longest genuine ones — keep a
        // nod ahead of plain length.
        let boosted = Set(
            eligible.filter { $0.starred && $0.genuine }
                .sorted { a, b in
                    a.s != b.s ? a.s > b.s : a.p.idx < b.p.idx
                }
                .prefix(2)
                .map(\.p.id)
        )

        func tier(_ c: Candidate) -> Int {
            !c.genuine ? 2 : boosted.contains(c.p.id) ? 0 : 1
        }
        let ranked = eligible.sorted { a, b in
            let ta = tier(a)
            let tb = tier(b)
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

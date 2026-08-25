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
/// signal, but a long rally must look GENUINE and the worker holds two
/// receipts — the reconstruction's hit count (two contacts or fewer is a
/// serve error or an ace, never a highlight) and the placement bounce
/// detections (a long span with almost none is dead time in a rally's
/// clothes). Rank length is capped at ~2s of credible play per contact,
/// so spans inflated by failed serve detection stop beating honest
/// rallies, while the budget still pays the true clip length. Either
/// signal missing reads as genuine. Up to two starred rallies keep a
/// nod ahead of plain length; the picks come back in match order.
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
    /// Lets are never picked. `tapEnd` is app_config.tap_end_playback:
    /// clip lengths end at the winner tap plus half a second
    /// (Playhead.effectiveEnd), so the budget buys real play instead of
    /// ball retrieval — every caller must pass the same value the
    /// players use, or the row, the tape and the render disagree.
    static func pick(
        _ ordered: [MatchPoint], pad: ClipPad, budgetS: Double,
        tapEnd: Bool = false
    ) -> Picks {
        struct Candidate {
            let p: MatchPoint
            let s: Double
            let rankS: Double
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
            var s = round2(rallyLen + eff.pre + eff.post)
            // The tap trims the clip (never extends): its cost against
            // the budget and its watchable length are the trimmed one.
            // Legacy points without cut offsets keep the pad formula.
            if tapEnd, let c = p.cutT0,
               let end = effectiveEnd(p, pad, on: true) {
                s = round2(min(s, end - c))
            }
            if s <= 0 { continue }
            // Roughly one recorded contact per six seconds is a LOW bar
            // for a real rally — the point is catching the thirty-second
            // "rally" with two contacts, not grading normal ones.
            let densityOK: Bool
            if let contacts = contactCount(p) {
                densityOK = contacts >= max(2, Int(rallyLen / 6))
            } else {
                densityOK = true
            }
            let nHits = p.suggestion?.nHits
            let genuine = densityOK && (nHits == nil || nHits! >= 3)
            // The span only ranks as high as the hits can vouch for.
            let rankS = nHits.map { min(s, round2(2 * Double($0))) } ?? s
            eligible.append(Candidate(p: p, s: s, rankS: rankS,
                                      starred: p.starred, genuine: genuine))
        }

        // Up to two starred rallies — the longest genuine ones — keep a
        // nod ahead of plain length.
        let boosted = Set(
            eligible.filter { $0.starred && $0.genuine }
                .sorted { a, b in
                    a.rankS != b.rankS ? a.rankS > b.rankS : a.p.idx < b.p.idx
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
            if a.rankS != b.rankS { return a.rankS > b.rankS }
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

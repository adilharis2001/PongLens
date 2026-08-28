import Foundation

// The highlight picker exists twice — highlights.ts is the original,
// Core/Highlights.swift the port — and this parity check replays the web
// picker's own recorded output (fixtures/highlights-parity.json, written
// by scripts/highlights-fixture.ts) through the Swift side. Same shape as
// the serve-parity check: the port is compared against the original's
// output over a real match, never against a second reading of the spec.

private struct HLFixture: Decodable {
    struct Pt: Decodable {
        let id: UUID
        let idx: Int
        let t0: Double?
        let t1: Double?
        let is_let: Bool
        let starred: Bool
        let tight_start: Bool
        let tight_end: Bool
        let confirmed_winner: String?
        let game_end_override: String?
        let has_clip: Bool
        let contacts: Int?
        let n_hits: Int?
        // Winner-tap fields (2026-08-25); absent on the legacy block.
        let cut_t0: Double?
        let scored_at_cut_s: Double?
    }
    struct Pad: Decodable {
        let pre: Double
        let post: Double
    }
    struct Expected: Decodable {
        let ids: [UUID]
        let totalS: Double
    }
    /// Julian 08-23 — 76 winner taps. `expected` pins the picks with
    /// tap-trimmed lengths (the shipping config), `expected_off` the
    /// same match with the flag off.
    struct Tapped: Decodable {
        let pad: Pad
        let points: [Pt]
        let expected: [String: Expected]
        let expected_off: [String: Expected]
    }
    let pad: Pad
    let points: [Pt]
    let expected: [String: Expected]
    let tapped: Tapped?
}

private func hlPoint(_ r: HLFixture.Pt, matchId: UUID) -> MatchPoint {
    MatchPoint(
        id: r.id, matchId: matchId, idx: r.idx,
        t0: r.t0, t1: r.t1, cutT0: r.cut_t0,
        server: nil, serverOverride: nil, isLet: r.is_let,
        confirmedWinner: r.confirmed_winner.flatMap { Winner(rawValue: $0) },
        confirmedHow: nil, starred: r.starred,
        deleted: false, edited: false,
        tightStart: r.tight_start, tightEnd: r.tight_end,
        gameEndOverride: r.game_end_override.flatMap { GameEndOverride(rawValue: $0) },
        gameWinnerOverride: nil,
        scoredAtCutS: r.scored_at_cut_s, serveStartAtCutS: nil,
        lossReasons: nil, direction: nil, misreadKind: nil,
        serveSpin: nil, serveSidespin: nil, serveLength: nil,
        placementFlagged: nil,
        clipPath: r.has_clip ? "c" : nil,
        // A real v3 PlacementData carrying n contact detections — the
        // detections() builder from ScoreLogicTests, same compile unit.
        placement: r.contacts.map { detections((0..<$0).map(Double.init)) },
        suggestion: r.n_hits.map { PointSuggestionLite(nHits: $0) }
    )
}

func runHighlightsParityChecks() {
    print("\n— highlight picker parity —")
    let url = URL(fileURLWithPath: "fixtures/highlights-parity.json")
    guard let data = try? Data(contentsOf: url),
          let fx = try? JSONDecoder().decode(HLFixture.self, from: data) else {
        check(false, "fixture fixtures/highlights-parity.json is readable")
        return
    }
    check(!fx.expected.isEmpty, "fixture carries expected picks")

    let matchId = uuid(424242)
    let pad = ClipPad(pre: fx.pad.pre, post: fx.pad.post)
    let ordered = fx.points.map { hlPoint($0, matchId: matchId) }
    let budgets: [(String, Double)] = [
        ("story", Highlights.storyBudgetS),
        ("reel", Highlights.reelBudgetS),
        ("long", Highlights.longBudgetS),
    ]
    for (kind, budget) in budgets {
        guard let want = fx.expected[kind] else {
            check(false, "\(kind): fixture has expectations")
            continue
        }
        // The legacy match carries no taps, so BOTH flag states must
        // reproduce the pinned picks — the flag is a no-op without data.
        for tapEnd in [false, true] {
            let got = Highlights.pick(ordered, pad: pad, budgetS: budget,
                                      ends: EndOptions(tapEnd: tapEnd))
            check(got.points.map(\.id) == want.ids,
                  "\(kind) tapEnd=\(tapEnd): same rallies as the web picker")
            check(abs(got.totalS - want.totalS) < 0.01,
                  "\(kind) tapEnd=\(tapEnd): same total seconds")
            check(got.totalS <= budget + 1e-9,
                  "\(kind) tapEnd=\(tapEnd): total inside the budget")
        }
    }

    // The tapped block: Julian 08-23, 76 winner taps. Trimmed lengths
    // change the picks (more rallies fit), and the off state must match
    // the old rule exactly.
    if let tapped = fx.tapped {
        check(tapped.points.contains { $0.scored_at_cut_s != nil },
              "tapped block really carries winner taps")
        let tpad = ClipPad(pre: tapped.pad.pre, post: tapped.pad.post)
        let tOrdered = tapped.points.map { hlPoint($0, matchId: matchId) }
        for (kind, budget) in budgets {
            guard let on = tapped.expected[kind],
                  let off = tapped.expected_off[kind] else {
                check(false, "tapped \(kind): fixture has expectations")
                continue
            }
            let gotOn = Highlights.pick(tOrdered, pad: tpad, budgetS: budget,
                                        ends: EndOptions(tapEnd: true))
            check(gotOn.points.map(\.id) == on.ids,
                  "tapped \(kind) on: same rallies as the web picker")
            check(abs(gotOn.totalS - on.totalS) < 0.01,
                  "tapped \(kind) on: same total seconds (\(gotOn.totalS) vs \(on.totalS))")
            let gotOff = Highlights.pick(tOrdered, pad: tpad, budgetS: budget,
                                         ends: EndOptions.off)
            check(gotOff.points.map(\.id) == off.ids,
                  "tapped \(kind) off: same rallies as the web picker")
            check(abs(gotOff.totalS - off.totalS) < 0.01,
                  "tapped \(kind) off: same total seconds")
        }
    } else {
        check(false, "fixture carries the tapped block")
    }

    // The summary line the Tools row shows.
    let reel = Highlights.pick(ordered, pad: pad, budgetS: Highlights.reelBudgetS)
    check(Highlights.summary(reel) != nil, "summary reads for a real match")
    let none = Highlights.pick([], pad: pad, budgetS: 20)
    check(Highlights.summary(none) == nil, "summary is nil with nothing to pick")
}

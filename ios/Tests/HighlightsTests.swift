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
    }
    struct Pad: Decodable {
        let pre: Double
        let post: Double
    }
    struct Expected: Decodable {
        let ids: [UUID]
        let totalS: Double
    }
    let pad: Pad
    let points: [Pt]
    let expected: [String: Expected]
}

private func hlPoint(_ r: HLFixture.Pt, matchId: UUID) -> MatchPoint {
    MatchPoint(
        id: r.id, matchId: matchId, idx: r.idx,
        t0: r.t0, t1: r.t1, cutT0: nil,
        server: nil, serverOverride: nil, isLet: r.is_let,
        confirmedWinner: r.confirmed_winner.flatMap { Winner(rawValue: $0) },
        confirmedHow: nil, starred: r.starred,
        deleted: false, edited: false,
        tightStart: r.tight_start, tightEnd: r.tight_end,
        gameEndOverride: r.game_end_override.flatMap { GameEndOverride(rawValue: $0) },
        gameWinnerOverride: nil,
        scoredAtCutS: nil, serveStartAtCutS: nil,
        lossReasons: nil, direction: nil, misreadKind: nil,
        serveSpin: nil, serveSidespin: nil, serveLength: nil,
        placementFlagged: nil,
        clipPath: r.has_clip ? "c" : nil,
        placement: nil
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
        let got = Highlights.pick(ordered, pad: pad, budgetS: budget)
        check(got.points.map(\.id) == want.ids,
              "\(kind): same rallies, same order as the web picker")
        check(abs(got.totalS - want.totalS) < 0.01,
              "\(kind): same total seconds (\(got.totalS) vs \(want.totalS))")
        check(got.totalS <= budget + 1e-9,
              "\(kind): total stays inside the \(Int(budget))s budget")
    }

    // The summary line the Tools row shows.
    let reel = Highlights.pick(ordered, pad: pad, budgetS: Highlights.reelBudgetS)
    check(Highlights.summary(reel) != nil, "summary reads for a real match")
    let none = Highlights.pick([], pad: pad, budgetS: 20)
    check(Highlights.summary(none) == nil, "summary is nil with nothing to pick")
}

import Foundation

// effectiveEnd exists twice — playhead.ts is the original, Core/
// Playhead.swift the port — and 143 gave it a second ranked rung, which is
// exactly the kind of change the two implementations drift on. So this
// replays the web module's own recorded answers (fixtures/
// rally-end-parity.json, written by scripts/rally-end-fixture.ts) through
// the Swift side. Same arrangement as the serve and highlights parity
// checks: the port is measured against the original's OUTPUT, never
// against a second reading of the same sentence. Two hand-written suites
// agreeing only proves both authors read it the same way, which is how the
// placement mirror survived a passing test for eight months.

private struct RallyEndFixture: Decodable {
    struct Pad: Decodable {
        let pre: Double
        let post: Double
    }
    struct Pt: Decodable {
        let cut_t0: Double?
        let t0: Double?
        let t1: Double?
        let edited: Bool
        let tight_start: Bool
        let tight_end: Bool
        let scored_at_cut_s: Double?
        let rally_end_cut_s: Double?
    }
    struct Opt: Decodable {
        struct Rally: Decodable {
            let on: Bool
            let bufferS: Double
        }
        let tapEnd: Bool
        let rallyEnd: Rally?
    }
    struct Case: Decodable {
        let name: String
        let point: Pt
        let padded_end: Double?
        /// setting name -> the answer playhead.ts gave.
        let ends: [String: Double?]
    }
    let pad: Pad
    let options: [String: Opt]
    let cases: [Case]
}

func runRallyEndParityChecks() {
    print("\n— effectiveEnd parity (web fixture -> Swift) —")
    let url = URL(fileURLWithPath: "fixtures/rally-end-parity.json")
    guard let data = try? Data(contentsOf: url),
          let fx = try? JSONDecoder().decode(RallyEndFixture.self, from: data)
    else {
        check(false, "rally-end fixture loads")
        return
    }
    let pad = ClipPad(pre: fx.pad.pre, post: fx.pad.post)

    for c in fx.cases {
        let p = MatchPoint(
            id: UUID(), matchId: UUID(), idx: 1,
            t0: c.point.t0, t1: c.point.t1, cutT0: c.point.cut_t0,
            server: nil, serverOverride: nil, isLet: false,
            confirmedWinner: nil, confirmedHow: nil, starred: false,
            deleted: false, edited: c.point.edited,
            tightStart: c.point.tight_start, tightEnd: c.point.tight_end,
            gameEndOverride: nil, gameWinnerOverride: nil,
            scoredAtCutS: c.point.scored_at_cut_s,
            serveStartAtCutS: nil,
            rallyEndCutS: c.point.rally_end_cut_s,
            lossReasons: nil, direction: nil, misreadKind: nil,
            serveSpin: nil, serveSidespin: nil, serveLength: nil,
            placementFlagged: nil, clipPath: nil, placement: nil
        )
        same("\(c.name): padded end", paddedEnd(p, pad), c.padded_end)
        for (name, expected) in c.ends.sorted(by: { $0.key < $1.key }) {
            guard let o = fx.options[name] else {
                check(false, "\(c.name): unknown setting \(name)")
                continue
            }
            let ends = EndOptions(
                tapEnd: o.tapEnd,
                rallyEnd: o.rallyEnd.map {
                    RallyEndConfig(on: $0.on, bufferS: $0.bufferS)
                }
            )
            same("\(c.name) [\(name)]", effectiveEnd(p, pad, ends), expected)
        }
    }
}

/// Two optional doubles agree, to a tolerance that ignores the float noise
/// a different language's arithmetic leaves behind (54.599999999999994 is
/// the same answer as 54.6, and a port failing over that teaches nothing).
private func same(_ label: String, _ got: Double?, _ want: Double?) {
    if got == nil || want == nil {
        check(got == nil && want == nil, "\(label) — both nil")
        return
    }
    check(abs(got! - want!) < 1e-6, "\(label) — \(got!) == \(want!)")
}

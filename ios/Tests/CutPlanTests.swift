import Foundation

// Port-parity checks for Core/CutPlan.swift against the Mac's own planner.
//
// fixtures/cut-plan-parity.json is written by
// `worker/hand_cut_device.py --write-fixture` from the REAL Python
// functions (plan_hand_cut over play_cut_segments, segment_cut_offsets and
// cut_position) for the eight live hand cuts and thirteen edge cases. Every
// expected number is compared EXACTLY: the Mac re-derives every one of them
// when it checks a phone's cut, so a last-bit difference here is a real
// difference there.

private nonisolated struct CutPlanFixture: Decodable {
    struct Rules: Decodable {
        let clip_pre: Double
        let clip_post: Double
        let segment_head: Double
        let segment_tail: Double
        let merge_gap: Double
        let decimals: Int
    }
    struct Rounding: Decodable {
        let x: Double
        let r2: Double
    }
    struct Expected: Decodable {
        let dropped: Int
        let segments_exact: [[Double]]
        let cut_segments: [[Double]]
        let offsets: [Double]
        let kept_s: Double
        let points: [CutPlan.Point]
    }
    struct Case: Decodable {
        let name: String
        let duration: Double
        let marks: [[Double]]
        let expected: Expected
    }
    let rules: Rules
    let rounding: [Rounding]
    let cases: [Case]
}

func runCutPlanParityChecks() {
    print("\ncut plan (parity with hand_cut_device.plan_hand_cut)")
    let url = URL(fileURLWithPath: "fixtures/cut-plan-parity.json")
    guard let data = try? Data(contentsOf: url) else {
        check(false, "fixture fixtures/cut-plan-parity.json is readable")
        return
    }
    let fx: CutPlanFixture
    do {
        fx = try JSONDecoder().decode(CutPlanFixture.self, from: data)
    } catch {
        check(false, "cut plan fixture decodes: \(error)")
        return
    }

    // The rules the fixture was generated under are the ones ported.
    eq(fx.rules.clip_pre, CutPlan.clipPre, "clip pre pad")
    eq(fx.rules.clip_post, CutPlan.clipPost, "clip post pad")
    eq(fx.rules.segment_head, CutPlan.segmentHead, "segment head pad")
    eq(fx.rules.segment_tail, CutPlan.segmentTail, "segment tail pad")
    eq(fx.rules.merge_gap, CutPlan.mergeGap, "merge gap")
    eq(fx.rules.decimals, 2, "two decimals")

    // Python's round(x, 2), on the values where the obvious Swift differs.
    for r in fx.rounding {
        eq(CutPlan.r2(r.x), r.r2, "r2(\(r.x))")
    }
    check((2.675 * 100).rounded() / 100 != CutPlan.r2(2.675),
          "the naive rounding really does differ (the table is not vacuous)")

    var points = 0
    for c in fx.cases {
        let plan = CutPlan.plan(marks: c.marks, duration: c.duration)
        let e = c.expected
        eq(plan.dropped, e.dropped, "\(c.name): dropped")
        eq(plan.segmentsExact, e.segments_exact, "\(c.name): exact segments")
        eq(plan.cutSegments, e.cut_segments, "\(c.name): cut segments")
        eq(plan.offsets, e.offsets, "\(c.name): offsets")
        eq(plan.kept, e.kept_s, "\(c.name): kept seconds")
        eq(plan.points.count, e.points.count, "\(c.name): point count")
        for (got, want) in zip(plan.points, e.points) {
            eq(got, want, "\(c.name): point \(want.idx)")
        }
        points += e.points.count
    }
    check(fx.cases.count == 21, "all 21 cases present (\(fx.cases.count))")
    check(points == 451, "all 451 points compared (\(points))")

    // Names and the unexported helpers, by hand.
    eq(CutPlan.clipName(1), "01.mp4", "clip 1")
    eq(CutPlan.clipName(9), "09.mp4", "clip 9")
    eq(CutPlan.clipName(99), "99.mp4", "clip 99")
    eq(CutPlan.clipName(100), "100.mp4", "clip 100 has three digits")
    eq(CutPlan.cutPosition([], [], 5), 0, "no segments, position 0")
    eq(CutPlan.cutPosition([[10, 20]], [0], 25), 10, "past the end clamps to the cut's end")
    eq(CutPlan.cutPosition([[10, 20], [30, 40]], [0, 10], 25), 10, "a gap clamps to the next kept edge")

    // What the phone refuses to take on, because the Mac would redo it.
    let dropped = CutPlan.plan(marks: [[10, 20], [50.2, 51]], duration: 50)
    check(CutPlan.macRefusal(dropped) != nil, "a dropped mark goes to the Mac")
    let clamped = CutPlan.plan(marks: [[110, 121]], duration: 120.4)
    check(CutPlan.macRefusal(clamped) != nil, "an end 0.6 s past the video goes to the Mac")
    let finalSecond = CutPlan.plan(marks: [[40, 52.5], [110, 120.1]], duration: 120.4)
    check(CutPlan.macRefusal(finalSecond) == nil, "a point ending in the final second stays on the phone")
    let justPast = CutPlan.plan(marks: [[110, 120.45]], duration: 120.4)
    check(CutPlan.macRefusal(justPast) == nil, "an end 0.05 s past the video is inside the publish rule")
    check(CutPlan.macRefusal(CutPlan.plan(marks: [], duration: 60)) != nil, "no marks, nothing to cut")
    check(CutPlan.durationAgrees(phone: 236.3, row: 236), "0.3 s from the row agrees")
    check(!CutPlan.durationAgrees(phone: 238, row: 236), "2 s from the row does not")
    check(CutPlan.durationAgrees(phone: 100, row: nil), "no row figure, nothing to disagree with")
    check(!CutPlan.durationAgrees(phone: .nan, row: 100), "an unreadable length never agrees")

    // Timescales at which two-decimal edges are whole ticks.
    eq(CutPlan.compositionTimescale(natural: 600), 600, "600 kept")
    eq(CutPlan.compositionTimescale(natural: 30000), 30000, "30000 kept")
    eq(CutPlan.compositionTimescale(natural: 90000), 90000, "90000 kept")
    eq(CutPlan.compositionTimescale(natural: 15360), 600, "15360 is not a multiple of 100: 600")
    eq(CutPlan.compositionTimescale(natural: 0), 600, "unknown: 600")
    for s in [13.48, 22.12, 83.92999999999998, 1455.0, 0.15] {
        let ticks = (s * 600).rounded()
        check(abs(ticks / 600 - CutPlan.r2(s)) < 1e-12, "\(s) is whole ticks at 600")
    }
}

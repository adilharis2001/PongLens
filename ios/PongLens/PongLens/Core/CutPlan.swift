import Foundation

// Cutting a hand-marked match on the phone: the plan. A line-for-line port
// of `plan_hand_cut` in worker/hand_cut_device.py, which is the Mac's own
// hand cut, the Mac's check of a phone's cut and the generator of
// ios/Tests/fixtures/cut-plan-parity.json. Contract:
// docs/superpowers/specs/2026-09-25-device-hand-cut-contract.md, section 5.
//
// Foundation only, so ios/Tests/run.sh proves it against the fixture
// without a simulator. Every expected value in the fixture must come out
// bit for bit, which is why the arithmetic below keeps Python's exact
// order of operations (and Python's own `max`, `min`, `round` and `sum`)
// rather than anything that reads more naturally in Swift.

nonisolated enum CutPlan {
    // The Mac's rules (points_pipeline.py SEGMENT_PADS["normal"],
    // SEGMENT_MERGE_S; hand_cut_device.py CLIP_PRE_S / CLIP_POST_S).
    static let clipPre = 1.2
    static let clipPost = 1.3
    static let segmentHead = 0.15
    static let segmentTail = 0.15
    static let mergeGap = 0.5

    /// The Mac's publish rule: every point within this of its mark
    /// (normalize_manual_cut_observations). A plan that breaks it would be
    /// a mismatch the moment the Mac checks it.
    static let publishTolerance = 0.06

    /// One planned point, exactly the fields the manifest and the fixture
    /// carry.
    struct Point: Codable, Equatable, Sendable {
        var idx: Int
        var t0: Double
        var t1: Double
        var clipT0: Double
        var clipT1: Double
        var cutT0: Double
        var clip: String

        enum CodingKeys: String, CodingKey {
            case idx, t0, t1, clip
            case clipT0 = "clip_t0", clipT1 = "clip_t1", cutT0 = "cut_t0"
        }
    }

    struct Plan: Equatable, Sendable {
        var duration: Double
        /// Marks dropped because they start at or after the end of the video.
        var dropped: Int
        /// Each kept mark's (t0, t1) as the player marked it, before the clamp.
        var marked: [[Double]]
        /// play_cut_segments' own floats.
        var segmentsExact: [[Double]]
        /// Two decimals: what the phone encodes, the manifest reports and
        /// match.json keeps.
        var cutSegments: [[Double]]
        /// Where each segment starts on the cut's clock, planned.
        var offsets: [Double]
        var points: [Point]

        /// Seconds kept, summed as Python's `sum` sums them.
        var kept: Double { CutPlan.pythonSum(cutSegments.map { $0[1] - $0[0] }) }
    }

    // MARK: - Python's arithmetic

    /// Python's `round(x, 2)`: the exact binary value rounded half to even.
    /// `(x * 100).rounded() / 100` disagrees on values like 2.675 and 0.125,
    /// and the fixture pins them.
    static func r2(_ x: Double) -> Double {
        guard x.isFinite else { return x }
        return Double(String(format: "%.2f", x)) ?? x
    }

    /// The Mac's clip file name: 01.mp4 ... 99.mp4, 100.mp4.
    static func clipName(_ idx: Int) -> String {
        idx < 10 ? "0\(idx).mp4" : "\(idx).mp4"
    }

    /// Python's `max(a, b)` for two floats: `b` only when it is greater.
    static func pyMax(_ a: Double, _ b: Double) -> Double { b > a ? b : a }
    /// Python's `min(a, b)` for two floats: `b` only when it is smaller.
    static func pyMin(_ a: Double, _ b: Double) -> Double { b < a ? b : a }

    /// Python 3.12's `sum` over floats, which compensates (Neumaier), so it
    /// is not a plain running total. Two live cases in the fixture differ
    /// in the last bit from `reduce(0, +)`.
    static func pythonSum(_ values: [Double]) -> Double {
        var total = 0.0
        var c = 0.0
        for x in values {
            let t = total + x
            if abs(total) >= abs(x) {
                c += (total - t) + x
            } else {
                c += (x - t) + total
            }
            total = t
        }
        if c != 0, c.isFinite { total += c }
        return total
    }

    // MARK: - points_pipeline.py

    /// `play_cut_segments(windows, dur, head, tail, merge_gap)`: pad, clamp
    /// to [0, dur], sort, merge gaps under `mergeGap`.
    static func playCutSegments(
        _ windows: [[Double]], duration dur: Double,
        head: Double = segmentHead, tail: Double = segmentTail, mergeGap: Double = mergeGap
    ) -> [[Double]] {
        var wins: [[Double]] = []
        for w in windows where w[1] > w[0] {
            let start: Double = pyMax(0.0, w[0] - head)
            let end: Double = pyMin(dur, w[1] + tail)
            wins.append([start, end])
        }
        wins.sort { (a: [Double], b: [Double]) -> Bool in
            a[0] != b[0] ? a[0] < b[0] : a[1] < b[1]
        }
        var segs: [[Double]] = []
        for w in wins {
            if let last = segs.last, w[0] - last[1] < mergeGap {
                segs[segs.count - 1][1] = pyMax(last[1], w[1])
            } else {
                segs.append(w)
            }
        }
        return segs
    }

    /// `segment_cut_offsets(segments)`: the running total of lengths.
    static func segmentCutOffsets(_ segments: [[Double]]) -> [Double] {
        var offsets: [Double] = []
        var acc = 0.0
        for s in segments {
            offsets.append(acc)
            acc += s[1] - s[0]
        }
        return offsets
    }

    /// `cut_position(segments, offsets, t)`: where source second `t` lands
    /// in the cut. A second inside a removed gap clamps to the next kept
    /// edge.
    static func cutPosition(_ segments: [[Double]], _ offsets: [Double], _ t: Double) -> Double {
        for (s, off) in zip(segments, offsets) {
            if t < s[0] { return off }
            if t <= s[1] { return off + (t - s[0]) }
        }
        guard let last = segments.last, let lastOffset = offsets.last else { return 0 }
        return lastOffset + (last[1] - last[0])
    }

    // MARK: - hand_cut_device.py

    /// `plan_hand_cut(marks, duration)`. `marks` are [t0, t1] source seconds
    /// from the frozen draft, closed marks only; they are sorted here (a
    /// stable sort, like Python's).
    static func plan(marks: [[Double]], duration: Double,
                     pre: Double = clipPre, post: Double = clipPost) -> Plan {
        let dur = duration
        let order: [Int] = marks.indices.sorted { (a: Int, b: Int) -> Bool in
            marks[a][0] != marks[b][0] ? marks[a][0] < marks[b][0] : a < b
        }
        let sorted: [[Double]] = order.map { marks[$0] }
        var kept: [[Double]] = []
        var marked: [[Double]] = []
        var dropped = 0
        for m in sorted {
            if m[0] >= dur {
                dropped += 1
                continue
            }
            marked.append([m[0], m[1]])
            kept.append([m[0], pyMin(m[1], dur)])
        }
        var windows: [[Double]] = []
        for m in kept {
            let start: Double = pyMax(0.0, m[0] - pre)
            let end: Double = pyMin(dur, m[1] + post)
            windows.append([start, end])
        }
        let exact = playCutSegments(windows, duration: dur)
        let cutSegments: [[Double]] = exact.map { (s: [Double]) -> [Double] in [r2(s[0]), r2(s[1])] }
        let offsets = segmentCutOffsets(cutSegments)
        var points: [Point] = []
        for (i, m) in kept.enumerated() {
            let t0 = m[0]
            let t1 = m[1]
            let clipT0 = r2(pyMax(0.0, t0 - pre))
            points.append(Point(
                idx: i + 1,
                t0: r2(t0),
                t1: r2(t1),
                clipT0: clipT0,
                clipT1: r2(pyMin(dur, t1 + post)),
                cutT0: r2(cutPosition(cutSegments, offsets, clipT0)),
                clip: clipName(i + 1)))
        }
        return Plan(duration: dur, dropped: dropped, marked: marked, segmentsExact: exact,
                    cutSegments: cutSegments, offsets: offsets, points: points)
    }

    // MARK: - Before the phone takes the job

    /// Why the Mac would turn this plan down on sight (contract section 7,
    /// checks 3 and 4), so the phone hands such a match straight to the Mac
    /// instead of cutting something that is certain to be redone. Nil means
    /// the plan is one the Mac accepts.
    static func macRefusal(_ plan: Plan) -> String? {
        if plan.dropped > 0 { return "\(plan.dropped) mark(s) start after the end of the video" }
        if plan.points.isEmpty { return "nothing to cut" }
        for (p, m) in zip(plan.points, plan.marked) {
            if abs(p.t0 - m[0]) > publishTolerance || abs(p.t1 - m[1]) > publishTolerance {
                return "point \(p.idx) ends past the end of the video"
            }
        }
        return nil
    }

    /// The phone's reading of the video's length against the match row's,
    /// with the Mac's own tolerance for that comparison (check 2).
    static func durationAgrees(phone: Double, row: Double?) -> Bool {
        guard phone.isFinite, phone > 0 else { return false }
        guard let row, row > 0 else { return true }
        return abs(phone - row) <= 1.5
    }

    /// A composition timescale at which every two-decimal second is a
    /// whole number of ticks (contract section 5): the source's own when it
    /// is a multiple of 100, else 600.
    static func compositionTimescale(natural: Int32) -> Int32 {
        natural >= 100 && natural % 100 == 0 ? natural : 600
    }
}

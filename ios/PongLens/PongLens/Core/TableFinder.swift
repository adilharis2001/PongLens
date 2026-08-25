import Foundation
import CoreGraphics
import simd

/// The pure half of the live table check: heatmap decoding, the physical-
/// plausibility gate, and the envelope verdict. No UIKit, no AVFoundation,
/// no Core ML — the same file compiles into a macOS harness and is checked
/// against the Python reference (worker/train_table_corners.py decode and
/// worker/mine_record_poses.py pose) before anything ships. Keep it that way.
///
/// World frame as everywhere else: x along the table length (near end at
/// -1.370 m), y across the width (camera-left positive), z up from the
/// TABLE SURFACE.
enum TableFinderCore {

    static let inputWidth = 320
    static let inputHeight = 176
    static let heatWidth = 80
    static let heatHeight = 44

    // The proven-good stance envelope, mined from 61 calibrated matches
    // (worker/mine_record_poses.py). Metres; height above the surface.
    static let behindRange = 1.49...4.09
    static let lateralRange = 1.2...3.8
    static let heightRange = 0.55...1.45

    /// Sub-pixel argmax per heatmap channel, identical to the trainer's
    /// decode(). Returns corners in model-input pixels, canonical order
    /// A near-left, B near-right, C far-right, D far-left, plus the peak
    /// value per corner as a confidence.
    static func decode(_ heat: [Float]) -> (corners: [SIMD2<Double>],
                                            peaks: [Float]) {
        var corners: [SIMD2<Double>] = []
        var peaks: [Float] = []
        let plane = heatWidth * heatHeight
        for channel in 0..<4 {
            let base = channel * plane
            var best = -Float.infinity
            var bx = 0, by = 0
            for y in 0..<heatHeight {
                for x in 0..<heatWidth {
                    let v = heat[base + y * heatWidth + x]
                    if v > best { best = v; bx = x; by = y }
                }
            }
            var fx = Double(bx), fy = Double(by)
            if bx > 0 && bx < heatWidth - 1 {
                let l = Double(heat[base + by * heatWidth + bx - 1])
                let m = Double(heat[base + by * heatWidth + bx])
                let r = Double(heat[base + by * heatWidth + bx + 1])
                let denom = l - 2 * m + r
                if abs(denom) > 1e-6 {
                    fx += min(max(0.5 * (l - r) / denom, -0.5), 0.5)
                }
            }
            if by > 0 && by < heatHeight - 1 {
                let u = Double(heat[base + (by - 1) * heatWidth + bx])
                let m = Double(heat[base + by * heatWidth + bx])
                let d = Double(heat[base + (by + 1) * heatWidth + bx])
                let denom = u - 2 * m + d
                if abs(denom) > 1e-6 {
                    fy += min(max(0.5 * (u - d) / denom, -0.5), 0.5)
                }
            }
            corners.append(SIMD2(
                fx * Double(inputWidth) / Double(heatWidth),
                fy * Double(inputHeight) / Double(heatHeight)))
            peaks.append(best)
        }
        return (corners, peaks)
    }

    /// World corners on the z = 0 plane, matching the worker's frame.
    static let worldCorners: [SIMD2<Double>] = [
        SIMD2(-1.370, 0.7625), SIMD2(-1.370, -0.7625),
        SIMD2(1.370, -0.7625), SIMD2(1.370, 0.7625),
    ]

    /// Four-point homography world plane -> image, via the 8x8 linear
    /// system with h9 = 1 (degenerate h9 never arises from a physical
    /// table view). Returns nil on a singular system.
    static func homography(image: [SIMD2<Double>]) -> [Double]? {
        var a = [[Double]](repeating: [Double](repeating: 0, count: 9),
                           count: 8)
        for i in 0..<4 {
            let X = worldCorners[i].x, Y = worldCorners[i].y
            let u = image[i].x, v = image[i].y
            a[2 * i] = [X, Y, 1, 0, 0, 0, -u * X, -u * Y, u]
            a[2 * i + 1] = [0, 0, 0, X, Y, 1, -v * X, -v * Y, v]
        }
        // Gaussian elimination with partial pivoting on the 8x9 tableau.
        for column in 0..<8 {
            var pivot = column
            for row in (column + 1)..<8
            where abs(a[row][column]) > abs(a[pivot][column]) {
                pivot = row
            }
            if abs(a[pivot][column]) < 1e-12 { return nil }
            a.swapAt(column, pivot)
            let lead = a[column][column]
            for k in column..<9 { a[column][k] /= lead }
            for row in 0..<8 where row != column {
                let factor = a[row][column]
                if factor == 0 { continue }
                for k in column..<9 { a[row][k] -= factor * a[column][k] }
            }
        }
        return [a[0][8], a[1][8], a[2][8],
                a[3][8], a[4][8], a[5][8],
                a[6][8], a[7][8], 1.0]
    }

    struct Stance {
        let behind: Double     // metres behind the near end line
        let lateral: Double    // signed; negative = player's right side
        let height: Double     // above the table surface
        /// How far K⁻¹H's first two columns are from an orthonormal pair
        /// (0 = a perfect pinhole view of a real 1.525 x 2.740 rectangle).
        let residual: Double
    }

    /// The physical-plausibility gate. Known focal (from the live lens)
    /// makes the decomposition overdetermined: predicted quads that are
    /// not a real table seen by this camera fail on residual or land the
    /// camera somewhere no one stands. Mirrors worker/mine_record_poses.
    static func stance(corners: [SIMD2<Double>], focal: Double,
                       cx: Double, cy: Double) -> Stance? {
        guard corners.count == 4,
              let h = homography(image: corners) else { return nil }
        // M = K⁻¹ H, computed column-wise.
        var m = [Double](repeating: 0, count: 9)
        for column in 0..<3 {
            let h0 = h[column], h1 = h[3 + column], h2 = h[6 + column]
            m[column] = (h0 - cx * h2) / focal
            m[3 + column] = (h1 - cy * h2) / focal
            m[6 + column] = h2
        }
        for sign in [1.0, -1.0] {
            let c0 = SIMD3(sign * m[0], sign * m[3], sign * m[6])
            let c1 = SIMD3(sign * m[1], sign * m[4], sign * m[7])
            let t = SIMD3(sign * m[2], sign * m[5], sign * m[8])
            let n0 = simd_length(c0), n1 = simd_length(c1)
            guard n0 > 1e-9, n1 > 1e-9 else { continue }
            let scale = 2.0 / (n0 + n1)
            let r0 = c0 * scale, r1 = c1 * scale
            // Orthonormality residual before any correction.
            let residual = abs(simd_length(r0) - 1)
                + abs(simd_length(r1) - 1)
                + abs(simd_dot(simd_normalize(r0), simd_normalize(r1)))
            let r2 = simd_cross(simd_normalize(r0), simd_normalize(r1))
            let rows = simd_double3x3(rows: [
                SIMD3(r0.x, r1.x, r2.x) / simd_length(SIMD3(r0.x, r1.x, r2.x)),
                SIMD3(r0.y, r1.y, r2.y) / simd_length(SIMD3(r0.y, r1.y, r2.y)),
                SIMD3(r0.z, r1.z, r2.z) / simd_length(SIMD3(r0.z, r1.z, r2.z)),
            ])
            let centre = -(rows.transpose * (t * scale))
            guard centre.z > 0 else { continue }
            return Stance(behind: -1.370 - centre.x,
                          lateral: centre.y,
                          height: centre.z,
                          residual: residual)
        }
        return nil
    }

    /// Zhang's two single-plane constraints, each solved for a focal
    /// length. Port of mine_record_poses.focal_candidates, and NOT used
    /// to grant anything: the 2026-08-25 focal-recovery study measured
    /// that a single table quad is too little signal to trust a solved
    /// lens (median 22% disagreement between the two answers on
    /// hand-marked corners, and the solved-lens gate waved through half
    /// the end-for-end rotations the current gate catches). What a
    /// solved lens IS good for is explaining a refusal: a steady
    /// sighting the known lens rejects but SOME lens explains cleanly is
    /// the signature of footage on a screen.
    static func focalCandidates(image corners: [SIMD2<Double>],
                                cx: Double, cy: Double) -> [Double] {
        guard let h = homography(image: corners) else { return [] }
        // Column j of H is (h[j], h[3+j], h[6+j]).
        var c1 = (h[0], h[3], h[6])
        var c2 = (h[1], h[4], h[7])
        c1.0 -= cx * c1.2; c1.1 -= cy * c1.2
        c2.0 -= cx * c2.2; c2.1 -= cy * c2.2
        let numerators = (c1.0 * c2.0 + c1.1 * c2.1,
                          c1.0 * c1.0 + c1.1 * c1.1
                              - c2.0 * c2.0 - c2.1 * c2.1)
        let denominators = (c1.2 * c2.2,
                            c1.2 * c1.2 - c2.2 * c2.2)
        var out: [Double] = []
        for (n, d) in [(numerators.0, denominators.0),
                       (numerators.1, denominators.1)] {
            guard abs(d) > 1e-12 else { continue }
            let value = -n / d
            if value > 0 { out.append(value.squareRoot()) }
        }
        return out
    }

    /// Does ANY plausible lens explain this quad as a real table seen by
    /// a camera somewhere a person could stand? True alongside a
    /// known-lens refusal reads as "the geometry is fine, the lens is
    /// wrong" — a screen, not garbage.
    static func fitsSomeLens(image corners: [SIMD2<Double>],
                             cx: Double, cy: Double,
                             imageWidth: Double) -> Bool {
        for focal in focalCandidates(image: corners, cx: cx, cy: cy) {
            let fov = 2 * atan(imageWidth / (2 * focal)) * 180 / .pi
            guard (40...110).contains(fov),
                  let s = stance(corners: corners, focal: focal,
                                 cx: cx, cy: cy),
                  s.behind > 0.2, s.behind < 9,
                  s.height > 0.15, s.height < 3,
                  abs(s.lateral) < 8 else { continue }
            return true
        }
        return false
    }

    enum Verdict: Equatable {
        case good
        case adjust(String)
        case implausible
    }

    /// How far round from the end of the table this camera stands, in
    /// degrees off the long axis measured at the table's centre.
    ///
    /// The single strongest thing we can measure about a camera position.
    /// Against 61 hand-marked matches it tracks foreshortening at r =
    /// 0.89, and foreshortening is what decides whether the serve is
    /// readable at all: the matches whose serve detector runs at ~90% sit
    /// at 0.73 and up, the three that collapse to 6-15% sit at 0.25-0.32.
    static func axisDegrees(for stance: Stance) -> Double {
        atan2(abs(stance.lateral), stance.behind + 1.370) * 180 / .pi
    }

    /// The envelope verdict, worded for the ghost's caption. One cue at a
    /// time, most impactful first.
    ///
    /// `expectedSide` is "right" or "left" in the player's own terms, or
    /// nil to say nothing about sides. It comes from the profile's
    /// handedness: a right-hander serving pendulum stands near their
    /// backhand corner, so the camera belongs on the forehand side — the
    /// side their own body cannot swing across. Same sentence the upload
    /// page's camera guide has carried all along; this is it said live.
    static func verdict(for stance: Stance,
                        expectedSide: String? = nil) -> Verdict {
        guard stance.residual < 0.35,
              stance.behind > 0.2, stance.behind < 9,
              stance.height > 0.15, stance.height < 3,
              abs(stance.lateral) < 8 else { return .implausible }
        // First, before everything: walking round to the correct side and
        // THEN fixing angle and distance is the only order that does not
        // waste the user's steps. Negative lateral is the player's right
        // side — the camera looks the same way the near player faces, so
        // camera-left is the player's left.
        if let expectedSide {
            let onRight = stance.lateral < 0
            if onRight != (expectedSide == "right") {
                return .adjust("Put the camera on your forehand side")
            }
        }
        // Before the distance cues, deliberately. Told to step back from a
        // shallow angle, a user walks further round the END of the table
        // and makes the angle worse — the two cues fight, and the one that
        // decides whether the serve can be read should win.
        //
        // 33 degrees, not the 37.5 that marks the proven-good band. 37.5
        // would nag two of our four venues permanently: Westchester's
        // median camera sits at 0.55 foreshortening and LYTTC's at 0.63,
        // and matches at those angles do process. What 33 does is pull the
        // genuinely unreadable region out of the green light — the worst
        // pose this gate used to call good sat at 0.22, more end-on than
        // any match Adil has rejected as unusable. Raise it when the band
        // between 0.32 and 0.73 has actually been measured.
        if axisDegrees(for: stance) < 33 {
            return .adjust("Move further round the side of the table")
        }
        if stance.behind < behindRange.lowerBound {
            return .adjust("Step back a little")
        }
        if stance.behind > behindRange.upperBound {
            return .adjust("Come a little closer")
        }
        if stance.height < heightRange.lowerBound {
            return .adjust("Raise the phone")
        }
        if stance.height > heightRange.upperBound {
            return .adjust("Lower the phone")
        }
        // The old "too close to the centre line" cue is gone: it measured
        // metres where the thing that matters is an angle, so it passed a
        // camera 1.2 m out at 1.5 m back (39 degrees, fine) and the same
        // 1.2 m out at 4 m back (12 degrees, unusable) identically.
        if abs(stance.lateral) > lateralRange.upperBound {
            return .adjust("Move toward the table")
        }
        return .good
    }
}

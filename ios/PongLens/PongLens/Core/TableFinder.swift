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

    enum Verdict: Equatable {
        case good
        case adjust(String)
        case implausible
    }

    /// The envelope verdict, worded for the ghost's caption. One cue at a
    /// time, most impactful first.
    static func verdict(for stance: Stance) -> Verdict {
        guard stance.residual < 0.35,
              stance.behind > 0.2, stance.behind < 9,
              stance.height > 0.15, stance.height < 3,
              abs(stance.lateral) < 8 else { return .implausible }
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
        if abs(stance.lateral) < lateralRange.lowerBound {
            return .adjust("Move toward the corner")
        }
        if abs(stance.lateral) > lateralRange.upperBound {
            return .adjust("Move toward the table")
        }
        return .good
    }
}

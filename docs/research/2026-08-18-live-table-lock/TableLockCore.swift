import Foundation
import CoreGraphics
import simd

/// The pure half of the live table lock: geometry, gradient scoring, and
/// the corridor search. No UIKit, no AVFoundation — the exact same file is
/// compiled into a macOS harness and measured against the hand-marked
/// corpus (docs/research/2026-08-18-live-table-lock-measurements.md), so
/// what ships is what was measured. Keep it that way.
///
/// World frame as everywhere else: x along the table length (near end at
/// -1.370 m), y across the width (positive toward the camera-left corner),
/// z up from the table surface.

enum TableGeometry {
    static let length = 2.740
    static let width = 1.525
    static let netHeight = 0.1525
    static let netOverhang = 0.1525
}

/// The proven-good camera envelope, mined from 61 calibrated matches
/// (worker/mine_record_poses.py). Heights are above the table surface.
enum GhostPose {
    static let behind = 2.82
    static let lateral = 2.74
    static let height = 0.90
    static let behindRange = 1.49...4.09
    static let target = SIMD3<Double>(0, 0, 0.4)
    static let fallbackFOV = 66.0
}

/// A candidate camera stance: where the phone might be standing right now.
/// `lateral` is signed — negative stands on the player's right side.
struct LockHypothesis {
    var behind: Double
    var lateral: Double
    var height: Double
    var targetY: Double
    var targetZ: Double

    var position: SIMD3<Double> {
        SIMD3(-TableGeometry.length / 2 - behind, lateral, height)
    }

    var target: SIMD3<Double> { SIMD3(0, targetY, targetZ) }
}

/// A pinhole camera over the table's world frame. Mirrors the projection
/// TableGhost draws with, so a locked hypothesis re-renders identically.
struct PinholeCamera {
    let position: SIMD3<Double>
    private let right: SIMD3<Double>
    private let down: SIMD3<Double>
    private let forward: SIMD3<Double>
    private let focal: Double
    private let centre: CGPoint

    init(position: SIMD3<Double>, target: SIMD3<Double>,
         fovDegrees: Double, size: CGSize) {
        self.position = position
        forward = simd_normalize(target - position)
        right = simd_normalize(simd_cross(forward, SIMD3<Double>(0, 0, 1)))
        down = simd_cross(forward, right)
        focal = Double(size.width) / 2 / tan(fovDegrees * .pi / 360)
        centre = CGPoint(x: size.width / 2, y: size.height / 2)
    }

    init(_ h: LockHypothesis, fovDegrees: Double, size: CGSize) {
        self.init(position: h.position, target: h.target,
                  fovDegrees: fovDegrees, size: size)
    }

    func project(_ world: SIMD3<Double>) -> CGPoint? {
        let v = world - position
        let z = simd_dot(v, forward)
        guard z > 0.05 else { return nil }
        return CGPoint(
            x: centre.x + focal * simd_dot(v, right) / z,
            y: centre.y + focal * simd_dot(v, down) / z
        )
    }
}

enum TableOutline {
    /// Corners in canonical order: A near-left, B near-right, C far-right,
    /// D far-left.
    static let corners: [SIMD3<Double>] = {
        let l = TableGeometry.length / 2, w = TableGeometry.width / 2
        return [SIMD3(-l, w, 0), SIMD3(-l, -w, 0),
                SIMD3(l, -w, 0), SIMD3(l, w, 0)]
    }()

    /// The five scored segments: four table edges plus the line across the
    /// surface under the net — identical to the validated offline harness.
    static let segments: [(SIMD3<Double>, SIMD3<Double>)] = {
        let c = corners
        let leftMid = (c[0] + c[3]) / 2
        let rightMid = (c[1] + c[2]) / 2
        return [(c[0], c[1]), (c[1], c[2]), (c[2], c[3]), (c[3], c[0]),
                (leftMid, rightMid)]
    }()
}

/// Gradient magnitudes of a downscaled grayscale frame, plus the Sobel
/// that builds them. Nearest-neighbour sampling, matching the harness.
struct GradientMap {
    let width: Int
    let height: Int
    let values: [Float]

    init(gray: [UInt8], width: Int, height: Int) {
        self.width = width
        self.height = height
        var out = [Float](repeating: 0, count: width * height)
        gray.withUnsafeBufferPointer { g in
            for y in 1..<(height - 1) {
                let up = (y - 1) * width, mid = y * width, dn = (y + 1) * width
                for x in 1..<(width - 1) {
                    let a = Float(g[up + x - 1]), b = Float(g[up + x]),
                        c = Float(g[up + x + 1])
                    let d = Float(g[mid + x - 1]), f = Float(g[mid + x + 1])
                    let gg = Float(g[dn + x - 1]), h = Float(g[dn + x]),
                        i = Float(g[dn + x + 1])
                    let gx = (c + 2 * f + i) - (a + 2 * d + gg)
                    let gy = (gg + 2 * h + i) - (a + 2 * b + c)
                    out[mid + x] = (gx * gx + gy * gy).squareRoot()
                }
            }
        }
        values = out
    }

    func sample(_ p: CGPoint) -> Float? {
        let x = Int(p.x.rounded()), y = Int(p.y.rounded())
        guard x >= 0, x < width, y >= 0, y < height else { return nil }
        return values[y * width + x]
    }
}

/// Mean gradient magnitude under the projected outline, optionally slid by
/// an image-space offset (the matched null below). Hypotheses whose
/// outline mostly leaves the frame are meaningless — refuse them.
func outlineScore(_ camera: PinholeCamera, in map: GradientMap,
                  offset: CGPoint = .zero,
                  samplesPerEdge: Int = 32) -> Double? {
    var total: Double = 0
    var inside = 0, all = 0
    for (p, q) in TableOutline.segments {
        for i in 0..<samplesPerEdge {
            let t = 0.02 + 0.96 * Double(i) / Double(samplesPerEdge - 1)
            all += 1
            guard var point = camera.project(p + (q - p) * t)
            else { continue }
            point.x += offset.x
            point.y += offset.y
            guard let value = map.sample(point) else { continue }
            total += Double(value)
            inside += 1
        }
    }
    guard inside > all * 3 / 4 else { return nil }
    return total / Double(inside)
}

/// Peak height over a matched null: the same outline slid ±5% of the
/// diagonal in four directions. The measured basin puts a true alignment
/// around 3x its own slid variants; incidental gradient ridges rarely
/// sustain that across every segment at once.
func matchedRatio(_ camera: PinholeCamera, in map: GradientMap) -> Double? {
    guard let peak = outlineScore(camera, in: map) else { return nil }
    let d = 0.05 * Double(map.width * map.width + map.height * map.height)
        .squareRoot()
    var nulls: [Double] = []
    for (dx, dy) in [(d, 0.0), (-d, 0.0), (0.0, d), (0.0, -d)] {
        if let s = outlineScore(camera, in: map,
                                offset: CGPoint(x: dx, y: dy)) {
            nulls.append(s)
        }
    }
    guard nulls.count >= 3 else { return nil }
    let null = nulls.reduce(0, +) / Double(nulls.count)
    guard null > 0 else { return nil }
    return peak / null
}

enum NeighborhoodSearch {
    /// Refine within a tight neighborhood of a seed stance — the app's
    /// real question: the ghost says the user should be HERE; does the
    /// image agree, and precisely where? Wide-field finding measured out
    /// as unreliable (38 false corridor locks on the corpus), so the
    /// search never strays from the seed, and the verdict comes from the
    /// matched-null ratio, not from beating other corridor cells.
    static func refine(around seed: LockHypothesis, in map: GradientMap,
                       fovDegrees: Double, size: CGSize) -> LockCandidate? {
        var top: (LockHypothesis, Double)?
        for db in [-0.3, -0.15, 0.0, 0.15, 0.3] {
            for dl in [-0.3, 0.0, 0.3] {
                for dh in [-0.12, 0.0, 0.12] {
                    for ty in [-0.2, 0.0, 0.2] {
                        for tz in [0.25, 0.4, 0.55] {
                            var h = seed
                            h.behind += db
                            h.lateral += dl
                            h.height = max(0.3, h.height + dh)
                            h.targetY = ty
                            h.targetZ = tz
                            guard let s = outlineScore(
                                PinholeCamera(h, fovDegrees: fovDegrees,
                                              size: size),
                                in: map) else { continue }
                            if top == nil || s > top!.1 { top = (h, s) }
                        }
                    }
                }
            }
        }
        guard let (winner, score) = top else { return nil }
        let camera = PinholeCamera(winner, fovDegrees: fovDegrees, size: size)
        guard let ratio = matchedRatio(camera, in: map) else { return nil }
        let corners = TableOutline.corners.compactMap(camera.project)
        guard corners.count == 4 else { return nil }
        return LockCandidate(hypothesis: winner, score: score,
                             ratio: ratio, corners: corners)
    }
}

struct LockCandidate {
    let hypothesis: LockHypothesis
    let score: Double
    /// Peak height over the corridor's median score. The measured true
    /// peak sits 2-3x above the off-peak plateau; below ~1.6 there is no
    /// basin worth trusting.
    let ratio: Double
    let corners: [CGPoint]
}

enum CorridorSearch {
    /// Coarse sweep along the proven corridor on both sides, then a local
    /// refinement around the best cell. Returns nil rather than guessing
    /// when no hypothesis stands clear of the corridor's median — the
    /// failure mode is "no lock", never "wrong lock".
    static func run(in map: GradientMap, fovDegrees: Double,
                    size: CGSize) -> LockCandidate? {
        var coarseScores: [Double] = []
        var best: (LockHypothesis, Double)?
        for side in [-1.0, 1.0] {
            for step in 0...10 {
                let behind = GhostPose.behindRange.lowerBound
                    + Double(step) / 10
                    * (GhostPose.behindRange.upperBound
                       - GhostPose.behindRange.lowerBound)
                let h = LockHypothesis(
                    behind: behind, lateral: side * GhostPose.lateral,
                    height: GhostPose.height,
                    targetY: 0, targetZ: GhostPose.target.z)
                guard let s = outlineScore(
                    PinholeCamera(h, fovDegrees: fovDegrees, size: size),
                    in: map) else { continue }
                coarseScores.append(s)
                if best == nil || s > best!.1 { best = (h, s) }
            }
        }
        guard let (seed, _) = best, coarseScores.count >= 8 else { return nil }
        let median = coarseScores.sorted()[coarseScores.count / 2]
        guard median > 0 else { return nil }

        var top: (LockHypothesis, Double)?
        for db in [-0.3, -0.15, 0, 0.15, 0.3] {
            for dl in [-0.45, 0.0, 0.45] {
                for dh in [-0.15, 0.0, 0.15] {
                    for ty in [-0.25, 0.0, 0.25] {
                        for tz in [0.3, 0.45, 0.6] {
                            var h = seed
                            h.behind = min(max(
                                h.behind + db,
                                GhostPose.behindRange.lowerBound),
                                GhostPose.behindRange.upperBound)
                            h.lateral += dl
                            h.height = max(0.3, h.height + dh)
                            h.targetY = ty
                            h.targetZ = tz
                            guard let s = outlineScore(
                                PinholeCamera(h, fovDegrees: fovDegrees,
                                              size: size),
                                in: map) else { continue }
                            if top == nil || s > top!.1 { top = (h, s) }
                        }
                    }
                }
            }
        }
        guard let (winner, score) = top else { return nil }
        let camera = PinholeCamera(winner, fovDegrees: fovDegrees, size: size)
        let corners = TableOutline.corners.compactMap(camera.project)
        guard corners.count == 4 else { return nil }
        return LockCandidate(hypothesis: winner, score: score,
                             ratio: score / median, corners: corners)
    }
}

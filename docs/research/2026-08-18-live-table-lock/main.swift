import Foundation
import CoreGraphics
import ImageIO

// The app's real question, measured: seeded at the TRUE stance (user has
// aligned the ghost), does NeighborhoodSearch converge and fire? Seeded at
// WRONG stances (user not aligned), does it stay quiet? Compile:
//   swiftc -O TableLockCore.swift main.swift -o lockcheck

struct Pose: Codable { let x: Double; let y: Double; let z: Double }
struct Row: Codable {
    let match: String
    let frame: String
    let venue: String
    let sourceWidth: Int
    let sourceHeight: Int
    let focal: Double
    let corners: [[Double]]
    let pose: Pose
}

func grayscale(_ path: String, targetWidth: Int) -> ([UInt8], Int, Int)? {
    guard let src = CGImageSourceCreateWithURL(
            URL(fileURLWithPath: path) as CFURL, nil),
          let img = CGImageSourceCreateImageAtIndex(src, 0, nil)
    else { return nil }
    let scale = Double(targetWidth) / Double(img.width)
    let w = targetWidth, h = Int((Double(img.height) * scale).rounded())
    var pixels = [UInt8](repeating: 0, count: w * h)
    let ok: Bool = pixels.withUnsafeMutableBytes { buf in
        guard let ctx = CGContext(
            data: buf.baseAddress, width: w, height: h,
            bitsPerComponent: 8, bytesPerRow: w,
            space: CGColorSpaceCreateDeviceGray(),
            bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return false }
        ctx.interpolationQuality = .medium
        ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
        return true
    }
    return ok ? (pixels, w, h) : nil
}

let threshold = Double(CommandLine.arguments.count > 1
    ? Double(CommandLine.arguments[1]) ?? 1.8 : 1.8)
let scratch = URL(fileURLWithPath: CommandLine.arguments[0])
    .deletingLastPathComponent()
let rows = try! JSONDecoder().decode(
    [Row].self,
    from: Data(contentsOf: scratch.appendingPathComponent("lock_manifest.json")))

var converged = 0, missedFire = 0, badSnap = 0
var falseFires = 0, wrongSeeds = 0
var lines: [String] = []

for row in rows {
    guard let (gray, w, h) = grayscale(row.frame, targetWidth: 480) else {
        continue
    }
    let map = GradientMap(gray: gray, width: w, height: h)
    let hfov = 2 * atan(Double(row.sourceWidth) / (2 * row.focal)) * 180 / .pi
    let size = CGSize(width: w, height: h)
    let scale = Double(w) / Double(row.sourceWidth)
    let truth = row.corners.map { CGPoint(x: $0[0] * scale, y: $0[1] * scale) }
    let diag = Double(w * w + h * h).squareRoot()

    let trueSeed = LockHypothesis(
        behind: -TableGeometry.length / 2 - row.pose.x,
        lateral: row.pose.y, height: row.pose.z,
        targetY: 0, targetZ: GhostPose.target.z)

    // Aligned case: seed at truth.
    if let c = NeighborhoodSearch.refine(
        around: trueSeed, in: map, fovDegrees: hfov, size: size) {
        let err = zip(c.corners, truth)
            .map { hypot($0.x - $1.x, $0.y - $1.y) }
            .reduce(0, +) / 4 / diag
        if c.ratio >= threshold && err < 0.03 {
            converged += 1
        } else if c.ratio >= threshold {
            badSnap += 1
            lines.append(String(format: "bad snap  %@ %@ err %.1f%% ratio %.1f",
                                String(row.match.prefix(8)), row.venue,
                                err * 100, c.ratio))
        } else {
            missedFire += 1
            lines.append(String(format: "quiet     %@ %@ ratio %.1f err %.1f%%",
                                String(row.match.prefix(8)), row.venue,
                                c.ratio, err * 100))
        }
    } else {
        missedFire += 1
        lines.append("no result \(row.match.prefix(8)) \(row.venue)")
    }

    // Misaligned case: seeds a metre off in stance — the ghost is where
    // the user is NOT. Any fire here is a false green light.
    for wrong in [
        LockHypothesis(behind: trueSeed.behind + 1.0,
                       lateral: trueSeed.lateral, height: trueSeed.height,
                       targetY: 0, targetZ: GhostPose.target.z),
        LockHypothesis(behind: max(0.6, trueSeed.behind - 1.0),
                       lateral: trueSeed.lateral + 1.0,
                       height: trueSeed.height,
                       targetY: 0, targetZ: GhostPose.target.z),
        LockHypothesis(behind: trueSeed.behind,
                       lateral: -trueSeed.lateral, height: trueSeed.height,
                       targetY: 0, targetZ: GhostPose.target.z),
    ] {
        wrongSeeds += 1
        if let c = NeighborhoodSearch.refine(
            around: wrong, in: map, fovDegrees: hfov, size: size),
            c.ratio >= threshold {
            let err = zip(c.corners, truth)
                .map { hypot($0.x - $1.x, $0.y - $1.y) }
                .reduce(0, +) / 4 / diag
            if err > 0.04 { falseFires += 1 }
        }
    }
}

print("threshold \(threshold)")
print("aligned:    converged \(converged), quiet \(missedFire), " +
      "bad snap \(badSnap)  of \(rows.count)")
print("misaligned: false fires \(falseFires) of \(wrongSeeds) wrong seeds")
for line in lines.prefix(20) { print("  " + line) }

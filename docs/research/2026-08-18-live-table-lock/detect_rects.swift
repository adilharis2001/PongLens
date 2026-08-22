import Foundation
import Vision
import AppKit

// detect_rects <image> <minAspect> <quadTolerance> <minConfidence> <maxObs>
// Prints detected quads as JSON in image pixel coordinates (origin top-left).
let args = CommandLine.arguments
let path = args[1]
let minAspect = Float(args.count > 2 ? args[2] : "0.15") ?? 0.15
let quadTol = Float(args.count > 3 ? args[3] : "30") ?? 30
let minConf = Float(args.count > 4 ? args[4] : "0.2") ?? 0.2
let maxObs = Int(args.count > 5 ? args[5] : "10") ?? 10

guard let img = NSImage(contentsOfFile: path),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("[]")
    exit(0)
}

let request = VNDetectRectanglesRequest()
request.minimumAspectRatio = minAspect
request.maximumAspectRatio = 1.0
request.quadratureTolerance = quadTol
request.minimumConfidence = minConf
request.maximumObservations = maxObs
request.minimumSize = 0.1

let handler = VNImageRequestHandler(cgImage: cg, options: [:])
try? handler.perform([request])

let W = Double(cg.width), H = Double(cg.height)
var out: [[String: Any]] = []
for obs in request.results ?? [] {
    func px(_ p: CGPoint) -> [Double] { [Double(p.x) * W, (1 - Double(p.y)) * H] }
    out.append([
        "confidence": Double(obs.confidence),
        "bl": px(obs.bottomLeft), "br": px(obs.bottomRight),
        "tr": px(obs.topRight), "tl": px(obs.topLeft),
    ])
}
let data = try! JSONSerialization.data(withJSONObject: out)
print(String(data: data, encoding: .utf8)!)

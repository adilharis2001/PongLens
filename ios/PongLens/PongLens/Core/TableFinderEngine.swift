import Foundation
import AVFoundation
import CoreImage
import CoreML

/// The live half of the table check: preview frames in, a verdict out.
///
/// The model reads the recorder's own preview (no second camera session),
/// the geometry gate rejects any prediction that implies a camera nobody
/// could stand at, and nothing is believed until three consecutive frames
/// agree. The failure mode is silence: no confident find means the ghost
/// behaves exactly as it did before this engine existed. During recording
/// the cadence drops to a slow drift watch that only ever acts on a
/// confident CONTRADICTING detection — absence means players are in the
/// way, which is not evidence the tripod moved.
///
/// Threading: `ingest` runs synchronously on the recorder's serial tap
/// queue (throttle, preprocess, predict), and only the settled verdict
/// hops to the main actor. The nonisolated(unsafe) fields below are
/// touched exclusively from that one serial queue, or written once from
/// the main actor before frames flow.
@Observable
final class TableFinderEngine {

    enum State: Equatable {
        case searching
        case adjust(String)
        /// Corners in model-input pixels, canonical A, B, C, D.
        case good([SIMD2<Double>])
    }

    private(set) var state: State = .searching
    private(set) var drifted = false

    /// Set true once recording starts: cadence drops, verdicts freeze,
    /// and the engine only watches for drift against the locked corners.
    var recording = false {
        didSet {
            if recording, case .good(let corners) = state {
                lockedCorners = corners
            }
            if !recording { drifted = false; lockedCorners = nil }
            recordingMirror = recording
        }
    }

    /// Horizontal field of view of the live lens, degrees; the screen
    /// sets it once the session answers. The gate needs the real focal.
    var fovDegrees: Double = 66 {
        didSet { fovMirror = fovDegrees }
    }

    // Tap-queue state (serial access only; see the threading note).
    private nonisolated(unsafe) var recordingMirror = false
    private nonisolated(unsafe) var fovMirror: Double = 66
    private nonisolated(unsafe) var lastRun: TimeInterval = 0
    private nonisolated(unsafe) var recent: [[SIMD2<Double>]] = []
    private let model: MLModel
    private let context = CIContext(options: [.cacheIntermediates: false])

    // Main-actor state.
    private var lockedCorners: [SIMD2<Double>]?
    private var driftStrikes = 0

    init?() {
        // The .mlpackage compiles into the bundle as TableCorners.mlmodelc.
        guard let url = Bundle.main.url(forResource: "TableCorners",
                                        withExtension: "mlmodelc"),
              let model = try? MLModel(contentsOf: url) else { return nil }
        self.model = model
    }

    /// One line for the theme gallery: does the bundled model load and
    /// answer, and how fast? Runs a zero-frame prediction, nothing more.
    static func selfTest() -> String {
        guard let engine = TableFinderEngine() else {
            return "Model missing from the bundle"
        }
        guard let input = try? MLMultiArray(
            shape: [1, 3,
                    NSNumber(value: TableFinderCore.inputHeight),
                    NSNumber(value: TableFinderCore.inputWidth)],
            dataType: .float32),
            let features = try? MLDictionaryFeatureProvider(
                dictionary: ["frame": MLFeatureValue(multiArray: input)])
        else { return "Model loaded; input failed" }
        let start = Date()
        guard (try? engine.model.prediction(from: features)) != nil else {
            return "Model loaded; prediction failed"
        }
        let ms = Date().timeIntervalSince(start) * 1000
        return String(format: "Model loaded · prediction OK · %.0f ms", ms)
    }

    /// Called from the recorder's serial tap queue with upright BGRA
    /// frames. Synchronous by design: the throttle keeps the duty cycle
    /// tiny, and late frames are discarded upstream.
    nonisolated func ingest(_ pixelBuffer: CVPixelBuffer) {
        let now = ProcessInfo.processInfo.systemUptime
        let interval: TimeInterval = recordingMirror ? 2.0 : 0.4
        guard now - lastRun >= interval else { return }
        lastRun = now

        guard let input = Self.modelInput(from: pixelBuffer,
                                          context: context) else { return }
        let corners = predict(input)
        let verdictPair = corners.flatMap { found -> (State, [SIMD2<Double>])? in
            let focal = Double(TableFinderCore.inputWidth) / 2
                / tan(fovMirror * .pi / 360)
            guard let stance = TableFinderCore.stance(
                corners: found, focal: focal,
                cx: Double(TableFinderCore.inputWidth) / 2,
                cy: Double(TableFinderCore.inputHeight) / 2) else {
                return nil
            }
            switch TableFinderCore.verdict(for: stance) {
            case .good: return (.good(found), found)
            case .adjust(let cue): return (.adjust(cue), found)
            case .implausible: return nil
            }
        }

        // Three consecutive agreeing frames flip the state; anything
        // else decays toward searching.
        let settled: State?
        if let (candidate, found) = verdictPair {
            if let previous = recent.last, !Self.agrees(previous, found) {
                recent.removeAll()
            }
            recent.append(found)
            if recent.count > 3 { recent.removeFirst() }
            settled = recent.count == 3 ? candidate : nil
        } else {
            recent.removeAll()
            settled = .searching
        }

        let detection = corners
        Task { @MainActor in
            if self.recording {
                self.watchDrift(detection)
            } else if let settled {
                if self.state != settled { self.state = settled }
            } else if verdictPair == nil, self.state != .searching {
                self.state = .searching
            }
        }
    }

    private nonisolated func predict(_ input: MLMultiArray) -> [SIMD2<Double>]? {
        guard let features = try? MLDictionaryFeatureProvider(
                dictionary: ["frame": MLFeatureValue(multiArray: input)]),
              let output = try? model.prediction(from: features),
              let heatArray = output.featureValue(for: "heatmaps")?
                .multiArrayValue else { return nil }
        var heat = [Float](repeating: 0, count: heatArray.count)
        for i in 0..<heatArray.count { heat[i] = heatArray[i].floatValue }
        let (corners, peaks) = TableFinderCore.decode(heat)
        // A confident corner peaks well above the background noise floor.
        guard peaks.allSatisfy({ $0 > 0.25 }) else { return nil }
        return corners
    }

    private func watchDrift(_ corners: [SIMD2<Double>]?) {
        guard let locked = lockedCorners, let corners else {
            driftStrikes = 0
            return
        }
        if Self.agrees(locked, corners, tolerance: 0.06) {
            driftStrikes = 0
            drifted = false
        } else {
            driftStrikes += 1
            if driftStrikes >= 2 { drifted = true }
        }
    }

    private nonisolated static func agrees(
        _ a: [SIMD2<Double>], _ b: [SIMD2<Double>],
        tolerance: Double = 0.03
    ) -> Bool {
        guard a.count == 4, b.count == 4 else { return false }
        let limit = tolerance * Double(TableFinderCore.inputWidth)
        return zip(a, b).allSatisfy { simd_length($0 - $1) < limit }
    }

    /// Downscale into the model's BGR float tensor. Training fed cv2
    /// arrays, so channel order is B, G, R.
    private nonisolated static func modelInput(
        from pixelBuffer: CVPixelBuffer, context: CIContext
    ) -> MLMultiArray? {
        let w = TableFinderCore.inputWidth, h = TableFinderCore.inputHeight
        let image = CIImage(cvPixelBuffer: pixelBuffer)
        guard image.extent.width > 0, image.extent.height > 0 else {
            return nil
        }
        let scaleX = CGFloat(w) / image.extent.width
        let scaleY = CGFloat(h) / image.extent.height
        let small = image.transformed(
            by: CGAffineTransform(scaleX: scaleX, y: scaleY))
        var rgba = [UInt8](repeating: 0, count: w * h * 4)
        context.render(
            small, toBitmap: &rgba, rowBytes: w * 4,
            bounds: CGRect(x: 0, y: 0, width: w, height: h),
            format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
        guard let array = try? MLMultiArray(
            shape: [1, 3, NSNumber(value: h), NSNumber(value: w)],
            dataType: .float32) else { return nil }
        let plane = w * h
        let pointer = array.dataPointer.bindMemory(to: Float32.self,
                                                   capacity: 3 * plane)
        for i in 0..<plane {
            let px = i * 4
            pointer[i] = Float32(rgba[px + 2]) / 255          // B
            pointer[plane + i] = Float32(rgba[px + 1]) / 255  // G
            pointer[2 * plane + i] = Float32(rgba[px]) / 255  // R
        }
        return array
    }
}

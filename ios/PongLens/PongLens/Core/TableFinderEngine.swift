import Foundation
import AVFoundation
import CoreImage
import CoreML
import ImageIO
import UniformTypeIdentifiers

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
        /// The model can see a table, but nothing has been accepted yet:
        /// the vote is still building, or the gate turned this frame
        /// down. Worth saying out loud — "seen but not trusted" and
        /// "nothing there at all" ask the user for opposite things, and
        /// for one build they looked identical on screen.
        case sighted
        case adjust(String)
        /// Corners in model-input pixels, canonical A, B, C, D.
        case good([SIMD2<Double>])
    }

    private(set) var state: State = .searching
    private(set) var drifted = false
    /// One line of truth for the hidden diagnostics readout: how many
    /// frames the engine has actually processed, what the model said,
    /// and which layer said no. Long-press the ghost to see it.
    private(set) var diag = "no frames yet"
    /// The last corners the model was confident about, whatever the gate
    /// then decided. Drawn only while the long-press readout is up, so a
    /// refusal can be seen rather than inferred — a table found and then
    /// rejected looks exactly like no table at all from the outside.
    private(set) var debugCorners: [SIMD2<Double>]?
    /// The last corners the model was CONFIDENT about, whatever the gate
    /// then decided, held across a few blank frames. Drawn in amber
    /// beside the teal target so the user has something to aim at: the
    /// two quads converging is the instruction, and it needs no words.
    /// Held rather than cleared per frame because a player walking
    /// through a corner is the normal case, and an overlay that strobes
    /// off every time one does reads as broken.
    private(set) var sighting: [SIMD2<Double>]?

    /// Set true once recording starts: cadence drops, verdicts freeze,
    /// and the engine only watches for drift against the locked corners.
    var recording = false {
        didSet {
            if recording, case .good(let corners) = state {
                lockedCorners = corners
            }
            if !recording { drifted = false; lockedCorners = nil }
            sighting = nil
            blankFrames = 0
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
    private nonisolated(unsafe) var framesSeen = 0
    private let model: MLModel
    private let context = CIContext(options: [.cacheIntermediates: false])

    // Main-actor state.
    private var lockedCorners: [SIMD2<Double>]?
    private var driftStrikes = 0
    private var blankFrames = 0

    init?() {
        // The .mlpackage compiles into the bundle as TableCorners.mlmodelc.
        // CPU only, deliberately: the GPU/ANE paths returned an all-zero
        // heatmap for an input the CPU decodes correctly (measured — the
        // simulator's Metal path is the known-flaky one, but a silent
        // zero is the worst possible failure for a feature whose whole
        // job is to refuse rather than guess). The model is ~13 ms on
        // CPU at a 0.4 s cadence, so there is nothing to win by risking
        // a backend that can disagree with the one we validated against.
        let configuration = MLModelConfiguration()
        configuration.computeUnits = .cpuOnly
        guard let url = Bundle.main.url(forResource: "TableCorners",
                                        withExtension: "mlmodelc"),
              let model = try? MLModel(contentsOf: url,
                                       configuration: configuration)
        else { return nil }
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
    /// tiny, and late frames are discarded upstream. `force` bypasses the
    /// throttle for the gallery bench.
    nonisolated func ingest(_ pixelBuffer: CVPixelBuffer, force: Bool = false) {
        let now = ProcessInfo.processInfo.systemUptime
        let interval: TimeInterval = recordingMirror ? 2.0 : 0.4
        guard force || now - lastRun >= interval else { return }
        lastRun = now
        framesSeen += 1
        let frameTag = "f\(framesSeen)"

        guard let input = Self.modelInput(from: pixelBuffer,
                                          context: context) else {
            report(nil, diag: "\(frameTag) preprocess failed")
            return
        }
        // What actually reached the model. A dead input (mean 0) means
        // the pixels never arrived, which looks identical from the
        // outside to a model that simply saw no table.
        let inputText = Self.inputStats(input)
        guard let (corners, peaks) = predict(input) else {
            report(nil, diag: "\(frameTag) \(inputText) model failed")
            return
        }
        let minPeak = peaks.min() ?? 0
        let meanPeak = peaks.reduce(0, +) / Float(max(1, peaks.count))
        let peakText = String(format: "\(inputText) peak min%.2f avg%.2f",
                              minPeak, meanPeak)
        // Confidence is judged on the AVERAGE corner, not the weakest one.
        // Requiring all four to be strong sounds safer and measures worse:
        // on held-out matches it threw away 18% of genuinely correct
        // detections, because a player standing in front of a corner is
        // the normal case, not the exception. Measured over 480 held-out
        // frames, mean > 0.40 accepts more (63% vs 60%) and is right more
        // often when it does (98% vs 97%) than min > 0.25.
        guard meanPeak > 0.40 else {
            // The corners still ride along for the readout: a faint find
            // is worth seeing while debugging, even though it is not
            // worth acting on.
            report(nil, raw: corners,
                   diag: "\(frameTag) \(peakText) — too faint")
            return
        }

        let focal = Double(TableFinderCore.inputWidth) / 2
            / tan(fovMirror * .pi / 360)
        guard let stance = TableFinderCore.stance(
            corners: corners, focal: focal,
            cx: Double(TableFinderCore.inputWidth) / 2,
            cy: Double(TableFinderCore.inputHeight) / 2) else {
            report(nil, sighted: corners, raw: corners,
                   diag: "\(frameTag) \(peakText) — no camera fits")
            return
        }
        let stanceText = String(
            format: "%@ %@ r%.2f behind %.1f lat %.1f h %.2f",
            frameTag, peakText, stance.residual, stance.behind,
            stance.lateral, stance.height)

        let verdict = TableFinderCore.verdict(for: stance)
        if verdict == .implausible {
            report(nil, sighted: corners, raw: corners,
                   diag: "\(stanceText) — gate refused")
            return
        }

        // Three consecutive agreeing frames flip the state; anything
        // else decays toward searching.
        if let previous = recent.last, !Self.agrees(previous, corners) {
            recent.removeAll()
        }
        recent.append(corners)
        if recent.count > 3 { recent.removeFirst() }
        let vote = "vote \(min(recent.count, 3))/3"
        let settled: State?
        if recent.count >= 3 {
            switch verdict {
            case .good: settled = .good(corners)
            case .adjust(let cue): settled = .adjust(cue)
            case .implausible: settled = nil
            }
        } else if recent.count == 2, case .adjust(let cue) = verdict {
            // A movement cue lands one frame earlier than the lock. The
            // two are not equally expensive to get wrong: a premature
            // "step back a little" costs the user a step they can undo
            // by standing still, while a premature green means filming
            // from an angle the pipeline cannot use.
            settled = .adjust(cue)
        } else {
            settled = nil
        }
        report(settled, detection: corners, sighted: corners, raw: corners,
               diag: "\(stanceText) \(vote) → \(label(for: verdict))")
    }

    private nonisolated func label(for verdict: TableFinderCore.Verdict)
        -> String {
        switch verdict {
        case .good: "good"
        case .adjust(let cue): cue.lowercased()
        case .implausible: "refused"
        }
    }

    /// Ship the frame's outcome to the main actor: diagnostics always,
    /// a state flip when the vote settled one, drift while recording.
    ///
    /// The three corner arguments are deliberately separate, because
    /// they answer three different questions. `raw` is whatever the
    /// model returned and is for the readout only. `sighted` cleared the
    /// confidence bar and is safe to draw. `detection` also cleared the
    /// geometry gate and is the only one allowed to move the verdict.
    private nonisolated func report(_ settled: State?,
                                    detection: [SIMD2<Double>]? = nil,
                                    sighted: [SIMD2<Double>]? = nil,
                                    raw: [SIMD2<Double>]? = nil,
                                    diag line: String) {
        if settled == nil, detection == nil {
            recent.removeAll()
        }
        Task { @MainActor in
            self.diag = line
            self.debugCorners = raw
            if let sighted {
                self.sighting = sighted
                self.blankFrames = 0
            } else {
                self.blankFrames += 1
                // Three blank frames at the idle cadence is 1.2 s — long
                // enough to ride out a rally crossing the corner, short
                // enough that a phone turned away goes quiet promptly.
                if self.blankFrames >= 3 { self.sighting = nil }
            }
            if self.recording {
                self.watchDrift(detection)
            } else if let settled {
                if self.state != settled { self.state = settled }
            } else if detection != nil {
                // The gate passed but the vote is still building. Hold
                // the last verdict rather than demoting it — this is the
                // frame-to-frame case, not a loss of the table.
            } else {
                let next: State = self.sighting == nil ? .searching : .sighted
                if self.state != next { self.state = next }
            }
        }
    }

    /// Debug only: write the exact tensor the model saw to Documents as
    /// a PNG, so it can be pulled off the device and looked at. Numbers
    /// can lie about an image; the picture cannot.
    nonisolated func dumpInput(from pixelBuffer: CVPixelBuffer) -> String {
        guard let array = Self.modelInput(from: pixelBuffer,
                                          context: context) else {
            return "preprocess failed"
        }
        let w = TableFinderCore.inputWidth, h = TableFinderCore.inputHeight
        let plane = w * h
        let pointer = array.dataPointer.bindMemory(to: Float32.self,
                                                   capacity: 3 * plane)
        var rgba = [UInt8](repeating: 255, count: plane * 4)
        for i in 0..<plane {
            // Tensor is B, G, R; write it back out as RGBA to look at.
            rgba[i * 4] = UInt8(max(0, min(255, pointer[2 * plane + i] * 255)))
            rgba[i * 4 + 1] = UInt8(max(0, min(255, pointer[plane + i] * 255)))
            rgba[i * 4 + 2] = UInt8(max(0, min(255, pointer[i] * 255)))
        }
        guard let provider = CGDataProvider(data: Data(rgba) as CFData),
              let image = CGImage(
                width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 32,
                bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGBitmapInfo(
                    rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
                provider: provider, decode: nil, shouldInterpolate: false,
                intent: .defaultIntent) else { return "image build failed" }
        let url = FileManager.default.urls(for: .documentDirectory,
                                           in: .userDomainMask)[0]
            .appendingPathComponent("model-input.png")
        guard let destination = CGImageDestinationCreateWithURL(
            url as CFURL, "public.png" as CFString, 1, nil) else {
            return "destination failed"
        }
        CGImageDestinationAddImage(destination, image, nil)
        CGImageDestinationFinalize(destination)
        return "wrote \(url.lastPathComponent)"
    }

    /// Mean and max of the input tensor — the cheapest way to tell a
    /// model that saw no table from a model that saw nothing at all.
    private nonisolated static func inputStats(_ array: MLMultiArray) -> String {
        let count = array.count
        guard count > 0 else { return "in empty" }
        let pointer = array.dataPointer.bindMemory(to: Float32.self,
                                                   capacity: count)
        var total: Float = 0
        var peak: Float = 0
        for i in 0..<count {
            let value = pointer[i]
            total += value
            if value > peak { peak = value }
        }
        return String(format: "in µ%.3f max%.2f", total / Float(count), peak)
    }

    private nonisolated func predict(_ input: MLMultiArray)
        -> ([SIMD2<Double>], [Float])? {
        guard let features = try? MLDictionaryFeatureProvider(
                dictionary: ["frame": MLFeatureValue(multiArray: input)]),
              let output = try? model.prediction(from: features),
              let heatArray = output.featureValue(for: "heatmaps")?
                .multiArrayValue else { return nil }
        var heat = [Float](repeating: 0, count: heatArray.count)
        for i in 0..<heatArray.count { heat[i] = heatArray[i].floatValue }
        return TableFinderCore.decode(heat)
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

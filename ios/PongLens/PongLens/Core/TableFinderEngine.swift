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
        /// Nothing found. The string is a reason worth saying out loud
        /// when there is one — too dark to see, or looking for long
        /// enough that silence starts to read as a hang — and nil when
        /// the placement instruction is still the most useful sentence
        /// on screen. RoomPlan and Object Capture both name their "I
        /// cannot see it" cases (`lowTexture`, `turnOnLight`,
        /// `objectNotDetected`) instead of going quiet, and the reason
        /// they do is that a silent detector and a broken one look the
        /// same from the outside.
        case searching(String?)
        /// The model can see a table, but nothing has been accepted yet:
        /// the vote is still building, or the gate turned this frame
        /// down. Worth saying out loud — "seen but not trusted" and
        /// "nothing there at all" ask the user for opposite things, and
        /// for one build they looked identical on screen. The string is
        /// a framing cue when the table is running off the frame.
        case sighted(String?)
        case adjust(String)
        /// Corners in model-input pixels, canonical A, B, C, D.
        case good([SIMD2<Double>])
    }

    /// Said when the input is nearly black and the model found nothing.
    /// The room is the problem, not the angle, and those need different
    /// answers from the user.
    nonisolated static let darkNote = "Too dark in here to find the table"
    /// Said after ten quiet seconds. The second sentence is the load
    /// bearing one: the check is a convenience and never a gate, and a
    /// search with no stated way out reads as a hang.
    nonisolated static let stalledNote =
        "Still looking for the table. You can record without it."
    /// Said when the gate keeps refusing a steady sighting that some
    /// OTHER lens would explain cleanly — the signature of footage on a
    /// screen, where the geometry belongs to whichever camera filmed the
    /// original. The angle check cannot be honest there, and saying so
    /// beats "checking the angle" forever.
    nonisolated static let screenNote =
        "That looks like a screen, not a real table"
    /// Said when the gate has refused a steady sighting for eight
    /// seconds with no better explanation. A refusal that never says
    /// anything reads as a hang.
    nonisolated static let refusedNote =
        "Can't judge the angle from this view"

    private(set) var state: State = .searching(nil)
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
    /// Degrees round from the end of the table, for the meter under the
    /// caption. Only ever set from frames that cleared the plausibility
    /// gate — an angle from an untrusted stance is fiction — and held
    /// alongside the sighting so the needle does not flicker on frames
    /// the gate turns down.
    private(set) var liveAngle: Double?

    /// Set true once recording starts: cadence drops, verdicts freeze,
    /// and the engine only watches for drift against the locked corners.
    var recording = false {
        didSet {
            if recording, case .good(let corners) = state {
                lockedCorners = corners
            }
            if !recording { drifted = false; lockedCorners = nil }
            sighting = nil
            liveAngle = nil
            quietSince = nil
            recordingMirror = recording
        }
    }

    /// Horizontal field of view of the live lens, degrees; the screen
    /// sets it once the session answers. The gate needs the real focal.
    var fovDegrees: Double = 66 {
        didSet { fovMirror = fovDegrees }
    }

    /// Which side the camera OUGHT to be on, "right" or "left" in the
    /// player's own terms, or nil to say nothing. The screen sets it from
    /// the profile's handedness — and clears it when the user has
    /// deliberately flipped the ghost the other way, because a person who
    /// has chosen a side (filming a left-handed friend, a wall in the
    /// way) should not be nagged about it.
    var expectedSide: String? {
        didSet { expectedSideMirror = expectedSide }
    }

    // Tap-queue state (serial access only; see the threading note).
    private nonisolated(unsafe) var recordingMirror = false
    private nonisolated(unsafe) var fovMirror: Double = 66
    private nonisolated(unsafe) var expectedSideMirror: String?
    private nonisolated(unsafe) var lastRun: TimeInterval = 0
    private nonisolated(unsafe) var recent: [[SIMD2<Double>]] = []
    private nonisolated(unsafe) var framesSeen = 0
    private nonisolated(unsafe) var darkSince: TimeInterval?
    private nonisolated(unsafe) var refusedSince: TimeInterval?
    private nonisolated(unsafe) var screenStreak = 0
    private let model: MLModel
    private let context = CIContext(options: [.cacheIntermediates: false])

    // Main-actor state.
    private var lockedCorners: [SIMD2<Double>]?
    private var driftStrikes = 0
    private var lastSightedAt = Date.distantPast
    /// When the last sighting was lost, so a long silence can say so.
    private var quietSince: Date?
    /// When the caption last moved, for the minimum-dwell rule.
    private var stateChangedAt = Date.distantPast

    init?() {
        // The .mlpackage compiles into the bundle as TableCorners.mlmodelc.
        // CPU only, deliberately: the GPU/ANE paths returned an all-zero
        // heatmap for an input the CPU decodes correctly (measured — the
        // simulator's Metal path is the known-flaky one, but a silent
        // zero is the worst possible failure for a feature whose whole
        // job is to refuse rather than guess). The model is ~13 ms on
        // CPU at a 0.15 s cadence, so there is nothing to win by risking
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
        // Idle cadence 0.15 s, not the original 0.4. The model answers in
        // 13 ms on CPU, so the old rate was caution left over from before
        // that was measured — and it made the whole feature feel slow:
        // three agreeing frames took 1.2 s at 0.4 s a frame. At 0.15 s the
        // vote fills in ~0.45 s for about 9% of one core, setup only.
        let interval: TimeInterval = recordingMirror ? 2.0 : 0.15
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
        let stats = Self.inputStats(input)
        let inputText = stats.text
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
            // A near-black frame and a well-lit frame with no table in it
            // are both "nothing found", and only one of them is the
            // user's to fix. 0.10 against a normally-exposed 0.48 is a
            // frame with almost nothing in it — a covered lens, a phone
            // face down, a hall with the lights off — chosen to fire
            // only when it is obvious rather than tuned on a corpus.
            // A full second of dark before saying so, measured in time
            // rather than frames so the cadence can change without
            // re-tuning this: the first moments after launch, before the
            // camera settles on an exposure, must stay quiet.
            if stats.mean < 0.10 {
                if darkSince == nil { darkSince = now }
            } else {
                darkSince = nil
            }
            let dark = darkSince.map { now - $0 >= 1.0 } ?? false
            // The corners still ride along for the readout: a faint find
            // is worth seeing while debugging, even though it is not
            // worth acting on.
            report(nil, note: dark ? Self.darkNote : nil,
                   raw: corners,
                   diag: "\(frameTag) \(peakText) — too faint")
            refusedSince = nil
            screenStreak = 0
            return
        }
        darkSince = nil

        let focal = Double(TableFinderCore.inputWidth) / 2
            / tan(fovMirror * .pi / 360)
        guard let stance = TableFinderCore.stance(
            corners: corners, focal: focal,
            cx: Double(TableFinderCore.inputWidth) / 2,
            cy: Double(TableFinderCore.inputHeight) / 2) else {
            report(nil, sighted: corners,
                   note: Self.framingCue(corners)
                       ?? refusalNote(corners, now: now),
                   raw: corners,
                   diag: "\(frameTag) \(peakText) — no camera fits")
            return
        }
        let stanceText = String(
            format: "%@ %@ r%.2f behind %.1f lat %.1f h %.2f",
            frameTag, peakText, stance.residual, stance.behind,
            stance.lateral, stance.height)

        let verdict = TableFinderCore.verdict(for: stance,
                                              expectedSide: expectedSideMirror)
        if verdict == .implausible {
            report(nil, sighted: corners,
                   note: Self.framingCue(corners)
                       ?? refusalNote(corners, now: now),
                   raw: corners,
                   diag: "\(stanceText) — gate refused")
            return
        }
        refusedSince = nil
        screenStreak = 0

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
        report(settled, detection: corners, sighted: corners,
               angle: TableFinderCore.axisDegrees(for: stance), raw: corners,
               diag: "\(stanceText) \(vote) → \(label(for: verdict))")
    }

    /// The caption for a sighting the gate keeps refusing. Serial tap
    /// queue only, like the rest of the frame path.
    ///
    /// Three refusals in a row that some solvable lens explains cleanly
    /// name the screen; eight quiet seconds name the stuck state. The
    /// solved lens grants NOTHING — the 2026-08-25 study measured why it
    /// never can — it only chooses between two apologies.
    private nonisolated func refusalNote(_ corners: [SIMD2<Double>],
                                         now: TimeInterval) -> String? {
        if refusedSince == nil { refusedSince = now }
        let w = Double(TableFinderCore.inputWidth)
        let h = Double(TableFinderCore.inputHeight)
        if TableFinderCore.fitsSomeLens(image: corners,
                                        cx: w / 2, cy: h / 2,
                                        imageWidth: w) {
            screenStreak += 1
        } else {
            screenStreak = 0
        }
        if screenStreak >= 3 { return Self.screenNote }
        if now - (refusedSince ?? now) > 8 { return Self.refusedNote }
        return nil
    }

    /// Which way to turn when the model can see the table but the table
    /// is running off the frame. The heatmap's argmax cannot land outside
    /// its own grid, so a table that continues past the edge comes back
    /// with corners pinned to the border — that pinning is the signal,
    /// and it is the single most common reason the gate refuses a
    /// confident find.
    ///
    /// Apple names this case rather than staying quiet: Object Capture
    /// ships an `outOfFieldOfView` feedback state, and the augmented
    /// reality guidelines ask for an indicator along the edge the subject
    /// ran off. One sentence is the cheap version of the same idea.
    ///
    /// Frame edges here are the RECORDING's, not the screen's: the
    /// preview crops the video vertically to fill, so anything clipped in
    /// the model's view is already clipped on screen too.
    nonisolated static func framingCue(_ corners: [SIMD2<Double>])
        -> String? {
        guard corners.count == 4 else { return nil }
        let width = Double(TableFinderCore.inputWidth)
        let height = Double(TableFinderCore.inputHeight)
        // One heatmap cell is four input pixels; two cells of slack keeps
        // a table that merely sits near the edge out of this.
        let margin = 8.0
        let left = corners.contains { $0.x < margin }
        let right = corners.contains { $0.x > width - margin }
        let top = corners.contains { $0.y < margin }
        let bottom = corners.contains { $0.y > height - margin }
        // Both sides at once is a width problem, not an aim problem, and
        // turning either way makes it worse.
        if left && right { return "Step back so the whole table fits" }
        if left { return "Turn a little to the left" }
        if right { return "Turn a little to the right" }
        // The near end first: it carries two of the four corners and it
        // is the end the pipeline measures from.
        if bottom { return "Tilt down a little" }
        if top { return "Tilt up a little" }
        return nil
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
    ///
    /// `note` is this frame's sentence for the caption, and which of the
    /// two kinds it is depends on whether the frame produced a sighting:
    /// beside one it is a framing cue, without one it is the reason
    /// nothing was found.
    private nonisolated func report(_ settled: State?,
                                    detection: [SIMD2<Double>]? = nil,
                                    sighted: [SIMD2<Double>]? = nil,
                                    note: String? = nil,
                                    angle: Double? = nil,
                                    raw: [SIMD2<Double>]? = nil,
                                    diag line: String) {
        if settled == nil, detection == nil {
            recent.removeAll()
        }
        let framing = sighted != nil ? note : nil
        let reason = sighted == nil ? note : nil
        Task { @MainActor in
            self.diag = line
            self.debugCorners = raw
            if let angle { self.liveAngle = angle }
            if let sighted {
                self.sighting = sighted
                self.lastSightedAt = Date()
                self.quietSince = nil
            } else if self.sighting != nil,
                      Date().timeIntervalSince(self.lastSightedAt) > 1.2 {
                // 1.2 s of blank before letting go — in time, not frames,
                // so the cadence can change without re-tuning. Long enough
                // to ride out a rally crossing the corner, short enough
                // that a phone turned away goes quiet promptly.
                self.sighting = nil
                self.liveAngle = nil
                if self.quietSince == nil { self.quietSince = Date() }
            } else if self.sighting == nil, self.quietSince == nil,
                      detection == nil {
                self.quietSince = Date()
            }
            if self.recording {
                self.watchDrift(detection)
            } else if let settled {
                self.apply(settled)
            } else if detection != nil {
                // The gate passed but the vote is still building. Hold
                // the last verdict rather than demoting it — this is the
                // frame-to-frame case, not a loss of the table.
            } else if self.sighting != nil {
                self.apply(.sighted(framing))
            } else {
                let quiet = self.quietSince.map {
                    Date().timeIntervalSince($0) > 10
                } ?? false
                self.apply(.searching(reason
                    ?? (quiet ? Self.stalledNote : nil)))
            }
        }
    }

    /// Move the caption, but never faster than it can be read. Cues swap
    /// on a 0.4 s cadence, and a sentence that changes as the user shifts
    /// their weight is noise rather than guidance — nine tenths of a
    /// second is the floor. Three transitions are exempt because they are
    /// news rather than a rewording: arriving at good, leaving good, and
    /// losing the table altogether.
    private func apply(_ next: State) {
        guard state != next else { return }
        var urgent = false
        switch (state, next) {
        case (_, .good), (.good, _), (_, .searching): urgent = true
        default: break
        }
        if !urgent, Date().timeIntervalSince(stateChangedAt) < 0.9 { return }
        state = next
        stateChangedAt = Date()
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
    private nonisolated static func inputStats(_ array: MLMultiArray)
        -> (text: String, mean: Float) {
        let count = array.count
        guard count > 0 else { return ("in empty", 0) }
        let pointer = array.dataPointer.bindMemory(to: Float32.self,
                                                   capacity: count)
        var total: Float = 0
        var peak: Float = 0
        for i in 0..<count {
            let value = pointer[i]
            total += value
            if value > peak { peak = value }
        }
        let mean = total / Float(count)
        return (String(format: "in µ%.3f max%.2f", mean, peak), mean)
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

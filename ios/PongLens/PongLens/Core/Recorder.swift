import AVFoundation
import UIKit

/// Native match recording, built to survive the real world: HEVC 1080p to
/// the app's own storage (never tmp — iOS purges tmp), movie fragments
/// every five seconds so a crash or dead battery still leaves a playable
/// file, clean handling of calls and interruptions, a storage and battery
/// preflight, a thermal watch, and an automatic roll at the pipeline's
/// 45-minute cap so a long session becomes two uploads instead of one
/// rejection.
@Observable
final class Recorder: NSObject, AVCaptureFileOutputRecordingDelegate {
    enum State: Equatable {
        case idle
        case denied
        case ready
        case recording
        case failed(String)
    }

    /// The pipeline's hard cap; recording rolls to a fresh file here.
    static let maxSegmentS: TimeInterval = 45 * 60

    var state: State = .idle
    var elapsed: TimeInterval = 0
    /// The frame rate actually in force, which is not always the one
    /// asked for. Published so the settings picker can show the truth
    /// rather than the request.
    private(set) var activeFPS: Int = 30
    /// Set when a requested frame rate could not be reached, cleared as
    /// soon as one can. The record screen shows it as a banner.
    private(set) var frameRateNote: String?

    /// Seconds recorded since the shutter, across segment rolls.
    ///
    /// `elapsed` is the CURRENT segment's clock and goes back to zero
    /// every 45 minutes when the file rolls, which is right for the
    /// countdown banner and wrong for anything asking "how long has this
    /// been running". Kept separate rather than derived, because a wall
    /// clock would keep counting through a pause and this must not.
    var sessionElapsed: TimeInterval = 0
    /// 1-based segment of this session — "Part 2" after a 45-minute roll.
    var segment = 1
    /// Recording, but held between points: the current file is closed and
    /// the next chunk starts on resume. Chunks merge into one video.
    var isPaused = false
    /// Set when an interruption (call, camera theft) ended the recording.
    var interruptionNote: String?
    var thermalWarning = false
    /// Preflight verdicts for the idle screen.
    var freeSpaceGB: Double = 0
    var lowBattery = false

    /// A finished segment, ready for the queue. Fires on manual stop, on
    /// the 45-minute roll, and on interruptions — the footage always lands.
    var onSegment: ((URL, TimeInterval) -> Void)?
    /// Manual stop finished — the session's last file is banked.
    var onSessionEnd: (() -> Void)?
    /// Match audio, for the spoken-score listener. Written once from the
    /// main actor before the session starts, read on the tap queue — the
    /// nonisolated(unsafe) is that handshake, not an invitation. Nil
    /// unless the setting is on, so it costs nothing when it is off.
    nonisolated(unsafe) var onAudioBuffer: ((CMSampleBuffer) -> Void)?
    /// Whether the session would take a second read of the microphone.
    /// Published rather than assumed: a capture session can refuse an
    /// output, and a listener wired to one that was never added hears
    /// nothing for ever without a word of explanation.
    private(set) var audioTapReady = false

    let session = AVCaptureSession()
    private let output = AVCaptureMovieFileOutput()
    private let audioTap = AVCaptureAudioDataOutput()
    private let audioTapQueue = DispatchQueue(
        label: "com.ponglens.audio-tap", qos: .utility)
    private var device: AVCaptureDevice?
    private var timer: Timer?
    private var rollPending = false
    private var stopRequested = false
    private var pausePending = false
    private var cancelPending = false
    /// Closed files of the current segment. One entry when nobody paused;
    /// one per resume otherwise. They ship as a single merged video.
    private var chunks: [URL] = []
    private var observers: [NSObjectProtocol] = []

    /// The zoom the buttons show, in the numbers people know from the
    /// Camera app. Not the device's own factor — see `wideFactor`.
    private(set) var displayZoom: Double = 1

    /// The device factor that a person calls "1x". On a virtual device
    /// factor 1.0 is the WIDEST constituent, so on any phone with an
    /// ultra-wide the familiar 1x sits at the first switch-over point,
    /// which is 2.0 on every current model. Reading this as 1.0 means
    /// filming ultra-wide while the label says 1x.
    var wideFactor: Double {
        guard let device,
              device.constituentDevices.contains(where: {
                  $0.deviceType == .builtInUltraWideCamera
              }),
              let first = device.virtualDeviceSwitchOverVideoZoomFactors.first
        else { return 1 }
        return Double(truncating: first)
    }

    /// The steps the buttons offer, in the numbers the Camera app uses.
    ///
    /// Three at most, which is both what the Camera app shows on most
    /// phones and what fits beside the shutter at 402 pt. The step past
    /// 1x is real glass when the telephoto is a 2x or 3x, and a 2x crop
    /// otherwise — including on the phones whose only telephoto is a 5x,
    /// because a jump from 1x to 5x skips every framing anyone wants for
    /// a table.
    var zoomSteps: [Double] {
        guard let device else { return [1] }
        let base = wideFactor
        let longer = device.virtualDeviceSwitchOverVideoZoomFactors
            .map { Double(truncating: $0) / base }
            .filter { $0 > 1.05 }
            .sorted()
        var steps: [Double] = []
        if base > 1.05 { steps.append(1 / base) }
        steps.append(1)
        steps.append(longer.first.flatMap { $0 <= 3.05 ? $0 : nil } ?? 2)
        let ceiling = Double(device.maxAvailableVideoZoomFactor) / base
        return steps.filter { $0 <= ceiling + 0.01 }
    }

    var zoomAvailable: Bool { zoomSteps.count > 1 }

    /// Horizontal field of view of the live lens in degrees, corrected
    /// for the current zoom. The table check turns this into a focal
    /// length, and a focal that is wrong by a third turns a good stance
    /// into a refusal — which is exactly what switching to 0.5x for a
    /// tight room would otherwise do, since activeFormat reports the
    /// format's field of view and knows nothing about zoom.
    var horizontalFOV: Double {
        guard let device else { return GhostPose.fallbackFOV }
        let base = Double(device.activeFormat.videoFieldOfView)
        guard base > 1 else { return GhostPose.fallbackFOV }
        let zoom = max(0.1, Double(device.videoZoomFactor))
        return 2 * atan(tan(base * .pi / 360) / zoom) * 180 / .pi
    }

    private var recordingsDirectory: URL {
        let base = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("recordings", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    // MARK: - Setup

    func configure(fps: Int) async {
        // Idempotent. This used to be called again for every frame-rate
        // change, and the second call always failed: a session already
        // holding a video input refuses another, so the guard below fell
        // through to "the camera isn't available on this device" — with a
        // perfectly good camera still running behind the message. Rate is
        // a property of the device, not the shape of the session, so it
        // is set directly and nothing is rebuilt.
        if device != nil, !session.inputs.isEmpty {
            setFrameRate(fps)
            return
        }
        let camera = await AVCaptureDevice.requestAccess(for: .video)
        let mic = await AVCaptureDevice.requestAccess(for: .audio)
        guard camera else {
            state = .denied
            return
        }
        session.beginConfiguration()
        session.sessionPreset = .hd1920x1080

        // Widest virtual device first: it carries every lens the phone
        // has, so the zoom buttons reach real glass instead of cropping
        // pixels. At 1x the picture is the same either way — a virtual
        // device just makes the other steps optical rather than digital.
        let picked = AVCaptureDevice.default(.builtInTripleCamera, for: .video, position: .back)
            ?? AVCaptureDevice.default(.builtInDualWideCamera, for: .video, position: .back)
            ?? AVCaptureDevice.default(.builtInDualCamera, for: .video, position: .back)
            ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
        guard let picked,
              let videoInput = try? AVCaptureDeviceInput(device: picked),
              session.canAddInput(videoInput) else {
            session.commitConfiguration()
            #if targetEnvironment(simulator)
            // No AVCaptureDevice exists here, and never will. Reporting
            // .ready lets the Record screen draw its viewfinder over the
            // stand-in clip (SimulatorViewfinder) so the recorder can be
            // filmed for the landing video. The session stays stopped, so
            // nothing can be recorded — which is correct, there is nothing
            // to record. Device builds do not compile this.
            state = .ready
            #else
            state = .failed("The camera isn't available on this device.")
            #endif
            return
        }
        device = picked
        session.addInput(videoInput)
        // Start at a true 1x. A virtual device sits at factor 1.0 until
        // told otherwise, and on any phone with an ultra-wide that is the
        // ULTRA-WIDE — so the default lens was the widest one on the
        // phone, with the table small in frame and the corners bending.
        // Nothing said so, because the label read 1x either way.
        setDisplayZoom(1)
        if mic, let micDevice = AVCaptureDevice.default(for: .audio),
           let audioInput = try? AVCaptureDeviceInput(device: micDevice),
           session.canAddInput(audioInput) {
            session.addInput(audioInput)
        }
        if session.canAddOutput(output) {
            session.addOutput(output)
        }
        // The same microphone the recording uses, read a second time. The
        // handler is nil unless someone turned the setting on, so an
        // ordinary match delivers buffers to nothing and stops there.
        audioTap.setSampleBufferDelegate(self, queue: audioTapQueue)
        if session.canAddOutput(audioTap) {
            session.addOutput(audioTap)
            audioTapReady = true
        }
        // Crash insurance: fragments every 5 seconds keep everything up to
        // the last few seconds playable no matter how the process dies.
        output.movieFragmentInterval = CMTime(seconds: 5, preferredTimescale: 600)
        session.commitConfiguration()

        setFrameRate(fps)
        if let connection = output.connection(with: .video) {
            if output.availableVideoCodecTypes.contains(.hevc) {
                output.setOutputSettings([AVVideoCodecKey: AVVideoCodecType.hevc], for: connection)
            }
        }

        watchInterruptions()
        refreshPreflight()

        Task.detached { [session] in
            session.startRunning()
        }
        state = .ready
    }

    /// Set the capture rate, switching to a format that can carry it when
    /// the active one cannot. Returns the rate actually in force.
    ///
    /// The old version only ever looked at the format the session preset
    /// had already chosen, and only at the FIRST of its rate ranges. When
    /// that format topped out at 30 — which is what a 1080p preset picks
    /// on plenty of phones — asking for 60 silently did nothing: the
    /// setting said 60, the camera recorded 30, and nobody was told.
    /// Anything that reports a rate it did not deliver is worse than a
    /// rate it cannot deliver.
    @discardableResult
    func setFrameRate(_ fps: Int) -> Int {
        guard let device else { activeFPS = fps; return fps }
        let target = Double(fps)

        func carries(_ format: AVCaptureDevice.Format) -> Bool {
            format.videoSupportedFrameRateRanges.contains {
                $0.minFrameRate <= target + 0.01
                    && target <= $0.maxFrameRate + 0.01
            }
        }

        let chosen: AVCaptureDevice.Format? =
            carries(device.activeFormat) ? device.activeFormat
                                         : bestFormat(carrying: target)
        guard let chosen else {
            // Leave the camera exactly as it is and say so. Falling back
            // silently is how the old bug hid.
            frameRateNote =
                "This phone can't record 1080p at \(fps) fps. Still recording at \(activeFPS)."
            return activeFPS
        }

        let duration = CMTime(value: 1, timescale: CMTimeScale(fps))
        session.beginConfiguration()
        do {
            try device.lockForConfiguration()
            // Setting a format hands format choice to the device and
            // supersedes the session preset. Every candidate is 1920x1080,
            // so the recorded size does not move.
            if chosen != device.activeFormat { device.activeFormat = chosen }
            device.activeVideoMinFrameDuration = duration
            device.activeVideoMaxFrameDuration = duration
            device.unlockForConfiguration()
            activeFPS = fps
            frameRateNote = nil
        } catch {
            frameRateNote = "Couldn't change the frame rate. Still recording at \(activeFPS)."
        }
        session.commitConfiguration()
        // A format change can clamp the zoom, so restate it rather than
        // letting the buttons drift out of step with the lens.
        setDisplayZoom(displayZoom)
        return activeFPS
    }

    /// The gentlest 1080p format that can carry a rate: the lowest ceiling
    /// that still covers it, so asking for 60 does not land on a 240 fps
    /// slow-motion format with its worse low-light behaviour, and full
    /// sensor readout ahead of a binned one where there is a choice.
    private func bestFormat(carrying target: Double) -> AVCaptureDevice.Format? {
        guard let device else { return nil }
        return device.formats
            .filter { format in
                let size = CMVideoFormatDescriptionGetDimensions(
                    format.formatDescription)
                guard size.width == 1920, size.height == 1080 else { return false }
                return format.videoSupportedFrameRateRanges.contains {
                    $0.minFrameRate <= target + 0.01
                        && target <= $0.maxFrameRate + 0.01
                }
            }
            .min { lhs, rhs in
                let l = lhs.videoSupportedFrameRateRanges
                    .map(\.maxFrameRate).max() ?? 0
                let r = rhs.videoSupportedFrameRateRanges
                    .map(\.maxFrameRate).max() ?? 0
                if l != r { return l < r }
                return !lhs.isVideoBinned && rhs.isVideoBinned
            }
    }

    /// What this phone can actually offer, for the settings picker.
    func supportedFrameRates(from candidates: [Int]) -> [Int] {
        guard device != nil else { return candidates }
        return candidates.filter { bestFormat(carrying: Double($0)) != nil }
    }

    /// Set the zoom in the numbers on the buttons. Everything else in
    /// the app speaks this language; only this one line converts.
    func setDisplayZoom(_ value: Double) {
        guard let device else { return }
        try? device.lockForConfiguration()
        device.videoZoomFactor = max(
            device.minAvailableVideoZoomFactor,
            min(CGFloat(value * wideFactor), device.maxAvailableVideoZoomFactor)
        )
        device.unlockForConfiguration()
        displayZoom = Double(device.videoZoomFactor) / wideFactor
    }

    // MARK: - Preflight

    func refreshPreflight() {
        let home = URL(fileURLWithPath: NSHomeDirectory())
        let values = try? home.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        freeSpaceGB = Double(values?.volumeAvailableCapacityForImportantUsage ?? 0) / 1_073_741_824
        UIDevice.current.isBatteryMonitoringEnabled = true
        let level = UIDevice.current.batteryLevel
        lowBattery = level >= 0 && level < 0.2 && UIDevice.current.batteryState == .unplugged
    }

    /// Nil when good to go; otherwise the reason recording can't start.
    var preflightBlock: String? {
        #if targetEnvironment(simulator)
        // The simulator's container reports 0.0 GB free however much the
        // host has, so this banner is always up and always wrong. It would
        // sit across the viewfinder in the landing video's recorder shot.
        // Device builds do not compile this.
        return nil
        #else
        // 45 minutes of 1080p HEVC is roughly 2 GB, and the upload slices
        // need transient headroom on top.
        if freeSpaceGB < 3 {
            return "This phone has \(String(format: "%.1f", freeSpaceGB)) GB free. A full match needs about 3 GB, so clear some space first."
        }
        return nil
        #endif
    }

    // MARK: - Recording

    func start() {
        guard state == .ready else { return }
        refreshPreflight()
        guard preflightBlock == nil else { return }
        // The preview's layout pass has almost certainly set this already.
        // "Almost certainly" is not a good enough reason to risk filming a
        // whole match sideways, so the orientation is read once more here,
        // from the scene rather than from a callback that may not have run.
        setCaptureRotation(Self.captureAngle())
        interruptionNote = nil
        segment = 1
        elapsed = 0
        sessionElapsed = 0
        chunks = []
        beginChunk()
        UIApplication.shared.isIdleTimerDisabled = true
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    /// The rotation that makes the sensor's frame match what the person is
    /// looking at. Same mapping CameraPreview uses in its layout pass.
    private static func captureAngle() -> CGFloat {
        let orientation = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }.first?.interfaceOrientation
        return switch orientation {
        case .landscapeRight: 0
        case .landscapeLeft: 180
        case .portraitUpsideDown: 270
        default: 90
        }
    }

    private func beginChunk() {
        let url = recordingsDirectory
            .appendingPathComponent("live-\(UUID().uuidString).mov")
        output.startRecording(to: url, recordingDelegate: self)
        state = .recording
    }

    private func tick() {
        thermalWarning = ProcessInfo.processInfo.thermalState == .serious
            || ProcessInfo.processInfo.thermalState == .critical
        guard state == .recording, !isPaused else { return }
        elapsed += 1
        sessionElapsed += 1
        // The cap: finalize this file and keep rolling into the next one.
        if elapsed >= Self.maxSegmentS, !rollPending, !stopRequested, !pausePending, !cancelPending {
            rollPending = true
            output.stopRecording()
        }
    }

    /// A break between games: close the current file and wait. The camera
    /// stays warm, the elapsed clock holds, and resume picks up in the same
    /// video.
    func pause() {
        guard state == .recording, !isPaused, !pausePending,
              !rollPending, !stopRequested, !cancelPending else { return }
        pausePending = true
        output.stopRecording()
    }

    func resume() {
        guard state == .recording, isPaused else { return }
        isPaused = false
        beginChunk()
    }

    func stop() {
        guard state == .recording else { return }
        if isPaused {
            // Nothing is rolling: the banked chunks are the whole video.
            finishSession()
        } else {
            stopRequested = true
            output.stopRecording()
        }
    }

    /// Throw the recording away: nothing banked so far survives, nothing
    /// uploads. The confirmation lives in the UI.
    func cancel() {
        guard state == .recording else { return }
        if isPaused {
            discardChunks()
            resetToReady()
        } else {
            cancelPending = true
            output.stopRecording()
        }
    }

    private func discardChunks() {
        for url in chunks {
            try? FileManager.default.removeItem(at: url)
        }
        chunks = []
    }

    private func resetToReady() {
        timer?.invalidate()
        UIApplication.shared.isIdleTimerDisabled = false
        stopRequested = false
        pausePending = false
        cancelPending = false
        rollPending = false
        isPaused = false
        if case .failed = state {
            // Leave the failure visible.
        } else {
            state = .ready
        }
    }

    /// The session is over: ship what's banked (merging pause chunks into
    /// one video), then hand the screen back.
    private func finishSession() {
        let seconds = min(elapsed, Self.maxSegmentS)
        shipChunks(seconds: seconds)
        resetToReady()
        onSessionEnd?()
    }

    /// Merge-and-deliver for the current segment's chunks. One chunk goes
    /// straight through; several become a single video first.
    private func shipChunks(seconds: TimeInterval) {
        guard !chunks.isEmpty, seconds >= 2 else {
            discardChunks()
            return
        }
        let parts = chunks
        chunks = []
        if parts.count == 1 {
            onSegment?(parts[0], seconds)
            return
        }
        // Self is captured strongly on purpose: the merge must outlive the
        // screen so the finished file reaches the queue, not the orphan
        // sweep on next launch.
        Task {
            if let merged = await Self.merge(parts, into: recordingsDirectory) {
                for url in parts {
                    try? FileManager.default.removeItem(at: url)
                }
                onSegment?(merged, seconds)
            } else {
                // The merge failed; ship the pieces separately rather than
                // lose a single frame of the match.
                for url in parts {
                    let duration = (try? await AVURLAsset(url: url).load(.duration).seconds) ?? 0
                    onSegment?(url, duration)
                }
            }
        }
    }

    /// Stitch chunk files into one movie without re-encoding: a passthrough
    /// export remuxes the samples, so it is quick and loses nothing.
    private nonisolated static func merge(_ parts: [URL], into directory: URL?) async -> URL? {
        guard let directory, parts.count > 1 else { return nil }
        let composition = AVMutableComposition()
        guard let video = composition.addMutableTrack(
            withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid
        ) else { return nil }
        let audio = composition.addMutableTrack(
            withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid
        )
        var cursor = CMTime.zero
        for url in parts {
            let asset = AVURLAsset(
                url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true]
            )
            guard let duration = try? await asset.load(.duration),
                  duration > .zero else { continue }
            let range = CMTimeRange(start: .zero, duration: duration)
            if let track = try? await asset.loadTracks(withMediaType: .video).first {
                do {
                    try video.insertTimeRange(range, of: track, at: cursor)
                } catch {
                    return nil
                }
                if cursor == .zero {
                    video.preferredTransform =
                        (try? await track.load(.preferredTransform)) ?? .identity
                }
            }
            if let track = try? await asset.loadTracks(withMediaType: .audio).first {
                try? audio?.insertTimeRange(range, of: track, at: cursor)
            }
            cursor = cursor + duration
        }
        guard cursor > .zero, let export = AVAssetExportSession(
            asset: composition, presetName: AVAssetExportPresetPassthrough
        ) else { return nil }
        let outURL = directory.appendingPathComponent("merged-\(UUID().uuidString).mov")
        do {
            try await export.export(to: outURL, as: .mov)
            return outURL
        } catch {
            try? FileManager.default.removeItem(at: outURL)
            return nil
        }
    }

    func teardown() {
        timer?.invalidate()
        UIApplication.shared.isIdleTimerDisabled = false
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
        }
        observers = []
        Task.detached { [session] in
            if session.isRunning { session.stopRunning() }
        }
    }

    // MARK: - Interruptions

    /// A phone call, an alarm, another app taking the camera: finalize the
    /// file at the cut and say so plainly. The footage up to that moment
    /// is already fragmented to disk, so nothing before the interruption
    /// is ever at risk.
    private func watchInterruptions() {
        observers.append(NotificationCenter.default.addObserver(
            forName: AVCaptureSession.wasInterruptedNotification,
            object: session, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.state == .recording else { return }
                let minutes = Int(self.elapsed / 60)
                self.interruptionNote = minutes >= 1
                    ? "Something interrupted the camera, so recording stopped. The \(minutes) minute\(minutes == 1 ? "" : "s") so far are saved and uploading."
                    : "Something interrupted the camera, so recording stopped. The clip was saved."
                if self.isPaused {
                    self.finishSession()
                } else {
                    self.stopRequested = true
                    self.output.stopRecording()
                }
            }
        })
        observers.append(NotificationCenter.default.addObserver(
            forName: AVCaptureSession.runtimeErrorNotification,
            object: session, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.state == .recording else { return }
                self.interruptionNote = "The camera hit an error. Everything recorded so far was saved."
                if self.isPaused {
                    self.finishSession()
                } else {
                    self.stopRequested = true
                    self.output.stopRecording()
                }
            }
        })
    }

    // MARK: - Segment delivery

    nonisolated func fileOutput(
        _ output: AVCaptureFileOutput,
        didFinishRecordingTo outputFileURL: URL,
        from connections: [AVCaptureConnection],
        error: Error?
    ) {
        Task { @MainActor in
            // An error here usually means the recording was cut short —
            // the fragmented file is still playable up to the cut, so it
            // ships rather than vanishes. Only a zero-byte file is dropped.
            let bytes = (try? FileManager.default.attributesOfItem(
                atPath: outputFileURL.path
            )[.size] as? Int64).flatMap { $0 } ?? 0

            if cancelPending {
                try? FileManager.default.removeItem(at: outputFileURL)
                discardChunks()
                resetToReady()
                return
            }

            if bytes > 0 {
                chunks.append(outputFileURL)
            } else {
                try? FileManager.default.removeItem(at: outputFileURL)
                if let error, !rollPending, !pausePending {
                    state = .failed(error.localizedDescription)
                }
            }

            if pausePending {
                pausePending = false
                // A stop that raced the pause wins: fall through and end
                // the session instead of holding it open.
                if !stopRequested {
                    isPaused = true
                    return
                }
            }

            if rollPending {
                // Seamless-enough: the next segment starts immediately;
                // the seam costs well under a second.
                rollPending = false
                shipChunks(seconds: min(elapsed, Self.maxSegmentS))
                segment += 1
                elapsed = 0
                beginChunk()
                return
            }
            finishSession()
        }
    }
}

// MARK: - Audio tap

extension Recorder: AVCaptureAudioDataOutputSampleBufferDelegate {
    nonisolated func captureOutput(_ output: AVCaptureOutput,
                                   didOutput sampleBuffer: CMSampleBuffer,
                                   from connection: AVCaptureConnection) {
        guard let handler = onAudioBuffer else { return }
        handler(sampleBuffer)
    }
}

// MARK: - Orientation

extension Recorder {
    /// Point the recorded file the same way up as the viewfinder. The
    /// preview computes the angle in its own layout pass and hands it here.
    ///
    /// This was missed for a long time: the preview layer was rotated, so
    /// the viewfinder looked right, while the movie output — the only
    /// connection that reaches the file — kept AVFoundation's default,
    /// which is portrait. So a match filmed in landscape, through a
    /// viewfinder that looked perfectly correct, was written to disk
    /// flagged as portrait and played back on its side. Nothing on a
    /// simulator can catch that: there is no camera, so no build ever
    /// produced a real recording until one reached a real match.
    func setCaptureRotation(_ angle: CGFloat) {
        // The file's own rotation is fixed when the chunk opens and must
        // not move afterwards: changing it mid-recording turns the picture
        // over halfway through the video.
        guard state != .recording,
              let movie = output.connection(with: .video),
              movie.isVideoRotationAngleSupported(angle) else { return }
        movie.videoRotationAngle = angle
    }
}

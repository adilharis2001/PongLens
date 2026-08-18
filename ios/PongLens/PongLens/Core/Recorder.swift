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
    /// 1-based segment of this session — "Part 2" after a 45-minute roll.
    var segment = 1
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

    let session = AVCaptureSession()
    private let output = AVCaptureMovieFileOutput()
    private var device: AVCaptureDevice?
    private var timer: Timer?
    private var rollPending = false
    private var stopRequested = false
    private var observers: [NSObjectProtocol] = []

    var zoomAvailable: Bool {
        (device?.minAvailableVideoZoomFactor ?? 1) < 1
    }

    private var recordingsDirectory: URL {
        let base = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("recordings", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    // MARK: - Setup

    func configure(fps: Int) async {
        let camera = await AVCaptureDevice.requestAccess(for: .video)
        let mic = await AVCaptureDevice.requestAccess(for: .audio)
        guard camera else {
            state = .denied
            return
        }
        session.beginConfiguration()
        session.sessionPreset = .hd1920x1080

        // The dual-wide virtual device unlocks 0.5x for tight rooms; fall
        // back to the plain wide camera everywhere else.
        let picked = AVCaptureDevice.default(.builtInDualWideCamera, for: .video, position: .back)
            ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
        guard let picked,
              let videoInput = try? AVCaptureDeviceInput(device: picked),
              session.canAddInput(videoInput) else {
            session.commitConfiguration()
            state = .failed("The camera isn't available on this device.")
            return
        }
        device = picked
        session.addInput(videoInput)
        if mic, let micDevice = AVCaptureDevice.default(for: .audio),
           let audioInput = try? AVCaptureDeviceInput(device: micDevice),
           session.canAddInput(audioInput) {
            session.addInput(audioInput)
        }
        if session.canAddOutput(output) {
            session.addOutput(output)
        }
        // Crash insurance: fragments every 5 seconds keep everything up to
        // the last few seconds playable no matter how the process dies.
        output.movieFragmentInterval = CMTime(seconds: 5, preferredTimescale: 600)
        session.commitConfiguration()

        applyFrameRate(fps)
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

    private func applyFrameRate(_ fps: Int) {
        guard let device else { return }
        let target = CMTime(value: 1, timescale: CMTimeScale(fps))
        guard let range = device.activeFormat.videoSupportedFrameRateRanges.first,
              Double(fps) <= range.maxFrameRate else { return }
        do {
            try device.lockForConfiguration()
            device.activeVideoMinFrameDuration = target
            device.activeVideoMaxFrameDuration = target
            device.unlockForConfiguration()
        } catch {
            // The default cadence still records.
        }
    }

    func setZoom(_ factor: CGFloat) {
        guard let device else { return }
        try? device.lockForConfiguration()
        device.videoZoomFactor = max(
            device.minAvailableVideoZoomFactor,
            min(factor, min(4, device.maxAvailableVideoZoomFactor))
        )
        device.unlockForConfiguration()
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
        // 45 minutes of 1080p HEVC is roughly 2 GB, and the upload slices
        // need transient headroom on top.
        if freeSpaceGB < 3 {
            return "This phone has \(String(format: "%.1f", freeSpaceGB)) GB free. A full match needs about 3 GB — clear some space first."
        }
        return nil
    }

    // MARK: - Recording

    func start() {
        guard state == .ready else { return }
        refreshPreflight()
        guard preflightBlock == nil else { return }
        interruptionNote = nil
        segment = 1
        beginSegment()
    }

    private func beginSegment() {
        let url = recordingsDirectory
            .appendingPathComponent("live-\(UUID().uuidString).mov")
        output.startRecording(to: url, recordingDelegate: self)
        state = .recording
        elapsed = 0
        UIApplication.shared.isIdleTimerDisabled = true
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    private func tick() {
        elapsed += 1
        thermalWarning = ProcessInfo.processInfo.thermalState == .serious
            || ProcessInfo.processInfo.thermalState == .critical
        // The cap: finalize this file and keep rolling into the next one.
        if elapsed >= Self.maxSegmentS, state == .recording, !rollPending, !stopRequested {
            rollPending = true
            output.stopRecording()
        }
    }

    func stop() {
        guard state == .recording else { return }
        stopRequested = true
        output.stopRecording()
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
                    ? "Recording stopped when something interrupted the camera — \(minutes) minute\(minutes == 1 ? "" : "s") saved and uploading."
                    : "Recording stopped when something interrupted the camera. The clip was saved."
                self.stopRequested = true
                self.output.stopRecording()
            }
        })
        observers.append(NotificationCenter.default.addObserver(
            forName: AVCaptureSession.runtimeErrorNotification,
            object: session, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.state == .recording else { return }
                self.interruptionNote = "The camera hit an error. Everything recorded so far was saved."
                self.stopRequested = true
                self.output.stopRecording()
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
            let seconds = min(elapsed, Self.maxSegmentS)
            // An error here usually means the recording was cut short —
            // the fragmented file is still playable up to the cut, so it
            // ships rather than vanishes. Only a zero-byte file is dropped.
            let bytes = (try? FileManager.default.attributesOfItem(
                atPath: outputFileURL.path
            )[.size] as? Int64).flatMap { $0 } ?? 0
            if bytes > 0, seconds >= 2 {
                onSegment?(outputFileURL, seconds)
            } else {
                try? FileManager.default.removeItem(at: outputFileURL)
                if let error, !rollPending {
                    state = .failed(error.localizedDescription)
                }
            }

            if rollPending {
                // Seamless-enough: the next segment starts immediately;
                // the seam costs well under a second.
                rollPending = false
                segment += 1
                beginSegment()
                return
            }
            timer?.invalidate()
            UIApplication.shared.isIdleTimerDisabled = false
            stopRequested = false
            if case .failed = state {
                // Leave the failure visible.
            } else {
                state = .ready
            }
            onSessionEnd?()
        }
    }
}

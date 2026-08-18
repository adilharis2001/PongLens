import AVFoundation
import Photos
import UIKit

/// Native match recording — the one feature the web can't have. Films with
/// the back camera at 1080p30, keeps the screen awake, saves a copy to
/// Photos, and hands the file to the upload pipeline.
@Observable
final class Recorder: NSObject, AVCaptureFileOutputRecordingDelegate {
    enum State: Equatable {
        case idle
        case denied
        case ready
        case recording
        case finished(URL)
        case failed(String)
    }

    var state: State = .idle
    var elapsed: TimeInterval = 0

    let session = AVCaptureSession()
    private let output = AVCaptureMovieFileOutput()
    private var timer: Timer?

    func configure() async {
        let camera = await AVCaptureDevice.requestAccess(for: .video)
        let mic = await AVCaptureDevice.requestAccess(for: .audio)
        guard camera else {
            state = .denied
            return
        }
        session.beginConfiguration()
        session.sessionPreset = .hd1920x1080
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let videoInput = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(videoInput) else {
            session.commitConfiguration()
            state = .failed("The camera isn't available on this device.")
            return
        }
        session.addInput(videoInput)
        if mic, let micDevice = AVCaptureDevice.default(for: .audio),
           let audioInput = try? AVCaptureDeviceInput(device: micDevice),
           session.canAddInput(audioInput) {
            session.addInput(audioInput)
        }
        if session.canAddOutput(output) {
            session.addOutput(output)
        }
        session.commitConfiguration()
        Task.detached { [session] in
            session.startRunning()
        }
        state = .ready
    }

    func start() {
        guard state == .ready else { return }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("record-\(UUID().uuidString).mov")
        output.startRecording(to: url, recordingDelegate: self)
        state = .recording
        elapsed = 0
        UIApplication.shared.isIdleTimerDisabled = true
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.elapsed += 1 }
        }
    }

    func stop() {
        guard state == .recording else { return }
        output.stopRecording()
    }

    func teardown() {
        timer?.invalidate()
        UIApplication.shared.isIdleTimerDisabled = false
        Task.detached { [session] in
            if session.isRunning { session.stopRunning() }
        }
    }

    nonisolated func fileOutput(
        _ output: AVCaptureFileOutput,
        didFinishRecordingTo outputFileURL: URL,
        from connections: [AVCaptureConnection],
        error: Error?
    ) {
        Task { @MainActor in
            timer?.invalidate()
            UIApplication.shared.isIdleTimerDisabled = false
            if let error {
                state = .failed(error.localizedDescription)
                return
            }
            state = .finished(outputFileURL)
            // Footage safety: a copy lands in Photos, best effort.
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
                guard status == .authorized || status == .limited else { return }
                PHPhotoLibrary.shared().performChanges {
                    PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: outputFileURL)
                }
            }
        }
    }
}

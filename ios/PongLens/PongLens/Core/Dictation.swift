import AVFoundation
import Foundation

/// Speaking an entry instead of typing it.
///
/// This is the journal composer's own flow, lifted out so the coach's
/// entry composer runs exactly the same one rather than a second copy of
/// it: record here, send it to the route voice notes already use, hand
/// back the words. An entry keeps only text, so the recording is deleted
/// as soon as it has been read.
@Observable
@MainActor
final class Dictation {
    enum State { case idle, recording, transcribing }

    private(set) var state: State = .idle
    /// Seconds recorded, for the row's running clock.
    private(set) var elapsed = 0
    /// The last thing worth telling somebody, cleared on the next attempt.
    var errorMessage: String?

    private var recorder: AVAudioRecorder?
    private var timer: Timer?

    var isBusy: Bool { state != .idle }

    func start() async {
        errorMessage = nil
        let granted = await AVAudioApplication.requestRecordPermission()
        guard granted else {
            errorMessage = "Microphone access was blocked. Check Settings."
            return
        }
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true)
        } catch {
            errorMessage = "Couldn't start recording. Try again."
            return
        }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("entry-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
        do {
            let rec = try AVAudioRecorder(url: url, settings: settings)
            rec.record()
            recorder = rec
            elapsed = 0
            state = .recording
            timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
                Task { @MainActor in self.elapsed += 1 }
            }
        } catch {
            errorMessage = "Couldn't start recording. Try again."
        }
    }

    /// Stop, transcribe, and hand the words back. The caller adds them to
    /// its draft rather than replacing it, so dictating twice appends.
    func stop(_ deliver: @escaping (String) -> Void) {
        timer?.invalidate()
        timer = nil
        guard let recorder else {
            state = .idle
            return
        }
        let url = recorder.url
        recorder.stop()
        self.recorder = nil
        try? AVAudioSession.sharedInstance()
            .setActive(false, options: .notifyOthersOnDeactivation)
        state = .transcribing
        Task {
            defer { state = .idle }
            guard let data = try? Data(contentsOf: url), !data.isEmpty else {
                errorMessage = "Nothing was recorded. Try again."
                return
            }
            guard data.count <= 10 * 1024 * 1024 else {
                errorMessage = "That recording is too long. Break it into shorter takes."
                return
            }
            do {
                let result = try await NoteMedia.transcribe(audio: data)
                let words = (result.transcript ?? "")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if !words.isEmpty { deliver(words) }
            } catch {
                errorMessage = "Couldn't transcribe that. Try again."
            }
            try? FileManager.default.removeItem(at: url)
        }
    }

    /// The sheet went away mid-recording: stop the hardware, skip the
    /// transcription nobody is waiting for.
    func cancel() {
        timer?.invalidate()
        timer = nil
        guard let recorder else { return }
        recorder.stop()
        try? FileManager.default.removeItem(at: recorder.url)
        try? AVAudioSession.sharedInstance()
            .setActive(false, options: .notifyOthersOnDeactivation)
        self.recorder = nil
        state = .idle
    }
}

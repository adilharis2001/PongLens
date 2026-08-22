import AVFoundation
import Foundation
import UIKit

// A lesson runs one to two hours, which rules out the obvious API.
//
// AVAudioRecorder stops recording at around 90 minutes in the background
// and says nothing — no error, no delegate call, no notification. Ninety
// minutes is the MIDDLE of the range we need, not the edge of it. It also
// loses everything recorded before an interruption: after a phone call it
// resumes cleanly and saves only what came after, so an hour of coaching
// disappears while the UI still reads as recording.
//
// So this uses AVAudioEngine with a tap, and writes SEGMENTS rather than
// one long file. A crash, a kill or a flat battery costs one segment
// instead of the lesson, and each segment can be transcribed the moment it
// closes — which is why the wait at the end is seconds rather than the
// length of the lesson.
//
// The trap in AVAudioEngine is interruption recovery: building a fresh
// engine after an interruption crashes inside CoreAudio. The same engine
// instance is reused and its graph reconnected instead.

/// One closed chunk of the lesson, on disk and ready to transcribe.
struct LessonSegment: Identifiable, Codable, Equatable {
    let id: UUID
    let url: URL
    let index: Int
    let seconds: Double
}

/// What a resumable session looks like on disk, so a crash mid-lesson
/// leaves something recoverable rather than orphaned files.
struct LessonManifest: Codable {
    var sessionId: UUID
    var startedAt: Date
    var segments: [LessonSegment]
}

/// A lesson that was recorded but never finished: the app was killed, the
/// battery died, or the phone was taken away mid-session.
///
/// These used to sit in Documents forever. Nothing deleted them, because
/// the only cleanup ran on save or discard and neither had happened — so
/// an abandoned hour cost ~14 MB of someone's phone permanently, silently.
struct OrphanedLesson: Identifiable {
    let id: UUID
    let directory: URL
    let startedAt: Date
    let segments: [LessonSegment]

    var seconds: Double { segments.reduce(0) { $0 + $1.seconds } }
}

@Observable
final class LessonRecorder {

    enum Phase: Equatable {
        case idle
        case recording
        case paused
        /// The tail is being flushed and the last segment closed.
        case finishing
    }

    /// Five minutes. Long enough that rotation is rare and the per-segment
    /// transcription overhead stays small, short enough that losing one to
    /// a crash is an annoyance rather than a disaster.
    static let segmentSeconds: Double = 300

    private(set) var phase: Phase = .idle
    private(set) var elapsed: TimeInterval = 0
    /// 0...1, smoothed. The viewfinder equivalent for audio: without it
    /// there is no way to tell a working microphone from a dead one until
    /// the lesson is over.
    private(set) var level: Double = 0
    private(set) var segments: [LessonSegment] = []
    private(set) var errorMessage: String?
    /// The underlying failure, kept alongside the readable message. A
    /// recorder is debugged from a TestFlight screenshot more often than
    /// from a console, so the reason has to be on screen to be any use.
    private(set) var diagnostic: String?
    /// Set when an interruption took the microphone away and gave it back,
    /// so the screen can account for the gap rather than pretending.
    private(set) var wasInterrupted = false

    private let engine = AVAudioEngine()
    private var writer: SegmentWriter?
    private var sessionId = UUID()
    private var startedAt = Date()
    private var ticker: Timer?
    private var accumulated: TimeInterval = 0
    private var resumedAt: Date?
    private var observers: [NSObjectProtocol] = []

    var directory: URL {
        URL.documentsDirectory
            .appendingPathComponent("lessons/\(sessionId.uuidString)", isDirectory: true)
    }

    // MARK: - Leftovers

    private static var root: URL {
        URL.documentsDirectory.appendingPathComponent("lessons", isDirectory: true)
    }

    /// Anything left behind by a session that never finished, newest first.
    ///
    /// Sweeps as it goes: a folder with no manifest or no audio has nothing
    /// anyone could want, and anything older than a fortnight is not being
    /// come back for. What survives is offered to the person instead of
    /// being deleted out from under them.
    static func orphans(excluding current: UUID? = nil) -> [OrphanedLesson] {
        let fm = FileManager.default
        guard let dirs = try? fm.contentsOfDirectory(
            at: root, includingPropertiesForKeys: nil
        ) else { return [] }

        var found: [OrphanedLesson] = []
        for dir in dirs {
            guard dir.hasDirectoryPath else { continue }
            let id = UUID(uuidString: dir.lastPathComponent)
            if let id, id == current { continue }

            let manifestURL = dir.appendingPathComponent("manifest.json")
            guard let data = try? Data(contentsOf: manifestURL),
                  let manifest = try? JSONDecoder().decode(LessonManifest.self, from: data)
            else {
                // No manifest means no closed segment ever landed.
                try? fm.removeItem(at: dir)
                continue
            }

            // Resolve the audio by NAME inside this directory rather than by
            // the URL the manifest stored. A container path changes when the
            // app is reinstalled or updated, so yesterday's absolute URLs
            // point at a directory that no longer exists.
            let files = (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil))?
                .filter { $0.pathExtension == "m4a" }
                .sorted { $0.lastPathComponent < $1.lastPathComponent } ?? []
            guard !files.isEmpty else {
                try? fm.removeItem(at: dir)
                continue
            }

            let byIndex = Dictionary(
                manifest.segments.map { ($0.index, $0) }, uniquingKeysWith: { a, _ in a }
            )
            let segments = files.enumerated().map { index, url in
                LessonSegment(
                    id: byIndex[index]?.id ?? UUID(),
                    url: url,
                    index: index,
                    seconds: byIndex[index]?.seconds ?? 0
                )
            }

            if manifest.startedAt < Date().addingTimeInterval(-14 * 24 * 3600) {
                try? fm.removeItem(at: dir)
                continue
            }
            found.append(
                OrphanedLesson(
                    id: manifest.sessionId, directory: dir,
                    startedAt: manifest.startedAt, segments: segments
                )
            )
        }
        return found.sorted { $0.startedAt > $1.startedAt }
    }

    static func remove(_ orphan: OrphanedLesson) {
        try? FileManager.default.removeItem(at: orphan.directory)
    }

    /// Take an unfinished session over, so finishing and discarding work on
    /// it exactly as they would on one recorded just now.
    func adopt(_ orphan: OrphanedLesson) {
        sessionId = orphan.id
        startedAt = orphan.startedAt
        segments = orphan.segments
        elapsed = orphan.seconds
        accumulated = orphan.seconds
    }

    // MARK: - Control

    func start() async -> Bool {
        guard phase == .idle else { return true }
        errorMessage = nil
        diagnostic = nil
        wasInterrupted = false

        guard await AVAudioApplication.requestRecordPermission() else {
            errorMessage = "PongLens needs the microphone to record a lesson. You can turn it on in Settings."
            return false
        }

        sessionId = UUID()
        startedAt = Date()
        segments = []
        accumulated = 0
        elapsed = 0

        do {
            try FileManager.default.createDirectory(
                at: directory, withIntermediateDirectories: true
            )
        } catch {
            fail("Couldn't make room for the recording.", error, step: "storage")
            return false
        }
        do {
            try configureSession()
        } catch {
            fail(
                "Couldn't take the microphone. Close anything else that might be using it, then try again.",
                error, step: "session"
            )
            return false
        }
        do {
            try beginEngine()
        } catch {
            fail("Couldn't start the microphone. Try again.", error, step: "engine")
            return false
        }

        listen()
        resumedAt = Date()
        phase = .recording
        startTicking()
        return true
    }

    private func fail(_ message: String, _ error: Error, step: String) {
        errorMessage = message
        let code = (error as NSError).code
        diagnostic = "\(step) \(code)"
        teardown()
    }

    func pause() {
        guard phase == .recording else { return }
        accumulateElapsed()
        engine.pause()
        // Close the open segment rather than hold it. A pause can last
        // minutes, and an open file is the one thing a crash can lose.
        writer?.closeCurrent()
        collectSegments()
        phase = .paused
    }

    func resume() {
        guard phase == .paused else { return }
        do {
            try AVAudioSession.sharedInstance().setActive(true)
            try engine.start()
        } catch {
            errorMessage = "Couldn't resume recording. Everything recorded so far is safe."
            return
        }
        resumedAt = Date()
        phase = .recording
    }

    /// Close everything and hand back what was captured, in order.
    @discardableResult
    func finish() -> [LessonSegment] {
        guard phase != .idle else { return segments }
        phase = .finishing
        accumulateElapsed()
        stopTicking()

        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        writer?.closeCurrent()
        collectSegments()
        teardown()

        phase = .idle
        return segments
    }

    /// Give up on the lesson and remove every byte of it.
    func discard() {
        _ = finish()
        try? FileManager.default.removeItem(at: directory)
        segments = []
        elapsed = 0
    }

    // MARK: - Engine

    private func configureSession() throws {
        let session = AVAudioSession.sharedInstance()
        // .record rather than .playAndRecord: nothing here plays audio, and
        // asking for playback would duck whatever the player has going.
        //
        // .default rather than .spokenAudio. spokenAudio is a PLAYBACK mode —
        // it exists so a podcast pauses instead of ducking — and pairing it
        // with .record is an invalid combination that throws on a device.
        // The simulator's audio session accepts it, so this passed every
        // check here and failed on the first real phone. .default also keeps
        // the input processing that helps a voice across a room, which
        // .measurement would switch off.
        try session.setCategory(.record, mode: .default, options: [])
        try session.setActive(true)
    }

    private func beginEngine() throws {
        let input = engine.inputNode
        // The tap's own format defines the file, so no sample-rate or
        // channel conversion is needed anywhere in the hot path.
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0 else {
            throw NSError(domain: "LessonRecorder", code: 1)
        }

        let writer = SegmentWriter(
            directory: directory,
            format: format,
            segmentSeconds: Self.segmentSeconds
        )
        self.writer = writer

        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, _ in
            // Real-time audio thread. Nothing here may allocate unbounded,
            // block, or touch main-actor state.
            writer.append(buffer)
        }

        engine.prepare()
        try engine.start()
    }

    private func teardown() {
        for token in observers {
            NotificationCenter.default.removeObserver(token)
        }
        observers = []
        stopTicking()
        writer = nil
        try? AVAudioSession.sharedInstance().setActive(
            false, options: .notifyOthersOnDeactivation
        )
    }

    // MARK: - Interruptions

    private func listen() {
        let centre = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()

        observers.append(centre.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: session, queue: .main
        ) { [weak self] note in
            MainActor.assumeIsolated { self?.handleInterruption(note) }
        })

        // Media services dying takes the engine with it. Everything has to
        // be rebuilt, and the segments already closed are what survive.
        observers.append(centre.addObserver(
            forName: AVAudioSession.mediaServicesWereResetNotification,
            object: session, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.rebuildAfterReset() }
        })
    }

    private func handleInterruption(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }

        switch type {
        case .began:
            guard phase == .recording else { return }
            wasInterrupted = true
            accumulateElapsed()
            engine.pause()
            // Close the segment immediately. This is the exact failure that
            // makes AVAudioRecorder unusable here: it keeps the file open
            // across the interruption and loses everything before it.
            writer?.closeCurrent()
            collectSegments()
            phase = .paused

        case .ended:
            let options = (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt)
                .map(AVAudioSession.InterruptionOptions.init(rawValue:)) ?? []
            guard options.contains(.shouldResume), phase == .paused else { return }
            resume()

        @unknown default:
            break
        }
    }

    private func rebuildAfterReset() {
        guard phase == .recording || phase == .paused else { return }
        wasInterrupted = true
        accumulateElapsed()
        writer?.closeCurrent()
        collectSegments()
        do {
            // The SAME engine instance, reconnected. Building a fresh one
            // here is the documented way to crash inside CoreAudio.
            engine.inputNode.removeTap(onBus: 0)
            engine.reset()
            try configureSession()
            try beginEngine()
            resumedAt = Date()
            phase = .recording
        } catch {
            errorMessage = "The recording stopped. Everything up to that point is safe."
            phase = .paused
        }
    }

    // MARK: - Bookkeeping

    private func collectSegments() {
        guard let writer else { return }
        let closed = writer.drainClosed()
        guard !closed.isEmpty else { return }
        segments.append(contentsOf: closed)
        writeManifest()
    }

    /// Written after every segment closes, so a session interrupted by a
    /// crash can be found and finished rather than left as loose files.
    private func writeManifest() {
        let manifest = LessonManifest(
            sessionId: sessionId, startedAt: startedAt, segments: segments
        )
        guard let data = try? JSONEncoder().encode(manifest) else { return }
        try? data.write(
            to: directory.appendingPathComponent("manifest.json"), options: .atomic
        )
    }

    private func accumulateElapsed() {
        if let resumedAt {
            accumulated += Date().timeIntervalSince(resumedAt)
            self.resumedAt = nil
        }
        elapsed = accumulated
    }

    private func startTicking() {
        stopTicking()
        // 10 Hz. The waveform is drawn from these samples, and at 4 Hz it
        // steps rather than moves.
        ticker = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                if self.phase == .recording, let resumedAt = self.resumedAt {
                    self.elapsed = self.accumulated + Date().timeIntervalSince(resumedAt)
                }
                self.level = self.writer?.currentLevel ?? 0
                // Rotation happens on the writer's own queue; this is only
                // the moment the UI learns a segment landed.
                self.collectSegments()
            }
        }
    }

    private func stopTicking() {
        ticker?.invalidate()
        ticker = nil
    }
}

// MARK: - Segment writer

/// Owns the files. Deliberately off the main actor: the tap callback
/// arrives on a real-time audio thread and must not wait on anything.
/// Buffers are handed to a serial queue, which is where every file
/// operation happens.
private final class SegmentWriter: @unchecked Sendable {

    private let directory: URL
    private let format: AVAudioFormat
    private let segmentSeconds: Double
    private let queue = DispatchQueue(label: "com.ponglens.lesson.writer")
    private let lock = NSLock()

    private var file: AVAudioFile?
    private var framesInSegment: AVAudioFramePosition = 0
    private var index = 0
    private var closed: [LessonSegment] = []
    private var smoothedLevel: Double = 0

    init(directory: URL, format: AVAudioFormat, segmentSeconds: Double) {
        self.directory = directory
        self.format = format
        self.segmentSeconds = segmentSeconds
    }

    var currentLevel: Double {
        lock.lock(); defer { lock.unlock() }
        return smoothedLevel
    }

    func drainClosed() -> [LessonSegment] {
        lock.lock(); defer { lock.unlock() }
        let out = closed
        closed = []
        return out
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        // Peak from this buffer, computed here because the copy below is
        // what the queue gets and we want the level to track live audio
        // rather than the write backlog.
        let peak = Self.peak(of: buffer)
        lock.lock()
        // Fast attack, slow release: a meter that falls instantly reads as
        // broken during the pauses in normal speech.
        smoothedLevel = peak > smoothedLevel
            ? peak
            : smoothedLevel * 0.85 + peak * 0.15
        lock.unlock()

        guard let copy = Self.copy(buffer) else { return }
        queue.async { [weak self] in
            self?.write(copy)
        }
    }

    func closeCurrent() {
        queue.sync { closeLocked() }
    }

    // MARK: - Queue-confined

    private func write(_ buffer: AVAudioPCMBuffer) {
        do {
            if file == nil { try open() }
            guard let file else { return }
            try file.write(from: buffer)
            framesInSegment += AVAudioFramePosition(buffer.frameLength)
            if Double(framesInSegment) / format.sampleRate >= segmentSeconds {
                closeLocked()
            }
        } catch {
            // A failed write must not take the lesson down. Close what is
            // open so it stays playable, and the next buffer opens a fresh
            // file.
            closeLocked()
        }
    }

    private func open() throws {
        let url = directory.appendingPathComponent(String(format: "seg-%03d.m4a", index))
        // AAC mono at 32 kbps: about 14 MB an hour, and speech at this rate
        // transcribes indistinguishably from a much larger file.
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: format.sampleRate,
            AVNumberOfChannelsKey: Int(format.channelCount),
            AVEncoderBitRateKey: 32_000,
        ]
        file = try AVAudioFile(
            forWriting: url,
            settings: settings,
            commonFormat: format.commonFormat,
            interleaved: format.isInterleaved
        )
        framesInSegment = 0
    }

    private func closeLocked() {
        guard let file else { return }
        let url = file.url
        let seconds = Double(framesInSegment) / format.sampleRate
        self.file = nil
        framesInSegment = 0
        guard seconds > 0.5 else {
            // Nothing worth transcribing; don't leave a stub behind.
            try? FileManager.default.removeItem(at: url)
            return
        }
        lock.lock()
        closed.append(
            LessonSegment(id: UUID(), url: url, index: index, seconds: seconds)
        )
        lock.unlock()
        index += 1
    }

    // MARK: - Helpers

    private static func copy(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let out = AVAudioPCMBuffer(
            pcmFormat: buffer.format, frameCapacity: buffer.frameLength
        ) else { return nil }
        out.frameLength = buffer.frameLength
        let channels = Int(buffer.format.channelCount)
        let frames = Int(buffer.frameLength)
        if let src = buffer.floatChannelData, let dst = out.floatChannelData {
            for ch in 0..<channels {
                dst[ch].update(from: src[ch], count: frames)
            }
        } else if let src = buffer.int16ChannelData, let dst = out.int16ChannelData {
            for ch in 0..<channels {
                dst[ch].update(from: src[ch], count: frames)
            }
        } else {
            return nil
        }
        return out
    }

    private static func peak(of buffer: AVAudioPCMBuffer) -> Double {
        let frames = Int(buffer.frameLength)
        guard frames > 0 else { return 0 }
        var maximum: Float = 0
        if let data = buffer.floatChannelData {
            for frame in stride(from: 0, to: frames, by: 8) {
                maximum = max(maximum, abs(data[0][frame]))
            }
        } else if let data = buffer.int16ChannelData {
            for frame in stride(from: 0, to: frames, by: 8) {
                maximum = max(maximum, abs(Float(data[0][frame]) / 32_768))
            }
        }
        // Speech sits low in a linear scale, so the meter is shaped rather
        // than raw or it barely leaves the floor across a room.
        return min(1, Double(maximum).squareRoot())
    }
}

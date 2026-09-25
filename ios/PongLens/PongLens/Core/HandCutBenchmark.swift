import BackgroundTasks
import Foundation
import UIKit

// Step 0 of the hand-cut plan (spec 2026-09-24, section 9): measure the
// phone's cut on a real iPhone 12 before building on it. Admin only,
// reached from Account > This iPhone > Cutting speed test.
//
// A run takes one video picked from Photos, keeps 20 seconds, drops 20,
// across the whole thing, and encodes exactly what a real phone cut would:
// the cut at source resolution plus one 720-wide clip per kept piece, with
// HandCutEncoder, the same type phase 2 cuts real matches with. It runs two
// ways: in the foreground, and as an iOS 26 continued processing task that
// is meant to keep going with the app in the background and the screen
// locked. Whether the hardware encoder survives that on an iPhone 12 is
// the open question; the run records what happened rather than assuming.
//
// Results are kept in Application Support so a run the system killed still
// shows up (as interrupted) on the next launch, and are shared as JSON.

@MainActor
@Observable
final class HandCutBenchmark {
    static let shared = HandCutBenchmark()

    /// Continued processing identifiers use wildcard notation: the
    /// Info.plist entry (BGTaskSchedulerPermittedIdentifiers) and the
    /// registration are this prefix plus ".*"; each submission adds its
    /// own suffix.
    static let taskPrefix = "com.ponglens.PongLens.handcut"
    static let taskWildcard = taskPrefix + ".*"

    enum Mode: String, Codable {
        case foreground
        case background
    }

    struct Source: Codable, Equatable {
        var name: String
        var info: HandCutSourceInfo
    }

    struct Output: Codable, Equatable, Identifiable {
        var id: String
        var label: String
        var mediaSeconds: Double
        var startedAt: Double
        var appStateAtStart: String
        var finishedAt: Double?
        var appStateAtFinish: String?
        var wallSeconds: Double?
        var bytes: Int64?
        var width: Int?
        var height: Int?
        var error: String?

        /// Seconds of video encoded per second of wall time.
        var speed: Double? {
            guard let wallSeconds, wallSeconds > 0 else { return nil }
            return mediaSeconds / wallSeconds
        }
    }

    struct Event: Codable, Equatable, Identifiable {
        var id = UUID()
        /// Seconds since the run started.
        var at: Double
        var kind: String
        var detail: String
    }

    struct Device: Codable, Equatable {
        var model: String
        var systemVersion: String
        var memoryGB: Double
        var cpuCount: Int
        var lowPowerMode: Bool
        var gpuBackgroundSupported: Bool
    }

    struct Run: Codable, Equatable, Identifiable {
        var id: UUID
        var mode: Mode
        var startedAt: Date
        var finishedAt: Date?
        var outcome: String?
        var device: Device
        var source: Source
        var segmentCount: Int
        var keptSeconds: Double
        var cutBitrate: Int
        var clipBitrate: Int
        var outputs: [Output] = []
        var events: [Event] = []
        var thermalStart: String
        var thermalEnd: String?
        var batteryStart: Double?
        var batteryEnd: Double?
        var batteryStateStart: String
        var backgroundRequested: Bool
        var backgroundGranted: Bool?
        var backgroundError: String?
        var expired = false
        var secondsInBackground: Double = 0
        var outputsFinishedInBackground = 0
        var plannedStarts: [Double] = []
        var compositionStarts: [Double] = []
        var measuredStarts: [Double] = []

        var totalWallSeconds: Double? { finishedAt.map { $0.timeIntervalSince(startedAt) } }
        var outputBytes: Int64 { outputs.compactMap(\.bytes).reduce(0, +) }
        /// Largest gap between where a segment should start in the cut
        /// and where its first frame landed.
        var worstStartDrift: Double? {
            guard !measuredStarts.isEmpty, measuredStarts.count == plannedStarts.count else { return nil }
            return zip(measuredStarts, plannedStarts).map { abs($0 - $1) }.max()
        }
    }

    // MARK: - State

    private(set) var runs: [Run] = []
    private(set) var current: Run?
    private(set) var progress: Double = 0
    private(set) var stage = ""
    private(set) var source: Source?
    private(set) var importing = false
    private(set) var importFraction: Double = 0
    private(set) var message: String?
    /// Submitted and waiting for the system to start the task.
    private(set) var awaitingBackgroundTask = false
    /// Bits per pixel per frame for both the cut and the clips.
    var bitsPerPixel: Double = 0.1

    @ObservationIgnored private var sourceURL: URL?
    @ObservationIgnored private var cancel: HandCutCancel?
    /// The continued processing task driving the current run, if any.
    @ObservationIgnored private var bgTask: BGContinuedProcessingTask?
    @ObservationIgnored private var observers: [NSObjectProtocol] = []
    @ObservationIgnored private var backgroundSince: Date?
    @ObservationIgnored private var importProgress: Progress?
    @ObservationIgnored private static var registrationAttempted = false
    @ObservationIgnored private static var registered = false

    var exportURL: URL { Self.exportFile }

    var running: Bool { current != nil || awaitingBackgroundTask }

    private init() {
        let data = try? Data(contentsOf: Self.storeFile)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        runs = (data.flatMap { try? decoder.decode([Run].self, from: $0) }) ?? []
        // A run with no end was killed with the app: that is a result too.
        var changed = false
        for i in runs.indices where runs[i].finishedAt == nil && runs[i].outcome == nil {
            runs[i].outcome = "Interrupted: the app stopped before the run finished"
            changed = true
        }
        // Nothing in the scratch folder belongs to a live run at launch.
        try? FileManager.default.removeItem(at: Self.scratch)
        if changed { persist() }
        writeExport()
    }

    // MARK: - Files

    nonisolated private static var scratch: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("handcut-bench", isDirectory: true)
    }

    nonisolated private static var storeFile: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("HandCutBenchmark", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("runs.json")
    }

    nonisolated private static var exportFile: URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("handcut-bench-export", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("ponglens-cutting-speed-test.json")
    }

    private func persist() {
        var all = runs
        if let current { all.insert(current, at: 0) }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? encoder.encode(all) {
            try? data.write(to: Self.storeFile, options: .atomic)
        }
        writeExport()
    }

    private func writeExport() {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? encoder.encode(runs) {
            try? data.write(to: Self.exportFile, options: .atomic)
        }
    }

    func clearResults() {
        guard current == nil else { return }
        runs = []
        persist()
    }

    // MARK: - Source

    /// The picked video, copied out of Photos into scratch space.
    func importSource(_ provider: NSItemProvider) {
        guard !running, !importing else { return }
        dropSource()
        importing = true
        importFraction = 0
        message = nil
        let name = provider.suggestedName ?? "Video"
        let progress = provider.loadFileRepresentation(forTypeIdentifier: "public.movie") { @Sendable url, error in
            // The system deletes its URL when this closure returns.
            var copied: URL?
            var failure = error.map { HandCutEncoder.describe($0) }
            if let url {
                let ext = url.pathExtension.isEmpty ? "mov" : url.pathExtension
                try? FileManager.default.createDirectory(at: Self.scratch, withIntermediateDirectories: true)
                let destination = Self.scratch.appendingPathComponent("source-\(UUID().uuidString).\(ext)")
                do {
                    try FileManager.default.copyItem(at: url, to: destination)
                    copied = destination
                } catch {
                    failure = HandCutEncoder.describe(error)
                }
            }
            let picked = copied
            let why = failure
            Task { @MainActor in
                await HandCutBenchmark.shared.finishImport(picked, name: name, failure: why)
            }
        }
        importProgress = progress
        Task { @MainActor in
            while self.importing {
                self.importFraction = progress.fractionCompleted
                try? await Task.sleep(for: .milliseconds(200))
            }
        }
    }

    private func finishImport(_ url: URL?, name: String, failure: String?) async {
        defer { importing = false; importProgress = nil }
        guard let url else {
            message = "Couldn't read that video. \(failure ?? "")"
            return
        }
        do {
            let info = try await HandCutEncoder.inspect(url)
            sourceURL = url
            source = Source(name: name, info: info)
        } catch {
            try? FileManager.default.removeItem(at: url)
            message = "Couldn't read that video. \(HandCutEncoder.describe(error))"
        }
    }

    func cancelImport() {
        importProgress?.cancel()
        importing = false
    }

    /// Delete the scratch copy of the source. Never while a run reads it.
    func dropSource() {
        guard !running else { return }
        if let sourceURL { try? FileManager.default.removeItem(at: sourceURL) }
        sourceURL = nil
        source = nil
    }

    // MARK: - Running

    func runForeground() {
        guard !running, source != nil else { return }
        let cancel = HandCutCancel()
        Task { _ = await execute(mode: .foreground, task: nil, cancel: cancel) }
    }

    /// Submit a continued processing task; the run starts when the system
    /// starts the task, which with the .fail strategy is now or never.
    func runInBackground() async {
        guard !running, let source else { return }
        message = nil
        guard registerIfNeeded() else {
            recordRefusal(source: source,
                          error: "The task handler could not be registered: \(Self.taskWildcard) is missing from BGTaskSchedulerPermittedIdentifiers in the built Info.plist.")
            return
        }
        let suffix = UUID().uuidString.prefix(8).lowercased()
        let request = BGContinuedProcessingTaskRequest(
            identifier: "\(Self.taskPrefix).bench-\(suffix)",
            title: "Cutting speed test", subtitle: "Starting")
        request.strategy = .fail
        awaitingBackgroundTask = true
        do {
            if #available(iOS 27.0, *) {
                try await BGTaskScheduler.shared.submitTaskRequest(request)
            } else {
                try BGTaskScheduler.shared.submit(request)
            }
        } catch {
            awaitingBackgroundTask = false
            recordRefusal(source: source, error: HandCutEncoder.describe(error))
        }
    }

    func cancelRun() {
        cancel?.cancel()
    }

    private func recordRefusal(source: Source, error: String) {
        var run = newRun(mode: .background, source: source, segments: [], cutBitrate: 0, clipBitrate: 0)
        run.backgroundGranted = false
        run.backgroundError = error
        run.finishedAt = Date()
        run.thermalEnd = run.thermalStart
        run.outcome = "Background processing was not granted"
        runs.insert(run, at: 0)
        persist()
    }

    /// Wildcard registration, once per process: registering the same
    /// identifier twice kills the app.
    private func registerIfNeeded() -> Bool {
        if Self.registrationAttempted { return Self.registered }
        Self.registrationAttempted = true
        Self.registered = BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.taskWildcard, using: nil
        ) { task in
            let box = TaskBox(task: task)
            Task { @MainActor in HandCutBenchmark.shared.backgroundTaskStarted(box) }
        }
        return Self.registered
    }

    private func backgroundTaskStarted(_ box: TaskBox) {
        awaitingBackgroundTask = false
        guard let task = box.task as? BGContinuedProcessingTask, current == nil, source != nil else {
            box.task.setTaskCompleted(success: false)
            return
        }
        let cancel = HandCutCancel()
        task.progress.totalUnitCount = 1000
        task.expirationHandler = {
            cancel.cancel()
            Task { @MainActor in HandCutBenchmark.shared.noteExpired() }
        }
        Task {
            let ok = await execute(mode: .background, task: task, cancel: cancel)
            task.setTaskCompleted(success: ok)
        }
    }

    private func noteExpired() {
        guard current != nil else { return }
        current?.expired = true
        event("background task", "Expired by the system")
        persist()
    }

    private func newRun(mode: Mode, source: Source, segments: [TimeWindow],
                        cutBitrate: Int, clipBitrate: Int) -> Run {
        let device = UIDevice.current
        device.isBatteryMonitoringEnabled = true
        return Run(
            id: UUID(), mode: mode, startedAt: Date(), device: Self.deviceInfo(), source: source,
            segmentCount: segments.count, keptSeconds: HandCutPlan.cutDuration(for: segments),
            cutBitrate: cutBitrate, clipBitrate: clipBitrate,
            thermalStart: Self.thermalName(ProcessInfo.processInfo.thermalState),
            batteryStart: device.batteryLevel >= 0 ? Double(device.batteryLevel) : nil,
            batteryStateStart: Self.batteryStateName(device.batteryState),
            backgroundRequested: mode == .background,
            backgroundGranted: mode == .background ? true : nil)
    }

    /// One whole run. Returns whether every output was written.
    private func execute(mode: Mode, task: BGContinuedProcessingTask?, cancel: HandCutCancel) async -> Bool {
        guard current == nil, let sourceURL, let source else { return false }
        let info = source.info
        let segments = HandCutPlan.alternating(duration: info.duration)
        let clipSize = HandCutPlan.clipEncodedSize(
            naturalWidth: Double(info.naturalWidth), naturalHeight: Double(info.naturalHeight),
            rotated: info.rotated)
        let cutBitrate = HandCutPlan.bitrate(
            width: info.naturalWidth, height: info.naturalHeight, fps: info.fps, bitsPerPixel: bitsPerPixel)
        let clipBitrate = HandCutPlan.bitrate(
            width: clipSize.width, height: clipSize.height, fps: info.fps, bitsPerPixel: bitsPerPixel)
        self.cancel = cancel
        bgTask = task
        current = newRun(mode: mode, source: source, segments: segments,
                         cutBitrate: cutBitrate, clipBitrate: clipBitrate)
        progress = 0
        startObserving()
        if mode == .background { event("background task", "Started by the system") }
        persist()

        let runDir = Self.scratch.appendingPathComponent(current!.id.uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: runDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: runDir) }

        let cutSeconds = HandCutPlan.cutDuration(for: segments)
        let totalMedia = max(0.001, cutSeconds * 2)   // the cut, then the same seconds again as clips
        var doneMedia = 0.0
        var allWritten = !segments.isEmpty
        var failuresInARow = 0
        var cancelled = false

        // The cut.
        if !segments.isEmpty {
            let output = runDir.appendingPathComponent("cut.mp4")
            beginOutput(id: "cut", label: "Cut", media: cutSeconds)
            task?.updateTitle("Cutting speed test", subtitle: "Cutting the video")
            stage = "Cutting the video"
            do {
                let result = try await HandCutEncoder.encodeCut(
                    source: sourceURL, segments: segments, to: output,
                    videoBitrate: cutBitrate, cancel: cancel,
                    progress: { fraction in
                        Task { @MainActor in
                            HandCutBenchmark.shared.relay(fraction, doneMedia: 0, span: cutSeconds,
                                                          total: totalMedia, label: "Cutting the video")
                        }
                    })
                finishOutput(id: "cut", file: result.file)
                current?.plannedStarts = result.plannedStarts
                current?.compositionStarts = result.compositionStarts
                current?.measuredStarts = result.measuredStarts
                try? FileManager.default.removeItem(at: output)
                failuresInARow = 0
            } catch HandCutEncoderError.cancelled {
                failOutput(id: "cut", error: "Cancelled")
                cancelled = true
            } catch {
                failOutput(id: "cut", error: HandCutEncoder.describe(error))
                allWritten = false
                failuresInARow += 1
            }
            doneMedia += cutSeconds
            persist()
        }

        // One clip per kept piece.
        for (i, window) in segments.enumerated() where !cancelled && failuresInARow < 3 {
            let id = "clip-\(i + 1)"
            let label = "Clip \(i + 1) of \(segments.count)"
            let output = runDir.appendingPathComponent("\(id).mp4")
            beginOutput(id: id, label: label, media: window.duration)
            task?.updateTitle("Cutting speed test", subtitle: label)
            let before = doneMedia
            do {
                let file = try await HandCutEncoder.encodeClip(
                    source: sourceURL, window: window, to: output,
                    videoBitrate: clipBitrate, cancel: cancel,
                    progress: { fraction in
                        Task { @MainActor in
                            HandCutBenchmark.shared.relay(fraction, doneMedia: before, span: window.duration,
                                                          total: totalMedia, label: label)
                        }
                    })
                finishOutput(id: id, file: file)
                try? FileManager.default.removeItem(at: output)
                failuresInARow = 0
            } catch HandCutEncoderError.cancelled {
                failOutput(id: id, error: "Cancelled")
                cancelled = true
            } catch {
                failOutput(id: id, error: HandCutEncoder.describe(error))
                allWritten = false
                failuresInARow += 1
            }
            doneMedia += window.duration
            persist()
        }
        if failuresInARow >= 3 { allWritten = false }

        // Close the run.
        stopObserving()
        let device = UIDevice.current
        var run = current!
        run.finishedAt = Date()
        run.thermalEnd = Self.thermalName(ProcessInfo.processInfo.thermalState)
        run.batteryEnd = device.batteryLevel >= 0 ? Double(device.batteryLevel) : nil
        if let backgroundSince {
            run.secondsInBackground += Date().timeIntervalSince(backgroundSince)
            self.backgroundSince = nil
        }
        if run.expired {
            run.outcome = "Stopped: the system expired the background task"
        } else if cancelled {
            run.outcome = "Cancelled"
        } else if segments.isEmpty {
            run.outcome = "Nothing to encode: the video is shorter than a second"
        } else if allWritten {
            run.outcome = "Finished"
        } else if failuresInARow >= 3 {
            run.outcome = "Stopped after three failures in a row"
        } else {
            run.outcome = "Finished with errors"
        }
        runs.insert(run, at: 0)
        current = nil
        self.cancel = nil
        bgTask = nil
        progress = 0
        stage = ""
        persist()
        return allWritten && !cancelled && !run.expired
    }

    private func relay(_ fraction: Double, doneMedia: Double, span: Double, total: Double, label: String) {
        guard current != nil else { return }
        progress = min(1, (doneMedia + fraction * span) / total)
        stage = label
        // A continued processing task that stops reporting progress looks
        // stalled, and the system may expire it.
        bgTask?.progress.completedUnitCount = Int64(progress * 1000)
    }

    private var elapsed: Double {
        current.map { Date().timeIntervalSince($0.startedAt) } ?? 0
    }

    private func beginOutput(id: String, label: String, media: Double) {
        current?.outputs.append(Output(
            id: id, label: label, mediaSeconds: media, startedAt: elapsed,
            appStateAtStart: Self.appStateName(UIApplication.shared.applicationState)))
    }

    private func finishOutput(id: String, file: HandCutFileOutput) {
        guard let i = current?.outputs.firstIndex(where: { $0.id == id }) else { return }
        let state = UIApplication.shared.applicationState
        current?.outputs[i].finishedAt = elapsed
        current?.outputs[i].appStateAtFinish = Self.appStateName(state)
        current?.outputs[i].wallSeconds = file.wallSeconds
        current?.outputs[i].bytes = file.bytes
        current?.outputs[i].width = file.width
        current?.outputs[i].height = file.height
        if state == .background { current?.outputsFinishedInBackground += 1 }
    }

    private func failOutput(id: String, error: String) {
        guard let i = current?.outputs.firstIndex(where: { $0.id == id }) else { return }
        current?.outputs[i].finishedAt = elapsed
        current?.outputs[i].appStateAtFinish = Self.appStateName(UIApplication.shared.applicationState)
        current?.outputs[i].error = error
    }

    private func event(_ kind: String, _ detail: String) {
        current?.events.append(Event(at: elapsed, kind: kind, detail: detail))
    }

    // MARK: - What the phone is doing meanwhile

    private func startObserving() {
        stopObserving()
        backgroundSince = UIApplication.shared.applicationState == .background ? Date() : nil
        let center = NotificationCenter.default
        func on(_ name: Notification.Name, _ body: @escaping @MainActor () -> Void) {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { _ in
                MainActor.assumeIsolated { body() }
            })
        }
        on(ProcessInfo.thermalStateDidChangeNotification) { [weak self] in
            self?.event("thermal", Self.thermalName(ProcessInfo.processInfo.thermalState))
            self?.persist()
        }
        on(.NSProcessInfoPowerStateDidChange) { [weak self] in
            self?.event("low power mode", ProcessInfo.processInfo.isLowPowerModeEnabled ? "on" : "off")
        }
        on(UIDevice.batteryLevelDidChangeNotification) { [weak self] in
            let level = UIDevice.current.batteryLevel
            if level >= 0 { self?.event("battery", "\(Int((level * 100).rounded()))%") }
        }
        on(UIApplication.didEnterBackgroundNotification) { [weak self] in
            self?.backgroundSince = Date()
            self?.event("app", "background")
            self?.persist()
        }
        on(UIApplication.willEnterForegroundNotification) { [weak self] in
            guard let self else { return }
            if let since = self.backgroundSince {
                self.current?.secondsInBackground += Date().timeIntervalSince(since)
                self.backgroundSince = nil
            }
            self.event("app", "foreground")
            self.persist()
        }
        on(UIApplication.protectedDataWillBecomeUnavailableNotification) { [weak self] in
            self?.event("screen", "locked")
            self?.persist()
        }
        on(UIApplication.protectedDataDidBecomeAvailableNotification) { [weak self] in
            self?.event("screen", "unlocked")
        }
    }

    private func stopObserving() {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers = []
    }

    // MARK: - Names

    static func thermalName(_ state: ProcessInfo.ThermalState) -> String {
        switch state {
        case .nominal: "nominal"
        case .fair: "fair"
        case .serious: "serious"
        case .critical: "critical"
        @unknown default: "unknown"
        }
    }

    static func appStateName(_ state: UIApplication.State) -> String {
        switch state {
        case .active: "active"
        case .inactive: "inactive"
        case .background: "background"
        @unknown default: "unknown"
        }
    }

    static func batteryStateName(_ state: UIDevice.BatteryState) -> String {
        switch state {
        case .unplugged: "unplugged"
        case .charging: "charging"
        case .full: "full"
        case .unknown: "unknown"
        @unknown default: "unknown"
        }
    }

    static func deviceInfo() -> Device {
        var system = utsname()
        uname(&system)
        var model = withUnsafeBytes(of: &system.machine) { raw in
            String(decoding: raw.prefix(while: { $0 != 0 }), as: UTF8.self)
        }
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] {
            model = "\(simulated) (simulator)"
        }
        return Device(
            model: model,
            systemVersion: "\(UIDevice.current.systemName) \(UIDevice.current.systemVersion)",
            memoryGB: Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824,
            cpuCount: ProcessInfo.processInfo.processorCount,
            lowPowerMode: ProcessInfo.processInfo.isLowPowerModeEnabled,
            gpuBackgroundSupported: BGTaskScheduler.supportedResources.contains(.gpu))
    }
}

/// The scheduler hands its task over on its own queue; this carries it to
/// the main actor, where every use of it happens.
private struct TaskBox: @unchecked Sendable {
    let task: BGTask
}

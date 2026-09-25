import AVFoundation
import BackgroundTasks
import Foundation
import Supabase
import UIKit

// Cutting a hand-marked match on the phone (spec 2026-09-24 section 7,
// contract docs/superpowers/specs/2026-09-25-device-hand-cut-contract.md).
//
// When the phone holds the match's video, "Cut the match" claims the job
// with claim_device_hand_cut instead of claim_hand_cut, and this queue does
// the Mac's work here: plan (CutPlan), encode the cut and one clip per point
// (HandCutEncoder), upload them through the route, write the manifest last,
// and submit. The Mac then only checks and publishes, and cuts the match
// itself from the same marks if anything disagrees.
//
// What decides each step lives in DeviceCutJob.swift and is tested headless.
// This file is the part that needs a phone:
//
//  - **One checkpoint per file.** The job and every finished file are kept
//    in Application Support, so a crash, a relaunch or an expired background
//    task resumes after the last finished file, never from the start.
//  - **The player never learns where it cuts.** The match page shows the
//    ordinary processing card with the hand cut's own stage names, and
//    whenever the phone cannot cut or cannot finish, it hands the job to the
//    server silently (release_device_hand_cut with to_mac true), which cuts
//    the match from the same marks.
//  - **The background.** Encoding runs under an iOS 26 continued processing
//    task with visible progress when the system grants one. When it does
//    not, or the task expires, and the app leaves the screen with encoding
//    still to do, the job is handed over. The uploads run on a background
//    URLSession, so they continue regardless.
//  - **Heat, power, space.** Between files: serious heat waits; critical
//    heat, Low Power Mode or too little space hand the job over. So does an
//    encode that fails twice.
//  - **The server has the last word.** Every report can answer that the job
//    is no longer the phone's (released, submitted, or taken over after 15
//    minutes without a report); the phone then stops and throws its files
//    away, quietly.

extension Notification.Name {
    /// A phone cut started, finished, stopped or went to the Mac. The object
    /// is the match id.
    static let deviceHandCutChanged = Notification.Name("deviceHandCutChanged")
}

// MARK: - Talking to the server

/// The route's request body (contract section 4). Only the fields an action
/// needs are sent; nil ones are left out.
nonisolated struct DeviceCutRouteRequest: Encodable, Sendable {
    nonisolated struct Part: Encodable, Sendable {
        let PartNumber: Int
        let ETag: String
    }

    var action: String
    var jobId: String
    var fileSize: Int64? = nil
    var uploadId: String? = nil
    var partNumber: Int? = nil
    var parts: [Part]? = nil
    var keys: [String]? = nil
    var toMac: Bool? = nil
}

/// Everything the phone says to the server about a phone cut. The live one
/// is the database and the route; the simulator QA run swaps in one that
/// keeps "uploads" in a folder.
@MainActor
protocol DeviceCutTransport: AnyObject {
    func enabled(userId: UUID) async -> Bool
    func claim(matchId: UUID, marks: [HandCutSubmission]) async throws -> DeviceCutClaim
    func report(jobId: UUID, stage: String, progress: Int) async throws -> DeviceCutReportAnswer
    func route(_ request: DeviceCutRouteRequest) async throws -> DeviceCutRouteAnswer
    /// A PUT from memory: the manifest.
    func put(_ data: Data, to url: URL, contentType: String) async throws
}

@MainActor
final class LiveDeviceCutTransport: DeviceCutTransport {
    private nonisolated struct Gate: Encodable, Sendable { let p_user: String }
    private nonisolated struct Claim: Encodable {
        let p_match_id: String
        let p_marks: [HandCutSubmission]
    }
    private nonisolated struct Report: Encodable, Sendable {
        let p_job: String
        let p_stage: String
        let p_progress: Int
    }

    /// device_hand_cut_enabled(auth.uid()): the authoritative answer. An
    /// unreadable one (including a server without the phone cut) means no.
    func enabled(userId: UUID) async -> Bool {
        (try? await supa.rpc("device_hand_cut_enabled",
                             params: Gate(p_user: userId.uuidString.lowercased())).execute().value) ?? false
    }

    func claim(matchId: UUID, marks: [HandCutSubmission]) async throws -> DeviceCutClaim {
        try await supa.rpc("claim_device_hand_cut",
                           params: Claim(p_match_id: matchId.uuidString.lowercased(), p_marks: marks))
            .execute().value
    }

    func report(jobId: UUID, stage: String, progress: Int) async throws -> DeviceCutReportAnswer {
        try await supa.rpc("report_device_hand_cut",
                           params: Report(p_job: jobId.uuidString.lowercased(), p_stage: stage, p_progress: progress))
            .execute().value
    }

    func route(_ request: DeviceCutRouteRequest) async throws -> DeviceCutRouteAnswer {
        let (status, data) = try await API.postForStatus("api/hand-cut/device", request)
        return DeviceCutRouteAnswer(status: status, data: data)
    }

    func put(_ data: Data, to url: URL, contentType: String) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        let (_, response) = try await URLSession.shared.upload(for: request, from: data)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
    }
}

// MARK: - Sending files

/// Where the files go. `send` hands one file over; its end comes back
/// through `DeviceHandCutQueue.transferFinished`.
@MainActor
protocol DeviceCutUploader: AnyObject {
    func send(file: URL, to url: URL, contentType: String?, name: String)
    /// Transfers still running from before this launch.
    func inFlight() async -> Set<String>
    func cancel(jobId: UUID) async
}

/// A background URLSession: the system owns the transfers, so they carry on
/// with the app suspended, the screen locked or the app killed, and wake
/// the app when they end.
@MainActor
final class DeviceCutSession: NSObject, DeviceCutUploader {
    static let identifier = "com.ponglens.PongLens.handcut.uploads"

    var backgroundCompletionHandler: (() -> Void)?

    lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.identifier)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.timeoutIntervalForResource = 24 * 3600
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    func send(file: URL, to url: URL, contentType: String?, name: String) {
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        if let contentType { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        let task = session.uploadTask(with: request, fromFile: file)
        task.taskDescription = name
        task.resume()
    }

    func inFlight() async -> Set<String> {
        Set(await session.allTasks.compactMap(\.taskDescription))
    }

    func cancel(jobId: UUID) async {
        let prefix = jobId.uuidString.lowercased() + "|"
        for task in await session.allTasks where task.taskDescription?.hasPrefix(prefix) == true {
            task.cancel()
        }
    }
}

extension DeviceCutSession: URLSessionDataDelegate {
    nonisolated func urlSession(
        _ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?
    ) {
        let name = task.taskDescription
        let http = task.response as? HTTPURLResponse
        let status = http?.statusCode ?? 0
        let etag = http?.value(forHTTPHeaderField: "ETag")
        let failed = error != nil
        Task { @MainActor in
            guard let name else { return }
            DeviceHandCutQueue.shared.transferFinished(name: name, status: status, etag: etag, failed: failed)
        }
    }

    nonisolated func urlSession(
        _ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
        totalBytesSent: Int64, totalBytesExpectedToSend: Int64
    ) {
        let name = task.taskDescription
        Task { @MainActor in
            guard let name else { return }
            DeviceHandCutQueue.shared.transferProgress(name: name, sent: totalBytesSent)
        }
    }

    nonisolated func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        Task { @MainActor in
            self.backgroundCompletionHandler?()
            self.backgroundCompletionHandler = nil
        }
    }
}

/// The scheduler hands its task over on its own queue; this carries it to
/// the main actor, where every use of it happens.
private struct DeviceCutTaskBox: @unchecked Sendable {
    let task: BGTask
}

// MARK: - The queue

@MainActor
@Observable
final class DeviceHandCutQueue {
    static let shared = DeviceHandCutQueue()

    /// What the match page shows for a job this phone is cutting: the
    /// ordinary processing card's title and bar, nothing more.
    struct Live: Equatable {
        var step: DeviceCutStep = .encodeCut
        var progress = 0

        var title: String { DeviceCutCopy.title(step: step) }
    }

    enum Start: Equatable {
        case started(UUID)
        /// Not a phone cut after all: claim_hand_cut, the Mac cuts it.
        case useMac
        /// The claim was refused; the marker shows the sentence.
        case refused(String)
    }

    private(set) var jobs: [DeviceCutJob] = []
    private(set) var live: [UUID: Live] = [:]

    // Swappable for the simulator QA run.
    @ObservationIgnored var transport: any DeviceCutTransport = LiveDeviceCutTransport()
    @ObservationIgnored var uploader: any DeviceCutUploader
    @ObservationIgnored var sourceFile: (UUID) -> URL? = { LocalMatchVideos.url(for: $0) }
    @ObservationIgnored var currentUser: () async -> UUID? = { try? await supa.auth.session.user.id }
    @ObservationIgnored var backgroundTasksAllowed = true
    /// QA only: stop the process after this many clips, to prove the resume.
    @ObservationIgnored var crashAfterClips: Int?

    @ObservationIgnored private let session: DeviceCutSession
    @ObservationIgnored private var driving: Set<UUID> = []
    @ObservationIgnored private var awaitingTask: Set<UUID> = []
    @ObservationIgnored private var tasks: [UUID: BGContinuedProcessingTask] = [:]
    @ObservationIgnored private var cancels: [UUID: HandCutCancel] = [:]
    @ObservationIgnored private var expired: Set<UUID> = []
    @ObservationIgnored private var released: Set<UUID> = []
    @ObservationIgnored private var handingOver: Set<UUID> = []
    /// Background time asked for while a hand-over is in the air.
    @ObservationIgnored private var graces: [UUID: UIBackgroundTaskIdentifier] = [:]
    @ObservationIgnored private var waiters: [UUID: CheckedContinuation<Void, Never>] = [:]
    /// Wakes that came while nothing was waiting.
    @ObservationIgnored private var woken: Set<UUID> = []
    @ObservationIgnored private var napTokens: [UUID: UUID] = [:]
    @ObservationIgnored private var sending: Set<String> = []
    @ObservationIgnored private var sentBytes: [String: Int64] = [:]
    @ObservationIgnored private var reconciled: Set<UUID> = []
    @ObservationIgnored private var reporting: Set<UUID> = []
    @ObservationIgnored private var fraction: [UUID: Double] = [:]
    @ObservationIgnored private var backoffs: [UUID: Int] = [:]
    @ObservationIgnored private var seeded = false
    @ObservationIgnored private var observers: [NSObjectProtocol] = []
    /// Registering the same task identifier twice kills the app.
    @ObservationIgnored private static var registered: Set<String> = []

    private init() {
        session = DeviceCutSession()
        uploader = session
        jobs = Self.load()
        // Files no job points at: a job finished or released while the
        // app was not there to clean up.
        let names = (try? FileManager.default.contentsOfDirectory(atPath: Self.root.path)) ?? []
        let known = Set(jobs.map { $0.jobId.uuidString.lowercased() })
        for name in names where name != Self.stateFileName && !known.contains(name) {
            try? FileManager.default.removeItem(at: Self.root.appendingPathComponent(name))
        }
        // Recreate the background session now, so transfers that ended while
        // the app was gone deliver their events to this launch.
        _ = session.session
        for job in jobs { live[job.jobId] = Live(step: DeviceCutFlow.next(job), progress: DeviceCutFlow.progress(job, step: DeviceCutFlow.next(job))) }
        observe()
    }

    // MARK: Files

    static let stateFileName = "jobs.json"

    static var root: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("DeviceHandCut", isDirectory: true)
        if !FileManager.default.fileExists(atPath: base.path) {
            try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
            var url = base
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? url.setResourceValues(values)
        }
        return base
    }

    static func directory(_ jobId: UUID) -> URL {
        let dir = root.appendingPathComponent(jobId.uuidString.lowercased(), isDirectory: true)
        try? FileManager.default.createDirectory(at: dir.appendingPathComponent("clips"), withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: dir.appendingPathComponent("parts"), withIntermediateDirectories: true)
        return dir
    }

    static func cutFile(_ jobId: UUID) -> URL { directory(jobId).appendingPathComponent("cut.mp4") }
    static func clipFile(_ jobId: UUID, _ clip: String) -> URL {
        directory(jobId).appendingPathComponent("clips").appendingPathComponent(clip)
    }
    static func partFile(_ jobId: UUID, _ n: Int) -> URL {
        directory(jobId).appendingPathComponent("parts").appendingPathComponent("part-\(n).bin")
    }

    private static func load() -> [DeviceCutJob] {
        guard let data = try? Data(contentsOf: root.appendingPathComponent(stateFileName)) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return (try? decoder.decode([DeviceCutJob].self, from: data)) ?? []
    }

    private func persist() {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        if let data = try? encoder.encode(jobs) {
            try? data.write(to: Self.root.appendingPathComponent(Self.stateFileName), options: .atomic)
        }
    }

    func job(_ jobId: UUID) -> DeviceCutJob? { jobs.first { $0.jobId == jobId } }

    func job(forMatch matchId: UUID) -> DeviceCutJob? { jobs.first { $0.matchId == matchId } }

    /// Nil once the phone has stopped: the job is going (or has gone) to
    /// the server, and the page reads the server's job row like any other.
    func live(forMatch matchId: UUID) -> Live? {
        guard let job = job(forMatch: matchId), job.stop == nil else { return nil }
        return live[job.jobId] ?? Live()
    }

    private func update(_ jobId: UUID, _ change: (inout DeviceCutJob) -> Void) {
        guard let i = jobs.firstIndex(where: { $0.jobId == jobId }) else { return }
        change(&jobs[i])
        persist()
    }

    private func setLive(_ jobId: UUID, _ change: (inout Live) -> Void) {
        var value = live[jobId] ?? Live()
        change(&value)
        if value != live[jobId] { live[jobId] = value }
    }

    // MARK: Starting

    /// "Cut the match" on a match whose video this phone holds. Reads the
    /// video and plans before claiming anything, so a match the phone
    /// should not cut goes to the Mac without a phone job ever existing.
    func start(match: MatchRow, marks: [HandCutMark]) async -> Start {
        await start(matchId: match.id, ownerId: match.userId, durationS: match.durationS,
                    marks: HandCut.submittable(marks))
    }

    /// The same, from exactly what claim_hand_cut is sent.
    func start(matchId: UUID, ownerId: UUID, durationS: Double?, marks submittable: [HandCutSubmission]) async -> Start {
        guard let uid = await currentUser(), uid == ownerId,
              let file = sourceFile(matchId),
              await transport.enabled(userId: uid)
        else { return .useMac }
        guard let info = try? await HandCutEncoder.inspect(file) else { return .useMac }
        let source = DeviceCutSource(
            duration: info.duration, fps: info.fps, width: info.naturalWidth, height: info.naturalHeight,
            rotation: info.rotationDegrees, hasAudio: info.hasAudio, bytes: info.bytes)
        let plan = CutPlan.plan(marks: submittable.map { [$0.t0, $0.t1] }, duration: source.duration)
        // Plans the Mac would refuse, a length that disagrees with the
        // match, a cut too large to send, or a phone that cannot start: the
        // Mac cuts it, exactly as from the web.
        guard CutPlan.macRefusal(plan) == nil,
              CutPlan.durationAgrees(phone: source.duration, row: durationS),
              !DeviceCutGuard.cutTooLarge(plan: plan, source: source)
        else { return .useMac }
        if case .hold(_) = conditions(needed: DeviceCutGuard.bytesNeeded(plan: plan, source: source)) {
            return .useMac
        }

        let claim: DeviceCutClaim
        do {
            claim = try await transport.claim(matchId: matchId, marks: submittable)
        } catch {
            let postgrest = error as? PostgrestError
            let message = [postgrest?.code ?? "", postgrest?.message ?? error.localizedDescription].joined(separator: " ")
            switch DeviceCutClaimOutcome.from(message: message) {
            case .useMac: return .useMac
            case .refused(let sentence): return .refused(sentence)
            }
        }
        let job = DeviceCutJob(claim: claim, matchId: matchId, userId: uid, source: source, plan: plan)
        for stale in jobs where stale.matchId == matchId {
            try? FileManager.default.removeItem(at: Self.root.appendingPathComponent(stale.jobId.uuidString.lowercased()))
            live[stale.jobId] = nil
        }
        jobs.removeAll { $0.matchId == matchId }
        jobs.append(job)
        persist()
        live[job.jobId] = Live()
        NotificationCenter.default.post(name: .deviceHandCutChanged, object: matchId)
        if claim.mismatch(with: plan) != nil {
            // The server's keys do not fit the plan: the phone cannot upload
            // what the Mac would accept. The server cuts the same marks.
            await handOver(job.jobId, because: .mismatch)
            return .started(job.jobId)
        }
        kick(job.jobId)
        return .started(job.jobId)
    }

    /// Pick up every job of the signed-in account: at launch, when the app
    /// comes back to the front, when a match page opens.
    func resume() {
        Task {
            guard let uid = await currentUser() else { return }
            for job in jobs where job.userId == uid { kick(job.jobId) }
        }
    }

    // MARK: Running

    /// Start (or restart) the work on a job. While encoding remains and the
    /// app is on screen, ask for a continued processing task first.
    private func kick(_ jobId: UUID) {
        guard !driving.contains(jobId), !awaitingTask.contains(jobId), let job = job(jobId) else { return }
        let wantsTask = backgroundTasksAllowed && !job.encodingDone && job.stop == nil
            && tasks[jobId] == nil && UIApplication.shared.applicationState == .active
        guard wantsTask else {
            Task { await drive(jobId) }
            return
        }
        awaitingTask.insert(jobId)
        Task {
            let submitted = await requestBackgroundTask(jobId)
            // With the .fail strategy a granted task starts at once; if its
            // handler has not arrived in a few seconds, work in the front.
            if submitted { try? await Task.sleep(for: .seconds(6)) }
            if awaitingTask.remove(jobId) != nil {
                await drive(jobId)
            }
        }
    }

    private func requestBackgroundTask(_ jobId: UUID) async -> Bool {
        let suffix = UUID().uuidString.prefix(8).lowercased()
        let identifier = "\(HandCutBenchmark.taskPrefix).cut-\(suffix)"
        guard !Self.registered.contains(identifier) else { return false }
        let ok = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
            let box = DeviceCutTaskBox(task: task)
            Task { @MainActor in DeviceHandCutQueue.shared.taskStarted(box, jobId: jobId) }
        }
        guard ok else { return false }
        Self.registered.insert(identifier)
        let request = BGContinuedProcessingTaskRequest(
            identifier: identifier, title: "Cutting your match", subtitle: DeviceCutCopy.cutting)
        request.strategy = .fail
        do {
            if #available(iOS 27.0, *) {
                try await BGTaskScheduler.shared.submitTaskRequest(request)
            } else {
                try BGTaskScheduler.shared.submit(request)
            }
            return true
        } catch {
            return false
        }
    }

    private func taskStarted(_ box: DeviceCutTaskBox, jobId: UUID) {
        guard let task = box.task as? BGContinuedProcessingTask else {
            box.task.setTaskCompleted(success: false)
            return
        }
        guard job(jobId) != nil else {
            task.setTaskCompleted(success: true)
            return
        }
        tasks[jobId] = task
        task.progress.totalUnitCount = 100
        let cancel = cancels[jobId]
        task.expirationHandler = {
            cancel?.cancel()
            Task { @MainActor in DeviceHandCutQueue.shared.taskExpired(jobId) }
        }
        if awaitingTask.remove(jobId) != nil || !driving.contains(jobId) {
            Task { await drive(jobId) }
        }
    }

    /// The system (or the player, from its progress view) took the
    /// continued processing task away. With encoding still to do, the phone
    /// cannot count on finishing, so the server cuts it. Uploads need no
    /// task and carry on.
    private func taskExpired(_ jobId: UUID) {
        expired.insert(jobId)
        cancels[jobId]?.cancel()
        tasks.removeValue(forKey: jobId)?.setTaskCompleted(success: false)
        wake(jobId)
        if let job = job(jobId), job.stop == nil, !job.encodingDone,
           beginHandOver(jobId, because: .background) {
            Task { await finishHandOver(jobId) }
        }
    }

    private enum Outcome {
        /// The step finished or will be tried again: go on.
        case next
        /// Stop driving for now; a resume picks it up.
        case pause
    }

    /// The whole job, one step at a time, until it is submitted, stopped,
    /// or has to wait for the app or the system.
    private func drive(_ jobId: UUID) async {
        guard !driving.contains(jobId) else { return }
        driving.insert(jobId)
        let cancel = HandCutCancel()
        cancels[jobId] = cancel
        var finished = false
        defer {
            driving.remove(jobId)
            cancels[jobId] = nil
            expired.remove(jobId)
            if let task = tasks.removeValue(forKey: jobId) { task.setTaskCompleted(success: finished) }
        }
        await seedInFlight()
        // Only the account that claimed it works on it.
        guard let owner = job(jobId)?.userId, await currentUser() == owner else { return }
        while !cancel.isCancelled, !expired.contains(jobId), let job = job(jobId) {
            let step = DeviceCutFlow.next(job)
            setLive(jobId) {
                $0.step = step
                $0.progress = DeviceCutFlow.progress(job, step: step, fraction: fraction[jobId] ?? 0,
                                                    inflightBytes: inflight(jobId))
            }
            let outcome: Outcome
            switch step {
            case .finished:
                finished = true
                wrapUp(jobId)
                return
            case .stopped(let stop):
                // Whatever stopped the phone, the server cuts the match from
                // the same marks.
                await handOver(jobId, because: stop)
                return
            case .encodeCut, .encodeClip:
                outcome = await encode(jobId, step: step, cancel: cancel)
            case .prepareUpload:
                outcome = await prepareUpload(jobId)
            case .upload(let parts, let clips):
                outcome = await upload(jobId, parts: parts, clips: clips)
            case .completeCut:
                outcome = await completeCut(jobId)
            case .uploadManifest:
                outcome = await uploadManifest(jobId)
            case .submit:
                outcome = await submit(jobId)
                if case .next = outcome, self.job(jobId)?.submitted == true {
                    finished = true
                }
            }
            if case .pause = outcome { return }
        }
    }

    // MARK: Encoding

    private func conditions(needed: Int64) -> DeviceCutGuard.Decision {
        let info = ProcessInfo.processInfo
        let free = (try? URL(fileURLWithPath: NSHomeDirectory())
            .resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
            .volumeAvailableCapacityForImportantUsage) ?? nil
        return DeviceCutGuard.decide(thermal: info.thermalState.rawValue, lowPower: info.isLowPowerModeEnabled,
                                     freeBytes: free, neededBytes: needed)
    }

    private func encode(_ jobId: UUID, step: DeviceCutStep, cancel: HandCutCancel) async -> Outcome {
        guard let job = job(jobId) else { return .pause }
        guard let source = sourceFile(job.matchId) else {
            // The video was deleted from this iPhone: only the server can
            // finish the cut now.
            await handOver(jobId, because: .sourceGone)
            return .pause
        }
        // Encoding needs the app on screen or a continued processing task.
        if UIApplication.shared.applicationState == .background, tasks[jobId] == nil {
            await handOver(jobId, because: .background)
            return .pause
        }
        switch conditions(needed: DeviceCutGuard.bytesNeeded(job)) {
        case .hold(let hold):
            await handOver(jobId, because: DeviceCutStop(hold))
            return .pause
        case .cool:
            // Serious heat: wait between files. The server hears "paused";
            // the player's card still reads as cutting.
            guard await report(jobId, step: step, paused: true) else { return .pause }
            await nap(jobId, seconds: 20)
            return .next
        case .go:
            break
        }
        guard await report(jobId, step: step, paused: false) else { return .pause }
        updateTask(jobId, step: step)
        fraction[jobId] = 0
        defer { fraction[jobId] = nil }
        let relay: @Sendable (Double) -> Void = { f in
            Task { @MainActor in DeviceHandCutQueue.shared.encodeProgress(jobId, step: step, fraction: f) }
        }
        do {
            switch step {
            case .encodeCut:
                let output = Self.cutFile(jobId)
                let result = try await HandCutEncoder.encodePlannedCut(
                    source: source, segments: job.cutSegments, offsets: job.plannedOffsets, to: output,
                    videoBitrate: job.cutVideoBitrate, audioBitrate: DeviceCutSettings.cutAudioBitrate,
                    cancel: cancel, progress: relay)
                let cut = DeviceCutJob.CutResult(
                    bytes: result.file.bytes, duration: result.file.mediaSeconds,
                    width: result.file.width, height: result.file.height,
                    measuredOffsets: result.compositionStarts, firstFrames: result.measuredStarts,
                    wall: result.file.wallSeconds)
                // The Mac's own checks of the phone's clock, before a byte
                // is sent: a cut it would redo is redone here instead.
                var candidate = job
                candidate.cut = cut
                if DeviceCutManifest.build(candidate)?.selfCheck(
                    plannedOffsets: job.plannedOffsets, expectedPoints: job.points.count) != nil {
                    try? FileManager.default.removeItem(at: output)
                    update(jobId) { DeviceCutFlow.recordFailure(&$0, step: step, interrupted: false) }
                    return .next
                }
                update(jobId) { $0.cut = cut }
            case .encodeClip(let idx):
                guard let point = job.points.first(where: { $0.idx == idx }) else { return .pause }
                let seconds = point.clipT1 - point.clipT0
                let file = try await HandCutEncoder.encodeClip(
                    source: source, window: TimeWindow(start: point.clipT0, end: point.clipT1),
                    to: Self.clipFile(jobId, point.clip),
                    videoBitrate: DeviceCutSettings.clipVideoBitrate(seconds: seconds),
                    audioBitrate: DeviceCutSettings.clipAudioBitrate, width: DeviceCutSettings.clipWidth,
                    cancel: cancel, progress: relay)
                update(jobId) {
                    $0.clips.removeAll { $0.idx == idx }
                    $0.clips.append(.init(idx: idx, bytes: file.bytes, wall: file.wallSeconds))
                    $0.clipsWall += file.wallSeconds
                }
                #if DEBUG && targetEnvironment(simulator)
                if let crash = crashAfterClips, (self.job(jobId)?.clips.count ?? 0) >= crash {
                    crashAfterClips = nil
                    DeviceCutQA.noteCrash()
                    exit(0)
                }
                #endif
            default:
                return .pause
            }
            backoffs[jobId] = nil
            return .next
        } catch {
            // Backgrounded without a task, an expired task, a hand-over: none
            // of those is the encoder failing, and each already sees to the
            // job (the background observer, taskExpired, handOver).
            let interrupted = released.contains(jobId) || expired.contains(jobId) || cancel.isCancelled
                || (UIApplication.shared.applicationState != .active && tasks[jobId] == nil)
            update(jobId) { DeviceCutFlow.recordFailure(&$0, step: step, interrupted: interrupted) }
            return interrupted ? .pause : .next
        }
    }

    private func encodeProgress(_ jobId: UUID, step: DeviceCutStep, fraction f: Double) {
        guard let job = job(jobId), fraction[jobId] != nil else { return }
        fraction[jobId] = f
        let progress = DeviceCutFlow.progress(job, step: step, fraction: f)
        setLive(jobId) { $0.progress = progress }
        tasks[jobId]?.progress.completedUnitCount = Int64(progress)
        Task {
            // A callback that lands after its file finished must not report
            // that file's stage over the next one.
            guard self.fraction[jobId] != nil, self.job(jobId).map(DeviceCutFlow.next) == step else { return }
            _ = await report(jobId, step: step, paused: false)
        }
    }

    private func updateTask(_ jobId: UUID, step: DeviceCutStep) {
        // The system's progress view reads as the match page does.
        tasks[jobId]?.updateTitle("Cutting your match", subtitle: DeviceCutCopy.title(step: step))
    }

    // MARK: Uploading

    private func seedInFlight() async {
        guard !seeded else { return }
        seeded = true
        sending.formUnion(await uploader.inFlight())
    }

    private func inflight(_ jobId: UUID) -> Int64 {
        let prefix = jobId.uuidString.lowercased() + "|"
        return sentBytes.filter { $0.key.hasPrefix(prefix) }.reduce(0) { $0 + $1.value }
    }

    /// A route call that answers for the job: nil means the phone should
    /// stop driving for now (the job moved on, or the network is down and
    /// a nap was taken).
    private func call(_ jobId: UUID, _ request: DeviceCutRouteRequest) async -> DeviceCutRouteAnswer? {
        do {
            let answer = try await transport.route(request)
            switch answer {
            case .notOnPhone(let phase):
                // Submitted already (a lost answer), moved to the Mac, or
                // released: in every case the phone has nothing left to do.
                if phase == "verify" { update(jobId) { $0.submitted = true } }
                finishLocally(jobId)
                return nil
            case .notFound:
                finishLocally(jobId)
                return nil
            default:
                return answer
            }
        } catch {
            await backoff(jobId)
            return nil
        }
    }

    private func prepareUpload(_ jobId: UUID) async -> Outcome {
        guard let job = job(jobId), let cut = job.cut else { return .next }
        updateTask(jobId, step: .prepareUpload)
        guard await report(jobId, step: .prepareUpload, paused: false) else { return .pause }
        if job.uploadId == nil {
            guard let answer = await call(jobId, .init(action: "create", jobId: jobId.uuidString.lowercased(),
                                                        fileSize: cut.bytes)) else { return .next }
            guard let created = answer.decode(DeviceCutRouteBodies.Created.self) else {
                if case .refused(413, _) = answer {
                    update(jobId) { $0.stop = .tooLarge }
                } else {
                    await backoff(jobId)
                }
                return .next
            }
            let count = Int((cut.bytes + DeviceCutSettings.partSize - 1) / DeviceCutSettings.partSize)
            update(jobId) {
                $0.uploadId = created.uploadId
                $0.partCount = max(1, count)
                $0.uploadStartedAt = $0.uploadStartedAt ?? Date()
            }
        }
        guard let ready = self.job(jobId), let partCount = ready.partCount else { return .next }
        let cutURL = Self.cutFile(jobId)
        let parts = (1...partCount).map { (n: $0, file: Self.partFile(jobId, $0), length: ready.partLength($0)) }
        let banked = Set(ready.etags.keys)
        do {
            try await Task.detached(priority: .utility) {
                try Self.slice(cut: cutURL, parts: parts, partSize: DeviceCutSettings.partSize, uploaded: banked)
            }.value
            update(jobId) { $0.partsSliced = true }
        } catch {
            // The cut is not where it should be: encode it again.
            await loseUpload(jobId)
        }
        return .next
    }

    /// The multipart upload, its parts or the cut are gone: throw away every
    /// piece of the old cut, here and in R2, and cut it again. A part left
    /// on disk would otherwise be sent as part of the NEW cut.
    private func loseUpload(_ jobId: UUID) async {
        await abortUpload(jobId)
        await uploader.cancel(jobId: jobId)
        let prefix = jobId.uuidString.lowercased() + "|part|"
        sending = sending.filter { !$0.hasPrefix(prefix) }
        reconciled.remove(jobId)
        let dir = Self.directory(jobId)
        try? FileManager.default.removeItem(at: dir.appendingPathComponent("parts"))
        try? FileManager.default.removeItem(at: dir.appendingPathComponent("cut.mp4"))
        update(jobId) { DeviceCutFlow.uploadLost(&$0) }
    }

    /// The cut, cut into part files from the END, truncating the cut after
    /// each, so the phone never holds the video twice. Safe to repeat after
    /// a crash at any point: a part already written whole is kept, and one
    /// already uploaded needs no file at all.
    nonisolated static func slice(cut: URL, parts: [(n: Int, file: URL, length: Int64)],
                                  partSize: Int64, uploaded: Set<Int>) throws {
        let fm = FileManager.default
        func size(_ url: URL) -> Int64? {
            (try? fm.attributesOfItem(atPath: url.path)[.size] as? Int64).flatMap { $0 }
        }
        for part in parts.sorted(by: { $0.n > $1.n }) {
            let offset = Int64(part.n - 1) * partSize
            let whole = uploaded.contains(part.n) || size(part.file) == part.length
            if !whole {
                guard let cutSize = size(cut), cutSize >= offset + part.length else {
                    throw CocoaError(.fileReadCorruptFile)
                }
                let temp = part.file.appendingPathExtension("tmp")
                try? fm.removeItem(at: temp)
                fm.createFile(atPath: temp.path, contents: nil)
                let reader = try FileHandle(forReadingFrom: cut)
                defer { try? reader.close() }
                let writer = try FileHandle(forWritingTo: temp)
                try reader.seek(toOffset: UInt64(offset))
                var remaining = part.length
                while remaining > 0 {
                    guard let chunk = try reader.read(upToCount: Int(min(8 * 1024 * 1024, remaining))),
                          !chunk.isEmpty else { break }
                    try writer.write(contentsOf: chunk)
                    remaining -= Int64(chunk.count)
                }
                try writer.close()
                guard remaining == 0 else { throw CocoaError(.fileReadCorruptFile) }
                try? fm.removeItem(at: part.file)
                try fm.moveItem(at: temp, to: part.file)
            }
            if let cutSize = size(cut), cutSize > offset {
                let handle = try FileHandle(forWritingTo: cut)
                try handle.truncate(atOffset: UInt64(offset))
                try handle.close()
            }
        }
        try? fm.removeItem(at: cut)
    }

    private func upload(_ jobId: UUID, parts: [Int], clips: [Int]) async -> Outcome {
        guard let job = job(jobId), let uploadId = job.uploadId else { return .next }
        updateTask(jobId, step: .upload(parts: parts, clips: clips))
        // Once per launch: bank what R2 already holds, so nothing is sent
        // twice after a relaunch.
        if !reconciled.contains(jobId) {
            guard let answer = await call(jobId, .init(action: "list-parts", jobId: jobId.uuidString.lowercased(),
                                                        uploadId: uploadId)) else { return .next }
            if let listed = answer.decode(DeviceCutRouteBodies.Listed.self) {
                if listed.gone == true {
                    await loseUpload(jobId)
                } else {
                    reconciled.insert(jobId)
                    update(jobId) { DeviceCutFlow.reconcile(&$0, listed: listed) }
                }
            } else {
                await backoff(jobId)
            }
            return .next
        }
        let id = jobId.uuidString.lowercased()
        for n in parts {
            let name = DeviceCutFlow.transferName(jobId, kind: "part", number: n)
            guard !sending.contains(name) else { continue }
            let file = Self.partFile(jobId, n)
            guard FileManager.default.fileExists(atPath: file.path) else {
                // Not uploaded and not on disk: the cut is gone. Again.
                await loseUpload(jobId)
                return .next
            }
            guard let answer = await call(jobId, .init(action: "sign-part", jobId: id, uploadId: uploadId, partNumber: n)),
                  let signed = answer.decode(DeviceCutRouteBodies.Signed.self), let url = URL(string: signed.url)
            else { return .next }
            sending.insert(name)
            uploader.send(file: file, to: url, contentType: nil, name: name)
        }
        let pending = clips.filter { !sending.contains(DeviceCutFlow.transferName(jobId, kind: "clip", number: $0)) }
        // Clip links last ten minutes, so each batch is signed just before
        // it is sent.
        for batch in stride(from: 0, to: pending.count, by: 100).map({ Array(pending[$0..<min($0 + 100, pending.count)]) }) {
            let keys = batch.compactMap { job.claim.clipKey($0) }
            guard let answer = await call(jobId, .init(action: "sign", jobId: id, keys: keys)),
                  let signed = answer.decode(DeviceCutRouteBodies.SignedKeys.self)
            else { return .next }
            for idx in batch {
                guard let key = job.claim.clipKey(idx), let point = job.points.first(where: { $0.idx == idx }),
                      let link = signed.urls[key], let url = URL(string: link) else { continue }
                let file = Self.clipFile(jobId, point.clip)
                guard FileManager.default.fileExists(atPath: file.path) else {
                    // The clip file is gone: make it again.
                    update(jobId) { $0.clips.removeAll { $0.idx == idx } }
                    return .next
                }
                let name = DeviceCutFlow.transferName(jobId, kind: "clip", number: idx)
                sending.insert(name)
                uploader.send(file: file, to: url, contentType: "video/mp4", name: name)
            }
        }
        refreshProgress(jobId)
        guard await report(jobId, step: .upload(parts: parts, clips: clips), paused: false) else { return .pause }
        // Woken by every transfer that ends; otherwise a heartbeat.
        await nap(jobId, seconds: 30)
        return .next
    }

    /// A transfer ended, in the foreground or on a background wake.
    func transferFinished(name: String, status: Int, etag: String?, failed: Bool) {
        sending.remove(name)
        sentBytes[name] = nil
        guard let transfer = DeviceCutFlow.transfer(name), job(transfer.jobId) != nil else { return }
        let jobId = transfer.jobId
        let kind = transfer.kind
        let n = transfer.number
        if !failed, (200..<300).contains(status) {
            if kind == "part" {
                if let etag {
                    update(jobId) { $0.etags[n] = etag }
                    try? FileManager.default.removeItem(at: Self.partFile(jobId, n))
                }
            } else {
                update(jobId) { if !$0.clipsUploaded.contains(n) { $0.clipsUploaded.append(n) } }
            }
        }
        // A dropped connection or an expired link needs nothing here: the
        // transfer is signed again and resent on the next pass.
        refreshProgress(jobId)
        wake(jobId)
        if !driving.contains(jobId) { kick(jobId) }
    }

    func transferProgress(name: String, sent: Int64) {
        guard let transfer = DeviceCutFlow.transfer(name) else { return }
        sentBytes[name] = sent
        refreshProgress(transfer.jobId)
    }

    private func refreshProgress(_ jobId: UUID) {
        guard let job = job(jobId) else { return }
        let step = DeviceCutFlow.next(job)
        let progress = DeviceCutFlow.progress(job, step: step, inflightBytes: inflight(jobId))
        setLive(jobId) { $0.progress = progress }
        tasks[jobId]?.progress.completedUnitCount = Int64(progress)
    }

    private func completeCut(_ jobId: UUID) async -> Outcome {
        guard let job = job(jobId), let uploadId = job.uploadId, let count = job.partCount else { return .next }
        let parts = (1...count).compactMap { n in job.etags[n].map { DeviceCutRouteRequest.Part(PartNumber: n, ETag: $0) } }
        guard let answer = await call(jobId, .init(action: "complete", jobId: jobId.uuidString.lowercased(),
                                                    uploadId: uploadId, parts: parts)) else { return .next }
        if case .ok = answer {
            update(jobId) { $0.cutUploaded = true }
            try? FileManager.default.removeItem(at: Self.directory(jobId).appendingPathComponent("parts"))
        } else if case .refused(413, _) = answer {
            update(jobId) { $0.stop = .tooLarge }
        } else {
            // Most likely an ETag the phone never heard about: ask R2 again.
            reconciled.remove(jobId)
            await backoff(jobId)
        }
        return .next
    }

    private func uploadManifest(_ jobId: UUID) async -> Outcome {
        guard let job = job(jobId) else { return .next }
        let started = job.uploadStartedAt ?? Date()
        let uploadWall = Date().timeIntervalSince(started)
        update(jobId) { $0.uploadWall = uploadWall }
        let device = HandCutBenchmark.deviceInfo()
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? ""
        guard let fresh = self.job(jobId),
              let manifest = DeviceCutManifest.build(
                fresh,
                encoder: .init(cut: .init(videoBitrate: fresh.cutVideoBitrate), device: device.model,
                               os: UIDevice.current.systemVersion, appBuild: build),
                timing: .init(cutWall: fresh.cut?.wall, clipsWall: fresh.clipsWall, uploadWall: uploadWall)),
              let data = try? manifest.encoded()
        else { return .pause }
        let key = fresh.claim.keys.manifest
        guard let answer = await call(jobId, .init(action: "sign", jobId: jobId.uuidString.lowercased(), keys: [key])),
              let signed = answer.decode(DeviceCutRouteBodies.SignedKeys.self),
              let link = signed.urls[key], let url = URL(string: link)
        else { return .next }
        do {
            try await transport.put(data, to: url, contentType: "application/json")
            update(jobId) { $0.manifestUploaded = true }
        } catch {
            await backoff(jobId)
        }
        return .next
    }

    private func submit(_ jobId: UUID) async -> Outcome {
        guard await report(jobId, step: .submit, paused: false, force: true) else { return .pause }
        guard let answer = await call(jobId, .init(action: "submit", jobId: jobId.uuidString.lowercased())) else {
            return self.job(jobId) == nil ? .pause : .next
        }
        switch answer {
        case .ok:
            update(jobId) { $0.submitted = true }
            setLive(jobId) { $0.progress = 100 }
        case .missing(let keys):
            if keys.contains(job(jobId)?.claim.keys.cut ?? "") {
                await loseUpload(jobId)
            }
            update(jobId) { DeviceCutFlow.missing(&$0, keys: keys) }
        case .refused(let status, _) where status == 400 || status == 413:
            // The route refused the manifest or a clip: the server cuts it.
            await handOver(jobId, because: .refused)
            return .pause
        default:
            await backoff(jobId)
        }
        return .next
    }

    // MARK: Reporting

    /// Report the stage and progress when the clock says so. Returns false
    /// when the server says the job is no longer the phone's.
    private func report(_ jobId: UUID, step: DeviceCutStep, paused: Bool, force: Bool = false) async -> Bool {
        guard let job = job(jobId), !reporting.contains(jobId) else { return job(jobId) != nil }
        let stage = DeviceCutFlow.reportStage(step, paused: paused)
        let progress = DeviceCutFlow.progress(job, step: step, fraction: fraction[jobId] ?? 0,
                                              inflightBytes: inflight(jobId))
        let now = Date()
        guard force || DeviceCutReportClock.due(
            now: now, stage: stage, progress: progress,
            lastStage: job.reportedStage, lastProgress: job.reportedProgress, lastAt: job.reportedAt)
        else { return true }
        reporting.insert(jobId)
        defer { reporting.remove(jobId) }
        do {
            let answer = try await transport.report(jobId: jobId, stage: stage, progress: progress)
            guard answer.accepted else {
                if answer.phase == "verify" { update(jobId) { $0.submitted = true } }
                finishLocally(jobId)
                return false
            }
            update(jobId) {
                $0.reportedStage = stage
                $0.reportedProgress = progress
                $0.reportedAt = now
            }
        } catch {
            // A report is best effort: no signal is no reason to stop
            // cutting. A job the server no longer has is.
            if (error as? PostgrestError)?.message.contains("not_found") == true {
                finishLocally(jobId)
                return false
            }
        }
        return true
    }

    // MARK: Waiting

    private func nap(_ jobId: UUID, seconds: Double) async {
        if woken.remove(jobId) != nil { return }
        let token = UUID()
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            waiters.removeValue(forKey: jobId)?.resume()
            waiters[jobId] = continuation
            napTokens[jobId] = token
            Task { [weak self] in
                try? await Task.sleep(for: .seconds(seconds))
                // Only this nap's own timer: a stale one must not cut the
                // next nap short.
                guard let self, self.napTokens[jobId] == token else { return }
                self.waiters.removeValue(forKey: jobId)?.resume()
            }
        }
        napTokens[jobId] = nil
    }

    private func wake(_ jobId: UUID) {
        if let waiter = waiters.removeValue(forKey: jobId) {
            waiter.resume()
        } else {
            woken.insert(jobId)
        }
    }

    private func backoff(_ jobId: UUID) async {
        let n = backoffs[jobId, default: 0]
        backoffs[jobId] = n + 1
        await nap(jobId, seconds: min(60, 5 * pow(2, Double(min(n, 4)))))
    }

    // MARK: Ending

    /// Submitted: the Mac has it. The files go; the kept original stays
    /// until the match is ready (LocalMatchVideos).
    private func wrapUp(_ jobId: UUID) {
        guard let job = job(jobId) else { return }
        try? FileManager.default.removeItem(at: Self.root.appendingPathComponent(jobId.uuidString.lowercased()))
        jobs.removeAll { $0.jobId == jobId }
        live[jobId] = nil
        persist()
        NotificationCenter.default.post(name: .deviceHandCutChanged, object: job.matchId)
    }

    /// The job is no longer the phone's: stop everything and let it go.
    private func finishLocally(_ jobId: UUID) {
        released.insert(jobId)
        cancels[jobId]?.cancel()
        wake(jobId)
        let uploader = uploader
        Task { await uploader.cancel(jobId: jobId) }
        wrapUp(jobId)
    }

    private func abortUpload(_ jobId: UUID) async {
        guard let uploadId = job(jobId)?.uploadId else { return }
        _ = try? await transport.route(.init(action: "abort", jobId: jobId.uuidString.lowercased(), uploadId: uploadId))
    }

    /// Give the job to the server, which cuts it from the same marks:
    /// release_device_hand_cut(job, true) through the route. Silent: the
    /// match page goes back to the ordinary processing card. The stop is
    /// written first, so the phone never goes back to cutting this job, and
    /// a release that does not get through is tried again (and, failing
    /// that, the server takes the job itself once the phone has been quiet
    /// for 15 minutes, and the phone lets it go when told).
    @discardableResult
    private func handOver(_ jobId: UUID, because stop: DeviceCutStop) async -> Bool {
        guard beginHandOver(jobId, because: stop) else { return false }
        return await finishHandOver(jobId)
    }

    /// The part of a hand-over that cannot wait: the stop written, the work
    /// stopped, and background time asked for, all before this returns, so
    /// an app on its way off the screen gets them. False when one is
    /// already under way.
    private func beginHandOver(_ jobId: UUID, because stop: DeviceCutStop) -> Bool {
        guard job(jobId) != nil, !handingOver.contains(jobId) else { return false }
        handingOver.insert(jobId)
        // The release needs a few seconds iOS may not otherwise give an app
        // that is leaving the screen.
        beginGrace(jobId)
        update(jobId) { if $0.stop == nil { $0.stop = stop } }
        // The page drops the phone's card at once and reads the job row.
        if let matchId = job(jobId)?.matchId {
            NotificationCenter.default.post(name: .deviceHandCutChanged, object: matchId)
        }
        released.insert(jobId)
        cancels[jobId]?.cancel()
        wake(jobId)
        return true
    }

    /// The release itself, after beginHandOver.
    @discardableResult
    private func finishHandOver(_ jobId: UUID) async -> Bool {
        defer {
            handingOver.remove(jobId)
            endGrace(jobId)
        }
        await uploader.cancel(jobId: jobId)
        await abortUpload(jobId)
        if let answer = try? await transport.route(
            .init(action: "release", jobId: jobId.uuidString.lowercased(), toMac: true)) {
            switch answer {
            case .ok, .notOnPhone, .notFound:
                wrapUp(jobId)
                return true
            default:
                break
            }
        }
        released.remove(jobId)
        retryHandOver(jobId)
        return false
    }

    /// The release did not get through (no signal, most likely): try again
    /// shortly. The job keeps its stop, so the next drive only hands over.
    private func retryHandOver(_ jobId: UUID) {
        let n = backoffs[jobId, default: 0]
        backoffs[jobId] = n + 1
        let delay = min(60, 5 * pow(2, Double(min(n, 4))))
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard let self, self.job(jobId) != nil else { return }
            self.kick(jobId)
        }
    }

    private func beginGrace(_ jobId: UUID) {
        guard graces[jobId] == nil else { return }
        graces[jobId] = UIApplication.shared.beginBackgroundTask(withName: "Hand over the cut") {
            MainActor.assumeIsolated { DeviceHandCutQueue.shared.endGrace(jobId) }
        }
    }

    private func endGrace(_ jobId: UUID) {
        guard let id = graces.removeValue(forKey: jobId), id != .invalid else { return }
        UIApplication.shared.endBackgroundTask(id)
    }

    /// Hand a job this phone holds to the server on request. The simulator
    /// QA run's stand-in for a phone that cannot finish.
    func handOver(matchId: UUID) async {
        guard let job = job(forMatch: matchId) else { return }
        await handOver(job.jobId, because: .requested)
    }

    // MARK: The app around it

    func handleBackgroundSessionEvents(completionHandler: @escaping () -> Void) {
        session.backgroundCompletionHandler = completionHandler
    }

    private func observe() {
        let center = NotificationCenter.default
        func on(_ name: Notification.Name, _ body: @escaping @MainActor () -> Void) {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { _ in
                MainActor.assumeIsolated { body() }
            })
        }
        // Without a continued processing task, the encoder cannot run in the
        // background: the app is leaving with encoding still to do, so the
        // server cuts the match from the same marks, handed over now while
        // iOS still gives the app a few seconds. Uploads carry on by
        // themselves and need nothing here.
        on(UIApplication.didEnterBackgroundNotification) { [weak self] in
            guard let self else { return }
            for jobId in self.driving where self.tasks[jobId] == nil {
                guard let job = self.job(jobId), job.stop == nil, !job.encodingDone,
                      self.beginHandOver(jobId, because: .background) else { continue }
                // The encode it cut short is marked released, so it is not
                // counted as the encoder failing.
                Task { await self.finishHandOver(jobId) }
            }
        }
        on(UIApplication.didBecomeActiveNotification) { [weak self] in self?.resume() }
    }
}

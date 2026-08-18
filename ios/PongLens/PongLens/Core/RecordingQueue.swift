import AVFoundation
import Foundation
import Photos
import UIKit
import UserNotifications

// The recording pipeline's ground truth: every recording lives in the app's
// own Documents storage and in a manifest, from the moment the camera stops
// until the server confirms it holds every byte. Uploads run on a BACKGROUND
// URLSession — the system owns the transfers, so they continue with the
// phone locked, the app switched away, or the app killed. Nothing is ever
// deleted until `complete` succeeds; a permanent failure exports the footage
// to Photos rather than losing it.
//
// Wire protocol: exactly Uploader.swift's (create / sign-part / complete
// with register / process), but with every part PRE-SLICED to its own file
// and PRE-SIGNED (part URLs last six hours), so the whole transfer can be
// handed to the system in one go and survive the app's death.

struct RecordingMetadata: Codable, Equatable {
    var opponent: String?
    var venue: String?
    var matchType: String?
    var userSide: String?
}

struct QueuedRecording: Codable, Identifiable, Equatable {
    enum State: String, Codable {
        case preparing // creating upload + slicing + signing
        case uploading // parts in the system's hands
        case finishing // all parts landed; completing + registering
        case done
        case failed
    }

    let id: UUID
    var fileName: String // relative to the recordings directory
    /// The name the file had before it entered the queue, for the library.
    var originalName: String?
    var state: State
    var durationS: Double
    var capturedAtMs: Int64
    var totalBytes: Int64
    var uploadedBytes: Int64 = 0
    var metadata = RecordingMetadata()
    var processOn = true
    var placementOn = false
    // Multipart bookkeeping.
    var key: String?
    var uploadId: String?
    var partSize: Int64 = RecordingQueue.partSize
    var partCount: Int = 0
    var etags: [Int: String] = [:]
    var attempts: Int = 0
    var errorMessage: String?
    var matchId: UUID?
    var savedToPhotos = false
    /// Recordings from one session (a 45-minute roll) share metadata edits.
    var sessionId: UUID
}

@Observable
final class RecordingQueue: NSObject {
    static let partSize: Int64 = 64 * 1024 * 1024
    static let sessionIdentifier = "com.ponglens.PongLens.uploads"
    static let shared = RecordingQueue()

    var items: [QueuedRecording] = []
    /// Recordings still on their way up (any state before done/failed).
    var active: [QueuedRecording] {
        items.filter { $0.state != .done }
    }

    /// Set while the metadata sheet is open for a session: completion holds
    /// so a fast upload doesn't register with half-typed fields.
    private var metadataHolds: Set<UUID> = []
    private var backgroundCompletionHandler: (() -> Void)?

    @ObservationIgnored private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.timeoutIntervalForResource = 24 * 3600
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    private var directory: URL {
        let base = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("recordings", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    private var manifestURL: URL { directory.appendingPathComponent("queue.json") }

    func fileURL(_ item: QueuedRecording) -> URL {
        directory.appendingPathComponent(item.fileName)
    }

    private func partsDirectory(_ id: UUID) -> URL {
        let dir = directory.appendingPathComponent("parts-\(id.uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func partURL(_ id: UUID, _ n: Int) -> URL {
        partsDirectory(id).appendingPathComponent("part-\(n).bin")
    }

    // MARK: - Lifecycle

    override init() {
        super.init()
        if let data = try? Data(contentsOf: manifestURL),
           let saved = try? JSONDecoder().decode([QueuedRecording].self, from: data) {
            items = saved
        }
        // Quiet notifications: delivered to the notification center without
        // an authorization prompt, so "your match is up" never costs a dialog.
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.provisional, .alert, .sound]
        ) { _, _ in }
        Task { await recover() }
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(items) {
            try? data.write(to: manifestURL, options: .atomic)
        }
    }

    private func update(_ id: UUID, _ mutate: (inout QueuedRecording) -> Void) {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        mutate(&items[i])
        persist()
    }

    func handleBackgroundSessionEvents(completionHandler: @escaping () -> Void) {
        backgroundCompletionHandler = completionHandler
    }

    // MARK: - Enqueue

    /// A finished recording or a picked video enters the queue: the file
    /// moves into the app's own storage and the upload starts immediately.
    func enqueue(
        fileURL: URL, durationS: Double, sessionId: UUID,
        metadata: RecordingMetadata, processOn: Bool, placementOn: Bool,
        originalName: String? = nil
    ) {
        let id = UUID()
        let ext = fileURL.pathExtension.isEmpty ? "mov" : fileURL.pathExtension.lowercased()
        let name = "match-\(id.uuidString).\(ext)"
        let destination = directory.appendingPathComponent(name)
        do {
            try FileManager.default.moveItem(at: fileURL, to: destination)
        } catch {
            return
        }
        let bytes = (try? FileManager.default.attributesOfItem(atPath: destination.path)[.size] as? Int64)
            .flatMap { $0 } ?? 0
        var item = QueuedRecording(
            id: id, fileName: name, originalName: originalName, state: .preparing,
            durationS: durationS,
            capturedAtMs: Int64(Date().timeIntervalSince1970 * 1000),
            totalBytes: bytes, sessionId: sessionId
        )
        item.metadata = metadata
        item.processOn = processOn
        item.placementOn = placementOn
        item.partCount = Int((bytes + Self.partSize - 1) / Self.partSize)
        items.insert(item, at: 0)
        persist()
        Task { await prepare(id) }
    }

    /// Metadata edits apply to every recording of the session (a rolled
    /// 45-minute match is several files, one set of details).
    func updateMetadata(sessionId: UUID, _ metadata: RecordingMetadata) {
        for item in items where item.sessionId == sessionId && item.state != .done {
            update(item.id) { $0.metadata = metadata }
        }
    }

    /// The processing decision can change while the upload runs; it takes
    /// effect when `complete` fires. Done items keep whatever they did.
    func updateProcessing(sessionId: UUID, process: Bool, placement: Bool) {
        for item in items where item.sessionId == sessionId && item.state != .done {
            update(item.id) {
                $0.processOn = process
                $0.placementOn = placement
            }
        }
    }

    func holdCompletion(sessionId: UUID) {
        metadataHolds.insert(sessionId)
    }

    func releaseCompletion(sessionId: UUID) {
        metadataHolds.remove(sessionId)
        for item in items where item.sessionId == sessionId && item.state == .uploading {
            Task { await finishIfComplete(item.id) }
        }
    }

    // MARK: - Pipeline

    private struct CreateRes: Decodable {
        let key: String
        let uploadId: String
    }

    private struct SignRes: Decodable { let url: String }

    private func prepare(_ id: UUID) async {
        guard let item = items.first(where: { $0.id == id }) else { return }
        do {
            var key = item.key
            var uploadId = item.uploadId
            if key == nil || uploadId == nil {
                struct CreateReq: Encodable {
                    let action = "create"
                    let fileSize: Int64
                    let contentType: String
                }
                let created: CreateRes = try await API.post(
                    "api/upload-url", CreateReq(
                        fileSize: item.totalBytes,
                        contentType: item.fileName.hasSuffix(".mp4") ? "video/mp4" : "video/quicktime"
                    )
                )
                key = created.key
                uploadId = created.uploadId
                update(id) {
                    $0.key = created.key
                    $0.uploadId = created.uploadId
                }
            }
            try await sliceAndEnqueue(id, key: key!, uploadId: uploadId!, only: nil)
            update(id) { $0.state = .uploading }
        } catch let APIError.http(status, message) where (400..<500).contains(status) {
            // The server said no (quota, size) — retrying won't change it.
            fail(id, message: message.isEmpty ? "The upload was refused." : message)
        } catch {
            update(id) { $0.attempts += 1 }
            if item.attempts >= 6 {
                fail(id, message: "The upload couldn't start. The footage is safe on this phone.")
            } else {
                try? await Task.sleep(for: .seconds(min(60, 5 * (item.attempts + 1))))
                await prepare(id)
            }
        }
    }

    /// Slice the movie into uniform part files, sign each (URLs live six
    /// hours), and hand every PUT to the background session. From here the
    /// SYSTEM drives the transfer — app death included.
    private func sliceAndEnqueue(_ id: UUID, key: String, uploadId: String, only: Set<Int>?) async throws {
        guard let item = items.first(where: { $0.id == id }) else { return }
        let source = fileURL(item)
        let handle = try FileHandle(forReadingFrom: source)
        defer { try? handle.close() }

        for n in 1...max(1, item.partCount) {
            if let only, !only.contains(n) { continue }
            if item.etags[n] != nil { continue }
            let partFile = partURL(id, n)
            if !FileManager.default.fileExists(atPath: partFile.path) {
                let offset = Int64(n - 1) * item.partSize
                let length = min(item.partSize, item.totalBytes - offset)
                try handle.seek(toOffset: UInt64(offset))
                FileManager.default.createFile(atPath: partFile.path, contents: nil)
                let writer = try FileHandle(forWritingTo: partFile)
                var remaining = length
                while remaining > 0 {
                    let chunk = try handle.read(upToCount: Int(min(8 * 1024 * 1024, remaining)))
                    guard let chunk, !chunk.isEmpty else { break }
                    try writer.write(contentsOf: chunk)
                    remaining -= Int64(chunk.count)
                }
                try writer.close()
            }

            struct SignReq: Encodable {
                let action = "sign-part"
                let key: String
                let uploadId: String
                let partNumber: Int
            }
            let signed: SignRes = try await API.post(
                "api/upload-url",
                SignReq(key: key, uploadId: uploadId, partNumber: n)
            )
            guard let putURL = URL(string: signed.url) else { throw URLError(.badURL) }
            var request = URLRequest(url: putURL)
            request.httpMethod = "PUT"
            request.allowsCellularAccess = !RecordSettings.load().wifiOnlyUploads
            let task = session.uploadTask(with: request, fromFile: partFile)
            task.taskDescription = "\(id.uuidString)|\(n)"
            task.resume()
        }
    }

    /// One part landed: bank its ETag, drop its slice, finish when whole.
    private func partCompleted(_ id: UUID, part: Int, etag: String, bytes: Int64) {
        update(id) {
            if $0.etags[part] == nil {
                $0.etags[part] = etag
                $0.uploadedBytes = min($0.totalBytes, $0.uploadedBytes + bytes)
            }
            $0.attempts = 0
        }
        try? FileManager.default.removeItem(at: partURL(id, part))
        Task { await finishIfComplete(id) }
    }

    private func finishIfComplete(_ id: UUID) async {
        guard let item = items.first(where: { $0.id == id }),
              item.state == .uploading,
              item.etags.count >= item.partCount,
              let key = item.key, let uploadId = item.uploadId else { return }
        // The metadata sheet is still open for this session — let it close
        // (or the app suspend) before the register write freezes the fields.
        guard !metadataHolds.contains(item.sessionId) else { return }
        update(id) { $0.state = .finishing }
        do {
            struct Part: Encodable {
                let PartNumber: Int
                let ETag: String
            }
            struct RegisterPayload: Encodable {
                let durationS: Double?
                let originalName: String
                let capturedAtMs: Int64
                let opponent: String?
                let venue: String?
                let matchType: String?
                let userSide: String?
            }
            struct CompleteReq: Encodable {
                let action = "complete"
                let key: String
                let uploadId: String
                let parts: [Part]
                let register: RegisterPayload
            }
            struct CompleteRes: Decodable {
                let ok: Bool?
                let matchId: String?
            }
            let completed: CompleteRes = try await API.post("api/upload-url", CompleteReq(
                key: key, uploadId: uploadId,
                parts: (1...max(1, item.partCount)).compactMap { n in
                    item.etags[n].map { Part(PartNumber: n, ETag: $0) }
                },
                register: RegisterPayload(
                    durationS: item.durationS,
                    originalName: item.originalName ?? item.fileName,
                    capturedAtMs: item.capturedAtMs,
                    opponent: item.metadata.opponent,
                    venue: item.metadata.venue,
                    matchType: item.metadata.matchType,
                    userSide: item.metadata.userSide
                )
            ))
            let matchId = completed.matchId.flatMap(UUID.init(uuidString:))
            if item.processOn, let matchId {
                struct ProcessReq: Encodable {
                    let matchId: String
                    let points = true
                    let placement: Bool
                    let strictness = "normal"
                }
                struct ProcessRes: Decodable { let code: String? }
                let _: ProcessRes? = try? await API.post(
                    "api/process",
                    ProcessReq(matchId: matchId.uuidString.lowercased(), placement: item.placementOn)
                )
            }
            update(id) {
                $0.state = .done
                $0.matchId = matchId
            }
            cleanup(id, keepOriginal: false)
            notify(
                title: "Match uploaded",
                body: item.processOn
                    ? "Processing has started. You'll get an email when it's ready."
                    : "It's in your library, unprocessed."
            )
        } catch {
            update(id) {
                $0.state = .uploading
                $0.attempts += 1
            }
            if let current = items.first(where: { $0.id == id }), current.attempts >= 8 {
                fail(id, message: "The upload kept failing. The footage is safe on this phone.")
            }
        }
    }

    private func fail(_ id: UUID, message: String) {
        update(id) {
            $0.state = .failed
            $0.errorMessage = message
        }
        // The footage's parachute: a permanent failure exports the original
        // to Photos so it exists somewhere the player already trusts.
        exportToPhotos(id)
        notify(title: "Upload failed", body: "\(message) A copy was saved to Photos.")
    }

    private func cleanup(_ id: UUID, keepOriginal: Bool) {
        guard let item = items.first(where: { $0.id == id }) else { return }
        try? FileManager.default.removeItem(at: partsDirectory(id))
        if !keepOriginal {
            try? FileManager.default.removeItem(at: fileURL(item))
        }
    }

    // MARK: - User actions

    func retry(_ id: UUID) {
        update(id) {
            $0.state = .preparing
            $0.attempts = 0
            $0.errorMessage = nil
            // A fresh multipart: the old one may have been aborted server-side.
            $0.key = nil
            $0.uploadId = nil
            $0.etags = [:]
            $0.uploadedBytes = 0
        }
        Task { await prepare(id) }
    }

    func exportToPhotos(_ id: UUID) {
        guard let item = items.first(where: { $0.id == id }),
              !item.savedToPhotos else { return }
        let url = fileURL(item)
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { [weak self] status in
            guard status == .authorized || status == .limited else { return }
            PHPhotoLibrary.shared().performChanges {
                PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: url)
            } completionHandler: { success, _ in
                Task { @MainActor in
                    if success { self?.update(id) { $0.savedToPhotos = true } }
                }
            }
        }
    }

    func remove(_ id: UUID) {
        cleanup(id, keepOriginal: false)
        items.removeAll { $0.id == id }
        persist()
    }

    /// The user changed their mind: stop the session's transfers, tell the
    /// server to drop the half-uploaded object, and delete the footage.
    func discardSession(_ sessionId: UUID) {
        metadataHolds.remove(sessionId)
        let doomed = items.filter { $0.sessionId == sessionId && $0.state != .done }
        guard !doomed.isEmpty else { return }
        let ids = Set(doomed.map { $0.id.uuidString })
        Task {
            for task in await session.allTasks {
                guard let description = task.taskDescription,
                      let prefix = description.split(separator: "|").first,
                      ids.contains(String(prefix)) else { continue }
                task.cancel()
            }
        }
        for item in doomed {
            if let key = item.key, let uploadId = item.uploadId {
                struct AbortReq: Encodable {
                    let action = "abort"
                    let key: String
                    let uploadId: String
                }
                struct AbortRes: Decodable { let ok: Bool? }
                Task {
                    let _: AbortRes? = try? await API.post(
                        "api/upload-url", AbortReq(key: key, uploadId: uploadId)
                    )
                }
            }
            cleanup(item.id, keepOriginal: false)
        }
        items.removeAll { $0.sessionId == sessionId && $0.state != .done }
        persist()
    }

    func clearFinished() {
        items.removeAll { $0.state == .done }
        persist()
    }

    // MARK: - Recovery

    /// On every launch: reattach to whatever the system finished while we
    /// were dead, reconcile with R2 (list-parts is the truth for what
    /// landed), and re-enqueue only the gaps.
    private func recover() async {
        let tasks = await session.allTasks
        let live = Set(tasks.compactMap(\.taskDescription))
        for item in items {
            switch item.state {
            case .preparing:
                await prepare(item.id)
            case .uploading:
                guard let key = item.key, let uploadId = item.uploadId else {
                    await prepare(item.id)
                    continue
                }
                // Ask R2 what actually landed.
                struct ListReq: Encodable {
                    let action = "list-parts"
                    let key: String
                    let uploadId: String
                }
                struct ListedPart: Decodable {
                    let PartNumber: Int?
                    let ETag: String?
                    let Size: Int64?
                }
                struct ListRes: Decodable { let parts: [ListedPart] }
                if let listed: ListRes = try? await API.post(
                    "api/upload-url", ListReq(key: key, uploadId: uploadId)
                ) {
                    update(item.id) { rec in
                        for part in listed.parts {
                            if let n = part.PartNumber, let etag = part.ETag, rec.etags[n] == nil {
                                rec.etags[n] = etag
                                rec.uploadedBytes = min(
                                    rec.totalBytes, rec.uploadedBytes + (part.Size ?? 0)
                                )
                            }
                        }
                    }
                }
                guard let current = items.first(where: { $0.id == item.id }) else { continue }
                let missing = Set((1...max(1, current.partCount)).filter { n in
                    current.etags[n] == nil && !live.contains("\(item.id.uuidString)|\(n)")
                })
                if missing.isEmpty {
                    await finishIfComplete(item.id)
                } else {
                    try? await sliceAndEnqueue(item.id, key: key, uploadId: uploadId, only: missing)
                }
            case .finishing:
                update(item.id) { $0.state = .uploading }
                await finishIfComplete(item.id)
            case .done, .failed:
                continue
            }
        }
        // Orphaned movie files with no manifest row: a crash between the
        // camera finishing and enqueue. Adopt them as recovered recordings.
        let known = Set(items.map(\.fileName))
        let files = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        for file in files where (file.hasSuffix(".mov") || file.hasSuffix(".mp4")) && !known.contains(file) {
            let url = directory.appendingPathComponent(file)
            let asset = AVURLAsset(url: url)
            let duration = (try? await asset.load(.duration).seconds) ?? 0
            let bytes = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int64)
                .flatMap { $0 } ?? 0
            guard bytes > 0 else {
                try? FileManager.default.removeItem(at: url)
                continue
            }
            var item = QueuedRecording(
                id: UUID(), fileName: file, state: .preparing,
                durationS: duration.isFinite ? duration : 0,
                capturedAtMs: Int64(Date().timeIntervalSince1970 * 1000),
                totalBytes: bytes, sessionId: UUID()
            )
            item.partCount = Int((bytes + Self.partSize - 1) / Self.partSize)
            let settings = RecordSettings.load()
            item.processOn = settings.processAfterUpload
            item.placementOn = settings.placementMaps
            items.append(item)
            persist()
            await prepare(item.id)
        }
    }

    private func notify(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        UNUserNotificationCenter.current().add(
            UNNotificationRequest(
                identifier: UUID().uuidString, content: content, trigger: nil
            )
        )
    }
}

// MARK: - URLSession delegate (background wakes land here)

extension RecordingQueue: URLSessionDataDelegate {
    nonisolated func urlSession(
        _ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?
    ) {
        let description = task.taskDescription
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        let etag = (task.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "ETag")
        let sent = task.countOfBytesSent
        Task { @MainActor in
            guard let description else { return }
            let pieces = description.split(separator: "|")
            guard pieces.count == 2,
                  let id = UUID(uuidString: String(pieces[0])),
                  let part = Int(pieces[1]) else { return }
            if error == nil, (200..<300).contains(status), let etag {
                self.partCompleted(id, part: part, etag: etag, bytes: sent)
                return
            }
            // A dropped connection, an expired six-hour URL, a server blip:
            // re-sign this one part and hand it back to the system.
            guard let item = self.items.first(where: { $0.id == id }),
                  item.state == .uploading,
                  let key = item.key, let uploadId = item.uploadId else { return }
            self.update(id) { $0.attempts += 1 }
            if item.attempts >= 12 {
                self.fail(id, message: "The upload kept failing.")
                return
            }
            try? await self.sliceAndEnqueue(id, key: key, uploadId: uploadId, only: [part])
        }
    }

    nonisolated func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        Task { @MainActor in
            self.backgroundCompletionHandler?()
            self.backgroundCompletionHandler = nil
        }
    }
}

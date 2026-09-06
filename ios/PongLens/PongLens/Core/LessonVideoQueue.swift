import AVFoundation
import Foundation
import Supabase
import UIKit

struct QueuedLessonVideo: Codable, Identifiable {
    let id: UUID
    let ownerId: UUID
    let studentId: UUID?
    let fileName: String
    let originalName: String
    let bytes: Int64
    let duration: Double
    var videoId: UUID?
    var etags: [Int: String] = [:]
    var state = "waiting"
    var error: String?
    var uploadedBytes: Int64 = 0
}

/// Dedicated lesson queue. The source is durable; just ONE part per video is staged.
/// Background URLSession owns each transfer. Foreground re-entry reconciles the
/// server's part list, including completion whose response was lost.
@MainActor @Observable
final class LessonVideoQueue: NSObject {
    static let shared = LessonVideoQueue()
    nonisolated static let sessionIdentifier = "com.ponglens.PongLens.lesson-videos"
    private(set) var items: [QueuedLessonVideo] = []
    private var advancing: Set<UUID> = []
    private var active: Set<UUID> = []
    private var recovered = false
    private var recovering = false
    private var backgroundCompletion: (() -> Void)?
    private var finishedBackgroundEvents = false
    @ObservationIgnored private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.timeoutIntervalForResource = 7 * 24 * 3600
        config.waitsForConnectivity = true
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    nonisolated static func directory() throws -> URL {
        var url = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("lesson-videos", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try url.setResourceValues(values)
        return url
    }

    /// Called INSIDE the Photos file callback, before its temporary URL expires.
    /// Files imports use this same streaming filesystem copy on a background task.
    nonisolated static func copyImport(_ source: URL) throws -> URL {
        let directory = try directory()
        let values = try source.resourceValues(forKeys: [.fileSizeKey])
        let bytes = Int64(values.fileSize ?? 0)
        guard bytes > 0, bytes <= LessonVideoUploadPlan.maximumBytes else {
            throw LessonVideoLocalError.message("Choose a video smaller than 20 GB.")
        }
        let available = try directory.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
            .volumeAvailableCapacityForImportantUsage ?? 0
        guard available > bytes + LessonVideoUploadPlan.partSize + 128 * 1024 * 1024 else {
            throw LessonVideoLocalError.message("Free up space for a local copy of this video, then import again.")
        }
        let ext = source.pathExtension.lowercased() == "mp4" ? "mp4" : "mov"
        let destination = directory.appendingPathComponent("\(UUID().uuidString).\(ext)")
        do {
            try FileManager.default.copyItem(at: source, to: destination)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: destination.path)
            return destination
        } catch {
            try? FileManager.default.removeItem(at: destination)
            throw error
        }
    }

    override init() {
        super.init()
        if let dir = try? Self.directory(),
           let data = try? Data(contentsOf: dir.appendingPathComponent("queue.json")),
           let saved = try? JSONDecoder().decode([QueuedLessonVideo].self, from: data) {
            items = saved
        }
        Task { await resume() }
    }

    private func persist() throws {
        let data = try JSONEncoder().encode(items)
        try data.write(to: Self.directory().appendingPathComponent("queue.json"), options: .atomic)
    }

    func enqueue(copy: URL, originalName: String, ownerId: UUID, studentId: UUID?) async throws {
        let duration = try await AVURLAsset(url: copy).load(.duration).seconds
        let bytes = Int64(try copy.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0)
        try LessonVideoUploadPlan.validate(bytes: bytes, duration: duration)
        let item = QueuedLessonVideo(id: UUID(), ownerId: ownerId, studentId: studentId,
            fileName: copy.lastPathComponent, originalName: originalName, bytes: bytes, duration: duration)
        items.append(item)
        do { try persist() } catch { items.removeAll { $0.id == item.id }; throw error }
        await resume()
    }

    func resume() async {
        guard !recovering else { return }
        recovering = true
        if !recovered {
            let tasks = await session.allTasks
            for task in tasks {
                if let (id, part) = Self.taskIdentity(task.taskDescription),
                   let item = items.first(where: { $0.id == id }),
                   item.state != "failed", item.state != "done", item.etags[part] == nil {
                    active.insert(id)
                }
            }
            recovered = true
        }
        recovering = false
        guard let owner = try? await supa.auth.session.user.id else { return }
        for item in items where item.ownerId == owner && item.state != "done" && item.state != "failed" {
            await advance(item.id, reconcile: true)
        }
    }

    func retry(_ id: UUID) async {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        items[i].error = nil
        items[i].state = "waiting"
        do { try persist(); await advance(id, reconcile: true) }
        catch { fail(id, error) }
    }

    private func fail(_ id: UUID, _ error: Error) {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        items[i].state = "failed"
        items[i].error = error.localizedDescription
        try? persist()
    }

    private struct Created: Decodable { let video: LessonVideo; let id: UUID; let partSize: Int64 }
    private struct Sign: Encodable { let action = "sign-part"; let id: UUID; let partNumber: Int }
    private struct Signed: Decodable { let url: String }
    private struct CompletedPart: Encodable { let partNumber: Int; let etag: String }
    private struct Complete: Encodable { let action = "complete"; let id: UUID; let parts: [CompletedPart] }

    private func advance(_ id: UUID, reconcile: Bool) async {
        guard !recovering, !advancing.contains(id), !active.contains(id),
              let i = items.firstIndex(where: { $0.id == id }), items[i].state != "done" else { return }
        advancing.insert(id)
        defer { advancing.remove(id); finishBackgroundIfPossible() }
        do {
            let owner = try await supa.auth.session.user.id
            guard owner == items[i].ownerId else { return }
            if items[i].videoId == nil {
                let item = items[i]
                let response: Created = try await API.post("api/lesson-video", LessonVideoCreateRequest(clientRequestId: item.id, studentId: item.studentId,
                    originalName: item.originalName, fileSize: item.bytes, durationS: item.duration,
                    contentType: item.fileName.hasSuffix("mp4") ? "video/mp4" : "video/quicktime"))
                guard response.video.owner_id == item.ownerId, response.partSize == LessonVideoUploadPlan.partSize else {
                    throw LessonVideoLocalError.message("Your account changed. Sign back in to resume this upload.")
                }
                items[i].videoId = response.id
                try persist()
            }
            guard let videoId = items[i].videoId else { return }
            if reconcile {
                let detail: LessonVideoDetail = try await API.get("api/lesson-video", query: ["id": videoId.uuidString])
                if detail.video.status != "uploading" {
                    try markComplete(id)
                    return
                }
                let response: LessonVideoUploadedParts = try await API.post("api/lesson-video", LessonVideoAction(action: "list-parts", id: videoId))
                if response.needsCompletion {
                    // The multipart may have completed while its response was lost.
                    let latest: LessonVideoDetail = try await API.get("api/lesson-video", query: ["id": videoId.uuidString])
                    if latest.video.status != "uploading" { try markComplete(id); return }
                    // complete is idempotent and repairs an object already assembled on R2.
                    let _: LessonVideoOK = try await API.post("api/lesson-video", Complete(id: videoId,
                        parts: items[i].etags.map { CompletedPart(partNumber: $0.key, etag: $0.value) }.sorted { $0.partNumber < $1.partNumber }))
                    try markComplete(id)
                    return
                }
                let plan = LessonVideoUploadPlan(bytes: items[i].bytes)
                items[i].etags = [:]
                for part in response.parts where part.PartNumber > 0 && part.PartNumber <= plan.partCount {
                    if plan.range(part: part.PartNumber).length == part.Size { items[i].etags[part.PartNumber] = part.ETag }
                }
                items[i].uploadedBytes = items[i].etags.keys.reduce(0) { $0 + plan.range(part: $1).length }
                try persist()
            }
            let plan = LessonVideoUploadPlan(bytes: items[i].bytes)
            guard let number = (1...plan.partCount).first(where: { items[i].etags[$0] == nil }) else {
                items[i].state = "finishing"
                try persist()
                let _: LessonVideoOK = try await API.post("api/lesson-video", Complete(id: videoId,
                    parts: items[i].etags.map { CompletedPart(partNumber: $0.key, etag: $0.value) }.sorted { $0.partNumber < $1.partNumber }))
                try markComplete(id)
                return
            }
            let directory = try Self.directory()
            let source = directory.appendingPathComponent(items[i].fileName)
            let partURL = directory.appendingPathComponent("part-\(id.uuidString).bin")
            let range = plan.range(part: number)
            let space = try directory.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage ?? 0
            guard space > range.length + 16 * 1024 * 1024 else {
                throw LessonVideoLocalError.message("Free up at least 100 MB, then resume the upload. Your video is kept on this phone.")
            }
            try await Task.detached(priority: .utility) {
                try LessonVideoUploadPlan.writePart(source: source, destination: partURL, offset: range.offset, length: range.length)
            }.value
            guard try await supa.auth.session.user.id == items[i].ownerId else { return }
            let signed: Signed = try await API.post("api/lesson-video", Sign(id: videoId, partNumber: number))
            guard let url = URL(string: signed.url) else { throw URLError(.badURL) }
            var request = URLRequest(url: url)
            request.httpMethod = "PUT"
            let task = session.uploadTask(with: request, fromFile: partURL)
            task.taskDescription = "\(id.uuidString):\(number)"
            items[i].state = "uploading"
            items[i].error = nil
            try persist()
            active.insert(id)
            task.resume()
        } catch { fail(id, error) }
    }

    private func markComplete(_ id: UUID) throws {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        items[i].state = "done"
        items[i].uploadedBytes = items[i].bytes
        items[i].error = nil
        try persist() // Never remove the source until server completion AND local state are durable.
        let directory = try Self.directory()
        try? FileManager.default.removeItem(at: directory.appendingPathComponent(items[i].fileName))
        try? FileManager.default.removeItem(at: directory.appendingPathComponent("part-\(id.uuidString).bin"))
    }

    nonisolated private static func taskIdentity(_ description: String?) -> (UUID, Int)? {
        let parts = (description ?? "").split(separator: ":")
        guard parts.count == 2, let id = UUID(uuidString: String(parts[0])), let part = Int(parts[1]) else { return nil }
        return (id, part)
    }

    func handleBackgroundSessionEvents(completionHandler: @escaping () -> Void) {
        backgroundCompletion = completionHandler
        _ = session
    }
    private func finishBackgroundIfPossible() {
        guard finishedBackgroundEvents, advancing.isEmpty, let callback = backgroundCompletion else { return }
        backgroundCompletion = nil
        finishedBackgroundEvents = false
        callback()
    }
}

extension LessonVideoQueue: URLSessionTaskDelegate {
    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let (id, number) = Self.taskIdentity(task.taskDescription) else { return }
        let response = task.response as? HTTPURLResponse
        let code = response?.statusCode ?? 0
        let etag = response?.value(forHTTPHeaderField: "ETag")
        Task { @MainActor in
            active.remove(id)
            guard let i = items.firstIndex(where: { $0.id == id }) else { return }
            guard error == nil, (200..<300).contains(code), let etag, !etag.isEmpty else {
                fail(id, error ?? LessonVideoLocalError.message("The upload paused. Tap Resume upload to continue from the last completed part."))
                return
            }
            items[i].etags[number] = etag
            let plan = LessonVideoUploadPlan(bytes: items[i].bytes)
            items[i].uploadedBytes = items[i].etags.keys.reduce(0) { $0 + plan.range(part: $1).length }
            do { try persist() } catch { fail(id, error); return }
            await advance(id, reconcile: false)
        }
    }

    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask,
        didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard let (id, _) = Self.taskIdentity(task.taskDescription) else { return }
        Task { @MainActor in
            guard let i = items.firstIndex(where: { $0.id == id }) else { return }
            let plan = LessonVideoUploadPlan(bytes: items[i].bytes)
            let completed = items[i].etags.keys.reduce(0) { $0 + plan.range(part: $1).length }
            items[i].uploadedBytes = min(items[i].bytes, completed + totalBytesSent)
        }
    }

    nonisolated func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        Task { @MainActor in
            finishedBackgroundEvents = true
            finishBackgroundIfPossible()
        }
    }
}

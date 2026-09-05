import Foundation

struct LessonVideo: Codable, Identifiable {
    let id: UUID
    let owner_id: UUID
    let student_id: UUID?
    let lesson_id: UUID?
    let original_name: String
    let file_size: Int64
    let duration_s: Double
    let status: String
    let stage: String?
    let error: String?
    let edit: LessonVideoEdit?
    let created_at: String
    let revision: Int?

    var isProcessing: Bool { status == "queued" || status == "processing" }
    var needsRefresh: Bool { status == "uploading" || isProcessing }
    var title: String { edit?.title ?? original_name }
    var statusLabel: String {
        switch status {
        case "uploading": "Uploading"
        case "queued": "Waiting to process"
        case "processing": "Preparing your recap"
        case "review": "Ready to review"
        case "ready": student_id == nil ? "Saved" : "Shared"
        case "failed": "Needs attention"
        default: "Preparing"
        }
    }
}

struct LessonVideoEdit: Codable, Equatable {
    var title: String
    var chapters: [Chapter]
    var themes: [Theme]
    var warning: String?
    struct Chapter: Codable, Equatable {
        var title: String
        var cues: [String]
        let start_s: Double
        let end_s: Double
        let summary_start_s: Double?
        let summary_end_s: Double?
    }
    struct Theme: Codable, Equatable {
        var name: String
        var points: [String]
    }
}

struct LessonVideoDetail: Decodable {
    let video: LessonVideo
    let sourceUrl: String?
    let originalUrl: String?
    let summaryUrl: String?
    let playbackUrl: String?
    let isOwner: Bool
}
struct LessonVideoList: Decodable { let videos: [LessonVideo] }
struct LessonVideoAction: Encodable {
    let action: String
    let id: UUID
    var edit: LessonVideoEdit? = nil
    var expectedRevision: Int? = nil
}
struct LessonVideoOK: Decodable { let ok: Bool }

/// Independent limits: a lesson is allowed to be considerably longer than a match.
nonisolated struct LessonVideoUploadPlan {
    static let partSize: Int64 = 64 * 1024 * 1024
    static let maximumBytes: Int64 = 20 * 1024 * 1024 * 1024
    let bytes: Int64
    var partCount: Int { Int((bytes + Self.partSize - 1) / Self.partSize) }
    func range(part: Int) -> (offset: Int64, length: Int64) {
        let offset = Int64(part - 1) * Self.partSize
        return (offset, min(Self.partSize, bytes - offset))
    }
    static func validate(bytes: Int64, duration: Double) throws {
        guard bytes > 0, bytes <= maximumBytes else {
            throw LessonVideoLocalError.message("Choose a video smaller than 20 GB.")
        }
        guard duration.isFinite, duration > 0, duration <= 10800 else {
            throw LessonVideoLocalError.message("Choose a video up to 3 hours long.")
        }
    }
    /// Stream a single part, using at most 1 MiB of process memory.
    static func writePart(source: URL, destination: URL, offset: Int64, length: Int64) throws {
        try? FileManager.default.removeItem(at: destination)
        guard FileManager.default.createFile(atPath: destination.path, contents: nil) else {
            throw LessonVideoLocalError.message("There isn't enough free space to prepare the upload.")
        }
        let input = try FileHandle(forReadingFrom: source)
        let output = try FileHandle(forWritingTo: destination)
        defer { try? input.close(); try? output.close() }
        try input.seek(toOffset: UInt64(offset))
        var remaining = length
        while remaining > 0 {
            let data = try input.read(upToCount: Int(min(remaining, 1024 * 1024))) ?? Data()
            guard !data.isEmpty else { throw LessonVideoLocalError.message("The local video is incomplete. Import it again.") }
            try output.write(contentsOf: data)
            remaining -= Int64(data.count)
        }
        try output.synchronize()
    }
}

nonisolated enum LessonVideoLocalError: LocalizedError {
    case message(String)
    var errorDescription: String? { switch self { case .message(let text): return text } }
}

struct LessonVideoUploadedParts: Decodable {
    struct Part: Decodable { let PartNumber: Int; let Size: Int64; let ETag: String }
    let parts: [Part]
    let gone: Bool?
    let complete: Bool?
    var needsCompletion: Bool { complete == true || gone == true }
}

/// API media URLs last four hours. Renew after three, or whenever the app
/// returns to the foreground, without rebuilding playback every status poll.
nonisolated enum LessonVideoPlaybackRefresh {
    static func isDue(lastRefresh: Date?, now: Date = Date()) -> Bool {
        guard let lastRefresh else { return false }
        return now.timeIntervalSince(lastRefresh) >= 3 * 3600
    }
}

nonisolated struct LessonVideoCreateRequest: Encodable {
        let action = "create"
        let clientRequestId: UUID
        let studentId: UUID?
        let originalName: String
        let fileSize: Int64
        let durationS: Double
        let contentType: String
    }

/// Only first-party recap URLs enter the authenticated native player.
nonisolated struct LessonVideoLink: Identifiable {
    let id: UUID
    init?(url: URL) {
        guard url.scheme?.lowercased() == "https",
              ["ponglens.com", "www.ponglens.com"].contains(url.host?.lowercased() ?? "") else { return nil }
        let path = url.pathComponents.filter { $0 != "/" }
        guard path.count == 2, path[0] == "lesson-video", let id = UUID(uuidString: path[1]) else { return nil }
        self.id = id
    }
}

import Foundation

struct LessonVideo: Codable, Identifiable {
    let id: UUID
    let owner_id: UUID
    let student_id: UUID?
    /// The player_coaches row this lesson was recorded with, when the
    /// PLAYER imported it rather than the coach. A video names one side or
    /// the other, never both. Optional so a row from a server that
    /// predates the column still decodes.
    var coach_ref_id: UUID? = nil
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
    /// Can the linked student see it today. From the API only; absent
    /// from list rows on older servers, which is why it is optional.
    let shared: Bool?

    var isProcessing: Bool { status == "queued" || status == "processing" }
    var needsRefresh: Bool { status == "uploading" || isProcessing }
    var title: String { edit?.title ?? original_name }
    /// Somebody to share it with: a student the coach made it for, or the
    /// coach the player made it with. A private lesson has neither, and is
    /// finished the moment it is saved.
    var hasRecipient: Bool { student_id != nil || coach_ref_id != nil }
    /// Whether the owner can press the share button now. Review is the
    /// first time; ready-but-unshared is somebody taking it back and
    /// changing their mind. Twin of lessonCanShare on web.
    func canShare(isOwner: Bool) -> Bool {
        guard isOwner else { return false }
        if status == "review" { return true }
        return status == "ready" && hasRecipient && shared == false
    }
    /// Whether who taught this lesson can still be answered or corrected.
    ///
    /// Attribution is a fact about an afternoon that already happened, so
    /// it is never too late to record it and never wrong to fix it. A
    /// coach's own import is excluded: it names the student it was made
    /// for, and moving a delivered lesson to a different student is not a
    /// correction, it is a different lesson. Twin of lessonCanSetCoach on
    /// web.
    static func canSetCoach(_ video: LessonVideo, isOwner: Bool) -> Bool {
        isOwner && video.student_id == nil && video.stage != "Deleting"
            && ["review", "ready", "failed"].contains(video.status)
    }
    var statusLabel: String { statusLabel(hasRecap: false) }
    /// One status word, with `hasRecap` saying whether there is already
    /// something to watch. Correcting a word is not reprocessing the
    /// lesson: a rebuild used to walk the same stages a first import
    /// does, starting at "Downloading the lesson", so a typo fix read as
    /// the whole ninety minutes going through again. Twin of
    /// lessonStatusLabel on web.
    func statusLabel(hasRecap: Bool) -> String {
        if hasRecap, ["queued", "processing"].contains(status) { return "Updating your recap" }
        return switch status {
        case "uploading": "Uploading"
        case "queued": "Waiting to process"
        case "processing": "Preparing your recap"
        case "review": "Ready to review"
        // A ready row is not the same as a shared one: the coach can take the
        // entry back from the student page. Twin of lessonStatusLabel on web.
        case "ready": !hasRecipient ? "Saved" : ((shared ?? true) ? "Shared" : "Ready to share")
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
    let posterUrl: String?
    let isOwner: Bool
}
struct LessonVideoList: Decodable { let videos: [LessonVideo] }
struct LessonVideoAction: Encodable {
    let action: String
    let id: UUID
    var edit: LessonVideoEdit? = nil
    var expectedRevision: Int? = nil
    /// Only on "share", and only for a player's own recap: whether the
    /// coach may read it. Asked every time and never assumed, which is the
    /// rule the journal's share toggle already follows. A coach's import
    /// ignores it; publishing IS the share there, as it always was.
    var share: Bool? = nil
}

/// Who taught the lesson, answered or corrected after the import.
///
/// Its own type with its own encoder because the answer "nobody" has to
/// travel as null rather than as a missing key, and a synthesized encoder
/// drops a nil optional. The id is lower-cased for the same reason the
/// create call is: Foundation writes a UUID in upper case and Postgres
/// hands its uuid columns back in lower, and the route compares strings.
struct LessonVideoRecipient: Encodable {
    let action = "recipient"
    let id: UUID
    let coachRefId: UUID?
    private enum CodingKeys: String, CodingKey { case action, id, coachRefId }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(action, forKey: .action)
        try c.encode(id.uuidString.lowercased(), forKey: .id)
        try c.encode(coachRefId?.uuidString.lowercased(), forKey: .coachRefId)
    }
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
        /// The player_coaches row, when a player imported the lesson. The
        /// route refuses both at once.
        var coachRefId: UUID? = nil
        let originalName: String
        let fileSize: Int64
        let durationS: Double
        let contentType: String
    }

/// Only first-party recap URLs enter the authenticated native player.
nonisolated struct LessonVideoLink: Identifiable {
    let id: UUID
    /// A recap the app already knows by id, from a journal entry's column
    /// or a notification, rather than from a link in the text.
    init(id: UUID) { self.id = id }
    init?(url: URL) {
        guard url.scheme?.lowercased() == "https",
              ["ponglens.com", "www.ponglens.com"].contains(url.host?.lowercased() ?? "") else { return nil }
        let path = url.pathComponents.filter { $0 != "/" }
        guard path.count == 2, path[0] == "lesson-video", let id = UUID(uuidString: path[1]) else { return nil }
        self.id = id
    }
}

/// One student filter drives the server list and this phone's pending uploads.
nonisolated struct LessonVideoScope {
    let studentId: UUID?
    var query: [String: String] { studentId.map { ["studentId": $0.uuidString] } ?? [:] }
    func includes(studentId candidate: UUID?) -> Bool { studentId == nil || studentId == candidate }
}

/// The cue panel follows the timeline currently shown by the player.
enum LessonVideoChapterSelection {
    static func start(at index: Int, chapters: [LessonVideoEdit.Chapter], original: Bool) -> Double? {
        guard chapters.indices.contains(index) else { return nil }
        let chapter = chapters[index]
        if original { return chapter.start_s }
        if let start = chapter.summary_start_s, start.isFinite { return start }
        return chapters[..<index].reduce(0) { total, previous in
            total + max(0, previous.end_s - previous.start_s)
        }
    }

    static func index(at seconds: Double, chapters: [LessonVideoEdit.Chapter], original: Bool) -> Int? {
        guard seconds.isFinite, !chapters.isEmpty else { return nil }
        return chapters.indices.last(where: { index in
            start(at: index, chapters: chapters, original: original).map { $0 <= seconds } ?? false
        }) ?? 0
    }
}

extension LessonVideoEdit {
    /// The recap's length in whole minutes, the chapter lengths added up.
    /// Twin of lessonRecapMinutes on web.
    var recapMinutes: Int {
        let seconds = chapters.reduce(0.0) { total, chapter in total + max(0, chapter.end_s - chapter.start_s) }
        return Int((seconds / 60).rounded())
    }
}

/// m:ss for a chapter's length. Twin of formatClipLength on web.
enum LessonVideoLength {
    static func label(seconds: Double) -> String {
        let whole = max(0, Int((seconds.isFinite ? seconds : 0).rounded()))
        return String(format: "%d:%02d", whole / 60, whole % 60)
    }
}

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
        // Any time but deletion. Who taught it does not depend on whether
        // the recap exists yet, and an upload filed against nobody is most
        // easily fixed while it is still uploading.
        isOwner && video.student_id == nil && video.stage != "Deleting"
    }
    /// The label with the recap question answered from the row itself. A
    /// list row that has an edit is a lesson somebody has already watched,
    /// so a rebuild reads "Updating your recap" there too, not "Waiting to
    /// process" in the list and "Updating" on the detail one tap away.
    var statusLabel: String { statusLabel(hasRecap: edit != nil) }
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
    /// What the lesson set out to improve, shown on a card before the
    /// first clip.
    ///
    /// Optional in both directions. A lesson that stated no goals has no
    /// key at all, which is how an older row decodes and how a recap
    /// whose last goal has been deleted is saved: an empty list would
    /// draw an empty heading on the page and an empty card into the
    /// video. Twins of `goals` and `work_on` in
    /// `src/lib/lessonVideo/model.ts`.
    var goals: [String]? = nil
    /// What to practise afterwards, shown on a card after the last clip.
    var work_on: [String]? = nil
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
    var playbackUrl: String?
    var posterUrl: String?
    let isOwner: Bool
    /// Whether the other person can see it today. The detail response
    /// carries this at the top level; the list response tucks it inside
    /// each video. This screen read only the second place, so on a recap
    /// page it was always missing and fell back to "ready with a coach
    /// means shared". A player pressed Stop sharing twice, the call
    /// succeeded both times, and the page went on saying Shared.
    let shared: Bool?
    /// The downloadable copy with the words painted into the picture, and
    /// what is happening to it. Optional because a server from before the
    /// file had a state of its own does not send it.
    let file: LessonShareFile?
    /// The public link, when there is a live one. Owner only: anybody else
    /// reading this recap is inside PongLens already.
    let link: String?

    /// One answer, from whichever place the server put it, and never a
    /// guess: a recap is shared when the server says so.
    var sharedNow: Bool { shared ?? video.shared ?? false }

    /// Whether this page still has something to wait for. Two things can
    /// be running: the recap itself being made, and the downloadable file
    /// being built, which carries on long after the recap is watchable.
    /// One condition, so the screen keeps one ten-second poll rather than
    /// growing a second timer beside it.
    var needsRefresh: Bool { video.needsRefresh || (file?.state.isBuilding ?? false) }
}

/// What is happening to the downloadable copy of a recap: the video with
/// the words painted into the picture.
///
/// The apps play the clean recap and draw the chapters themselves, so this
/// file is only ever used for a download, to send to somebody who will not
/// open it in PongLens. It is built when its owner asks for it, and it goes
/// out of date the moment a word is corrected, because by then the old
/// words are in the picture. Twin of ShareFileState in
/// `src/lib/lessonVideo/shareFile.ts`.
///
/// `unknown` is the fallback for a state this build has never heard of. A
/// phone that has not been updated must still show the recap, rather than
/// failing to decode the whole page over one word it does not recognise.
nonisolated enum LessonShareFileState: String, Decodable {
    case none, queued, processing, ready, behind, failed, unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = LessonShareFileState(rawValue: raw) ?? .unknown
    }

    /// Whether there is a file somebody can actually download. `behind` is
    /// included on purpose: it plays, and it shows the wording its owner
    /// had when it was built. Twin of shareFileDownloadable.
    var isDownloadable: Bool { self == .ready || self == .behind }

    /// Whether asking for a build would do anything. Twin of
    /// shareFileCanPrepare, with one case the web has no word for:
    /// `unknown` answers no, because a build this app cannot name is not
    /// one it should start a second copy of.
    var canPrepare: Bool {
        switch self {
        case .queued, .processing, .ready, .unknown: false
        case .none, .behind, .failed: true
        }
    }

    /// A build is running now. This is what keeps the recap page polling
    /// after the recap itself has finished.
    var isBuilding: Bool { self == .queued || self == .processing }
}

/// The file's state as the recap page reads it.
nonisolated struct LessonShareFile: Decodable {
    let state: LessonShareFileState
    /// What the worker is doing, and why it stopped. Both are the owner's
    /// business; the server sends null for anybody else.
    let stage: String?
    let error: String?
    let bytes: Int?
    /// A presigned download, sent only when there is a file to fetch.
    let url: String?

    /// Written out rather than synthesized so a response missing a key
    /// still reads as "nothing has been made" instead of failing the whole
    /// page.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        state = try container.decodeIfPresent(LessonShareFileState.self, forKey: .state) ?? .none
        stage = try container.decodeIfPresent(String.self, forKey: .stage)
        error = try container.decodeIfPresent(String.self, forKey: .error)
        bytes = try container.decodeIfPresent(Int.self, forKey: .bytes)
        url = try container.decodeIfPresent(String.self, forKey: .url)
    }
    private enum CodingKeys: String, CodingKey { case state, stage, error, bytes, url }

    var downloadURL: URL? { url.flatMap(URL.init(string:)) }
    var sizeLabel: String? { Self.sizeLabel(bytes: bytes) }

    /// "128 MB", "2.0 GB", and nothing at all when the size is not known.
    /// Twin of shareFileSize, including where it changes unit.
    static func sizeLabel(bytes: Int?) -> String? {
        guard let bytes, bytes > 0 else { return nil }
        let mb = Double(bytes) / (1024 * 1024)
        if mb >= 1024 { return String(format: "%.1f GB", mb / 1024) }
        return "\(Int(mb.rounded())) MB"
    }
}

/// What "prepare-file" answers with: the file's state, straight away, so
/// the sheet can show the build starting before the page reloads.
struct LessonVideoFileResponse: Decodable {
    let ok: Bool
    let file: LessonShareFile
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
nonisolated enum LessonVideoMedia {
    /// Whether two signed media links point at the same stored file.
    ///
    /// A signed link carries the file's path and a signature that expires,
    /// so the same file signed twice gives two different strings. Handing a
    /// player or an image a new string makes it throw away what it holds and
    /// fetch again, and the picture blinks.
    ///
    /// The screen used to decide this from the recap's revision and status,
    /// which was right while every saved edit re-cut the video: a new
    /// revision meant a new file. Correcting a word no longer re-cuts
    /// anything, so the revision moves while the file stays where it was.
    /// The path is what actually says whether the file changed.
    static func sameTarget(_ a: String?, _ b: String?) -> Bool {
        guard let a, let b, let first = URL(string: a), let second = URL(string: b) else { return false }
        return !first.path.isEmpty && first.path == second.path
    }
}

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

/// The recap as the edit sheet holds it while it is open.
///
/// The stored edit carries bare strings, and a list cannot edit those: two
/// identical points are one row as far as SwiftUI is concerned and typing
/// into either moves both. Each chapter and each point gets an id of its
/// own for as long as the sheet is open, and `cleaned()` turns it back into
/// the shape the server takes. Foundation only, so the rules Save relies
/// on run under ios/Tests without a simulator.
struct LessonVideoEditDraft: Equatable {
    struct Cue: Identifiable, Equatable {
        let id: UUID
        var text: String
        init(id: UUID = UUID(), text: String) { self.id = id; self.text = text }
    }
    struct Chapter: Identifiable, Equatable {
        let id: UUID
        var title: String
        var cues: [Cue]
        let start_s: Double
        let end_s: Double
        let summary_start_s: Double?
        let summary_end_s: Double?
    }
    /// One line of the goals card or the things-to-work-on card, with an
    /// id of its own for the same reason a cue has one.
    struct Line: Identifiable, Equatable {
        let id: UUID
        var text: String
        init(id: UUID = UUID(), text: String) { self.id = id; self.text = text }
    }
    var title: String
    var chapters: [Chapter]
    var themes: [LessonVideoEdit.Theme]
    var warning: String?
    var goals: [Line]
    var workOn: [Line]

    /// Three points is the space the rendered chapter panel has.
    static let maxCuesPerChapter = 3
    /// What the cards have room for, and what the server trims to.
    static let maxGoals = 5
    static let maxWorkOn = 6
    static let focusLineLimit = 180

    // Reading and writing a row BY ID, never by where it sits.
    //
    // The editor used to hand each row a binding produced by `ForEach` over
    // a binding to the array, and those resolve by position. Removing a
    // point left a row holding the index of something no longer there, and
    // reading it crashed the app the moment the list was laid out again.
    // A lookup that finds nothing answers with empty text and writes
    // nowhere, so a row that has just been removed can be read safely one
    // last time.

    func chapterTitle(_ chapterId: UUID) -> String {
        chapters.first(where: { $0.id == chapterId })?.title ?? ""
    }

    mutating func setChapterTitle(_ chapterId: UUID, _ text: String) {
        guard let index = chapters.firstIndex(where: { $0.id == chapterId }) else { return }
        chapters[index].title = text
    }

    func cueText(chapter chapterId: UUID, cue cueId: UUID) -> String {
        chapters.first(where: { $0.id == chapterId })?
            .cues.first(where: { $0.id == cueId })?.text ?? ""
    }

    mutating func setCueText(chapter chapterId: UUID, cue cueId: UUID, _ text: String) {
        guard let chapterIndex = chapters.firstIndex(where: { $0.id == chapterId }),
              let cueIndex = chapters[chapterIndex].cues.firstIndex(where: { $0.id == cueId })
        else { return }
        chapters[chapterIndex].cues[cueIndex].text = text
    }

    func goalText(_ lineId: UUID) -> String { Self.text(goals, lineId) }
    mutating func setGoalText(_ lineId: UUID, _ text: String) { Self.setText(&goals, lineId, text) }
    func workOnText(_ lineId: UUID) -> String { Self.text(workOn, lineId) }
    mutating func setWorkOnText(_ lineId: UUID, _ text: String) { Self.setText(&workOn, lineId, text) }

    private static func text(_ lines: [Line], _ lineId: UUID) -> String {
        lines.first(where: { $0.id == lineId })?.text ?? ""
    }

    private static func setText(_ lines: inout [Line], _ lineId: UUID, _ text: String) {
        guard let index = lines.firstIndex(where: { $0.id == lineId }) else { return }
        lines[index].text = text
    }
    /// The server's own trims (validateEdit on web): a longer value is
    /// cut there anyway, so it is cut here first and what is saved is
    /// what was on screen.
    static let titleLimit = 100
    static let chapterTitleLimit = 80
    static let cueLimit = 220

    init(_ edit: LessonVideoEdit) {
        title = edit.title
        chapters = edit.chapters.map { chapter in
            Chapter(
                id: UUID(), title: chapter.title,
                cues: chapter.cues.map { Cue(text: $0) },
                start_s: chapter.start_s, end_s: chapter.end_s,
                summary_start_s: chapter.summary_start_s, summary_end_s: chapter.summary_end_s
            )
        }
        themes = edit.themes
        warning = edit.warning
        goals = (edit.goals ?? []).map { Line(text: $0) }
        workOn = (edit.work_on ?? []).map { Line(text: $0) }
    }

    /// Why Save is off, or nil when it may go. A disabled button with
    /// nothing beside it reads as broken. Checked in the order a person
    /// reads the sheet: the title, then each chapter's title, then its
    /// points. Twin of the server's refusals, in words.
    var blocker: String? {
        if Self.trim(title).isEmpty { return "The recap needs a title." }
        if chapters.contains(where: { Self.trim($0.title).isEmpty }) { return "Every chapter needs a title." }
        if chapters.contains(where: { chapter in !chapter.cues.contains { !Self.trim($0.text).isEmpty } }) {
            return "Every chapter needs at least one point."
        }
        return nil
    }

    /// The edit as it will be stored: everything trimmed, blank points
    /// dropped, the server's length limits applied. Themes and the warning
    /// pass through untouched; the sheet never shows them.
    ///
    /// A list a coach has emptied travels as no key rather than as an
    /// empty array, because the recap then has no goals card at all,
    /// which is not the same thing as a card with nothing on it.
    func cleaned() -> LessonVideoEdit {
        let goalLines = Self.lines(goals, limit: Self.maxGoals)
        let workOnLines = Self.lines(workOn, limit: Self.maxWorkOn)
        return LessonVideoEdit(
            title: Self.trim(title, limit: Self.titleLimit),
            chapters: chapters.map { chapter in
                LessonVideoEdit.Chapter(
                    title: Self.trim(chapter.title, limit: Self.chapterTitleLimit),
                    cues: chapter.cues.map { Self.trim($0.text, limit: Self.cueLimit) }.filter { !$0.isEmpty },
                    start_s: chapter.start_s, end_s: chapter.end_s,
                    summary_start_s: chapter.summary_start_s, summary_end_s: chapter.summary_end_s
                )
            },
            themes: themes,
            warning: warning,
            goals: goalLines.isEmpty ? nil : goalLines,
            work_on: workOnLines.isEmpty ? nil : workOnLines
        )
    }

    /// Trimmed, blanks dropped, capped at what the card holds.
    private static func lines(_ lines: [Line], limit: Int) -> [String] {
        Array(lines.map { trim($0.text, limit: focusLineLimit) }.filter { !$0.isEmpty }.prefix(limit))
    }

    private static func trim(_ value: String, limit: Int? = nil) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let limit, trimmed.count > limit else { return trimmed }
        return String(trimmed.prefix(limit))
    }
}

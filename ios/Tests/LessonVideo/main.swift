import Foundation
func check(_ value: @autoclosure () -> Bool, _ message: String) {
    if !value() { fatalError(message) }
}
try LessonVideoUploadPlan.validate(bytes: 12_000_000_000, duration: 5400)
try LessonVideoUploadPlan.validate(bytes: 21_474_836_480, duration: 10800)
for (bytes, duration) in [(Int64(21_474_836_481), 5400.0), (Int64(100), 10801.0), (Int64(0), 1.0), (Int64(1), Double.nan)] {
    do { try LessonVideoUploadPlan.validate(bytes: bytes, duration: duration); fatalError("Accepted invalid import") } catch {}
}
let plan = LessonVideoUploadPlan(bytes: 134_217_729)
check(plan.partCount == 3, "Includes trailing byte")
check(plan.range(part: 1).offset == 0 && plan.range(part: 1).length == 67_108_864, "First part")
check(plan.range(part: 3).offset == 134_217_728 && plan.range(part: 3).length == 1, "Final part")
let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: dir) }
let source = dir.appendingPathComponent("source")
let part = dir.appendingPathComponent("part")
FileManager.default.createFile(atPath: source.path, contents: nil)
let file = try FileHandle(forWritingTo: source)
try file.truncate(atOffset: 134_217_729)
try file.seek(toOffset: 134_217_728)
try file.write(contentsOf: Data([0xAC]))
try file.close()
try LessonVideoUploadPlan.writePart(source: source, destination: part, offset: 134_217_728, length: 1)
let result = try Data(contentsOf: part)
check(result == Data([0xAC]), "Correct source bytes")
let completedResponse = try JSONDecoder().decode(LessonVideoUploadedParts.self, from: Data(#"{"parts":[],"complete":true}"#.utf8))
check(completedResponse.needsCompletion, "Lost completion response must finish without uploading again")
let goneResponse = try JSONDecoder().decode(LessonVideoUploadedParts.self, from: Data(#"{"parts":[],"gone":true}"#.utf8))
check(goneResponse.needsCompletion, "Gone multipart must check assembled source")
let pendingResponse = try JSONDecoder().decode(LessonVideoUploadedParts.self, from: Data(#"{"parts":[]}"#.utf8))
check(!pendingResponse.needsCompletion, "Fresh upload still requires parts")
print("Lesson video: 90-minute import, maximum limits, trailing part and lost-completion checks passed")

for status in ["uploading", "queued", "processing", "review", "ready", "failed"] {
    let data = Data("""
    {"id":"00000000-0000-0000-0000-000000000001","owner_id":"00000000-0000-0000-0000-000000000002","original_name":"Lesson.mov","file_size":1024,"duration_s":5400,"status":"\(status)","created_at":"2026-09-05T00:00:00Z"}
    """.utf8)
    let video = try JSONDecoder().decode(LessonVideo.self, from: data)
    check(video.needsRefresh == ["uploading", "queued", "processing"].contains(status), "Uploading detail must keep updating until review")
}
let now = Date(timeIntervalSince1970: 1_800_000_000)
check(LessonVideoPlaybackRefresh.isDue(lastRefresh: now.addingTimeInterval(-5 * 3600), now: now), "An old signed player URL must refresh")
check(!LessonVideoPlaybackRefresh.isDue(lastRefresh: now.addingTimeInterval(-300), now: now), "A fresh player must not be replaced on every poll")
check(!LessonVideoPlaybackRefresh.isDue(lastRefresh: nil, now: now), "No player means no URL expiry to poll")
print("Lesson video: upload polling and playback expiry checks passed")
let requestId = UUID(uuidString: "00000000-0000-0000-0000-000000000099")!
let request = LessonVideoCreateRequest(clientRequestId: requestId, studentId: nil, originalName: "Lesson.mov", fileSize: 1024, durationS: 5400, contentType: "video/quicktime")
let requestBody = try JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as! [String: Any]
check(UUID(uuidString: requestBody["clientRequestId"] as! String) == requestId, "The persisted local ID must reach create for retry deduplication")
print("Lesson video: stable create request ID check passed")
let lessonLink = URL(string: "https://ponglens.com/lesson-video/00000000-0000-0000-0000-000000000099")!
check(LessonVideoLink(url: lessonLink)?.id == requestId, "Shared note must open its native recap")
for invalid in ["https://other.example/lesson-video/00000000-0000-0000-0000-000000000099", "https://ponglens.com/lesson-video/not-an-id", "https://ponglens.com/match/00000000-0000-0000-0000-000000000099"] {
    check(LessonVideoLink(url: URL(string: invalid)!) == nil, "Unrecognized links keep normal browser handling")
}
print("Lesson video: shared note routing checks passed")
let studentScope = LessonVideoScope(studentId: requestId)
check(studentScope.query["studentId"] == requestId.uuidString, "Student page must request only that student's videos")
check(studentScope.includes(studentId: requestId), "Student page includes assigned private recaps")
check(!studentScope.includes(studentId: UUID()), "Student page excludes another student's recaps")
check(!studentScope.includes(studentId: nil), "Student page excludes unassigned recaps")
check(LessonVideoScope(studentId: nil).query.isEmpty, "Home lists all coach videos")
check(LessonVideoScope(studentId: nil).includes(studentId: requestId), "Home includes every student")
print("Lesson video: student section scoping checks passed")
let chapters = [
    LessonVideoEdit.Chapter(title: "One", cues: [], start_s: 100, end_s: 130, summary_start_s: 0, summary_end_s: 30),
    LessonVideoEdit.Chapter(title: "Two", cues: [], start_s: 400, end_s: 440, summary_start_s: 30, summary_end_s: 70)
]
check(LessonVideoChapterSelection.index(at: 29.9, chapters: chapters, original: false) == 0, "Cue must not change before the next clip")
check(LessonVideoChapterSelection.index(at: 30, chapters: chapters, original: false) == 1, "Cue changes at the exact next clip boundary")
check(LessonVideoChapterSelection.index(at: 200, chapters: chapters, original: true) == 0, "Original video uses source timestamps")
check(LessonVideoChapterSelection.index(at: 400, chapters: chapters, original: true) == 1, "Original seek selects its chapter")
check(LessonVideoChapterSelection.index(at: .nan, chapters: chapters, original: false) == nil, "Unknown playback time cannot change the selected cue")
print("Lesson video: active chapter playback boundaries passed")
var expandedChapters: [LessonVideoEdit.Chapter] = []
for i in 0..<12 {
    let start = Double(i) * 100.0
    let summaryStart = Double(i) * 60.0
    let item = LessonVideoEdit.Chapter(title: "Chapter \(i + 1)", cues: ["When the ball changes, adjust."], start_s: start, end_s: start + 60.0, summary_start_s: summaryStart, summary_end_s: summaryStart + 60.0)
    expandedChapters.append(item)
}
let expandedEdit = LessonVideoEdit(title: "Expanded lesson", chapters: expandedChapters, themes: [], warning: nil)
let expandedRoundTrip = try JSONDecoder().decode(LessonVideoEdit.self, from: JSONEncoder().encode(expandedEdit))
check(expandedRoundTrip.chapters.count == 12, "Expanded recap retains all chapters on iOS")
check(expandedRoundTrip.chapters[11].summary_end_s == 720, "Expanded recap retains final playback timing")
print("Lesson video: twelve-chapter decoding passed")


// One status word, and shared is not the same as ready (twin of presentation.test.ts).
func video(_ status: String, student: Bool, shared: Bool?) -> LessonVideo {
    var json = """
    {"id":"c75c8a89-16ee-41a1-b8f2-d3b441f0f82f","owner_id":"c75c8a89-16ee-41a1-b8f2-d3b441f0f82f","student_id":\(student ? "\"c75c8a89-16ee-41a1-b8f2-d3b441f0f82f\"" : "null"),"lesson_id":null,"original_name":"IMG_0001.MOV","file_size":10,"duration_s":10,"status":"\(status)","stage":null,"error":null,"edit":null,"created_at":"2026-09-06T00:00:00Z","revision":1
    """
    if let shared { json += ",\"shared\":\(shared)" }
    json += "}"
    return try! JSONDecoder().decode(LessonVideo.self, from: Data(json.utf8))
}
check(video("review", student: true, shared: nil).statusLabel == "Ready to review", "review label")
check(video("ready", student: true, shared: true).statusLabel == "Shared", "shared label")
check(video("ready", student: true, shared: false).statusLabel == "Ready to share", "taken back reads as ready to share")
check(video("ready", student: true, shared: nil).statusLabel == "Shared", "an older server that does not say is read as shared, as before")
check(video("ready", student: false, shared: nil).statusLabel == "Saved", "private lesson label")
check(video("failed", student: true, shared: nil).statusLabel == "Needs attention", "failed label")
check(video("review", student: true, shared: nil).canShare(isOwner: true), "review can be shared")
check(video("ready", student: true, shared: false).canShare(isOwner: true), "taken back can be shared again")
check(!video("ready", student: true, shared: true).canShare(isOwner: true), "already shared")
check(!video("ready", student: true, shared: nil).canShare(isOwner: true), "unknown is not offered twice")
check(!video("ready", student: false, shared: false).canShare(isOwner: true), "nothing to share a private lesson with")
check(!video("review", student: true, shared: nil).canShare(isOwner: false), "never for the student")
check(LessonVideoLink(id: UUID(uuidString: "c75c8a89-16ee-41a1-b8f2-d3b441f0f82f")!).id.uuidString.lowercased() == "c75c8a89-16ee-41a1-b8f2-d3b441f0f82f", "a link from an id")
print("lesson video checks passed")

// The two numbers under the poster (twin of presentation.test.ts).
check(LessonVideoLength.label(seconds: 0) == "0:00", "zero length")
check(LessonVideoLength.label(seconds: 65) == "1:05", "minute and seconds")
check(LessonVideoLength.label(seconds: 119.6) == "2:00", "rounds to the nearest second")
check(LessonVideoLength.label(seconds: .nan) == "0:00", "unknown length reads as zero")
let timedEdit = LessonVideoEdit(title: "T", chapters: [
    LessonVideoEdit.Chapter(title: "a", cues: [], start_s: 0, end_s: 90, summary_start_s: nil, summary_end_s: nil),
    LessonVideoEdit.Chapter(title: "b", cues: [], start_s: 100, end_s: 250, summary_start_s: nil, summary_end_s: nil),
], themes: [], warning: nil)
check(timedEdit.recapMinutes == 4, "recap minutes add the chapters up and round")
print("lesson video length checks passed")

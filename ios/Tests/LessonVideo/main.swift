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

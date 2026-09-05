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

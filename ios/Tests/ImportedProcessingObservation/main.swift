import Foundation

func check(_ condition: Bool, _ message: String) {
    guard condition else { print("FAIL: \(message)"); exit(1) }
}
let imported = UUID()
let retry = UUID()
var observation = ImportedProcessingObservation()
check(observation.taskID(importJobID: imported) == imported, "initial import observed")
observation.kind = nil
observation.status = nil
let stoppedTask = observation.taskID(importJobID: imported)
try observation.processingRequested(jobID: retry.uuidString)
check(observation.taskID(importJobID: imported) != stoppedTask, "successful retry restarts a completed observation task")
check(observation.retryJobID == retry, "returned processing ID retained")
check(observation.kind == "deadspace_cut" && observation.status == "queued", "retry immediately renders queued processing and its estimate context")
for invalid in [nil, "", "invalid"] as [String?] {
    let before = observation
    do { try observation.processingRequested(jobID: invalid); check(false, "invalid retry must fail") }
    catch { check(observation == before, "invalid retry preserves current observation") }
}
print("7 import observation assertions passed")

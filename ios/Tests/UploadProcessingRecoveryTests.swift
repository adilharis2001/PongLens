import Foundation

@main struct UploadProcessingRecoveryTests {
    static func main() throws {
        var choice = UploadProcessingChoice(process: false, placement: false)
        choice.chooseProcess(true)
        choice.selectType(tracksServe: true)
        precondition(choice.process, "Choosing Match must preserve explicit processing")
        choice.selectType(tracksServe: false)
        precondition(choice.process, "An explicit choice survives later type edits")
        choice.chooseProcess(false)
        choice.selectType(tracksServe: true)
        precondition(!choice.process, "An explicit opt-out is never overwritten")
        var defaults = UploadProcessingChoice(process: true, placement: true)
        defaults.selectType(tracksServe: false)
        precondition(!defaults.process && !defaults.placement)
        defaults.selectType(tracksServe: true)
        precondition(defaults.process && defaults.placement)
        defaults.choosePlacement(false)
        defaults.selectType(tracksServe: false)
        defaults.selectType(tracksServe: true)
        precondition(!defaults.placement)

        let now = Date(timeIntervalSince1970: 1000)
        var request = UploadProcessingRequest(ownerID: UUID(), matchID: UUID(), placement: false,
            trimStartS: 12, trimEndS: 100)
        let key = request.id
        request.failed(httpStatus: 503, code: "unavailable", now: now)
        precondition(request.isPending && !request.isDue(now: now))
        let restored = try JSONDecoder().decode(UploadProcessingRequest.self,
            from: JSONEncoder().encode(request))
        precondition(restored.id == key && restored.trimStartS == 12 && restored.trimEndS == 100)
        precondition(restored.isDue(now: now.addingTimeInterval(600)))
        request.accepted(jobID: UUID())
        precondition(!request.isPending && !request.isDue(now: now.addingTimeInterval(600)))
        for code in ["insufficient_minutes", "trim_too_short", "not_found", "bad_state"] {
            var denied = restored
            denied.failed(httpStatus: 400, code: code, now: now)
            precondition(!denied.isPending, "Permanent refusals need user action, not automatic spending")
        }
        var capped = restored
        for _ in 0..<30 { capped.failed(httpStatus: 503, code: "unavailable", now: now) }
        precondition(capped.nextAttemptAt!.timeIntervalSince(now) <= 300)
        print("Upload processing choice and durable retry checks passed")
    }
}

import Foundation

func runAllowanceRecoveryChecks() {
    check(AllowanceLimit.isStorage("Storage is full. Delete a video or manage your allowance in Account."), "storage refusal offers recovery")
    check(!AllowanceLimit.isStorage("Could not check your storage allowance. Please try again."), "lookup failure is not a storage refusal")
    check(!AllowanceLimit.isStorage("Your queue is full. Wait for a match to finish."), "queue limit cannot request storage")
    check(!AllowanceLimit.isStorage(nil), "no error needs no recovery")
    check(UploadProcessingStatus(requested: false, jobID: nil, errorCode: nil) == .notRequested, "manual uploads stay unprocessed")
    check(UploadProcessingStatus(requested: true, jobID: "job", errorCode: nil) == .started, "confirmed processing can announce success")
    check(UploadProcessingStatus(requested: true, jobID: nil, errorCode: "insufficient_minutes") == .needsMinutes, "minute refusal never announces processing success")
    check(UploadProcessingStatus(requested: true, jobID: nil, errorCode: nil) == .notStarted, "unconfirmed processing never announces success")
}

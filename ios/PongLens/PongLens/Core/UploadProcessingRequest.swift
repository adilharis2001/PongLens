import Foundation

/// Type supplies defaults only until the player makes an explicit choice.
struct UploadProcessingChoice {
    private(set) var process: Bool
    private(set) var placement: Bool
    private let defaultProcess: Bool
    private let defaultPlacement: Bool
    private var processChosen = false
    private var placementChosen = false
    init(process: Bool, placement: Bool) {
        self.process = process; self.placement = placement
        defaultProcess = process; defaultPlacement = placement
    }
    mutating func chooseProcess(_ value: Bool) { process = value; processChosen = true }
    mutating func choosePlacement(_ value: Bool) { placement = value; placementChosen = true }
    mutating func selectType(tracksServe: Bool) {
        if !processChosen { process = tracksServe && defaultProcess }
        if !placementChosen { placement = tracksServe && defaultPlacement }
    }
}

/// Survives multipart completion and app restart. The server deduplicates id
/// even if the original reply was lost and its job has already finished.
struct UploadProcessingRequest: Codable, Equatable, Identifiable {
    let id: UUID
    let ownerID: UUID
    var matchID: UUID
    let placement: Bool
    let trimStartS: Double?
    let trimEndS: Double?
    private(set) var jobID: UUID?
    private(set) var errorCode: String?
    private(set) var retryCount = 0
    private(set) var nextAttemptAt: Date?
    private(set) var blocked = false
    init(ownerID: UUID, matchID: UUID, placement: Bool, trimStartS: Double?, trimEndS: Double?) {
        id = UUID(); self.ownerID = ownerID; self.matchID = matchID
        self.placement = placement; self.trimStartS = trimStartS; self.trimEndS = trimEndS
    }
    var isPending: Bool { jobID == nil && !blocked }
    func isDue(now: Date = Date()) -> Bool { isPending && (nextAttemptAt == nil || nextAttemptAt! <= now) }
    mutating func accepted(jobID: UUID) { self.jobID = jobID; errorCode = nil; nextAttemptAt = nil }
    mutating func failed(httpStatus: Int?, code: String, now: Date = Date()) {
        errorCode = code
        let retryable = httpStatus == nil || httpStatus == 401 || httpStatus == 408 || httpStatus == 429
            || (httpStatus ?? 0) >= 500 || code == "queue_full" || code == "check_pending"
        blocked = !retryable
        retryCount = min(retryCount + 1, 30)
        nextAttemptAt = retryable ? now.addingTimeInterval(min(300, 5 * pow(2, Double(min(retryCount, 6))))) : nil
    }
}

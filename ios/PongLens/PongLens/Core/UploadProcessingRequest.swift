import Foundation

/// The answers to "Break it into points" on the upload sheet, which
/// replaced the "Process when the upload finishes" switch (owner-approved
/// mockup, 2026-09-25). The web's upload card offers the same three.
enum UploadCutWay: Hashable, CaseIterable {
    /// Decide on the match page. Exactly the old switch off.
    case later
    /// Exactly the old switch on: the same persisted request, the same
    /// retries, the same options sent.
    case automatic
    /// The switch off, and the marker opens on the phone's own copy once
    /// the sheet is done (RecordingQueue.markerSession).
    case byHand

    /// Only Automatically asks for processing when the upload lands.
    var processes: Bool { self == .automatic }

    /// Only Mark the points yourself opens the marker.
    var opensMarker: Bool { self == .byHand }

    /// The rows the sheet offers, in order. Mark the points yourself only
    /// for an account that can mark by hand.
    static func offered(marking: Bool) -> [UploadCutWay] {
        marking ? [.later, .automatic, .byHand] : [.later, .automatic]
    }

    /// The N of "Uses {N} of your {M} minutes." under the sheet's trim:
    /// every file of the session, each at least a minute and each its trim
    /// window where one was chosen, because it is the number the charge
    /// will match. Zero while no file has entered the queue yet.
    static func minutes(_ files: [(durationS: Double, trimStartS: Double?, trimEndS: Double?)]) -> Int {
        files.reduce(0) { total, file in
            let kept = file.trimEndS.map { max(0, $0 - (file.trimStartS ?? 0)) } ?? file.durationS
            return total + max(1, Int(ceil(kept / 60)))
        }
    }

    /// The match the marker opens for a session: its earliest file's (a
    /// 45-minute roll is several matches, and play starts in the first).
    /// Nil until that file has registered.
    static func markerMatch(_ files: [(capturedAtMs: Int64, matchId: UUID?)]) -> UUID? {
        files.min { $0.capturedAtMs < $1.capturedAtMs }?.matchId
    }
}

/// The sheet's answer and the placement that rides with it.
///
/// The way always opens on Later, whatever the type and whatever the last
/// upload chose, and Type never moves it: Later is the default for every
/// type, so an explicit answer survives any Type change (the upload-intent
/// contract of 2026-09-13). Type still supplies placement's default until
/// the player chooses.
struct UploadProcessingChoice {
    private(set) var way: UploadCutWay
    private(set) var placement: Bool
    private let defaultPlacement: Bool
    private var placementChosen = false
    /// `way` is Later for a new upload. A sheet reopened on a running
    /// upload passes the answer the session already carries.
    init(way: UploadCutWay = .later, placement: Bool) {
        self.way = way; self.placement = placement
        defaultPlacement = placement
    }
    /// What the queue sends, exactly as the switch did.
    var process: Bool { way.processes }
    mutating func choose(_ way: UploadCutWay) { self.way = way }
    mutating func choosePlacement(_ value: Bool) { placement = value; placementChosen = true }
    mutating func selectType(tracksServe: Bool) {
        if !placementChosen { placement = tracksServe && defaultPlacement }
    }
    /// The account turned out not to mark by hand: the row is gone, and
    /// its answer goes back to Later rather than staying chosen unseen.
    mutating func markingUnavailable() {
        if way == .byHand { way = .later }
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

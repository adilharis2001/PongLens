import Foundation

/// Observed worker state and advisory camera evidence. No unvalidated ETA.
struct MatchProcessingFeedback: Decodable, Hashable {
    let matchId: UUID
    let jobId: UUID?
    let jobStatus: String?
    let jobKind: String?
    let stage: String?
    let workerState: String?
    let checkedAtString: String?
    let windowStartS: Double?
    let windowEndS: Double?
    let cameraCheck: CameraCheck?

    enum CodingKeys: String, CodingKey {
        case matchId = "match_id", jobId = "job_id", jobStatus = "job_status"
        case jobKind = "job_kind", stage, workerState = "worker_state"
        case checkedAtString = "checked_at", windowStartS = "window_start_s"
        case windowEndS = "window_end_s", cameraCheck = "camera_check"
    }

    struct CameraCheck: Decodable, Hashable {
        let statusString: String
        let changes: [Change]
        enum CodingKeys: String, CodingKey { case statusString = "status", changes }
        init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            statusString = try values.decode(String.self, forKey: .statusString)
            changes = try values.decodeIfPresent([Change].self, forKey: .changes) ?? []
        }
    }
    struct Change: Decodable, Hashable {
        let beforeS: Double
        let afterS: Double
        enum CodingKeys: String, CodingKey { case beforeS = "before_s", afterS = "after_s" }
    }

    var stageLabel: String? {
        guard jobStatus == "queued" || jobStatus == "processing" else { return nil }
        let checking = jobKind == "content_check"
        if workerState == "silent" { return checking ? "Video check is delayed" : "Processing is delayed" }
        if jobStatus == "queued" { return checking ? "Waiting to check video" : "Waiting to process" }
        guard workerState == "fresh" else { return nil }
        switch stage {
        case "content_check": return "Checking video"
        case "camera_check": return "Checking the camera view"
        case "download", "trim": return "Preparing video"
        case "import": return "Importing video"
        case "ball": return "Finding the ball"
        case "points", "bodies": return "Finding the points"
        case "cut": return "Removing dead time"
        case "publish": return "Preparing your match"
        default: return checking ? "Checking video" : "Processing your match"
        }
    }

    func cameraWarning(trimStart: Double = 0, trimEnd: Double = .infinity) -> String? {
        guard trimStart.isFinite, trimStart >= 0, !trimEnd.isNaN, trimEnd > trimStart,
              let cameraCheck, cameraCheck.statusString == "changed",
              cameraCheck.changes.contains(where: {
                  $0.beforeS.isFinite && $0.afterS.isFinite && $0.beforeS >= 0
                      && $0.beforeS < $0.afterS && $0.beforeS >= trimStart && $0.afterS <= trimEnd
              }) else { return nil }
        return "The camera view changes during this recording. Try trimming to a section with a fixed view of the same table."
    }
}

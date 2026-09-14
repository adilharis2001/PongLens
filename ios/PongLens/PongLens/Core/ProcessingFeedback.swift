import Foundation

/// Observations, advisory camera evidence and an optional server-owned rough estimate.
struct MatchProcessingFeedback: Decodable, Hashable {
    let matchId: UUID
    let jobId: UUID?
    let jobStatus: String?
    let jobKind: String?
    let stage: String?
    let workerState: String?
    let serviceState: String?
    let lane: String?
    let checkedAtString: String?
    let windowStartS: Double?
    let windowEndS: Double?
    let cameraCheck: CameraCheck?
    var estimate: ProcessingEstimate? = nil

    enum CodingKeys: String, CodingKey {
        case matchId = "match_id", jobId = "job_id", jobStatus = "job_status"
        case jobKind = "job_kind", stage, workerState = "worker_state", serviceState = "service_state", lane
        case checkedAtString = "checked_at", windowStartS = "window_start_s"
        case windowEndS = "window_end_s", cameraCheck = "camera_check", estimate
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
        guard jobKind != "content_check" else { return nil }
        guard jobStatus == "queued" || jobStatus == "processing" else { return nil }
        if workerState == "silent" { return "Processing is delayed" }
        if jobStatus == "queued" { return "Waiting to process" }
        guard workerState == "fresh" else { return nil }
        switch stage {
        case "content_check": return "Processing your match"
        case "camera_check": return "Checking the camera view"
        case "download", "trim": return "Preparing video"
        case "import": return "Importing video"
        case "ball": return "Finding the ball"
        case "points", "bodies": return "Finding the points"
        case "cut": return "Removing dead time"
        case "publish": return "Preparing your match"
        default: return "Processing your match"
        }
    }

    func cameraWarning(trimStart: Double = 0, trimEnd: Double = .infinity) -> String? {
        guard trimStart.isFinite, trimStart >= 0, !trimEnd.isNaN, trimEnd > trimStart,
              let cameraCheck, cameraCheck.statusString == "changed",
              cameraCheck.changes.contains(where: {
                  $0.beforeS.isFinite && $0.afterS.isFinite && $0.beforeS >= 0
                      && $0.beforeS < $0.afterS && $0.beforeS >= trimStart && $0.afterS <= trimEnd
              }) else { return nil }
        if let start = windowStartS, let end = windowEndS,
           start.isFinite, end.isFinite, start >= 0, end > start, end - start <= 10 {
            return "The camera view changes during this recording. Keep the camera in a fixed position with the same table in view."
        }
        return "The camera view changes during this recording. Try trimming to a section with a fixed view of the same table."
    }
}

extension MatchProcessingFeedback {
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        matchId = try values.decode(UUID.self, forKey: .matchId)
        jobId = try values.decodeIfPresent(UUID.self, forKey: .jobId)
        jobStatus = try values.decodeIfPresent(String.self, forKey: .jobStatus)
        jobKind = try values.decodeIfPresent(String.self, forKey: .jobKind)
        stage = try values.decodeIfPresent(String.self, forKey: .stage)
        workerState = try values.decodeIfPresent(String.self, forKey: .workerState)
        serviceState = try values.decodeIfPresent(String.self, forKey: .serviceState)
        lane = try values.decodeIfPresent(String.self, forKey: .lane)
        checkedAtString = try values.decodeIfPresent(String.self, forKey: .checkedAtString)
        windowStartS = try values.decodeIfPresent(Double.self, forKey: .windowStartS)
        windowEndS = try values.decodeIfPresent(Double.self, forKey: .windowEndS)
        cameraCheck = try values.decodeIfPresent(CameraCheck.self, forKey: .cameraCheck)
        // Advisory timing must not discard established processing or camera feedback.
        estimate = try? values.decodeIfPresent(ProcessingEstimate.self, forKey: .estimate)
    }
}

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
    /// A hand cut the owner's iPhone cut or is cutting (20260925061009):
    /// phase "device" while the phone works, "verify" once the Mac checks
    /// it, "mac" when the Mac took it over. Nil on every other job.
    var cutter: String? = nil
    var phase: String? = nil
    /// The phone's own stage, and when it last reported (its claim when it
    /// never has), while phase is "device".
    var deviceStage: String? = nil
    var deviceSeenAtString: String? = nil

    enum CodingKeys: String, CodingKey {
        case matchId = "match_id", jobId = "job_id", jobStatus = "job_status"
        case jobKind = "job_kind", stage, workerState = "worker_state", serviceState = "service_state", lane
        case checkedAtString = "checked_at", windowStartS = "window_start_s"
        case windowEndS = "window_end_s", cameraCheck = "camera_check", estimate
        case cutter, phase, deviceStage = "device_stage", deviceSeenAtString = "device_seen_at"
    }

    /// The owner's iPhone is cutting this match; no Mac lane is involved yet.
    var onDevice: Bool { jobKind == "hand_cut" && phase == "device" }

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
        // The phone is doing the work, so the Mac's lanes and pulses say
        // nothing about it: its own stage is the whole answer.
        if onDevice { return Self.deviceStageLabel(deviceStage) }
        if workerState == "silent" { return "Processing is delayed" }
        let handCut = jobKind == "hand_cut"
        // A hand cut waits in the same words whoever cut it: a phone's cut
        // waiting for its check is not told apart.
        if jobStatus == "queued" { return handCut ? "Waiting to prepare clips" : "Waiting to process" }
        guard workerState == "fresh" else { return nil }
        if handCut { return Self.handCutStageLabel(stage) }
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

    /// The words for a cut that is queued or running, wherever it is shown:
    /// the unprocessed page's card, and More options and the progress card
    /// on a processed match, so a Replace waiting its turn reads "Waiting to
    /// prepare clips" in both places, as an unprocessed hand cut does (QA
    /// 2026-09-25). The feedback's stage while it describes an active job;
    /// until it catches up with a job the screen already holds (the claim
    /// that just returned), that job's own queued words. Nil leaves the
    /// card's "Processing".
    static func runningLabel(
        _ feedback: MatchProcessingFeedback?, jobKind: String?, jobStatus: String?
    ) -> String? {
        if let feedback, feedback.jobStatus == "queued" || feedback.jobStatus == "processing" {
            return feedback.stageLabel
        }
        guard jobStatus == "queued", jobKind != "content_check" else { return nil }
        return jobKind == "hand_cut" ? "Waiting to prepare clips" : "Waiting to process"
    }

    /// A hand cut runs its own stages (worker.py process_hand_cut). None of
    /// them finds points or removes dead time: the owner's marks already did
    /// both. The words are the same wherever the cut runs, so a player never
    /// learns where that is: the Mac checking a phone's cut is "Saving the
    /// match", as its publish is. The web's HAND_CUT_STAGES in
    /// src/lib/processingFeedback.ts.
    static func handCutStageLabel(_ stage: String?) -> String {
        switch stage {
        case "marks": return "Reading the marks"
        case "download": return "Preparing video"
        case "cut": return "Cutting the video"
        case "upload": return "Uploading the result"
        case "points": return "Building the points"
        case "publish", "device_verify": return "Saving the match"
        default: return "Preparing clips"
        }
    }

    /// The phone's own stages, in the hand cut's words: its encoding (and a
    /// pause in it) is "Cutting the video", its upload "Uploading the
    /// result". The web's deviceStageLabel in src/lib/deviceHandCut.ts.
    static func deviceStageLabel(_ stage: String?) -> String {
        handCutStageLabel(stage == "device_upload" ? "upload" : "cut")
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
        cutter = try? values.decodeIfPresent(String.self, forKey: .cutter)
        phase = try? values.decodeIfPresent(String.self, forKey: .phase)
        deviceStage = try? values.decodeIfPresent(String.self, forKey: .deviceStage)
        deviceSeenAtString = try? values.decodeIfPresent(String.self, forKey: .deviceSeenAtString)
    }
}

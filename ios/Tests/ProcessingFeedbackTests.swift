import Foundation

private let processingCameraWarning =
    "The camera view changes during this recording. Try trimming to a section with a fixed view of the same table."
private let shortProcessingCameraWarning =
    "The camera view changes during this recording. Keep the camera in a fixed position with the same table in view."

private func decodeProcessingFeedback(_ json: String) -> MatchProcessingFeedback? {
    do {
        return try JSONDecoder().decode(MatchProcessingFeedback.self, from: Data(json.utf8))
    } catch {
        check(false, "processing feedback decodes: \(error)")
        return nil
    }
}

func runProcessingFeedbackChecks() {
    suite("processing feedback decodes the RPC boundary") {
        let decoded = decodeProcessingFeedback("""
        {
          "match_id": "00000000-0000-0000-0000-000000000001",
          "job_id": "00000000-0000-0000-0000-000000000002",
          "job_status": "processing",
          "job_kind": "deadspace_cut",
          "stage": "ball",
          "worker_state": "fresh",
          "checked_at": "2026-09-12T16:30:00Z",
          "window_start_s": 12.5,
          "window_end_s": 45.75,
          "camera_check": {
            "status": "changed",
            "changes": [{ "before_s": 20.25, "after_s": 21.5 }]
          }
        }
        """)

        guard let decoded else { return }
        eq(decoded.matchId, uuid(1), "snake-case match id becomes a UUID")
        eq(decoded.jobId, Optional(uuid(2)), "snake-case job id becomes an optional UUID")
        eq(decoded.jobStatus, Optional("processing"), "job status crosses the JSON boundary")
        eq(decoded.jobKind, Optional("deadspace_cut"), "job kind crosses the JSON boundary")
        eq(decoded.stage, Optional("ball"), "stage crosses the JSON boundary")
        eq(decoded.workerState, Optional("fresh"), "worker state crosses the JSON boundary")
        eq(decoded.checkedAtString, Optional("2026-09-12T16:30:00Z"), "checked-at stays an exact server string")
        near(decoded.windowStartS, 12.5, "window start decodes from window_start_s")
        near(decoded.windowEndS, 45.75, "window end decodes from window_end_s")
        eq(decoded.cameraCheck?.statusString, Optional("changed"), "camera status decodes")
        eq(decoded.cameraCheck?.changes.count, Optional(1), "camera changes decode")
        near(decoded.cameraCheck?.changes.first?.beforeS, 20.25, "camera before boundary decodes")
        near(decoded.cameraCheck?.changes.first?.afterS, 21.5, "camera after boundary decodes")
        check(Set([decoded]).count == 1, "processing feedback is hashable")
    }

    suite("processing feedback tolerates absent optional data") {
        let decoded = decodeProcessingFeedback("""
        { "match_id": "00000000-0000-0000-0000-000000000001" }
        """)

        guard let decoded else { return }
        eq(decoded.jobId, nil, "missing job id is nil")
        eq(decoded.jobStatus, nil, "missing job status is nil")
        eq(decoded.jobKind, nil, "missing job kind is nil")
        eq(decoded.stage, nil, "missing stage is nil")
        eq(decoded.workerState, nil, "missing worker state is nil")
        eq(decoded.checkedAtString, nil, "missing checked-at is nil")
        eq(decoded.windowStartS, nil, "missing window start is nil")
        eq(decoded.windowEndS, nil, "missing window end is nil")
        eq(decoded.cameraCheck, nil, "missing camera check is nil")
        eq(decoded.stageLabel, nil, "missing job data makes no processing claim")
        eq(decoded.cameraWarning(), nil, "missing camera data makes no warning")

        let cameraWithoutChanges = decodeProcessingFeedback("""
        {
          "match_id": "00000000-0000-0000-0000-000000000001",
          "camera_check": { "status": "changed" }
        }
        """)
        eq(cameraWithoutChanges?.cameraCheck?.changes.count, Optional(0), "missing camera changes decode as an empty list")
        eq(cameraWithoutChanges?.cameraWarning(), nil, "changed status without a measured change does not warn")
    }

    suite("processing stages use the same player language as web") {
        let cases: [(String, String)] = [
            ("content_check", "Checking video"),
            ("camera_check", "Checking the camera view"),
            ("download", "Preparing video"),
            ("import", "Importing video"),
            ("trim", "Preparing video"),
            ("ball", "Finding the ball"),
            ("points", "Finding the points"),
            ("bodies", "Finding the points"),
            ("cut", "Removing dead time"),
            ("publish", "Preparing your match")
        ]

        for (stage, expected) in cases {
            let decoded = decodeProcessingFeedback("""
            {
              "match_id": "00000000-0000-0000-0000-000000000001",
              "job_status": "processing",
              "job_kind": "deadspace_cut",
              "stage": "\(stage)",
              "worker_state": "fresh"
            }
            """)
            eq(decoded?.stageLabel, Optional(expected), "\(stage) has its agreed label")
        }
    }

    suite("processing stage claims require current worker evidence") {
        let queued = decodeProcessingFeedback("""
        { "match_id":"00000000-0000-0000-0000-000000000001", "job_status":"queued", "job_kind":"deadspace_cut" }
        """)
        let queuedCheck = decodeProcessingFeedback("""
        { "match_id":"00000000-0000-0000-0000-000000000001", "job_status":"queued", "job_kind":"content_check" }
        """)
        let silent = decodeProcessingFeedback("""
        { "match_id":"00000000-0000-0000-0000-000000000001", "job_status":"processing", "job_kind":"deadspace_cut", "stage":"ball", "worker_state":"silent" }
        """)
        let silentCheck = decodeProcessingFeedback("""
        { "match_id":"00000000-0000-0000-0000-000000000001", "job_status":"processing", "job_kind":"content_check", "stage":"content_check", "worker_state":"silent" }
        """)
        let missing = decodeProcessingFeedback("""
        { "match_id":"00000000-0000-0000-0000-000000000001", "job_status":"processing", "stage":"ball", "worker_state":"missing" }
        """)
        let unknownStage = decodeProcessingFeedback("""
        { "match_id":"00000000-0000-0000-0000-000000000001", "job_status":"processing", "job_kind":"deadspace_cut", "stage":"future_stage", "worker_state":"fresh" }
        """)
        let unknownCheckStage = decodeProcessingFeedback("""
        { "match_id":"00000000-0000-0000-0000-000000000001", "job_status":"processing", "job_kind":"content_check", "stage":"future_stage", "worker_state":"fresh" }
        """)
        let done = decodeProcessingFeedback("""
        { "match_id":"00000000-0000-0000-0000-000000000001", "job_status":"done", "stage":"publish", "worker_state":"fresh" }
        """)
        let failed = decodeProcessingFeedback("""
        { "match_id":"00000000-0000-0000-0000-000000000001", "job_status":"failed", "stage":"publish", "worker_state":"fresh" }
        """)

        eq(queued?.stageLabel, Optional("Waiting to process"), "queued processing says it is waiting")
        eq(queuedCheck?.stageLabel, Optional("Waiting to check video"), "queued content check names the check")
        eq(silent?.stageLabel, Optional("Processing is delayed"), "silent processing says it is delayed")
        eq(silentCheck?.stageLabel, Optional("Video check is delayed"), "silent content check names the delay")
        eq(missing?.stageLabel, nil, "missing worker evidence does not invent a live stage")
        eq(unknownStage?.stageLabel, Optional("Processing your match"), "unknown processing stage has a calm fallback")
        eq(unknownCheckStage?.stageLabel, Optional("Checking video"), "unknown check stage has a check fallback")
        eq(done?.stageLabel, nil, "terminal jobs have no processing label")
        eq(failed?.stageLabel, nil, "failed jobs have no processing label")
    }

    suite("camera warnings respect status and the selected trim") {
        let changed = decodeProcessingFeedback("""
        {
          "match_id":"00000000-0000-0000-0000-000000000001",
          "camera_check": {
            "status":"changed",
            "changes":[
              {"before_s":9,"after_s":12},
              {"before_s":12,"after_s":14},
              {"before_s":18,"after_s":21}
            ]
          }
        }
        """)
        let boundary = decodeProcessingFeedback("""
        {
          "match_id":"00000000-0000-0000-0000-000000000001",
          "camera_check":{"status":"changed","changes":[{"before_s":10,"after_s":20}]}
        }
        """)
        let stable = decodeProcessingFeedback("""
        {
          "match_id":"00000000-0000-0000-0000-000000000001",
          "camera_check":{"status":"stable","changes":[{"before_s":12,"after_s":14}]}
        }
        """)
        let unknown = decodeProcessingFeedback("""
        {
          "match_id":"00000000-0000-0000-0000-000000000001",
          "camera_check":{"status":"future_status","changes":[{"before_s":12,"after_s":14}]}
        }
        """)
        let invalidChanges = decodeProcessingFeedback("""
        {
          "match_id":"00000000-0000-0000-0000-000000000001",
          "camera_check":{"status":"changed","changes":[{"before_s":-1,"after_s":2},{"before_s":8,"after_s":7}]}
        }
        """)
        let shortRecording = decodeProcessingFeedback("""
        {
          "match_id":"00000000-0000-0000-0000-000000000001",
          "window_start_s":0,
          "window_end_s":7,
          "camera_check":{"status":"changed","changes":[{"before_s":2,"after_s":3}]}
        }
        """)

        eq(changed?.cameraWarning(trimStart: 10, trimEnd: 20), Optional(processingCameraWarning), "one wholly contained change warns")
        eq(boundary?.cameraWarning(trimStart: 10, trimEnd: 20), Optional(processingCameraWarning), "a change touching both trim boundaries warns")
        eq(shortRecording?.cameraWarning(), Optional(shortProcessingCameraWarning), "a short checked recording avoids unavailable trim guidance")
        eq(changed?.cameraWarning(trimStart: 14, trimEnd: 18), nil, "partial and out-of-window changes are ignored")
        eq(stable?.cameraWarning(), nil, "stable status does not warn")
        eq(unknown?.cameraWarning(), nil, "unknown camera status does not warn")
        eq(invalidChanges?.cameraWarning(), nil, "negative and reversed change windows do not warn")
        eq(changed?.cameraWarning(trimStart: -1, trimEnd: 20), nil, "negative selected start is invalid")
        eq(changed?.cameraWarning(trimStart: 20, trimEnd: 10), nil, "reversed selected window is invalid")
        eq(changed?.cameraWarning(trimStart: .nan, trimEnd: 20), nil, "NaN selected start is invalid")
        check(!(changed?.cameraWarning(trimStart: 10, trimEnd: 20) ?? "").contains("12"), "warning does not expose detection timestamps")
    }
}

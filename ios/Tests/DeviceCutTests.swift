import Foundation

// Cutting a hand-marked match on the phone: the job, its order, the
// manifest and the guards (Core/DeviceCutJob.swift). The encoder, the
// background task and the uploads need a phone; everything that decides
// what they do is here.

private nonisolated struct LiveCase: Decodable {
    struct Case: Decodable {
        let name: String
        let marks: [[Double]]
    }
    let cases: [Case]
}

private func liveMarks(_ name: String) -> [[Double]] {
    let url = URL(fileURLWithPath: "fixtures/cut-plan-parity.json")
    guard let data = try? Data(contentsOf: url),
          let fx = try? JSONDecoder().decode(LiveCase.self, from: data),
          let c = fx.cases.first(where: { $0.name == name })
    else { return [] }
    return c.marks
}

private let testJob = UUID(uuidString: "5D1C0000-0000-4000-8000-00000000000A")!
private let testMatch = UUID(uuidString: "04F1B393-F16F-4242-9F51-A853A276BAE8")!
private let testUser = UUID(uuidString: "A2E61027-2EE9-4026-A058-DC07441EE633")!

private func claimJSON(points: Int) -> Data {
    let uid = testUser.uuidString.lowercased()
    let mid = testMatch.uuidString.lowercased()
    let jid = testJob.uuidString.lowercased()
    let clips = (1...points).map { "\"points/\(uid)/\(mid)/\(CutPlan.clipName($0))\"" }.joined(separator: ",")
    return """
    {"job_id": "\(jid)", "points": \(points), "bucket": "ponglens-media",
     "keys": {"cut": "results/\(uid)/\(jid).mp4",
              "manifest": "results/\(uid)/\(jid).manifest.json",
              "clips": [\(clips)]},
     "clip_pads": {"pre": 1.2, "post": 1.3}}
    """.data(using: .utf8)!
}

private func makeJob(marks: [[Double]], duration: Double) -> (DeviceCutJob, CutPlan.Plan)? {
    let plan = CutPlan.plan(marks: marks, duration: duration)
    guard let claim = try? JSONDecoder().decode(DeviceCutClaim.self, from: claimJSON(points: marks.count))
    else { return nil }
    let source = DeviceCutSource(duration: duration, fps: Double(Float(29.97003)), width: 1920, height: 1080,
                                 rotation: 0, hasAudio: true, bytes: 229_072_083)
    return (DeviceCutJob(claim: claim, matchId: testMatch, userId: testUser, source: source, plan: plan,
                         createdAt: Date(timeIntervalSince1970: 1_790_000_000)), plan)
}

func runDeviceCutChecks() {
    print("\n— cutting on the iPhone: job, order, manifest, guards —")

    // MARK: The claim

    let marks = liveMarks("live 04f1b393")
    check(marks.count == 20, "the live case's 20 marks load")
    guard let (fresh, plan) = makeJob(marks: marks, duration: 236.3233) else {
        check(false, "a claim decodes and a job builds")
        return
    }
    eq(fresh.claim.jobId, testJob, "job id decodes from the lowercase string")
    eq(fresh.claim.keys.clips.count, 20, "one clip key per mark")
    check(fresh.claim.mismatch(with: plan) == nil, "the claim's keys and pads agree with the plan")
    eq(fresh.claim.clipKey(20), "points/\(testUser.uuidString.lowercased())/\(testMatch.uuidString.lowercased())/20.mp4", "clip key 20")
    eq(fresh.claim.clipKey(21), nil, "no key past the marks")
    var wrongPads = fresh.claim
    wrongPads.clipPads.post = 1.0
    check(wrongPads.mismatch(with: plan) != nil, "different pads refuse")
    var fewKeys = fresh.claim
    fewKeys.keys.clips.removeLast()
    check(fewKeys.mismatch(with: plan) != nil, "too few clip keys refuse")
    var swapped = fresh.claim
    swapped.keys.clips.swapAt(0, 1)
    check(swapped.mismatch(with: plan) != nil, "a key naming another point's clip refuses")

    // MARK: The order of the work, and where it resumes

    var job = fresh
    eq(DeviceCutFlow.next(job), .encodeCut, "a fresh job cuts first")
    job.cut = .init(bytes: 150_000_000, duration: plan.kept, width: 1920, height: 1080,
                    measuredOffsets: plan.offsets, firstFrames: plan.offsets.map { $0 + 0.02 }, wall: 300)
    eq(DeviceCutFlow.next(job), .encodeClip(1), "then clip 1")
    for p in plan.points where p.idx <= 7 {
        job.clips.append(.init(idx: p.idx, bytes: 2_000_000 + Int64(p.idx), wall: 3))
    }
    eq(DeviceCutFlow.next(job), .encodeClip(8), "a relaunch after seven clips resumes at clip 8")
    for p in plan.points where p.idx > 7 {
        job.clips.append(.init(idx: p.idx, bytes: 2_000_000 + Int64(p.idx), wall: 3))
    }
    check(job.encodingDone, "every file written")
    eq(DeviceCutFlow.next(job), .prepareUpload, "then the upload is prepared")
    job.uploadId = "mpu-1"
    eq(DeviceCutFlow.next(job), .prepareUpload, "an upload created but not sliced prepares again")
    job.partCount = 3
    job.partsSliced = true
    eq(DeviceCutFlow.next(job), .upload(parts: [1, 2, 3], clips: Array(1...20)), "every part and clip goes up")
    job.etags = [1: "\"e1\"", 3: "\"e3\""]
    job.clipsUploaded = Array(1...18)
    eq(DeviceCutFlow.next(job), .upload(parts: [2], clips: [19, 20]), "only what is missing goes again")

    // A job written to disk and read back resumes at the same step.
    do {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let back = try decoder.decode(DeviceCutJob.self, from: encoder.encode(job))
        eq(back, job, "the job survives a round trip to disk")
        eq(DeviceCutFlow.next(back), .upload(parts: [2], clips: [19, 20]), "and resumes where it was")
    } catch {
        check(false, "the job encodes and decodes: \(error)")
    }

    job.etags[2] = "\"e2\""
    job.clipsUploaded = Array(1...20)
    eq(DeviceCutFlow.next(job), .completeCut, "all parts up: complete the cut")
    job.cutUploaded = true
    eq(DeviceCutFlow.next(job), .uploadManifest, "then the manifest, last")
    job.manifestUploaded = true
    eq(DeviceCutFlow.next(job), .submit, "then submit")
    job.submitted = true
    eq(DeviceCutFlow.next(job), .finished, "then nothing")

    // Submit found objects missing: send just those again.
    var missing = job
    missing.submitted = false
    DeviceCutFlow.missing(&missing, keys: [fresh.claim.keys.clips[4]])
    eq(DeviceCutFlow.next(missing), .upload(parts: [], clips: [5]), "a missing clip goes again")
    check(!missing.manifestUploaded, "and the manifest after it")
    DeviceCutFlow.missing(&missing, keys: [fresh.claim.keys.cut])
    eq(DeviceCutFlow.next(missing), .encodeCut, "a missing cut is cut again: its parts are gone")
    check(missing.clips.count == 20, "the clips are kept")

    // MARK: Failures

    var failing = fresh
    check(!DeviceCutFlow.recordFailure(&failing, step: .encodeCut, interrupted: true), "an interruption is not a failure")
    eq(failing.failures["cut"], nil, "nothing counted")
    check(!DeviceCutFlow.recordFailure(&failing, step: .encodeCut, interrupted: false), "one failed cut tries again")
    eq(DeviceCutFlow.next(failing), .encodeCut, "and cuts again")
    check(DeviceCutFlow.recordFailure(&failing, step: .encodeCut, interrupted: false), "a second failed cut stops")
    eq(DeviceCutFlow.next(failing), .stopped(.encodeFailed), "and hands the job over")

    var clipFailing = fresh
    clipFailing.cut = job.cut
    DeviceCutFlow.recordFailure(&clipFailing, step: .encodeClip(1), interrupted: false)
    eq(DeviceCutFlow.next(clipFailing), .encodeClip(1), "a clip that failed once is tried again")
    DeviceCutFlow.recordFailure(&clipFailing, step: .encodeClip(1), interrupted: false)
    eq(clipFailing.clipsAbandoned, [1], "twice, and it is left to the Mac")
    eq(DeviceCutFlow.next(clipFailing), .encodeClip(2), "the phone moves on to the next clip")
    for idx in [2, 3] {
        DeviceCutFlow.recordFailure(&clipFailing, step: .encodeClip(idx), interrupted: false)
        DeviceCutFlow.recordFailure(&clipFailing, step: .encodeClip(idx), interrupted: false)
    }
    eq(DeviceCutFlow.next(clipFailing), .stopped(.encodeFailed), "three clips the phone cannot make stop the job")

    var lost = job
    lost.submitted = false
    DeviceCutFlow.uploadLost(&lost)
    eq(DeviceCutFlow.next(lost), .encodeCut, "a vanished multipart upload cuts again")

    // MARK: Stages and progress

    eq(DeviceCutFlow.reportStage(.encodeCut, paused: false), "device_cut", "cutting")
    eq(DeviceCutFlow.reportStage(.encodeClip(3), paused: false), "device_clips", "clips")
    eq(DeviceCutFlow.reportStage(.upload(parts: [1], clips: []), paused: false), "device_upload", "uploading")
    eq(DeviceCutFlow.reportStage(.uploadManifest, paused: false), "device_upload", "the manifest is uploading too")
    eq(DeviceCutFlow.reportStage(.encodeCut, paused: true), "device_paused", "paused wins")
    eq(DeviceCutFlow.reportStage(.stopped(.encodeFailed), paused: false), "device_paused", "stopped reads paused")

    eq(DeviceCutFlow.progress(fresh, step: .encodeCut), 0, "nothing done")
    eq(DeviceCutFlow.progress(fresh, step: .encodeCut, fraction: 0.5), 30, "half the cut is 30")
    var halfClips = fresh
    halfClips.cut = job.cut
    eq(DeviceCutFlow.progress(halfClips, step: .encodeClip(1)), 60, "the cut done is 60")
    for p in plan.points { halfClips.clips.append(.init(idx: p.idx, bytes: 1, wall: 1)) }
    halfClips.uploadId = "u"
    halfClips.partCount = 3
    halfClips.partsSliced = true
    eq(DeviceCutFlow.progress(halfClips, step: .upload(parts: [1, 2, 3], clips: [])), 80, "all files written is 80")
    halfClips.cutUploaded = true
    halfClips.clipsUploaded = plan.points.map(\.idx)
    eq(DeviceCutFlow.progress(halfClips, step: .uploadManifest), 99, "everything up but not handed over is 99")
    halfClips.submitted = true
    eq(DeviceCutFlow.progress(halfClips, step: .finished), 100, "submitted is 100")
    var mono = fresh
    var last = -1
    var monotonic = true
    for f in stride(from: 0.0, through: 1.0, by: 0.1) {
        let v = DeviceCutFlow.progress(mono, step: .encodeCut, fraction: f)
        monotonic = monotonic && v >= last
        last = v
    }
    mono.cut = job.cut
    for p in plan.points {
        for f in stride(from: 0.0, through: 1.0, by: 0.5) {
            let v = DeviceCutFlow.progress(mono, step: .encodeClip(p.idx), fraction: f)
            monotonic = monotonic && v >= last
            last = v
        }
        mono.clips.append(.init(idx: p.idx, bytes: 1_000_000, wall: 1))
    }
    check(monotonic, "progress never goes backwards through the cut and the clips")

    // MARK: When to report

    let t0 = Date(timeIntervalSince1970: 0)
    check(DeviceCutReportClock.due(now: t0, stage: "device_cut", progress: 0, lastStage: nil, lastProgress: nil, lastAt: nil),
          "the first report always goes")
    check(DeviceCutReportClock.due(now: t0.addingTimeInterval(1), stage: "device_clips", progress: 60,
                                   lastStage: "device_cut", lastProgress: 59, lastAt: t0), "a stage change goes at once")
    check(!DeviceCutReportClock.due(now: t0.addingTimeInterval(5), stage: "device_cut", progress: 10,
                                    lastStage: "device_cut", lastProgress: 5, lastAt: t0), "progress within 10 s waits")
    check(DeviceCutReportClock.due(now: t0.addingTimeInterval(10), stage: "device_cut", progress: 10,
                                   lastStage: "device_cut", lastProgress: 5, lastAt: t0), "progress after 10 s goes")
    check(!DeviceCutReportClock.due(now: t0.addingTimeInterval(30), stage: "device_cut", progress: 5,
                                    lastStage: "device_cut", lastProgress: 5, lastAt: t0), "no change, no report before 60 s")
    check(DeviceCutReportClock.due(now: t0.addingTimeInterval(60), stage: "device_cut", progress: 5,
                                   lastStage: "device_cut", lastProgress: 5, lastAt: t0), "a heartbeat every 60 s")

    // MARK: Heat, power and space

    eq(DeviceCutGuard.decide(thermal: 0, lowPower: false, freeBytes: 10_000_000_000, neededBytes: 1), .go, "nominal goes")
    eq(DeviceCutGuard.decide(thermal: 1, lowPower: false, freeBytes: nil, neededBytes: 1), .go, "fair goes")
    eq(DeviceCutGuard.decide(thermal: 2, lowPower: false, freeBytes: nil, neededBytes: 1), .cool, "serious waits between files")
    eq(DeviceCutGuard.decide(thermal: 3, lowPower: false, freeBytes: nil, neededBytes: 1), .hold(.heat), "critical stops")
    eq(DeviceCutGuard.decide(thermal: 0, lowPower: true, freeBytes: nil, neededBytes: 1), .hold(.lowPower), "Low Power Mode stops")
    eq(DeviceCutGuard.decide(thermal: 0, lowPower: false, freeBytes: 100, neededBytes: 101), .hold(.storage), "a full disk stops")
    eq(DeviceCutGuard.decide(thermal: 2, lowPower: true, freeBytes: 0, neededBytes: 1), .hold(.lowPower),
       "a stop outranks a wait")

    var thirty = fresh.source
    thirty.fps = 30
    eq(DeviceCutSettings.cutVideoBitrate(thirty), 6_220_800, "1080p30 cut at 0.1 bits per pixel (the contract's example)")
    eq(DeviceCutSettings.cutVideoBitrate(fresh.source), 6_214_585, "and at 29.97 fps, a touch less")
    let cutBytes = DeviceCutSettings.bytes(seconds: plan.kept, videoBitrate: 6_220_800, audioBitrate: 128_000)
    check(cutBytes > 140_000_000 && cutBytes < 145_000_000, "156 s of 1080p30 is about 142 MB (\(cutBytes))")
    let need = DeviceCutGuard.bytesNeeded(plan: plan, source: fresh.source)
    check(need > cutBytes + DeviceCutGuard.spareBytes, "the whole job needs the cut, the clips and spare room")
    eq(DeviceCutGuard.bytesNeeded(fresh), need, "a fresh job needs what the claim-time estimate said")
    var sliced = job
    sliced.submitted = false
    eq(DeviceCutGuard.bytesNeeded(sliced), DeviceCutGuard.spareBytes, "a job with every file written needs only the spare room")

    let fourK = DeviceCutSource(duration: 2700, fps: 60, width: 3840, height: 2160, rotation: 0, hasAudio: true, bytes: 0)
    let long = CutPlan.plan(marks: (0..<120).map { [Double($0) * 22 + 2, Double($0) * 22 + 20] }, duration: 2700)
    check(DeviceCutGuard.cutTooLarge(plan: long, source: fourK), "45 minutes of 4K60 is too large to upload as one cut")
    check(!DeviceCutGuard.cutTooLarge(plan: plan, source: fresh.source), "a 4-minute 1080p match is not")

    eq(DeviceCutSettings.clipVideoBitrate(seconds: 12), 2_500_000, "an ordinary clip is the Mac's 2.5 Mbps")
    let longClip = DeviceCutSettings.clipVideoBitrate(seconds: 182.5)
    check(longClip < 2_500_000, "a 3-minute clip is lowered (\(longClip))")
    check(DeviceCutSettings.bytes(seconds: 182.5, videoBitrate: longClip, audioBitrate: 96_000) <= DeviceCutSettings.maxClipBytes,
          "and fits the route's clip ceiling with room")
    eq(DeviceCutSettings.r3(Double(Float(29.97))), 29.97, "29.97 fps written as ffprobe's 3 decimals")
    eq(DeviceCutSettings.r3(Double(Float(59.94006))), 59.94, "59.94")

    // MARK: The manifest

    var done = job
    done.submitted = false
    done.clipsAbandoned = [3]
    done.clips.removeAll { $0.idx == 3 }
    done.cut?.measuredOffsets = plan.offsets.map { CutPlan.r2($0) }
    let encoderInfo = DeviceCutManifest.EncoderInfo(
        cut: .init(videoBitrate: 6_220_800), device: "iPhone13,2", os: "26.0", appBuild: "240")
    guard let manifest = DeviceCutManifest.build(
        done, encoder: encoderInfo, timing: .init(cutWall: 312.5, clipsWall: 80.1, uploadWall: 120))
    else {
        check(false, "a manifest builds once the cut exists")
        return
    }
    check(DeviceCutManifest.build(fresh) == nil, "no manifest before the cut")
    check(manifest.selfCheck(plannedOffsets: plan.offsets, expectedPoints: 20) == nil, "the phone's own check passes")

    guard let data = try? manifest.encoded(),
          let text = String(data: data, encoding: .utf8),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
        check(false, "the manifest encodes to a JSON object")
        return
    }
    check(data.count < 2 * 1024 * 1024, "under the 2 MB limit (\(data.count) bytes)")
    eq(Set(object.keys), ["schema", "pipeline", "cutter", "job_id", "match_id", "source", "clip_pads",
                          "cut_segments", "cut_segment_offsets", "cut_first_frame_s", "cut", "points",
                          "encoder", "timing"], "exactly the contract's keys")
    eq(object["schema"] as? Int, 1, "schema 1")
    eq(object["pipeline"] as? String, "hand-v1", "pipeline hand-v1")
    eq(object["cutter"] as? String, "device", "cutter device")
    eq(object["job_id"] as? String, testJob.uuidString.lowercased(), "the claim's job, lowercase")
    eq(object["match_id"] as? String, testMatch.uuidString.lowercased(), "the match, lowercase")
    let src = object["source"] as? [String: Any] ?? [:]
    eq(Set(src.keys), ["duration", "fps", "width", "height", "rotation"], "source keys")
    eq(src["duration"] as? Double, 236.3233, "D unrounded")
    eq(src["fps"] as? Double, 29.97, "fps to 3 decimals")
    check(text.contains("\"width\":1920") && text.contains("\"height\":1080"), "sizes are integers in the JSON")
    eq(object["clip_pads"] as? [String: Double], ["pre": 1.2, "post": 1.3], "clip pads")
    check(text.contains("\"cut_segments\":[[13.48,22.12],[36.29,48.76],[57.38,75.12]"),
          "segments printed as two decimals, as the Mac reads them")
    check(text.contains("\"cut_segment_offsets\":[0,8.64,21.11,38.85,58.04,83.93]"),
          "measured offsets printed short")
    eq((object["cut_first_frame_s"] as? [Double])?.count, 6, "first frames, one per segment")
    let pts = object["points"] as? [[String: Any]] ?? []
    eq(pts.count, 20, "one point per planned point")
    eq(Set(pts.first.map { Array($0.keys) } ?? []),
       ["idx", "t0", "t1", "clip_t0", "clip_t1", "cut_t0", "clip", "clip_bytes"], "point keys")
    check(text.contains("{\"clip\":\"01.mp4\",\"clip_bytes\":2000001,\"clip_t0\":13.63,\"clip_t1\":21.97,\"cut_t0\":0.15,\"idx\":1,\"t0\":14.83,\"t1\":20.67}"),
          "point 1 exactly as the plan has it")
    check(pts[2]["clip"] is NSNull, "an abandoned clip is written as null, not left out")
    check(pts[2]["clip_bytes"] == nil, "and has no size")
    let enc = object["encoder"] as? [String: Any] ?? [:]
    eq((enc["cut"] as? [String: Any])?["keyframe_frames"] as? Int, 60, "keyframe every 60 frames")
    eq((enc["cut"] as? [String: Any])?["audio_bitrate"] as? Int, 128_000, "cut AAC 128k")
    eq((enc["clips"] as? [String: Any])?["audio_bitrate"] as? Int, 96_000, "clips AAC 96k")
    eq((enc["clips"] as? [String: Any])?["width"] as? Int, 720, "clips 720 wide")
    eq((enc["clips"] as? [String: Any])?["video_bitrate"] as? Int, 2_500_000, "clips 2.5 Mbps")
    eq(enc["app_build"] as? String, "240", "app build")
    eq((object["timing"] as? [String: Double])?["cut_wall_s"], 312.5, "timing")

    // Optional pieces stay out rather than going in wrong.
    var noFrames = done
    noFrames.cut?.firstFrames = plan.offsets.map { $0 + 0.2 }
    check(DeviceCutManifest.build(noFrames)?.cutFirstFrameS == nil,
          "first frames outside 0.1 s are left out rather than failing a good cut")
    noFrames.cut?.firstFrames = [0]
    check(DeviceCutManifest.build(noFrames)?.cutFirstFrameS == nil, "a short list is left out")
    if let bare = try? DeviceCutManifest.build(noFrames)?.encoded(),
       let bareObject = try? JSONSerialization.jsonObject(with: bare) as? [String: Any] {
        check(bareObject["encoder"] == nil && bareObject["timing"] == nil && bareObject["cut_first_frame_s"] == nil,
              "absent diagnostics are omitted, not null")
    } else {
        check(false, "a bare manifest encodes")
    }

    // The phone's own check catches a clock the Mac would refuse.
    var drift = manifest
    drift.cutSegmentOffsets[3] += 0.06
    check(drift.selfCheck(plannedOffsets: plan.offsets, expectedPoints: 20) != nil, "an offset 0.06 s out fails")
    var late = manifest
    late.cutSegmentOffsets[0] = 0.11
    check(late.selfCheck(plannedOffsets: plan.offsets, expectedPoints: 20) != nil, "a first segment after 0.1 s fails")
    var short = manifest
    short.points.removeLast()
    check(short.selfCheck(plannedOffsets: plan.offsets, expectedPoints: 20) != nil, "a missing point fails")

    // MARK: The claim's refusals

    eq(DeviceCutClaimOutcome.from(message: "not_enabled"), .useMac, "switched off: the Mac cuts it")
    eq(DeviceCutClaimOutcome.from(message: "PGRST202: Could not find the function public.claim_device_hand_cut"),
       .useMac, "no phone cut on this server: the Mac cuts it")
    eq(DeviceCutClaimOutcome.from(message: "already_cut"), .refused("This match already has points."), "already cut")
    eq(DeviceCutClaimOutcome.from(message: "already_processing"),
       .refused("Something is already running on this match."), "already processing")
    eq(DeviceCutClaimOutcome.from(message: "queue_full"),
       .refused("Your queue is full. Wait for a video to finish."), "queue full")
    eq(DeviceCutClaimOutcome.from(message: "The network connection was lost."),
       .refused("That didn't send. Check your connection and try again."), "offline")
    // MARK: What the player reads, and why the phone stops

    let steps: [DeviceCutStep] = [.encodeCut, .encodeClip(3), .prepareUpload, .upload(parts: [1], clips: [2]),
                                  .completeCut, .uploadManifest, .submit, .stopped(.heat)]
    for step in steps {
        let line = DeviceCutCopy.title(step: step)
        check(!line.contains("\u{2014}") && !line.contains(" AI"), "no em dash in \"\(line)\"")
        check(!line.contains("iPhone") && !line.contains("phone") && !line.contains("Mac")
              && !line.contains("Paused") && !line.contains("PongLens"), "\"\(line)\" does not say where it cuts")
    }
    eq(DeviceCutCopy.title(step: .encodeCut), MatchProcessingFeedback.deviceStageLabel("device_cut"),
       "the phone's card reads as the server's for the same stage")
    eq(DeviceCutCopy.title(step: .encodeClip(4)), MatchProcessingFeedback.handCutStageLabel("cut"), "clips are cutting too")
    eq(DeviceCutCopy.title(step: .upload(parts: [], clips: [1])), MatchProcessingFeedback.handCutStageLabel("upload"),
       "and the upload reads as the Mac's upload")
    eq(DeviceCutCopy.title(step: .submit), MatchProcessingFeedback.handCutStageLabel("upload"), "submitting is uploading")
    eq(DeviceCutStop(.heat), .heat, "critical heat hands over")
    eq(DeviceCutStop(.lowPower), .lowPower, "so does Low Power Mode")
    eq(DeviceCutStop(.storage), .storage, "and a full disk")
    var held = fresh
    held.stop = DeviceCutStop(.lowPower)
    eq(DeviceCutFlow.next(held), .stopped(.lowPower), "a job that stopped never goes back to cutting")
    // Upload on Wi-Fi only (post-rollout audit H): with the cut ready and
    // no Wi-Fi, the server cuts it at once.
    check(DeviceCutGuard.handOverForWiFi(wifiOnly: true, onWiFi: false), "Wi-Fi only with no Wi-Fi hands over")
    check(!DeviceCutGuard.handOverForWiFi(wifiOnly: true, onWiFi: true), "Wi-Fi only on Wi-Fi uploads")
    check(!DeviceCutGuard.handOverForWiFi(wifiOnly: false, onWiFi: false), "cellular allowed uploads on cellular")
    check(!DeviceCutGuard.handOverForWiFi(wifiOnly: true, onWiFi: nil),
          "a network not yet known is not no Wi-Fi: the upload waits for one itself")
    var noWiFi = fresh
    noWiFi.stop = .wifiOnly
    eq(DeviceCutFlow.next(noWiFi), .stopped(.wifiOnly), "a job handed over for Wi-Fi stays handed over")
    if let data = try? JSONEncoder().encode(noWiFi),
       let back = try? JSONDecoder().decode(DeviceCutJob.self, from: data) {
        eq(back.stop, .wifiOnly, "the Wi-Fi stop survives a relaunch")
    } else {
        check(false, "a Wi-Fi stop encodes")
    }
    // A job written by build 236, with its old hold key and no new ones,
    // still reads.
    if let data = try? JSONEncoder().encode(fresh),
       var object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        object["hold"] = "heat"
        let old = try? JSONSerialization.data(withJSONObject: object)
        let back = old.flatMap { try? JSONDecoder().decode(DeviceCutJob.self, from: $0) }
        eq(back?.jobId, fresh.jobId, "a job saved before this build still loads")
    } else {
        check(false, "a job encodes")
    }
}

func runDeviceCutRouteChecks() {
    print("\n— cutting on the iPhone: the route's answers —")
    func body(_ s: String) -> Data { s.data(using: .utf8)! }
    eq(DeviceCutRouteAnswer(status: 200, data: body("{\"ok\":true,\"phase\":\"verify\"}")).decode(DeviceCutRouteBodies.Phase.self)?.phase,
       "verify", "submit's answer reads")
    eq(DeviceCutRouteAnswer(status: 409, data: body("{\"error\":\"Some files did not finish uploading\",\"missing\":[\"points/u/m/03.mp4\"]}")),
       .missing(["points/u/m/03.mp4"]), "409 with missing keys names them")
    eq(DeviceCutRouteAnswer(status: 409, data: body("{\"error\":\"This cut is no longer on the iPhone.\",\"phase\":\"mac\"}")),
       .notOnPhone(phase: "mac"), "409 without keys means the job moved on")
    eq(DeviceCutRouteAnswer(status: 409, data: body("{\"error\":\"This cut is no longer on the iPhone.\",\"phase\":null}")),
       .notOnPhone(phase: nil), "a null phase reads as none")
    eq(DeviceCutRouteAnswer(status: 404, data: body("{\"error\":\"Job not found\"}")), .notFound, "404")
    eq(DeviceCutRouteAnswer(status: 403, data: body("{\"error\":\"Those keys do not belong to this cut\",\"refused\":[\"x\"]}")),
       .refused(status: 403, message: "Those keys do not belong to this cut"), "403 keeps the sentence")
    eq(DeviceCutRouteAnswer(status: 500, data: Data()), .refused(status: 500, message: ""), "an empty 500")
    let listed = DeviceCutRouteAnswer(status: 200, data: body("{\"parts\":[{\"PartNumber\":2,\"Size\":67108864,\"ETag\":\"\\\"b\\\"\"}]}"))
        .decode(DeviceCutRouteBodies.Listed.self)
    eq(listed?.parts.first?.PartNumber, 2, "list-parts decodes")
    let signed = DeviceCutRouteAnswer(status: 200, data: body("{\"urls\":{\"results/u/j.manifest.json\":\"https://r2/x\"}}"))
        .decode(DeviceCutRouteBodies.SignedKeys.self)
    eq(signed?.urls["results/u/j.manifest.json"], "https://r2/x", "sign decodes")

    let job = UUID(uuidString: "5d1c0000-0000-4000-8000-00000000000a")!
    let name = DeviceCutFlow.transferName(job, kind: "clip", number: 12)
    eq(name, "5d1c0000-0000-4000-8000-00000000000a|clip|12", "transfer names")
    check(DeviceCutFlow.transfer(name).map { $0.jobId == job && $0.kind == "clip" && $0.number == 12 } ?? false,
          "and they read back")
    check(DeviceCutFlow.transfer("\(job.uuidString)|part|3")?.number == 3, "part names read back")
    check(DeviceCutFlow.transfer("garbage") == nil && DeviceCutFlow.transfer("\(job.uuidString)|other|1") == nil,
          "anything else is not ours")

    let answer = try? JSONDecoder().decode(DeviceCutReportAnswer.self,
                                           from: body("{\"accepted\":false,\"phase\":\"mac\",\"status\":\"queued\"}"))
    eq(answer?.accepted, false, "a refused report reads")
    eq(answer?.phase, "mac", "with where the job went")
}

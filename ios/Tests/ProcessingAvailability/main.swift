import Foundation

private var checks = 0
private func check(_ value: @autoclosure () -> Bool, _ label: String) {
    checks += 1
    guard value() else { fatalError(label) }
}

@MainActor func run() async throws {
    let now = Date(timeIntervalSince1970: 1_789_300_800)
    let json = """
    {"main":"unavailable","fast":"available","hand":"maintenance","clip_lane":"fast","observed_at":"\(ISO8601DateFormatter().string(from: now))"}
    """
    let status = try JSONDecoder().decode(ProcessingServiceStatus.self, from: Data(json.utf8))
    check(status.state(for: .main, now: now) == .unavailable, "main down decodes")
    check(status.state(for: .fast, now: now) == .available, "fast remains healthy")
    check(status.state(for: .hand, now: now) == .maintenance, "hand maintenance stays independent")
    let feedback = try JSONDecoder().decode(MatchProcessingFeedback.self, from: Data("""
    {"match_id":"00000000-0000-0000-0000-000000000001","job_status":"processing","job_kind":"hand_cut","stage":"ball","worker_state":"fresh","service_state":"unavailable","lane":"hand"}
    """.utf8))
    check(feedback.serviceState == "unavailable" && feedback.lane == "hand", "feedback additive fields decode")
    check(feedback.stageLabel == "Finding the ball", "feedback service state alone does not sustain an outage")
    check(status.state(for: .main, now: now.addingTimeInterval(91)) == .unknown, "old server result expires")
    check(status.state(for: .main, now: now.addingTimeInterval(-31)) == .unknown, "future timestamp is not trusted")
    let missing = try JSONDecoder().decode(ProcessingServiceStatus.self, from: Data("{}".utf8))
    check(missing.state(for: .main, now: now) == .unknown, "missing contract fails unknown")
    check(processingServiceLane(kind: "hand_cut", clipLane: .fast) == .hand, "hand cut avoids main")
    check(processingServiceLane(kind: "reclip", clipLane: .main) == .main, "reclip follows returned main")
    check(processingServiceLane(kind: "reel", clipLane: .fast, scope: "v:point:1") == .fast, "vertical reel follows clip lane")
    check(processingServiceLane(kind: "reel", clipLane: .fast, scope: "full") == .main, "ordinary export uses main")
    check(processingServiceLane(kind: "content_check", clipLane: .fast) == .main, "content checks use main")
    check(availabilityNotice(.unknown, context: .savedMatch) == nil, "unknown is not an outage")
    check(availabilityNotice(.available, context: .savedMatch) == nil, "recovery removes notice")
    check(availabilityNotice(.unavailable, context: .savedMatch)?.body == "Your video is saved and queued. Processing will resume automatically when service is restored. You can leave this page. We’ll email you when your match is ready.", "primary job retains approved email promise")
    for context in [AvailabilityContext.beforeUpload, .uploading] {
        let body = availabilityNotice(.unavailable, context: context)!.body
        check(!body.contains("saved") && !body.contains("leave"), "incomplete upload cannot claim saved")
    }
    for context in [AvailabilityContext.savedVideo, .savedProcessing, .importRequest, .fast, .export] {
        check(!availabilityNotice(.unavailable, context: context)!.body.contains("email"), "other jobs never promise email")
    }
    check(availabilityNotice(.unavailable, context: .uploading)!.body == "Your video is still uploading. Processing will wait until the upload finishes and service is restored.", "native background upload describes incomplete transfer")
    var calls = 0
    let store = ProcessingServiceStore(fetch: {
        calls += 1
        if calls == 1 { return status }
        throw URLError(.notConnectedToInternet)
    }, now: { now })
    await store.refresh()
    check(store.state(for: .main) == .unavailable, "successful refresh shows observed outage")
    check(store.matchNotice(matchStatus: "ready", jobKind: "deadspace_cut", jobStatus: "done") == nil, "completed match never claims queued")
    check(store.matchNotice(matchStatus: "failed", jobKind: "deadspace_cut", jobStatus: "failed") == nil, "failed match retains failure")
    check(store.matchNotice(matchStatus: "uploaded", jobKind: "content_check", jobStatus: "done")?.body == "Your video is saved. You can request processing, but it will not start until service is restored.", "finished check does not claim queued")
    check(store.matchNotice(matchStatus: "processing", jobKind: "hand_cut", jobStatus: "queued", lane: "hand")?.body == "Your video is saved. Clip preparation will resume automatically when service is restored. You can leave this page.", "hand feedback routes to maintenance without email")
    check(store.matchNotice(matchStatus: "uploaded", jobKind: "youtube_import", jobStatus: "queued", videoSaved: false)?.body == "Your import request is queued and will continue when service is restored. You can leave this page.", "import does not claim remote video saved")
    await store.refresh()
    check(store.state(for: .main) == .unknown, "failed refresh clears last outage")
    let background = ProcessingServiceStore(fetch: { status }, now: { now })
    await background.refresh()
    background.stop()
    check(background.state(for: .main) == .unknown, "background or signout clears last outage")
    var pending: CheckedContinuation<ProcessingServiceStatus, Never>?
    var requests = 0
    let serial = ProcessingServiceStore(fetch: {
        requests += 1
        return await withCheckedContinuation { pending = $0 }
    }, now: { now })
    let inFlight = Task { await serial.refresh() }
    while pending == nil { await Task.yield() }
    await serial.refresh()
    check(requests == 1, "foreground refresh cannot overlap active request")
    serial.stop()
    pending?.resume(returning: status)
    await inFlight.value
    check(serial.state(for: .main) == .unknown, "late response cannot restore outage after signout")
    print("\(checks) processing availability checks passed")
}
Task { @MainActor in
    do { try await run(); exit(0) } catch { fatalError("\(error)") }
}
dispatchMain()

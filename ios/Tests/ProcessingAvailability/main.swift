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
    {"match_id":"00000000-0000-0000-0000-000000000001","job_status":"processing","job_kind":"hand_cut","stage":"cut","worker_state":"fresh","service_state":"unavailable","lane":"hand"}
    """.utf8))
    check(feedback.serviceState == "unavailable" && feedback.lane == "hand", "feedback additive fields decode")
    check(feedback.stageLabel == "Cutting the video", "feedback service state alone does not sustain an outage")
    check(status.state(for: .main, now: now.addingTimeInterval(91)) == .unknown, "old server result expires")
    check(status.state(for: .main, now: now.addingTimeInterval(-31)) == .unknown, "future timestamp is not trusted")
    let missing = try JSONDecoder().decode(ProcessingServiceStatus.self, from: Data("{}".utf8))
    check(missing.state(for: .main, now: now) == .unknown, "missing contract fails unknown")
    for route in ["null", "\"hand\"", "\"\"", "1"] {
        let invalid = try JSONDecoder().decode(ProcessingServiceStatus.self, from: Data("""
        {"main":"unavailable","fast":"available","clip_lane":\(route),"observed_at":"\(ISO8601DateFormatter().string(from: now))"}
        """.utf8))
        check(invalid.state(for: invalid.clipLane, now: now) == .unknown, "invalid route cannot claim main clip outage")
    }
    check(availabilityNotice(.unavailable, context: .fast)?.title == "Clip updates and vertical exports are temporarily unavailable", "clip warning does not claim ordinary exports unavailable")
    var mixedStatus = status
    mixedStatus.hand = .available
    let mixed = summarizeProcessingWork(mixedStatus, work: [
        ProcessingWork(kind: "deadspace_cut", status: "queued", videoSaved: true),
        ProcessingWork(kind: "hand_cut", status: "processing", videoSaved: true, stageLabel: "Preparing clips")
    ], now: now)
    check(mixed.blockedCount == 1 && mixed.continuingCount == 1, "mixed queues keep healthy work visible")
    check(mixed.continuingLabel == "Preparing clips" && mixed.exitMessage == "We’ll email you when your match is ready.", "healthy hand work promises the ready email the worker sends")
    let orphan = summarizeProcessingWork(mixedStatus, work: [ProcessingWork(kind: "youtube_import", status: "queued", videoSaved: false)], now: now)
    check(orphan.continuingCount == 0 && orphan.notice?.body == "Your import request is queued and will continue when service is restored. You can leave this page.", "orphan import has safe outage notice")
    var availableStatus = mixedStatus
    availableStatus.main = .available
    let primarySummary = summarizeProcessingWork(availableStatus, work: [ProcessingWork(kind: "deadspace_cut", status: "processing", videoSaved: true)], now: now)
    check(primarySummary.exitMessage == "We’ll email you when your match is ready.", "healthy primary retains email promise")
    let terminalSummary = summarizeProcessingWork(mixedStatus, work: [ProcessingWork(kind: "deadspace_cut", status: "done", videoSaved: true)], now: now)
    check(terminalSummary.notice == nil && terminalSummary.continuingCount == 0 && !terminalSummary.exitMessage.contains("email"), "terminal primary cannot claim queued or promise another email")
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
    check(store.matchNotice(matchStatus: "processing", jobKind: "hand_cut", jobStatus: "queued", lane: "hand")?.body == "Your video is saved. Clip preparation will resume automatically when service is restored. You can leave this page. We’ll email you when your match is ready.", "hand feedback routes to maintenance and promises the ready email")
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
    var hungResponse: CheckedContinuation<ProcessingServiceStatus, Never>?
    var expiry: CheckedContinuation<Void, Error>?
    var expiryCalls = 0
    var renewedCalls = 0
    var healthy = status
    healthy.main = .available
    let renewable = ProcessingServiceStore(fetch: {
        renewedCalls += 1
        if renewedCalls == 1 { return await withCheckedContinuation { hungResponse = $0 } }
        return healthy
    }, now: { now }, waitForExpiry: {
        expiryCalls += 1
        if expiryCalls == 1 { try await withCheckedThrowingContinuation { expiry = $0 } }
        else { try await Task.sleep(for: .seconds(30)) }
    })
    let hungRequest = Task { await renewable.refresh() }
    while hungResponse == nil || expiry == nil { await Task.yield() }
    expiry?.resume()
    await hungRequest.value
    check(renewable.state(for: .main) == .unknown, "expiry retires an unresponsive request")
    await renewable.refresh()
    check(renewedCalls == 2 && renewable.state(for: .main) == .available, "new request runs after previous timeout")
    hungResponse?.resume(returning: status)
    for _ in 0..<20 { await Task.yield() }
    check(renewable.state(for: .main) == .available, "late retired response cannot overwrite newer recovery")
    renewable.stop()
    print("\(checks) processing availability checks passed")
}
Task { @MainActor in
    do { try await run(); exit(0) } catch { fatalError("\(error)") }
}
dispatchMain()

import Foundation

func runMatchToolsChecks() {
    print("\n— match tools —")
    check(
        shareLinkTargets(processed: true, highlightsReady: true)
            == [.match, .highlights, .starred],
        "ready matches show the three primary public-link targets"
    )
    check(
        shareLinkTargets(processed: true, highlightsReady: false)
            == [.match, .starred],
        "the link sheet does not start missing highlights"
    )
    check(
        shareLinkTargets(processed: false, highlightsReady: false)
            == [.match],
        "unprocessed matches offer only their live whole-match link"
    )
    check(
        coachInviteCreationOrder.last == .createLink,
        "coach invite creation ends with its primary action"
    )
    check(
        coachInviteCreationOrder.firstIndex(of: .starterPack)!
            < coachInviteCreationOrder.firstIndex(of: .createLink)!,
        "starter selections come before invite creation"
    )
    runFailedHandCutChecks()
}

/// A failed hand cut puts its match back to 'uploaded'; the job is the only
/// record. The same cases as src/lib/primaryMatchJob.test.ts.
private func runFailedHandCutChecks() {
    func job(_ match: String, _ kind: String, _ status: String, _ at: String) -> JobRow? {
        let json = """
        {"id": "\(UUID().uuidString)", "status": "\(status)", "kind": "\(kind)", "progress": 0,
         "original_name": null, "options": {"match_id": "\(match)"}, "created_at": "\(at)"}
        """
        return try? JSONDecoder().decode(JobRow.self, from: Data(json.utf8))
    }
    // Newest first, as the queries order them.
    let jobs = [
        job("e", "reclip", "done", "2026-09-24T12:00:00Z"),
        job("b", "hand_cut", "done", "2026-09-24T11:00:00Z"),
        job("c", "deadspace_cut", "queued", "2026-09-24T11:00:00Z"),
        job("e", "content_check", "done", "2026-09-24T11:00:00Z"),
        job("a", "hand_cut", "failed", "2026-09-24T10:00:00Z"),
        job("b", "hand_cut", "failed", "2026-09-24T10:00:00Z"),
        job("c", "hand_cut", "failed", "2026-09-24T10:00:00Z"),
        job("d", "deadspace_cut", "failed", "2026-09-24T10:00:00Z"),
        job("e", "hand_cut", "failed", "2026-09-24T10:00:00Z"),
    ].compactMap { $0 }
    check(jobs.count == 9, "hand-cut job fixtures decode")
    check(JobRow.failedHandCutMatchIds(jobs) == ["a", "e"],
          "a match whose latest primary job is a failed hand cut is found, and only that")
    check(JobRow.failedHandCutMatchIds([]).isEmpty, "no jobs, no failures")

    let row = """
    {"id": "11111111-1111-1111-1111-111111111111", "user_id": "22222222-2222-2222-2222-222222222222",
     "status": "uploaded", "created_at": "2026-09-24T10:00:00Z", "played_at": "2026-09-24T10:00:00Z"}
    """
    if let uploaded = try? JSONDecoder().decode(MatchRow.self, from: Data(row.utf8)) {
        check(uploaded.displayStatus(hasLiveJob: false, handCutFailed: true) == .failed, "a failed hand cut reads as failed")
        check(uploaded.displayStatus(hasLiveJob: true, handCutFailed: true) == .uploaded, "not while a job works on it again")
        check(uploaded.displayStatus(hasLiveJob: false, handCutFailed: false) == .uploaded, "an untouched upload stays not processed")
    } else {
        check(false, "match fixture decodes")
    }
}

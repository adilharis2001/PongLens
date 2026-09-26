import Foundation

// Core/CutAgain.swift and the marker's shared words and pad geometry
// (Core/MarkLandscape.swift): what More options offers, the Replace or Keep
// choice, the error sentences of the cut again contract
// (docs/superpowers/specs/2026-09-25-cut-again-contract.md), and the
// owner's 2026-09-25 changes to the marker.

func runCutAgainChecks() {
    print("\n— cut again: More options, the choice, the refusals —")
    runRecutOptionsDecodeChecks()
    runMoreOptionsPlanChecks()
    runSameMarksChecks()
    runCutWayChecks()
    runRecutChoiceChecks()
    runRecutRefusalChecks()
    runProcessChargeChecks()
    runLibraryWorkChecks()
    runMarkerCopyChecks()
    runPortraitPadChecks()
    runStartAgainRailChecks()
}

private func decodeOptions(_ json: String) -> RecutOptions? {
    try? JSONDecoder().decode(RecutOptions.self, from: Data(json.utf8))
}

private func runRecutOptionsDecodeChecks() {
    let full = decodeOptions("""
    {"available": true, "reason": null, "replace_by_hand": true, "replace_automatic": false,
     "has_coach_review": false, "has_match_notes": true, "cut_source": "manual"}
    """)
    eq(full, RecutOptions(available: true, replaceByHand: true, replaceAutomatic: false,
                          hasCoachReview: false, hasMatchNotes: true, cutSource: "manual"),
       "recut_options decodes the contract's shape")
    // A response the app does not fully understand offers less, never more.
    let sparse = decodeOptions(#"{"available": true}"#)
    eq(sparse?.replaceByHand, false, "a missing replace_by_hand reads as not allowed")
    eq(sparse?.replaceAutomatic, false, "a missing replace_automatic reads as not allowed")
    eq(decodeOptions("{}")?.available, false, "an empty answer offers nothing")
    eq(decodeOptions(#"{"available": false, "reason": "no_source"}"#)?.reason, "no_source",
       "the reason comes through")
}

private func runMoreOptionsPlanChecks() {
    let ready = RecutOptions(available: true)
    eq(MoreOptionsPlan.make(options: ready, handCutEnabled: true, jobRunning: false),
       MoreOptionsPlan(automatic: true, marking: true), "both rows when available and hand cutting is on")
    eq(MoreOptionsPlan.make(options: ready, handCutEnabled: false, jobRunning: false),
       MoreOptionsPlan(automatic: true, marking: false), "no marking row without hand_cut_enabled")
    eq(MoreOptionsPlan.make(options: ready, handCutEnabled: true, jobRunning: true),
       MoreOptionsPlan(running: true), "a running cut takes the rows' place")
    eq(MoreOptionsPlan.make(options: nil, handCutEnabled: true, jobRunning: false),
       MoreOptionsPlan(), "nothing offered before the options are read")
    eq(MoreOptionsPlan.make(options: nil, handCutEnabled: true, jobRunning: true),
       MoreOptionsPlan(running: true), "the running cut shows even before the options answer")
    eq(MoreOptionsPlan.make(options: RecutOptions(available: false, reason: "processing"),
                            handCutEnabled: true, jobRunning: false),
       MoreOptionsPlan(running: true, blocked: CutAgainCopy.busy),
       "processing: shown as running, with the busy line until the job is seen")
    eq(MoreOptionsPlan.make(options: RecutOptions(available: false, reason: "support_request"),
                            handCutEnabled: true, jobRunning: false),
       MoreOptionsPlan(blocked: "Something is already running on this match."),
       "a support request blocks both ways")
    eq(MoreOptionsPlan.make(options: RecutOptions(available: false, reason: "no_source"),
                            handCutEnabled: true, jobRunning: false),
       MoreOptionsPlan(blocked: "The original video is no longer stored."),
       "no original: said plainly, never expired")
    eq(MoreOptionsPlan.make(options: RecutOptions(available: false, reason: "not_ready"),
                            handCutEnabled: true, jobRunning: false),
       MoreOptionsPlan(), "not ready: no rows and no line")

    func trailing(_ n: Int, submitted: Bool = false, prefilled: Bool = false) -> String? {
        MoreOptionsPlan.markingTrailing(draftCount: MoreOptionsPlan.draftCount(
            markedCount: n, submitted: submitted, prefilled: prefilled))
    }
    eq(trailing(12), "12 marked", "an unsent draft trails its count")
    eq(trailing(12, submitted: true), nil, "a submitted draft is the live cut, not a draft")
    eq(trailing(0), nil, "an empty draft trails nothing")
    // QA 2026-09-25, match 5e432cde: opening the marker and closing it
    // again read "3 marked" and "Keep marking".
    eq(trailing(3, prefilled: true), nil,
       "a prefilled draft is the live cut's points, not marks the player made")
    eq(MoreOptionsPlan.draftCount(markedCount: 3, submitted: false, prefilled: true), 0,
       "so the button reads Start marking")
    eq(MoreOptionsPlan.draftCount(markedCount: 4, submitted: false, prefilled: false), 4,
       "once a mark changes, the draft is the player's")
}

/// HandCut.sameMarks is the database's _marks_signature (20260925133555):
/// what decides that a prefilled draft has become the player's own.
private func runSameMarksChecks() {
    func mark(_ id: String, _ t0: Double, _ t1: Double?, _ w: Winner? = nil, isLet: Bool = false,
              starred: Bool = false) -> HandCutMark {
        HandCutMark(id: id, t0: t0, t1: t1, winner: w, isLet: isLet, starred: starred,
                    tap: t0 + 0.6, rate: 1)
    }
    let base = [mark("a", 10, 14, .user), mark("b", 20, 25), mark("c", 30, 33, isLet: true)]
    check(HandCut.sameMarks(base, base), "the same marks are the same")
    check(HandCut.sameMarks(base, [mark("x", 10.001, 14.004, .user), mark("y", 20, 25),
                                   mark("z", 30, 33, isLet: true)]),
          "ids and a thousandth of a second do not count")
    check(HandCut.sameMarks(base, [base[2], base[0], base[1]]), "order is start order")
    check(HandCut.sameMarks(base, [mark("a", 10, 14, .user, starred: true), base[1], base[2]]),
          "a star is not a change to the cut")
    check(!HandCut.sameMarks(base, [mark("a", 10, 14, .opponent), base[1], base[2]]),
          "a changed answer is a change")
    check(!HandCut.sameMarks(base, [mark("a", 10, 14.5, .user), base[1], base[2]]),
          "a moved end is a change")
    check(!HandCut.sameMarks(base, [base[0], base[1]]), "a removed point is a change")
    check(!HandCut.sameMarks(base, base + [mark("d", 40, nil)]), "an open rally is a change")
    check(!HandCut.sameMarks(base, [base[0], base[1], mark("c", 30, 33)]), "an unskipped let is a change")
}

/// The two ways are one choice (owner's option A, 2026-09-25), and neither
/// is selected until the player taps one (owner, later the same day): no
/// default, not even for unsent marks.
private func runCutWayChecks() {
    let untouched = CutWayChoice()
    eq(untouched.chosen, nil, "nothing is picked until the player taps")
    eq(untouched.selected(), nil, "neither way is selected by default")
    eq(untouched.selected(markingSelectable: false), nil,
       "not Automatically either when marking cannot be chosen")

    // Unsent marks still say so on their row, but no longer pick it.
    let unsent = MoreOptionsPlan.draftCount(markedCount: 12, submitted: false, prefilled: false)
    eq(MoreOptionsPlan.markingTrailing(draftCount: unsent), "12 marked",
       "the row still reads \"12 marked\"")
    eq(untouched.selected(), nil, "and the waiting draft selects nothing")

    var picked = CutWayChoice()
    picked.choose(.byHand)
    eq(picked.selected(), .byHand, "a tap selects Mark the points yourself")
    picked.choose(.automatic)
    eq(picked.selected(), .automatic, "a tap on Automatically moves the choice")
    picked.choose(.automatic)
    eq(picked.selected(), .automatic, "tapping the selected way keeps it selected")
    eq(picked.selected(markingSelectable: false), .automatic,
       "Automatically stays chosen when marking goes grey")

    // No original to mark: the row is greyed and cannot be the choice.
    picked.choose(.byHand)
    eq(picked.selected(markingSelectable: false), nil,
       "an earlier tap on marking that can no longer be chosen selects nothing")

    // The arrival from the upload sheet's Mark the points yourself is an
    // explicit pick, the only way the page ever opens on a way.
    eq(CutWayChoice(chosen: .byHand).selected(), .byHand, "a carried pick is kept")
}

private func runRecutChoiceChecks() {
    var byHand = RecutChoiceState.byHand(RecutOptions(available: true, hasMatchNotes: false))
    eq(byHand.selected, .keep, "Keep is the default (assumption B)")
    eq(byHand.replace, false, "Keep does not replace")
    eq(byHand.replaceLines, [], "nothing under Replace while Keep is chosen")
    byHand.select(.replace)
    eq(byHand.replace, true, "Replace can be chosen by hand")
    eq(byHand.replaceLines, ["Point notes will be deleted."],
       "Replace by hand says what it deletes: the marks keep each score")
    var automatic = RecutChoiceState.automatic(
        RecutOptions(available: true, replaceAutomatic: true, hasMatchNotes: false))
    automatic.select(.replace)
    eq(automatic.replaceLines, ["Points, scores and point notes will be deleted."],
       "automatic Replace deletes the scores too")

    var withNotes = RecutChoiceState.byHand(RecutOptions(available: true, hasMatchNotes: true))
    withNotes.select(.replace)
    eq(withNotes.replaceLines,
       ["Point notes will be deleted.", "Match notes stay with the match."],
       "the second line only when the match has match notes")
    withNotes.select(.keep)
    eq(withNotes.replaceLines, [], "the lines go when Keep is chosen again")

    var coach = RecutChoiceState.byHand(
        RecutOptions(available: true, replaceByHand: false, hasCoachReview: true))
    eq(coach.replaceAllowed, false, "a coach review greys Replace (assumption A)")
    eq(coach.replaceBlockedLine, "Has a coach review", "and says why")
    coach.select(.replace)
    eq(coach.selected, .keep, "a greyed Replace cannot be chosen")

    var auto = RecutChoiceState.automatic(RecutOptions(available: true, replaceAutomatic: false))
    eq(auto.replaceAllowed, false, "automatic Replace is greyed in phase 1")
    eq(auto.replaceBlockedLine, nil, "with no line")
    auto.select(.replace)
    eq(auto.replace, false, "and cannot be chosen")

    var phase2 = RecutChoiceState.automatic(RecutOptions(available: true, replaceAutomatic: true))
    phase2.select(.replace)
    eq(phase2.replace, true, "the flag alone turns automatic Replace on")

    let autoCoach = RecutChoiceState.automatic(
        RecutOptions(available: true, replaceAutomatic: true, hasCoachReview: true))
    eq(autoCoach.replaceAllowed, false, "a coach review greys automatic Replace too")
    eq(autoCoach.replaceBlockedLine, "Has a coach review", "and says why there too")

    var late = RecutChoiceState.byHand(RecutOptions(available: true))
    late.select(.replace)
    late.coachReviewFound()
    eq(late.selected, .keep, "a claim refused for a coach review falls back to Keep")
    eq(late.replaceBlockedLine, "Has a coach review", "and greys Replace with its reason")
    eq(late.replace, false, "and will not replace")
}

private func runRecutRefusalChecks() {
    eq(CutAgainErrors.handRecut("coach_review"), .coachReview, "coach_review is not an error")
    for code in ["support_request", "processing", "already_processing"] {
        eq(CutAgainErrors.handRecut(code), .message("Something is already running on this match."),
           "\(code) says something is already running")
    }
    eq(CutAgainErrors.handRecut("no_source"), .message("The original video is no longer stored."),
       "no_source")
    eq(CutAgainErrors.handRecut("already_cut"), .message("This match already has points."),
       "the hand cut's own sentences otherwise")
    eq(CutAgainErrors.handRecut("queue_full"), .message("Your queue is full. Wait for a video to finish."),
       "queue_full")
    eq(CutAgainErrors.handRecut("check_pending"), .message("Still checking the video. Try again in a moment."),
       "check_pending")
    eq(CutAgainErrors.handRecut("invalid_marks"),
       .message("Some marks are not valid. Check for very short points."), "invalid_marks")
    eq(CutAgainErrors.handRecut("The network connection was lost."),
       .message("That didn't send. Check your connection and try again."), "anything else")
    eq(CutAgainErrors.handRecut("not_processing_yet"),
       .message("That didn't send. Check your connection and try again."),
       "a bare 'processing' matches the whole code, not a word inside another")

    eq(CutAgainErrors.copy("processing"), "Something is already running on this match.", "copy: busy")
    eq(CutAgainErrors.copy("support_request"), "Something is already running on this match.",
       "copy: a support request")
    eq(CutAgainErrors.copy("no_source"), "The original video is no longer stored.", "copy: no original")
    eq(CutAgainErrors.copy("bad_state"), "Something went wrong. Try again.", "copy: anything else")

    // Replace, processed automatically (claim_auto_recut, phase 2): the
    // contract's codes, then the charge's in the raw page's words; never a
    // hand cut's sentence. The web's autoRecutClaimError.
    eq(CutAgainErrors.autoRecut("coach_review"), .coachReview, "auto: coach_review is not an error")
    for code in ["support_request", "processing", "already_processing"] {
        eq(CutAgainErrors.autoRecut(code), .message("Something is already running on this match."),
           "auto: \(code) says something is already running")
    }
    eq(CutAgainErrors.autoRecut("no_source"), .message("The original video is no longer stored."),
       "auto: no_source")
    eq(CutAgainErrors.autoRecut("insufficient_minutes"), .message("Not enough minutes for this video."),
       "auto: the charge's sentence for the balance")
    eq(CutAgainErrors.autoRecut("queue_full"), .message("Your queue is full. Wait for a video to finish."),
       "auto: the charge's sentence for the queue")
    for other in ["", "not_enabled", "trim_too_short", "bad_state", "not_processing_yet"] {
        eq(CutAgainErrors.autoRecut(other), .message("Something went wrong. Try again."),
           "auto: '\(other)' reads as the raw page's generic sentence")
    }

    // The raw page's claim keeps its words.
    eq(CutAgainErrors.handCut("already_processing"), "Something is already running on this match.",
       "raw hand cut: already_processing unchanged")
    eq(CutAgainErrors.handCut(""), "That didn't send. Check your connection and try again.",
       "raw hand cut: default unchanged")
}

private func runProcessChargeChecks() {
    eq(ProcessCharge.minutes(durationS: 600, trimStart: 0, trimEnd: nil), 10, "ten minutes of video")
    eq(ProcessCharge.minutes(durationS: 601, trimStart: 0, trimEnd: nil), 11, "rounded up")
    eq(ProcessCharge.minutes(durationS: 20, trimStart: 0, trimEnd: nil), 1, "never less than one")
    eq(ProcessCharge.minutes(durationS: 1240, trimStart: 100, trimEnd: 700), 10, "the kept window")
    eq(ProcessCharge.minutes(durationS: nil, trimStart: 0, trimEnd: nil), nil, "no length, no quote")
    eq(ProcessCharge.label(), "Process", "the unprocessed page's button, no price on it")
    eq(ProcessCharge.label(again: true), "Process again",
       "More options' button says it processes the match again, no price on it")

    // The cost is the line under the button, and it follows the trim.
    eq(ProcessCharge.usesLine(minutes: 12, balance: 300), "Uses 12 of your 300 minutes.",
       "what this run uses, out of the balance")
    let trimmed = ProcessCharge.minutes(durationS: 1240, trimStart: 100, trimEnd: 700)
    eq(ProcessCharge.usesLine(minutes: trimmed, balance: 300), "Uses 10 of your 300 minutes.",
       "the line quotes the trimmed window")
    eq(ProcessCharge.usesLine(minutes: 12, balance: nil), "Uses 12 minutes.",
       "an unknown balance: only the cost")
    eq(ProcessCharge.usesLine(minutes: 1, balance: nil), "Uses 1 minute.", "one minute, singular")
    eq(ProcessCharge.usesLine(minutes: 1, balance: 1), "Uses 1 of your 1 minute.",
       "a balance of one, singular")
    eq(ProcessCharge.usesLine(minutes: nil, balance: 300), nil, "no length, no line")
    eq(ProcessCharge.usesLine(minutes: UploadCutWay.minutes([(durationS: 600, trimStartS: 60, trimEndS: 300),
                                                             (durationS: 130, trimStartS: nil, trimEndS: nil)]),
                              balance: 40),
       "Uses 7 of your 40 minutes.",
       "the upload sheet: every file of the session, the first one's trim included")
    eq(CutAgainCopy.processAgain, "Process again", "More options' label over the two ways")
    eq(CutAgainCopy.automatically, "Automatically", "the first way, as on the unprocessed page")
    eq(ProcessCharge.trimmed(durationS: 600, trimStart: 0.4, trimEnd: 599.8), false,
       "half a second either end is not a trim")
    eq(ProcessCharge.trimmed(durationS: 600, trimStart: 1, trimEnd: nil), true, "a trimmed start")
    eq(ProcessCharge.enough(minutes: 10, balance: 9, needsMore: false), false, "short of minutes")
    eq(ProcessCharge.enough(minutes: 10, balance: 10, needsMore: false), true, "exactly enough")
    eq(ProcessCharge.enough(minutes: 10, balance: nil, needsMore: false), true,
       "an unknown balance does not block (the server decides)")
    eq(ProcessCharge.enough(minutes: 1, balance: 100, needsMore: true), false,
       "the server said not enough")

    runStrictnessChecks()
}

/// Cut strictness is gone from every player surface (owner, 2026-09-25):
/// whatever the trim, a request carries "normal".
private func runStrictnessChecks() {
    let id = UUID(uuidString: "6D0CEA7A-0000-4000-8000-000000000001")!
    func json<T: Encodable>(_ value: T) -> [String: Any] {
        let data = try! JSONEncoder().encode(value)
        return try! JSONSerialization.jsonObject(with: data) as! [String: Any]
    }
    let whole = json(ProcessRequestBody(matchId: id, settings: ProcessSettings()))
    eq(whole["strictness"] as? String, "normal", "/api/process always sends normal")
    eq(whole["matchId"] as? String, id.uuidString.lowercased(), "the match, lowercased")
    eq(whole["points"] as? Bool, true, "points are always asked for")
    eq(whole["placement"] as? Bool, true, "the analysis rides along by default")
    check(whole["trimStartS"] == nil && whole["trimEndS"] == nil,
          "an untrimmed request sends no window, as before")

    let window = json(ProcessRequestBody(
        matchId: id, settings: ProcessSettings(trimStart: 12, trimEnd: 100), placement: false))
    eq(window["strictness"] as? String, "normal", "a trimmed request still sends normal")
    eq(window["trimStartS"] as? Double, 12, "the window's start")
    eq(window["trimEndS"] as? Double, 100, "the window's end")
    eq(window["placement"] as? Bool, false, "placement as the caller says")

    let replace = json(AutoRecutParams(matchId: id, settings: ProcessSettings(trimStart: 5, trimEnd: nil)))
    eq(replace["p_strictness"] as? String, "normal", "claim_auto_recut always sends normal")
    eq(replace["p_replace"] as? Bool, true, "Replace")
    eq(replace["p_trim_start_s"] as? Double, 5, "Replace's window start")
    eq(ProcessSettings.strictness, "normal", "the one strictness a new request carries")
}

private func job(_ id: UUID, _ kind: String, _ status: String, match: UUID?) -> JobRow {
    let options = match.map { #"{"match_id": "\#($0.uuidString.lowercased())"}"# } ?? "{}"
    let json = """
    {"id": "\(id.uuidString)", "status": "\(status)", "kind": "\(kind)", "progress": 0,
     "original_name": null, "options": \(options), "created_at": "2026-09-25T10:00:00Z"}
    """
    return try! JSONDecoder().decode(JobRow.self, from: Data(json.utf8))
}

private func matchRow(_ id: UUID, jobId: UUID?, status: String) -> MatchRow {
    let job = jobId.map { "\"\($0.uuidString)\"" } ?? "null"
    let json = """
    {"id": "\(id.uuidString)", "user_id": "11111111-1111-4111-8111-111111111111",
     "job_id": \(job), "match_type": "match", "played_at": "2026-09-20T12:00:00Z",
     "status": "\(status)", "created_at": "2026-09-20T12:00:00Z"}
    """
    return try! JSONDecoder().decode(MatchRow.self, from: Data(json.utf8))
}

/// Home and the library after a Replace, and with Keep's new match.
private func runLibraryWorkChecks() {
    let match = UUID(), upload = UUID(), candidate = UUID(), copy = UUID(), copyJob = UUID()

    // During a Replace: the match is ready, its job_id still the upload's,
    // and the candidate hand cut is queued against it.
    let during = [job(candidate, "hand_cut", "queued", match: match)]
    eq(LibraryWork.orphanJobs(during, ownMatches: [matchRow(match, jobId: upload, status: "ready")]).count, 0,
       "a re-cut running on a match is that match's work, not a stray card")

    // After a Replace: job_id is the candidate's and the upload job is done,
    // so it is not among the queued or running jobs at all.
    let after: [JobRow] = []
    eq(LibraryWork.orphanJobs(after, ownMatches: [matchRow(match, jobId: candidate, status: "ready")]).count, 0,
       "nothing left over after a Replace")

    // Keep: a new uploaded match with an ordinary hand cut on it.
    let keep = [job(copyJob, "hand_cut", "queued", match: copy)]
    let matches = [matchRow(match, jobId: upload, status: "ready"), matchRow(copy, jobId: copyJob, status: "uploaded")]
    eq(LibraryWork.orphanJobs(keep, ownMatches: matches).count, 0,
       "Keep's new match owns its job; no second card")

    // Keep automatically, before the worker links job_id: found by match id.
    let linking = [job(copyJob, "deadspace_cut", "queued", match: copy)]
    let unlinked = [matchRow(match, jobId: upload, status: "ready"), matchRow(copy, jobId: nil, status: "uploaded")]
    eq(LibraryWork.orphanJobs(linking, ownMatches: unlinked).count, 0,
       "an unlinked job on the new match is still that match's")

    // An import with no match row yet does count on its own.
    let importing = [job(UUID(), "youtube_import", "processing", match: nil)]
    eq(LibraryWork.orphanJobs(importing, ownMatches: matches).count, 1,
       "a job no match names still counts once")
    eq(LibraryWork.orphanJobs([job(UUID(), "reclip", "queued", match: nil)], ownMatches: matches).count, 0,
       "clip re-cuts are never a match of their own")
}

/// The owner's copy of 2026-09-25: the switch says what the pass is, and
/// "Reset" is "Back to last point".
private func runMarkerCopyChecks() {
    eq(MarkerCopy.scoreLabel(on: true, practice: false), "Cut and score", "switch on")
    eq(MarkerCopy.scoreLabel(on: false, practice: false), "Cut only", "switch off")
    eq(MarkerCopy.scoreLabel(on: true, practice: true), "Cut only", "practice is cut only")
    eq(MarkerCopy.scoreDetail(on: true, practice: false), "Say who won each point as you go.", "line, on")
    eq(MarkerCopy.scoreDetail(on: false, practice: false), "Mark where each rally starts and ends.", "line, off")
    eq(MarkerCopy.scoreDetail(on: false, practice: true), "Scoring is for matches.", "line, practice")
    eq(MarkerCopy.backToLastPoint, "Back to last point", "the renamed Reset")
    for words in [CutAgainCopy.moreOptions, CutAgainCopy.processAgain, CutAgainCopy.automatically, CutAgainCopy.markYourself,
                  CutAgainCopy.reportProblem, CutAgainCopy.replace, CutAgainCopy.keep,
                  CutAgainCopy.replaceDeletes, CutAgainCopy.matchNotesStay, CutAgainCopy.hasCoachReview,
                  CutAgainCopy.startAgain, CutAgainCopy.clearTitle, CutAgainCopy.busy, CutAgainCopy.noSource,
                  MarkerCopy.scoreDetail(on: true, practice: false),
                  MarkerCopy.scoreDetail(on: false, practice: false),
                  MarkerCopy.scoreDetail(on: false, practice: true)] {
        let lower = words.lowercased()
        check(!lower.contains("free") && !lower.contains("mac") && !lower.contains("iphone")
              && !lower.contains("version") && !words.contains("\u{2014}"),
              "no free, Mac, iPhone, version or em dash: \(words)")
    }
}

/// The pass fills the portrait pad; the gate is plain buttons that fit.
private func runPortraitPadChecks() {
    let gap = MarkPortraitPad.gap, pad = MarkPortraitPad.padding, row = MarkPortraitPad.rowH
    // 320 is the smallest pad, 620 a Pro Max's.
    for height in [320.0, 398.0, 451.0, 620.0] {
        // The pass, as the marker has always split it.
        let scoring = MarkPortraitPad.pass(height: height, refusal: false, answers: true)
        let used = 2 * pad + scoring.pair + gap + scoring.answers + gap + row + gap + row
        near(used, height, "the pass fills \(height)")

        // The gate is plain buttons, the web's heights, and always fits.
        for (buttons, again) in [(1, false), (2, false), (2, true)] {
            let g = MarkPortraitPad.gate(height: height, refusal: false, buttons: buttons, startAgain: again)
            near(g.primary, 64, "the gate's primary is a plain button at \(height)")
            near(g.secondary, buttons > 1 ? 48 : 0, "the gate's second button is plain at \(height)")
            let used = 2 * pad + g.primary + (buttons > 1 ? gap + g.secondary : 0)
                + (again ? gap + row : 0) + gap + row
            check(used <= height + 0.001, "the gate fits \(height)")
        }
    }
}

/// Landscape: Start again at the foot of the gate, only with marks.
private func runStartAgainRailChecks() {
    // The web's own cases (markLandscape.test.ts), label, tone and action.
    func labels(_ opened: HandCutOpenAs, again: Bool) -> [String] {
        MarkLandscape.railPair(started: false, opened: opened, reviewing: false,
                               adjusting: false, open: false, startAgain: again)
            .map { "\($0.label):\($0.tone.rawValue):\($0.action.rawValue)" }
    }
    eq(labels(.choice, again: true),
       ["Keep marking:lit:keepMarking", "Review the points:unlit:reviewPoints", "Start again:unlit:startAgain"],
       "choice gate with Start again")
    eq(labels(.review, again: true), ["Begin review:lit:beginReview", "Start again:unlit:startAgain"],
       "review gate with Start again")
    eq(labels(.scoring, again: true), ["Keep marking:lit:beginCutting", "Start again:unlit:startAgain"],
       "points still to call: carry on from the first of them")
    eq(labels(.fresh, again: false), ["Begin Cutting:lit:beginCutting"], "no Start again with nothing marked")
    eq(labels(.choice, again: false), ["Keep marking:lit:keepMarking", "Review the points:unlit:reviewPoints"],
       "the raw page's gate is unchanged")
    for opened in [HandCutOpenAs.choice, .review, .scoring] {
        let tiles = MarkLandscape.railPair(started: false, opened: opened, reviewing: false,
                                           adjusting: false, open: false, startAgain: true)
        near(tiles.map(\.share).reduce(0, +), 1, "the gate's shares fill the rail (\(opened))")
        let h = MarkLandscape.pairTileHeight(tiles.last!, count: tiles.count, boxH: 265)
        check(h >= 44, "Start again is a real touch target on a 6.1-inch board (\(h))")
    }
    eq(MarkLandscape.railPair(started: true, opened: .fresh, reviewing: false, adjusting: false, open: true)
        .map(\.label), ["Back to last point", "End Point"], "the open rally's pair")
}

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

    eq(MoreOptionsPlan.markingTrailing(markedCount: 12, draftOpen: true), "12 marked",
       "an unsent draft trails its count")
    eq(MoreOptionsPlan.markingTrailing(markedCount: 12, draftOpen: false), nil,
       "a submitted draft is the live cut, not a draft")
    eq(MoreOptionsPlan.markingTrailing(markedCount: 0, draftOpen: true), nil,
       "an empty draft trails nothing")
}

private func runRecutChoiceChecks() {
    var byHand = RecutChoiceState.byHand(RecutOptions(available: true, hasMatchNotes: false))
    eq(byHand.selected, .keep, "Keep is the default (assumption B)")
    eq(byHand.replace, false, "Keep does not replace")
    eq(byHand.replaceLines, [], "nothing under Replace while Keep is chosen")
    byHand.select(.replace)
    eq(byHand.replace, true, "Replace can be chosen by hand")
    eq(byHand.replaceLines, ["Points, scores and point notes will be deleted."],
       "Replace says what it deletes")

    var withNotes = RecutChoiceState.byHand(RecutOptions(available: true, hasMatchNotes: true))
    withNotes.select(.replace)
    eq(withNotes.replaceLines,
       ["Points, scores and point notes will be deleted.", "Match notes stay with the match."],
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
    eq(ProcessCharge.label(minutes: 12), "Process · 12 min", "the button")
    eq(ProcessCharge.label(minutes: nil), "Process", "the button without a length")
    eq(ProcessCharge.trimmed(durationS: 600, trimStart: 0.4, trimEnd: 599.8), false,
       "half a second either end is not a trim")
    eq(ProcessCharge.trimmed(durationS: 600, trimStart: 1, trimEnd: nil), true, "a trimmed start")
    eq(ProcessCharge.enough(minutes: 10, balance: 9, needsMore: false), false, "short of minutes")
    eq(ProcessCharge.enough(minutes: 10, balance: 10, needsMore: false), true, "exactly enough")
    eq(ProcessCharge.enough(minutes: 10, balance: nil, needsMore: false), true,
       "an unknown balance does not block (the server decides)")
    eq(ProcessCharge.enough(minutes: 1, balance: 100, needsMore: true), false,
       "the server said not enough")
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
    for words in [CutAgainCopy.moreOptions, CutAgainCopy.processAutomatically, CutAgainCopy.markYourself,
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

/// The portrait pad fills its height in every state.
private func runPortraitPadChecks() {
    let gap = MarkPortraitPad.gap, pad = MarkPortraitPad.padding, row = MarkPortraitPad.rowH
    for height in [320.0, 398.0, 451.0] {
        // The pass, as the marker has always split it.
        let scoring = MarkPortraitPad.pass(height: height, refusal: false, answers: true)
        let used = 2 * pad + scoring.pair + gap + scoring.answers + gap + row + gap + row
        near(used, height, "the pass fills \(height)")

        // The choice gate: two buttons, the tool row's place empty.
        let choice = MarkPortraitPad.gate(height: height, refusal: false, buttons: 2, startAgain: false)
        let choiceUsed = 2 * pad + choice.primary + gap + choice.secondary + gap + row
        check(choiceUsed <= height + 0.001, "the choice gate fits \(height)")
        check(height - choiceUsed < 1 || choice.primary == MarkPortraitPad.primaryMax
              || choice.secondary == MarkPortraitPad.secondaryMax,
              "the choice gate leaves no dead zone at \(height) unless a button is at its ceiling")

        // Marking again: Start again where the tool row goes.
        let again = MarkPortraitPad.gate(height: height, refusal: false, buttons: 2, startAgain: true)
        let againUsed = 2 * pad + again.primary + gap + again.secondary + gap + row + gap + row
        check(againUsed <= height + 0.001, "the gate with Start again fits \(height)")
        near(again.primary, min(MarkPortraitPad.primaryMax, scoring.pair),
             "the gate's primary takes the pair's share at \(height)")
        near(again.secondary, min(MarkPortraitPad.secondaryMax, scoring.answers),
             "the gate's secondary takes the answers' share at \(height)")

        // One button takes both shares, up to its ceiling.
        let one = MarkPortraitPad.gate(height: height, refusal: false, buttons: 1, startAgain: false)
        near(one.primary, min(MarkPortraitPad.singleMax, height - 2 * pad - row - gap),
             "a single gate button fills the pad at \(height)")
    }
    let refused = MarkPortraitPad.gate(height: 398, refusal: true, buttons: 1, startAgain: false)
    let clear = MarkPortraitPad.gate(height: 398, refusal: false, buttons: 1, startAgain: false)
    near(clear.primary - refused.primary, MarkPortraitPad.refusalH + gap, "a refusal line takes its own row")
    check(MarkPortraitPad.gate(height: 60, refusal: false, buttons: 2, startAgain: true).primary >= 64,
          "never smaller than a pad button")
}

/// Landscape: Start again at the foot of the gate, only with marks.
private func runStartAgainRailChecks() {
    func labels(_ opened: HandCutOpenAs, again: Bool) -> [String] {
        MarkLandscape.railPair(started: false, opened: opened, reviewing: false,
                               adjusting: false, open: false, startAgain: again)
            .map { "\($0.label):\($0.tone.rawValue)" }
    }
    eq(labels(.choice, again: true), ["Keep marking:lit", "Review the points:unlit", "Start again:unlit"],
       "choice gate with Start again")
    eq(labels(.review, again: true), ["Begin review:lit", "Start again:unlit"], "review gate with Start again")
    eq(labels(.fresh, again: true), ["Begin Cutting:lit"], "no Start again with nothing marked")
    eq(labels(.choice, again: false), ["Keep marking:lit", "Review the points:unlit"],
       "the raw page's gate is unchanged")
    for opened in [HandCutOpenAs.choice, .review] {
        let tiles = MarkLandscape.railPair(started: false, opened: opened, reviewing: false,
                                           adjusting: false, open: false, startAgain: true)
        near(tiles.map(\.share).reduce(0, +), 1, "the gate's shares fill the rail (\(opened))")
        let h = MarkLandscape.pairTileHeight(tiles.last!, count: tiles.count, boxH: 265)
        check(h >= 44, "Start again is a real touch target on a 6.1-inch board (\(h))")
    }
    eq(MarkLandscape.railPair(started: true, opened: .fresh, reviewing: false, adjusting: false, open: true)
        .map(\.label), ["Back to last point", "End Point"], "the open rally's pair")
}

import Foundation

// Cutting a processed match again (docs/superpowers/specs/2026-09-25-cut-
// again-design.md and its contract): what the More options sheet offers, the
// Replace or Keep choice, the words for each refusal, and the arithmetic the
// automatic cut quotes its minutes with. Foundation only, so ios/Tests/run.sh
// checks every rule here without a simulator; the views read these and
// decide nothing of their own.

// MARK: - The words

/// Every sentence the player reads in this feature, in one place so the
/// web's copy can be checked against it line by line. No explanations, no
/// price for marking by hand, never "free", "Mac", "iPhone" or "version".
enum CutAgainCopy {
    static let moreOptions = "More options"
    /// The label over the two ways, which is what they do on a processed
    /// match: process it again. Also its button.
    static let processAgain = "Process again"
    /// The unprocessed page's button under Automatically.
    static let process = "Process"
    /// The trim preview's two stamps: the handle to the picture.
    static let startHere = "Start here"
    static let endHere = "End here"
    /// The unprocessed page's word for the same row.
    static let automatically = "Automatically"
    static let markYourself = "Mark the points yourself"
    /// The line under each way, the unprocessed page's own.
    static let automaticallyDetail = "We find the rallies and cut them for you."
    static let markYourselfDetail = "You mark where each point starts and ends."
    static let reportProblem = "Report a problem"

    static let replace = "Replace this match"
    static let keep = "Keep this match and add a new one"
    static let replaceDeletes = "Points, scores and point notes will be deleted."
    /// Marking by hand keeps each point's score through its mark, so only the
    /// point notes go (Adil, 2026-09-26).
    static let handReplaceDeletes = "Point notes will be deleted."
    static let matchNotesStay = "Match notes stay with the match."
    static let hasCoachReview = "Has a coach review"

    static let startAgain = "Start again"
    static let clearTitle = "Clear all marks?"
    static let clear = "Clear"
    static let cancel = "Cancel"

    static let busy = "Something is already running on this match."
    static let noSource = "The original video is no longer stored."
    /// The raw page's own sentence for a process call that went wrong.
    static let somethingWrong = "Something went wrong. Try again."
    /// The raw page's sentences for a process call the charge refused.
    static let notEnoughMinutes = "Not enough minutes for this video."
    static let queueFull = "Your queue is full. Wait for a video to finish."
}

// MARK: - What the server allows (recut_options)

/// `recut_options(p_match_id)`: what the sheet may offer on this match.
/// Missing keys read as the safe answer (nothing available, nothing to
/// replace), so a response the app does not understand offers less, never
/// more.
struct RecutOptions: Decodable, Equatable {
    var available: Bool
    /// `not_ready`, `processing`, `no_source` or `support_request`.
    var reason: String?
    var replaceByHand: Bool
    var replaceAutomatic: Bool
    var hasCoachReview: Bool
    var hasMatchNotes: Bool
    var cutSource: String?

    enum CodingKeys: String, CodingKey {
        case available, reason
        case replaceByHand = "replace_by_hand"
        case replaceAutomatic = "replace_automatic"
        case hasCoachReview = "has_coach_review"
        case hasMatchNotes = "has_match_notes"
        case cutSource = "cut_source"
    }

    init(
        available: Bool, reason: String? = nil, replaceByHand: Bool = true,
        replaceAutomatic: Bool = false, hasCoachReview: Bool = false,
        hasMatchNotes: Bool = false, cutSource: String? = nil
    ) {
        self.available = available
        self.reason = reason
        self.replaceByHand = replaceByHand
        self.replaceAutomatic = replaceAutomatic
        self.hasCoachReview = hasCoachReview
        self.hasMatchNotes = hasMatchNotes
        self.cutSource = cutSource
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        available = (try? c.decodeIfPresent(Bool.self, forKey: .available)) ?? false
        reason = try? c.decodeIfPresent(String.self, forKey: .reason)
        replaceByHand = (try? c.decodeIfPresent(Bool.self, forKey: .replaceByHand)) ?? false
        replaceAutomatic = (try? c.decodeIfPresent(Bool.self, forKey: .replaceAutomatic)) ?? false
        hasCoachReview = (try? c.decodeIfPresent(Bool.self, forKey: .hasCoachReview)) ?? false
        hasMatchNotes = (try? c.decodeIfPresent(Bool.self, forKey: .hasMatchNotes)) ?? false
        cutSource = try? c.decodeIfPresent(String.self, forKey: .cutSource)
    }
}

// MARK: - The More options sheet

/// Which rows the sheet shows, or the one line that stands in for them.
/// Report a problem is always there: it is today's request form.
struct MoreOptionsPlan: Equatable {
    var automatic = false
    var marking = false
    /// A cut is running on this match: the sheet shows it and nothing else
    /// can start.
    var running = false
    /// Said in place of the two rows when neither can be offered.
    var blocked: String?

    /// - options: the server's answer, nil while unread or unreadable.
    /// - handCutEnabled: `hand_cut_enabled` for this account, with the
    ///   draft table readable (the raw page's own gate).
    /// - commerceEnabled: `app_config.commerce_enabled`. Processing
    ///   automatically spends minutes, so it is offered only while
    ///   commerce is on, as on the web (post-rollout audit S3). An unread
    ///   answer is off: the sheet offers less, never more.
    /// - jobRunning: this match's processing feedback says a job is queued
    ///   or running, which the sheet can know before recut_options answers.
    static func make(
        options: RecutOptions?, handCutEnabled: Bool, commerceEnabled: Bool, jobRunning: Bool
    ) -> MoreOptionsPlan {
        if jobRunning { return MoreOptionsPlan(running: true) }
        guard let options else { return MoreOptionsPlan() }
        if options.available {
            return MoreOptionsPlan(automatic: commerceEnabled, marking: handCutEnabled)
        }
        switch options.reason {
        case "processing":
            // The server knows of a job the feedback has not shown yet.
            return MoreOptionsPlan(running: true, blocked: CutAgainCopy.busy)
        case "support_request": return MoreOptionsPlan(blocked: CutAgainCopy.busy)
        case "no_source": return MoreOptionsPlan(blocked: CutAgainCopy.noSource)
        default: return MoreOptionsPlan()
        }
    }

    /// The marks the player made and has not sent, which "{N} marked" and
    /// "Keep marking" speak for. A submitted draft is the cut that is
    /// already live. A prefilled one is the live cut's points as
    /// start_recut wrote them for the marker to open on (20260925133555):
    /// opening the marker and closing it again made nothing, so it counts
    /// as nothing until a mark really changes. `submitted` is false on an
    /// unprocessed match, whose row counts a failed cut's marks too.
    static func draftCount(markedCount: Int, submitted: Bool, prefilled: Bool) -> Int {
        submitted || prefilled ? 0 : markedCount
    }

    /// "Mark the points yourself" trails the count of marks made and not
    /// sent (`draftCount`), or nothing.
    static func markingTrailing(draftCount: Int) -> String? {
        draftCount > 0 ? "\(draftCount) marked" : nil
    }
}

// MARK: - The two ways, pick one

/// The two ways to cut a match: the unprocessed page's "Automatically" and
/// "Mark the points yourself", and the same two under More options'
/// "Process again" label. They are one choice, not two rows that open
/// (owner's option A, 2026-09-25): at most one is selected, and only its
/// controls show under the pair, so there is only ever one cyan primary on
/// screen (QA 2026-09-25).
enum CutWay: Equatable {
    case automatic, byHand
}

/// Which way is selected. Local to the screen, never saved.
struct CutWayChoice: Equatable {
    /// The player's tap. Nil until they make one.
    private(set) var chosen: CutWay?

    init(chosen: CutWay? = nil) { self.chosen = chosen }

    mutating func choose(_ way: CutWay) { chosen = way }

    /// The way that is selected: only ever the one the player tapped. There
    /// is no default (owner, 2026-09-25): until a tap, neither is selected
    /// and nothing shows under the pair, unsent marks included (their row
    /// still reads "{N} marked"). Marking that cannot be chosen (no original
    /// to mark) is never selected, even by an earlier tap.
    func selected(markingSelectable: Bool = true) -> CutWay? {
        if chosen == .byHand && !markingSelectable { return nil }
        return chosen
    }
}

// MARK: - Replace or Keep

enum RecutChoice: String, Equatable {
    case replace, keep
}

/// The last step of either way: two rows, one selected, Keep by default.
struct RecutChoiceState: Equatable {
    private(set) var selected: RecutChoice = .keep
    private(set) var replaceAllowed: Bool
    /// Under a greyed Replace. Nil when Replace is allowed, and when it is
    /// greyed for a reason the player is not told (automatic, phase 1).
    private(set) var replaceBlockedLine: String?
    let hasMatchNotes: Bool
    /// What Replace deletes on this way: everything for an automatic cut,
    /// only the point notes when the points are marked by hand.
    let deletesLine: String

    init(replaceAllowed: Bool, replaceBlockedLine: String? = nil, hasMatchNotes: Bool,
         deletesLine: String = CutAgainCopy.replaceDeletes) {
        self.replaceAllowed = replaceAllowed
        self.replaceBlockedLine = replaceAllowed ? nil : replaceBlockedLine
        self.hasMatchNotes = hasMatchNotes
        self.deletesLine = deletesLine
    }

    /// Marking by hand: Replace unless a coach review exists (assumption A).
    static func byHand(_ o: RecutOptions) -> RecutChoiceState {
        let allowed = o.replaceByHand && !o.hasCoachReview
        return RecutChoiceState(
            replaceAllowed: allowed,
            replaceBlockedLine: o.hasCoachReview ? CutAgainCopy.hasCoachReview : nil,
            hasMatchNotes: o.hasMatchNotes,
            deletesLine: CutAgainCopy.handReplaceDeletes
        )
    }

    /// Processing automatically: Replace only once the server says so. While
    /// it does not, Replace is greyed with no line; a coach review still
    /// says why when it is the reason.
    static func automatic(_ o: RecutOptions) -> RecutChoiceState {
        let allowed = o.replaceAutomatic && !o.hasCoachReview
        return RecutChoiceState(
            replaceAllowed: allowed,
            replaceBlockedLine: o.hasCoachReview ? CutAgainCopy.hasCoachReview : nil,
            hasMatchNotes: o.hasMatchNotes
        )
    }

    /// A greyed Replace cannot be chosen.
    mutating func select(_ choice: RecutChoice) {
        guard choice == .keep || replaceAllowed else { return }
        selected = choice
    }

    /// The claim came back `coach_review`: a review arrived after the sheet
    /// read the options. Replace greys with its line and Keep is chosen.
    mutating func coachReviewFound() {
        replaceAllowed = false
        replaceBlockedLine = CutAgainCopy.hasCoachReview
        selected = .keep
    }

    var replace: Bool { selected == .replace && replaceAllowed }

    /// Under Replace, only while it is selected.
    var replaceLines: [String] {
        guard replace else { return [] }
        return hasMatchNotes
            ? [deletesLine, CutAgainCopy.matchNotesStay]
            : [deletesLine]
    }
}

// MARK: - Refusals

enum RecutRefusal: Error, Equatable {
    /// Not an error: Replace greys with "Has a coach review".
    case coachReview
    case message(String)
}

enum CutAgainErrors {
    /// `claim_hand_cut`'s refusals in the web's words (RawMatchView.tsx),
    /// which the raw page has always shown.
    static func handCut(_ raw: String) -> String {
        if raw.contains("already_cut") { return "This match already has points." }
        if raw.contains("already_processing") { return CutAgainCopy.busy }
        if raw.contains("queue_full") { return "Your queue is full. Wait for a video to finish." }
        if raw.contains("check_pending") { return "Still checking the video. Try again in a moment." }
        if raw.contains("invalid_marks") { return "Some marks are not valid. Check for very short points." }
        return "That didn't send. Check your connection and try again."
    }

    /// `claim_hand_recut`: the contract's codes first, then the hand cut's.
    static func handRecut(_ raw: String) -> RecutRefusal {
        if raw.contains("coach_review") { return .coachReview }
        if raw.contains("support_request") || raw.contains("already_processing")
            || code(raw) == "processing" {
            return .message(CutAgainCopy.busy)
        }
        if raw.contains("no_source") { return .message(CutAgainCopy.noSource) }
        return .message(handCut(raw))
    }

    /// `claim_auto_recut` (processed automatically, Replace or Keep): the
    /// contract's codes as for the hand claim, then the charge's refusals
    /// in the raw page's words, since it is the same charge as its Process
    /// button. Never a hand cut's sentence: there are no marks here. The
    /// web's autoRecutClaimError in recutView.ts.
    static func autoRecut(_ raw: String) -> RecutRefusal {
        if raw.contains("coach_review") { return .coachReview }
        if raw.contains("support_request") || raw.contains("already_processing")
            || code(raw) == "processing" {
            return .message(CutAgainCopy.busy)
        }
        if raw.contains("no_source") { return .message(CutAgainCopy.noSource) }
        if raw.contains("insufficient_minutes") { return .message(CutAgainCopy.notEnoughMinutes) }
        if raw.contains("queue_full") { return .message(CutAgainCopy.queueFull) }
        return .message(CutAgainCopy.somethingWrong)
    }

    /// A bare `processing` must match the whole code: it is a word inside
    /// other messages.
    private static func code(_ raw: String) -> String {
        raw.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

// MARK: - The automatic cut's minutes

/// The raw page's quote, shared with More options: the kept window rounded
/// up to whole minutes, never less than one. The server recomputes the same
/// number at claim time, so this can only be wrong towards an error.
enum ProcessCharge {
    static func keptSeconds(durationS: Double?, trimStart: Double, trimEnd: Double?) -> Double? {
        guard let durationS else { return nil }
        return max(0, (trimEnd ?? durationS) - trimStart)
    }

    static func trimmed(durationS: Double?, trimStart: Double, trimEnd: Double?) -> Bool {
        guard let durationS else { return false }
        return trimStart > 0.5 || (trimEnd.map { $0 < durationS - 0.5 } ?? false)
    }

    static func minutes(durationS: Double?, trimStart: Double, trimEnd: Double?) -> Int? {
        keptSeconds(durationS: durationS, trimStart: trimStart, trimEnd: trimEnd)
            .map { max(1, Int(($0 / 60).rounded(.up))) }
    }

    /// The button. `again` on a processed match (More options), where it
    /// says it processes the match again. No price on it: the cost is the
    /// line under it (`usesLine`).
    static func label(again: Bool = false) -> String {
        again ? CutAgainCopy.processAgain : CutAgainCopy.process
    }

    /// The line under the button, and under the upload sheet's trim: what
    /// this run costs, out of what the player has. It follows the trim, so
    /// it moves as a handle does. Without a known balance, only the cost.
    /// Nil while there is no length to quote. Out of minutes is said
    /// elsewhere, in the words each place already had.
    static func usesLine(minutes: Int?, balance: Int?) -> String? {
        guard let minutes else { return nil }
        guard let balance else {
            return "Uses \(count(minutes))."
        }
        return "Uses \(minutes) of your \(count(balance))."
    }

    /// The line in place of that one when the balance is short, the web's
    /// words: "Not enough minutes. You have 20 minutes."
    static func notEnoughLine(balance: Int) -> String {
        "Not enough minutes. You have \(count(balance))."
    }

    /// "1 minute", "20 minutes".
    static func count(_ minutes: Int) -> String {
        "\(minutes) \(minutes == 1 ? "minute" : "minutes")"
    }

    static func enough(minutes: Int?, balance: Int?, needsMore: Bool) -> Bool {
        if needsMore { return false }
        guard let minutes, let balance else { return true }
        return balance >= minutes
    }
}

// MARK: - What an automatic cut sends

/// The automatic cut's settings, as /api/process and claim_auto_recut take
/// them. Cut strictness is no longer the player's to choose (owner,
/// 2026-09-25): every new request sends "normal", which is also what the
/// server assumes. A match keeps the strictness it was cut with for its
/// clip padding (Playhead.clipPad), which nothing here touches.
struct ProcessSettings: Equatable {
    var trimStart: Double?
    var trimEnd: Double?

    /// The only strictness a new request carries.
    static let strictness = "normal"
}

/// /api/process's body, as the raw page and More options' Keep send it.
/// Every processed upload asks for the analysis too (Adil, 2026-09-16).
struct ProcessRequestBody: Encodable, Equatable {
    let matchId: String
    let trimStartS: Double?
    let trimEndS: Double?
    let points: Bool
    let placement: Bool
    let strictness: String

    init(matchId: UUID, settings: ProcessSettings, placement: Bool = true) {
        self.matchId = matchId.uuidString.lowercased()
        trimStartS = settings.trimStart
        trimEndS = settings.trimEnd
        points = true
        self.placement = placement
        strictness = ProcessSettings.strictness
    }
}

/// `claim_auto_recut`'s parameters: processing a processed match again,
/// automatically. Replace builds the new cut beside this one; Keep
/// (`p_replace` false) copies the match and claims the copy's processing
/// in one transaction, so a refusal leaves no copy behind (post-rollout
/// audit K: Keep used to be the copy and then /api/process, and a refused
/// charge left an unprocessed duplicate).
struct AutoRecutParams: Encodable, Equatable {
    let p_match_id: String
    let p_replace: Bool
    let p_trim_start_s: Double?
    let p_trim_end_s: Double?
    let p_strictness: String

    init(matchId: UUID, settings: ProcessSettings, replace: Bool) {
        p_match_id = matchId.uuidString.lowercased()
        p_replace = replace
        p_trim_start_s = settings.trimStart
        p_trim_end_s = settings.trimEnd
        p_strictness = ProcessSettings.strictness
    }
}

/// `claim_auto_recut`'s answer: the job, and the match it runs on (this one
/// for Replace, the new match for Keep).
struct AutoRecutClaim: Decodable, Equatable {
    let jobId: UUID?
    let matchId: UUID?

    enum CodingKeys: String, CodingKey {
        case jobId = "job_id"
        case matchId = "match_id"
    }
}

/// What pressing Process again did, for the sheet.
enum ProcessAgainOutcome: Equatable {
    /// Replace was claimed: the sheet closes, the match keeps playing and
    /// More options shows the ordinary progress.
    case replacing
    /// Keep made a new match, already processing: the sheet closes and
    /// opens it.
    case opened(UUID)
    /// Refused (the sentence is in `error`), or Replace went grey over a
    /// coach review and the choice is back on Keep: the sheet stays.
    case stayed

    /// A claim that landed. Keep opens the match the claim names; an
    /// answer without one (never sent by the live function) stays, with
    /// the generic sentence, rather than opening this match again.
    static func after(replace: Bool, claim: AutoRecutClaim, matchId: UUID) -> ProcessAgainOutcome {
        if replace { return .replacing }
        guard let id = claim.matchId, id != matchId else { return .stayed }
        return .opened(id)
    }
}

// MARK: - start_recut

/// `start_recut`'s answer. The draft it wrote (or resumed) is read back
/// through the draft store, which also reconciles the phone's own copy, so
/// this is kept for its mode and as proof the call landed.
struct StartRecutReply: Decodable, Equatable {
    let marks: HandCutJSON?
    let mode: String?
    let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case marks, mode
        case updatedAt = "updated_at"
    }
}

/// `claim_hand_recut`'s answer: the job, and the match it runs on (this one
/// for Replace, the new copy for Keep).
struct HandRecutClaim: Decodable, Equatable {
    let jobId: UUID?
    let matchId: UUID?

    enum CodingKeys: String, CodingKey {
        case jobId = "job_id"
        case matchId = "match_id"
    }
}

// MARK: - Home and the library

/// Which jobs Home counts on their own, beside the matches they belong to.
/// A job counts alone only when no own match names it, by `job_id` or by
/// `options.match_id`. After a Replace the match's `job_id` points at the
/// new cut's job and the upload's first job is finished (so it is not in
/// `activeJobs`, which holds only queued and running rows): nothing is left
/// over to draw as a stray card. A candidate cut running on a ready match is
/// that match's own work, not a second video.
enum LibraryWork {
    static let primaryKinds: Set<String> = ["youtube_import", "deadspace_cut", "hand_cut"]

    static func orphanJobs(_ activeJobs: [JobRow], ownMatches: [MatchRow]) -> [JobRow] {
        let ownJobIds = Set(ownMatches.compactMap(\.jobId))
        let ownIds = Set(ownMatches.map { $0.id.uuidString.lowercased() })
        return activeJobs.filter { job in
            primaryKinds.contains(job.kind)
                && !ownJobIds.contains(job.id)
                && !ownIds.contains(job.options?.matchId?.lowercased() ?? "")
        }
    }
}

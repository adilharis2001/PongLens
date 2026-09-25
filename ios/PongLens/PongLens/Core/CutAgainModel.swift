import Foundation
import Supabase

// The state and the calls behind More options on a processed match. The
// rules are in CutAgain.swift; this holds what the server said, what the
// sheet is set to, and the four database calls of the cut again contract
// (docs/superpowers/specs/2026-09-25-cut-again-contract.md). Transport is a
// struct of closures so the simulator fixture can run the real sheet on
// fakes.

/// A refusal from the database, reduced to its message (the code the
/// function raised), so a fake can raise the same thing.
struct CutAgainServerError: Error, Equatable {
    let message: String

    static func from(_ error: Error) -> CutAgainServerError {
        if let e = error as? CutAgainServerError { return e }
        if let e = error as? PostgrestError { return CutAgainServerError(message: e.message) }
        return CutAgainServerError(message: error.localizedDescription)
    }
}

/// What /api/process said.
enum ProcessStart: Equatable {
    case started(UUID?)
    /// The route's error code (`insufficient_minutes`, `queue_full`), or nil.
    case refused(String?)
}

enum ProcessAPI {
    /// Spend minutes on a match: the raw page's call, unchanged. Every
    /// processed upload asks for the analysis too (Adil, 2026-09-16).
    static func start(matchId: UUID, settings: ProcessSettings, placement: Bool = true) async -> ProcessStart {
        struct Res: Decodable {
            let jobId: String?
            enum CodingKeys: String, CodingKey { case jobId = "job_id" }
        }
        do {
            let res: Res = try await API.post(
                "api/process",
                ProcessRequestBody(matchId: matchId, settings: settings, placement: placement)
            )
            return .started(res.jobId.flatMap(UUID.init(uuidString:)))
        } catch let APIError.http(_, code) {
            return .refused(code)
        } catch {
            return .refused(nil)
        }
    }

    /// The raw page's sentences for a refused process call.
    static func message(_ code: String?) -> String {
        switch code {
        case "insufficient_minutes": CutAgainCopy.notEnoughMinutes
        case "queue_full": CutAgainCopy.queueFull
        default: CutAgainCopy.somethingWrong
        }
    }
}

/// What pressing Process again did, for the sheet.
enum ProcessAgainOutcome: Equatable {
    /// Replace was claimed: the sheet closes, the match keeps playing and
    /// More options shows the ordinary progress.
    case replacing
    /// Keep made a new match: the sheet closes and opens it.
    case opened(UUID)
    /// Refused (the sentence is in `error`), or Replace went grey over a
    /// coach review and the choice is back on Keep: the sheet stays.
    case stayed
}

struct CutAgainClient {
    var options: (UUID) async throws -> RecutOptions
    /// This match's processing feedback: the job working it, if any.
    var feedback: (UUID) async throws -> MatchProcessingFeedback?
    /// A job's progress, for the bar.
    var job: (UUID) async throws -> MatchJob?
    var minutes: () async throws -> Int
    var startRecut: (UUID, Bool) async throws -> StartRecutReply
    var claimHandRecut: (UUID, [HandCutSubmission], Bool) async throws -> HandRecutClaim
    var copyForRecut: (UUID) async throws -> UUID
    var process: (UUID, ProcessSettings) async -> ProcessStart
    /// Replace under Automatically, in More options (phase 2):
    /// `claim_auto_recut(p_match_id, p_replace, p_trim_start_s,
    /// p_trim_end_s, p_strictness)` returning `{job_id, match_id}`
    /// (20260925170532_cut_again_auto_replace.sql). Charged as /api/process
    /// charges; the detailed analysis rides along, as on every processed
    /// upload. Keep does not come here: it is the copy plus /api/process.
    var claimAutoRecut: (UUID, ProcessSettings) async throws -> UUID?

    static let live = CutAgainClient(
        options: { id in
            struct P: Encodable { let p_match_id: String }
            do {
                return try await supa.rpc("recut_options", params: P(p_match_id: id.uuidString.lowercased()))
                    .execute().value
            } catch { throw CutAgainServerError.from(error) }
        },
        feedback: { id in
            struct P: Encodable { let p_match_ids: [UUID] }
            let rows: [MatchProcessingFeedback] = try await supa
                .rpc("my_match_processing_feedback", params: P(p_match_ids: [id]))
                .execute().value
            return rows.first { $0.matchId == id }
        },
        job: { id in
            let rows: [MatchJob] = try await supa.from("jobs")
                .select("id,status,progress,user_message,kind")
                .eq("id", value: id.uuidString.lowercased())
                .execute().value
            return rows.first
        },
        minutes: {
            struct Row: Decodable { let minutes_balance: Double }
            let rows: [Row] = try await supa.rpc("my_processing_state").execute().value
            guard let row = rows.first else { throw URLError(.badServerResponse) }
            return Int(row.minutes_balance)
        },
        startRecut: { id, fresh in
            struct P: Encodable { let p_match_id: String; let p_fresh: Bool }
            do {
                return try await supa.rpc(
                    "start_recut", params: P(p_match_id: id.uuidString.lowercased(), p_fresh: fresh)
                ).execute().value
            } catch { throw CutAgainServerError.from(error) }
        },
        claimHandRecut: { id, marks, replace in
            struct P: Encodable {
                let p_match_id: String
                let p_marks: [HandCutSubmission]
                let p_replace: Bool
            }
            do {
                return try await supa.rpc(
                    "claim_hand_recut",
                    params: P(p_match_id: id.uuidString.lowercased(), p_marks: marks, p_replace: replace)
                ).execute().value
            } catch { throw CutAgainServerError.from(error) }
        },
        copyForRecut: { id in
            struct P: Encodable { let p_match_id: String }
            do {
                return try await supa.rpc(
                    "copy_match_for_recut", params: P(p_match_id: id.uuidString.lowercased())
                ).execute().value
            } catch { throw CutAgainServerError.from(error) }
        },
        process: { id, settings in await ProcessAPI.start(matchId: id, settings: settings) },
        claimAutoRecut: { id, settings in
            struct R: Decodable { let job_id: UUID? }
            do {
                let r: R = try await supa.rpc(
                    "claim_auto_recut", params: AutoRecutParams(matchId: id, settings: settings)
                ).execute().value
                return r.job_id
            } catch { throw CutAgainServerError.from(error) }
        }
    )
}

/// One processed match's More options: what the server allows, the job
/// working it, and the settings of the automatic cut.
@MainActor @Observable
final class CutAgainModel {
    let matchId: UUID
    private(set) var options: RecutOptions?
    private(set) var optionsFailed = false
    /// The job working this match (a Replace running on it), from the same
    /// feedback the raw page reads.
    private(set) var feedback: MatchProcessingFeedback?
    private(set) var job: MatchJob?
    private(set) var minutesBalance: Int?
    private(set) var needsMoreMinutes = false

    // The sheet's settings. They outlive a closed sheet, the way the raw
    // page keeps its trim while the card is folded.
    var trimStart: Double = 0
    var trimEnd: Double?
    var autoChoice: RecutChoiceState?
    /// Which of the two ways the player picked, if they have.
    var way = CutWayChoice()
    /// The switch on Mark the points yourself, once flipped.
    var markModeChoice: HandCutMode?
    private(set) var busy = false
    var error: String?
    var markError: String?
    var openingMarker = false
    /// The original, for the trim's preview: fetched once Automatically
    /// shows, then held, so a sheet opened again does not reload the
    /// picture (the web's MoreOptions holds its signed link the same way).
    private(set) var previewURL: URL?
    /// The last fetch came back empty: the trim shows its bar alone.
    private(set) var previewMissed = false
    @ObservationIgnored private var resolvingPreview = false

    /// The preview's box holds its place until the video is fetched or
    /// known to be missing, so it does not appear under the player's eyes.
    var previewLoading: Bool { previewURL == nil && !previewMissed }

    @ObservationIgnored private let client: CutAgainClient
    @ObservationIgnored private var pollTask: Task<Void, Never>?

    init(matchId: UUID, client: CutAgainClient = .live) {
        self.matchId = matchId
        self.client = client
    }

    /// A job other than the content check is queued or running here.
    var jobRunning: Bool {
        guard let feedback, feedback.jobKind != "content_check" else { return false }
        return feedback.jobStatus == "queued" || feedback.jobStatus == "processing"
    }

    /// What the running cut is doing, in the unprocessed page's words
    /// (MatchProcessingFeedback.runningLabel).
    var runningLabel: String? {
        MatchProcessingFeedback.runningLabel(feedback, jobKind: job?.kind, jobStatus: job?.status)
    }

    /// The lane the running cut waits on.
    private var lane: ProcessingServiceLane {
        feedback?.lane.flatMap(ProcessingServiceLane.init(rawValue:))
            ?? processingServiceLane(kind: feedback?.jobKind ?? job?.kind,
                                     clipLane: ProcessingServiceStore.shared.clipLane)
    }

    /// That lane is paused or down: said in place of the stage, as on the
    /// unprocessed page. None while the owner's phone is doing the cut.
    /// A re-cut running here is the player's own automatic Replace, which
    /// ends in the ordinary ready email, as a processed upload does (the
    /// web's MoreOptions reads it the same way).
    var serviceNotice: ProcessingAvailabilityNotice? {
        guard jobRunning, feedback?.onDevice != true else { return nil }
        let kind = feedback?.jobKind ?? job?.kind
        return ProcessingServiceStore.shared.notice(
            lane: lane,
            context: processingContext(kind: kind == "match_reprocess" ? "deadspace_cut" : kind))
    }

    var serviceState: String {
        ProcessingServiceStore.shared.state(for: lane).rawValue
    }

    func plan(handCutEnabled: Bool) -> MoreOptionsPlan {
        MoreOptionsPlan.make(options: options, handCutEnabled: handCutEnabled, jobRunning: jobRunning)
    }

    /// Everything the sheet reads. Cheap: two RPCs and the balance.
    func load() async {
        async let o = try? client.options(matchId)
        async let m = try? client.minutes()
        await refreshRunning()
        let fresh = await o
        optionsFailed = fresh == nil
        if let fresh {
            options = fresh
            // A choice already made survives a reload; its greying follows
            // the server.
            var next = RecutChoiceState.automatic(fresh)
            if let old = autoChoice { next.select(old.selected) }
            autoChoice = next
        }
        if let balance = await m { minutesBalance = balance }
        updatePolling()
    }

    /// The job working this match, and its progress.
    func refreshRunning() async {
        let wasRunning = jobRunning
        if let fresh = try? await client.feedback(matchId) {
            feedback = fresh
        } else {
            feedback = nil
        }
        if let id = feedback?.jobId, jobRunning {
            job = (try? await client.job(id)) ?? job
        } else {
            job = nil
        }
        // A cut on this match just finished: the page reads the match again
        // (a Replace goes live here), and the sheet its options.
        if wasRunning && !jobRunning {
            NotificationCenter.default.post(name: .matchProcessingVersionChanged, object: matchId)
            if let fresh = try? await client.options(matchId) { options = fresh }
        }
    }

    /// Fetch the preview's video through the page (the phone's own copy,
    /// else the original's link), unless it is already here or on its way.
    /// A miss is tried again the next time Automatically shows.
    func resolvePreview(_ resolve: () async -> URL?) async {
        guard previewURL == nil, !resolvingPreview else { return }
        resolvingPreview = true
        let url = await resolve()
        previewURL = url
        previewMissed = url == nil
        resolvingPreview = false
    }

    func recheckMinutes() async throws {
        minutesBalance = try await client.minutes()
        needsMoreMinutes = false
        error = nil
    }

    func startPolling() {
        guard pollTask == nil else { return }
        updatePolling()
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    /// Poll while a cut runs here, the raw page's eight seconds.
    private func updatePolling() {
        guard jobRunning else {
            pollTask?.cancel()
            pollTask = nil
            return
        }
        guard pollTask == nil else { return }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(8))
                guard let self, !Task.isCancelled else { return }
                await self.refreshRunning()
                if !self.jobRunning {
                    self.pollTask = nil
                    return
                }
            }
        }
    }

    // MARK: - Process again, automatically

    /// Replace: `claim_auto_recut` builds the new cut beside this one; the
    /// match keeps playing and this model polls the ordinary progress.
    /// Keep: a copy of this match, then the ordinary process call on the
    /// copy, which is then opened.
    ///
    /// Once the copy exists it is a real match: if processing it is then
    /// refused, the copy is still opened, where its own page offers the
    /// process again, rather than making a second copy from here.
    func processAutomatically(durationS: Double?) async -> ProcessAgainOutcome {
        guard !busy else { return .stayed }
        busy = true
        error = nil
        defer { busy = false }
        let trimmed = ProcessCharge.trimmed(durationS: durationS, trimStart: trimStart, trimEnd: trimEnd)
        let settings = ProcessSettings(
            trimStart: trimmed ? trimStart : nil,
            trimEnd: trimmed ? trimEnd : nil
        )
        if autoChoice?.replace == true {
            do {
                _ = try await client.claimAutoRecut(matchId, settings)
            } catch {
                let raw = CutAgainServerError.from(error).message
                let charge = raw.contains("insufficient_minutes") || raw.contains("queue_full")
                if raw.contains("insufficient_minutes") { needsMoreMinutes = true }
                switch CutAgainErrors.autoRecut(raw) {
                case .coachReview:
                    // Not an error to show: Replace greys with its reason
                    // and the choice is back on Keep, for the player to
                    // press again (the web's setAutoPick("keep")).
                    break
                case .message(let sentence):
                    self.error = sentence
                }
                if !charge, let fresh = try? await client.options(matchId) {
                    options = fresh
                    var next = RecutChoiceState.automatic(fresh)
                    if let old = autoChoice { next.select(old.selected) }
                    autoChoice = next
                }
                return .stayed
            }
            await refreshRunning()
            updatePolling()
            return .replacing
        }
        let copy: UUID
        do {
            copy = try await client.copyForRecut(matchId)
        } catch {
            self.error = CutAgainErrors.copy(CutAgainServerError.from(error).message)
            return .stayed
        }
        if case .refused(let code) = await client.process(copy, settings) {
            if code == "insufficient_minutes" { needsMoreMinutes = true }
            // The copy is opened anyway; its page says what to do next.
        }
        return .opened(copy)
    }

    // MARK: - Mark the points yourself

    /// The draft for marking again: the current cut's points, or the
    /// unsent draft to resume.
    func startRecut(fresh: Bool = false) async -> Result<StartRecutReply, CutAgainServerError> {
        do {
            return .success(try await client.startRecut(matchId, fresh))
        } catch {
            return .failure(CutAgainServerError.from(error))
        }
    }

    /// Cut the match, from the marker's review sheet.
    func claimHandRecut(_ marks: [HandCutMark], replace: Bool) async -> Result<HandRecutClaim, RecutRefusal> {
        do {
            let claim = try await client.claimHandRecut(matchId, HandCut.submittable(marks), replace)
            if replace {
                await refreshRunning()
                updatePolling()
            }
            return .success(claim)
        } catch {
            return .failure(CutAgainErrors.handRecut(CutAgainServerError.from(error).message))
        }
    }
}

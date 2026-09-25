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

/// The automatic cut's settings, as /api/process takes them.
struct ProcessSettings: Equatable {
    var trimStart: Double?
    var trimEnd: Double?
    var strictness: String
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
        struct Req: Encodable {
            let matchId: String
            let trimStartS: Double?
            let trimEndS: Double?
            let points = true
            let placement: Bool
            let strictness: String
        }
        struct Res: Decodable {
            let jobId: String?
            enum CodingKeys: String, CodingKey { case jobId = "job_id" }
        }
        do {
            let res: Res = try await API.post(
                "api/process",
                Req(
                    matchId: matchId.uuidString.lowercased(),
                    trimStartS: settings.trimStart, trimEndS: settings.trimEnd,
                    placement: placement, strictness: settings.strictness
                )
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
        case "insufficient_minutes": "Not enough minutes for this video."
        case "queue_full": "Your queue is full. Wait for a video to finish."
        default: CutAgainCopy.somethingWrong
        }
    }
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
    /// Phase 2 only (Replace under Automatically, in More options). The design names
    /// `claim_auto_recut(match, replace, trim, strictness)`; the contract
    /// has not pinned its parameters yet, so this is the design's reading.
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
            struct P: Encodable {
                let p_match_id: String
                let p_replace: Bool
                let p_trim_start_s: Double?
                let p_trim_end_s: Double?
                let p_strictness: String
            }
            struct R: Decodable { let job_id: UUID? }
            do {
                let r: R = try await supa.rpc("claim_auto_recut", params: P(
                    p_match_id: id.uuidString.lowercased(), p_replace: true,
                    p_trim_start_s: settings.trimStart, p_trim_end_s: settings.trimEnd,
                    p_strictness: settings.strictness
                )).execute().value
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
    var strictness = "normal"
    var autoChoice: RecutChoiceState?
    /// Which of the two rows is open: at most one.
    var ways = CutWayAccordion()
    var autoOpen: Bool {
        get { ways.isOpen(.automatic) }
        set { ways.set(.automatic, open: newValue) }
    }
    var markOpen: Bool {
        get { ways.isOpen(.byHand) }
        set { ways.set(.byHand, open: newValue) }
    }
    /// The switch on Mark the points yourself, once flipped.
    var markModeChoice: HandCutMode?
    private(set) var busy = false
    var error: String?
    var markError: String?
    var openingMarker = false

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
    var serviceNotice: ProcessingAvailabilityNotice? {
        guard jobRunning, feedback?.onDevice != true else { return nil }
        return ProcessingServiceStore.shared.notice(
            lane: lane, context: processingContext(kind: feedback?.jobKind ?? job?.kind))
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

    /// Keep: a copy of this match, then the ordinary process call on the
    /// copy. Returns the match to open (the copy), or nil when this match
    /// is the one now processing (Replace) or when it failed (`error` set).
    ///
    /// Once the copy exists it is a real match: if processing it is then
    /// refused, the copy is still opened, where its own page offers the
    /// process again, rather than making a second copy from here.
    func processAutomatically(durationS: Double?) async -> UUID? {
        guard !busy else { return nil }
        busy = true
        error = nil
        defer { busy = false }
        let trimmed = ProcessCharge.trimmed(durationS: durationS, trimStart: trimStart, trimEnd: trimEnd)
        let settings = ProcessSettings(
            trimStart: trimmed ? trimStart : nil,
            trimEnd: trimmed ? trimEnd : nil,
            strictness: strictness
        )
        if autoChoice?.replace == true {
            do {
                _ = try await client.claimAutoRecut(matchId, settings)
                await refreshRunning()
                updatePolling()
            } catch {
                self.error = CutAgainErrors.copy(CutAgainServerError.from(error).message)
            }
            return nil
        }
        let copy: UUID
        do {
            copy = try await client.copyForRecut(matchId)
        } catch {
            self.error = CutAgainErrors.copy(CutAgainServerError.from(error).message)
            return nil
        }
        if case .refused(let code) = await client.process(copy, settings) {
            if code == "insufficient_minutes" { needsMoreMinutes = true }
            // The copy is opened anyway; its page says what to do next.
        }
        return copy
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

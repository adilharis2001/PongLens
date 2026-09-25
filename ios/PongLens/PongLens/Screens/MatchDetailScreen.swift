import SwiftUI
import Supabase

/// The latest pipeline job for a match, polled while it runs — the same
/// row the web's raw view watches for its progress bar.
struct MatchJob: Decodable, Equatable {
    let id: UUID
    var status: String
    var progress: Int?
    var userMessage: String?
    var kind: String?

    /// Work the OWNER started. Every upload also queues an automatic
    /// content check against the same match, which is queued and running
    /// within seconds of the file landing — so a freshly uploaded video
    /// showed a progress bar before anyone pressed Process. The check is
    /// still fetched, because the same row carries the sentence explaining
    /// a video the check turns down.
    var running: Bool {
        kind != "content_check" && (status == "queued" || status == "processing")
    }

    enum CodingKeys: String, CodingKey {
        case id, status, progress, kind
        case userMessage = "user_message"
    }
}

struct MatchDetailSnapshot {
    let points: [MatchPoint]
    let videoURL: URL?
    let matchStructure: MatchStructure?
    var canonicalCommandsEnabled = false
    var canonicalScoreRead: CanonicalScoreReadExecution? = nil
}

/// Replace only transport in tests. The model owns version comparison,
/// coherent snapshot replacement and refusal of stale async responses.
struct MatchDetailClient {
    var match: (UUID) async throws -> MatchRow
    var snapshot: (MatchRow) async throws -> MatchDetailSnapshot

    static let live = MatchDetailClient(
        match: { id in
            try await supa.from("matches").select(MatchRow.detailSelect)
                .eq("id", value: id.uuidString.lowercased()).single().execute().value
        },
        snapshot: { match in
            let query = supa.from("points").select(MatchPoint.matchSelect)
                .eq("match_id", value: match.id.uuidString.lowercased())
            if let version = match.activeProcessingVersionId {
                query.eq("processing_version_id", value: version.uuidString.lowercased())
            }
            let points: [MatchPoint] = try await query.order("idx").execute().value
            struct Request: Encodable { let matchId: String; let preview: Bool?; let rawPreview: Bool?; let expectedVersionId: UUID? }
            struct Response: Decodable { let url: String? }
            let ready = match.status == .ready
            let response: Response = try await API.post("api/media-url", Request(
                matchId: match.id.uuidString.lowercased(), preview: ready ? true : nil, rawPreview: ready ? nil : true,
                expectedVersionId: ready ? match.activeProcessingVersionId : nil))
            let commandsEnabled: Bool =
                (try? await supa.rpc("canonical_score_commands_enabled").execute().value) ?? false
            let readersEnabled: Bool =
                (try? await supa.rpc("canonical_score_readers_enabled").execute().value) ?? false
            var canonicalScoreRead: CanonicalScoreReadExecution?
            if readersEnabled {
                struct ReaderRequest: Encodable { let p_match_id: String }
                let reader = CanonicalScoreReader { requested in
                    try await supa.rpc(
                        "canonical_score_snapshot_v1",
                        params: ReaderRequest(p_match_id: requested.uuidString.lowercased())
                    ).execute().value
                }
                canonicalScoreRead = await reader.load(
                    matchId: match.id,
                    expectedRevision: match.scoreRevision)
            }
            return MatchDetailSnapshot(
                points: points,
                videoURL: response.url.flatMap(URL.init),
                matchStructure: match.matchStructure,
                canonicalCommandsEnabled: commandsEnabled,
                canonicalScoreRead: canonicalScoreRead)
        }
    )
}

@MainActor @Observable
final class MatchDetailModel {
    @ObservationIgnored private let client: MatchDetailClient
    @ObservationIgnored private var refreshGeneration = 0
    /// The row is adopted with its point/media snapshot, never separately by
    /// a save callback. Same-version metadata can update without reloading it.
    private(set) var currentMatch: MatchRow?
    private(set) var loadedVersionId: UUID?
    private var loadedMatchId: UUID?
    private var loadedMatchStatus: MatchStatus?
    @ObservationIgnored private var canonicalCommands: CanonicalScoreCommandTransport?
    @ObservationIgnored var canonicalSplitRequestByChild: [UUID: UUID] = [:]
    private(set) var canonicalCommandsEnabled = false
    private(set) var canonicalScoreRead: CanonicalScoreReadExecution?
    private(set) var canonicalScoreReaderParity: CanonicalScoreReaderParity?

    init(client: MatchDetailClient? = nil) { self.client = client ?? .live }
    var points: [MatchPoint] = []
    var videoURL: URL?
    /// The game-end detector's evidence for this match (140/146), or nil
    /// when it has none — every match processed before the stage existed,
    /// and every one the detector refused.
    var matchStructure: MatchStructure?
    var loaded = false
    var error: String?
    var job: MatchJob?
    var processingFeedback: MatchProcessingFeedback?
    private var feedbackMatchId: UUID?
    var minutesBalance: Int?
    var needsMoreMinutes = false
    /// The demo match, seen by anyone but its owner. Scoring it moves the
    /// score, the games, the rotation and the cards on screen exactly as
    /// it would on your own match, and stops at the phone: nothing is
    /// sent, so there is no write for the database to refuse and no error
    /// to explain. The screen sets this once it knows who is reading.
    var demo = false

    /// Scoring commands read from the model when their turn begins. The
    /// queue is per point, so two quick corrections cannot finish out of
    /// order while an unrelated point remains free to save independently.
    @ObservationIgnored @MainActor private lazy var scorerCommands = ScorerCommands(
        read: { [weak self] id in
            self?.points.first(where: { $0.id == id }).map(ScorerCommandPoint.init)
        },
        apply: { [weak self] id, state in
            guard let self, let i = points.firstIndex(where: { $0.id == id }) else { return }
            points[i].confirmedWinner = state.winner
            points[i].isLet = state.isLet
            points[i].scoredAtCutS = state.scoredAt
        },
        persist: { [weak self] id, state in
            guard let self else { return false }
            if demo { return true }
            let skipKind = canonicalSkipCommandKind(
                points.first(where: { $0.id == id })?.confirmedHow)
            let outcome = state.winner?.rawValue ?? (state.isLet ? skipKind : "clear")
            let result = await canonicalCommand(
                "set_point_outcome_v2",
                args: [
                    "p_point_id": .uuid(id),
                    "p_outcome": .string(outcome),
                    "p_confirmed_how": state.isLet ? .string(skipKind) : .null,
                    "p_scored_at_cut_s": state.scoredAt.map(CanonicalJSON.number) ?? .null,
                ]
            ) {
                do {
                    try await supa
                        .from("points")
                        .update([
                            "confirmed_winner": state.winner.map { .string($0.rawValue) } ?? .null,
                            "is_let": .bool(state.isLet),
                            "scored_at_cut_s": state.scoredAt.map { .double($0) } ?? .null,
                        ] as [String: AnyJSON])
                        .eq("id", value: id.uuidString.lowercased())
                        .execute()
                    return true
                } catch { return false }
            }
            switch result {
            case .canonical: return true
            case .legacy(let saved): return saved
            case .conflict(let snapshot):
                reconcileCanonical(snapshot)
                return true
            case .rejected, .transportError: return false
            }
        }
    )

    func canonicalCommand<T>(
        _ name: String,
        args: [String: CanonicalJSON],
        legacy: () async -> T
    ) async -> CanonicalScoreExecution<T> {
        guard let canonicalCommands else { return .legacy(await legacy()) }
        return await canonicalCommands.execute(name, args: args, legacy: legacy)
    }

    func reconcileCanonical(_ snapshot: CanonicalScoreSnapshot) {
        let byId = Dictionary(uniqueKeysWithValues: snapshot.points.map { ($0.pointId, $0) })
        for index in points.indices {
            guard let state = byId[points[index].id] else { continue }
            if let winner = state.confirmedWinner.flatMap(Winner.init(rawValue:)) {
                points[index].confirmedWinner = winner
                points[index].isLet = false
            } else if let skip = state.skipKind {
                points[index].confirmedWinner = nil
                points[index].confirmedHow = skip
                points[index].isLet = true
                points[index].scoredAtCutS = nil
            } else {
                points[index].confirmedWinner = nil
                points[index].confirmedHow = nil
                points[index].isLet = false
                points[index].scoredAtCutS = nil
            }
        }
    }

    var jobRunning: Bool { job?.running ?? false }

    /// The visible timeline: non-deleted, ordered by source time (idx tiebreak).
    var visible: [MatchPoint] {
        points
            .filter { !$0.deleted }
            .sorted { a, b in
                if let ta = a.t0, let tb = b.t0, ta != tb { return ta < tb }
                return a.idx < b.idx
            }
    }

    /// A clip is stale while the worker recuts it. The chip strip and the
    /// point view both say so; this is what takes the word back down.
    var hasPendingClips: Bool { points.contains { $0.edited && !$0.deleted } }

    private var clipPoll: Task<Void, Never>?
    /// The on-device re-cut loop (DeviceReclip.swift): one pass at a time,
    /// with one more queued if an edit lands while it runs.
    var deviceRecutRunning = false
    var deviceRecutAgain = false

    /// While clips regenerate, poll so "updating" resolves into the fresh
    /// clip without a manual refresh. t0/t1 truth lives in Postgres; the
    /// video is the only thing arriving late. Stops by itself once nothing
    /// is pending, and never runs twice.
    func startClipPoll(_ matchId: UUID) {
        guard clipPoll == nil, hasPendingClips else { return }
        clipPoll = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 8_000_000_000)
                guard let self, !Task.isCancelled else { return }
                guard self.hasPendingClips else {
                    self.clipPoll = nil
                    return
                }
                await self.refreshClipState(matchId)
            }
            self?.clipPoll = nil
        }
    }

    func stopClipPoll() {
        clipPoll?.cancel()
        clipPoll = nil
    }

    /// Fetches the new file's path and the cut anchor as well as the
    /// timing: without clip_path a re-cut stayed invisible until the match
    /// was reopened (Share said the rally had no video, Starred stayed
    /// blank), and without cut_t0 an Adjust made on another device kept
    /// the old anchor here.
    private func refreshClipState(_ matchId: UUID) async {
        let generation = refreshGeneration
        struct ClipRow: Decodable {
            let id: UUID
            let t0: Double?
            let t1: Double?
            let cutT0: Double?
            let clipPath: String?
            let edited: Bool
            let deleted: Bool
            let tightStart: Bool
            let tightEnd: Bool
            enum CodingKeys: String, CodingKey {
                case id, t0, t1, edited, deleted
                case cutT0 = "cut_t0"
                case clipPath = "clip_path"
                case tightStart = "tight_start"
                case tightEnd = "tight_end"
            }
        }
        let fresh: [ClipRow]? = try? await supa
            .from("points")
            .select("id, t0, t1, cut_t0, clip_path, edited, deleted, tight_start, tight_end")
            .eq("match_id", value: matchId.uuidString.lowercased())
            .execute()
            .value
        guard let fresh, generation == refreshGeneration else { return }
        let byId = Dictionary(uniqueKeysWithValues: fresh.map { ($0.id, $0) })
        for i in points.indices {
            guard let row = byId[points[i].id] else { continue }
            points[i].t0 = row.t0
            points[i].t1 = row.t1
            points[i].cutT0 = row.cutT0
            points[i].clipPath = row.clipPath
            points[i].edited = row.edited
            points[i].deleted = row.deleted
            points[i].tightStart = row.tightStart
            points[i].tightEnd = row.tightEnd
        }
    }

    @discardableResult
    func load(_ match: MatchRow) async -> MatchRow? {
        await refetchMatch(match.id)
    }

    /// No media request or point replacement for ordinary issue polling.
    /// Publish and restore both replace the whole snapshot, not annotations.
    @discardableResult
    func refreshActiveVersion(_ matchId: UUID) async -> MatchRow? {
        refreshGeneration += 1
        let generation = refreshGeneration
        do {
            var fresh = try await client.match(matchId)
            for _ in 0..<3 {
                guard generation == refreshGeneration, !Task.isCancelled else { return nil }
                if loadedMatchId == matchId, loadedVersionId == fresh.activeProcessingVersionId, loadedMatchStatus == fresh.status {
                    currentMatch = fresh
                    error = nil
                    return nil
                }
                let snapshot: MatchDetailSnapshot
                do {
                    snapshot = try await client.snapshot(fresh)
                } catch let failure as APIError {
                    // The signer may see a publication after our point read.
                    // Refetch the canonical row before retrying; never attach
                    // that newer cut to the point snapshot already fetched.
                    if case .http(409, _) = failure {
                        let latest = try await client.match(matchId)
                        if latest.activeProcessingVersionId != fresh.activeProcessingVersionId {
                            fresh = latest
                            continue
                        }
                    }
                    throw failure
                }
                let verified = try await client.match(matchId)
                guard generation == refreshGeneration, !Task.isCancelled else { return nil }
                if verified.activeProcessingVersionId != fresh.activeProcessingVersionId {
                    fresh = verified
                    continue
                }
                stopClipPoll()
                points = snapshot.points
                videoURL = snapshot.videoURL
                matchStructure = snapshot.matchStructure
                canonicalCommands = CanonicalScoreCommandTransport(
                    matchId: matchId,
                    revision: fresh.scoreRevision ?? 0,
                    enabled: snapshot.canonicalCommandsEnabled
                ) { name, params in
                    try await supa.rpc(name, params: params).execute().value
                }
                canonicalCommandsEnabled = snapshot.canonicalCommandsEnabled
                canonicalScoreRead = snapshot.canonicalScoreRead
                canonicalScoreReaderParity = nil
                if case .canonical(let canonical)? = snapshot.canonicalScoreRead {
                    let parity = compareCanonicalScoreReader(
                        canonical,
                        firstServer: fresh.firstServer.flatMap(Winner.init(rawValue:)),
                        points: snapshot.points.map(CanonicalReaderLegacyPoint.init))
                    canonicalScoreReaderParity = parity
                    print(
                        "canonical score reader parity revision=\(parity.revision) "
                        + "matches=\(parity.matches) "
                        + "match_fields=\(parity.mismatchedMatchFields) "
                        + "points=\(parity.mismatchedPoints) "
                        + "canonical_count=\(parity.canonicalPointCount) "
                        + "legacy_count=\(parity.legacyPointCount)")
                } else if case .legacy(let reason)? = snapshot.canonicalScoreRead,
                          reason != "not_enabled" {
                    print("canonical score reader fallback reason=\(reason)")
                }
                loadedVersionId = fresh.activeProcessingVersionId
                loadedMatchId = matchId
                loadedMatchStatus = fresh.status
                currentMatch = fresh
                loaded = true
                error = nil
                startClipPoll(matchId)
                return fresh
            }
            error = "This match changed while loading. Try again."
        } catch {
            if generation == refreshGeneration {
                self.error = "Couldn't load this match. Try again."
            }
        }
        loaded = true
        return nil
    }

    // MARK: - Raw match: job state, balance, processing

    private static let jobSelect = "id,status,progress,user_message,kind"

    /// The newest job for this match plus the minutes balance — what the
    /// raw view needs to say "Processing", "failed", or "Process · N min".
    func loadRawState(_ match: MatchRow, isOwner: Bool) async {
        guard isOwner else {
            feedbackMatchId = nil
            processingFeedback = nil
            job = nil
            minutesBalance = nil
            return
        }
        feedbackMatchId = match.id
        await refreshFeedback()
        if let primaryId = processingFeedback?.jobId {
            let jobs: [MatchJob]? = try? await supa.from("jobs").select(Self.jobSelect)
                .eq("id", value: primaryId.uuidString.lowercased()).execute().value
            job = jobs?.first
        } else {
            let active: [MatchJob]? = try? await supa.from("jobs").select(Self.jobSelect)
                .eq("options->>match_id", value: match.id.uuidString.lowercased())
                .in("kind", values: ["deadspace_cut", "youtube_import", "hand_cut"])
                .in("status", values: ["queued", "processing"])
                .order("created_at", ascending: false).limit(1).execute().value
            job = active?.first
            if job == nil {
                let jobs: [MatchJob]? = try? await supa.from("jobs").select(Self.jobSelect)
                    .eq("options->>match_id", value: match.id.uuidString.lowercased())
                    .in("kind", values: ["deadspace_cut", "youtube_import", "hand_cut"])
                    .order("created_at", ascending: false).limit(1).execute().value
                job = jobs?.first
            }
            if job == nil {
                let checks: [MatchJob]? = try? await supa.from("jobs").select(Self.jobSelect)
                    .eq("options->>match_id", value: match.id.uuidString.lowercased())
                    .eq("kind", value: "content_check")
                    .order("created_at", ascending: false).limit(1).execute().value
                job = checks?.first
            }
        }

        struct StateRow: Decodable {
            let minutesBalance: Double?
            enum CodingKeys: String, CodingKey { case minutesBalance = "minutes_balance" }
        }
        let state: [StateRow]? = try? await supa
            .rpc("my_processing_state").execute().value
        minutesBalance = state?.first?.minutesBalance.map(Int.init)
    }

    private func refreshFeedback() async {
        guard let feedbackMatchId else { return }
        struct Request: Encodable { let p_match_ids: [UUID] }
        let rows: [MatchProcessingFeedback]? = try? await supa
            .rpc("my_match_processing_feedback", params: Request(p_match_ids: [feedbackMatchId]))
            .execute().value
        processingFeedback = rows?.first
    }

    var feedbackActive: Bool {
        jobRunning || job?.status == "queued" || job?.status == "processing"
            || processingFeedback?.jobStatus == "queued" || processingFeedback?.jobStatus == "processing"
    }

    func refreshJob() async {
        await refreshFeedback()
        guard let currentId = processingFeedback?.jobId ?? job?.id else { return }
        let jobs: [MatchJob]? = try? await supa
            .from("jobs")
            .select(Self.jobSelect)
            .eq("id", value: currentId.uuidString.lowercased())
            .execute()
            .value
        if let fresh = jobs?.first {
            job = fresh
        }
    }

    func refreshMinutes() async throws {
        struct Row: Decodable { let minutes_balance: Double }
        let rows: [Row] = try await supa.rpc("my_processing_state").execute().value
        guard let row = rows.first else { throw URLError(.badServerResponse) }
        minutesBalance = Int(row.minutes_balance)
        needsMoreMinutes = false
    }

    func refetchMatch(_ id: UUID) async -> MatchRow? {
        await refreshActiveVersion(id)
        // If a changed version cannot load, keep returning the coherent
        // previous row, not the newer row that failed snapshot adoption.
        return currentMatch?.id == id ? currentMatch : nil
    }

    /// Spend minutes on the full video. Returns nil on success (the job is
    /// set), or the sentence to show.
    func process(
        _ match: MatchRow, placement: Bool,
        trimStart: Double?, trimEnd: Double?, strictness: String
    ) async -> String? {
        let result = await ProcessAPI.start(
            matchId: match.id,
            settings: ProcessSettings(trimStart: trimStart, trimEnd: trimEnd, strictness: strictness),
            placement: placement
        )
        switch result {
        case .started(let jobId):
            if let jobId {
                // The job the owner just asked for, so it counts as running
                // straight away rather than waiting for the first poll.
                job = MatchJob(id: jobId, status: "queued", progress: 0,
                               userMessage: nil, kind: "deadspace_cut")
            }
            return nil
        case .refused(let code):
            if code == "insufficient_minutes" { needsMoreMinutes = true }
            return ProcessAPI.message(code)
        }
    }

    /// Signed download link for the full cut (attachment disposition).
    func downloadURL(_ match: MatchRow) async -> URL? {
        struct Req: Encodable { let matchId: String }
        struct Res: Decodable { let url: String? }
        let res: Res? = try? await API.post(
            "api/media-url", Req(matchId: match.id.uuidString.lowercased())
        )
        return res?.url.flatMap(URL.init)
    }

    /// Streamable link to the ORIGINAL upload — the file as it came off
    /// the phone, before the dead time was cut out. Offered when the cut
    /// came out poor.
    ///
    /// Minted on tap rather than alongside the cut in `load`: it is a
    /// six-hour presigned URL, and signing one on every open of every
    /// match, for a control most people never press, buys nothing.
    ///
    /// `.gone` means the file genuinely is — only possible on matches
    /// processed before mid-August 2026, since the retention sweep never
    /// expires an original a library row still points at. `.failed` is
    /// the request itself not getting an answer, which is a different
    /// sentence: this used to fold both into nil, and a phone with no
    /// working session was told its original was "no longer available".
    func originalLink(_ match: MatchRow) async -> OriginalLink {
        struct Req: Encodable { let matchId: String; let rawPreview: Bool }
        struct Res: Decodable { let url: String? }
        do {
            let res: Res = try await API.post(
                "api/media-url",
                Req(matchId: match.id.uuidString.lowercased(), rawPreview: true)
            )
            if let url = res.url.flatMap(URL.init) { return .url(url) }
            return .gone
        } catch {
            return .failed
        }
    }

    /// What asking for the original upload got back.
    enum OriginalLink {
        case url(URL)
        /// The route answered, and the file is not there any more.
        case gone
        /// No answer: offline, signed out, or the server had a bad moment.
        case failed
    }

    /// Generic optimistic patch for non-scorekeeper point controls. Scorer
    /// writes use their per-point command queue below; existing star, delete
    /// and bulk-edit callers keep this independent behavior.
    @discardableResult
    func patch(
        _ point: MatchPoint,
        fields: [String: AnyJSON],
        apply: (inout MatchPoint) -> Void
    ) async -> Bool {
        guard let i = points.firstIndex(where: { $0.id == point.id }) else { return false }
        let before = points[i]
        var updated = before
        apply(&updated)
        points[i] = updated
        do {
            try await supa
                .from("points")
                .update(fields)
                .eq("id", value: point.id.uuidString.lowercased())
                .execute()
            return true
        } catch {
            points[i] = before
            return false
        }
    }

    /// Winner tap: toggles — tapping the side already shown clears it.
    /// One atomic patch; is_let and a winner never coexist (DB constraint).
    /// `scoredAt` is stamped only from Keep score's flowing pass, and only
    /// when SETTING a winner — the web's exact rule.
    /// `force` is the Why bubble's contract: it means "they won it, and here
    /// is why I lost", so on a point already theirs it re-affirms instead of
    /// toggling the score off. Saying why must never cost you the score.
    @MainActor
    func queueWinner(
        _ point: MatchPoint, _ side: Winner, scoredAt: Double? = nil,
        observationTiming: ScorerTimingGuard? = nil, force: Bool = false
    ) -> Task<ScorerCommandReceipt?, Never> {
        let stamp = scoredAt.flatMap { value in
            value.isFinite ? ((value * 100).rounded()) / 100 : nil
        }
        return scorerCommands.beginWinner(
            point.id, side: side, observation: stamp,
            observationTiming: observationTiming, force: force
        )
    }

    @MainActor @discardableResult
    func tapWinner(
        _ point: MatchPoint, _ side: Winner, scoredAt: Double? = nil,
        observationTiming: ScorerTimingGuard? = nil, force: Bool = false
    ) async -> ScorerCommandReceipt? {
        await queueWinner(
            point, side, scoredAt: scoredAt,
            observationTiming: observationTiming, force: force
        ).value
    }

    /// Score Undo restores only the fields named in its receipt. Starred,
    /// deleted and every structural field may have changed independently.
    @MainActor @discardableResult
    func restoreScorer(_ receipt: ScorerCommandReceipt) async -> ScorerCommandReceipt? {
        await scorerCommands.restore(receipt)
    }

    /// Reserve Undo immediately, while the original receipt is still
    /// pending, so a later score cannot enter this point's queue ahead of it.
    @MainActor
    func queueRestore(
        _ pointId: UUID,
        after pending: Task<ScorerCommandReceipt?, Never>
    ) -> Task<ScorerCommandReceipt?, Never> {
        scorerCommands.beginRestore(pointId, after: pending)
    }

    /// Undo support: writes a set of scorer fields back in one patch. Takes
    /// the values rather than a whole point, because the undo stack stores
    /// what CHANGED — a snapshot taken before the write would also carry
    /// every field the write never touched, and restoring those would quietly
    /// revert edits made since.
    func restoreScorerFields(
        _ point: MatchPoint, winner: Winner?, isLet: Bool, scoredAt: Double?,
        deleted: Bool, starred: Bool
    ) async {
        guard let current = points.first(where: { $0.id == point.id }) else { return }
        if current.confirmedWinner != winner || current.isLet != isLet ||
            current.scoredAtCutS != scoredAt {
            _ = await saveCanonicalOutcome(
                current,
                winner: winner,
                confirmedHow: isLet ? canonicalSkipReason(current.confirmedHow) : current.confirmedHow,
                isLet: isLet,
                scoredAt: scoredAt)
        }
        if let afterScore = points.first(where: { $0.id == point.id }),
           afterScore.deleted != deleted {
            _ = await setPointVisibility(afterScore, visible: !deleted)
        }
        if let afterVisibility = points.first(where: { $0.id == point.id }),
           afterVisibility.starred != starred {
            _ = await patch(afterVisibility, fields: ["starred": .bool(starred)]) {
                $0.starred = starred
            }
        }
    }

    @MainActor @discardableResult
    func tapSkip(_ point: MatchPoint) async -> ScorerCommandReceipt? {
        await queueSkip(point).value
    }

    @MainActor
    func queueSkip(_ point: MatchPoint) -> Task<ScorerCommandReceipt?, Never> {
        scorerCommands.beginSkip(point.id)
    }

    func toggleStar(_ point: MatchPoint) async {
        await patch(point, fields: ["starred": .bool(!point.starred)]) {
            $0.starred.toggle()
        }
    }

    func softDelete(_ point: MatchPoint) async {
        _ = await setPointVisibility(point, visible: false)
    }

    @discardableResult
    func setPointVisibility(_ point: MatchPoint, visible: Bool) async -> Bool {
        guard let index = points.firstIndex(where: { $0.id == point.id }) else { return false }
        let before = points[index].deleted
        points[index].deleted = !visible
        let result = await canonicalCommand(
            "set_point_visibility_v2",
            args: ["p_point_id": .uuid(point.id), "p_visible": .bool(visible)]
        ) {
            do {
                try await supa.from("points").update(["deleted": !visible])
                    .eq("id", value: point.id.uuidString.lowercased()).execute()
                return true
            } catch { return false }
        }
        switch result {
        case .canonical, .legacy(true): return true
        case .conflict(let snapshot):
            points[index].deleted = before
            reconcileCanonical(snapshot)
            return false
        case .legacy(false), .rejected, .transportError:
            points[index].deleted = before
            return false
        }
    }

    func setFirstServer(matchId: UUID, value: Winner) async -> Bool {
        let result = await canonicalCommand(
            "set_first_server_v2",
            args: ["p_first_server": .string(value.rawValue)]
        ) {
            do {
                try await supa.from("matches").update([
                    "first_server": AnyJSON.string(value.rawValue),
                    "first_server_source": AnyJSON.string("user"),
                ]).eq("id", value: matchId.uuidString.lowercased()).execute()
                return true
            } catch { return false }
        }
        switch result {
        case .canonical, .legacy(true): return true
        case .conflict(let snapshot): reconcileCanonical(snapshot); return false
        case .legacy(false), .rejected, .transportError: return false
        }
    }
}

enum WinnerFilter: String, CaseIterable {
    case anyone = "Anyone", me = "I won", them = "They won"
}

enum OnlyFilter: String, CaseIterable {
    case everything = "Everything", starred = "Starred", skipped = "Skipped"
}

struct MatchDetailScreen: View {
    let match: MatchRow
    /// The web's ?p= deep link: when a journal card names a point, its
    /// sheet opens as soon as the points are in.
    var openPointId: UUID?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @Environment(Router.self) private var router
    @Environment(AppState.self) private var app
    @Environment(LibraryStore.self) private var library
    @State private var model = MatchDetailModel()
    @State private var notesStore = NotesStore()
    @State private var tagsStore = TagsStore()
    @State private var reasonsStore = CustomReasonsStore()
    @State private var scrolledPastHeader = false
    @State private var tagPickerPoint: MatchPoint?
    struct PlayerRequest: Identifiable {
        let id = UUID()
        let url: URL
        let startAt: Double?
        let mode: PlayerMode
        /// Which file this URL points at. `.original` stands down every
        /// position the player knows, because they are all cut seconds
        /// and the original does not share that clock. Defaulted so the
        /// six existing call sites keep saying what they already said.
        var source: PlayerSource = .cut
        /// Mark the points: the session the takeover drives in `.mark`.
        var marker: HandCutMarker? = nil
    }

    @State private var playerRequest: PlayerRequest?
    /// Mark the points yourself: this match's draft, and whether the
    /// account may hand cut at all.
    @State private var handCut = HandCutDraftStore()
    /// "Automatically" is open inside Break it into points.
    @State private var autoOpen = false
    /// "Mark the points yourself" is open beside it, the same way.
    @State private var markOpen = false
    /// The Score switch on that row, once the player has flipped it. Nil
    /// means untouched: the marker opens as the draft (or its default) says.
    @State private var markModeChoice: HandCutMode?
    /// The marker's video link is being minted.
    @State private var openingMarker = false
    /// The Original pill is mid-flight (the presigned URL is a round trip).
    @State private var openingOriginal = false
    /// The original could not be reached. Only possible on matches
    /// processed before mid-August 2026: since then the retention sweep
    /// skips any upload a library row still points at.
    @State private var originalMissing = false
    /// The request for the original got no answer — a different sentence
    /// from the file being gone.
    @State private var originalFailed = false
    @State private var pointSheetOpen = false
    /// Where Keep score should resume when a point opened FROM the pad is
    /// closed. Nil for a point opened from the list, which has no pad to
    /// come back to.
    @State private var scoreReturnPoint: Double?
    @State private var pointSheetIndex = 0
    @State private var pointsExpanded = false
    /// A game pill's target when the list had to expand first: the jump
    /// finishes when that row appears (see `jump`).
    @State private var pendingJump: UUID?
    @State private var showGamesDetail = false
    /// The spoken score's own disclosure, for the unscored state where it
    /// stands in the score slot.
    @State private var showSpokenDetail = false
    /// Editing the spoken score after the fact. Local override so a save
    /// shows immediately without refetching the row.
    @State private var spokenOverride: [SpokenGameScore]??
    @State private var spokenSheetOpen = false
    @State private var filtersOpen = false
    @State private var winnerFilter: WinnerFilter = .anyone
    @State private var onlyFilter: OnlyFilter = .everything
    @State private var watchKick = 0
    // Trim window in raw-video seconds (web RawMatchView's trimStart /
    // trimEnd). End nil = untouched = the whole video.
    @State private var trimStart: Double = 0
    @State private var trimEnd: Double?
    @State private var strictness = "normal"
    @State private var processBusy = false
    @State private var processError: String?
    /// Is the process card open? Closed on a fresh upload, open on a
    /// failed one — see processCard.
    @State private var processOpen = false
    @State private var detailsOpen = false
    @State private var shareOpen = false
    @State private var deleteAsk = false
    @State private var deleting = false
    /// The detected side-change marker the owner tapped in the point list.
    @State private var sideChangeSheet: MatchPoint?
    /// More options on a processed match (cut again): what the server
    /// allows, the cut running on it, the automatic cut's settings. Owner
    /// only; nil everywhere else.
    @State private var cutAgain: CutAgainModel?
    /// The marker a More options sheet prepared, raised once it has gone.
    @State private var pendingRecutPlayer: PlayerRequest?
    /// The match to open once the marker has closed: Keep's new match.
    @State private var pendingOpenMatch: UUID?

    private let pointsPreview = 10

    private var current: MatchRow { model.currentMatch ?? match }

    /// Spoken rows to display: the local edit if one happened, else the
    /// row's. Empty array means "had them, all removed".
    private var spokenRows: [SpokenGameScore] {
        (spokenOverride ?? current.spokenScores) ?? []
    }

    /// The scored result owns the slot whenever it exists; spoken only
    /// stands in while it does not.
    private var scoredOwnsSlot: Bool {
        tracksServe && score.confirmedCount > 0
    }

    /// Does a score mean anything here — tracksServe on the LIVE type, so
    /// changing it in Match details reacts without a reload. Gates every
    /// score-shaped thing on this screen: the games total, the game
    /// checkpoints and dividers, and the You/Them/Skip pills on the rows.
    private var tracksServe: Bool { MatchTitle.tracksServe(current.matchType) }

    private var isOwner: Bool { app.userId == current.userId }

    /// Everything a coach-style viewer may normally do (a note, a sketch,
    /// the download) is off on the sample match: it is ours, and every
    /// account is looking at the same one.
    private var canWrite: Bool { isOwner || !SampleMatch.isSample(current) }

    /// Reading the sample: Tools are shown but dead, and the two players
    /// stay unnamed.
    private var sampleViewer: Bool { !isOwner && SampleMatch.isSample(current) }
    /// Player 1 / Player 2 in the app's own "me / them" order, on the
    /// sample match only. Nil everywhere else, where the real names and
    /// the owner's or the coach's wording apply.
    private var sampleLabels: (you: String, them: String)? {
        sampleViewer ? SampleMatch.labels(userSide: current.userSide) : nil
    }

    private var pad: ClipPad {
        clipPad(strictness: nil, stored: current.clipPads)
    }

    private var score: MatchScore {
        computeMatchScore(model.visible.map {
            PointRow(
                id: $0.id, matchId: $0.matchId, idx: $0.idx, t0: $0.t0,
                confirmedWinner: $0.confirmedWinner, isLet: $0.isLet,
                deleted: $0.deleted, gameEndOverride: $0.gameEndOverride,
                gameWinnerOverride: $0.gameWinnerOverride
            )
        })
    }


    private var filtersActive: Bool {
        winnerFilter != .anyone || onlyFilter != .everything
    }

    /// Rotation-derived servers for every visible point (serving.ts port).
    private var serving: [UUID: ServeInfo] {
        computeServing(
            model.visible,
            firstServer: current.firstServer.flatMap(Winner.init(rawValue:))
        )
    }

    /// Where the video says the players swapped ends and the score has
    /// not said so yet (140/146). Marker only — never folded into the
    /// boundary walk, so nothing about the score changes. Fades as the
    /// match gets scored: a real boundary within three rallies silences
    /// its detection. See Core/SideChanges.swift.
    private var sideChanges: [UUID: SideChanges.Marker] {
        SideChanges.byPoint(
            evidence: model.matchStructure,
            visiblePoints: model.visible,
            boundaryAfter: Set(score.boundaryAfter.keys),
            enabled: app.gameEndDetection,
            scoredType: tracksServe
        )
    }

    /// The video saw them swap ends and the score has not said so.
    /// Dashed, because the solid line means "a game ended here and the
    /// score proves it" and this is a different claim.
    @ViewBuilder
    private func sideChangeDivider(_ point: MatchPoint) -> some View {
        // fixedSize, or the two flexible rules either side squeeze the
        // capsule until "Players changed ends" wraps onto two lines. The
        // text takes what it needs and the rules take the rest.
        let label = Text(SideChanges.label)
            .font(.plCaption)
            .foregroundStyle(isOwner ? PL.text400 : PL.text500)
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .overlay(Capsule().strokeBorder(PL.edge, style: PLDash.style))
        let row = HStack(spacing: 8) {
            PLDash().stroke(PL.edge, style: PLDash.style)
                .frame(height: 1).frame(maxWidth: .infinity)
            label
            PLDash().stroke(PL.edge, style: PLDash.style)
                .frame(height: 1).frame(maxWidth: .infinity)
        }
        if isOwner {
            Button { sideChangeSheet = point } label: { row }
                .buttonStyle(.plain)
                .padding(.vertical, 2)
                .accessibilityLabel(
                    "The players changed ends here — tap to answer")
        } else {
            row.padding(.vertical, 2)
        }
    }

    private var filteredPoints: [MatchPoint] {
        model.visible.filter { p in
            switch winnerFilter {
            case .anyone: break
            case .me: if p.confirmedWinner != .user { return false }
            case .them: if p.confirmedWinner != .opponent { return false }
            }
            switch onlyFilter {
            case .everything: break
            case .starred: if !p.starred { return false }
            case .skipped: if !p.isLet { return false }
            }
            return true
        }
    }

    /// 0-based game each visible point belongs to — players change ends
    /// every game, so the aggregate needs this to orient landings.
    private var gameIndexByPoint: [UUID: Int] {
        var result: [UUID: Int] = [:]
        var game = 0
        for p in model.visible {
            result[p.id] = game
            if score.boundaryAfter[p.id] != nil { game += 1 }
        }
        return result
    }

    /// The aggregate exists once placement ran or any point carries data.
    /// A coach sees it too (Adil, 2026-09-02): the maps are what a share
    /// link shows, and generation still lives in the owner's Tools.
    private var showPlacementAggregate: Bool {
        current.placementStatus == "ready"
            || model.visible.contains { $0.placement != nil }
    }

    /// First visible point of each game, for the checkpoint chips.
    private var gameStarts: [(game: Int, id: UUID)] {
        var starts: [(Int, UUID)] = []
        var game = 1
        var atStart = true
        for p in model.visible {
            if atStart {
                starts.append((game, p.id))
                atStart = false
            }
            if score.boundaryAfter[p.id] != nil {
                game += 1
                atStart = true
            }
        }
        return starts
    }

    var body: some View {
        let head = MatchTitle.head(for: current)
        let parts = MatchTitle.parts(
            opponentName: head.opponent, venue: head.venue,
            playedAt: current.playedAt, matchType: current.matchType
        )
        ZStack {
            ArenaBackground()
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        HStack {
                            Button {
                                dismiss()
                            } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: "chevron.left")
                                        .font(.system(size: 12, weight: .semibold))
                                    // A coach came from the student's
                                    // screen, not a library of their own.
                                    Text(isOwner ? "Matches" : "Back")
                                }
                            }
                            .buttonStyle(PLSecondaryButtonStyle())
                            Spacer()
                            if isOwner {
                                matchMenu
                            }
                        }
                        .id("match-top")

                        header(parts)

                        if let error = model.error {
                            Text(error)
                                .font(.plCaption)
                                .foregroundStyle(PL.dangerText)
                                .plCard(padding: 14)
                        }

                        // A rejected upload has no file left to show, so
                        // the hero would be an empty 16:9 box labelled
                        // "Original video". rawSection carries the reason
                        // instead.
                        if !sourceGone {
                            hero
                        }

                        // A coach never sees Tools, so the two rows that
                        // are not owner actions get their own card here.
                        if !isOwner, !sampleViewer {
                            VStack(spacing: 0) {
                                ProcessingToolRow(match: current)
                                Rectangle().fill(PL.edge.opacity(0.6)).frame(height: 1).padding(.leading, 16)
                                FeedbackBoardToolRow(match: current)
                            }
                            .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                                    .strokeBorder(PL.edge, lineWidth: 1)
                            )
                        }

                        if current.status == .ready {
                            // A new cut replacing this one: the match plays
                            // on as it is, and the ordinary progress says
                            // where the new cut has got to.
                            if isOwner, let cutAgain, cutAgain.jobRunning {
                                recutProgress(cutAgain)
                            }
                            // Coach viewers never see Tools — every row is
                            // an owner action, matching the web.
                            if isOwner || sampleViewer {
                                ToolsSection(
                                    match: current,
                                    model: model,
                                    score: score,
                                    onOpenPlayer: {
                                        if let url = model.videoURL {
                                            playerRequest = PlayerRequest(url: url, startAt: nil, mode: .score)
                                        }
                                    },
                                    onScrollToNotes: {
                                        withAnimation { proxy.scrollTo("overall-notes", anchor: .top) }
                                    },
                                    onScrollToAnalysis: {
                                        withAnimation { proxy.scrollTo("match-analysis", anchor: .top) }
                                    },
                                    onScrollToPlacement: {
                                        withAnimation { proxy.scrollTo("match-analysis", anchor: .top) }
                                    },
                                    onRowChanged: {
                                        // The Tools rows render from this
                                        // screen's captured row: refetch it
                                        // so "Your side" / details reflect
                                        // the save immediately, then square
                                        // the library list too.
                                        Task {
                                            await refreshMatch(refreshLibrary: true)
                                        }
                                    },
                                    sampleViewer: sampleViewer,
                                    moreOptions: moreOptionsHooks
                                )
                            }
                            pointsSection(proxy: proxy)
                            // One section: the serve maps are cards of the
                            // analysis deck now, so a practice with maps gets
                            // the section too, holding just those. A hand-cut
                            // match gets the same deck as an automatic one.
                            analysisSection(coachView: !isOwner)
                            overallNotesSection
                        } else {
                            rawSection(proxy: proxy)
                        }
                    }
                    .padding(20)
                    .padding(.bottom, 100)
                }
                .onScrollGeometryChange(for: Bool.self) { geo in
                    geo.contentOffset.y + geo.contentInsets.top > 130
                } action: { _, past in
                    withAnimation(.easeOut(duration: 0.15)) {
                        scrolledPastHeader = past
                    }
                }
                .safeAreaInset(edge: .top, spacing: 0) {
                    if scrolledPastHeader {
                        stickyHeader(parts, proxy: proxy)
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }
                }
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task {
            // Before anything loads: every write the model makes has to
            // know whether it is allowed to leave the phone.
            model.demo = sampleViewer
            notesStore.demo = sampleViewer
            // Opening the sample is the First steps row "Review the sample
            // match", and reading it leaves no other trace.
            if sampleViewer, !app.sampleMatchSeen {
                await app.setMetadataFlag("sample_match_seen", true)
            }
            await model.load(match)
            model.startClipPoll(match.id)
            await notesStore.load(matchId: match.id)
            await tagsStore.load(ownerId: match.userId, pointIds: model.visible.map(\.id))
            await reasonsStore.load(ownerId: match.userId)
            if match.status != .ready {
                await model.loadRawState(match, isOwner: isOwner)
                // A failed match opens itself: the reason and the retry
                // are why anyone is on this screen.
                if match.status == .failed { processOpen = true }
                if isOwner, let uid = app.userId {
                    await handCut.load(matchId: match.id, userId: uid)
                    // A cut this phone started and has not finished carries on.
                    DeviceHandCutQueue.shared.resume()
                }
                // A hand cut that died opens the card too: its marks and
                // the way back into them are why anyone is here.
                if handCutFailed { processOpen = true }
                #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("--dev-open-marker") {
                    processOpen = true
                    await openMarker()
                }
                #endif
                watchKick += 1
            }
            if let pointId = openPointId,
               let i = model.visible.firstIndex(where: { $0.id == pointId }) {
                pointSheetIndex = i
                pointSheetOpen = true
            }
            #if DEBUG
            if router.devOpenPlayer, let url = model.videoURL {
                router.devOpenPlayer = false
                playerRequest = PlayerRequest(url: url, startAt: nil, mode: .watch)
            }
            if let n = router.devOpenPoint, model.visible.indices.contains(n - 1) {
                router.devOpenPoint = nil
                pointSheetIndex = n - 1
                pointSheetOpen = true
            }
            if router.devOpenScore, let url = model.videoURL {
                router.devOpenScore = false
                playerRequest = PlayerRequest(url: url, startAt: nil, mode: .score)
            }
            #endif
        }
        .task(id: watchKick) {
            guard watchKick > 0 else { return }
            await watchProcessing()
        }
        // A processed match of the owner's own: what More options may offer,
        // and whether a new cut is already running on it. Keyed so a match
        // that finishes processing while open picks it up.
        .task(id: current.status == .ready && isOwner) {
            await loadCutAgain()
        }
        // Covered by the player or left: stop polling; back: carry on.
        .onAppear { cutAgain?.startPolling() }
        .onDisappear { cutAgain?.stopPolling() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task {
                    await refreshMatch()
                    await cutAgain?.load()
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .matchProcessingVersionChanged)) { notification in
            guard notification.object as? UUID == match.id else { return }
            Task {
                await refreshMatch(refreshLibrary: cutAgain != nil)
                // A re-cut that failed hands its marks back to the draft.
                if cutAgain != nil { await handCut.refresh() }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .deviceHandCutChanged)) { notification in
            // Submitted, handed over, or let go: the server's job row is the
            // truth again, so read it and keep watching.
            guard notification.object as? UUID == match.id else { return }
            Task {
                await model.refreshJob()
                await refreshMatch(refreshLibrary: true)
                watchKick += 1
            }
        }
        .alert("The original is no longer available", isPresented: $originalMissing) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("This match was processed before we started keeping originals. The full video still plays.")
        }
        .alert("Couldn't open the original", isPresented: $originalFailed) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Check your connection and try again.")
        }
        .fullScreenCover(item: $playerRequest, onDismiss: {
            // Keep made a new match: its page takes this one's place.
            if let id = pendingOpenMatch {
                pendingOpenMatch = nil
                router.openMatchId = id
            }
        }) { request in
            PlayerTakeover(
                match: current,
                model: model,
                pad: pad,
                videoURL: request.url,
                startAt: request.startAt,
                mode: request.mode,
                source: request.source,
                reasonsStore: reasonsStore,
                notesStore: notesStore,
                tagsStore: tagsStore,
                onFirstServer: { _ in
                    // Repaint from the row rather than patching a copy: the
                    // serve rotation shows up on this screen too.
                    //
                    // The LIBRARY is reloaded as well, the way the details
                    // editor does it. This screen holds a MatchRow value
                    // captured when the list handed it over, and the list
                    // only refreshes itself on a 30s poll — so leaving to
                    // the list and coming straight back in re-entered the
                    // pad on a row that still said nobody knew, and the
                    // sheet asked a question that had just been answered.
                    Task {
                        await refreshMatch(refreshLibrary: true)
                    }
                },
                onOpenPoint: { i in
                    pointSheetIndex = i
                    // Continuity: opening a point FROM the pad and closing it
                    // must come back to the pad, on the rally you were looking
                    // at. Reaching it again otherwise is Keep score, wait for
                    // the resume, then hunt for it.
                    scoreReturnPoint = request.mode == .score
                        ? model.visible.indices.contains(i) ? model.visible[i].cutT0 : nil
                        : nil
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {
                        pointSheetOpen = true
                    }
                },
                onKeepScore: { at in
                    guard let url = model.videoURL else { return }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {
                        playerRequest = PlayerRequest(url: url, startAt: at, mode: .score)
                    }
                },
                marker: request.marker
            )
        }
        .sheet(isPresented: $pointSheetOpen, onDismiss: {
            guard let at = scoreReturnPoint, let url = model.videoURL else { return }
            scoreReturnPoint = nil
            playerRequest = PlayerRequest(url: url, startAt: at, mode: .score)
        }) {
            PointDetailScreen(
                match: current,
                model: model,
                index: $pointSheetIndex,
                onOpenInMatch: { cutT0 in
                    if let url = model.videoURL {
                        playerRequest = PlayerRequest(url: url, startAt: cutT0, mode: .watch)
                    }
                },
                notesStore: notesStore,
                tagsStore: tagsStore,
                reasonsStore: reasonsStore,
                pad: pad
            )
        }
        .sheet(item: $tagPickerPoint) { point in
            TagPickerSheet(
                point: point, match: current, tagsStore: tagsStore, userId: app.userId
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $filtersOpen) {
            PointFilterSheet(winner: $winnerFilter, only: $onlyFilter, coachView: !isOwner)
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $shareOpen) {
            ShareLinksSheet(
                match: current,
                starredCount: model.visible.filter(\.starred).count,
                processed: current.status == .ready
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        // Edit details in the menu opens the same editor the Tools card
        // does. The title is derived from these fields, so the row is
        // refetched on save to repaint it right away.
        .sheet(isPresented: $detailsOpen) {
            MatchDetailsEditor(match: current) {
                Task {
                    await refreshMatch(refreshLibrary: true)
                }
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        // Two answers and a way out. "Game ended here" writes the SAME
        // override the owner could pin by hand, so a game ended from a
        // marker is indistinguishable afterwards from one ended any other
        // way — the detector never gets a private path into the score.
        .confirmationDialog(
            "The players changed ends here",
            isPresented: Binding(
                get: { sideChangeSheet != nil },
                set: { if !$0 { sideChangeSheet = nil } }
            ),
            titleVisibility: .visible,
            presenting: sideChangeSheet
        ) { point in
            Button("Game ended here") {
                Task { await model.setBoundary(point, next: .end) }
            }
            Button("They just changed ends") {
                Task { await model.dismissSideChange(point) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("This usually means the game ended.")
        }
        .alert("Delete this match?", isPresented: $deleteAsk) {
            Button("Delete", role: .destructive) {
                Task { await deleteMatch() }
            }
            Button("Keep it", role: .cancel) {}
        } message: {
            Text("The video, points, and notes are gone for good.")
        }
        .plKeyboardDismiss()
    }

    /// The row leaves the library immediately, this page dismisses back to
    /// it, and the store's reload squares the list with the server.
    private func deleteMatch() async {
        deleting = true
        dismiss()
        await library.delete(current)
    }

    // MARK: - Header

    /// The owner's actions, up where iOS keeps them: an ellipsis at the
    /// top right holding edit, share, and the delete that used to be a
    /// pill at the bottom of the scroll.
    private var matchMenu: some View {
        Menu {
            Button {
                detailsOpen = true
            } label: {
                Label("Edit details", systemImage: "pencil")
            }
            // Share works before processing too (153): the link plays the
            // original upload, then upgrades to the cut once processing
            // lands. Only a rejected upload, whose file is gone, has
            // nothing to share.
            if !sourceGone {
                Button {
                    shareOpen = true
                } label: {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
            }
            Divider()
            Button(role: .destructive) {
                deleteAsk = true
            } label: {
                Label("Delete match", systemImage: "trash")
            }
            .disabled(deleting)
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(PL.text200)
                .frame(width: 34, height: 34)
                .background(PL.surface2, in: Circle())
                .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))
                .contentShape(Circle())
        }
        .accessibilityLabel("Match actions")
    }

    /// The floating match pill once the title scrolls away — the web's
    /// sticky header: back, title, running games score with a caret that
    /// jumps back to the top.
    private func stickyHeader(
        _ parts: (primary: String, secondary: String), proxy: ScrollViewProxy
    ) -> some View {
        HStack(spacing: 10) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PL.text200)
                    .frame(width: 34, height: 34)
                    .background(PL.surface2.opacity(0.8), in: Circle())
            }
            .buttonStyle(.plain)
            Text(parts.primary)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(PL.textBody)
                .lineLimit(1)
            Spacer()
            if tracksServe, score.confirmedCount > 0 {
                Button {
                    withAnimation { proxy.scrollTo("match-top", anchor: .top) }
                } label: {
                    HStack(spacing: 6) {
                        (Text("\(score.gamesYou)").foregroundColor(PL.cyan)
                            + Text(" - ").foregroundColor(PL.text600)
                            + Text("\(score.gamesThem)").foregroundColor(PL.magentaSoft))
                            .font(.system(size: 15, weight: .semibold))
                            .monospacedDigit()
                        Image(systemName: "chevron.down")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(PL.text500)
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 52)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(PL.edge.opacity(0.8), lineWidth: 1))
        .padding(.horizontal, 12)
        .padding(.top, 6)
        .padding(.bottom, 4)
    }

    private func header(_ parts: (primary: String, secondary: String)) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(parts.primary)
                .font(.plPageTitle)
                .tracking(-0.6)
                .foregroundStyle(PL.textBody)
            HStack {
                Text(parts.secondary)
                    .font(.plBody)
                    .foregroundStyle(PL.text500)
                Spacer()
                if current.status != .ready {
                    StatusChip(
                        status: processingAvailabilityNotice != nil && (model.jobRunning || current.status == .processing) ? .queued : model.jobRunning ? .processing : current.chipStatus
                    )
                }
                // tracksServe too, not just "has winners": a match that was
                // scored and then re-tagged as practice keeps its winner
                // rows, and a games total beside "Practice" reads as a
                // contradiction. Flip the type back and it returns.
                if scoredOwnsSlot {
                    Button {
                        withAnimation(.easeOut(duration: 0.15)) {
                            showGamesDetail.toggle()
                        }
                    } label: {
                        HStack(spacing: 6) {
                            (Text("\(score.gamesYou)").foregroundColor(PL.cyan)
                                + Text(" - ").foregroundColor(PL.text600)
                                + Text("\(score.gamesThem)").foregroundColor(PL.magentaSoft))
                                .font(.system(size: 16, weight: .semibold))
                                .monospacedDigit()
                            Image(systemName: "chevron.down")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(PL.text500)
                                .rotationEffect(.degrees(showGamesDetail ? 180 : 0))
                        }
                    }
                    .buttonStyle(.plain)
                } else if !spokenRows.isEmpty {
                    // No scored result yet: the spoken score stands in
                    // the slot, muted and labelled, so which one is the
                    // record is answered by weight before the label.
                    SpokenGamesToggle(rows: spokenRows,
                                      open: showSpokenDetail) {
                        withAnimation(.easeOut(duration: 0.15)) {
                            showSpokenDetail.toggle()
                        }
                    }
                }
            }
            if showGamesDetail, !score.games.isEmpty {
                Text(score.games.map { "\($0.you)-\($0.them)" }.joined(separator: "  ·  "))
                    .font(.plCaption)
                    .monospacedDigit()
                    .foregroundStyle(PL.text400)
                // The record, then the testimony, one weight apart. Tap
                // the spoken line to fix it.
                if !spokenRows.isEmpty {
                    Button {
                        spokenSheetOpen = true
                    } label: {
                        Text("Spoken  ").font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(PL.text600)
                        + Text(SpokenSummary.line(spokenRows))
                            .font(.plCaption)
                            .monospacedDigit()
                            .foregroundStyle(PL.text500)
                    }
                    .buttonStyle(.plain)
                }
            }
            if showSpokenDetail, !scoredOwnsSlot, !spokenRows.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Button {
                        spokenSheetOpen = true
                    } label: {
                        Text(SpokenSummary.line(spokenRows))
                            .font(.plCaption)
                            .monospacedDigit()
                            .foregroundStyle(PL.text400)
                    }
                    .buttonStyle(.plain)
                    // Spoken is the appetizer; the analysis only comes
                    // from scoring the points. The nudge rides the peek,
                    // which is the moment someone is thinking about the
                    // score at all.
                    if tracksServe, current.status == .ready,
                       let url = model.videoURL {
                        Button {
                            playerRequest = PlayerRequest(
                                url: url, startAt: nil, mode: .score)
                        } label: {
                            Text("Score the match to unlock your analysis")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(PL.cyan)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .sheet(isPresented: $spokenSheetOpen) {
            SpokenScoreSheet(youLabel: spokenYouLabel,
                             rows: spokenRows,
                             onSave: { game, you, them in
                                 saveSpoken(game: game, you: you, them: them)
                             },
                             onRemove: { game in removeSpoken(game: game) })
        }
    }

    /// The uploader's own label on the spoken board, same rule as the
    /// record screen: the account's first name, or "You".
    private var spokenYouLabel: String {
        let name = app.firstName
        guard name != "player", name.count <= 10 else { return "You" }
        return name.prefix(1).uppercased() + name.dropFirst()
    }

    private func saveSpoken(game: Int, you: Int, them: Int) {
        var rows = spokenRows
        rows.removeAll { $0.game == game }
        rows.append(SpokenGameScore(game: game, you: you, them: them))
        rows.sort { $0.game < $1.game }
        persistSpoken(rows)
    }

    private func removeSpoken(game: Int) {
        persistSpoken(spokenRows.filter { $0.game != game })
    }

    /// Optimistic: the screen updates now, the row write follows. An
    /// empty list stores null, so the slot disappears cleanly rather
    /// than leaving an empty board behind.
    private func persistSpoken(_ rows: [SpokenGameScore]) {
        spokenOverride = rows.isEmpty ? .some(nil) : .some(rows)
        struct Patch: Encodable { let spoken_scores: [SpokenGameScore]? }
        Task {
            _ = try? await supa.from("matches")
                .update(Patch(spoken_scores: rows.isEmpty ? nil : rows))
                .eq("id", value: match.id.uuidString)
                .execute()
        }
    }

    // MARK: - Hero (DownloadCard)

    private var hero: some View {
        MatchVideoHero(
            match: current, videoAvailable: model.videoURL != nil,
            hasOriginal: hasOriginal, openingOriginal: openingOriginal,
            onPlay: {
                if let url = model.videoURL {
                    playerRequest = PlayerRequest(url: url, startAt: nil, mode: .watch)
                }
            },
            onOriginal: { Task { await openOriginal() } },
            onDownload: canWrite ? {
                Task {
                    if let url = await model.downloadURL(current) { openURL(url) }
                }
            } : nil
        )
    }

    // MARK: - Raw match (uploaded, processing, or failed)

    /// Nothing left behind this row: the content check turns a video down
    /// by deleting the file, keeping only the match so the uploader can
    /// read why. Matches the web's RawMatchView, which hides its player
    /// and its process card on the same condition.
    /// Is there an original upload left to watch? raw_path is set at
    /// upload and never cleared on the success path, and r2_raw_sweep
    /// skips any object a live match references — so for anything
    /// uploaded since the commerce flip this is simply true, for good.
    /// A legacy row reads null only if its raw was swept before commerce
    /// (worker/backfill_raw_path.py fills the column where the file
    /// survived).
    private var hasOriginal: Bool {
        current.rawPath?.hasPrefix("r2://ponglens-raw/") == true
    }

    /// Mint the six-hour streaming link and open the takeover on it. On
    /// tap, not on load: signing one for every viewer of every match, for
    /// a button most never press, buys nothing.
    private func openOriginal() async {
        guard !openingOriginal else { return }
        openingOriginal = true
        defer { openingOriginal = false }
        switch await model.originalLink(current) {
        case .url(let url):
            playerRequest = PlayerRequest(
                url: url, startAt: nil, mode: .watch, source: .original
            )
        case .gone:
            originalMissing = true
        case .failed:
            originalFailed = true
        }
    }

    private var sourceGone: Bool {
        current.status == .failed && current.rawPath == nil
    }


    /// The web's RawMatchView, sized for the app: live job progress while
    /// the pipeline runs, the failure sentence when it broke, and the
    /// process decision with real numbers when the video just sits there.
    @ViewBuilder
    private func rawSection(proxy: ScrollViewProxy) -> some View {
        if isOwner, let phone = DeviceHandCutQueue.shared.live(forMatch: current.id) {
            DeviceHandCutCard(live: phone)
        } else if model.jobRunning || current.status == .processing {
            MatchProcessingCard(
                notice: processingAvailabilityNotice,
                stageLabel: model.processingFeedback?.stageLabel,
                warning: model.processingFeedback?.cameraWarning(trimStart: trimStart, trimEnd: trimEnd ?? .infinity),
                progress: model.job?.progress,
                // A hand cut ends in the same ready email as an automatic cut.
                sendsReadyEmail: ["deadspace_cut", "hand_cut"].contains(model.processingFeedback?.jobKind ?? model.job?.kind ?? ""),
                estimate: model.processingFeedback?.estimate,
                jobStatus: model.processingFeedback?.jobStatus ?? model.job?.status,
                serviceState: ProcessingServiceStore.shared.state(for: processingServiceLane(kind: model.processingFeedback?.jobKind ?? model.job?.kind, clipLane: ProcessingServiceStore.shared.clipLane)).rawValue
            )
        } else if sourceGone {
            VStack(alignment: .leading, spacing: 10) {
                Text(model.job?.userMessage ?? "This video couldn't be processed.")
                    .font(.plBody)
                    .foregroundStyle(PL.warningText)
                Text("The file has been removed and nothing was charged for it. If this was a match, upload it again and it will go through.")
                    .font(.plBody)
                    .foregroundStyle(PL.text500)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .plCard()
        } else if isOwner {
            if handCutFailed { handCutFailedCard }
            processCard
        }

        // The processed page's Tools card, minus the rows that need
        // points to exist. Details editing hands back to this screen's
        // own editor (the same one the ellipsis menu opens), replacing
        // the summary card that used to sit here — one editor, one door.
        if isOwner {
            RawToolsSection(
                match: current,
                sourceGone: sourceGone,
                onEditDetails: { detailsOpen = true },
                onScrollToNotes: {
                    withAnimation { proxy.scrollTo("overall-notes", anchor: .top) }
                }
            )
        }
        // The same overall-notes thread the processed page ends with.
        // Notes were the invisible half of the raw player: its note button
        // saved a real match note, and this page had nowhere to show it.
        overallNotesSection
    }

    private var processingAvailabilityNotice: ProcessingAvailabilityNotice? {
        guard isOwner else { return nil }
        return ProcessingServiceStore.shared.matchNotice(
            matchStatus: current.status.rawValue,
            jobKind: model.processingFeedback?.jobKind ?? model.job?.kind,
            jobStatus: model.processingFeedback?.jobStatus ?? model.job?.status,
            lane: model.processingFeedback?.lane,
            videoSaved: current.rawPath != nil,
            onDevice: model.processingFeedback?.onDevice ?? false
        )
    }



    /// Turning the upload into points: the primary decision on this
    /// screen, and the only one that spends minutes.
    ///
    /// COLLAPSED BY DEFAULT. It used to sit permanently open, so a screen
    /// whose job is "watch this and decide" led with a trim bar, two
    /// settings and a price. Closed it states the offer and the cost in
    /// one line and gets out of the way; the controls are one tap down for
    /// the person who actually wants them. Same shape as the details card
    /// below it.
    ///
    /// The exception is a match that FAILED. Its reason and its retry are
    /// the whole point of the screen, so that one opens itself.
    private var processCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.22)) { processOpen.toggle() }
            } label: {
                HStack(alignment: .center, spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Break it into points")
                            .font(.plCardTitle)
                            .foregroundStyle(PL.text100)
                        Text("Every rally as its own clip")
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                    }
                    Spacer(minLength: 8)
                    // The price, before the tap. It is what decides whether
                    // anyone opens this at all. With two ways in, the price
                    // belongs to the automatic one and sits on its row.
                    if !handCutAvailable, let charge = minutesCharge {
                        Text("\(charge) min")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(PL.text300)
                            .monospacedDigit()
                    }
                    Image(systemName: "chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(PL.text500)
                        .rotationEffect(.degrees(processOpen ? 180 : 0))
                }
                .padding(20)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if let warning = model.processingFeedback?.cameraWarning(trimStart: trimStart, trimEnd: trimEnd ?? .infinity) {
                Text(warning).font(.plBody).foregroundStyle(PL.warningText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20).padding(.bottom, 20)
            }
            if let notice = processingAvailabilityNotice {
                ProcessingAvailabilityNoticeView(notice: notice)
                    .padding(.horizontal, 20).padding(.bottom, 20)
            } else if model.processingFeedback?.jobKind == "content_check", let label = model.processingFeedback?.stageLabel {
                Text(label).font(.plBody).foregroundStyle(PL.text400)
                    .padding(.horizontal, 20).padding(.bottom, 20)
            }

            // Outside the fold: a failure is the reason someone opened this
            // screen, and hiding it behind a chevron would be a lie of
            // omission.
            if current.status == .failed {
                Text(model.job?.userMessage ?? "Processing failed, and your minutes came back.")
                    .font(.plBody)
                    .foregroundStyle(PL.warningText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 20)
            }

            if processOpen {
                Rectangle().fill(PL.edge).frame(height: 1)

                if handCutAvailable {
                    // Two ways to do this, stated as two rows (the web's
                    // RawMatchView). The automatic one carries the price and
                    // the trim; marking by hand has neither.
                    autoRow
                    if autoOpen {
                        Rectangle().fill(PL.edge.opacity(0.6)).frame(height: 1)
                        autoControls
                    }
                    Rectangle().fill(PL.edge.opacity(0.6)).frame(height: 1)
                    markRow
                    if markOpen {
                        Rectangle().fill(PL.edge.opacity(0.6)).frame(height: 1)
                        markControls
                    }
                } else {
                    autoControls
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 0)
    }

    // MARK: - Mark the points yourself

    /// The web's gate: the account may hand cut AND the draft table
    /// answered. A failed read hides the row rather than offering a pass
    /// that cannot be saved.
    private var handCutAvailable: Bool { isOwner && handCut.enabled && handCut.ready }

    /// The latest hand cut on this match died for good.
    private var handCutFailed: Bool {
        !model.jobRunning && model.job?.kind == "hand_cut" && model.job?.status == "failed"
    }

    /// The match is back to 'uploaded', so nothing else here says anything
    /// went wrong; the job does. The marks are still there: the row below
    /// reads "N marked".
    private var handCutFailedCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Marked by hand")
                .font(.plSection)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(PL.text500)
            Text(model.job?.userMessage ?? "The cut didn't finish.")
                .font(.plBody)
                .foregroundStyle(PL.text300)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 12)
            // A phone cut released after 72 hours already says the marks are
            // saved; the same sentence twice reads as a mistake.
            Text((model.job?.userMessage ?? "").contains("Your marks are saved")
                 ? "Open them, check them and send them again."
                 : "Your marks are saved. Open them, check them and send them again.")
                .font(.plBody)
                .foregroundStyle(PL.text400)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard()
    }

    private var autoRow: some View {
        AccordionHeaderRow(
            title: "Automatically",
            detail: "We find the rallies and cut them for you.",
            trailing: minutesCharge.map { "\($0) min" },
            open: autoOpen
        ) {
            withAnimation(.easeOut(duration: 0.22)) { autoOpen.toggle() }
        }
    }

    /// Opens in place like "Automatically": the Score switch and the button
    /// that starts marking sit under it, never a jump straight into the
    /// marker.
    private var markRow: some View {
        let count = handCut.markedCount
        return AccordionHeaderRow(
            title: "Mark the points yourself",
            detail: "You mark where each point starts and ends.",
            trailing: count > 0 ? "\(count) marked" : nil,
            open: markOpen
        ) {
            withAnimation(.easeOut(duration: 0.22)) { markOpen.toggle() }
        }
        .disabled(!hasOriginal)
        .opacity(hasOriginal ? 1 : 0.4)
    }

    /// Practice and drills cannot be scored (the marker's own rule).
    private var markPractice: Bool { !MatchTitle.tracksServe(current.matchType) }

    /// Where the switch stands: the player's flip, else what the marker
    /// would open as (on for a match, a draft's recorded mode, off for
    /// practice and drills).
    private var markMode: HandCutMode {
        HandCut.openingMode(
            handCut.marks, recorded: handCut.mode,
            tracksServe: !markPractice, chosen: markModeChoice
        )
    }

    /// The Score switch, the same rules as in the marker, and the button
    /// that opens the marker in that mode at its gate.
    private var markControls: some View {
        MarkYourselfControls(
            practice: markPractice,
            mode: markMode,
            onMode: { markModeChoice = $0 },
            resuming: handCut.markedCount > 0,
            opening: openingMarker,
            enabled: hasOriginal,
            onStart: { Task { await openMarker() } }
        )
    }

    /// Open the marker on the original: a file already on the phone when
    /// there is one (HandCutVideo), else a presigned link minted now and
    /// frozen for the session, as the web freezes its own. The draft is
    /// checked against the server first, so the newer copy is the one
    /// that opens.
    private func openMarker() async {
        guard !openingMarker, isOwner else { return }
        openingMarker = true
        defer { openingMarker = false }
        async let refreshed: Void = handCut.beginSession()
        let url: URL?
        if let local = HandCutVideo.localFile(current.id) {
            url = local
        } else {
            switch await model.originalLink(current) {
            case .url(let u): url = u
            case .gone: url = nil; originalMissing = true
            case .failed: url = nil; originalFailed = true
            }
        }
        await refreshed
        guard let url, handCut.ready else { return }
        let marker = HandCutMarker(
            match: current,
            store: handCut,
            mode: markModeChoice,
            submitMarks: { marks in await submitHandCut(marks) },
            saveFirstServer: { value in await model.setFirstServer(matchId: current.id, value: value) }
        )
        // The choice now lives in the draft; the row reads it back from there.
        markModeChoice = nil
        playerRequest = PlayerRequest(
            url: url, startAt: nil, mode: .mark, source: .original, marker: marker
        )
    }

    /// claim_hand_cut with the marks, exactly as the web sends them, and the
    /// web's sentences for each refusal. On success the job is known at once
    /// and the ordinary processing card takes over.
    ///
    /// When this iPhone holds the video and the account may cut on the
    /// phone, the phone claims the job instead and cuts it here
    /// (DeviceHandCutQueue); anything that stops that before the claim falls
    /// through to the Mac, exactly as from the web. The player sees the same
    /// processing card either way.
    private func submitHandCut(_ marks: [HandCutMark]) async -> String? {
        if isOwner, HandCutVideo.localFile(current.id) != nil {
            switch await DeviceHandCutQueue.shared.start(match: current, marks: marks) {
            case .started(let jobId):
                model.job = MatchJob(id: jobId, status: "processing", progress: 0, userMessage: nil, kind: "hand_cut")
                await refreshMatch(refreshLibrary: true)
                watchKick += 1
                return nil
            case .refused(let sentence):
                return sentence
            case .useMac:
                break
            }
        }
        nonisolated struct Claim: Encodable {
            let p_match_id: String
            let p_marks: [HandCutSubmission]
        }
        nonisolated struct Claimed: Decodable { let job_id: String? }
        do {
            let res: Claimed = try await supa.rpc(
                "claim_hand_cut",
                params: Claim(
                    p_match_id: current.id.uuidString.lowercased(),
                    p_marks: HandCut.submittable(marks)
                )
            ).execute().value
            model.job = MatchJob(
                id: res.job_id.flatMap(UUID.init(uuidString:)) ?? UUID(),
                status: "queued", progress: 0, userMessage: nil, kind: "hand_cut"
            )
            await refreshMatch(refreshLibrary: true)
            watchKick += 1
            return nil
        } catch {
            return CutAgainErrors.handCut((error as? PostgrestError)?.message ?? error.localizedDescription)
        }
    }

    /// Trim, strictness and the charge: the automatic cut's controls.
    private var autoControls: some View {
        AutoProcessControls(
            durationS: current.durationS,
            trimStart: $trimStart,
            trimEnd: $trimEnd,
            strictness: $strictness,
            error: processError,
            busy: processBusy,
            balance: model.minutesBalance,
            needsMoreMinutes: model.needsMoreMinutes,
            recheckMinutes: {
                try await model.refreshMinutes()
                processError = nil
            },
            onProcess: { Task { await runProcess() } }
        )
    }

    /// The kept window's length — what the charge is quoted on. The
    /// server recomputes the same number at claim time, so this label can
    /// only ever be wrong in the direction of an error message.
    private var trimmed: Bool {
        ProcessCharge.trimmed(durationS: current.durationS, trimStart: trimStart, trimEnd: trimEnd)
    }

    private var minutesCharge: Int? {
        ProcessCharge.minutes(durationS: current.durationS, trimStart: trimStart, trimEnd: trimEnd)
    }

    private func runProcess() async {
        processBusy = true
        processError = await model.process(
            current, placement: true,
            trimStart: trimmed ? trimStart : nil,
            trimEnd: trimmed ? trimEnd : nil,
            strictness: strictness
        )
        if processError != nil { try? await model.refreshMinutes() }
        if processError == nil {
            await refreshMatch(refreshLibrary: true)
            watchKick += 1
        }
        processBusy = false
    }

    /// Every saved-row, job, foreground and notification refresh goes through
    /// the same adoption. Only a replaced snapshot closes point-owned UI.
    private func refreshMatch(refreshLibrary: Bool = false) async {
        let replacement = await model.refreshActiveVersion(match.id)
        if let fresh = replacement {
            scoreReturnPoint = nil
            pointSheetOpen = false
            playerRequest = nil
            tagPickerPoint = nil
            sideChangeSheet = nil
            pendingJump = nil
            // These stores belong to point identities, not to a match position.
            notesStore = NotesStore()
            tagsStore = TagsStore()
            await notesStore.load(matchId: fresh.id)
            await tagsStore.load(ownerId: fresh.userId, pointIds: model.visible.map(\.id))
        }
        if replacement != nil || refreshLibrary { await library.load() }
    }

    /// Poll the running job the way the web does, and flip this page to
    /// the full match view the moment processing lands.
    private func watchProcessing() async {
        while !Task.isCancelled, model.feedbackActive {
            try? await Task.sleep(for: .seconds(8))
            guard !Task.isCancelled else { return }
            await model.refreshJob()
            guard let job = model.job else { return }
            if job.status == "done" || job.status == "failed" {
                await refreshMatch(refreshLibrary: true)
                return
            }
        }
    }

    // MARK: - Cut again (More options on a processed match)

    /// What the Tools row lends More options. Nil for anyone but the owner.
    private var moreOptionsHooks: MoreOptionsHooks? {
        guard isOwner, let cutAgain else { return nil }
        return MoreOptionsHooks(
            cutAgain: cutAgain,
            handCut: handCut,
            cutScored: model.visible.contains { $0.confirmedWinner != nil || $0.isLet },
            prepareMarking: { chosen in await prepareRecutMarking(chosen) },
            afterDismiss: {
                guard let request = pendingRecutPlayer else { return }
                pendingRecutPlayer = nil
                playerRequest = request
            },
            openMatch: { id in router.openMatchId = id }
        )
    }

    private func loadCutAgain() async {
        guard current.status == .ready, isOwner, !SampleMatch.isSample(current) else { return }
        if cutAgain == nil { cutAgain = CutAgainModel(matchId: match.id) }
        await cutAgain?.load()
        if let uid = app.userId { await handCut.load(matchId: match.id, userId: uid) }
    }

    /// The ordinary processing card, for the cut replacing this one.
    private func recutProgress(_ cutAgain: CutAgainModel) -> some View {
        let kind = cutAgain.feedback?.jobKind
        return MatchProcessingCard(
            notice: nil,
            stageLabel: cutAgain.feedback?.stageLabel,
            warning: nil,
            progress: cutAgain.job?.progress,
            sendsReadyEmail: true,
            estimate: cutAgain.feedback?.estimate,
            jobStatus: cutAgain.feedback?.jobStatus,
            serviceState: ProcessingServiceStore.shared.state(
                for: processingServiceLane(kind: kind, clipLane: ProcessingServiceStore.shared.clipLane)
            ).rawValue
        )
    }

    /// Start marking, from More options: the draft for marking again
    /// (start_recut resumes an unsent one, or writes the live cut's points),
    /// read back through the draft store so the phone's own copy is
    /// reconciled as on the raw page, then the ORIGINAL's link, minted now
    /// and frozen for the session. The marker is raised once the sheet has
    /// gone. Never cut on the phone: a re-cut always goes to the server.
    private func prepareRecutMarking(_ chosen: HandCutMode?) async -> String? {
        guard isOwner, let cutAgain, let options = cutAgain.options, let uid = app.userId else {
            return CutAgainCopy.somethingWrong
        }
        if case .failure(let refused) = await cutAgain.startRecut() {
            switch CutAgainErrors.handRecut(refused.message) {
            case .message(let sentence): return sentence
            case .coachReview: return CutAgainCopy.somethingWrong
            }
        }
        await handCut.load(matchId: current.id, userId: uid)
        guard handCut.ready else { return CutAgainErrors.handCut("") }
        let url: URL
        switch await model.originalLink(current) {
        case .url(let link): url = link
        case .gone: return CutAgainCopy.noSource
        case .failed: return "Couldn't open the original. Check your connection and try again."
        }
        let matchNow = current
        let marker = HandCutMarker(
            match: matchNow,
            store: handCut,
            mode: chosen,
            // The raw page's claim is never used for a re-cut.
            submitMarks: { _ in CutAgainCopy.somethingWrong },
            saveFirstServer: { value in await model.setFirstServer(matchId: matchNow.id, value: value) },
            recut: RecutChoiceState.byHand(options),
            submitRecut: { marks, replace in await submitHandRecut(marks, replace: replace) }
        )
        pendingRecutPlayer = PlayerRequest(
            url: url, startAt: nil, mode: .mark, source: .original, marker: marker
        )
        return nil
    }

    /// Cut the match, from the marker's review sheet on a processed match.
    /// Replace: the match plays on and the ordinary progress shows. Keep:
    /// the new match's page opens once the marker has closed.
    private func submitHandRecut(_ marks: [HandCutMark], replace: Bool) async -> RecutRefusal? {
        guard let cutAgain else { return .message(CutAgainCopy.somethingWrong) }
        switch await cutAgain.claimHandRecut(marks, replace: replace) {
        case .failure(let refusal):
            return refusal
        case .success(let claim):
            if !replace, let id = claim.matchId, id != current.id {
                pendingOpenMatch = id
            }
            await library.load()
            return nil
        }
    }

    // MARK: - Overall notes

    /// Match-level notes (no point attached): overall takeaways and the
    /// coach's whole-match review, at the bottom the way the web page ends.
    private var overallNotesSection: some View {
        let matchNotes = notesStore.notes.filter { $0.pointId == nil }
        return VStack(alignment: .leading, spacing: 12) {
            SectionHeading("Overall notes")
            VStack(alignment: .leading, spacing: 14) {
                ForEach(matchNotes) { note in
                    NoteItemView(
                        note: note,
                        matchId: current.id,
                        ownerId: current.userId,
                        viewerId: app.userId ?? current.userId,
                        authorName: sampleViewer
                            ? SampleMatch.noteAuthor
                            : notesStore.authorNames[note.authorId],
                        notesStore: notesStore
                    )
                }
                // No composer on the sample: the database refuses a note
                NoteComposerView(
                    matchId: current.id,
                    pointId: nil,
                    userId: app.userId ?? current.userId,
                    notesStore: notesStore,
                    placeholder: "How did the match go?",
                    demo: sampleViewer
                )
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .plCard()
        }
        .id("overall-notes")
    }

    // MARK: - Match analysis

    private func analysisSection(coachView: Bool) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading("Match analysis")
            AnalysisCards(
                bundle: MatchAnalysisBundle(match: current, model: model, score: score),
                coachView: coachView,
                neutralLabels: sampleLabels,
                video: VideoCardsInput(
                    match: current,
                    points: model.visible,
                    userSide: current.userSide,
                    gameIndexByPoint: gameIndexByPoint,
                    serving: serving,
                    pad: pad,
                    // Nobody is named on the sample: the cards and maps read
                    // Player 1 and Player 2, the uploader's own side first.
                    opponentLabel: sampleLabels?.them ?? (current.opponentName ?? "Them"),
                    servesOnly: app.placementServesOnly,
                    scoredType: tracksServe,
                    showMaps: showPlacementAggregate,
                    placementTrusted: current.placementStatus == "ready",
                    onScore: isOwner && tracksServe
                        ? {
                            if let url = model.videoURL {
                                playerRequest = PlayerRequest(url: url, startAt: nil, mode: .score)
                            }
                        }
                        : nil,
                    onPlacementChanged: {
                        Task { await refreshMatch(refreshLibrary: true) }
                    },
                    videoURL: model.videoURL,
                    onOpenPoint: { point in
                        guard let i = model.visible.firstIndex(where: { $0.id == point.id }) else { return }
                        pointSheetIndex = i
                        // The zone sheet is dismissing; the point sheet
                        // presents once it is gone, as the pad does.
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {
                            pointSheetOpen = true
                        }
                    },
                    // The same write the pad's first-server sheet makes, then
                    // the row is read again so the rotation and the card follow.
                    onSetFirstServer: isOwner
                        ? { value in
                            let saved = await model.setFirstServer(matchId: current.id, value: value)
                            if saved { await refreshMatch(refreshLibrary: true) }
                            return saved
                        }
                        : nil
                )
            )
        }
        .id("match-analysis")
    }

    // MARK: - Points

    /// A point row's scroll anchor. A string of its own, NOT the point's
    /// UUID: the ForEach already claims that UUID as the row's identity,
    /// and with two views answering to one id `scrollTo` matches neither
    /// and does nothing at all. Every scroll on this screen that has
    /// always worked ("overall-notes", "placement-maps") aims at a
    /// string, and this is why.
    private func anchor(_ id: UUID) -> String { "point-\(id.uuidString)" }

    /// A game pill's jump. Two things had to be true for it to move, and
    /// neither was: the row needs an id `scrollTo` can find (above), and
    /// it has to exist. The list shows ten points until it is expanded,
    /// so a game starting past the tenth has no row yet — expand, then
    /// let that row's own appearance finish the jump.
    private func jump(to id: UUID, all: [MatchPoint], proxy: ScrollViewProxy) {
        let shown = pointsExpanded ? all : Array(all.prefix(pointsPreview))
        if shown.contains(where: { $0.id == id }) {
            withAnimation { proxy.scrollTo(anchor(id), anchor: .center) }
        } else {
            pendingJump = id
            pointsExpanded = true
        }
    }

    @ViewBuilder
    private func pointsSection(proxy: ScrollViewProxy) -> some View {
        let all = filteredPoints
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                SectionHeading("Points")
                Spacer()
                Button {
                    filtersOpen = true
                } label: {
                    Image(systemName: "line.3.horizontal.decrease")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(filtersActive ? PL.cyan : PL.text400)
                        .frame(width: 34, height: 34)
                        .overlay(
                            RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                                .strokeBorder(filtersActive ? PL.cyan.opacity(0.5) : PL.edge, lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Filter points")
            }

            if tracksServe, gameStarts.count > 1, !filtersActive {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(gameStarts, id: \.id) { start in
                            // Padding and the capsule belong INSIDE the
                            // label: hung on the Button from outside they
                            // only move it, so the tap target stayed the
                            // width of the glyphs and every miss on the
                            // pill did nothing (Adil, 2026-09-03).
                            Button {
                                jump(to: start.id, all: all, proxy: proxy)
                            } label: {
                                Text("Game \(start.game)")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(PL.text400)
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 7)
                                    .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                                    .contentShape(Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            if !model.loaded {
                ForEach(0..<3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                        .fill(PL.surface)
                        .frame(height: 110)
                        .opacity(0.6)
                }
            } else if model.visible.isEmpty {
                Text("No point breakdown for this match.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
                    .frame(maxWidth: .infinity)
                    .plCard(padding: 24)
            } else if all.isEmpty {
                Text("No points match these filters.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
                    .frame(maxWidth: .infinity)
                    .plCard(padding: 24)
            } else {
                let shown = (pointsExpanded || filtersActive) ? all : Array(all.prefix(pointsPreview))
                // Once for the list, not once per row: `sideChanges` walks
                // every visible point, and a computed property read inside
                // a ForEach body is read for every row that renders.
                let markers = sideChanges
                VStack(spacing: 10) {
                    ForEach(shown) { point in
                        let number = (model.visible.firstIndex(of: point) ?? 0) + 1
                        PointCard(
                            point: point,
                            number: number,
                            displayServer: serving[point.id]?.server ?? point.displayServer,
                            scoring: tracksServe,
                            coachView: !isOwner,
                            neutralLabels: sampleLabels,
                            locked: sampleViewer,
                            noteCount: notesStore.count(for: point.id),
                            tagCount: tagsStore.tags(for: point.id).count,
                            onOpen: {
                                if let i = model.visible.firstIndex(of: point) {
                                    pointSheetIndex = i
                                    pointSheetOpen = true
                                }
                            },
                            onYou: { Task { await model.tapWinner(point, .user) } },
                            onThem: { Task { await model.tapWinner(point, .opponent) } },
                            onSkip: { Task { await model.tapSkip(point) } },
                            onTag: { tagPickerPoint = point },
                            onStar: { Task { await model.toggleStar(point) } },
                            onDelete: { Task { await model.softDelete(point) } }
                        )
                        .id(anchor(point.id))
                        .onAppear {
                            guard pendingJump == point.id else { return }
                            pendingJump = nil
                            // The row exists now, but the list around it
                            // is still laying out and a scroll in the
                            // same pass is dropped. One turn later it
                            // lands.
                            DispatchQueue.main.async {
                                withAnimation {
                                    proxy.scrollTo(anchor(point.id), anchor: .center)
                                }
                            }
                        }
                        if tracksServe, !filtersActive, let boundary = score.boundaryAfter[point.id] {
                            Text("Game \(boundary.game) ends \(boundary.you)-\(boundary.them) · game \(boundary.game + 1) begins")
                                .font(.plCaption)
                                .monospacedDigit()
                                .foregroundStyle(PL.text500)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 2)
                        } else if tracksServe, !filtersActive,
                                  markers[point.id] != nil {
                            // The video saw them swap and the score has
                            // not said so. Dashed, because the line above
                            // means "a game ended here and the score
                            // proves it" and this is a different claim.
                            //
                            // filtersActive is excluded for the same
                            // reason as the line above: with a filter on,
                            // the neighbouring card is not the
                            // neighbouring rally, so a between-rallies
                            // marker lies about what sits either side.
                            sideChangeDivider(point)
                        }
                    }
                }
                if !filtersActive, all.count > pointsPreview {
                    Button(
                        pointsExpanded
                            ? "Show first \(pointsPreview)"
                            : "Show all \(all.count) points"
                    ) {
                        withAnimation { pointsExpanded.toggle() }
                    }
                    .buttonStyle(PLSecondaryButtonStyle())
                    .frame(maxWidth: .infinity)
                }
            }
        }
    }
}

// MARK: - Filter sheet

struct PointFilterSheet: View {
    @Binding var winner: WinnerFilter
    @Binding var only: OnlyFilter
    /// A coach reads the player's match, so "I won" would be the coach
    /// speaking. The point cards' own words instead.
    var coachView = false

    private func winnerLabel(_ filter: WinnerFilter) -> String {
        switch filter {
        case .anyone: return "Anyone"
        case .me: return coachView ? "Player won" : "I won"
        case .them: return coachView ? "Opponent won" : "They won"
        }
    }

    var body: some View {
        // Titled after the button that opens it. Two segmented controls,
        // the coach sheet's own picker, one question each.
        PLSheetScaffold(title: "Filter points") {
            Form {
                Section {
                    Picker("Winner", selection: $winner) {
                        ForEach(WinnerFilter.allCases, id: \.self) { option in
                            Text(winnerLabel(option)).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)
                } header: {
                    Text("Winner")
                }
                Section {
                    Picker("Only", selection: $only) {
                        ForEach(OnlyFilter.allCases, id: \.self) { option in
                            Text(option.rawValue).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)
                } header: {
                    Text("Only")
                }
            }
        }
    }
}

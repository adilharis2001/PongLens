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

@Observable
final class MatchDetailModel {
    var points: [MatchPoint] = []
    var videoURL: URL?
    /// The game-end detector's evidence for this match (140/146), or nil
    /// when it has none — every match processed before the stage existed,
    /// and every one the detector refused.
    var matchStructure: MatchStructure?
    var loaded = false
    var error: String?
    var job: MatchJob?
    var minutesBalance: Int?

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

    private func refreshClipState(_ matchId: UUID) async {
        struct ClipRow: Decodable {
            let id: UUID
            let t0: Double?
            let t1: Double?
            let edited: Bool
            let deleted: Bool
            let tightStart: Bool
            let tightEnd: Bool
            enum CodingKeys: String, CodingKey {
                case id, t0, t1, edited, deleted
                case tightStart = "tight_start"
                case tightEnd = "tight_end"
            }
        }
        let fresh: [ClipRow]? = try? await supa
            .from("points")
            .select("id, t0, t1, edited, deleted, tight_start, tight_end")
            .eq("match_id", value: matchId.uuidString.lowercased())
            .execute()
            .value
        guard let fresh else { return }
        let byId = Dictionary(uniqueKeysWithValues: fresh.map { ($0.id, $0) })
        for i in points.indices {
            guard let row = byId[points[i].id] else { continue }
            points[i].t0 = row.t0
            points[i].t1 = row.t1
            points[i].edited = row.edited
            points[i].deleted = row.deleted
            points[i].tightStart = row.tightStart
            points[i].tightEnd = row.tightEnd
        }
    }

    func load(_ match: MatchRow) async {
        do {
            points = try await supa
                .from("points")
                .select(MatchPoint.matchSelect)
                .eq("match_id", value: match.id.uuidString.lowercased())
                .order("idx")
                .execute()
                .value
        } catch {
            #if DEBUG
            self.error = String(describing: error)
            #else
            self.error = "Couldn't load this match. Try again."
            #endif
        }

        struct Req: Encodable {
            let matchId: String
            var preview: Bool?
            var rawPreview: Bool?
        }
        struct Res: Decodable { let url: String? }
        do {
            let ready = match.status == .ready
            let res: Res = try await API.post(
                "api/media-url",
                Req(
                    matchId: match.id.uuidString.lowercased(),
                    preview: ready ? true : nil,
                    rawPreview: ready ? nil : true
                )
            )
            videoURL = res.url.flatMap(URL.init)
        } catch {
            // Hero stays a poster; playback reports its own error.
        }
        // The game-end detector's evidence, read here rather than off the
        // MatchRow the list handed over: that row comes from librarySelect,
        // which deliberately leaves this column out (a JSONB blob on every
        // row of a list that fetches the whole library). Fetched on load
        // rather than on one of the refetch paths, so a match shows its
        // markers the moment it opens rather than after the first edit.
        struct StructureRow: Decodable { let matchStructure: MatchStructure?
            enum CodingKeys: String, CodingKey {
                case matchStructure = "match_structure"
            } }
        let row: StructureRow? = try? await supa
            .from("matches")
            .select("match_structure")
            .eq("id", value: match.id.uuidString.lowercased())
            .single()
            .execute()
            .value
        matchStructure = row?.matchStructure

        loaded = true
    }

    // MARK: - Raw match: job state, balance, processing

    private static let jobSelect = "id,status,progress,user_message,kind"

    /// The newest job for this match plus the minutes balance — what the
    /// raw view needs to say "Processing", "failed", or "Process · N min".
    func loadRawState(_ match: MatchRow) async {
        let jobs: [MatchJob]? = try? await supa
            .from("jobs")
            .select(Self.jobSelect)
            .eq("options->>match_id", value: match.id.uuidString.lowercased())
            .order("created_at", ascending: false)
            .limit(1)
            .execute()
            .value
        job = jobs?.first

        struct StateRow: Decodable {
            let minutesBalance: Double?
            enum CodingKeys: String, CodingKey { case minutesBalance = "minutes_balance" }
        }
        let state: [StateRow]? = try? await supa
            .rpc("my_processing_state").execute().value
        minutesBalance = state?.first?.minutesBalance.map(Int.init)
    }

    func refreshJob() async {
        guard let current = job else { return }
        let jobs: [MatchJob]? = try? await supa
            .from("jobs")
            .select(Self.jobSelect)
            .eq("id", value: current.id.uuidString.lowercased())
            .execute()
            .value
        if let fresh = jobs?.first {
            job = fresh
        }
    }

    func refetchMatch(_ id: UUID) async -> MatchRow? {
        try? await supa
            .from("matches")
            .select(MatchRow.detailSelect)
            .eq("id", value: id.uuidString.lowercased())
            .single()
            .execute()
            .value
    }

    /// Spend minutes on the full video. Returns nil on success (the job is
    /// set), or the sentence to show.
    func process(
        _ match: MatchRow, placement: Bool,
        trimStart: Double?, trimEnd: Double?, strictness: String
    ) async -> String? {
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
                    matchId: match.id.uuidString.lowercased(),
                    trimStartS: trimStart, trimEndS: trimEnd,
                    placement: placement, strictness: strictness
                )
            )
            if let jobId = res.jobId.flatMap(UUID.init(uuidString:)) {
                // The job the owner just asked for, so it counts as running
                // straight away rather than waiting for the first poll.
                job = MatchJob(id: jobId, status: "queued", progress: 0,
                               userMessage: nil, kind: "deadspace_cut")
            }
            return nil
        } catch let APIError.http(_, code) {
            return switch code {
            case "insufficient_minutes": "Not enough minutes for this video."
            case "queue_full": "Your queue is full. Wait for a video to finish."
            default: "Something went wrong. Try again."
            }
        } catch {
            return "Something went wrong. Try again."
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
    /// Nil means the file is genuinely gone — only possible on matches
    /// processed before mid-August 2026, since the retention sweep never
    /// expires an original a library row still points at.
    func originalURL(_ match: MatchRow) async -> URL? {
        struct Req: Encodable { let matchId: String; let rawPreview: Bool }
        struct Res: Decodable { let url: String? }
        let res: Res? = try? await API.post(
            "api/media-url",
            Req(matchId: match.id.uuidString.lowercased(), rawPreview: true)
        )
        return res?.url.flatMap(URL.init)
    }

    /// Optimistic column-scoped patch with rollback — the whole scorer
    /// write surface goes through here. Returns false on a failed save so
    /// callers can flash "Couldn't save. Tap again." the way the web does.
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
    func tapWinner(
        _ point: MatchPoint, _ side: Winner, scoredAt: Double? = nil, force: Bool = false
    ) async {
        if point.confirmedWinner == side, !force {
            await patch(
                point,
                fields: ["confirmed_winner": .null, "scored_at_cut_s": .null]
            ) {
                $0.confirmedWinner = nil
                $0.scoredAtCutS = nil
            }
        } else {
            var fields: [String: AnyJSON] = [
                "confirmed_winner": .string(side.rawValue),
                "is_let": .bool(false),
            ]
            let stamp = scoredAt.map { (($0 * 100).rounded()) / 100 }
            if let stamp { fields["scored_at_cut_s"] = .double(stamp) }
            await patch(point, fields: fields) {
                $0.confirmedWinner = side
                $0.isLet = false
                if let stamp { $0.scoredAtCutS = stamp }
            }
        }
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
        await patch(
            current,
            fields: [
                "confirmed_winner": winner.map { .string($0.rawValue) } ?? .null,
                "is_let": .bool(isLet),
                "scored_at_cut_s": scoredAt.map { .double($0) } ?? .null,
                "deleted": .bool(deleted),
                "starred": .bool(starred),
            ]
        ) {
            $0.confirmedWinner = winner
            $0.isLet = isLet
            $0.scoredAtCutS = scoredAt
            $0.deleted = deleted
            $0.starred = starred
        }
    }

    func tapSkip(_ point: MatchPoint) async {
        if point.isLet {
            await patch(point, fields: ["is_let": .bool(false)]) {
                $0.isLet = false
            }
        } else {
            await patch(
                point,
                fields: ["is_let": .bool(true), "confirmed_winner": .null]
            ) {
                $0.isLet = true
                $0.confirmedWinner = nil
            }
        }
    }

    func toggleStar(_ point: MatchPoint) async {
        await patch(point, fields: ["starred": .bool(!point.starred)]) {
            $0.starred.toggle()
        }
    }

    func softDelete(_ point: MatchPoint) async {
        await patch(point, fields: ["deleted": .bool(true)]) {
            $0.deleted = true
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
    }

    @State private var playerRequest: PlayerRequest?
    /// The Original pill is mid-flight (the presigned URL is a round trip).
    @State private var openingOriginal = false
    /// The original could not be reached. Only possible on matches
    /// processed before mid-August 2026: since then the retention sweep
    /// skips any upload a library row still points at.
    @State private var originalMissing = false
    @State private var pointSheetOpen = false
    /// Where Keep score should resume when a point opened FROM the pad is
    /// closed. Nil for a point opened from the list, which has no pad to
    /// come back to.
    @State private var scoreReturnPoint: Double?
    @State private var pointSheetIndex = 0
    @State private var pointsExpanded = false
    @State private var showGamesDetail = false
    @State private var filtersOpen = false
    @State private var winnerFilter: WinnerFilter = .anyone
    @State private var onlyFilter: OnlyFilter = .everything
    /// The match row, refreshed in place when processing finishes while
    /// this screen is open — the page flips to the full match view the way
    /// the web's refresh does.
    @State private var live: MatchRow?
    @State private var watchKick = 0
    @State private var placementOn = false
    // Trim window in raw-video seconds (web RawMatchView's trimStart /
    // trimEnd). End nil = untouched = the whole video.
    @State private var trimStart: Double = 0
    @State private var trimEnd: Double?
    @State private var strictness = "normal"
    @State private var processBusy = false
    @State private var processError: String?
    @State private var detailsOpen = false
    @State private var shareOpen = false
    @State private var deleteAsk = false
    @State private var deleting = false
    /// The detected side-change marker the owner tapped in the point list.
    @State private var sideChangeSheet: MatchPoint?

    private let pointsPreview = 10

    private var current: MatchRow { live ?? match }

    /// Does a score mean anything here — tracksServe on the LIVE type, so
    /// changing it in Match details reacts without a reload. Gates every
    /// score-shaped thing on this screen: the games total, the game
    /// checkpoints and dividers, and the You/Them/Skip pills on the rows.
    private var tracksServe: Bool { MatchTitle.tracksServe(current.matchType) }

    private var isOwner: Bool { app.userId == current.userId }

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
    private var showPlacementAggregate: Bool {
        isOwner && (
            current.placementStatus == "ready"
                || model.visible.contains { $0.placement != nil }
        )
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
        let parts = MatchTitle.parts(
            opponentName: current.opponentName, venue: current.venue,
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
                                    Text("Matches")
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

                        if current.status == .ready {
                            // Coach viewers never see Tools — every row is
                            // an owner action, matching the web.
                            if isOwner {
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
                                    onScrollToPlacement: {
                                        withAnimation { proxy.scrollTo("placement-maps", anchor: .top) }
                                    }
                                )
                            }
                            pointsSection(proxy: proxy)
                            if showPlacementAggregate {
                                PlacementAggregateSection(
                                    points: model.visible,
                                    userSide: current.userSide,
                                    gameIndexByPoint: gameIndexByPoint,
                                    serving: serving,
                                    opponentLabel: current.opponentName ?? "Them",
                                    servesOnly: app.placementServesOnly
                                )
                                .id("placement-maps")
                            }
                            overallNotesSection
                        } else {
                            rawSection
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
            await model.load(match)
            model.startClipPoll(match.id)
            await notesStore.load(matchId: match.id)
            await tagsStore.load(ownerId: match.userId, pointIds: model.visible.map(\.id))
            await reasonsStore.load(ownerId: match.userId)
            if match.status != .ready {
                await model.loadRawState(match)
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
        .alert("The original is no longer available", isPresented: $originalMissing) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("This match was processed before we started keeping originals. The full video still plays.")
        }
        .fullScreenCover(item: $playerRequest) { request in
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
                        if let fresh = await model.refetchMatch(current.id) {
                            live = fresh
                        }
                        await library.load()
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
                }
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
            .presentationBackground(PL.surface)
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $filtersOpen) {
            PointFilterSheet(winner: $winnerFilter, only: $onlyFilter)
                .presentationDetents([.medium])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $shareOpen) {
            ShareLinksSheet(
                match: current,
                starredCount: model.visible.filter(\.starred).count
            )
            .presentationDetents([.medium, .large])
            .presentationBackground(PL.surface)
            .presentationDragIndicator(.visible)
        }
        // Edit details in the menu opens the same editor the Tools card
        // does. The title is derived from these fields, so the row is
        // refetched on save to repaint it right away.
        .sheet(isPresented: $detailsOpen) {
            MatchDetailsEditor(match: current) {
                Task {
                    if let fresh = await model.refetchMatch(current.id) {
                        live = fresh
                    }
                    await library.load()
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
            if current.status == .ready {
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
                        status: model.jobRunning ? .processing : current.chipStatus
                    )
                }
                // tracksServe too, not just "has winners": a match that was
                // scored and then re-tagged as practice keeps its winner
                // rows, and a games total beside "Practice" reads as a
                // contradiction. Flip the type back and it returns.
                if tracksServe, score.confirmedCount > 0 {
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
                }
            }
            if showGamesDetail, !score.games.isEmpty {
                Text(score.games.map { "\($0.you)-\($0.them)" }.joined(separator: "  ·  "))
                    .font(.plCaption)
                    .monospacedDigit()
                    .foregroundStyle(PL.text400)
            }
        }
    }

    // MARK: - Hero (DownloadCard)

    private var hero: some View {
        VStack(spacing: 0) {
            Button {
                if let url = model.videoURL {
                    playerRequest = PlayerRequest(url: url, startAt: nil, mode: .watch)
                }
            } label: {
                Color.clear
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .overlay(MatchThumb(matchId: match.id))
                    .overlay {
                        if model.videoURL != nil {
                            Circle()
                                .fill(PL.ink.opacity(0.6))
                                .frame(width: 96, height: 96)
                                .overlay(
                                    Image(systemName: "play.fill")
                                        .font(.system(size: 34))
                                        .foregroundStyle(.white)
                                        .offset(x: 3)
                                )
                        }
                    }
                    .clipped()
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(model.videoURL == nil)

            Rectangle().fill(PL.edge).frame(height: 1)

            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(current.status == .ready ? "Full video" : "Original video")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(PL.textBody)
                    Text(current.status == .ready ? "Playtime only" : "As uploaded")
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                }
                Spacer()
                // The uncut upload, for when the cut came out poor. Beside
                // the download rather than in Tools, because Tools is
                // `if isOwner` and a coach looking at a bad cut wants the
                // original for the same reason the player does. Labelled
                // "Original" rather than repeating "Full video", which the
                // caption two inches left already says about the cut.
                if current.status == .ready, hasOriginal {
                    Button {
                        Task { await openOriginal() }
                    } label: {
                        HStack(spacing: 5) {
                            if openingOriginal {
                                ProgressView().controlSize(.mini).tint(PL.text300)
                            } else {
                                Image(systemName: "play.fill")
                                    .font(.system(size: 11, weight: .semibold))
                            }
                            Text("Original")
                                .font(.system(size: 14, weight: .medium))
                        }
                        .foregroundStyle(PL.text300)
                        .padding(.horizontal, 14)
                        .frame(height: 38)
                        .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .disabled(openingOriginal)
                    .accessibilityLabel("Watch the original video")
                }
                if current.status == .ready {
                    Button {
                        Task {
                            if let url = await model.downloadURL(current) {
                                openURL(url)
                            }
                        }
                    } label: {
                        Image(systemName: "arrow.down.to.line")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(PL.text300)
                            .frame(width: 46, height: 38)
                            .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Download video")
                }
            }
            .padding(16)
        }
        .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                .strokeBorder(PL.edge, lineWidth: 1)
        )
    }

    // MARK: - Raw match (uploaded, processing, or failed)

    /// Nothing left behind this row: the content check turns a video down
    /// by deleting the file, keeping only the match so the uploader can
    /// read why. Matches the web's RawMatchView, which hides its player
    /// and its process card on the same condition.
    /// Is there an original upload left to watch? raw_path is set at
    /// upload and never cleared on the success path, and r2_raw_sweep
    /// skips any object a live library row points at — so for anything
    /// uploaded since the commerce flip this is simply true, for good.
    /// Rows older than that read null; their originals are on the ordinary
    /// 30-day clock and mostly gone already.
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
        if let url = await model.originalURL(current) {
            playerRequest = PlayerRequest(
                url: url, startAt: nil, mode: .watch, source: .original
            )
        } else {
            originalMissing = true
        }
    }

    private var sourceGone: Bool {
        current.status == .failed && current.rawPath == nil
    }


    /// The web's RawMatchView, sized for the app: live job progress while
    /// the pipeline runs, the failure sentence when it broke, and the
    /// process decision with real numbers when the video just sits there.
    @ViewBuilder
    private var rawSection: some View {
        if model.jobRunning || current.status == .processing {
            VStack(alignment: .leading, spacing: 12) {
                Text("Processing")
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                ProgressView(value: Double(min(100, max(4, model.job?.progress ?? 0))) / 100)
                    .tint(PL.cyan)
                Text("You can leave this page. We email you when the match is ready.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .plCard()
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
            processCard
        }

        if !sourceGone {
            rawDetailsCard
        }
        // The same overall-notes thread the processed page ends with.
        // Notes were the invisible half of the raw player: its note button
        // saved a real match note, and this page had nowhere to show it.
        overallNotesSection
    }

    /// What the details sheet edits, readable without opening it. On the
    /// web these fields sit as a form on the raw page — a fresh upload is
    /// where names get filled in, and a value behind a menu might as well
    /// not exist.
    private var rawDetailsCard: some View {
        Button {
            detailsOpen = true
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Match details")
                        .font(.plCardTitle)
                        .foregroundStyle(PL.text100)
                    Text(rawDetailsSummary)
                        .font(.plBody)
                        .foregroundStyle(PL.text500)
                        .lineLimit(2)
                }
                Spacer(minLength: 8)
                Text(isOwner ? "Edit" : "")
                    .font(.plButtonSecondary)
                    .foregroundStyle(PL.text300)
                if isOwner {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(PL.text600)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .plCard(padding: 16)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!isOwner)
    }

    private var rawDetailsSummary: String {
        var parts: [String] = []
        if let opp = current.opponentName?.trimmingCharacters(in: .whitespaces),
           !opp.isEmpty { parts.append("vs \(opp)") }
        if let venue = current.venue?.trimmingCharacters(in: .whitespaces),
           !venue.isEmpty { parts.append(venue) }
        if let type = current.matchType,
           let label = MatchTitle.typeLabel[type] { parts.append(label) }
        return parts.isEmpty
            ? "Add the opponent, venue, and type."
            : parts.joined(separator: " · ")
    }



    private var processCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Break it into points")
                .font(.plCardTitle)
                .foregroundStyle(PL.text100)
            if current.status == .failed {
                Text(model.job?.userMessage ?? "Processing failed, and your minutes came back.")
                    .font(.plBody)
                    .foregroundStyle(PL.warningText)
            }
            if let duration = current.durationS, duration > 10 {
                RawTrimBar(
                    duration: duration,
                    start: $trimStart,
                    end: Binding(
                        get: { trimEnd ?? duration },
                        set: { trimEnd = $0 }
                    )
                )
                if trimmed {
                    Button("Reset trim") {
                        trimStart = 0
                        trimEnd = nil
                    }
                    .buttonStyle(PLSecondaryButtonStyle())
                }
            }
            VStack(alignment: .leading, spacing: 3) {
                Toggle("Placement maps", isOn: $placementOn)
                    .font(.plRowTitle)
                    .foregroundStyle(PL.text100)
                    .tint(PL.cyan.opacity(0.6))
                Text("Where every ball landed. Adds processing time.")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text("Cut strictness")
                    .font(.plRowTitle)
                    .foregroundStyle(PL.text100)
                Text("How much room to leave around each point.")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                HStack(spacing: 4) {
                    ForEach(["tight", "normal", "loose"], id: \.self) { level in
                        let active = strictness == level
                        Button(level.capitalized) { strictness = level }
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(active ? PL.cyan : PL.text400)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .background(
                                active ? PL.cyan.opacity(0.15) : .clear,
                                in: RoundedRectangle(cornerRadius: PL.rSmall, style: .continuous)
                            )
                            .buttonStyle(.plain)
                    }
                }
                .padding(3)
                .background(PL.ink.opacity(0.4), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                        .strokeBorder(PL.edge, lineWidth: 1)
                )
                .padding(.top, 5)
            }
            if let processError {
                Text(processError)
                    .font(.plCaption)
                    .foregroundStyle(PL.warningText)
            }
            HStack(spacing: 12) {
                Button(processBusy ? "Starting…" : chargeLabel) {
                    Task { await runProcess() }
                }
                .buttonStyle(PLPrimaryButtonStyle())
                .disabled(processBusy || !enoughMinutes)
                if let balance = model.minutesBalance {
                    Text("You have \(balance).")
                        .font(.plCaption)
                        .foregroundStyle(enoughMinutes ? PL.text400 : PL.warningText)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard()
    }

    /// The kept window's length — what the charge is quoted on. The
    /// server recomputes the same number at claim time, so this label can
    /// only ever be wrong in the direction of an error message.
    private var keptSeconds: Double? {
        guard let duration = current.durationS else { return nil }
        return max(0, (trimEnd ?? duration) - trimStart)
    }

    private var trimmed: Bool {
        guard let duration = current.durationS else { return false }
        return trimStart > 0.5 || (trimEnd.map { $0 < duration - 0.5 } ?? false)
    }

    private var minutesCharge: Int? {
        keptSeconds.map { max(1, Int(ceil($0 / 60))) }
    }

    private var chargeLabel: String {
        minutesCharge.map { "Process · \($0) min" } ?? "Process"
    }

    private var enoughMinutes: Bool {
        guard let charge = minutesCharge, let balance = model.minutesBalance else { return true }
        return balance >= charge
    }

    private func runProcess() async {
        processBusy = true
        processError = await model.process(
            current, placement: placementOn,
            trimStart: trimmed ? trimStart : nil,
            trimEnd: trimmed ? trimEnd : nil,
            strictness: strictness
        )
        if processError == nil {
            if let fresh = await model.refetchMatch(current.id) {
                live = fresh
            }
            watchKick += 1
        }
        processBusy = false
    }

    /// Poll the running job the way the web does, and flip this page to
    /// the full match view the moment processing lands.
    private func watchProcessing() async {
        while !Task.isCancelled, model.jobRunning {
            try? await Task.sleep(for: .seconds(8))
            guard !Task.isCancelled else { return }
            await model.refreshJob()
            guard let job = model.job else { return }
            if job.status == "done" || job.status == "failed" {
                if let fresh = await model.refetchMatch(match.id) {
                    live = fresh
                    if fresh.status == .ready {
                        await model.load(fresh)
                    }
                }
                return
            }
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
                        authorName: notesStore.authorNames[note.authorId],
                        notesStore: notesStore
                    )
                }
                NoteComposerView(
                    matchId: current.id,
                    pointId: nil,
                    userId: app.userId ?? current.userId,
                    notesStore: notesStore,
                    placeholder: "How did the match go?"
                )
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .plCard()
        }
        .id("overall-notes")
    }

    // MARK: - Points

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
                            Button("Game \(start.game)") {
                                pointsExpanded = true
                                withAnimation {
                                    proxy.scrollTo(start.id, anchor: .center)
                                }
                            }
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(PL.text400)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 4)
                            .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
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
                        .id(point.id)
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

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            SectionHeading("Winner")
            segmentRow(WinnerFilter.allCases, selection: $winner)
            SectionHeading("Only")
            segmentRow(OnlyFilter.allCases, selection: $only)
            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func segmentRow<T: RawRepresentable & CaseIterable & Hashable>(
        _ options: T.AllCases, selection: Binding<T>
    ) -> some View where T.RawValue == String {
        HStack(spacing: 8) {
            ForEach(Array(options), id: \.self) { option in
                let active = selection.wrappedValue == option
                Button(option.rawValue) {
                    selection.wrappedValue = option
                }
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(active ? PL.cyan : PL.text500)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(active ? PL.cyan.opacity(0.15) : .clear, in: Capsule())
                .overlay(
                    Capsule().strokeBorder(active ? PL.cyan.opacity(0.5) : PL.edge, lineWidth: 1)
                )
                .buttonStyle(.plain)
            }
        }
    }
}

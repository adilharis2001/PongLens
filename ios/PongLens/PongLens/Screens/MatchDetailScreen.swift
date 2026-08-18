import SwiftUI
import Supabase

@Observable
final class MatchDetailModel {
    var points: [MatchPoint] = []
    var videoURL: URL?
    var loaded = false
    var error: String?

    /// The visible timeline: non-deleted, ordered by source time (idx tiebreak).
    var visible: [MatchPoint] {
        points
            .filter { !$0.deleted }
            .sorted { a, b in
                if let ta = a.t0, let tb = b.t0, ta != tb { return ta < tb }
                return a.idx < b.idx
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
            var raw: Bool?
        }
        struct Res: Decodable { let url: String? }
        do {
            let ready = match.status == .ready
            let res: Res = try await API.post(
                "api/media-url",
                Req(
                    matchId: match.id.uuidString.lowercased(),
                    preview: ready ? true : nil,
                    raw: ready ? nil : true
                )
            )
            videoURL = res.url.flatMap(URL.init)
        } catch {
            // Hero stays a poster; playback reports its own error.
        }
        loaded = true
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

    /// Optimistic column-scoped patch with rollback — the whole scorer
    /// write surface goes through here.
    func patch(
        _ point: MatchPoint,
        fields: [String: AnyJSON],
        apply: (inout MatchPoint) -> Void
    ) async {
        guard let i = points.firstIndex(where: { $0.id == point.id }) else { return }
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
        } catch {
            points[i] = before
        }
    }

    /// Winner tap: toggles — tapping the side already shown clears it.
    /// One atomic patch; is_let and a winner never coexist (DB constraint).
    func tapWinner(_ point: MatchPoint, _ side: Winner) async {
        if point.confirmedWinner == side {
            await patch(
                point,
                fields: ["confirmed_winner": .null, "scored_at_cut_s": .null]
            ) {
                $0.confirmedWinner = nil
                $0.scoredAtCutS = nil
            }
        } else {
            await patch(
                point,
                fields: [
                    "confirmed_winner": .string(side.rawValue),
                    "is_let": .bool(false),
                ]
            ) {
                $0.confirmedWinner = side
                $0.isLet = false
            }
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

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(MediaStore.self) private var media
    @Environment(Router.self) private var router
    @State private var model = MatchDetailModel()
    @State private var playerStartAt: Double?
    @State private var playerOpen = false
    @State private var pointSheetOpen = false
    @State private var pointSheetIndex = 0
    @State private var pointsExpanded = false
    @State private var showGamesDetail = false
    @State private var filtersOpen = false
    @State private var winnerFilter: WinnerFilter = .anyone
    @State private var onlyFilter: OnlyFilter = .everything

    private let pointsPreview = 10

    private var pad: ClipPad {
        clipPad(strictness: nil, stored: match.clipPads)
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
            firstServer: match.firstServer.flatMap(Winner.init(rawValue:))
        )
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
            opponentName: match.opponentName, venue: match.venue,
            playedAt: match.playedAt, matchType: match.matchType
        )
        ZStack {
            ArenaBackground()
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
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

                        header(parts)

                        if let error = model.error {
                            Text(error)
                                .font(.plCaption)
                                .foregroundStyle(PL.dangerText)
                                .plCard(padding: 14)
                        }

                        hero

                        if match.status == .ready {
                            ToolsSection(
                                match: match,
                                model: model,
                                score: score,
                                onOpenPlayer: {
                                    playerStartAt = nil
                                    playerOpen = true
                                }
                            )
                            pointsSection(proxy: proxy)
                        } else {
                            rawStatus
                        }
                    }
                    .padding(20)
                    .padding(.bottom, 100)
                }
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task {
            await model.load(match)
            #if DEBUG
            if router.devOpenPlayer, model.videoURL != nil {
                router.devOpenPlayer = false
                playerOpen = true
            }
            if let n = router.devOpenPoint, model.visible.indices.contains(n - 1) {
                router.devOpenPoint = nil
                pointSheetIndex = n - 1
                pointSheetOpen = true
            }
            #endif
        }
        .fullScreenCover(isPresented: $playerOpen) {
            if let url = model.videoURL {
                PlayerTakeover(
                    points: model.visible,
                    pad: pad,
                    videoURL: url,
                    startAt: playerStartAt
                )
            }
        }
        .sheet(isPresented: $pointSheetOpen) {
            PointDetailScreen(
                match: match,
                model: model,
                index: $pointSheetIndex,
                onOpenInMatch: { cutT0 in
                    playerStartAt = cutT0
                    playerOpen = true
                }
            )
        }
        .sheet(isPresented: $filtersOpen) {
            PointFilterSheet(winner: $winnerFilter, only: $onlyFilter)
                .presentationDetents([.medium])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
    }

    // MARK: - Header

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
                if score.confirmedCount > 0 {
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
                playerStartAt = nil
                playerOpen = true
            } label: {
                Color.clear
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .overlay(MatchThumb(url: media.thumbURL(match.id)))
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
                    Text("Full video")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(PL.textBody)
                    Text("Playtime only")
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                }
                Spacer()
                Button {
                    Task {
                        if let url = await model.downloadURL(match) {
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
            .padding(16)
        }
        .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                .strokeBorder(PL.edge, lineWidth: 1)
        )
    }

    private var rawStatus: some View {
        VStack(alignment: .leading, spacing: 10) {
            StatusChip(status: match.chipStatus)
            if match.status == .processing {
                Text("You can leave this page. We email you when the match is ready.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
            } else if match.status == .failed {
                Text("Processing failed, and your minutes came back.")
                    .font(.plBody)
                    .foregroundStyle(PL.warningText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard()
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

            if gameStarts.count > 1, !filtersActive {
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
                VStack(spacing: 10) {
                    ForEach(shown) { point in
                        let number = (model.visible.firstIndex(of: point) ?? 0) + 1
                        PointCard(
                            point: point,
                            number: number,
                            displayServer: serving[point.id]?.server ?? point.displayServer,
                            onOpen: {
                                if let i = model.visible.firstIndex(of: point) {
                                    pointSheetIndex = i
                                    pointSheetOpen = true
                                }
                            },
                            onYou: { Task { await model.tapWinner(point, .user) } },
                            onThem: { Task { await model.tapWinner(point, .opponent) } },
                            onSkip: { Task { await model.tapSkip(point) } },
                            onStar: { Task { await model.toggleStar(point) } },
                            onDelete: { Task { await model.softDelete(point) } }
                        )
                        .id(point.id)
                        if !filtersActive, let boundary = score.boundaryAfter[point.id] {
                            Text("Game \(boundary.game) ends \(boundary.you)-\(boundary.them) · game \(boundary.game + 1) begins")
                                .font(.plCaption)
                                .monospacedDigit()
                                .foregroundStyle(PL.text500)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 2)
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

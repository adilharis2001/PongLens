import AVFoundation
import SwiftUI
import Supabase

/// The per-point view (web PointSheet): clip, actions, scorecard,
/// placement, notes. Presented as a sheet over the match screen.
struct PointDetailScreen: View {
    let match: MatchRow
    let model: MatchDetailModel
    @Binding var index: Int
    let onOpenInMatch: (Double) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    @State private var notesStore = NotesStore()
    @State private var clipURLs: [UUID: URL] = [:]
    @State private var noteDraft = ""
    @State private var sendingNote = false
    @State private var shareItem: URL?

    private var points: [MatchPoint] { model.visible }

    private var point: MatchPoint? {
        points.indices.contains(index) ? points[index] : nil
    }

    /// Running score as of this point (the web header's colored pair).
    private var runningScore: GameSummary {
        computeMatchScore(Array(points.prefix(index + 1)).map {
            PointRow(
                id: $0.id, matchId: $0.matchId, idx: $0.idx, t0: $0.t0,
                confirmedWinner: $0.confirmedWinner, isLet: $0.isLet,
                deleted: $0.deleted, gameEndOverride: $0.gameEndOverride,
                gameWinnerOverride: $0.gameWinnerOverride
            )
        }).current
    }

    private var iServed: Bool? {
        guard let point else { return nil }
        let serving = computeServing(
            points, firstServer: match.firstServer.flatMap(Winner.init(rawValue:))
        )
        guard let server = serving[point.id]?.server ?? point.displayServer else { return nil }
        return server == .user
    }

    var body: some View {
        ZStack {
            PL.surface.ignoresSafeArea()
            if let point {
                VStack(spacing: 0) {
                    header(point)
                    Rectangle().fill(PL.edge.opacity(0.7)).frame(height: 1)
                    ScrollViewReader { proxy in
                        ScrollView {
                            VStack(alignment: .leading, spacing: 16) {
                                ClipPlayerView(
                                    url: clipURLs[point.id],
                                    starred: point.starred,
                                    hasPrev: index > 0,
                                    hasNext: index < points.count - 1,
                                    onStar: { Task { await model.toggleStar(point) } },
                                    onPrev: { index = max(0, index - 1) },
                                    onNext: { index = min(points.count - 1, index + 1) }
                                )
                                actionBar(point)
                                scorecard(point)
                                placementSection(point)
                                notesSection(point)
                                    .id("notes")
                            }
                            .padding(16)
                            .padding(.bottom, 40)
                        }
                        #if DEBUG
                        .onAppear {
                            if ProcessInfo.processInfo.arguments.contains("--dev-scroll-point-bottom") {
                                DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                                    withAnimation { proxy.scrollTo("notes", anchor: .bottom) }
                                }
                            }
                        }
                        #endif
                    }
                }
            }
        }
        .task(id: point?.id) {
            await loadClip()
            if !notesStore.loaded {
                await notesStore.load(matchId: match.id)
            }
        }
        .sheet(item: $shareItem) { url in
            ActivityView(items: [url])
                .presentationDetents([.medium])
        }
    }

    // MARK: - Header

    private func header(_ point: MatchPoint) -> some View {
        HStack(spacing: 8) {
            Text("Point \(index + 1)")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(PL.textBody)
            Text("\(index + 1) of \(points.count)")
                .font(.plBody)
                .monospacedDigit()
                .foregroundStyle(PL.text500)
            Spacer()
            (Text("\(runningScore.you)").foregroundColor(PL.cyan)
                + Text("-").foregroundColor(PL.text600)
                + Text("\(runningScore.them)").foregroundColor(PL.magentaSoft))
                .font(.system(size: 15, weight: .semibold))
                .monospacedDigit()
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PL.text300)
                    .frame(width: 34, height: 34)
                    .background(PL.surface2, in: Circle())
                    .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    // MARK: - Action bar

    private func actionBar(_ point: MatchPoint) -> some View {
        HStack(spacing: 0) {
            actionButton("Share", icon: "square.and.arrow.up", tint: PL.cyan) {
                Task { await mintShareLink(point) }
            }
            actionSeparator
            boundaryButton(point)
            actionSeparator
            actionButton("In match", icon: "arrow.up.forward.square", tint: PL.text300) {
                if let cutT0 = point.cutT0 {
                    dismiss()
                    onOpenInMatch(cutT0)
                }
            }
            actionSeparator
            actionButton("Remove", icon: "trash", tint: PL.dangerText) {
                Task {
                    await model.softDelete(point)
                    dismiss()
                }
            }
        }
        .frame(maxWidth: .infinity)
        .plCard(padding: 6)
    }

    private var actionSeparator: some View {
        Rectangle().fill(PL.edge.opacity(0.6)).frame(width: 1, height: 40)
    }

    private func actionButton(
        _ label: String, icon: String, tint: Color, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 15, weight: .medium))
                Text(label).font(.system(size: 11, weight: .medium))
            }
            .foregroundStyle(tint)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
        }
        .buttonStyle(.plain)
    }

    private func boundaryButton(_ point: MatchPoint) -> some View {
        let endsHere = boundaryEndsHere(point)
        let action = boundaryAction(override: point.gameEndOverride, walkEndsHere: endsHere)
        return actionButton(action.label, icon: "flag", tint: PL.text300) {
            Task { await model.setBoundary(point, next: action.next) }
        }
    }

    private func boundaryEndsHere(_ point: MatchPoint) -> Bool {
        let score = computeMatchScore(points.map {
            PointRow(
                id: $0.id, matchId: $0.matchId, idx: $0.idx, t0: $0.t0,
                confirmedWinner: $0.confirmedWinner, isLet: $0.isLet,
                deleted: $0.deleted, gameEndOverride: $0.gameEndOverride,
                gameWinnerOverride: $0.gameWinnerOverride
            )
        })
        return score.boundaryAfter[point.id] != nil
    }

    // MARK: - Scorecard

    @ViewBuilder
    private func scorecard(_ point: MatchPoint) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 10) {
                Text("Who served?")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PL.text200)
                HStack(spacing: 10) {
                    bigChoice("Me", selected: iServed == true) {
                        Task { await model.setServerOverride(point, .user) }
                    }
                    bigChoice("Them", selected: iServed == false) {
                        Task { await model.setServerOverride(point, .opponent) }
                    }
                }
            }

            VStack(alignment: .leading, spacing: 10) {
                Text("Who won this point?")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PL.text200)
                HStack(spacing: 10) {
                    bigChoice("Me", selected: point.confirmedWinner == .user) {
                        Task { await model.tapWinner(point, .user) }
                    }
                    bigChoice("Them", selected: point.confirmedWinner == .opponent) {
                        Task { await model.tapWinner(point, .opponent) }
                    }
                    bigChoice("Skip", selected: point.isLet) {
                        Task { await model.tapSkip(point) }
                    }
                }
            }

            if hasLossAnalysis(point) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Why did you lose it?")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(PL.text200)
                    if let iServed {
                        Text(iServed ? "YOU SERVED" : "THEY SERVED")
                            .font(.plSection)
                            .tracking(0.6)
                            .foregroundStyle(PL.text500)
                    }
                    reasonWrap(lossReasonsFor(iServed: iServed), selected: Set(point.lossReasons ?? [])) { value in
                        Task { await model.toggleReason(point, value) }
                    }
                }

                if misreadKindApplies(point.lossReasons) {
                    followUp("What got you?", chips: MISREAD_KINDS, selected: point.misreadKind) { value in
                        Task { await model.setMisreadKind(point, point.misreadKind == value ? nil : value) }
                    }
                }
                if outOfPositionApplies(point.lossReasons) {
                    followUp("Where did they get you?", chips: DIRECTIONS, selected: point.direction) { value in
                        Task { await model.setDirection(point, point.direction == value ? nil : value) }
                    }
                }
                if serveApplies(point.lossReasons) {
                    followUp("Which serve beat you?", chips: SERVE_SPINS, selected: point.serveSpin) { value in
                        Task { await model.setServeSpin(point, point.serveSpin == value ? nil : value) }
                    }
                    HStack(spacing: 8) {
                        reasonChipView("Sidespin", selected: point.serveSidespin == true) {
                            Task { await model.setServeSidespin(point, !(point.serveSidespin ?? false)) }
                        }
                        ForEach(SERVE_LENGTHS) { chip in
                            reasonChipView(chip.label, selected: point.serveLength == chip.value) {
                                Task { await model.setServeLength(point, point.serveLength == chip.value ? nil : chip.value) }
                            }
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard()
    }

    private func followUp(
        _ question: String, chips: [ReasonChip], selected: String?,
        pick: @escaping (String) -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(question)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(PL.text200)
            HStack(spacing: 8) {
                ForEach(chips) { chip in
                    reasonChipView(chip.label, selected: selected == chip.value) {
                        pick(chip.value)
                    }
                }
            }
        }
    }

    private func reasonWrap(
        _ chips: [ReasonChip], selected: Set<String>, pick: @escaping (String) -> Void
    ) -> some View {
        FlowLayout(spacing: 8) {
            ForEach(chips) { chip in
                reasonChipView(chip.label, selected: selected.contains(chip.value)) {
                    pick(chip.value)
                }
            }
        }
    }

    private func reasonChipView(
        _ label: String, selected: Bool, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(selected ? PL.cyan : PL.text300)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(selected ? PL.cyan.opacity(0.15) : .clear, in: Capsule())
                .overlay(
                    Capsule().strokeBorder(selected ? PL.cyan.opacity(0.6) : PL.edge, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    private func bigChoice(_ label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(selected ? PL.cyan : PL.text300)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(
                    selected ? PL.cyan.opacity(0.12) : PL.ink.opacity(0.4),
                    in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                        .strokeBorder(selected ? PL.cyan.opacity(0.7) : PL.edge, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Placement

    @ViewBuilder
    private func placementSection(_ point: MatchPoint) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text("Where the ball landed")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PL.text200)
                Text("BETA")
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(0.5)
                    .foregroundStyle(PL.warningText.opacity(0.9))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(PL.warning.opacity(0.1), in: Capsule())
                    .overlay(Capsule().strokeBorder(PL.warning.opacity(0.25), lineWidth: 1))
            }
            if let placement = point.placement {
                PlacementMapView(
                    placement: placement,
                    userSide: match.userSide,
                    opponentLabel: match.opponentName ?? "Them",
                    flagged: point.placementFlagged ?? false,
                    onFlagToggle: { Task { await model.togglePlacementFlag(point) } }
                )
            } else if match.userSide == nil {
                Text("Tell us which side you played to orient the placement maps.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
            } else {
                Text("No high-confidence placement data is available for this match yet.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard()
    }

    // MARK: - Notes

    private func notesSection(_ point: MatchPoint) -> some View {
        let pointNotes = notesStore.notes.filter { $0.pointId == point.id }
        return VStack(alignment: .leading, spacing: 12) {
            Text("Notes")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(PL.text200)

            if pointNotes.isEmpty {
                Text("No notes on this point yet.")
                    .font(.plBody)
                    .foregroundStyle(PL.text500)
            } else {
                ForEach(pointNotes) { note in
                    noteItem(note)
                }
            }

            HStack(spacing: 10) {
                TextField("Add a note about this point", text: $noteDraft, axis: .vertical)
                    .plField()
                    .lineLimit(1...4)
                Button {
                    Task { await sendNote(point) }
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(PL.ink)
                        .frame(width: 44, height: 44)
                        .background(
                            noteDraft.trimmingCharacters(in: .whitespaces).isEmpty
                                ? AnyShapeStyle(PL.text600) : AnyShapeStyle(PL.cyan),
                            in: Circle()
                        )
                }
                .buttonStyle(.plain)
                .disabled(sendingNote || noteDraft.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func noteItem(_ note: NoteRow) -> some View {
        let mine = note.authorId == app.userId
        let author = mine ? "You" : (notesStore.authorNames[note.authorId] ?? "Coach")
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(author)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(mine ? PL.text400 : Color(hex: 0xF0C420))
                Text("· \(PGDate.shortDate(note.createdAt))")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
            }
            Text(note.body)
                .font(.plBody)
                .foregroundStyle(PL.text200)
                .lineSpacing(3)
        }
        .padding(.leading, 12)
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 1)
                .fill(mine ? PL.edge : Color(hex: 0xF0C420).opacity(0.7))
                .frame(width: 3)
        }
    }

    // MARK: - Data

    private func loadClip() async {
        guard let point, clipURLs[point.id] == nil else { return }
        struct Req: Encodable {
            let matchId: String
            let pointId: String
        }
        struct Res: Decodable { let url: String? }
        let res: Res? = try? await API.post(
            "api/media-url",
            Req(
                matchId: match.id.uuidString.lowercased(),
                pointId: point.id.uuidString.lowercased()
            )
        )
        if let url = res?.url.flatMap(URL.init) {
            clipURLs[point.id] = url
        }
    }

    private func sendNote(_ point: MatchPoint) async {
        guard let uid = app.userId else { return }
        let body = noteDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        sendingNote = true
        let ok = await notesStore.add(matchId: match.id, pointId: point.id, authorId: uid, body: body)
        if ok { noteDraft = "" }
        sendingNote = false
    }

    private func mintShareLink(_ point: MatchPoint) async {
        struct Req: Encodable {
            let matchId: String
            let pointId: String
        }
        struct Res: Decodable { let url: String }
        let res: Res? = try? await API.post(
            "api/share",
            Req(
                matchId: match.id.uuidString.lowercased(),
                pointId: point.id.uuidString.lowercased()
            )
        )
        if let url = res.flatMap({ URL(string: $0.url) }) {
            shareItem = url
        }
    }
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}

/// System share sheet.
struct ActivityView: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

// MARK: - Clip player

struct ClipPlayerView: View {
    let url: URL?
    let starred: Bool
    let hasPrev: Bool
    let hasNext: Bool
    let onStar: () -> Void
    let onPrev: () -> Void
    let onNext: () -> Void

    @State private var player = AVPlayer()
    @State private var progress: Double = 0
    @State private var rate: Float = 1
    @State private var observer: Any?

    var body: some View {
        ZStack {
            Color.black
            if url != nil {
                PlayerLayerView(player: player)
            } else {
                ProgressView().tint(PL.cyan)
            }

            Color.clear
                .contentShape(Rectangle())
                .onTapGesture {
                    if player.rate > 0 { player.pause() } else { player.play() }
                }

            VStack {
                HStack {
                    Spacer()
                    Button(action: onStar) {
                        Image(systemName: starred ? "star.fill" : "star")
                            .font(.system(size: 14))
                            .foregroundStyle(starred ? Color(hex: 0xFFD230) : PL.text300)
                            .frame(width: 34, height: 34)
                            .background(PL.ink.opacity(0.65), in: Circle())
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
                HStack {
                    if hasPrev { chevron("chevron.left", action: onPrev) }
                    Spacer()
                    Button {
                        rate = rate == 1 ? 0.5 : rate == 0.5 ? 0.25 : 1
                        if player.rate > 0 { player.rate = rate }
                    } label: {
                        Text(rate == 1 ? "1x" : rate == 0.5 ? "0.5x" : "0.25x")
                            .font(.system(size: 12, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(PL.text200)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(PL.ink.opacity(0.65), in: Capsule())
                    }
                    .buttonStyle(.plain)
                    if hasNext { chevron("chevron.right", action: onNext) }
                }
                .padding(.bottom, 6)
            }
            .padding(8)
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .overlay(alignment: .bottom) {
            GeometryReader { geo in
                Rectangle()
                    .fill(PL.cyan)
                    .frame(width: geo.size.width * progress, height: 3)
                    .frame(maxHeight: .infinity, alignment: .bottom)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                .strokeBorder(PL.edge, lineWidth: 1)
        )
        .task(id: url) {
            guard let url else { return }
            if observer == nil {
                observer = player.addPeriodicTimeObserver(
                    forInterval: CMTime(seconds: 0.2, preferredTimescale: 600),
                    queue: .main
                ) { time in
                    Task { @MainActor in
                        let duration = player.currentItem?.duration.seconds ?? 0
                        if duration.isFinite, duration > 0 {
                            progress = min(1, max(0, time.seconds / duration))
                        }
                    }
                }
            }
            player.replaceCurrentItem(with: AVPlayerItem(url: url))
            player.play()
            player.rate = rate
        }
        .onDisappear {
            if let observer { player.removeTimeObserver(observer) }
            observer = nil
            player.pause()
        }
    }

    private func chevron(_ name: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: name)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(PL.text200)
                .frame(width: 38, height: 38)
                .background(PL.ink.opacity(0.65), in: Circle())
        }
        .buttonStyle(.plain)
    }
}

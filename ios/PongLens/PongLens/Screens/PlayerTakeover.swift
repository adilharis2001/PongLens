import AVFoundation
import SwiftUI
import Supabase

enum PlayerMode {
    case watch, score
}

enum ScorePhase {
    case play, summary, review
}

/// The full-screen takeover: watch mode with the web's gestures, and Keep
/// score — ticker, chip strip, winner buttons, auto-pause at each rally's
/// end with the web's tuned rules (PAUSE_BEAT 1.2, re-arm 1.5, play guard
/// 500 ms, tail watch 3.5).
struct PlayerTakeover: View {
    let match: MatchRow
    let model: MatchDetailModel
    let pad: ClipPad
    let videoURL: URL
    var startAt: Double?
    var mode: PlayerMode = .watch
    /// The pad's Analysis panel needs the owner's own reason pills.
    var reasonsStore: CustomReasonsStore?
    /// Details: leave the pad and open this point's sheet (0-based index).
    var onOpenPoint: ((Int) -> Void)?

    @Environment(\.dismiss) private var dismiss
    @State private var player = AVPlayer()
    @State private var currentT: Double = 0
    @State private var lastTick: Double?
    @State private var duration: Double = 0
    @State private var isPlaying = false
    @State private var chromeVisible = true
    @State private var scrubbing = false
    @State private var scrubT: Double = 0
    @State private var flash: String?
    @State private var observer: Any?

    // Keep score state
    @State private var phase: ScorePhase = .play
    @State private var endPausedId: UUID?
    @State private var endPauseBlockedId: UUID?
    @State private var runStartT: Double = 0
    @State private var lastPlayAt = Date.distantPast
    @State private var undoStack: [MatchPoint] = []
    @State private var setupOpen = false
    @State private var reviewQueue: [UUID] = []
    @State private var reviewIndex = 0
    @State private var firstHintShown = false
    @State private var rate: Float = 1
    @State private var analysisOpen = false
    @State private var modifyPoint: MatchPoint?

    private var points: [MatchPoint] { model.visible }

    /// The single answer for "which rally is on screen": the auto-pause pin
    /// first, then the WYSIWYG resolver.
    private var displayTarget: MatchPoint? {
        if let endPausedId, let pinned = points.first(where: { $0.id == endPausedId }) {
            return pinned
        }
        if phase == .review, reviewQueue.indices.contains(reviewIndex),
           let reviewing = points.first(where: { $0.id == reviewQueue[reviewIndex] }) {
            return reviewing
        }
        guard let id = playingPointId(points, at: currentT) else { return nil }
        return points.first { $0.id == id }
    }

    private var serving: [UUID: ServeInfo] {
        computeServing(points, firstServer: match.firstServer.flatMap(Winner.init(rawValue:)))
    }

    private var runningScore: MatchScore {
        let upTo: [MatchPoint]
        if let target = displayTarget, let i = points.firstIndex(of: target) {
            upTo = Array(points.prefix(i + 1))
        } else {
            upTo = points
        }
        return computeMatchScore(upTo.map {
            PointRow(
                id: $0.id, matchId: $0.matchId, idx: $0.idx, t0: $0.t0,
                confirmedWinner: $0.confirmedWinner, isLet: $0.isLet,
                deleted: $0.deleted, gameEndOverride: $0.gameEndOverride,
                gameWinnerOverride: $0.gameWinnerOverride
            )
        })
    }

    var body: some View {
        GeometryReader { geo in
            VStack(spacing: 0) {
                videoArea(geo)
                if mode == .score, phase == .play {
                    scorePad
                }
            }
            .frame(maxHeight: .infinity, alignment: .top)
            .background(Color.black.ignoresSafeArea())
            .overlay {
                if phase == .summary { summaryOverlay }
            }
        }
        .statusBarHidden()
        .task { await start() }
        .onDisappear {
            if let observer { player.removeTimeObserver(observer) }
            player.pause()
        }
        .sheet(isPresented: $setupOpen) {
            firstServerSheet
                .presentationDetents([.medium])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $analysisOpen) {
            if let target = displayTarget, let reasonsStore {
                PadAnalysisSheet(
                    match: match, model: model, pointId: target.id,
                    reasonsStore: reasonsStore, serving: serving
                )
                .presentationDetents([.medium, .large])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
            }
        }
        .fullScreenCover(item: $modifyPoint) { point in
            ModifySheet(match: match, model: model, point: point, pad: pad)
        }
    }

    // MARK: - Video area

    @ViewBuilder
    private func videoArea(_ geo: GeometryProxy) -> some View {
        let scoreLayout = mode == .score && phase == .play
        ZStack {
            Color.black
            PlayerLayerView(player: player)

            Color.clear
                .contentShape(Rectangle())
                .onTapGesture(count: 2, coordinateSpace: .local) { location in
                    if location.x > geo.size.width / 2 { step(1) } else { step(-1) }
                }
                .onTapGesture { togglePlay() }

            if let flash {
                PLToast(message: flash)
            }

            VStack {
                HStack {
                    if mode == .score, let n = displayNumber {
                        Text("Point \(n)")
                            .font(.plMicro)
                            .monospacedDigit()
                            .foregroundStyle(PL.text300)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(PL.ink.opacity(0.7), in: Capsule())
                    }
                    Spacer()
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(PL.text300)
                            .padding(9)
                            .background(PL.ink.opacity(0.7), in: Circle())
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
                if mode == .watch, chromeVisible {
                    watchTransport
                }
            }
            .padding(12)

            // Next point sits on the footage's right edge — the eyes are
            // on the video, so navigation lives there (web pad parity).
            if scoreLayout {
                HStack {
                    Spacer()
                    Button {
                        step(1)
                    } label: {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(PL.text100)
                            .frame(width: 36, height: 36)
                            .background(PL.ink.opacity(0.6), in: Circle())
                    }
                    .buttonStyle(.plain)
                    .padding(.trailing, 10)
                }
            }

            if mode == .score, phase == .play, endPausedId != nil, !firstHintShown {
                VStack {
                    Spacer()
                    PLToast(message: "Tap who won this point")
                        .padding(.bottom, 12)
                }
                .onAppear {
                    Task {
                        try? await Task.sleep(nanoseconds: 2_500_000_000)
                        firstHintShown = true
                    }
                }
            }
        }
        .aspectRatio(scoreLayout ? 16 / 9 : nil, contentMode: scoreLayout ? .fit : .fill)
        .frame(maxHeight: scoreLayout ? nil : .infinity)
    }

    private var displayNumber: Int? {
        guard let target = displayTarget, let i = points.firstIndex(of: target) else { return nil }
        return i + 1
    }

    private var watchTransport: some View {
        HStack(spacing: 12) {
            Button {
                togglePlay()
            } label: {
                Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 16))
                    .foregroundStyle(.white)
                    .frame(width: 34, height: 34)
            }
            Text(timeString(scrubbing ? scrubT : currentT))
                .font(.plMicro).monospacedDigit().foregroundStyle(PL.text300)
            Slider(
                value: Binding(
                    get: { scrubbing ? scrubT : min(currentT, max(duration, 0.1)) },
                    set: { scrubT = $0 }
                ),
                in: 0...max(duration, 0.1)
            ) { editing in
                scrubbing = editing
                if !editing { seek(to: scrubT) }
            }
            .tint(PL.cyan)
            Text(timeString(duration))
                .font(.plMicro).monospacedDigit().foregroundStyle(PL.text500)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(PL.ink.opacity(0.7), in: Capsule())
    }

    // MARK: - Score pad

    private var scorePad: some View {
        let target = displayTarget
        let score = runningScore
        let serveInfo = target.flatMap { serving[$0.id] }
        return VStack(spacing: 10) {
            // Score row: serve balls at the edges, the big pair centered.
            ZStack {
                HStack {
                    serveBall(active: serveInfo?.server == .user)
                    Spacer()
                    serveBall(active: serveInfo?.server == .opponent, them: true)
                }
                VStack(spacing: 2) {
                    (Text("\(score.current.you)").foregroundColor(PL.cyan)
                        + Text(" - ").foregroundColor(PL.text600)
                        + Text("\(score.current.them)").foregroundColor(PL.magentaSoft))
                        .font(.system(size: 32, weight: .bold))
                        .monospacedDigit()
                    Text(serveLine(serveInfo))
                        .font(.plBody)
                        .foregroundStyle(PL.text400)
                }
            }
            .padding(.horizontal, 8)
            .padding(.top, 2)

            chipStrip(targetId: target?.id)

            // Controls: the web pad's full row.
            HStack(spacing: 6) {
                padControl("Undo", icon: "arrow.uturn.backward", disabled: undoStack.isEmpty) { undo() }
                padControl("Replay", icon: "gobackward") { replayTarget() }
                padControl("Speed", text: rate == 1 ? "1x" : rate == 0.5 ? "0.5x" : "0.25x") {
                    rate = rate == 1 ? 0.5 : rate == 0.5 ? 0.25 : 1
                    if player.rate > 0 { player.rate = rate }
                }
                padControl("Star", icon: target?.starred == true ? "star.fill" : "star") {
                    if let target {
                        undoStack.append(target)
                        Task { await model.toggleStar(target) }
                    }
                }
                boundaryControl(target: target)
                padControl(
                    "Analysis", icon: "doc.text",
                    disabled: target == nil || reasonsStore == nil,
                    lit: target?.confirmedHow != nil || !(target?.lossReasons ?? []).isEmpty
                ) {
                    player.pause()
                    analysisOpen = true
                }
                padControl("Details", icon: "arrow.up.forward.square", disabled: target == nil || onOpenPoint == nil) {
                    guard let target, let i = points.firstIndex(of: target) else { return }
                    dismiss()
                    onOpenPoint?(i)
                }
            }

            // Disposition
            HStack(spacing: 8) {
                dispositionButton("Skip", sub: "let", tint: PL.warning) { tapSkip() }
                dispositionButton("Delete", sub: "dead space", tint: PL.dangerText) { tapDelete() }
                dispositionButton("Modify", sub: "split · join · adjust", tint: PL.cyan) {
                    if let target {
                        player.pause()
                        modifyPoint = target
                    }
                }
            }

            // Winner buttons
            HStack(spacing: 10) {
                winnerButton("Me", tint: PL.cyan, selected: target?.confirmedWinner == .user) {
                    tapWinner(.user)
                }
                winnerButton(
                    match.opponentName ?? "Them", tint: PL.magentaSoft,
                    selected: target?.confirmedWinner == .opponent
                ) {
                    tapWinner(.opponent)
                }
                .overlay(alignment: .topTrailing) {
                    if target?.confirmedWinner == .opponent, reasonsStore != nil {
                        Button {
                            player.pause()
                            analysisOpen = true
                        } label: {
                            Text("Why")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(PL.text100)
                                .frame(width: 54, height: 54)
                                .background(PL.ink.opacity(0.55), in: Circle())
                        }
                        .buttonStyle(.plain)
                        .padding(10)
                    }
                }
            }
            .frame(maxHeight: .infinity)
        }
        .padding(14)
        .frame(maxHeight: .infinity)
        .background(PL.surface.ignoresSafeArea())
    }

    /// The server's ball glows on their side; the other side keeps a quiet
    /// hollow ring, so the row always shows both ends of the rotation.
    private func serveBall(active: Bool, them: Bool = false) -> some View {
        let tint = them ? PL.magentaSoft : PL.cyan
        return Circle()
            .fill(active ? AnyShapeStyle(
                RadialGradient(
                    colors: [Color.white.opacity(0.9), tint],
                    center: .init(x: 0.35, y: 0.3), startRadius: 1, endRadius: 16
                )
            ) : AnyShapeStyle(Color.clear))
            .frame(width: 26, height: 26)
            .overlay {
                if !active {
                    Circle().strokeBorder(PL.edge, lineWidth: 2)
                }
            }
            .shadow(color: active ? tint.opacity(0.7) : .clear, radius: 8)
    }

    private func serveLine(_ info: ServeInfo?) -> String {
        switch info?.server {
        case .user: "You serve"
        case .opponent: "\(match.opponentName ?? "They") serve\(match.opponentName == nil ? "" : "s")"
        case nil: ""
        }
    }

    /// The point ticker: numbered rings colored by winner, the current one
    /// glowing with a playback-progress arc — the web pad's strip.
    private func chipStrip(targetId: UUID?) -> some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(points.enumerated()), id: \.element.id) { i, p in
                        if p.cutT0 != nil {
                            tickerChip(p, number: i + 1, isCurrent: p.id == targetId)
                                .id(p.id)
                        }
                    }
                }
                .padding(.vertical, 5)
                .padding(.horizontal, 2)
            }
            .onChange(of: targetId) { _, id in
                guard let id else { return }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
                    proxy.scrollTo(id, anchor: .center)
                }
            }
        }
    }

    private func tickerChip(_ p: MatchPoint, number: Int, isCurrent: Bool) -> some View {
        let tint = chipTint(p)
        let unscored = p.confirmedWinner == nil && !p.isLet
        // Playback progress through the current point's padded span.
        let progress: Double = {
            guard isCurrent, let cutT0 = p.cutT0,
                  let end = paddedEnd(p, pad), end > cutT0 else { return 0 }
            return min(1, max(0, (currentT - cutT0) / (end - cutT0)))
        }()
        return Button {
            if let cutT0 = p.cutT0 {
                endPausedId = nil
                seek(to: cutT0)
                play()
            }
        } label: {
            ZStack {
                Circle()
                    .fill(tint.opacity(unscored ? 0.04 : 0.16))
                if unscored {
                    Circle().strokeBorder(
                        PL.text600, style: StrokeStyle(lineWidth: 1.5, dash: [3, 3])
                    )
                } else {
                    Circle().strokeBorder(tint.opacity(0.85), lineWidth: 2)
                }
                if isCurrent, progress > 0 {
                    Circle()
                        .trim(from: 0, to: progress)
                        .stroke(.white, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .padding(1)
                }
                Text("\(number)")
                    .font(.system(size: 13, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(unscored ? PL.text400 : tint)
            }
            .frame(width: 36, height: 36)
            .shadow(color: isCurrent ? tint.opacity(0.8) : .clear, radius: 6)
            .scaleEffect(isCurrent ? 1.08 : 1)
        }
        .buttonStyle(.plain)
    }

    private func chipTint(_ p: MatchPoint) -> Color {
        if p.isLet { return PL.warning }
        switch p.confirmedWinner {
        case .user: return PL.cyan
        case .opponent: return PL.magentaSoft
        case nil: return PL.text500
        }
    }

    private func padControl(
        _ label: String, icon: String? = nil, text: String? = nil,
        disabled: Bool = false, lit: Bool = false, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                if let icon {
                    Image(systemName: icon).font(.system(size: 14, weight: .medium))
                        .frame(height: 16)
                } else if let text {
                    Text(text).font(.system(size: 13, weight: .bold)).monospacedDigit()
                        .frame(height: 16)
                }
                Text(label)
                    .font(.system(size: 9, weight: .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            .foregroundStyle(disabled ? PL.text600 : lit ? PL.cyan : PL.text300)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(PL.ink.opacity(0.4), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(lit ? PL.cyan.opacity(0.4) : PL.edge, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }

    private func boundaryControl(target: MatchPoint?) -> some View {
        let endsHere = target.map { runningScore.boundaryAfter[$0.id] != nil } ?? false
        let action = boundaryAction(override: target?.gameEndOverride, walkEndsHere: endsHere)
        return padControl(action.label, icon: "flag", disabled: target == nil) {
            guard let target else { return }
            Task { await model.setBoundary(target, next: action.next) }
            showFlash(action.label == "Game ended" ? "Game ended" : "Game continues")
        }
    }

    private func dispositionButton(
        _ label: String, sub: String, tint: Color, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Text(label).font(.system(size: 13, weight: .semibold))
                Text(sub).font(.system(size: 10)).opacity(0.7)
            }
            .foregroundStyle(tint)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(PL.ink.opacity(0.4), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(tint.opacity(0.35), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func winnerButton(
        _ label: String, tint: Color, selected: Bool, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 26, weight: .bold))
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(
                    tint.opacity(selected ? 0.28 : 0.06),
                    in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                        .strokeBorder(tint.opacity(selected ? 0.9 : 0.35), lineWidth: selected ? 2 : 1)
                )
                .shadow(color: selected ? tint.opacity(0.45) : .clear, radius: 14)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Summary / review

    private var summaryOverlay: some View {
        let score = computeMatchScore(points.map {
            PointRow(
                id: $0.id, matchId: $0.matchId, idx: $0.idx, t0: $0.t0,
                confirmedWinner: $0.confirmedWinner, isLet: $0.isLet,
                deleted: $0.deleted, gameEndOverride: $0.gameEndOverride,
                gameWinnerOverride: $0.gameWinnerOverride
            )
        })
        let unscored = points.filter { !$0.isLet && $0.confirmedWinner == nil && $0.cutT0 != nil }
        let starred = points.filter(\.starred).count
        return ZStack {
            PL.ink.opacity(0.8).ignoresSafeArea()
            VStack(spacing: 14) {
                Text(score.confirmedCount == 0
                    ? "No points scored"
                    : "\(score.gamesYou)-\(score.gamesThem) · " + score.games.map { "\($0.you)-\($0.them)" }.joined(separator: " "))
                    .font(.system(size: 20, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(PL.text100)
                if !unscored.isEmpty {
                    HStack(spacing: 10) {
                        Text("\(unscored.count) unscored")
                            .font(.plBody)
                            .foregroundStyle(PL.text400)
                        Button("Review") { startReview(unscored.map(\.id)) }
                            .buttonStyle(PLCyanGhostButtonStyle())
                    }
                }
                if starred > 0 {
                    Text("\(starred) starred")
                        .font(.plBody)
                        .foregroundStyle(PL.text400)
                }
                Button("Done") { dismiss() }
                    .buttonStyle(PLPrimaryButtonStyle())
            }
            .padding(28)
            .frame(maxWidth: 320)
            .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            )
        }
    }

    private func startReview(_ ids: [UUID]) {
        reviewQueue = ids
        reviewIndex = 0
        phase = .review
        seekToReview()
    }

    private func seekToReview() {
        guard reviewQueue.indices.contains(reviewIndex),
              let p = points.first(where: { $0.id == reviewQueue[reviewIndex] }),
              let cutT0 = p.cutT0 else {
            phase = .summary
            return
        }
        seek(to: cutT0)
        play()
    }

    // MARK: - First server sheet

    private var firstServerSheet: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Who served first?")
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                Text("Sets the serve rotation for the whole match.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
            }
            HStack(spacing: 10) {
                firstServerButton("Me", value: "user")
                firstServerButton(match.opponentName ?? "Them", value: "opponent")
            }
            Button("Skip") { setupOpen = false; play() }
                .font(.plCaption)
                .foregroundStyle(PL.text500)
                .buttonStyle(.plain)
            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func firstServerButton(_ label: String, value: String) -> some View {
        Button(label) {
            Task {
                _ = try? await supa
                    .from("matches")
                    .update([
                        "first_server": AnyJSON.string(value),
                        "first_server_source": AnyJSON.string("user"),
                    ])
                    .eq("id", value: match.id.uuidString.lowercased())
                    .execute()
            }
            setupOpen = false
            play()
        }
        .font(.system(size: 15, weight: .semibold))
        .foregroundStyle(PL.cyan)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 13)
        .background(PL.cyan.opacity(0.1), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                .strokeBorder(PL.cyan.opacity(0.5), lineWidth: 1)
        )
        .buttonStyle(.plain)
    }

    // MARK: - Scoring actions

    private func tapWinner(_ side: Winner) {
        guard let target = displayTarget else { return }
        let isNew = target.confirmedWinner == nil && !target.isLet
        undoStack.append(target)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        Task {
            await model.tapWinner(
                target, side,
                scoredAt: phase == .play && isNew ? currentT : nil
            )
        }
        endPausedId = nil
        if phase == .review {
            Task {
                try? await Task.sleep(nanoseconds: 400_000_000)
                reviewIndex += 1
                seekToReview()
            }
            return
        }
        guard isNew else { return }
        advance(from: target)
    }

    private func tapSkip() {
        guard let target = displayTarget else { return }
        let wasSkipped = target.isLet
        let isNew = target.confirmedWinner == nil && !target.isLet
        undoStack.append(target)
        if wasSkipped {
            jumpAfter(target)
            return
        }
        Task { await model.tapSkip(target) }
        showFlash("Skipped")
        endPausedId = nil
        if isNew { advance(from: target) }
    }

    private func tapDelete() {
        guard let target = displayTarget else { return }
        undoStack.append(target)
        Task { await model.softDelete(target) }
        showFlash("Removed")
        endPausedId = nil
        jumpAfter(target)
    }

    /// A NEW answer advances; changing an existing one never does. When the
    /// clip has more than TAIL_WATCH_S left, play it out; otherwise jump.
    private func advance(from p: MatchPoint) {
        if let end = paddedEnd(p, pad), end - currentT > 3.5 {
            play()
        } else {
            jumpAfter(p)
        }
    }

    private func jumpAfter(_ p: MatchPoint) {
        if let next = nextCutStart(points, after: p) {
            seek(to: next)
            play()
        } else {
            play()
        }
    }

    private func replayTarget() {
        guard let target = displayTarget, let cutT0 = target.cutT0 else { return }
        endPausedId = nil
        seek(to: cutT0)
        play()
    }

    private func undo() {
        guard let snapshot = undoStack.popLast() else { return }
        Task { await model.restore(snapshot) }
        if let cutT0 = snapshot.cutT0 {
            endPausedId = nil
            seek(to: cutT0)
            play()
        }
    }

    // MARK: - Playback plumbing

    private func start() async {
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        try? AVAudioSession.sharedInstance().setActive(true)

        player.replaceCurrentItem(with: AVPlayerItem(url: videoURL))
        NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: player.currentItem, queue: .main
        ) { _ in
            Task { @MainActor in
                if mode == .score { phase = .summary }
            }
        }
        observer = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.2, preferredTimescale: 600),
            queue: .main
        ) { time in
            Task { @MainActor in tick(time.seconds) }
        }

        if mode == .score {
            // Resume from the first unscored point, snapped to its padded start.
            let target = startAt ?? points.first {
                !$0.isLet && $0.confirmedWinner == nil && $0.cutT0 != nil
            }?.cutT0
            if let target { seek(to: target) }
            if match.firstServer == nil {
                setupOpen = true
                return
            }
        } else if let startAt {
            seek(to: startAt)
        }
        play()
    }

    private func tick(_ t: Double) {
        defer { lastTick = t }
        currentT = t
        isPlaying = player.rate > 0
        if duration == 0, let d = player.currentItem?.duration.seconds, d.isFinite, d > 0 {
            duration = d
        }

        guard mode == .score, isPlaying, !scrubbing else { return }
        guard let prev = lastTick, t > prev, t - prev < 1 else { return }

        if phase == .review {
            // Review clips stop at their padded end.
            if reviewQueue.indices.contains(reviewIndex),
               let p = points.first(where: { $0.id == reviewQueue[reviewIndex] }),
               let end = paddedEnd(p, pad), t >= end {
                player.pause()
            }
            return
        }
        guard phase == .play else { return }

        // Re-arm: dipping well before the blocked boundary clears the block.
        if let blockedId = endPauseBlockedId,
           let blocked = points.first(where: { $0.id == blockedId }),
           let end = rallyEnd(blocked, pad), t < end - 1.5 {
            endPauseBlockedId = nil
        }

        // Pause-at-point-end for the unscored rally whose stop lies in this tick.
        guard Date().timeIntervalSince(lastPlayAt) > 0.5 else { return }
        for p in points {
            guard !p.isLet, p.confirmedWinner == nil, p.cutT0 != nil else { continue }
            guard let stop = pauseEnd(p, pad, nextStart: nextCutStart(points, after: p)) else { continue }
            if prev < stop, t >= stop {
                guard endPauseBlockedId != p.id else { continue }
                guard let end = rallyEnd(p, pad), runStartT <= end else { continue }
                player.pause()
                endPausedId = p.id
                endPauseBlockedId = p.id
                break
            }
        }
    }

    private func togglePlay() {
        if player.rate > 0 {
            player.pause()
            chromeVisible = true
        } else {
            play()
            withAnimation(.easeOut(duration: 0.18)) { chromeVisible.toggle() }
        }
    }

    private func play() {
        lastPlayAt = Date()
        runStartT = currentT
        endPausedId = nil
        lastTick = nil
        player.play()
        if rate != 1 { player.rate = rate }
    }

    private func seek(to seconds: Double) {
        lastTick = nil
        player.seek(
            to: CMTime(seconds: max(0, seconds), preferredTimescale: 600),
            toleranceBefore: .zero, toleranceAfter: .zero
        )
        currentT = max(0, seconds)
    }

    private func step(_ direction: Int) {
        let withStarts = points.filter { $0.cutT0 != nil }
        guard !withStarts.isEmpty else { return }
        let currentId = playingPointId(points, at: currentT)
        var index: Int
        if let currentId, let i = withStarts.firstIndex(where: { $0.id == currentId }) {
            index = i + direction
        } else {
            index = direction > 0 ? 0 : withStarts.count - 1
        }
        index = max(0, min(withStarts.count - 1, index))
        let target = withStarts[index]
        guard let cutT0 = target.cutT0 else { return }
        endPausedId = nil
        seek(to: cutT0)
        play()
        if let n = points.firstIndex(of: target) {
            showFlash(direction > 0 ? "Next · point \(n + 1)" : "Back · point \(n + 1)")
        }
    }

    private func showFlash(_ message: String) {
        withAnimation { flash = message }
        Task {
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            withAnimation { flash = nil }
        }
    }

    private func timeString(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let s = Int(seconds.rounded())
        return "\(s / 60):" + String(format: "%02d", s % 60)
    }
}

// MARK: - Analysis panel

/// The pad's Analysis door: everything you can record about the point
/// beyond who won it — the same questions the point sheet asks, sliding
/// over the pad so the video never goes anywhere (web's analysis variant).
struct PadAnalysisSheet: View {
    let match: MatchRow
    let model: MatchDetailModel
    let pointId: UUID
    let reasonsStore: CustomReasonsStore
    let serving: [UUID: ServeInfo]

    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    @State private var addingReason = false
    @State private var newReason = ""
    @State private var savingReason = false

    private var point: MatchPoint? {
        model.points.first { $0.id == pointId }
    }

    private var iServed: Bool? {
        guard let point else { return nil }
        guard let server = serving[point.id]?.server ?? point.displayServer else { return nil }
        return server == .user
    }

    var body: some View {
        ScrollView {
            if let point {
                VStack(alignment: .leading, spacing: 18) {
                    HStack {
                        Text("Analysis")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(PL.textBody)
                        Spacer()
                        Button("Done") { dismiss() }
                            .buttonStyle(PLCyanGhostButtonStyle())
                    }

                    if point.isLet {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Why skip it?")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(PL.text200)
                            FlowLayout(spacing: 8) {
                                ForEach(SKIP_REASONS) { chip in
                                    chipView(
                                        chip.label,
                                        selected: canonicalSkipReason(point.confirmedHow) == chip.value
                                    ) {
                                        let next = canonicalSkipReason(point.confirmedHow) == chip.value
                                            ? nil : chip.value
                                        Task { await model.setSkipReason(point, next) }
                                    }
                                }
                            }
                        }
                    } else if point.confirmedWinner == .opponent {
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
                            FlowLayout(spacing: 8) {
                                ForEach(lossReasonsFor(iServed: iServed, custom: reasonsStore.reasons)) { chip in
                                    chipView(
                                        chip.label,
                                        selected: (point.lossReasons ?? []).contains(chip.value)
                                    ) {
                                        Task { await model.toggleReason(point, chip.value) }
                                    }
                                }
                                if !addingReason {
                                    Button {
                                        addingReason = true
                                    } label: {
                                        Text("Enter custom")
                                            .font(.system(size: 13, weight: .medium))
                                            .foregroundStyle(PL.text500)
                                            .padding(.horizontal, 14)
                                            .padding(.vertical, 8)
                                            .overlay(
                                                Capsule().strokeBorder(
                                                    PL.edge,
                                                    style: StrokeStyle(lineWidth: 1, dash: [4, 3])
                                                )
                                            )
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            if addingReason {
                                HStack(spacing: 8) {
                                    TextField("Misread the pips", text: $newReason)
                                        .plField()
                                        .onSubmit { Task { await submitNewReason(point) } }
                                    Button(savingReason ? "Adding…" : "Add") {
                                        Task { await submitNewReason(point) }
                                    }
                                    .buttonStyle(PLCyanGhostButtonStyle())
                                    .disabled(newReason.trimmingCharacters(in: .whitespaces).isEmpty)
                                }
                            }
                        }

                        if misreadKindApplies(point.lossReasons) {
                            question("What got you?", chips: MISREAD_KINDS, selected: point.misreadKind) { value in
                                Task { await model.setMisreadKind(point, point.misreadKind == value ? nil : value) }
                            }
                        }
                        if outOfPositionApplies(point.lossReasons) {
                            question("Where did they get you?", chips: DIRECTIONS, selected: point.direction) { value in
                                Task { await model.setDirection(point, point.direction == value ? nil : value) }
                            }
                        }
                        if serveApplies(point.lossReasons) {
                            VStack(alignment: .leading, spacing: 10) {
                                Text((point.lossReasons ?? []).contains("weak_serve")
                                    ? "Which serve did you play?"
                                    : "Which serve beat you?")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(PL.text200)
                                FlowLayout(spacing: 8) {
                                    ForEach(SERVE_SPINS) { chip in
                                        chipView(chip.label, selected: point.serveSpin == chip.value) {
                                            Task { await model.pickServeSpin(point, chip.value) }
                                        }
                                    }
                                    chipView("+ Sidespin", selected: point.serveSidespin == true) {
                                        Task { await model.toggleServeSidespin(point) }
                                    }
                                }
                                FlowLayout(spacing: 8) {
                                    ForEach(SERVE_LENGTHS) { chip in
                                        chipView(chip.label, selected: point.serveLength == chip.value) {
                                            Task {
                                                await model.setServeLength(
                                                    point,
                                                    point.serveLength == chip.value ? nil : chip.value
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } else if point.confirmedWinner == .user {
                        Text("Points you won ask nothing. What you did right is not what a player comes back to a match to find out.")
                            .font(.plBody)
                            .foregroundStyle(PL.text500)
                    } else {
                        Text("Score the point first — the questions follow the outcome.")
                            .font(.plBody)
                            .foregroundStyle(PL.text500)
                    }
                }
                .padding(20)
            }
        }
    }

    private func submitNewReason(_ point: MatchPoint) async {
        let label = newReason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !label.isEmpty, let uid = app.userId else { return }
        savingReason = true
        if let id = await reasonsStore.create(label: label, ownerId: uid) {
            newReason = ""
            addingReason = false
            await model.toggleReason(point, customReasonValue(id: id))
        }
        savingReason = false
    }

    private func question(
        _ text: String, chips: [ReasonChip], selected: String?,
        pick: @escaping (String) -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(text)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(PL.text200)
            FlowLayout(spacing: 8) {
                ForEach(chips) { chip in
                    chipView(chip.label, selected: selected == chip.value) { pick(chip.value) }
                }
            }
        }
    }

    private func chipView(
        _ label: String, selected: Bool, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(selected ? PL.cyan : PL.text300)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(selected ? PL.cyan.opacity(0.15) : PL.ink.opacity(0.4), in: Capsule())
                .overlay(
                    Capsule().strokeBorder(selected ? PL.cyan.opacity(0.6) : PL.edge, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }
}

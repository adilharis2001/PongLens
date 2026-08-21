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
    /// Quick notes from the player write through the match's own store.
    var notesStore: NotesStore?
    /// Details: leave the pad and open this point's sheet (0-based index).
    var onOpenPoint: ((Int) -> Void)?
    /// Coach workspace hook: when set, the watch overlay offers adding the
    /// point on screen to a pattern. Players never see it.
    var onTagPoint: ((MatchPoint) -> Void)?

    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
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
    @State private var pointsGridOpen = false

    // Zoom: survives point skips on purpose — a player studying one corner
    // of the table wants the same corner across rallies.
    @State private var zoomScale: CGFloat = 1
    @State private var zoomAnchor: CGFloat = 1
    @State private var panOffset: CGSize = .zero
    @State private var panAnchor: CGSize = .zero
    /// Hold a side of the picture for temporary speed: right 2x, left 0.25x.
    @State private var holdRate: Float?
    /// True while the rotate button holds the scene in landscape. The
    /// preference sticks to the SCENE, not this view, so closing the
    /// player must hand it back or the whole app stays sideways.
    @State private var forcedLandscape = false
    // Quick actions: a note or a drawing without leaving the player.
    @State private var noteComposerOpen = false
    @State private var annotateFrame: UIImage?
    @State private var pendingImage: (path: String, preview: UIImage)?

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

    /// The answer to "who served first", live: starts from the match row
    /// and updates the moment the sheet is answered, so the rotation shows
    /// up without waiting on the database round trip.
    @State private var firstServer: Winner?

    private var serving: [UUID: ServeInfo] {
        computeServing(points, firstServer: firstServer)
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
            let landscape = geo.size.width > geo.size.height
            Group {
                if mode == .score, phase == .play, landscape {
                    // The web's edge layout: full-bleed video, the pad's
                    // pieces floating in bands that leave the picture open.
                    ZStack {
                        videoArea(geo)
                        landscapePadOverlay(geo)
                    }
                } else {
                    VStack(spacing: 0) {
                        videoArea(geo)
                        if mode == .score, phase == .play {
                            scorePad
                        }
                    }
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
            releaseForcedLandscape()
        }
        .sheet(isPresented: $setupOpen) {
            firstServerSheet
                .presentationDetents([.height(236)])
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
        .sheet(isPresented: $pointsGridOpen) {
            pointsGrid
                .presentationDetents([.medium])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $noteComposerOpen) {
            quickNoteSheet
                .presentationDetents([.height(240), .medium])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
        .fullScreenCover(isPresented: Binding(
            get: { annotateFrame != nil },
            set: { if !$0 { annotateFrame = nil } }
        )) {
            if let frame = annotateFrame {
                AnnotatorView(
                    frame: frame,
                    onCancel: { annotateFrame = nil },
                    onSave: { jpeg in
                        do {
                            let path = try await NoteMedia.uploadImage(jpeg)
                            pendingImage = (path, UIImage(data: jpeg) ?? frame)
                            annotateFrame = nil
                            noteComposerOpen = true
                            return true
                        } catch {
                            return false
                        }
                    }
                )
            }
        }
    }

    /// A note without leaving the player: the point on screen is the
    /// subject, and a drawing made a moment ago rides along.
    @ViewBuilder
    private var quickNoteSheet: some View {
        if let notesStore, let uid = app.userId {
            VStack(alignment: .leading, spacing: 12) {
                Text(displayNumber.map { "Note on point \($0)" } ?? "Match note")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(PL.textBody)
                if let pendingImage {
                    HStack(spacing: 10) {
                        Image(uiImage: pendingImage.preview)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 84, height: 48)
                            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                        Text("Drawing attached")
                            .font(.plCaption)
                            .foregroundStyle(PL.text400)
                        Spacer()
                        Button("Remove") { self.pendingImage = nil }
                            .font(.plCaption)
                            .foregroundStyle(PL.text400)
                            .buttonStyle(.plain)
                    }
                }
                NoteComposerView(
                    matchId: match.id,
                    pointId: displayTarget?.id,
                    userId: uid,
                    notesStore: notesStore,
                    placeholder: "What do you see here?",
                    pendingImagePath: pendingImage?.path,
                    onSent: {
                        pendingImage = nil
                        noteComposerOpen = false
                    }
                )
                Spacer()
            }
            .padding(18)
        }
    }

    // MARK: - Video area

    @ViewBuilder
    private func videoArea(_ geo: GeometryProxy) -> some View {
        let landscape = geo.size.width > geo.size.height
        // Portrait keep-score pins a snug 16:9 band above the pad; the
        // landscape edge layout goes full-bleed like watch mode.
        let scoreLayout = mode == .score && phase == .play && !landscape
        let content = ZStack {
            Color.black
            PlayerLayerView(player: player)
                .scaleEffect(zoomScale)
                .offset(panOffset)
                .clipped()

            // Two gesture halves: single tap plays, double tap skips a
            // point, press and hold runs that side's temporary speed.
            HStack(spacing: 0) {
                gestureHalf(isRight: false)
                gestureHalf(isRight: true)
            }

            if let flash {
                PLToast(message: flash)
            }

            if let holdRate {
                VStack {
                    Text(holdRate > 1 ? "2x ▶▶" : "0.25x ◀▶")
                        .font(.system(size: 13, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 5)
                        .background(PL.ink.opacity(0.85), in: Capsule())
                        .padding(.top, 54)
                    Spacer()
                }
            }

            VStack {
                HStack(alignment: .top, spacing: 8) {
                    if mode == .watch, notesStore != nil {
                        overlayButton("square.and.pencil", label: "Add a note") {
                            player.pause()
                            noteComposerOpen = true
                        }
                        overlayButton("scribble.variable", label: "Draw on this frame") {
                            captureFrame()
                        }
                    }
                    // Starring is the owner's write — the column grant would
                    // silently refuse a coach anyway. Replay used to sit
                    // beside it up here and moved to the transport row,
                    // which is the half of the screen a thumb can reach.
                    if mode == .watch, !points.isEmpty, app.userId == match.userId {
                        overlayButton(
                            displayTarget?.starred == true ? "star.fill" : "star",
                            label: "Star this point",
                            tint: displayTarget?.starred == true ? PL.warning : PL.text200
                        ) {
                            guard let target = displayTarget else { return }
                            Task { await model.toggleStar(target) }
                        }
                    }
                    if mode == .watch, let onTagPoint {
                        overlayButton("square.grid.2x2", label: "Add to a pattern") {
                            player.pause()
                            if let target = displayTarget { onTagPoint(target) }
                        }
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
                if mode == .watch {
                    VStack(alignment: .leading, spacing: 8) {
                        // The score rides the picture whether or not the
                        // chrome is up — landscape included.
                        scoreBug
                        if chromeVisible {
                            watchTransport(landscape: landscape, size: geo.size)
                        }
                    }
                }
            }
            // Hiding the status bar collapses the reported safe areas, so
            // the chrome takes hard floors instead: clear of the display's
            // corner curves up top and the home indicator below.
            .padding(.top, max(geo.safeAreaInsets.top, 24))
            .padding(.bottom, max(geo.safeAreaInsets.bottom, 20))
            .padding(.horizontal, max(
                max(geo.safeAreaInsets.leading, geo.safeAreaInsets.trailing), 14
            ))

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
        // Score layout pins the picture to a snug 16:9 band; watch mode
        // fills the SCREEN and lets the layer letterbox inside it. The
        // fill-the-container shortcut here is what once blew the watch
        // player up past the screen edges, chrome and all.
        let sized = scoreLayout
            ? AnyView(content.aspectRatio(16 / 9, contentMode: .fit))
            : AnyView(content.frame(maxWidth: .infinity, maxHeight: .infinity))
        sized
            .simultaneousGesture(zoomGesture(geo.size))
            .simultaneousGesture(panGesture(geo.size))
    }

    // MARK: - Zoom and hold-speed

    private func zoomGesture(_ size: CGSize) -> some Gesture {
        MagnificationGesture()
            .onChanged { value in
                zoomScale = min(4, max(1, zoomAnchor * value))
                clampPan(size)
            }
            .onEnded { _ in
                zoomAnchor = zoomScale
                if zoomScale < 1.06 { resetZoom() }
            }
    }

    private func panGesture(_ size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 14)
            .onChanged { value in
                guard zoomScale > 1 else { return }
                panOffset = CGSize(
                    width: panAnchor.width + value.translation.width,
                    height: panAnchor.height + value.translation.height
                )
                clampPan(size)
            }
            .onEnded { _ in panAnchor = panOffset }
    }

    /// Keep the scaled picture covering the frame — no dead margins.
    private func clampPan(_ size: CGSize) {
        let maxX = size.width * (zoomScale - 1) / 2
        let maxY = size.height * (zoomScale - 1) / 2
        panOffset = CGSize(
            width: min(maxX, max(-maxX, panOffset.width)),
            height: min(maxY, max(-maxY, panOffset.height))
        )
    }

    private func resetZoom() {
        withAnimation(.easeOut(duration: 0.15)) {
            zoomScale = 1
            zoomAnchor = 1
            panOffset = .zero
            panAnchor = .zero
        }
    }

    /// Button zoom, anchored at the frame center — ×1.5 steps like the web.
    private func zoomBy(_ factor: CGFloat, size: CGSize) {
        let next = min(4, max(1, zoomScale * factor))
        if next <= 1.001 {
            resetZoom()
            return
        }
        withAnimation(.easeOut(duration: 0.15)) {
            zoomScale = next
            zoomAnchor = next
            clampPan(size)
            panAnchor = panOffset
        }
    }

    private func gestureHalf(isRight: Bool) -> some View {
        Color.clear
            .contentShape(Rectangle())
            .onTapGesture(count: 2) { step(isRight ? 1 : -1) }
            .onTapGesture { togglePlay() }
            .onLongPressGesture(minimumDuration: 0.25, maximumDistance: 40) {
                beginHold(fast: isRight)
            } onPressingChanged: { pressing in
                if !pressing { endHold() }
            }
            // On the video surface only, never the chrome — a swipe that
            // rode the whole screen would fire after every scrubber drag.
            .gesture(swipeSeek)
    }

    /// A clean horizontal flick hops five seconds, either direction, in
    /// watch and keep score alike. Zoomed, the same motion pans instead.
    private var swipeSeek: some Gesture {
        DragGesture(minimumDistance: 24)
            .onEnded { value in
                guard zoomScale <= 1.001 else { return }
                let dx = value.translation.width
                let dy = value.translation.height
                guard abs(dx) > 56, abs(dx) > abs(dy) * 1.4 else { return }
                var target = max(0, currentT + (dx > 0 ? 5 : -5))
                if duration > 0 { target = min(target, duration - 0.1) }
                seek(to: target)
                showFlash(dx > 0 ? "+5s" : "-5s")
            }
    }

    private func beginHold(fast: Bool) {
        guard player.rate > 0 else { return }
        holdRate = fast ? 2.0 : 0.25
        player.rate = holdRate!
    }

    private func endHold() {
        guard holdRate != nil else { return }
        holdRate = nil
        if player.rate > 0 { player.rate = rate }
    }

    private func overlayButton(
        _ icon: String, label: String, tint: Color = PL.text200,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(tint)
                .padding(9)
                .background(PL.ink.opacity(0.7), in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    /// Grab the paused moment for the annotator, exactly the point sheet's
    /// flow: draw, save, and the picture rides the next note.
    private func captureFrame() {
        guard let asset = player.currentItem?.asset else { return }
        player.pause()
        let time = player.currentTime()
        let generator = AVAssetImageGenerator(asset: asset)
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = .zero
        generator.appliesPreferredTrackTransform = true
        generator.generateCGImageAsynchronously(for: time) { cgImage, _, _ in
            Task { @MainActor in
                if let cgImage {
                    annotateFrame = UIImage(cgImage: cgImage)
                }
            }
        }
    }

    private var displayNumber: Int? {
        guard let target = displayTarget, let i = points.firstIndex(of: target) else { return nil }
        return i + 1
    }

    /// Score entering the rally on screen — never counting it. Watching a
    /// point while the scoreboard already counts it gives the ending away.
    private var bugScore: MatchScore {
        let upTo: [MatchPoint]
        if let target = displayTarget, let i = points.firstIndex(of: target) {
            upTo = Array(points.prefix(i))
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

    /// The broadcast score bug, bottom-left over the picture — the same
    /// table the exported reel burns in: a row per player with their accent
    /// bar, one muted column per completed game, the live game tinted.
    @ViewBuilder
    private var scoreBug: some View {
        let score = bugScore
        if !points.isEmpty, displayTarget != nil {
            VStack(alignment: .leading, spacing: 1) {
                scoreBugRow(
                    name: "You", tint: PL.cyan,
                    games: score.games.map(\.you), current: score.current.you
                )
                scoreBugRow(
                    name: match.opponentName ?? "Them", tint: PL.magentaSoft,
                    games: score.games.map(\.them), current: score.current.them
                )
            }
            .padding(4)
            .background(PL.ink.opacity(0.78), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
    }

    private func scoreBugRow(
        name: String, tint: Color, games: [Int], current: Int
    ) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 1)
                .fill(tint)
                .frame(width: 3, height: 9)
            Text(name)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(PL.text100)
                .lineLimit(1)
                .frame(minWidth: 44, alignment: .leading)
            ForEach(Array(games.enumerated()), id: \.offset) { _, points in
                Text("\(points)")
                    .font(.system(size: 11, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(PL.text400)
                    .frame(minWidth: 16)
            }
            Text("\(current)")
                .font(.system(size: 11, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(PL.text100)
                .frame(minWidth: 20)
                .padding(.vertical, 2)
                .background(tint.opacity(0.2), in: RoundedRectangle(cornerRadius: 3, style: .continuous))
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 2)
    }

    private func watchTransport(landscape: Bool, size: CGSize) -> some View {
        VStack(spacing: 8) {
            HStack(spacing: 10) {
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
            // Nine controls, and the gap between them cannot be a constant.
            // "0.25x" is 20pt wider than "1x", so a row tuned for one phone
            // at one speed runs off another phone's right edge — that is
            // what once crushed the speed label to nothing. Let the layout
            // choose: 8pt where it fits, 4pt on a 375pt screen at the
            // slowest speed, and it never overflows. The 2pt candidate is
            // the floor — ViewThatFits renders the last one whether it fits
            // or not, so the last one has to be the one that always does.
            ViewThatFits(in: .horizontal) {
                watchControls(spacing: 8, landscape: landscape, size: size)
                watchControls(spacing: 6, landscape: landscape, size: size)
                watchControls(spacing: 4, landscape: landscape, size: size)
                watchControls(spacing: 2, landscape: landscape, size: size)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(PL.ink.opacity(0.72), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func watchControls(spacing: CGFloat, landscape: Bool, size: CGSize) -> some View {
        HStack(spacing: spacing) {
                Button {
                    step(-1)
                } label: {
                    Image(systemName: "backward.frame.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(PL.text200)
                        .frame(width: 28, height: 34)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Previous point")
                Button {
                    togglePlay()
                } label: {
                    Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 40)
                }
                .buttonStyle(.plain)
                Button {
                    step(1)
                } label: {
                    Image(systemName: "forward.frame.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(PL.text200)
                        .frame(width: 28, height: 34)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Next point")
                Spacer(minLength: 4)
                Button {
                    guard let target = displayTarget, let cutT0 = target.cutT0 else { return }
                    endPausedId = nil
                    seek(to: cutT0)
                    play()
                    if let n = points.firstIndex(of: target) {
                        showFlash("Replay · point \(n + 1)")
                    }
                } label: {
                    Image(systemName: "gobackward")
                        .font(.system(size: 15))
                        .foregroundStyle(displayTarget?.cutT0 == nil ? PL.text600 : PL.text200)
                        .frame(width: 26, height: 34)
                }
                .buttonStyle(.plain)
                .disabled(displayTarget?.cutT0 == nil)
                .accessibilityLabel("Replay this point")
                Menu {
                    // Slowest nearest the thumb, the web menu's ordering.
                    ForEach([2.0, 1.5, 1.0, 0.5, 0.25, 0.1], id: \.self) { speed in
                        Button {
                            rate = Float(speed)
                            if player.rate > 0 { player.rate = rate }
                        } label: {
                            if rate == Float(speed) {
                                Label(speedLabel(speed), systemImage: "checkmark")
                            } else {
                                Text(speedLabel(speed))
                            }
                        }
                    }
                } label: {
                    Text(speedLabel(Double(rate)))
                        .font(.system(size: 12, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(PL.text200)
                        .fixedSize()
                        .padding(.horizontal, 8)
                        .padding(.vertical, 7)
                        .background(PL.surface2.opacity(0.8), in: Capsule())
                }
                // Without the plain style the menu repaints its label and
                // the text vanishes into the capsule.
                .buttonStyle(.plain)
                .tint(PL.text200)
                .accessibilityLabel("Playback speed")
                Button {
                    zoomBy(1 / 1.5, size: size)
                } label: {
                    Image(systemName: "minus.magnifyingglass")
                        .font(.system(size: 14))
                        .foregroundStyle(zoomScale <= 1.001 ? PL.text600 : PL.text200)
                        .frame(width: 26, height: 34)
                }
                .buttonStyle(.plain)
                .disabled(zoomScale <= 1.001)
                .accessibilityLabel("Zoom out")
                Button {
                    zoomBy(1.5, size: size)
                } label: {
                    Image(systemName: "plus.magnifyingglass")
                        .font(.system(size: 14))
                        .foregroundStyle(zoomScale >= 3.999 ? PL.text600 : PL.text200)
                        .frame(width: 26, height: 34)
                }
                .buttonStyle(.plain)
                .disabled(zoomScale >= 3.999)
                .accessibilityLabel("Zoom in")
                Button {
                    pointsGridOpen = true
                } label: {
                    Image(systemName: "square.grid.3x3")
                        .font(.system(size: 15))
                        .foregroundStyle(PL.text200)
                        .frame(width: 28, height: 34)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Jump to a point")
                Button {
                    rotate(toLandscape: !landscape)
                } label: {
                    Image(systemName: landscape
                        ? "rectangle.portrait.arrowtriangle.2.outward"
                        : "rectangle.landscape.rotate")
                        .font(.system(size: 15))
                        .foregroundStyle(PL.text200)
                        .frame(width: 28, height: 34)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(landscape ? "Back to portrait" : "Turn to landscape")
        }
    }

    /// The YouTube move: one button flips the takeover between portrait
    /// and landscape without touching the phone's rotation lock.
    private func rotate(toLandscape: Bool) {
        forcedLandscape = toLandscape
        requestOrientation(toLandscape ? .landscapeRight : .portrait)
    }

    /// Every exit runs through here via onDisappear. If the button put
    /// the scene in landscape and the phone is not physically on its
    /// side, give the scene back to portrait; a phone genuinely held
    /// sideways keeps what it has.
    private func releaseForcedLandscape() {
        guard forcedLandscape else { return }
        forcedLandscape = false
        guard !UIDevice.current.orientation.isLandscape else { return }
        requestOrientation(.portrait)
    }

    private func requestOrientation(_ orientations: UIInterfaceOrientationMask) {
        guard let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene }).first else { return }
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: orientations))
    }

    private func speedLabel(_ speed: Double) -> String {
        speed == 1 ? "1x"
            : speed == floor(speed) ? String(format: "%.0fx", speed)
            : String(format: "%gx", speed)
    }

    /// Jump to any point: the ticker's numbered rings, as a grid.
    private var pointsGrid: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Jump to a point")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(PL.textBody)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 44), spacing: 8)], spacing: 8) {
                    ForEach(Array(points.enumerated()), id: \.element.id) { i, p in
                        if p.cutT0 != nil {
                            Button {
                                pointsGridOpen = false
                                if let cutT0 = p.cutT0 {
                                    endPausedId = nil
                                    seek(to: cutT0)
                                    play()
                                }
                            } label: {
                                ZStack {
                                    Circle().fill(chipTint(p).opacity(
                                        p.confirmedWinner == nil && !p.isLet ? 0.04 : 0.16
                                    ))
                                    if p.confirmedWinner == nil && !p.isLet {
                                        Circle().strokeBorder(
                                            PL.text600,
                                            style: StrokeStyle(lineWidth: 1.5, dash: [3, 3])
                                        )
                                    } else {
                                        Circle().strokeBorder(chipTint(p).opacity(0.85), lineWidth: 2)
                                    }
                                    Text("\(i + 1)")
                                        .font(.system(size: 13, weight: .semibold))
                                        .monospacedDigit()
                                        .foregroundStyle(
                                            p.confirmedWinner == nil && !p.isLet
                                                ? PL.text400 : chipTint(p)
                                        )
                                }
                                .frame(width: 44, height: 44)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(20)
        }
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

    /// The landscape pad: nothing owns the screen except the footage. The
    /// score and ticker float top-center, winner tiles hold the left edge,
    /// dispositions the right, and a mini control row hugs the bottom —
    /// the web's edge layout, band for band.
    private func landscapePadOverlay(_ geo: GeometryProxy) -> some View {
        let target = displayTarget
        let score = runningScore
        let serveInfo = target.flatMap { serving[$0.id] }
        return ZStack {
            // Top bands, inset clear of the corner buttons.
            VStack(spacing: 6) {
                HStack(spacing: 12) {
                    serveBall(active: serveInfo?.server == .user)
                    (Text("\(score.current.you)").foregroundColor(PL.cyan)
                        + Text(" - ").foregroundColor(PL.text600)
                        + Text("\(score.current.them)").foregroundColor(PL.magentaSoft))
                        .font(.system(size: 19, weight: .bold))
                        .monospacedDigit()
                    Text(serveLine(serveInfo))
                        .font(.plCaption)
                        .foregroundStyle(PL.text400)
                        .lineLimit(1)
                    serveBall(active: serveInfo?.server == .opponent, them: true)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 3)
                .background(PL.ink.opacity(0.45), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                chipStrip(targetId: target?.id)
                    .padding(.horizontal, 8)
                    .background(PL.ink.opacity(0.45), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                Spacer()
            }
            .padding(.horizontal, 52)
            .padding(.top, 6)

            // Winner tiles on the left edge, vertically centered.
            HStack {
                VStack(spacing: 8) {
                    winnerButton("Me", tint: PL.cyan, selected: target?.confirmedWinner == .user) {
                        tapWinner(.user)
                    }
                    .frame(width: 96, height: 88)
                    winnerButton(
                        match.opponentName ?? "Them", tint: PL.magentaSoft,
                        selected: target?.confirmedWinner == .opponent
                    ) {
                        tapWinner(.opponent)
                    }
                    .frame(width: 96, height: 88)
                    .overlay(alignment: .topTrailing) {
                        if target?.confirmedWinner == .opponent, reasonsStore != nil {
                            Button {
                                player.pause()
                                analysisOpen = true
                            } label: {
                                Text("Why")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(PL.text100)
                                    .frame(width: 36, height: 36)
                                    .background(PL.ink.opacity(0.55), in: Circle())
                            }
                            .buttonStyle(.plain)
                            .padding(4)
                        }
                    }
                }
                Spacer()
            }
            .padding(.leading, 4)

            // Dispositions on the right edge.
            HStack {
                Spacer()
                VStack(spacing: 8) {
                    dispositionButton("Skip", sub: "let", tint: PL.warning) { tapSkip() }
                        .frame(width: 96)
                    dispositionButton("Delete", sub: "dead space", tint: PL.dangerText) { tapDelete() }
                        .frame(width: 96)
                    dispositionButton("Modify", sub: "split · join", tint: PL.cyan) {
                        if let target {
                            player.pause()
                            modifyPoint = target
                        }
                    }
                    .frame(width: 96)
                }
            }
            .padding(.trailing, 4)

            // Mini control row, bottom center.
            VStack {
                Spacer()
                HStack(spacing: 6) {
                    miniControl("chevron.left", label: "Back") { step(-1) }
                    miniControl("arrow.uturn.backward", label: "Undo", disabled: undoStack.isEmpty) { undo() }
                    miniControl("gobackward", label: "Replay") { replayTarget() }
                    Button {
                        rate = rate == 1 ? 0.5 : rate == 0.5 ? 0.25 : 1
                        if player.rate > 0 { player.rate = rate }
                    } label: {
                        VStack(spacing: 2) {
                            Text(rate == 1 ? "1x" : rate == 0.5 ? "0.5x" : "0.25x")
                                .font(.system(size: 13, weight: .bold))
                                .monospacedDigit()
                                .frame(height: 18)
                            Text("Speed").font(.system(size: 8, weight: .medium))
                        }
                        .foregroundStyle(PL.text200)
                        .frame(width: 46, height: 40)
                        .background(PL.ink.opacity(0.6), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    miniControl(
                        target?.starred == true ? "star.fill" : "star", label: "Star"
                    ) {
                        if let target {
                            undoStack.append(target)
                            Task { await model.toggleStar(target) }
                        }
                    }
                    miniControl("doc.text", label: "Analysis", disabled: target == nil || reasonsStore == nil) {
                        player.pause()
                        analysisOpen = true
                    }
                    miniControl("arrow.up.forward.square", label: "Details", disabled: target == nil || onOpenPoint == nil) {
                        guard let target, let i = points.firstIndex(of: target) else { return }
                        dismiss()
                        onOpenPoint?(i)
                    }
                    miniControl("chevron.right", label: "Next") { step(1) }
                }
                .padding(.bottom, 8)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func miniControl(
        _ icon: String, label: String, disabled: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .medium))
                    .frame(height: 18)
                Text(label).font(.system(size: 8, weight: .medium))
            }
            .foregroundStyle(disabled ? PL.text600 : PL.text200)
            .frame(width: 46, height: 40)
            .background(PL.ink.opacity(0.6), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
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
                    // The arc is the time LEFT in the point, shrinking as
                    // it plays — the web ticker's direction.
                    Circle()
                        .trim(from: 0, to: max(0, 1 - progress))
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
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func firstServerButton(_ label: String, value: String) -> some View {
        Button(label) {
            // The rotation shows immediately; the row catches up behind.
            // The update writes ONLY first_server — the client grant is
            // column-scoped, and adding first_server_source rejects the
            // whole statement without an error surfacing anywhere.
            firstServer = Winner(rawValue: value)
            Task {
                _ = try? await supa
                    .from("matches")
                    .update(["first_server": AnyJSON.string(value)])
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

        firstServer = match.firstServer.flatMap(Winner.init(rawValue:))
        if mode == .score {
            // Resume from the first unscored point, snapped to its padded start.
            let target = startAt ?? points.first {
                !$0.isLet && $0.confirmedWinner == nil && $0.cutT0 != nil
            }?.cutT0
            if let target { seek(to: target) }
            if firstServer == nil {
                // Presenting a sheet while the takeover's own animation is
                // still running leaves it half-alive with dead buttons —
                // the picker race all over again. Let the cover land first.
                try? await Task.sleep(for: .milliseconds(650))
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
                        Text("Score the point first. The questions follow the outcome.")
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

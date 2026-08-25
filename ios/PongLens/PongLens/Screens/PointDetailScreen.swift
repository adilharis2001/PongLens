import AVFoundation
import SwiftUI
import Supabase

/// The per-point view (web PointSheet + PointDetail): clip with its overlay
/// controls, the five-segment action bar, the scorecard, the placement map,
/// and the note thread. Swipe horizontally (or use the chevrons) to move
/// between points.
struct PointDetailScreen: View {
    let match: MatchRow
    let model: MatchDetailModel
    @Binding var index: Int
    let onOpenInMatch: (Double) -> Void
    let notesStore: NotesStore
    let tagsStore: TagsStore
    let reasonsStore: CustomReasonsStore
    let pad: ClipPad

    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    @State private var clipURLs: [UUID: URL] = [:]
    @State private var player = AVPlayer()
    @State private var shareSheetOpen = false
    @State private var tagPickerOpen = false
    @State private var modifyOpen = false
    @State private var feedbackOpen = false
    @State private var confirmingBefore = false
    @State private var annotateFrame: UIImage?
    @State private var pendingImage: (path: String, preview: UIImage)?
    @State private var captureError: String?

    // The "Saved" / "Couldn't save" line under the questions.
    @State private var savedFlash = false
    @State private var flashError: String?
    @State private var flashTask: Task<Void, Never>?

    // Custom-reason entry.
    @State private var addingReason = false
    @State private var newReason = ""
    @State private var savingReason = false

    // Horizontal paging between points: the body follows the finger with
    // the web sheet's resistance, commits past a quarter-width or a flick,
    // snaps back otherwise (PointSheet.tsx FOLLOW/EDGE_FOLLOW/commitTo).
    @State private var slideDX: CGFloat = 0
    @State private var dragHorizontal: Bool?
    @State private var bodyWidth: CGFloat = 390

    private var points: [MatchPoint] { model.visible }

    private var point: MatchPoint? {
        points.indices.contains(index) ? points[index] : nil
    }

    private var score: MatchScore {
        computeMatchScore(points.map {
            PointRow(
                id: $0.id, matchId: $0.matchId, idx: $0.idx, t0: $0.t0,
                confirmedWinner: $0.confirmedWinner, isLet: $0.isLet,
                deleted: $0.deleted, gameEndOverride: $0.gameEndOverride,
                gameWinnerOverride: $0.gameWinnerOverride
            )
        })
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

    private var serving: [UUID: ServeInfo] {
        computeServing(
            points, firstServer: match.firstServer.flatMap(Winner.init(rawValue:))
        )
    }

    private var iServed: Bool? {
        guard let point else { return nil }
        guard let server = serving[point.id]?.server ?? point.displayServer else { return nil }
        return server == .user
    }

    /// 0-based game this point belongs to — players change ends each game.
    private var gameIndex: Int {
        guard let point else { return 0 }
        var game = 0
        for p in points {
            if p.id == point.id { break }
            if score.boundaryAfter[p.id] != nil { game += 1 }
        }
        return game
    }

    /// Rotation-derived physical side of this point's server.
    private var serverPhysicalSide: String? {
        guard let userSide = match.userSide, let iServed else { return nil }
        let mine = physicalSideForGame(userSide, gameIndex: gameIndex)
        return iServed ? mine : otherSide(mine)
    }

    /// A coach viewing a student's match: watch and leave notes, never
    /// score, star, tag or edit — the web hides every owner action, and
    /// the column grants would silently refuse the writes anyway.
    private var isOwner: Bool { app.userId == match.userId }

    var body: some View {
        ZStack {
            PL.surface.ignoresSafeArea()
            if let point {
                VStack(spacing: 0) {
                    header(point)
                    Rectangle().fill(PL.edge.opacity(0.7)).frame(height: 1)
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            ClipPlayerView(
                                player: player,
                                url: clipURLs[point.id],
                                starred: point.starred,
                                tagged: !tagsStore.tags(for: point.id).isEmpty,
                                updating: point.edited,
                                hasPrev: index > 0,
                                hasNext: index < points.count - 1,
                                canEdit: isOwner,
                                onStar: { Task { await model.toggleStar(point) } },
                                onTag: { tagPickerOpen = true },
                                onPrev: { index = max(0, index - 1) },
                                onNext: { index = min(points.count - 1, index + 1) }
                            )
                            actionBar(point)
                            if isOwner {
                                scorecard(point)
                            }
                            placementSection(point)
                            notesSection(point)
                                .id("notes")
                        }
                        .padding(16)
                        .padding(.bottom, 40)
                    }
                    .offset(x: slideDX)
                    .onGeometryChange(for: CGFloat.self) { proxy in
                        proxy.size.width
                    } action: { width in
                        bodyWidth = max(1, width)
                    }
                    .simultaneousGesture(pagingGesture)
                }
            }
        }
        .task(id: point?.id) {
            confirmingBefore = false
            addingReason = false
            clearPendingImage()
            await loadClip()
            if !notesStore.loaded {
                await notesStore.load(matchId: match.id)
            }
        }
        .sheet(isPresented: $shareSheetOpen) {
            if let point {
                SharePointSheet(match: match, point: point, pad: pad, points: points)
                .presentationDetents([.height(SharePointSheet.detentHeight)])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
            }
        }
        .sheet(isPresented: $tagPickerOpen) {
            if let point {
                TagPickerSheet(
                    point: point, match: match, tagsStore: tagsStore, userId: app.userId
                )
                .presentationDetents([.medium, .large])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
            }
        }
        .sheet(isPresented: $feedbackOpen) {
            NavigationStack {
                ZStack {
                    ArenaBackground()
                    FeedbackScreen(matchId: match.id)
                }
            }
        }
        .fullScreenCover(isPresented: $modifyOpen) {
            if let point {
                ModifySheet(match: match, model: model, point: point, pad: pad)
            }
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
                            return true
                        } catch {
                            return false
                        }
                    }
                )
            }
        }
        .plKeyboardDismiss()
    }

    // MARK: - Paging gesture

    private var pagingGesture: some Gesture {
        DragGesture(minimumDistance: 12)
            .onChanged { value in
                let dx = value.translation.width
                let dy = value.translation.height
                // Axis lock: undecided under 10pt, then whichever axis
                // leads owns the rest of the gesture.
                if dragHorizontal == nil {
                    guard abs(dx) > 10 || abs(dy) > 10 else { return }
                    dragHorizontal = abs(dx) > abs(dy)
                }
                guard dragHorizontal == true else { return }
                let atEdge = (dx > 0 && index == 0) || (dx < 0 && index >= points.count - 1)
                slideDX = dx * (atEdge ? 0.2 : 0.55)
            }
            .onEnded { value in
                let wasHorizontal = dragHorizontal == true
                dragHorizontal = nil
                guard wasHorizontal else { return }
                let dx = value.translation.width
                let canGo = dx < 0 ? index < points.count - 1 : index > 0
                let flick = abs(value.predictedEndTranslation.width) > abs(dx) + 60 && abs(dx) > 32
                guard canGo, abs(dx) > bodyWidth * 0.25 || flick else {
                    withAnimation(.easeOut(duration: 0.18)) { slideDX = 0 }
                    return
                }
                // Slide out, swap, land: the new point mounts in place.
                let direction: CGFloat = dx < 0 ? -1 : 1
                withAnimation(.easeInOut(duration: 0.16)) {
                    slideDX = direction * bodyWidth * 0.35
                }
                Task {
                    try? await Task.sleep(for: .milliseconds(160))
                    index += direction < 0 ? 1 : -1
                    slideDX = 0
                }
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

    @ViewBuilder
    private func actionBar(_ point: MatchPoint) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                if isOwner {
                    // Share used to mint a link and go straight to the
                    // system sheet. It now opens a chooser first, because
                    // the thing people want to do with a good rally is put
                    // it on Instagram, and that needs a vertical video
                    // rather than a URL. The link is still one row down.
                    actionButton("Share", icon: "square.and.arrow.up", tint: PL.cyan) {
                        shareSheetOpen = true
                    }
                    actionSeparator
                    if point.t0 != nil, point.t1 != nil {
                        actionButton("Modify", icon: "scissors", tint: PL.text300) {
                            modifyOpen = true
                        }
                        actionSeparator
                    }
                    boundaryButton(point)
                    actionSeparator
                }
                actionButton("In match", icon: "arrow.up.forward.square", tint: PL.text300) {
                    if let cutT0 = point.cutT0 {
                        dismiss()
                        onOpenInMatch(cutT0)
                    }
                }
                if isOwner {
                    actionSeparator
                    actionButton("Remove", icon: "trash", tint: PL.dangerText) {
                        Task {
                            await model.softDelete(point)
                            dismiss()
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity)

            if isOwner, index >= 2 {
                Rectangle().fill(PL.edge.opacity(0.6)).frame(height: 1)
                if confirmingBefore {
                    HStack {
                        Text("Remove \(index) earlier point\(index == 1 ? "" : "s")?")
                            .font(.plCaption)
                            .foregroundStyle(PL.text400)
                        Spacer()
                        Button("Cancel") { confirmingBefore = false }
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                            .buttonStyle(.plain)
                        Button("Remove") {
                            confirmingBefore = false
                            Task { await model.deleteBefore(point) }
                        }
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(PL.dangerText)
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                } else {
                    Button {
                        confirmingBefore = true
                    } label: {
                        HStack {
                            Text("Remove the \(index) points before this")
                                .font(.plCaption)
                                .foregroundStyle(PL.text400)
                            Spacer()
                            Text("warm-up")
                                .font(.system(size: 11))
                                .foregroundStyle(PL.text600)
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .background(PL.surface2.opacity(0.4), in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                .strokeBorder(PL.edge, lineWidth: 1)
        )
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
                Text(label)
                    .font(.system(size: 10, weight: .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(tint)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
        }
        .buttonStyle(.plain)
    }

    private func boundaryButton(_ point: MatchPoint) -> some View {
        let endsHere = score.boundaryAfter[point.id] != nil
        let action = boundaryAction(override: point.gameEndOverride, walkEndsHere: endsHere)
        return actionButton(action.label, icon: "flag", tint: PL.text300) {
            Task {
                await model.setBoundary(point, next: action.next)
                flashSaved()
            }
        }
    }

    // MARK: - Save flash

    private func flashSaved() {
        flashError = nil
        savedFlash = true
        flashTask?.cancel()
        flashTask = Task {
            try? await Task.sleep(for: .seconds(1.5))
            if !Task.isCancelled { savedFlash = false }
        }
    }

    private func report(_ ok: Bool) {
        if ok {
            flashSaved()
        } else {
            flashError = "Couldn't save. Tap again."
        }
    }

    // MARK: - Scorecard

    @ViewBuilder
    private func scorecard(_ point: MatchPoint) -> some View {
        let outcome: WinnerOrSkip? = point.isLet
            ? .skip
            : point.confirmedWinner.map { $0 == .user ? .user : .opponent }
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 10) {
                Text("Who served?")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PL.text200)
                HStack(spacing: 10) {
                    bigChoice("Me", selected: iServed == true, tint: PL.cyan) {
                        Task { await model.setServerOverride(point, .user); flashSaved() }
                    }
                    bigChoice("Them", selected: iServed == false, tint: PL.magentaSoft) {
                        Task { await model.setServerOverride(point, .opponent); flashSaved() }
                    }
                }
            }

            VStack(alignment: .leading, spacing: 10) {
                Text("Who won this point?")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PL.text200)
                HStack(spacing: 10) {
                    bigChoice("Me", selected: outcome == .user, tint: PL.cyan) {
                        Task { report(await model.pickOutcome(point, .user)) }
                    }
                    bigChoice("Them", selected: outcome == .opponent, tint: PL.cyan) {
                        Task { report(await model.pickOutcome(point, .opponent)) }
                    }
                    bigChoice("Skip", selected: outcome == .skip, tint: PL.warningText) {
                        Task { report(await model.pickOutcome(point, .skip)) }
                    }
                }
            }

            // Skip keeps a flat one-tap reason list — a skipped ball never
            // scored, so nothing deeper applies.
            if point.isLet {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Why skip it?")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(PL.text200)
                    FlowLayout(spacing: 8) {
                        ForEach(SKIP_REASONS) { chip in
                            reasonChipView(
                                chip.label,
                                selected: canonicalSkipReason(point.confirmedHow) == chip.value
                            ) {
                                let next = canonicalSkipReason(point.confirmedHow) == chip.value
                                    ? nil : chip.value
                                Task { report(await model.setSkipReason(point, next)) }
                            }
                        }
                    }
                }
            }

            // An answer to a question that no longer exists, kept readable.
            if !point.isLet, let retired = howLabel(canonicalHowForDisplay(point)) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("RECORDED EARLIER")
                            .font(.system(size: 10, weight: .medium))
                            .tracking(0.5)
                            .foregroundStyle(PL.text500)
                        Text(retired)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(PL.text100)
                    }
                    Spacer()
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(PL.ink.opacity(0.4), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(PL.edge, lineWidth: 1)
                )
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
                    FlowLayout(spacing: 8) {
                        ForEach(lossReasonsFor(iServed: iServed, custom: reasonsStore.reasons)) { chip in
                            reasonChipView(
                                chip.label,
                                selected: (point.lossReasons ?? []).contains(chip.value)
                            ) {
                                Task { report(await model.toggleReason(point, chip.value)) }
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
                                            PL.edge, style: StrokeStyle(lineWidth: 1, dash: [4, 3])
                                        )
                                    )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    if addingReason {
                        HStack(spacing: 8) {
                            TextField("Misread the pips", text: $newReason)
                                .font(.system(size: 13))
                                .foregroundStyle(PL.text100)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(PL.ink.opacity(0.4), in: Capsule())
                                .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                                .onSubmit { Task { await submitNewReason(point) } }
                            Button(savingReason ? "Adding…" : "Add") {
                                Task { await submitNewReason(point) }
                            }
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(PL.cyan)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(PL.cyan.opacity(0.1), in: Capsule())
                            .overlay(Capsule().strokeBorder(PL.cyan.opacity(0.5), lineWidth: 1))
                            .buttonStyle(.plain)
                            .disabled(newReason.trimmingCharacters(in: .whitespaces).isEmpty || savingReason)
                        }
                    }
                }

                if misreadKindApplies(point.lossReasons) {
                    followUp("What got you?", chips: MISREAD_KINDS, selected: point.misreadKind) { value in
                        Task {
                            await model.setMisreadKind(point, point.misreadKind == value ? nil : value)
                            flashSaved()
                        }
                    }
                }
                if outOfPositionApplies(point.lossReasons) {
                    followUp("Where did they get you?", chips: DIRECTIONS, selected: point.direction) { value in
                        Task {
                            await model.setDirection(point, point.direction == value ? nil : value)
                            flashSaved()
                        }
                    }
                }
                if serveApplies(point.lossReasons) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text((point.lossReasons ?? []).contains("weak_serve")
                            ? "Which serve did you play?"
                            : "Which serve beat you?")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(PL.text200)
                        Text("SPIN")
                            .font(.system(size: 10, weight: .medium))
                            .tracking(0.5)
                            .foregroundStyle(PL.text500)
                        FlowLayout(spacing: 8) {
                            ForEach(SERVE_SPINS) { chip in
                                reasonChipView(chip.label, selected: point.serveSpin == chip.value) {
                                    Task { await model.pickServeSpin(point, chip.value); flashSaved() }
                                }
                            }
                            reasonChipView("+ Sidespin", selected: point.serveSidespin == true) {
                                Task { await model.toggleServeSidespin(point); flashSaved() }
                            }
                        }
                        Text("LENGTH")
                            .font(.system(size: 10, weight: .medium))
                            .tracking(0.5)
                            .foregroundStyle(PL.text500)
                        FlowLayout(spacing: 8) {
                            ForEach(SERVE_LENGTHS) { chip in
                                reasonChipView(chip.label, selected: point.serveLength == chip.value) {
                                    Task {
                                        await model.setServeLength(
                                            point, point.serveLength == chip.value ? nil : chip.value
                                        )
                                        flashSaved()
                                    }
                                }
                            }
                        }
                        if let summary = serveSummaryLabel(
                            spin: point.serveSpin, sidespin: point.serveSidespin,
                            length: point.serveLength
                        ) {
                            Text(summary)
                                .font(.system(size: 11))
                                .foregroundStyle(PL.text600)
                        }
                    }
                }
            }

            // The flash line keeps its slot so answers don't jump.
            HStack(spacing: 10) {
                if savedFlash {
                    Text("Saved")
                        .font(.plCaption)
                        .foregroundStyle(PL.successText)
                }
                if let flashError {
                    Text(flashError)
                        .font(.plCaption)
                        .foregroundStyle(PL.dangerText)
                }
            }
            .frame(height: 14)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard()
    }

    /// A retired confirmed_how worth a summary row: winner-hows on scored
    /// points (nothing writes them since 062).
    private func canonicalHowForDisplay(_ point: MatchPoint) -> String? {
        guard let how = point.confirmedHow, !how.isEmpty else { return nil }
        return how
    }

    private func submitNewReason(_ point: MatchPoint) async {
        let label = newReason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !label.isEmpty, let uid = app.userId else { return }
        savingReason = true
        if let id = await reasonsStore.create(label: label, ownerId: uid) {
            newReason = ""
            addingReason = false
            report(await model.toggleReason(point, customReasonValue(id: id)))
        } else {
            flashError = "Couldn't save that reason. Try again."
        }
        savingReason = false
    }

    private func followUp(
        _ question: String, chips: [ReasonChip], selected: String?,
        pick: @escaping (String) -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(question)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(PL.text200)
            FlowLayout(spacing: 8) {
                ForEach(chips) { chip in
                    reasonChipView(chip.label, selected: selected == chip.value) {
                        pick(chip.value)
                    }
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
                .background(
                    selected ? PL.cyan.opacity(0.15) : PL.ink.opacity(0.4), in: Capsule()
                )
                .overlay(
                    Capsule().strokeBorder(selected ? PL.cyan.opacity(0.6) : PL.edge, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    private func bigChoice(
        _ label: String, selected: Bool, tint: Color, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(selected ? tint : PL.text300)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(
                    selected ? tint.opacity(0.12) : PL.ink.opacity(0.4),
                    in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                        .strokeBorder(selected ? tint.opacity(0.7) : PL.edge, lineWidth: 1)
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
                    gameIndex: gameIndex,
                    opponentLabel: match.opponentName ?? "Them",
                    serverPhysicalSide: serverPhysicalSide,
                    flagged: point.placementFlagged ?? false,
                    onFlagToggle: { Task { await model.togglePlacementFlag(point) } },
                    onSetUserSide: { side in
                        Task { await setUserSide(side) }
                    },
                    onTellUsMore: { feedbackOpen = true }
                )
            } else if match.userSide == nil {
                Text("Tell us which side you played to orient the placement maps.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
            } else {
                Text("No high-confidence placement data is available for this point.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard()
    }

    /// The map's orientation prompt writes matches.user_side — the same
    /// write the Your side sheet does.
    private func setUserSide(_ side: String) async {
        _ = try? await supa
            .from("matches")
            .update(["user_side": side])
            .eq("id", value: match.id.uuidString.lowercased())
            .execute()
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
                    NoteItemView(
                        note: note,
                        matchId: match.id,
                        ownerId: match.userId,
                        viewerId: app.userId ?? match.userId,
                        authorName: notesStore.authorNames[note.authorId],
                        notesStore: notesStore
                    )
                }
            }

            if let pendingImage {
                VStack(alignment: .leading, spacing: 6) {
                    Image(uiImage: pendingImage.preview)
                        .resizable()
                        .scaledToFit()
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .strokeBorder(PL.edge, lineWidth: 1)
                        )
                    HStack(spacing: 12) {
                        Button("Redraw") { captureFrame() }
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(PL.text500)
                            .buttonStyle(.plain)
                        Button("Remove") { clearPendingImage() }
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(PL.text500)
                            .buttonStyle(.plain)
                    }
                }
            } else if clipURLs[point.id] != nil {
                Button {
                    captureFrame()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "pencil.line")
                            .font(.system(size: 12))
                        Text("Draw on this frame")
                    }
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(PL.text400)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .overlay(
                        Capsule().strokeBorder(
                            PL.edge, style: StrokeStyle(lineWidth: 1, dash: [4, 3])
                        )
                    )
                }
                .buttonStyle(.plain)
            }
            if let captureError {
                Text(captureError)
                    .font(.plCaption)
                    .foregroundStyle(PL.warningText)
            }

            NoteComposerView(
                matchId: match.id,
                pointId: point.id,
                userId: app.userId ?? match.userId,
                notesStore: notesStore,
                placeholder: "Add a note about this point",
                pendingImagePath: pendingImage?.path,
                onSent: { clearPendingImage() }
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func clearPendingImage() {
        pendingImage = nil
        captureError = nil
    }

    /// Capture the clip's current frame for the annotator — the paused
    /// moment is the thing worth drawing on.
    private func captureFrame() {
        guard let asset = player.currentItem?.asset else {
            captureError = "The clip isn't ready yet."
            return
        }
        player.pause()
        let time = player.currentTime()
        let generator = AVAssetImageGenerator(asset: asset)
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = .zero
        generator.appliesPreferredTrackTransform = true
        generator.generateCGImageAsynchronously(for: time) { cgImage, _, _ in
            Task { @MainActor in
                if let cgImage {
                    captureError = nil
                    annotateFrame = UIImage(cgImage: cgImage)
                } else {
                    captureError = "Couldn't read that frame. Try while paused."
                }
            }
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

// MARK: - Tag picker

/// The owner's tag vocabulary, applied per point — chips toggle, the field
/// creates. Recent-first, the web TagPicker's contract.
struct TagPickerSheet: View {
    let point: MatchPoint
    let match: MatchRow
    let tagsStore: TagsStore
    let userId: UUID?

    @Environment(\.dismiss) private var dismiss
    @State private var newLabel = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Tag this point")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(PL.textBody)

            HStack(spacing: 8) {
                TextField("New tag", text: $newLabel)
                    .plField()
                    .onSubmit { create() }
                Button("Add") { create() }
                    .buttonStyle(PLSecondaryButtonStyle())
                    .disabled(newLabel.trimmingCharacters(in: .whitespaces).isEmpty)
            }

            if tagsStore.vocab.isEmpty {
                Text("No tags yet. Add one above and it stays in your vocabulary for every match.")
                    .font(.plBody)
                    .foregroundStyle(PL.text500)
            } else {
                ScrollView {
                    FlowLayout(spacing: 8) {
                        ForEach(tagsStore.vocab) { tag in
                            let applied = tagsStore.tags(for: point.id).contains(tag)
                            Button(tag.label) {
                                guard let userId else { return }
                                Task {
                                    await tagsStore.toggle(pointId: point.id, tag: tag, userId: userId)
                                }
                            }
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(applied ? PL.cyan : PL.text300)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(
                                applied ? PL.cyan.opacity(0.15) : PL.ink.opacity(0.4), in: Capsule()
                            )
                            .overlay(
                                Capsule().strokeBorder(
                                    applied ? PL.cyan.opacity(0.6) : PL.edge, lineWidth: 1
                                )
                            )
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .plKeyboardDismiss()
    }

    private func create() {
        let label = newLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !label.isEmpty, let userId else { return }
        newLabel = ""
        Task {
            await tagsStore.create(
                pointId: point.id, label: label, ownerId: match.userId, userId: userId
            )
        }
    }
}

// MARK: - Clip player

/// Speed and zoom persist across point navigation (the web's module-scoped
/// persistedSpeed/persistedZoom): if you zoomed, the camera was too far for
/// the whole recording — every clip needs the same correction.
@MainActor private var persistedZoom: (scale: CGFloat, offset: CGSize) = (1, .zero)

struct ClipPlayerView: View {
    let player: AVPlayer
    let url: URL?
    let starred: Bool
    let tagged: Bool
    let updating: Bool
    let hasPrev: Bool
    let hasNext: Bool
    var canEdit: Bool = true
    /// The tag button belongs to the point sheet, where the tag list is on
    /// screen underneath it. A sequence viewer has nowhere to show one.
    var showTag: Bool = true
    let onStar: () -> Void
    let onTag: () -> Void
    let onPrev: () -> Void
    let onNext: () -> Void
    /// The clip finished. A sequence viewer advances here; the point sheet
    /// passes nothing and the clip simply rests on its last frame.
    var onEnded: (() -> Void)?

    @State private var progress: Double = 0
    @State private var muted = false
    @State private var zoomScale: CGFloat = persistedZoom.scale
    @State private var zoomOffset: CGSize = persistedZoom.offset
    @State private var gestureBase: (scale: CGFloat, offset: CGSize)?
    @State private var observer: Any?

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Color.black
                if url != nil {
                    PlayerLayerView(player: player)
                        .scaleEffect(zoomScale)
                        .offset(zoomOffset)
                        .clipped()
                } else {
                    ProgressView().tint(PL.cyan)
                }

                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture {
                        if player.rate > 0 { player.pause() } else { player.play() }
                    }
                    .gesture(zoomGesture(in: geo.size))

                controls
            }
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
        .overlay(alignment: .topLeading) {
            if updating {
                Text("UPDATING CLIP")
                    .font(.system(size: 9, weight: .semibold))
                    .tracking(0.8)
                    .foregroundStyle(PL.cyan)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(PL.ink.opacity(0.8), in: Capsule())
                    .overlay(Capsule().strokeBorder(PL.cyan.opacity(0.4), lineWidth: 1))
                    .padding(10)
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
            player.isMuted = muted
            player.play()
        }
        .onReceive(
            NotificationCenter.default.publisher(
                for: AVPlayerItem.didPlayToEndTimeNotification
            )
        ) { note in
            // One notification centre, many players: only answer for the
            // item this view is showing, or a clip playing somewhere else
            // advances this sequence.
            guard let onEnded,
                  let item = note.object as? AVPlayerItem,
                  item === player.currentItem
            else { return }
            onEnded()
        }
        .onDisappear {
            if let observer { player.removeTimeObserver(observer) }
            observer = nil
            player.pause()
        }
    }

    private var controls: some View {
        ZStack {
            VStack {
                HStack(spacing: 6) {
                    Spacer()
                    if canEdit {
                        if showTag {
                            glassButton(
                                icon: "tag", size: 12,
                                tint: tagged ? PL.cyan : PL.text200, action: onTag
                            )
                            .accessibilityLabel("Tag this point")
                        }
                        glassButton(
                            icon: starred ? "star.fill" : "star", size: 12,
                            tint: starred ? Color(hex: 0xFFD230) : PL.text200, action: onStar
                        )
                        .accessibilityLabel(starred ? "Remove star" : "Star this point")
                    }
                    glassButton(
                        icon: muted ? "speaker.slash.fill" : "speaker.wave.2.fill", size: 12,
                        tint: PL.text200
                    ) {
                        muted.toggle()
                        player.isMuted = muted
                    }
                    .accessibilityLabel(muted ? "Unmute" : "Mute")
                }
                Spacer()
                HStack(spacing: 6) {
                    Spacer()
                    glassButton(
                        icon: "arrow.counterclockwise", size: 13,
                        tint: PL.text100
                    ) {
                        player.seek(to: .zero)
                        player.play()
                    }
                    .accessibilityLabel("Replay this point")
                    glassButton(icon: "minus.magnifyingglass", size: 13, tint: zoomScale > 1 ? PL.text100 : PL.text500) {
                        setZoom(scale: max(1, zoomScale / 1.5))
                    }
                    .accessibilityLabel("Zoom out")
                    glassButton(icon: "plus.magnifyingglass", size: 13, tint: PL.text100) {
                        setZoom(scale: min(4, zoomScale * 1.5))
                    }
                    .accessibilityLabel("Zoom in")
                }
            }
            // Prev/next flank the clip at mid-height — the video is where
            // the eyes are, so navigation lives on it.
            HStack {
                if hasPrev {
                    glassButton(icon: "chevron.left", size: 15, tint: PL.text100, action: onPrev)
                        .accessibilityLabel("Previous point")
                }
                Spacer()
                if hasNext {
                    glassButton(icon: "chevron.right", size: 15, tint: PL.text100, action: onNext)
                        .accessibilityLabel("Next point")
                }
            }
        }
        .padding(8)
    }

    private func glassButton(
        icon: String, size: CGFloat, tint: Color, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: size, weight: .medium))
                .foregroundStyle(tint)
                .frame(width: 32, height: 32)
                .background(PL.ink.opacity(0.65), in: Circle())
        }
        .buttonStyle(.plain)
    }

    private func setZoom(scale: CGFloat) {
        zoomScale = scale
        if scale <= 1 { zoomOffset = .zero }
        clampOffset()
        persistedZoom = (zoomScale, zoomOffset)
    }

    private func clampOffset() {
        // Keep the frame covered: the pan can't reveal the void behind it.
        let limit = (zoomScale - 1) * 90
        zoomOffset = CGSize(
            width: min(max(zoomOffset.width, -limit), limit),
            height: min(max(zoomOffset.height, -limit), limit)
        )
    }

    private func zoomGesture(in size: CGSize) -> some Gesture {
        let pinch = MagnifyGesture()
            .onChanged { value in
                if gestureBase == nil { gestureBase = (zoomScale, zoomOffset) }
                zoomScale = min(4, max(1, (gestureBase?.scale ?? 1) * value.magnification))
                clampOffset()
            }
            .onEnded { _ in
                gestureBase = nil
                if zoomScale < 1.05 { setZoom(scale: 1) } else { persistedZoom = (zoomScale, zoomOffset) }
            }
        let pan = DragGesture(minimumDistance: 12)
            .onChanged { value in
                guard zoomScale > 1 else { return }
                if gestureBase == nil { gestureBase = (zoomScale, zoomOffset) }
                zoomOffset = CGSize(
                    width: (gestureBase?.offset.width ?? 0) + value.translation.width,
                    height: (gestureBase?.offset.height ?? 0) + value.translation.height
                )
                clampOffset()
            }
            .onEnded { _ in
                gestureBase = nil
                persistedZoom = (zoomScale, zoomOffset)
            }
        return pinch.simultaneously(with: pan)
    }
}

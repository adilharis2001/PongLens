import AVFoundation
import SwiftUI
import Supabase

// The Keep-score surfaces that sit over or beside the pad: the Why fast
// lane, the two game-boundary sheets, the setup sheet, the transport, and
// the pad's non-blocking offers. Split out of PlayerTakeover.swift because
// that file was already the longest screen in the app; the state still
// lives there, since an extension cannot hold any.

extension PlayerTakeover {

    // MARK: - Why: score them and say why, in one tap

    /// The bubble in the opponent tile's corner. It scores the same side the
    /// button around it would, so a mis-tap costs a dismissal and never a
    /// wrong score — then holds the advance and opens the question.
    @ViewBuilder
    func whyBubble(_ target: MatchPoint?, size: CGFloat) -> some View {
        if whyAvailable, target != nil {
            let answered = target?.lossReasons?.isEmpty == false
            Button {
                tapWinner(.opponent, thenWhy: true)
            } label: {
                Text("Why")
                    .font(.system(size: size > 40 ? 13 : 11, weight: .semibold))
                    // Magenta in BOTH states. It belongs to the opponent's
                    // tile and means "they won it" — cyan is the other
                    // player's colour everywhere else in the app, so a cyan
                    // Why reads as the wrong side having taken the point.
                    // Filled once answered, so a pass leaves a visible trail
                    // of which losses you have explained.
                    .foregroundStyle(answered ? PL.magentaSoft : PL.magentaSoft.opacity(0.8))
                    .padding(.horizontal, size > 40 ? 16 : 10)
                    .frame(height: size)
                    .background(
                        answered ? PL.magenta.opacity(0.25) : PL.ink.opacity(0.6),
                        in: Capsule()
                    )
                    .overlay(
                        Capsule().strokeBorder(
                            answered ? PL.magenta : PL.magenta.opacity(0.4),
                            lineWidth: 1
                        )
                    )
            }
            .buttonStyle(.plain)
            .padding(size > 40 ? 8 : 4)
            .accessibilityLabel("\(match.opponentName ?? "They") won it — say why you lost")
        }
    }

    /// The loss reasons are strictly first-person, so there is only a
    /// question here on the owner's own match. Better absent than empty.
    var whyAvailable: Bool {
        reasonsStore != nil && app.userId == match.userId
    }

    /// ONE question over the pad, never over the video — the rally you are
    /// explaining has to stay on screen. One chip saves the reason, closes
    /// the overlay and moves on: no confirm, no dismiss, no clock. That
    /// single rule is what makes the pass fast, so nothing here bends it.
    @ViewBuilder
    var whyOverlay: some View {
        if let point = whyPoint, let reasonsStore {
            let iServed = serving[point.id]?.server.map { $0 == .user }
            ZStack(alignment: .bottom) {
                PL.ink.opacity(0.8)
                    .ignoresSafeArea()
                    .onTapGesture { closeWhy() }
                VStack(alignment: .leading, spacing: 14) {
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Why did you lose it?")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(PL.text100)
                            if let iServed {
                                Text(iServed ? "You served" : "\(match.opponentName ?? "They") served")
                                    .font(.plSection)
                                    .tracking(0.6)
                                    .textCase(.uppercase)
                                    .foregroundStyle(PL.text500)
                            }
                        }
                        Spacer()
                        Button("Skip") { closeWhy() }
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                            .buttonStyle(.plain)
                            .accessibilityLabel("Skip the question")
                    }

                    FlowLayout(spacing: 8) {
                        ForEach(lossReasonsFor(iServed: iServed, custom: reasonsStore.reasons)) { chip in
                            Button { answerWhy(point, chip.value) } label: {
                                Text(chip.label)
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundStyle(PL.text200)
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 9)
                                    .background(PL.ink.opacity(0.5), in: Capsule())
                                    .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                            }
                            .buttonStyle(.plain)
                        }
                        // Neither of these is a reason, so both are dashed.
                        if !whyCustomOpen {
                            dashedChip("Enter custom") { whyCustomOpen = true }
                        }
                        dashedChip("More details →") { whyMoreDetails(point) }
                    }

                    if whyCustomOpen {
                        HStack(spacing: 8) {
                            TextField("Misread the pips", text: $whyCustom)
                                .plField()
                                .submitLabel(.done)
                                .onSubmit { Task { await submitWhyCustom(point) } }
                            Button("Add") { Task { await submitWhyCustom(point) } }
                                .buttonStyle(PLCyanGhostButtonStyle())
                                .disabled(whyCustom.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    }
                }
                .padding(18)
                .padding(.bottom, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(PL.surface)
                .overlay(alignment: .top) { Divider().overlay(PL.edge) }
                .clipShape(.rect(topLeadingRadius: 18, topTrailingRadius: 18))
            }
            .transition(.opacity)
        }
    }

    private func dashedChip(_ label: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(PL.text500)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .overlay(
                    Capsule().strokeBorder(
                        PL.edge, style: StrokeStyle(lineWidth: 1, dash: [4, 3])
                    )
                )
        }
        .buttonStyle(.plain)
    }

    /// THE ANSWER IS THE EXIT. Single-select on purpose: with the tap
    /// doubling as the exit there is only room for one, and being made to
    /// name the PRIMARY cause sharpens the chart more than a soup of
    /// co-selected chips would. The Analysis panel is where a point can
    /// carry several.
    func answerWhy(_ point: MatchPoint, _ value: String) {
        whyPoint = nil
        whyCustomOpen = false
        whyCustom = ""
        Task { await model.setLossReasons(point, [value]) }
        advanceFromWhy(point)
    }

    /// Naming your own reason without leaving the fast lane. It breaks the
    /// one-tap rule on purpose — typing cannot be one tap — but it lands in
    /// the same place.
    func submitWhyCustom(_ point: MatchPoint) async {
        let label = whyCustom.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !label.isEmpty, let uid = app.userId, let reasonsStore else { return }
        if let id = await reasonsStore.create(label: label, ownerId: uid) {
            answerWhy(point, customReasonValue(id: id))
        }
    }

    /// Hand off to the unhurried door: the follow-ups, a note, a tag. The
    /// point is already scored, so the panel opens straight into questions,
    /// and closing it resumes the advance this tap held back.
    func whyMoreDetails(_ point: MatchPoint) {
        whyPoint = nil
        whyCustomOpen = false
        whyCustom = ""
        advanceAfterSheet = point.id
        withAnimation(.easeOut(duration: 0.22)) { analysisPoint = point }
    }

    /// Back to the pad without answering — where the score buttons are live
    /// again, so a mis-tapped winner can still be corrected. Never advances.
    func closeWhy() {
        whyPoint = nil
        whyCustomOpen = false
        whyCustom = ""
    }

    /// Answering Why goes STRAIGHT to the next rally — it does not play the
    /// clip out the way a plain winner tap does.
    ///
    /// The tail rule exists because an early winner tap might have called a
    /// point that has not finished, and there could be a second rally in the
    /// clip worth seeing (which is what the split nudge is for). Neither
    /// applies here: you have just told the app who won AND why, so there is
    /// nothing left to decide about this point, and sitting through the rest
    /// of its footage is the opposite of the fast lane this is meant to be.
    func advanceFromWhy(_ point: MatchPoint) {
        guard phase == .play else {
            if phase == .review { nextReviewFromWhy() }
            return
        }
        jumpAfter(point)
    }

    private func nextReviewFromWhy() {
        Task {
            try? await Task.sleep(nanoseconds: 400_000_000)
            nextReview()
        }
    }

    // MARK: - Analysis

    /// The unhurried door: every follow-up question, a tag and a note, on
    /// the point that was on screen when it opened. It slides in over the
    /// PAD and never over the video — the frame you are judging has to stay
    /// visible while you answer it.
    @ViewBuilder
    func analysisLayer(landscape: Bool) -> some View {
        if let point = analysisPoint, let reasonsStore {
            PadAnalysisPanel(
                match: match, model: model, pointId: point.id,
                number: (points.firstIndex(where: { $0.id == point.id }) ?? 0) + 1,
                reasonsStore: reasonsStore, serving: serving,
                notesStore: notesStore, tagsStore: tagsStore,
                landscape: landscape,
                onClose: { closeAnalysis() }
            )
            .transition(.move(edge: .trailing))
        }
    }

    /// Pause and bring the panel in.
    ///
    /// Prefers the point JUST SCORED over the one under the playhead.
    /// Scoring advances and plays, so within a few seconds of a tap the
    /// playhead is already on the next rally. The window is what keeps it
    /// honest: opening this seconds after scoring means "about the one I
    /// just did", and opening it after scrubbing somewhere deliberately
    /// means "about what I am looking at".
    func openAnalysis() {
        let justScored = lastScored
            .flatMap { Date().timeIntervalSince($0.at) < 15 ? $0.id : nil }
            .flatMap { id in points.first { $0.id == id } }
        guard let p = justScored ?? tapTarget else { return }
        player.pause()
        withAnimation(.easeOut(duration: 0.22)) { analysisPoint = p }
    }

    /// Closing resumes whatever the panel interrupted, so writing a note
    /// costs a note and not the rhythm of the pass.
    func closeAnalysis() {
        withAnimation(.easeOut(duration: 0.2)) { analysisPoint = nil }
        guard let id = advanceAfterSheet else { return }
        advanceAfterSheet = nil
        if let p = points.first(where: { $0.id == id }) { advance(from: p) }
    }

    // The panel used to open and close on a horizontal drag, the way the
    // web pad does. It came out again: the chip strip scrolls sideways
    // through the points, and the two gestures live on the same screen —
    // so a flick along the balls kept pulling the panel in instead of
    // moving through the match. Analysis has a button in both layouts and
    // the panel has its own Done, which is one obvious way rather than two
    // that fight.

    // MARK: - Game boundary sheets

    /// Asked right after pinning an end at a score the 11-clear-by-2 rule
    /// cannot decide. Skipping leaves the game counted for nobody, which is
    /// what happened silently before there was a question.
    @ViewBuilder
    func winnerAskSheet(_ ask: WinnerAsk) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Who won this game?")
                .font(.plCardTitle)
                .foregroundStyle(PL.text100)
            Text("The recorded score is \(ask.you)-\(ask.them), which doesn't decide it. Some points may be missing from the video.")
                .font(.plBody)
                .foregroundStyle(PL.text400)
            HStack(spacing: 10) {
                gameWinnerButton("Me", tint: PL.cyan) { nameGameWinner(ask, .user) }
                gameWinnerButton(match.opponentName ?? "Them", tint: PL.magentaSoft) {
                    nameGameWinner(ask, .opponent)
                }
            }
            Button("Not sure") { winnerAsk = nil }
                .font(.plCaption)
                .foregroundStyle(PL.text500)
                .buttonStyle(.plain)
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func nameGameWinner(_ ask: WinnerAsk, _ side: Winner) {
        winnerAsk = nil
        guard let p = model.points.first(where: { $0.id == ask.pointId }) else { return }
        Task { await model.setGameWinner(p, side) }
        showFlash(side == .user ? "Game to you" : "Game to \(match.opponentName ?? "them")")
    }

    private func gameWinnerButton(
        _ label: String, tint: Color, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(tint.opacity(0.1), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                        .strokeBorder(tint.opacity(0.45), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    /// The divider tapped in the chip strip. Removing the boundary holds the
    /// game open through this point, which reads the same whether the end
    /// came from the score or from a Game ended tap.
    @ViewBuilder
    func gameBreakSheet(_ brk: GameBreak) -> some View {
        let point = model.points.first { $0.id == brk.pointId }
        let named = point?.gameWinnerOverride
        let undecided = gameWinner(GameSummary(you: brk.you, them: brk.them, winnerOverride: nil)) == nil
        VStack(alignment: .leading, spacing: 0) {
            // The score IS the headline here. You tapped a divider in the
            // strip to ask about one game, so lead with the game and its
            // result rather than with a sentence about them.
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("\(brk.you)")
                    .foregroundStyle(PL.cyan)
                + Text(" – ")
                    .foregroundStyle(PL.text600)
                + Text("\(brk.them)")
                    .foregroundStyle(PL.magentaSoft)
            }
            .font(.system(size: 34, weight: .bold))
            .monospacedDigit()

            Text("Game \(brk.game) ended here")
                .font(.plBody)
                .foregroundStyle(PL.text400)
                .padding(.top, 2)

            if undecided, let point {
                Divider().overlay(PL.edge).padding(.vertical, 18)
                Text("Who won it?")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(PL.text100)
                Text("The score doesn't decide it.")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                    .padding(.top, 1)
                HStack(spacing: 10) {
                    breakWinnerPill("Me", tint: PL.cyan, on: named == .user) {
                        Task { await model.setGameWinner(point, named == .user ? nil : .user) }
                    }
                    breakWinnerPill(
                        match.opponentName ?? "Them", tint: PL.magentaSoft,
                        on: named == .opponent
                    ) {
                        Task { await model.setGameWinner(point, named == .opponent ? nil : .opponent) }
                    }
                }
                .padding(.top, 12)
            }

            Divider().overlay(PL.edge).padding(.vertical, 18)

            // The correction, said as what it does. Not destructive — the
            // game keeps counting — so it is not dressed in red.
            Button {
                gameBreak = nil
                guard let point else { return }
                applyGameOverride(point, .continue)
                freshBoundary = nil
                showFlash("Game continues")
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "arrow.uturn.backward")
                        .font(.system(size: 13, weight: .semibold))
                    VStack(alignment: .leading, spacing: 1) {
                        Text("The game didn't end here")
                            .font(.system(size: 14, weight: .semibold))
                        Text("Keep counting into the same game")
                            .font(.system(size: 11))
                            .foregroundStyle(PL.text500)
                    }
                    Spacer()
                }
                .foregroundStyle(PL.text200)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(PL.ink.opacity(0.45), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(PL.edge, lineWidth: 1)
                )
            }
            .buttonStyle(.plain)

            Spacer(minLength: 0)
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The sheet grows by the "who won it?" block, which only a score the
    /// rule cannot decide gets. One detent sized for the taller case leaves
    /// a band of empty sheet under the common one.
    func gameBreakSheetHeight(_ brk: GameBreak) -> CGFloat {
        gameWinner(GameSummary(you: brk.you, them: brk.them, winnerOverride: nil)) == nil
            ? 360 : 250
    }

    private func breakWinnerPill(
        _ label: String, tint: Color, on: Bool, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(tint)
                .lineLimit(1)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(tint.opacity(on ? 0.2 : 0.05), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                        .strokeBorder(tint.opacity(on ? 0.9 : 0.3), lineWidth: on ? 2 : 1)
                )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Setup

    /// Who served first. The web asks for player names here too, but those
    /// are the side-mapped player_near_name / player_far_name pair that the
    /// tagging panel owns, and iOS models neither — a sheet that writes
    /// names nothing else in the app can read or correct is worse than no
    /// sheet. See ios/docs/web-parity-specs for the tagging port.
    ///
    /// The quiet Skip never blocks scoring; playback starts from whichever
    /// tap dismisses this.
    var setupSheet: some View {
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
            Button("Skip") { dismissSetup() }
                .font(.plCaption)
                .foregroundStyle(PL.text500)
                .buttonStyle(.plain)
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    func dismissSetup() {
        setupOpen = false
        if let resume = pendingResumeToast {
            showToast(resume)
            pendingResumeToast = nil
        }
        play()
    }

    func firstServerButton(_ label: String, value: String) -> some View {
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
            dismissSetup()
        }
        .font(.system(size: 15, weight: .semibold))
        .foregroundStyle(PL.cyan)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 13)
        .background(PL.cyan.opacity(0.1), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                .strokeBorder(PL.cyan.opacity(0.5), lineWidth: 1)
        )
        .buttonStyle(.plain)
    }

    // MARK: - Pad offers

    /// Recorded warm-up is the top reason a match's head is junk. Only while
    /// NOTHING in the match has been answered — the first real answer
    /// retires the offer for good, so it can never interrupt actual scoring.
    @ViewBuilder
    var startHereOffer: some View {
        if startHereCount > 0 {
            HStack(spacing: 8) {
                Text("Match starts here? The \(startHereCount) earlier point\(startHereCount == 1 ? "" : "s") can go.")
                    .font(.system(size: 11))
                    .foregroundStyle(PL.text300)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                offerPill("Remove them", tint: PL.cyan) { tapStartHere() }
                offerPill("Keep", tint: PL.text300) { startHereDismissed = true }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(PL.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            )
        }
    }

    func tapStartHere() {
        guard let target = displayTarget, let i = points.firstIndex(of: target), i > 0 else { return }
        let swept = points.prefix(i).map(\.id)
        undoStack.append(.bulkDelete(pointIds: Array(swept), cutT0: points.first?.cutT0))
        startHereDismissed = true
        Task { await model.deleteBefore(target) }
        showFlash("\(swept.count) removed")
    }

    /// Offered on the clip you just answered when a rally's worth of footage
    /// was still to run. It sits in the pad, not over the video, because the
    /// video is now playing the part you had not seen: watch it, then decide.
    @ViewBuilder
    var splitNudgeOffer: some View {
        if let nudge = splitNudge,
           let n = points.firstIndex(where: { $0.id == nudge.pointId }) {
            HStack(spacing: 8) {
                // Named, because the offer outlives the clip: the tail plays
                // out and the pad moves on, and "this clip" would then be
                // pointing at the wrong one.
                Text("Point \(n + 1)\(nudge.certain ? " looks like two points." : " — two points in there?")")
                    .font(.system(size: 11))
                    .foregroundStyle(PL.warning.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                offerPill("Split", tint: PL.warning) {
                    let p = points.first { $0.id == nudge.pointId }
                    splitNudge = nil
                    // Splitting outright lands the cut sight-unseen. Open
                    // Modify with the suggested cut seeded instead: the user
                    // SEES where the split goes and confirms it.
                    if let p {
                        player.pause()
                        modifyInitialCut = nudge.atCut
                        modifyPoint = p
                    }
                }
                // "No" rather than a bare dismiss: answering the question
                // also answers what to do next. One point in the clip means
                // the rest is the walk-back, and waiting through it is time
                // you did not need to spend.
                offerPill("No", tint: PL.text300) {
                    let p = points.first { $0.id == nudge.pointId }
                    splitNudge = nil
                    playTail = nil
                    if let p { jumpAfter(p) }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(PL.ink.opacity(0.6), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(PL.warning.opacity(0.4), lineWidth: 1)
            )
        }
    }

    private func offerPill(
        _ label: String, tint: Color, _ action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(tint)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .overlay(Capsule().strokeBorder(tint.opacity(0.5), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .fixedSize()
    }

    // MARK: - Pad controls

    /// The pad's speed control. A three-way cycle was the old shortcut and
    /// it hid half the range: the watch transport has offered all six speeds
    /// for a while, and a scorer studying a serve wants the same 0.1x the
    /// watcher gets.
    func padSpeedMenu() -> some View {
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
            VStack(spacing: 4) {
                Text(speedLabel(Double(rate)))
                    .font(.system(size: 13, weight: .bold))
                    .monospacedDigit()
                    .frame(height: 16)
                Text("Speed")
                    .font(.system(size: 9, weight: .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            .foregroundStyle(PL.text300)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(PL.ink.opacity(0.4), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            )
        }
        // Without the plain style the menu repaints its label and the text
        // vanishes into the tile.
        .buttonStyle(.plain)
        .accessibilityLabel("Playback speed")
    }

    /// The landscape mini row's speed control — the same six as everywhere
    /// else, in a 46pt tile.
    func miniSpeedMenu(wide: Bool = false) -> some View {
        Menu {
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
            VStack(spacing: 1) {
                Text(speedLabel(Double(rate)))
                    .font(.system(size: 13, weight: .bold))
                    .monospacedDigit()
                    .frame(height: 16)
                Text("Speed").font(.system(size: 8, weight: .medium))
            }
            .foregroundStyle(PL.text200)
            .frame(
                maxWidth: wide ? .infinity : PlayerTakeover.miniControlSize.width,
                minHeight: PlayerTakeover.miniControlSize.height,
                maxHeight: PlayerTakeover.miniControlSize.height
            )
            .background(PL.surface2, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Playback speed")
    }

    /// The boundary control was portrait-only, so a landscape pass had no way
    /// to close or reopen a game at all.
    func miniBoundaryControl(wide: Bool = false) -> some View {
        let offer = boundaryOffer
        return Button {
            tapBoundary()
        } label: {
            // Text alone, like the pad's. The flag was a second way of
            // saying "game" that cost the label the room it needed.
            Text(offer?.label ?? "Game ended")
                .font(.system(size: 11, weight: .semibold))
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
                .padding(.horizontal, 2)
            .foregroundStyle(
                offer == nil ? PL.text600
                    : (offer!.endsHere || offer!.attention) ? PL.cyan : PL.text200
            )
            .frame(
                maxWidth: wide ? .infinity : PlayerTakeover.miniControlSize.width,
                minHeight: PlayerTakeover.miniControlSize.height,
                maxHeight: PlayerTakeover.miniControlSize.height
            )
            .background(PL.surface2, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .strokeBorder(
                        offer?.attention == true ? PL.cyan : .clear,
                        lineWidth: 2
                    )
            )
        }
        .buttonStyle(.plain)
        .disabled(offer == nil)
        .accessibilityLabel(offer?.accessibility ?? "Mark the game as ended")
    }

    /// Admin only, on the owner's own match: the serve-start label (089).
    /// A second tap RE-STAMPS rather than toggling off — the common
    /// correction is "I tapped late", and the fix is to scrub back and tap
    /// again. Clearing is the rare case and gets its own control.
    @ViewBuilder
    func serveStartControls() -> some View {
        if canLabelServeStart, let target = displayTarget {
            HStack(spacing: 10) {
                Button {
                    Task {
                        await model.setServeStart(
                            target, at: currentT, paused: player.rate == 0,
                            rate: player.rate, source: "button"
                        )
                    }
                    showFlash("Serve start")
                } label: {
                    Text("Serve start")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(target.serveStartAtCutS == nil ? PL.text200 : PL.cyan)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 9)
                        .background(
                            target.serveStartAtCutS == nil
                                ? Color.clear : PL.cyan.opacity(0.15),
                            in: Capsule()
                        )
                        .overlay(
                            Capsule().strokeBorder(
                                target.serveStartAtCutS == nil ? PL.edge : PL.cyan,
                                lineWidth: 1
                            )
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Mark where the serve began")
                if target.serveStartAtCutS != nil {
                    Button("Clear") {
                        Task {
                            await model.setServeStart(
                                target, at: nil, paused: nil, rate: nil, source: nil
                            )
                        }
                    }
                    .font(.system(size: 14))
                    .foregroundStyle(PL.text400)
                    .buttonStyle(.plain)
                }
            }
        }
    }

    /// Admin, on their own match. The number itself never goes on the pad:
    /// the scrubber already shows a clock, and two clocks that can disagree
    /// read as a bug.
    var canLabelServeStart: Bool {
        app.isAdmin && app.userId == match.userId
    }

    /// Review lets you pass on a point without answering it. Without this
    /// the queue only moves on an answer, so a rally you genuinely cannot
    /// call is a dead end.
    @ViewBuilder
    var reviewNextButton: some View {
        if phase == .review {
            Button("Next") { nextReview() }
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(PL.cyan)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .overlay(Capsule().strokeBorder(PL.cyan.opacity(0.5), lineWidth: 1))
                .buttonStyle(.plain)
        }
    }

    // MARK: - Gestures help

    var gesturesSheet: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(mode == .score ? "Keep score gestures" : "Player gestures")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(PL.textBody)
                gestureRow("hand.tap", "Tap the picture", "Play or pause. At a freeze, this resumes without scoring.")
                gestureRow("hand.tap.fill", "Double tap", "Right side jumps to the next point, left goes back one, the middle plays this one again.")
                gestureRow("hand.point.up.left", "Press and hold", "Right side runs at 2x, left at a quarter speed, while you hold.")
                gestureRow("arrow.left.arrow.right", "Swipe across", "Five seconds either way.")
                gestureRow("arrow.up.left.and.arrow.down.right", "Pinch", "Zoom in up to four times, then drag to move around.")
                if mode == .score {
                    gestureRow("flag", "Game ended", "Closes a game at the rally on screen. It reads \"Didn't end\" where one already closes, so the same button undoes it.")
                    gestureRow("circle.fill", "The serve ball", "Tap either ball to change who served. The whole rotation recomputes.")
                }
            }
            .padding(20)
        }
    }

    private func gestureRow(_ icon: String, _ title: String, _ body: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 15))
                .foregroundStyle(PL.cyan)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PL.text200)
                Text(body)
                    .font(.plCaption)
                    .foregroundStyle(PL.text400)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: - Toast

    func showToast(_ message: String) {
        withAnimation { toast = message }
        Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            withAnimation { if toast == message { toast = nil } }
        }
    }
}

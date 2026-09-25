import AVFoundation
import SwiftUI

// "Mark the points" on iPhone: the web's marker (MarkPoints.tsx) as a MODE
// of the full-screen player rather than a second player. The rules are
// Core/HandCut.swift, proved against the web's own output; the session
// state is HandCutMarker; this file is the screen and the taps.
//
// The contract is docs/superpowers/specs/2026-09-24-ios-hand-cut-marker-
// inventory.md, value by value and word for word. The approved deviations
// are in the design spec's section 3: the iPhone player's own gestures,
// 44pt touch targets, one speed shown truthfully, no hover or keyboard, the
// web's defects fixed rather than ported, and phone landscape in the
// Scorekeeper's language (solid bars and rails, the approved mockup).
//
// The picture plays the ORIGINAL upload through the takeover's own player:
// tap to play or pause, double tap either half for ten seconds, swipe for
// five, press and hold for 0.25x or 2x, pinch to zoom. Nothing here moves
// the clock except through `seek(to:)` and `play()`, so the takeover's
// guards against stale ticks still hold.

private let amber200 = Color(hex: 0xFEE685)
private let amber300 = PL.warningText
private let amber400 = PL.warning

extension PlayerTakeover {

    // MARK: - Layout

    @ViewBuilder
    func markLayout(_ geo: GeometryProxy) -> some View {
        if let hc = marker {
            let landscape = geo.size.width > geo.size.height
            ZStack {
                if landscape {
                    markLandscape(geo, hc)
                } else {
                    markPortrait(geo, hc)
                }
                markServeSheet(hc, landscape: landscape, bottomInset: geo.safeAreaInsets.bottom)
                markReviewSheet(hc)
            }
            .alert(
                CutAgainCopy.clearTitle,
                isPresented: Binding(
                    get: { hc.confirmingStartAgain },
                    set: { hc.confirmingStartAgain = $0 }
                )
            ) {
                Button(CutAgainCopy.clear, role: .destructive) { markStartAgain() }
                Button(CutAgainCopy.cancel, role: .cancel) {}
            }
        }
    }

    /// Mobile web portrait: the picture full width at the file's own shape,
    /// capped at 42% of the height, and the pad filling the rest.
    func markPortrait(_ geo: GeometryProxy, _ hc: HandCutMarker) -> some View {
        let w = geo.size.width
        let h = min(w / CGFloat(max(0.1, hc.aspect)), geo.size.height * 0.42)
        return VStack(spacing: 0) {
            markPicture(geo, hc, box: CGSize(width: w, height: h), landscape: false)
                .frame(width: w, height: h)
                .clipped()
            markPad(hc)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(PL.ink.ignoresSafeArea())
    }

    /// The approved landscape: a solid top bar, the answers on the left
    /// rail, the pair on the right, the tools along the bottom, and the
    /// picture fitted into what is left by the Scorekeeper's formula.
    /// Nothing permanent sits on the picture.
    func markLandscape(_ geo: GeometryProxy, _ hc: HandCutMarker) -> some View {
        // The shared geometry (MarkLandscape, the web's markLandscape.ts),
        // over this frame with no insets: the frame is ALREADY inside the
        // safe area and still reports the insets, so passing them too would
        // spend them twice (landscape-scorer note). The bars' backgrounds
        // reach out to the glass on their own.
        let g = MarkLandscape(
            w: Double(geo.size.width), h: Double(geo.size.height), aspect: hc.aspect
        )
        let side = CGFloat(MarkLandscape.sideMargin)
        let rail = CGFloat(g.rail)
        let boxW = CGFloat(g.boxW)
        let boxH = CGFloat(g.boxH)
        return VStack(spacing: 0) {
            markTopBar(hc, side: side)
                .frame(height: CGFloat(MarkLandscape.topBarH))
            HStack(spacing: 0) {
                markAnswerRail(hc, g)
                    .frame(width: rail, alignment: .leading)
                markPicture(geo, hc, box: CGSize(width: boxW, height: boxH), landscape: true)
                    .frame(width: boxW, height: boxH)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                markPairRail(hc, g)
                    .frame(width: rail, alignment: .trailing)
            }
            .frame(width: CGFloat(g.avail))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, side)
            .frame(height: CGFloat(max(0, g.midH)))
            markBottomBar(hc, side: side)
                .frame(height: CGFloat(MarkLandscape.bottomBarH), alignment: .top)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.black.ignoresSafeArea())
    }

    // MARK: - The picture

    /// The takeover's own video surface and gestures, plus the marker's few
    /// things on it: the close button and the ±5s / Prev·Next pair in
    /// portrait, the play glyph, and in landscape the refusal line.
    func markPicture(
        _ geo: GeometryProxy, _ hc: HandCutMarker, box: CGSize, landscape: Bool
    ) -> some View {
        videoArea(geo, inBands: true, boxSize: box)
            .overlay(alignment: .topTrailing) {
                if !landscape { markCloseButton(hc, filled: false).padding(4) }
            }
            .overlay(alignment: .leading) {
                if !landscape { markSkipButton(hc, forward: false).padding(.leading, 10) }
            }
            .overlay(alignment: .trailing) {
                if !landscape { markSkipButton(hc, forward: true).padding(.trailing, 10) }
            }
            .overlay { markPlayGlyph(hc) }
            .overlay(alignment: .top) {
                if landscape, let refusal = markStatus(hc) {
                    markRefusalLine(refusal)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(PL.ink.opacity(0.85), in: Capsule())
                        .padding(.top, 12)
                }
            }
    }

    /// ±5s while marking, Prev and Next while a point is selected. 40pt
    /// circles on the picture's mid-height, each inside a 44pt target.
    func markSkipButton(_ hc: HandCutMarker, forward: Bool) -> some View {
        let stepping = hc.reviewingPoint
        let enabled = !stepping || (forward ? hc.hasNext : hc.hasPrev)
        let label = stepping ? (forward ? "Next" : "Prev") : (forward ? "+5s" : "\u{2212}5s")
        return Button {
            if stepping { markStep(forward ? 1 : -1) } else { markSeekBy(forward ? 5 : -5) }
        } label: {
            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(PL.text100)
                .frame(width: 40, height: 40)
                .background(PL.ink.opacity(0.6), in: Circle())
                .overlay(Circle().strokeBorder(Color.white.opacity(0.15), lineWidth: 1))
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.3)
        .accessibilityLabel(stepping
            ? (forward ? "Next point" : "Previous point")
            : (forward ? "Forward five seconds" : "Back five seconds"))
    }

    /// Held still for 340ms, a play button in the middle of the picture.
    /// Before the first play it stands in for the web player's poster
    /// glyph; after that it shows only once the session has started.
    @ViewBuilder
    func markPlayGlyph(_ hc: HandCutMarker) -> some View {
        if hc.stopped, !hc.everPlayed || hc.started, !loadFailed {
            Button {
                play()
            } label: {
                Image(systemName: "play.fill")
                    .font(.system(size: 20))
                    .foregroundStyle(PL.text100)
                    .offset(x: 2)
                    .frame(width: 48, height: 48)
                    .background(PL.ink.opacity(0.6), in: Circle())
                    .overlay(Circle().strokeBorder(Color.white.opacity(0.15), lineWidth: 1))
                    .contentShape(Circle())
            }
            .buttonStyle(HCPressStyle(scale: 1, dim: true))
            .accessibilityLabel("Play")
        }
    }

    func markCloseButton(_ hc: HandCutMarker, filled: Bool) -> some View {
        Button {
            markClose()
        } label: {
            Image(systemName: "xmark")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(filled ? PL.text200 : PL.text300)
                .frame(width: 32, height: 32)
                .background(filled ? PL.surface2 : PL.ink.opacity(0.6), in: Circle())
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Close")
    }

    // MARK: - Portrait pad

    func markPad(_ hc: HandCutMarker) -> some View {
        VStack(spacing: 0) {
            markTicker(hc, landscape: false)
                .frame(minHeight: 32)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .overlay(alignment: .bottom) { markHairline }
            markStrip(hc, chip: 32, landscape: false)
                .frame(height: 52)
                .overlay(alignment: .bottom) { markHairline }
            Group {
                if hc.adjustOn {
                    markRangeBar(hc, landscape: false)
                } else {
                    markSpeedBar()
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 46)
            .overlay(alignment: .bottom) { markHairline }
            GeometryReader { g in
                markControls(hc, height: g.size.height)
            }
        }
    }

    var markHairline: some View {
        Rectangle().fill(PL.edge.opacity(0.6)).frame(height: 1)
    }

    /// Refusal, then the gate or the pair, answers and tools, then the
    /// footer (MarkPortraitPad): while marking, the pair and the answers
    /// share what is left 3:2; the gate is plain buttons at the top. The
    /// footer always sits at the bottom.
    func markControls(_ hc: HandCutMarker, height: CGFloat) -> some View {
        let gap = CGFloat(MarkPortraitPad.gap)
        let status = markStatus(hc)
        let answers = hc.mode == .score
        let pass = MarkPortraitPad.pass(height: Double(height), refusal: status != nil, answers: answers)
        let gate = MarkPortraitPad.gate(
            height: Double(height), refusal: status != nil,
            buttons: hc.openedPartial ? 2 : 1, startAgain: hc.canStartAgain
        )
        return VStack(spacing: gap) {
            if let status {
                markRefusalLine(status).frame(height: CGFloat(MarkPortraitPad.refusalH))
            }
            if !hc.started {
                markGate(hc, primary: CGFloat(gate.primary), secondary: CGFloat(gate.secondary))
                    .frame(maxHeight: .infinity, alignment: .top)
                markFooter(hc)
            } else {
                markPair(hc).frame(height: CGFloat(pass.pair))
                if answers {
                    markAnswerRow(hc).frame(height: CGFloat(pass.answers))
                }
                markUtilRow(hc)
                markFooter(hc)
            }
        }
        .padding(CGFloat(MarkPortraitPad.padding))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    /// The refusal of the moment, or, once a newer draft has turned up,
    /// that line for the rest of the session.
    func markStatus(_ hc: HandCutMarker) -> String? {
        hc.refusal ?? (hc.store.conflicted ? HandCutDraftStore.newerDraft : nil)
    }

    func markRefusalLine(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(amber300)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .accessibilityAddTraits(.updatesFrequently)
    }

    // MARK: - Ticker

    @ViewBuilder
    func markTicker(_ hc: HandCutMarker, landscape: Bool) -> some View {
        let big: CGFloat = landscape ? 20 : 24
        HStack(spacing: landscape ? 10 : 12) {
            if hc.mode == .cut {
                let n = hc.summary.total
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("\(n)")
                        .font(.system(size: big, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(PL.text200)
                    Text(n == 1 ? "point" : "points")
                        .font(.system(size: 11, weight: landscape ? .regular : .medium))
                        .foregroundStyle(PL.text500)
                }
                .fixedSize()
            } else {
                let score = hc.score
                HStack(alignment: .center, spacing: landscape ? 10 : 8) {
                    (Text("\(score.current.you)").foregroundColor(PL.cyan)
                        + Text(" - ").foregroundColor(PL.text600)
                        + Text("\(score.current.them)").foregroundColor(PL.magentaSoft))
                        .font(.system(size: big, weight: .bold))
                        .monospacedDigit()
                        .lineLimit(1)
                        .fixedSize()
                    if score.gamesYou + score.gamesThem > 0 {
                        Text("\(score.gamesYou)-\(score.gamesThem)")
                            .font(.system(size: 11, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(PL.text300)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(landscape ? Color.clear : PL.surface, in: Capsule())
                            .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                            .fixedSize()
                    }
                    if landscape, let server = hc.nextServer {
                        markServerLabel(hc, server, landscape: true)
                    }
                }
                if !landscape {
                    Spacer(minLength: 0)
                    if let server = hc.nextServer {
                        markServerLabel(hc, server, landscape: false)
                    }
                }
            }
            if !landscape && hc.mode == .cut { Spacer(minLength: 0) }
        }
    }

    func markServerLabel(_ hc: HandCutMarker, _ server: Winner, landscape: Bool) -> some View {
        HStack(spacing: landscape ? 5 : 8) {
            Circle()
                .fill(server == .user ? PL.cyan : PL.magentaSoft)
                .frame(width: landscape ? 7 : 10, height: landscape ? 7 : 10)
                .accessibilityHidden(true)
            Text(server == .user ? "You serve" : "\(hc.themLabel) serves")
                .font(.system(size: landscape ? 13 : 11))
                .foregroundStyle(landscape ? PL.text300 : PL.text400)
                .lineLimit(1)
        }
        .fixedSize()
    }

    // MARK: - The strip

    func markStrip(_ hc: HandCutMarker, chip: CGFloat, landscape: Bool) -> some View {
        let marks = hc.state.marks
        let playing = hc.playingId(at: currentT)
        let focus = hc.state.selectedId ?? playing
        let gaps = hc.gaps
        return GeometryReader { box in
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 0) {
                        if marks.isEmpty {
                            Text("Nothing marked yet.")
                                .font(.system(size: landscape ? 12 : 11))
                                .foregroundStyle(PL.text500)
                                .padding(.horizontal, 3)
                        }
                        ForEach(Array(marks.enumerated()), id: \.element.id) { i, m in
                            if hc.state.selectedId == m.id, let g = gaps.before {
                                markPlus(g, before: true, chip: chip)
                            }
                            markChip(hc, n: i + 1, m, size: chip, playing: playing == m.id)
                                .id("hc-chip-\(m.id)")
                            if hc.state.selectedId == m.id, let g = gaps.after {
                                markPlus(g, before: false, chip: chip)
                            }
                        }
                        Color.clear.frame(width: 1, height: 1).id("hc-strip-end")
                    }
                    .padding(.horizontal, landscape ? 3 : 9)
                    .frame(minWidth: box.size.width, minHeight: box.size.height,
                           alignment: landscape ? .trailing : .leading)
                }
                .onChange(of: marks.count) { _, _ in
                    withAnimation(.easeOut(duration: 0.3)) {
                        proxy.scrollTo("hc-strip-end", anchor: .trailing)
                    }
                }
                .onChange(of: focus) { _, id in
                    guard let id else { return }
                    withAnimation(.easeOut(duration: 0.3)) {
                        proxy.scrollTo("hc-chip-\(id)", anchor: .center)
                    }
                }
                .onAppear {
                    if let focus {
                        proxy.scrollTo("hc-chip-\(focus)", anchor: .center)
                    } else if !marks.isEmpty {
                        proxy.scrollTo("hc-strip-end", anchor: .trailing)
                    }
                }
            }
        }
    }

    /// One rally. Closed chips take their answer's colour; the open one
    /// grows a point a second up to 60, with the fill running under it.
    func markChip(
        _ hc: HandCutMarker, n: Int, _ m: HandCutMark, size: CGFloat, playing: Bool
    ) -> some View {
        let open = m.t1 == nil
        let awaiting = hc.state.awaitingId == m.id
        let selected = hc.state.selectedId == m.id
        let grow = open ? max(0, currentT - m.t0) : 0
        let width = open ? min(60, size + grow) : size
        let tone = markChipTone(m)
        let said = open ? "in progress"
            : m.isLet ? "let"
            : m.winner == .user ? "you won"
            : m.winner == .opponent ? "they won"
            : "not called"
        let ring: Color? = playing ? PL.cyan : selected ? Color.white.opacity(0.9) : nil
        let raised = open || awaiting || playing
        let glow: Color = (open || awaiting) ? Color.white.opacity(0.35)
            : playing ? PL.cyan.opacity(0.55) : .clear
        return Button {
            markTapChip(m.id)
        } label: {
            ZStack(alignment: .leading) {
                Capsule().fill(tone.fill)
                if open {
                    Rectangle()
                        .fill(PL.cyan.opacity(0.25))
                        .frame(width: width * min(1, grow * 3 / 100))
                        .animation(.linear(duration: 0.3), value: grow)
                }
                Text("\(n)")
                    .font(.system(size: size > 32 ? 13 : 12, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(tone.text)
                    .frame(width: width)
            }
            .frame(width: width, height: size)
            .clipShape(Capsule())
            .overlay(
                Capsule().strokeBorder(
                    tone.border,
                    style: tone.dashed
                        ? StrokeStyle(lineWidth: 1, dash: [3, 2]) : StrokeStyle(lineWidth: 1)
                )
            )
            .overlay {
                if let ring {
                    Capsule().stroke(ring, lineWidth: 2).padding(-1)
                }
            }
            .overlay(alignment: .topTrailing) {
                if m.starred {
                    Text("\u{2605}")
                        .font(.system(size: size > 32 ? 9 : 8))
                        .foregroundStyle(amber300)
                        .offset(x: -2, y: size > 32 ? -2 : 0)
                        .accessibilityHidden(true)
                }
            }
            .scaleEffect(raised ? 1.1 : 1)
            .shadow(color: glow, radius: 6)
            .animation(.timingCurve(0.4, 0, 0.2, 1, duration: 0.15), value: raised)
            .animation(.timingCurve(0.4, 0, 0.2, 1, duration: 0.15), value: width)
            // The target is 44 tall; the chip keeps the web's size.
            .padding(.vertical, (44 - size) / 2)
            .padding(.horizontal, 3)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Point \(n), \(said)\(playing ? ", playing" : "")")
        .accessibilityAddTraits(open || awaiting ? .isSelected : [])
    }

    func markChipTone(_ m: HandCutMark) -> (border: Color, fill: Color, text: Color, dashed: Bool) {
        if m.t1 == nil { return (PL.cyan, PL.cyan.opacity(0.1), PL.cyan, false) }
        if m.isLet { return (amber400.opacity(0.5), amber400.opacity(0.1), amber300.opacity(0.9), false) }
        switch m.winner {
        case .user: return (PL.cyan.opacity(0.6), PL.cyan.opacity(0.2), PL.cyan, false)
        case .opponent: return (PL.magenta.opacity(0.6), PL.magenta.opacity(0.2), PL.magentaSoft, false)
        case nil: return (PL.text600, .clear, PL.text500, true)
        }
    }

    /// The dashed "+" beside the point stood on, where a hole of four
    /// seconds or more could hold a missed rally.
    func markPlus(_ gap: HandCutGap, before: Bool, chip: CGFloat) -> some View {
        Button {
            markInsert(gap)
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(PL.text500)
                .frame(width: 24, height: 32)
                .overlay(
                    Capsule().strokeBorder(PL.text600, style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
                )
                .padding(.vertical, 6)
                .padding(.horizontal, 3)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(before ? "Add a rally before this point" : "Add a rally after this point")
    }

    // MARK: - The bar: speed, or the point's edges

    /// Six speeds evenly spaced by index, the knob snapping between them.
    /// It drives the one speed the player has, so it never shows a rate the
    /// video is not playing at (the web's bar could).
    func markSpeedBar() -> some View {
        let speeds = HandCutMarker.speeds
        let playing = Double(holdRate ?? rate)
        let idx = HandCutMarker.speedIndex(playing)
        return HStack(spacing: 12) {
            Text(speedLabel(playing))
                .font(.system(size: 11, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(PL.text200)
                .frame(width: 36, alignment: .leading)
            GeometryReader { track in
                let w = track.size.width
                let x = { (i: Int) -> CGFloat in w * CGFloat(i) / CGFloat(speeds.count - 1) }
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.1)).frame(height: 6)
                    ForEach(speeds.indices, id: \.self) { i in
                        Capsule()
                            .fill(i <= idx ? PL.cyan.opacity(0.6) : Color.white.opacity(0.25))
                            .frame(width: 2, height: 8)
                            .position(x: x(i), y: track.size.height / 2)
                    }
                    Circle()
                        .fill(PL.ink)
                        .overlay(Circle().strokeBorder(PL.cyan, lineWidth: 2))
                        .frame(width: 20, height: 20)
                        .shadow(color: PL.cyan.opacity(0.6), radius: 4)
                        .position(x: x(idx), y: track.size.height / 2)
                }
                .frame(height: track.size.height)
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { g in
                            guard w > 0 else { return }
                            let f = min(1, max(0, g.location.x / w))
                            let i = Int((f * CGFloat(speeds.count - 1)).rounded())
                            markSetSpeed(speeds[i])
                        }
                )
            }
            .frame(height: 32)
            .accessibilityElement()
            .accessibilityLabel("Playback speed")
            .accessibilityValue(speedLabel(playing))
            .accessibilityAdjustableAction { direction in
                let next = direction == .increment ? min(speeds.count - 1, idx + 1) : max(0, idx - 1)
                markSetSpeed(speeds[next])
            }
            Text("speed")
                .font(.system(size: 10))
                .foregroundStyle(PL.text500)
                .frame(width: 40, alignment: .trailing)
        }
    }

    /// The selected point's two edges on a fixed window. The picture follows
    /// the handle under the finger; nothing is written until Confirm.
    @ViewBuilder
    func markRangeBar(_ hc: HandCutMarker, landscape: Bool) -> some View {
        if let id = hc.adjusting, let draft = hc.adjustDraft, let bounds = hc.adjustBounds,
           let i = hc.state.marks.firstIndex(where: { $0.id == id }) {
            let lo = bounds.t0
            let span = max(0.5, bounds.t1 - bounds.t0)
            HStack(spacing: landscape ? 10 : 12) {
                Text("\(i + 1)")
                    .font(.system(size: 11, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(PL.text200)
                    .frame(width: landscape ? 22 : 36, alignment: landscape ? .center : .leading)
                GeometryReader { track in
                    let w = track.size.width
                    let h = track.size.height
                    let x = { (t: Double) -> CGFloat in w * CGFloat((t - lo) / span) }
                    ZStack(alignment: .topLeading) {
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color.white.opacity(0.1))
                            Rectangle()
                                .fill(PL.cyan.opacity(0.45))
                                .frame(width: max(0, x(draft.t1) - x(draft.t0)))
                                .offset(x: x(draft.t0))
                        }
                        .frame(width: w, height: 6)
                        .clipShape(Capsule())
                        .position(x: w / 2, y: h / 2)
                        Circle()
                            .fill(PL.cyan)
                            .frame(width: 12, height: 12)
                            .shadow(color: PL.cyan.opacity(0.7), radius: 4)
                            .position(x: min(w, max(0, x(currentT))), y: h / 2)
                            .allowsHitTesting(false)
                        markRangeHandle(hc, start: true, x: x(draft.t0), h: h, w: w, lo: lo, span: span)
                        markRangeHandle(hc, start: false, x: x(draft.t1), h: h, w: w, lo: lo, span: span)
                    }
                    .coordinateSpace(.named("hc-range"))
                }
                .frame(height: landscape ? 34 : 32)
                Text(String(format: "%.1fs", draft.t1 - draft.t0))
                    .font(.system(size: 10))
                    .monospacedDigit()
                    .foregroundStyle(PL.text400)
                    .frame(width: landscape ? 34 : 40, alignment: landscape ? .leading : .trailing)
            }
        }
    }

    func markRangeHandle(
        _ hc: HandCutMarker, start: Bool, x: CGFloat, h: CGFloat, w: CGFloat,
        lo: Double, span: Double
    ) -> some View {
        ZStack {
            Capsule().fill(PL.cyan).frame(width: 2, height: 32)
            Circle()
                .fill(PL.ink)
                .overlay(Circle().strokeBorder(PL.cyan, lineWidth: 2))
                .frame(width: 16, height: 16)
                .shadow(color: PL.cyan.opacity(0.6), radius: 4)
        }
        .frame(width: 36, height: 44)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .named("hc-range"))
                .onChanged { g in
                    guard w > 0, let bounds = hc.adjustBounds, let cur = hc.adjustDraft else { return }
                    let f = min(1, max(0, Double(g.location.x / w)))
                    let t = min(bounds.t1, max(bounds.t0, lo + f * span))
                    let next = start
                        ? HandCutSpan(t0: min(t, cur.t1 - HandCut.MIN_POINT_S), t1: cur.t1)
                        : HandCutSpan(t0: cur.t0, t1: max(t, cur.t0 + HandCut.MIN_POINT_S))
                    hc.adjustDraft = next
                    // The picture follows the handle: the frame under the
                    // finger is the one being judged.
                    markScrub(to: max(0, start ? next.t0 : next.t1))
                }
                .onEnded { _ in
                    guard let d = hc.adjustDraft else { return }
                    // One exact frame, once, where the finger lifted.
                    hc.scrubPending = nil
                    seek(to: max(0, start ? d.t0 : d.t1))
                }
        )
        .position(x: x, y: h / 2)
        .accessibilityLabel(start ? "Start of point" : "End of point")
    }

    // MARK: - Pair, answers, tools, footer (portrait)

    /// Before the pass: the way in, as big as the pair and the answers it
    /// gives way to, and, when a processed match is marked again, Start
    /// again where the tool row will be.
    func markGate(_ hc: HandCutMarker, primary: CGFloat, secondary: CGFloat) -> some View {
        VStack(spacing: CGFloat(MarkPortraitPad.gap)) {
            if hc.openedPartial {
                markBigButton("Keep marking", lit: true, height: primary) { markBeginMarking() }
                markBigButton("Review the points", lit: false, text: PL.text300, height: secondary) {
                    markBeginReview()
                }
            } else {
                // A re-cut with points still to call carries on from the
                // first of them: the cue is already there.
                markBigButton(
                    hc.openedFinished ? "Begin review"
                        : hc.openedAs == .scoring ? "Keep marking" : "Begin Cutting",
                    lit: true, height: primary
                ) {
                    if hc.openedFinished { markBeginReview() } else { markBeginCutting() }
                }
            }
            if hc.canStartAgain {
                markStartAgainButton(hc)
            }
        }
    }

    /// Outlined, a step down from the gate's buttons: clearing every mark
    /// is not the way in, and it asks first.
    func markStartAgainButton(_ hc: HandCutMarker) -> some View {
        Button {
            hc.confirmingStartAgain = true
        } label: {
            Text(MarkerCopy.startAgain)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(PL.text200)
                .frame(maxWidth: .infinity)
                .frame(height: CGFloat(MarkPortraitPad.rowH))
                .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    /// The rhythm pair: Begin and End while marking, Adjust and Resume once
    /// a closed point is selected. Whichever is next is lit.
    @ViewBuilder
    func markPair(_ hc: HandCutMarker) -> some View {
        HStack(spacing: 8) {
            if hc.reviewingPoint {
                markBigButton(hc.adjustOn ? "Confirm" : "Adjust", lit: true) {
                    if hc.adjustOn { markConfirmAdjust() } else { markOpenAdjust() }
                }
                markBigButton("Resume", lit: false, text: PL.text300, enabled: !hc.adjustOn) {
                    markResume()
                }
            } else if hc.open != nil {
                markBigButton(MarkerCopy.backToLastPoint, lit: false, text: PL.text400) { markReset() }
                markBigButton("End Point", lit: true) { markEnd() }
            } else {
                markBigButton("Begin Point", lit: true) { markBegin() }
                markBigButton("End Point", lit: false, text: PL.text400, enabled: false) { markEnd() }
            }
        }
    }

    /// A pad button: lit is cyan with the glow, unlit is the edge border on
    /// surface. `height` nil fills the row it is given.
    func markBigButton(
        _ label: String, lit: Bool, text: Color = PL.text400, enabled: Bool = true,
        height: CGFloat? = nil, radius: CGFloat = 12, font: CGFloat = 16,
        lines: Int = 2, minScale: CGFloat = 0.8,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: font, weight: .bold))
                .foregroundStyle(lit ? PL.ink : text)
                .multilineTextAlignment(.center)
                .lineLimit(lines)
                .minimumScaleFactor(minScale)
                .padding(.horizontal, 8)
                .frame(maxWidth: .infinity, maxHeight: height == nil ? .infinity : nil)
                .frame(height: height)
                .frame(minHeight: 44)
                .background(
                    lit ? PL.cyan : (radius > 12 ? PL.surface2 : PL.surface),
                    in: RoundedRectangle(cornerRadius: radius, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .strokeBorder(lit ? PL.cyan : PL.edge, lineWidth: 2)
                )
                .modifier(HCGlow(on: lit && enabled, radius: radius))
                .contentShape(Rectangle())
        }
        .buttonStyle(HCPressStyle())
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.35)
        .animation(.timingCurve(0.4, 0, 0.2, 1, duration: 0.15), value: lit)
    }

    /// Me, {opponent}, Let. They light when there is something to answer and
    /// pulse while the picture is held for it.
    func markAnswerRow(_ hc: HandCutMarker) -> some View {
        HStack(spacing: 8) {
            markAnswer(hc, .user, hc.youLabel)
            markAnswer(hc, .opponent, hc.themLabel)
            markAnswer(hc, .let, "Let")
        }
    }

    func markAnswerTone(_ o: HandCutOutcome) -> (border: Color, fill: Color, text: Color) {
        switch o {
        case .user: (PL.cyan, PL.cyan.opacity(0.15), PL.cyan)
        case .opponent: (PL.magenta, PL.magenta.opacity(0.15), PL.magentaSoft)
        case .let: (amber400.opacity(0.7), amber400.opacity(0.1), amber300)
        }
    }

    func markAnswer(_ hc: HandCutMarker, _ o: HandCutOutcome, _ label: String) -> some View {
        let lit = hc.canAnswer
        let tone = markAnswerTone(o)
        return Button {
            markAnswerTap(o)
        } label: {
            Text(label)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(lit ? tone.text : PL.text500)
                .lineLimit(1)
                .truncationMode(.tail)
                .padding(.horizontal, 4)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(lit ? tone.fill : PL.surface,
                            in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(lit ? tone.border : PL.edge, lineWidth: 1)
                )
                .modifier(HCAwaitPulse(active: hc.awaiting, radius: 12, offset: 0))
                .contentShape(Rectangle())
        }
        .buttonStyle(HCPressStyle(scale: 0.98))
        .disabled(!lit)
        .opacity(lit ? 1 : 0.3)
        .animation(.timingCurve(0.4, 0, 0.2, 1, duration: 0.15), value: lit)
    }

    /// Six small tools in one row, a size down and allowed two lines.
    func markUtilRow(_ hc: HandCutMarker) -> some View {
        HStack(spacing: 6) {
            markUtil("Undo", enabled: !hc.state.undo.isEmpty) { markUndo() }
            markUtil("Star", enabled: !hc.state.marks.isEmpty, lit: hc.starLit) { markStar() }
            markUtil("\u{2212}5s") { markSeekBy(-5) }
            markUtil("+5s") { markSeekBy(5) }
            markUtil("Mark again", enabled: hc.reviewingPoint) { markAgain() }
            markUtil("Remove", enabled: hc.reviewingPoint) { markRemove() }
        }
        .frame(height: 44)
    }

    func markUtil(
        _ label: String, enabled: Bool = true, lit: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 10, weight: .semibold))
                .lineSpacing(-1)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .foregroundStyle(lit ? amber300 : PL.text400)
                .padding(.horizontal, 2)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(lit ? amber400.opacity(0.15) : PL.surface,
                            in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .strokeBorder(lit ? amber400.opacity(0.6) : PL.edge, lineWidth: 1)
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.35)
    }

    /// The count on the left; the Score switch and Done on the right, from
    /// the gate onwards.
    func markFooter(_ hc: HandCutMarker) -> some View {
        let sum = hc.summary
        let points = "\(sum.total) \(sum.total == 1 ? "point" : "points")"
        let line: String = hc.mode == .cut
            ? (sum.open ? "One point still open" : points)
            : (sum.unscored > 0 ? "\(points) · \(sum.unscored) to score" : points)
        return HStack(spacing: 12) {
            Text(line)
                .font(.system(size: 11))
                .foregroundStyle(PL.text500)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 0)
            markScoreSwitch(hc)
            markDoneButton(hc, compact: false)
        }
        .frame(height: 44)
    }

    /// "Cut and score" or "Cut only": whether the pass also says who won
    /// each point. It can be flipped at any time and nothing already called
    /// is lost. Practice and drills cannot be scored, so theirs stays off,
    /// greyed, "Cut only". The footer has room for the label alone; the
    /// line under it lives on the match page's accordion.
    func markScoreSwitch(_ hc: HandCutMarker) -> some View {
        let practice = hc.practice
        let on = hc.mode == .score && !practice
        let label = MarkerCopy.scoreLabel(on: on, practice: practice)
        return HStack(spacing: 8) {
            Text(label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(practice ? PL.text500 : PL.text200)
                .fixedSize()
                .accessibilityHidden(true)
            Toggle(label, isOn: Binding(
                get: { on },
                set: { markSetScoring($0) }
            ))
            .labelsHidden()
            .tint(PL.cyan)
            .disabled(practice)
            .accessibilityHint(practice ? MarkerCopy.scoreDetail(on: false, practice: true) : "")
        }
    }

    /// Done opens the review sheet that sends the marks, so it looks like
    /// the submit it leads to: the app's primary cyan button.
    func markDoneButton(_ hc: HandCutMarker, compact: Bool) -> some View {
        Button {
            markOpenReview()
        } label: {
            Text("Done")
                .lineLimit(1)
                .fixedSize()
                .frame(minHeight: compact ? 0 : 20)
        }
        .buttonStyle(PLPrimaryButtonStyle(compact: compact))
        .disabled(hc.summary.total == 0)
    }

    /// A rounded-full, bordered pill with a 44pt target around it.
    func markPill(
        _ label: String, size: CGFloat, color: Color, horizontal: CGFloat,
        weight: Font.Weight = .semibold, enabled: Bool = true,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: size, weight: weight))
                .foregroundStyle(color)
                .lineLimit(1)
                .fixedSize()
                .padding(.horizontal, horizontal)
                .frame(height: 32)
                .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
    }

    // MARK: - Landscape bars and rails

    func markTopBar(_ hc: HandCutMarker, side: CGFloat) -> some View {
        HStack(spacing: 10) {
            markTicker(hc, landscape: true)
                .fixedSize()
            markStrip(hc, chip: 36, landscape: true)
                .frame(maxWidth: .infinity)
                .frame(height: 42)
            markDoneButton(hc, compact: true)
            markCloseButton(hc, filled: true)
                .padding(.horizontal, -6)
        }
        .padding(.horizontal, side)
        .frame(height: 42)
        .background(PL.surface.ignoresSafeArea(edges: .horizontal))
        .overlay(alignment: .bottom) { Rectangle().fill(PL.edge).frame(height: 1) }
    }

    /// Me, {opponent}, Let down the left edge. In Cut only they stay where
    /// they are, greyed out (option A), so the layout never moves.
    func markAnswerRail(_ hc: HandCutMarker, _ g: MarkLandscape) -> some View {
        let letH = CGFloat(MarkLandscape.letH)
        let aH = max(0, CGFloat(g.answerH))
        let fs = CGFloat(g.answerFont)
        return VStack(spacing: CGFloat(MarkLandscape.railGap)) {
            markRailAnswer(hc, .user, hc.youLabel, height: aH, font: fs)
            markRailAnswer(hc, .opponent, hc.themLabel, height: aH, font: fs)
            markRailAnswer(hc, .let, "Let", height: letH, font: 17)
        }
        .frame(width: max(0, CGFloat(g.tileW)), height: CGFloat(g.boxH))
    }

    func markRailAnswer(
        _ hc: HandCutMarker, _ o: HandCutOutcome, _ label: String, height: CGFloat, font: CGFloat
    ) -> some View {
        // Lit only once the pass has started: behind the gate the portrait
        // pad hides its answers, and the board greys them.
        let on = hc.started && hc.mode == .score && hc.canAnswer
        let rgb: Color = switch o {
        case .user: PL.cyan
        case .opponent: PL.magenta
        case .let: amber400
        }
        let text: Color = switch o {
        case .user: PL.cyan
        case .opponent: PL.magentaSoft
        case .let: amber300
        }
        let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
        return Button {
            markAnswerTap(o)
        } label: {
            Text(label)
                .font(.system(size: font, weight: .bold))
                .foregroundStyle(text)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .padding(.horizontal, 8)
                .frame(maxWidth: .infinity)
                .frame(height: height)
                .background {
                    ZStack {
                        shape.fill(PL.surface2)
                        shape.fill(rgb.opacity(on ? 0.28 : 0))
                    }
                }
                .overlay(shape.strokeBorder(rgb.opacity(on ? 0.9 : 0.35), lineWidth: on ? 2 : 1))
                .shadow(color: rgb.opacity(on ? 0.35 : 0), radius: 8)
                .modifier(HCAwaitPulse(active: on && hc.awaiting, radius: 16, offset: 2))
                .contentShape(Rectangle())
        }
        .buttonStyle(HCPressStyle(scale: 0.98))
        .disabled(!on)
        .opacity(on ? 1 : 0.3)
    }

    /// The pair down the right edge, or the gate before starting: the
    /// shared `railPair`, the same tiles the web draws in each state.
    func markPairRail(_ hc: HandCutMarker, _ g: MarkLandscape) -> some View {
        let tiles = MarkLandscape.railPair(
            started: hc.started, opened: hc.openedAs, reviewing: hc.reviewingPoint,
            adjusting: hc.adjustOn, open: hc.open != nil, startAgain: hc.canStartAgain
        )
        let fs = CGFloat(g.pairFont)
        return VStack(spacing: CGFloat(MarkLandscape.railGap)) {
            ForEach(Array(tiles.enumerated()), id: \.offset) { _, tile in
                // "Back to last point" may take three short lines but never
                // shrinks below the tile beside it; Start again is a step
                // down, like its portrait pill.
                markBigButton(
                    tile.label, lit: tile.tone == .lit, text: PL.text300,
                    enabled: tile.tone != .off,
                    height: CGFloat(MarkLandscape.pairTileHeight(tile, count: tiles.count, boxH: g.boxH)),
                    radius: 16, font: tile.action == .startAgain ? min(fs, 15) : fs,
                    lines: tile.action == .reset ? 3 : 2,
                    minScale: tile.action == .reset ? 1 : 0.8
                ) { markRailAction(tile.action) }
            }
        }
        .frame(width: max(0, CGFloat(g.tileW)), height: CGFloat(g.boxH))
    }

    func markRailAction(_ action: MarkLandscape.Action) {
        switch action {
        case .startAgain: marker?.confirmingStartAgain = true
        case .beginCutting: markBeginCutting()
        case .beginReview, .reviewPoints: markBeginReview()
        case .keepMarking: markBeginMarking()
        case .begin: markBegin()
        case .reset: markReset()
        case .end: markEnd()
        case .adjust: markOpenAdjust()
        case .confirm: markConfirmAdjust()
        case .resume: markResume()
        }
    }

    /// Eight tools along the bottom, or the range bar while adjusting.
    func markBottomBar(_ hc: HandCutMarker, side: CGFloat) -> some View {
        Group {
            if hc.adjustOn {
                markRangeBar(hc, landscape: true)
                    .frame(height: 34)
            } else {
                markToolRow(hc)
            }
        }
        .padding(.horizontal, side)
        .padding(.top, 3)
        .padding(.bottom, 4)
        .background(PL.surface.ignoresSafeArea(edges: [.horizontal, .bottom]))
        .overlay(alignment: .top) { Rectangle().fill(PL.edge).frame(height: 1) }
    }

    func markToolRow(_ hc: HandCutMarker) -> some View {
        let sel = hc.started && hc.reviewingPoint
        return HStack(spacing: 6) {
            if sel {
                markTool("Prev", icon: "chevron.left", enabled: hc.hasPrev) { markStep(-1) }
            } else {
                markTool("\u{2212}5s", icon: "gobackward.5") { markSeekBy(-5) }
            }
            markTool("Undo", icon: "arrow.uturn.backward",
                     enabled: hc.started && !hc.state.undo.isEmpty) { markUndo() }
            markSpeedTool()
            markTool("Star", icon: hc.starLit ? "star.fill" : "star",
                     enabled: hc.started && !hc.state.marks.isEmpty,
                     tint: hc.starLit ? amber300 : nil) { markStar() }
            markTool("Mark again", icon: "arrow.triangle.2.circlepath", enabled: sel) { markAgain() }
            markTool("Remove", icon: "trash", enabled: sel) { markRemove() }
            markScoreTile(hc)
            if sel {
                markTool("Next", icon: "chevron.right", enabled: hc.hasNext) { markStep(1) }
            } else {
                markTool("+5s", icon: "goforward.5") { markSeekBy(5) }
            }
        }
        .frame(height: 34)
    }

    func markTool(
        _ label: String, icon: String, enabled: Bool = true, tint: Color? = nil,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .medium))
                    .frame(height: 16)
                Text(label)
                    .font(.system(size: 10, weight: .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .foregroundStyle(tint ?? PL.text200)
            .padding(.horizontal, 2)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(PL.surface2, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.35)
        .accessibilityLabel(label)
    }

    /// The footer's switch as a bottom-bar tile: a small switch that shows
    /// on or off and its label beside it ("Cut and score" or "Cut only").
    /// Practice and drills stay off, greyed, and cannot be tapped.
    func markScoreTile(_ hc: HandCutMarker) -> some View {
        let practice = hc.practice
        let on = hc.mode == .score && !practice
        let label = MarkerCopy.scoreLabel(on: on, practice: practice)
        return Button {
            markSetScoring(!on)
        } label: {
            HStack(spacing: 6) {
                markMiniSwitch(on: on)
                    .opacity(practice ? 0.35 : 1)
                // A disabled plain button dims its label by itself, so the
                // practice label starts brighter to stay readable.
                Text(label)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(practice ? PL.text300 : PL.text200)
                    .multilineTextAlignment(.leading)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
            }
            .padding(.horizontal, 4)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(PL.surface2, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(practice)
        .accessibilityLabel(label)
        .accessibilityValue(on ? "On" : "Off")
        .accessibilityHint(practice ? MarkerCopy.scoreDetail(on: false, practice: true) : "")
        .accessibilityAddTraits(.isToggle)
    }

    /// An iOS switch at tile size: cyan track and the knob right when on.
    func markMiniSwitch(on: Bool) -> some View {
        Capsule()
            .fill(on ? PL.cyan : Color.white.opacity(0.18))
            .frame(width: 28, height: 16)
            .overlay(alignment: on ? .trailing : .leading) {
                Circle()
                    .fill(Color.white)
                    .frame(width: 12, height: 12)
                    .padding(2)
            }
            .animation(.easeOut(duration: 0.15), value: on)
    }

    func markSpeedTool() -> some View {
        Menu {
            ForEach(HandCutMarker.speeds.reversed(), id: \.self) { speed in
                Button {
                    markSetSpeed(speed)
                } label: {
                    if Double(rate) == speed {
                        Label(speedLabel(speed), systemImage: "checkmark")
                    } else {
                        Text(speedLabel(speed))
                    }
                }
            }
        } label: {
            VStack(spacing: 2) {
                Text(speedLabel(Double(holdRate ?? rate)))
                    .font(.system(size: 13, weight: .bold))
                    .monospacedDigit()
                    .frame(height: 16)
                Text("Speed")
                    .font(.system(size: 10, weight: .medium))
                    .lineLimit(1)
            }
            .foregroundStyle(PL.text200)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(PL.surface2, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Playback speed")
        .accessibilityValue(speedLabel(Double(rate)))
    }

    // MARK: - Sheets

    func markSheetShape(landscape: Bool) -> UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            topLeadingRadius: 16, bottomLeadingRadius: landscape ? 16 : 0,
            bottomTrailingRadius: landscape ? 16 : 0, topTrailingRadius: 16,
            style: .continuous
        )
    }

    /// "Who served first?" No backdrop: the video and the pad stay usable,
    /// because the answer is on the tape.
    @ViewBuilder
    func markServeSheet(_ hc: HandCutMarker, landscape: Bool, bottomInset: CGFloat) -> some View {
        if hc.serveStep {
            VStack(alignment: .leading, spacing: 0) {
                Text("Who served first?")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(PL.text100)
                Text("Sets the serve rotation for the whole match. Play the start if you need to check.")
                    .font(.system(size: 12))
                    .foregroundStyle(PL.text500)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
                HStack(spacing: 8) {
                    markServeOption(hc.youLabel) { markAnswerFirstServer(.user) }
                    markServeOption(hc.themLabel) { markAnswerFirstServer(.opponent) }
                }
                .padding(.top, 16)
                HStack {
                    markPill("Play from the start", size: 12, color: PL.text200, horizontal: 16) {
                        markPlayFromStart()
                    }
                    Spacer(minLength: 8)
                    markPill("Not sure yet", size: 12, color: PL.text400, horizontal: 16) {
                        markCloseServeStep()
                    }
                }
                .padding(.top, 6)
            }
            .padding(20)
            .padding(.bottom, landscape ? 0 : 12 + bottomInset)
            .frame(maxWidth: landscape ? 384 : .infinity, alignment: .leading)
            .background(PL.surface, in: markSheetShape(landscape: landscape))
            .overlay(markSheetShape(landscape: landscape).strokeBorder(PL.edge, lineWidth: 1))
            .shadow(color: .black.opacity(landscape ? 0.5 : 0), radius: 25, y: 12)
            .modifier(HCFadeIn())
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            .padding(.bottom, landscape ? 41 + 10 : 0)
            .ignoresSafeArea(edges: landscape ? [] : .bottom)
        }
    }

    func markServeOption(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(PL.text300)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity)
                .frame(minHeight: 44)
                .padding(.horizontal, 16)
                .background(PL.ink.opacity(0.4), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(PL.edge, lineWidth: 1))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// Done: what is about to be sent, in the web's words. Marking a
    /// processed match again adds the Replace or Keep choice above Cut the
    /// match. A phone on its side may not fit it all, so the card scrolls
    /// when it has to and not otherwise.
    @ViewBuilder
    func markReviewSheet(_ hc: HandCutMarker) -> some View {
        if hc.reviewing {
            ZStack {
                PL.ink.opacity(0.7)
                    .ignoresSafeArea()
                    .contentShape(Rectangle())
                    .onTapGesture {}
                ViewThatFits(in: .vertical) {
                    markReviewCard(hc)
                    ScrollView { markReviewCard(hc) }
                        .scrollBounceBehavior(.basedOnSize)
                        .frame(maxWidth: 384 + 32)
                }
            }
        }
    }

    func markReviewCard(_ hc: HandCutMarker) -> some View {
        let sum = hc.summary
        return VStack(alignment: .leading, spacing: 0) {
            Text("\(sum.total) \(sum.total == 1 ? "point" : "points") marked.")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(PL.text100)
            if hc.mode == .score && sum.unscored > 0 {
                Text(sum.unscored == 1
                     ? "1 has no winner yet. You can score it from the match."
                     : "\(sum.unscored) have no winner yet. You can score them from the match.")
                    .font(.system(size: 14))
                    .foregroundStyle(PL.text400)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)
            }
            if sum.open {
                Text("One point has no ending and will not be included.")
                    .font(.system(size: 14))
                    .foregroundStyle(amber300.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)
            }
            if sum.long > 0 {
                Text("\(sum.long) \(sum.long == 1 ? "point is" : "points are") over two minutes long. Check you did not miss an ending.")
                    .font(.system(size: 14))
                    .foregroundStyle(amber300.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)
            }
            if hc.recut != nil {
                RecutChoiceView(
                    state: Binding(
                        get: { hc.recut ?? RecutChoiceState(replaceAllowed: false, hasMatchNotes: false) },
                        set: { hc.recut = $0 }
                    ),
                    disabled: hc.busy
                )
                .padding(.top, 20)
            }
            if let error = hc.submitError {
                Text(error)
                    .font(.system(size: 14))
                    .foregroundStyle(amber300.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 12)
            }
            Button {
                Task { await markSubmit() }
            } label: {
                Text(hc.busy ? "Sending" : "Cut the match")
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 20)
            }
            .buttonStyle(PLPrimaryButtonStyle())
            .disabled(hc.busy)
            .padding(.top, 20)
            Button {
                hc.reviewing = false
            } label: {
                Text("Keep marking")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PL.text200)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 44)
                    .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .padding(.top, 12)
        }
        .padding(24)
        .frame(maxWidth: 384, alignment: .leading)
        .background(PL.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(PL.edge, lineWidth: 1))
        .padding(16)
    }

    // MARK: - Opening, the clock and the cue

    /// The takeover has its item. Nothing plays until the player asks:
    /// Begin Cutting starts playback in the same tap.
    func markDidOpen() {
        guard let hc = marker else { return }
        hc.playbackChanged(playing: false)
        #if DEBUG
        // Headless checks of the sideways board, where a sheet can cover
        // the rotate button.
        if ProcessInfo.processInfo.arguments.contains("--dev-hc-landscape") {
            Task {
                try? await Task.sleep(for: .seconds(1.5))
                rotate(toLandscape: true)
            }
        }
        #endif
        if let notice = hc.store.notice {
            hc.store.notice = nil
            showToast(notice)
        }
        Task { await markWhenReady() }
    }

    /// The first metadata event: the file's shape and length, then the cue.
    func markWhenReady() async {
        for _ in 0..<200 {
            if player.currentItem?.status == .readyToPlay || loadFailed { break }
            try? await Task.sleep(for: .milliseconds(100))
        }
        guard let hc = marker, let item = player.currentItem, item.status == .readyToPlay else { return }
        let d = item.duration.seconds
        if d.isFinite, d > 0 {
            duration = d
            if hc.durationS == nil { hc.durationS = d }
        }
        let size = item.presentationSize
        if size.width > 0, size.height > 0 { hc.aspect = Double(size.width / size.height) }
        guard !hc.cued else { return }
        hc.cued = true
        markCueReview()
    }

    /// Where a reopened draft is cued: the point the pad opened on, padded
    /// as its clip will be, or where the marking stopped. Nothing plays.
    func markCueReview() {
        guard let hc = marker else { return }
        let d = duration > 0 ? duration : .infinity
        let s = hc.state
        let cue = s.selectedId.flatMap { id in s.marks.first { $0.id == id } }
            ?? HandCut.firstUnscored(s.marks)
        if let cue, let t1 = cue.t1 {
            seek(to: max(0, min(d - 0.1, cue.t0 - HandCutMarker.clipPre)))
            hc.previewUntil = t1 + HandCutMarker.clipPost
        } else {
            guard let at = HandCutMarker.markingPlace(s.marks) else { return }
            seek(to: max(0, min(d - 0.1, at)))
            hc.previewUntil = nil
        }
    }

    /// Every tick: a clip preview that has played out stops, and the walk
    /// moves on.
    func markTick(_ t: Double) {
        guard let hc = marker, let stop = hc.previewUntil, t >= stop else { return }
        hc.previewUntil = nil
        player.pause()
        markChainAfterPreview()
    }

    /// The live clock at the moment of the tap, never the last tick.
    var markNow: Double { liveT }

    /// The rate the tap was made at: the playing rate, or the chosen speed
    /// while paused (a paused web video still reports its playbackRate).
    var markRate: Double {
        player.rate > 0 ? Double(player.rate) : Double(rate)
    }

    func markSetSpeed(_ speed: Double) {
        guard Float(speed) != rate else { return }
        rate = Float(speed)
        if player.rate > 0, holdRate == nil { player.rate = rate }
    }

    func markSeekBy(_ delta: Double) {
        let d = duration > 0 ? duration : Double.infinity
        seek(to: max(0, min(d - 0.05, liveT + delta)))
    }

    /// One seek in flight while a handle moves, the newest replacing any
    /// waiting, at 0.15s tolerance. An exact seek per drag tick over a
    /// streamed file is what got the app killed once.
    func markScrub(to t: Double) {
        guard let hc = marker else { return }
        currentT = t
        if hc.scrubInFlight {
            hc.scrubPending = t
            return
        }
        hc.scrubInFlight = true
        let tol = CMTime(seconds: 0.15, preferredTimescale: 600)
        player.seek(to: CMTime(seconds: t, preferredTimescale: 600),
                    toleranceBefore: tol, toleranceAfter: tol) { _ in
            Task { @MainActor in
                guard let hc = marker else { return }
                hc.scrubInFlight = false
                if let next = hc.scrubPending {
                    hc.scrubPending = nil
                    markScrub(to: next)
                }
            }
        }
    }

    // MARK: - Taps

    func markBeginCutting() {
        guard let hc = marker else { return }
        hc.started = true
        play()
    }

    func markCloseServeStep() {
        guard let hc = marker else { return }
        hc.serveStep = false
        if !hc.serveStepCue {
            hc.serveStepCue = true
            return
        }
        player.pause()
        markCueReview()
    }

    func markAnswerFirstServer(_ value: Winner) {
        guard let hc = marker else { return }
        let previous = hc.firstServer
        hc.firstServer = value
        Task {
            if await hc.saveFirstServer(value) {
                onFirstServer?(value)
            } else {
                hc.firstServer = previous
                showToast("Couldn't save who served. Try again.")
            }
        }
        markCloseServeStep()
    }

    func markPlayFromStart() {
        seek(to: 0)
        play()
    }

    func markResumeAfterAnswer() {
        guard let hc = marker, hc.pausedForAnswer else { return }
        hc.pausedForAnswer = false
        play()
    }

    /// Reset: the Begin tap was too early. Back to the end of the point
    /// before, and play the run-up again.
    func markReset() {
        guard let hc = marker else { return }
        let r = HandCut.resetOpen(hc.state)
        hc.state = r.state
        hc.previewUntil = nil
        hc.pausedForAnswer = false
        seek(to: max(0, r.backTo))
        play()
    }

    func markBegin() {
        guard let hc = marker else { return }
        // Held for an answer, and they pressed on: carry on, uncalled.
        if hc.pausedForAnswer {
            hc.state = HandCut.clearAwaiting(hc.state)
            markResumeAfterAnswer()
            hc.refuse("Left uncalled.")
            return
        }
        if hc.apply(HandCut.startMark(hc.state, now: markNow, rate: markRate, id: hc.nextId())) {
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        }
    }

    func markEnd() {
        guard let hc = marker else { return }
        let next = HandCut.endMark(hc.state, now: markNow)
        guard hc.apply(next) else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        // Hold the picture until the point is called. Cut only never stops.
        if hc.mode == .score {
            player.pause()
            hc.pausedForAnswer = true
        }
    }

    /// An answer to a point selected for review moves the review on to the
    /// next point still without a winner.
    func markAdvanceReview(_ after: HandCutState, from fromId: String) {
        guard let hc = marker else { return }
        guard let next = HandCut.firstUnscored(after.marks, afterId: fromId), let t1 = next.t1 else {
            hc.state = HandCut.selectMark(hc.state, id: nil)
            hc.previewUntil = nil
            return
        }
        hc.state = HandCut.selectMark(hc.state, id: next.id)
        hc.pausedForAnswer = false
        seek(to: max(0, next.t0 - HandCutMarker.clipPre))
        hc.previewUntil = t1 + HandCutMarker.clipPost
        play()
    }

    func markAnswerTap(_ o: HandCutOutcome) {
        guard let hc = marker else { return }
        let before = hc.state
        let reviewingId = before.awaitingId == nil ? before.selectedId : nil
        let next = HandCut.setOutcome(before, o)
        guard hc.apply(next) else { return }
        if let reviewingId {
            // The same answer again clears the point. That is a change of
            // mind about THIS point, so the review stays on it rather than
            // walking past it uncalled (web defect 5).
            let now = next.state.marks.first { $0.id == reviewingId }
            if let now, !now.isLet, now.winner == nil { return }
            markAdvanceReview(next.state, from: reviewingId)
        } else {
            markResumeAfterAnswer()
        }
    }

    /// Select a point, cue its clip exactly as the worker will cut it, and
    /// play. Every path that shows a point back goes through here.
    func markPlayMark(_ id: String) {
        guard let hc = marker, let m = hc.state.marks.first(where: { $0.id == id }), let t1 = m.t1
        else { return }
        // Selected, never toggled: the web's toggle here deselected the
        // first point on "Begin review", which then walked nowhere.
        if hc.state.selectedId != id {
            hc.state = HandCut.selectMark(hc.state, id: id)
        }
        hc.pausedForAnswer = false
        seek(to: max(0, m.t0 - HandCutMarker.clipPre))
        hc.previewUntil = t1 + HandCutMarker.clipPost
        play()
    }

    func markTapChip(_ id: String) {
        guard let hc = marker else { return }
        // The point already selected stops, which is how a walk holds a frame.
        if hc.state.selectedId == id {
            hc.previewUntil = nil
            player.pause()
            return
        }
        markPlayMark(id)
    }

    func markBeginReview() {
        guard let hc = marker else { return }
        hc.started = true
        if let first = hc.state.marks.first(where: { $0.t1 != nil }) {
            markPlayMark(first.id)
        } else {
            play()
        }
    }

    /// A rally the pass went past, put back in the middle of the hole at a
    /// rally's length, with the bar open on it.
    func markInsert(_ gap: HandCutGap) {
        guard let hc = marker else { return }
        let span = gap.hi - gap.lo
        let len = max(HandCut.MIN_POINT_S, min(6, span - 0.4))
        let t0 = gap.lo + (span - len) / 2
        let t1 = t0 + len
        let id = hc.nextId()
        guard hc.apply(HandCut.insertMark(hc.state, t0: t0, t1: t1, id: id)) else { return }
        player.pause()
        hc.previewUntil = nil
        hc.pausedForAnswer = false
        seek(to: max(0, t0 - HandCutMarker.clipPre))
        hc.adjustDraft = HandCutSpan(t0: t0, t1: t1)
        hc.adjustBounds = HandCutSpan(t0: gap.lo, t1: gap.hi)
        hc.adjusting = id
    }

    func markStep(_ dir: Int) {
        guard let hc = marker else { return }
        let s = hc.state
        guard let sel = s.selectedId, let i = s.marks.firstIndex(where: { $0.id == sel }) else { return }
        var j = i + dir
        while j >= 0 && j < s.marks.count {
            if s.marks[j].t1 != nil {
                markPlayMark(s.marks[j].id)
                return
            }
            j += dir
        }
    }

    /// A clip played out. A point still waiting for its winner holds the
    /// picture there; anything else plays the next point straight away.
    func markChainAfterPreview() {
        guard let hc = marker, let sel = hc.state.selectedId,
              let i = hc.state.marks.firstIndex(where: { $0.id == sel })
        else { return }
        let done = hc.state.marks[i]
        if hc.mode == .score && !done.isLet && done.winner == nil { return }
        guard let next = hc.state.marks[(i + 1)...].first(where: { $0.t1 != nil }) else { return }
        markPlayMark(next.id)
    }

    /// The Score switch, at the gate or mid-pass. Nothing is lost: winners
    /// already called stay on their points either way. Off is the old
    /// "Stop scoring"; on asks who served first where the old "Score them
    /// too" did.
    func markSetScoring(_ on: Bool) {
        guard let hc = marker else { return }
        let next: HandCutMode = on ? .score : .cut
        guard next != hc.mode, next == .cut || !hc.practice else { return }
        hc.mode = next
        if next == .cut {
            hc.state = HandCut.clearAwaiting(hc.state)
            hc.serveStep = false
            if hc.pausedForAnswer {
                hc.pausedForAnswer = false
                play()
            }
            return
        }
        if MatchTitle.tracksServe(hc.matchType), hc.firstServer == nil,
           HandCut.openMark(hc.state.marks) == nil {
            // Before the pass starts this is the question on the way in,
            // and closing it cues the picture the same way.
            hc.serveStepCue = !hc.started
            hc.serveStep = true
        }
    }

    /// Back to where the marking had got to: the rally still open, wherever
    /// it sits, or else the end of the last point.
    func markResume() {
        guard let hc = marker else { return }
        hc.state = HandCut.selectMark(hc.state, id: nil)
        hc.previewUntil = nil
        if let at = HandCutMarker.markingPlace(hc.state.marks) { seek(to: max(0, at)) }
        play()
    }

    func markBeginMarking() {
        guard let hc = marker else { return }
        hc.started = true
        markResume()
    }

    /// Mark again: the point comes out (undoable) and the playhead lands a
    /// few seconds before it, never back inside the rally before.
    func markAgain() {
        guard let hc = marker, let m = hc.selectedMark,
              let i = hc.state.marks.firstIndex(where: { $0.id == m.id })
        else { return }
        let floor = HandCutMarker.floorAfter(i > 0 ? hc.state.marks[i - 1] : nil)
        let to = max(floor, max(0, m.t0 - HandCutMarker.redoLead))
        hc.state = HandCut.selectMark(HandCut.removeMark(hc.state, id: m.id).state, id: nil)
        hc.adjusting = nil
        hc.previewUntil = nil
        seek(to: to)
        play()
    }

    func markRemove() {
        guard let hc = marker, let m = hc.selectedMark else { return }
        hc.apply(HandCut.removeMark(hc.state, id: m.id))
        hc.adjusting = nil
        hc.state = HandCut.selectMark(hc.state, id: nil)
    }

    func markUndo() {
        guard let hc = marker else { return }
        hc.state = HandCut.undoLast(hc.state)
        markResumeAfterAnswer()
    }

    func markStar() {
        guard let hc = marker else { return }
        let s = hc.state
        let target = s.awaitingId ?? s.selectedId ?? HandCut.openMark(s.marks)?.id ?? s.marks.last?.id
        if let target { hc.apply(HandCut.toggleStar(s, id: target)) }
    }

    func markOpenAdjust() {
        guard let hc = marker, let m = hc.selectedMark, let mT1 = m.t1,
              let i = hc.state.marks.firstIndex(where: { $0.id == m.id })
        else { return }
        let marks = hc.state.marks
        let prevEnd = HandCutMarker.floorAfter(i > 0 ? marks[i - 1] : nil)
        let nextStart = i < marks.count - 1 ? marks[i + 1].t0 : (hc.durationS ?? mT1 + 30)
        hc.adjustDraft = HandCutSpan(t0: m.t0, t1: mT1)
        hc.adjustBounds = HandCutSpan(t0: max(prevEnd, m.t0 - 8), t1: min(nextStart, mT1 + 8))
        hc.adjusting = m.id
        // The preview is over once an edge is in hand. Left armed, dragging
        // the end past the clip's stop fired the walk to the next point and
        // took the bar away mid-drag (the web does the same).
        hc.previewUntil = nil
        player.pause()
    }

    func markConfirmAdjust() {
        guard let hc = marker else { return }
        let id = hc.adjusting
        let d = hc.adjustDraft
        hc.adjusting = nil
        hc.adjustDraft = nil
        hc.adjustBounds = nil
        guard let id, let d, let m = hc.state.marks.first(where: { $0.id == id }), m.t1 != nil
        else { return }
        if d.t0 != m.t0 || d.t1 != m.t1 {
            hc.apply(HandCut.setEdges(hc.state, id: id, t0: d.t0, t1: d.t1))
        }
    }

    func markOpenReview() {
        guard let hc = marker else { return }
        player.pause()
        hc.submitError = nil
        hc.reviewing = true
    }

    func markSubmit() async {
        guard let hc = marker, !hc.busy else { return }
        // Sending would put these marks over the newer draft, which is the
        // one thing the newer-draft rule exists to stop.
        if hc.store.conflicted {
            hc.submitError = HandCutDraftStore.newerDraft
            return
        }
        if let bad = HandCut.validate(hc.state.marks, durationS: hc.durationS) {
            hc.submitError = bad.text
            return
        }
        hc.busy = true
        hc.submitError = nil
        await hc.store.flush()
        // A processed match: claim_hand_recut, with the choice.
        if let recut = hc.recut, let submitRecut = hc.submitRecut {
            let refusal = await submitRecut(hc.state.marks, recut.replace)
            hc.busy = false
            switch refusal {
            case nil:
                hc.store.submitted()
                closeTakeover()
            case .coachReview:
                // A review arrived since the sheet opened: Replace greys
                // with its reason and Keep is chosen. Nothing was sent.
                hc.recut?.coachReviewFound()
            case .message(let sentence):
                hc.submitError = sentence
            }
            return
        }
        let error = await hc.submitMarks(hc.state.marks)
        hc.busy = false
        if let error {
            hc.submitError = error
        } else {
            hc.store.submitted()
            closeTakeover()
        }
    }

    /// Start again, confirmed: every mark goes, the picture goes back to
    /// the start, and the gate reads Begin Cutting.
    func markStartAgain() {
        guard let hc = marker else { return }
        player.pause()
        hc.startAgain()
        seek(to: 0)
    }

    /// Close saves at once: a pending save is never dropped by leaving.
    func markClose() {
        if let hc = marker {
            Task { await hc.store.flush() }
        }
        closeTakeover()
    }
}

// MARK: - Small pieces

/// The web's active:scale press feedback.
struct HCPressStyle: ButtonStyle {
    var scale: CGFloat = 0.99
    var dim = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .opacity(dim && configuration.isPressed ? 0.8 : 1)
    }
}

/// `glow-cta`: a 1px cyan ring and two soft cyan shadows. Off when disabled,
/// because the glow is what reads as live.
struct HCGlow: ViewModifier {
    let on: Bool
    var radius: CGFloat = 12
    func body(content: Content) -> some View {
        content
            .overlay(
                RoundedRectangle(cornerRadius: radius + 1, style: .continuous)
                    .stroke(PL.cyan.opacity(on ? 0.4 : 0), lineWidth: 1)
                    .padding(-0.5)
            )
            .shadow(color: PL.cyan.opacity(on ? 0.35 : 0), radius: 12)
            .shadow(color: PL.cyan.opacity(on ? 0.18 : 0), radius: 20, y: 4)
            .animation(.easeOut(duration: 0.2), value: on)
    }
}

/// `animate-pulse` with `ring-2 ring-white/60`: the answers breathe, one to
/// half opacity and back every two seconds, while the pad waits for them.
struct HCAwaitPulse: ViewModifier {
    let active: Bool
    let radius: CGFloat
    /// The ring's gap from the tile (the landscape tiles sit it 2pt off).
    let offset: CGFloat
    @State private var dim = false

    func body(content: Content) -> some View {
        content
            .overlay {
                if active {
                    RoundedRectangle(cornerRadius: radius + offset + 1, style: .continuous)
                        .stroke(Color.white.opacity(0.6), lineWidth: 2)
                        .padding(-(offset + 1))
                }
            }
            .opacity(active && dim ? 0.5 : 1)
            .onChange(of: active, initial: true) { _, on in
                if on {
                    dim = false
                    withAnimation(.timingCurve(0.4, 0, 0.6, 1, duration: 1).repeatForever(autoreverses: true)) {
                        dim = true
                    }
                } else {
                    withAnimation(.linear(duration: 0)) { dim = false }
                }
            }
    }
}

/// `ks-fade`: 180ms ease-out from nothing at 97% scale.
struct HCFadeIn: ViewModifier {
    @State private var shown = false
    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .scaleEffect(shown ? 1 : 0.97)
            .onAppear {
                withAnimation(.easeOut(duration: 0.18)) { shown = true }
            }
    }
}

import AVFoundation
import SwiftUI

/// The Modify modal — Split · Join · Adjust, the same three operations the
/// web's ModifyClip drives (modifyOps.ts): split_point / merge_points RPCs
/// and the t0/t1 adjust patch, each followed by one queued reclip job.
/// Plays the CUT video, because a point's real start and end can live
/// outside its own clip file.
struct ModifySheet: View {
    let match: MatchRow
    let model: MatchDetailModel
    let point: MatchPoint
    let pad: ClipPad
    /// A split marker seeded by the pad's "two points in there?" nudge. The
    /// cut lands sight-unseen otherwise; seeding it here means the user SEES
    /// where the split goes and can move it before confirming.
    var initialCut: Double?

    @Environment(\.dismiss) private var dismiss
    @State private var tab: Tab = .split
    @State private var player = AVPlayer()
    @State private var videoURL: URL?
    @State private var playhead: Double = 0
    @State private var paused = false
    @State private var observer: Any?
    @State private var busy = false
    @State private var failed = false

    // Split state: marker times in CUT seconds, and a disposition per segment.
    @State private var markers: [Double] = []
    @State private var segments: [WinnerOrSkip?] = [nil]

    // Join state.
    @State private var joinCount = 1
    @State private var joinWinner: WinnerOrSkip = .user
    @State private var joinArmed = false

    // Adjust state: edited t0/t1 in SOURCE seconds.
    @State private var t0New: Double = 0
    @State private var t1New: Double = 0

    private enum Tab: String, CaseIterable {
        case split = "Split", join = "Join", adjust = "Adjust"
    }

    /// The point's padded span in cut-video seconds.
    private var span: (start: Double, end: Double)? {
        guard let cutT0 = point.cutT0, let t0 = point.t0, let t1 = point.t1 else { return nil }
        let eff = effectivePad(pad, tightStart: point.tightStart, tightEnd: point.tightEnd)
        return (cutT0, cutT0 + eff.pre + (t1 - t0) + eff.post)
    }

    /// Cut seconds ↔ source seconds, through the span anchor.
    private var anchor: Double {
        guard let t0 = point.t0 else { return 0 }
        let eff = effectivePad(pad, tightStart: point.tightStart, tightEnd: point.tightEnd)
        return max(0, t0 - eff.pre)
    }

    private func sourceTime(ofCut T: Double) -> Double {
        anchor + (T - (point.cutT0 ?? 0))
    }

    private func cutTime(ofSource t: Double) -> Double {
        (point.cutT0 ?? 0) + (t - anchor)
    }

    private var maxJoin: Int {
        guard let i = model.visible.firstIndex(where: { $0.id == point.id }) else { return 0 }
        return model.visible.dropFirst(i + 1).filter { $0.cutT0 != nil && $0.t1 != nil }.count
    }

    var body: some View {
        ZStack {
            PL.ink.ignoresSafeArea()
            VStack(spacing: 14) {
                HStack {
                    Text("Modify this point")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(PL.textBody)
                    Spacer()
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
                    .disabled(busy)
                }
                .padding(.horizontal, 16)

                tabPicker

                video

                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        switch tab {
                        case .split: splitControls
                        case .join: joinControls
                        case .adjust: adjustControls
                        }
                        if failed {
                            Text("That didn't save. Try again.")
                                .font(.plCaption)
                                .foregroundStyle(PL.dangerText)
                        }
                    }
                    .padding(16)
                }
            }
            .padding(.top, 12)
        }
        .task { await load() }
        .onDisappear {
            if let observer { player.removeTimeObserver(observer) }
            observer = nil
            player.pause()
        }
        .onAppear {
            t0New = point.t0 ?? 0
            t1New = point.t1 ?? 0
            if let initialCut, markers.isEmpty {
                markers = [initialCut]
                segments = [nil, nil]
            }
        }
        .interactiveDismissDisabled(busy)
    }

    private var tabPicker: some View {
        HStack(spacing: 2) {
            ForEach(Tab.allCases, id: \.self) { t in
                let active = tab == t
                let disabled = t == .join && maxJoin < 1
                Button {
                    tab = t
                } label: {
                    VStack(spacing: 1) {
                        Text(t.rawValue)
                            .font(.system(size: 13, weight: .semibold))
                        Text(subtitle(for: t))
                            .font(.system(size: 9))
                            .foregroundStyle(PL.text500)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 7)
                    .foregroundStyle(active ? PL.cyan : disabled ? PL.text600 : PL.text300)
                    .background(active ? PL.cyan.opacity(0.12) : .clear, in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(disabled)
            }
        }
        .padding(3)
        .background(PL.ink.opacity(0.5), in: Capsule())
        .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
        .padding(.horizontal, 16)
    }

    private func subtitle(for t: Tab) -> String {
        switch t {
        case .split: "two rallies in one"
        case .join: maxJoin < 1 ? "no next point" : "merge with next"
        case .adjust: "trim start / end"
        }
    }

    // MARK: - Video

    private var video: some View {
        ZStack {
            Color.black
            if videoURL != nil {
                PlayerLayerView(player: player)
            } else {
                ProgressView().tint(PL.cyan)
            }
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture { togglePlay() }
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .overlay(alignment: .bottom) { scrubber }
        .clipShape(RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                .strokeBorder(PL.edge, lineWidth: 1)
        )
        .padding(.horizontal, 16)
    }

    private var scrubber: some View {
        GeometryReader { geo in
            let width = geo.size.width
            ZStack(alignment: .leading) {
                Rectangle().fill(PL.ink.opacity(0.65))
                if let span {
                    let length = max(0.01, span.end - span.start)
                    Rectangle()
                        .fill(PL.cyan)
                        .frame(width: width * min(1, max(0, (playhead - span.start) / length)))
                    ForEach(Array(markers.enumerated()), id: \.offset) { _, m in
                        Rectangle()
                            .fill(Color(hex: 0xF43F5E))
                            .frame(width: 2)
                            .offset(x: width * min(1, max(0, (m - span.start) / length)))
                    }
                }
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        guard let span else { return }
                        let f = min(1, max(0, value.location.x / width))
                        seek(to: span.start + f * (span.end - span.start))
                    }
            )
        }
        .frame(height: 18)
    }

    // MARK: - Split

    @ViewBuilder
    private var splitControls: some View {
        Text("Scrub to where one rally ends and the next begins, then add a cut. Each segment gets its own winner.")
            .font(.plCaption)
            .foregroundStyle(PL.text400)

        Button {
            addMarker()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "scissors")
                    .font(.system(size: 13, weight: .medium))
                Text("Add cut at playhead")
            }
        }
        .buttonStyle(PLSecondaryButtonStyle())

        if !markers.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(markers.enumerated()), id: \.offset) { i, m in
                    HStack(spacing: 10) {
                        Text("Cut \(i + 1) · \(relative(m))s")
                            .font(.plCaption)
                            .monospacedDigit()
                            .foregroundStyle(PL.text300)
                        Button("Remove") { removeMarker(at: i) }
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                            .buttonStyle(.plain)
                        Spacer()
                    }
                }
            }

            SectionHeading("Who won each segment?")
            VStack(spacing: 8) {
                ForEach(0..<segments.count, id: \.self) { i in
                    HStack(spacing: 8) {
                        Text("\(i + 1)")
                            .font(.system(size: 12, weight: .bold))
                            .monospacedDigit()
                            .foregroundStyle(PL.text400)
                            .frame(width: 26, height: 26)
                            .background(PL.surface2, in: Circle())
                        segmentPill("Me", i, .user, PL.cyan)
                        segmentPill("Them", i, .opponent, PL.magentaSoft)
                        segmentPill("Skip", i, .skip, PL.warning)
                    }
                }
            }

            Button(busy ? "Splitting…" : "Split into \(segments.count)") {
                Task { await doSplit() }
            }
            .buttonStyle(PLPrimaryButtonStyle())
            .disabled(busy)
        }
    }

    private func segmentPill(
        _ label: String, _ i: Int, _ value: WinnerOrSkip, _ tint: Color
    ) -> some View {
        let selected = segments[i] == value
        return Button(label) {
            segments[i] = selected ? nil : value
        }
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(selected ? tint : PL.text400)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 7)
        .background(selected ? tint.opacity(0.15) : PL.ink.opacity(0.4), in: Capsule())
        .overlay(Capsule().strokeBorder(selected ? tint.opacity(0.6) : PL.edge, lineWidth: 1))
        .buttonStyle(.plain)
    }

    private func addMarker() {
        guard let t0 = point.t0, let t1 = point.t1 else { return }
        let src = sourceTime(ofCut: playhead)
        guard src > t0 + SPLIT_EDGE_S, src < t1 - SPLIT_EDGE_S else { return }
        markers.append(playhead)
        markers.sort()
        segments = Array(repeating: nil, count: markers.count + 1)
    }

    private func removeMarker(at i: Int) {
        markers.remove(at: i)
        segments = Array(repeating: nil, count: markers.count + 1)
    }

    private func doSplit() async {
        guard let rootT0 = point.t0, let originalT1 = point.t1 else { return }
        busy = true
        failed = false
        let ok = await model.runSplit(point, pad: pad, cutTimes: markers)
        if ok {
            // Segment winners: the root plus its children, in timeline
            // order, are exactly the visible points inside the old span.
            let segPoints = model.visible.filter {
                guard let t0 = $0.t0 else { return false }
                return t0 >= rootT0 - 0.001 && t0 < originalT1 - 0.001
            }
            for (i, disposition) in segments.enumerated()
            where i < segPoints.count {
                if let disposition {
                    await model.pickOutcome(segPoints[i], disposition)
                }
            }
            dismiss()
        } else {
            failed = true
        }
        busy = false
    }

    // MARK: - Join

    @ViewBuilder
    private var joinControls: some View {
        Text("One rally got recorded as several points. Merge this point with the next ones and the footage joins back into a single point.")
            .font(.plCaption)
            .foregroundStyle(PL.text400)

        HStack(spacing: 14) {
            Text("Merge with next")
                .font(.plBody)
                .foregroundStyle(PL.text200)
            HStack(spacing: 0) {
                Button {
                    joinCount = max(1, joinCount - 1)
                } label: {
                    Image(systemName: "minus")
                        .frame(width: 38, height: 34)
                }
                Text("\(joinCount)")
                    .font(.system(size: 15, weight: .bold))
                    .monospacedDigit()
                    .frame(width: 32)
                Button {
                    joinCount = min(maxJoin, joinCount + 1)
                } label: {
                    Image(systemName: "plus")
                        .frame(width: 38, height: 34)
                }
            }
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(PL.text200)
            .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
            Text(joinCount == 1 ? "point" : "points")
                .font(.plBody)
                .foregroundStyle(PL.text500)
        }

        SectionHeading("Who won the joined point?")
        HStack(spacing: 8) {
            joinPill("Me", .user, PL.cyan)
            joinPill("Them", .opponent, PL.magentaSoft)
            joinPill("Skip", .skip, PL.warning)
        }

        Text("Join can't be undone. The merged points' own outcomes and clips fold into this one.")
            .font(.plCaption)
            .foregroundStyle(PL.warningText)

        Button(busy ? "Joining…" : joinArmed ? "Tap again to join" : "Join") {
            Task { await doJoin() }
        }
        .buttonStyle(PLPrimaryButtonStyle())
        .disabled(busy || maxJoin < 1)
    }

    private func joinPill(_ label: String, _ value: WinnerOrSkip, _ tint: Color) -> some View {
        let selected = joinWinner == value
        return Button(label) {
            joinWinner = value
            joinArmed = false
        }
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(selected ? tint : PL.text400)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 9)
        .background(selected ? tint.opacity(0.15) : PL.ink.opacity(0.4), in: Capsule())
        .overlay(Capsule().strokeBorder(selected ? tint.opacity(0.6) : PL.edge, lineWidth: 1))
        .buttonStyle(.plain)
    }

    private func doJoin() async {
        guard joinArmed else {
            joinArmed = true
            return
        }
        busy = true
        failed = false
        let ok = await model.runJoin(point, count: joinCount)
        if ok {
            if let survivor = model.points.first(where: { $0.id == point.id }) {
                await model.pickOutcome(survivor, joinWinner)
            }
            dismiss()
        } else {
            failed = true
        }
        busy = false
    }

    // MARK: - Adjust

    @ViewBuilder
    private var adjustControls: some View {
        if point.edited {
            Text("A clip update is already in flight for this point. Adjust unlocks when it finishes, usually under a minute.")
                .font(.plCaption)
                .foregroundStyle(PL.warningText)
        } else {
            Text("Move the point's start and end. The clip re-cuts to match.")
                .font(.plCaption)
                .foregroundStyle(PL.text400)

            edgeRow("Start", value: $t0New, floor: nil, ceil: t1New - 0.5)
            edgeRow("End", value: $t1New, floor: t0New + 0.5, ceil: nil)

            HStack(spacing: 12) {
                Button("Start = playhead") {
                    let src = sourceTime(ofCut: playhead)
                    if src < t1New - 0.5 { t0New = max(0, (src * 100).rounded() / 100) }
                }
                .buttonStyle(PLSecondaryButtonStyle())
                Button("End = playhead") {
                    let src = sourceTime(ofCut: playhead)
                    if src > t0New + 0.5 { t1New = (src * 100).rounded() / 100 }
                }
                .buttonStyle(PLSecondaryButtonStyle())
            }

            Button(busy ? "Saving…" : "Save timing") {
                Task { await doAdjust() }
            }
            .buttonStyle(PLPrimaryButtonStyle())
            .disabled(busy || (t0New == point.t0 && t1New == point.t1))
        }
    }

    private func edgeRow(
        _ label: String, value: Binding<Double>, floor: Double?, ceil: Double?
    ) -> some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.plBody)
                .foregroundStyle(PL.text200)
                .frame(width: 44, alignment: .leading)
            ForEach([-0.5, -0.1, 0.1, 0.5], id: \.self) { step in
                Button(step > 0 ? "+\(String(format: "%.1f", step))" : String(format: "%.1f", step)) {
                    var next = ((value.wrappedValue + step) * 100).rounded() / 100
                    if let floor { next = max(floor, next) }
                    if let ceil { next = min(ceil, next) }
                    value.wrappedValue = max(0, next)
                    seek(to: cutTime(ofSource: value.wrappedValue))
                }
                .font(.system(size: 12, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(PL.text300)
                .padding(.horizontal, 8)
                .padding(.vertical, 7)
                .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                .buttonStyle(.plain)
            }
            Spacer()
            Text(String(format: "%.1fs", value.wrappedValue))
                .font(.plCaption)
                .monospacedDigit()
                .foregroundStyle(PL.text400)
        }
    }

    private func doAdjust() async {
        busy = true
        failed = false
        let ok = await model.runAdjust(point, t0New: t0New, t1New: t1New)
        if ok {
            dismiss()
        } else {
            failed = true
        }
        busy = false
    }

    // MARK: - Playback

    private func load() async {
        struct Req: Encodable {
            let matchId: String
            let preview: Bool
        }
        struct Res: Decodable { let url: String? }
        let res: Res? = try? await API.post(
            "api/media-url",
            Req(matchId: match.id.uuidString.lowercased(), preview: true)
        )
        guard let url = res?.url.flatMap(URL.init) else { return }
        videoURL = url
        player.replaceCurrentItem(with: AVPlayerItem(url: url))
        if let span {
            playhead = span.start
            await player.seek(
                to: CMTime(seconds: span.start, preferredTimescale: 600),
                toleranceBefore: .zero, toleranceAfter: .zero
            )
        }
        player.play()
        observer = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.1, preferredTimescale: 600), queue: .main
        ) { time in
            Task { @MainActor in
                playhead = time.seconds
                if let span, time.seconds >= span.end {
                    player.pause()
                    paused = true
                }
            }
        }
    }

    private func togglePlay() {
        if player.rate > 0 {
            player.pause()
            paused = true
        } else {
            if let span, playhead >= span.end - 0.05 {
                seek(to: span.start)
            }
            player.play()
            paused = false
        }
    }

    private func seek(to cutSeconds: Double) {
        playhead = cutSeconds
        player.seek(
            to: CMTime(seconds: cutSeconds, preferredTimescale: 600),
            toleranceBefore: .zero, toleranceAfter: .zero
        )
    }

    private func relative(_ cutSeconds: Double) -> String {
        guard let span else { return "0.0" }
        return String(format: "%.1f", cutSeconds - span.start)
    }
}

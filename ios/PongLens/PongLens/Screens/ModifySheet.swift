import AVFoundation
import SwiftUI

/// What a Modify run did, handed back so the host can carry on. Splitting
/// and joining both change which points exist, so a host that merely closed
/// the sheet would leave the playhead inside footage that has been re-cut
/// underneath it — and, worse, would look like nothing had happened.
struct ModifyOutcome {
    /// Where the pass resumes, in cut seconds. Nil leaves the playhead be.
    var landing: Double?
    /// Whether to start playing there.
    var play: Bool
    var flash: String
}

/// The Modify modal — ALL clip surgery, shared by the Keep-score pad and the
/// point view so a boundary problem never means switching surfaces. The
/// reviewer watches the whole (possibly wrong) point play out, THEN decides.
///
/// Three paths behind a segmented control, mirroring the web's ModifyClip:
///
///   SPLIT   one point into 2 or 3. A stepper for how many, a draggable
///           marker per cut on the clip's own timeline, and a Me / Them /
///           Skip picker per resulting part.
///   JOIN    swallow the next one or two points. A stepper, the combined
///           span, one outcome picker. Merged-away rows are gone for good,
///           so the button arms before it fires.
///   ADJUST  the point was cut short or long: drag the two edge handles
///           until the tinted band covers the real point. Both directions
///           are the same drag, which is why it is not called Trim.
///
/// It plays the CUT video rather than the point's own clip, because a
/// point's real start and end can live outside that clip.
struct ModifySheet: View {
    let match: MatchRow
    let model: MatchDetailModel
    let point: MatchPoint
    let pad: ClipPad
    /// A split marker seeded by the pad's "two points in there?" nudge. The
    /// cut lands sight-unseen otherwise; seeding it here means the user SEES
    /// where the split goes and can move it before confirming.
    var initialCut: Double?
    /// Called on the way out of a run that changed something, before the
    /// sheet closes. The point view has nothing to resume and leaves it nil.
    var onFinished: ((ModifyOutcome) -> Void)?

    @Environment(\.dismiss) private var dismiss
    /// Compact sideways. The sheet's video is a hunting tool, not the point
    /// of the screen, and at full width it stood taller than the phone.
    @Environment(\.verticalSizeClass) private var vClass
    @State private var tab: Tab = .split
    @State private var player = AVPlayer()
    @State private var videoURL: URL?

    /// WHICH FILE THE PICTURE IS COMING FROM.
    ///
    /// The cut video is the fast default: it is already streaming behind
    /// this sheet, so opening costs nothing. But it no longer holds the
    /// waiting between rallies — since the body assembler tightened the
    /// cards, only about a fifth of seams run unbroken into their
    /// neighbour, and on an end-on camera two in a hundred. Drag a handle
    /// out there and the cut has no frame to show.
    ///
    /// So the original is warmed in the background and taken over ONCE,
    /// the first time a handle leaves what the cut holds. Once, and then
    /// it stays: the original contains everything the cut does, so there is
    /// nothing to go back for, and swapping to and fro would stall twice.
    private enum PreviewSource { case cut, raw }
    @State private var previewSource: PreviewSource = .cut
    /// The stored original, loaded far enough to be attached without a
    /// round trip. Nil until the warm finishes, or for ever on a match
    /// whose original was swept — where the old held-frame behaviour is
    /// what is left, and is still honest.
    @State private var rawAsset: AVURLAsset?
    /// Seconds to ADD to a point timestamp to reach the original's clock.
    /// A library upload processed with a head trim was cut down before the
    /// pipeline saw it, so every t0/t1 is measured from trim_start_s INTO
    /// the stored file. Yu Yu Lin is 243 s. Getting this wrong is silent:
    /// real footage from the wrong minute.
    @State private var rawOffset: Double = 0
    /// The one moment the picture is not live, between attaching the
    /// original and its first frame landing.
    @State private var swapping = false
    @State private var playhead: Double = 0
    @State private var paused = true
    @State private var observer: Any?
    @State private var busy = false
    @State private var failed = false
    /// Which handle a finger currently owns. Nil means the drag is scrubbing.
    @State private var dragging: Handle?
    /// One seek at a time, newest wins — see seek(to:).
    @State private var seeking = false
    @State private var pendingSeek: Double?
    /// A finger on the bare track, moving the picture rather than a handle.
    @State private var scrubbing = false
    /// Where the handle under the finger sat when the drag began.
    @State private var dragStartT: Double?

    // Split: how many parts, the marker times in CUT seconds, and one
    // disposition per resulting part.
    @State private var parts = 2
    @State private var markers: [Double] = []
    @State private var segments: [WinnerOrSkip] = [.user, .opponent]

    // Join.
    @State private var joinCount = 1
    @State private var joinWinner: WinnerOrSkip = .user
    @State private var joinArmed = false
    /// Backwards by default. You notice two cards are one rally by watching
    /// the second and realising it began in the first, so the join you want
    /// is with the point you just left. Falls forward when nothing precedes.
    @State private var joinDirection: JoinDirection = .previous

    // Adjust: edited t0/t1 in SOURCE seconds.
    @State private var adjT0: Double = 0
    @State private var adjT1: Double = 0

    private enum Tab: String, CaseIterable {
        case split = "Split", join = "Join", adjust = "Adjust"
    }

    private enum Handle: Equatable {
        case marker(Int)
        case edgeStart
        case edgeEnd
    }

    /// Source-space guard: a split has to sit this far inside the point on
    /// both edges. Matches split_point's own window.
    private let edgeS = SPLIT_EDGE_S
    /// Closest two markers may sit, in seconds of cut video.
    private let minGapS = 0.4
    private let trackHeight: CGFloat = 40

    // MARK: - Geometry

    private struct Geometry {
        var spanStart: Double
        var spanEnd: Double
        var rallyStart: Double
        var rallyEnd: Double
        var markerLo: Double
        var markerHi: Double
    }

    /// The point's clip in cut-video seconds (see Playhead.swift's anchoring
    /// note). The marker band is the rally itself, held clear of both source
    /// edges — the cut keeps source durations intact inside the span, so the
    /// guard is the same distance in either space.
    private var geo: Geometry? {
        guard let cutT0 = point.cutT0, let t0 = point.t0, let t1 = point.t1 else { return nil }
        let eff = effectivePad(pad, tightStart: point.tightStart, tightEnd: point.tightEnd)
        let rallyStart = cutT0 + eff.pre
        let rallyEnd = rallyStart + max(0, t1 - t0)
        return Geometry(
            spanStart: cutT0, spanEnd: rallyEnd + eff.post,
            rallyStart: rallyStart, rallyEnd: rallyEnd,
            markerLo: rallyStart + edgeS, markerHi: rallyEnd - edgeS
        )
    }

    private var splittable: Bool {
        guard let geo else { return false }
        return geo.markerHi - geo.markerLo > minGapS
    }

    /// The visible points this one could swallow either way — at most two
    /// per side, nearest first.
    private var prevPoints: [MatchPoint] { model.joinNeighbours(point, direction: .previous) }
    private var nextPoints: [MatchPoint] { model.joinNeighbours(point, direction: .next) }

    /// The chosen direction, corrected for a side that has nothing on it.
    private var joinDir: JoinDirection {
        switch joinDirection {
        case .previous: return prevPoints.isEmpty ? .next : .previous
        case .next: return nextPoints.isEmpty ? .previous : .next
        }
    }
    private var joinPool: [MatchPoint] { joinDir == .previous ? prevPoints : nextPoints }
    private var maxJoin: Int { joinPool.count }
    private var canJoin: Bool { !prevPoints.isEmpty || !nextPoints.isEmpty }

    /// What the video covers: the point's clip, extended through the far
    /// end of the run while the Join tab is up — forward to the last joined
    /// point's end, or back to the earliest one's start.
    private var videoSpan: (start: Double, end: Double)? {
        guard let geo else { return nil }
        if tab == .join, joinCount >= 1, joinPool.count >= joinCount {
            let far = joinPool[joinCount - 1]
            switch joinDir {
            case .next:
                if let end = paddedEnd(far, pad) { return (geo.spanStart, end) }
            case .previous:
                if let start = far.cutT0 { return (start, geo.spanEnd) }
            }
        }
        return (geo.spanStart, geo.spanEnd)
    }

    // Source ↔ cut, one linear map: the cut keeps source durations intact
    // inside a point's span.
    private func cutOf(_ src: Double) -> Double {
        guard let geo, let t0 = point.t0 else { return 0 }
        return geo.rallyStart + (src - t0)
    }

    private func srcOf(_ cut: Double) -> Double {
        guard let geo, let t0 = point.t0 else { return 0 }
        return t0 + (cut - geo.rallyStart)
    }

    private var adjLoCut: Double { geo?.spanStart ?? 0 }
    private var adjHiCut: Double { geo?.spanEnd ?? 0 }
    private var adjDirty: Bool { adjT0 != point.t0 || adjT1 != point.t1 }

    /// How far past the clip's own footage a handle may be DRAGGED.
    ///
    /// A clip cut long is a trim, and both handles start inside the picture
    /// with room to move inwards. A clip cut SHORT is the other half of the
    /// job and it used to be impossible here: both handles opened sitting on
    /// the clip's own edges with nowhere further to go, so a point missing
    /// its serve could not be widened at all. So the track runs past the
    /// clip on both sides, and that margin is real, draggable room.
    ///
    /// Fixed for a given point, deliberately: it bounds the drag, and a
    /// bound that moved while a finger was down would shift the coordinates
    /// under the drag it is bounding.
    private var adjustReach: Double {
        guard let geo else { return 0 }
        return min(8, max(2.5, (geo.spanEnd - geo.spanStart) * 0.3))
    }

    /// The drag's own limits: the clip plus the margin, and nothing beyond.
    private var adjustDragBounds: (start: Double, end: Double)? {
        guard let geo else { return nil }
        return (geo.spanStart - adjustReach, geo.spanEnd + adjustReach)
    }

    /// What the track DRAWS. Normally the drag bounds; it grows to follow a
    /// handle the step buttons have pushed out beyond them, so pressing
    /// "−1s" ten times never walks the handle off the end of the track.
    private var adjustSpan: (start: Double, end: Double)? {
        guard let bounds = adjustDragBounds else { return nil }
        return (
            min(bounds.start, cutOf(adjT0) - 1),
            max(bounds.end, cutOf(adjT1) + 1)
        )
    }

    /// The coordinate space of the scrub track. Split and Join measure the
    /// footage they are about; Adjust measures the room it can reach.
    private var trackSpan: (start: Double, end: Double)? {
        tab == .adjust ? adjustSpan : videoSpan
    }

    /// How far the cut video runs CONTIGUOUS with this point's own span,
    /// on each side. InsertGeometry's seam rule answers it (55% of seams
    /// are continuous, and the neighbour's own kept footage is real on
    /// every seam): where it does, the Adjust preview follows a handle into
    /// that footage instead of freezing at the clip's edge; where the
    /// cutter removed time, the picture holds at the span's edge and the
    /// caption says so. Port of ModifyClip.tsx playableBounds.
    /// The player's own clock for a cut second. One line, because `srcOf`
    /// is a straight line anchored on this point: extrapolated past the
    /// clip it is a LIE against the cut (the cutter removed time out
    /// there, which is the whole reason the preview used to clamp) and is
    /// exactly true against the original, which has no cuts in it.
    private func playerTime(_ cutSeconds: Double) -> Double {
        previewSource == .raw ? srcOf(cutSeconds) + rawOffset : cutSeconds
    }

    /// ...and back, so everything on screen stays in cut seconds and no
    /// other part of this sheet has to know which file is playing.
    private func cutTime(_ playerSeconds: Double) -> Double {
        previewSource == .raw ? cutOf(playerSeconds - rawOffset) : playerSeconds
    }

    private var playableBounds: (lo: Double, hi: Double)? {
        contiguousCutBounds(for: point, in: model.visible, pad: pad)
    }

    /// True when a draft edge lies past the footage the cut video holds
    /// here: the file will carry it (the re-cut reads the original), the
    /// preview cannot.
    private var adjustBeyondClip: Bool {
        guard let b = playableBounds else { return false }
        return cutOf(adjT0) < b.lo - 0.05 || cutOf(adjT1) > b.hi + 0.05
    }

    /// What PLAYS on the Adjust tab: the draft point with its pads, clamped
    /// to the footage the cut holds, so pressing play after a drag shows
    /// exactly what the point will keep. Split and Join play the span.
    private var playSpan: (start: Double, end: Double)? {
        guard let span = videoSpan else { return nil }
        guard tab == .adjust else { return span }
        let eff = effectivePad(
            pad,
            tightStart: point.tightStart && adjT0 == point.t0,
            tightEnd: point.tightEnd && adjT1 == point.t1)
        let want = (cutOf(adjT0) - eff.pre, cutOf(adjT1) + eff.post)
        // On the original there is nothing to clamp against: play exactly
        // what the clip will keep, which is the question this tab asks.
        if previewSource == .raw {
            return want.1 > want.0 ? (want.0, want.1) : span
        }
        guard let b = playableBounds else { return span }
        let start = min(b.hi, max(b.lo, want.0))
        let end = min(b.hi, max(b.lo, want.1))
        return end > start ? (start, end) : span
    }

    private var youLabel: String { "Me" }
    private var themLabel: String { match.opponentName ?? "Them" }

    // MARK: - Body

    var body: some View {
        ZStack {
            PL.ink.ignoresSafeArea()
            VStack(spacing: 0) {
                header
                if vClass == .compact {
                    // Sideways there is width and no height. Stacked, the
                    // pickers — the part of this sheet that actually decides
                    // anything — sat below the fold behind a scroll nobody
                    // knew was there. So the clip and its timeline take one
                    // column and the decisions take the other.
                    tabPicker
                    // The whole pair scrolls, rather than the pickers alone.
                    // Giving the video only the height left over made it
                    // something to squint at, and a tight point is exactly
                    // when you need to see the ball — so it takes the room
                    // it needs and the last inch of the sheet scrolls, which
                    // costs a flick and nothing else.
                    ScrollView {
                        HStack(alignment: .top, spacing: 12) {
                            VStack(spacing: 0) {
                                video
                                scrubTrack
                            }
                            .frame(maxWidth: .infinity)
                            body(for: tab)
                                .frame(maxWidth: .infinity)
                        }
                        .padding(.bottom, 12)
                    }
                } else {
                    ScrollView {
                        VStack(spacing: 0) {
                            tabPicker
                            video
                            scrubTrack
                            body(for: tab)
                        }
                        .padding(.bottom, 12)
                    }
                }
                footer
            }
        }
        .task { await load() }
        .onAppear {
            adjT0 = point.t0 ?? 0
            adjT1 = point.t1 ?? 0
            segments = [
                point.confirmedWinner == .opponent ? .opponent : .user,
                .opponent,
            ]
            resetMarkers()
        }
        .onChange(of: parts) { _, _ in resetMarkers() }
        .onChange(of: tab) { _, _ in
            joinArmed = false
            seekToSpanStart()
        }
        .onChange(of: joinDirection) { _, _ in
            joinArmed = false
            joinCount = min(max(1, joinCount), max(1, maxJoin))
        }
        .onChange(of: joinCount) { _, _ in
            joinArmed = false
            seekToSpanStart()
        }
        .onDisappear {
            if let observer { player.removeTimeObserver(observer) }
            observer = nil
            player.pause()
        }
        .interactiveDismissDisabled(busy)
    }

    private var header: some View {
        HStack {
            Text("Modify point")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(PL.textBody)
            Spacer()
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PL.text400)
                    .frame(width: 34, height: 34)
                    .background(PL.ink.opacity(0.4), in: Circle())
                    .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(busy)
            .accessibilityLabel("Close")
        }
        .padding(.horizontal, 16)
        // Sideways every point of chrome is a point the clip does not get.
        .padding(.vertical, vClass == .compact ? 6 : 12)
        .overlay(alignment: .bottom) {
            Rectangle().fill(PL.edge.opacity(0.6)).frame(height: 1)
        }
    }

    private var tabPicker: some View {
        HStack(spacing: 6) {
            tabCard(.split, "one point → 2-3", enabled: true)
            tabCard(.join, canJoin ? "merge neighbours" : "nothing beside it",
                    enabled: canJoin)
            tabCard(.adjust, "fix start / end", enabled: point.t0 != nil)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, vClass == .compact ? 6 : 12)
    }

    private func tabCard(_ t: Tab, _ subtitle: String, enabled: Bool) -> some View {
        let active = tab == t
        return Button {
            tab = t
        } label: {
            VStack(alignment: .leading, spacing: 1) {
                Text(t.rawValue)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PL.text100)
                Text(subtitle)
                    .font(.system(size: 11))
                    .foregroundStyle(PL.text500)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10)
            .padding(.vertical, vClass == .compact ? 6 : 9)
            .background(
                RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                    .fill(active ? PL.cyan.opacity(0.1) : PL.ink.opacity(0.4))
            )
            .overlay(
                RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                    .strokeBorder(active ? PL.cyan.opacity(0.6) : PL.edge, lineWidth: 1)
            )
            .opacity(enabled ? 1 : 0.4)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    // MARK: - Video

    private var video: some View {
        ZStack {
            Color.black
            if videoURL != nil {
                PlayerLayerView(player: player)
            } else {
                Text("Loading…")
                    .font(.plCaption)
                    .foregroundStyle(PL.text600)
            }
            if paused {
                Image(systemName: "play.fill")
                    .font(.system(size: 24))
                    .foregroundStyle(.white)
                    .frame(width: 58, height: 58)
                    .background(PL.ink.opacity(0.6), in: Circle())
                    .allowsHitTesting(false)
            }
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture { togglePlay() }
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        // Sideways, the full width of the sheet is 16:9 taller than the
        // screen — the tabs above it and the track below it both scroll off
        // and the sheet reads as one enormous video. Capped, it stays a
        // preview and everything that acts on it stays in view.
        .frame(maxHeight: vClass == .compact ? 210 : nil)
        .clipShape(RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
        .padding(.horizontal, 12)
    }

    // MARK: - Scrub track

    /// One track, three jobs: it scrubs, it carries the split markers, and
    /// on Adjust it carries the two edge handles with the kept region tinted
    /// between them — so the band IS the preview of what the point keeps.
    private var scrubTrack: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            ZStack(alignment: .leading) {
                // the bar
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.08))
                    if let geo, let span = trackSpan {
                        // On Adjust the track reaches past the clip, so the
                        // stretch the cut video holds here is drawn lighter.
                        // Without it the margins read as more of the same
                        // footage rather than as somewhere the picture
                        // cannot go.
                        if tab == .adjust {
                            let lit = playableBounds ?? (geo.spanStart, geo.spanEnd)
                            Rectangle()
                                .fill(Color.white.opacity(0.16))
                                .frame(width: max(0, (frac(lit.hi, span) - frac(lit.lo, span)) * width))
                                .offset(x: frac(lit.lo, span) * width)
                        }
                        let lo = tab == .adjust ? cutOf(adjT0) : geo.rallyStart
                        let hi = tab == .adjust ? cutOf(adjT1) : geo.rallyEnd
                        let x = frac(lo, span) * width
                        Rectangle()
                            .fill(tab == .adjust ? PL.cyan.opacity(0.45) : Color.white.opacity(0.1))
                            .frame(width: max(0, (frac(hi, span) - frac(lo, span)) * width))
                            .offset(x: x)
                        // Watched-so-far, on the tabs where the track is a
                        // timeline. Adjust's track is a ruler, not a
                        // timeline — a fill running to the playhead there
                        // painted right over the one distinction the tab
                        // depends on, which stretch the clip holds.
                        if tab != .adjust {
                            Capsule()
                                .fill(PL.cyan.opacity(0.7))
                                .frame(width: frac(playhead, span) * width)
                        }
                    }
                }
                .frame(height: 6)
                .clipShape(Capsule())
                .frame(maxHeight: .infinity)

                if let span = trackSpan {
                    // playhead knob
                    Circle()
                        .fill(PL.cyan)
                        .frame(width: 12, height: 12)
                        .offset(x: frac(playhead, span) * width - 6)
                        .allowsHitTesting(false)

                    if tab == .adjust, let geo {
                        // Where this clip's own footage begins and ends.
                        ForEach([geo.spanStart, geo.spanEnd], id: \.self) { edge in
                            Rectangle()
                                .fill(Color.white.opacity(0.45))
                                .frame(width: 1, height: 18)
                                .offset(x: frac(edge, span) * width)
                                .allowsHitTesting(false)
                        }
                        handle(.edgeStart, at: cutOf(adjT0), span: span,
                               width: width, tint: PL.cyan, label: "Start of point")
                        handle(.edgeEnd, at: cutOf(adjT1), span: span,
                               width: width, tint: PL.cyan, label: "End of point")
                    }
                    if tab == .split {
                        ForEach(Array(markers.enumerated()), id: \.offset) { i, m in
                            handle(.marker(i), at: m, span: span, width: width,
                                   tint: PL.magenta, label: "Split marker \(i + 1)")
                        }
                    }
                }
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        guard dragging == nil, let span = trackSpan else { return }
                        scrubbing = true
                        playhead = playable(time(at: value.location.x, width: width, span: span))
                        request(playhead, exact: false)
                    }
                    .onEnded { _ in
                        scrubbing = false
                        request(playhead, exact: true)
                    }
            )
        }
        .frame(height: trackHeight)
        .padding(.horizontal, 12)
        .padding(.top, vClass == .compact ? 6 : 12)
    }

    private func handle(
        _ kind: Handle, at t: Double, span: (start: Double, end: Double),
        width: CGFloat, tint: Color, label: String
    ) -> some View {
        ZStack {
            Rectangle()
                .fill(tint)
                .frame(width: 2, height: trackHeight)
            Circle()
                .fill(PL.ink)
                .overlay(Circle().strokeBorder(tint, lineWidth: 2))
                .frame(width: 16, height: 16)
        }
        .frame(width: 40, height: trackHeight)
        .contentShape(Rectangle())
        .offset(x: frac(t, span) * width - 20)
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    // Translation from where the handle was when the finger
                    // landed — never its live position. The handle moves with
                    // the value it is setting, so reading the finger against
                    // the handle's CURRENT box counts every movement twice
                    // and the marker runs away to the end of the track.
                    if dragging != kind {
                        dragging = kind
                        dragStartT = t
                    }
                    let from = frac(dragStartT ?? t, span) * width
                    drag(kind, to: time(
                        at: from + value.translation.width, width: width, span: span
                    ))
                }
                .onEnded { _ in
                    dragging = nil
                    dragStartT = nil
                    request(playhead, exact: true)
                }
        )
        .accessibilityLabel(label)
    }

    /// A cut time the video can actually show. On Adjust that is every
    /// second the cut holds contiguous with this point (a handle dragged
    /// into the neighbour's footage shows that footage); on Split and Join
    /// it is the span itself.
    private func playable(_ t: Double) -> Double {
        // The original holds every second of the match, so there is nothing
        // to clamp to once it is the source.
        if previewSource == .raw { return t }
        if tab == .adjust, let b = playableBounds {
            return min(b.hi, max(b.lo, t))
        }
        guard let span = videoSpan else { return t }
        return min(span.end, max(span.start, t))
    }

    private func frac(_ t: Double, _ span: (start: Double, end: Double)) -> CGFloat {
        let length = max(0.01, span.end - span.start)
        return CGFloat(min(1, max(0, (t - span.start) / length)))
    }

    private func time(at x: CGFloat, width: CGFloat, span: (start: Double, end: Double)) -> Double {
        let f = Double(min(1, max(0, x / max(1, width))))
        return span.start + f * (span.end - span.start)
    }

    private func drag(_ kind: Handle, to t: Double) {
        guard let geo else { return }
        switch kind {
        case .marker(let i):
            guard markers.indices.contains(i) else { return }
            let lo = i > 0 ? markers[i - 1] + minGapS : geo.markerLo
            let hi = i < markers.count - 1 ? markers[i + 1] - minGapS : geo.markerHi
            markers[i] = round2(min(hi, max(lo, t)))
            seek(to: t)
        case .edgeStart:
            let floor = max(0, srcOf(adjustDragBounds?.start ?? adjLoCut))
            adjT0 = round2(min(adjT1 - 0.5, max(floor, srcOf(t))))
            // The picture stops at the clip's edge. Out in the margin there
            // is no frame to show — the cut video jumps to a different part
            // of the match there, and showing that as "the new start" would
            // be a lie the user would act on.
            useOriginalIfNeeded()
            seek(to: playable(cutOf(adjT0)))
        case .edgeEnd:
            let ceil = srcOf(adjustDragBounds?.end ?? adjHiCut)
            adjT1 = round2(max(adjT0 + 0.5, min(ceil, srcOf(t))))
            useOriginalIfNeeded()
            seek(to: playable(cutOf(adjT1)))
        }
    }

    // MARK: - Bodies

    @ViewBuilder
    private func body(for tab: Tab) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            switch tab {
            case .split: splitBody
            case .join: joinBody
            case .adjust: adjustBody
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
    }

    // MARK: Split

    @ViewBuilder
    private var splitBody: some View {
        stepper(
            "Into", value: parts, range: 2...3,
            format: { "\($0) points" },
            set: { parts = $0 }
        )

        if !splittable {
            Text("This point is too short to split.")
                .font(.plCaption)
                .foregroundStyle(PL.warningText)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
        }

        VStack(spacing: 8) {
            ForEach(Array(segments.enumerated()), id: \.offset) { i, disposition in
                let bounds = partBounds(i)
                let from = bounds.from
                let to = bounds.to
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("Part \(i + 1)")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(PL.text400)
                        Spacer()
                        if let geo {
                            Text("\(fmt(from - geo.spanStart))–\(fmt(to - geo.spanStart))")
                                .font(.system(size: 10))
                                .monospacedDigit()
                                .foregroundStyle(PL.text600)
                        }
                    }
                    dispositionRow(selected: disposition) { segments[i] = $0 }
                }
                .padding(10)
                .background(
                    RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                        .fill(PL.ink.opacity(0.3))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                        .strokeBorder(PL.edge, lineWidth: 1)
                )
            }
        }
        .padding(.top, 4)
    }

    /// Where part `i` runs from and to, in cut seconds. Read defensively:
    /// the first body pass happens before onAppear has placed the markers,
    /// so the two lists are briefly out of step.
    private func partBounds(_ i: Int) -> (from: Double, to: Double) {
        let rallyStart = geo?.rallyStart ?? 0
        let rallyEnd = geo?.rallyEnd ?? 0
        let from = i > 0 && markers.indices.contains(i - 1) ? markers[i - 1] : rallyStart
        let to = markers.indices.contains(i) ? markers[i] : rallyEnd
        return (from, to)
    }

    // MARK: Join

    @ViewBuilder
    private var joinBody: some View {
        // Which way: the point(s) before this one, or after.
        HStack(spacing: 6) {
            directionPill("← Previous", .previous, count: prevPoints.count)
            directionPill("Next →", .next, count: nextPoints.count)
        }
        .padding(.top, 4)

        stepper(
            joinDir == .previous ? "Points before" : "Points after",
            value: joinCount, range: 1...max(1, maxJoin),
            format: { "\($0) point\($0 == 1 ? "" : "s")" },
            set: { joinCount = $0 }
        )

        if let span = videoSpan {
            Text("Merged clip ≈ \(fmt(span.end - span.start))")
                .font(.plCaption)
                .foregroundStyle(PL.text500)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 4)
        }

        VStack(alignment: .leading, spacing: 6) {
            Text("Who won the point?")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(PL.text400)
            dispositionRow(selected: joinWinner, big: true) { joinWinner = $0 }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                .fill(PL.ink.opacity(0.3))
        )
        .overlay(
            RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                .strokeBorder(PL.edge, lineWidth: 1)
        )
        .padding(.top, 4)

        Text(joinArmed
             ? "Tap Confirm to join — this can't be undone."
             : "Join can't be undone from here.")
            .font(.system(size: 11))
            .foregroundStyle(PL.warningText.opacity(0.75))
            .frame(maxWidth: .infinity)
            .padding(.top, 8)
    }

    // MARK: Adjust

    @ViewBuilder
    private var adjustBody: some View {
        edgeRow("Start", start: true)
        edgeRow("End", start: false)

        Text("Point ≈ \(fmt(max(0, adjT1 - adjT0))) — drag the handles until the band covers the whole point.")
            .font(.plCaption)
            .foregroundStyle(PL.text500)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 4)

        // Three states, because the honest sentence changed. Out past the
        // cut we used to hold a frame and say the stretch was gone; now the
        // original is playing and there is nothing to apologise for. Only a
        // match whose original was swept still gets the old line.
        Text(adjustBeyondClip
             ? (previewSource == .raw
                ? "Playing from the original recording, past what the match video holds."
                : "That stretch was cut from the match video. The clip will still include it.")
             : "The lighter stretch is the footage the match video holds here. Drag or step an edge to take in more of the point.")
            .font(.system(size: 11))
            .foregroundStyle(PL.text500)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 4)

    }

    /// One edge's readout and its two step buttons.
    ///
    /// The buttons used to appear only once the handle had been dragged all
    /// the way onto the clip's edge, which meant the one control for a clip
    /// cut short was invisible until you had already found the problem by
    /// hand. They are always here now, one second at a time in either
    /// direction, and they read the same whichever way the edge is going.
    private func edgeRow(_ label: String, start: Bool) -> some View {
        let current = start ? adjT0 : adjT1
        let original = (start ? point.t0 : point.t1) ?? current
        let delta = current - original
        return HStack(spacing: 10) {
            Text(label)
                .font(.plBody)
                .foregroundStyle(PL.text300)
                .frame(width: 44, alignment: .leading)
            Text(abs(delta) < 0.001
                 ? "unchanged"
                 : String(format: "%@%.1fs", delta > 0 ? "+" : "−", abs(delta)))
                .font(.plCaption)
                .monospacedDigit()
                .foregroundStyle(abs(delta) < 0.001 ? PL.text500 : PL.cyan)
            Spacer()
            stepPill("−1s", enabled: true) { nudge(start: start, by: -1) }
            stepPill("+1s", enabled: true) { nudge(start: start, by: 1) }
        }
        .padding(.vertical, 6)
    }

    private func stepPill(_ title: String, enabled: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(PL.text200)
                .frame(width: 52, height: 32)
                .background(PL.ink.opacity(0.4), in: Capsule())
                .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                .opacity(enabled ? 1 : 0.35)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    /// Move one edge a second, keeping the two half a second apart and the
    /// start off the front of the match. Outward there is no ceiling: the
    /// track grows to follow, and the reclip is what brings the frames.
    private func nudge(start: Bool, by delta: Double) {
        if start {
            adjT0 = round2(min(adjT1 - 0.5, max(0, adjT0 + delta)))
            useOriginalIfNeeded()
            seek(to: playable(cutOf(adjT0)))
        } else {
            adjT1 = round2(max(adjT0 + 0.5, adjT1 + delta))
            useOriginalIfNeeded()
            seek(to: playable(cutOf(adjT1)))
        }
    }

    // MARK: - Shared pieces

    private func stepper(
        _ title: String, value: Int, range: ClosedRange<Int>,
        format: (Int) -> String, set: @escaping (Int) -> Void
    ) -> some View {
        HStack {
            Text(title)
                .font(.plBody)
                .foregroundStyle(PL.text300)
            Spacer()
            HStack(spacing: 12) {
                stepButton("minus", enabled: value > range.lowerBound) {
                    set(max(range.lowerBound, value - 1))
                }
                Text(format(value))
                    .font(.system(size: 14, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(PL.text100)
                    .frame(width: 80)
                stepButton("plus", enabled: value < range.upperBound) {
                    set(min(range.upperBound, value + 1))
                }
            }
        }
        .padding(.vertical, 8)
    }

    private func stepButton(_ icon: String, enabled: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(PL.text200)
                .frame(width: 32, height: 32)
                .background(PL.ink.opacity(0.4), in: Circle())
                .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))
                .opacity(enabled ? 1 : 0.3)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(icon == "minus" ? "Fewer points" : "More points")
    }

    private func directionPill(_ label: String, _ value: JoinDirection, count: Int) -> some View {
        let on = joinDir == value
        return Button { joinDirection = value } label: {
            Text(label)
                .font(.system(size: 14, weight: .semibold))
                .lineLimit(1)
                .foregroundStyle(on ? PL.cyan : PL.text400)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 9)
                .background(
                    RoundedRectangle(cornerRadius: PL.rSmall, style: .continuous)
                        .fill(on ? PL.cyan.opacity(0.2) : PL.ink.opacity(0.4))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rSmall, style: .continuous)
                        .strokeBorder(on ? PL.cyan : PL.edge, lineWidth: 1)
                )
                .opacity(count < 1 ? 0.3 : 1)
        }
        .buttonStyle(.plain)
        .disabled(count < 1)
        .accessibilityLabel(value == .previous ? "Join with the previous point" : "Join with the next point")
    }

    private func dispositionRow(
        selected: WinnerOrSkip, big: Bool = false,
        _ set: @escaping (WinnerOrSkip) -> Void
    ) -> some View {
        HStack(spacing: 6) {
            dispositionPill(youLabel, .user, PL.cyan, selected, big, set)
            dispositionPill(themLabel, .opponent, PL.magentaSoft, selected, big, set)
            dispositionPill("Skip", .skip, PL.warning, selected, big, set)
        }
    }

    private func dispositionPill(
        _ label: String, _ value: WinnerOrSkip, _ tint: Color,
        _ selected: WinnerOrSkip, _ big: Bool, _ set: @escaping (WinnerOrSkip) -> Void
    ) -> some View {
        let on = selected == value
        return Button { set(value) } label: {
            Text(label)
                .font(.system(size: big ? 14 : 12, weight: .semibold))
                .lineLimit(1)
                .truncationMode(.tail)
                .foregroundStyle(on ? tint : PL.text400)
                .frame(maxWidth: .infinity)
                .padding(.vertical, big ? 9 : 7)
                .background(
                    RoundedRectangle(cornerRadius: PL.rSmall, style: .continuous)
                        .fill(on ? tint.opacity(0.2) : PL.ink.opacity(0.4))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rSmall, style: .continuous)
                        .strokeBorder(on ? tint : PL.edge, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    private var footer: some View {
        VStack(spacing: 0) {
            Rectangle().fill(PL.edge.opacity(0.6)).frame(height: 1)
            // Beside the button that failed, not at the end of a scroll view
            // the tap never scrolled to.
            if failed {
                Text("That didn't save. Try again.")
                    .font(.plCaption)
                    .foregroundStyle(PL.dangerText)
                    .padding(.top, 10)
            }
            Group {
                switch tab {
                case .split:
                    cta(busy ? "Splitting…" : "Split into \(parts)",
                        enabled: splittable && !busy) {
                        Task { await doSplit() }
                    }
                case .join:
                    cta(
                        busy ? "Joining…"
                        : joinArmed ? "Confirm — join \(joinCount + 1) points"
                        : "Join \(joinCount + 1) points",
                        enabled: maxJoin >= 1 && !busy, armed: joinArmed
                    ) {
                        Task { await doJoin() }
                    }
                case .adjust:
                    cta(busy ? "Saving…" : "Save timing",
                        enabled: adjDirty && !busy) {
                        Task { await doAdjust() }
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, vClass == .compact ? 7 : 12)
        }
        .background(PL.ink)
    }

    /// The one action at the bottom. Armed is the join confirm: amber, not
    /// cyan, because the second tap is the one that cannot be taken back.
    private func cta(
        _ title: String, enabled: Bool, armed: Bool = false,
        _ action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                // The write takes a few round trips — an RPC per cut, then
                // one per outcome — and a button that only changes its verb
                // reads as a button that did not respond.
                if busy {
                    ProgressView()
                        .controlSize(.small)
                        .tint(armed ? PL.warningText : PL.ink)
                }
                Text(title)
                    .font(.plButton)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }
            .foregroundStyle(armed ? PL.warningText : PL.ink)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(Capsule().fill(armed ? PL.warning.opacity(0.15) : PL.cyan))
            .overlay(
                Capsule().strokeBorder(
                    armed ? PL.warning : PL.cyan.opacity(0.4), lineWidth: 1
                )
            )
            .shadow(color: armed ? .clear : PL.cyan.opacity(0.3), radius: 12)
            .opacity(enabled ? 1 : 0.4)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    // MARK: - Actions

    private func resetMarkers() {
        guard let geo else { return }
        let lo = geo.markerLo
        let hi = geo.markerHi
        var next: [Double] = []
        for k in 1..<parts {
            next.append(round2(lo + (hi - lo) * Double(k) / Double(parts)))
        }
        if parts == 2, let initialCut, hi - lo > 0, !next.isEmpty {
            next[0] = round2(min(hi, max(lo, initialCut)))
        }
        markers = next
        segments = (0..<parts).map { $0 < segments.count ? segments[$0] : .user }
    }

    /// Where the pass carries on after a run that changed the timeline.
    /// Read BEFORE the run: splitting keeps every child inside this point's
    /// own span, and joining swallows the points after it, so in both cases
    /// the right landing is a point that exists on the timeline now.
    private func landingAfter(_ last: MatchPoint) -> Double? {
        guard let i = model.visible.firstIndex(where: { $0.id == last.id }) else { return nil }
        return model.visible.dropFirst(i + 1).first(where: { $0.cutT0 != nil })?.cutT0
    }

    private func doSplit() async {
        guard let rootT0 = point.t0, let originalT1 = point.t1, !busy else { return }
        busy = true
        failed = false
        let plan = segments
        let landing = landingAfter(point)
        let ok = await model.runSplit(point, pad: pad, cutTimes: markers)
        if ok {
            // The root plus its children, in timeline order, are exactly the
            // visible points inside the old span.
            let segPoints = model.visible.filter {
                guard let t0 = $0.t0 else { return false }
                return t0 >= rootT0 - 0.001 && t0 < originalT1 - 0.001
            }
            // The outcomes are written without waiting: each is a round trip,
            // three of them in a row held the sheet open for a second or two
            // on a slow connection after the split itself had already
            // landed. setOutcome applies locally first, so the pad is right
            // the moment it resumes and the rows catch up behind it — the
            // web's own order.
            for (i, disposition) in plan.enumerated() where i < segPoints.count {
                let p = segPoints[i]
                Task { await model.setOutcome(p, disposition) }
            }
            finish(ModifyOutcome(
                landing: landing, play: true,
                flash: "Split into \(max(parts, segPoints.count))"
            ))
        } else {
            failed = true
        }
        busy = false
    }

    private func doJoin() async {
        guard maxJoin >= 1, !busy else { return }
        guard joinArmed else {
            joinArmed = true
            return
        }
        busy = true
        failed = false
        // Past the whole merged range, not back onto the survivor: it is
        // already scored, so landing on it would replay a point that has
        // just been answered. Forward, the run ends at the last neighbour;
        // backward, it ends at this point. Read before the write, while
        // every row of the run still exists.
        let dir = joinDir
        let pool = joinPool
        guard pool.count >= joinCount else { busy = false; return }
        let landing = landingAfter(dir == .next ? pool[joinCount - 1] : point)
        if let survivor = await model.runJoin(point, pad: pad, count: joinCount, direction: dir) {
            // Written without waiting, as the split's outcomes are.
            let winner = joinWinner
            Task { await model.setOutcome(survivor, winner) }
            finish(ModifyOutcome(
                landing: landing, play: true,
                flash: "Joined \(joinCount + 1) points"
            ))
        } else {
            failed = true
        }
        busy = false
    }

    private func doAdjust() async {
        guard adjDirty, !busy else { return }
        busy = true
        failed = false
        let ok = await model.runAdjust(point, pad: pad, t0New: adjT0, t1New: adjT1)
        if ok {
            // Land on the point's NEW padded start and play it. The whole
            // reason to adjust is to check the window, and handing back no
            // landing left the pad paused wherever it was, so the change only
            // showed on a replay while Split and Join moved on and played.
            // runAdjust has re-anchored cutT0 by the time it returns.
            let after = model.points.first(where: { $0.id == point.id })
            finish(ModifyOutcome(
                landing: after?.cutT0, play: after?.cutT0 != nil,
                flash: "Timing saved"
            ))
        } else {
            failed = true
        }
        busy = false
    }

    private func finish(_ outcome: ModifyOutcome) {
        onFinished?(outcome)
        dismiss()
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
        if let span = videoSpan {
            playhead = span.start
            await player.seek(
                to: CMTime(seconds: span.start, preferredTimescale: 600),
                toleranceBefore: .zero, toleranceAfter: .zero
            )
        }
        observer = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.1, preferredTimescale: 600), queue: .main
        ) { time in
            Task { @MainActor in
                paused = player.rate == 0
                guard dragging == nil, !scrubbing, !seeking, pendingSeek == nil else { return }
                let here = cutTime(time.seconds)
                playhead = here
                if let span = playSpan, player.rate > 0, here >= span.end {
                    player.pause()
                    playhead = span.end
                    paused = true
                }
            }
        }
        // Only now, with the cut already showing, is the original worth
        // fetching. Nothing above this line waits for it.
        await warmOriginal()
    }

    /// Fetch the original and parse enough of it to attach without a
    /// round trip. Runs AFTER the cut is on screen, so it cannot slow the
    /// sheet down, and never plays or shows anything.
    ///
    /// `available: false` is an ordinary answer, not a failure: a legacy
    /// match whose original was swept has none, and the held-frame
    /// behaviour it falls back to is what shipped before this.
    private func warmOriginal() async {
        struct Req: Encodable {
            let matchId: String
            let rawPreview: Bool
        }
        struct Res: Decodable {
            let url: String?
            let available: Bool?
            let trimStartS: Double?
        }
        guard let res: Res = try? await API.post(
            "api/media-url",
            Req(matchId: match.id.uuidString.lowercased(), rawPreview: true)
        ), res.available == true, let url = res.url.flatMap(URL.init) else { return }
        let asset = AVURLAsset(url: url)
        // Metadata only. This is a few range reads, not the file: the
        // original is the largest object in the system and a phone must
        // never be made to pull it to answer a question about two seconds.
        _ = try? await asset.load(.duration, .tracks)
        guard !Task.isCancelled else { return }
        rawOffset = res.trimStartS ?? 0
        rawAsset = asset
    }

    /// Take the original over, once, the first time a handle leaves what
    /// the cut can show. Everything on screen stays in cut seconds; only
    /// the file behind the picture changes.
    private func useOriginalIfNeeded() {
        guard tab == .adjust, previewSource == .cut, adjustBeyondClip,
              let asset = rawAsset else { return }
        previewSource = .raw
        swapping = true
        let wasPlaying = player.rate > 0
        player.pause()
        // A queued seek belongs to the old file's clock. Drop it rather
        // than let it land on the new one.
        seeking = false
        pendingSeek = nil
        player.replaceCurrentItem(with: AVPlayerItem(asset: asset))
        request(playhead, exact: true)
        if wasPlaying { player.play() }
    }

    private func seekToSpanStart() {
        guard let span = videoSpan else { return }
        seek(to: span.start)
    }

    private func togglePlay() {
        if player.rate > 0 {
            player.pause()
            paused = true
        } else {
            if let span = playSpan, playhead >= span.end - 0.05 || playhead < span.start {
                seek(to: span.start)
            }
            player.play()
            paused = false
        }
    }

    /// Move the picture to `cutSeconds`.
    ///
    /// Two things make the naive version fatal here. A drag fires dozens of
    /// times a second, and an exact seek on this footage has to fetch and
    /// decode a whole group of pictures (the cut video runs long GOPs) — so
    /// a single marker drag queues dozens of full decodes over the network
    /// and the system kills the app for it. So: at most one seek in flight,
    /// the newest request wins, and while a handle is moving the seek is
    /// allowed to land on a nearby frame. The exact frame is fetched when
    /// the finger lifts, which is the only moment it matters.
    private func seek(to cutSeconds: Double) {
        playhead = cutSeconds
        request(cutSeconds, exact: dragging == nil)
    }

    private func request(_ t: Double, exact: Bool) {
        guard t.isFinite else { return }
        guard !seeking else {
            pendingSeek = t
            return
        }
        seeking = true
        let tolerance: CMTime = exact
            ? .zero
            : CMTime(seconds: 0.15, preferredTimescale: 600)
        // `t` is a CUT second, which is what the whole sheet speaks. Only
        // here does it become a position in whichever file is attached.
        player.seek(
            to: CMTime(seconds: max(0, playerTime(t)), preferredTimescale: 600),
            toleranceBefore: tolerance, toleranceAfter: tolerance
        ) { _ in
            Task { @MainActor in
                seeking = false
                swapping = false
                guard let next = pendingSeek else { return }
                pendingSeek = nil
                request(next, exact: dragging == nil)
            }
        }
    }

    private func round2(_ v: Double) -> Double { (v * 100).rounded() / 100 }

    private func fmt(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds > 0 else { return "0:00" }
        let s = Int(seconds)
        return String(format: "%d:%02d", s / 60, s % 60)
    }
}

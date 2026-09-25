import AVFoundation
import SwiftUI

/// The trim with a picture to cut against, one component for every place a
/// player chooses what to process: Automatically on an unprocessed match,
/// Process again in More options, and "Trim it first" on the upload and
/// recording sheet. Top to bottom: the video, the bar with its two handles,
/// and "Start here" / "End here", which put a handle where the picture is.
/// The web's ClipPlayer over TrimBar with the same two stamps
/// (BreakIntoPoints, MoreOptions).
///
/// Dragging a handle moves the picture to that handle's time, so the frame
/// on screen is the one processing will start or end on. The seeks follow
/// TrimSeekQueue: loose while the finger is down, one exact seek when it
/// lifts. The times under the bar are the player's own clock
/// (TrimWindow.clock), the one its transport writes.
///
/// The box is sized on a view, never on the picture, from the video's shape
/// (the caller's when it knows it, else the file's), so it does not change
/// size under a finger. A portrait video's box stops at square rather than
/// standing taller than the controls around it; the picture sits inside.
///
/// With nothing to show (no file, no link), it is the bar alone.
struct TrimPreview: View {
    /// The file: the phone's own copy, or the original's link. Nil when
    /// there is none.
    let source: URL?
    /// The link is still being fetched: the box holds its place.
    var loading = false
    let duration: Double
    @Binding var start: Double
    /// Nil until the end handle moves: the whole video.
    @Binding var end: Double?
    /// The picture's width over its height, when the caller already knows
    /// it (the upload sheet reads it from the track for its poster).
    var aspect: CGFloat? = nil
    /// The upload sheet's preview is silent, as the web's upload card is.
    var muted = false

    @State private var video = TrimPreviewPlayer()
    /// The handle a drag took, for the life of the drag.
    @State private var dragging: TrimHandle?
    /// A finger on the transport's track.
    @State private var scrubbing = false

    private var endValue: Double { min(end ?? duration, duration) }

    private var boxAspect: CGFloat {
        max(aspect ?? video.aspect ?? 16 / 9, 1)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if source != nil || loading {
                picture
            }
            bar
            if source != nil {
                stamps
            }
        }
        .task(id: source) {
            guard let source else { return }
            await video.attach(source, at: start, muted: muted)
        }
        // A player taken off the screen keeps playing with sound.
        .onDisappear { video.stop() }
    }

    // MARK: - The picture

    private var picture: some View {
        let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
        return Color.black
            .aspectRatio(boxAspect, contentMode: .fit)
            .frame(maxWidth: .infinity)
            .overlay {
                if source != nil {
                    PlayerLayerView(player: video.player)
                        .allowsHitTesting(false)
                }
            }
            .overlay {
                // The whole picture plays and pauses. Idle, it shows a play
                // mark; playing, nothing sits on the picture.
                Button {
                    video.toggle()
                } label: {
                    ZStack {
                        Color.clear
                        if source == nil || (!video.ready && !video.failed) {
                            ProgressView().tint(PL.cyan)
                        } else if video.ready && !video.playing {
                            Circle()
                                .fill(PL.ink.opacity(0.6))
                                .frame(width: 56, height: 56)
                                .overlay(
                                    Image(systemName: "play.fill")
                                        .font(.system(size: 22))
                                        .foregroundStyle(.white)
                                        .offset(x: 2)
                                )
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!video.ready)
                .accessibilityLabel(video.playing ? "Pause" : "Play")
            }
            .overlay(alignment: .bottom) {
                if video.ready && (!video.playing || scrubbing) {
                    transport
                }
            }
            .clipShape(shape)
            .overlay(shape.strokeBorder(PL.edge, lineWidth: 1))
    }

    /// Paused: where the picture is, and a track to move it along. A solid
    /// strip, never a blur over moving video.
    private var transport: some View {
        HStack(spacing: 10) {
            Text(TrimWindow.clock(video.playhead))
            GeometryReader { geo in
                let w = geo.size.width
                let x = w * CGFloat(min(1, max(0, video.playhead / duration)))
                ZStack(alignment: .leading) {
                    Capsule().fill(PL.text600).frame(height: 3)
                    Capsule().fill(PL.cyan).frame(width: x, height: 3)
                    Circle().fill(.white).frame(width: 12, height: 12).offset(x: x - 6)
                }
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            if !scrubbing {
                                scrubbing = true
                                video.hold()
                            }
                            video.seek(
                                to: TrimWindow.seconds(x: value.location.x, width: w, duration: duration),
                                dragging: true
                            )
                        }
                        .onEnded { value in
                            scrubbing = false
                            video.release()
                            video.seek(
                                to: TrimWindow.seconds(x: value.location.x, width: w, duration: duration),
                                dragging: false
                            )
                        }
                )
            }
            Text(TrimWindow.clock(duration))
        }
        .font(.plCaption)
        .monospacedDigit()
        .foregroundStyle(PL.text200)
        .padding(.horizontal, 12)
        .frame(height: 40)
        .background(PL.ink.opacity(0.75))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(TrimWindow.clock(video.playhead)) of \(TrimWindow.clock(duration))")
    }

    // MARK: - The bar

    private var bar: some View {
        VStack(spacing: 6) {
            GeometryReader { geo in
                let w = geo.size.width
                let x0 = w * CGFloat(start / duration)
                let x1 = w * CGFloat(endValue / duration)
                ZStack(alignment: .leading) {
                    // The whole video.
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(PL.ink.opacity(0.6))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .strokeBorder(PL.edge, lineWidth: 1)
                        )
                    // The window that gets processed.
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(PL.cyan.opacity(0.14))
                        .overlay(
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .strokeBorder(PL.cyan.opacity(0.5), lineWidth: 1)
                        )
                        .frame(width: max(0, x1 - x0))
                        .offset(x: x0)
                    handle(at: x0)
                    handle(at: x1)
                }
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            let which: TrimHandle
                            if let dragging {
                                which = dragging
                            } else {
                                // The nearer handle comes to the finger,
                                // decided once, where it landed.
                                which = TrimWindow.grab(
                                    TrimWindow.seconds(x: value.startLocation.x, width: w, duration: duration),
                                    start: start, end: endValue
                                )
                                dragging = which
                                video.hold()
                            }
                            let next = TrimWindow.move(
                                which,
                                to: TrimWindow.seconds(x: value.location.x, width: w, duration: duration),
                                start: start, end: endValue, duration: duration
                            )
                            switch which {
                            case .start: start = next.start
                            case .end: end = next.end
                            }
                            if source != nil {
                                video.seek(
                                    to: TrimWindow.seekTarget(which, start: next.start, end: next.end),
                                    dragging: true
                                )
                            }
                        }
                        .onEnded { _ in
                            guard let which = dragging else { return }
                            dragging = nil
                            video.release()
                            // The exact frame, once, now the finger is up.
                            if source != nil {
                                video.seek(
                                    to: TrimWindow.seekTarget(which, start: start, end: endValue),
                                    dragging: false
                                )
                            }
                        }
                )
            }
            .frame(height: 44)

            HStack {
                Text(TrimWindow.clock(start))
                Spacer()
                Text("\(TrimWindow.clock(endValue - start)) kept")
                    .foregroundStyle(PL.text300)
                Spacer()
                Text(TrimWindow.clock(endValue))
            }
            .font(.plCaption)
            .monospacedDigit()
            .foregroundStyle(PL.text500)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "Trim. Keeping \(TrimWindow.clock(endValue - start)) from \(TrimWindow.clock(start)) to \(TrimWindow.clock(endValue))."
        )
    }

    private func handle(at x: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 4, style: .continuous)
            .fill(PL.cyan)
            .frame(width: 14, height: 44)
            .overlay(
                RoundedRectangle(cornerRadius: 1, style: .continuous)
                    .fill(PL.ink.opacity(0.6))
                    .frame(width: 2, height: 16)
            )
            .offset(x: x - 7)
    }

    // MARK: - Start here, End here

    /// Two outlined buttons sharing the width, each 44pt tall. Plain-styled
    /// with their own outline, because in the upload sheet they sit in one
    /// Form row, where any other style lets a tap on the row fire them all.
    private var stamps: some View {
        HStack(spacing: 10) {
            stampButton(CutAgainCopy.startHere) {
                start = TrimWindow.stampStart(
                    playhead: video.playhead, start: start, end: endValue, duration: duration)
            }
            stampButton(CutAgainCopy.endHere) {
                end = TrimWindow.stampEnd(
                    playhead: video.playhead, start: start, end: endValue, duration: duration)
            }
        }
        .disabled(!video.ready)
        .opacity(video.ready ? 1 : 0.5)
    }

    private func stampButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            OutlinedActionLabel(title: title)
        }
        .buttonStyle(.plain)
    }
}

/// PLSecondaryButtonStyle's outlined pill as a label, full width and 44pt
/// tall, for a button that must keep `.plain` (several buttons in one Form
/// row).
struct OutlinedActionLabel: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.plButtonSecondary)
            .foregroundStyle(PL.text300)
            .frame(maxWidth: .infinity, minHeight: 44)
            .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
            .contentShape(Capsule())
    }
}

/// The preview's player: the file attached once, its shape, whether it is
/// playing, and where the picture is. Seeks go through TrimSeekQueue, so a
/// drag never has more than one in flight.
@MainActor @Observable
final class TrimPreviewPlayer {
    @ObservationIgnored private var _player: AVPlayer?
    /// Made on first use: SwiftUI builds a fresh one of these on every
    /// redraw of the view that owns it and keeps only the first, so the
    /// discarded ones must not each allocate a player.
    var player: AVPlayer {
        if let _player { return _player }
        let made = AVPlayer()
        _player = made
        return made
    }

    private(set) var url: URL?
    /// Width over height, as displayed. Nil until the track answers.
    private(set) var aspect: CGFloat?
    private(set) var ready = false
    private(set) var failed = false
    private(set) var playing = false
    /// The picture's time, in seconds of the file. Follows playback, and
    /// jumps to a seek's target the moment it is asked for.
    private(set) var playhead: Double = 0
    /// A finger is on a handle or the transport.
    private(set) var holding = false

    @ObservationIgnored private var seeks = TrimSeekQueue()
    @ObservationIgnored private var timeObserver: Any?
    @ObservationIgnored private var controlObservation: NSKeyValueObservation?
    @ObservationIgnored private var itemObservation: NSKeyValueObservation?

    /// Show `url`, on the frame at `seconds`. The same file again only
    /// resumes watching it.
    func attach(_ url: URL, at seconds: Double, muted: Bool) async {
        player.isMuted = muted
        observe()
        guard url != self.url else { return }
        self.url = url
        ready = false
        failed = false
        let asset = AVURLAsset(url: url)
        let item = AVPlayerItem(asset: asset)
        itemObservation = item.observe(\.status, options: [.initial, .new]) { @Sendable [weak self] item, _ in
            guard let self else { return }
            let status = item.status
            Task { @MainActor in
                self.ready = status == .readyToPlay
                self.failed = status == .failed
            }
        }
        player.replaceCurrentItem(with: item)
        seek(to: seconds, dragging: false)
        if aspect == nil { aspect = await Self.shape(asset) }
    }

    func toggle() {
        if playing {
            player.pause()
            return
        }
        // At the end, play from the start again.
        if let item = player.currentItem, item.duration.isNumeric,
           playhead >= item.duration.seconds - 0.25 {
            seek(to: 0, dragging: false)
        }
        player.play()
    }

    /// A finger went down on a handle or the transport: playback stops so
    /// the picture stays where the finger puts it.
    func hold() {
        holding = true
        if playing { player.pause() }
    }

    func release() { holding = false }

    func seek(to seconds: Double, dragging: Bool) {
        guard seconds.isFinite else { return }
        playhead = max(0, seconds)
        if let next = seeks.request(seconds, dragging: dragging) { run(next) }
    }

    /// Off the screen: stop, and stop listening. `attach` picks both up
    /// again if the view comes back.
    func stop() {
        _player?.pause()
        if let timeObserver { _player?.removeTimeObserver(timeObserver) }
        timeObserver = nil
        controlObservation = nil
    }

    private func run(_ seek: TrimSeek) {
        let tolerance = CMTime(seconds: seek.tolerance, preferredTimescale: 600)
        player.seek(
            to: CMTime(seconds: seek.seconds, preferredTimescale: 600),
            toleranceBefore: tolerance, toleranceAfter: tolerance
        ) { @Sendable [weak self] _ in
            guard let self else { return }
            Task { @MainActor in
                if let next = self.seeks.finished(dragging: self.holding) { self.run(next) }
            }
        }
    }

    private func observe() {
        if timeObserver == nil {
            timeObserver = player.addPeriodicTimeObserver(
                forInterval: CMTime(seconds: 0.2, preferredTimescale: 600), queue: .main
            ) { [weak self] time in
                MainActor.assumeIsolated {
                    // A seek in flight or a finger down owns the playhead.
                    guard let self, !self.holding, !self.seeks.inFlight, self.seeks.pending == nil else { return }
                    let t = time.seconds
                    if t.isFinite { self.playhead = max(0, t) }
                }
            }
        }
        if controlObservation == nil {
            controlObservation = player.observe(\.timeControlStatus, options: [.initial, .new]) { @Sendable [weak self] player, _ in
                guard let self else { return }
                let on = player.timeControlStatus != .paused
                Task { @MainActor in self.playing = on }
            }
        }
    }

    /// A phone hands back both shapes, and the track's transform decides
    /// which: the stored frame of a portrait clip is still a landscape one.
    private static func shape(_ asset: AVURLAsset) async -> CGFloat? {
        guard let track = try? await asset.loadTracks(withMediaType: .video).first,
              let size = try? await track.load(.naturalSize),
              let transform = try? await track.load(.preferredTransform)
        else { return nil }
        let shown = size.applying(transform)
        let width = abs(shown.width), height = abs(shown.height)
        guard width > 0, height > 0 else { return nil }
        return width / height
    }
}

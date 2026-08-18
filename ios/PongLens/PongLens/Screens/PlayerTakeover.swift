import AVFoundation
import SwiftUI

/// Watch-mode takeover: the cut video full screen with custom chrome.
/// Gestures mirror the web player: tap = play/pause + chrome, double-tap
/// right/left = next/previous point (seeks to cut_t0 and plays).
struct PlayerTakeover: View {
    let points: [MatchPoint]
    let pad: ClipPad
    let videoURL: URL
    var startAt: Double?

    @Environment(\.dismiss) private var dismiss
    @State private var player = AVPlayer()
    @State private var currentT: Double = 0
    @State private var duration: Double = 0
    @State private var isPlaying = false
    @State private var chromeVisible = true
    @State private var scrubbing = false
    @State private var scrubT: Double = 0
    @State private var flash: String?
    @State private var observer: Any?

    private var currentPoint: MatchPoint? {
        guard let id = playingPointId(points, at: currentT) else { return nil }
        return points.first { $0.id == id }
    }

    private var currentDisplayNumber: Int? {
        guard let current = currentPoint,
              let i = points.firstIndex(of: current) else { return nil }
        return i + 1
    }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Color.black.ignoresSafeArea()
                PlayerLayerView(player: player)
                    .ignoresSafeArea()

                // Gesture surface over the picture.
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture(count: 2, coordinateSpace: .local) { location in
                        if location.x > geo.size.width / 2 { step(1) } else { step(-1) }
                    }
                    .onTapGesture { togglePlay() }

                if let flash {
                    PLToast(message: flash)
                        .transition(.opacity)
                }

                VStack {
                    if chromeVisible { topBar }
                    Spacer()
                    if chromeVisible { transport }
                }
            }
        }
        .statusBarHidden()
        .task { await start() }
        .onDisappear {
            if let observer { player.removeTimeObserver(observer) }
            player.pause()
        }
    }

    private var topBar: some View {
        HStack {
            if let n = currentDisplayNumber {
                Text("Point \(n)")
                    .font(.plMicro)
                    .monospacedDigit()
                    .foregroundStyle(PL.text300)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(PL.ink.opacity(0.7), in: Capsule())
                    .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
            }
            Spacer()
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PL.text300)
                    .padding(10)
                    .background(PL.ink.opacity(0.7), in: Circle())
                    .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))
            }
        }
        .padding(16)
    }

    private var transport: some View {
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
                .font(.plMicro)
                .monospacedDigit()
                .foregroundStyle(PL.text300)
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
                .font(.plMicro)
                .monospacedDigit()
                .foregroundStyle(PL.text500)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(PL.ink.opacity(0.7), in: Capsule())
        .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
        .padding(16)
    }

    // MARK: - Playback

    private func start() async {
        try? AVAudioSession.sharedInstance().setCategory(.playback)
        try? AVAudioSession.sharedInstance().setActive(true)

        player.replaceCurrentItem(with: AVPlayerItem(url: videoURL))
        observer = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.25, preferredTimescale: 600),
            queue: .main
        ) { time in
            Task { @MainActor in
                currentT = time.seconds
                isPlaying = player.rate > 0
                if duration == 0, let d = player.currentItem?.duration.seconds,
                   d.isFinite, d > 0 {
                    duration = d
                }
            }
        }
        if let startAt { seek(to: startAt) }
        player.play()
    }

    private func togglePlay() {
        if player.rate > 0 {
            player.pause()
            chromeVisible = true
        } else {
            player.play()
        }
        withAnimation(.easeOut(duration: 0.18)) { chromeVisible.toggle() }
        if player.rate > 0 || isPlaying { chromeVisible = true }
    }

    private func seek(to seconds: Double) {
        player.seek(
            to: CMTime(seconds: max(0, seconds), preferredTimescale: 600),
            toleranceBefore: .zero, toleranceAfter: .zero
        )
    }

    /// Double-tap point navigation: seeks to the target's cut_t0 and plays.
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
        seek(to: cutT0)
        player.play()
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

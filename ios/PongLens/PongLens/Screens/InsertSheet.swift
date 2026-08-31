import AVFoundation
import SwiftUI

/// "Add a missing rally" — the card for a rally the cutter dropped.
///
/// IT PLAYS THE RAW UPLOAD, not the cut. The cut video by definition does
/// not contain the missing rally, so the first version of this screen could
/// only grey the gap out and say "this part was cut" — which told the owner
/// the footage was gone when it is not. The original upload is still stored
/// (it is the storage they pay for) and /api/media-url streams it inline for
/// exactly this reason. Against the raw there is no hole: the whole
/// neighbourhood is watchable and the rally being restored can be played.
///
/// THE RAW RUNS ON A DIFFERENT CLOCK. A trimmed upload is cut down before
/// the pipeline sees it, so every t0/t1 in points is measured from
/// trim_start_s into the raw file. The route returns that offset; adding it
/// is what makes the footage the right footage.
///
/// The cut video stays as the fallback for matches whose raw has expired,
/// and only there does the hatched "not available" band appear.
struct InsertSheet: View {
    let match: MatchRow
    let model: MatchDetailModel
    let prev: MatchPoint?
    let next: MatchPoint?
    /// Their numbers in the strip, so this screen reads as the strip does.
    let prevNumber: Int?
    let nextNumber: Int?
    let pad: ClipPad
    var onFinished: ((String) -> Void)?

    private enum SourceKind { case raw, cut }
    private struct Source {
        let kind: SourceKind
        let url: URL
        /// seconds to ADD to a point timestamp to reach this file's clock
        let offset: Double
    }

    @Environment(\.dismiss) private var dismiss
    @State private var player = AVPlayer()
    @State private var win = InsertWindow(t0: 0, t1: 1)
    @State private var playhead: Double = 0
    @State private var winner: Winner?
    @State private var busy = false
    @State private var failed = false
    @State private var loading = true
    @State private var playing = false
    @State private var seam: Seam?
    @State private var source: Source?
    @State private var observer: Any?

    private var themLabel: String { match.opponentName ?? "Them" }

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                if let seam {
                    videoBox(seam)
                    chipsRow
                    playButton
                    track(seam)
                    Text(caption(seam))
                        .font(.system(size: 11))
                        .foregroundStyle(PL.text500)
                        .multilineTextAlignment(.center)
                    winnerPicker
                    Spacer(minLength: 0)
                    addButton(seam)
                } else {
                    Text("Nothing to add here.")
                        .font(.system(size: 13))
                        .foregroundStyle(PL.text500)
                }
            }
            .padding(16)
            .background(PL.ink.ignoresSafeArea())
            .navigationTitle("Add a missing rally")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .task { await load() }
        .onDisappear {
            player.pause()
            if let observer { player.removeTimeObserver(observer) }
        }
    }

    // ------------------------------------------------------------ pieces

    private func canWatch(_ seam: Seam, _ s: Double) -> Bool {
        source?.kind == .raw ? true : playableAt(seam, s)
    }

    @ViewBuilder
    private func videoBox(_ seam: Seam) -> some View {
        ZStack {
            PlayerLayerView(player: player)
                .aspectRatio(16 / 9, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            if loading {
                Text("Loading the footage…")
                    .font(.system(size: 11))
                    .foregroundStyle(PL.text400)
            } else if !canWatch(seam, playhead) {
                // Only reachable on the cut fallback: this match's original
                // upload is gone, so these seconds exist nowhere readable.
                RoundedRectangle(cornerRadius: 12)
                    .fill(PL.ink.opacity(0.78))
                    .overlay(
                        Text("The original video for this match has expired, so this stretch can't be shown. You can still add the rally.")
                            .font(.system(size: 11))
                            .foregroundStyle(PL.text300)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 18)
                    )
            }
        }
    }

    /// What is being done, in the language of the strip you came from: a new
    /// card going in between two you already have.
    private var chipsRow: some View {
        HStack(spacing: 10) {
            neighbourChip(prev, prevNumber)
            HStack(spacing: 6) {
                Text("+")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(PL.cyan)
                    .frame(width: 22, height: 22)
                    .overlay(Circle().strokeBorder(
                        PL.cyan.opacity(0.7),
                        style: StrokeStyle(lineWidth: 1, dash: [3, 3])))
                Text("New card")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(PL.cyan)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .overlay(Capsule().strokeBorder(
                PL.cyan.opacity(0.6),
                style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            neighbourChip(next, nextNumber)
        }
    }

    @ViewBuilder
    private func neighbourChip(_ p: MatchPoint?, _ n: Int?) -> some View {
        if let p, let n {
            let tint: Color = p.confirmedWinner == .user
                ? PL.cyan
                : (p.confirmedWinner == .opponent ? PL.magentaSoft : PL.text500)
            Text("\(n)")
                .font(.system(size: 12, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(tint)
                .frame(width: 32, height: 32)
                .background(Circle().fill(tint.opacity(
                    p.confirmedWinner == nil ? 0.04 : 0.18)))
                .overlay(Circle().strokeBorder(tint.opacity(0.7), lineWidth: 1.5))
        } else {
            Color.clear.frame(width: 32, height: 32)
        }
    }

    private var playButton: some View {
        Button {
            togglePlay()
        } label: {
            Text(playing ? "Pause" : "Play this rally")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(PL.text200)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(source == nil)
        .opacity(source == nil ? 0.4 : 1)
    }

    private func pct(_ seam: Seam, _ s: Double) -> Double {
        let span = seam.to - seam.from
        guard span > 0 else { return 0 }
        return min(1, max(0, (s - seam.from) / span))
    }

    @ViewBuilder
    private func track(_ seam: Seam) -> some View {
        GeometryReader { geo in
            let w = geo.size.width
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 8)
                    .fill(PL.surface2.opacity(0.5))
                ForEach(Array([seam.prev, seam.next].compactMap { $0 }.enumerated()),
                        id: \.offset) { _, sp in
                    RoundedRectangle(cornerRadius: 3)
                        .fill(PL.text600.opacity(0.55))
                        .frame(
                            width: max(2, (pct(seam, sp.t1) - pct(seam, sp.t0)) * w),
                            height: 12)
                        .offset(x: pct(seam, sp.t0) * w, y: 6)
                }
                if missingInside(seam) > 0.25 {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(PL.warningText.opacity(0.12))
                        .overlay(RoundedRectangle(cornerRadius: 3)
                            .strokeBorder(PL.warningText.opacity(0.45), lineWidth: 1))
                        .frame(
                            width: max(2, (pct(seam, seam.gapTo) - pct(seam, seam.gapFrom)) * w),
                            height: 12)
                        .offset(x: pct(seam, seam.gapFrom) * w, y: 6)
                }
                RoundedRectangle(cornerRadius: 4)
                    .fill(PL.cyan.opacity(0.25))
                    .overlay(RoundedRectangle(cornerRadius: 4)
                        .strokeBorder(PL.cyan.opacity(0.8), lineWidth: 1))
                    .frame(
                        width: max(3, (pct(seam, win.t1) - pct(seam, win.t0)) * w),
                        height: 22)
                    .offset(x: pct(seam, win.t0) * w, y: 24)
                handle(seam, edge: .start, width: w)
                handle(seam, edge: .end, width: w)
                Rectangle()
                    .fill(.white.opacity(0.7))
                    .frame(width: 1, height: 52)
                    .offset(x: pct(seam, playhead) * w)
            }
        }
        .frame(height: 52)
    }

    @ViewBuilder
    private func handle(_ seam: Seam, edge: InsertEdge, width: CGFloat) -> some View {
        let at = edge == .start ? win.t0 : win.t1
        Capsule()
            .fill(PL.cyan)
            .frame(width: 4, height: 30)
            // Drawn thin, dragged wide: the finger gets a 36pt target, the
            // same as the chips in the strip behind this sheet.
            .frame(width: 36, height: 40)
            .contentShape(Rectangle())
            .offset(x: pct(seam, at) * width - 18, y: 18)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { g in
                        player.pause()
                        let frac = min(1, max(0, g.location.x / max(1, width)))
                        let s = seam.from + frac * (seam.to - seam.from)
                        win = moveInsertHandle(seam, win, edge: edge, to: s)
                        seek(seam, s)
                    }
            )
            .accessibilityLabel(edge == .start
                ? "Drag where the rally starts"
                : "Drag where the rally ends")
    }

    private var winnerPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Who won it?")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(PL.text200)
            HStack(spacing: 8) {
                // Skip is deliberately absent: a skipped card does not
                // advance the rotation, so it would fix nothing.
                choice(nil, "Not sure yet", PL.text300)
                choice(.user, "Me", PL.cyan)
                choice(.opponent, themLabel, PL.magentaSoft)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func choice(_ v: Winner?, _ label: String, _ tint: Color) -> some View {
        Button { winner = v } label: {
            Text(label)
                .font(.system(size: 13, weight: .semibold))
                .lineLimit(1)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: 10)
                        .fill(winner == v ? tint.opacity(0.16) : PL.surface2.opacity(0.4)))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .strokeBorder(winner == v ? tint.opacity(0.7) : PL.edge,
                                      lineWidth: 1))
                .foregroundStyle(winner == v ? tint : PL.text400)
        }
        .buttonStyle(.plain)
    }

    private func missingInside(_ seam: Seam) -> Double {
        if source?.kind == .raw || seam.continuous { return 0 }
        return max(0, min(win.t1, seam.gapTo) - max(win.t0, seam.gapFrom))
    }

    private func caption(_ seam: Seam) -> String {
        let len = win.t1 - win.t0
        let missing = missingInside(seam)
        let head = missing > 0.25
            ? String(format: "%.1fs · %.0fs not available", len, missing)
            : String(format: "%.1fs", len)
        return head + " · drag the handles to where the rally starts and ends"
    }

    @ViewBuilder
    private func addButton(_ seam: Seam) -> some View {
        VStack(spacing: 6) {
            if failed {
                Text("Couldn't add that rally. Try again.")
                    .font(.system(size: 11))
                    .foregroundStyle(PL.dangerText)
            }
            Button {
                Task { await add(seam) }
            } label: {
                Text(busy ? "Adding…" : "Add card")
                    .font(.system(size: 15, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
            }
            .buttonStyle(.plain)
            .background(RoundedRectangle(cornerRadius: 12).fill(PL.cyan.opacity(0.16)))
            .overlay(RoundedRectangle(cornerRadius: 12)
                .strokeBorder(PL.cyan.opacity(0.65), lineWidth: 1))
            .foregroundStyle(PL.cyan)
            .opacity(busy ? 0.5 : 1)
            .disabled(busy)
        }
    }

    // ------------------------------------------------------------- work

    /// A point timestamp, in the seconds of whichever file is loaded.
    private func videoTime(_ seam: Seam, _ s: Double) -> Double {
        guard let source else { return 0 }
        return source.kind == .raw ? s + source.offset : sourceToCut(seam, s)
    }

    private func seek(_ seam: Seam, _ s: Double) {
        playhead = s
        player.seek(
            to: CMTime(seconds: videoTime(seam, s), preferredTimescale: 600),
            toleranceBefore: .zero, toleranceAfter: .zero)
    }

    private func togglePlay() {
        guard let seam else { return }
        if playing {
            player.pause()
            playing = false
            return
        }
        if playhead < win.t0 - 0.05 || playhead > win.t1 - 0.05 {
            seek(seam, win.t0)
        }
        player.play()
        playing = true
    }

    private func load() async {
        let built = seamBetween(
            prev?.insertNeighbour, next?.insertNeighbour, pad: pad)
        seam = built
        guard let built else { loading = false; return }
        win = defaultInsertWindow(built)
        playhead = win.t0

        struct RawReq: Encodable { let matchId: String; let rawPreview: Bool }
        struct RawRes: Decodable {
            let url: String?
            let available: Bool?
            let trimStartS: Double?
        }
        let id = match.id.uuidString.lowercased()
        if let res: RawRes = try? await API.post(
            "api/media-url", RawReq(matchId: id, rawPreview: true)),
           res.available == true, let u = res.url.flatMap(URL.init) {
            source = Source(kind: .raw, url: u, offset: res.trimStartS ?? 0)
        } else {
            struct CutReq: Encodable { let matchId: String; let preview: Bool }
            struct CutRes: Decodable { let url: String? }
            if let res: CutRes = try? await API.post(
                "api/media-url", CutReq(matchId: id, preview: true)),
               let u = res.url.flatMap(URL.init) {
                source = Source(kind: .cut, url: u, offset: 0)
            }
        }
        loading = false
        guard let source else { return }
        player.replaceCurrentItem(with: AVPlayerItem(url: source.url))
        player.isMuted = true
        seek(built, win.t0)
        // Stop at the end of the rally being restored.
        observer = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.1, preferredTimescale: 600),
            queue: .main
        ) { time in
            guard source.kind == .raw else { return }
            let s = time.seconds - source.offset
            playhead = s
            if playing, s >= win.t1 {
                player.pause()
                playing = false
            }
        }
    }

    private func add(_ seam: Seam) async {
        guard !busy else { return }
        busy = true
        failed = false
        player.pause()
        let w = clampInsertWindow(seam, win)
        let ok = await model.runInsert(
            prev: prev, next: next,
            t0: w.t0, t1: w.t1,
            cutT0: insertCutT0(seam, w, pad: pad),
            winner: winner)
        busy = false
        if !ok { failed = true; return }
        onFinished?("Rally added. Serve rotation updated.")
        dismiss()
    }
}

import AVFoundation
import SwiftUI

/// "Add a missing rally" — the card for a rally the cutter dropped.
///
/// Its own sheet rather than a fourth tab in ModifySheet, mirroring the
/// web's InsertPoint. Every other clip surface works in CUT seconds,
/// because within one point's span the cut keeps source duration intact.
/// Across a SEAM that stops holding: the cutter removed footage, so the cut
/// jumps while the source runs on. This timeline is drawn on SOURCE seconds
/// and mapped into the cut for playback.
///
/// The picture is the point: the rally before, the hole, the rally after,
/// and the new card over all three. Dragging a handle outwards visibly
/// takes footage from a neighbour, which is what a badly cut match needs —
/// a missing rally is often smeared across its neighbours rather than
/// sitting cleanly in a gap.
struct InsertSheet: View {
    let match: MatchRow
    let model: MatchDetailModel
    let prev: MatchPoint?
    let next: MatchPoint?
    let pad: ClipPad
    var onFinished: ((String) -> Void)?

    @Environment(\.dismiss) private var dismiss
    @State private var player = AVPlayer()
    @State private var win = InsertWindow(t0: 0, t1: 1)
    @State private var playhead: Double = 0
    @State private var winner: Winner?
    @State private var busy = false
    @State private var failed = false
    @State private var seam: Seam?

    private var themLabel: String { match.opponentName ?? "Them" }

    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                if let seam {
                    videoBox(seam)
                    track(seam)
                    Text(caption(seam))
                        .font(.system(size: 11))
                        .foregroundStyle(PL.text500)
                    Text("Drag the handles over the rally that is missing. Reaching into a neighbouring rally takes that footage from it.")
                        .font(.system(size: 11))
                        .foregroundStyle(PL.text500)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 8)
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
    }

    // ------------------------------------------------------------ pieces

    @ViewBuilder
    private func videoBox(_ seam: Seam) -> some View {
        ZStack {
            PlayerLayerView(player: player)
                .aspectRatio(16 / 9, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            if !playableAt(seam, playhead) {
                // The honest state: the cutter removed this stretch, so
                // there is no frame to show. Saying so beats freezing on a
                // frame that looks like the wrong moment.
                RoundedRectangle(cornerRadius: 12)
                    .fill(PL.ink.opacity(0.78))
                    .overlay(
                        Text("This part was cut from the video. You can still add the rally here.")
                            .font(.system(size: 11))
                            .foregroundStyle(PL.text300)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 18)
                    )
            }
        }
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
                            height: 14)
                        .offset(x: pct(seam, sp.t0) * w, y: 8)
                }
                if !seam.continuous {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(PL.warningText.opacity(0.12))
                        .overlay(RoundedRectangle(cornerRadius: 3)
                            .strokeBorder(PL.warningText.opacity(0.45), lineWidth: 1))
                        .frame(
                            width: max(2, (pct(seam, seam.gapTo) - pct(seam, seam.gapFrom)) * w),
                            height: 14)
                        .offset(x: pct(seam, seam.gapFrom) * w, y: 8)
                }
                RoundedRectangle(cornerRadius: 4)
                    .fill(PL.cyan.opacity(0.25))
                    .overlay(RoundedRectangle(cornerRadius: 4)
                        .strokeBorder(PL.cyan.opacity(0.8), lineWidth: 1))
                    .frame(
                        width: max(3, (pct(seam, win.t1) - pct(seam, win.t0)) * w),
                        height: 26)
                    .offset(x: pct(seam, win.t0) * w, y: 30)
                handle(seam, edge: .start, width: w)
                handle(seam, edge: .end, width: w)
                Rectangle()
                    .fill(.white.opacity(0.7))
                    .frame(width: 1, height: 62)
                    .offset(x: pct(seam, playhead) * w)
            }
        }
        .frame(height: 62)
    }

    @ViewBuilder
    private func handle(_ seam: Seam, edge: InsertEdge, width: CGFloat) -> some View {
        let at = edge == .start ? win.t0 : win.t1
        Capsule()
            .fill(PL.cyan)
            .frame(width: 4, height: 34)
            // Drawn thin, dragged wide: the finger gets a 36pt target, the
            // same as the chips in the strip behind this sheet.
            .frame(width: 36, height: 44)
            .contentShape(Rectangle())
            .offset(x: pct(seam, at) * width - 18, y: 24)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { g in
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
                // advance the rotation, so it would hand back a card that
                // fixes nothing. "Not sure yet" leaves it unscored, which
                // still fixes the rotation, and Keep score asks later.
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

    private func caption(_ seam: Seam) -> String {
        let len = win.t1 - win.t0
        let missing = seam.continuous ? 0 : max(
            0, min(win.t1, seam.gapTo) - max(win.t0, seam.gapFrom))
        if missing > 0.25 {
            return String(format: "%.1fs rally · %.0fs not in this video", len, missing)
        }
        return String(format: "%.1fs rally", len)
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

    private func seek(_ seam: Seam, _ s: Double) {
        playhead = s
        player.seek(
            to: CMTime(seconds: sourceToCut(seam, s), preferredTimescale: 600),
            toleranceBefore: .zero, toleranceAfter: .zero)
    }

    private func load() async {
        let built = seamBetween(
            prev?.insertNeighbour, next?.insertNeighbour, pad: pad)
        seam = built
        guard let built else { return }
        win = defaultInsertWindow(built)
        playhead = built.gapFrom
        struct Req: Encodable { let matchId: String; let preview: Bool }
        struct Res: Decodable { let url: String? }
        let res: Res? = try? await API.post(
            "api/media-url",
            Req(matchId: match.id.uuidString.lowercased(), preview: true))
        guard let url = res?.url.flatMap(URL.init) else { return }
        player.replaceCurrentItem(with: AVPlayerItem(url: url))
        player.isMuted = true
        seek(built, built.gapFrom)
    }

    private func add(_ seam: Seam) async {
        guard !busy else { return }
        busy = true
        failed = false
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

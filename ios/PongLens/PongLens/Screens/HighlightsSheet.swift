import AVFoundation
import SwiftUI

/// The match's automatic highlights: two cuts, watched full screen, shared
/// from the player.
///
/// The hierarchy (Adil, 2026-08-25): a SHORT highlight and a LONG one,
/// each named with its own rally count so the two never blur together.
/// Tapping one opens the full-screen tape — ClipPlayerView, the same
/// player every clip surface uses, so pinch zoom, speed and their
/// persistence arrive without being written twice. Sharing and saving
/// live INSIDE the player, after watching, the same shape as sharing a
/// single rally.
///
/// Nothing here re-decides anything: Core/Highlights.swift picks the
/// rallies (parity-tested against the server's picker), and the share
/// actions ride the same render pipeline as every other vertical.
struct HighlightsSheet: View {
    let match: MatchRow
    /// The match's visible points in timeline order (model.visible).
    let points: [MatchPoint]

    static var detentHeight: CGFloat { 330 }

    @State private var playCut: HighlightCut?

    private var pad: ClipPad {
        clipPad(strictness: nil, stored: match.clipPads)
    }
    private var reel: Highlights.Picks {
        Highlights.pick(points, pad: pad, budgetS: Highlights.reelBudgetS)
    }
    private var long: Highlights.Picks {
        Highlights.pick(points, pad: pad, budgetS: Highlights.longBudgetS)
    }
    /// The long cut earns its row only when it actually shows more.
    private var longWorthIt: Bool {
        long.totalS > reel.totalS + 1
    }

    var body: some View {
        PLChooserSheet(title: "Highlights") {
            if reel.points.isEmpty {
                Text("No rallies to pick from yet.")
                    .font(.plBody)
                    .foregroundStyle(PL.text500)
            } else {
                PLChooserRow(
                    icon: "play.fill",
                    title: "Short highlight",
                    detail: (Highlights.summary(reel) ?? "")
                        + ". Your best rallies, inside a minute."
                ) {
                    playCut = HighlightCut(kind: .short)
                }
                if longWorthIt {
                    PLChooserRow(
                        icon: "play.fill",
                        title: "Long highlight",
                        detail: (Highlights.summary(long) ?? "")
                            + ". More of the match."
                    ) {
                        playCut = HighlightCut(kind: .long)
                    }
                }
            }
        }
        .fullScreenCover(item: $playCut) { cut in
            HighlightsPlayerScreen(
                match: match,
                points: points,
                kind: cut.kind,
                picks: cut.kind == .short ? reel.points : long.points
            )
        }
    }
}

struct HighlightCut: Identifiable {
    enum Kind { case short, long }
    let kind: Kind
    var id: Bool { kind == .short }
}

// MARK: - The tape

/// One cut, played back to back — ClipPlayerView over the picked rallies,
/// with Share at the bottom once you have seen it.
struct HighlightsPlayerScreen: View {
    let match: MatchRow
    /// All visible points, for the picker the share sheet re-runs.
    let points: [MatchPoint]
    let kind: HighlightCut.Kind
    let picks: [MatchPoint]

    @Environment(\.dismiss) private var dismiss
    @State private var index = 0
    @State private var player = AVPlayer()
    @State private var url: URL?
    @State private var failed = false
    @State private var loadSeq = 0
    @State private var shareOpen = false

    private var point: MatchPoint? {
        picks.indices.contains(index) ? picks[index] : nil
    }
    private var title: String {
        kind == .short ? "Short highlight" : "Long highlight"
    }

    var body: some View {
        ZStack {
            PL.ink.ignoresSafeArea()
            if let point {
                VStack(spacing: 0) {
                    header
                    Spacer(minLength: 0)
                    picture(point)
                    Spacer(minLength: 0)
                    bottomBar
                }
            } else {
                ProgressView().tint(PL.cyan)
            }
        }
        .task(id: point?.id) { await load() }
        .onDisappear { player.pause() }
        .sheet(isPresented: $shareOpen) {
            HighlightsShareSheet(match: match, points: points, kind: kind)
                .presentationDetents([.height(HighlightsShareSheet.detentHeight(kind))])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(PL.text100)
                Text("\(index + 1) of \(picks.count)")
                    .font(.plCaption)
                    .monospacedDigit()
                    .foregroundStyle(PL.text500)
            }
            Spacer(minLength: 0)
            Button {
                player.pause()
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PL.text300)
                    .frame(width: 34, height: 34)
                    .background(PL.surface, in: Circle())
                    .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")
        }
        .padding(.horizontal, 20)
        .padding(.top, 10)
        .padding(.bottom, 16)
    }

    @ViewBuilder
    private func picture(_ point: MatchPoint) -> some View {
        if url != nil || !failed {
            ClipPlayerView(
                player: player,
                url: url,
                starred: point.starred,
                tagged: false,
                updating: false,
                hasPrev: index > 0,
                hasNext: index < picks.count - 1,
                canEdit: false,
                showTag: false,
                onStar: {},
                onTag: {},
                onPrev: { go(index - 1) },
                onNext: { go(index + 1) },
                onEnded: {
                    if index < picks.count - 1 { go(index + 1) }
                }
            )
            .padding(.horizontal, 12)
        } else {
            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                .fill(Color.black)
                .aspectRatio(16 / 9, contentMode: .fit)
                .overlay(
                    Text("Couldn't load this clip.")
                        .font(.plBody)
                        .foregroundStyle(PL.text500)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                        .strokeBorder(PL.edge, lineWidth: 1)
                )
                .padding(.horizontal, 12)
        }
    }

    private var bottomBar: some View {
        Button("Share") {
            player.pause()
            shareOpen = true
        }
        .buttonStyle(PLSecondaryButtonStyle())
        .padding(.top, 18)
        .padding(.bottom, 8)
    }

    private func go(_ next: Int) {
        guard picks.indices.contains(next) else { return }
        index = next
    }

    private func load() async {
        guard let point else { return }
        let mine = loadSeq + 1
        loadSeq = mine
        url = nil
        failed = false
        guard point.hasClip else {
            failed = true
            return
        }
        let link = await ClipLinks.url(matchId: match.id, pointId: point.id)
        guard loadSeq == mine else { return }
        if let link {
            url = link
        } else {
            failed = true
        }
        // Read one ahead: a six second rally does not leave time to notice
        // a round trip, so the round trip happens during the rally before.
        if let next = picks[safe: index + 1], next.hasClip {
            _ = await ClipLinks.url(matchId: match.id, pointId: next.id)
        }
    }
}

// MARK: - Sharing a cut

/// What Share offers for the cut being watched — the SharePointSheet
/// shape, applied to a highlight. The short cut can leave for Instagram;
/// the long one runs past Instagram's minute and is for saving.
struct HighlightsShareSheet: View {
    let match: MatchRow
    let points: [MatchPoint]
    let kind: HighlightCut.Kind

    static func detentHeight(_ kind: HighlightCut.Kind) -> CGFloat {
        kind == .short && InstagramShare.isAvailable(.reel) ? 470 : 330
    }

    @Environment(\.dismiss) private var dismiss
    @State private var model = StoryShareModel()
    @State private var shareItem: URL?
    /// The emergency switch (136); an unreadable row answers "on".
    @State private var sharingOn = true
    /// Which row is working, so only it animates.
    @State private var busyAction: String?
    @AppStorage("shareShowNames") private var showNames = true
    @AppStorage("shareShowScore") private var showScore = true

    private var story: Highlights.Picks {
        Highlights.pick(points,
                        pad: clipPad(strictness: nil, stored: match.clipPads),
                        budgetS: Highlights.storyBudgetS)
    }

    var body: some View {
        PLChooserSheet(title: "Share this highlight") {
            if kind == .short {
                if sharingOn, !story.points.isEmpty,
                   InstagramShare.isAvailable(.story) {
                    PLChooserRow(
                        icon: "camera.aperture",
                        title: busyAction == "story"
                            ? "Preparing…" : "Instagram Story",
                        detail: busyAction == "story"
                            ? model.progressLine : storyDetail,
                        pending: model.busy && busyAction != "story",
                        busy: busyAction == "story"
                    ) {
                        Task { await run("story", to: .story) }
                    }
                }
                if sharingOn, InstagramShare.isAvailable(.reel) {
                    PLChooserRow(
                        icon: "camera.aperture",
                        title: busyAction == "reel"
                            ? "Preparing…" : "Instagram Reel",
                        detail: busyAction == "reel"
                            ? model.progressLine
                            : "This highlight as one vertical video. "
                                + "Opens Instagram ready to post.",
                        pending: model.busy && busyAction != "reel",
                        busy: busyAction == "reel"
                    ) {
                        Task { await run("reel", to: .reel) }
                    }
                }
            }
            PLChooserRow(
                icon: "square.and.arrow.down",
                title: busyAction == "save"
                    ? "Preparing…" : "Save the video",
                detail: busyAction == "save"
                    ? model.progressLine
                    : "This highlight as one vertical video, "
                        + "to save or send anywhere.",
                pending: model.busy && busyAction != "save",
                busy: busyAction == "save"
            ) {
                Task { await run(kind == .short ? "reel" : "long",
                                 to: nil, action: "save") }
            }

            Toggle("Include names", isOn: $showNames)
                .font(.plBody)
                .foregroundStyle(PL.text200)
                .tint(PL.cyan.opacity(0.5))
                .padding(.top, 4)
            Toggle("Include score", isOn: $showScore)
                .font(.plBody)
                .foregroundStyle(PL.text200)
                .tint(PL.cyan.opacity(0.5))

            if let message = model.errorMessage {
                Text(message)
                    .font(.plCaption)
                    .foregroundStyle(PL.dangerText)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            }
        }
        .sheet(item: $shareItem) { url in
            ActivityView(items: [url])
                .presentationDetents([.medium])
        }
        .task { sharingOn = await StoryShareModel.sharingEnabled() }
    }

    private var storyDetail: String {
        let n = story.points.count
        let s = Int(story.totalS.rounded())
        return n == 1
            ? "Your best rally, \(s) seconds. Opens Instagram ready to post."
            : "Your best \(n) rallies, \(s) seconds. Opens Instagram ready to post."
    }

    private func run(_ apiKind: String,
                     to destination: InstagramShare.Destination?,
                     action: String? = nil) async {
        busyAction = action ?? apiKind
        defer { busyAction = nil }
        guard let url = await model.prepareAuto(
            match: match, kind: apiKind,
            showNames: showNames, showScore: showScore)
        else { return }
        if let destination {
            do {
                try InstagramShare.share(url, to: destination)
                dismiss()
            } catch {
                model.errorMessage = error.localizedDescription
            }
        } else {
            shareItem = url
        }
    }
}

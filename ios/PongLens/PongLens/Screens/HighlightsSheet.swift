import SwiftUI

/// The match's automatic highlights: two cuts, watched in the real watch
/// player, shared from inside it.
///
/// The hierarchy (Adil, 2026-08-25): a SHORT highlight and a LONG one,
/// each named with its own rally count so the two never blur together.
/// Tapping one opens PlayerTakeover in highlights mode — the full watch
/// experience the app already has (seeker, pause, zoom, rotate, the
/// prev/next flanks, landscape) playing only the picked rallies, with a
/// Share pill in its chrome. No second player interface.
///
/// Nothing here re-decides anything: Core/Highlights.swift picks the
/// rallies (parity-tested against the server's picker), and the share
/// actions ride the same render pipeline as every other vertical.
struct HighlightsSheet: View {
    let match: MatchRow
    let model: MatchDetailModel

    static var detentHeight: CGFloat { 330 }

    @State private var playCut: HighlightCut?
    @Environment(AppState.self) private var app

    private var pad: ClipPad {
        clipPad(strictness: nil, stored: match.clipPads)
    }
    private var reel: Highlights.Picks {
        Highlights.pick(model.visible, pad: pad, budgetS: Highlights.reelBudgetS,
                        tapEnd: app.tapEndPlayback)
    }
    private var long: Highlights.Picks {
        Highlights.pick(model.visible, pad: pad, budgetS: Highlights.longBudgetS,
                        tapEnd: app.tapEndPlayback)
    }
    /// The long cut earns its row only when it actually shows more.
    private var longWorthIt: Bool {
        long.totalS > reel.totalS + 1
    }

    var body: some View {
        PLChooserSheet(title: "Highlights") {
            if reel.points.isEmpty || model.videoURL == nil {
                Text("No rallies to pick from yet.")
                    .font(.plBody)
                    .foregroundStyle(PL.text500)
            } else {
                PLChooserRow(
                    icon: "play.fill",
                    title: "Short highlight",
                    detail: Highlights.summary(reel) ?? ""
                ) {
                    playCut = HighlightCut(kind: .short)
                }
                if longWorthIt {
                    PLChooserRow(
                        icon: "play.fill",
                        title: "Long highlight",
                        detail: Highlights.summary(long) ?? ""
                    ) {
                        playCut = HighlightCut(kind: .long)
                    }
                }
            }
        }
        .fullScreenCover(item: $playCut) { cut in
            if let url = model.videoURL {
                HighlightsTakeover(
                    match: match,
                    model: model,
                    pad: pad,
                    videoURL: url,
                    kind: cut.kind,
                    picks: cut.kind == .short ? reel.points : long.points
                )
            }
        }
    }
}

struct HighlightCut: Identifiable {
    enum Kind { case short, long }
    let kind: Kind
    var id: Bool { kind == .short }
}

/// The watch player in highlights mode, plus the share sheet its Share
/// pill opens. A wrapper rather than state inside PlayerTakeover, so the
/// takeover stays a player and sharing stays this feature's business.
private struct HighlightsTakeover: View {
    let match: MatchRow
    let model: MatchDetailModel
    let pad: ClipPad
    let videoURL: URL
    let kind: HighlightCut.Kind
    let picks: [MatchPoint]

    @State private var shareOpen = false

    var body: some View {
        PlayerTakeover(
            match: match,
            model: model,
            pad: pad,
            videoURL: videoURL,
            startAt: picks.first?.cutT0,
            mode: .watch,
            highlightPicks: picks,
            onShareHighlight: { shareOpen = true }
        )
        .sheet(isPresented: $shareOpen) {
            HighlightsShareSheet(match: match, points: model.visible, kind: kind)
                .presentationDetents([.height(HighlightsShareSheet.detentHeight)])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
    }
}

// MARK: - Sharing a cut

/// What Share offers: Instagram Story, Instagram Reel, Save the video.
/// The Instagram rows always render their own fitting cut (a Story takes
/// 20 seconds, a Reel a minute); Save renders the cut being watched. The
/// rows are always offered — a phone without Instagram is told so on tap
/// rather than shown a sheet with the whole point of the feature missing.
struct HighlightsShareSheet: View {
    let match: MatchRow
    let points: [MatchPoint]
    let kind: HighlightCut.Kind

    static var detentHeight: CGFloat { 470 }

    @Environment(\.dismiss) private var dismiss
    @State private var model = StoryShareModel()
    @State private var shareItem: URL?
    /// The emergency switch (136); an unreadable row answers "on".
    @State private var sharingOn = true
    @Environment(AppState.self) private var app
    /// Which row is working, so only it animates.
    @State private var busyAction: String?
    @AppStorage("shareShowNames") private var showNames = true
    @AppStorage("shareShowScore") private var showScore = true
    @AppStorage("shareShowLogo") private var showLogo = true

    private var story: Highlights.Picks {
        Highlights.pick(points,
                        pad: clipPad(strictness: nil, stored: match.clipPads),
                        budgetS: Highlights.storyBudgetS,
                        tapEnd: app.tapEndPlayback)
    }

    var body: some View {
        PLChooserSheet(title: "Share this highlight") {
            if sharingOn, !story.points.isEmpty {
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
            if sharingOn {
                PLChooserRow(
                    icon: "camera.aperture",
                    title: busyAction == "reel"
                        ? "Preparing…" : "Instagram Reel",
                    detail: busyAction == "reel"
                        ? model.progressLine
                        : "Your best rallies inside a minute. "
                            + "Opens Instagram ready to post.",
                    pending: model.busy && busyAction != "reel",
                    busy: busyAction == "reel"
                ) {
                    Task { await run("reel", to: .reel) }
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
            Toggle("Include logo", isOn: $showLogo)
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
        if let destination, !InstagramShare.isAvailable(destination) {
            model.errorMessage = InstagramShare.ShareError
                .notInstalled.errorDescription
            return
        }
        guard let url = await model.prepareAuto(
            match: match, kind: apiKind,
            showNames: showNames, showScore: showScore,
            showLogo: showLogo)
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

import SwiftUI

/// One worker-rendered highlight video. Rally membership and timing come
/// from the server manifest; the phone never recreates the selection rule.
struct HighlightsSheet: View {
    let match: MatchRow
    let model: MatchDetailModel

    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @State private var response: AutomaticHighlightsResponse?
    @State private var playing = false

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            PLChooserSheet(title: "Highlights") {
                switch response?.status {
                case "ready":
                    if hasActions {
                        AutomaticHighlightActions(
                            match: match,
                            includePlay: true,
                            playDetail: response?.summary ?? "",
                            onPlay: { playing = true }
                        )
                    } else {
                        stateText("Highlights unavailable")
                    }
                case "empty", "unavailable":
                    stateText("No highlight rallies")
                case "failed":
                    stateText("Highlights unavailable")
                default:
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small).tint(PL.text300)
                        stateText("Preparing highlights")
                    }
                }
            }
        }
        .scrollBounceBehavior(.basedOnSize)
        .presentationDetents(detents)
        .task(id: match.id) { await loadUntilSettled() }
        .fullScreenCover(isPresented: $playing) {
            if let response, let url = response.url, let manifest = response.manifest {
                HighlightsTakeover(
                    match: match, model: model, videoURL: url, manifest: manifest
                )
            }
        }
    }

    private var hasActions: Bool {
        response?.status == "ready" && response?.url != nil && response?.manifest != nil
    }

    private var detents: Set<PresentationDetent> {
        if hasActions && verticalSizeClass == .compact { return [.large] }
        let height = automaticHighlightsSheetHeight(hasActions: hasActions)
        return [.height(CGFloat(height))]
    }

    private func stateText(_ value: String) -> some View {
        Text(value)
            .font(.plBody)
            .foregroundStyle(PL.text500)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func loadUntilSettled() async {
        while !Task.isCancelled {
            do {
                response = try await API.get(
                    "api/highlights",
                    query: ["matchId": match.id.uuidString.lowercased()]
                )
            } catch {
                response = AutomaticHighlightsResponse(
                    status: "failed", url: nil, durationS: nil, manifest: nil
                )
            }
            guard response?.status == "rendering" else { return }
            try? await Task.sleep(for: .milliseconds(1800))
        }
    }
}

/// The existing match player, but with one continuous highlight AVPlayerItem.
private struct HighlightsTakeover: View {
    let match: MatchRow
    let model: MatchDetailModel
    let videoURL: URL
    let manifest: AutomaticHighlightManifest

    @State private var shareOpen = false

    var body: some View {
        PlayerTakeover(
            match: match,
            model: model,
            pad: clipPad(strictness: nil, stored: match.clipPads),
            videoURL: videoURL,
            startAt: 0,
            mode: .watch,
            source: .cut,
            highlightManifest: manifest,
            onShareHighlight: { shareOpen = true }
        )
        .sheet(isPresented: $shareOpen) {
            HighlightsShareSheet(match: match)
                .presentationDetents([.height(HighlightsShareSheet.detentHeight)])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
    }
}

/// Vertical sharing remains a separate render, but the server derives each
/// duration from the same already-qualified canonical pool.
struct HighlightsShareSheet: View {
    let match: MatchRow

    static var detentHeight: CGFloat { 470 }

    var body: some View {
        PLChooserSheet(title: "Share this highlight") {
            AutomaticHighlightActions(
                match: match,
                includePlay: false,
                playDetail: "",
                onPlay: {}
            )
        }
    }
}

/// One implementation of the automatic-highlight actions, used both before
/// playback and by the player's Share shortcut so the two sheets cannot drift.
private struct AutomaticHighlightActions: View {
    let match: MatchRow
    let includePlay: Bool
    let playDetail: String
    let onPlay: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var model = StoryShareModel()
    @State private var shareItem: URL?
    @State private var sharingOn = true
    @State private var busyAction: String?
    @AppStorage("shareShowNames") private var showNames = true
    @AppStorage("shareShowScore") private var showScore = true
    @AppStorage("shareShowLogo") private var showLogo = true

    var body: some View {
        Group {
            ForEach(
                automaticHighlightActions(
                    includePlay: includePlay, sharingEnabled: sharingOn
                ),
                id: \.self
            ) { action in
                switch action {
                case .play:
                    PLChooserRow(
                        icon: "play.fill",
                        title: "Play highlights",
                        detail: playDetail,
                        action: onPlay
                    )
                case .instagramStory:
                    shareRow(
                        action: "story",
                        title: "Instagram Story",
                        detail: "Your best qualifying rally inside 20 seconds. Opens Instagram ready to post.",
                        destination: .story
                    )
                case .instagramReel:
                    shareRow(
                        action: "reel",
                        title: "Instagram Reel",
                        detail: "Your best qualifying rallies inside a minute. Opens Instagram ready to post.",
                        destination: .reel
                    )
                case .saveVideo:
                    shareRow(
                        action: "save",
                        title: "Save the video",
                        detail: "The full highlight as one video, to save or send anywhere.",
                        destination: nil
                    )
                }
            }

            Toggle("Include names", isOn: $showNames)
                .font(.plBody).foregroundStyle(PL.text200)
                .tint(PL.cyan.opacity(0.5)).padding(.top, 4)
            Toggle("Include score", isOn: $showScore)
                .font(.plBody).foregroundStyle(PL.text200)
                .tint(PL.cyan.opacity(0.5))
            Toggle("Include logo", isOn: $showLogo)
                .font(.plBody).foregroundStyle(PL.text200)
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
            ActivityView(items: [url]).presentationDetents([.medium])
        }
        .task { sharingOn = await StoryShareModel.sharingEnabled() }
    }

    private func shareRow(
        action: String,
        title: String,
        detail: String,
        destination: InstagramShare.Destination?
    ) -> some View {
        PLChooserRow(
            icon: destination == nil ? "square.and.arrow.down" : "camera.aperture",
            title: busyAction == action ? "Preparing…" : title,
            detail: busyAction == action ? model.progressLine : detail,
            pending: model.busy && busyAction != action,
            busy: busyAction == action
        ) {
            Task { await run(action, to: destination) }
        }
    }

    private func run(
        _ action: String, to destination: InstagramShare.Destination?
    ) async {
        busyAction = action
        defer { busyAction = nil }
        if let destination, !InstagramShare.isAvailable(destination) {
            model.errorMessage = InstagramShare.ShareError.notInstalled.errorDescription
            return
        }
        let kind = action == "save" ? "long" : action
        guard let url = await model.prepareAuto(
            match: match, kind: kind,
            showNames: showNames, showScore: showScore, showLogo: showLogo
        ) else { return }
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

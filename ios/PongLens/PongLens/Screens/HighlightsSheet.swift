import SwiftUI

/// One worker-rendered highlight video. Rally membership and timing come
/// from the server manifest; the phone never recreates the selection rule.
struct HighlightsSheet: View {
    let match: MatchRow
    let model: MatchDetailModel
    let scored: Bool
    let onChanged: (AutomaticHighlightsResponse) -> Void
    let onScore: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @State private var response: AutomaticHighlightsResponse?
    @State private var playing = false
    @State private var submitting = false
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let requestView {
                NavigationStack {
                    Form {
                        Section {
                            if requestView.running {
                                HStack(spacing: 10) {
                                    ProgressView().tint(PL.cyan)
                                    Text("Updating rally clips…")
                                        .font(.plBody)
                                        .foregroundStyle(PL.text300)
                                }
                            } else if let actionLabel = requestView.actionLabel {
                                Button(submitting ? "Starting…" : actionLabel) {
                                    if requestView.action == .score {
                                        dismiss()
                                        DispatchQueue.main.async { onScore() }
                                    } else {
                                        Task { await requestUpdate() }
                                    }
                                }
                                .disabled(submitting)
                            }
                            if let errorMessage {
                                Text(errorMessage)
                                    .font(.plCaption)
                                    .foregroundStyle(PL.dangerText)
                            }
                        } footer: {
                            Text(requestView.body)
                        }
                    }
                    .tint(PL.cyan)
                    .navigationTitle(requestView.title)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { dismiss() }
                                .fontWeight(.semibold)
                        }
                    }
                }
                .preferredColorScheme(.dark)
            } else {
                ScrollView(.vertical, showsIndicators: false) {
                    PLChooserSheet(title: "Highlights") {
                        switch response?.status {
                        case "ready":
                            if hasActions {
                                AutomaticHighlightActions(
                                    match: match,
                                    starredCount: model.visible.filter(\.starred).count,
                                    scored: scored,
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
            }
        }
        .presentationDetents(detents)
        .task(id: match.id) { await loadUntilSettled() }
        .fullScreenCover(isPresented: $playing) {
            if let response, let url = response.url, let manifest = response.manifest {
                HighlightsTakeover(
                    match: match, model: model, scored: scored,
                    videoURL: url, manifest: manifest
                )
            }
        }
    }

    private var hasActions: Bool {
        response?.status == "ready" && response?.url != nil && response?.manifest != nil
    }

    private var requestView: AutomaticHighlightsRequestView? {
        response.flatMap { automaticHighlightsRequestView(response: $0) }
    }

    private var detents: Set<PresentationDetent> {
        if requestView != nil { return [.medium] }
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
            if let response { onChanged(response) }
            guard response?.status == "rendering" || response?.status == "updating" else {
                return
            }
            try? await Task.sleep(for: .milliseconds(1800))
        }
    }

    private func requestUpdate() async {
        submitting = true
        errorMessage = nil
        struct Req: Encodable { let matchId: String }
        do {
            let next: AutomaticHighlightsResponse = try await API.post(
                "api/highlights",
                Req(matchId: match.id.uuidString.lowercased())
            )
            response = next
            onChanged(next)
            submitting = false
            await loadUntilSettled()
        } catch let APIError.http(_, code) {
            if code == "highlights_current"
                || code == "rally_clips_updating"
                || code == "highlights_score_required" {
                submitting = false
                await loadUntilSettled()
                return
            }
            errorMessage = code == "render_queue_full"
                ? "Three videos are already being prepared. Try again when one is finished."
                : "Couldn't prepare highlights. Try again."
            submitting = false
        } catch {
            errorMessage = "Couldn't prepare highlights. Try again."
            submitting = false
        }
    }
}

/// The existing match player, but with one continuous highlight AVPlayerItem.
private struct HighlightsTakeover: View {
    let match: MatchRow
    let model: MatchDetailModel
    let scored: Bool
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
            HighlightsShareSheet(
                match: match,
                starredCount: model.visible.filter(\.starred).count,
                scored: scored
            )
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
    let starredCount: Int
    let scored: Bool

    static var detentHeight: CGFloat { 470 }

    var body: some View {
        PLChooserSheet(title: "Share this highlight") {
            AutomaticHighlightActions(
                match: match,
                starredCount: starredCount,
                scored: scored,
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
    let starredCount: Int
    let scored: Bool
    let includePlay: Bool
    let playDetail: String
    let onPlay: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var model = StoryShareModel()
    @State private var shareItem: URL?
    @State private var sharingOn = true
    @State private var busyAction: String?
    @State private var instagramOpen = false
    @State private var linkOpen = false
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
                        pending: busyAction != nil,
                        action: onPlay
                    )
                case .instagram:
                    PLChooserRow(
                        icon: "camera.aperture",
                        title: "Instagram",
                        detail: "Share as a Story or Reel.",
                        pending: busyAction != nil
                    ) {
                        instagramOpen = true
                    }
                case .shareLink:
                    PLChooserRow(
                        icon: "link",
                        title: "Share a link",
                        detail: "Anyone with the link can watch. You can revoke it anytime from your account.",
                        pending: busyAction != nil
                    ) {
                        linkOpen = true
                    }
                case .saveVideo:
                    shareRow(
                        action: "save",
                        title: "Save the video",
                        detail: "The full highlight as one video, to save or send anywhere.",
                        destination: nil
                    )
                }
            }

            Text("Video appearance")
                .font(.plBody)
                .foregroundStyle(PL.text200)
                .padding(.top, 4)
            Text("For Instagram and saved videos.")
                .font(.plCaption)
                .foregroundStyle(PL.text500)

            Toggle("Include names", isOn: $showNames)
                .font(.plBody).foregroundStyle(PL.text200)
                .tint(PL.cyan.opacity(0.5))
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
        .sheet(isPresented: $instagramOpen) {
            PLChooserSheet(title: "Instagram") {
                shareRow(
                    action: "story",
                    title: "Story",
                    detail: "Your best qualifying rally inside 20 seconds.",
                    destination: .story
                )
                shareRow(
                    action: "reel",
                    title: "Reel",
                    detail: "Your best qualifying rallies inside a minute.",
                    destination: .reel
                )
            }
            .presentationDetents([.height(300)])
            .presentationBackground(PL.surface)
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $linkOpen) {
            ShareLinksSheet(
                match: match,
                starredCount: starredCount,
                scored: scored,
                processed: true,
                initialTarget: .highlights,
                highlightsReady: true
            )
            .presentationDetents([.medium, .large])
            .presentationBackground(PL.surface)
            .presentationDragIndicator(.visible)
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
            pending: busyAction != nil && busyAction != action,
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
                instagramOpen = false
                dismiss()
            } catch {
                model.errorMessage = UserFacingError.message(error)
            }
        } else {
            shareItem = url
        }
    }
}

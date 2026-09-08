import SwiftUI

/// The match page's existing media card, shared with its feedback page.
struct MatchVideoHero: View {
    let match: MatchRow
    let videoAvailable: Bool
    let hasOriginal: Bool
    let openingOriginal: Bool
    let onPlay: () -> Void
    let onOriginal: () -> Void
    let onDownload: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Button(action: onPlay) {
                Color.clear
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .overlay(MatchThumb(matchId: match.id))
                    .overlay {
                        if videoAvailable {
                            Circle()
                                .fill(PL.ink.opacity(0.6))
                                .frame(width: 96, height: 96)
                                .overlay(
                                    Image(systemName: "play.fill")
                                        .font(.system(size: 34))
                                        .foregroundStyle(.white)
                                        .offset(x: 3)
                                )
                        }
                    }
                    .clipped()
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!videoAvailable)

            Rectangle().fill(PL.edge).frame(height: 1)

            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(match.status == .ready ? "Full video" : "Original video")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(PL.textBody)
                    Text(match.status == .ready ? "Playtime only" : "As uploaded")
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                }
                Spacer()
                // The uncut upload, for when the cut came out poor. Beside
                // the download rather than in Tools, because Tools is
                // `if isOwner` and a coach looking at a bad cut wants the
                // original for the same reason the player does. Labelled
                // "Original" rather than repeating "Full video", which the
                // caption two inches left already says about the cut.
                if match.status == .ready, hasOriginal {
                    Button(action: onOriginal) {
                        HStack(spacing: 5) {
                            if openingOriginal {
                                ProgressView().controlSize(.mini).tint(PL.text300)
                            } else {
                                Image(systemName: "play.fill")
                                    .font(.system(size: 11, weight: .semibold))
                            }
                            Text("Original")
                                .font(.system(size: 14, weight: .medium))
                        }
                        .foregroundStyle(PL.text300)
                        .padding(.horizontal, 14)
                        .frame(height: 38)
                        .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .disabled(openingOriginal)
                    .accessibilityLabel("Watch the original video")
                }
                if match.status == .ready {
                    Button(action: onDownload) {
                        Image(systemName: "arrow.down.to.line")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(PL.text300)
                            .frame(width: 46, height: 38)
                            .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Download video")
                }
            }
            .padding(16)
        }
        .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                .strokeBorder(PL.edge, lineWidth: 1)
        )
    }
}


/// Private match feedback. Account's public Feedback board keeps its own route.
struct MatchProcessingFeedbackScreen: View {
    let matchId: UUID
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    @State private var model: MatchIssueModel
    @State private var media = MatchDetailModel()
    private var match: MatchRow? { media.currentMatch }
    @State private var playerRequest: MatchDetailScreen.PlayerRequest?
    @State private var openingOriginal = false
    @State private var mediaError: String?

    init(matchId: UUID, client: MatchIssueClient? = nil, mediaClient: MatchDetailClient? = nil) {
        self.matchId = matchId
        _model = State(initialValue: MatchIssueModel(matchId: matchId, client: client))
        _media = State(initialValue: MatchDetailModel(client: mediaClient))
    }

    var body: some View {
        @Bindable var model = model
        ZStack {
            ArenaBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Same route back control as FeedbackScreen and Starred.
                    Button { dismiss() } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 12, weight: .semibold))
                            Text("Back")
                        }
                    }
                    .buttonStyle(PLSecondaryButtonStyle())

                    Text(model.state?.title ?? "Match feedback")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)

                    if let match {
                        let parts = MatchTitle.parts(for: match)
                        HStack(spacing: 12) {
                            MatchThumb(matchId: match.id)
                                .frame(width: 80, height: 48)
                                .clipped()
                            VStack(alignment: .leading, spacing: 4) {
                                Text(parts.primary).font(.plBody).foregroundStyle(PL.text100)
                                Text(parts.secondary).font(.plCaption).foregroundStyle(PL.text500)
                            }
                        }
                    }

                    feedbackCard

                    // The choices precede the existing 16:9 media card on a
                    // phone. A 353pt card is 199pt tall before its controls.
                    if let match, match.cutPath != nil || match.rawPath != nil {
                        MatchVideoHero(
                            match: match, videoAvailable: media.videoURL != nil,
                            hasOriginal: match.rawPath?.hasPrefix("r2://ponglens-raw/") == true,
                            openingOriginal: openingOriginal,
                            onPlay: {
                                if let url = media.videoURL {
                                    playerRequest = .init(url: url, startAt: nil, mode: .watch,
                                                          source: match.status == .ready ? .cut : .original)
                                }
                            },
                            onOriginal: { Task { await openOriginal(match) } },
                            onDownload: {
                                Task { if let url = await media.downloadURL(match) { openURL(url) } }
                            }
                        )
                    }
                    if let mediaError {
                        Text(mediaError).font(.plBody).foregroundStyle(PL.warningText)
                        Button { Task { await loadMatch() } } label: {
                            Text("Try again").frame(maxWidth: .infinity, minHeight: 28)
                        }
                        .buttonStyle(PLSecondaryButtonStyle())
                    }
                }
                .padding(20)
                .padding(.bottom, 60)
            }
            .plKeyboardDismiss()
            .refreshable { await model.load(); await loadMatch() }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task {
            await model.load()
            model.startPolling()
            await loadMatch()
        }
        .onDisappear { model.stopPolling() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await model.load(); model.startPolling(); await loadMatch() }
            } else { model.stopPolling() }
        }
        .onChange(of: model.state?.activeProcessingVersionId) { _, _ in
            Task { await loadMatch() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .matchProcessingVersionChanged)) { notification in
            guard notification.object as? UUID == matchId else { return }
            Task { await model.load(); await loadMatch() }
        }
        .fullScreenCover(item: $playerRequest) { request in
            if let match {
                PlayerTakeover(
                    match: match, model: media, pad: match.clipPads ?? CLIP_PAD["normal"]!,
                    videoURL: request.url, startAt: request.startAt, mode: request.mode, source: request.source
                )
            }
        }
    }

    private var feedbackCard: some View {
        @Bindable var model = model
        return VStack(alignment: .leading, spacing: 16) {
            if let confirmation = model.confirmation {
                Text(confirmation).font(.plBody).foregroundStyle(PL.text300)
                    .accessibilityAddTraits(.updatesFrequently)
            }
            if let state = model.state {
                if let receipt = state.automaticRefundMessage {
                    Text(receipt).font(.plBody).foregroundStyle(PL.text300)
                }
                if let issue = state.activeIssue {
                    if let label = state.statusLabel {
                        Text(label).font(.plCardTitle).foregroundStyle(PL.text100)
                    }
                    if let message = state.statusMessage, message != model.confirmation {
                        Text(message).font(.plBody).foregroundStyle(PL.text300)
                    }
                    if !issue.message.isEmpty {
                        Text(issue.message).font(.plBody).foregroundStyle(PL.text400)
                    }
                    if let note = issue.playerNote, !note.isEmpty, note != state.statusMessage {
                        Text(note).font(.plBody).foregroundStyle(PL.text300)
                    }
                    if state.canCancel {
                        Button { Task { await model.cancel() } } label: {
                            Text("Cancel request").frame(maxWidth: .infinity, minHeight: 28)
                        }
                        .buttonStyle(PLSecondaryButtonStyle())
                        .disabled(model.busy)
                    }
                }

                if !state.choices.isEmpty {
                    if state.choices != [.problem] {
                        ForEach(state.choices) { choice in
                            Button {
                                model.choice = choice
                                model.confirmation = nil
                            } label: {
                                HStack(alignment: .top, spacing: 12) {
                                    Image(systemName: model.selectedChoice == choice ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(model.selectedChoice == choice ? PL.cyan : PL.text500)
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(choice.label(minutes: state.refundableMinutes))
                                            .font(.plBody).foregroundStyle(PL.text100)
                                        Text(choice.detail).font(.plBody).foregroundStyle(PL.text400)
                                    }
                                }
                                .multilineTextAlignment(.leading)
                                .frame(maxWidth: .infinity, minHeight: 28, alignment: .leading)
                            }
                            .buttonStyle(PLSecondaryButtonStyle())
                            .disabled(model.busy)
                            .accessibilityAddTraits(model.selectedChoice == choice ? .isSelected : [])
                        }
                    }

                    if let selected = model.selectedChoice, selected != .positive {
                        Text(state.isOwnerCut ? "What went wrong? (optional)" : "What happened?")
                            .font(.plBody).foregroundStyle(PL.text300)
                        TextField(state.isOwnerCut ? "Tell us what was missed or cut incorrectly." : "Tell us what went wrong.",
                                  text: $model.message, axis: .vertical)
                            .lineLimit(3...8)
                            .font(.plBody)
                            .foregroundStyle(PL.text100)
                            .padding(12)
                            .background(PL.ink, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(PL.edge, lineWidth: 1))
                            .disabled(model.busy)
                            .onChange(of: model.message) { _, value in
                                if value.count > 1000 { model.message = String(value.prefix(1000)) }
                            }
                    }
                    Button { Task { await model.submit() } } label: {
                        Text(model.busy ? "Sending…" : model.selectedChoice?.action ?? "Send feedback")
                            .frame(maxWidth: .infinity, minHeight: 28)
                    }
                    .buttonStyle(PLPrimaryButtonStyle())
                    .disabled(!model.canSubmit)
                }

                if !state.events.isEmpty {
                    Rectangle().fill(PL.edge).frame(height: 1)
                    Text("History").font(.plBody).foregroundStyle(PL.text200)
                    ForEach(state.events) { event in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(event.label).font(.plBody).foregroundStyle(PL.text300)
                            if !event.playerNote.isEmpty {
                                Text(event.playerNote).font(.plBody).foregroundStyle(PL.text400)
                            }
                            if let date = PGDate.parse(event.createdAt) {
                                Text(date, format: .dateTime.month(.abbreviated).day().year().hour().minute())
                                    .font(.plCaption).foregroundStyle(PL.text500)
                            }
                        }
                    }
                }
            } else if model.loadError == nil {
                ProgressView("Loading…").font(.plBody).tint(PL.cyan)
            }
            if let error = model.error {
                Text(error).font(.plBody).foregroundStyle(PL.warningText)
            }
            if let error = model.loadError {
                Text(error).font(.plBody).foregroundStyle(PL.warningText)
                Button { Task { await model.load() } } label: {
                    Text("Try again").frame(maxWidth: .infinity, minHeight: 28)
                }
                .buttonStyle(PLSecondaryButtonStyle())
                .disabled(model.busy)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard()
    }

    private func loadMatch() async {
        // Row and media have one owner. Unrelated refresh adopts metadata
        // without closing playback; a new timeline replaces the whole snapshot.
        if await media.refreshActiveVersion(matchId) != nil { playerRequest = nil }
        guard let fresh = media.currentMatch else {
            mediaError = "Could not load this match. You can try again."
            return
        }
        mediaError = media.error
        if fresh.cutPath != nil || fresh.rawPath != nil, media.videoURL == nil {
            mediaError = "Could not open this video. You can try again."
        }
    }

    private func openOriginal(_ match: MatchRow) async {
        guard !openingOriginal else { return }
        openingOriginal = true
        defer { openingOriginal = false }
        if let url = await media.originalURL(match) {
            playerRequest = .init(url: url, startAt: nil, mode: .watch, source: .original)
        } else {
            mediaError = "Could not open the original video. You can try again."
        }
    }
}

/// The existing Tools row and chevron, with state refreshed even when its
/// match is already ready and ordinary processing polling has stopped.
struct MatchFeedbackLink: View {
    let match: MatchRow
    let isOwner: Bool
    @Environment(\.scenePhase) private var scenePhase
    @State private var model: MatchIssueModel

    init(match: MatchRow, isOwner: Bool) {
        self.match = match
        self.isOwner = isOwner
        _model = State(initialValue: MatchIssueModel(matchId: match.id))
    }

    var body: some View {
        NavigationLink(value: "match-feedback:\(match.id.uuidString.lowercased())") {
            HStack {
                Text(model.state?.rowLabel ?? (!isOwner ? "Report a cut problem" : match.status == .ready ? "How was the cut?" : "Report an issue"))
                    .font(.system(size: 16))
                    .foregroundStyle(PL.textBody)
                Spacer()
                Text(model.state?.rowTrailing ?? (isOwner && match.status == .ready ? "Share feedback" : ""))
                    .font(.plBody)
                    .foregroundStyle(PL.text500)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PL.text600)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .task { await model.load(); model.startPolling() }
        .onDisappear { model.stopPolling() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.load(); model.startPolling() } }
            else { model.stopPolling() }
        }
        .onChange(of: model.state?.activeProcessingVersionId) { _, version in
            guard let version, version != match.activeProcessingVersionId else { return }
            NotificationCenter.default.post(name: .matchProcessingVersionChanged, object: match.id)
        }
    }
}

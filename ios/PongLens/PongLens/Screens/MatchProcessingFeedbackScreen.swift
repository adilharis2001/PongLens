import SwiftUI

/// Private feedback about how a match was processed — Try processing
/// again, Request minutes back, or a plain report when neither applies —
/// and the review that follows.
/// The public Feedback board is a different thing and keeps its own route;
/// the match page offers both, one row each, so an idea or a bug never has
/// to be squeezed into a question about one match's cut.
///
/// One panel, two homes. From the match page it is a sheet raised from the
/// Processing row, like Your side and Match details, because it is a
/// short question and not a destination. It used to be a page that
/// re-drew the match's own video card under the choices, so the cut, the
/// Original button and the download appeared twice, one tap apart; the
/// video it asks about is on the page underneath, so the sheet carries
/// none. A notification about a request deep-links to a page holding the
/// same panel, so the review can be read without the match page under it.
struct MatchIssuePanel: View {
    @Bindable var model: MatchIssueModel
    /// Whether the original upload is still stored; nil until known. Only
    /// read when there is no remedy to offer, to say why.
    var hasOriginal: Bool? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let confirmation = model.confirmation {
                Text(confirmation).font(.plBody).foregroundStyle(PL.text300)
                    .accessibilityAddTraits(.updatesFrequently)
            }
            if let state = model.state {
                if let receipt = state.automaticRefundMessage {
                    Text(receipt).font(.plBody).foregroundStyle(PL.text300)
                }
                if let issue = state.activeIssue {
                    status(issue, state: state)
                }
                if !state.choices.isEmpty {
                    // A coach, or an owner whose match is not ready, has one
                    // thing to say and no choice to make: the note is the
                    // whole form.
                    if state.choices != [.problem] {
                        VStack(spacing: 8) {
                            ForEach(state.choices) { choice in
                                choiceRow(choice, minutes: state.refundableMinutes)
                            }
                        }
                    } else if state.isOwnerCut, hasOriginal == false {
                        // The one reason a processed match has no remedy
                        // that the owner can do nothing about; said plainly
                        // so the missing "Try processing again" is not a
                        // mystery. "No longer stored", never "expired".
                        Text("The original video is no longer stored, so this match cannot be processed again.")
                            .font(.plBody).foregroundStyle(PL.text300)
                    }
                    if let selected = model.selectedChoice, selected != .positive {
                        noteField(for: selected, cut: state.isOwnerCut)
                    }
                    Button { Task { await model.submit() } } label: {
                        Text(model.busy ? "Sending…" : "Send")
                            .frame(maxWidth: .infinity, minHeight: 28)
                    }
                    .buttonStyle(PLPrimaryButtonStyle())
                    .disabled(!model.canSubmit)
                }
                if !state.events.isEmpty {
                    history(state.events)
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
    }

    private func status(_ issue: MatchIssue, state: MatchIssueState) -> some View {
        VStack(alignment: .leading, spacing: 6) {
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
                .padding(.top, 6)
            }
        }
    }

    /// The app's choose-one row (onboarding's level picker): a rounded
    /// field, lit in the accent with a checkmark when chosen. Not the
    /// capsule button style, which turns two lines of text into an oval.
    private func choiceRow(_ choice: MatchIssueChoice, minutes: Int?) -> some View {
        let active = model.selectedChoice == choice
        return Button {
            model.choice = choice
            model.confirmation = nil
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(choice.label(minutes: minutes))
                        .font(.plRowTitle)
                        .foregroundStyle(active ? PL.cyan : PL.text100)
                    Text(choice.detail)
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 8)
                if active {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(PL.cyan)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(
                active ? PL.cyan.opacity(0.08) : PL.ink.opacity(0.4),
                in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                    .strokeBorder(active ? PL.cyan.opacity(0.7) : PL.edge, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(model.busy)
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    /// A report needs words (the server refuses an empty one); a remedy
    /// request does not, so only the request says "optional".
    private func noteField(for choice: MatchIssueChoice, cut: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(choice == .problem
                 ? (cut ? "What went wrong?" : "What happened?")
                 : "What went wrong? (optional)")
                .font(.plBody).foregroundStyle(PL.text300)
            TextField(
                cut ? "Tell us what was missed or cut incorrectly." : "Tell us what went wrong.",
                text: $model.message, axis: .vertical
            )
            .lineLimit(3...8)
            .font(.plBody)
            .foregroundStyle(PL.text100)
            .padding(12)
            .background(PL.ink, in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            )
            .disabled(model.busy)
            .onChange(of: model.message) { _, value in
                if value.count > 1000 { model.message = String(value.prefix(1000)) }
            }
        }
    }

    private func history(_ events: [MatchIssueEvent]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Rectangle().fill(PL.edge).frame(height: 1)
            Text("History").font(.plRowTitle).foregroundStyle(PL.text200)
            ForEach(events) { event in
                VStack(alignment: .leading, spacing: 2) {
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
    }
}

/// The sheet the Processing row raises. Same chrome as Your side: a card
/// title, then the content, on the surface colour.
struct MatchProcessingSheet: View {
    let model: MatchIssueModel
    let hasOriginal: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Processing")
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                MatchIssuePanel(model: model, hasOriginal: hasOriginal)
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .plKeyboardDismiss()
        .task { await model.load() }
    }
}

/// The page a notification about a request opens. Standard page chrome —
/// Back pill, title, the match it is about — around the same panel.
struct MatchProcessingFeedbackScreen: View {
    let matchId: UUID
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var model: MatchIssueModel
    @State private var match: MatchRow?
    private let loadMatch: (UUID) async throws -> MatchRow

    init(matchId: UUID, client: MatchIssueClient? = nil, mediaClient: MatchDetailClient? = nil) {
        self.matchId = matchId
        _model = State(initialValue: MatchIssueModel(matchId: matchId, client: client))
        loadMatch = (mediaClient ?? .live).match
    }

    var body: some View {
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

                    Text("Processing")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)

                    if let match {
                        let parts = MatchTitle.parts(for: match)
                        HStack(spacing: 12) {
                            MatchThumb(matchId: match.id)
                                .frame(width: 80, height: 48)
                                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            VStack(alignment: .leading, spacing: 4) {
                                Text(parts.primary).font(.plBody).foregroundStyle(PL.text100)
                                Text(parts.secondary).font(.plCaption).foregroundStyle(PL.text500)
                            }
                        }
                    }

                    MatchIssuePanel(
                        model: model,
                        hasOriginal: match.map { $0.rawPath?.hasPrefix("r2://ponglens-raw/") == true }
                    )
                    .plCard()
                }
                .padding(20)
                .padding(.bottom, 60)
            }
            .plKeyboardDismiss()
            .refreshable { await model.load() }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task {
            await model.load()
            model.startPolling()
            match = try? await loadMatch(matchId)
        }
        .onDisappear { model.stopPolling() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await model.load(); model.startPolling() }
            } else { model.stopPolling() }
        }
        .onChange(of: model.state?.activeProcessingVersionId) { _, _ in
            Task { match = try? await loadMatch(matchId) }
        }
        .onReceive(NotificationCenter.default.publisher(for: .matchProcessingVersionChanged)) { notification in
            guard notification.object as? UUID == matchId else { return }
            Task { await model.load() }
        }
    }
}

/// The Processing row: in Tools for the owner, under the hero for a coach.
/// Its trailing text is the live state of any request, refreshed even when
/// the match is ready and ordinary processing polling has stopped. The tap
/// raises the sheet; the row's own model goes with it, so the sheet opens
/// on state that is already loaded.
struct ProcessingToolRow: View {
    let match: MatchRow
    @Environment(\.scenePhase) private var scenePhase
    @State private var model: MatchIssueModel
    @State private var open = false

    init(match: MatchRow) {
        self.match = match
        _model = State(initialValue: MatchIssueModel(matchId: match.id))
    }

    var body: some View {
        Button { open = true } label: {
            HStack(spacing: 8) {
                Text("Processing")
                    .font(.system(size: 16))
                    .foregroundStyle(PL.textBody)
                Spacer()
                Text(model.state?.rowTrailing ?? "Report a problem")
                    .font(.plBody)
                    .foregroundStyle(PL.text500)
                    .lineLimit(1)
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
        .sheet(isPresented: $open) {
            MatchProcessingSheet(model: model, hasOriginal: match.rawPath?.hasPrefix("r2://ponglens-raw/") == true)
                .presentationDetents([.medium, .large])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
    }
}

/// The public Feedback board, one row under Processing. Ideas and bugs have
/// nothing to do with how one match was cut, but a match page is where most
/// of them occur to people, so the board opens with this match attached —
/// which is what the row in this slot always did before Processing took it.
struct FeedbackBoardToolRow: View {
    let match: MatchRow

    var body: some View {
        NavigationLink(value: "feedback:\(match.id.uuidString.lowercased())") {
            HStack(spacing: 8) {
                Text("Feedback")
                    .font(.system(size: 16))
                    .foregroundStyle(PL.textBody)
                Spacer()
                Text("Ideas and bugs")
                    .font(.plBody)
                    .foregroundStyle(PL.text500)
                    .lineLimit(1)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PL.text600)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

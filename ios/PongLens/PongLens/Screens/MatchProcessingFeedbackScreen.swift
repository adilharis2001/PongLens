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
///
/// The panel is a run of Form sections, and both homes put it in a Form:
/// the sheet's, and the page's, drawn over the arena. One form, one look,
/// wherever it is read.
struct MatchIssuePanel: View {
    @Bindable var model: MatchIssueModel
    /// Whether the original upload is still stored; nil until known. Only
    /// read when there is no remedy to offer, to say why.
    var hasOriginal: Bool? = nil

    var body: some View {
        // What has already happened: a request just sent, minutes already
        // returned, a request still being looked at.
        if model.confirmation != nil
            || model.state?.automaticRefundMessage != nil
            || model.state?.activeIssue != nil {
            Section {
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
                }
            }
        }
        if let state = model.state {
            if !state.choices.isEmpty {
                // A coach, or an owner whose match is not ready, has one
                // thing to say and no choice to make: the note is the
                // whole form.
                if state.choices != [.problem] {
                    Section {
                        ForEach(state.choices) { choice in
                            PLChoiceRow(
                                title: choice.label(minutes: state.refundableMinutes),
                                detail: choice.detail,
                                selected: model.selectedChoice == choice,
                                disabled: model.busy
                            ) {
                                model.choice = choice
                                model.confirmation = nil
                            }
                        }
                    }
                } else if state.isOwnerCut, hasOriginal == false {
                    // The one reason a processed match has no remedy
                    // that the owner can do nothing about; said plainly
                    // so the missing "Try processing again" is not a
                    // mystery. "No longer stored", never "expired".
                    Section {
                        Text("The original video is no longer stored, so this match cannot be processed again.")
                            .font(.plBody).foregroundStyle(PL.text300)
                    }
                }
                // The note is part of the form from the start, optional
                // beside a request and required for a report, so the
                // sheet reads as one form rather than rows and a button.
                let reportOnly = state.choices == [.problem]
                noteSection(reportOnly: reportOnly, cut: state.isOwnerCut)
                Section {
                    PLSheetActionRow(
                        label: model.busy ? "Sending…" : reportOnly ? "Send report" : "Send request",
                        disabled: !model.canSubmit
                    ) {
                        Task { await model.submit() }
                    }
                }
            }
            if !state.events.isEmpty {
                history(state.events)
            }
        } else if model.loadError == nil {
            Section {
                ProgressView("Loading…").font(.plBody).tint(PL.cyan)
            }
        }
        if let error = model.error {
            Section {
                Text(error).font(.plBody).foregroundStyle(PL.warningText)
            }
        }
        if let error = model.loadError {
            Section {
                Text(error).font(.plBody).foregroundStyle(PL.warningText)
                Button("Try again") { Task { await model.load() } }
                    .disabled(model.busy)
            }
        }
    }

    @ViewBuilder
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
        }
        if state.canCancel {
            Button("Cancel request") { Task { await model.cancel() } }
                .foregroundStyle(PL.text300)
                .disabled(model.busy)
        }
    }

    /// A report needs words (the server refuses an empty one); a remedy
    /// request does not, so only the request says "optional".
    private func noteSection(reportOnly: Bool, cut: Bool) -> some View {
        Section {
            TextField(
                cut ? "Rallies that were missed, or cut at the wrong time." : "Tell us what went wrong.",
                text: $model.message, axis: .vertical
            )
            .lineLimit(3...8)
            .disabled(model.busy)
            .onChange(of: model.message) { _, value in
                if value.count > 1000 { model.message = String(value.prefix(1000)) }
            }
        } header: {
            Text(reportOnly
                 ? (cut ? "What went wrong?" : "What happened?")
                 : "What went wrong? (optional)")
        }
    }

    private func history(_ events: [MatchIssueEvent]) -> some View {
        Section {
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
        } header: {
            Text("History")
        }
    }
}

/// The sheet the Processing row raises, dressed like every other sheet
/// off the Tools list.
struct MatchProcessingSheet: View {
    let model: MatchIssueModel
    let hasOriginal: Bool

    var body: some View {
        PLSheetScaffold(title: "Processing") {
            Form {
                MatchIssuePanel(model: model, hasOriginal: hasOriginal)
            }
            .plKeyboardDismiss()
        }
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
            // The panel is Form sections, so the page is a Form too: the
            // same cells the sheet shows, drawn over the arena, with the
            // page's own header as a clear first row.
            Form {
                Section {
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
                    }
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)
                }

                MatchIssuePanel(
                    model: model,
                    hasOriginal: match.map { $0.rawPath?.hasPrefix("r2://ponglens-raw/") == true }
                )
            }
            .scrollContentBackground(.hidden)
            .tint(PL.cyan)
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
                .presentationDragIndicator(.visible)
        }
    }
}

/// The public Feedback board, one row under Processing. Ideas and bugs have
/// nothing to do with how one match was cut, but a match page is where most
/// of them occur to people. It used to open the composer with this match
/// already attached; it no longer does (Adil, 2026-09-16), because a post
/// that arrives pinned to a match reads as being about that match. The
/// match is one tap away in the composer's picker.
struct FeedbackBoardToolRow: View {
    let match: MatchRow

    var body: some View {
        NavigationLink(value: "feedback") {
            HStack(spacing: 8) {
                Text("Feedback and discussion")
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

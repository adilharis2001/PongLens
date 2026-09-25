import SwiftUI

// More options: the Tools row of a PROCESSED match that took the place of
// "Processing" (cut again design, 2026-09-25). It opens a sheet with the
// raw page's two ways to cut a match, as the same components, then Report a
// problem, which closes the sheet and pushes the match's report page (the
// Processing form unchanged), as the web's row navigates to it. Owner only:
// a coach keeps the Processing row under the hero.

/// What the match page lends the row: the model, the draft, and the three
/// things only the page can do (open the marker over itself, open another
/// match, act once the sheet has gone).
struct MoreOptionsHooks {
    let cutAgain: CutAgainModel
    let handCut: HandCutDraftStore
    /// The live cut carries winners or lets, so marking it again opens with
    /// scoring on (start_recut's own rule for the draft's mode).
    let cutScored: Bool
    /// Start marking: prepare the marker (start_recut, the original's
    /// link). Nil when it is ready to open once the sheet has gone, else
    /// the sentence to show.
    let prepareMarking: (HandCutMode?) async -> String?
    /// The sheet has gone: raise whatever it prepared.
    let afterDismiss: () -> Void
    /// Open another match (the new one, after Keep).
    let openMatch: (UUID) -> Void
    /// The video under Process again's trim: this phone's own copy of the
    /// original, else a link to it. Nil leaves the trim bar on its own.
    var originalURL: () async -> URL? = { nil }
}

/// The row. Its trailing text is the cut running on this match, else the
/// state of any request, else nothing. The request's model lives here, as
/// it did on the Processing row, so it keeps polling and keeps telling the
/// page when a support reprocess goes live.
struct MoreOptionsToolRow: View {
    let match: MatchRow
    let hooks: MoreOptionsHooks?
    @Environment(\.scenePhase) private var scenePhase
    /// Optional so the simulator fixture, which has no navigation root,
    /// still draws the row.
    @Environment(Router.self) private var router: Router?
    @State private var issue: MatchIssueModel
    @State private var open = false
    /// A match the sheet asked to open once it has closed.
    @State private var pendingOpen: UUID?
    /// Report a problem was tapped: push the report page once the sheet
    /// has closed. Pushing while it is still on screen would either stack
    /// the page under it or have the push dropped.
    @State private var pendingReport = false
    /// Full height when a way's controls show on opening (a way already
    /// picked, or the only way there is), because its button would
    /// otherwise sit below the fold; half height for the rest (the two ways
    /// with neither picked, a running cut, one line, Report a problem).
    /// Picking a way expands it.
    @State private var detent: PresentationDetent = .medium

    init(match: MatchRow, hooks: MoreOptionsHooks?, issueClient: MatchIssueClient? = nil) {
        self.match = match
        self.hooks = hooks
        _issue = State(initialValue: MatchIssueModel(matchId: match.id, client: issueClient))
    }

    #if DEBUG
    /// Simulator fixtures: the row with its sheet already up.
    init(match: MatchRow, hooks: MoreOptionsHooks?, issueClient: MatchIssueClient?, open: Bool) {
        self.init(match: match, hooks: hooks, issueClient: issueClient)
        _open = State(initialValue: open)
        _detent = State(initialValue: showsControls ? .large : .medium)
    }
    #endif

    /// The sheet will open on a way's controls: the only way offered, or
    /// the way already picked when both are. Two ways with neither picked
    /// show only their two rows (there is no default).
    private var showsControls: Bool {
        guard let hooks else { return false }
        let plan = hooks.cutAgain.plan(handCutEnabled: hooks.handCut.enabled && hooks.handCut.ready)
        if plan.automatic && plan.marking { return hooks.cutAgain.way.chosen != nil }
        return plan.automatic || plan.marking
    }

    private var trailing: String? {
        // The running cut in the unprocessed page's words: a paused lane's
        // notice, else the stage, else its card's "Processing".
        if let cutAgain = hooks?.cutAgain, cutAgain.jobRunning {
            return cutAgain.serviceNotice?.title ?? cutAgain.runningLabel ?? "Processing"
        }
        guard let state = issue.state else { return nil }
        let words = state.rowTrailing
        return words == CutAgainCopy.reportProblem ? nil : words
    }

    var body: some View {
        Button {
            detent = showsControls ? .large : .medium
            pendingReport = false
            open = true
        } label: {
            HStack(spacing: 8) {
                Text(CutAgainCopy.moreOptions)
                    .font(.system(size: 16))
                    .foregroundStyle(PL.textBody)
                Spacer()
                if let trailing {
                    Text(trailing)
                        .font(.plBody)
                        .foregroundStyle(PL.text500)
                        .lineLimit(1)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PL.text600)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .task { await issue.load(); issue.startPolling() }
        .onDisappear { issue.stopPolling() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await issue.load(); issue.startPolling() } }
            else { issue.stopPolling() }
        }
        .onChange(of: issue.state?.activeProcessingVersionId) { _, version in
            guard let version, version != match.activeProcessingVersionId else { return }
            NotificationCenter.default.post(name: .matchProcessingVersionChanged, object: match.id)
        }
        .sheet(isPresented: $open, onDismiss: {
            if let id = pendingOpen {
                pendingOpen = nil
                hooks?.openMatch(id)
            } else if pendingReport {
                pendingReport = false
                // The same route the bell pushes for a request's update,
                // onto the match's own stack: Back returns to the match.
                router?.openRoute = "match-feedback:\(match.id.uuidString.lowercased())"
            } else {
                hooks?.afterDismiss()
            }
        }) {
            MoreOptionsSheet(
                match: match,
                hooks: hooks,
                issue: issue,
                close: { opening in
                    pendingOpen = opening
                    open = false
                },
                report: {
                    pendingReport = true
                    open = false
                },
                expand: { detent = .large }
            )
            .presentationDetents([.medium, .large], selection: $detent)
            .presentationDragIndicator(.visible)
        }
    }
}

/// The sheet: under a "Process again" label, the choice between
/// Automatically and Mark the points yourself and the chosen way's
/// controls; then Report a problem. A way the server does not allow is not
/// there (one way left means no choice, just its controls); a running cut
/// takes their place.
///
/// Cards, not a Form (owner, build 241). The two ways are the raw page's
/// own components, drawn as dark cards inside; a Form row put them in a
/// system-grey cell, card in card, and a row clips its content to the
/// section's ~26pt corners, which would cut the 16pt card's border. So the
/// sheet is the page's cards on the scaffold's ground: Process again in
/// the "Break it into points" card, Report a problem as a Tools row.
struct MoreOptionsSheet: View {
    let match: MatchRow
    let hooks: MoreOptionsHooks?
    let issue: MatchIssueModel
    /// Close the sheet, optionally opening a match once it has gone.
    let close: (UUID?) -> Void
    /// Report a problem: close the sheet, then show the match's report
    /// page. Never a second sheet over this one.
    let report: () -> Void
    /// A way was picked: the sheet goes to full height.
    var expand: () -> Void = {}

    var body: some View {
        PLSheetScaffold(title: CutAgainCopy.moreOptions) {
            ScrollView {
                // The match page's rhythm: 20 between cards, 20 in from
                // the edges.
                VStack(alignment: .leading, spacing: 20) {
                    if let hooks {
                        CutAgainSections(match: match, hooks: hooks, close: close, expand: expand)
                    }
                    reportRow
                }
                .padding(20)
            }
            .plKeyboardDismiss()
        }
        .task {
            await hooks?.cutAgain.load()
            hooks?.cutAgain.startPolling()
        }
    }

    /// A Tools row on the match page, word for word in its dress: 16pt
    /// label, the trailing state in caption grey, the chevron, in the
    /// page's card (MatchTools.toolRow inside ToolsSection's card).
    private var reportRow: some View {
        Button { report() } label: {
            HStack(spacing: 8) {
                Text(CutAgainCopy.reportProblem)
                    .font(.system(size: 16))
                    .foregroundStyle(PL.textBody)
                Spacer()
                if let words = issue.state?.rowTrailing, words != CutAgainCopy.reportProblem {
                    Text(words)
                        .font(.plBody)
                        .foregroundStyle(PL.text500)
                        .lineLimit(1)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PL.text600)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .plCard(padding: 0)
    }
}

/// The two ways (one choice and the chosen way's controls), or the running
/// cut, or the one line that stands in for them, each in the page's card.
private struct CutAgainSections: View {
    let match: MatchRow
    let hooks: MoreOptionsHooks
    let close: (UUID?) -> Void
    let expand: () -> Void

    private var model: CutAgainModel { hooks.cutAgain }
    private var handCut: HandCutDraftStore { hooks.handCut }
    private var plan: MoreOptionsPlan {
        model.plan(handCutEnabled: handCut.enabled && handCut.ready)
    }

    private var practice: Bool { !MatchTitle.tracksServe(match.matchType) }
    /// Where the switch stands: the player's flip; else an unsent draft's
    /// own mode (a prefilled one too: start_recut keeps the pass the
    /// player switched to); else what start_recut will write from the live
    /// cut.
    private var markMode: HandCutMode {
        if handCut.openDraftCount > 0 || (handCut.prefilled && !handCut.isSubmitted) {
            return HandCut.openingMode(
                handCut.marks, recorded: handCut.mode,
                tracksServe: !practice, chosen: model.markModeChoice
            )
        }
        if practice { return .cut }
        return model.markModeChoice ?? (hooks.cutScored ? .score : .cut)
    }
    var body: some View {
        let plan = plan
        if plan.running {
            if model.jobRunning {
                // The unprocessed page's processing card, word for word.
                MatchProcessingCard(
                    notice: model.serviceNotice,
                    stageLabel: model.runningLabel,
                    warning: nil,
                    progress: model.job?.progress,
                    sendsReadyEmail: true,
                    estimate: model.feedback?.estimate,
                    jobStatus: model.feedback?.jobStatus ?? model.job?.status,
                    serviceState: model.serviceState
                )
            } else {
                // The server says something is running before its job is
                // seen: the contract's line for `processing`.
                Text(plan.blocked ?? CutAgainCopy.busy)
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .plCard()
            }
        } else if let line = plan.blocked {
            Text(line).font(.plBody).foregroundStyle(PL.text300)
                .frame(maxWidth: .infinity, alignment: .leading)
                .plCard()
        } else if model.options == nil {
            Group {
                if model.optionsFailed {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Couldn't load this match. Try again.")
                            .font(.plBody).foregroundStyle(PL.warningText)
                        // Full width, the width on the label, as the
                        // allowance card's retry does it.
                        Button { Task { await model.load() } } label: {
                            Text("Try again").frame(maxWidth: .infinity, minHeight: 28)
                        }
                        .buttonStyle(PLSecondaryButtonStyle())
                    }
                } else {
                    ProgressView().tint(PL.cyan)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .plCard()
        }
        if plan.automatic || plan.marking {
            VStack(alignment: .leading, spacing: 10) {
                // What both rows do on a processed match, dressed as the
                // sheets' own section header (Match details' "Your side":
                // 17pt semibold in the secondary grey, level with the rows'
                // text), not the page's uppercase label. Nothing under it.
                Text(CutAgainCopy.processAgain)
                    .font(.headline)
                    .foregroundStyle(PL.text400)
                    .padding(.horizontal, 16)
                Group {
                    if plan.automatic && plan.marking {
                        // Both ways: one choice with neither picked, then
                        // the chosen way's controls, as on the raw page.
                        CutWayPicker(
                            selected: model.way.selected(),
                            markingTrailing: MoreOptionsPlan.markingTrailing(draftCount: handCut.openDraftCount),
                            onSelect: { way in
                                model.way.choose(way)
                                expand()
                            },
                            automatic: { automaticControls },
                            marking: { markingControls }
                        )
                    } else if plan.automatic {
                        // One way only (no marking by hand on this
                        // account): its controls, with nothing to choose.
                        automaticControls
                    } else {
                        markingControls
                    }
                }
                // The raw page's "Break it into points" card: surface
                // fill, edge border, 16pt corners, no padding of its own
                // (the components carry theirs).
                .frame(maxWidth: .infinity, alignment: .leading)
                .plCard(padding: 0)
            }
        }
    }

    /// Process again, automatically: the trim over the original, the
    /// Replace or Keep choice, and the button with what it uses. The
    /// original is fetched the moment these controls show (the web signs
    /// it as soon as Automatically shows in an open sheet), once.
    private var automaticControls: some View {
        @Bindable var model = model
        return AutoProcessControls(
            durationS: match.durationS,
            trimStart: $model.trimStart,
            trimEnd: $model.trimEnd,
            previewURL: model.previewURL,
            previewLoading: model.previewLoading,
            error: model.error,
            busy: model.busy,
            balance: model.minutesBalance,
            needsMoreMinutes: model.needsMoreMinutes,
            recheckMinutes: { try await model.recheckMinutes() },
            onProcess: {
                Task {
                    switch await model.processAutomatically(durationS: match.durationS) {
                    case .replacing: close(nil)
                    case .opened(let id): close(id)
                    case .stayed: break
                    }
                }
            },
            again: true,
            choice: {
                if model.autoChoice != nil {
                    RecutChoiceView(
                        state: Binding(
                            get: { model.autoChoice ?? RecutChoiceState(replaceAllowed: false, hasMatchNotes: false) },
                            set: { model.autoChoice = $0 }
                        ),
                        disabled: model.busy
                    )
                }
            }
        )
        .task { await model.resolvePreview(hooks.originalURL) }
    }

    private var markingControls: some View {
        VStack(alignment: .leading, spacing: 0) {
            MarkYourselfControls(
                practice: practice,
                mode: markMode,
                onMode: { model.markModeChoice = $0 },
                resuming: handCut.openDraftCount > 0,
                opening: model.openingMarker,
                enabled: match.rawPath?.hasPrefix("r2://ponglens-raw/") == true,
                onStart: {
                    Task {
                        model.openingMarker = true
                        model.markError = nil
                        let refusal = await hooks.prepareMarking(model.markModeChoice)
                        model.openingMarker = false
                        if let refusal {
                            model.markError = refusal
                        } else {
                            model.markModeChoice = nil
                            close(nil)
                        }
                    }
                }
            )
            if let error = model.markError {
                Text(error)
                    .font(.plCaption)
                    .foregroundStyle(PL.warningText)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 20)
            }
        }
    }
}

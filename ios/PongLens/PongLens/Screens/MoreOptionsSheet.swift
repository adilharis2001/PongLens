import SwiftUI

// More options: the Tools row of a PROCESSED match that took the place of
// "Processing" (cut again design, 2026-09-25). It opens a sheet with the
// raw page's two ways to cut a match, as the same components, then Report a
// problem, which is today's Processing form unchanged. Owner only: a coach
// keeps the Processing row under the hero.

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
}

/// The row. Its trailing text is the cut running on this match, else the
/// state of any request, else nothing. The request's model lives here, as
/// it did on the Processing row, so it keeps polling and keeps telling the
/// page when a support reprocess goes live.
struct MoreOptionsToolRow: View {
    let match: MatchRow
    let hooks: MoreOptionsHooks?
    @Environment(\.scenePhase) private var scenePhase
    @State private var issue: MatchIssueModel
    @State private var open = false
    /// A match the sheet asked to open once it has closed.
    @State private var pendingOpen: UUID?
    /// Full height when the two ways are offered, because the chosen way's
    /// controls always show and its button would otherwise sit below the
    /// fold; half height for the rest (a running cut, one line, Report a
    /// problem).
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
        _detent = State(initialValue: offersWays ? .large : .medium)
    }
    #endif

    /// The sheet will show a way to process again, and so its controls.
    private var offersWays: Bool {
        guard let hooks else { return false }
        let plan = hooks.cutAgain.plan(handCutEnabled: hooks.handCut.enabled && hooks.handCut.ready)
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
            detent = offersWays ? .large : .medium
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
struct MoreOptionsSheet: View {
    let match: MatchRow
    let hooks: MoreOptionsHooks?
    let issue: MatchIssueModel
    /// Close the sheet, optionally opening a match once it has gone.
    let close: (UUID?) -> Void
    /// A way was picked: the sheet goes to full height.
    var expand: () -> Void = {}
    @State private var reportOpen = false

    var body: some View {
        PLSheetScaffold(title: CutAgainCopy.moreOptions) {
            Form {
                if let hooks {
                    CutAgainSections(match: match, hooks: hooks, close: close, expand: expand)
                }
                Section {
                    Button { reportOpen = true } label: {
                        HStack(spacing: 8) {
                            Text(CutAgainCopy.reportProblem)
                                .font(.plRowTitle)
                                .foregroundStyle(PL.text100)
                            Spacer(minLength: 8)
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
                        .padding(.vertical, 6)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .plKeyboardDismiss()
        }
        .task {
            await hooks?.cutAgain.load()
            hooks?.cutAgain.startPolling()
        }
        .sheet(isPresented: $reportOpen) {
            MatchProcessingSheet(
                model: issue,
                hasOriginal: match.rawPath?.hasPrefix("r2://ponglens-raw/") == true
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
    }
}

/// The two ways (one choice and the chosen way's controls), or the running
/// cut, or the one line that stands in for them. Form sections, so the
/// sheet reads as one form.
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
    private var minutes: Int? {
        ProcessCharge.minutes(durationS: match.durationS, trimStart: model.trimStart, trimEnd: model.trimEnd)
    }

    var body: some View {
        let plan = plan
        if plan.running {
            Section {
                if model.jobRunning {
                    // The unprocessed page's processing card, word for word.
                    MatchProcessingContent(
                        notice: model.serviceNotice,
                        stageLabel: model.runningLabel,
                        warning: nil,
                        progress: model.job?.progress,
                        sendsReadyEmail: true,
                        estimate: model.feedback?.estimate,
                        jobStatus: model.feedback?.jobStatus ?? model.job?.status,
                        serviceState: model.serviceState
                    )
                    .padding(.vertical, 6)
                } else {
                    // The server says something is running before its job is
                    // seen: the contract's line for `processing`.
                    Text(plan.blocked ?? CutAgainCopy.busy)
                        .font(.plCardTitle)
                        .foregroundStyle(PL.text100)
                        .padding(.vertical, 6)
                }
            }
        } else if let line = plan.blocked {
            Section {
                Text(line).font(.plBody).foregroundStyle(PL.text300)
            }
        } else if model.options == nil {
            Section {
                if model.optionsFailed {
                    Text("Couldn't load this match. Try again.")
                        .font(.plBody).foregroundStyle(PL.warningText)
                    Button("Try again") { Task { await model.load() } }
                } else {
                    ProgressView().tint(PL.cyan)
                }
            }
        }
        if plan.automatic || plan.marking {
            Section {
                Group {
                    if plan.automatic && plan.marking {
                        // Both ways: one choice, then the chosen way's
                        // controls, as on the raw page.
                        CutWayPicker(
                            selected: model.way.selected(draftCount: handCut.openDraftCount),
                            automaticTrailing: minutes.map { "\($0) min" },
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
                .listRowInsets(EdgeInsets())
            } header: {
                // What both rows do on a processed match, in the page's
                // own section label ("TOOLS", "POINTS"). Nothing under it.
                SectionHeading(CutAgainCopy.processAgain)
            }
        }
    }

    private var automaticControls: some View {
        @Bindable var model = model
        return AutoProcessControls(
            durationS: match.durationS,
            trimStart: $model.trimStart,
            trimEnd: $model.trimEnd,
            strictness: $model.strictness,
            error: model.error,
            busy: model.busy,
            balance: model.minutesBalance,
            needsMoreMinutes: model.needsMoreMinutes,
            recheckMinutes: { try await model.recheckMinutes() },
            onProcess: {
                Task {
                    let opening = await model.processAutomatically(durationS: match.durationS)
                    if model.error == nil { close(opening) }
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

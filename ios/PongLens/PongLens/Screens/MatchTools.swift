import SwiftUI
import Supabase

/// The Tools card on the match page: a divided list of rows, each with a
/// trailing value and chevron, exactly like the web's mobile layout.
struct ToolsSection: View {
    let match: MatchRow
    let model: MatchDetailModel
    let score: MatchScore
    let onOpenPlayer: () -> Void
    let onScrollToNotes: () -> Void
    let onScrollToAnalysis: () -> Void
    let onScrollToPlacement: () -> Void
    /// Called after a sheet writes to the match row (Match details, which
    /// holds Your side).
    /// The screen refetches its own copy — this card renders from a
    /// captured MatchRow, and reloading the library alone left the rows'
    /// trailing text stale, which read as the save not working.
    let onRowChanged: () -> Void
    /// Reading the sample match: the card is shown in full so the page is
    /// the real page, but every row except Highlights is dead — none of
    /// them is this reader's to press.
    var sampleViewer = false
    /// More options (cut again): what the page lends the row. Nil on the
    /// sample, where the row is shown dead like its neighbours.
    var moreOptions: MoreOptionsHooks? = nil
    /// Points the serve maps can draw (mappedPointCount). On a match that
    /// keeps no score, the analysis row shows only when there is one.
    var mappedPoints = 0

    @Environment(AppState.self) private var app
    @State private var shareOpen = false
    @State private var highlightsOpen = false
    @State private var coachOpen = false
    @State private var exportOpen = false
    @State private var detailsOpen = false
    @State private var analysisRequestOpen = false
    @State private var automaticHighlights: AutomaticHighlightsResponse?

    /// Greys and deadens a row on the demo match. Three rows do NOT take
    /// this: scoring, the analysis and the notes all work there and stop
    /// at the phone, because a demo you can only look at teaches nothing
    /// (Adil, 2026-09-18).
    @ViewBuilder
    private func locked(_ row: some View) -> some View {
        row.disabled(sampleViewer).opacity(sampleViewer ? 0.45 : 1)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading("Tools")
            VStack(spacing: 0) {
                // Score the Match's whole job is assigning a winner to each
                // point to build a score. Drills have no score, so the row
                // is not a disabled control, it is absent. Watching,
                // tagging, starring and noting all stay: they are the
                // reason to film a practice session at all.
                if MatchTitle.tracksServe(match.matchType) {
                    toolRow("Score the Match", trailing: gamesTrailing) { onOpenPlayer() }
                    divider
                }
                toolRow("Highlights", trailing: .text(highlightsTrailing)) {
                    highlightsOpen = true
                }
                divider
                // One row for the whole analysis section: the score cards,
                // the video cards and the serve maps live under it, and its
                // trailing text names whatever the section is waiting on.
                // Generating maps is a card in that section now.
                // The web's rule (MatchView): a match that keeps a score
                // always has the row; a practice or drill only once the maps
                // have a point to draw, so it never jumps to an empty section.
                if AnalysisToolRow.shown(scoredType: MatchTitle.tracksServe(match.matchType), mappedPoints: mappedPoints) {
                    toolRow("Match analysis", trailing: .text(analysisTrailing)) {
                        // Past the bar the row triggers the analysis, which
                        // is a job the demo has no business queueing.
                        if analysisRowAction && !sampleViewer {
                            analysisRequestOpen = true
                        } else {
                            onScrollToAnalysis()
                        }
                    }
                    divider
                }
                locked(toolRow("Share a link", trailing: .text("Not shared")) { shareOpen = true })
                divider
                locked(toolRow("Coach", trailing: .text("Invite your coach")) { coachOpen = true })
                divider
                locked(toolRow("Export", trailing: .text("Video files")) { exportOpen = true })
                divider
                toolRow("Notes", trailing: .text("Add a note")) { onScrollToNotes() }
                divider
                // Your side is a field of Match details, not a row of its
                // own (Adil, 2026-09-25).
                locked(toolRow("Match details", trailing: .text(detailsTrailing)) { detailsOpen = true })
                divider
                locked(FeedbackBoardToolRow(match: match))
                divider
                // More options took Processing's place (cut again,
                // 2026-09-25): processing the match again, either way, and
                // Report a problem, which is the Processing form unchanged.
                // The last row (Adil, 2026-09-25).
                locked(MoreOptionsToolRow(match: match, hooks: moreOptions))
            }
            .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            )
        }
        .sheet(isPresented: $shareOpen) {
            ShareLinksSheet(
                match: match, starredCount: starredCount,
                scored: score.confirmedCount > 0,
                highlightsReady: automaticHighlights?.status == "ready"
            )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $highlightsOpen) {
            HighlightsSheet(
                match: match,
                model: model,
                scored: score.confirmedCount > 0,
                locked: sampleViewer,
                onChanged: { response in
                    automaticHighlights = response
                },
                onScore: {
                    highlightsOpen = false
                    DispatchQueue.main.async { onOpenPlayer() }
                }
            )
        }
        .sheet(isPresented: $coachOpen) {
            CoachInviteSheet(match: match)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $exportOpen) {
            ExportSheet(match: match, starredCount: starredCount)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $detailsOpen) {
            MatchDetailsEditor(match: match, asksSide: true, videoURL: model.videoURL) {
                onRowChanged()
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $analysisRequestOpen) {
            PlacementRequestSheet(match: match, onChanged: onRowChanged)
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        }
        .task(id: match.id) { await loadAutomaticHighlights() }
    }

    private var highlightsTrailing: String {
        automaticHighlights?.summary ?? "Preparing highlights"
    }

    private func loadAutomaticHighlights() async {
        while !Task.isCancelled {
            do {
                automaticHighlights = try await API.get(
                    "api/highlights",
                    query: ["matchId": match.id.uuidString.lowercased()]
                )
            } catch {
                automaticHighlights = AutomaticHighlightsResponse(
                    status: "failed", url: nil, durationS: nil, manifest: nil
                )
            }
            guard automaticHighlights?.status == "rendering"
                    || automaticHighlights?.status == "updating" else { return }
            try? await Task.sleep(for: .milliseconds(1800))
        }
    }

    private var starredCount: Int {
        model.visible.filter(\.starred).count
    }

    private var gamesTrailing: Trailing {
        score.confirmedCount > 0 ? .games(score.gamesYou, score.gamesThem) : .text("")
    }

    /// What the section is waiting on: points to score, maps to generate,
    /// or the detail still missing. The same gate as the deck (and as the
    /// highlights), so the row and the card it jumps to never disagree
    /// about what "unlocked" means.
    /// Whether a tap on the Match analysis row should start the analysis
    /// rather than scroll to it: the match is scored past the bar and the
    /// analysis has not been generated, or can be tried again.
    private var analysisRowAction: Bool {
        guard MatchTitle.tracksServe(match.matchType), !firstServerBeforeAnalysis,
              scoredCardsGate(model.visible).open else { return false }
        switch match.placementStatus {
        case nil, "not_requested", "retry_available": return true
        default: return false
        }
    }

    /// The maps read whose serve each dot is from the rotation, so a scored
    /// match names its first server before the analysis is offered. The row
    /// then names that step and lands on the deck's card that asks it. The
    /// web's firstServerBeforeAnalysis in MatchView.
    private var firstServerBeforeAnalysis: Bool {
        guard !sampleViewer, MatchTitle.tracksServe(match.matchType), match.firstServer == nil else { return false }
        switch match.placementStatus {
        case nil, "not_requested", "retry_available": return true
        default: return false
        }
    }

    private var analysisTrailing: String {
        if !MatchTitle.tracksServe(match.matchType) { return AnalysisToolRow.unscoredTrailing(mappedPoints: mappedPoints) }
        let gate = scoredCardsGate(model.visible)
        if !gate.open {
            return gate.scored == 0
                ? "Score points to unlock"
                : "\(gate.scored) of \(gate.eligible) scored"
        }
        switch match.placementStatus {
        case "processing": return "Generating…"
        case "retrying": return "Retrying…"
        default: break
        }
        if firstServerBeforeAnalysis { return "Who served first?" }
        switch match.placementStatus {
        case "retry_available": return "Try again"
        case nil, "not_requested": return "Generate detailed analysis"
        default: break
        }
        let serving = computeServing(
            model.visible, firstServer: match.firstServer.flatMap(Winner.init(rawValue:))
        )
        return statsRowSummary(
            computeMatchStats(model.visible, serving: serving, score: score)
        )
    }

    private var detailsTrailing: String {
        // The sample names nobody, and this row is locked anyway: the
        // two players read Player 1 and Player 2 wherever a visitor
        // sees them.
        if sampleViewer { return "Player 1 and Player 2" }
        let opp = match.opponentName ?? ""
        let venue = match.venue ?? ""
        if opp.isEmpty && venue.isEmpty { return "Add opponent and venue" }
        return [opp, venue].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private var divider: some View {
        Rectangle().fill(PL.edge.opacity(0.6)).frame(height: 1).padding(.leading, 16)
    }

    private enum Trailing {
        case text(String)
        case games(Int, Int)
    }

    private func toolRow(
        _ label: String, trailing: Trailing, beta: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(label)
                    .font(.system(size: 16))
                    .foregroundStyle(PL.textBody)
                if beta {
                    Text("BETA")
                        .font(.system(size: 10, weight: .semibold))
                        .tracking(0.5)
                        .foregroundStyle(PL.warningText.opacity(0.9))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(PL.warning.opacity(0.1), in: Capsule())
                        .overlay(Capsule().strokeBorder(PL.warning.opacity(0.25), lineWidth: 1))
                }
                Spacer()
                switch trailing {
                case .text(let value):
                    Text(value)
                        .font(.plBody)
                        .foregroundStyle(PL.text500)
                        .lineLimit(1)
                case .games(let you, let them):
                    (Text("\(you)").foregroundColor(PL.cyan)
                        + Text(" - ").foregroundColor(PL.text600)
                        + Text("\(them)").foregroundColor(PL.magentaSoft))
                        .font(.system(size: 14, weight: .semibold))
                        .monospacedDigit()
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
    }
}

// MARK: - Share

/// Share, in the app's Form idiom: pick what to share, create the link,
/// then hand it over. The QR waits behind a toggle — it is for a coach
/// standing next to you, not for the person reading the sheet.
struct ShareLinksSheet: View {
    let match: MatchRow
    let starredCount: Int
    /// The match has confirmed winners, so a shared link has a score to
    /// draw. False hides the toggle rather than offering a choice with no
    /// effect, the same rule the export sheet follows.
    var scored = false
    /// False before processing: the link plays the original upload (and
    /// upgrades to the cut once processing lands), so the footer must not
    /// promise "cut to the play" yet.
    var processed = true
    let initialTarget: ShareLinkTarget
    var highlightsReady: Bool

    @Environment(\.dismiss) private var dismiss
    @State private var target: ShareLinkTarget
    /// One link per scope: the API is idempotent, and switching back
    /// should show the link you already made rather than mint again.
    @State private var links: [ShareLinkTarget: URL] = [:]
    @State private var creating = false
    @State private var errorMessage: String?
    @State private var showQR = false
    @State private var copied = false
    /// Whether the shared page draws the running score over the video.
    /// An overlay on the page, not burnt into the file, so changing it
    /// takes effect on a link somebody already has.
    @State private var showScore = true

    init(
        match: MatchRow,
        starredCount: Int,
        scored: Bool = false,
        processed: Bool = true,
        initialTarget: ShareLinkTarget = .match,
        highlightsReady: Bool = false
    ) {
        self.match = match
        self.starredCount = starredCount
        self.scored = scored
        self.processed = processed
        self.initialTarget = initialTarget
        self.highlightsReady = highlightsReady
        _target = State(initialValue: initialTarget)
    }

    private var link: URL? { links[target] }
    private var starredEmpty: Bool {
        target == .starred && starredCount == 0
    }
    private var targets: [ShareLinkTarget] {
        shareLinkTargets(
            processed: processed,
            highlightsReady: highlightsReady
        )
    }

    var body: some View {
        PLSheetScaffold(title: "Share a link") {
            Form {
                Section {
                    ForEach(targets, id: \.self) { option in
                        PLChoiceRow(
                            title: targetTitle(option),
                            detail: targetDetail(option),
                            selected: target == option
                        ) {
                            target = option
                        }
                    }
                } footer: {
                    Text(scopeFooter)
                }

                // A whole-match link only. A starred link is a run of
                // single rallies, and a running scoreboard over one of
                // those says nothing.
                // One switch for the whole scored half of the shared page.
                // The bug over the video, the result and the analysis
                // under it are the same fact told three ways, so they
                // answer to one control rather than three.
                if target != .starred, scored {
                    Section {
                        Toggle("Include score and stats", isOn: $showScore)
                    } footer: {
                        Text("The running score over the video, plus the result and the placement maps.")
                    }
                }

                if let link {
                    Section {
                        Text(link.absoluteString)
                            .font(.system(size: 13, design: .monospaced))
                            .foregroundStyle(PL.text300)
                            .lineLimit(2)
                        ShareLink(item: link) {
                            Text("Share the link")
                        }
                        Button(copied ? "Copied" : "Copy link") {
                            UIPasteboard.general.string = link.absoluteString
                            copied = true
                            Task {
                                try? await Task.sleep(for: .seconds(1.5))
                                copied = false
                            }
                        }
                        Toggle("Show QR", isOn: $showQR)
                    } footer: {
                        // Under the rows on the sheet, not a clear last row,
                        // which left the rows above ending square.
                        if showQR {
                            QRCodeView(url: link).plFormBlock(top: nil)
                        }
                    }
                } else if !starredEmpty {
                    Section {} footer: {
                        PLSheetActionRow(
                            label: creating ? "Creating…" : "Create the link",
                            disabled: creating
                        ) {
                            Task { await mint() }
                        }
                        .plFormBlock()
                    }
                    if let errorMessage {
                        Section {
                            Text(errorMessage)
                                .font(.plCaption)
                                .foregroundStyle(PL.dangerText)
                        }
                    }
                }
            }
            .onChange(of: showScore) { _, _ in
                // The route is idempotent and applies the choice on the
                // reuse path, so this updates the link already out there
                // rather than minting a second one.
                guard target != .starred, links[target] != nil else { return }
                Task { await mint() }
            }
        }
        .onChange(of: target) { _, _ in
            // The QR belongs to the link on screen, so a switch closes it.
            showQR = false
            copied = false
            errorMessage = nil
        }
    }

    private var scopeFooter: String {
        if target == .starred {
            return starredCount == 0
                ? "Star points to share them as a set."
                : "The \(starredCount) points you have starred, and it keeps up as you star more. Anyone with the link can watch."
        }
        if target == .highlights {
            return "Your current highlight reel. Anyone with the link can watch, and you can revoke it anytime from your account."
        }
        if !processed {
            return "The whole match, as uploaded. Anyone with the link can watch, and you can revoke it anytime from your account."
        }
        return "The whole match, cut to the play. Anyone with the link can watch, and you can revoke it anytime from your account."
    }

    private struct MintResponse: Decodable { let url: String }

    private func targetTitle(_ option: ShareLinkTarget) -> String {
        switch option {
        case .match: "This match"
        case .highlights: "Highlights"
        case .starred: "Starred points"
        }
    }

    private func targetDetail(_ option: ShareLinkTarget) -> String {
        switch option {
        case .match: processed ? "The whole match, cut to the play" : "The whole match, as uploaded"
        case .highlights: "Your best qualifying rallies"
        case .starred: starredCount == 0 ? "Star points to share them" : "\(starredCount) selected rallies"
        }
    }

    private func mint() async {
        creating = true
        errorMessage = nil
        let id = match.id.uuidString.lowercased()
        let res: MintResponse?
        if target == .starred {
            struct Req: Encodable {
                let matchId: String
                let kind: String
            }
            res = try? await API.post("api/share", Req(matchId: id, kind: "starred"))
        } else if target == .highlights {
            struct Req: Encodable {
                let matchId: String
                let kind: String
                let showScore: Bool
            }
            res = try? await API.post(
                "api/share",
                Req(matchId: id, kind: "highlights", showScore: showScore)
            )
        } else {
            struct Req: Encodable {
                let matchId: String
                let showScore: Bool
            }
            res = try? await API.post(
                "api/share", Req(matchId: id, showScore: showScore)
            )
        }
        if let url = res.flatMap({ URL(string: $0.url) }) {
            links[target] = url
        } else {
            errorMessage = "Couldn't create the link. Try again."
        }
        creating = false
    }
}

// MARK: - Placement maps

/// The Tools row for placement maps only scrolls once maps exist. Every
/// other state lands here, which is the one place generation can be
/// started — before this the row did nothing at all on a match that had
/// never been generated. Copy and state machine mirror placementRetry.ts.
struct PlacementRequestSheet: View {
    let match: MatchRow
    let onChanged: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var submitting = false
    @State private var started = false
    @State private var errorMessage: String?

    private var status: String { match.placementStatus ?? "not_requested" }

    var body: some View {
        PLSheetScaffold(title: "Detailed analysis") {
            Form {
                if !started, !running, let actionLabel {
                    // The action on the sheet, not in a row (see
                    // PLSheetActionRow), with the words under it. An error
                    // is a row under the action, and the words follow it.
                    let action = PLSheetActionRow(
                        label: submitting ? "Starting…" : actionLabel,
                        disabled: submitting
                    ) {
                        Task { await request() }
                    }
                    if let errorMessage {
                        Section {} footer: { action.plFormBlock() }
                        Section {
                            Text(errorMessage)
                                .font(.plCaption)
                                .foregroundStyle(PL.dangerText)
                        } footer: {
                            Text(body_)
                        }
                    } else {
                        Section {} footer: {
                            PLCaptionedBlock { action } caption: { Text(body_) }
                        }
                    }
                } else {
                    Section {
                        if started {
                            Label(
                                "Started. It takes a few minutes.",
                                systemImage: "checkmark.circle.fill"
                            )
                            .font(.plBody)
                            .foregroundStyle(PL.text300)
                        } else if running {
                            HStack(spacing: 10) {
                                ProgressView().tint(PL.cyan)
                                Text(status == "retrying" ? "Retrying…" : "Generating…")
                                    .font(.plBody)
                                    .foregroundStyle(PL.text300)
                            }
                        }
                        if let errorMessage {
                            Text(errorMessage)
                                .font(.plCaption)
                                .foregroundStyle(PL.dangerText)
                        }
                    } footer: {
                        Text(body_)
                    }
                }
            }
        }
    }

    /// A run is already in flight; the sheet reports rather than offers.
    private var running: Bool {
        status == "processing" || status == "retrying"
    }

    private var body_: String {
        switch status {
        case "processing", "retrying":
            "The detailed analysis is generating. It takes a few minutes."
        case "retry_available":
            "The detailed analysis couldn't be generated because the table was hard to detect in this video. You can try once more."
        case "final_failed":
            "The detailed analysis couldn't be generated for this video."
        default:
            "The detailed analysis reads the video for where each serve landed, how fast it was and where points ended. It takes a few minutes."
        }
    }

    /// nil while a run is in flight or the match is past retrying.
    private var actionLabel: String? {
        switch status {
        case "retry_available": "Try again"
        case "processing", "retrying", "final_failed": nil
        default: "Generate detailed analysis"
        }
    }

    private func request() async {
        submitting = true
        errorMessage = nil
        struct Req: Encodable { let matchId: String }
        struct Res: Decodable { let status: String? }
        let path = status == "retry_available"
            ? "api/placement-retry" : "api/placement-generate"
        do {
            let _: Res = try await API.post(
                path, Req(matchId: match.id.uuidString.lowercased())
            )
            started = true
            onChanged()
        } catch let APIError.http(_, code) {
            errorMessage = switch code {
            case "source_expired":
                "The original video is no longer available, so placement can't run."
            case "generation_already_used", "retry_already_used", "already_retrying":
                "That has already been started for this match."
            case "not_owner": "This isn't your match."
            default: "Couldn't start it. Try again."
            }
        } catch {
            errorMessage = "Couldn't start it. Try again."
        }
        submitting = false
    }
}

// MARK: - Coach invite

/// Share with coach. Your connected coaches come first, by name, with
/// what they can see and a one-tap share for this match — the link is
/// only for a coach you have not connected yet. A player-written,
/// match-scoped accepted link is the direct grant (160); the coach hears
/// about it the same way they hear about a student's match turning ready.
struct CoachInviteSheet: View {
    let match: MatchRow

    @Environment(AppState.self) private var app
    @Environment(CoachingStore.self) private var coaching
    @Environment(\.dismiss) private var dismiss

    struct ConnectedCoach: Identifiable {
        let id: UUID
        let name: String
        /// An accepted link with no scope: every match, this one included.
        let allMatches: Bool
        /// The accepted link scoped to THIS match, when there is one.
        let matchLinkId: UUID?
        let otherMatches: Int
    }

    struct PendingInvite: Identifiable {
        let id: UUID
        let token: String
        /// "this match", "all matches" or "matches you share".
        let access: String
        /// What the player calls them, when the invite was named (164).
        let name: String?
        /// Their invite already covers this match, so there is nothing to
        /// line up: every match, or an invite minted for this one.
        let covers: Bool
        /// This match is queued to go over the moment they accept (166).
        let queued: Bool
    }

    @State private var coaches: [ConnectedCoach] = []
    @State private var pending: [PendingInvite] = []
    @State private var loaded = false
    @State private var busyCoach: UUID?

    @State private var scope = "match"
    /// Who the invite is for (164). Optional, and it does two things: the
    /// waiting invite says a name instead of "Invite sent", and the
    /// journal can attribute entries to them before they accept.
    @State private var inviteName = ""
    @Environment(LibraryStore.self) private var library
    @State private var starter = StarterPackStore()
    /// The waiting invite being named after the fact, and its draft.
    @State private var namingInvite: UUID?
    @State private var nameDraft = ""
    @State private var link: URL?
    @State private var creating = false
    @State private var errorMessage: String?
    @State private var showQR = false

    var body: some View {
        PLSheetScaffold(title: "Share with coach") {
            Form {
                if loaded && !coaches.isEmpty {
                    Section {
                        ForEach(coaches) { coach in
                            coachRow(coach)
                        }
                    } header: {
                        Text("Your coaches")
                    } footer: {
                        Text("Sharing hands them this match. Take it back any time from Account.")
                    }
                }

                // Coaches you have invited who have not opened the link
                // yet (166). Sharing writes an accepted link and there is
                // no account to write one for, so this lines the match up
                // instead and the accept hands it over.
                if !pending.isEmpty {
                    Section {
                        ForEach(pending) { invite in
                            HStack(spacing: 12) {
                                PLRowLabel(
                                    title: invite.name ?? CoachingStore.unnamedInvite,
                                    detail: invite.covers
                                        ? "Gets \(invite.access) when they accept"
                                        : invite.queued
                                            ? "Gets this match when they accept"
                                            : "Hasn't opened the link yet",
                                    dimmed: invite.name == nil
                                )
                                Spacer(minLength: 8)
                                if busyCoach == invite.id {
                                    ProgressView().tint(PL.cyan)
                                } else if !invite.covers {
                                    Button(invite.queued ? "Remove" : "Share") {
                                        Task { await queue(invite, on: !invite.queued) }
                                    }
                                    .buttonStyle(.borderless)
                                    .fontWeight(invite.queued ? .regular : .semibold)
                                    .foregroundStyle(invite.queued ? PL.text400 : PL.cyan)
                                }
                                if invite.name == nil {
                                    // Naming it afterwards. The field is
                                    // optional at creation and easy to
                                    // skip, and the name is what puts
                                    // this coach in the journal picker.
                                    Button("Name") {
                                        namingInvite = invite.id
                                        nameDraft = ""
                                    }
                                    .buttonStyle(.borderless)
                                    .foregroundStyle(PL.cyan)
                                }
                                ShareLink(item: URL(string: "https://www.ponglens.com/coach-invite/\(invite.token)")!) {
                                    Image(systemName: "square.and.arrow.up")
                                }
                                .buttonStyle(.borderless)
                            }
                        }
                    } header: {
                        Text("Waiting to accept")
                    }
                }

                Section {
                    if link == nil {
                        TextField("Their name (optional)", text: $inviteName)
                            .textInputAutocapitalization(.words)
                            .autocorrectionDisabled()
                    }
                    if link == nil {
                        Picker("Share", selection: $scope) {
                            Text("This match").tag("match")
                            Text("All my matches").tag("all")
                        }
                        .pickerStyle(.segmented)
                    }

                    if let link {
                        // The raw URL is gone on purpose. It is two lines
                        // of unreadable hex that nobody retypes, and the
                        // invite is now in Waiting to accept above with
                        // its own share control — so this is only here to
                        // finish the job you just started.
                        ShareLink(item: link) {
                            Text("Send the link")
                        }
                        Toggle("Show QR", isOn: $showQR)
                        if !showQR { inviteSomeoneElse }
                    }
                } header: {
                    // The header has to describe what is in the section.
                    // It said "Invite another coach" over a link that had
                    // just been made, which reads as a second invitation
                    // you did not ask for (Adil, 2026-09-04).
                    Text(link != nil
                         ? "Send this invite"
                         : coaches.isEmpty && pending.isEmpty
                            ? "Invite a coach"
                            : "Invite another coach")
                } footer: {
                    // The code on the sheet under the rows, not a clear
                    // row between them, which cut the section in two with
                    // square ends. Invite someone else follows it.
                    if let link, showQR {
                        QRCodeView(url: link).plFormBlock(top: nil)
                    } else if link != nil {
                        Text("It is waiting above until they open it.")
                    }
                }

                if link != nil, showQR {
                    Section { inviteSomeoneElse } footer: {
                        Text("It is waiting above until they open it.")
                    }
                }

                if link == nil {
                    InviteStarterPackSections(
                        store: starter,
                        // "All my matches" already covers every match, and
                        // a match-scoped invite is about this one.
                        offerMatches: scope != "all",
                        named: !inviteName.trimmingCharacters(in: .whitespaces).isEmpty
                    )

                    Section {} footer: {
                        PLCaptionedBlock {
                            PLSheetActionRow(
                                label: creating ? "Creating…" : "Create invite link",
                                disabled: creating
                            ) {
                                Task { await create() }
                            }
                        } caption: {
                            Text("For a coach you haven't connected yet. They open the link, sign in, and can watch your matches point by point and leave notes.")
                        }
                    }
                    if let errorMessage {
                        Section {
                            Text(errorMessage)
                                .font(.plCaption)
                                .foregroundStyle(PL.dangerText)
                        }
                    }
                }
            }
        }
        .task { await load() }
        .task {
            guard let uid = app.userId, !starter.loaded else { return }
            await starter.load(userId: uid, library: library.matches)
        }
        .alert(
            "Name this invite",
            isPresented: Binding(
                get: { namingInvite != nil },
                set: { if !$0 { namingInvite = nil } }
            )
        ) {
            TextField("Their name", text: $nameDraft)
                .textInputAutocapitalization(.words)
            Button("Cancel", role: .cancel) { namingInvite = nil }
            Button("Save") {
                if let id = namingInvite, let uid = app.userId {
                    let name = nameDraft
                    Task {
                        busyCoach = id
                        await coaching.nameInvite(
                            playerId: uid, inviteId: id, name: name
                        )
                        await load()
                        busyCoach = nil
                    }
                }
                namingInvite = nil
            }
        }
    }

    @ViewBuilder
    /// Back to a fresh invite: the name, the scope and the button again.
    private var inviteSomeoneElse: some View {
        Button("Invite someone else") {
            self.link = nil
            inviteName = ""
            showQR = false
        }
        .foregroundStyle(PL.text400)
    }

    private func coachRow(_ coach: ConnectedCoach) -> some View {
        HStack(spacing: 12) {
            PLRowLabel(
                title: coach.name,
                detail: coach.allMatches
                    ? "Sees all your matches"
                    : coach.matchLinkId != nil
                        ? "Has this match"
                        : coach.otherMatches > 0
                            ? "Has \(coach.otherMatches) other match\(coach.otherMatches == 1 ? "" : "es")"
                            : "Doesn't have this match"
            )
            Spacer(minLength: 8)
            if coach.allMatches {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(PL.cyan)
            } else if busyCoach == coach.id {
                ProgressView().tint(PL.cyan)
            } else if coach.matchLinkId != nil {
                Button("Remove") { Task { await unshare(coach) } }
                    .buttonStyle(.borderless)
                    .foregroundStyle(PL.text400)
            } else {
                Button("Share") { Task { await share(coach) } }
                    .buttonStyle(.borderless)
                    .fontWeight(.semibold)
            }
        }
    }

    // MARK: - Data

    private struct LinkRow: Decodable {
        let id: UUID
        let coach_id: UUID?
        let scope_match_id: UUID?
        let all_matches: Bool
        let status: String
        let invite_token: String
    }
    private struct NameRow: Decodable {
        let id: UUID
        let coach_name: String?
        let coach_email: String?
    }

    private func load() async {
        guard let uid = app.userId else { return }
        async let linksQ: [LinkRow]? = try? await supa
            .from("coach_links")
            .select("id,coach_id,scope_match_id,all_matches,status,invite_token")
            .eq("player_id", value: uid.uuidString.lowercased())
            .neq("status", value: "revoked")
            .execute().value
        async let namesQ: [NameRow]? = try? await supa
            .rpc("player_coach_links").execute().value
        struct QueuedRow: Decodable { let invite_id: UUID }
        struct MatchParam: Encodable { let p_match_id: String }
        let queuedQ: [QueuedRow]? = try? await supa
            .from("coach_invite_matches")
            .select("invite_id")
            .eq("match_id", value: match.id.uuidString.lowercased())
            .execute().value
        let queuedIds = Set((queuedQ ?? []).map(\.invite_id))
        let namedQ: [PlayerCoach]? = try? await supa
            .rpc("player_coaches_list").execute().value
        let namedByInvite = Dictionary(
            (namedQ ?? []).compactMap { row in row.inviteId.map { ($0, row.displayName) } },
            uniquingKeysWith: { first, _ in first }
        )
        let (links, names) = await (linksQ ?? [], namesQ ?? [])
        let nameById = Dictionary(uniqueKeysWithValues: names.map { ($0.id, $0.coach_name ?? $0.coach_email ?? "Coach") })

        var grouped: [UUID: [LinkRow]] = [:]
        for row in links where row.status == "accepted" {
            guard let coachId = row.coach_id else { continue }
            grouped[coachId, default: []].append(row)
        }
        coaches = grouped.map { coachId, rows in
            ConnectedCoach(
                id: coachId,
                name: rows.compactMap { nameById[$0.id] }.first ?? "Coach",
                allMatches: rows.contains { $0.scope_match_id == nil && $0.all_matches },
                matchLinkId: rows.first { $0.scope_match_id == match.id }?.id,
                otherMatches: rows.filter { $0.scope_match_id != nil && $0.scope_match_id != match.id }.count
            )
        }
        .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        pending = links
            .filter { $0.status == "pending" && $0.coach_id == nil }
            .map {
                PendingInvite(
                    id: $0.id,
                    token: $0.invite_token,
                    access: $0.scope_match_id != nil ? "this match"
                        : $0.all_matches ? "all matches" : "matches you share",
                    name: namedByInvite[$0.id],
                    covers: $0.all_matches || $0.scope_match_id == match.id,
                    queued: queuedIds.contains($0.id)
                )
            }
        loaded = true
    }

    /// Line this match up for an invite, or take it back off (166).
    /// Nothing is shared: the row says what the accept should hand over.
    private func queue(_ invite: PendingInvite, on: Bool) async {
        busyCoach = invite.id
        struct Insert: Encodable {
            let invite_id: String
            let match_id: String
        }
        if on {
            _ = try? await supa
                .from("coach_invite_matches")
                .insert(Insert(
                    invite_id: invite.id.uuidString.lowercased(),
                    match_id: match.id.uuidString.lowercased()
                ))
                .execute()
        } else {
            _ = try? await supa
                .from("coach_invite_matches")
                .delete()
                .eq("invite_id", value: invite.id.uuidString.lowercased())
                .eq("match_id", value: match.id.uuidString.lowercased())
                .execute()
        }
        await load()
        busyCoach = nil
    }

    private func share(_ coach: ConnectedCoach) async {
        guard let uid = app.userId else { return }
        busyCoach = coach.id
        struct Insert: Encodable {
            let player_id: String
            let coach_id: String
            let scope_match_id: String
            let status: String
        }
        _ = try? await supa
            .from("coach_links")
            .insert(Insert(
                player_id: uid.uuidString.lowercased(),
                coach_id: coach.id.uuidString.lowercased(),
                scope_match_id: match.id.uuidString.lowercased(),
                status: "accepted"
            ))
            .execute()
        await load()
        busyCoach = nil
    }

    private func unshare(_ coach: ConnectedCoach) async {
        guard let linkId = coach.matchLinkId else { return }
        busyCoach = coach.id
        _ = try? await supa
            .from("coach_links")
            .delete()
            .eq("id", value: linkId.uuidString.lowercased())
            .execute()
        await load()
        busyCoach = nil
    }

    private func create() async {
        guard let uid = app.userId else { return }
        creating = true
        errorMessage = nil
        struct Insert: Encodable {
            let player_id: String
            let scope_match_id: String?
        }
        struct TokenRow: Decodable { let id: UUID; let invite_token: String }
        do {
            let row: TokenRow = try await supa
                .from("coach_links")
                .insert(Insert(
                    player_id: uid.uuidString.lowercased(),
                    scope_match_id: scope == "match" ? match.id.uuidString.lowercased() : nil
                ))
                .select("id,invite_token")
                .single()
                .execute()
                .value
            await coaching.nameInvite(
                playerId: uid, inviteId: row.id, name: inviteName
            )
            await starter.apply(
                userId: uid, inviteId: row.id, includeMatches: scope != "all"
            )
            link = URL(string: "https://www.ponglens.com/coach-invite/\(row.invite_token)")
            await load()
        } catch {
            errorMessage = "Couldn't create the link. Try again."
        }
        creating = false
    }
}

// MARK: - Export

struct ExportSheet: View {
    let match: MatchRow
    let starredCount: Int

    @Environment(\.openURL) private var openURL
    @State private var showScore = true
    @State private var reels: [String: String] = [:] // scope -> status
    @State private var busy: String?

    var body: some View {
        PLSheetScaffold(title: "Export") {
            Form {
                if let notice = ProcessingServiceStore.shared.notice(context: .export) {
                    Section { ProcessingAvailabilityNoticeView(notice: notice) }
                }
                Section {
                    Toggle("Include score", isOn: $showScore)
                }
                Section {
                    exportRow(
                        "Full match",
                        subtitle: showScore ? "Whole match, with scoreboard" : "The playtime video",
                        scope: "full"
                    )
                    exportRow(
                        "Starred points",
                        subtitle: starredCount > 0 ? "Your starred rallies, in order" : "Star points to export them",
                        scope: "starred",
                        disabled: starredCount == 0
                    )
                    rawRow
                }
            }
        }
        .task {
            await loadReels()
        }
    }

    private func exportRow(
        _ title: String, subtitle: String, scope: String, disabled: Bool = false
    ) -> some View {
        let status = reels[scope]
        return HStack(spacing: 12) {
            PLRowLabel(
                title: title, detail: statusLine(status) ?? subtitle, dimmed: disabled
            )
            Spacer(minLength: 8)
            if status == "ready" {
                PLRowAction("Download") {
                    Task { await download(scope: scope) }
                }
            } else if status == "queued" || status == "rendering" {
                Text(ProcessingServiceStore.shared.notice(context: .export) == nil ? "Rendering…" : "Queued")
                    .font(.plCaption)
                    .foregroundStyle(PL.warningText)
            } else {
                PLRowAction(busy == scope ? "…" : "Create", disabled: disabled || busy != nil) {
                    Task { await create(scope: scope) }
                }
            }
        }
    }

    private var rawRow: some View {
        HStack(spacing: 12) {
            PLRowLabel(title: "Raw match", detail: "Your original upload, uncut")
            Spacer(minLength: 8)
            PLRowAction("Download") {
                Task {
                    struct Req: Encodable {
                        let matchId: String
                        let raw: Bool
                    }
                    struct Res: Decodable {
                        let url: String?
                        let available: Bool?
                    }
                    let res: Res? = try? await API.post(
                        "api/media-url",
                        Req(matchId: match.id.uuidString.lowercased(), raw: true)
                    )
                    if let url = res?.url.flatMap(URL.init) { openURL(url) }
                }
            }
        }
    }

    private func statusLine(_ status: String?) -> String? {
        switch status {
        case "queued", "rendering": ProcessingServiceStore.shared.notice(context: .export) == nil ? "Rendering. We'll email you." : "Waiting for video exports to resume."
        case "ready": "Ready"
        case "failed": "Couldn't prepare the video. Try again."
        default: nil
        }
    }

    private func loadReels() async {
        struct ReelRow: Decodable {
            let scope: String
            let status: String
        }
        let rows: [ReelRow]? = try? await supa
            .from("match_reels")
            .select("scope,status")
            .eq("match_id", value: match.id.uuidString.lowercased())
            .execute()
            .value
        if let rows {
            reels = Dictionary(uniqueKeysWithValues: rows.map { ($0.scope, $0.status) })
        }
    }

    private func create(scope: String) async {
        busy = scope
        struct Req: Encodable {
            let matchId: String
            let scope: String
            let showScore: Bool
        }
        struct Res: Decodable { let status: String? }
        let res: Res? = try? await API.post(
            "api/reel",
            Req(matchId: match.id.uuidString.lowercased(), scope: scope, showScore: showScore)
        )
        if let status = res?.status { reels[scope] = status }
        busy = nil
    }

    private func download(scope: String) async {
        struct Req: Encodable {
            let matchId: String
            let reel: Bool
            let scope: String
        }
        struct Res: Decodable { let url: String? }
        let res: Res? = try? await API.post(
            "api/media-url",
            Req(matchId: match.id.uuidString.lowercased(), reel: true, scope: scope)
        )
        if let url = res?.url.flatMap(URL.init) { openURL(url) }
    }
}

// MARK: - Match details editor

/// The app's one details idiom, shared with the record and upload flows:
/// a native Form, typed fields with recent answers behind a chevron, and
/// Done in the toolbar.
///
/// On a processed match it also asks which end the owner played from:
/// Your side used to be a Tools row and a sheet of its own, and is a field
/// here since 2026-09-25 (Adil). Everything that asked for the side opens
/// this sheet now. Not before processing (audit, 2026-09-01): nothing at
/// processing time reads it.
struct MatchDetailsEditor: View {
    let match: MatchRow
    /// Show the Your side field. The processed match page only.
    var asksSide = false
    /// The cut video, for the still the side question is answered from.
    /// Nil asks without a picture, which is the thing to avoid: near/far
    /// is a guess without one, and a wrong answer mirrors every map.
    var videoURL: URL? = nil
    let onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(LibraryStore.self) private var library
    @Environment(AppState.self) private var app
    @State private var opponent: String
    @State private var venue: String
    @State private var matchType: String
    /// "near" or "far", or nil while the match has none. Written on Done,
    /// with the other fields, and only when it changed.
    @State private var side: String?
    @State private var saving = false
    @State private var frame: UIImage?
    @State private var frameFailed = false
    @State private var sideError: String?

    private static let types = ["drills", "practice", "match", "league", "tournament"]

    init(
        match: MatchRow, asksSide: Bool = false, videoURL: URL? = nil,
        onSaved: @escaping () -> Void
    ) {
        self.match = match
        self.asksSide = asksSide
        self.videoURL = videoURL
        self.onSaved = onSaved
        _opponent = State(initialValue: match.opponentName ?? "")
        _venue = State(initialValue: match.venue ?? "")
        _matchType = State(initialValue: match.matchType ?? "")
        _side = State(initialValue: match.userSide)
    }

    var body: some View {
        PLSheetScaffold(
            title: "Match details",
            doneLabel: saving ? "Saving…" : "Done",
            doneDisabled: saving,
            onDone: { Task { await save() } }
        ) {
            Form {
                Section {
                    entryRow(
                        "Opponent", text: $opponent,
                        options: library.recentValues(\.opponentName)
                    )
                    entryRow(
                        "Club or location", text: $venue,
                        options: library.recentValues(\.venue)
                    )
                    Picker("Type", selection: $matchType) {
                        Text("Not set").tag("")
                        ForEach(Self.types, id: \.self) { value in
                            Text(MatchTitle.typeLabel[value] ?? value).tag(value)
                        }
                    }
                }
                if asksSide {
                    sideSections
                }
            }
            .plKeyboardDismiss()
        }
    }

    /// A field you can type into, with the recent answers one tap away
    /// behind the chevron — the record sheet's entryRow.
    private func entryRow(
        _ placeholder: String, text: Binding<String>, options: [String]
    ) -> some View {
        HStack(spacing: 10) {
            TextField(placeholder, text: text)
            if !options.isEmpty {
                Menu {
                    ForEach(options, id: \.self) { value in
                        Button(value) { text.wrappedValue = value }
                    }
                } label: {
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(PL.text400)
                        .frame(width: 30, height: 30)
                        .contentShape(Rectangle())
                }
            }
        }
    }

    private func save() async {
        saving = true
        sideError = nil
        let typedOpponent = opponent.trimmingCharacters(in: .whitespaces)
        let fields: [String: AnyJSON] = [
            "opponent_name": typedOpponent.isEmpty ? .null : .string(typedOpponent),
            "venue": venue.trimmingCharacters(in: .whitespaces).isEmpty
                ? .null : .string(venue.trimmingCharacters(in: .whitespaces)),
            "match_type": matchType.isEmpty ? .null : .string(matchType),
        ]
        _ = try? await supa
            .from("matches")
            .update(fields)
            .eq("id", value: match.id.uuidString.lowercased())
            .execute()
        // After the details, so the side's name-fill reads the opponent
        // as it now stands: the order the two sheets were saved in when
        // they were separate.
        if asksSide, let side, side != match.userSide {
            let typed = typedOpponent != (match.opponentName ?? "")
                .trimmingCharacters(in: .whitespaces)
            guard await saveSide(side, opponent: typedOpponent, opponentTyped: typed) else {
                saving = false
                onSaved()
                return
            }
        }
        saving = false
        onSaved()
        dismiss()
    }

    // MARK: Your side

    /// The still on the sheet itself with the label over it, then the two
    /// choices: the old Your side sheet's layout under a field label.
    /// Without a still the label sits on the choices. The still is a block
    /// in the section's footer slot, not a clear row: a row is clipped to
    /// the section's corners, which cut the frame's own (build 244).
    @ViewBuilder
    private var sideSections: some View {
        if videoURL != nil, !frameFailed {
            Section {} header: {
                Text("Your side")
            } footer: {
                frameView.plFormBlock()
            }
            Section { sideRows }
        } else {
            Section { sideRows } header: {
                Text("Your side")
            }
        }
        if let sideError {
            Section {
                Text(sideError)
                    .font(.plBody)
                    .foregroundStyle(PL.warningText)
            }
        }
    }

    @ViewBuilder
    private var sideRows: some View {
        sideRow("Bottom of video", side: "near")
        sideRow("Top of video", side: "far")
    }

    /// The share sheet's choice row, so the questions the match page asks
    /// look like the same kind of question. The chosen side is marked.
    private func sideRow(_ label: String, side value: String) -> some View {
        PLChoiceRow(
            title: label,
            selected: side == value,
            disabled: saving
        ) {
            side = value
        }
    }

    /// A quarter of the way in, capped at two and a half minutes: the same
    /// rule as the upload sheet's picker, where the first second is two
    /// people walking to the table. Marked Top and Bottom so the rows
    /// under it need no explaining.
    private var frameView: some View {
        ZStack {
            if let frame {
                Image(uiImage: frame)
                    .resizable()
                    .scaledToFit()
            } else {
                Color.clear.frame(height: 200)
                ProgressView().tint(PL.cyan)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(maxHeight: 360)
        .overlay(alignment: .top) { edgeLabel("Top") }
        .overlay(alignment: .bottom) { edgeLabel("Bottom") }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .task(id: videoURL) {
            guard let videoURL else { return }
            let seconds = min(150, (match.durationS ?? 0) * 0.25)
            frame = await ClipFrameLoader.still(from: videoURL, at: max(1, seconds))
            frameFailed = frame == nil
        }
    }

    private func edgeLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(PL.text100)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(PL.ink.opacity(0.75), in: Capsule())
            .padding(8)
    }

    /// The web's chooseSide, column for column (MatchView
    /// handleSetUserSide), unchanged from the Your side sheet: the side,
    /// plus the name-fill — your account name onto your side, the
    /// opponent field onto the other — filling only what is empty, so a
    /// name someone typed is never overwritten. For the same reason an
    /// opponent typed in this sheet is not replaced by the name on the
    /// other end. Errors are SHOWN, not swallowed: an expired session
    /// answers 204 and changes nothing, and fire-and-forget made that look
    /// exactly like a write that worked. Answers whether it landed.
    private func saveSide(_ side: String, opponent opp: String, opponentTyped: Bool) async -> Bool {
        let id = match.id.uuidString.lowercased()
        struct Names: Decodable {
            let playerNearName: String?
            let playerFarName: String?
            enum CodingKeys: String, CodingKey {
                case playerNearName = "player_near_name"
                case playerFarName = "player_far_name"
            }
        }
        let names: Names? = try? await supa
            .from("matches")
            .select("player_near_name, player_far_name")
            .eq("id", value: id)
            .single()
            .execute()
            .value
        let account = app.displayName
        var near = (names?.playerNearName ?? "")
            .trimmingCharacters(in: .whitespaces)
        var far = (names?.playerFarName ?? "")
            .trimmingCharacters(in: .whitespaces)
        if side == "near" {
            if near.isEmpty { near = account }
            if far.isEmpty { far = opp }
        } else {
            if far.isEmpty { far = account }
            if near.isEmpty { near = opp }
        }
        let opponent = (side == "near" ? far : near)
            .trimmingCharacters(in: .whitespaces)
        var fields: [String: AnyJSON] = [
            "user_side": .string(side),
            "player_near_name": near.isEmpty ? .null : .string(near),
            "player_far_name": far.isEmpty ? .null : .string(far),
        ]
        if !opponent.isEmpty, !opponentTyped { fields["opponent_name"] = .string(opponent) }
        do {
            try await supa
                .from("matches")
                .update(fields)
                .eq("id", value: id)
                .execute()
        } catch {
            sideError =
                "That didn't save. Check your connection and try again."
            return false
        }
        return true
    }
}

// MARK: - Raw tools

/// The Tools card for an UNPROCESSED match: the same rows as
/// ToolsSection, minus the ones that need points to exist — Score
/// Keeper, Highlights, Placement and Match analysis appear once
/// processing creates them. A rejected upload (sourceGone) keeps only
/// the rows that don't touch the video. Details editing stays with the
/// screen's own editor (the ellipsis menu opens the same one), so the
/// row hands the tap back rather than mounting a second sheet.
struct RawToolsSection: View {
    let match: MatchRow
    let sourceGone: Bool
    let onEditDetails: () -> Void
    let onScrollToNotes: () -> Void

    @State private var shareOpen = false
    @State private var coachOpen = false
    @State private var exportOpen = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading("Tools")
            VStack(spacing: 0) {
                if !sourceGone {
                    toolRow("Share", trailing: "Not shared") { shareOpen = true }
                    divider
                    toolRow("Coach", trailing: "Invite your coach") { coachOpen = true }
                    divider
                    toolRow("Export", trailing: "Original video") { exportOpen = true }
                    divider
                }
                toolRow("Notes", trailing: "Add a note") { onScrollToNotes() }
                if !sourceGone {
                    divider
                    toolRow("Match details", trailing: detailsTrailing) { onEditDetails() }
                }
                // No "Your side" row before processing (audit, 2026-09-01):
                // nothing at processing time reads it, and everything it
                // orients — maps, Me/Them labels — exists only after
                // processing, where the first-open banner asks anyway.
                divider
                ProcessingToolRow(match: match)
                divider
                FeedbackBoardToolRow(match: match)
            }
            .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            )
        }
        .sheet(isPresented: $shareOpen) {
            ShareLinksSheet(match: match, starredCount: 0, scored: false, processed: false)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $coachOpen) {
            CoachInviteSheet(match: match)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $exportOpen) {
            RawExportSheet(match: match)
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        }
    }

    private var detailsTrailing: String {
        let opp = match.opponentName ?? ""
        let venue = match.venue ?? ""
        if opp.isEmpty && venue.isEmpty { return "Add opponent and venue" }
        return [opp, venue].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private var divider: some View {
        Rectangle().fill(PL.edge.opacity(0.6)).frame(height: 1).padding(.leading, 16)
    }

    private func toolRow(
        _ label: String, trailing: String, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(label)
                    .font(.system(size: 16))
                    .foregroundStyle(PL.textBody)
                Spacer()
                Text(trailing)
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

/// Export before processing: the same door, one artifact — the original
/// upload. Availability is probed on open so a legacy match whose
/// original is gone gets an honest line rather than a button that does
/// nothing (the raw of a live library match never ages out; only
/// pre-commerce matches can have lost theirs).
struct RawExportSheet: View {
    let match: MatchRow

    @Environment(\.openURL) private var openURL
    /// nil while probing; false = the file is gone.
    @State private var available: Bool?
    @State private var busy = false

    var body: some View {
        PLSheetScaffold(title: "Export") {
            Form {
                Section {
                    HStack(spacing: 12) {
                        PLRowLabel(
                            title: "Original video",
                            detail: available == false
                                ? "No longer stored"
                                : "Your upload, as recorded",
                            dimmed: available == false
                        )
                        Spacer(minLength: 8)
                        if available != false {
                            PLRowAction(busy ? "…" : "Download", disabled: available != true || busy) {
                                Task { await download() }
                            }
                        }
                    }
                } footer: {
                    Text("Point clips and rendered videos appear here after processing.")
                }
            }
        }
        .task { await probe() }
    }

    private struct Req: Encodable {
        let matchId: String
        let raw: Bool
    }
    private struct Res: Decodable {
        let url: String?
        let available: Bool?
    }

    private func probe() async {
        let res: Res? = try? await API.post(
            "api/media-url",
            Req(matchId: match.id.uuidString.lowercased(), raw: true)
        )
        available = res?.available ?? (res?.url != nil)
    }

    private func download() async {
        busy = true
        let res: Res? = try? await API.post(
            "api/media-url",
            Req(matchId: match.id.uuidString.lowercased(), raw: true)
        )
        if let url = res?.url.flatMap(URL.init) { openURL(url) }
        busy = false
    }
}

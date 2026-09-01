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
    let onScrollToPlacement: () -> Void

    @Environment(AppState.self) private var app
    @Environment(LibraryStore.self) private var library
    @State private var shareOpen = false
    @State private var highlightsOpen = false
    @State private var coachOpen = false
    @State private var exportOpen = false
    @State private var analysisOpen = false
    @State private var detailsOpen = false
    @State private var sideOpen = false
    @State private var placementOpen = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading("Tools")
            VStack(spacing: 0) {
                // Score Keeper's whole job is assigning a winner to each
                // point to build a score. Drills have no score, so the row
                // is not a disabled control, it is absent. Watching,
                // tagging, starring and noting all stay: they are the
                // reason to film a practice session at all.
                if MatchTitle.tracksServe(match.matchType) {
                    toolRow("Score Keeper", trailing: gamesTrailing) { onOpenPlayer() }
                    divider
                }
                toolRow("Highlights", trailing: .text(highlightsTrailing)) {
                    highlightsOpen = true
                }
                divider
                toolRow("Share", trailing: .text("Not shared")) { shareOpen = true }
                divider
                toolRow("Coach", trailing: .text("Invite your coach")) { coachOpen = true }
                divider
                toolRow("Export", trailing: .text(starredCount > 0 ? "★ \(starredCount) starred" : "Video & clips")) { exportOpen = true }
                divider
                toolRow(
                    app.placementServesOnly ? "Serve placement" : "Placement maps",
                    trailing: .text(placementTrailing), beta: true
                ) {
                    // Ready means there is something to scroll to; every
                    // other state needs the sheet, which is the only place
                    // generation can actually be started.
                    if match.placementStatus == "ready" {
                        onScrollToPlacement()
                    } else {
                        placementOpen = true
                    }
                }
                // Every number in the analysis derives from a confirmed
                // score, and practice never collects one — for it the
                // sheet could only ever say "score a full game", which is
                // an instruction to do the one thing practice removed.
                if MatchTitle.tracksServe(match.matchType) {
                    divider
                    toolRow("Match analysis", trailing: .text(analysisTrailing)) { analysisOpen = true }
                }
                divider
                toolRow("Notes", trailing: .text("Add a note")) { onScrollToNotes() }
                divider
                toolRow("Match details", trailing: .text(detailsTrailing)) { detailsOpen = true }
                divider
                toolRow("Your side", trailing: .text(sideTrailing)) { sideOpen = true }
                divider
                NavigationLink(value: "feedback:\(match.id.uuidString.lowercased())") {
                    HStack {
                        Text("Report an issue")
                            .font(.system(size: 16))
                            .foregroundStyle(PL.textBody)
                        Spacer()
                        Text("Something look off?")
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
                scored: score.confirmedCount > 0
            )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $highlightsOpen) {
            HighlightsSheet(match: match, model: model)
                .presentationDetents([.height(HighlightsSheet.detentHeight)])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $coachOpen) {
            CoachInviteSheet(match: match)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $exportOpen) {
            ExportSheet(match: match, starredCount: starredCount)
                .presentationDetents([.medium, .large])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $analysisOpen) {
            AnalysisSheet(match: match, model: model, score: score)
                .presentationDetents([.large])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $detailsOpen) {
            MatchDetailsEditor(match: match) {
                Task { await library.load() }
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $sideOpen) {
            YourSideSheet(match: match) {
                Task { await library.load() }
            }
            .presentationDetents([.medium])
            .presentationBackground(PL.surface)
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $placementOpen) {
            PlacementRequestSheet(match: match) {
                Task { await library.load() }
            }
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
        }
    }

    /// The trailing summary is the reel cut — the flagship of the three.
    private var highlightsTrailing: String {
        let picks = Highlights.pick(
            model.visible,
            pad: clipPad(strictness: nil, stored: match.clipPads),
            budgetS: Highlights.reelBudgetS,
            ends: app.endOptions)
        return Highlights.summary(picks) ?? "No rallies yet"
    }

    private var starredCount: Int {
        model.visible.filter(\.starred).count
    }

    private var gamesTrailing: Trailing {
        score.confirmedCount > 0 ? .games(score.gamesYou, score.gamesThem) : .text("")
    }

    private var placementTrailing: String {
        switch match.placementStatus {
        case "ready": "Ready"
        case "processing": "Generating…"
        case "retrying": "Retrying…"
        case "retry_available": "Try again"
        case "final_failed": "Unavailable"
        default: "Generate"
        }
    }

    /// The web's own summary: readiness first, then completeness. A bare
    /// percentage here would read as a number the app invented.
    private var analysisTrailing: String {
        let serving = computeServing(
            model.visible, firstServer: match.firstServer.flatMap(Winner.init(rawValue:))
        )
        return statsRowSummary(
            computeMatchStats(model.visible, serving: serving, score: score)
        )
    }

    private var detailsTrailing: String {
        let opp = match.opponentName ?? ""
        let venue = match.venue ?? ""
        if opp.isEmpty && venue.isEmpty { return "Add opponent and venue" }
        return [opp, venue].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private var sideTrailing: String {
        switch match.userSide {
        case "near": "Bottom of video"
        case "far": "Top of video"
        default: "Set your side"
        }
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

    @Environment(\.dismiss) private var dismiss
    @State private var scope = "match"
    /// One link per scope: the API is idempotent, and switching back
    /// should show the link you already made rather than mint again.
    @State private var links: [String: URL] = [:]
    @State private var creating = false
    @State private var errorMessage: String?
    @State private var showQR = false
    @State private var copied = false
    /// Whether the shared page draws the running score over the video.
    /// An overlay on the page, not burnt into the file, so changing it
    /// takes effect on a link somebody already has.
    @State private var showScore = true

    private var link: URL? { links[scope] }
    private var starredEmpty: Bool { scope == "starred" && starredCount == 0 }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Share", selection: $scope) {
                        Text("This match").tag("match")
                        Text("Starred points").tag("starred")
                    }
                    .pickerStyle(.segmented)
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
                if scope == "match", scored {
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
                        if showQR {
                            QRCodeView(url: link)
                                .listRowBackground(Color.clear)
                        }
                    }
                } else if !starredEmpty {
                    Section {
                        Button(creating ? "Creating…" : "Create the link") {
                            Task { await mint() }
                        }
                        .disabled(creating)
                        if let errorMessage {
                            Text(errorMessage)
                                .font(.plCaption)
                                .foregroundStyle(PL.dangerText)
                        }
                    }
                }
            }
            .tint(PL.cyan)
            .onChange(of: showScore) { _, _ in
                // The route is idempotent and applies the choice on the
                // reuse path, so this updates the link already out there
                // rather than minting a second one.
                guard scope == "match", links["match"] != nil else { return }
                Task { await mint() }
            }
            .navigationTitle("Share")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
        }
        .preferredColorScheme(.dark)
        .onChange(of: scope) { _, _ in
            // The QR belongs to the link on screen, so a switch closes it.
            showQR = false
            copied = false
            errorMessage = nil
        }
    }

    private var scopeFooter: String {
        if scope == "starred" {
            return starredCount == 0
                ? "Star points to share them as a set."
                : "The \(starredCount) points you have starred, and it keeps up as you star more. Anyone with the link can watch."
        }
        if !processed {
            return "The whole match, as uploaded. Anyone with the link can watch, and you can revoke it anytime from your account."
        }
        return "The whole match, cut to the play. Anyone with the link can watch, and you can revoke it anytime from your account."
    }

    private struct MintResponse: Decodable { let url: String }

    private func mint() async {
        creating = true
        errorMessage = nil
        let id = match.id.uuidString.lowercased()
        let res: MintResponse?
        if scope == "starred" {
            struct Req: Encodable {
                let matchId: String
                let kind: String
            }
            res = try? await API.post("api/share", Req(matchId: id, kind: "starred"))
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
            links[scope] = url
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
        NavigationStack {
            Form {
                Section {
                    if started {
                        Label(
                            "Started. We'll email you when they're ready.",
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
                    } else if let actionLabel {
                        Button(submitting ? "Starting…" : actionLabel) {
                            Task { await request() }
                        }
                        .disabled(submitting)
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
            .tint(PL.cyan)
            .navigationTitle("Placement maps")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    /// A run is already in flight; the sheet reports rather than offers.
    private var running: Bool {
        status == "processing" || status == "retrying"
    }

    private var body_: String {
        switch status {
        case "processing", "retrying":
            "Placement maps are generating. We'll email you when they're ready."
        case "retry_available":
            "Placement maps couldn't be generated because the table was hard to detect in this video. You can try once more."
        case "final_failed":
            "Placement maps couldn't be generated for this video."
        default:
            "Placement maps haven't been generated for this match yet."
        }
    }

    /// nil while a run is in flight or the match is past retrying.
    private var actionLabel: String? {
        switch status {
        case "retry_available": "Try placement again"
        case "processing", "retrying", "final_failed": nil
        default: "Generate placement maps"
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

struct CoachInviteSheet: View {
    let match: MatchRow

    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var scope = "match"
    @State private var link: URL?
    @State private var creating = false
    @State private var errorMessage: String?
    @State private var showQR = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Share", selection: $scope) {
                        Text("This match").tag("match")
                        Text("All my matches").tag("all")
                    }
                    .pickerStyle(.segmented)
                    .disabled(link != nil)
                } footer: {
                    Text("They can watch your matches, point by point, and leave coach notes.")
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
                        Toggle("Show QR", isOn: $showQR)
                        if showQR {
                            QRCodeView(url: link)
                                .listRowBackground(Color.clear)
                        }
                    }
                } else {
                    Section {
                        Button(creating ? "Creating…" : "Create invite link") {
                            Task { await create() }
                        }
                        .disabled(creating)
                        if let errorMessage {
                            Text(errorMessage)
                                .font(.plCaption)
                                .foregroundStyle(PL.dangerText)
                        }
                    }
                }
            }
            .tint(PL.cyan)
            .navigationTitle("Share with coach")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private func create() async {
        guard let uid = app.userId else { return }
        creating = true
        errorMessage = nil
        struct Insert: Encodable {
            let player_id: String
            let scope_match_id: String?
        }
        struct TokenRow: Decodable { let invite_token: String }
        do {
            let row: TokenRow = try await supa
                .from("coach_links")
                .insert(Insert(
                    player_id: uid.uuidString.lowercased(),
                    scope_match_id: scope == "match" ? match.id.uuidString.lowercased() : nil
                ))
                .select("invite_token")
                .single()
                .execute()
                .value
            link = URL(string: "https://www.ponglens.com/coach-invite/\(row.invite_token)")
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
    @State private var instagramOpen = false
    /// The emergency switch (136); an unreadable row answers "on".
    @State private var sharingOn = true

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Export")
                .font(.plCardTitle)
                .foregroundStyle(PL.text100)

            Toggle("Include score", isOn: $showScore)
                .font(.plBody)
                .foregroundStyle(PL.text200)
                .tint(PL.cyan.opacity(0.5))

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
            if sharingOn {
                instagramRow
            }
            rawRow
            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .task {
            sharingOn = await StoryShareModel.sharingEnabled()
            await loadReels()
        }
        .sheet(isPresented: $instagramOpen) {
            ShareHighlightsSheet(match: match, starredCount: starredCount)
                .presentationDetents([.height(ShareHighlightsSheet.detentHeight)])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
    }

    /// The starred rallies as one 9:16 video, handed straight to
    /// Instagram — the vertical sibling of the row above, rendered on the
    /// worker like every other stitched export.
    private var instagramRow: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Instagram Reel").font(.plRowTitle)
                    .foregroundStyle(starredCount > 0 ? PL.text100 : PL.text500)
                Text(starredCount > 0
                     ? "Your starred rallies, back to back"
                     : "Star points to share them")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
            }
            Spacer()
            Button("Share") { instagramOpen = true }
                .buttonStyle(PLSecondaryButtonStyle())
                .disabled(starredCount == 0)
        }
        .plInnerRow()
    }

    private func exportRow(
        _ title: String, subtitle: String, scope: String, disabled: Bool = false
    ) -> some View {
        let status = reels[scope]
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.plRowTitle).foregroundStyle(disabled ? PL.text500 : PL.text100)
                Text(statusLine(status) ?? subtitle)
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
            }
            Spacer()
            if status == "ready" {
                Button("Download") {
                    Task { await download(scope: scope) }
                }
                .buttonStyle(PLCyanGhostButtonStyle())
            } else if status == "queued" || status == "rendering" {
                Text("Rendering…")
                    .font(.plCaption)
                    .foregroundStyle(PL.warningText)
            } else {
                Button(busy == scope ? "…" : "Create") {
                    Task { await create(scope: scope) }
                }
                .buttonStyle(PLSecondaryButtonStyle())
                .disabled(disabled || busy != nil)
            }
        }
        .plInnerRow()
    }

    private var rawRow: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Raw match").font(.plRowTitle).foregroundStyle(PL.text100)
                Text("Your original upload, uncut")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
            }
            Spacer()
            Button("Download") {
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
            .buttonStyle(PLSecondaryButtonStyle())
        }
        .plInnerRow()
    }

    private func statusLine(_ status: String?) -> String? {
        switch status {
        case "queued", "rendering": "Rendering. We'll email you."
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
struct MatchDetailsEditor: View {
    let match: MatchRow
    let onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(LibraryStore.self) private var library
    @State private var opponent: String
    @State private var venue: String
    @State private var matchType: String
    @State private var saving = false

    private static let types = ["drills", "practice", "match", "league", "tournament"]

    init(match: MatchRow, onSaved: @escaping () -> Void) {
        self.match = match
        self.onSaved = onSaved
        _opponent = State(initialValue: match.opponentName ?? "")
        _venue = State(initialValue: match.venue ?? "")
        _matchType = State(initialValue: match.matchType ?? "")
    }

    var body: some View {
        NavigationStack {
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
            }
            .tint(PL.cyan)
            .navigationTitle("Match details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Done") {
                        Task { await save() }
                    }
                    .fontWeight(.semibold)
                    .disabled(saving)
                }
            }
            .plKeyboardDismiss()
        }
        .preferredColorScheme(.dark)
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
        let fields: [String: AnyJSON] = [
            "opponent_name": opponent.trimmingCharacters(in: .whitespaces).isEmpty
                ? .null : .string(opponent.trimmingCharacters(in: .whitespaces)),
            "venue": venue.trimmingCharacters(in: .whitespaces).isEmpty
                ? .null : .string(venue.trimmingCharacters(in: .whitespaces)),
            "match_type": matchType.isEmpty ? .null : .string(matchType),
        ]
        _ = try? await supa
            .from("matches")
            .update(fields)
            .eq("id", value: match.id.uuidString.lowercased())
            .execute()
        saving = false
        onSaved()
        dismiss()
    }
}

// MARK: - Your side

struct YourSideSheet: View {
    let match: MatchRow
    let onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Which player are you?")
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                Text("So your labels and placement maps come out right.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
            }

            HStack(spacing: 10) {
                sideButton("Bottom of video", side: "near")
                sideButton("Top of video", side: "far")
            }
            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func sideButton(_ label: String, side: String) -> some View {
        let active = match.userSide == side
        return Button {
            Task {
                saving = true
                _ = try? await supa
                    .from("matches")
                    .update(["user_side": AnyJSON.string(side)])
                    .eq("id", value: match.id.uuidString.lowercased())
                    .execute()
                saving = false
                onSaved()
                dismiss()
            }
        } label: {
            Text(label)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(active ? PL.cyan : PL.text300)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(
                    active ? PL.cyan.opacity(0.12) : PL.ink.opacity(0.4),
                    in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                        .strokeBorder(active ? PL.cyan.opacity(0.7) : PL.edge, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .disabled(saving)
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

    @Environment(LibraryStore.self) private var library
    @State private var shareOpen = false
    @State private var coachOpen = false
    @State private var exportOpen = false
    @State private var sideOpen = false

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
                    divider
                    toolRow("Your side", trailing: sideTrailing) { sideOpen = true }
                }
                divider
                NavigationLink(value: "feedback:\(match.id.uuidString.lowercased())") {
                    HStack {
                        Text("Report an issue")
                            .font(.system(size: 16))
                            .foregroundStyle(PL.textBody)
                        Spacer()
                        Text("Something look off?")
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
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $sideOpen) {
            YourSideSheet(match: match) {
                Task { await library.load() }
            }
            .presentationDetents([.medium])
            .presentationBackground(PL.surface)
            .presentationDragIndicator(.visible)
        }
    }

    private var detailsTrailing: String {
        let opp = match.opponentName ?? ""
        let venue = match.venue ?? ""
        if opp.isEmpty && venue.isEmpty { return "Add opponent and venue" }
        return [opp, venue].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private var sideTrailing: String {
        switch match.userSide {
        case "near": "Bottom of video"
        case "far": "Top of video"
        default: "Set your side"
        }
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
        VStack(alignment: .leading, spacing: 16) {
            Text("Export")
                .font(.plCardTitle)
                .foregroundStyle(PL.text100)
            Text("Point clips and rendered videos appear here after processing.")
                .font(.plBody)
                .foregroundStyle(PL.text400)

            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Original video")
                        .font(.plRowTitle)
                        .foregroundStyle(available == false ? PL.text500 : PL.text100)
                    Text(available == false
                         ? "No longer stored"
                         : "Your upload, as recorded")
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                }
                Spacer()
                if available != false {
                    Button(busy ? "…" : "Download") {
                        Task { await download() }
                    }
                    .buttonStyle(PLSecondaryButtonStyle())
                    .disabled(available != true || busy)
                }
            }
            .plInnerRow()
            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
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

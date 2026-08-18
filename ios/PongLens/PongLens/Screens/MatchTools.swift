import CoreImage.CIFilterBuiltins
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
    @State private var coachOpen = false
    @State private var exportOpen = false
    @State private var analysisOpen = false
    @State private var detailsOpen = false
    @State private var sideOpen = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading("Tools")
            VStack(spacing: 0) {
                toolRow("Score Keeper", trailing: gamesTrailing) { onOpenPlayer() }
                divider
                toolRow("Share", trailing: .text("Not shared")) { shareOpen = true }
                divider
                toolRow("Coach", trailing: .text("Invite your coach")) { coachOpen = true }
                divider
                toolRow("Export", trailing: .text(starredCount > 0 ? "★ \(starredCount) starred" : "Video & clips")) { exportOpen = true }
                divider
                toolRow("Placement maps", trailing: .text(placementTrailing), beta: true) { onScrollToPlacement() }
                divider
                toolRow("Match analysis", trailing: .text(analysisTrailing)) { analysisOpen = true }
                divider
                toolRow("Notes", trailing: .text("Add a note")) { onScrollToNotes() }
                divider
                toolRow("Match details", trailing: .text(detailsTrailing)) { detailsOpen = true }
                divider
                toolRow("Your side", trailing: .text(sideTrailing)) { sideOpen = true }
                divider
                NavigationLink(value: "feedback") {
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
            ShareLinksSheet(match: match, starredCount: starredCount)
                .presentationDetents([.medium])
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

    private var analysisTrailing: String {
        let n = score.confirmedCount
        if n == 0 { return "Score points to unlock" }
        if score.games.isEmpty { return "Finish a game to unlock" }
        return "\(n) scored · add detail"
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

struct ShareLinksSheet: View {
    let match: MatchRow
    let starredCount: Int

    @State private var shareURL: URL?
    @State private var creating: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Share")
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                Text("Anyone with the link can watch. Revoke it anytime from your account.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
            }

            shareRow(
                "This match", subtitle: "Public link · the whole match",
                icon: "play.rectangle", key: "match"
            ) {
                struct Req: Encodable { let matchId: String }
                await mint(key: "match", body: Req(matchId: match.id.uuidString.lowercased()))
            }

            if starredCount > 0 {
                shareRow(
                    "Starred points (\(starredCount))",
                    subtitle: "Public link · updates as you star",
                    icon: "star", key: "starred"
                ) {
                    struct Req: Encodable {
                        let matchId: String
                        let kind: String
                    }
                    await mint(key: "starred", body: Req(matchId: match.id.uuidString.lowercased(), kind: "starred"))
                }
            } else {
                HStack(spacing: 12) {
                    Image(systemName: "star")
                        .font(.system(size: 15))
                        .foregroundStyle(PL.text600)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Starred points")
                            .font(.plRowTitle)
                            .foregroundStyle(PL.text500)
                        Text("Star points to share them as a set.")
                            .font(.plCaption)
                            .foregroundStyle(PL.text600)
                    }
                }
                .padding(14)
            }
            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .sheet(item: $shareURL) { url in
            ActivityView(items: [url])
                .presentationDetents([.medium])
        }
    }

    private func shareRow(
        _ title: String, subtitle: String, icon: String, key: String,
        mintAction: @escaping () async -> Void
    ) -> some View {
        Button {
            Task { await mintAction() }
        } label: {
            HStack(spacing: 12) {
                Circle()
                    .fill(PL.cyan.opacity(0.1))
                    .frame(width: 36, height: 36)
                    .overlay(Circle().strokeBorder(PL.cyan.opacity(0.4), lineWidth: 1))
                    .overlay(
                        Image(systemName: icon)
                            .font(.system(size: 14))
                            .foregroundStyle(PL.cyan)
                    )
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.plRowTitle).foregroundStyle(PL.text100)
                    Text(creating == key ? "Creating link…" : subtitle)
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PL.text600)
            }
            .plInnerRow()
        }
        .buttonStyle(.plain)
        .disabled(creating != nil)
    }

    private struct MintResponse: Decodable { let url: String }

    private func mint(key: String, body: some Encodable) async {
        creating = key
        let res: MintResponse? = try? await API.post("api/share", body)
        creating = nil
        if let url = res.flatMap({ URL(string: $0.url) }) {
            shareURL = url
        }
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
                            qrCard(link)
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

    /// The invite as a QR on a white card, for the coach standing next to
    /// you — camera apps need the quiet zone the card provides.
    private func qrCard(_ link: URL) -> some View {
        VStack(spacing: 10) {
            if let image = Self.qrImage(link.absoluteString) {
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .frame(width: 160, height: 160)
                    .accessibilityLabel("QR code for the invite link")
            }
            Text("Scan to open")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color(hex: 0x3F3F46))
        }
        .padding(16)
        .frame(maxWidth: .infinity)
        .background(Color.white, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private static func qrImage(_ string: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 8, y: 8))
        guard let cg = CIContext().createCGImage(scaled, from: scaled.extent) else {
            return nil
        }
        return UIImage(cgImage: cg)
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
            rawRow
            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .task { await loadReels() }
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

// MARK: - Analysis (overview numbers)

struct AnalysisSheet: View {
    let match: MatchRow
    let model: MatchDetailModel
    let score: MatchScore

    var body: some View {
        let serving = computeServing(
            model.visible, firstServer: match.firstServer.flatMap(Winner.init(rawValue:))
        )
        let scored = model.visible.filter { !$0.isLet && $0.confirmedWinner != nil }
        let won = scored.filter { $0.confirmedWinner == .user }
        let served = scored.filter { serving[$0.id]?.server == .user }
        let received = scored.filter { serving[$0.id]?.server == .opponent }
        let serveWon = served.filter { $0.confirmedWinner == .user }
        let receiveWon = received.filter { $0.confirmedWinner == .user }

        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Match analysis")
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)

                if scored.isEmpty {
                    Text("Score points to unlock the analysis.")
                        .font(.plBody)
                        .foregroundStyle(PL.text400)
                } else {
                    statRow("Points won–lost", "\(won.count)–\(scored.count - won.count)")
                    if !served.isEmpty {
                        statRow("Serve win %", "\(Int((Double(serveWon.count) / Double(served.count) * 100).rounded()))% · \(serveWon.count)/\(served.count)")
                    }
                    if !received.isEmpty {
                        statRow("Receive win %", "\(Int((Double(receiveWon.count) / Double(received.count) * 100).rounded()))% · \(receiveWon.count)/\(received.count)")
                    }
                    statRow("Best run of points", "\(bestRun(scored)) in a row")
                    statRow("Games won", "\(score.gamesYou)–\(score.gamesThem)")
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func bestRun(_ scored: [MatchPoint]) -> Int {
        var best = 0, run = 0
        for p in scored {
            if p.confirmedWinner == .user {
                run += 1
                best = max(best, run)
            } else {
                run = 0
            }
        }
        return best
    }

    private func statRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.plBody).foregroundStyle(PL.text300)
            Spacer()
            Text(value).font(.system(size: 14, weight: .semibold)).monospacedDigit().foregroundStyle(PL.text100)
        }
        .plInnerRow()
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

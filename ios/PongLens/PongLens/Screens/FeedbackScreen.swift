import SwiftUI
import Supabase

/// One row of the public feedback board, straight from `feedback_board`.
///
/// The RPC decides what each caller may see: private rows and their
/// screenshots reach only their author and the admin, so there is nothing
/// to filter here beyond what arrives.
struct FeedbackItem: Decodable, Identifiable {
    let id: UUID
    let userId: UUID
    let title: String
    let body: String
    let type: String
    let status: String
    var voteCount: Int
    let createdAt: String
    let authorName: String?
    let authorAvatar: String?
    var voted: Bool
    let hidden: Bool?

    enum CodingKeys: String, CodingKey {
        case id, title, body, type, status, voted, hidden
        case userId = "user_id"
        case voteCount = "vote_count"
        case createdAt = "created_at"
        case authorName = "author_name"
        case authorAvatar = "author_avatar"
    }

    var isDone: Bool { status == "done" || status == "declined" }
}

/// The feedback board, and the box that adds to it.
///
/// This used to be the box alone: a screen whose entire content was a text
/// field and a Send button, so posting felt like dropping something into a
/// hole. Everything the web has shown for months — what other people asked
/// for, what is being built, what has shipped — was simply missing here,
/// which also meant the same idea got sent twice with no way to notice.
///
/// So the board IS the screen, and writing is a sheet raised from the
/// corner button. That is the app's own idiom (the journal's New entry
/// works exactly this way) and it puts Send in a sheet's commit slot, top
/// right, instead of floating in the middle of a page.
struct FeedbackScreen: View {
    var matchId: UUID?

    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app

    @State private var items: [FeedbackItem] = []
    @State private var sort = "top"
    @State private var loading = true
    @State private var loadFailed = false
    @State private var doneOpen = false
    @State private var composeOpen = false
    @State private var justPosted = false

    private var active: [FeedbackItem] { items.filter { !$0.isDone } }
    private var finished: [FeedbackItem] { items.filter(\.isDone) }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            ArenaBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Button { dismiss() } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 12, weight: .semibold))
                            Text("Back")
                        }
                    }
                    .buttonStyle(PLSecondaryButtonStyle())

                    Text("Feedback")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)

                    Picker("", selection: $sort) {
                        Text("Top").tag("top")
                        Text("New").tag("new")
                    }
                    .pickerStyle(.segmented)

                    if justPosted {
                        HStack(spacing: 10) {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(PL.successText)
                            Text("Posted. Others can upvote it now.")
                                .font(.plBody)
                                .foregroundStyle(PL.text200)
                            Spacer(minLength: 0)
                        }
                        .plCard(padding: 14)
                    }

                    if loading {
                        VStack(spacing: 12) {
                            ForEach(0..<3, id: \.self) { _ in
                                VStack(alignment: .leading, spacing: 10) {
                                    PLSkeletonBar(maxWidth: 220)
                                    PLSkeletonBar()
                                    PLSkeletonBar(maxWidth: 160)
                                }
                                .plCard(padding: 16)
                            }
                        }
                        .plShimmer()
                    } else if loadFailed {
                        emptyCard(
                            "Couldn't load the board.",
                            detail: "Your feedback still sends."
                        )
                    } else if items.isEmpty {
                        emptyCard(
                            "Nothing here yet.",
                            detail: "Be the first to post something."
                        )
                    } else {
                        ForEach(active) { item in
                            card(item)
                        }
                        if !finished.isEmpty {
                            doneSection
                        }
                    }
                }
                .padding(20)
                .padding(.bottom, 120)
            }
            .refreshable { await load() }

            PLFab(label: "New feedback", systemImage: "plus") {
                composeOpen = true
            }
            .padding(20)
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { await load() }
        .onChange(of: sort) { _, _ in Task { await load() } }
        .sheet(isPresented: $composeOpen) {
            FeedbackComposer(matchId: matchId) {
                justPosted = true
                Task { await load() }
            }
        }
    }

    // MARK: - Rows

    /// Vote on the left, the words in the middle. The count is the reason
    /// the board exists — it is what tells someone their idea is already
    /// here and already wanted, so it reads before the text does.
    private func card(_ item: FeedbackItem) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Button { Task { await vote(item) } } label: {
                VStack(spacing: 2) {
                    Image(systemName: "chevron.up")
                        .font(.system(size: 12, weight: .bold))
                    Text("\(item.voteCount)")
                        .font(.system(size: 14, weight: .semibold))
                        .monospacedDigit()
                }
                .foregroundStyle(item.voted ? PL.cyan : PL.text400)
                .frame(width: 46, height: 48)
                .background(
                    item.voted ? PL.cyan.opacity(0.12) : PL.ink.opacity(0.4),
                    in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(
                            item.voted ? PL.cyan.opacity(0.5) : PL.edge,
                            lineWidth: 1
                        )
                )
            }
            .buttonStyle(.plain)
            .accessibilityLabel(item.voted ? "Remove your vote" : "Vote for this")

            VStack(alignment: .leading, spacing: 6) {
                Text(item.title)
                    .font(.plRowTitle)
                    .foregroundStyle(PL.text100)
                    .fixedSize(horizontal: false, vertical: true)
                if !item.body.isEmpty, item.body != item.title {
                    Text(item.body)
                        .font(.plBody)
                        .foregroundStyle(PL.text400)
                        .lineLimit(4)
                        .lineSpacing(2)
                }
                HStack(spacing: 8) {
                    chip(typeLabel(item.type), tint: typeTint(item.type))
                    if let status = statusLabel(item.status) {
                        chip(status, tint: PL.text400)
                    }
                    Text(authorLine(item))
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 16)
    }

    private var doneSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                withAnimation(.easeOut(duration: 0.18)) { doneOpen.toggle() }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .rotationEffect(.degrees(doneOpen ? 90 : 0))
                    Text("Done (\(finished.count))")
                        .font(.plSection)
                        .tracking(0.6)
                    Spacer()
                }
                .foregroundStyle(PL.text500)
            }
            .buttonStyle(.plain)
            if doneOpen {
                ForEach(finished) { card($0) }
            }
        }
        .padding(.top, 4)
    }

    private func chip(_ text: String, tint: Color) -> some View {
        Text(text)
            .font(.plMicro)
            .foregroundStyle(tint)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(tint.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(tint.opacity(0.35), lineWidth: 1))
    }

    private func emptyCard(_ title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.plRowTitle)
                .foregroundStyle(PL.text200)
            Text(detail)
                .font(.plBody)
                .foregroundStyle(PL.text500)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 20)
    }

    // MARK: - Labels

    private func typeLabel(_ type: String) -> String {
        switch type {
        case "bug": "Bug"
        case "idea": "Idea"
        case "improvement": "Improvement"
        default: "Private"
        }
    }

    private func typeTint(_ type: String) -> Color {
        switch type {
        case "bug": PL.dangerText
        case "idea": PL.cyan
        case "improvement": PL.warningText
        default: PL.text400
        }
    }

    /// Only the states worth naming. "Open" on every row is noise: it is
    /// what a board item is unless something says otherwise.
    private func statusLabel(_ status: String) -> String? {
        switch status {
        case "planned": "Planned"
        case "building": "Building"
        case "done": "Done"
        case "declined": "Declined"
        default: nil
        }
    }

    private func authorLine(_ item: FeedbackItem) -> String {
        let who = (item.authorName ?? "").trimmingCharacters(in: .whitespaces)
        let name = item.userId == app.userId ? "You" : (who.isEmpty ? "A player" : who)
        guard let date = PGDate.parse(item.createdAt) else { return name }
        return "\(name) · \(ago(date))"
    }

    /// "3m", "5h", "2d", then a date — the board's own scale.
    private func ago(_ date: Date) -> String {
        let seconds = Date().timeIntervalSince(date)
        if seconds < 3600 { return "\(max(1, Int(seconds / 60)))m" }
        if seconds < 86_400 { return "\(Int(seconds / 3600))h" }
        if seconds < 7 * 86_400 { return "\(Int(seconds / 86_400))d" }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }

    // MARK: - Data

    private func load() async {
        loadFailed = false
        struct Req: Encodable { let p_sort: String }
        do {
            items = try await supa.rpc("feedback_board", params: Req(p_sort: sort))
                .execute().value
        } catch {
            loadFailed = true
        }
        loading = false
    }

    /// Optimistic: the count moves under the thumb and settles on whatever
    /// the server says. A vote that waits for a round trip reads as a tap
    /// that missed, and people tap again.
    private func vote(_ item: FeedbackItem) async {
        guard let index = items.firstIndex(where: { $0.id == item.id }) else { return }
        let wasVoted = items[index].voted
        let wasCount = items[index].voteCount
        items[index].voted = !wasVoted
        items[index].voteCount = max(0, wasCount + (wasVoted ? -1 : 1))
        struct Req: Encodable { let p_item: String }
        struct Res: Decodable {
            let voteCount: Int
            let voted: Bool
            enum CodingKeys: String, CodingKey {
                case voteCount = "vote_count"
                case voted
            }
        }
        let rows: [Res]? = try? await supa
            .rpc("feedback_toggle_vote", params: Req(p_item: item.id.uuidString.lowercased()))
            .execute().value
        guard let i = items.firstIndex(where: { $0.id == item.id }) else { return }
        guard let truth = rows?.first else {
            // The write did not land: put the row back rather than leave a
            // number that disagrees with the server.
            items[i].voted = wasVoted
            items[i].voteCount = wasCount
            return
        }
        items[i].voted = truth.voted
        items[i].voteCount = truth.voteCount
    }

}

// MARK: - Composer

/// Writing a piece of feedback. A sheet, so Send sits where a sheet's
/// commit action always sits and the board stays behind it.
private struct FeedbackComposer: View {
    let matchId: UUID?
    let onPosted: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    @Environment(LibraryStore.self) private var library

    @State private var body_ = ""
    @State private var pickedMatch: UUID?
    @State private var sending = false
    @State private var errorMessage: String?

    var body: some View {
        PLSheetScaffold(
            title: "New feedback",
            doneLabel: sending ? "Sending…" : "Send",
            doneDisabled: sending || body_.trimmingCharacters(in: .whitespaces).isEmpty,
            onDone: { Task { await send() } }
        ) {
            Form {
                Section {
                    TextField("A bug, an idea, anything.", text: $body_, axis: .vertical)
                        .lineLimit(5...14)
                }

                Section {
                    // A real picker over the whole library, not a handful
                    // of chips.
                    Picker("Match", selection: $pickedMatch) {
                        Text("Not about a match").tag(UUID?.none)
                        ForEach(ownMatches) { match in
                            Text(MatchTitle.parts(for: match).primary)
                                .tag(UUID?.some(match.id))
                        }
                    }
                } footer: {
                    Text("Naming the match tells us where to look.")
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.plBody)
                            .foregroundStyle(PL.dangerText)
                    }
                }
            }
            .plKeyboardDismiss()
        }
        .onAppear { pickedMatch = matchId }
    }

    private var ownMatches: [MatchRow] {
        guard let uid = app.userId else { return [] }
        return library.matches.filter { $0.userId == uid }
    }

    private func send() async {
        guard let uid = app.userId else { return }
        let trimmed = body_.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        sending = true
        errorMessage = nil
        struct Insert: Encodable {
            let user_id: String
            let match_id: String?
            let body: String
            let title: String
            let attachments: [String]
        }
        let title = trimmed.split(separator: " ").prefix(8).joined(separator: " ")
        do {
            struct IdRow: Decodable { let id: UUID }
            let row: IdRow = try await supa
                .from("feedback_items")
                .insert(Insert(
                    user_id: uid.uuidString.lowercased(),
                    match_id: pickedMatch?.uuidString.lowercased(),
                    body: trimmed,
                    title: title.isEmpty ? "Feedback" : title,
                    attachments: []
                ))
                .select("id")
                .single()
                .execute()
                .value
            onPosted()
            dismiss()
            // Background polish, fire and forget — same as the web. After
            // the dismiss on purpose: nobody waits on a rewrite.
            struct AssistReq: Encodable { let itemId: String }
            struct AssistRes: Decodable { let ok: Bool? }
            let _: AssistRes? = try? await API.post(
                "api/feedback/assist", AssistReq(itemId: row.id.uuidString.lowercased())
            )
        } catch {
            errorMessage = "Could not send. Try again."
            sending = false
        }
    }
}

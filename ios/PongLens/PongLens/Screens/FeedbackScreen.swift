import SwiftUI
import Supabase

/// The feedback board, and the box that adds to it.
///
/// Two tabs. Feedback is the posts and their threads: the board IS the
/// screen, writing is a sheet raised from the corner button (the journal's
/// New entry works exactly this way), and every post opens into its own
/// page where the thread lives. Roadmap is what is being built, what
/// comes next and what shipped, the same list as the public web page; no
/// corner button there, because nothing on it is written by a player.
///
/// The Top / New / Active sort went with the tabs (Adil, 2026-09-16):
/// with a few dozen posts the ranking by votes is the only order worth
/// having, and the stages a post moves through live on the Roadmap now.
/// Finished posts fold away under the list.
///
/// After a post is sent, a card at the top says so and carries whatever
/// the tidy-up came back with: a post that already asks for the same
/// thing, or a follow-up question.
struct FeedbackScreen: View {
    /// Raise the composer on arrival (Home's "add it to the board" row).
    var openCompose = false

    init(openCompose: Bool = false) {
        self.openCompose = openCompose
        var initialTab: FeedbackTab = .feedback
        #if DEBUG
        // --dev-feedback-tab roadmap: land on the roadmap, for screenshots.
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "--dev-feedback-tab"), args.indices.contains(i + 1),
           let requested = FeedbackTab(rawValue: args[i + 1]) {
            initialTab = requested
        }
        #endif
        _tab = State(initialValue: initialTab)
    }

    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app

    @State private var tab: FeedbackTab
    @State private var items: [FeedbackItem] = []
    @State private var loading = true
    @State private var loadFailed = false
    @State private var doneOpen = false
    @State private var roadmap: [RoadmapItem] = []
    @State private var roadmapVotes: [UUID: Int] = [:]
    @State private var roadmapLoaded = false
    @State private var composeOpen = false
    @State private var posted: PostedState?
    @State private var answer = ""

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

                    // "Feedback and discussion", not "Feedback board": the
                    // reader is looking at the board, so the name says what
                    // it is for (Adil, 2026-09-16).
                    Text("Feedback and discussion")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)
                        .fixedSize(horizontal: false, vertical: true)

                    // The one line under the title. Adil asked for it
                    // (2026-09-16): the board grew threads, and a
                    // first-time reader should know it is for talking as
                    // well as voting. Same words as the web.
                    Text("Ideas and bugs from players. Vote on what matters, join a thread, and see what's being built.")
                        .font(.plBody)
                        .foregroundStyle(PL.text400)
                        .fixedSize(horizontal: false, vertical: true)

                    Picker("", selection: $tab) {
                        ForEach(FeedbackTab.allCases) { t in
                            Text(t.label).tag(t)
                        }
                    }
                    .pickerStyle(.segmented)

                    if tab == .roadmap {
                        RoadmapSectionsView(items: roadmap, loaded: roadmapLoaded, votes: roadmapVotes) { item, pressed in
                            Task { await voteRoadmap(item, pressed: pressed) }
                        }
                        .padding(.top, 4)
                        if roadmapLoaded {
                            Text("Vote up what you want sooner and down what you can live without.")
                                .font(.plCaption)
                                .foregroundStyle(PL.text500)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    } else {
                        if posted != nil {
                            postedCard
                        }
                        boardList
                    }
                }
                .padding(20)
                .padding(.bottom, 120)
            }
            .refreshable {
                await load()
                if tab == .roadmap { await loadRoadmap() }
            }

            if tab == .feedback {
                PLFab(label: "New feedback", systemImage: "plus") {
                    composeOpen = true
                }
                .padding(20)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task {
            await load()
            if tab == .roadmap { await loadRoadmap() }
            if openCompose { composeOpen = true }
        }
        .onChange(of: tab) { _, now in
            if now == .roadmap, !roadmapLoaded {
                Task { await loadRoadmap() }
            }
        }
        .sheet(isPresented: $composeOpen) {
            FeedbackComposer { itemId, body in
                posted = PostedState(itemId: itemId)
                answer = ""
                Task {
                    await load()
                    await assist(itemId: itemId, body: body)
                }
            }
        }
    }

    // MARK: - The list

    @ViewBuilder
    private var boardList: some View {
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
            emptyCard("Couldn't load the board.", detail: "Your feedback still sends.")
        } else if items.isEmpty {
            emptyCard("Nothing here yet.", detail: "Be the first to post something.")
        } else {
            ForEach(active) { item in
                NavigationLink(value: "feedback-item:\(item.id.uuidString.lowercased())") {
                    card(item)
                }
                .buttonStyle(.plain)
            }
            if active.isEmpty {
                emptyCard("Nothing open right now.", detail: "Everything on the board is finished.")
            }
            if !finished.isEmpty {
                doneSection
            }
        }
    }

    /// Finished posts, folded away: what shipped stays findable without
    /// sitting on top of what is still wanted.
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
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if doneOpen {
                ForEach(finished) { item in
                    NavigationLink(value: "feedback-item:\(item.id.uuidString.lowercased())") {
                        card(item)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.top, 4)
    }

    private func card(_ item: FeedbackItem) -> some View {
        HStack(alignment: .top, spacing: 14) {
            if item.isHidden {
                FeedbackHiddenBox()
            } else {
                FeedbackVoteBox(count: item.voteCount, voted: item.voted) {
                    Task { await vote(item) }
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                Text(item.title)
                    .font(.plRowTitle)
                    .foregroundStyle(PL.text100)
                    .fixedSize(horizontal: false, vertical: true)
                if !item.body.isEmpty, item.body != item.title {
                    Text(item.body)
                        .font(.plBody)
                        .foregroundStyle(PL.text400)
                        .lineLimit(3)
                        .lineSpacing(2)
                }
                if let reply = item.officialReply {
                    FeedbackOfficialReply(text: reply, at: item.officialReplyAt)
                        .padding(.top, 2)
                }
                HStack(spacing: 8) {
                    FeedbackChip(text: FeedbackLook.typeLabel(item.type), tint: FeedbackLook.typeTint(item.type))
                    if let status = FeedbackLook.statusLabel(item.status) {
                        FeedbackChip(text: status, tint: FeedbackLook.statusTint(item.status))
                    }
                    if !item.isHidden {
                        FeedbackCommentCount(count: item.commentCount)
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
        .contentShape(Rectangle())
        .plCard(padding: 16)
    }

    private func authorLine(_ item: FeedbackItem) -> String {
        let name = FeedbackLook.name(item.authorName, userId: item.userId, viewerId: app.userId)
        let ago = FeedbackLook.ago(item.createdAt)
        return ago.isEmpty ? name : "\(name) · \(ago)"
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

    // MARK: - After posting

    /// What happened to the post, and what the tidy-up wants to know.
    private struct PostedState {
        enum Similar { case pending, kept, merged }
        let itemId: UUID
        var assist: FeedbackAssist?
        var similar: Similar = .pending
        var questionIndex = 0
        var savingAnswer = false
        var merging = false
    }

    @ViewBuilder
    private var postedCard: some View {
        if let state = posted {
            let similar = state.assist?.similar
            let questions = state.assist?.questions ?? []
            let merged = state.similar == .merged
            let showSimilar = !merged && state.similar == .pending && similar != nil
            let isPrivate = state.assist?.visibility == "private"
            let currentQuestion: String? =
                (!merged && !showSimilar && state.questionIndex < questions.count)
                ? questions[state.questionIndex] : nil
            let line: String = merged
                ? "Vote added to “\(similar?.title ?? "that post")”."
                : state.assist == nil
                    ? "Sent."
                    : isPrivate ? "Sent to us." : "Posted. Others can upvote it now."

            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(PL.successText)
                    Text(line)
                        .font(.plBody)
                        .foregroundStyle(PL.text200)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    Button {
                        withAnimation(.easeOut(duration: 0.15)) { posted = nil }
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(PL.text500)
                            .frame(width: 28, height: 28)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Dismiss")
                }

                if showSimilar, let similar {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Similar: “\(similar.title)”. Add your vote to it instead?")
                            .font(.plBody)
                            .foregroundStyle(PL.text300)
                            .fixedSize(horizontal: false, vertical: true)
                        HStack(spacing: 10) {
                            Button(state.merging ? "Adding…" : "+1") {
                                Task { await mergeIntoSimilar(similar) }
                            }
                            .buttonStyle(PLCyanGhostButtonStyle())
                            .disabled(state.merging)
                            Button("Keep mine") { posted?.similar = .kept }
                                .buttonStyle(PLSecondaryButtonStyle())
                        }
                    }
                    .plInnerRow(padding: 12)
                }

                if let currentQuestion {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(currentQuestion)
                            .font(.plRowTitle)
                            .foregroundStyle(PL.text100)
                            .fixedSize(horizontal: false, vertical: true)
                        TextField("Answer (optional)", text: $answer, axis: .vertical)
                            .lineLimit(2...5)
                            .font(.plBody)
                            .foregroundStyle(PL.text100)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .background(PL.ink.opacity(0.5), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: PL.rField, style: .continuous).strokeBorder(PL.edge, lineWidth: 1))
                        HStack(spacing: 10) {
                            Spacer(minLength: 0)
                            Button("Skip") {
                                answer = ""
                                posted?.questionIndex += 1
                            }
                            .buttonStyle(PLSecondaryButtonStyle())
                            Button(state.savingAnswer ? "Sending…" : "Send") {
                                Task { await submitAnswer(currentQuestion) }
                            }
                            .buttonStyle(PLCyanGhostButtonStyle())
                            .disabled(state.savingAnswer || answer.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    }
                }

                if !merged, !isPrivate {
                    NavigationLink(value: "feedback-item:\(state.itemId.uuidString.lowercased())") {
                        HStack(spacing: 3) {
                            Text("Open your post")
                            Image(systemName: "chevron.right")
                                .font(.system(size: 11, weight: .semibold))
                        }
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(PL.cyan)
                    }
                    .buttonStyle(.plain)
                }
            }
            .plCard(padding: 14)
        }
    }

    /// Background tidy-up, the same call the web makes. The post is
    /// already saved; anything here is polish, and a failure leaves the
    /// card saying "Sent." with nothing under it.
    private func assist(itemId: UUID, body: String) async {
        struct Req: Encodable {
            let itemId: String
            let body: String
        }
        // The polish is OpenAI's: permission first. The post is already
        // sent either way; declining leaves the card saying "Sent."
        guard await AiConsent.shared.ensure() else { return }
        let result: FeedbackAssist? = try? await API.post(
            "api/feedback/assist",
            Req(itemId: itemId.uuidString.lowercased(), body: body)
        )
        guard posted?.itemId == itemId else { return }
        posted?.assist = result ?? FeedbackAssist(questions: [], similar: nil, visibility: "board")
        // The title and type may have changed under the post.
        await load()
    }

    private func mergeIntoSimilar(_ similar: FeedbackAssist.Similar) async {
        guard let itemId = posted?.itemId else { return }
        posted?.merging = true
        struct VoteReq: Encodable { let p_item: String }
        _ = try? await supa
            .rpc("feedback_toggle_vote", params: VoteReq(p_item: similar.id.uuidString.lowercased()))
            .execute()
        _ = try? await supa
            .rpc("feedback_decline_duplicate", params: VoteReq(p_item: itemId.uuidString.lowercased()))
            .execute()
        posted?.merging = false
        posted?.similar = .merged
        await load()
    }

    private func submitAnswer(_ question: String) async {
        guard let itemId = posted?.itemId else { return }
        let text = answer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        posted?.savingAnswer = true
        struct Req: Encodable {
            let p_item: String
            let p_question: String
            let p_answer: String
        }
        _ = try? await supa
            .rpc("feedback_append_qa", params: Req(
                p_item: itemId.uuidString.lowercased(), p_question: question, p_answer: text
            ))
            .execute()
        answer = ""
        posted?.savingAnswer = false
        posted?.questionIndex += 1
        await load()
    }

    // MARK: - Data

    /// Ranked by votes, newest first among equals: the board is a list of
    /// what players want, and that is the order that says so.
    private func load() async {
        loadFailed = false
        struct Req: Encodable { let p_sort: String }
        do {
            items = try await supa.rpc("feedback_board", params: Req(p_sort: "top"))
                .execute().value
        } catch {
            loadFailed = true
        }
        loading = false
    }

    private func loadRoadmap() async {
        let rows: [RoadmapItem]? = try? await supa
            .from("roadmap_items")
            .select("id,title,description,stage,position,shipped_at,link,score,created_at")
            .order("stage")
            .order("position")
            .execute()
            .value
        roadmap = rows ?? []
        let mine: [RoadmapVoteRow]? = try? await supa
            .from("roadmap_votes")
            .select("item_id,value")
            .execute()
            .value
        roadmapVotes = Dictionary(uniqueKeysWithValues: (mine ?? []).map { ($0.itemId, $0.value) })
        roadmapLoaded = true
    }

    /// Optimistic: the score moves under the thumb and settles on whatever
    /// the server says, which applies the same "same arrow takes it back"
    /// rule as `Roadmap.nextVote`.
    private func voteRoadmap(_ item: RoadmapItem, pressed: Int) async {
        guard let index = roadmap.firstIndex(where: { $0.id == item.id }) else { return }
        let from = roadmapVotes[item.id] ?? 0
        let next = Roadmap.nextVote(current: from, pressed: pressed)
        let wasScore = roadmap[index].score
        roadmapVotes[item.id] = next
        roadmap[index].score = Roadmap.adjustedScore(wasScore, from: from, to: next)
        struct Req: Encodable {
            let p_item: String
            let p_value: Int
        }
        struct Res: Decodable {
            let score: Int
            let myVote: Int
            enum CodingKeys: String, CodingKey {
                case score
                case myVote = "my_vote"
            }
        }
        let rows: [Res]? = try? await supa
            .rpc("roadmap_vote", params: Req(p_item: item.id.uuidString.lowercased(), p_value: next))
            .execute().value
        guard let i = roadmap.firstIndex(where: { $0.id == item.id }) else { return }
        guard let truth = rows?.first else {
            roadmapVotes[item.id] = from
            roadmap[i].score = wasScore
            return
        }
        roadmapVotes[item.id] = truth.myVote
        roadmap[i].score = truth.score
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
///
/// No match is pre-selected. The composer used to arrive with the match
/// you came from already chosen, which read as "the latest match is
/// selected by default" and made every post look like it was about one
/// match (Adil, 2026-09-16). The match stays one tap away in the picker.
private struct FeedbackComposer: View {
    /// The saved post's id and its text, for the tidy-up that follows.
    let onPosted: (UUID, String) -> Void

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
            onPosted(row.id, trimmed)
            dismiss()
        } catch {
            errorMessage = "Could not send. Try again."
            sending = false
        }
    }
}

import SwiftUI
import Supabase

/// One post and everything said under it.
///
/// The post at the top with its vote box; the maker's latest reply pinned
/// under the post when there is one; then every comment in the order it
/// was written, with a reply bar along the bottom. Comments carry a first
/// name and a photo, "You" for your own, and the PongLens badge for the
/// admin.
///
/// Writing goes through feedback_post_comment, which is what rings the
/// other people's bells. Editing goes through feedback_edit_comment so
/// the row is stamped edited. Deleting is a plain delete: the row policy
/// lets the author and the admin do it and nobody else.
struct FeedbackThreadScreen: View {
    let itemId: UUID

    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app

    @State private var item: FeedbackItem?
    @State private var comments: [FeedbackComment] = []
    @State private var loading = true
    @State private var draft = ""
    @State private var sending = false
    @State private var errorMessage: String?
    @State private var editing: FeedbackComment?
    @State private var deleting: FeedbackComment?
    @FocusState private var replyFocused: Bool

    private var canSend: Bool {
        !sending && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        ZStack {
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

                    if loading {
                        VStack(alignment: .leading, spacing: 10) {
                            PLSkeletonBar(maxWidth: 240)
                            PLSkeletonBar()
                            PLSkeletonBar(maxWidth: 180)
                        }
                        .plCard(padding: 16)
                        .plShimmer()
                    } else if let item {
                        postCard(item)

                        Text(threadHeading)
                            .font(.plSection)
                            .tracking(0.6)
                            .foregroundStyle(PL.text500)
                            .padding(.top, 8)

                        ForEach(comments) { comment in
                            commentCard(comment)
                        }

                        if comments.isEmpty, !item.isHidden {
                            Text("Nothing said yet. Yours goes first.")
                                .font(.plBody)
                                .foregroundStyle(PL.text500)
                        }
                        if item.isHidden {
                            Text("This report is private, so there is no thread on it.")
                                .font(.plBody)
                                .foregroundStyle(PL.text500)
                        }
                    } else {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("This post is not on the board.")
                                .font(.plRowTitle)
                                .foregroundStyle(PL.text200)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .plCard(padding: 20)
                    }

                    if let errorMessage {
                        Text(errorMessage)
                            .font(.plCaption)
                            .foregroundStyle(PL.dangerText)
                    }
                }
                .padding(20)
                .padding(.bottom, 24)
            }
            .refreshable { await load() }
            .scrollDismissesKeyboard(.interactively)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let item, !item.isHidden {
                replyBar
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { await load() }
        .sheet(item: $editing) { comment in
            EditCommentSheet(comment: comment) { newBody in
                await edit(comment, body: newBody)
            }
        }
        .confirmationDialog(
            "Delete this comment?",
            isPresented: Binding(
                get: { deleting != nil },
                set: { if !$0 { deleting = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let comment = deleting {
                    deleting = nil
                    Task { await remove(comment) }
                }
            }
            Button("Keep", role: .cancel) { deleting = nil }
        }
    }

    private var threadHeading: String {
        switch comments.count {
        case 0: "COMMENTS"
        case 1: "1 COMMENT"
        default: "\(comments.count) COMMENTS"
        }
    }

    // MARK: - The post

    private func postCard(_ item: FeedbackItem) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 14) {
                if item.isHidden {
                    FeedbackHiddenBox()
                } else {
                    FeedbackVoteBox(count: item.voteCount, voted: item.voted, large: true) {
                        Task { await vote() }
                    }
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text(item.title)
                        .font(.plCardTitle)
                        .foregroundStyle(PL.text100)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 8) {
                        FeedbackChip(text: FeedbackLook.typeLabel(item.type), tint: FeedbackLook.typeTint(item.type))
                        if let status = FeedbackLook.statusLabel(item.status) {
                            FeedbackChip(text: status, tint: FeedbackLook.statusTint(item.status))
                        }
                        Spacer(minLength: 0)
                    }
                    HStack(spacing: 6) {
                        FeedbackAvatar(name: item.authorName, url: item.authorAvatar, size: 16)
                        Text(authorLine(item))
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                            .lineLimit(1)
                    }
                }
            }

            if !item.lead.isEmpty {
                Text(item.lead)
                    .font(.plBody)
                    .foregroundStyle(PL.text200)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if !item.original.isEmpty {
                HStack(alignment: .top, spacing: 10) {
                    Rectangle()
                        .fill(PL.edge)
                        .frame(width: 2)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Original message")
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                        Text(item.original)
                            .font(.plBody)
                            .foregroundStyle(PL.text400)
                            .lineSpacing(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
            }

            if let pinned = comments.last(where: \.official) {
                FeedbackOfficialReply(text: pinned.body, at: pinned.createdAt, lineLimit: nil)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 16)
    }

    private func authorLine(_ item: FeedbackItem) -> String {
        let name = FeedbackLook.name(item.authorName, userId: item.userId, viewerId: app.userId)
        let ago = FeedbackLook.ago(item.createdAt)
        return ago.isEmpty ? name : "\(name) · \(ago)"
    }

    // MARK: - Comments

    private func commentCard(_ comment: FeedbackComment) -> some View {
        let mine = comment.userId == app.userId
        let canDelete = mine || app.isAdmin
        return HStack(alignment: .top, spacing: 12) {
            FeedbackAvatar(name: comment.authorName, url: comment.authorAvatar, size: 28)
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    if comment.official {
                        FeedbackOfficialBadge()
                    } else {
                        Text(FeedbackLook.name(comment.authorName, userId: comment.userId, viewerId: app.userId))
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(PL.text200)
                    }
                    Text(FeedbackLook.ago(comment.createdAt) + (comment.editedAt == nil ? "" : " · edited"))
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    if mine || canDelete {
                        Menu {
                            if mine {
                                Button("Edit", systemImage: "pencil") { editing = comment }
                            }
                            if canDelete {
                                Button("Delete", systemImage: "trash", role: .destructive) { deleting = comment }
                            }
                        } label: {
                            Image(systemName: "ellipsis")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(PL.text500)
                                .frame(width: 28, height: 28)
                                .contentShape(Rectangle())
                        }
                        .accessibilityLabel("Comment actions")
                    }
                }
                Text(comment.body)
                    .font(.plBody)
                    .foregroundStyle(PL.text200)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 14)
        .overlay(
            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                .strokeBorder(PL.cyan.opacity(comment.official ? 0.35 : 0), lineWidth: 1)
        )
    }

    // MARK: - Reply bar

    private var replyBar: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField(
                comments.isEmpty ? "Be the first to comment" : "Add a comment",
                text: $draft,
                axis: .vertical
            )
            .lineLimit(1...5)
            .focused($replyFocused)
            .font(.plBody)
            .foregroundStyle(PL.text100)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(PL.surface2, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(PL.edge, lineWidth: 1))

            Button {
                Task { await send() }
            } label: {
                Group {
                    if sending {
                        ProgressView().controlSize(.small).tint(PL.ink)
                    } else {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 15, weight: .bold))
                    }
                }
                .foregroundStyle(PL.ink)
                .frame(width: 40, height: 40)
                .background(canSend ? PL.cyan : PL.text600, in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
            .accessibilityLabel("Post comment")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background {
            ZStack {
                Rectangle().fill(.ultraThinMaterial)
                PL.ink.opacity(0.7)
            }
            .ignoresSafeArea(edges: .bottom)
        }
        .overlay(alignment: .top) {
            Rectangle().fill(PL.edge.opacity(0.7)).frame(height: 1)
        }
    }

    // MARK: - Data

    private func load() async {
        struct Req: Encodable { let p_item: String }
        let key = itemId.uuidString.lowercased()
        let rows: [FeedbackItem]? = try? await supa
            .rpc("feedback_item", params: Req(p_item: key))
            .execute().value
        item = rows?.first
        let thread: [FeedbackComment]? = try? await supa
            .rpc("feedback_thread", params: Req(p_item: key))
            .execute().value
        comments = thread ?? []
        loading = false
    }

    private func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !sending else { return }
        sending = true
        errorMessage = nil
        struct Req: Encodable {
            let p_item: String
            let p_body: String
        }
        do {
            _ = try await supa
                .rpc("feedback_post_comment", params: Req(p_item: itemId.uuidString.lowercased(), p_body: text))
                .execute()
            draft = ""
            await load()
        } catch {
            errorMessage = "Could not post that. Try again."
        }
        sending = false
    }

    private func edit(_ comment: FeedbackComment, body: String) async -> Bool {
        struct Req: Encodable {
            let p_comment: String
            let p_body: String
        }
        do {
            _ = try await supa
                .rpc("feedback_edit_comment", params: Req(p_comment: comment.id.uuidString.lowercased(), p_body: body))
                .execute()
            await load()
            return true
        } catch {
            errorMessage = "Could not save that. Try again."
            return false
        }
    }

    private func remove(_ comment: FeedbackComment) async {
        do {
            _ = try await supa
                .from("feedback_comments")
                .delete()
                .eq("id", value: comment.id.uuidString.lowercased())
                .execute()
            await load()
        } catch {
            errorMessage = "Could not delete that. Try again."
        }
    }

    private func vote() async {
        guard var current = item, !current.isHidden else { return }
        let wasVoted = current.voted
        let wasCount = current.voteCount
        current.voted = !wasVoted
        current.voteCount = max(0, wasCount + (wasVoted ? -1 : 1))
        item = current
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
            .rpc("feedback_toggle_vote", params: Req(p_item: itemId.uuidString.lowercased()))
            .execute().value
        guard var settled = item else { return }
        if let truth = rows?.first {
            settled.voted = truth.voted
            settled.voteCount = truth.voteCount
        } else {
            settled.voted = wasVoted
            settled.voteCount = wasCount
        }
        item = settled
    }
}

// MARK: - Editing a comment

/// Your own words, changed. A sheet, so Save sits where a sheet's commit
/// action always sits.
private struct EditCommentSheet: View {
    let comment: FeedbackComment
    let onSave: (String) async -> Bool

    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @State private var saving = false
    @State private var failed = false

    init(comment: FeedbackComment, onSave: @escaping (String) async -> Bool) {
        self.comment = comment
        self.onSave = onSave
        _text = State(initialValue: comment.body)
    }

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        PLSheetScaffold(
            title: "Edit comment",
            doneLabel: saving ? "Saving…" : "Save",
            doneDisabled: saving || trimmed.isEmpty || trimmed == comment.body,
            onDone: {
                Task {
                    saving = true
                    failed = false
                    if await onSave(trimmed) {
                        dismiss()
                    } else {
                        failed = true
                        saving = false
                    }
                }
            }
        ) {
            Form {
                Section {
                    TextField("Your comment", text: $text, axis: .vertical)
                        .lineLimit(3...12)
                }
                if failed {
                    Section {
                        Text("Could not save that. Try again.")
                            .font(.plBody)
                            .foregroundStyle(PL.dangerText)
                    }
                }
            }
            .plKeyboardDismiss()
        }
        .presentationDetents([.medium, .large])
    }
}

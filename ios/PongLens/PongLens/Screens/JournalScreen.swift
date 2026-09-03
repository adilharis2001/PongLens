import AVFoundation
import PhotosUI
import SwiftUI
import Supabase

struct JournalScreen: View {
    @Environment(AppState.self) private var app
    @Environment(LibraryStore.self) private var library
    @Environment(JournalStore.self) private var store
    @State private var query = ""
    @State private var tab = "All"
    @State private var selectedTag: TagStatRow?
    @State private var newEntryOpen = false
    @State private var entryChoice: NewEntryChoice?
    @State private var lessonRecordOpen = false

    /// Everything the composer needs, in one value. Presenting on a flag
    /// while the kind and text sat in their own @State meant the sheet
    /// could be built before those landed.
    struct ComposerRequest: Identifiable {
        let id = UUID()
        var kind = "practice"
        var text = ""
    }
    @State private var composerRequest: ComposerRequest?

    /// The entry being corrected. Its own presentation, because editing
    /// is its own screen now: the composer makes entries, the note editor
    /// fixes them, and neither has the other's controls on it.
    struct EditRequest: Identifiable {
        let id = UUID()
        let lesson: LessonRow
    }
    @State private var editRequest: EditRequest?
    @State private var coachEntryOpen: CoachSharedEntry?
    @State private var ask = AskState()

    private let feedCap = 30
    @State private var showAll = false

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        Text("Journal")
                            .font(.plPageTitle)
                            .tracking(-0.6)
                            .foregroundStyle(PL.textBody)
                            .id("journal-top")

                        searchField

                        AskPanelView(
                            ask: ask, query: $query, examples: askExamples,
                            onOpenEntry: { id in revealEntry(id, proxy: proxy) },
                            onOpenJournal: {
                                withAnimation { proxy.scrollTo("journal-top", anchor: .top) }
                            }
                        )

                        if !store.tagStats.isEmpty {
                            tagRail
                        }

                        if selectedTag == nil {
                            WorkingOnCard(store: store)
                            tabs
                            if tab == "Recollect" {
                                RecollectSection(journal: store) { source in
                                    revealSource(source, proxy: proxy)
                                }
                            } else {
                                feed
                            }
                        } else {
                            taggedView
                        }
                    }
                    .padding(20)
                    .padding(.top, 12)
                    .padding(.bottom, 120)
                }
                .refreshable { await store.load(userId: app.userId) }
            }

            PLFab(label: "New entry", systemImage: "plus") {
                newEntryOpen = true
            }
            .padding(20)
        }
        // Keyboard dismissal comes from MainTabView's plKeyboardDismiss —
        // a toolbar declared inside the pager would be swallowed, and a
        // second one here would double the chevron if it were not.
        .scrollDismissesKeyboard(.interactively)
        .task {
            if !store.loaded { await store.load(userId: app.userId) }
            store.markCoachSharesSeen(userId: app.userId)
        }
        .onChange(of: store.coachShared) { _, _ in
            store.markCoachSharesSeen(userId: app.userId)
        }
        .sheet(item: $coachEntryOpen) { entry in
            CoachSharedEntrySheet(entry: entry)
        }
        // Search reads entries, which Recollect does not list. Rather than
        // leave typing dead there, it moves to the list it filters.
        .onChange(of: query) { _, value in
            if !value.isEmpty, tab == "Recollect" { tab = "All" }
        }
        // Turning Recollect off in Account takes its tab away; a reader
        // standing on it lands back on the whole feed.
        .onChange(of: store.recollectEnabled) { _, enabled in
            if !enabled, tab == "Recollect" { tab = "All" }
        }
        // Handed off on dismissal rather than presented from inside: a
        // second sheet raised while the first is still up races it, and
        // one of the two is dropped.
        .sheet(isPresented: $newEntryOpen, onDismiss: {
            switch entryChoice {
            case .practice:
                composerRequest = ComposerRequest(kind: "practice")
            case .lesson:
                composerRequest = ComposerRequest(kind: "lesson")
            case .record:
                lessonRecordOpen = true
            case nil:
                break
            }
            entryChoice = nil
        }) {
            NewEntrySheet { choice in
                entryChoice = choice
                newEntryOpen = false
            }
            .presentationDetents([.height(348)])
            .presentationBackground(PL.surface)
            .presentationDragIndicator(.visible)
        }
        .fullScreenCover(isPresented: $lessonRecordOpen) {
            LessonRecordScreen {
                Task { await store.load(userId: app.userId) }
            }
        }
        // sheet(item:) rather than a flag beside separate @State. The kind
        // and the text travel WITH the presentation, so the composer cannot
        // be built from values that have not landed yet — which is how a
        // recorded lesson opened as an empty practice note.
        .sheet(item: $composerRequest) { request in
            JournalComposer(
                store: store, initialKind: request.kind, initialText: request.text
            ) {
                Task { await store.load(userId: app.userId) }
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        // No drag indicator: this sheet blocks the swipe once there are
        // changes on it, and a grip that does nothing reads as a stuck
        // screen. Cancel and Save are the way out.
        .sheet(item: $editRequest) { request in
            JournalNoteEditor(lesson: request.lesson, store: store)
                .presentationDetents([.large])
        }
    }

    /// An ask source that points at a journal entry brings the feed to it,
    /// the way the web's /journal#journal-entry- anchor does: back to the
    /// plain feed, then scroll to the card.
    private func revealEntry(_ id: UUID, proxy: ScrollViewProxy) {
        selectedTag = nil
        query = ""
        tab = "All"
        if let i = feedItems.firstIndex(where: { $0.id == id }), i >= feedCap {
            showAll = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            withAnimation { proxy.scrollTo(id, anchor: .center) }
        }
    }

    /// A revealed Recollect point's source line opens the entry it came
    /// from: over to that entry's section, then scroll to the card.
    private func revealSource(_ source: RecollectSource, proxy: ScrollViewProxy) {
        selectedTag = nil
        query = ""
        tab = source.kind == "practice" ? "Practice" : "Lessons"
        if let i = feedItems.firstIndex(where: { $0.id == source.lessonId }), i >= feedCap {
            showAll = true
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            withAnimation { proxy.scrollTo(source.lessonId, anchor: .center) }
        }
    }

    // MARK: - Search + ask

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "sparkles")
                .font(.system(size: 15))
                .foregroundStyle(PL.cyan)
            TextField("Search or ask your journal", text: $query, axis: .vertical)
                .font(.plBody)
                .foregroundStyle(PL.text200)
                .tint(PL.cyan)
                .lineLimit(1...3)
                .onSubmit { Task { await ask.fire(query) } }

            // The way to ask, and the ONLY one. It lives in the box with
            // the question rather than in the panel below, because the
            // panel is where answers go: once one was on screen the old
            // button was in an unreachable branch of the same if-chain, so
            // a second question could not be asked at all without
            // restarting the app.
            //
            // Here it cannot go missing. It is in the field, beside the
            // words it sends, whether or not an answer is already up.
            // Clearing is a quality-of-life thing, not a control anyone
            // needs to find, so it stays a bare glyph: no fill, no border,
            // muted. It sits inside the field where the text it erases is,
            // and it is absent the moment there is nothing to erase.
            if !query.isEmpty, !ask.loading {
                Button {
                    query = ""
                    ask.clear()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(PL.text500)
                        .frame(width: 26, height: 30)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear the question")
            }

            if ask.loading {
                ProgressView()
                    .controlSize(.small)
                    .tint(PL.cyan)
                    .frame(width: 30, height: 30)
            } else if askable(query) {
                Button {
                    Task { await ask.fire(query) }
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(PL.ink)
                        .frame(width: 30, height: 30)
                        .background(PL.cyan, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Ask your journal")
                .transition(.scale.combined(with: .opacity))
            }
        }
        .animation(.easeOut(duration: 0.15), value: askable(query))
        .animation(.easeOut(duration: 0.15), value: query.isEmpty)
        .animation(.easeOut(duration: 0.15), value: ask.loading)
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(PL.surface2.opacity(0.4), in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                .strokeBorder(PL.edge, lineWidth: 1)
        )
    }

    private var askExamples: [String] {
        var examples: [String] = []
        if let coach = store.lessons.compactMap(\.coachName).first {
            examples.append("What has \(coach) told me to work on?")
        }
        if let opponent = store.notes.compactMap(\.opponentName).first {
            examples.append("What have I written about playing \(opponent)?")
        }
        examples.append("What keeps costing me points?")
        return examples
    }

    // MARK: - Tags

    private var tagRail: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(store.tagStats) { tag in
                    let active = selectedTag?.id == tag.id
                    Button {
                        selectedTag = active ? nil : tag
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "tag")
                                .font(.system(size: 11))
                            Text(tag.label)
                                .font(.system(size: 13, weight: .medium))
                            if active {
                                Image(systemName: "xmark")
                                    .font(.system(size: 10, weight: .semibold))
                            } else {
                                Text("\(tag.pointCount + store.entryCount(for: tag.id))")
                                    .font(.system(size: 12))
                                    .monospacedDigit()
                                    .foregroundStyle(PL.text500)
                            }
                        }
                        .foregroundStyle(active ? PL.cyan : PL.text300)
                        .padding(.horizontal, 13)
                        .padding(.vertical, 8)
                        .background(active ? PL.cyan.opacity(0.12) : .clear, in: Capsule())
                        .overlay(
                            Capsule().strokeBorder(active ? PL.cyan.opacity(0.5) : PL.edge, lineWidth: 1)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var taggedView: some View {
        let tag = selectedTag!
        let taggedLessonIds = Set(store.entryTags.filter { $0.tagId == tag.id }.map(\.lessonId))
        let entries = store.lessons.filter { taggedLessonIds.contains($0.id) }
        return VStack(alignment: .leading, spacing: 14) {
            Text("\(tag.pointCount) points across \(tag.matchCount) matches · \(entries.count) entries tagged \"\(tag.label)\".")
                .font(.plBody)
                .foregroundStyle(PL.text400)
            if !entries.isEmpty {
                SectionHeading("Entries")
                ForEach(entries) { lesson in
                    LessonCardView(lesson: lesson, store: store, onEdit: {
                        editRequest = EditRequest(lesson: lesson)
                    })
                }
            }
            Text("Open a match to see its tagged points.")
                .font(.plCaption)
                .foregroundStyle(PL.text500)
        }
    }

    // MARK: - Tabs + feed

    private var tabs: some View {
        // "From your coach" is a filter, not a tab bar item: it appears
        // once a coach has shared something, the same way Recollect appears
        // when it is on. Its entries also sit under All, the way the web's
        // journal reads (Adil, 2026-09-02) — no section of their own.
        let names = ["All", "Matches", "Lessons", "Practice"]
            + (store.coachShared.isEmpty ? [] : ["From your coach"])
            + (store.recollectEnabled ? ["Recollect"] : [])
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(names, id: \.self) { name in
                    let active = tab == name
                    Button(name) { tab = name }
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(active ? .white : PL.text500)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(active ? PL.surface2 : .clear, in: Capsule())
                        .buttonStyle(.plain)
                }
            }
        }
        .overlay(alignment: .bottom) {
            Rectangle().fill(PL.edge.opacity(0.5)).frame(height: 1).offset(y: 6)
        }
    }

    private enum FeedItem: Identifiable {
        case note(NoteFeedRow)
        case lesson(LessonRow)
        case coach(CoachSharedEntry)

        var id: UUID {
            switch self {
            case .note(let n): n.id
            case .lesson(let l): l.id
            case .coach(let e): e.entryId
            }
        }

        var createdAt: String {
            switch self {
            case .note(let n): n.createdAt
            case .lesson(let l): l.createdAt
            case .coach(let e): e.sharedAt
            }
        }
    }

    private var feedItems: [FeedItem] {
        var items: [FeedItem] = []
        if tab == "All" || tab == "Matches" {
            items += store.notes.map { .note($0) }
        }
        if tab == "All" || tab == "From your coach" {
            items += store.coachShared.map { .coach($0) }
        }
        if tab != "Matches", tab != "From your coach" {
            items += store.lessons
                .filter { lesson in
                    switch tab {
                    case "Lessons": lesson.kind == "lesson"
                    case "Practice": lesson.kind == "practice"
                    default: true
                    }
                }
                .map { .lesson($0) }
        }
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        if !q.isEmpty, !askable(query) {
            items = items.filter { item in
                switch item {
                case .note(let n):
                    n.body.lowercased().contains(q)
                        || (n.opponentName ?? "").lowercased().contains(q)
                        || (n.authorName ?? "").lowercased().contains(q)
                case .lesson(let l):
                    l.transcript.lowercased().contains(q)
                        || (l.coachName ?? "").lowercased().contains(q)
                        || (l.takeaways?.themes ?? []).contains { theme in
                            theme.name.lowercased().contains(q)
                                || theme.points.contains { $0.lowercased().contains(q) }
                        }
                case .coach(let e):
                    e.transcript.lowercased().contains(q)
                        || e.coachName.lowercased().contains(q)
                        || (e.takeaways?.themes ?? []).contains { theme in
                            theme.name.lowercased().contains(q)
                                || theme.points.contains { $0.lowercased().contains(q) }
                        }
                }
            }
        }
        return items.sorted {
            (PGDate.parse($0.createdAt) ?? .distantPast) > (PGDate.parse($1.createdAt) ?? .distantPast)
        }
    }

    @ViewBuilder
    private var feed: some View {
        let items = feedItems
        if !store.loaded {
            ForEach(0..<3, id: \.self) { _ in
                RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                    .fill(PL.surface)
                    .frame(height: 96)
                    .opacity(0.6)
            }
        } else if items.isEmpty && store.notes.isEmpty && store.lessons.isEmpty && store.coachShared.isEmpty {
            VStack(spacing: 12) {
                Text("📓").font(.system(size: 40))
                Text("Your journal starts here")
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                Text("Notes from your matches collect here on their own. Add a lesson or a practice entry with New. Type it, speak it, or paste it.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
            }
            .frame(maxWidth: .infinity)
            .plCard(padding: 40)
        } else if items.isEmpty {
            Text(emptyLine)
                .font(.plBody)
                .foregroundStyle(PL.text400)
                .frame(maxWidth: .infinity)
                .plCard(padding: 24)
        } else {
            let shown = showAll ? items : Array(items.prefix(feedCap))
            ForEach(shown) { item in
                switch item {
                case .note(let note): NoteCardView(note: note, store: store)
                case .lesson(let lesson):
                    LessonCardView(lesson: lesson, store: store, onEdit: {
                        editRequest = EditRequest(lesson: lesson)
                    })
                case .coach(let entry):
                    Button {
                        coachEntryOpen = entry
                    } label: {
                        CoachSharedEntryCard(entry: entry)
                    }
                    .buttonStyle(.plain)
                }
            }
            if items.count > feedCap, !showAll {
                Button("Show \(items.count - feedCap) more") { showAll = true }
                    .buttonStyle(PLSecondaryButtonStyle())
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private var emptyLine: String {
        switch tab {
        case "Lessons": "No lessons yet. New saves your first."
        case "Practice": "No practice entries yet. New starts one."
        case "From your coach": "Nothing from a coach yet."
        default: "Nothing found."
        }
    }

}

/// Journal cards deep-link into a match the way the web's /match/{id}?p=
/// links do: the destination opens the match and, when a point is named,
/// its sheet.
struct MatchPointRoute: Hashable {
    let match: MatchRow
    let pointId: UUID?
}

/// One match or point note in the feed. The header opens the match it
/// came from (and the point, for a point note); the owner of the match
/// can delete any note on it, matching the web.
struct NoteCardView: View {
    let note: NoteFeedRow
    let store: JournalStore

    @Environment(AppState.self) private var app
    @Environment(LibraryStore.self) private var library
    @State private var deleteAsk = false
    @State private var deleting = false
    @State private var deleteError: String?

    var body: some View {
        let title = MatchTitle.parts(
            opponentName: note.opponentName, venue: note.venue, playedAt: note.playedAt
        ).primary
        let mine = note.authorId == app.userId
        let canDelete = mine || note.matchOwnerId == app.userId
        let target = library.matches.first { $0.id == note.matchId }

        VStack(alignment: .leading, spacing: 8) {
            if let target {
                NavigationLink(value: MatchPointRoute(match: target, pointId: note.pointId)) {
                    header(title)
                }
                .buttonStyle(.plain)
            } else {
                header(title)
            }
            if !mine, let author = note.authorName {
                Text(author)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color(hex: 0xF0C420))
            }
            Text(note.body)
                .font(.plBody)
                .foregroundStyle(PL.text200)
                .lineLimit(4)
            if canDelete {
                HStack {
                    Spacer()
                    Button("Delete") {
                        deleteError = nil
                        deleteAsk = true
                    }
                    .buttonStyle(PLSoftDestructiveButtonStyle())
                    .disabled(deleting)
                }
            }
            if let deleteError {
                Text(deleteError)
                    .font(.plCaption)
                    .foregroundStyle(PL.warningText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 16)
        .overlay(alignment: .leading) {
            if !mine {
                UnevenRoundedRectangle(topLeadingRadius: PL.rCard, bottomLeadingRadius: PL.rCard)
                    .fill(Color(hex: 0xF0C420).opacity(0.6))
                    .frame(width: 3)
            }
        }
        .alert("Delete this note?", isPresented: $deleteAsk) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) {
                Task {
                    deleting = true
                    let ok = await store.deleteNote(note)
                    deleting = false
                    if !ok {
                        deleteError = "Couldn't delete this note. Try again."
                    }
                }
            }
        }
    }

    private func header(_ title: String) -> some View {
        HStack(spacing: 4) {
            Text("\(title) · \(note.pointId == nil ? "Match note" : "Point note")")
                .font(.plCaption)
                .foregroundStyle(PL.text500)
            Image(systemName: "chevron.right")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(PL.text600)
            Spacer()
            Text(PGDate.shortDate(note.createdAt))
                .font(.plCaption)
                .foregroundStyle(PL.text600)
        }
        .contentShape(Rectangle())
    }
}

// MARK: - Askable rule (AskPanel.tsx)

private let MIN_ASK_CHARS = 8
private let MAX_QUESTION_CHARS = 400

func askable(_ query: String) -> Bool {
    let q = query.trimmingCharacters(in: .whitespaces)
    return q.count >= MIN_ASK_CHARS && q.count <= MAX_QUESTION_CHARS && q.contains(" ")
}

// MARK: - Ask panel

@Observable
final class AskState {
    struct Paragraph: Decodable {
        let text: String
        let sourceIds: [String]?
    }
    struct Source: Decodable, Identifiable {
        let id: String
        let kind: String
        let title: String
        let href: String
        let when: String
    }
    struct Response: Decodable {
        let answer: [Paragraph]?
        let refused: String?
        let sources: [Source]?
        let coverage: String?
    }

    var loading = false
    var answer: Response?
    var errorMessage: String?
    var asked: String?

    func fire(_ question: String) async {
        let q = question.trimmingCharacters(in: .whitespaces)
        guard askable(q), !loading else { return }
        loading = true
        errorMessage = nil
        answer = nil
        asked = q
        struct Req: Encodable { let question: String }
        do {
            let res: Response = try await API.post("api/journal-ask", Req(question: q))
            answer = res
        } catch let APIError.http(_, code) {
            errorMessage = askErrorCopy(code)
        } catch {
            errorMessage = "Something went wrong. Try again."
        }
        loading = false
    }

    /// Back to nothing: the question, and the answer that belonged to it.
    /// Leaving an answer above an empty box is the stale state that made
    /// the ask button unreachable in the first place.
    func clear() {
        answer = nil
        errorMessage = nil
        asked = nil
    }

    private func askErrorCopy(_ code: String) -> String {
        switch code {
        case "too_fast": "Give it a moment, then ask again."
        case "daily_limit", "token_budget": "That is all your questions for today. There will be more tomorrow."
        case "busy": "Ask is busy right now. Try again in a few minutes."
        case "disabled": "Ask is turned off at the moment."
        case "question_too_long": "That question is too long. Try it shorter."
        case "no_answer": "That did not come back cleanly. Try asking it another way."
        default: "Something went wrong. Try again."
        }
    }
}

struct AskPanelView: View {
    let ask: AskState
    @Binding var query: String
    let examples: [String]
    /// Brings the journal feed to the entry an ask source cites.
    var onOpenEntry: (UUID) -> Void = { _ in }
    /// Returns to the top of the journal, for sources that live on this
    /// page (Working on, tags).
    var onOpenJournal: () -> Void = {}

    @Environment(LibraryStore.self) private var library

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if ask.loading {
                loadingCard
            } else if let message = ask.errorMessage {
                Text(message)
                    .font(.plBody)
                    .foregroundStyle(PL.warningText)
                    .plCard(padding: 16)
            } else if let answer = ask.answer {
                answerCard(answer)
            } else if query.isEmpty {
                FlowLayout(spacing: 8) {
                    ForEach(examples, id: \.self) { example in
                        Button {
                            query = example
                            Task { await ask.fire(example) }
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "sparkles")
                                    .font(.system(size: 11))
                                    .foregroundStyle(PL.cyan)
                                Text(example)
                                    .font(.system(size: 13))
                                    .foregroundStyle(PL.text300)
                            }
                            .padding(.horizontal, 13)
                            .padding(.vertical, 8)
                            .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    /// The wait, in the shape of the answer.
    ///
    /// This was a spinner and a line of grey text in a card that hugged
    /// them, so it sat as a small pill where a full-width answer was about
    /// to appear, and the layout jumped when it did. The card is now the
    /// answer's own size and carries placeholder paragraphs, which makes
    /// the wait read as the answer arriving rather than as the app
    /// stalling. Reading a journal takes a few seconds and that is worth
    /// furnishing properly.
    private var loadingCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 7) {
                Image(systemName: "sparkles")
                    .font(.system(size: 13))
                    .foregroundStyle(PL.cyan)
                Text("Reading your journal…")
                    .font(.plCaption)
                    .foregroundStyle(PL.text400)
            }
            // Three lines and a short one, the length a paragraph of the
            // answer actually runs to.
            VStack(alignment: .leading, spacing: 10) {
                PLSkeletonBar()
                PLSkeletonBar()
                PLSkeletonBar(maxWidth: 300)
                PLSkeletonBar(maxWidth: 190)
            }
            .plShimmer()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 16)
        // One announcement, not five unlabelled bars.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Reading your journal")
    }

    @ViewBuilder
    private func answerCard(_ answer: AskState.Response) -> some View {
        let sources = answer.sources ?? []
        let numberOf = Dictionary(
            sources.enumerated().map { ($1.id, $0 + 1) },
            uniquingKeysWith: { first, _ in first }
        )
        VStack(alignment: .leading, spacing: 12) {
            if let paragraphs = answer.answer, !paragraphs.isEmpty {
                ForEach(Array(paragraphs.enumerated()), id: \.offset) { _, paragraph in
                    paragraphText(paragraph, numberOf: numberOf)
                        .font(.plBody)
                        .foregroundStyle(PL.text200)
                        .lineSpacing(4)
                }
                if !sources.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        SectionHeading("Where this comes from")
                        ForEach(Array(sources.enumerated()), id: \.element.id) { i, source in
                            sourceRow(source, number: i + 1)
                        }
                    }
                    .padding(.top, 2)
                }
                // An answer drawn from part of the journal has to say so.
                if let coverage = answer.coverage, !coverage.isEmpty, coverage != "full" {
                    Text(coverage == "takeaways"
                        ? "Your journal is large, so this read the lesson summaries rather than the full transcripts."
                        : "Your journal is large, so this read the last year of it.")
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                }
            } else {
                Text(refusalCopy(answer.refused ?? ""))
                    .font(.plBody)
                    .foregroundStyle(PL.text300)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 16)
    }

    /// A paragraph with its citation numbers raised after it, the way the
    /// web superscripts them.
    private func paragraphText(
        _ paragraph: AskState.Paragraph, numberOf: [String: Int]
    ) -> Text {
        let numbers = (paragraph.sourceIds ?? []).compactMap { numberOf[$0] }
        let base = Text(paragraph.text)
        guard !numbers.isEmpty else { return base }
        return base
            + Text(" " + numbers.map(String.init).joined(separator: ","))
                .font(.system(size: 11, weight: .medium))
                .baselineOffset(4)
                .foregroundColor(PL.cyan)
    }

    /// Where a source's tap goes, worked out from the same href the web
    /// links to.
    private enum SourceTarget {
        case match(MatchRow, pointId: UUID?)
        case entry(UUID)
        case journal
        case account
        case none
    }

    private func target(for source: AskState.Source) -> SourceTarget {
        let href = source.href
        if href.hasPrefix("/match/") {
            let rest = href.dropFirst("/match/".count)
            let pieces = rest.split(separator: "?", maxSplits: 1)
            guard let first = pieces.first,
                  let matchId = UUID(uuidString: String(first)),
                  let match = library.matches.first(where: { $0.id == matchId })
            else { return .none }
            var pointId: UUID?
            if pieces.count > 1, pieces[1].hasPrefix("p=") {
                pointId = UUID(uuidString: String(pieces[1].dropFirst(2)))
            }
            return .match(match, pointId: pointId)
        }
        if let range = href.range(of: "#journal-entry-"),
           let entryId = UUID(uuidString: String(href[range.upperBound...])) {
            return .entry(entryId)
        }
        if href.hasPrefix("/journal") { return .journal }
        if href.hasPrefix("/account") { return .account }
        return .none
    }

    @ViewBuilder
    private func sourceRow(_ source: AskState.Source, number: Int) -> some View {
        switch target(for: source) {
        case .match(let match, let pointId):
            NavigationLink(value: MatchPointRoute(match: match, pointId: pointId)) {
                sourceRowBody(source, number: number)
            }
            .buttonStyle(.plain)
        case .entry(let entryId):
            Button { onOpenEntry(entryId) } label: {
                sourceRowBody(source, number: number)
            }
            .buttonStyle(.plain)
        case .journal:
            Button { onOpenJournal() } label: {
                sourceRowBody(source, number: number)
            }
            .buttonStyle(.plain)
        case .account:
            NavigationLink(value: "account") {
                sourceRowBody(source, number: number)
            }
            .buttonStyle(.plain)
        case .none:
            sourceRowBody(source, number: number)
        }
    }

    private func sourceRowBody(_ source: AskState.Source, number: Int) -> some View {
        HStack(spacing: 10) {
            Text("\(number)")
                .font(.system(size: 11, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(PL.cyan)
                .frame(width: 20, height: 20)
                .background(PL.cyan.opacity(0.15), in: Circle())
            Text(source.title)
                .font(.plBody)
                .foregroundStyle(PL.text200)
                .lineLimit(1)
            Spacer(minLength: 8)
            Text(sourceMeta(source))
                .font(.plCaption)
                .foregroundStyle(PL.text500)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(
            PL.surface2.opacity(0.4),
            in: RoundedRectangle(cornerRadius: 10, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(PL.edge, lineWidth: 1)
        )
        .contentShape(Rectangle())
    }

    /// "Lesson · Aug 12". Sources that describe the whole journal carry a
    /// sentinel epoch date, which is not worth printing.
    private func sourceMeta(_ source: AskState.Source) -> String {
        let kind = kindLabel(source.kind)
        guard let date = PGDate.parse(source.when),
              date.timeIntervalSince1970 > 0
        else { return kind }
        return "\(kind) · \(PGDate.shortDate(source.when))"
    }

    private func kindLabel(_ kind: String) -> String {
        switch kind {
        case "note": "Note"
        case "lesson": "Lesson"
        case "practice": "Practice"
        case "match": "Match"
        case "working_on": "Working on"
        case "tags": "Tags"
        case "profile": "Profile"
        default: kind.capitalized
        }
    }

    private func refusalCopy(_ refused: String) -> String {
        switch refused {
        case "empty": "There is nothing in your journal to answer that from yet."
        case "off_topic": "That one is outside what your journal covers."
        default: "Your journal does not cover that yet."
        }
    }
}

// MARK: - Working on

struct WorkingOnCard: View {
    let store: JournalStore

    @Environment(AppState.self) private var app
    @State private var adding = false
    @State private var draft = ""
    @State private var notice: String?
    @State private var historyOpen = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("WORKING ON")
                    .font(.plSection)
                    .tracking(0.6)
                    .foregroundStyle(PL.cyan)
                Spacer()
                Button {
                    adding.toggle()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "plus").font(.system(size: 11, weight: .semibold))
                        Text("Add")
                    }
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(PL.text300)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }

            if store.activeCues.isEmpty && !adding {
                Text("The cues you're fixing right now.")
                    .font(.plBody)
                    .foregroundStyle(PL.text500)
            }

            ForEach(store.activeCues) { cue in
                HStack(spacing: 12) {
                    Button {
                        Task { await store.retireCue(cue) }
                    } label: {
                        Circle()
                            .strokeBorder(PL.text500, lineWidth: 1.5)
                            .frame(width: 22, height: 22)
                    }
                    .buttonStyle(.plain)
                    Text(cue.label)
                        .font(.plBody)
                        .foregroundStyle(PL.text200)
                }
            }

            if adding {
                HStack(spacing: 8) {
                    TextField("One cue, e.g. racket up between strokes", text: $draft)
                        .plField()
                        .onSubmit { Task { await add() } }
                    Button("Add") { Task { await add() } }
                        .buttonStyle(PLCyanGhostButtonStyle())
                        .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }

            if let notice {
                Text(notice)
                    .font(.plCaption)
                    .foregroundStyle(PL.warningText)
            }

            if !store.retiredCues.isEmpty {
                Button(historyOpen ? "Hide history" : "History (\(store.retiredCues.count))") {
                    withAnimation { historyOpen.toggle() }
                }
                .font(.plCaption)
                .foregroundStyle(PL.text500)
                .buttonStyle(.plain)
                if historyOpen {
                    ForEach(store.retiredCues) { cue in
                        HStack(spacing: 12) {
                            Image(systemName: "checkmark.circle")
                                .font(.system(size: 16))
                                .foregroundStyle(PL.text600)
                            Text(cue.label)
                                .font(.plBody)
                                .foregroundStyle(PL.text500)
                                .strikethrough()
                            Spacer()
                            Button("Restore") {
                                Task { await store.restoreCue(cue) }
                            }
                            .font(.plCaption)
                            .foregroundStyle(PL.cyan)
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                .strokeBorder(PL.cyan.opacity(0.35), lineWidth: 1)
        )
    }

    private func add() async {
        guard let uid = app.userId else { return }
        notice = await store.addCue(userId: uid, label: draft)
        if notice == nil {
            draft = ""
            adding = false
        }
    }
}

// MARK: - Lesson card

struct LessonCardView: View {
    let lesson: LessonRow
    let store: JournalStore
    let onEdit: () -> Void

    @Environment(AppState.self) private var app
    @State private var transcriptOpen = false
    @State private var deleteAsk = false
    @State private var deleting = false
    @State private var deleteError: String?
    @State private var addedPoints: Set<String> = []
    @State private var shareOpen = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 4) {
                if lesson.kind == "lesson" {
                    (Text("Lesson with ").foregroundColor(PL.text500)
                        + Text(lesson.coachName ?? "your coach").foregroundColor(PL.text200).fontWeight(.semibold)
                        + Text(" · \(PGDate.shortDate(lesson.createdAt))").foregroundColor(PL.text500))
                        .font(.system(size: 13))
                } else {
                    Text("Practice · \(PGDate.shortDate(lesson.createdAt))")
                        .font(.system(size: 13))
                        .foregroundStyle(PL.text500)
                }
                Spacer()
            }

            if let takeaways = lesson.takeaways {
                if let title = takeaways.title, !title.isEmpty {
                    Text(title)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(PL.text100)
                }
                // Keyed by position, not by the text. A hand-edited note
                // can hold two headings named the same or two identical
                // points, and identity by content makes those one row:
                // SwiftUI drops the duplicate and the card silently shows
                // less than the note contains.
                ForEach(Array((takeaways.themes ?? []).enumerated()), id: \.offset) { _, theme in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(theme.name.uppercased())
                            .font(.plSection)
                            .tracking(0.6)
                            .foregroundStyle(PL.cyan)
                        ForEach(Array(theme.points.enumerated()), id: \.offset) { _, point in
                            HStack(alignment: .top, spacing: 8) {
                                Circle().fill(PL.text600).frame(width: 4, height: 4)
                                    .padding(.top, 7)
                                EntryText(text: point)
                                Spacer(minLength: 0)
                                Button {
                                    Task {
                                        guard let uid = app.userId else { return }
                                        let notice = await store.addCue(userId: uid, label: point)
                                        if notice == nil { addedPoints.insert(point) }
                                    }
                                } label: {
                                    Image(systemName: addedPoints.contains(point) ? "checkmark" : "plus")
                                        .font(.system(size: 12, weight: .semibold))
                                        .foregroundStyle(addedPoints.contains(point) ? PL.success : PL.text500)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .padding(.top, 2)
                }
            } else if lesson.status == "queued" {
                Text("Reading it through…")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
            } else {
                EntryText(text: lesson.transcript)
                    .lineLimit(6)
            }

            // The photo the entry was saved with. It has been on the web
            // since the journal grew photos and invisible here the whole
            // time, which is the kind of gap only somebody using both ever
            // finds.
            if lesson.imagePath != nil {
                EntryPhotoView(lessonId: lesson.id)
            }

            // Pills rather than bare text. A `Button` with a plain Text
            // label and no padding is tappable only on the letters, about
            // 20 points of it, with no pressed state — hit it and it
            // works, miss and nothing happens at all. That is what made
            // the coach's sharing buttons read as broken (2026-09-03),
            // and this card had the identical shape.
            FlowLayout(spacing: 8) {
                if lesson.takeaways != nil {
                    Button(transcriptOpen ? "Hide transcript" : "Transcript") {
                        withAnimation { transcriptOpen.toggle() }
                    }
                    .buttonStyle(PLSecondaryButtonStyle())
                }
                Button("Edit") { onEdit() }
                    .buttonStyle(PLSecondaryButtonStyle())
                // Share sits beside Delete: a public read-only link to
                // this entry, minted in the sheet it opens. Hidden while
                // queued, same as the web card — the entry is not its
                // final self yet.
                if lesson.status != "queued" {
                    Button("Share") { shareOpen = true }
                        .buttonStyle(PLSecondaryButtonStyle())
                }
                Button("Delete") {
                    deleteError = nil
                    deleteAsk = true
                }
                .buttonStyle(PLSoftDestructiveButtonStyle())
                .disabled(deleting)
            }

            if let deleteError {
                Text(deleteError)
                    .font(.plCaption)
                    .foregroundStyle(PL.warningText)
            }

            if transcriptOpen {
                EntryText(text: lesson.transcript, font: .plCaption, color: PL.text400)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 16)
        .alert("Delete this entry?", isPresented: $deleteAsk) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) {
                Task {
                    deleting = true
                    let ok = await store.deleteLesson(lesson)
                    deleting = false
                    if !ok {
                        deleteError = "Couldn't delete this entry. Try again."
                    }
                }
            }
        }
        .sheet(isPresented: $shareOpen) {
            EntryShareSheet(lesson: lesson)
        }
    }
}

/// The sheet behind a journal entry's Share button — the same dress as
/// the match share sheet in MatchTools: the link line, the system share,
/// copy, a QR, all in one Form.
///
/// Opening it mints the link straight away: the Share tap on the card was
/// the decision, so there is nothing to ask first. POST /api/share is
/// idempotent, so reopening hands back the same URL rather than minting a
/// second one. The link is live — the page always shows the entry as it
/// currently reads, and deleting the entry kills it. "Turn off the link"
/// revokes on the spot; Account lists it beside every other public link.
struct EntryShareSheet: View {
    let lesson: LessonRow

    @Environment(\.dismiss) private var dismiss
    @State private var link: URL?
    @State private var linkId: String?
    @State private var creating = false
    @State private var revoking = false
    @State private var copied = false
    @State private var showQR = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
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
                    } footer: {
                        Text("Anyone with the link can read this entry, and it always shows the latest version.")
                    }
                    // "Revoke" is the product's one word for killing a
                    // link — Account and the match sheet both use it.
                    Section {
                        Button(revoking ? "Revoking…" : "Revoke the link", role: .destructive) {
                            Task { await turnOff() }
                        }
                        .disabled(revoking)
                        if let errorMessage {
                            Text(errorMessage)
                                .font(.plCaption)
                                .foregroundStyle(PL.dangerText)
                        }
                    }
                } else {
                    Section {
                        if creating {
                            Text("Creating the link…")
                                .foregroundStyle(PL.text400)
                        } else {
                            Button("Create the link") {
                                Task { await mint() }
                            }
                        }
                        if let errorMessage {
                            Text(errorMessage)
                                .font(.plCaption)
                                .foregroundStyle(PL.dangerText)
                        }
                    } footer: {
                        Text("Anyone with the link can read this entry, and it always shows the latest version. You can revoke it anytime.")
                    }
                }
            }
            .tint(PL.cyan)
            .navigationTitle("Share this entry")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
            .task {
                if link == nil { await mint() }
            }
        }
        .preferredColorScheme(.dark)
    }

    private struct MintResponse: Decodable {
        let url: String
        let id: String
    }

    private func mint() async {
        guard !creating else { return }
        creating = true
        errorMessage = nil
        // The entry's current headline rides along and is stored on the
        // link, so the Account list can tell shared entries apart.
        // Re-sharing refreshes it (the route patches the title on reuse).
        let kindLine = lesson.kind == "practice"
            ? "Practice"
            : lesson.coachName.map { "Lesson with \($0)" } ?? "Lesson"
        let title = lesson.takeaways?.title
            ?? "\(kindLine) · \(PGDate.shortDate(lesson.createdAt))"
        struct Req: Encodable {
            let lessonId: String
            let title: String
        }
        let res: MintResponse? = try? await API.post(
            "api/share",
            Req(lessonId: lesson.id.uuidString.lowercased(), title: title)
        )
        if let res, let url = URL(string: res.url) {
            link = url
            linkId = res.id
        } else {
            errorMessage = "Couldn't create the link. Try again."
        }
        creating = false
    }

    private func turnOff() async {
        guard let linkId, !revoking else { return }
        revoking = true
        errorMessage = nil
        struct Req: Encodable { let id: String }
        struct Res: Decodable { let ok: Bool? }
        let res: Res? = try? await API.post("api/share/revoke", Req(id: linkId))
        revoking = false
        if res != nil {
            dismiss()
        } else {
            errorMessage = "Couldn't turn the link off. Try again."
        }
    }
}

// MARK: - Composer

enum NewEntryChoice {
    case practice
    case lesson
    case record
}

/// What the journal's create button opens. Practice and lesson are the
/// same editor with a different frame around it, which is exactly the
/// thing a chooser is for: the decision is made once, up front, instead
/// of as a pair of pills inside a form.
///
/// Recording the lesson outright is the third: the phone sits by the net,
/// the coach talks, and the words come back written up.
struct NewEntrySheet: View {
    let onChoose: (NewEntryChoice) -> Void

    var body: some View {
        PLChooserSheet(title: "New entry") {
            PLChooserRow(
                icon: "figure.table.tennis",
                title: "Practice note",
                detail: "Drills, reflections, anything worth keeping."
            ) { onChoose(.practice) }
            PLChooserRow(
                icon: "text.bubble",
                title: "Lesson",
                detail: "What your coach gave you. Type it, speak it, or paste it."
            ) { onChoose(.lesson) }
            PLChooserRow(
                icon: "waveform",
                title: "Audio record a lesson",
                detail: "Put your phone near the net. Your notes are prepared automatically."
            ) { onChoose(.record) }
        }
    }
}

/// The sheet that makes a new entry. Correcting one that already exists
/// is `JournalNoteEditor`: it edits the written-up note rather than the
/// raw words, so this no longer has an editing mode at all.
struct JournalComposer: View {
    let store: JournalStore
    let onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var kind: String
    @State private var coachName: String
    @State private var body_: String
    @State private var summarize = true
    @State private var saving = false
    @State private var errorMessage: String?

    // Dictation and one attached photo, both shared with the coach's
    // entry composer (`EntryComposerParts.swift`). Entries keep only the
    // text of a dictation, so the audio itself is thrown away.
    @State private var dictation = Dictation()
    @State private var photo = EntryPhotoDraft()

    // Scan pages: photographs of a paper notebook, read into the same
    // draft field the dictation writes to. The photos are never stored —
    // the words come back and the images are dropped.
    @State private var libraryOpen = false
    @State private var cameraOpen = false
    @State private var scanItems: [PhotosPickerItem] = []
    @State private var scanning = false
    @State private var scanDone = 0
    @State private var scanTotal = 0
    /// What the batch came to, when it is worth saying: pages that were
    /// not notes pages, mostly.
    @State private var scanNote: String?

    init(
        store: JournalStore,
        initialKind: String = "practice",
        initialText: String = "",
        onSaved: @escaping () -> Void
    ) {
        self.store = store
        self.onSaved = onSaved
        _kind = State(initialValue: initialKind)
        _coachName = State(initialValue: "")
        _body_ = State(initialValue: initialText)
    }

    var body: some View {
        // Was a bare ScrollView with the save button as the last thing in
        // a left-aligned stack. On a short entry that put Save near the top
        // left with the rest of the sheet empty beneath it, which reads as
        // an unfinished screen rather than a form. This is the chrome the
        // recorder's details sheet uses: title in the bar, the commit
        // action top right where a sheet's commit action lives, and native
        // grouped sections that fill the width.
        PLSheetScaffold(
            title: title,
            doneLabel: saving ? "Saving…" : "Save",
            doneDisabled: saving || dictation.isBusy || photo.isBusy || scanning
                || body_.trimmingCharacters(in: .whitespaces).isEmpty,
            onDone: { Task { await save() } }
        ) {
            Form {
                if kind == "lesson" {
                    Section {
                        TextField("Who taught it?", text: $coachName)
                    }
                }

                Section {
                    TextField(
                        kind == "lesson"
                            ? "Paste the transcript, or start writing"
                            : "What did you work on today?",
                        text: $body_, axis: .vertical
                    )
                    .lineLimit(8...20)
                }

                Section {
                    DictationRow(dictation: dictation, disabled: saving || scanning) { words in
                        append(words)
                    }
                    scanRow
                    EntryPhotoRow(draft: photo, disabled: saving || scanning || dictation.isBusy)
                } footer: {
                    Text(scanNote ?? "Speak it, or photograph pages from a paper notebook; both come back as text you can edit. A photo you add is kept with the entry.")
                        .foregroundStyle(scanNote == nil ? PL.text500 : PL.warningText)
                }

                Section {
                    Toggle("Improve with AI", isOn: $summarize)
                } footer: {
                    Text("Your rough notes become clear, simple points. You can edit them afterwards.")
                }

                if let line = errorMessage ?? dictation.errorMessage ?? photo.errorMessage {
                    Section {
                        Text(line)
                            .font(.plBody)
                            .foregroundStyle(PL.dangerText)
                    }
                }
            }
            .plKeyboardDismiss()
            // On the Form rather than beside the camera cover. Two
            // presentations hung off the same view is one presentation:
            // SwiftUI keeps one and silently drops the other, which is
            // how a confirmation dialog ended up on screen with no
            // buttons that worked.
            .photosPicker(
                isPresented: $libraryOpen, selection: $scanItems,
                maxSelectionCount: PageScan.maxPages, matching: .images
            )
        }
        .fullScreenCover(isPresented: $cameraOpen) {
            PageCameraView(limit: PageScan.maxPages) { pages in
                if !pages.isEmpty { Task { await readPages(pages) } }
            }
        }
        .onChange(of: scanItems) { _, picked in
            guard !picked.isEmpty else { return }
            // Cleared straight away so choosing the same photos twice in a
            // row still registers as a change.
            scanItems = []
            Task {
                var jpegs: [Data] = []
                for item in picked.prefix(PageScan.maxPages) {
                    if let data = try? await item.loadTransferable(type: Data.self),
                       let image = UIImage(data: data),
                       let jpeg = PageScan.jpeg(image) {
                        jpegs.append(jpeg)
                    }
                }
                await readPages(jpegs)
            }
        }
        .onDisappear {
            // Swiped away mid-recording, or with a photo attached to an
            // entry that will never exist.
            dictation.cancel()
            photo.discard()
        }
    }

    /// The kind is settled before this opens, so the bar says which one
    /// this is instead of asking again.
    private var title: String {
        kind == "lesson" ? "New lesson" : "New practice note"
    }

    /// Photographed pages, in the same section as dictation because they
    /// are the same offer: a way to get words into the field without
    /// typing them.
    @ViewBuilder
    private var scanRow: some View {
        if scanning {
            HStack(spacing: 12) {
                ProgressView().tint(PL.cyan)
                Text(scanTotal > 1
                     ? "Reading page \(min(scanDone + 1, scanTotal)) of \(scanTotal)…"
                     : "Reading your page…")
                Spacer()
            }
        } else if PageScan.cameraAvailable {
            // Camera first: the notebook is open on the table, which is
            // the whole reason this belongs on a phone. The library is for
            // pages photographed earlier.
            Menu {
                Button { cameraOpen = true } label: {
                    Label("Take photos", systemImage: "camera")
                }
                Button { libraryOpen = true } label: {
                    Label("Choose photos", systemImage: "photo.on.rectangle")
                }
            } label: {
                scanLabel
            }
            .disabled(saving || dictation.isBusy)
        } else {
            // No camera to offer, so nothing to ask about.
            Button { libraryOpen = true } label: { scanLabel }
                .disabled(saving || dictation.isBusy)
        }
    }

    private var scanLabel: some View {
        HStack(spacing: 12) {
            Image(systemName: "doc.text.viewfinder")
                .foregroundStyle(PL.cyan)
            Text("Scan pages")
            Spacer()
        }
    }

    // MARK: - Scanning

    /// Read the pages one at a time, keeping whatever comes back.
    ///
    /// A page the model refuses is counted rather than raised: someone who
    /// photographed five pages and a thumb should get the five pages and
    /// one quiet line about the thumb. Anything that throws is the route
    /// itself refusing — no signal, or the day's allowance spent — and
    /// that stops the batch and says so, with the pages already read kept.
    private func readPages(_ jpegs: [Data]) async {
        guard !jpegs.isEmpty, !scanning else { return }
        scanning = true
        scanNote = nil
        errorMessage = nil
        scanTotal = min(jpegs.count, PageScan.maxPages)
        scanDone = 0
        defer {
            scanning = false
            scanTotal = 0
            scanDone = 0
        }

        var read: [String] = []
        var skipped = 0
        for jpeg in jpegs.prefix(PageScan.maxPages) {
            do {
                switch try await PageScan.read(jpeg) {
                case .text(let text): read.append(text)
                case .rejected, .failed: skipped += 1
                }
            } catch {
                errorMessage = (error as? APIError)?.errorDescription
                    ?? "Couldn't read those pages. Try again."
                break
            }
            scanDone += 1
        }

        if !read.isEmpty { append(read.joined(separator: "\n\n")) }
        if read.isEmpty, skipped > 0 {
            scanNote = "Those photos didn't look like notes pages."
        } else if skipped > 0 {
            scanNote = "Read \(read.count) page\(read.count == 1 ? "" : "s"). \(skipped) didn't look like notes."
        }
    }

    /// Add words to the draft without stepping on what is already there.
    private func append(_ text: String) {
        let existing = body_.trimmingCharacters(in: .whitespacesAndNewlines)
        body_ = existing.isEmpty ? text : existing + "\n\n" + text
    }

    private func save() async {
        saving = true
        errorMessage = nil
        let ok = await store.saveEntry(
            transcript: body_.trimmingCharacters(in: .whitespacesAndNewlines),
            kind: kind,
            coachName: kind == "lesson" && !coachName.trimmingCharacters(in: .whitespaces).isEmpty
                ? coachName.trimmingCharacters(in: .whitespaces) : nil,
            summarize: summarize,
            imagePath: photo.path
        )
        saving = false
        if ok {
            // The entry owns the photo now: let go of it rather than
            // deleting it on the way out.
            photo.release()
            onSaved()
            dismiss()
        } else {
            errorMessage = "Couldn't save it. Your words are still here, so try again."
        }
    }
}

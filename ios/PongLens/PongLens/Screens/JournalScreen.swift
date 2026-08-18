import SwiftUI
import Supabase

struct JournalScreen: View {
    @Environment(AppState.self) private var app
    @Environment(LibraryStore.self) private var library
    @State private var store = JournalStore()
    @State private var query = ""
    @State private var tab = "All"
    @State private var selectedTag: TagStatRow?
    @State private var composerOpen = false
    @State private var editingLesson: LessonRow?
    @State private var ask = AskState()

    private let feedCap = 30
    @State private var showAll = false

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("Journal")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)

                    searchField

                    AskPanelView(ask: ask, query: $query, examples: askExamples)

                    if !store.tagStats.isEmpty {
                        tagRail
                    }

                    if selectedTag == nil {
                        WorkingOnCard(store: store)
                        tabs
                        feed
                    } else {
                        taggedView
                    }
                }
                .padding(20)
                .padding(.top, 12)
                .padding(.bottom, 120)
            }
            .refreshable { await store.load(userId: app.userId) }

            PLFab(label: "New", systemImage: "plus") {
                editingLesson = nil
                composerOpen = true
            }
            .padding(20)
        }
        .task {
            if !store.loaded { await store.load(userId: app.userId) }
        }
        .sheet(isPresented: $composerOpen) {
            JournalComposer(store: store, editing: editingLesson) {
                Task { await store.load(userId: app.userId) }
            }
            .presentationDetents([.large])
            .presentationBackground(PL.surface)
            .presentationDragIndicator(.visible)
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
        }
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
                        editingLesson = lesson
                        composerOpen = true
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
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(["All", "Matches", "Lessons", "Practice"], id: \.self) { name in
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

        var id: UUID {
            switch self {
            case .note(let n): n.id
            case .lesson(let l): l.id
            }
        }

        var createdAt: String {
            switch self {
            case .note(let n): n.createdAt
            case .lesson(let l): l.createdAt
            }
        }
    }

    private var feedItems: [FeedItem] {
        var items: [FeedItem] = []
        if tab == "All" || tab == "Matches" {
            items += store.notes.map { .note($0) }
        }
        if tab != "Matches" {
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
        } else if items.isEmpty && store.notes.isEmpty && store.lessons.isEmpty {
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
                case .note(let note): noteCard(note)
                case .lesson(let lesson):
                    LessonCardView(lesson: lesson, store: store, onEdit: {
                        editingLesson = lesson
                        composerOpen = true
                    })
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
        default: "Nothing found."
        }
    }

    private func noteCard(_ note: NoteFeedRow) -> some View {
        let title = MatchTitle.parts(
            opponentName: note.opponentName, venue: note.venue, playedAt: note.playedAt
        ).primary
        let mine = note.authorId == app.userId
        return VStack(alignment: .leading, spacing: 8) {
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
            if !mine, let author = note.authorName {
                Text(author)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color(hex: 0xF0C420))
            }
            Text(note.body)
                .font(.plBody)
                .foregroundStyle(PL.text200)
                .lineLimit(4)
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
    struct Paragraph: Decodable { let text: String }
    struct Source: Decodable {
        let kind: String?
        let label: String?
        let date: String?
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

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if ask.loading {
                HStack(spacing: 10) {
                    ProgressView().tint(PL.cyan)
                    Text("Reading your journal…")
                        .font(.plBody)
                        .foregroundStyle(PL.text400)
                }
                .plCard(padding: 16)
            } else if let message = ask.errorMessage {
                Text(message)
                    .font(.plBody)
                    .foregroundStyle(PL.warningText)
                    .plCard(padding: 16)
            } else if let answer = ask.answer {
                answerCard(answer)
            } else if askable(query) {
                Button {
                    Task { await ask.fire(query) }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 13))
                        Text("Ask your journal")
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11, weight: .semibold))
                    }
                    .font(.plBody)
                    .foregroundStyle(PL.cyan)
                }
                .buttonStyle(.plain)
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

    @ViewBuilder
    private func answerCard(_ answer: AskState.Response) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if let refused = answer.refused, !refused.isEmpty {
                Text(refusalCopy(refused))
                    .font(.plBody)
                    .foregroundStyle(PL.text300)
            } else if let paragraphs = answer.answer {
                ForEach(Array(paragraphs.enumerated()), id: \.offset) { _, paragraph in
                    Text(paragraph.text)
                        .font(.plBody)
                        .foregroundStyle(PL.text200)
                        .lineSpacing(4)
                }
                if let sources = answer.sources, !sources.isEmpty {
                    SectionHeading("Where this comes from")
                    ForEach(Array(sources.enumerated()), id: \.offset) { i, source in
                        HStack(spacing: 6) {
                            Text("\(i + 1)")
                                .font(.system(size: 10, weight: .semibold))
                                .monospacedDigit()
                                .foregroundStyle(PL.text500)
                            Text([source.kind, source.label, source.date]
                                .compactMap { $0 }.joined(separator: " · "))
                                .font(.plCaption)
                                .foregroundStyle(PL.text400)
                                .lineLimit(1)
                        }
                    }
                }
                if let coverage = answer.coverage, !coverage.isEmpty {
                    Text(coverage)
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 16)
    }

    private func refusalCopy(_ refused: String) -> String {
        switch refused {
        case "empty": "There is nothing in your journal to answer that from yet."
        case "out_of_scope": "That one is outside what your journal covers."
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
    @State private var confirmingDelete = false
    @State private var addedPoints: Set<String> = []

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
                ForEach(takeaways.themes ?? [], id: \.name) { theme in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(theme.name.uppercased())
                            .font(.plSection)
                            .tracking(0.6)
                            .foregroundStyle(PL.cyan)
                        ForEach(theme.points, id: \.self) { point in
                            HStack(alignment: .top, spacing: 8) {
                                Circle().fill(PL.text600).frame(width: 4, height: 4)
                                    .padding(.top, 7)
                                Text(point)
                                    .font(.plBody)
                                    .foregroundStyle(PL.text200)
                                    .lineSpacing(3)
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
                Text(lesson.transcript)
                    .font(.plBody)
                    .foregroundStyle(PL.text200)
                    .lineLimit(6)
            }

            HStack(spacing: 16) {
                if lesson.takeaways != nil {
                    Button(transcriptOpen ? "Hide transcript" : "Transcript") {
                        withAnimation { transcriptOpen.toggle() }
                    }
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                    .buttonStyle(.plain)
                }
                Button("Edit") { onEdit() }
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                    .buttonStyle(.plain)
                Button(confirmingDelete ? "Delete?" : "Delete") {
                    if confirmingDelete {
                        Task { _ = await store.deleteLesson(lesson) }
                    } else {
                        confirmingDelete = true
                        Task {
                            try? await Task.sleep(nanoseconds: 3_000_000_000)
                            confirmingDelete = false
                        }
                    }
                }
                .font(.plCaption)
                .foregroundStyle(confirmingDelete ? PL.dangerText : PL.text500)
                .buttonStyle(.plain)
                Spacer()
            }

            if transcriptOpen {
                Text(lesson.transcript)
                    .font(.plCaption)
                    .foregroundStyle(PL.text400)
                    .lineSpacing(3)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 16)
    }
}

// MARK: - Composer

struct JournalComposer: View {
    let store: JournalStore
    let editing: LessonRow?
    let onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var kind: String
    @State private var coachName: String
    @State private var body_: String
    @State private var summarize = true
    @State private var saving = false
    @State private var errorMessage: String?

    init(store: JournalStore, editing: LessonRow?, onSaved: @escaping () -> Void) {
        self.store = store
        self.editing = editing
        self.onSaved = onSaved
        _kind = State(initialValue: editing?.kind ?? "practice")
        _coachName = State(initialValue: editing?.coachName ?? "")
        _body_ = State(initialValue: editing?.transcript ?? "")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(editing == nil ? "New entry" : "Edit entry")
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)

                HStack(spacing: 8) {
                    kindPill("Practice", value: "practice")
                    kindPill("Lesson", value: "lesson")
                }
                Text(kind == "lesson"
                    ? "What your coach gave you. Type it, speak it, or paste it."
                    : "Drills, reflections, anything worth keeping.")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)

                if kind == "lesson" {
                    TextField("Who taught it?", text: $coachName)
                        .plField()
                }

                TextField(
                    kind == "lesson" ? "Paste the transcript, or start writing" : "What did you work on today?",
                    text: $body_, axis: .vertical
                )
                .plField()
                .lineLimit(6...14)

                Toggle("Condense and summarize", isOn: $summarize)
                    .font(.plBody)
                    .foregroundStyle(PL.text200)
                    .tint(PL.cyan.opacity(0.5))

                if let errorMessage {
                    Text(errorMessage)
                        .font(.plCaption)
                        .foregroundStyle(PL.dangerText)
                }

                Button(saving ? (summarize ? "Reading it through…" : "Saving…")
                    : (editing == nil ? "Save entry" : "Save changes")) {
                    Task { await save() }
                }
                .buttonStyle(PLPrimaryButtonStyle())
                .disabled(saving || body_.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func kindPill(_ label: String, value: String) -> some View {
        let active = kind == value
        return Button(label) { kind = value }
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(active ? PL.cyan : PL.text500)
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(active ? PL.cyan.opacity(0.15) : .clear, in: Capsule())
            .overlay(Capsule().strokeBorder(active ? PL.cyan.opacity(0.5) : PL.edge, lineWidth: 1))
            .buttonStyle(.plain)
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
            editing: editing
        )
        saving = false
        if ok {
            onSaved()
            dismiss()
        } else {
            errorMessage = "Couldn't save it. Your words are still here — try again."
        }
    }
}

import SwiftUI

// MARK: - Note editor

/// What "Edit" opens on a journal entry.
///
/// It used to open the raw transcript, and saving threw the written-up
/// note away and made it again from scratch. Correcting one wrong bullet
/// therefore meant re-reading the speech-to-text of a forty-minute lesson
/// and having all sixteen points rewritten, so nobody did it and wrong
/// points stood forever. Here you edit the note itself, one line at a
/// time, and the words it came from are left exactly as they are.
///
/// An entry with no written-up note — short ones, and ones saved with
/// condensing turned off — has nothing to correct, so its words ARE the
/// note and the sheet edits those instead. That is the whole rule:
/// `takeaways != nil` edits the note, `takeaways == nil` edits the words.
///
/// Two things the create sheet carries are deliberately absent. Practice
/// or lesson was settled when the entry was made, and improving is a
/// choice about writing a note rather than about correcting one. Neither
/// question belongs on a screen for fixing a typo.
///
/// A coach correcting an entry about a student opens this same sheet.
/// The two sides differ only in where the save lands — the coach's
/// entries live in `CoachWorkspaceStore`, a player's in `JournalStore` —
/// so the saving is two closures rather than a store, and everything a
/// person sees is written down once.
struct JournalNoteEditor: View {
    let lesson: LessonRow
    /// Save the corrected note. nil on success, or a line worth showing.
    let onSaveNote: (LessonTakeaways, String?) async -> String?
    /// Save corrected words, for an entry that never had a note.
    let onSaveWords: (String, String?) async -> String?

    @Environment(\.dismiss) private var dismiss

    @State private var title: String
    @State private var themes: [DraftTheme]
    @State private var words: String
    @State private var coachName: String
    @State private var saving = false
    @State private var errorMessage: String?
    @State private var discardAsk = false
    @FocusState private var focus: Field?

    // What the sheet opened with, so Cancel can tell "nothing touched"
    // from "changes to lose". The draft ids are made once in init and
    // shared with these, so an untouched row compares equal.
    private let openedTitle: String
    private let openedThemes: [DraftTheme]
    private let openedWords: String
    private let openedCoach: String

    /// A player's own entry.
    init(lesson: LessonRow, store: JournalStore) {
        self.init(
            lesson: lesson,
            onSaveNote: { takeaways, coach in
                await store.saveNote(lesson: lesson, takeaways: takeaways, coachName: coach)
            },
            onSaveWords: { words, coach in
                await store.saveWords(lesson: lesson, transcript: words, coachName: coach)
            }
        )
    }

    init(
        lesson: LessonRow,
        onSaveNote: @escaping (LessonTakeaways, String?) async -> String?,
        onSaveWords: @escaping (String, String?) async -> String?
    ) {
        self.lesson = lesson
        self.onSaveNote = onSaveNote
        self.onSaveWords = onSaveWords
        let draft = Self.draft(from: lesson.takeaways)
        let title = lesson.takeaways?.title ?? ""
        let coach = lesson.coachName ?? ""
        _title = State(initialValue: title)
        _themes = State(initialValue: draft)
        _words = State(initialValue: lesson.transcript)
        _coachName = State(initialValue: coach)
        openedTitle = title
        openedThemes = draft
        openedWords = lesson.transcript
        openedCoach = coach
    }

    /// A note exists, so the note is what gets edited.
    private var editsNote: Bool { lesson.takeaways != nil }

    var body: some View {
        PLSheetScaffold(
            // What is on screen decides the word, the same way the web
            // does it: an entry with no written-up note has only its
            // words, and calling that "the note" reads as a different
            // screen from the one you are looking at.
            title: editsNote ? "Edit note" : "Edit entry",
            doneLabel: saving ? "Saving…" : "Save",
            doneDisabled: saving || !canSave,
            onDone: { Task { await save() } }
        ) {
            Form {
                if lesson.kind == "lesson" {
                    Section {
                        TextField("Who taught it?", text: $coachName)
                            .focused($focus, equals: .coach)
                    }
                }

                if editsNote {
                    noteSections
                } else {
                    Section {
                        TextField(
                            lesson.kind == "lesson"
                                ? "What your coach told you"
                                : "What you worked on",
                            text: $words, axis: .vertical
                        )
                        .lineLimit(8...20)
                        .focused($focus, equals: .words)
                    }
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
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        if dirty { discardAsk = true } else { dismiss() }
                    }
                    .disabled(saving)
                }
            }
            .confirmationDialog(
                "Discard your changes?", isPresented: $discardAsk, titleVisibility: .visible
            ) {
                Button("Discard", role: .destructive) { dismiss() }
                Button("Keep editing", role: .cancel) {}
            }
        }
        // Swiping the sheet away with edits in it loses them silently, and
        // nothing here has been written yet. With changes on screen the
        // way out is Cancel, which asks first.
        .interactiveDismissDisabled(dirty || saving)
    }

    // MARK: - The note

    @ViewBuilder
    private var noteSections: some View {
        Section {
            TextField("Title", text: $title)
                .font(.plCardTitle)
                .foregroundStyle(PL.text100)
                .focused($focus, equals: .title)
        }

        ForEach($themes) { $theme in
            Section {
                TextField("Heading", text: $theme.name)
                    .font(.plRowTitle)
                    .foregroundStyle(PL.cyan)
                    .focused($focus, equals: .heading(theme.id))
                    // Deleting a heading takes its points with it and does
                    // not ask. Nothing is written until Save, and Cancel
                    // puts the whole note back the way it was.
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            themes.removeAll { $0.id == theme.id }
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }

                ForEach($theme.points) { $point in
                    TextField("Point", text: $point.text, axis: .vertical)
                        .font(.plBody)
                        .foregroundStyle(PL.text200)
                        .focused($focus, equals: .point(point.id))
                }
                .onDelete { offsets in
                    guard let i = themes.firstIndex(where: { $0.id == theme.id }) else { return }
                    themes[i].points.remove(atOffsets: offsets)
                }

                // Icon-and-text rows, the shape this Form already uses for
                // "Dictate it" and "Scan pages" on the create sheet. A row
                // is what gets pressed inside a grouped list; a pill button
                // floating in a section reads as the section's own action.
                Button { addPoint(to: theme.id) } label: {
                    Label("Add point", systemImage: "plus.circle")
                }
            }
        }

        Section {
            Button { addTheme() } label: {
                Label("Add heading", systemImage: "plus.circle")
            }
        } footer: {
            if let blocker {
                Text(blocker).foregroundStyle(PL.warningText)
            }
        }

        Section {
            NavigationLink {
                TranscriptReader(text: lesson.transcript)
            } label: {
                Text("Transcript")
            }
        } footer: {
            Text("Read only.")
        }
    }

    // MARK: - Rows

    private func addTheme() {
        let theme = DraftTheme(name: "", points: [DraftPoint(text: "")])
        themes.append(theme)
        // A render behind the append: the row the keyboard is being sent
        // to does not exist yet on this pass, and focus set now lands on
        // nothing at all.
        DispatchQueue.main.async { focus = .heading(theme.id) }
    }

    private func addPoint(to themeId: UUID) {
        guard let i = themes.firstIndex(where: { $0.id == themeId }) else { return }
        let point = DraftPoint(text: "")
        themes[i].points.append(point)
        DispatchQueue.main.async { focus = .point(point.id) }
    }

    // MARK: - What can be saved

    /// The note as it would be stored: blank points dropped, and headings
    /// left holding nothing dropped with them. The server applies the same
    /// rules, so the card shows what this worked out either way — doing it
    /// here as well is what lets Save know whether anything is left.
    private var cleaned: [LessonTakeaways.Theme] {
        themes.compactMap { theme in
            let points = theme.points
                .map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            guard !points.isEmpty else { return nil }
            return LessonTakeaways.Theme(
                name: theme.name.trimmingCharacters(in: .whitespacesAndNewlines),
                points: points
            )
        }
    }

    private var canSave: Bool {
        guard editsNote else {
            return !words.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        return blocker == nil
    }

    /// Why Save is off, when it is off for a reason worth naming. A
    /// disabled button with nothing beside it reads as broken.
    private var blocker: String? {
        guard editsNote else { return nil }
        let ready = cleaned
        if ready.contains(where: { $0.name.isEmpty }) { return "Every heading needs a name." }
        if ready.isEmpty { return "A note needs at least one point." }
        return nil
    }

    private var dirty: Bool {
        if title != openedTitle || coachName != openedCoach { return true }
        return editsNote ? themes != openedThemes : words != openedWords
    }

    private func save() async {
        saving = true
        errorMessage = nil
        let coach = coachName.trimmingCharacters(in: .whitespacesAndNewlines)
        // A practice entry has no coach, and the name field is not shown
        // for one, so nothing is sent for it either.
        let sentCoach = lesson.kind == "lesson" ? (coach.isEmpty ? nil : coach) : nil

        let notice: String?
        if editsNote {
            notice = await onSaveNote(
                LessonTakeaways(
                    title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                    themes: cleaned
                ),
                sentCoach
            )
        } else {
            notice = await onSaveWords(
                words.trimmingCharacters(in: .whitespacesAndNewlines), sentCoach
            )
        }
        saving = false
        if let notice {
            errorMessage = notice
        } else {
            dismiss()
        }
    }

    // MARK: - Draft shapes

    /// The stored note carries bare strings, and a list cannot edit those:
    /// two identical points, or two headings named the same, are one row
    /// as far as SwiftUI is concerned and typing into either moves both.
    /// Each row gets an id of its own for as long as the sheet is open.
    private struct DraftTheme: Identifiable, Equatable {
        let id = UUID()
        var name: String
        var points: [DraftPoint]
    }

    private struct DraftPoint: Identifiable, Equatable {
        let id = UUID()
        var text: String
    }

    private enum Field: Hashable {
        case title, coach, words
        case heading(UUID)
        case point(UUID)
    }

    private static func draft(from takeaways: LessonTakeaways?) -> [DraftTheme] {
        (takeaways?.themes ?? []).map { theme in
            DraftTheme(
                name: theme.name,
                points: theme.points.map { DraftPoint(text: $0) }
            )
        }
    }
}

// MARK: - Transcript

/// The words the note was made from, on their own screen because a lesson
/// can run to forty minutes of speech and that does not belong in the
/// middle of a form. Selectable, so a name the microphone mangled can
/// still be copied out.
private struct TranscriptReader: View {
    let text: String

    var body: some View {
        ZStack {
            ArenaBackground()
            ScrollView {
                Text(text)
                    .font(.plBody)
                    .foregroundStyle(PL.text300)
                    .lineSpacing(4)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(20)
            }
        }
        .navigationTitle("Transcript")
        .navigationBarTitleDisplayMode(.inline)
    }
}

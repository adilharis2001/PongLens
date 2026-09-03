import SwiftUI

/// One entry, in the journal's language: the lesson card's own body and
/// its quiet text-button row (Transcript, Edit, Delete), with sharing as
/// a grouped card above it. Sharing is a live grant — edits after sharing
/// show on the student's side — and the card says so at the moment it
/// matters.
struct CoachEntryScreen: View {
    let entryId: UUID

    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    @Environment(CoachWorkspaceStore.self) private var workspace
    @Environment(LibraryStore.self) private var library

    @State private var editOpen = false
    @State private var sharing = false
    @State private var linkURL: URL?
    @State private var mintingLink = false
    @State private var linkCopied = false
    @State private var matchPickerOpen = false
    @State private var transcriptOpen = false
    @State private var deleteAsk = false
    @State private var errorLine: String?

    private var entry: CoachEntryRow? {
        workspace.entries.first { $0.id == entryId }
    }
    private var lesson: LessonRow? {
        entry.flatMap { workspace.lesson(for: $0) }
    }
    private var student: CoachStudentRow? {
        entry.flatMap { workspace.student($0.studentId) }
    }
    private var linkedMatch: MatchRow? {
        guard let id = lesson?.matchId else { return nil }
        return library.matches.first { $0.id == id }
    }
    private var matchChoices: [MatchRow] {
        guard let playerId = student?.playerId else { return [] }
        return library.matches
            .filter { $0.userId == playerId }
            .sorted { $0.createdAt > $1.createdAt }
    }

    var body: some View {
        ZStack {
            ArenaBackground()
            if let entry, let student {
                content(entry, student)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $editOpen) {
            // The player's own editor, pointed at the coach's store. An
            // entry that came back as points is corrected point by point;
            // one that never had any has its words edited instead. That
            // rule lives in the editor, so it cannot disagree between the
            // two sides of one lesson.
            if let entry, let lesson {
                JournalNoteEditor(
                    lesson: lesson,
                    onSaveNote: { takeaways, _ in
                        await workspace.saveNote(entry, takeaways: takeaways)
                    },
                    onSaveWords: { words, _ in
                        await workspace.saveWords(entry, transcript: words)
                    }
                )
            }
        }
        .sheet(isPresented: $matchPickerOpen) {
            if let entry { matchPicker(entry) }
        }
        .confirmationDialog(
            "Delete this entry?",
            isPresented: $deleteAsk,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                guard let entry else { return }
                Task {
                    if await workspace.deleteEntry(entry) { dismiss() }
                    else { errorLine = "Couldn't delete it. Try again." }
                }
            }
            Button("Keep", role: .cancel) {}
        } message: {
            Text(entry?.sharedAt != nil
                 ? "It disappears from your student's journal too."
                 : "The entry is deleted.")
        }
    }

    private func content(_ entry: CoachEntryRow, _ student: CoachStudentRow) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Button {
                    dismiss()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 12, weight: .semibold))
                        Text(student.displayName)
                    }
                }
                .buttonStyle(PLSecondaryButtonStyle())

                Text(lesson?.takeaways?.title.flatMap { $0.isEmpty ? nil : $0 } ?? "Entry")
                    .font(.plPageTitle)
                    .tracking(-0.6)
                    .foregroundStyle(PL.textBody)

                shareGroup(entry, student)

                entryCard(entry)

                if let match = linkedMatch {
                    CoachGroup("Match") {
                        NavigationLink(value: match) {
                            CoachMatchLine(match: match)
                        }
                        .buttonStyle(.plain)
                    }
                } else if student.linked, !matchChoices.isEmpty {
                    CoachGroup {
                        CoachNavRow(label: "Link one of their matches", symbol: "play.rectangle") {
                            matchPickerOpen = true
                        }
                    }
                }

                if let errorLine {
                    Text(errorLine)
                        .font(.plCaption)
                        .foregroundStyle(PL.dangerText)
                }
            }
            .padding(20)
            .padding(.bottom, 60)
        }
    }

    // MARK: - Sharing

    @ViewBuilder
    private func shareGroup(_ entry: CoachEntryRow, _ student: CoachStudentRow) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if student.linked {
                if entry.sharedAt != nil {
                    HStack(spacing: 10) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 16))
                            .foregroundStyle(PL.cyan)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Shared with \(student.displayName)")
                                .font(.plRowTitle)
                                .foregroundStyle(PL.text100)
                            Text("Edits show on their side.")
                                .font(.plCaption)
                                .foregroundStyle(PL.text500)
                        }
                        Spacer()
                    }
                } else {
                    Button {
                        Task {
                            sharing = true
                            _ = await workspace.setShared(entry, shared: true)
                            sharing = false
                        }
                    } label: {
                        Text(sharing ? "Sharing…" : "Share with \(student.displayName)")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PLPrimaryButtonStyle())
                    .disabled(sharing)
                }
            } else {
                Text("\(student.displayName) isn't on PongLens. Send the link below; it opens without an account, and joining from it connects you.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 16) {
                if let linkURL {
                    ShareLink(item: linkURL) {
                        Text("Send link")
                    }
                    Button(linkCopied ? "Copied" : "Copy link") {
                        UIPasteboard.general.string = linkURL.absoluteString
                        linkCopied = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { linkCopied = false }
                    }
                } else {
                    Button(mintingLink ? "Getting the link…" : "Get a link") {
                        Task { await mintLink(entry) }
                    }
                    .disabled(mintingLink)
                }
                Spacer()
                if student.linked, entry.sharedAt != nil {
                    Button("Stop sharing") {
                        Task {
                            sharing = true
                            _ = await workspace.setShared(entry, shared: false)
                            sharing = false
                        }
                    }
                    .disabled(sharing)
                }
            }
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(PL.text400)
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 16)
    }

    private func mintLink(_ entry: CoachEntryRow) async {
        guard let uid = app.userId else { return }
        mintingLink = true
        linkURL = await workspace.entryLinkURL(owner: uid, entry: entry, title: lesson?.takeaways?.title)
        mintingLink = false
        if linkURL == nil {
            errorLine = "Couldn't get a link. Try again."
        }
    }

    // MARK: - The entry itself, as the journal draws one

    private func entryCard(_ entry: CoachEntryRow) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Entry · \(PGDate.shortDate(entry.createdAt))")
                .font(.system(size: 13))
                .foregroundStyle(PL.text500)

            if let takeaways = lesson?.takeaways, !(takeaways.themes ?? []).isEmpty {
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
                            }
                        }
                    }
                    .padding(.top, 2)
                }
            } else if lesson?.status == "queued" {
                Text("Reading it through…")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
            } else {
                EntryText(text: lesson?.transcript ?? "")
            }

            if let lesson, lesson.imagePath != nil {
                EntryPhotoView(lessonId: lesson.id)
            }

            HStack(spacing: 16) {
                if lesson?.takeaways != nil {
                    Button(transcriptOpen ? "Hide transcript" : "Transcript") {
                        withAnimation { transcriptOpen.toggle() }
                    }
                }
                // Always, not only when there is nothing written up. An
                // improved entry was the one you could NOT correct, which
                // is the entry most likely to need it.
                Button("Edit") { editOpen = true }
                    .disabled(lesson == nil)
                Spacer()
                Button("Delete") { deleteAsk = true }
            }
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(PL.text400)
            .buttonStyle(.plain)

            if transcriptOpen {
                EntryText(
                    text: lesson?.transcript ?? "", font: .plCaption, color: PL.text400
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 16)
    }

    // MARK: - Match picker

    private func matchPicker(_ entry: CoachEntryRow) -> some View {
        PLSheetScaffold(title: "Link a match", doneLabel: "Cancel") {
            List {
                ForEach(matchChoices) { match in
                    Button {
                        matchPickerOpen = false
                        Task { _ = await workspace.setMatch(entry, matchId: match.id) }
                    } label: {
                        CoachMatchLine(match: match)
                            .padding(.horizontal, -16)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

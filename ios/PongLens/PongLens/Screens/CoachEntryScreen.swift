import SwiftUI

/// One entry, and everything the coach does with it: read it, share it,
/// fix the words, tie it to a match, or delete it. Sharing is a live
/// grant — edits after sharing show on the student's side — and the
/// screen says so at the moment it matters.
struct CoachEntryScreen: View {
    let entryId: UUID

    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    @Environment(CoachWorkspaceStore.self) private var workspace
    @Environment(LibraryStore.self) private var library

    @State private var editOpen = false
    @State private var draft = ""
    @State private var savingWords = false
    @State private var editError: String?
    @State private var sharing = false
    @State private var linkURL: URL?
    @State private var mintingLink = false
    @State private var linkCopied = false
    @State private var matchPickerOpen = false
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

    var body: some View {
        ZStack {
            ArenaBackground()
            if let entry, let student {
                content(entry, student)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $editOpen) { editSheet }
        .sheet(isPresented: $matchPickerOpen) { matchPicker }
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
            VStack(alignment: .leading, spacing: 20) {
                Button {
                    dismiss()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 12, weight: .semibold))
                        Text("Back")
                    }
                }
                .buttonStyle(PLSecondaryButtonStyle())

                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text(student.displayName)
                            .font(.plSection)
                            .tracking(0.6)
                            .foregroundStyle(PL.cyan)
                        Text(PLWhen.day(entry.createdAt))
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                        Spacer()
                        Menu {
                            Button("Edit the words") { openEditor() }
                            if student.linked, !matchChoices.isEmpty {
                                Button(linkedMatch == nil ? "Link a match" : "Change the match") {
                                    matchPickerOpen = true
                                }
                            }
                            if lesson?.matchId != nil {
                                Button("Unlink the match") {
                                    Task { _ = await workspace.setMatch(entry, matchId: nil) }
                                }
                            }
                            Button("Delete entry", role: .destructive) { deleteAsk = true }
                        } label: {
                            Image(systemName: "ellipsis")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(PL.text400)
                                .frame(width: 34, height: 34)
                                .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))
                                .contentShape(Circle())
                        }
                    }
                    if let title = lesson?.takeaways?.title, !title.isEmpty {
                        Text(title)
                            .font(.plPageTitle)
                            .tracking(-0.6)
                            .foregroundStyle(PL.textBody)
                    }
                }

                shareCard(entry, student)

                if let match = linkedMatch {
                    VStack(alignment: .leading, spacing: 10) {
                        SectionHeading("Match")
                        NavigationLink(value: match) {
                            CoachMatchLine(match: match)
                        }
                        .buttonStyle(.plain)
                        .plCard(padding: 0)
                    }
                }

                entryBody

                if let errorLine {
                    Text(errorLine)
                        .font(.plCaption)
                        .foregroundStyle(PL.dangerText)
                }
            }
            .padding(20)
            .padding(.bottom, 40)
        }
    }

    // MARK: - Sharing

    @ViewBuilder
    private func shareCard(_ entry: CoachEntryRow, _ student: CoachStudentRow) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if student.linked {
                if entry.sharedAt != nil {
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 15))
                            .foregroundStyle(PL.cyan)
                        Text("Shared with \(student.displayName). Edits show on their side.")
                            .font(.plCaption)
                            .foregroundStyle(PL.text300)
                        Spacer()
                        Button("Stop sharing") {
                            Task {
                                sharing = true
                                _ = await workspace.setShared(entry, shared: false)
                                sharing = false
                            }
                        }
                        .buttonStyle(PLSecondaryButtonStyle())
                        .disabled(sharing)
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
                Text("\(student.displayName) isn't on PongLens. Send them the link — it opens without an account, and joining from it connects you.")
                    .font(.plCaption)
                    .foregroundStyle(PL.text400)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let linkURL {
                HStack(spacing: 10) {
                    ShareLink(item: linkURL) {
                        Label("Send the link", systemImage: "square.and.arrow.up")
                            .font(.plButtonSecondary)
                    }
                    .buttonStyle(PLSecondaryButtonStyle())
                    Button(linkCopied ? "Copied" : "Copy") {
                        UIPasteboard.general.string = linkURL.absoluteString
                        linkCopied = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                            linkCopied = false
                        }
                    }
                    .buttonStyle(PLSecondaryButtonStyle())
                }
            } else {
                Button {
                    Task { await mintLink(entry) }
                } label: {
                    Label(mintingLink ? "Getting the link…" : "Get a link",
                          systemImage: "link")
                        .font(.plButtonSecondary)
                }
                .buttonStyle(PLSecondaryButtonStyle())
                .disabled(mintingLink)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 16)
    }

    private func mintLink(_ entry: CoachEntryRow) async {
        guard let uid = app.userId else { return }
        mintingLink = true
        let title = lesson?.takeaways?.title
        linkURL = await workspace.entryLinkURL(owner: uid, entry: entry, title: title)
        mintingLink = false
        if linkURL == nil {
            errorLine = "Couldn't get a link. Try again."
        }
    }

    // MARK: - Body

    @ViewBuilder
    private var entryBody: some View {
        if let takeaways = lesson?.takeaways, !(takeaways.themes ?? []).isEmpty {
            VStack(alignment: .leading, spacing: 18) {
                ForEach(takeaways.themes ?? [], id: \.name) { theme in
                    VStack(alignment: .leading, spacing: 7) {
                        Text(theme.name.uppercased())
                            .font(.plSection)
                            .tracking(0.6)
                            .foregroundStyle(PL.cyan)
                        ForEach(theme.points, id: \.self) { point in
                            HStack(alignment: .top, spacing: 8) {
                                Circle().fill(PL.text600)
                                    .frame(width: 4, height: 4)
                                    .padding(.top, 7)
                                Text(point)
                                    .font(.plBody)
                                    .foregroundStyle(PL.text200)
                                    .lineSpacing(3)
                                Spacer(minLength: 0)
                            }
                        }
                    }
                }
                DisclosureGroup {
                    Text(lesson?.transcript ?? "")
                        .font(.plBody)
                        .foregroundStyle(PL.text300)
                        .lineSpacing(4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 8)
                } label: {
                    Text("Transcript")
                        .font(.plRowTitle)
                        .foregroundStyle(PL.text400)
                }
                .tint(PL.text400)
            }
        } else {
            Text(lesson?.transcript ?? "")
                .font(.plBody)
                .foregroundStyle(PL.text200)
                .lineSpacing(4)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: - Edit

    private func openEditor() {
        draft = lesson?.transcript ?? ""
        editError = nil
        editOpen = true
    }

    private var editSheet: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                TextEditor(text: $draft)
                    .font(.plBody)
                    .foregroundStyle(PL.text200)
                    .lineSpacing(4)
                    .scrollContentBackground(.hidden)
                    .padding(10)
                    .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                            .strokeBorder(PL.edge, lineWidth: 1)
                    )
                if let editError {
                    Text(editError)
                        .font(.plCaption)
                        .foregroundStyle(PL.dangerText)
                }
                HStack(spacing: 10) {
                    Button(savingWords ? "Saving…" : "Save") {
                        Task { await saveWords() }
                    }
                    .buttonStyle(PLPrimaryButtonStyle())
                    .disabled(savingWords || draft.trimmingCharacters(in: .whitespaces).isEmpty)
                    Button("Cancel") { editOpen = false }
                        .buttonStyle(PLSecondaryButtonStyle())
                        .disabled(savingWords)
                }
            }
            .padding(20)
            .background(ArenaBackground())
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    private func saveWords() async {
        guard let entry else { return }
        savingWords = true
        editError = await workspace.saveWords(
            entry, transcript: draft.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        savingWords = false
        if editError == nil { editOpen = false }
    }

    // MARK: - Match link

    private var matchChoices: [MatchRow] {
        guard let playerId = student?.playerId else { return [] }
        return library.matches
            .filter { $0.userId == playerId }
            .sorted { $0.createdAt > $1.createdAt }
    }

    private var matchPicker: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Link a match")
                    .font(.plPageTitle)
                    .tracking(-0.6)
                    .foregroundStyle(PL.textBody)
                VStack(spacing: 0) {
                    ForEach(Array(matchChoices.enumerated()), id: \.element.id) { i, match in
                        Button {
                            guard let entry else { return }
                            matchPickerOpen = false
                            Task { _ = await workspace.setMatch(entry, matchId: match.id) }
                        } label: {
                            CoachMatchLine(match: match)
                        }
                        .buttonStyle(.plain)
                        if i < matchChoices.count - 1 {
                            Divider().overlay(PL.edge)
                        }
                    }
                }
                .plCard(padding: 0)
            }
            .padding(20)
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(PL.surface)
        .presentationDragIndicator(.visible)
    }
}

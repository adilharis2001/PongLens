import SwiftUI

/// One student's page, in the Account page's grammar: Back, the name, a
/// primary action, then grouped rows and cards. Reads live from the
/// store by id, so a rename or a share flip shows immediately.
struct CoachStudentScreen: View {
    let studentId: UUID

    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    @Environment(CoachRouter.self) private var router
    @Environment(CoachWorkspaceStore.self) private var workspace
    @Environment(LibraryStore.self) private var library

    @State private var inviteOpen = false
    @State private var renameOpen = false
    @State private var renameDraft = ""
    @State private var archiveAsk = false
    @State private var mergeAsk = false
    @State private var sharingId: UUID?
    @State private var bulkBusy = false

    private var student: CoachStudentRow? { workspace.student(studentId) }

    /// Rows still waiting for an account: the ones a joined student can be
    /// folded into (161).
    private var offlineStudents: [CoachStudentRow] {
        workspace.activeStudents.filter { !$0.linked && $0.id != studentId }
    }

    /// Game scores for the matches on screen (169). The same walk the
    /// player's own app runs, so the two can never disagree.
    @State private var scores: [UUID: MatchScoreChip] = [:]

    private var matches: [MatchRow] {
        guard let playerId = student?.playerId else { return [] }
        return library.matches
            .filter { $0.userId == playerId }
            .sorted { $0.createdAt > $1.createdAt }
    }

    var body: some View {
        ZStack {
            ArenaBackground()
            if let student {
                content(student)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $inviteOpen) {
            StudentInviteSheet(student: student)
        }
        .alert("Rename student", isPresented: $renameOpen) {
            TextField("Their name", text: $renameDraft)
            Button("Save") {
                guard let student else { return }
                Task { _ = await workspace.renameStudent(student, to: renameDraft) }
            }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog(
            "Remove this student?",
            isPresented: $archiveAsk,
            titleVisibility: .visible
        ) {
            Button("Remove", role: .destructive) {
                guard let student else { return }
                Task {
                    if await workspace.archiveStudent(student) { dismiss() }
                }
            }
            Button("Keep", role: .cancel) {}
        } message: {
            Text(student?.linked == true
                 ? "They come off your list and you stop seeing their matches. Your entries are kept."
                 : "They come off your list. Your entries are kept.")
        }
        .confirmationDialog(
            "Which student are they?",
            isPresented: $mergeAsk,
            titleVisibility: .visible
        ) {
            ForEach(offlineStudents) { other in
                Button(other.displayName) {
                    guard let student else { return }
                    Task {
                        if await workspace.mergeStudent(student, into: other, userId: app.userId) {
                            dismiss()
                        }
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Your entries about them come along, and their account connects to that name.")
        }
    }

    /// The card's own share: the same grant the entry screen makes.
    private func share(_ entry: CoachEntryRow) {
        sharingId = entry.id
        Task {
            _ = await workspace.setShared(entry, shared: true)
            sharingId = nil
        }
    }

    @ViewBuilder
    private func headStart(_ student: CoachStudentRow) -> some View {
        let all = workspace.entries(for: student.id)
        let marked = all.filter { $0.sharedAt != nil }.count
        let rest = all.count - marked
        if !all.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text(marked == 0
                     ? "None of your \(all.count) \(all.count == 1 ? "entry" : "entries") are shared yet."
                     : rest == 0
                        ? "\(student.displayName) gets \(all.count == 1 ? "your entry" : "all \(all.count) entries") when they join."
                        : "\(student.displayName) gets \(marked) of \(all.count) entries when they join.")
                    .font(.plBody)
                    .foregroundStyle(PL.text200)
                    .fixedSize(horizontal: false, vertical: true)
                if rest > 0 {
                    Button(bulkBusy
                           ? "Sharing…"
                           : marked == 0
                              ? "Share all \(rest) when they join"
                              : "Share the other \(rest)") {
                        bulkBusy = true
                        Task {
                            _ = await workspace.shareAll(studentId: student.id)
                            bulkBusy = false
                        }
                    }
                    .buttonStyle(PLCyanGhostButtonStyle())
                    .disabled(bulkBusy)
                }
            }
        }
    }

    private func content(_ student: CoachStudentRow) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Button {
                    dismiss()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 12, weight: .semibold))
                        Text("Students")
                    }
                }
                .buttonStyle(PLSecondaryButtonStyle())

                // Who, whether they are on PongLens, and the page's actions
                // together. New entry is the only primary; Invite stands
                // beside it while there is nobody at the other end yet,
                // and goes when there is. The old screen put the primary
                // above a large "Connect" card, two calls to action with
                // no relationship (Adil, 2026-09-05). Both fill the width
                // and stack, the way every action button on a phone does
                // here; the label is sized first so the hit area grows
                // with the visible button (baseline 2026-09-05).
                VStack(alignment: .leading, spacing: 4) {
                    Text(student.displayName)
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)
                    Text(student.linked ? "On PongLens" : "Not on PongLens yet")
                        .font(.plBody)
                        .foregroundStyle(PL.text500)
                }

                VStack(spacing: 10) {
                    Button {
                        router.newEntryStudent = student
                        router.newEntryOpen = true
                    } label: {
                        Label("New entry", systemImage: "square.and.pencil")
                            .frame(maxWidth: .infinity, minHeight: 28)
                    }
                    .buttonStyle(PLPrimaryButtonStyle())
                    if !student.linked {
                        Button {
                            inviteOpen = true
                        } label: {
                            Text("Invite \(student.displayName)")
                                .frame(maxWidth: .infinity, minHeight: 28)
                        }
                        .buttonStyle(PLSecondaryButtonStyle())
                    }
                }

                // Every section from here down is built the same way: a
                // heading, then one card. Where a section is empty it says
                // so inside the card and, if there is something to do
                // about it, offers that as a row, the way Lesson videos
                // always has (Adil, 2026-09-05).
                let entries = workspace.entries(for: student.id)
                if entries.isEmpty {
                    CoachGroup("Journal") {
                        CoachGroupLine(text: "No entries yet.")
                        CoachRowDivider()
                        CoachNavRow(label: "New entry", symbol: "square.and.pencil") {
                            router.newEntryStudent = student
                            router.newEntryOpen = true
                        }
                    }
                } else {
                    VStack(alignment: .leading, spacing: 10) {
                        SectionHeading("Journal")
                        // What the invite will hand over, and the one button
                        // that shares the rest (2026-09-04). It used to sit in
                        // the Connect card; with that card gone it belongs
                        // above the entries it is counting, while there is
                        // nobody at the other end to receive them yet.
                        if !student.linked {
                            headStart(student)
                        }
                        ForEach(entries) { entry in
                            NavigationLink(value: entry) {
                                CoachEntryCard(
                                    entry: entry,
                                    lesson: workspace.lesson(for: entry),
                                    shareWith: student.displayName,
                                    studentLinked: student.linked,
                                    sharing: sharingId == entry.id,
                                    onShare: { share(entry) }
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                // Their journal, the half they chose to show you (164).
                // Read-only and clearly theirs: the entries above are
                // yours, written about them, and the two must never look
                // like one pile.
                let fromThem = workspace.shared(from: student)
                if !fromThem.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        // Their journal, named as such. "From <name>" read like a
                        // message addressed to the coach, something to act
                        // on, rather than a window onto what the student
                        // keeps for themselves (Adil, 2026-09-04).
                        SectionHeading("\(possessive(student.displayName)) journal")
                        ForEach(fromThem) { shared in
                            StudentSharedCard(entry: shared)
                        }
                    }
                }

                // Always here, connected or not. It used to exist only once
                // the student had an account, so a coach looking at a new
                // student had no way to know matches would ever appear
                // (Adil, 2026-09-05). Unconnected, it says what it is
                // waiting for and offers the one thing that gets it there.
                Group {
                    if !student.linked {
                        CoachGroup("Matches") {
                            CoachGroupLine(text: "Their matches show here once they're connected.")
                            CoachRowDivider()
                            CoachNavRow(label: "Invite \(student.displayName)", symbol: "link") {
                                inviteOpen = true
                            }
                        }
                    } else if matches.isEmpty {
                        CoachGroup("Matches") {
                            CoachGroupLine(text: "Nothing shared yet.")
                        }
                    } else {
                        VStack(alignment: .leading, spacing: 10) {
                            SectionHeading("Matches")
                            // Cards, not a list of names (Adil,
                            // 2026-09-04). A coach opening a new student
                            // should SEE what they have been doing rather
                            // than read dates and tap each one to find
                            // out.
                            VStack(spacing: 8) {
                                ForEach(matches) { match in
                                    NavigationLink(value: match) {
                                        CoachMatchCard(
                                            match: match,
                                            score: scores[match.id]
                                        )
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                }
                .task(id: matches.map(\.id)) {
                    let ready = matches.filter { $0.status == .ready }.map(\.id)
                    guard !ready.isEmpty else { return }
                    scores = await CoachMatchScores.load(matchIds: ready)
                }

                CoachLessonVideosSection(student: student)

                CoachGroup("Manage") {
                    CoachNavRow(label: "Rename") {
                        renameDraft = student.displayName
                        renameOpen = true
                    }
                    if student.linked && !offlineStudents.isEmpty {
                        CoachRowDivider()
                        CoachNavRow(label: "Same as an existing student") {
                            mergeAsk = true
                        }
                    }
                    CoachRowDivider()
                    CoachNavRow(label: "Remove from students", tint: PL.dangerText) {
                        archiveAsk = true
                    }
                }
            }
            .padding(20)
            .padding(.bottom, 60)
        }
    }
}

/// One line inside a group card, where a section says "nothing yet" or
/// what it is waiting for. The same words CoachEmptyLine draws as a card
/// of its own, drawn as a row so it can sit above an action in one card.
private struct CoachGroupLine: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.plBody)
            .foregroundStyle(PL.text400)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
    }
}

/// One entry a student shared from their own journal (164). Their words,
/// so there is nothing to edit and nothing to share on: the only actions
/// on this card are reading it.
private struct StudentSharedCard: View {
    let entry: StudentSharedLesson
    @State private var open = false

    /// The first line of substance, for a card that is closed.
    private var preview: String? {
        let first = entry.takeaways?.themes?.first?.points.first
        let words = (first ?? entry.transcript)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        if words.isEmpty { return nil }
        return words.count > 140 ? String(words.prefix(140)) + "…" : words
    }

    /// One line to name it: the distilled title, else the opening words.
    /// Same rule as CoachEntryCard and the web's entryTitle().
    private var title: String {
        if let t = entry.takeaways?.title, !t.isEmpty { return t }
        let words = entry.transcript
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        if words.isEmpty { return "Entry" }
        return words.count > 72 ? String(words.prefix(72)) + "…" : words
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                open.toggle()
            } label: {
                HStack(alignment: .top, spacing: 8) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(title)
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(PL.text100)
                            .multilineTextAlignment(.leading)
                        Text(PGDate.shortDate(entry.createdAt))
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                        // A title and a date alone say nothing about
                        // whether an entry is worth opening; the first
                        // thing the student actually wrote does.
                        if !open, let peek = preview, !peek.isEmpty {
                            Text(peek)
                                .font(.plBody)
                                .foregroundStyle(PL.text400)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                                .padding(.top, 2)
                        }
                    }
                    Spacer(minLength: 8)
                    Image(systemName: open ? "chevron.up" : "chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(PL.text500)
                }
            }
            .buttonStyle(.plain)

            if open {
                if let themes = entry.takeaways?.themes, !themes.isEmpty {
                    ForEach(themes, id: \.name) { theme in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(theme.name.uppercased())
                                .font(.system(size: 11, weight: .semibold))
                                .kerning(0.6)
                                .foregroundStyle(PL.cyan.opacity(0.8))
                            ForEach(theme.points, id: \.self) { point in
                                Text(point)
                                    .font(.plBody)
                                    .foregroundStyle(PL.text300)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                } else {
                    Text(entry.transcript)
                        .font(.plBody)
                        .foregroundStyle(PL.text300)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 16)
    }
}

/// One of a student's matches, as a coach sees it (169): the picture,
/// who it was against, when and where, and how it went.
private struct CoachMatchCard: View {
    let match: MatchRow
    let score: MatchScoreChip?

    private var title: String {
        if let opponent = match.opponentName, !opponent.isEmpty {
            return "vs \(opponent)"
        }
        if let name = match.originalName, !name.isEmpty { return name }
        return match.matchType == "practice" ? "Practice" : "Match"
    }

    private var subtitle: String {
        [PGDate.shortDate(match.playedAt), match.venue]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    var body: some View {
        HStack(spacing: 12) {
            Group {
                if match.status == .ready {
                    MatchThumb(matchId: match.id)
                } else {
                    ThumbPlaceholder()
                }
            }
            .frame(width: 104, height: 58)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(PL.textBody)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                    .lineLimit(1)
                if let score {
                    HStack(spacing: 6) {
                        Text("\(score.you)–\(score.them)")
                            .font(.system(size: 13, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(PL.text200)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .overlay(
                                Capsule().strokeBorder(PL.edge, lineWidth: 1)
                            )
                        if !score.complete {
                            Text("in progress")
                                .font(.plCaption)
                                .foregroundStyle(PL.text600)
                        }
                    }
                    .padding(.top, 1)
                } else if match.status != .ready {
                    Text(match.status == .failed ? "Failed" : "Working on it")
                        .font(.plCaption)
                        .foregroundStyle(PL.text600)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 10)
    }
}

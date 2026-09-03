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

    private var student: CoachStudentRow? { workspace.student(studentId) }

    /// Rows still waiting for an account: the ones a joined student can be
    /// folded into (161).
    private var offlineStudents: [CoachStudentRow] {
        workspace.activeStudents.filter { !$0.linked && $0.id != studentId }
    }

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

                VStack(alignment: .leading, spacing: 4) {
                    Text(student.displayName)
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)
                    Text(student.linked ? "On PongLens" : "Not on PongLens yet")
                        .font(.plBody)
                        .foregroundStyle(PL.text500)
                }

                Button {
                    router.newEntryStudent = student
                    router.newEntryOpen = true
                } label: {
                    Label("New entry", systemImage: "square.and.pencil")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(PLPrimaryButtonStyle())

                if !student.linked {
                    // The invite, framed the way the player's "Bring your
                    // coach" is: what it does, then the one row that does it.
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Connect \(student.displayName)")
                            .font(.plCardTitle)
                            .foregroundStyle(PL.text100)
                        Text("An invite links them to their PongLens account. You'll see the matches they upload, and the entries you share reach their journal.")
                            .font(.plBody)
                            .foregroundStyle(PL.text400)
                            .lineSpacing(3)
                        VStack(spacing: 0) {
                            CoachNavRow(label: "Invite \(student.displayName)", symbol: "link") {
                                inviteOpen = true
                            }
                        }
                        .background(PL.ink.opacity(0.4), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                                .strokeBorder(PL.edge, lineWidth: 1)
                        )
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .plCard(padding: 16)
                }

                let entries = workspace.entries(for: student.id)
                VStack(alignment: .leading, spacing: 10) {
                    SectionHeading("Journal")
                    if entries.isEmpty {
                        CoachEmptyLine(text: "No entries yet.")
                    } else {
                        ForEach(entries) { entry in
                            NavigationLink(value: entry) {
                                CoachEntryCard(
                                    entry: entry,
                                    lesson: workspace.lesson(for: entry),
                                    shareWith: student.linked ? student.displayName : nil,
                                    sharing: sharingId == entry.id,
                                    onShare: { share(entry) }
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                if student.linked {
                    VStack(alignment: .leading, spacing: 10) {
                        SectionHeading("Matches")
                        if matches.isEmpty {
                            CoachEmptyLine(text: "Nothing shared yet.")
                        } else {
                            CoachGroup {
                                ForEach(Array(matches.enumerated()), id: \.element.id) { i, match in
                                    NavigationLink(value: match) {
                                        CoachMatchLine(match: match)
                                    }
                                    .buttonStyle(.plain)
                                    if i < matches.count - 1 { CoachRowDivider() }
                                }
                            }
                        }
                    }
                }

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

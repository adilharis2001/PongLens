import SwiftUI

/// One student's page: their journal, their shared matches, and the
/// invite that links them when they are not on PongLens yet. Reads live
/// from the store by id, so a rename or a share flip shows immediately.
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

    private var student: CoachStudentRow? { workspace.student(studentId) }

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
            Text("They come off your list. Your entries are kept.")
        }
    }

    private func content(_ student: CoachStudentRow) -> some View {
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

                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(student.displayName)
                            .font(.plPageTitle)
                            .tracking(-0.6)
                            .foregroundStyle(PL.textBody)
                        if !student.linked {
                            Text("Not on PongLens yet")
                                .font(.plCaption)
                                .foregroundStyle(PL.text500)
                        }
                    }
                    Spacer()
                    Menu {
                        Button("Rename") {
                            renameDraft = student.displayName
                            renameOpen = true
                        }
                        Button("Remove from students", role: .destructive) {
                            archiveAsk = true
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(PL.text400)
                            .frame(width: 34, height: 34)
                            .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))
                            .contentShape(Circle())
                    }
                }

                HStack(spacing: 10) {
                    Button {
                        router.newEntryStudent = student
                        router.newEntryOpen = true
                    } label: {
                        Label("New entry", systemImage: "square.and.pencil")
                            .font(.plButtonSecondary)
                    }
                    .buttonStyle(PLSecondaryButtonStyle())
                    if !student.linked {
                        Button {
                            inviteOpen = true
                        } label: {
                            Label("Invite", systemImage: "person.badge.plus")
                                .font(.plButtonSecondary)
                        }
                        .buttonStyle(PLSecondaryButtonStyle())
                    }
                }

                let entries = workspace.entries(for: student.id)
                VStack(alignment: .leading, spacing: 10) {
                    SectionHeading("Journal")
                    if entries.isEmpty {
                        Text("No entries yet.")
                            .font(.plBody)
                            .foregroundStyle(PL.text400)
                    } else {
                        ForEach(entries) { entry in
                            NavigationLink(value: entry) {
                                CoachEntryCard(
                                    entry: entry,
                                    lesson: workspace.lesson(for: entry)
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
                            Text("Nothing shared yet.")
                                .font(.plBody)
                                .foregroundStyle(PL.text400)
                        } else {
                            VStack(spacing: 0) {
                                ForEach(Array(matches.enumerated()), id: \.element.id) { i, match in
                                    NavigationLink(value: match) {
                                        CoachMatchLine(match: match)
                                    }
                                    .buttonStyle(.plain)
                                    if i < matches.count - 1 {
                                        Divider().overlay(PL.edge)
                                    }
                                }
                            }
                            .plCard(padding: 0)
                        }
                    }
                }
            }
            .padding(20)
            .padding(.bottom, 96)
        }
    }
}

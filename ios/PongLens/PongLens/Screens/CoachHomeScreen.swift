import SwiftUI

/// The coaching workspace's front page: what students sent, what was
/// written lately, and the two actions a coach reaches for between
/// lessons. Everything here is a doorway — the roster is the real home
/// of each student's record.
struct CoachHomeScreen: View {
    @Environment(AppState.self) private var app
    @Environment(CoachRouter.self) private var router
    @Environment(CoachWorkspaceStore.self) private var workspace
    @Environment(LibraryStore.self) private var library

    @State private var inviteOpen = false

    /// Students' matches, newest first. The library already holds them —
    /// RLS delivers every match a coach link covers — so this only keeps
    /// the ones that are not the coach's own.
    private var studentMatches: [MatchRow] {
        guard let uid = app.userId else { return [] }
        return library.matches
            .filter { $0.userId != uid }
            .sorted { $0.createdAt > $1.createdAt }
    }

    private func studentName(ownerId: UUID) -> String {
        workspace.students.first { $0.playerId == ownerId }?.displayName ?? "Student"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Text("Coaching")
                    .font(.plPageTitle)
                    .tracking(-0.6)
                    .foregroundStyle(PL.textBody)

                if workspace.loaded && workspace.activeStudents.isEmpty {
                    emptyState
                } else {
                    quickActions

                    if !studentMatches.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            SectionHeading("From your students")
                            VStack(spacing: 0) {
                                ForEach(Array(studentMatches.prefix(6).enumerated()), id: \.element.id) { i, match in
                                    NavigationLink(value: match) {
                                        CoachMatchLine(
                                            match: match,
                                            studentName: studentName(ownerId: match.userId)
                                        )
                                    }
                                    .buttonStyle(.plain)
                                    if i < min(studentMatches.count, 6) - 1 {
                                        Divider().overlay(PL.edge)
                                    }
                                }
                            }
                            .plCard(padding: 0)
                        }
                    }

                    if !workspace.entries.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            SectionHeading("Recent entries")
                            ForEach(workspace.entries.prefix(5)) { entry in
                                NavigationLink(value: entry) {
                                    CoachEntryCard(
                                        entry: entry,
                                        lesson: workspace.lesson(for: entry),
                                        studentName: workspace.student(entry.studentId)?.displayName
                                    )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    if studentMatches.isEmpty && workspace.entries.isEmpty {
                        Text("Nothing here yet. Write your first entry, or open Students to see who has shared matches.")
                            .font(.plBody)
                            .foregroundStyle(PL.text400)
                            .padding(.top, 8)
                    }
                }
            }
            .padding(20)
            .padding(.bottom, 96)
        }
        .sheet(isPresented: $inviteOpen) {
            StudentInviteSheet(student: nil)
        }
    }

    private var quickActions: some View {
        HStack(spacing: 10) {
            Button {
                router.newEntryStudent = nil
                router.newEntryOpen = true
            } label: {
                Label("New entry", systemImage: "square.and.pencil")
                    .font(.plButtonSecondary)
            }
            .buttonStyle(PLSecondaryButtonStyle())
            Button {
                inviteOpen = true
            } label: {
                Label("Invite a student", systemImage: "person.badge.plus")
                    .font(.plButtonSecondary)
            }
            .buttonStyle(PLSecondaryButtonStyle())
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("No students yet.")
                .font(.plCardTitle)
                .foregroundStyle(PL.text100)
            Text("Add a student to start keeping lesson notes. An invite links them to their PongLens account, and their matches show up here.")
                .font(.plBody)
                .foregroundStyle(PL.text400)
                .lineSpacing(3)
            HStack(spacing: 10) {
                Button("Add a student") { router.tab = .students }
                    .buttonStyle(PLPrimaryButtonStyle())
                Button("Invite") { inviteOpen = true }
                    .buttonStyle(PLSecondaryButtonStyle())
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 20)
    }
}

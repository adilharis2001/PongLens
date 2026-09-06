import SwiftUI

/// The coaching workspace's front page, built the way the player's Home
/// is: a title, then cards and grouped rows, and the New entry pill as the
/// one create door. Nothing floats at the top — the roster is the first
/// card, and everything else is a doorway into a student.
struct CoachHomeScreen: View {
    @Environment(AppState.self) private var app
    @Environment(CoachRouter.self) private var router
    @Environment(CoachWorkspaceStore.self) private var workspace
    @Environment(LibraryStore.self) private var library

    @State private var inviteOpen = false
    @State private var sharingId: UUID?

    /// Students' matches, newest first. The library already holds them —
    /// RLS delivers every match a coach link covers — so this keeps the
    /// ones owned by someone on the live roster. A match reachable only
    /// through a paid review order belongs to the web's orders pages.
    private var studentMatches: [MatchRow] {
        let owners = Set(workspace.activeStudents.compactMap(\.playerId))
        return library.matches
            .filter { owners.contains($0.userId) }
            .sorted { $0.createdAt > $1.createdAt }
    }

    /// Entries for students still on the roster; an archived student's
    /// record stays reachable from their entries, not from Home.
    private var recentEntries: [CoachEntryRow] {
        let live = Set(workspace.activeStudents.map(\.id))
        return workspace.entries.filter { live.contains($0.studentId) }
    }

    private func studentName(ownerId: UUID) -> String {
        workspace.students.first { $0.playerId == ownerId }?.displayName ?? "Student"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                Text("Coaching")
                    .font(.plPageTitle)
                    .tracking(-0.6)
                    .foregroundStyle(PL.textBody)

                if workspace.loadFailed && !workspace.loaded {
                    loadFailedState
                } else if workspace.loaded && workspace.activeStudents.isEmpty {
                    firstStudentCard
                    CoachLessonVideosSection()
                } else if workspace.loaded {
                    studentsGroup

                    CoachLessonVideosSection()

                    if !studentMatches.isEmpty {
                        CoachGroup("From your students") {
                            ForEach(Array(studentMatches.prefix(6).enumerated()), id: \.element.id) { i, match in
                                NavigationLink(value: match) {
                                    CoachMatchLine(match: match, studentName: studentName(ownerId: match.userId))
                                }
                                .buttonStyle(.plain)
                                if i < min(studentMatches.count, 6) - 1 { CoachRowDivider() }
                            }
                        }
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        SectionHeading("Recent entries")
                        if recentEntries.isEmpty {
                            CoachEmptyLine(text: "No entries yet. New entry writes the first.")
                        } else {
                            ForEach(recentEntries.prefix(5)) { entry in
                                let student = workspace.student(entry.studentId)
                                NavigationLink(value: entry) {
                                    CoachEntryCard(
                                        entry: entry,
                                        lesson: workspace.lesson(for: entry),
                                        studentName: student?.displayName,
                                        shareWith: student?.displayName,
                                        studentLinked: student?.linked == true,
                                        sharing: sharingId == entry.id,
                                        onShare: {
                                            sharingId = entry.id
                                            Task {
                                                _ = await workspace.setShared(entry, shared: true)
                                                sharingId = nil
                                            }
                                        }
                                    )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
            .padding(20)
            .padding(.top, 12)
            .padding(.bottom, 120)
        }
        .refreshable { await workspace.load(userId: app.userId) }
        .sheet(isPresented: $inviteOpen) {
            StudentInviteSheet(student: nil)
        }
    }

    /// The roster at a glance: the same grouped rows the Students tab
    /// draws, capped, with the tab one row away.
    private var studentsGroup: some View {
        CoachGroup("Students") {
            let shown = Array(workspace.activeStudents.prefix(4))
            ForEach(Array(shown.enumerated()), id: \.element.id) { i, student in
                NavigationLink(value: student) {
                    CoachStudentLine(student: student, entryCount: workspace.entries(for: student.id).count)
                }
                .buttonStyle(.plain)
                if i < shown.count - 1 { CoachRowDivider() }
            }
            if workspace.activeStudents.count > shown.count {
                CoachRowDivider()
                CoachNavRow(label: "All students") { router.tab = .students }
            }
        }
    }

    /// The first-run card, in the same shape as the player's "Add your
    /// first match": a symbol, a bold line, one paragraph, one row.
    private var firstStudentCard: some View {
        VStack(spacing: 14) {
            Image(systemName: "person.2.fill")
                .font(.system(size: 34))
                .foregroundStyle(PL.cyan)
                .padding(.top, 6)
            Text("Add your first student")
                .font(.plCardTitle)
                .foregroundStyle(PL.text100)
            Text("Keep lesson notes on each student and share them when they're ready. An invite links them to their PongLens account, and the matches they upload show up here.")
                .font(.plBody)
                .foregroundStyle(PL.text400)
                .multilineTextAlignment(.center)
                .lineSpacing(4)
            VStack(spacing: 0) {
                CoachNavRow(label: "Add a student", symbol: "person.badge.plus") {
                    router.tab = .students
                    router.addStudentOpen = true
                }
                CoachRowDivider()
                CoachNavRow(label: "Invite a new student", symbol: "link") { inviteOpen = true }
            }
            .background(PL.ink.opacity(0.4), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            )
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .plCard(padding: 24)
    }

    private var loadFailedState: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Couldn't load your students.")
                .font(.plCardTitle)
                .foregroundStyle(PL.text100)
            Text("Check your connection and try again.")
                .font(.plBody)
                .foregroundStyle(PL.text400)
            Button("Try again") {
                Task { await workspace.load(userId: app.userId) }
            }
            .buttonStyle(PLPrimaryButtonStyle())
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 20)
    }
}

/// One student as a grouped row: initial, name, a quiet second line.
struct CoachStudentLine: View {
    let student: CoachStudentRow
    var entryCount: Int = 0
    var matchCount: Int = 0

    private var summary: String {
        guard student.linked else { return "Not on PongLens yet" }
        var parts: [String] = []
        if matchCount > 0 { parts.append("\(matchCount) match\(matchCount == 1 ? "" : "es")") }
        if entryCount > 0 { parts.append("\(entryCount) entr\(entryCount == 1 ? "y" : "ies")") }
        return parts.isEmpty ? "On PongLens" : parts.joined(separator: " · ")
    }

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(PL.surface2)
                Text(String(student.displayName.prefix(1)).uppercased())
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(student.linked ? PL.cyan : PL.text500)
            }
            .frame(width: 36, height: 36)
            .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))
            VStack(alignment: .leading, spacing: 2) {
                Text(student.displayName)
                    .font(.system(size: 16))
                    .foregroundStyle(PL.textBody)
                Text(summary)
                    .font(.system(size: 13))
                    .foregroundStyle(PL.text500)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(PL.text600)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }
}

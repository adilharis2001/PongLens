import SwiftUI

/// The roster, as grouped rows like the Account page: every student the
/// coach works with, on PongLens or not, with "Add a student" as the last
/// row the way Account ends its coaching group with "Add a coach".
struct CoachStudentsScreen: View {
    @Environment(AppState.self) private var app
    @Environment(CoachRouter.self) private var router
    @Environment(CoachWorkspaceStore.self) private var workspace
    @Environment(LibraryStore.self) private var library

    @State private var inviteOpen = false

    private func matchCount(for student: CoachStudentRow) -> Int {
        guard let playerId = student.playerId else { return 0 }
        return library.matches.filter { $0.userId == playerId }.count
    }

    var body: some View {
        @Bindable var router = router
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                Text("Students")
                    .font(.plPageTitle)
                    .tracking(-0.6)
                    .foregroundStyle(PL.textBody)

                if workspace.loadFailed && !workspace.loaded {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Couldn't load your students. Check your connection.")
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
                } else if workspace.loaded {
                    CoachGroup {
                        ForEach(Array(workspace.activeStudents.enumerated()), id: \.element.id) { i, student in
                            NavigationLink(value: student) {
                                CoachStudentLine(
                                    student: student,
                                    entryCount: workspace.entries(for: student.id).count,
                                    matchCount: matchCount(for: student)
                                )
                            }
                            .buttonStyle(.plain)
                            CoachRowDivider()
                        }
                        CoachNavRow(label: "Add a student", symbol: "person.badge.plus") {
                            router.addStudentOpen = true
                        }
                        CoachRowDivider()
                        CoachNavRow(label: "Invite a new student", symbol: "link") {
                            inviteOpen = true
                        }
                    }

                    if workspace.activeStudents.isEmpty {
                        Text("No students yet.")
                            .font(.plBody)
                            .foregroundStyle(PL.text400)
                    }
                }
            }
            .padding(20)
            .padding(.top, 12)
            .padding(.bottom, 120)
        }
        .refreshable { await workspace.load(userId: app.userId) }
        .sheet(isPresented: $router.addStudentOpen) {
            AddStudentSheet()
        }
        .sheet(isPresented: $inviteOpen) {
            StudentInviteSheet(student: nil)
        }
    }
}

/// The composer's chrome for one field: title in the bar, Add top right,
/// a grouped form. Same scaffold the journal's composer stands in.
struct AddStudentSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    @Environment(CoachWorkspaceStore.self) private var workspace

    @State private var name = ""
    @State private var adding = false
    @State private var errorMessage: String?

    var body: some View {
        PLSheetScaffold(
            title: "Add a student",
            doneLabel: adding ? "Adding…" : "Add",
            doneDisabled: adding || name.trimmingCharacters(in: .whitespaces).isEmpty,
            onDone: { Task { await add() } }
        ) {
            Form {
                Section {
                    TextField("Their name", text: $name)
                        .textContentType(.name)
                        .submitLabel(.done)
                        .onSubmit { Task { await add() } }
                } footer: {
                    Text("They don't need the app for you to keep notes. Invite them later and everything connects.")
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
        }
        .presentationDetents([.medium])
    }

    private func add() async {
        guard let uid = app.userId else { return }
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        adding = true
        errorMessage = nil
        let row = await workspace.addStudent(coachId: uid, name: clean)
        adding = false
        if row == nil {
            errorMessage = "Couldn't add them. Try again."
        } else {
            dismiss()
        }
    }
}

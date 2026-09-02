import SwiftUI

/// The roster. Every student the coach works with, on PongLens or not;
/// tapping through is where their matches and journal live.
struct CoachStudentsScreen: View {
    @Environment(AppState.self) private var app
    @Environment(CoachWorkspaceStore.self) private var workspace
    @Environment(LibraryStore.self) private var library

    @State private var addOpen = false
    @State private var newName = ""
    @State private var adding = false
    @State private var addError: String?

    private func matchCount(for student: CoachStudentRow) -> Int {
        guard let playerId = student.playerId else { return 0 }
        return library.matches.filter { $0.userId == playerId }.count
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text("Students")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)
                    Spacer()
                    Button("Add a student") {
                        newName = ""
                        addError = nil
                        addOpen = true
                    }
                    .buttonStyle(PLSecondaryButtonStyle())
                }

                if workspace.loaded && workspace.activeStudents.isEmpty {
                    Text("No students yet.")
                        .font(.plBody)
                        .foregroundStyle(PL.text400)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(workspace.activeStudents.enumerated()), id: \.element.id) { i, student in
                            NavigationLink(value: student) {
                                row(student)
                            }
                            .buttonStyle(.plain)
                            if i < workspace.activeStudents.count - 1 {
                                Divider().overlay(PL.edge)
                            }
                        }
                    }
                    .plCard(padding: 0)
                }
            }
            .padding(20)
            .padding(.bottom, 96)
        }
        .sheet(isPresented: $addOpen) {
            addSheet
                .presentationDetents([.height(260)])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
    }

    private func row(_ student: CoachStudentRow) -> some View {
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
                    .font(.plRowTitle)
                    .foregroundStyle(PL.text100)
                if student.linked {
                    let matches = matchCount(for: student)
                    let entries = workspace.entries(for: student.id).count
                    Text(summary(matches: matches, entries: entries))
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                } else {
                    Text("Not on PongLens yet")
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                }
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(PL.text500)
        }
        .padding(14)
        .contentShape(Rectangle())
    }

    private func summary(matches: Int, entries: Int) -> String {
        var parts: [String] = []
        if matches > 0 { parts.append("\(matches) match\(matches == 1 ? "" : "es")") }
        if entries > 0 { parts.append("\(entries) entr\(entries == 1 ? "y" : "ies")") }
        return parts.isEmpty ? "On PongLens" : parts.joined(separator: " · ")
    }

    private var addSheet: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Add a student")
                .font(.plPageTitle)
                .tracking(-0.6)
                .foregroundStyle(PL.textBody)
            TextField("Their name", text: $newName)
                .plField()
                .submitLabel(.done)
                .onSubmit { Task { await add() } }
            Text("They don't need the app for you to keep notes. Invite them later and everything connects.")
                .font(.plCaption)
                .foregroundStyle(PL.text500)
                .fixedSize(horizontal: false, vertical: true)
            if let addError {
                Text(addError)
                    .font(.plCaption)
                    .foregroundStyle(PL.dangerText)
            }
            Button(adding ? "Adding…" : "Add") {
                Task { await add() }
            }
            .buttonStyle(PLPrimaryButtonStyle())
            .disabled(adding)
            .frame(maxWidth: .infinity)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func add() async {
        guard let uid = app.userId else { return }
        let clean = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else {
            addError = "Enter their name to add them."
            return
        }
        adding = true
        addError = nil
        let row = await workspace.addStudent(coachId: uid, name: clean)
        adding = false
        if row == nil {
            addError = "Couldn't add them. Try again."
        } else {
            addOpen = false
        }
    }
}

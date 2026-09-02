import SwiftUI

/// Creating an entry, in the journal composer's own chrome: title in the
/// bar, Save top right, a grouped form. The student is a picker in the
/// form when the chooser did not already say who; recording opens the
/// same full-screen recorder a player's lesson uses, pointed at the
/// coach's journal instead of their own.
struct CoachEntryComposer: View {
    let request: CoachComposerRequest

    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    @Environment(CoachWorkspaceStore.self) private var workspace

    @State private var studentId: UUID?
    @State private var draft = ""
    @State private var summarize = true
    @State private var saving = false
    @State private var errorMessage: String?

    private var student: CoachStudentRow? {
        studentId.flatMap { workspace.student($0) }
    }

    var body: some View {
        Group {
            switch request.mode {
            case .write:
                editor
            case .record:
                recorder
            }
        }
        .onAppear {
            if studentId == nil { studentId = request.student?.id ?? workspace.activeStudents.first?.id }
        }
    }

    // MARK: - Writing

    private var editor: some View {
        PLSheetScaffold(
            title: "New entry",
            doneLabel: saving ? "Saving…" : "Save",
            doneDisabled: saving || student == nil
                || draft.trimmingCharacters(in: .whitespaces).isEmpty,
            onDone: {
                Task {
                    guard let student else { return }
                    if await save(student: student, transcript: draft, summarize: summarize) {
                        dismiss()
                    }
                }
            }
        ) {
            Form {
                Section {
                    Picker("Student", selection: $studentId) {
                        ForEach(workspace.activeStudents) { row in
                            Text(row.displayName).tag(Optional(row.id))
                        }
                    }
                }

                Section {
                    TextField(
                        "What you worked on, what to fix, what comes next",
                        text: $draft, axis: .vertical
                    )
                    .lineLimit(8...20)
                }

                Section {
                    Toggle("Condense and summarize", isOn: $summarize)
                } footer: {
                    Text("Summarizing reads the whole entry through and writes it up as short points, so saving takes a few seconds longer.")
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
    }

    // MARK: - Recording

    @ViewBuilder
    private var recorder: some View {
        if let student {
            LessonRecordScreen(
                hideAuthorField: true,
                saveAs: { transcript in
                    await save(student: student, transcript: transcript, summarize: true)
                },
                onSaved: {}
            )
        } else {
            // The chooser opened without a student and the roster is
            // empty: nothing to record about. Say so rather than record
            // into nowhere.
            ZStack {
                ArenaBackground()
                VStack(spacing: 14) {
                    Text("Add a student first")
                        .font(.plCardTitle)
                        .foregroundStyle(PL.text100)
                    Text("Entries live under a student. Add one in Students, then record.")
                        .font(.plBody)
                        .foregroundStyle(PL.text400)
                        .multilineTextAlignment(.center)
                    Button("Close") { dismiss() }
                        .buttonStyle(PLSecondaryButtonStyle())
                }
                .padding(32)
            }
            .preferredColorScheme(.dark)
        }
    }

    // MARK: - Save

    private func save(student: CoachStudentRow, transcript: String, summarize: Bool) async -> Bool {
        let words = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let uid = app.userId, !words.isEmpty else { return false }
        saving = true
        errorMessage = nil
        let entry = await workspace.createEntry(
            coachId: uid, studentId: student.id, transcript: words, summarize: summarize
        )
        saving = false
        if entry == nil {
            errorMessage = "Couldn't save the entry. Try again."
            return false
        }
        return true
    }
}

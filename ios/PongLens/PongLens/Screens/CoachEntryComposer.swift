import SwiftUI

/// Creating an entry, both ways in. Writing gets a plain editor; audio
/// gets the same recorder a player's lesson uses, pointed at the coach's
/// journal instead of their own. When the chooser did not already say
/// which student, picking one is the first step — an entry about nobody
/// has nowhere to live.
struct CoachEntryComposer: View {
    let request: CoachComposerRequest

    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    @Environment(CoachWorkspaceStore.self) private var workspace

    @State private var student: CoachStudentRow?
    @State private var draft = ""
    @State private var saving = false
    @State private var errorLine: String?

    var body: some View {
        ZStack {
            ArenaBackground()
            if let student {
                switch request.mode {
                case .write:
                    editor(student)
                case .record:
                    LessonRecordScreen(
                        hideAuthorField: true,
                        saveAs: { transcript in
                            await save(student: student, transcript: transcript, summarize: true)
                        },
                        onSaved: {}
                    )
                }
            } else {
                studentPicker
            }
        }
        .preferredColorScheme(.dark)
        .onAppear {
            student = request.student
        }
    }

    // MARK: - Student picker

    private var studentPicker: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text("Who is this about?")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)
                    Spacer()
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(PL.text400)
                            .frame(width: 34, height: 34)
                            .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Close")
                }
                .padding(.top, 8)

                if workspace.activeStudents.isEmpty {
                    Text("No students yet. Add one in Students first.")
                        .font(.plBody)
                        .foregroundStyle(PL.text400)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(workspace.activeStudents.enumerated()), id: \.element.id) { i, row in
                            Button {
                                student = row
                            } label: {
                                HStack(spacing: 12) {
                                    Text(row.displayName)
                                        .font(.plRowTitle)
                                        .foregroundStyle(PL.text100)
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.system(size: 12, weight: .semibold))
                                        .foregroundStyle(PL.text500)
                                }
                                .padding(14)
                                .contentShape(Rectangle())
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
            .padding(24)
        }
    }

    // MARK: - Writing

    private func editor(_ student: CoachStudentRow) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("New entry")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)
                    Text(student.displayName)
                        .font(.plSection)
                        .tracking(0.6)
                        .foregroundStyle(PL.cyan)
                }
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(PL.text400)
                        .frame(width: 34, height: 34)
                        .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close")
            }
            .padding(.top, 8)

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
                .frame(maxHeight: .infinity)

            Text("What you worked on, what to fix, what comes next. Share it from the entry when it's ready.")
                .font(.plCaption)
                .foregroundStyle(PL.text500)

            if let errorLine {
                Text(errorLine)
                    .font(.plCaption)
                    .foregroundStyle(PL.dangerText)
            }

            Button(saving ? "Saving…" : "Save entry") {
                Task {
                    let ok = await save(
                        student: student,
                        transcript: draft.trimmingCharacters(in: .whitespacesAndNewlines),
                        summarize: false
                    )
                    if ok { dismiss() }
                }
            }
            .buttonStyle(PLPrimaryButtonStyle())
            .disabled(saving || draft.trimmingCharacters(in: .whitespaces).isEmpty)
            .frame(maxWidth: .infinity)
        }
        .padding(24)
        .plKeyboardDismiss()
    }

    // MARK: - Save

    private func save(student: CoachStudentRow, transcript: String, summarize: Bool) async -> Bool {
        guard let uid = app.userId, !transcript.isEmpty else { return false }
        saving = true
        errorLine = nil
        let entry = await workspace.createEntry(
            coachId: uid,
            studentId: student.id,
            transcript: transcript,
            summarize: summarize
        )
        saving = false
        if entry == nil {
            errorLine = "Couldn't save the entry. Try again."
            return false
        }
        return true
    }
}

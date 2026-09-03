import SwiftUI

/// The coaching side's first steps, the port of the web's
/// `src/app/coaching/CoachFirstSteps.tsx`.
///
/// The web shipped this on 2 Sep and iOS did not get it, so a coach-only
/// account opened the app into the coaching workspace and found one line
/// telling it to add a student. Same eight steps here, same order, same
/// done-conditions read off real product state, and the same dismissal
/// flag — `coach_first_steps_dismissed` in the account's metadata — so
/// hiding it on one surface hides it on the other.
///
/// Drawn with the player checklist's own row idiom rather than a second
/// look: filled circle and strikethrough when done, hollow circle and a
/// chevron when there is somewhere to go.
struct CoachFirstSteps: View {
    @Environment(AppState.self) private var app
    @Environment(CoachRouter.self) private var router
    @Environment(CoachWorkspaceStore.self) private var workspace
    @Environment(CoachStore.self) private var coach
    @Environment(LibraryStore.self) private var library

    /// Hidden for the rest of this launch the moment Hide is pressed, so
    /// the list goes without waiting for the metadata write to land.
    @State private var hiddenNow = false

    /// Where a step sends you. The coaching side's doors are sheets and
    /// tabs as often as pushes, so this carries all four.
    private enum Go {
        case route(String)
        case match(MatchRow)
        case student(CoachStudentRow)
        case addStudent
        case newEntry(CoachStudentRow?)
        case tab(CoachTab)
    }

    private struct Step {
        let label: String
        let done: Bool
        let go: Go?
    }

    // MARK: - State, read the same way the web reads it

    private var students: [CoachStudentRow] {
        // Oldest first: the web orders ascending and points every
        // per-student step at the FIRST student, which is the one the
        // coach added when they started.
        workspace.activeStudents.sorted { $0.createdAt < $1.createdAt }
    }

    private var firstStudent: CoachStudentRow? { students.first }

    /// A match owned by somebody other than the coach — RLS only delivers
    /// one when a student shared it, which is what the step is about.
    private var sharedMatch: MatchRow? {
        guard let uid = app.userId else { return nil }
        return library.matches.first { $0.userId != uid }
    }

    private var steps: [Step] {
        let studentDoor: Go = firstStudent.map { Go.student($0) } ?? .addStudent
        var all: [Step] = [
            Step(label: "Create your account", done: true, go: nil),
            Step(label: "Add your first student",
                 done: !students.isEmpty,
                 go: .addStudent),
            Step(label: "Send a student their invite link",
                 done: workspace.anyInvite || students.contains { $0.playerId != nil },
                 go: studentDoor),
            Step(label: "Write your first entry",
                 done: !workspace.entries.isEmpty,
                 go: .newEntry(firstStudent)),
            Step(label: "Share an entry with a student",
                 done: workspace.entries.contains { $0.sharedAt != nil },
                 go: studentDoor),
            Step(label: "Open a match a student shared",
                 done: sharedMatch != nil,
                 // Falls back to the guide until a student has shared
                 // something, exactly as the web falls back to
                 // /learn/for-coaches.
                 go: sharedMatch.map { Go.match($0) } ?? .route("guide:for-coaches")),
        ]
        // Paid reviews are web-only in the app by decision, and
        // `coachMarketplace` is the single boundary that says so. Listing
        // the step here would put a door in front of a room this build
        // does not have. Turn the flag on and it appears, and the two
        // checklists match again without another edit.
        if AppConfig.coachMarketplace {
            all.append(Step(label: "Offer paid reviews",
                            done: coach.profile != nil,
                            go: .route("coach-orders")))
        }
        all.append(Step(label: "Watch the tutorial videos",
                        done: app.metadataFlag("tutorial_started"),
                        go: .route("learn-videos")))
        return all
    }

    // MARK: - Body

    var body: some View {
        let all = steps
        let done = all.filter(\.done).count
        // Gone when every step is done, when it has been hidden, and until
        // the roster has actually loaded — an empty store would otherwise
        // draw a checklist of nothing-done for a coach who has done it all.
        //
        // Also gone once the roster is established at five students, the
        // web's own cut-off and the mirror of the player list retiring at
        // five matches: past that the account is plainly running, and a
        // list of beginnings is clutter on its front page.
        if workspace.loaded, students.count < 5, done < all.count, !hiddenNow,
           !app.metadataFlag("coach_first_steps_dismissed") {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    SectionHeading("First steps")
                    Spacer()
                    Text("\(done) of \(all.count)")
                        .font(.plCaption)
                        .monospacedDigit()
                        .foregroundStyle(PL.text500)
                    Button("Hide") {
                        hiddenNow = true
                        Task {
                            await app.setMetadataFlag(
                                "coach_first_steps_dismissed", true)
                        }
                    }
                    .font(.plCaption)
                    .foregroundStyle(PL.text400)
                    .buttonStyle(.plain)
                }
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(all.enumerated()), id: \.offset) { i, step in
                        row(step)
                        if i < all.count - 1 {
                            Rectangle().fill(PL.edge.opacity(0.4)).frame(height: 1)
                        }
                    }
                    NavigationLink(value: "guide:for-coaches") {
                        HStack(spacing: 4) {
                            Text("How coaching works, step by step, in")
                                .foregroundStyle(PL.text500)
                            Text("Learn")
                                .foregroundStyle(PL.cyan)
                            Image(systemName: "chevron.right")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(PL.cyan)
                        }
                        .font(.plCaption)
                        .padding(.top, 8)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                .plCard(padding: 16)
            }
        }
    }

    @ViewBuilder
    private func row(_ step: Step) -> some View {
        let content = HStack(spacing: 12) {
            Image(systemName: step.done ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 18))
                .foregroundStyle(step.done ? PL.cyan : PL.text600)
            Text(step.label)
                .font(.plBody)
                .foregroundStyle(step.done ? PL.text500 : PL.text200)
                .strikethrough(step.done, color: PL.text600)
            Spacer()
            if !step.done, step.go != nil {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PL.text600)
            }
        }
        .padding(.vertical, 9)
        .contentShape(Rectangle())

        if step.done {
            content
        } else {
            switch step.go {
            case .route(let route):
                NavigationLink(value: route) { content }.buttonStyle(.plain)
            case .match(let match):
                NavigationLink(value: match) { content }.buttonStyle(.plain)
            case .student(let student):
                NavigationLink(value: student) { content }.buttonStyle(.plain)
            case .addStudent:
                Button {
                    router.tab = .students
                    router.addStudentOpen = true
                } label: { content }
                    .buttonStyle(.plain)
            case .newEntry(let student):
                Button {
                    router.newEntryStudent = student
                    router.newEntryOpen = true
                } label: { content }
                    .buttonStyle(.plain)
            case .tab(let tab):
                Button { router.tab = tab } label: { content }
                    .buttonStyle(.plain)
            case nil:
                content
            }
        }
    }
}

import SwiftUI

/// The coach's first-steps checklist, the web's `CoachFirstSteps.tsx` on
/// this side of the table. Every row is read from what the account has
/// actually done, so there is no step flag to keep in sync and nothing to
/// tick off by hand: the product state IS the checklist.
///
/// Seven steps here against the web's eight. "Offer paid reviews" is the
/// marketplace, and the marketplace is off in the app
/// (`AppConfig.coachMarketplace`), so every screen behind it renders
/// nothing — the row would sit there taking taps and going nowhere, which
/// is worse than a row that is absent. It comes back with the flag.
///
/// The count still reads "n of 7" rather than borrowing the web's eight,
/// because a coach who finishes everything they can reach on a phone
/// should see a finished list.
struct CoachFirstSteps: View {
    /// A match one of this coach's students shared, if there is one. Home
    /// already works out which matches those are, and that rule is not
    /// worth writing down twice; the last step needs the first of them
    /// and nothing else.
    let sharedMatch: MatchRow?

    @Environment(AppState.self) private var app
    @Environment(CoachRouter.self) private var router
    @Environment(CoachWorkspaceStore.self) private var workspace

    /// Hidden for the rest of this launch, while the flag that hides it
    /// for good is written. Same shape as the player's checklist.
    @State private var hidden = false

    /// The web writes the same key, so hiding the list on either platform
    /// hides it on both.
    private static let dismissedKey = "coach_first_steps_dismissed"

    /// Where a step happens. Web makes every incomplete row a link; the
    /// iOS equivalents are a mix of pushes, a tab switch and a sheet, so
    /// the destination is modelled rather than being a URL.
    private enum Go {
        /// The Students tab with the Add sheet up, which is what
        /// `/coaching/students?add=1` opens on the web.
        case addStudent
        /// A student's own page. The invite, the composer and the entry
        /// cards are all on it, so it stands for the web's `studentHref`
        /// on all three of the per-student steps.
        case student(CoachStudentRow)
        case match(MatchRow)
        /// A String route `appRoutes()` resolves, for the guide a step
        /// falls back to while it has nothing of its own to point at.
        case route(String)
        case tutorial
    }

    private struct Step {
        let label: String
        let done: Bool
        let go: Go?
    }

    private var steps: [Step] {
        // The three per-student steps go to the oldest student, and to the
        // Add sheet while there is nobody yet — the same fallback the web
        // makes with `firstStudentId ? … : /coaching/students?add=1`.
        let onStudent: Go = workspace.firstStudent.map(Go.student) ?? .addStudent
        let entries = workspace.entries
        return [
            Step(label: "Create your account", done: true, go: nil),
            Step(
                label: "Add your first student",
                done: !workspace.activeStudents.isEmpty,
                go: .addStudent
            ),
            Step(
                label: "Send a student their invite link",
                done: workspace.inviteCount > 0
                    || workspace.activeStudents.contains(where: \.linked),
                go: onStudent
            ),
            Step(label: "Write your first entry", done: !entries.isEmpty, go: onStudent),
            Step(
                label: "Share an entry with a student",
                done: entries.contains { $0.sharedAt != nil },
                go: onStudent
            ),
            Step(
                label: "Open a match a student shared",
                done: sharedMatch != nil,
                go: sharedMatch.map(Go.match) ?? .route("guide:review-student-match")
            ),
            Step(
                label: "Watch the tutorial videos",
                done: LearnAudience.coach.started(in: [
                    LearnAudience.coach.progressKey:
                        app.metadataFlag(LearnAudience.coach.progressKey),
                ]),
                go: .tutorial
            ),
        ]
    }

    var body: some View {
        let all = steps
        let done = all.filter(\.done).count
        // Gone once the roster is established, every step is done, or it
        // was hidden. Waiting for `loaded` keeps a full checklist from
        // flashing over a roster that is still arriving.
        if workspace.loaded, workspace.activeStudents.count < 5, done < all.count,
           !hidden, !app.metadataFlag(Self.dismissedKey) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    SectionHeading("First steps")
                    Spacer()
                    Text("\(done) of \(all.count)")
                        .font(.plCaption)
                        .monospacedDigit()
                        .foregroundStyle(PL.text500)
                    Button("Hide") {
                        hidden = true
                        Task { await app.setMetadataFlag(Self.dismissedKey, true) }
                    }
                    .font(.plCaption)
                    .foregroundStyle(PL.text400)
                    .buttonStyle(.plain)
                }
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(all.enumerated()), id: \.offset) { i, step in
                        stepRow(step)
                        if i < all.count - 1 {
                            Rectangle().fill(PL.edge.opacity(0.4)).frame(height: 1)
                        }
                    }
                    // Web hangs this sentence on the one guide that walks
                    // through a student's match. The app has a Learn
                    // screen, and the word in the sentence is "Learn", so
                    // on a phone it goes to the screen it names.
                    NavigationLink(value: "learn") {
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

    /// One row. Incomplete rows are tappable and carry a chevron;
    /// completed ones are inert text, the way web draws them.
    @ViewBuilder
    private func stepRow(_ step: Step) -> some View {
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
            case .addStudent:
                // The sheet belongs to the Students tab, so the tab has to
                // come forward with it — the same pair of lines the first
                // student card next door uses.
                Button {
                    router.tab = .students
                    router.addStudentOpen = true
                } label: { content }
                .buttonStyle(.plain)
            case .student(let student):
                NavigationLink(value: student) { content }.buttonStyle(.plain)
            case .match(let match):
                NavigationLink(value: match) { content }.buttonStyle(.plain)
            case .route(let route):
                NavigationLink(value: route) { content }.buttonStyle(.plain)
            case .tutorial:
                NavigationLink(value: LearnVideosRoute(.coach)) { content }
                    .buttonStyle(.plain)
            case nil:
                content
            }
        }
    }
}

import SwiftUI
import Supabase

/// First-login setup, mirroring the web's two steps and its gate: a missing
/// display name OR a missing player_profiles row routes here.
struct OnboardingScreen: View {
    let needsName: Bool
    /// Anyone holding a coach_links row. Coaches are here to review someone
    /// else's matches, so they answer the name and nothing more; the
    /// all-null profile row is written on their behalf so the gate never
    /// asks again. Same two branches as the web flow.
    let isCoach: Bool
    /// No player_profiles row yet: the account has never finished setup,
    /// whichever sign-in brought it here. The role question keys on this,
    /// not on the name — Google and Apple arrive with a name.
    let isNew: Bool
    let onDone: () -> Void

    @Environment(AppState.self) private var app
    @State private var step: Int
    /// The Upwork question, asked once of brand-new accounts: which side
    /// of the table are you on. Invite-born coaches never see it — the
    /// invite already answered. "player" runs the existing flow;
    /// "coach" answers the name and lands in the coaching workspace.
    @State private var role: String?
    @State private var name = ""
    @State private var handedness: String?
    @State private var grip: String?
    @State private var level: String?
    @State private var saving = false
    @State private var errorMessage: String?
    @State private var autoFinished = false

    init(needsName: Bool, isCoach: Bool = false, isNew: Bool = true, onDone: @escaping () -> Void) {
        self.needsName = needsName
        self.isCoach = isCoach
        self.isNew = isNew
        self.onDone = onDone
        _step = State(initialValue: needsName ? 0 : 1)
    }

    /// Web caps the field at 120 characters and rejects anything over 80 on
    /// submit; without the same rule iOS could write a name the web would
    /// have refused.
    private static let maxNameLength = 80

    private func nameError(_ value: String) -> String? {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(
                of: "\\s+", with: " ", options: .regularExpression
            )
        if normalized.isEmpty { return "Enter your name to continue." }
        if normalized.count > Self.maxNameLength {
            return "Keep your name to 80 characters or fewer."
        }
        return nil
    }

    private let levels: [(String, String, String)] = [
        ("beginner", "Beginner", "Learning the basic strokes."),
        ("intermediate", "Intermediate", "You rally with spin and control."),
        ("advanced", "Advanced", "Strong technique, and you train regularly."),
        ("club", "Club", "You play club matches or a local league."),
        ("regional", "Regional", "You compete at regional or state level."),
        ("national", "National", "You compete at national level."),
        ("international", "International", "You represent your country, or play professionally."),
    ]

    var body: some View {
        ZStack {
            ArenaBackground()
            ScrollView {
                VStack(spacing: 24) {
                    LogoWordmark()
                        .padding(.top, 40)

                    if isCoach && !needsName {
                        // Nothing to ask. Write the row and get out of the
                        // way; the gate is what this screen exists for.
                        VStack(spacing: 12) {
                            if let errorMessage {
                                Text(errorMessage)
                                    .font(.plCaption)
                                    .foregroundStyle(PL.dangerText)
                                // Without this the screen is a dead end:
                                // the only content is "Setting up…" and
                                // there is nothing left to tap.
                                Button("Try again") {
                                    Task { await saveProfile() }
                                }
                                .buttonStyle(PLPrimaryButtonStyle())
                                .disabled(saving)
                            } else {
                                Text("Setting up…")
                                    .font(.plBody)
                                    .foregroundStyle(PL.text400)
                            }
                        }
                        .padding(.vertical, 24)
                    } else if isNew && !isCoach && role == nil {
                        roleStep
                    } else if step == 0 {
                        nameStep
                    } else {
                        profileStep
                    }
                }
                .padding(24)
                .frame(maxWidth: 420)
            }
        }
        // A ScrollView turns its top safe-area inset into a content inset,
        // so content starts below the status bar but scrolls UNDER it — and
        // with no navigation bar here there was nothing to hide it. Reaching
        // Done past seven level cards drove "How do you play?" straight
        // through the clock. The scrim is the same trick a nav bar's
        // background performs, minus the bar.
        .overlay(alignment: .top) {
            LinearGradient(
                colors: [PL.ink, PL.ink.opacity(0.9), PL.ink.opacity(0)],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 96)
            .ignoresSafeArea(edges: .top)
            .allowsHitTesting(false)
        }
        .plKeyboardDismiss()
        .task {
            guard isCoach, !needsName, !autoFinished else { return }
            autoFinished = true
            await saveProfile()
        }
    }

    private var roleStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("How will you use PongLens?")
                .font(.plCardTitle)
                .foregroundStyle(PL.text100)
            Text("You can add the other side later from Account.")
                .font(.plBody)
                .foregroundStyle(PL.text400)
            VStack(spacing: 10) {
                roleCard(
                    value: "player",
                    title: "I play",
                    blurb: "Film your matches and review your game."
                )
                roleCard(
                    value: "coach",
                    title: "I coach",
                    blurb: "Keep lesson notes and follow your students' matches."
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 24)
    }

    private func roleCard(value: String, title: String, blurb: String) -> some View {
        Button {
            role = value
            // With a name already on the account (Google, Apple) there is
            // nothing left to ask a coach: mark, switch, write the row.
            if value == "coach", !needsName {
                app.setWorkspace(.coach)
                Task { await saveProfile() }
            }
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.plRowTitle)
                    .foregroundStyle(PL.text100)
                Text(blurb)
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(PL.ink.opacity(0.4),
                        in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private var nameStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text("What should we call you?")
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                Text("We'll use this across PongLens.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
            }
            TextField("Alex", text: $name)
                .plField()
                .textContentType(.givenName)
                // "Enter your name to continue." sitting under a field that
                // now has a name in it contradicts what the user can see.
                .onChange(of: name) { _, _ in
                    if errorMessage != nil { errorMessage = nil }
                }
            if let errorMessage {
                Text(errorMessage)
                    .font(.plCaption)
                    .foregroundStyle(PL.dangerText)
            }
            // Enabled whatever the field holds, and it says why when the
            // answer is no. Disabling it left the very first button of the
            // product inert with no explanation.
            Button(saving ? "Saving…" : "Continue") {
                Task { await saveName() }
            }
            .buttonStyle(PLPrimaryButtonStyle())
            .disabled(saving)
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 24)
    }

    private var profileStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("How do you play?")
                .font(.plCardTitle)
                .foregroundStyle(PL.text100)

            VStack(alignment: .leading, spacing: 8) {
                SectionHeading("Handedness")
                HStack(spacing: 8) {
                    chip("Right-handed", value: "right", selection: $handedness)
                    chip("Left-handed", value: "left", selection: $handedness)
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                SectionHeading("Grip")
                HStack(spacing: 8) {
                    chip("Shakehand", value: "shakehand", selection: $grip)
                    chip("Penhold", value: "penhold", selection: $grip)
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                SectionHeading("Your level")
                Text("Pick the highest one that's true.")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                VStack(spacing: 8) {
                    ForEach(levels, id: \.0) { value, label, blurb in
                        let active = level == value
                        Button {
                            level = active ? nil : value
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(label)
                                    .font(.plRowTitle)
                                    .foregroundStyle(active ? PL.cyan : PL.text100)
                                Text(blurb)
                                    .font(.plCaption)
                                    .foregroundStyle(PL.text500)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(
                                active ? PL.cyan.opacity(0.08) : PL.ink.opacity(0.4),
                                in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                                    .strokeBorder(active ? PL.cyan.opacity(0.6) : PL.edge, lineWidth: 1)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.plCaption)
                    .foregroundStyle(PL.dangerText)
            }

            Button(saving
                ? "Saving…"
                : (handedness != nil || grip != nil || level != nil ? "Done" : "Skip for now")) {
                Task { await saveProfile() }
            }
            .buttonStyle(PLPrimaryButtonStyle())
            .disabled(saving)
            .frame(maxWidth: .infinity)

            Text("You can change any of this later in Account.")
                .font(.plCaption)
                .foregroundStyle(PL.text500)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 24)
    }

    private func chip(_ label: String, value: String, selection: Binding<String?>) -> some View {
        let active = selection.wrappedValue == value
        return Button(label) {
            selection.wrappedValue = active ? nil : value
        }
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(active ? PL.cyan : PL.text400)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(active ? PL.cyan.opacity(0.15) : .clear, in: Capsule())
        .overlay(Capsule().strokeBorder(active ? PL.cyan.opacity(0.5) : PL.edge, lineWidth: 1))
        .buttonStyle(.plain)
    }

    private func saveName() async {
        if let problem = nameError(name) {
            errorMessage = problem
            return
        }
        let normalized = name.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(
                of: "\\s+", with: " ", options: .regularExpression
            )
        saving = true
        errorMessage = nil
        do {
            try await supa.auth.update(user: UserAttributes(
                data: ["full_name": .string(normalized)]
            ))
            saving = false
            if isCoach || role == "coach" {
                // Straight past the player questions, exactly as the web
                // flow does once the name is in. A chosen coach lands in
                // the coaching workspace with the choice remembered.
                if role == "coach" {
                    app.setWorkspace(.coach)
                }
                await saveProfile()
                return
            }
            step = 1
        } catch {
            errorMessage = "We couldn't save your name. Try again."
            saving = false
        }
    }

    private func saveProfile() async {
        guard let uid = app.userId else { return }
        saving = true
        errorMessage = nil
        struct Upsert: Encodable {
            let user_id: String
            let handedness: String?
            let grip: String?
            let level: String?
        }
        do {
            try await supa
                .from("player_profiles")
                .upsert(Upsert(
                    user_id: uid.uuidString.lowercased(),
                    handedness: handedness, grip: grip, level: level
                ))
                .execute()
            onDone()
        } catch {
            errorMessage = "We couldn't save that. Try again."
        }
        saving = false
    }
}

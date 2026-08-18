import SwiftUI
import Supabase

/// First-login setup, mirroring the web's two steps and its gate: a missing
/// display name OR a missing player_profiles row routes here.
struct OnboardingScreen: View {
    let needsName: Bool
    let onDone: () -> Void

    @Environment(AppState.self) private var app
    @State private var step: Int
    @State private var name = ""
    @State private var handedness: String?
    @State private var grip: String?
    @State private var level: String?
    @State private var saving = false
    @State private var errorMessage: String?

    init(needsName: Bool, onDone: @escaping () -> Void) {
        self.needsName = needsName
        self.onDone = onDone
        _step = State(initialValue: needsName ? 0 : 1)
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

                    if step == 0 {
                        nameStep
                    } else {
                        profileStep
                    }
                }
                .padding(24)
                .frame(maxWidth: 420)
            }
        }
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
            if let errorMessage {
                Text(errorMessage)
                    .font(.plCaption)
                    .foregroundStyle(PL.dangerText)
            }
            Button(saving ? "Saving…" : "Continue") {
                Task { await saveName() }
            }
            .buttonStyle(PLPrimaryButtonStyle())
            .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
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
        saving = true
        errorMessage = nil
        do {
            try await supa.auth.update(user: UserAttributes(
                data: ["full_name": .string(name.trimmingCharacters(in: .whitespaces))]
            ))
            step = 1
        } catch {
            errorMessage = "We couldn't save your name. Try again."
        }
        saving = false
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

import SwiftUI
import Supabase

/// First-login setup, mirroring the web's steps and its gate: a missing
/// display name OR a missing player_profiles row routes here.
///
/// Four steps at most — which side of the table you are on, your name, how
/// you heard about us, how you play — and the ones that do not apply are
/// skipped. A coach answers all but the last and lands on the coaching side;
/// "both" answers everything and starts on the playing side with coaching
/// one switch away.
struct OnboardingScreen: View {
    let needsName: Bool
    /// Anyone holding a coach_links row. Coaches are here to review someone
    /// else's matches, so they answer the name and nothing more; the
    /// all-null profile row is written on their behalf so the gate never
    /// asks again. Same branch as the web flow.
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
    /// invite already answered. `role` is the highlighted card; it only
    /// counts once Continue is tapped.
    @State private var role: String?
    @State private var roleChosen = false
    @State private var cardsShown = false
    @State private var name = ""
    @State private var handedness: String?
    @State private var grip: String?
    @State private var level: String?
    @State private var source: String?
    @State private var sourceDetail = ""
    /// The name field only exists while an answer that asks for one is
    /// picked, so it takes the keyboard the moment it appears — the same
    /// thing the web's autoFocus does.
    @FocusState private var detailFocused: Bool
    @State private var saving = false
    @State private var errorMessage: String?
    @State private var autoFinished = false

    /// 0 name, 1 how you heard about us, 2 how you play. The role card is
    /// its own gate ahead of all three.
    private enum Step {
        static let name = 0
        static let source = 1
        static let play = 2
    }

    init(needsName: Bool, isCoach: Bool = false, isNew: Bool = true, onDone: @escaping () -> Void) {
        self.needsName = needsName
        self.isCoach = isCoach
        self.isNew = isNew
        self.onDone = onDone
        // A brand-new account that arrived with a name answers the source
        // question first; an invite-born coach is never asked and goes
        // straight to the playing questions it will also skip.
        _step = State(initialValue: needsName
            ? Step.name
            : (isNew && !isCoach ? Step.source : Step.play))
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

    private var askingRole: Bool { isNew && !isCoach && !roleChosen }
    private var coachOnly: Bool { isCoach || role == "coach" }
    private var alsoCoach: Bool { role == "both" }
    /// Where a signup came from, asked of accounts that arrived on their
    /// own. An invite-born coach is not asked: a player sent them, and we
    /// know it. Same condition the role card keys on, and the same people:
    /// the two questions bracket the flow.
    private var asksSource: Bool { isNew && !isCoach }

    /// The dots: which steps this account will walk, and where it is.
    /// Counted from what the account arrived with, never from the card
    /// under the finger — a coach simply never reaches the last dot, and
    /// the row does not resize while choosing.
    private var stepCount: Int {
        var n = 0
        if asksSource { n += 1 }
        if needsName { n += 1 }
        if asksSource { n += 1 }
        if !isCoach { n += 1 }
        return n
    }
    private var stepIndex: Int {
        if askingRole { return 0 }
        var i = asksSource ? 1 : 0
        if step == Step.name { return i }
        if needsName { i += 1 }
        if step == Step.source { return i }
        if asksSource { i += 1 }
        return i
    }

    var body: some View {
        ZStack {
            ArenaBackground()
            ScrollView {
                VStack(spacing: 28) {
                    LogoWordmark()
                        .padding(.top, 40)

                    if stepCount > 1 {
                        HStack(spacing: 6) {
                            ForEach(0..<stepCount, id: \.self) { i in
                                Capsule()
                                    .fill(i <= stepIndex ? PL.cyan : PL.edge)
                                    .frame(width: i == stepIndex ? 22 : 8, height: 4)
                                    .animation(.easeOut(duration: 0.25), value: stepIndex)
                            }
                        }
                        .accessibilityHidden(true)
                    }

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
                                    Task { await saveProfile(setupDone: false) }
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
                    } else if askingRole {
                        roleStep
                    } else if step == Step.name {
                        nameStep
                    } else if step == Step.source {
                        sourceStep
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
            await saveProfile(setupDone: false)
        }
        .onAppear {
            withAnimation(.easeOut(duration: 0.5).delay(0.1)) { cardsShown = true }
        }
    }

    // MARK: - Which side

    private var roleStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("How will you use PongLens?")
                .font(.plPageTitle)
                .tracking(-0.6)
                .foregroundStyle(PL.textBody)
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 12) {
                roleCard(
                    value: "player",
                    icon: "figure.table.tennis",
                    title: "I play",
                    blurb: "Film your matches, score them, and see where your game is going."
                )
                roleCard(
                    value: "coach",
                    icon: "text.book.closed.fill",
                    title: "I coach",
                    blurb: "Keep lesson notes on each student and follow the matches they share."
                )
                roleCard(
                    value: "both",
                    icon: "person.2.fill",
                    title: "Both",
                    blurb: "Your own game and your students, one switch apart."
                )
            }
            .opacity(cardsShown ? 1 : 0)
            .offset(y: cardsShown ? 0 : 14)

            if let errorMessage {
                Text(errorMessage)
                    .font(.plCaption)
                    .foregroundStyle(PL.dangerText)
            }

            // The label carries the width, not the button: a frame outside
            // the style leaves a narrow pill centred in a wide row, which is
            // what shipped in 103 and read as broken under three full-width
            // cards. Web's Continue is w-full on every step.
            Button {
                Task { await continueFromRole() }
            } label: {
                Text(saving ? "Saving…" : "Continue")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PLPrimaryButtonStyle())
            .disabled(role == nil || saving)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func roleCard(value: String, icon: String, title: String, blurb: String) -> some View {
        let active = role == value
        return Button {
            withAnimation(.easeOut(duration: 0.18)) { role = value }
        } label: {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(active ? PL.ink : PL.cyan)
                    .frame(width: 46, height: 46)
                    .background(active ? PL.cyan : PL.cyan.opacity(0.1), in: Circle())
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.plCardTitle)
                        .foregroundStyle(PL.text100)
                    Text(blurb)
                        .font(.plCaption)
                        .foregroundStyle(PL.text400)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Image(systemName: active ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(active ? PL.cyan : PL.text600)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                active ? PL.cyan.opacity(0.08) : PL.surface,
                in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                    .strokeBorder(active ? PL.cyan.opacity(0.7) : PL.edge, lineWidth: 1)
            )
            .shadow(color: active ? PL.cyan.opacity(0.18) : .clear, radius: 18)
            .contentShape(RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    /// Continue from the role card. A coach with a name already on the
    /// account (Google, Apple) has nothing left to answer; everyone else
    /// goes to the name or the playing questions.
    private func continueFromRole() async {
        guard role != nil else { return }
        roleChosen = true
        if role == "coach", !needsName {
            // Nothing left to answer about their game, but a coach who came
            // looking is a signup like any other, so the source question is
            // still asked and its Continue is what finishes.
            app.setWorkspace(.coach)
            step = Step.source
            return
        }
        step = needsName ? Step.name : Step.source
    }

    // MARK: - Name

    private var nameStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text("What should we call you?")
                    .font(.plPageTitle)
                    .tracking(-0.6)
                    .foregroundStyle(PL.textBody)
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
            Button {
                Task { await saveName() }
            } label: {
                Text(saving ? "Saving…" : "Continue")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PLPrimaryButtonStyle())
            .disabled(saving)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 24)
    }

    // MARK: - How you heard about us

    private var sourceStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("How did you hear about us?")
                .font(.plPageTitle)
                .tracking(-0.6)
                .foregroundStyle(PL.textBody)
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 8) {
                ForEach(SignupSource.options, id: \.value) { option in
                    let active = source == option.value
                    Button {
                        withAnimation(.easeOut(duration: 0.15)) {
                            source = active ? nil : option.value
                            // Whatever was typed belonged to the answer that
                            // was showing. A coach's name under "Which club?"
                            // is worse than an empty field.
                            sourceDetail = ""
                        }
                    } label: {
                        HStack(spacing: 12) {
                            Text(option.label)
                                .font(.plRowTitle)
                                .foregroundStyle(active ? PL.cyan : PL.text100)
                                .multilineTextAlignment(.leading)
                            Spacer(minLength: 8)
                            if active {
                                Image(systemName: "checkmark.circle.fill")
                                    .font(.system(size: 18, weight: .medium))
                                    .foregroundStyle(PL.cyan)
                            }
                        }
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
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

            // The half that is worth the most. A coach's name is the thing
            // that turns "coaches are working" into "this coach is".
            if let picked = SignupSource.option(source), let label = picked.detailLabel {
                VStack(alignment: .leading, spacing: 8) {
                    SectionHeading(label)
                    // No textContentType: the same field asks for a coach's
                    // name, a club and a free answer, and iOS would offer
                    // the phone owner's own name for all three.
                    TextField(picked.detailPlaceholder ?? "", text: $sourceDetail)
                        .plField()
                        .focused($detailFocused)
                        .onAppear { detailFocused = true }
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.plCaption)
                    .foregroundStyle(PL.dangerText)
            }

            // Same one-button shape as the playing questions: nothing here
            // is required, and the button says which it is about to do.
            Button {
                Task { await continueFromSource() }
            } label: {
                Text(saving ? "Saving…" : (source != nil ? "Continue" : "Skip for now"))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PLPrimaryButtonStyle())
            .disabled(saving)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 24)
    }

    /// A coach has nothing left to answer, so their Continue finishes the
    /// flow; everyone else goes on to the playing questions and finishes
    /// there, which keeps this to one write either way.
    private func continueFromSource() async {
        if coachOnly {
            await saveProfile(setupDone: false)
        } else {
            step = Step.play
        }
    }

    // MARK: - How you play

    private var profileStep: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("How do you play?")
                .font(.plPageTitle)
                .tracking(-0.6)
                .foregroundStyle(PL.textBody)

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
                            withAnimation(.easeOut(duration: 0.15)) {
                                level = active ? nil : value
                            }
                        } label: {
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(label)
                                        .font(.plRowTitle)
                                        .foregroundStyle(active ? PL.cyan : PL.text100)
                                    Text(blurb)
                                        .font(.plCaption)
                                        .foregroundStyle(PL.text500)
                                }
                                Spacer(minLength: 8)
                                if active {
                                    Image(systemName: "checkmark.circle.fill")
                                        .font(.system(size: 18, weight: .medium))
                                        .foregroundStyle(PL.cyan)
                                }
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

            Button {
                Task { await saveProfile(setupDone: true) }
            } label: {
                Text(saving
                    ? "Saving…"
                    : (handedness != nil || grip != nil || level != nil ? "Done" : "Skip for now"))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PLPrimaryButtonStyle())
            .disabled(saving)

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
            withAnimation(.easeOut(duration: 0.15)) {
                selection.wrappedValue = active ? nil : value
            }
        }
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(active ? PL.cyan : PL.text400)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(active ? PL.cyan.opacity(0.15) : .clear, in: Capsule())
        .overlay(Capsule().strokeBorder(active ? PL.cyan.opacity(0.5) : PL.edge, lineWidth: 1))
        .buttonStyle(.plain)
    }

    // MARK: - Saving

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
            if coachOnly {
                // Straight past the player questions, exactly as the web
                // flow does once the name is in. A chosen coach lands in
                // the coaching workspace with the choice remembered.
                if role == "coach" {
                    app.setWorkspace(.coach)
                }
                // A coach who arrived through a player's invite is never
                // asked where they came from, so they finish here.
                if asksSource {
                    step = Step.source
                    return
                }
                await saveProfile(setupDone: false)
                return
            }
            step = asksSource ? Step.source : Step.play
        } catch {
            errorMessage = "We couldn't save your name. Try again."
            saving = false
        }
    }

    /// Writes the profile row. `setupDone` stamps the questions as answered
    /// or explicitly skipped; the coach paths leave it empty so Home can
    /// offer the playing questions the day they switch sides.
    private func saveProfile(setupDone: Bool) async {
        guard let uid = app.userId else { return }
        saving = true
        errorMessage = nil
        struct Upsert: Encodable {
            let user_id: String
            let handedness: String?
            let grip: String?
            let level: String?
            let setup_done_at: String?
        }
        do {
            try await supa
                .from("player_profiles")
                .upsert(Upsert(
                    user_id: uid.uuidString.lowercased(),
                    handedness: handedness, grip: grip, level: level,
                    setup_done_at: setupDone ? ISO8601DateFormatter().string(from: Date()) : nil
                ))
                .execute()
            // How they found us, if they said. Deliberately after the
            // profile and deliberately unchecked: this row is for us, and
            // failing to write it is not a reason to hold somebody on the
            // last screen of setup. Skipping the question writes nothing,
            // so an account created after this shipped with no row here is
            // one that skipped.
            if let source {
                struct SourceUpsert: Encodable {
                    let user_id: String
                    let source: String
                    let detail: String?
                }
                _ = try? await supa
                    .from("signup_sources")
                    .upsert(SourceUpsert(
                        user_id: uid.uuidString.lowercased(),
                        source: source,
                        detail: SignupSource.asksForDetail(source)
                            ? SignupSource.normalizeDetail(sourceDetail) : nil
                    ))
                    .execute()
            }
            if alsoCoach {
                // Both sides: the playing side first, coaching one switch
                // away, and the flag so the switch offers itself.
                await app.setMetadataFlag("is_coach", true)
            }
            app.playerSetupPending = !setupDone
            onDone()
        } catch {
            errorMessage = "We couldn't save that. Try again."
        }
        saving = false
    }
}

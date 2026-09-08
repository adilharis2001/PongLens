import SwiftUI
import Supabase

/// Accepting an invite inside the app, the native twin of the website's
/// /join and /coach-invite pages. Same database functions, same side
/// cases, same sentences; and one thing the web pages only gained on
/// 2026-09-07: it says which account is about to accept, with a way out
/// if it is the wrong one. Signing out there is this device only, and the
/// invite stays pending in RootView, so the next account to sign in lands
/// straight back here.
struct InviteAcceptSheet: View {
    let link: InviteLink
    /// Sign this device out and keep the invite waiting for the next
    /// account. RootView owns the pending link, so it is not cleared.
    let onSwitchAccount: () -> Void
    /// The invite was accepted. RootView drops the pending link, which
    /// closes the sheet.
    let onFinished: () -> Void

    @Environment(AppState.self) private var app
    @Environment(Router.self) private var router

    enum Phase: Equatable {
        case loading
        case student(coachName: String)
        case coach(playerName: String, scope: String)
        /// A side case with nothing to accept: your own link, a revoked
        /// one, an invite already taken.
        case notice(title: String, detail: String)
        case notFound
    }

    @State private var phase: Phase = .loading
    @State private var allMatches = true
    @State private var name = ""
    @State private var busy = false
    @State private var error: String?

    /// A brand-new account arrives here before the name step of
    /// onboarding, and the coach's roster copies the name at the moment
    /// of joining, the same rule as the web page.
    private var needsName: Bool { app.displayName.isEmpty }
    private var cleanName: String {
        name.split(separator: " ").joined(separator: " ")
    }

    var body: some View {
        PLSheetScaffold(title: "Invite", doneLabel: "Close") {
            Form {
                switch phase {
                case .loading:
                    Section {
                        HStack {
                            Spacer()
                            ProgressView().tint(PL.cyan)
                            Spacer()
                        }
                        .padding(.vertical, 24)
                        .listRowBackground(Color.clear)
                    }
                case .notFound:
                    noticeSection(
                        "Invite not found",
                        "This invite link isn't valid. Ask for a fresh link."
                    )
                case .notice(let title, let detail):
                    noticeSection(title, detail)
                case .student(let coachName):
                    studentSections(coachName)
                case .coach(let playerName, let scope):
                    coachSections(playerName, scope: scope)
                }
            }
        }
        .task(id: link) { await load() }
    }

    // MARK: - Sections

    private func noticeSection(_ title: String, _ detail: String) -> some View {
        Section {
            heading(title, detail)
        }
    }

    private func heading(_ title: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(PL.text100)
            Text(detail)
                .font(.plBody)
                .foregroundStyle(PL.text400)
        }
        .padding(.vertical, 4)
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 8, leading: 4, bottom: 8, trailing: 4))
    }

    /// The account about to accept, and the way out. The name when the
    /// account has one, else the email on its own.
    private func identitySection(_ header: String) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 2) {
                Text(app.displayName.isEmpty ? (app.userEmail ?? "") : app.displayName)
                    .foregroundStyle(PL.text100)
                if !app.displayName.isEmpty, let email = app.userEmail {
                    Text(email)
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                }
            }
            Button("Not you? Sign out") { onSwitchAccount() }
                .foregroundStyle(PL.text300)
        } header: {
            Text(header)
        }
    }

    @ViewBuilder
    private func studentSections(_ coachName: String) -> some View {
        Section {
            heading(
                "\(coachName) invited you as a student",
                "Lesson notes they share land in your journal. You choose which matches they can see."
            )
        }
        identitySection("Joining as")
        if needsName {
            Section {
                TextField("How your coach knows you", text: $name)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
            } header: {
                Text("Your name")
            }
        }
        Section {
            choiceRow(
                "All my matches",
                detail: "Every match, including future uploads.",
                selected: allMatches
            ) { allMatches = true }
            choiceRow(
                "Only matches I share",
                detail: "You share each match from its page. Change this any time.",
                selected: !allMatches
            ) { allMatches = false }
        } header: {
            Text("What \(coachName) can see")
        }
        Section {
            Button {
                Task { await join(coachName) }
            } label: {
                HStack {
                    Spacer()
                    Text(busy ? "Joining…" : "Join \(coachName)")
                        .fontWeight(.semibold)
                    Spacer()
                }
            }
            .disabled(busy || (needsName && cleanName.isEmpty))
        } footer: {
            if let error {
                Text(error).foregroundStyle(PL.dangerText)
            }
        }
    }

    @ViewBuilder
    private func coachSections(_ playerName: String, scope: String) -> some View {
        Section {
            heading(coachTitle(playerName, scope: scope), coachDetail(scope: scope))
        }
        identitySection("Accepting as")
        Section {
            Button {
                Task { await accept() }
            } label: {
                HStack {
                    Spacer()
                    Text(busy ? "Setting up your access…" : "Accept")
                        .fontWeight(.semibold)
                    Spacer()
                }
            }
            .disabled(busy)
        } footer: {
            if let error {
                Text(error).foregroundStyle(PL.dangerText)
            }
        }
    }

    /// The web page's sentences, by what the player shared.
    private func coachTitle(_ playerName: String, scope: String) -> String {
        switch scope {
        case "selected": "\(playerName) added you as their coach"
        case "all": "\(playerName) shared their matches with you"
        default: "\(playerName) shared a match with you"
        }
    }

    private func coachDetail(scope: String) -> String {
        switch scope {
        case "all":
            "You can watch all their matches, point by point, and leave coach notes."
        case "selected":
            "They will share matches with you one at a time. You can watch each one, point by point, and leave coach notes."
        default:
            "You can watch this match, point by point, and leave coach notes."
        }
    }

    /// A choice drawn as a row: the title, its one line, and a tick when
    /// it is the one. The invite sheet's idiom.
    private func choiceRow(
        _ title: String, detail: String, selected: Bool, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .foregroundStyle(selected ? PL.text100 : PL.text300)
                    Text(detail)
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                }
                Spacer()
                if selected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(PL.cyan)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Data

    private var tokenString: String { link.token.uuidString.lowercased() }

    private func load() async {
        phase = .loading
        switch link {
        case .student:
            struct Row: Decodable {
                let coach_name: String?
                let is_own_invite: Bool?
                let already_linked: Bool?
                let status: String?
            }
            struct Params: Encodable { let p_token: String }
            let rows: [Row]? = try? await supa
                .rpc("student_invite_info", params: Params(p_token: tokenString))
                .execute().value
            guard let info = rows?.first else {
                phase = .notFound
                return
            }
            let coach = info.coach_name?.trimmingCharacters(in: .whitespaces) ?? ""
            let coachName = coach.isEmpty ? "Your coach" : coach
            if info.is_own_invite == true {
                phase = .notice(
                    title: "This is your invite link",
                    detail: "Send it to your student. When they join, their matches connect to your students list."
                )
            } else if info.status == "revoked" {
                phase = .notice(
                    title: "Invite revoked",
                    detail: "Your coach revoked this link. Ask them for a new one."
                )
            } else if info.already_linked == true {
                phase = .notice(
                    title: "You're connected to \(coachName)",
                    detail: "They can see the matches you upload, and the notes they share land in your journal."
                )
            } else {
                phase = .student(coachName: coachName)
            }
        case .coach:
            struct Row: Decodable {
                let player_name: String?
                let is_own_invite: Bool?
                let accepted_by_me: Bool?
                let scope: String?
                let status: String?
            }
            struct Params: Encodable { let token: String }
            let rows: [Row]? = try? await supa
                .rpc("coach_invite_info", params: Params(token: tokenString))
                .execute().value
            guard let info = rows?.first else {
                phase = .notFound
                return
            }
            let player = info.player_name?.trimmingCharacters(in: .whitespaces) ?? ""
            let playerName = player.isEmpty ? "A player" : player
            if info.is_own_invite == true {
                phase = .notice(
                    title: "This is your invite link",
                    detail: "Send it to your coach. When they accept, they can watch your matches and leave notes."
                )
            } else if info.accepted_by_me == true {
                phase = .notice(
                    title: "Already accepted",
                    detail: "\(playerName) is on your students list. Open them to watch their matches and leave notes."
                )
            } else if info.status != "pending" {
                phase = info.status == "revoked"
                    ? .notice(
                        title: "Invite revoked",
                        detail: "The player revoked this invite. Ask them for a new link."
                    )
                    : .notice(
                        title: "Invite already used",
                        detail: "Someone already accepted this invite. Ask the player for a new link."
                    )
            } else {
                phase = .coach(playerName: playerName, scope: info.scope ?? "all")
            }
        }
    }

    /// Join the coach: the name first when the account has none, then the
    /// accept, then the journal, where the notes the coach has shared sit
    /// at the top (the web's /journal?from=coach).
    private func join(_ coachName: String) async {
        guard !busy else { return }
        busy = true
        error = nil
        defer { busy = false }
        if needsName {
            do {
                try await supa.auth.update(
                    user: UserAttributes(data: ["full_name": .string(cleanName)])
                )
            } catch {
                self.error = "Couldn't save your name. Try again."
                return
            }
        }
        struct Params: Encodable {
            let p_token: String
            let p_all_matches: Bool
        }
        do {
            _ = try await supa
                .rpc("accept_student_invite", params: Params(p_token: tokenString, p_all_matches: allMatches))
                .execute()
        } catch {
            self.error = "Couldn't join. The link may have been revoked. Ask for a new one."
            return
        }
        // A student stands on the playing side. The tab flips before the
        // sheet closes, so the journal is what is behind it.
        app.setWorkspace(.player)
        router.tab = .journal
        onFinished()
    }

    /// Accept the coach invite and stand on the coaching side, on the
    /// roster, where the new student now is. The web lands on the
    /// student's page or the shared match; here the roster is one tap
    /// from both and is the screen that proves the accept took.
    private func accept() async {
        guard !busy else { return }
        busy = true
        error = nil
        defer { busy = false }
        struct Params: Encodable { let token: String }
        do {
            _ = try await supa
                .rpc("accept_coach_invite", params: Params(token: tokenString))
                .execute()
        } catch {
            self.error = "Couldn't accept the invite. It may have been used or revoked."
            return
        }
        app.pendingCoachTab = .students
        app.setWorkspace(.coach)
        onFinished()
    }
}

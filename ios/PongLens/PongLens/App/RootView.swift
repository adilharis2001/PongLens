import SwiftUI
import Supabase

struct RootView: View {
    @State private var app = AppState()
    @State private var router = Router()
    @State private var library = LibraryStore()
    @State private var scores = ScoresStore()
    @State private var journal = JournalStore()
    @State private var notifications = NotificationsStore()
    @State private var coaching = CoachingStore()
    @State private var coach = CoachStore()
    @State private var coachWorkspace = CoachWorkspaceStore()

    enum OnboardingGate: Equatable {
        case checking
        case needed(needsName: Bool, isCoach: Bool, isNew: Bool)
        case done
    }

    @State private var gate: OnboardingGate = .checking
    @State private var splashDone = false
    @State private var lessonVideoLink: LessonVideoLink?
    /// An invite that opened the app (a Universal Link on /join or
    /// /coach-invite). Lives here, not on the router: the router is
    /// rebuilt on every account change, and a link that arrives signed
    /// out has to survive the sign-in and onboarding it causes. Presented
    /// once the account is in and onboarding is done; cleared when the
    /// sheet is closed or the invite accepted, never by a sign-out.
    @State private var pendingInvite: InviteLink?
    /// The sign-in screen's one extra line while an invite waits.
    @State private var pendingInviteLine: String?

    var body: some View {
        #if DEBUG
        // Same idea as --dev-token-hash below: a launch argument the
        // simulator pipeline can use to open the visual QA gallery
        // without signing in. Never compiled into Release.
        if ProcessInfo.processInfo.arguments.contains("--theme-gallery") {
            ThemeGallery()
        } else if ProcessInfo.processInfo.arguments.contains("--dev-recording-brief") {
            // The first-run brief, without an account: it only ever shows
            // to a fresh account mid-tap, which makes checking its copy a
            // whole sign-up. Same idea as --theme-gallery above.
            RecordingBriefSheet(context: .upload, onDone: {})
        } else if ProcessInfo.processInfo.arguments.contains("--dev-camera-guide") {
            // The "Where to place the camera" sheet, without an account,
            // for the same reason.
            CameraPlacementSheet()
        } else {
            appBody
        }
        #else
        appBody
        #endif
    }

    private var appBody: some View {
        Group {
            switch app.phase {
            case .loading:
                ZStack {
                    ArenaBackground()
                    ProgressView().tint(PL.cyan)
                }
            case .signedOut:
                LoginScreen(inviteLine: pendingInvite == nil ? nil : pendingInviteLine)
            case .signedIn:
                switch gate {
                case .checking:
                    ZStack {
                        ArenaBackground()
                        ProgressView().tint(PL.cyan)
                    }
                    .task { await checkOnboarding() }
                case .needed(let needsName, let isCoach, let isNew):
                    OnboardingScreen(needsName: needsName, isCoach: isCoach, isNew: isNew) { gate = .done }
                case .done:
                    // One account, two workspaces. The remembered choice
                    // decides which side of the app stands up; Account
                    // switches it, and the whole tree swaps.
                    #if DEBUG
                    if router.tutorialCapture == .coachAudioLesson {
                        LessonRecordScreen(
                            hideAuthorField: true,
                            saveAs: { _ in false },
                            onSaved: {}
                        )
                    } else if app.workspace == .coach {
                        CoachTabView()
                    } else {
                        MainTabView()
                    }
                    #else
                    if app.workspace == .coach {
                        CoachTabView()
                    } else {
                        MainTabView()
                    }
                    #endif
                }
            }
        }
        .environment(app)
        .environment(router)
        .environment(library)
        .environment(scores)
        .environment(journal)
        .environment(notifications)
        .environment(coaching)
        .environment(coach)
        .environment(coachWorkspace)
        .environment(\.openURL, OpenURLAction { url in
            guard app.userId != nil, let link = LessonVideoLink(url: url) else { return .systemAction }
            lessonVideoLink = link
            return .handled
        })
        .sheet(item: $lessonVideoLink) { link in
            NavigationStack {
                LessonVideoDetailScreen(id: link.id)
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button("Done") { lessonVideoLink = nil }
                        }
                    }
            }
        }
        // A Universal Link reaches the app both ways depending on how it
        // was opened; both land in the same place. Only the invite paths
        // are claimed in the site's association file, so anything else
        // here is not ours and is left alone.
        .onOpenURL { url in receive(url) }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            if let url = activity.webpageURL { receive(url) }
        }
        .sheet(item: presentedInvite) { link in
            InviteAcceptSheet(
                link: link,
                onSwitchAccount: {
                    // This device only, and the invite stays pending:
                    // the sign-in screen comes up with its line, and the
                    // next account lands straight back on the sheet.
                    Task { await app.signOut() }
                },
                onFinished: { pendingInvite = nil }
            )
            // A sheet presented from here does not see the environment
            // the modifiers above hand the tree; the first link opened
            // in the simulator crashed on exactly that. Handed over
            // explicitly.
            .environment(app)
            .environment(router)
        }
        .overlay {
            if !splashDone {
                SplashScreen()
                    .transition(.opacity)
            }
        }
        .task {
            // The player's rotate button asks the SCENE for landscape, and
            // the scene keeps it. Handing it back is the takeover's job on
            // dismiss — but a force-quit while it is up never gets there,
            // and the whole app comes back sideways with no way to right it
            // except opening a player and rotating twice. Cold start owns
            // the floor: portrait unless the phone is genuinely on its side.
            if !UIDevice.current.orientation.isLandscape {
                (UIApplication.shared.connectedScenes
                    .compactMap { $0 as? UIWindowScene }.first)?
                    .requestGeometryUpdate(.iOS(interfaceOrientations: .portrait))
            }
            #if DEBUG
            // The auth-state listener must exist before the simulator hook
            // verifies its one-time token. Starting it afterwards can miss
            // the signed-in event and leave a successfully authenticated
            // screenshot run on the login screen.
            if ProcessInfo.processInfo.arguments.contains("--dev-token-hash") {
                Task { await app.start() }
                try? await Task.sleep(nanoseconds: 100_000_000)
                await devSignInIfRequested()
                await app.refreshAdmin()
                return
            }
            #endif
            await app.start()
            await app.refreshAdmin()
        }
        .task {
            // Not user-scoped and not behind auth (107 allow-lists the
            // key for anon), so this does not wait on the session the way
            // refreshAdmin does.
            await app.refreshConfigFlags()
        }
        .task {
            // A breath of brand on cold start, then out of the way. Auth
            // resolves behind it, so most launches land straight on content.
            try? await Task.sleep(nanoseconds: 1_100_000_000)
            withAnimation(.easeOut(duration: 0.35)) { splashDone = true }
        }
        .onChange(of: app.userId) { previous, next in
            guard previous != next else { return }
            // pendingInvite deliberately survives this: it is the reason
            // the account just changed.
            lessonVideoLink = nil
            Task { await app.refreshAdmin(); await LessonVideoQueue.shared.resume() }
            // A different account (or none) owns the screen now. Stores
            // are process-lifetime objects, so without this the next
            // account inherits the last one's rendered data — that is
            // exactly how a coach account got shown the player's journal
            // on a shared phone. Hand the new identity fresh stores and
            // re-run the onboarding check.
            router = Router()
            library = LibraryStore()
            ThumbLoader.shared.clear()
            scores = ScoresStore()
            journal = JournalStore()
            notifications = NotificationsStore()
            coaching = CoachingStore()
            coach = CoachStore()
            coachWorkspace = CoachWorkspaceStore()
            gate = .checking
        }
    }

    /// The invite sheet shows only once there is an account to accept
    /// with and onboarding is out of the way. Closing it drops the
    /// invite; a sign-out collapses it without dropping anything, because
    /// the sheet is what the next sign-in is for.
    private var presentedInvite: Binding<InviteLink?> {
        Binding(
            get: { app.userId != nil && gate == .done ? pendingInvite : nil },
            set: { value in
                if value == nil, app.userId != nil { pendingInvite = nil }
            }
        )
    }

    private func receive(_ url: URL) {
        guard let link = InviteLink(url: url) else { return }
        pendingInvite = link
        pendingInviteLine = "Sign in to accept the invite."
        Task { pendingInviteLine = await inviteLine(for: link) }
    }

    /// The name on the invite, for the sign-in screen's line. The preview
    /// functions are the ones the website's link previews call, open to
    /// anyone holding the token, so this needs no session.
    private func inviteLine(for link: InviteLink) async -> String {
        struct Row: Decodable { let inviter_name: String? }
        struct Params: Encodable { let p_token: String }
        let function = switch link {
        case .student: "student_invite_preview"
        case .coach: "coach_invite_preview"
        }
        let rows: [Row]? = try? await supa
            .rpc(function, params: Params(p_token: link.token.uuidString.lowercased()))
            .execute().value
        let name = rows?.first?.inviter_name?.trimmingCharacters(in: .whitespaces) ?? ""
        return name.isEmpty
            ? "Sign in to accept the invite."
            : "Sign in to accept the invite from \(name)."
    }

    /// The web's middleware gate: onboarding when the display name is empty
    /// OR there is no player_profiles row.
    private func checkOnboarding() async {
        #if DEBUG
        if let tutorialCapture = router.tutorialCapture {
            // Capture must not persist a workspace preference or update the
            // signed-in account's metadata. The direct assignment lasts for
            // this process only.
            app.workspace = tutorialCapture == .coachAudioLesson ? .coach : .player
            gate = .done
            return
        }
        if ProcessInfo.processInfo.arguments.contains("--dev-coach-record") {
            app.setWorkspace(.coach)
            gate = .done
            return
        }
        #endif
        guard case .signedIn(let session) = app.phase else { return }
        app.loadWorkspace()
        let uid = session.user.id.uuidString.lowercased()
        let meta = session.user.userMetadata
        let name = (meta["full_name"]?.stringValue ?? meta["name"]?.stringValue ?? "")
            .trimmingCharacters(in: .whitespaces)
        // Filter by user_id explicitly. Migration 046 gives an accepted
        // coach SELECT on their students' profiles, so an unfiltered count
        // is answered by somebody else's row: a coach who also plays would
        // have skipped their own onboarding entirely once a student
        // accepted them.
        struct ProfileRow: Decodable { let setup_done_at: String? }
        async let profileQuery: [ProfileRow]? = try? await supa
            .from("player_profiles")
            .select("setup_done_at")
            .eq("user_id", value: uid)
            .execute().value
        // A coach answers the name and nothing else — same rule as the web
        // page, which reads coach_links before deciding what to show.
        async let coachQuery = try? await supa
            .from("coach_links")
            .select("id", head: true, count: .exact)
            .eq("coach_id", value: uid)
            .limit(1)
            .execute()
        let (profile, coachLink) = await (profileQuery, coachQuery)
        let hasProfile = !(profile ?? []).isEmpty
        let isCoach = (coachLink?.count ?? 0) > 0
        app.playerSetupPending = hasProfile && profile?.first?.setup_done_at == nil
        if name.isEmpty || !hasProfile {
            // isNew: no profile row yet, whatever the name says. Google and
            // Apple hand us a name, so "needs a name" is NOT "brand new" —
            // keying the role question on it skipped every such account.
            gate = .needed(needsName: name.isEmpty, isCoach: isCoach, isNew: !hasProfile)
        } else {
            gate = .done
        }
    }

    #if DEBUG
    /// Development-only: sign in with a token_hash minted locally by the
    /// Supabase admin API, passed as a launch argument. Same verifyOTP code
    /// path a production universal link uses. Never compiled into Release.
    private func devSignInIfRequested() async {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "--dev-token-hash"), args.indices.contains(i + 1) else { return }
        do {
            try await supa.auth.verifyOTP(tokenHash: args[i + 1], type: .email)
        } catch {
            print("dev sign-in failed: \(error)")
        }
    }
    #endif
}

/// A breath of brand on cold start: the lens ring over ink, gone within a
/// second and a half. It sits over whatever the launch resolves to, so the
/// session restore happens behind it instead of in front of a spinner.
private struct SplashScreen: View {
    @State private var shown = false

    var body: some View {
        ZStack {
            PL.ink.ignoresSafeArea()
            VStack(spacing: 20) {
                LogoMark(size: 72)
                HStack(spacing: 0) {
                    Text("Pong").foregroundStyle(.white)
                    Text("Lens").foregroundStyle(PL.cyan)
                }
                .font(.system(size: 26, weight: .semibold))
                .tracking(-0.5)
            }
            .opacity(shown ? 1 : 0)
            .scaleEffect(shown ? 1 : 0.94)
        }
        .onAppear {
            withAnimation(.easeOut(duration: 0.45)) { shown = true }
        }
    }
}

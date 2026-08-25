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

    enum OnboardingGate: Equatable {
        case checking
        case needed(needsName: Bool, isCoach: Bool)
        case done
    }

    @State private var gate: OnboardingGate = .checking
    @State private var splashDone = false

    var body: some View {
        #if DEBUG
        // Same idea as --dev-token-hash below: a launch argument the
        // simulator pipeline can use to open the visual QA gallery
        // without signing in. Never compiled into Release.
        if ProcessInfo.processInfo.arguments.contains("--theme-gallery") {
            ThemeGallery()
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
                LoginScreen()
            case .signedIn:
                switch gate {
                case .checking:
                    ZStack {
                        ArenaBackground()
                        ProgressView().tint(PL.cyan)
                    }
                    .task { await checkOnboarding() }
                case .needed(let needsName, let isCoach):
                    OnboardingScreen(needsName: needsName, isCoach: isCoach) { gate = .done }
                case .done:
                    MainTabView()
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
            await devSignInIfRequested()
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
            Task { await app.refreshAdmin() }
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
            gate = .checking
        }
    }

    /// The web's middleware gate: onboarding when the display name is empty
    /// OR there is no player_profiles row.
    private func checkOnboarding() async {
        guard case .signedIn(let session) = app.phase else { return }
        let uid = session.user.id.uuidString.lowercased()
        let meta = session.user.userMetadata
        let name = (meta["full_name"]?.stringValue ?? meta["name"]?.stringValue ?? "")
            .trimmingCharacters(in: .whitespaces)
        // Filter by user_id explicitly. Migration 046 gives an accepted
        // coach SELECT on their students' profiles, so an unfiltered count
        // is answered by somebody else's row: a coach who also plays would
        // have skipped their own onboarding entirely once a student
        // accepted them.
        async let profileQuery = try? await supa
            .from("player_profiles")
            .select("user_id", head: true, count: .exact)
            .eq("user_id", value: uid)
            .execute()
        // A coach answers the name and nothing else — same rule as the web
        // page, which reads coach_links before deciding what to show.
        async let coachQuery = try? await supa
            .from("coach_links")
            .select("id", head: true, count: .exact)
            .eq("coach_id", value: uid)
            .limit(1)
            .execute()
        let (profile, coachLink) = await (profileQuery, coachQuery)
        let hasProfile = (profile?.count ?? 0) > 0
        let isCoach = (coachLink?.count ?? 0) > 0
        if name.isEmpty || !hasProfile {
            gate = .needed(needsName: name.isEmpty, isCoach: isCoach)
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

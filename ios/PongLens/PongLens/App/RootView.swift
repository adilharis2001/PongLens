import SwiftUI
import Supabase

struct RootView: View {
    @State private var app = AppState()
    @State private var router = Router()
    @State private var library = LibraryStore()
    @State private var media = MediaStore()
    @State private var scores = ScoresStore()
    @State private var journal = JournalStore()
    @State private var notifications = NotificationsStore()
    @State private var coaching = CoachingStore()
    @State private var coach = CoachStore()

    enum OnboardingGate: Equatable {
        case checking
        case needed(needsName: Bool)
        case done
    }

    @State private var gate: OnboardingGate = .checking

    var body: some View {
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
                case .needed(let needsName):
                    OnboardingScreen(needsName: needsName) { gate = .done }
                case .done:
                    MainTabView()
                }
            }
        }
        .environment(app)
        .environment(router)
        .environment(library)
        .environment(media)
        .environment(scores)
        .environment(journal)
        .environment(notifications)
        .environment(coaching)
        .environment(coach)
        .task {
            #if DEBUG
            await devSignInIfRequested()
            #endif
            await app.start()
        }
    }

    /// The web's middleware gate: onboarding when the display name is empty
    /// OR there is no player_profiles row.
    private func checkOnboarding() async {
        guard case .signedIn(let session) = app.phase else { return }
        let meta = session.user.userMetadata
        let name = (meta["full_name"]?.stringValue ?? meta["name"]?.stringValue ?? "")
            .trimmingCharacters(in: .whitespaces)
        let profile = try? await supa
            .from("player_profiles")
            .select("user_id", head: true, count: .exact)
            .execute()
        let hasProfile = (profile?.count ?? 0) > 0
        if name.isEmpty || !hasProfile {
            gate = .needed(needsName: name.isEmpty)
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

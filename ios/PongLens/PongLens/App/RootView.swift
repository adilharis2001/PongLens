import SwiftUI
import Supabase

struct RootView: View {
    @State private var app = AppState()
    @State private var router = Router()

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
                MainTabView()
            }
        }
        .environment(app)
        .environment(router)
        .task {
            #if DEBUG
            await devSignInIfRequested()
            #endif
            await app.start()
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

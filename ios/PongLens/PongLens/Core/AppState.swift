import Foundation
import Supabase

/// Session and identity state for the whole app.
@Observable
final class AppState {
    enum AuthPhase {
        case loading
        case signedOut
        case signedIn(Session)
    }

    var phase: AuthPhase = .loading

    var userId: UUID? {
        if case .signedIn(let session) = phase { return session.user.id }
        return nil
    }

    var userEmail: String? {
        if case .signedIn(let session) = phase { return session.user.email }
        return nil
    }

    /// First name for the "Hey {name} 👋" greeting, mirroring the web's fallbacks.
    var firstName: String {
        guard case .signedIn(let session) = phase else { return "player" }
        let meta = session.user.userMetadata
        let full = (meta["full_name"]?.stringValue ?? meta["name"]?.stringValue)?
            .trimmingCharacters(in: .whitespaces)
        if let full, !full.isEmpty {
            return full.split(separator: " ").first.map(String.init) ?? full
        }
        if let email = session.user.email, let stem = email.split(separator: "@").first {
            return String(stem)
        }
        return "player"
    }

    func start() async {
        for await (event, session) in supa.auth.authStateChanges {
            switch event {
            case .initialSession, .signedIn, .tokenRefreshed, .userUpdated:
                if let session {
                    phase = .signedIn(session)
                } else {
                    phase = .signedOut
                }
            case .signedOut, .userDeleted:
                phase = .signedOut
            default:
                break
            }
        }
    }

    func signOut() async {
        try? await supa.auth.signOut()
        phase = .signedOut
    }
}

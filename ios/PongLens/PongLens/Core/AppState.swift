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

    /// Google and Apple accounts carry a picture; magic-link accounts get
    /// their initial instead.
    var avatarURL: URL? {
        guard case .signedIn(let session) = phase else { return nil }
        let meta = session.user.userMetadata
        return (meta["avatar_url"]?.stringValue ?? meta["picture"]?.stringValue)
            .flatMap(URL.init)
    }

    /// One letter for the avatar circle when there is no picture.
    var initial: String {
        let name = firstName
        return name == "player" ? "P" : String(name.prefix(1)).uppercased()
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

    /// Whether this account is the admin, answered by the database rather
    /// than by a constant in the app. `is_admin()` is SECURITY DEFINER and
    /// already the real boundary everywhere else; asking it keeps the admin
    /// address out of a binary that ships to devices, which a hardcoded
    /// mirror of src/lib/config.ts would not.
    var isAdmin = false

    func refreshAdmin() async {
        guard userId != nil else {
            isAdmin = false
            return
        }
        struct Answer: Decodable {}
        isAdmin = (try? await supa.rpc("is_admin").execute().value as Bool) ?? false
    }

    func metadataFlag(_ key: String) -> Bool {
        guard case .signedIn(let session) = phase else { return false }
        return session.user.userMetadata[key]?.boolValue ?? false
    }

    func setMetadataFlag(_ key: String, _ value: Bool) async {
        try? await supa.auth.update(user: UserAttributes(data: [key: .bool(value)]))
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

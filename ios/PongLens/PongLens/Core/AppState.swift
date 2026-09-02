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

    /// The account's full display name, for the chooseSide name-fill
    /// (YourSideSheet writes it into player_*_name the way the web does).
    /// Empty when the account has never had a name — the fill then leaves
    /// the column alone rather than inventing one.
    var displayName: String {
        guard case .signedIn(let session) = phase else { return "" }
        let meta = session.user.userMetadata
        return (meta["full_name"]?.stringValue ?? meta["name"]?.stringValue)?
            .trimmingCharacters(in: .whitespaces) ?? ""
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

    /// app_config placement_serves_only (132): the maps show serves only.
    ///
    /// Read rather than compiled in, so the phone follows the same switch
    /// the web reads and one match cannot show serves in the browser and
    /// every landing here. False on any failure, which is the old
    /// behaviour — a shipped build that cannot reach the config should
    /// look like the build before it, not like a half-flipped one.
    var placementServesOnly = false

    /// app_config tap_end_playback (138): scored points end at the winner
    /// tap plus half a second (Playhead.effectiveEnd) and watch mode jumps
    /// the dead footage between a tap and the next rally. False on any
    /// failure — a build that cannot reach the config behaves like the
    /// build before the flag existed.
    var tapEndPlayback = false

    /// app_config unscored_rally_end (143): a point NOBODY scored ends at
    /// the observed rally end plus a buffer, instead of at the padding that
    /// exists to catch a winner tap. Ranked below the tap, never combined
    /// with it. False on any failure, same reasoning as above.
    var unscoredRallyEnd = false

    /// app_config unscored_rally_end_buffer_s. A server value rather than a
    /// constant because it is not calibrated yet, and widening it must not
    /// need a build. An unreadable value falls back to the default rather
    /// than to zero — zero is the most dangerous setting there is.
    var unscoredRallyEndBufferS = 0.5

    /// app_config game_end_detection (140): a marker between two rallies
    /// where the video shows the players swapping ends. False on any
    /// failure — a build that cannot reach the config should behave like
    /// the build before the flag existed, not like a half-flipped one.
    var gameEndDetection = false

    /// What the players and the picker pass to Playhead.effectiveEnd.
    var endOptions: EndOptions {
        EndOptions(
            tapEnd: tapEndPlayback,
            rallyEnd: unscoredRallyEnd
                ? RallyEndConfig(on: true, bufferS: unscoredRallyEndBufferS)
                : nil
        )
    }

    func refreshConfigFlags() async {
        struct ConfigRow: Decodable { let key: String?; let value: String? }
        let rows: [ConfigRow]? = try? await supa
            .from("app_config")
            .select("key,value")
            .in("key", values: [
                "placement_serves_only", "tap_end_playback",
                "unscored_rally_end", "unscored_rally_end_buffer_s",
                "game_end_detection",
            ])
            .execute().value
        placementServesOnly = (rows?.first {
            $0.key == "placement_serves_only"
        }?.value ?? "").contains("true")
        tapEndPlayback = rows?.first {
            $0.key == "tap_end_playback"
        }?.value == "on"
        unscoredRallyEnd = rows?.first {
            $0.key == "unscored_rally_end"
        }?.value == "on"
        unscoredRallyEndBufferS = rows?.first {
            $0.key == "unscored_rally_end_buffer_s"
        }?.value.flatMap(Double.init).map { max(0, $0) } ?? 0.5
        gameEndDetection = rows?.first {
            $0.key == "game_end_detection"
        }?.value == "on"
    }

    // MARK: - Workspace

    /// Which side of the app this account is using: playing or coaching.
    /// A per-user choice, remembered on the device; the coaching side only
    /// offers itself to accounts with coach data (links, a roster, or the
    /// onboarding answer in metadata).
    enum Workspace: String {
        case player
        case coach
    }

    var workspace: Workspace = .player

    private static func workspaceKey(_ uid: UUID) -> String {
        "pl.workspace.\(uid.uuidString.lowercased())"
    }

    /// Resolve the remembered choice for the signed-in user. Accounts that
    /// answered "coach" at onboarding and never chose since land on the
    /// coaching side; everyone else starts as a player.
    func loadWorkspace() {
        guard let uid = userId else {
            workspace = .player
            return
        }
        if let stored = UserDefaults.standard.string(forKey: Self.workspaceKey(uid)),
           let value = Workspace(rawValue: stored) {
            workspace = value
        } else {
            workspace = metadataFlag("is_coach") ? .coach : .player
        }
    }

    func setWorkspace(_ value: Workspace) {
        workspace = value
        guard let uid = userId else { return }
        UserDefaults.standard.set(value.rawValue, forKey: Self.workspaceKey(uid))
        // Entering the coaching side marks the account a coach for good,
        // so the switcher still offers itself from a fresh install or
        // another device — the roster alone only exists once loaded.
        if value == .coach, !metadataFlag("is_coach") {
            Task { await setMetadataFlag("is_coach", true) }
        }
    }

    func metadataFlag(_ key: String) -> Bool {
        guard case .signedIn(let session) = phase else { return false }
        return session.user.userMetadata[key]?.boolValue ?? false
    }

    func setMetadataFlag(_ key: String, _ value: Bool) async {
        try? await supa.auth.update(user: UserAttributes(data: [key: .bool(value)]))
    }

    /// A metadata value that is a number rather than a flag, handed back
    /// raw so the tested half — `CameraGuideGate.coerce` — is the only
    /// thing that decides what counts as a count.
    func metadataValue(_ key: String) -> Any? {
        guard case .signedIn(let session) = phase else { return nil }
        return session.user.userMetadata[key]?.value
    }

    func setMetadataInt(_ key: String, _ value: Int) async {
        try? await supa.auth.update(user: UserAttributes(data: [key: .integer(value)]))
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

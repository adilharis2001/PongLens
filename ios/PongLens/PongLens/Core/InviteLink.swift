import Foundation

/// An invite link the app can accept natively: a coach's invite to a
/// student (`/join/<token>`) or a player's invite to a coach
/// (`/coach-invite/<token>`). These are the two paths the website's
/// apple-app-site-association file hands to the app, so a phone with the
/// app installed opens them here rather than in its browser, signed in as
/// the account the app holds rather than whichever one the browser did.
///
/// Same shape as `LessonVideoLink`: https only, both hosts, a UUID in the
/// second path segment, nil for anything else.
nonisolated enum InviteLink: Identifiable, Equatable {
    /// A coach invited this account as their student.
    case student(token: UUID)
    /// A player invited this account as their coach.
    case coach(token: UUID)

    var token: UUID {
        switch self {
        case .student(let token), .coach(let token): token
        }
    }

    var id: UUID { token }

    init?(url: URL) {
        guard url.scheme?.lowercased() == "https",
              ["ponglens.com", "www.ponglens.com"].contains(url.host?.lowercased() ?? "")
        else { return nil }
        let path = url.pathComponents.filter { $0 != "/" }
        guard path.count == 2, let token = UUID(uuidString: path[1]) else { return nil }
        switch path[0] {
        case "join": self = .student(token: token)
        case "coach-invite": self = .coach(token: token)
        default: return nil
        }
    }
}

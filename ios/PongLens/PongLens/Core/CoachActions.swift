import Foundation

/// What a player may do about a coach, and what the app says while doing it.
///
/// The twin of `src/lib/coaches/coachActions.ts`, asserted against the same
/// generated fixture (`ios/Tests/fixtures/coach-actions.json`) so a state
/// added on one platform fails the other platform's test. That fixture is the
/// only thing here that works without anyone remembering it, which is why
/// these rules live in one place rather than in the four screens that ask
/// them.
///
/// The rule that put this file here: on 2026-09-10 the owner opened a new
/// account, wrote down a coach called Kory, and lost the only invite button in
/// the product. It was gated on "no coaches yet", written twice in prose, on
/// two platforms. `coachingTabDoor` is that gate, written once.
enum CoachActions {

    /// How the coach list was last read.
    ///
    /// `failed` is not decoration. Both clients used to coerce a dropped
    /// request into an empty array and call it loaded, so one bad connection
    /// told a player with six coaches that they had none, and re-hid the
    /// invite door in exactly the way this work exists to stop.
    enum ListState: String {
        case loading
        case ready
        case failed
    }

    /// What the Coaching tab shows where the coaches live.
    enum TabDoor: String {
        case loading
        case empty
        case row
        case error
    }

    /// The one gate. Exactly one of the first-run card and the permanent row
    /// is on screen once the list has been read, in every state.
    ///
    /// Pending invites count. A player whose only artefact is an invite nobody
    /// has named would otherwise get the first-run card and still have no way
    /// to reach the link they already sent.
    static func tabDoor(
        coachCount: Int, pendingInviteCount: Int, state: ListState
    ) -> TabDoor {
        switch state {
        case .loading: return .loading
        case .failed: return .error
        case .ready: return coachCount + pendingInviteCount > 0 ? .row : .empty
        }
    }

    /// The trailing note on that row, or nil when nothing is waiting.
    static func invitesWaitingLabel(_ pendingInviteCount: Int) -> String? {
        guard pendingInviteCount > 0 else { return nil }
        return pendingInviteCount == 1
            ? "1 invite waiting"
            : "\(pendingInviteCount) invites waiting"
    }

    /// Whether this coach can be sent an invite.
    ///
    /// Offline is the obvious one. Past matters just as much: the naming
    /// helper filters on a null coach id, so inviting a coach you used to work
    /// with used to mint a SECOND row with the same name that only healed if
    /// they accepted. Binding the invite onto the row they already have is
    /// what makes one coach one row for good.
    static func canSendInvite(status: String) -> Bool {
        status == "offline" || status == "past"
    }

    /// Whether ending access is a thing that can be done to this coach.
    static func canEndAccess(status: String) -> Bool { status == "connected" }

    /// What the sheet's primary should do about a name already on the list.
    enum DuplicateAction: String {
        case inviteThisRow = "invite-this-row"
        case openTheirPage = "open-their-page"
    }

    struct DuplicateNotice: Equatable {
        let line: String
        let action: DuplicateAction
    }

    /// What typing a name into the invite composer should tell the player.
    ///
    /// The `invited` case is the sharpest hazard in this area: typing a name
    /// that already has an invite out used to adopt the row and overwrite its
    /// invite, leaving the first one pending, unnamed, and holding a queue of
    /// matches nobody could reach.
    static func duplicateNotice(
        rows: [PlayerCoach], typed: String
    ) -> DuplicateNotice? {
        guard let coach = findByName(rows: rows, name: typed) else { return nil }
        let name = coach.displayName
        switch coach.status {
        case "invited":
            return DuplicateNotice(
                line: "\(name) already has an invite waiting.",
                action: .openTheirPage)
        case "connected":
            return DuplicateNotice(
                line: "\(name) is already connected.",
                action: .openTheirPage)
        default:
            return DuplicateNotice(
                line: "\(name) is already on your list. This invite goes to them.",
                action: .inviteThisRow)
        }
    }

    /// An existing row for this name, case and space insensitively. The twin
    /// of `findCoachByName`.
    static func findByName(rows: [PlayerCoach], name: String) -> PlayerCoach? {
        let key = normalizeName(name).lowercased()
        guard !key.isEmpty else { return nil }
        return rows.first {
            $0.displayName.trimmingCharacters(in: .whitespaces).lowercased() == key
        }
    }

    static func normalizeName(_ value: String) -> String {
        let collapsed = value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
        return String(collapsed.prefix(80))
    }

    struct Confirm: Equatable {
        let title: String
        let body: String
        let confirmLabel: String
    }

    /// Removing a coach.
    ///
    /// "Your lessons keep their name" replaces the older "Your lessons are
    /// kept". What a player is afraid of losing is the name on the card, not
    /// the card, and the promise the database actually makes is about the
    /// name: `coach_name` survives an archive, `shared_with_coach_at` does not.
    static func removeConfirm(name: String, status: String) -> Confirm {
        let title = "Remove \(name) from your list?"
        switch status {
        case "connected":
            return Confirm(
                title: title,
                body: "They stop seeing your matches and the entries you shared with them. Your lessons keep their name.",
                confirmLabel: "Remove")
        case "invited":
            return Confirm(
                title: title,
                body: "The invite stops working and cannot be restarted. Your lessons keep their name.",
                confirmLabel: "Remove")
        default:
            return Confirm(
                title: title,
                body: "Your lessons keep their name.",
                confirmLabel: "Remove")
        }
    }

    /// Ending access, which is not removal and must not read like it.
    static func endAccessConfirm(name: String) -> Confirm {
        Confirm(
            title: "End their access?",
            body: "\(name) stops seeing your matches and the entries you shared with them. They stay on your list and your lessons keep their name.",
            confirmLabel: "End access")
    }

    /// What a restored coach needs told, or nil when the standing line says it.
    ///
    /// Removal revokes an outstanding invite, and putting the coach back does
    /// not revive it: the list needs a PENDING link to read "Invite waiting",
    /// so an invited coach comes back reading "Not on PongLens" with no
    /// explanation of where their link went. This is that explanation.
    static func restoreNotice(status: String) -> String? {
        status == "offline"
            ? "The invite you sent them was cancelled. Send a new one."
            : nil
    }

    /// The standing, in the words a player reads.
    static func standingWords(_ status: String) -> String {
        switch status {
        case "connected": return "Connected"
        case "invited": return "Invite waiting"
        case "past": return "No longer connected"
        default: return "Not on PongLens"
        }
    }

    /// The line under a coach's name in a list.
    ///
    /// One rule, because it was two: web suppressed the access half for a
    /// coach with no account and the phone did not, so the phone printed "Not
    /// on PongLens · Not connected", saying one fact twice, one tap from a
    /// screen that said it once.
    static func accessLine(
        status: String, hasAccount: Bool, access: String?
    ) -> String {
        let standing = standingWords(status)
        guard hasAccount, let access, !access.isEmpty else { return standing }
        return "\(standing) · \(access)"
    }

    /// The sentence under an invite link.
    ///
    /// Two variants because the box now appears in three places and only one
    /// of them has a Revoke under it. It used to name a destination, and named
    /// a different one on each platform ("from Coaching" on the web, "from
    /// Account" on the phone) for a screen that manages none of this.
    static func inviteWaitingLine(revokeIsHere: Bool) -> String {
        revokeIsHere
            ? "It is waiting until they open it. You can revoke it any time."
            : "It is waiting until they open it. You can revoke it from their page under Your coaches."
    }
}

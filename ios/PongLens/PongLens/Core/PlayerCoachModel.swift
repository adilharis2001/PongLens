import Foundation

/// The player's own coach rows, and nothing that needs a screen.
///
/// Lifted out of JournalStore on 2026-09-10 so `ios/Tests/run.sh` can compile
/// it: that harness is a plain swiftc build over Core files that import
/// Foundation and nothing else, and the coach-action parity test needs this
/// type. Same module, so no other file changed.
///
/// Not to be confused with Core/CoachModels.swift, which is the COACH side's
/// marketplace schema (review orders, offerings, findings). This file is the
/// player's list of the people who coach them.

/// One of the player's own coaches, as player_coaches_list() returns it
/// (164). The web twin is `PlayerCoach` in src/lib/coaches/playerCoaches.ts;
/// keep the rules in step.
///
/// coachId is optional and that is the point: a coach who has been INVITED
/// has nobody behind their link yet, so an entry could not be attributed to
/// them at all if this pointed at an account. It also covers the coach who
/// will never join, which is most of them.
struct PlayerCoach: Codable, Identifiable, Hashable {
    let id: UUID
    let coachId: UUID?
    let displayName: String
    let coachEmail: String?
    let inviteId: UUID?
    /// "connected" | "invited" | "past" | "offline", from coach_links.
    /// past and offline are separate on purpose: offline may be invited
    /// later, past is a relationship that ended on either side and the
    /// row survives only because the lessons did.
    let status: String
    let entryCount: Int
    let sharedCount: Int

    enum CodingKeys: String, CodingKey {
        case id, status
        case coachId = "coach_id"
        case displayName = "display_name"
        case coachEmail = "coach_email"
        case inviteId = "invite_id"
        case entryCount = "entry_count"
        case sharedCount = "shared_count"
    }

    /// Whether sharing an entry with them can ever reach them. "invited"
    /// counts: student_shared_lessons() needs an accepted link too, so a
    /// share set while an invite is out simply waits for it.
    var canReceiveEntries: Bool { status == "connected" || status == "invited" }

    /// The marker beside the name in a picker, when there is one to make.
    var stateMark: String? {
        switch status {
        case "invited": return "invited"
        case "past": return "past"
        default: return nil
        }
    }

    /// The line under the share control. Never guesses a pronoun.
    var shareHint: String? {
        switch status {
        case "connected": return "They can read it in their coaching workspace."
        case "invited": return "They can read it once they accept your invite."
        default: return nil
        }
    }
}

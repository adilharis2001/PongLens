import Foundation
import Supabase

struct CoachLinkRow: Codable, Identifiable, Hashable {
    let id: UUID
    let status: String
    let scopeMatchId: UUID?
    let inviteToken: String?
    let coachId: UUID?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, status
        case scopeMatchId = "scope_match_id"
        case inviteToken = "invite_token"
        case coachId = "coach_id"
        case createdAt = "created_at"
    }
}

struct StudentOrderRow: Codable, Identifiable, Hashable {
    let id: UUID
    let status: String?
    let offeringTitle: String?
    let coachName: String?

    enum CodingKeys: String, CodingKey {
        case id, status
        case offeringTitle = "offering_title"
        case coachName = "coach_name"
    }
}

/// The Coaching tab's gate and player-side data. The tab shows when ANY of
/// the web's four checks passes; the answer is cached like the web's
/// sessionStorage flag so the tab never pops in after first paint.
@Observable
final class CoachingStore {
    var isCoach = false
    /// Someone's accepted coach, regardless of having a marketplace page.
    /// One leg of "does the coaching workspace offer itself".
    var coachesAnyone = false
    var showTab: Bool
    var coachLinks: [CoachLinkRow] = []
    var orders: [StudentOrderRow] = []
    var loaded = false

    /// The no-pop-in cache is per account — two people share a phone, and
    /// one being a coach must not flash the tab at the other.
    static func tabCacheKey(_ userId: UUID) -> String {
        "pl-coach-tab-\(userId.uuidString.lowercased())"
    }

    init() {
        // With the marketplace web-only, the Coaching tab never shows: the
        // free half of coaching lives on Account (your coaches) and in
        // Matches (shared with you) instead.
        if AppConfig.coachMarketplace, let uid = supa.auth.currentSession?.user.id {
            showTab = UserDefaults.standard.bool(forKey: Self.tabCacheKey(uid))
        } else {
            showTab = false
        }
    }

    func load(userId: UUID?) async {
        guard let userId else { return }
        let uid = userId.uuidString.lowercased()

        async let profileQ = try? supa
            .from("coach_profiles").select("user_id", head: true, count: .exact)
            .eq("user_id", value: uid).execute()
        async let asCoachQ = try? supa
            .from("coach_links").select("id", head: true, count: .exact)
            .eq("coach_id", value: uid).eq("status", value: "accepted").execute()
        async let asPlayerQ: [CoachLinkRow]? = try? supa
            .from("coach_links")
            .select("id,status,scope_match_id,invite_token,coach_id,created_at")
            .eq("player_id", value: uid)
            .neq("status", value: "revoked")
            .order("created_at", ascending: false)
            .execute().value
        async let ordersQ: [StudentOrderRow]? = try? supa
            .rpc("student_review_orders").execute().value

        let (profile, asCoach, links, orderRows) = await (profileQ, asCoachQ, asPlayerQ, ordersQ)
        isCoach = (profile?.count ?? 0) > 0
        coachesAnyone = (asCoach?.count ?? 0) > 0
        coachLinks = links ?? []
        orders = orderRows ?? []
        showTab = AppConfig.coachMarketplace
            && (isCoach
                || (asCoach?.count ?? 0) > 0
                || !coachLinks.isEmpty
                || !orders.isEmpty)
        UserDefaults.standard.set(showTab, forKey: Self.tabCacheKey(userId))
        loaded = true
    }

    /// Ending a coach ends everything with them (157): every link with
    /// that coach revoked AND the roster binding cleared, so their shared
    /// journal entries stop as well as their match access. A pending
    /// invite nobody accepted carries no coach and is simply flipped.
    func revokeLink(_ link: CoachLinkRow) async {
        if let coachId = link.coachId {
            struct Params: Encodable { let p_coach_id: String }
            _ = try? await supa
                .rpc("leave_coach", params: Params(p_coach_id: coachId.uuidString.lowercased()))
                .execute()
            coachLinks.removeAll { $0.coachId == coachId }
        } else {
            _ = try? await supa
                .from("coach_links")
                .update(["status": AnyJSON.string("revoked")])
                .eq("id", value: link.id.uuidString.lowercased())
                .execute()
            coachLinks.removeAll { $0.id == link.id }
        }
    }
}

func studentOrderStatusLabel(_ status: String?) -> String {
    switch status {
    case "awaiting_submission": "Pick your match"
    case "submitted": "Sent"
    case "in_review": "In review"
    case "clarification": "Question for you"
    case "delivered": "Your review is ready"
    case "completed": "Done"
    case "declined": "Declined"
    case "cancelled": "Cancelled"
    default: status ?? ""
    }
}

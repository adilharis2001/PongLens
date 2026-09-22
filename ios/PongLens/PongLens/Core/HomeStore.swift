import Foundation
import Supabase

/// One rendered export in Home's activity feed — a match_reels row with
/// just enough manifest to title it.
struct ReelFeedRow: Decodable, Identifiable, Hashable {
    let matchId: UUID
    let scope: String
    let status: String
    let durationS: Double?
    let manifest: Manifest?
    let updatedAt: String

    var id: String { "\(matchId.uuidString)-\(scope)" }
    var rendering: Bool { status == "queued" || status == "rendering" }

    struct Manifest: Decodable, Hashable {
        let youName: String?
        let themName: String?

        enum CodingKeys: String, CodingKey {
            case youName = "you_name"
            case themName = "them_name"
        }
    }

    enum CodingKeys: String, CodingKey {
        case scope, status, manifest
        case matchId = "match_id"
        case durationS = "duration_s"
        case updatedAt = "updated_at"
    }
}

/// The small facts Home needs that no other store carries: whether any
/// share link or coach link exists, and the latest rendered exports.
@Observable
final class HomeStore {
    var shareLinksCount = 0
    var coachLinksCount = 0
    var reels: [ReelFeedRow] = []
    /// Lesson videos this account has imported, for the First steps row.
    var lessonVideosCount = 0
    /// The three board posts being talked about most recently, for Home's
    /// last section. Open posts only: a finished one is not an invitation.
    var boardItems: [FeedbackItem] = []
    /// The newest starred points, for Home's Starred points row, in the
    /// shelf's own order (newest match first).
    var starred: [StarredPointRow] = []
    var loaded = false

    /// Home shows this many stars; the shelf has the rest.
    static let starredLimit = 10

    func load(userId: UUID?) async {
        guard let userId else { return }
        let shares = try? await supa
            .from("share_links")
            .select("id", head: true, count: .exact)
            .is("revoked_at", value: nil)
            .execute()
        shareLinksCount = shares?.count ?? 0

        let coaches = try? await supa
            .from("coach_links")
            .select("id", head: true, count: .exact)
            .eq("player_id", value: userId.uuidString.lowercased())
            .neq("status", value: "revoked")
            .execute()
        coachLinksCount = coaches?.count ?? 0

        let videos = try? await supa
            .from("lesson_videos")
            .select("id", head: true, count: .exact)
            .eq("owner_id", value: userId.uuidString.lowercased())
            .execute()
        lessonVideosCount = videos?.count ?? 0

        let reelRows: [ReelFeedRow]? = try? await supa
            .from("match_reels")
            .select("match_id,scope,status,duration_s,manifest,updated_at")
            .order("updated_at", ascending: false)
            .limit(6)
            .execute()
            .value
        reels = reelRows ?? []

        struct BoardReq: Encodable {
            let p_sort: String
            let p_limit: Int
        }
        let board: [FeedbackItem]? = try? await supa
            .rpc("feedback_board", params: BoardReq(p_sort: "active", p_limit: 8))
            .execute()
            .value
        boardItems = Array((board ?? []).filter { !$0.isHidden && !$0.isDone }.prefix(3))

        // One call, ten rows (2026-09-22). A failed read keeps the row that
        // was already showing rather than emptying it.
        struct StarredReq: Encodable { let p_limit: Int }
        if let rows: [StarredPointRow] = try? await supa
            .rpc("starred_points", params: StarredReq(p_limit: Self.starredLimit))
            .execute()
            .value {
            starred = rows
        }
        loaded = true
    }
}

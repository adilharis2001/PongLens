import Foundation

// The feedback board's data and the small rules the screens share.
// Foundation only, so ios/Tests can compile it without SwiftUI.

/// One row of the board, straight from `feedback_board` / `feedback_item`.
///
/// The RPC decides what each caller may see: private rows reach only
/// their author and the admin, so there is nothing to filter here beyond
/// what arrives.
struct FeedbackItem: Decodable, Identifiable, Hashable {
    let id: UUID
    let userId: UUID
    let title: String
    let body: String
    let type: String
    let status: String
    var voteCount: Int
    let createdAt: String
    let authorName: String?
    let authorAvatar: String?
    var voted: Bool
    let hidden: Bool?
    var commentCount: Int
    let lastActivityAt: String?
    /// The admin's latest comment on this post, pinned under it.
    let officialReply: String?
    let officialReplyAt: String?

    enum CodingKeys: String, CodingKey {
        case id, title, body, type, status, voted, hidden
        case userId = "user_id"
        case voteCount = "vote_count"
        case createdAt = "created_at"
        case authorName = "author_name"
        case authorAvatar = "author_avatar"
        case commentCount = "comment_count"
        case lastActivityAt = "last_activity_at"
        case officialReply = "official_reply"
        case officialReplyAt = "official_reply_at"
    }

    var isDone: Bool { status == "done" || status == "declined" }
    var isHidden: Bool { hidden == true }
}

/// One comment under a post, from `feedback_thread`.
struct FeedbackComment: Decodable, Identifiable, Hashable {
    let id: UUID
    let userId: UUID
    var body: String
    let createdAt: String
    var editedAt: String?
    let authorName: String?
    let authorAvatar: String?
    /// Written by the admin: shown as PongLens, not as a first name.
    let official: Bool

    enum CodingKeys: String, CodingKey {
        case id, body, official
        case userId = "user_id"
        case createdAt = "created_at"
        case editedAt = "edited_at"
        case authorName = "author_name"
        case authorAvatar = "author_avatar"
    }
}

/// The board's two tabs: the posts and their threads, and the roadmap.
enum FeedbackTab: String, CaseIterable, Identifiable {
    case feedback, roadmap
    var id: String { rawValue }
    var label: String {
        switch self {
        case .feedback: "Feedback"
        case .roadmap: "Roadmap"
        }
    }
}

/// Where a feedback link points. The bell writes `/feedback/<post id>`
/// (feedback_post_comment); the board itself is `/feedback`.
enum FeedbackLink {
    static func itemId(in href: String) -> UUID? {
        guard href.hasPrefix("/feedback/") else { return nil }
        var rest = String(href.dropFirst("/feedback/".count))
        if let cut = rest.firstIndex(where: { $0 == "?" || $0 == "#" || $0 == "/" }) {
            rest = String(rest[..<cut])
        }
        return UUID(uuidString: rest)
    }

    static func isBoard(_ href: String) -> Bool {
        href == "/feedback" || href.hasPrefix("/feedback?") || href.hasPrefix("/feedback/")
    }
}

/// What /api/feedback/assist hands back once a post is saved: follow-up
/// questions (usually none), a post that already asks for the same thing,
/// and whether the post landed on the board or came to us privately.
struct FeedbackAssist: Decodable {
    struct Similar: Decodable {
        let id: UUID
        let title: String
    }
    let questions: [String]?
    let similar: Similar?
    let visibility: String?
}

// MARK: - Roadmap

/// The three stages of the public roadmap, in reading order: what is
/// happening now, then next, then done.
enum RoadmapStage: String, CaseIterable, Identifiable, Decodable {
    case building, planned, shipped
    var id: String { rawValue }

    var label: String {
        switch self {
        case .building: "In development"
        case .planned: "Planned"
        case .shipped: "Shipped"
        }
    }
}

/// One roadmap entry, from `roadmap_items`: a title and one sentence,
/// with the month for anything shipped and a place to try it when there
/// is one.
struct RoadmapItem: Decodable, Identifiable, Hashable {
    let id: UUID
    let title: String
    let description: String
    let stage: RoadmapStage
    let position: Int
    let shippedAt: String?
    let link: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, title, description, stage, position, link
        case shippedAt = "shipped_at"
        case createdAt = "created_at"
    }
}

enum Roadmap {
    struct Group: Identifiable {
        let stage: RoadmapStage
        let items: [RoadmapItem]
        var id: String { stage.rawValue }
    }

    /// Items grouped by stage in reading order, each stage by position
    /// then by age. Shipped reads newest first: the top of that list is
    /// the thing that just landed. Empty stages are left out, so a thin
    /// roadmap is not three headings over nothing.
    static func groups(_ items: [RoadmapItem]) -> [Group] {
        RoadmapStage.allCases.compactMap { stage in
            let rows = items
                .filter { $0.stage == stage }
                .sorted { a, b in
                    if stage == .shipped, (a.shippedAt ?? "") != (b.shippedAt ?? "") {
                        return (a.shippedAt ?? "") > (b.shippedAt ?? "")
                    }
                    if a.position != b.position { return a.position < b.position }
                    return a.createdAt < b.createdAt
                }
            return rows.isEmpty ? nil : Group(stage: stage, items: rows)
        }
    }

    /// "Sep 2026" from a `yyyy-MM-dd` date. Month and year only.
    static func shippedLabel(_ shippedAt: String?) -> String? {
        guard let shippedAt else { return nil }
        let parts = shippedAt.split(separator: "-").compactMap { Int($0) }
        guard parts.count >= 2, (1...12).contains(parts[1]) else { return nil }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        components.day = 1
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        guard let date = calendar.date(from: components) else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "MMM yyyy"
        return formatter.string(from: date)
    }
}

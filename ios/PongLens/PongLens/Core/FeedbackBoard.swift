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

/// How the board is ordered: what is wanted, what is fresh, what is
/// being talked about.
enum FeedbackSort: String, CaseIterable, Identifiable {
    case top, new, active
    var id: String { rawValue }
    var label: String {
        switch self {
        case .top: "Top"
        case .new: "New"
        case .active: "Active"
        }
    }
}

/// The stages a post moves through once the maker has looked at it. The
/// rail above the board shows one pill per stage with a count; pressing
/// one filters the list to it.
enum FeedbackStage: String, CaseIterable, Identifiable {
    case planned, building, done
    var id: String { rawValue }

    var label: String {
        switch self {
        case .planned: "Planned"
        case .building: "Building"
        case .done: "Done"
        }
    }

    /// Whether a post belongs to this stage. Declined posts sit under
    /// Done: both are finished, and a separate "Declined" pill would be
    /// a column of things nobody wants to read about.
    func contains(_ item: FeedbackItem) -> Bool {
        switch self {
        case .planned: item.status == "planned"
        case .building: item.status == "building"
        case .done: item.isDone
        }
    }

    static func counts(_ items: [FeedbackItem]) -> [FeedbackStage: Int] {
        var out: [FeedbackStage: Int] = [:]
        for stage in allCases {
            out[stage] = items.filter(stage.contains).count
        }
        return out
    }

    /// The rail appears only once something has moved. An empty board is
    /// not three empty columns.
    static func railVisible(_ items: [FeedbackItem]) -> Bool {
        items.contains { item in allCases.contains { $0.contains(item) } }
    }

    /// The rows the list shows: one stage when a pill is lit, otherwise
    /// everything still open.
    static func visible(_ items: [FeedbackItem], stage: FeedbackStage?) -> [FeedbackItem] {
        if let stage { return items.filter(stage.contains) }
        return items.filter { !$0.isDone }
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

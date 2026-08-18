import Foundation
import Supabase

struct ShareLinkRow: Codable, Identifiable, Hashable {
    let id: UUID
    let matchId: UUID?
    let pointId: UUID?
    let kind: String?
    let title: String?
    let revokedAt: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, kind, title
        case matchId = "match_id"
        case pointId = "point_id"
        case revokedAt = "revoked_at"
        case createdAt = "created_at"
    }

    var label: String {
        if let title, !title.isEmpty { return title }
        switch kind {
        case "starred": return "Starred points"
        case "tag": return "Tagged points"
        default: return pointId == nil ? "This match" : "This point"
        }
    }
}

@Observable
final class AccountStore {
    struct StorageState: Decodable {
        let storageLimitBytes: Int64?
        let usedBytes: Int64?

        enum CodingKeys: String, CodingKey {
            case storageLimitBytes = "storage_limit_bytes"
            case usedBytes = "used_bytes"
        }
    }

    struct ProcessingState: Decodable {
        let minutesBalance: Double?
        let billingMode: String?

        enum CodingKeys: String, CodingKey {
            case minutesBalance = "minutes_balance"
            case billingMode = "billing_mode"
        }
    }

    var storage: StorageState?
    var processing: ProcessingState?
    var commerceEnabled = false
    var supportEmail = "support@ponglens.com"
    var recollectEnabled = false
    var shareLinks: [ShareLinkRow] = []
    var loaded = false

    func load(userId: UUID?) async {
        struct ConfigRow: Decodable {
            let key: String
            let value: String?
        }
        async let configQ: [ConfigRow]? = try? supa
            .from("app_config")
            .select("key,value")
            .in("key", values: ["commerce_enabled", "support_email"])
            .execute().value
        async let storageQ: [StorageState]? = try? supa
            .rpc("my_storage_state").execute().value
        async let processingQ: [ProcessingState]? = try? supa
            .rpc("my_processing_state").execute().value
        async let linksQ: [ShareLinkRow]? = try? supa
            .from("share_links")
            .select("id,match_id,point_id,kind,title,revoked_at,created_at")
            .is("revoked_at", value: nil)
            .order("created_at", ascending: false)
            .execute().value

        struct RecollectPref: Decodable { let enabled: Bool }
        async let recollectQ: [RecollectPref]? = try? supa
            .from("recollect_preferences")
            .select("enabled")
            .execute().value

        let (config, s, p, links, recollect) = await (configQ, storageQ, processingQ, linksQ, recollectQ)
        for row in config ?? [] {
            if row.key == "commerce_enabled" {
                commerceEnabled = (row.value ?? "").contains("true")
            }
            if row.key == "support_email", let v = row.value, !v.isEmpty {
                supportEmail = v.replacingOccurrences(of: "\"", with: "")
            }
        }
        storage = s?.first
        processing = p?.first
        shareLinks = links ?? []
        recollectEnabled = recollect?.first?.enabled ?? false
        loaded = true
    }

    func setRecollect(_ enabled: Bool, userId: UUID?) async -> Bool {
        guard let userId else { return false }
        struct Upsert: Encodable {
            let user_id: String
            let enabled: Bool
        }
        do {
            try await supa
                .from("recollect_preferences")
                .upsert(Upsert(user_id: userId.uuidString.lowercased(), enabled: enabled))
                .execute()
            recollectEnabled = enabled
            return true
        } catch {
            return false
        }
    }

    func revoke(_ link: ShareLinkRow) async {
        struct Req: Encodable { let id: String }
        struct Res: Decodable { let ok: Bool? }
        let res: Res? = try? await API.post(
            "api/share/revoke", Req(id: link.id.uuidString.lowercased())
        )
        if res != nil {
            shareLinks.removeAll { $0.id == link.id }
        }
    }
}

// MARK: - Notifications

struct NotificationRow: Codable, Identifiable, Hashable {
    let id: UUID
    let kind: String
    let matchId: UUID?
    let title: String
    let body: String?
    let href: String
    let groupCount: Int?
    let readAt: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, kind, title, body, href
        case matchId = "match_id"
        case groupCount = "group_count"
        case readAt = "read_at"
        case createdAt = "created_at"
    }
}

@Observable
final class NotificationsStore {
    var rows: [NotificationRow] = []
    var loaded = false
    private var pollTask: Task<Void, Never>?

    var unreadCount: Int { rows.filter { $0.readAt == nil }.count }

    func load() async {
        let fetched: [NotificationRow]? = try? await supa
            .from("notifications")
            .select("id,kind,match_id,title,body,href,group_count,read_at,created_at")
            .order("created_at", ascending: false)
            .limit(30)
            .execute().value
        if let fetched { rows = fetched }
        loaded = true
    }

    func markAllRead() async {
        let stamp = ISO8601DateFormatter().string(from: Date())
        _ = try? await supa
            .from("notifications")
            .update(["read_at": AnyJSON.string(stamp)])
            .is("read_at", value: nil)
            .execute()
        rows = rows.map { row in
            guard row.readAt == nil else { return row }
            return NotificationRow(
                id: row.id, kind: row.kind, matchId: row.matchId, title: row.title,
                body: row.body, href: row.href, groupCount: row.groupCount,
                readAt: stamp, createdAt: row.createdAt
            )
        }
    }

    /// The web polls the bell every 60 s — the events it reports are
    /// minutes-scale, so no realtime.
    func startPolling() {
        guard pollTask == nil else { return }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 60 * 1_000_000_000)
                guard !Task.isCancelled else { break }
                await self?.load()
            }
        }
    }
}

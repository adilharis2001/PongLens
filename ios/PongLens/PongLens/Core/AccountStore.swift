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
        case "highlights": return "Highlights"
        case "tag": return "Tagged points"
        case "entry": return "Journal entry"
        default: return pointId == nil ? "This match" : "This point"
        }
    }
}

@Observable
final class AccountStore {
    struct StorageState: Decodable {
        let storageLimitBytes: Int64?
        let usedBytes: Int64?
        /// When the buckets were last measured for this account, and what
        /// they held by kind. Nil until the first nightly measurement.
        let snapshotAt: String?
        let breakdown: [String: Int64]?

        enum CodingKeys: String, CodingKey {
            case storageLimitBytes = "storage_limit_bytes"
            case usedBytes = "used_bytes"
            case snapshotAt = "snapshot_at"
            case breakdown
        }

        struct BreakdownRow: Identifiable {
            let id: String
            let label: String
            let bytes: Int64
        }

        /// Last night's measurement by kind, largest first, in the words
        /// the web Account page uses. The keys are named by the web app's
        /// storage inventory (lib/storage/inventory.ts); a key this list
        /// does not know is left out rather than shown raw.
        var breakdownRows: [BreakdownRow] {
            let labels: [(String, String)] = [
                ("match_original", "Match videos"),
                ("match_cut", "Cut versions"),
                ("match_clips", "Point clips and match data"),
                ("lesson_video", "Lesson videos"),
                ("reels", "Reels and highlights"),
                ("notes_media", "Voice notes, sketches and photos"),
                ("coach_media", "Coaching files"),
            ]
            // A kind that would read "0.0 GB" is left off the list, the same
            // rule as the web Account page: a few kilobytes of sketches is
            // not something to show a row for.
            return labels.compactMap { key, label -> BreakdownRow? in
                guard let bytes = breakdown?[key],
                      Double(bytes) / 1_073_741_824 >= 0.05 else { return nil }
                return BreakdownRow(id: key, label: label, bytes: bytes)
            }.sorted { $0.bytes > $1.bytes }
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
    var purchasesEnabled = false
    var supportEmail = "support@ponglens.com"
    /// No preference row means enabled, the same reading the web makes.
    /// Only read while app_config recollect_enabled is on; off, the row
    /// is not shown and the preference is never asked for.
    var recollectEnabled = true
    var shareLinks: [ShareLinkRow] = []
    var loaded = false

    private struct RecollectPref: Decodable { let enabled: Bool }

    private static func readRecollectPreference(_ available: Bool) async -> [RecollectPref]? {
        guard available else { return nil }
        return try? await supa
            .from("recollect_preferences")
            .select("enabled")
            .execute().value
    }

    private struct ConsentRow: Decodable {
        let ai_features_enabled: Bool?
        let upload_confirmed_at: String?
    }

    /// The account's own profile row. Filtered by user_id on purpose:
    /// an accepted coach can read their students' rows too.
    private static func readConsent(_ userId: UUID?) async -> [ConsentRow]? {
        guard let userId else { return nil }
        return try? await supa
            .from("player_profiles")
            .select("ai_features_enabled,upload_confirmed_at")
            .eq("user_id", value: userId.uuidString.lowercased())
            .execute().value
    }

    func load(userId: UUID?, recollectAvailable: Bool = false) async {
        struct ConfigRow: Decodable {
            let key: String
            let value: String?
        }
        async let configQ: [ConfigRow]? = try? supa
            .from("app_config")
            .select("key,value")
            .in("key", values: ["commerce_enabled", "purchases_enabled", "support_email"])
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

        async let recollectQ: [RecollectPref]? = Self.readRecollectPreference(recollectAvailable)
        async let consentQ: [ConsentRow]? = Self.readConsent(userId)

        let (config, s, p, links, recollect, consent) = await (configQ, storageQ, processingQ, linksQ, recollectQ, consentQ)
        for row in config ?? [] {
            if row.key == "purchases_enabled" { purchasesEnabled = row.value == "true" }
            if row.key == "commerce_enabled" {
                commerceEnabled = row.value == "true"
            }
            if row.key == "support_email", let v = row.value, !v.isEmpty {
                supportEmail = v.replacingOccurrences(of: "\"", with: "")
            }
        }
        storage = s?.first
        processing = p?.first
        shareLinks = links ?? []
        recollectEnabled = recollect?.first?.enabled ?? true
        if let consent {
            // The same two facts RootView seeds at sign-in, refreshed
            // whenever Account opens, so the switch shows what the row says.
            AiConsent.shared.seed(enabled: consent.first?.ai_features_enabled)
            UploadConsent.shared.seed(confirmedAt: consent.first?.upload_confirmed_at, loaded: true)
        }
        loaded = true
    }

    /// Flips the Recollect setting through the settings route. The change
    /// has to travel that way: the underlying RPC is service-role only,
    /// and turning it off also clears the queue and every sorted topic —
    /// a direct preferences write would leave all of that behind.
    func setRecollect(_ enabled: Bool) async -> Bool {
        struct Req: Encodable { let enabled: Bool }
        struct Res: Decodable { let enabled: Bool? }
        let previous = recollectEnabled
        recollectEnabled = enabled
        do {
            let res: Res = try await API.post("api/recollect/settings", Req(enabled: enabled))
            recollectEnabled = res.enabled ?? enabled
            NotificationCenter.default.post(
                name: .plRecollectChanged, object: nil,
                userInfo: ["enabled": recollectEnabled]
            )
            return true
        } catch {
            recollectEnabled = previous
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

    /// What a tap opens (BellDestination): a feedback update its private
    /// report; admin review its web page; the match its id or its
    /// `/match/<id>` link names, at the point a note was left on
    /// (`?p=<point id>`, migration 031, as the web's bell opens it); the
    /// upload screen for `/upload`; else a page the root maps itself.
    var destination: BellDestination { BellDestination(kind: kind, matchId: matchId, href: href) }

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

    /// The kinds this app can actually show and open. The table also
    /// carries marketplace kinds (order_*, review_delivered, sample_*, …)
    /// for people using paid coaching on the web — those land in the bell
    /// there, where tapping them goes somewhere. Here they would be a row
    /// that does nothing, so they only come through with the marketplace.
    static var supportedKinds: [String] {
        var list = [
            "note", "match_ready", "match_failed", "upload_failed",
            "allowance_request", "allowance_decided",
            "match_issue_reported", "match_issue_updated", "match_reprocess_ready", "match_reprocess_failed",
            "reel_ready", "reel_failed", "coach_joined",
            // Coach workspace (156): an entry shared with you, a student
            // joining, a student's match turning ready, and — the other
            // direction — a student sharing a lesson they recorded.
            "coach_entry", "student_joined", "student_match_ready",
            "student_lesson",
        ]
        if AppConfig.coachMarketplace {
            list += [
                "order_paid", "order_submitted", "order_accepted",
                "order_declined", "clarification_requested",
                "review_delivered", "followup_received", "order_completed",
                "order_refunded", "sample_requested", "sample_responded",
                "testimonial_left", "clarification_answered",
                "sponsored_claimed",
            ]
        }
        return list
    }

    func load() async {
        let fetched: [NotificationRow]? = try? await supa
            .from("notifications")
            .select("id,kind,match_id,title,body,href,group_count,read_at,created_at")
            .in("kind", values: Self.supportedKinds)
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

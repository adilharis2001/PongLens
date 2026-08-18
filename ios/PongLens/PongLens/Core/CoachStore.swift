import Foundation
import Supabase

/// The coach side of the Coaching tab: profile, queue, stats, and the
/// storefront numbers. Mirrors what src/app/coaching/page.tsx assembles
/// server-side for CoachHub, loaded here with the same queries.
@Observable
final class CoachStore {
    var profile: CoachProfileRow?
    var queue: [CoachQueueItem] = []
    var stats = CoachReviewStats(activeCount: 0, completedCount: 0, earnedCents: 0)
    var offeringCount = 0
    /// nil means commerce is off — the Sponsored row hides entirely.
    var sponsoredLeft: Int?
    var pageOpens7d = 0
    var loaded = false

    func load(userId: UUID?) async {
        guard let userId else { return }
        let uid = userId.uuidString.lowercased()

        async let profileQ: CoachProfileRow? = try? await supa
            .from("coach_profiles")
            .select(CoachProfileRow.fullSelect)
            .eq("user_id", value: uid)
            .single()
            .execute()
            .value
        let profileRow = await profileQ
        profile = profileRow

        if profileRow != nil {
            async let queueQ: [CoachQueueItem]? = try? await supa
                .rpc("coach_queue").execute().value
            async let statsQ: CoachReviewStats? = try? await supa
                .rpc("coach_review_stats").execute().value
            async let offeringsQ = try? await supa
                .from("offerings").select("id", head: true, count: .exact)
                .eq("coach_id", value: uid).execute()
            async let viewsQ = try? await supa
                .from("coach_page_views").select("id", head: true, count: .exact)
                .gte("viewed_at", value: Self.iso(daysAgo: 7)).execute()
            let (q, s, o, v) = await (queueQ, statsQ, offeringsQ, viewsQ)
            queue = q ?? []
            if let s { stats = s }
            offeringCount = o?.count ?? 0
            pageOpens7d = v?.count ?? 0
            await loadSponsoredBalance()
        }
        loaded = true
    }

    /// Σ ledger credits, plus the free allowance until a grant row exists.
    /// Stays nil while commerce is off, which hides the Sponsored row.
    func loadSponsoredBalance() async {
        struct ConfigRow: Decodable { let value: String }
        struct LedgerRow: Decodable {
            let credits: Int
            let kind: String
        }
        async let commerceQ: ConfigRow? = try? await supa
            .from("app_config").select("value")
            .eq("key", value: "commerce_enabled").single().execute().value
        async let ledgerQ: [LedgerRow]? = try? await supa
            .from("sponsored_credit_ledger").select("credits, kind").execute().value
        async let freeQ: ConfigRow? = try? await supa
            .from("app_config").select("value")
            .eq("key", value: "sponsored_free_credits").single().execute().value
        let (commerce, ledger, freeRow) = await (commerceQ, ledgerQ, freeQ)
        guard commerce?.value == "true" else {
            sponsoredLeft = nil
            return
        }
        let rows = ledger ?? []
        let sum = rows.reduce(0) { $0 + $1.credits }
        let hasGrant = rows.contains { $0.kind == "grant" }
        let free = Int(freeRow?.value ?? "3") ?? 3
        sponsoredLeft = sum + (hasGrant ? 0 : max(free, 0))
    }

    // MARK: - Derived

    /// Setup mode: nothing sold yet and the storefront is not fully open —
    /// the hub shows only the checklist. Mirrors CoachHub.setupMode.
    var setupMode: Bool {
        guard let profile else { return false }
        let payoutsReady = profile.chargesEnabled && profile.payoutsEnabled
        return queue.isEmpty && stats.completedCount == 0
            && !(offeringCount > 0 && payoutsReady && profile.published)
    }

    /// New orders, then promised-within-24h work, capped at five.
    var needsYou: [CoachQueueItem] {
        let newOrders = queue.filter { $0.status == .submitted }
        let dueSoon = queue.filter { item in
            guard item.status == .inReview || item.status == .clarification,
                  let promised = item.promisedBy, let date = PGDate.parse(promised)
            else { return false }
            return date.timeIntervalSinceNow < 24 * 3600
        }
        return Array((newOrders + dueSoon).prefix(5))
    }

    var activeCount: Int {
        queue.filter {
            [.awaitingSubmission, .submitted, .inReview, .clarification, .delivered]
                .contains($0.status)
        }.count
    }

    // MARK: - Writes

    /// Fire-and-forget, like the web: both columns plus updated_at, every
    /// time either control changes.
    func saveAvailability(accepting: Bool, maxActive: Int?) async {
        guard let profile else { return }
        self.profile?.acceptingOrders = accepting
        self.profile?.maxActiveOrders = maxActive
        let fields: [String: AnyJSON] = [
            "accepting_orders": .bool(accepting),
            "max_active_orders": maxActive.map { AnyJSON.integer($0) } ?? .null,
            "updated_at": .string(Self.isoNow()),
        ]
        _ = try? await supa.from("coach_profiles").update(fields)
            .eq("user_id", value: profile.userId.uuidString.lowercased()).execute()
    }

    /// Saved on change, not behind a Save button — the coach is about to
    /// leave for Stripe, and an unsaved select is what would be lost.
    func savePayoutCountry(_ code: String) async -> Bool {
        guard let profile else { return false }
        do {
            try await supa.from("coach_profiles")
                .update(["payout_country": AnyJSON.string(code)])
                .eq("user_id", value: profile.userId.uuidString.lowercased())
                .execute()
            self.profile?.payoutCountry = code
            return true
        } catch {
            return false
        }
    }

    // MARK: - Stripe Connect (api/reviews/connect)

    struct ConnectLink: Decodable { let url: String? }

    /// Onboarding link; the caller opens it in the browser. Throws
    /// APIError.http with a stable code (country_required, …) on refusal.
    func connectLink() async throws -> URL? {
        struct Req: Encodable { let action = "link" }
        let res: ConnectLink = try await API.post("api/reviews/connect", Req())
        return res.url.flatMap(URL.init)
    }

    func stripeDashboardLink() async -> URL? {
        struct Req: Encodable { let action = "dashboard" }
        let res: ConnectLink? = try? await API.post("api/reviews/connect", Req())
        return res?.url.flatMap(URL.init)
    }

    /// Re-reads charges/payouts from Stripe (the route mirrors them onto
    /// the profile), then reloads the row so the hub reflects it.
    func syncConnectStatus(userId: UUID?) async {
        struct Req: Encodable { let action = "sync" }
        struct Res: Decodable {
            let charges_enabled: Bool
            let payouts_enabled: Bool
        }
        let _: Res? = try? await API.post("api/reviews/connect", Req())
        await load(userId: userId)
    }

    /// The daily order sweep the web fires on hub mount.
    func sweep() async {
        struct Req: Encodable { let action = "sweep" }
        struct Res: Decodable { let ok: Bool? }
        let _: Res? = try? await API.post("api/reviews/transition", Req())
    }

    // MARK: -

    private static func isoNow() -> String {
        ISO8601DateFormatter().string(from: Date())
    }

    private static func iso(daysAgo: Int) -> String {
        ISO8601DateFormatter().string(from: Date().addingTimeInterval(-Double(daysAgo) * 86_400))
    }
}

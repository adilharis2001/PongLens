import Foundation
import StoreKit
import Supabase

/// A pack the phone can buy, named by the same key the web uses.
///
/// The key is the join: `m60` is a row in app_config's minute_packs, a
/// product in App Store Connect, and a pack_key on platform_purchases.
/// One name end to end, so a purchase made here credits exactly what a
/// purchase made in a browser credits.
struct BuyablePack: Identifiable, Hashable {
    let key: String
    /// platform_purchases.kind — "minute_pack" or "storage".
    let kind: String
    /// What you get: "60 minutes", "100 GB for a year".
    let label: String

    var id: String { key }
    var productId: String { "com.ponglens.PongLens.\(key)" }
}

/// Buying minutes and storage through Apple.
///
/// The shape of this is dictated by one rule: **a transaction is finished
/// only after our server has granted the balance.** Finishing tells Apple
/// the goods were delivered and it stops re-presenting the transaction —
/// so finishing first and failing to credit afterwards means the customer
/// paid and got nothing, with nothing left to retry from. Every path here
/// either grants and finishes, or leaves the transaction alone for
/// StoreKit to hand back on the next launch.
@Observable
final class PurchaseStore {
    /// app_config.iap_enabled. Off means the buy rows are not drawn at
    /// all, which is how this ships until a real device has bought
    /// something.
    var enabled = false
    var minutePacks: [BuyablePack] = []
    var storagePacks: [BuyablePack] = []
    /// Apple's product objects, keyed by product id. The PRICE shown to
    /// the user comes from here and never from our own config: Apple
    /// charges its own price points, localised and tax-inclusive, and a
    /// screen promising $5.00 while the sheet says $4.99 is a bug.
    var products: [String: Product] = [:]
    /// The pack key with a purchase in flight, for the row's spinner.
    var busyKey: String?
    var errorMessage: String?
    var loaded = false

    /// Called after a grant lands so the balance on screen catches up.
    var onGranted: (() async -> Void)?

    private var updates: Task<Void, Never>?

    // MARK: - Loading

    func load() async {
        struct ConfigRow: Decodable {
            let key: String
            let value: String?
        }
        let config: [ConfigRow]? = try? await supa
            .from("app_config")
            .select("key,value")
            .in("key", values: ["iap_enabled", "purchases_enabled", "commerce_enabled", "minute_packs", "storage_packs"])
            .execute().value

        var on = false
        var purchasesOn = false
        var commerceOn = false
        var minutes: [BuyablePack] = []
        var storage: [BuyablePack] = []
        for row in config ?? [] {
            switch row.key {
            case "purchases_enabled":
                purchasesOn = row.value == "true"
            case "commerce_enabled":
                commerceOn = row.value == "true"
            case "iap_enabled":
                on = (row.value ?? "").trimmingCharacters(in: .whitespaces) == "on"
            case "minute_packs":
                minutes = Self.parse(row.value, kind: "minute_pack")
            case "storage_packs":
                storage = Self.parse(row.value, kind: "storage")
            default: break
            }
        }
        on = on && purchasesOn && commerceOn
        enabled = on
        if !on { products = [:] }
        minutePacks = minutes
        storagePacks = storage

        if on {
            await loadProducts()
        }
        loaded = true
    }

    /// app_config stores packs as a JSON array. Minutes carry `minutes`,
    /// storage carries `gb` — the label is built here rather than stored,
    /// so adding a pack server-side needs no app release.
    private static func parse(_ raw: String?, kind: String) -> [BuyablePack] {
        guard let data = raw?.data(using: .utf8),
              let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { return [] }
        return rows.compactMap { row in
            guard let key = row["key"] as? String else { return nil }
            let label: String
            if let m = row["minutes"] as? Int {
                label = "\(m) minutes"
            } else if let gb = row["gb"] as? Int {
                let months = row["months"] as? Int ?? 12
                label = months == 12
                    ? "\(gb) GB for a year"
                    : "\(gb) GB for \(months) months"
            } else {
                return nil
            }
            return BuyablePack(key: key, kind: kind, label: label)
        }
    }

    private func loadProducts() async {
        let ids = (minutePacks + storagePacks).map(\.productId)
        guard !ids.isEmpty else { return }
        guard let fetched = try? await Product.products(for: ids) else {
            // No products means the store could not be reached, or they
            // are not approved yet. The rows stay hidden rather than
            // offering a button that cannot work.
            return
        }
        products = Dictionary(uniqueKeysWithValues: fetched.map { ($0.id, $0) })
    }

    // MARK: - Buying

    func buy(_ pack: BuyablePack) async {
        guard enabled, busyKey == nil, let product = products[pack.productId] else { return }
        busyKey = pack.key
        errorMessage = nil
        defer { busyKey = nil }

        // The server prices and records what is being bought BEFORE Apple
        // takes any money, and hands back the row's id. That id travels
        // through Apple as appAccountToken and comes back inside Apple's
        // signature, which is how the receipt is tied to this pack.
        guard let purchaseId = await startPurchase(pack),
              let token = UUID(uuidString: purchaseId)
        else {
            errorMessage = "Couldn't start the purchase. Try again."
            return
        }

        do {
            let result = try await product.purchase(options: [.appAccountToken(token)])
            switch result {
            case .success(let verification):
                await redeem(verification)
            case .userCancelled:
                break
            case .pending:
                // Ask to Buy, or a payment needing approval. It may be
                // approved hours later, and it arrives through
                // Transaction.updates when it is — nothing to do here but
                // say so.
                errorMessage = "This purchase needs approval. It will be added once approved."
            @unknown default:
                break
            }
        } catch {
            errorMessage = "The purchase didn't go through. Try again."
        }
    }

    private func startPurchase(_ pack: BuyablePack) async -> String? {
        struct Req: Encodable {
            let action = "start"
            let kind: String
            let packKey: String
        }
        struct Res: Decodable { let purchaseId: String }
        let res: Res? = try? await API.post(
            "api/billing/iap", Req(kind: pack.kind, packKey: pack.key)
        )
        return res?.purchaseId
    }

    /// Hand Apple's signed transaction to our server, and finish it only
    /// if the server says the balance is granted.
    private func redeem(_ verification: VerificationResult<Transaction>) async {
        // StoreKit checks the signature on device too, but that check is
        // not what we rely on — a modified app could skip it. It is the
        // untouched `jwsRepresentation` that the server re-verifies
        // against Apple's root certificate. This guard exists to get at
        // the transaction object for finish().
        guard case .verified(let transaction) = verification else {
            errorMessage = "That purchase couldn't be verified."
            return
        }

        struct Req: Encodable {
            let action = "verify"
            let signedTransaction: String
        }
        struct Res: Decodable { let granted: Bool }
        let res: Res? = try? await API.post(
            "api/billing/iap",
            Req(signedTransaction: verification.jwsRepresentation)
        )

        guard res != nil else {
            // The money is taken and we could not record it. Leaving the
            // transaction unfinished is the whole safety net: StoreKit
            // re-presents it on the next launch and we try again.
            errorMessage = "Purchase received. Your balance will update shortly."
            return
        }

        await transaction.finish()
        await onGranted?()
    }

    // MARK: - Interrupted purchases

    /// Anything Apple still considers undelivered — an approved Ask to
    /// Buy, a purchase made while the app was killed, or one of ours that
    /// failed to reach the server last time. Started once at launch.
    func startListening() {
        guard updates == nil else { return }
        updates = Task { [weak self] in
            for await result in Transaction.unfinished {
                await self?.redeem(result)
            }
            for await result in Transaction.updates {
                guard !Task.isCancelled else { return }
                await self?.redeem(result)
            }
        }
    }

    func stopListening() {
        updates?.cancel()
        updates = nil
    }
}

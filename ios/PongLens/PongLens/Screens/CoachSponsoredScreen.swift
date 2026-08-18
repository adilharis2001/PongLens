import SwiftUI
import Supabase

/// Sponsored reviews: mint a single-use link for a student you already
/// coach, watch unused ones, revoke them. Buying more stays on the web,
/// like every purchase in the app.
struct CoachSponsoredScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(AppState.self) private var app
    @Environment(CoachStore.self) private var coach

    struct InviteRow: Decodable, Identifiable {
        let id: UUID
        let token: String
        let offering_id: UUID?
        let status: String
        let created_at: String
    }

    struct Pack: Identifiable {
        let id: String
        let credits: Int
        let priceCents: Int
    }

    @State private var offerings: [OfferingRow] = []
    @State private var invites: [InviteRow] = []
    @State private var packs: [Pack] = []
    @State private var selectedOffering: UUID?
    @State private var mintedURL: URL?
    @State private var busy = false
    @State private var copiedToken: String?
    @State private var errorMessage: String?

    var body: some View {
        ZStack {
            ArenaBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Button { dismiss() } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 12, weight: .semibold))
                            Text("Coaching")
                        }
                    }
                    .buttonStyle(PLSecondaryButtonStyle())

                    Text("Sponsored reviews")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)

                    Text("For students you already coach. They use your link, send a match, and pay nothing.")
                        .font(.plBody)
                        .foregroundStyle(PL.text400)

                    mintCard

                    if !packs.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionHeading("Get more")
                            HStack(spacing: 10) {
                                ForEach(packs) { pack in
                                    packTile(pack)
                                }
                            }
                            Text("Packs are bought at ponglens.com. The balance lands here.")
                                .font(.plCaption)
                                .foregroundStyle(PL.text600)
                        }
                    }
                }
                .padding(20)
                .padding(.bottom, 60)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { await load() }
    }

    private var mintCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let left = coach.sponsoredLeft {
                Text(
                    left == 1
                        ? "You have 1 sponsored review."
                        : "You have \(left) sponsored reviews."
                )
                .font(.plRowTitle)
                .foregroundStyle(PL.text100)
            } else {
                Text("Reading your balance…")
                    .font(.plBody)
                    .foregroundStyle(PL.text500)
            }

            let active = offerings.filter(\.active)
            if !active.isEmpty && (coach.sponsoredLeft ?? 0) > 0 {
                Text("Pick the offering, create the link, send it to your student.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
                FlowLayout(spacing: 8) {
                    ForEach(active) { offering in
                        let on = selectedOffering == offering.id
                        Button(offering.title) {
                            selectedOffering = on ? nil : offering.id
                        }
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(on ? PL.cyan : PL.text300)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(on ? PL.cyan.opacity(0.15) : .clear, in: Capsule())
                        .overlay(
                            Capsule().strokeBorder(
                                on ? PL.cyan.opacity(0.6) : PL.edge, lineWidth: 1
                            )
                        )
                        .buttonStyle(.plain)
                    }
                }
                Button("Create the link") {
                    Task { await mint() }
                }
                .buttonStyle(PLPrimaryButtonStyle())
                .disabled(selectedOffering == nil || busy)
            }

            if let mintedURL {
                Text(mintedURL.absoluteString)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(PL.text300)
                    .lineLimit(2)
                    .plInnerRow()
                ShareLink(item: mintedURL) {
                    Text("Share the link")
                        .font(.plButton)
                        .foregroundStyle(PL.ink)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(PL.cyan, in: Capsule())
                }
            }

            if let errorMessage {
                Text(errorMessage).font(.plCaption).foregroundStyle(PL.warningText)
            }

            if !invites.isEmpty {
                Rectangle().fill(PL.edge.opacity(0.5)).frame(height: 1)
                ForEach(invites) { invite in
                    HStack(spacing: 10) {
                        Text("\(offeringTitle(invite.offering_id)) · waiting to be used")
                            .font(.plCaption)
                            .foregroundStyle(PL.text400)
                            .lineLimit(1)
                        Spacer()
                        Button(copiedToken == invite.token ? "Copied" : "Copy link") {
                            UIPasteboard.general.string =
                                "https://www.ponglens.com/review-invite/\(invite.token)"
                            copiedToken = invite.token
                            Task {
                                try? await Task.sleep(for: .seconds(1.5))
                                copiedToken = nil
                            }
                        }
                        .buttonStyle(PLSecondaryButtonStyle())
                        Button("Revoke") {
                            Task { await revoke(invite) }
                        }
                        .buttonStyle(PLSoftDestructiveButtonStyle())
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 18)
    }

    private func packTile(_ pack: Pack) -> some View {
        Button {
            openURL(AppConfig.apiBase.appendingPathComponent("coaching/sponsored"))
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text(String(pack.credits))
                    .font(.system(size: 24, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(PL.text100)
                Text(pack.credits == 1 ? "review" : "reviews")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                Text(formatUsd(pack.priceCents))
                    .font(.plRowTitle)
                    .foregroundStyle(PL.text200)
                Text("\(formatUsd(Int((Double(pack.priceCents) / Double(pack.credits)).rounded()))) a review")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .plCard(padding: 16)
        }
        .buttonStyle(.plain)
    }

    private func offeringTitle(_ id: UUID?) -> String {
        id.flatMap { offeringId in
            offerings.first(where: { $0.id == offeringId })?.title
        } ?? "Offering"
    }

    // MARK: - Data

    private func load() async {
        guard let uid = app.userId?.uuidString.lowercased() else { return }
        async let offeringsQ: [OfferingRow]? = try? await supa
            .from("offerings").select(OfferingRow.fullSelect)
            .eq("coach_id", value: uid)
            .order("sort", ascending: true)
            .order("created_at", ascending: true)
            .execute().value
        async let invitesQ: [InviteRow]? = try? await supa
            .from("sponsored_invites")
            .select("id, token, offering_id, status, created_at")
            .eq("status", value: "pending")
            .order("created_at", ascending: false)
            .limit(10)
            .execute().value
        struct ConfigRow: Decodable { let value: String }
        async let packsQ: ConfigRow? = try? await supa
            .from("app_config").select("value")
            .eq("key", value: "sponsored_packs").single().execute().value
        let (o, i, packsRow) = await (offeringsQ, invitesQ, packsQ)
        offerings = o ?? []
        invites = i ?? []
        packs = Self.parsePacks(packsRow?.value)
        await coach.loadSponsoredBalance()
    }

    /// app_config sponsored_packs JSON, with the web's defaults.
    private static func parsePacks(_ json: String?) -> [Pack] {
        struct Raw: Decodable {
            let key: String
            let credits: Int
            let price_cents: Int
        }
        if let json, let data = json.data(using: .utf8),
           let raw = try? JSONDecoder().decode([Raw].self, from: data), !raw.isEmpty {
            return raw.map { Pack(id: $0.key, credits: $0.credits, priceCents: $0.price_cents) }
        }
        return [
            Pack(id: "sp5", credits: 5, priceCents: 2000),
            Pack(id: "sp15", credits: 15, priceCents: 5000),
        ]
    }

    private func mint() async {
        guard let offeringId = selectedOffering else { return }
        busy = true
        errorMessage = nil
        mintedURL = nil
        struct Params: Encodable { let p_offering_id: String }
        struct Res: Decodable {
            let invite_id: UUID
            let token: String
        }
        do {
            let res: Res = try await supa.rpc(
                "mint_sponsored_invite",
                params: Params(p_offering_id: offeringId.uuidString.lowercased())
            ).execute().value
            mintedURL = URL(string: "https://www.ponglens.com/review-invite/\(res.token)")
            await load()
        } catch {
            errorMessage = String(describing: error).contains("no_sponsored_credits")
                ? "No sponsored reviews left. Get a pack below."
                : "Could not create the link. Try again."
        }
        busy = false
    }

    private func revoke(_ invite: InviteRow) async {
        struct Update: Encodable {
            let status: String
            let revoked_at: String
        }
        _ = try? await supa.from("sponsored_invites")
            .update(Update(
                status: "revoked",
                revoked_at: ISO8601DateFormatter().string(from: Date())
            ))
            .eq("id", value: invite.id.uuidString.lowercased())
            .execute()
        await load()
    }
}

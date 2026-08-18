import SwiftUI
import Supabase

/// The coach view of the Coaching tab, mirroring CoachHub.tsx at phone
/// width: setup checklist until the storefront is open, then the queue,
/// the money strip, the section rows, payouts and availability.
struct CoachHubView: View {
    @Environment(AppState.self) private var app
    @Environment(CoachStore.self) private var coach
    @Environment(\.openURL) private var openURL

    @State private var copied = false
    @State private var showQr = false
    @State private var connectBusy = false
    @State private var connectNote: String?

    private var pageURL: URL? {
        guard let handle = coach.profile?.handle else { return nil }
        return AppConfig.apiBase.appendingPathComponent("coach/\(handle)")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            if !coach.setupMode {
                actionPills
                if showQr, let pageURL {
                    VStack(spacing: 12) {
                        QRCodeView(url: pageURL)
                        Text("Scan to open your page. Put it up at the club.")
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                    }
                    .frame(maxWidth: .infinity)
                    .plCard(padding: 24)
                }
            }

            if coach.setupMode {
                CoachSetupChecklist(
                    connectBusy: $connectBusy,
                    connectNote: $connectNote,
                    connect: { await connect() }
                )
            } else {
                if !coach.needsYou.isEmpty {
                    orderGroup("Needs you", orders: coach.needsYou)
                }
                if coach.stats.completedCount > 0 {
                    moneyStrip
                }
                sectionRows
                payoutsSection
                availabilitySection
            }
        }
    }

    // MARK: - Action pills

    private var actionPills: some View {
        HStack(spacing: 10) {
            if let pageURL {
                actionPill("View page", icon: "eye", active: false) {
                    openURL(pageURL)
                }
                actionPill(copied ? "Copied" : "Copy link", icon: "doc.on.doc", active: copied) {
                    UIPasteboard.general.string = pageURL.absoluteString
                    copied = true
                    Task {
                        try? await Task.sleep(for: .seconds(1.6))
                        copied = false
                    }
                }
                actionPill("QR", icon: "qrcode", active: showQr) {
                    showQr.toggle()
                }
            }
        }
    }

    private func actionPill(
        _ label: String, icon: String, active: Bool, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 12, weight: .medium))
                Text(label).font(.system(size: 12, weight: .medium))
            }
            .foregroundStyle(active ? PL.cyan : PL.text300)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(PL.surface, in: Capsule())
            .overlay(
                Capsule().strokeBorder(
                    active ? PL.cyan.opacity(0.6) : PL.edge, lineWidth: 1
                )
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Queue group

    private func orderGroup(_ label: String, orders: [CoachQueueItem]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading(label)
            VStack(spacing: 0) {
                ForEach(Array(orders.enumerated()), id: \.element.id) { i, order in
                    NavigationLink(value: CoachOrderRoute(id: order.id)) {
                        CoachOrderRowView(order: order)
                    }
                    .buttonStyle(.plain)
                    if i < orders.count - 1 {
                        Rectangle().fill(PL.edge.opacity(0.5)).frame(height: 1)
                            .padding(.leading, 16)
                    }
                }
            }
            .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            )
        }
    }

    // MARK: - Money strip

    private var moneyStrip: some View {
        HStack(spacing: 0) {
            moneyCell(formatUsd(coach.stats.earnedCents), "earned")
            moneyCell(String(coach.stats.completedCount), "completed")
            moneyCell(String(coach.activeCount), "active")
        }
        .frame(maxWidth: .infinity)
        .plCard(padding: 16)
    }

    private func moneyCell(_ value: String, _ caption: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.system(size: 18, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(PL.text100)
            Text(caption).font(.plCaption).foregroundStyle(PL.text500)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Section rows

    private var sectionRows: some View {
        VStack(spacing: 0) {
            hubRow(
                "Orders", sub: "Reviews players have bought from you.",
                detail: coach.activeCount > 0 ? "\(coach.activeCount) active" : nil,
                route: "coach-orders"
            )
            divider
            hubRow(
                "Offerings", sub: "What you sell and the price you set.",
                detail: String(coach.offeringCount), route: "coach-offerings"
            )
            if let left = coach.sponsoredLeft {
                divider
                hubRow(
                    "Sponsored reviews",
                    sub: "Cover a review for a student. They pay nothing.",
                    detail: "\(left) left", route: "coach-sponsored"
                )
            }
            divider
            hubRow(
                "Your page", sub: "Your public page, where players find and buy.",
                detail: pageOpensDetail, route: "coach-profile"
            )
        }
        .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                .strokeBorder(PL.edge, lineWidth: 1)
        )
    }

    private var pageOpensDetail: String {
        guard coach.profile?.published == true else { return "Hidden" }
        let n = coach.pageOpens7d
        return n == 1 ? "1 open this week" : "\(n) opens this week"
    }

    private var divider: some View {
        Rectangle().fill(PL.edge.opacity(0.5)).frame(height: 1).padding(.leading, 16)
    }

    private func hubRow(
        _ label: String, sub: String, detail: String?, route: String
    ) -> some View {
        NavigationLink(value: route) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(label).font(.plRowTitle).foregroundStyle(PL.text200)
                    Text(sub).font(.plCaption).foregroundStyle(PL.text500)
                }
                Spacer()
                if let detail {
                    Text(detail)
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                        .multilineTextAlignment(.trailing)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PL.text600)
            }
            .padding(16)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Payouts

    private var payoutsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading("Payouts")
            if coach.profile?.stripeAccountId == nil {
                countryCard
            }
            payoutStatusCard
            if let connectNote {
                Text(connectNote).font(.plCaption).foregroundStyle(PL.warningText)
            }
        }
    }

    /// Where the money lands. Stripe fixes an account's country at
    /// creation, so this select disappears once the account exists.
    private var countryCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Where are you paid?")
                .font(.plRowTitle)
                .foregroundStyle(PL.text200)
            Text("Stripe cannot change this later, so it has to be the country of the bank account you want the money in.")
                .font(.plCaption)
                .foregroundStyle(PL.text500)
            CountryMenu(
                selected: coach.profile?.payoutCountry ?? "",
                onPick: { code in
                    Task {
                        if await coach.savePayoutCountry(code) == false {
                            connectNote = "Could not save that country. Try again."
                        }
                    }
                }
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 18)
    }

    private var payoutStatusCard: some View {
        let profile = coach.profile
        let hasAccount = profile?.stripeAccountId != nil
        let ready = (profile?.chargesEnabled ?? false) && (profile?.payoutsEnabled ?? false)
        let (title, subtitle) = if !hasAccount {
            ("Not set up", "Connect Stripe to sell reviews.")
        } else if ready {
            ("Ready", "Stripe pays your bank when an order completes.")
        } else {
            ("Onboarding not finished", "Stripe needs a few more details from you.")
        }
        return HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.plCardTitle).foregroundStyle(PL.text100)
                Text(subtitle).font(.plCaption).foregroundStyle(PL.text400)
            }
            Spacer()
            if hasAccount && ready {
                Button(connectBusy ? "Opening" : "Open Stripe") {
                    Task { await openDashboard() }
                }
                .buttonStyle(PLSecondaryButtonStyle())
                .disabled(connectBusy)
            } else {
                Button(
                    connectBusy
                        ? "Opening Stripe"
                        : hasAccount ? "Finish setup" : "Set up payouts"
                ) {
                    Task { await connect() }
                }
                .buttonStyle(PLPrimaryButtonStyle())
                .disabled(connectBusy)
            }
        }
        .plCard(padding: 18)
    }

    private func connect() async {
        connectBusy = true
        connectNote = nil
        do {
            if let url = try await coach.connectLink() { openURL(url) }
        } catch let APIError.http(_, code) where code == "country_required" {
            connectNote = "Choose where you are paid first."
        } catch {
            connectNote = "Stripe didn't answer. Try again in a moment."
        }
        connectBusy = false
    }

    private func openDashboard() async {
        connectBusy = true
        if let url = await coach.stripeDashboardLink() { openURL(url) }
        connectBusy = false
    }

    // MARK: - Availability

    private var availabilitySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading("Availability")
            VStack(spacing: 0) {
                HStack {
                    Text("Taking new orders")
                        .font(.plRowTitle)
                        .foregroundStyle(PL.text200)
                    Spacer()
                    Toggle("", isOn: Binding(
                        get: { coach.profile?.acceptingOrders ?? true },
                        set: { next in
                            Task {
                                await coach.saveAvailability(
                                    accepting: next,
                                    maxActive: coach.profile?.maxActiveOrders
                                )
                            }
                        }
                    ))
                    .labelsHidden()
                    .tint(PL.cyan)
                }
                .padding(16)
                divider
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Most orders at once")
                            .font(.plRowTitle)
                            .foregroundStyle(PL.text200)
                        Text("New purchases pause at the limit.")
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                    }
                    Spacer()
                    Menu {
                        Button("No limit") { setMaxActive(nil) }
                        ForEach([1, 2, 3, 5, 10, 20], id: \.self) { n in
                            Button(String(n)) { setMaxActive(n) }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Text(coach.profile?.maxActiveOrders.map(String.init) ?? "No limit")
                                .font(.plBody)
                                .foregroundStyle(PL.text100)
                            Image(systemName: "chevron.up.chevron.down")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(PL.text400)
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                        .background(PL.surface2, in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                                .strokeBorder(PL.edge, lineWidth: 1)
                        )
                    }
                }
                .padding(16)
            }
            .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            )
        }
    }

    private func setMaxActive(_ n: Int?) {
        Task {
            await coach.saveAvailability(
                accepting: coach.profile?.acceptingOrders ?? true, maxActive: n
            )
        }
    }
}

// MARK: - Queue row (shared with the Orders screen)

struct CoachOrderRowView: View {
    let order: CoachQueueItem

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                (Text(order.studentName).foregroundStyle(PL.text200)
                    + Text(" · \(order.offeringTitle)").foregroundStyle(PL.text500))
                    .font(.plRowTitle)
                    .lineLimit(1)
                statusLine
            }
            Spacer()
            Text(formatUsd(order.coachShareCents))
                .font(.plBody)
                .monospacedDigit()
                .foregroundStyle(PL.text300)
        }
        .padding(16)
        .contentShape(Rectangle())
    }

    private var statusLine: some View {
        var parts: [Text] = [
            Text(coachOrderStatusLabel(order.status)).foregroundStyle(PL.text500)
        ]
        if order.status == .inReview || order.status == .clarification,
           let promise = promiseLabel(order.promisedBy) {
            parts.append(Text(" · ").foregroundStyle(PL.text500))
            parts.append(
                Text(promise.text)
                    .foregroundStyle(promise.overdue ? PL.warningText : PL.text500)
            )
        }
        if order.status == .delivered || order.status == .completed,
           order.reviewViewedAt != nil {
            parts.append(Text(" · ").foregroundStyle(PL.text500))
            parts.append(Text("watched").foregroundStyle(PL.cyan))
        }
        return parts.reduce(Text(""), +).font(.plCaption)
    }
}

/// Push route for one order; MainTabView resolves it.
struct CoachOrderRoute: Hashable {
    let id: UUID
}

// MARK: - Setup checklist

/// "Before your first order" — the whole hub until the storefront is open.
private struct CoachSetupChecklist: View {
    @Environment(CoachStore.self) private var coach
    @Binding var connectBusy: Bool
    @Binding var connectNote: String?
    let connect: () async -> Void

    var body: some View {
        let profile = coach.profile
        let payoutsStarted = profile?.stripeAccountId != nil
        let payoutsReady = (profile?.chargesEnabled ?? false) && (profile?.payoutsEnabled ?? false)
        let done = [coach.offeringCount > 0, payoutsReady, profile?.published == true]
            .count(where: { $0 })

        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Before your first order")
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                Spacer()
                Text("\(done) of 3")
                    .font(.plCaption)
                    .monospacedDigit()
                    .foregroundStyle(PL.text500)
            }

            checklistLink(
                done: coach.offeringCount > 0,
                label: "Create an offering",
                hint: "What you review, what it costs, and how long you take.",
                route: "coach-offerings"
            )
            checklistButton(
                done: payoutsReady,
                label: payoutsStarted && !payoutsReady
                    ? "Finish payouts setup" : "Set up payouts",
                hint: payoutsStarted && !payoutsReady
                    ? "Stripe still needs a few details before it can pay you."
                    : "Stripe confirms who you are and connects your bank account."
            )
            checklistLink(
                done: profile?.published == true,
                label: "Publish your page",
                hint: "Makes your page visible to anyone you send the link to.",
                route: "coach-profile"
            )

            if !payoutsStarted {
                Rectangle().fill(PL.edge.opacity(0.5)).frame(height: 1)
                Text("Where are you paid?")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(PL.text300)
                Text("Stripe cannot change this later, so it has to be the country of your bank account.")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                CountryMenu(
                    selected: profile?.payoutCountry ?? "",
                    onPick: { code in
                        Task {
                            if await coach.savePayoutCountry(code) == false {
                                connectNote = "Could not save that country. Try again."
                            }
                        }
                    }
                )
            }

            if let connectNote {
                Text(connectNote).font(.plCaption).foregroundStyle(PL.warningText)
            }

            Rectangle().fill(PL.edge.opacity(0.5)).frame(height: 1)
            if let handle = profile?.handle {
                Text("Your page will be at ponglens.com/coach/\(handle).")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 18)
    }

    private func checklistLink(
        done: Bool, label: String, hint: String, route: String
    ) -> some View {
        Group {
            if done {
                checklistRow(done: true, label: label, hint: hint, chevron: false)
            } else {
                NavigationLink(value: route) {
                    checklistRow(done: false, label: label, hint: hint, chevron: true)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func checklistButton(done: Bool, label: String, hint: String) -> some View {
        Group {
            if done {
                checklistRow(done: true, label: label, hint: hint, chevron: false)
            } else {
                Button {
                    Task { await connect() }
                } label: {
                    checklistRow(done: false, label: label, hint: hint, chevron: true)
                }
                .buttonStyle(.plain)
                .disabled(connectBusy)
            }
        }
    }

    private func checklistRow(
        done: Bool, label: String, hint: String, chevron: Bool
    ) -> some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle()
                    .fill(done ? PL.cyan.opacity(0.15) : .clear)
                    .frame(width: 20, height: 20)
                Circle()
                    .strokeBorder(done ? .clear : PL.edge, lineWidth: 1.5)
                    .frame(width: 20, height: 20)
                if done {
                    Image(systemName: "checkmark")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(PL.cyan)
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.plRowTitle)
                    .strikethrough(done, color: PL.text600)
                    .foregroundStyle(done ? PL.text500 : PL.text200)
                if !done {
                    Text(hint).font(.plCaption).foregroundStyle(PL.text500)
                }
            }
            Spacer()
            if chevron {
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PL.text600)
            }
        }
        .contentShape(Rectangle())
    }
}

// MARK: - Country picker

/// The payout-country select: display order from the web, not alphabetical.
private struct CountryMenu: View {
    let selected: String
    let onPick: (String) -> Void

    var body: some View {
        Menu {
            ForEach(payoutCountries, id: \.code) { country in
                Button(country.name) { onPick(country.code) }
            }
        } label: {
            HStack(spacing: 6) {
                Text(
                    payoutCountries.first(where: { $0.code == selected })?.name
                        ?? "Choose a country"
                )
                .font(.plBody)
                .foregroundStyle(selected.isEmpty ? PL.text400 : PL.text100)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(PL.text400)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(PL.surface2, in: Capsule())
            .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
        }
    }
}

// MARK: - Become a coach

/// The free-to-paid entry: a row card offering the coach page.
struct BecomeCoachCard: View {
    @Binding var startOpen: Bool

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Offer paid reviews")
                    .font(.plRowTitle)
                    .foregroundStyle(PL.text200)
                Text("Your price, your scope, your turnaround.")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
            }
            Spacer()
            Button("Set up your page") { startOpen = true }
                .buttonStyle(PLPrimaryButtonStyle())
        }
        .plCard(padding: 16)
    }
}

/// Name + handle → create_coach_page. Mirrors CoachStart.tsx, including
/// the handle rules and the taken-handle copy.
struct CoachStartSheet: View {
    @Environment(AppState.self) private var app
    @Environment(CoachingStore.self) private var coaching
    @Environment(CoachStore.self) private var coach
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var handle = ""
    @State private var busy = false
    @State private var errorMessage: String?

    private var cleanHandle: String {
        handle.lowercased().replacingOccurrences(
            of: "[^a-z0-9-]", with: "", options: .regularExpression
        )
    }

    private var handleOk: Bool {
        cleanHandle.range(
            of: "^[a-z0-9][a-z0-9-]{2,29}$", options: .regularExpression
        ) != nil
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Set up your coach page")
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)

                VStack(alignment: .leading, spacing: 6) {
                    SectionHeading("Your name")
                    TextField("How students know you", text: $name)
                        .plField()
                }

                VStack(alignment: .leading, spacing: 6) {
                    SectionHeading("Your page")
                    HStack(spacing: 0) {
                        Text("ponglens.com/coach/")
                            .font(.plBody)
                            .foregroundStyle(PL.text500)
                        TextField("your-name", text: $handle)
                            .font(.plBody)
                            .foregroundStyle(PL.text100)
                            .tint(PL.cyan)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(PL.surface2.opacity(0.4), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                            .strokeBorder(PL.edge, lineWidth: 1)
                    )
                    if !handle.isEmpty && !handleOk {
                        Text("Three to thirty characters: letters, numbers and dashes.")
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                    }
                }

                if let errorMessage {
                    Text(errorMessage).font(.plCaption).foregroundStyle(PL.warningText)
                }

                Button(busy ? "Creating" : "Create your coach page") {
                    Task { await create() }
                }
                .buttonStyle(PLPrimaryButtonStyle())
                .frame(maxWidth: .infinity)
                .disabled(!handleOk || busy)

                Spacer()
            }
            .padding(24)
        }
        .onAppear { if name.isEmpty { name = app.firstName } }
    }

    private func create() async {
        busy = true
        errorMessage = nil
        struct Params: Encodable {
            let p_handle: String
            let p_display_name: String
        }
        do {
            try await supa.rpc(
                "create_coach_page",
                params: Params(
                    p_handle: cleanHandle,
                    p_display_name: String(
                        name.trimmingCharacters(in: .whitespaces).prefix(80)
                    )
                )
            ).execute()
            await coach.load(userId: app.userId)
            await coaching.load(userId: app.userId)
            dismiss()
        } catch {
            errorMessage = String(describing: error).contains("23505")
                ? "That handle is taken. Try another."
                : "Could not create your page. Try again."
        }
        busy = false
    }
}

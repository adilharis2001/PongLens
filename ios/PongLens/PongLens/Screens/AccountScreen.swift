import SwiftUI
import Supabase

struct AccountScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(AppState.self) private var app
    @State private var store = AccountStore()
    @State private var editingName = false
    @State private var nameDraft = ""
    @State private var linksOpen = false
    @State private var profileOpen = false
    @State private var deleteOpen = false
    @State private var recollectSaving = false
    @State private var recollectError = false

    var body: some View {
        ZStack {
            ArenaBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Button {
                        dismiss()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 12, weight: .semibold))
                            Text("Back")
                        }
                    }
                    .buttonStyle(PLSecondaryButtonStyle())

                    Text("Account")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)

                    identity

                    group("Your game") {
                        linkRow("My stats", value: "stats")
                        rowDivider
                        linkRow("Tactics", value: "stats-tactics")
                        rowDivider
                        navRow("Player profile") { profileOpen = true }
                        rowDivider
                        recollectRow
                    }

                    group("Public links") {
                        HStack(spacing: 12) {
                            Image(systemName: "link")
                                .font(.system(size: 15))
                                .foregroundStyle(PL.text400)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(store.shareLinks.isEmpty
                                    ? "No active links"
                                    : "\(store.shareLinks.count) active link\(store.shareLinks.count == 1 ? "" : "s")")
                                    .font(.plRowTitle)
                                    .foregroundStyle(PL.text100)
                                let matches = Set(store.shareLinks.compactMap(\.matchId)).count
                                if matches > 0 {
                                    Text("Across \(matches) match\(matches == 1 ? "" : "es")")
                                        .font(.plCaption)
                                        .foregroundStyle(PL.text500)
                                }
                            }
                            Spacer()
                            if !store.shareLinks.isEmpty {
                                Button("Manage") { linksOpen = true }
                                    .buttonStyle(PLSecondaryButtonStyle())
                            }
                        }
                        .padding(16)
                    }

                    if store.commerceEnabled {
                        minutesSection
                        storageSection
                    }

                    group("Support") {
                        linkRow("How-to guides", value: "learn")
                        rowDivider
                        linkRow("Tutorial videos", value: "learn-videos")
                        rowDivider
                        linkRow("Feedback", value: "feedback")
                        rowDivider
                        navRow("Contact support") {
                            openURL(URL(string: "mailto:\(store.supportEmail)")!)
                        }
                        rowDivider
                        navRow("Delete account") { deleteOpen = true }
                    }

                    group("Legal") {
                        navRow("Terms of Service") {
                            openURL(URL(string: "https://www.ponglens.com/terms")!)
                        }
                        rowDivider
                        navRow("Privacy Policy") {
                            openURL(URL(string: "https://www.ponglens.com/privacy")!)
                        }
                    }

                    // The iOS-native sign-out: a red text row in its own
                    // grouped card, like Settings does it.
                    Button {
                        Task { await app.signOut() }
                    } label: {
                        Text("Sign Out")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(PL.dangerText)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                            .strokeBorder(PL.edge, lineWidth: 1)
                    )
                }
                .padding(20)
                .padding(.bottom, 60)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .plKeyboardDismiss()
        .task { await store.load(userId: app.userId) }
        .sheet(isPresented: $linksOpen) {
            ShareLinksManager(store: store)
                .presentationDetents([.medium, .large])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $deleteOpen) {
            DeleteAccountSheet()
                .presentationDetents([.medium, .large])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $profileOpen) {
            PlayerProfileSheet()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
    }

    private var identityInitial: some View {
        Text(app.initial)
            .font(.system(size: 22, weight: .semibold))
            .foregroundStyle(PL.cyan)
    }

    private var identity: some View {
        HStack(spacing: 16) {
            ZStack {
                Circle().fill(PL.surface2)
                if let url = app.avatarURL {
                    AsyncImage(url: url) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        identityInitial
                    }
                } else {
                    identityInitial
                }
            }
            .frame(width: 56, height: 56)
            .clipShape(Circle())
            .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))
            VStack(alignment: .leading, spacing: 3) {
                if editingName {
                    HStack(spacing: 8) {
                        TextField("Your name", text: $nameDraft)
                            .plField()
                        Button("Save") {
                            Task {
                                let clean = nameDraft.trimmingCharacters(in: .whitespaces)
                                guard !clean.isEmpty else { return }
                                try? await supa.auth.update(
                                    user: UserAttributes(data: ["full_name": .string(clean)])
                                )
                                editingName = false
                            }
                        }
                        .buttonStyle(PLCyanGhostButtonStyle())
                    }
                } else {
                    HStack(spacing: 8) {
                        Text(displayName)
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(PL.text100)
                        Button("Edit") {
                            nameDraft = displayName
                            editingName = true
                        }
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(PL.cyan)
                        .buttonStyle(.plain)
                    }
                    Text(app.userEmail ?? "")
                        .font(.plBody)
                        .foregroundStyle(PL.text500)
                }
            }
            Spacer()
        }
        .plCard(padding: 18)
    }

    private var displayName: String {
        guard case .signedIn(let session) = app.phase else { return "" }
        return (session.user.userMetadata["full_name"]?.stringValue
            ?? session.user.userMetadata["name"]?.stringValue
            ?? app.firstName)
    }

    private var recollectRow: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Recollect")
                    .font(.system(size: 16))
                    .foregroundStyle(PL.textBody)
                Text("Bring useful guidance from lessons and practice notes back at the right time.")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                if recollectError {
                    Text("Couldn't save that change. Try again.")
                        .font(.plCaption)
                        .foregroundStyle(PL.dangerText)
                }
            }
            Spacer()
            Toggle("", isOn: Binding(
                get: { store.recollectEnabled },
                set: { value in
                    guard !recollectSaving else { return }
                    recollectSaving = true
                    recollectError = false
                    Task {
                        recollectError = !(await store.setRecollect(value))
                        recollectSaving = false
                    }
                }
            ))
            .labelsHidden()
            .disabled(recollectSaving)
            .tint(PL.cyan.opacity(0.6))
        }
        .padding(16)
    }

    private var minutesSection: some View {
        group("Processing minutes") {
            VStack(alignment: .leading, spacing: 12) {
                if let minutes = store.processing?.minutesBalance {
                    (Text("\(Int(minutes))")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundColor(PL.text100)
                        + Text("  minutes left")
                        .font(.system(size: 14))
                        .foregroundColor(PL.text400))
                        .monospacedDigit()
                } else {
                    Text("Reading balance…")
                        .font(.plBody)
                        .foregroundStyle(PL.text500)
                }
                Text("Processing is what turns a video into a match: the dead time cut out, every point its own clip. One minute of footage uses one minute from your balance, and trimming off the warm-up first uses fewer.")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                    .lineSpacing(3)
                Text("Get more minutes at ponglens.com. Purchases stay on the web for now.")
                    .font(.plCaption)
                    .foregroundStyle(PL.text400)
            }
            .padding(16)
        }
    }

    private var storageSection: some View {
        group("Storage") {
            VStack(alignment: .leading, spacing: 8) {
                if let s = store.storage, let used = s.usedBytes, let limit = s.storageLimitBytes, limit > 0 {
                    let usedGB = Double(used) / 1_073_741_824
                    let limitGB = Double(limit) / 1_073_741_824
                    Text(String(format: "%.1f of %.0f GB used", usedGB, limitGB))
                        .font(.system(size: 16, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(PL.text100)
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(PL.surface2)
                            Capsule()
                                .fill(used >= limit ? PL.dangerFill : PL.cyan)
                                .frame(width: max(4, geo.size.width * min(1, Double(used) / Double(limit))))
                        }
                    }
                    .frame(height: 6)
                } else {
                    Text("Reading usage…")
                        .font(.plBody)
                        .foregroundStyle(PL.text500)
                }
                Text("Storage holds your match videos, so your playing history lives in one place instead of scattered across phones. Your uploads and their cut versions count toward the space. Point clips and notes don't.")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                    .lineSpacing(3)
            }
            .padding(16)
        }
    }

    // MARK: - Building blocks

    private func group(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeading(title)
            VStack(spacing: 0, content: content)
                .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                        .strokeBorder(PL.edge, lineWidth: 1)
                )
        }
    }

    private var rowDivider: some View {
        Rectangle().fill(PL.edge.opacity(0.6)).frame(height: 1).padding(.leading, 16)
    }

    private func linkRow(_ label: String, value: String) -> some View {
        NavigationLink(value: value) {
            HStack {
                Text(label)
                    .font(.system(size: 16))
                    .foregroundStyle(PL.textBody)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PL.text600)
            }
            .padding(16)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func navRow(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(label)
                    .font(.system(size: 16))
                    .foregroundStyle(PL.textBody)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PL.text600)
            }
            .padding(16)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Share links manager

struct ShareLinksManager: View {
    let store: AccountStore

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Public links")
                .font(.plCardTitle)
                .foregroundStyle(PL.text100)
            if store.shareLinks.isEmpty {
                Text("No active links.")
                    .font(.plBody)
                    .foregroundStyle(PL.text500)
            }
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(store.shareLinks) { link in
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(link.label)
                                    .font(.plRowTitle)
                                    .foregroundStyle(PL.text100)
                                    .lineLimit(1)
                                Text(PGDate.shortDate(link.createdAt))
                                    .font(.plCaption)
                                    .foregroundStyle(PL.text500)
                            }
                            Spacer()
                            Button("Revoke") {
                                Task { await store.revoke(link) }
                            }
                            .buttonStyle(PLSoftDestructiveButtonStyle())
                        }
                        .plInnerRow()
                    }
                }
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Player profile

struct PlayerProfileSheet: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var handedness: String?
    @State private var grip: String?
    @State private var level: String?
    @State private var saving = false

    var body: some View {
        PLSheetScaffold(
            title: "Player profile",
            doneLabel: saving ? "Saving…" : "Done",
            doneDisabled: saving,
            onDone: { Task { await save() } }
        ) {
            Form {
                choiceSection("Handedness", options: [
                    ("right", "Right-handed"), ("left", "Left-handed"),
                ], selection: $handedness)
                choiceSection("Grip", options: [
                    ("shakehand", "Shakehand"), ("penhold", "Penhold"),
                ], selection: $grip)
                choiceSection("Your level", options: [
                    ("beginner", "Beginner"), ("intermediate", "Intermediate"),
                    ("advanced", "Advanced"), ("club", "Club"),
                    ("regional", "Regional"), ("national", "National"),
                    ("international", "International"),
                ], selection: $level,
                footer: "Everything here saves when you tap Done, and you can change it any time.")
            }
        }
        .task { await load() }
    }

    private func choiceSection(
        _ title: String, options: [(String, String)],
        selection: Binding<String?>, footer: String? = nil
    ) -> some View {
        Section {
            FlowLayout(spacing: 8) {
                ForEach(options, id: \.0) { value, label in
                    let active = selection.wrappedValue == value
                    Button(label) {
                        selection.wrappedValue = active ? nil : value
                    }
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(active ? PL.cyan : PL.text400)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .background(active ? PL.cyan.opacity(0.15) : .clear, in: Capsule())
                    .overlay(Capsule().strokeBorder(active ? PL.cyan.opacity(0.5) : PL.edge, lineWidth: 1))
                    .buttonStyle(.plain)
                }
            }
            .listRowInsets(EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12))
        } header: {
            Text(title)
        } footer: {
            if let footer {
                Text(footer)
            }
        }
    }

    private struct ProfileRow: Codable {
        var handedness: String?
        var grip: String?
        var level: String?
    }

    private func load() async {
        let rows: [ProfileRow]? = try? await supa
            .from("player_profiles")
            .select("handedness,grip,level")
            .execute().value
        if let row = rows?.first {
            handedness = row.handedness
            grip = row.grip
            level = row.level
        }
    }

    private func save() async {
        guard let uid = app.userId else { return }
        saving = true
        struct Upsert: Encodable {
            let user_id: String
            let handedness: String?
            let grip: String?
            let level: String?
        }
        _ = try? await supa
            .from("player_profiles")
            .upsert(Upsert(
                user_id: uid.uuidString.lowercased(),
                handedness: handedness, grip: grip, level: level
            ))
            .execute()
        saving = false
        dismiss()
    }
}

// MARK: - Delete account

/// Closing the account for good. A screen rather than an alert on purpose:
/// there is a real amount to say — what goes, and the one case where it
/// cannot go yet — and an alert is the wrong shape for any of it.
///
/// It asks the server what would be deleted before it says anything, so the
/// numbers are this account's rather than a generic warning, and the typed
/// word is the last gate a misdirected tap has to get through.
struct DeleteAccountSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app

    @State private var matches = 0
    @State private var entries = 0
    @State private var blocked = false
    @State private var blockedOrders = 0
    @State private var loaded = false
    @State private var typed = ""
    @State private var busy = false
    @State private var error: String?

    private var armed: Bool {
        loaded && !blocked && !busy
            && typed.trimmingCharacters(in: .whitespaces).uppercased() == "DELETE"
    }

    var body: some View {
        PLSheetScaffold(title: "Delete account") {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if !loaded {
                        HStack(spacing: 10) {
                            ProgressView().tint(PL.cyan)
                            Text("Checking your account")
                                .font(.plBody)
                                .foregroundStyle(PL.text300)
                        }
                    } else if blocked {
                        Text(blockedOrders == 1
                             ? "A review is still in progress."
                             : "\(blockedOrders) reviews are still in progress.")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(PL.text100)
                        Text("Deleting now would leave the other person without the review they are waiting for. Finish or cancel it, then come back here.")
                            .font(.plBody)
                            .foregroundStyle(PL.text300)
                    } else {
                        Text("This cannot be undone.")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(PL.text100)
                        Text(summary)
                            .font(.plBody)
                            .foregroundStyle(PL.text300)

                        VStack(alignment: .leading, spacing: 7) {
                            Text("Type DELETE to confirm")
                                .font(.plCaption)
                                .foregroundStyle(PL.text400)
                            TextField("", text: $typed)
                                .textInputAutocapitalization(.characters)
                                .autocorrectionDisabled()
                                .font(.system(size: 16, weight: .medium))
                                .foregroundStyle(PL.text100)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 10)
                                .background(PL.ink.opacity(0.4), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                                        .strokeBorder(PL.edge, lineWidth: 1)
                                )
                        }
                        .padding(.top, 4)

                        Button(busy ? "Deleting…" : "Delete my account") {
                            Task { await destroy() }
                        }
                        .buttonStyle(PLDestructiveButtonStyle())
                        .frame(maxWidth: .infinity)
                        .disabled(!armed)
                        .opacity(armed ? 1 : 0.5)
                    }

                    if let error {
                        Text(error)
                            .font(.plCaption)
                            .foregroundStyle(PL.dangerText)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(20)
            }
        }
        .plKeyboardDismiss()
        .task { await loadPreview() }
    }

    private var summary: String {
        let m = matches == 1 ? "1 match" : "\(matches) matches"
        let e = entries == 1 ? "1 journal entry" : "\(entries) journal entries"
        return "Your account goes, and with it \(m) with their video and points, \(e), your notes, your stats, and any coach page you have."
    }

    private func loadPreview() async {
        struct Req: Encodable { let action: String }
        struct Res: Decodable {
            let matches: Int
            let entries: Int
            let blocked: Bool
            let blockedOrders: Int
        }
        do {
            let res: Res = try await API.post("api/delete-account", Req(action: "preview"))
            matches = res.matches
            entries = res.entries
            blocked = res.blocked
            blockedOrders = res.blockedOrders
            loaded = true
        } catch {
            self.error = "Couldn't check your account. Close this and try again."
        }
    }

    private func destroy() async {
        struct Req: Encodable { let action: String; let confirm: String }
        struct Res: Decodable { let ok: Bool? }
        busy = true
        error = nil
        do {
            let _: Res = try await API.post(
                "api/delete-account", Req(action: "delete", confirm: "DELETE")
            )
            // The account behind this session no longer exists, so the sign
            // out is local housekeeping — it must not be allowed to fail the
            // operation that already succeeded.
            await app.signOut()
            dismiss()
        } catch let APIError.http(_, message) {
            // A big library can outrun the request; the sweep is idempotent,
            // so saying "try again" is honest advice rather than a shrug.
            error = message.isEmpty
                ? "Couldn't delete the account. Try again."
                : message
            busy = false
        } catch {
            self.error = "Couldn't delete the account. Try again."
            busy = false
        }
    }
}

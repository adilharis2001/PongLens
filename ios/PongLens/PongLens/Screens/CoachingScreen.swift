import SwiftUI
import Supabase

/// The Coaching tab. It runs in two directions: you as a coach (the hub —
/// queue, offerings, payouts), and the coaches you have (their notes, the
/// reviews you bought, who can see your matches). Someone living both
/// gets a view switch; everyone else gets exactly their side.
struct CoachingScreen: View {
    @Environment(AppState.self) private var app
    @Environment(JournalStore.self) private var journal
    @Environment(LibraryStore.self) private var library
    @Environment(MediaStore.self) private var media
    @Environment(ScoresStore.self) private var scores
    @Environment(CoachingStore.self) private var coaching
    @Environment(CoachStore.self) private var coach
    @Environment(\.scenePhase) private var scenePhase

    @State private var inviteOpen = false
    @State private var startOpen = false
    @State private var view = "coach"
    @State private var sweptOnce = false

    private var coachNotes: [NoteFeedRow] {
        journal.notes
            .filter { $0.authorId != app.userId }
            .sorted {
                (PGDate.parse($0.createdAt) ?? .distantPast) > (PGDate.parse($1.createdAt) ?? .distantPast)
            }
    }

    private var playerSide: Bool {
        !coaching.coachLinks.isEmpty || !coaching.orders.isEmpty || !coachNotes.isEmpty
    }

    private var dual: Bool { coach.profile != nil && playerSide }
    private var showCoach: Bool { coach.profile != nil && (!dual || view == "coach") }
    private var showPlayer: Bool { coach.profile == nil || (dual && view == "player") }

    /// Matches students shared through a coach link, grouped by player.
    /// This is the free half of coaching — it does not need a coach page
    /// or payouts, so it shows here even before any of that is set up.
    private var sharedByPlayer: [(playerId: UUID, matches: [MatchRow])] {
        guard let uid = app.userId else { return [] }
        let shared = library.matches.filter { $0.userId != uid }
        return Dictionary(grouping: shared, by: \.userId)
            .map { ($0.key, $0.value) }
            .sorted { a, b in
                (a.matches.first.map(\.createdAt) ?? "") > (b.matches.first.map(\.createdAt) ?? "")
            }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack(alignment: .center) {
                    Text("Coaching")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)
                    Spacer()
                    if dual {
                        viewSwitch
                    }
                }

                if showCoach {
                    CoachHubView()
                    if !sharedByPlayer.isEmpty {
                        fromYourStudents
                    }
                }

                if showPlayer {
                    if coach.profile == nil, !sharedByPlayer.isEmpty {
                        fromYourStudents
                    }
                    fromYourCoaches
                    if !coaching.orders.isEmpty {
                        reviewsBought
                    }
                    sharingSection
                    if coach.profile == nil, coach.loaded {
                        BecomeCoachCard(startOpen: $startOpen)
                    }
                }
            }
            .padding(20)
            .padding(.top, 12)
            .padding(.bottom, 120)
        }
        .sheet(isPresented: $inviteOpen) {
            AllMatchesCoachInvite()
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $startOpen) {
            CoachStartSheet()
                .presentationDetents([.medium])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
        .task {
            if let uid = app.userId,
               let stored = UserDefaults.standard.string(forKey: Self.viewKey(uid)),
               stored == "coach" || stored == "player" {
                view = stored
            }
            await coach.load(userId: app.userId)
            if coach.profile != nil && !sweptOnce {
                sweptOnce = true
                await coach.sweep()
                await coach.load(userId: app.userId)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            // Coming back from Stripe onboarding in the browser: re-ask
            // Stripe for the account state, exactly like the web's
            // ?connected=1 boot sync.
            guard phase == .active, let profile = coach.profile,
                  profile.stripeAccountId != nil,
                  !(profile.chargesEnabled && profile.payoutsEnabled)
            else { return }
            Task { await coach.syncConnectStatus(userId: app.userId) }
        }
    }

    private var viewSwitch: some View {
        HStack(spacing: 2) {
            switchButton("Coach", key: "coach")
            switchButton("Your coaches", key: "player")
        }
        .padding(2)
        .background(PL.ink.opacity(0.4), in: Capsule())
        .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
    }

    /// The remembered coach/player choice is per account, like the tab cache.
    static func viewKey(_ userId: UUID) -> String {
        "pl-coaching-view-\(userId.uuidString.lowercased())"
    }

    private func switchButton(_ label: String, key: String) -> some View {
        let active = view == key
        return Button(label) {
            view = key
            if let uid = app.userId {
                UserDefaults.standard.set(key, forKey: Self.viewKey(uid))
            }
        }
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(active ? PL.cyan : PL.text500)
        .lineLimit(1)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(active ? PL.cyan.opacity(0.15) : .clear, in: Capsule())
        .buttonStyle(.plain)
    }

    // MARK: - From your students

    /// The matches students linked you to, free, through a coach link.
    /// Paid work lives under Orders; this list asks for nothing.
    private var fromYourStudents: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading("From your students")
            ForEach(sharedByPlayer, id: \.playerId) { group in
                VStack(alignment: .leading, spacing: 10) {
                    Text(coach.studentNames[group.playerId] ?? "A player")
                        .font(.plRowTitle)
                        .foregroundStyle(PL.text300)
                    ForEach(group.matches) { match in
                        NavigationLink(value: match) {
                            MatchListRow(
                                match: match,
                                thumbURL: media.thumbURL(match.id),
                                score: scores.scores[match.id]
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: - From your coaches

    @ViewBuilder
    private var fromYourCoaches: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading("From your coaches")
            if coachNotes.isEmpty {
                Text("Coach notes on your matches land here.")
                    .font(.plBody)
                    .foregroundStyle(PL.text500)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .plCard(padding: 18)
            } else {
                ForEach(coachNotes.prefix(4)) { note in
                    let title = MatchTitle.parts(
                        opponentName: note.opponentName, venue: note.venue,
                        playedAt: note.playedAt
                    ).primary
                    let target = library.matches.first { $0.id == note.matchId }
                    Group {
                        if let target {
                            NavigationLink(value: target) {
                                coachNoteBody(note, title: title)
                            }
                            .buttonStyle(.plain)
                        } else {
                            coachNoteBody(note, title: title)
                        }
                    }
                }
            }
        }
    }

    private func coachNoteBody(_ note: NoteFeedRow, title: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Text(note.authorName ?? "Coach")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color(hex: 0xF0C420))
                Text("· \(title) · \(PGDate.shortDate(note.createdAt))")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                    .lineLimit(1)
            }
            Text(note.body.isEmpty ? (note.audioPath != nil ? "Voice note" : "Drawing") : note.body)
                .font(.plBody)
                .foregroundStyle(PL.text200)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 14)
        .overlay(alignment: .leading) {
            UnevenRoundedRectangle(topLeadingRadius: PL.rCard, bottomLeadingRadius: PL.rCard)
                .fill(Color(hex: 0xF0C420).opacity(0.6))
                .frame(width: 3)
        }
    }

    // MARK: - Reviews you bought

    private var reviewsBought: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeading("Reviews you bought")
            VStack(spacing: 0) {
                ForEach(Array(coaching.orders.prefix(3).enumerated()), id: \.element.id) { i, order in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text([order.offeringTitle, order.coachName].compactMap { $0 }.joined(separator: " · "))
                                .font(.plRowTitle)
                                .foregroundStyle(PL.text100)
                                .lineLimit(1)
                            Text(studentOrderStatusLabel(order.status))
                                .font(.plCaption)
                                .foregroundStyle(order.status == "delivered" ? PL.successText : PL.text500)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(PL.text600)
                    }
                    .padding(14)
                    if i < min(3, coaching.orders.count) - 1 {
                        Rectangle().fill(PL.edge.opacity(0.5)).frame(height: 1).padding(.leading, 14)
                    }
                }
            }
            .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            )
            Text("Open orders at ponglens.com to send a match or read the review.")
                .font(.plCaption)
                .foregroundStyle(PL.text600)
        }
    }

    // MARK: - Sharing

    private var sharingSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                SectionHeading("Your coaches")
                Spacer()
                Button("Add a coach") { inviteOpen = true }
                    .buttonStyle(PLSecondaryButtonStyle())
            }
            if coaching.coachLinks.isEmpty {
                Text("No coaches yet.")
                    .font(.plBody)
                    .foregroundStyle(PL.text500)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .plCard(padding: 18)
            } else {
                VStack(spacing: 10) {
                    ForEach(coaching.coachLinks) { link in
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(link.status == "accepted" ? "Coach connected" : "Invite pending")
                                    .font(.plRowTitle)
                                    .foregroundStyle(PL.text100)
                                Text(link.scopeMatchId == nil ? "All matches" : "One match")
                                    .font(.plCaption)
                                    .foregroundStyle(PL.text500)
                            }
                            Spacer()
                            if link.status != "accepted", let token = link.inviteToken,
                               let url = URL(string: "https://www.ponglens.com/coach-invite/\(token)") {
                                ShareLink(item: url) {
                                    Text("Copy link")
                                        .font(.plButtonSecondary)
                                        .foregroundStyle(PL.text300)
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 6)
                                        .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                                }
                            }
                            Button("Remove") {
                                Task { await coaching.revokeLink(link) }
                            }
                            .buttonStyle(PLSoftDestructiveButtonStyle())
                        }
                        .plInnerRow()
                    }
                }
            }
        }
    }
}

/// The all-matches coach invite (the match-scoped variant lives on the
/// match page's Tools). The QR is for handing your phone to the coach at
/// the table — same link, no typing.
struct AllMatchesCoachInvite: View {
    @Environment(AppState.self) private var app
    @Environment(CoachingStore.self) private var coaching
    @Environment(\.dismiss) private var dismiss
    @State private var link: URL?
    @State private var creating = false
    @State private var errorMessage: String?
    @State private var showQR = false
    @State private var copied = false

    var body: some View {
        NavigationStack {
            Form {
                if let link {
                    Section {
                        Text(link.absoluteString)
                            .font(.system(size: 13, design: .monospaced))
                            .foregroundStyle(PL.text300)
                            .lineLimit(2)
                        ShareLink(item: link) {
                            Text("Share the link")
                        }
                        Button(copied ? "Copied" : "Copy link") {
                            UIPasteboard.general.string = link.absoluteString
                            copied = true
                            Task {
                                try? await Task.sleep(for: .seconds(1.5))
                                copied = false
                            }
                        }
                        Toggle("Show QR", isOn: $showQR)
                        if showQR {
                            QRCodeView(url: link)
                                .listRowBackground(Color.clear)
                        }
                    } footer: {
                        Text("They can watch all your matches, point by point, and leave coach notes.")
                    }
                } else {
                    Section {
                        Button(creating ? "Creating…" : "Create invite link") {
                            Task { await create() }
                        }
                        .disabled(creating)
                        if let errorMessage {
                            Text(errorMessage)
                                .font(.plCaption)
                                .foregroundStyle(PL.dangerText)
                        }
                    } footer: {
                        Text("They can watch all your matches, point by point, and leave coach notes.")
                    }
                }
            }
            .tint(PL.cyan)
            .navigationTitle("Share with coach")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private func create() async {
        guard let uid = app.userId else { return }
        creating = true
        errorMessage = nil
        struct Insert: Encodable {
            let player_id: String
        }
        struct TokenRow: Decodable { let invite_token: String }
        do {
            let row: TokenRow = try await supa
                .from("coach_links")
                .insert(Insert(player_id: uid.uuidString.lowercased()))
                .select("invite_token")
                .single()
                .execute()
                .value
            link = URL(string: "https://www.ponglens.com/coach-invite/\(row.invite_token)")
            await coaching.load(userId: uid)
        } catch {
            errorMessage = "Couldn't create the link. Try again."
        }
        creating = false
    }
}

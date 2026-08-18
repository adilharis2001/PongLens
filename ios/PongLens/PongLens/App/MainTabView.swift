import SwiftUI

enum MainTab: String, CaseIterable, Identifiable {
    case home = "Home"
    case record = "Record"
    case matches = "Matches"
    case journal = "Journal"
    case coaching = "Coaching"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .home: "house"
        case .record: "record.circle"
        case .matches: "play.rectangle"
        case .journal: "book.closed"
        case .coaching: "figure.table.tennis"
        }
    }

    var iconFilled: String {
        switch self {
        case .home: "house.fill"
        case .record: "record.circle.fill"
        case .matches: "play.rectangle.fill"
        case .journal: "book.closed.fill"
        case .coaching: "figure.table.tennis"
        }
    }
}

struct MainTabView: View {
    @Environment(Router.self) private var router
    @Environment(AppState.self) private var app
    @Environment(LibraryStore.self) private var library
    @Environment(MediaStore.self) private var media
    @Environment(ScoresStore.self) private var scores
    @Environment(JournalStore.self) private var journal
    @Environment(NotificationsStore.self) private var notifications
    @Environment(CoachingStore.self) private var coaching

    @State private var path = NavigationPath()
    @State private var bellOpen = false

    var body: some View {
        @Bindable var router = router
        NavigationStack(path: $path) {
            ZStack {
                ArenaBackground()
                // Paged, so the tabs swipe left and right like they read in
                // the bar; the bar and the swipe drive the same selection.
                TabView(selection: $router.tab) {
                    HomeScreen().tag(MainTab.home)
                    MatchesScreen().tag(MainTab.matches)
                    JournalScreen().tag(MainTab.journal)
                    if coaching.showTab {
                        CoachingScreen().tag(MainTab.coaching)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                PLTopBar(
                    unreadCount: notifications.unreadCount,
                    onBell: { bellOpen = true },
                    onAvatar: { path.append("account") }
                )
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                PLTabBar(
                    selection: $router.tab,
                    items: coaching.showTab
                        ? [.home, .record, .matches, .journal, .coaching]
                        : [.home, .record, .matches, .journal],
                    onRecord: { router.recordOpen = true }
                )
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: MatchRow.self) { match in
                MatchDetailScreen(match: match)
            }
            .navigationDestination(for: String.self) { route in
                switch route {
                case "account": AccountScreen()
                case "stats": StatsScreen()
                case "stats-tactics": StatsScreen(initialTab: "Tactics")
                case "learn": LearnScreen()
                case "learn-videos": TutorialVideosScreen()
                case "feedback": FeedbackScreen()
                case "coach-orders": CoachOrdersScreen()
                case "coach-offerings": CoachOfferingsScreen()
                case "coach-profile": CoachProfileScreen()
                case "coach-sponsored": CoachSponsoredScreen()
                default: EmptyView()
                }
            }
            .navigationDestination(for: CoachOrderRoute.self) { route in
                CoachOrderScreen(orderId: route.id)
            }
        }
        .fullScreenCover(isPresented: $router.uploadOpen) {
            UploadScreen()
        }
        .fullScreenCover(isPresented: $router.recordOpen) {
            RecordScreen()
        }
        .onReceive(NotificationCenter.default.publisher(for: .plUploadRegistered)) { _ in
            // A finished upload just registered its match row; pull the
            // library so the new card shows up without waiting for a poll.
            Task {
                await library.load()
                await media.loadThumbs(library.matches.map(\.id))
            }
        }
        .sheet(isPresented: $bellOpen) {
            NotificationsPanel(
                store: notifications,
                onOpenMatch: { matchId in
                    bellOpen = false
                    if let match = library.matches.first(where: { $0.id == matchId }) {
                        path.append(match)
                    }
                }
            )
            .presentationDetents([.medium, .large])
            .presentationBackground(PL.surface)
            .presentationDragIndicator(.visible)
        }
        .task {
            #if DEBUG
            if router.devOpenAccount {
                router.devOpenAccount = false
                path.append("account")
            }
            #endif
            await notifications.load()
            notifications.startPolling()
        }
        .task { await coaching.load(userId: app.userId) }
        .task {
            await library.load()
            await media.loadThumbs(library.matches.map(\.id))
            await scores.load(for: library.matches.filter { $0.status == .ready })
            if !journal.loaded {
                await journal.load(userId: app.userId)
            }
            library.startPolling()
        }
        .onChange(of: library.matches) { _, matches in
            Task {
                await media.loadThumbs(matches.map(\.id))
                await scores.load(for: matches.filter { $0.status == .ready })
            }
            #if DEBUG
            if let devId = router.devOpenMatchId,
               let match = matches.first(where: { $0.id == devId }) {
                router.devOpenMatchId = nil
                path.append(match)
            }
            #endif
        }
    }
}

// MARK: - Top bar

struct PLTopBar: View {
    @Environment(AppState.self) private var app
    var unreadCount = 0
    var onBell: () -> Void = {}
    var onAvatar: () -> Void = {}

    var body: some View {
        HStack {
            LogoWordmark()
            Spacer()
            HStack(spacing: 20) {
                Button(action: onBell) {
                    Image(systemName: "bell")
                        .font(.system(size: 19, weight: .medium))
                        .foregroundStyle(PL.text300)
                        .frame(width: 36, height: 36)
                        .overlay(alignment: .topTrailing) {
                            if unreadCount > 0 {
                                Text(unreadCount > 9 ? "9+" : "\(unreadCount)")
                                    .font(.system(size: 10, weight: .bold))
                                    .monospacedDigit()
                                    .foregroundStyle(.white)
                                    .fixedSize()
                                    .padding(.horizontal, 4.5)
                                    .padding(.vertical, 2)
                                    .background(PL.magenta, in: Capsule())
                                    .offset(x: 6, y: -2)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Notifications")
                Button(action: onAvatar) {
                    ZStack {
                        Circle().fill(PL.surface2)
                        if let url = app.avatarURL {
                            AsyncImage(url: url) { image in
                                image.resizable().scaledToFill()
                            } placeholder: {
                                initialText
                            }
                        } else {
                            initialText
                        }
                    }
                    .frame(width: 34, height: 34)
                    .clipShape(Circle())
                    .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Account")
            }
        }
        .padding(.horizontal, 20)
        .frame(height: 56)
        .background {
            ZStack {
                Rectangle().fill(.ultraThinMaterial)
                PL.ink.opacity(0.6)
            }
            .ignoresSafeArea(edges: .top)
        }
        .overlay(alignment: .bottom) {
            Rectangle().fill(PL.edge.opacity(0.7)).frame(height: 1)
        }
    }

    private var initialText: some View {
        Text(app.initial)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(PL.cyan)
    }
}

// MARK: - Tab bar

struct PLTabBar: View {
    @Binding var selection: MainTab
    var items: [MainTab] = [.home, .matches, .journal]
    /// Record is a door, not a page: tapping it opens the camera full
    /// screen instead of selecting a tab, so a swipe can never land you in
    /// a live viewfinder by accident.
    var onRecord: (() -> Void)?

    var body: some View {
        HStack(spacing: 0) {
            ForEach(items) { item in
                Button {
                    if item == .record, let onRecord {
                        onRecord()
                    } else {
                        selection = item
                    }
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: selection == item ? item.iconFilled : item.icon)
                            .font(.system(size: 20))
                            .frame(height: 24)
                        Text(item.rawValue)
                            .font(.plTabLabel)
                    }
                    .frame(maxWidth: .infinity)
                    .foregroundStyle(selection == item ? PL.cyan : PL.text500)
                }
                .buttonStyle(.plain)
            }
        }
        .frame(height: 60)
        .background {
            ZStack {
                Rectangle().fill(.ultraThinMaterial)
                PL.ink.opacity(0.7)
            }
            .ignoresSafeArea(edges: .bottom)
        }
        .overlay(alignment: .top) {
            Rectangle().fill(PL.edge.opacity(0.7)).frame(height: 1)
        }
    }
}

// MARK: - FAB

struct PLFab: View {
    let label: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: systemImage)
                    .font(.system(size: 15, weight: .bold))
                Text(label)
                    .font(.plButton)
            }
            .foregroundStyle(PL.ink)
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
            .background(PL.cyan, in: Capsule())
            .overlay(Capsule().strokeBorder(PL.cyan.opacity(0.4), lineWidth: 1))
            .shadow(color: PL.cyan.opacity(0.35), radius: 12)
            .shadow(color: .black.opacity(0.4), radius: 14, y: 6)
        }
    }
}

/// The corner action on Home and Matches. Record lives on the tab bar.
struct PLFabStack: View {
    @Environment(Router.self) private var router

    var body: some View {
        PLFab(label: "Upload", systemImage: "tray.and.arrow.up") {
            router.uploadOpen = true
        }
    }
}

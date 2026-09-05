import SwiftUI

enum MainTab: String, CaseIterable, Identifiable {
    case home = "Home"
    case matches = "Matches"
    case journal = "Journal"
    case coaching = "Coaching"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .home: "house"
        case .matches: "play.rectangle"
        case .journal: "book.closed"
        case .coaching: "figure.table.tennis"
        }
    }

    var iconFilled: String {
        switch self {
        case .home: "house.fill"
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
    @Environment(ScoresStore.self) private var scores
    @Environment(JournalStore.self) private var journal
    @Environment(NotificationsStore.self) private var notifications
    @Environment(CoachingStore.self) private var coaching

    @State private var path = NavigationPath()
    @State private var bellOpen = false
    @State private var newMatchChoice: NewMatchChoice?
    /// The chosen door, held while the camera guide is up in front of it,
    /// and consumed when the guide closes.
    @State private var pendingChoice: NewMatchChoice?
    /// The guide's own presentation. `sheet(item:)` rather than a Bool:
    /// the sheet has to know which door raised it, and reading that from
    /// a second piece of state resolved a beat too early — every showing
    /// came out in the upload wording, including the two raised by
    /// Record. Carried by the item, it cannot disagree.
    @State private var cameraGuideDoor: CameraGuideDoor?
    @State private var keyboardVisible = false

    struct CameraGuideDoor: Identifiable {
        let id = UUID()
        let context: CameraPlacementSheet.Context
    }

    /// A coaching side exists: the flag, a marketplace page, or someone's
    /// accepted coach. The top-bar switch shows only then.
    private var canSwitchWorkspace: Bool {
        LearnAudienceAccess.canSwitch(
            isCoach: coaching.isCoach,
            coachesAnyone: coaching.coachesAnyone,
            metadataCoach: app.metadataFlag("is_coach"),
            playerSetupPending: app.playerSetupPending
        )
    }

    /// Everything the chooser used to do inline, now also reachable from
    /// the far side of the camera guide.
    private func beginNewMatch(_ choice: NewMatchChoice) {
        switch choice {
        case .record(let kind):
            // Which door was used has to be set before the recorder is
            // presented, because the details sheet it raises on stop reads
            // it for its processing defaults and its type list.
            router.recordKind = kind
            // Rotate BEFORE presenting, not after. The recorder is
            // landscape-only, and a cover raised in portrait and rotated
            // once it is up resizes with the camera preview already on
            // screen — a preview is a plain layer that does not resize
            // with the window, so the picture is a portrait-width strip
            // with black beside it for a few frames. Six tenths of a
            // second at most, then present regardless; the recorder keeps
            // asking on its own behalf.
            Task {
                await RecordOrientation.pinLandscape()
                router.recordOpen = true
            }
        case .upload:
            router.uploadOpen = true
        }
    }

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
                    // Only an account with BOTH sides set up gets the
                    // pill (Adil, 2026-09-02): "Both" at onboarding, or a
                    // player who set up coaching from Account. A coach who
                    // merely switched here still has the playing questions
                    // pending, and their way back stays in Account.
                    switchTo: canSwitchWorkspace ? "Coaching" : nil,
                    onSwitch: { app.setWorkspace(.coach) },
                    onBell: { bellOpen = true },
                    onAvatar: { path.append("account") }
                )
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                PLTabBar(
                    selection: $router.tab,
                    items: coaching.showTab
                        ? [.home, .matches, .journal, .coaching]
                        : [.home, .matches, .journal]
                )
            }
            // The paged TabView swallows SwiftUI keyboard toolbar items,
            // declared inside its pages or above it — verified both ways.
            // So the tab screens get their hide-keyboard button from this
            // inset instead: it sits directly above the keyboard and only
            // exists while one is up. Pushed screens and sheets use
            // plKeyboardDismiss, whose toolbar works there.
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if keyboardVisible {
                    HStack {
                        Spacer()
                        PLKeyboardDismissButton()
                    }
                    .padding(.horizontal, 12)
                    .padding(.bottom, 8)
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .onReceive(NotificationCenter.default.publisher(
                for: UIResponder.keyboardWillShowNotification
            )) { _ in keyboardVisible = true }
            .onReceive(NotificationCenter.default.publisher(
                for: UIResponder.keyboardWillHideNotification
            )) { _ in keyboardVisible = false }
            .navigationDestination(for: MatchRow.self) { match in
                MatchDetailScreen(match: match)
            }
            .navigationDestination(for: MatchPointRoute.self) { route in
                MatchDetailScreen(match: route.match, openPointId: route.pointId)
            }
            .appRoutes()
            .navigationDestination(for: CoachOrderRoute.self) { route in
                if AppConfig.coachMarketplace {
                    CoachOrderScreen(orderId: route.id)
                }
            }
        }
        .fullScreenCover(isPresented: $router.uploadOpen) {
            UploadScreen()
        }
        .fullScreenCover(isPresented: $router.recordOpen) {
            RecordScreen()
        }
        // The chooser hands its answer over on dismissal rather than
        // presenting from inside itself. A full screen cover raised while
        // the sheet is still up races the dismissal, and the loser of that
        // race is simply dropped — you tap Record and nothing happens.
        .sheet(isPresented: $router.newMatchOpen, onDismiss: {
            guard let choice = newMatchChoice else { return }
            newMatchChoice = nil
            // For the first two occasions an account walks through any of
            // these three doors, the camera guide stands in front of it.
            // Where the camera goes is the single biggest thing deciding
            // whether the pipeline finds any points, and this is the last
            // moment the advice can still change the footage.
            //
            // It has to open HERE, before the errand starts, because the
            // recorder rotates the phone before it presents and this is a
            // tall portrait form. Portrait first, hand over on dismissal.
            if CameraGuideFirstRun.shouldAutoShow(
                app: app,
                hasAnyMatch: library.loaded ? !library.matches.isEmpty : nil
            ) {
                pendingChoice = choice
                cameraGuideDoor = CameraGuideDoor(
                    context: { if case .record = choice { .recording } else { .upload } }()
                )
            } else {
                beginNewMatch(choice)
            }
        }) {
            NewMatchSheet { choice in
                newMatchChoice = choice
                router.newMatchOpen = false
            }
            // Three rows now, not two. A detent left at the old height cuts
            // the last row in half, which reads as a bug rather than as
            // something to scroll.
            .presentationDetents([.height(336)])
            .presentationBackground(PL.surface)
            .presentationDragIndicator(.visible)
        }
        // Raised only by the gate above. The manual "How to record"
        // triggers on Home and Upload keep their own sheets and never
        // count against the two automatic showings.
        .sheet(item: $cameraGuideDoor, onDismiss: {
            // Closing it must never cancel the errand — by the button, by
            // the drag, or by tapping outside. A tap that opens a sheet
            // and then leaves you exactly where you started reads as a
            // broken button, which is the easiest way there is to spoil a
            // first run.
            if let choice = pendingChoice {
                pendingChoice = nil
                beginNewMatch(choice)
            }
        }) { door in
            CameraPlacementSheet(context: door.context)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .onReceive(NotificationCenter.default.publisher(for: .plUploadRegistered)) { _ in
            // A finished upload just registered its match row; pull the
            // library so the new card shows up without waiting for a poll.
            Task {
                await library.load()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .plRecollectChanged)) { note in
            // The Account toggle just moved; the journal's Recollect tab
            // follows without waiting for a reload.
            if let enabled = note.userInfo?["enabled"] as? Bool {
                journal.recollectEnabled = enabled
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
                },
                onOpenHref: { href in
                    // "shared a lesson note" lands on the journal, where the
                    // From your coach section sits at the top.
                    if href.hasPrefix("/journal") {
                        bellOpen = false
                        router.tab = .journal
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
            if router.devOpenStarred {
                router.devOpenStarred = false
                path.append("starred")
            }
            #endif
            await notifications.load()
            notifications.startPolling()
        }
        .task { await coaching.load(userId: app.userId) }
        .task {
            await library.load()
            await scores.load(for: library.matches.filter { $0.status == .ready })
            if !journal.loaded {
                await journal.load(userId: app.userId)
            }
            library.startPolling()
        }
        .onChange(of: library.matches) { _, matches in
            Task {
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
    /// The side switch (158): the OTHER side's name, shown only for
    /// accounts that have both. A word over an icon — "Coaching" on the
    /// playing side, "Playing" on the coaching side — so it never reads
    /// as "your coach". Nil hides it; everyone else keeps Account's row.
    var switchTo: String? = nil
    var onSwitch: () -> Void = {}
    var onBell: () -> Void = {}
    var onAvatar: () -> Void = {}

    var body: some View {
        HStack {
            LogoWordmark()
            Spacer()
            HStack(spacing: switchTo == nil ? 20 : 14) {
                if let switchTo {
                    Button(action: onSwitch) {
                        HStack(spacing: 5) {
                            Image(systemName: "arrow.left.arrow.right")
                                .font(.system(size: 11, weight: .bold))
                            Text(switchTo)
                                .font(.system(size: 13, weight: .semibold))
                                .lineLimit(1)
                        }
                        .fixedSize()
                        .foregroundStyle(PL.text200)
                        .padding(.horizontal, 11)
                        .padding(.vertical, 6)
                        .background(PL.surface2, in: Capsule())
                        .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Switch to \(switchTo.lowercased())")
                }
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

    var body: some View {
        HStack(spacing: 0) {
            ForEach(items) { item in
                Button {
                    selection = item
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

// MARK: - New match

enum NewMatchChoice {
    case record(MatchKind)
    case upload
}

/// The ways footage gets in. They are not spellings of one action: two are
/// for standing at the table now, the third for a file already on the
/// phone. Each row names its situation, so the choice never rests on
/// telling verbs apart.
///
/// Match and practice both open the same recorder. Asking here rather than
/// afterwards is what lets the details sheet arrive already right: practice
/// starts with processing off, because drills do not earn their minutes
/// back, and without serve, because nobody in a drill is tracking who
/// serves.
struct NewMatchSheet: View {
    let onChoose: (NewMatchChoice) -> Void

    var body: some View {
        PLChooserSheet(title: "New match") {
            PLChooserRow(
                icon: "record.circle",
                title: "Record a match",
                detail: "Film a match you are about to play."
            ) { onChoose(.record(.match)) }
            PLChooserRow(
                icon: "figure.table.tennis",
                title: "Record a practice session",
                detail: "Film drills or non-match play."
            ) { onChoose(.record(.practice)) }
            PLChooserRow(
                icon: "tray.and.arrow.up",
                title: "Upload a match",
                detail: "Pick a video you have already filmed."
            ) { onChoose(.upload) }
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

/// The corner action on Home and Matches, and the only way into either
/// the camera or the library. Recording and uploading are one errand —
/// getting a match into the app — so a single button owns it and the
/// chooser settles which. The tab bar went back to destinations only.
struct PLFabStack: View {
    @Environment(Router.self) private var router

    var body: some View {
        PLFab(label: "New match", systemImage: "plus") {
            router.newMatchOpen = true
        }
    }
}

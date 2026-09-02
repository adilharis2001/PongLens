import SwiftUI

enum CoachTab: String, CaseIterable, Identifiable {
    case home = "Home"
    case students = "Students"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .home: "house"
        case .students: "person.2"
        }
    }

    var iconFilled: String {
        switch self {
        case .home: "house.fill"
        case .students: "person.2.fill"
        }
    }
}

/// What the New entry chooser resolved to: how the entry starts, and for
/// whom if that is already decided. Carried by the cover so the composer
/// cannot disagree with the tap that raised it.
struct CoachComposerRequest: Identifiable {
    enum Mode { case write, record }
    let id = UUID()
    let mode: Mode
    let student: CoachStudentRow?
}

/// Coach-side navigation state, the coaching twin of Router.
@Observable
final class CoachRouter {
    var tab: CoachTab = .home
    /// The New entry chooser, and the student it is about when opened
    /// from a student's own page.
    var newEntryOpen = false
    var newEntryStudent: CoachStudentRow?
    /// Writing is a sheet, like the journal composer; recording is the
    /// full-screen recorder, like a player's lesson. Two presentations,
    /// so each gets the chrome its twin has.
    var composeWrite: CoachComposerRequest?
    var composeRecord: CoachComposerRequest?
    /// The Add a student sheet, reachable from Students and from Home's
    /// first-run card.
    var addStudentOpen = false

    #if DEBUG
    /// Headless-verification hooks, the coach side's --dev-* set: land on
    /// a tab or open a screen straight from launch arguments so simctl
    /// screenshots can reach deep screens without tap automation.
    var devOpenFirstStudent = false
    var devOpenFirstEntry = false
    var devComposeWrite = false
    var devInvite = false
    #endif

    init() {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "--dev-coach-tab"), args.indices.contains(i + 1),
           let requested = CoachTab(rawValue: args[i + 1].capitalized) {
            tab = requested
        }
        devOpenFirstStudent = args.contains("--dev-open-first-student")
        devOpenFirstEntry = args.contains("--dev-open-first-entry")
        devComposeWrite = args.contains("--dev-coach-compose")
        devInvite = args.contains("--dev-coach-invite")
        #endif
    }
}

/// The coaching workspace: the same app, standing on the other side of
/// the table. Two tabs and a New entry action; everything hangs off the
/// roster. Matches shared by students open the same match screens the
/// player side uses — access was never the tab's job.
struct CoachTabView: View {
    @Environment(AppState.self) private var app
    @Environment(LibraryStore.self) private var library
    @Environment(ScoresStore.self) private var scores
    @Environment(NotificationsStore.self) private var notifications
    @Environment(CoachWorkspaceStore.self) private var workspace

    @State private var router = CoachRouter()
    @State private var path = NavigationPath()
    @State private var bellOpen = false
    /// DEBUG-only presentation target for --dev-coach-invite; inert in
    /// Release, where nothing sets it.
    @State private var devInviteOpen = false

    var body: some View {
        @Bindable var router = router
        NavigationStack(path: $path) {
            ZStack {
                ArenaBackground()
                TabView(selection: $router.tab) {
                    CoachHomeScreen().tag(CoachTab.home)
                    CoachStudentsScreen().tag(CoachTab.students)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
            }
            .overlay(alignment: .bottomTrailing) {
                PLFab(label: "New entry", systemImage: "plus") {
                    router.newEntryStudent = nil
                    router.newEntryOpen = true
                }
                .padding(.trailing, 20)
                .padding(.bottom, 16)
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                PLTopBar(
                    unreadCount: notifications.unreadCount,
                    switchTo: "Playing",
                    onSwitch: { app.setWorkspace(.player) },
                    onBell: { bellOpen = true },
                    onAvatar: { path.append("account") }
                )
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                CoachTabBar(selection: $router.tab)
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: CoachStudentRow.self) { student in
                CoachStudentScreen(studentId: student.id)
            }
            .navigationDestination(for: CoachEntryRow.self) { entry in
                CoachEntryScreen(entryId: entry.id)
            }
            .navigationDestination(for: MatchRow.self) { match in
                MatchDetailScreen(match: match)
            }
            .navigationDestination(for: String.self) { route in
                switch route {
                case "account": AccountScreen()
                default: EmptyView()
                }
            }
        }
        .environment(router)
        .sheet(isPresented: $router.newEntryOpen) {
            CoachNewEntrySheet(student: router.newEntryStudent) { mode in
                let student = router.newEntryStudent
                router.newEntryOpen = false
                // Hand over on dismissal, the same race the New match
                // chooser settles: a cover raised while the sheet is
                // still up can be dropped by the loser of the dismissal.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                    let request = CoachComposerRequest(mode: mode, student: student)
                    if mode == .write { router.composeWrite = request } else { router.composeRecord = request }
                }
            }
            .presentationDetents([.height(300)])
            .presentationBackground(PL.surface)
            .presentationDragIndicator(.visible)
        }
        .sheet(item: $router.composeWrite) { request in
            CoachEntryComposer(request: request)
                .presentationDetents([.large])
        }
        .fullScreenCover(item: $router.composeRecord) { request in
            CoachEntryComposer(request: request)
        }
        .sheet(isPresented: $devInviteOpen) {
            StudentInviteSheet(student: workspace.activeStudents.first)
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
                    // A student joining lands on the roster.
                    if href.hasPrefix("/coaching/students") {
                        bellOpen = false
                        router.tab = .students
                    }
                }
            )
            .presentationDetents([.medium, .large])
            .presentationBackground(PL.surface)
            .presentationDragIndicator(.visible)
        }
        .task {
            await notifications.load()
            notifications.startPolling()
        }
        .task {
            await workspace.load(userId: app.userId)
            await library.load()
            await scores.load(for: library.matches.filter { $0.status == .ready })
            library.startPolling()
            #if DEBUG
            if router.devOpenFirstStudent, let student = workspace.activeStudents.first {
                router.devOpenFirstStudent = false
                path.append(student)
            }
            if router.devOpenFirstEntry, let entry = workspace.entries.first {
                router.devOpenFirstEntry = false
                path.append(entry)
            }
            if router.devComposeWrite {
                router.devComposeWrite = false
                router.composeWrite = CoachComposerRequest(
                    mode: .write, student: workspace.activeStudents.first
                )
            }
            if router.devInvite {
                router.devInvite = false
                devInviteOpen = true
            }
            #endif
        }
        .onChange(of: library.matches) { _, matches in
            Task {
                await scores.load(for: matches.filter { $0.status == .ready })
            }
        }
    }
}

// MARK: - Tab bar

/// The player tab bar's twin, typed for the coach tabs. Same dress, same
/// heights, so switching workspaces moves the ground under your feet as
/// little as possible.
struct CoachTabBar: View {
    @Binding var selection: CoachTab

    var body: some View {
        HStack(spacing: 0) {
            ForEach(CoachTab.allCases) { item in
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

// MARK: - New entry chooser

/// How a new entry starts. Writing and recording are the two ways words
/// arrive; video is named so nobody hunts for it, and marked for later.
struct CoachNewEntrySheet: View {
    let student: CoachStudentRow?
    let onChoose: (CoachComposerRequest.Mode) -> Void

    var body: some View {
        PLChooserSheet(title: student.map { "New entry for \($0.displayName)" } ?? "New entry") {
            PLChooserRow(
                icon: "square.and.pencil",
                title: "Write it down",
                detail: "Type up notes from a lesson or a match."
            ) { onChoose(.write) }
            PLChooserRow(
                icon: "waveform",
                title: "Record audio",
                detail: "Talk through the lesson. It is written up for you."
            ) { onChoose(.record) }
            PLChooserRow(
                icon: "video",
                title: "Record video",
                detail: "Coming soon.",
                pending: true
            )
        }
    }
}

import SwiftUI

enum MainTab: String, CaseIterable, Identifiable {
    case home = "Home"
    case matches = "Matches"
    case journal = "Journal"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .home: "house"
        case .matches: "play.rectangle"
        case .journal: "book.closed"
        }
    }

    var iconFilled: String {
        switch self {
        case .home: "house.fill"
        case .matches: "play.rectangle.fill"
        case .journal: "book.closed.fill"
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

    @State private var path = NavigationPath()

    var body: some View {
        @Bindable var router = router
        NavigationStack(path: $path) {
            ZStack {
                ArenaBackground()
                Group {
                    switch router.tab {
                    case .home: HomeScreen()
                    case .matches: MatchesScreen()
                    case .journal: JournalScreen()
                    }
                }
            }
            .safeAreaInset(edge: .top, spacing: 0) { PLTopBar() }
            .safeAreaInset(edge: .bottom, spacing: 0) { PLTabBar(selection: $router.tab) }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: MatchRow.self) { match in
                MatchDetailScreen(match: match)
            }
        }
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
    var body: some View {
        HStack {
            LogoWordmark()
            Spacer()
            HStack(spacing: 14) {
                Button {} label: {
                    Image(systemName: "bell")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(PL.text400)
                }
                Button {} label: {
                    Circle()
                        .fill(PL.surface2)
                        .frame(width: 28, height: 28)
                        .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))
                        .overlay(
                            Image(systemName: "person.fill")
                                .font(.system(size: 12))
                                .foregroundStyle(PL.text500)
                        )
                }
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
}

// MARK: - Tab bar

struct PLTabBar: View {
    @Binding var selection: MainTab

    var body: some View {
        HStack(spacing: 0) {
            ForEach(MainTab.allCases) { item in
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

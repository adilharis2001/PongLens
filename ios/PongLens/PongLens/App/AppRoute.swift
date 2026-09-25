import SwiftUI

/// The destination behind every String route that either app workspace can
/// push. Keeping the resolution independent from SwiftUI makes the route
/// contract testable: a missing coach-side case must fail before it becomes
/// an `EmptyView` on a device.
enum AppRouteDestination: Equatable {
    case account
    case lessonVideo(UUID)
    case stats
    case statsTactics
    case starred
    case learn
    case tutorialVideos(LearnAudience)
    /// The board; `compose` raises the composer on arrival.
    case feedback(compose: Bool)
    /// One post and its thread.
    case feedbackItem(UUID)
    case matchFeedback(UUID)
    case coachOrders
    case coachOfferings
    case coachProfile
    case coachSponsored
    case guide(LearnGuide)
    /// Videos this phone kept for matches waiting to be marked.
    case deviceVideos
    /// The admin-only cutting speed test (hand cut step 0).
    case cuttingSpeedTest
    case unknown

    static func resolve(
        _ route: String,
        workspace: AppState.Workspace,
        catalog: LearnCatalogStore = .bundled
    ) -> AppRouteDestination {
        switch route {
        case "account": return .account
        case "stats": return .stats
        case "stats-tactics": return .statsTactics
        case "starred": return .starred
        case "learn": return .learn
        case "learn-videos":
            return .tutorialVideos(LearnAudience(workspace: workspace))
        case "feedback": return .feedback(compose: false)
        case "feedback-compose": return .feedback(compose: true)
        case "coach-orders": return .coachOrders
        case "coach-offerings": return .coachOfferings
        case "coach-profile": return .coachProfile
        case "coach-sponsored": return .coachSponsored
        case "device-videos": return .deviceVideos
        case "cutting-speed-test": return .cuttingSpeedTest
        default:
            if route.hasPrefix("match-feedback:"),
               let id = UUID(uuidString: String(route.dropFirst("match-feedback:".count))) {
                return .matchFeedback(id)
            }
            if route.hasPrefix("lesson-video:"),
               let id = UUID(uuidString: String(route.dropFirst("lesson-video:".count))) {
                return .lessonVideo(id)
            }
            if route.hasPrefix("feedback-item:"),
               let id = UUID(uuidString: String(route.dropFirst("feedback-item:".count))) {
                return .feedbackItem(id)
            }
            // "feedback:<match id>" used to open the composer with that
            // match attached. It no longer pre-selects anything (Adil,
            // 2026-09-16); the route still lands on the board so nothing
            // that linked it breaks.
            if route.hasPrefix("feedback:") {
                return .feedback(compose: false)
            }
            if route.hasPrefix("guide:"),
               let guide = catalog.guides(for: LearnAudience(workspace: workspace)).first(
                   where: { $0.slug == String(route.dropFirst(6)) }
               ) {
                return .guide(guide)
            }
            return .unknown
        }
    }
}

/// Render the shared String-route contract. What a workspace offers is still
/// decided where its links are shown; once a shared screen offers a link,
/// both navigation roots must be able to resolve it.
private struct AppRoute: View {
    let route: String
    @Environment(AppState.self) private var app

    /// Simulator QA only: the cutting speed test without an admin account,
    /// so a screenshot run can reach it signed in as the test account.
    #if DEBUG && targetEnvironment(simulator)
    private static let devCuttingTest = ProcessInfo.processInfo.arguments.contains("--dev-cutting-test")
    #else
    private static let devCuttingTest = false
    #endif

    var body: some View {
        destination(
            AppRouteDestination.resolve(route, workspace: app.workspace)
        )
    }

    @ViewBuilder
    private func destination(_ destination: AppRouteDestination) -> some View {
        switch destination {
        case .account:
            AccountScreen()
        case .lessonVideo(let id):
            LessonVideoDetailScreen(id: id)
        case .stats:
            StatsScreen()
        case .statsTactics:
            StatsScreen(initialTab: "Tactics")
        case .starred:
            StarredScreen()
        case .learn:
            LearnScreen()
        case .tutorialVideos(let audience):
            TutorialVideosScreen(audience: audience)
        case .feedback(let compose):
            FeedbackScreen(openCompose: compose)
        case .feedbackItem(let id):
            FeedbackThreadScreen(itemId: id)
        case .matchFeedback(let id):
            MatchProcessingFeedbackScreen(matchId: id)
        case .coachOrders:
            if AppConfig.coachMarketplace { CoachOrdersScreen() }
        case .coachOfferings:
            if AppConfig.coachMarketplace { CoachOfferingsScreen() }
        case .coachProfile:
            if AppConfig.coachMarketplace { CoachProfileScreen() }
        case .coachSponsored:
            if AppConfig.coachMarketplace { CoachSponsoredScreen() }
        case .guide(let guide):
            GuideDetailScreen(guide: guide)
        case .deviceVideos:
            DeviceVideosScreen()
        case .cuttingSpeedTest:
            // The row is admin only; so is the screen behind the route.
            if app.isAdmin || Self.devCuttingTest { HandCutBenchmarkScreen() }
        case .unknown:
            EmptyView()
        }
    }
}

extension View {
    /// Register every route that can leave a screen shared by the playing
    /// and coaching workspaces. Both root navigation stacks call this one
    /// registrar so adding a support destination cannot update only one side.
    func appRoutes() -> some View {
        navigationDestination(for: String.self) { route in
            AppRoute(route: route)
        }
        .navigationDestination(for: LearnVideosRoute.self) { route in
            TutorialVideosScreen(audience: route.audience)
        }
        .navigationDestination(for: LearnGuide.self) { guide in
            GuideDetailScreen(guide: guide)
        }
    }
}

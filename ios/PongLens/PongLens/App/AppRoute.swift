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
    case feedback(matchId: UUID?)
    case coachOrders
    case coachOfferings
    case coachProfile
    case coachSponsored
    case guide(LearnGuide)
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
        case "feedback": return .feedback(matchId: nil)
        case "coach-orders": return .coachOrders
        case "coach-offerings": return .coachOfferings
        case "coach-profile": return .coachProfile
        case "coach-sponsored": return .coachSponsored
        default:
            if route.hasPrefix("lesson-video:"),
               let id = UUID(uuidString: String(route.dropFirst("lesson-video:".count))) {
                return .lessonVideo(id)
            }
            if route.hasPrefix("feedback:"),
               let id = UUID(uuidString: String(route.dropFirst(9))) {
                return .feedback(matchId: id)
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
        case .feedback(let matchId):
            FeedbackScreen(matchId: matchId)
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

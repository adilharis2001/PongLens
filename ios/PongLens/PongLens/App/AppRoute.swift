import SwiftUI

/// Every String route the app pushes, resolved in one place.
///
/// This used to be written once per root. The playing side's copy had ten
/// cases; the coaching side's had one, and everything else fell through to
/// `EmptyView`. Account is shared by both sides, so its Support rows —
/// How-to guides, Tutorial videos, Feedback — pushed onto a stack that had
/// never heard of them and landed on a blank screen. No error, no crash,
/// nothing to search for: the row just took you somewhere empty.
///
/// So the table is stated once and both roots register it. Whether a side
/// should OFFER a route is decided where the row is drawn — Account
/// already hides the playing side's rooms behind `workspace != .coach` —
/// never by quietly leaving the route unresolvable.
struct AppRoute: View {
    let route: String

    var body: some View {
        switch route {
        case "account": AccountScreen()
        case "stats": StatsScreen()
        case "stats-tactics": StatsScreen(initialTab: "Tactics")
        case "starred": StarredScreen()
        case "learn": LearnScreen()
        case "learn-videos": TutorialVideosScreen()
        case "feedback": FeedbackScreen()
        // Marketplace screens: only the Coaching tab pushes these, and the
        // tab is gated on the same flag — a second fence around the same
        // boundary, not a separate decision.
        case "coach-orders": if AppConfig.coachMarketplace { CoachOrdersScreen() }
        case "coach-offerings": if AppConfig.coachMarketplace { CoachOfferingsScreen() }
        case "coach-profile": if AppConfig.coachMarketplace { CoachProfileScreen() }
        case "coach-sponsored": if AppConfig.coachMarketplace { CoachSponsoredScreen() }
        default:
            // "guide:<slug>" opens one Learn guide directly. It is resolved
            // HERE rather than pushing a GuideData, because the destination
            // for that type is declared inside LearnScreen — reachable only
            // once Learn is already on the stack, which is exactly not the
            // case when the first-steps checklist links to a guide from
            // Home.
            //
            // "feedback:<matchId>" opens the feedback board with that match
            // pre-selected — the match pages' "Report an issue" rows, so the
            // report arrives with context.
            if route.hasPrefix("feedback:"),
               let id = UUID(uuidString: String(route.dropFirst(9))) {
                FeedbackScreen(matchId: id)
            } else if route.hasPrefix("guide:"),
                      let guide = GuideLibrary.shared.guides.first(
                          where: { $0.slug == String(route.dropFirst(6)) }
                      ) {
                GuideDetailScreen(guide: guide)
            } else {
                EmptyView()
            }
        }
    }
}

extension View {
    /// Register the shared String routes on a navigation stack.
    ///
    /// Any stack that can reach a screen shared between the two sides needs
    /// this. A stack without it does not fail loudly — it pushes an empty
    /// view — so the rule is: if a root has a `NavigationStack` and a tab
    /// bar, it calls this.
    func appStringRoutes() -> some View {
        navigationDestination(for: String.self) { route in
            AppRoute(route: route)
        }
    }
}

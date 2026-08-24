import SwiftUI

/// Match-level placement: where the ball landed across every point with a
/// trusted bounce, always drawn with the user at the bottom — the web's
/// PlacementAggregate, sized for the app. Landings and a heat map, chosen
/// with a toggle rather than the web's swipe deck; the game filter stays
/// web-only for now.
struct PlacementAggregateSection: View {
    let points: [MatchPoint]
    let userSide: String?
    let gameIndexByPoint: [UUID: Int]
    let serving: [UUID: ServeInfo]
    let opponentLabel: String
    /// app_config placement_serves_only (132). The same switch the web
    /// reads, so one match cannot show serves in the browser and every
    /// landing here.
    var servesOnly = false

    private enum Who { case me, them }
    private enum Shot { case serves, rally }
    private enum Page { case landings, heat }

    @State private var who: Who = .me
    @State private var shot: Shot = .serves
    @State private var page: Page = .landings

    private let youColor = PL.cyan
    private let themColor = Color(hex: 0xF59E0B)

    private var unflagged: [MatchPoint] { unflaggedPlacementPoints(points) }

    private var allObservations: [TrustedPlacementObservation] {
        let collect = servesOnly
            ? collectServePlacementObservations
            : collectTrustedPlacementObservations
        return collect(unflagged, userSide, gameIndexByPoint, serving)
    }

    private var filter: PlacementAggregateFilter {
        if servesOnly { return who == .me ? .myServes : .theirServes }
        switch (who, shot) {
        case (.me, .serves): return .myServes
        case (.me, .rally): return .myRally
        case (.them, .serves): return .theirServes
        case (.them, .rally): return .theirRally
        }
    }

    var body: some View {
        let observations = allObservations
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                SectionHeading(servesOnly ? "Serve placement" : "Placement maps")
                Text("BETA")
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(0.5)
                    .foregroundStyle(PL.warningText.opacity(0.9))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(PL.warning.opacity(0.1), in: Capsule())
                    .overlay(Capsule().strokeBorder(PL.warning.opacity(0.25), lineWidth: 1))
            }

            VStack(alignment: .leading, spacing: 12) {
                if userSide == nil {
                    Text(servesOnly
                        ? "Tell us which side you played to orient the serve maps."
                        : "Tell us which side you played to orient the placement maps.")
                        .font(.plBody)
                        .foregroundStyle(PL.text400)
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                        .padding(.vertical, 20)
                } else if observations.isEmpty {
                    Text("No high-confidence placement data is available for this match yet.")
                        .font(.plBody)
                        .foregroundStyle(PL.text400)
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                        .padding(.vertical, 20)
                } else {
                    mapBody(observations)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .plCard()
        }
    }

    @ViewBuilder
    private func mapBody(_ observations: [TrustedPlacementObservation]) -> some View {
        let shown = observations.filter { $0.filter == filter }
        let used = trustedPlacementPointCount(observations)
        let total = unflagged.count

        Text(servesOnly
            ? "Serves mapped for \(used) of \(total) \(total == 1 ? "point" : "points")."
            : "Mapped for \(used) of \(total) \(total == 1 ? "point" : "points").")
            .font(.plCaption)
            .monospacedDigit()
            .foregroundStyle(PL.text500)

        HStack(spacing: 8) {
            segmented(
                [("Landings", Page.landings), ("Heat map", Page.heat)],
                active: page
            ) { page = $0 }
        }

        HStack(spacing: 8) {
            segmented(
                [("Me", Who.me), (opponentLabel, Who.them)], active: who
            ) { who = $0 }
            // Rally landings are not shown at the confidence they can be
            // reconstructed at, so there is no second thing to choose
            // between and the control comes off entirely.
            if !servesOnly {
                segmented(
                    [("Serves", Shot.serves), ("Rally", Shot.rally)], active: shot
                ) { shot = $0 }
            }
        }

        let tallies = placementZoneTallies(observations, filter: filter)
        let scored = placementZonesAreScored(tallies)

        if page == .heat {
            Text(placementHeatMapTitle(scored: scored))
                .font(.plCaption)
                .foregroundStyle(PL.text400)
                .frame(maxWidth: .infinity, alignment: .leading)
        }

        Group {
            if page == .heat {
                heatCanvas(tallies, scored: scored)
            } else {
                landingsCanvas(shown)
            }
        }
        .aspectRatio(PlacementTable.viewW / PlacementTable.viewH, contentMode: .fit)
        .frame(maxWidth: 260)
        .frame(maxWidth: .infinity)

        if shown.isEmpty {
            Text("No trusted landings in this view.")
                .font(.plCaption)
                .foregroundStyle(PL.text500)
                .frame(maxWidth: .infinity)
        } else {
            Text(caption(shown))
                .font(.system(size: 11))
                .foregroundStyle(PL.text500)
                .frame(maxWidth: .infinity)
                .multilineTextAlignment(.center)
        }
    }

    /// Nine squares over the receiver's half, shaded by how many serves
    /// landed in each and labelled with how many of those the server won.
    /// A port of buildPlacementHeatCells + PlacementHeatMap on the web,
    /// down to the thirds and the opacity ramp.
    private func heatCanvas(
        _ tallies: [PlacementZone: PlacementZoneTally], scored: Bool
    ) -> some View {
        Canvas { context, size in
            let s = size.width / PlacementTable.viewW
            drawPlacementTable(
                context, scale: s, topLabel: opponentLabel, bottomLabel: "Me"
            )
            let tone = who == .me ? youColor : themColor
            let maxTotal = max(1, tallies.values.map(\.total).max() ?? 0)
            let net = TABLE_L / 2
            let depthStep = net / 3
            let lateralStep = TABLE_W / 3
            let incoming = filter.landsOnUsersHalf

            for depth in PlacementDepth.allCases {
                for lateral in PlacementLateral.allCases {
                    let zone = PlacementZone(depth: depth, lateral: lateral)
                    let tally = tallies[zone] ?? PlacementZoneTally()
                    let u0 = Double(lateral.rawValue) * lateralStep
                    let u1 = lateral == .right
                        ? TABLE_W : Double(lateral.rawValue + 1) * lateralStep
                    let d = Double(depth.rawValue)
                    let v0: Double
                    let v1: Double
                    if incoming {
                        v0 = depth == .deep ? 0 : net - (d + 1) * depthStep
                        v1 = depth == .short ? net : net - d * depthStep
                    } else {
                        v0 = depth == .deep
                            ? TABLE_L - depthStep : net + d * depthStep
                        v1 = depth == .deep ? TABLE_L : net + (d + 1) * depthStep
                    }
                    let x = PlacementTable.x + PlacementTable.w * u0 / TABLE_W
                    let y = PlacementTable.y
                        + PlacementTable.h * (1 - v1 / TABLE_L)
                    let w = PlacementTable.w * (u1 - u0) / TABLE_W
                    let h = PlacementTable.h * (v1 - v0) / TABLE_L
                    let rect = CGRect(
                        x: x * s, y: y * s, width: w * s, height: h * s
                    )
                    var layer = context
                    layer.opacity = tally.total == 0
                        ? 0.06
                        : 0.12 + 0.68 * (Double(tally.total) / Double(maxTotal))
                    layer.fill(Path(rect), with: .color(tone))
                    context.stroke(
                        Path(rect),
                        with: .color(Color(hex: 0x94A3B8).opacity(0.32)),
                        lineWidth: 0.75 * s
                    )
                    guard tally.total > 0 else { continue }
                    let label = scored && tally.scored > 0
                        ? "\(tally.won)/\(tally.scored)"
                        : "\(tally.total)"
                    context.draw(
                        Text(label)
                            .font(.system(
                                size: (scored && tally.scored > 0 ? 10 : 11) * s,
                                weight: .bold
                            ))
                            .foregroundStyle(Color(hex: 0xF8FAFC)),
                        at: CGPoint(x: rect.midX, y: rect.midY)
                    )
                }
            }
        }
    }

    private func landingsCanvas(_ shown: [TrustedPlacementObservation]) -> some View {
        Canvas { context, size in
            let s = size.width / PlacementTable.viewW
            drawPlacementTable(
                context, scale: s, topLabel: opponentLabel, bottomLabel: "Me"
            )
            let tone = who == .me ? youColor : themColor
            for observation in shown {
                let x = PlacementTable.x + PlacementTable.w * observation.u / TABLE_W
                let y = PlacementTable.y + PlacementTable.h * (1 - observation.v / TABLE_L)
                let r = 5.0 * s
                let dot = Path(ellipseIn: CGRect(
                    x: x * s - r, y: y * s - r, width: 2 * r, height: 2 * r
                ))
                var layer = context
                layer.opacity = 0.52
                layer.fill(dot, with: .color(tone))
                context.stroke(dot, with: .color(Color(hex: 0x0C1222)), lineWidth: 0.75 * s)
            }
        }
    }

    /// The one line under the map: what a dot means for this filter, then
    /// how much data is behind it.
    private func caption(_ shown: [TrustedPlacementObservation]) -> String {
        let what = switch filter {
        case .myServes: "Where your serves landed"
        case .theirServes: "Where their serves landed"
        case .myRally: "Your non-serve shots that bounced on their side"
        case .theirRally: "Their non-serve shots that bounced on your side"
        }
        let landings = shown.count
        let pointCount = trustedPlacementPointCount(shown)
        return "\(what) · \(landings) \(landings == 1 ? "landing" : "landings") from \(pointCount) \(pointCount == 1 ? "point" : "points")"
    }

    private func segmented<T: Equatable>(
        _ options: [(String, T)], active: T, pick: @escaping (T) -> Void
    ) -> some View {
        HStack(spacing: 2) {
            ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                let isActive = option.1 == active
                Button(option.0) { pick(option.1) }
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(isActive ? PL.cyan : PL.text500)
                    .lineLimit(1)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(isActive ? PL.cyan.opacity(0.15) : .clear, in: Capsule())
                    .buttonStyle(.plain)
            }
        }
        .padding(2)
        .background(PL.ink.opacity(0.4), in: Capsule())
        .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
    }
}

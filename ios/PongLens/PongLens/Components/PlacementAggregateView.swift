import SwiftUI

/// The serve maps as two cards of the Match analysis deck: where the
/// serves landed, and the same landings as a heat map with win rates. A
/// port of the web's PlacementAggregate, sized for the app; the two cards
/// share whose serves are drawn through the bindings the deck owns, so
/// switching on one switches the other, exactly as the web's control does.
/// The game filter stays web-only for now.
enum PlacementMapPage { case landings, heat }
enum PlacementMapWho { case me, them }
enum PlacementMapShot { case serves, rally }

struct PlacementMapCard: View {
    let page: PlacementMapPage
    let points: [MatchPoint]
    let userSide: String?
    let gameIndexByPoint: [UUID: Int]
    let serving: [UUID: ServeInfo]
    let opponentLabel: String
    /// app_config placement_serves_only (132). The same switch the web
    /// reads, so one match cannot show serves in the browser and every
    /// landing here.
    var servesOnly = false
    @Binding var who: PlacementMapWho
    @Binding var shot: PlacementMapShot
    /// Open one point from a zone's list. Nil leaves the zones as pictures.
    var onOpenPoint: ((MatchPoint) -> Void)? = nil

    /// The zone the owner tapped, with the points behind its number.
    @State private var zoneSheet: ZoneSheet?

    private struct ZoneSheet: Identifiable {
        let id = UUID()
        let zone: PlacementZone
        let points: [MatchPoint]
    }

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
        let shown = observations.filter { $0.filter == filter }
        let tallies = placementZoneTallies(observations, filter: filter)
        let scored = placementZonesAreScored(tallies)
        let title = page == .landings
            ? (servesOnly ? "Serve landings" : "Landings")
            : placementHeatMapTitle(scored: scored)
        let tappable = page == .heat && onOpenPoint != nil && !shown.isEmpty

        ScoredCardStyle.card(
            title,
            hint: tappable ? "Tap a zone to see its points" : hint(shown),
            beta: true
        ) {
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
                    controls
                    Group {
                        if page == .heat {
                            heatCanvas(tallies, scored: scored, tappable: tappable)
                                .onTapGesture { location in
                                    guard tappable else { return }
                                    openZone(at: location, shown: shown)
                                }
                        } else {
                            landingsCanvas(shown)
                        }
                    }
                    .aspectRatio(PlacementTable.viewW / PlacementTable.viewH, contentMode: .fit)
                    .frame(maxWidth: 240)
                    .frame(maxWidth: .infinity)
                    if shown.isEmpty {
                        Text("No trusted landings in this view.")
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                            .frame(maxWidth: .infinity)
                    } else if tappable {
                        Text(hint(shown) ?? "")
                            .font(.system(size: 11))
                            .foregroundStyle(PL.text500)
                            .frame(maxWidth: .infinity)
                            .multilineTextAlignment(.center)
                    }
                }
            }
        }
        .sheet(item: $zoneSheet) { sheet in
            ZonePointsSheet(
                zone: sheet.zone,
                points: sheet.points,
                gameIndexByPoint: gameIndexByPoint,
                allPoints: points,
                whose: who == .me ? "you" : opponentLabel,
                servesOnly: servesOnly,
                onOpen: { point in
                    zoneSheet = nil
                    onOpenPoint?(point)
                }
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
    }

    /// A tap on the drawn table: which square, and which points landed in
    /// it. Geometry mirrors heatCanvas exactly, in the canvas's own points.
    private func openZone(at location: CGPoint, shown: [TrustedPlacementObservation]) {
        let width = 240.0
        let s = width / PlacementTable.viewW
        let x = location.x / s
        let y = location.y / s
        guard x >= PlacementTable.x, x <= PlacementTable.x + PlacementTable.w,
              y >= PlacementTable.y, y <= PlacementTable.y + PlacementTable.h
        else { return }
        let u = (x - PlacementTable.x) / PlacementTable.w * TABLE_W
        let v = (1 - (y - PlacementTable.y) / PlacementTable.h) * TABLE_L
        guard let zone = placementZone(u: u, v: v, filter: filter) else { return }
        let ids = shown
            .filter { placementZone(u: $0.u, v: $0.v, filter: filter) == zone }
            .map(\.pointId)
        guard !ids.isEmpty else { return }
        let byIndex = points.enumerated().filter { ids.contains($0.element.id) }
        zoneSheet = ZoneSheet(zone: zone, points: byIndex.map(\.element))
    }

    /// The one line under the title: what a dot means for this filter,
    /// then how much data is behind it.
    private func hint(_ shown: [TrustedPlacementObservation]) -> String? {
        guard userSide != nil, !shown.isEmpty else { return nil }
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

    private var controls: some View {
        HStack(spacing: 8) {
            segmented([("Me", PlacementMapWho.me), (opponentLabel, .them)], active: who) { who = $0 }
            // Rally landings are not shown at the confidence they can be
            // reconstructed at, so there is no second thing to choose
            // between and the control comes off entirely.
            if !servesOnly {
                segmented([("Serves", PlacementMapShot.serves), ("Rally", .rally)], active: shot) { shot = $0 }
            }
        }
    }

    /// Nine squares over the receiver's half, shaded by how many serves
    /// landed in each and labelled with how many of those the server won.
    /// A port of buildPlacementHeatCells + PlacementHeatMap on the web,
    /// down to the thirds and the opacity ramp.
    private func heatCanvas(
        _ tallies: [PlacementZone: PlacementZoneTally], scored: Bool, tappable: Bool
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
                    // The underline is the tap affordance: a number you can
                    // open, not a label.
                    context.draw(
                        Text(label)
                            .font(.system(
                                size: (scored && tally.scored > 0 ? 10 : 11) * s,
                                weight: .bold
                            ))
                            .underline(tappable)
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


/// The points behind one heat-map square, in timeline order, each opening
/// the point. The web's zone sheet, as a PLSheetScaffold + Form like every
/// other sheet on this screen.
struct ZonePointsSheet: View {
    let zone: PlacementZone
    let points: [MatchPoint]
    let gameIndexByPoint: [UUID: Int]
    let allPoints: [MatchPoint]
    let whose: String
    let servesOnly: Bool
    let onOpen: (MatchPoint) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        PLSheetScaffold(title: readableZone(zone).capitalized) {
            Form {
                Section {
                    ForEach(points, id: \.id) { point in
                        Button {
                            dismiss()
                            onOpen(point)
                        } label: {
                            HStack(spacing: 12) {
                                (Text("Point \((allPoints.firstIndex { $0.id == point.id } ?? 0) + 1)")
                                    .font(.plRowTitle)
                                    .foregroundStyle(PL.text100)
                                    + Text("  Game \((gameIndexByPoint[point.id] ?? 0) + 1)")
                                    .font(.plCaption)
                                    .foregroundStyle(PL.text500))
                                Spacer()
                                Text(outcome(point))
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(outcomeColor(point))
                            }
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                } footer: {
                    Text("\(points.count) \(points.count == 1 ? "point" : "points") with a \(servesOnly ? "serve" : "shot") by \(whose) landing here.")
                }
            }
        }
    }

    private func outcome(_ point: MatchPoint) -> String {
        switch point.confirmedWinner {
        case .user: "You won"
        case .opponent: "They won"
        default: "Not scored"
        }
    }

    private func outcomeColor(_ point: MatchPoint) -> Color {
        switch point.confirmedWinner {
        case .user: PL.cyan
        case .opponent: PL.magentaSoft
        default: PL.text500
        }
    }
}

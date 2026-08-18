import SwiftUI

// placementTable.tsx geometry, shared by the per-point map and the
// match-level aggregate. One coordinate space: 230x356 canvas units.
enum PlacementTable {
    static let viewW = 230.0
    static let viewH = 356.0
    static let x = 35.0
    static let y = 40.0
    static let w = 160.0
    static let h = 280.0
    static var netY: Double { y + h / 2 }
}

/// The table itself — surface, net, center line, end labels — drawn the
/// same way wherever landings appear.
func drawPlacementTable(
    _ context: GraphicsContext, scale s: Double, topLabel: String, bottomLabel: String
) {
    let rect = CGRect(
        x: PlacementTable.x * s, y: PlacementTable.y * s,
        width: PlacementTable.w * s, height: PlacementTable.h * s
    )
    let tablePath = Path(roundedRect: rect, cornerRadius: 5 * s)
    context.fill(tablePath, with: .color(Color(hex: 0x0F2557)))
    context.stroke(tablePath, with: .color(Color(hex: 0xCBD5E1)), lineWidth: 2 * s)

    var net = Path()
    net.move(to: CGPoint(x: rect.minX, y: PlacementTable.netY * s))
    net.addLine(to: CGPoint(x: rect.maxX, y: PlacementTable.netY * s))
    context.stroke(
        net, with: .color(Color(hex: 0xF8FAFC)),
        style: StrokeStyle(lineWidth: 2.5 * s, dash: [5 * s, 3 * s])
    )

    var center = Path()
    center.move(to: CGPoint(x: rect.midX, y: rect.minY))
    center.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
    context.stroke(center, with: .color(Color(hex: 0x64748B)), lineWidth: 1 * s)

    context.draw(
        Text(topLabel).font(.system(size: 11 * s, weight: .semibold))
            .foregroundColor(Color(hex: 0xA1A1AA)),
        at: CGPoint(x: rect.midX, y: (PlacementTable.y - 18) * s)
    )
    context.draw(
        Text(bottomLabel).font(.system(size: 11 * s, weight: .semibold))
            .foregroundColor(Color(hex: 0xA1A1AA)),
        at: CGPoint(x: rect.midX, y: (PlacementTable.y + PlacementTable.h + 26) * s)
    )
}

/// "Where the ball landed" — the per-point placement card, a straight port
/// of the web's PlacementMap + placementTable: Trajectory/Landing views,
/// whose-shots filter, the vertical shot strip (All / S / … / F), arrows
/// with derived carry lines, terminal X marks, and the won / net-out rings.
struct PlacementMapView: View {
    let placement: PlacementData
    let userSide: String? // matches.user_side
    let gameIndex: Int // 0-based; players change ends each game
    let opponentLabel: String
    /// Rotation-derived physical side of this point's server, when known.
    let serverPhysicalSide: String?
    let flagged: Bool
    let onFlagToggle: () -> Void
    /// Owner-only: write matches.user_side from the orientation prompt.
    var onSetUserSide: ((String) -> Void)?
    /// "Tell us more" on the marked-wrong notice.
    var onTellUsMore: (() -> Void)?

    private enum ViewMode: String, CaseIterable {
        case trajectory = "Trajectory", landing = "Landing"
    }
    private enum Whose { case me, them, both }

    @State private var mode: ViewMode = .trajectory
    @State private var whose: Whose = .both
    /// 1-based cutoff of shots to show; nil = the whole rally. Not
    /// persisted — "through shot 3" means nothing on the next point.
    @State private var through: Int?

    // placementTable.tsx geometry, in one coordinate space.
    private let VIEW_W = 230.0
    private let VIEW_H = 356.0
    private let TX = 35.0
    private let TY = 40.0
    private let TW = 160.0
    private let TH = 280.0
    private var NET_Y: Double { TY + TH / 2 }

    private let youColor = PL.cyan
    private let themColor = Color(hex: 0xF59E0B)
    private let wonRing = Color(hex: 0x34D399)
    private let missRing = Color(hex: 0xF87171)

    private var tagged: Bool { userSide != nil }
    /// The physical side drawn at the bottom for this point.
    private var bottom: String {
        guard let userSide else { return "near" }
        return physicalSideForGame(userSide, gameIndex: gameIndex)
    }

    private var hypothesis: PlacementHypothesis? {
        guard case .v3(let data) = placement else { return nil }
        return selectPlacementHypothesis(data, serverSide: serverPhysicalSide)
    }

    private var model: PlacementRenderModel? {
        hypothesis.map { buildPlacementRenderModel($0, through: through) }
    }

    var body: some View {
        if flagged {
            markedWrong
        } else {
            VStack(spacing: 10) {
                if !tagged {
                    Text("CAMERA VIEW · NEAR PLAYER AT THE BOTTOM")
                        .font(.system(size: 10, weight: .medium))
                        .tracking(0.5)
                        .foregroundStyle(PL.text500)
                    if let onSetUserSide {
                        orientationPrompt(onSetUserSide)
                    }
                }
                switch placement {
                case .v3:
                    v3Body
                case .v2(let bounces):
                    v2Body(bounces)
                case .v1(let bounces):
                    v1Body(bounces)
                }
                Button {
                    onFlagToggle()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "flag")
                            .font(.system(size: 12))
                            .foregroundStyle(PL.text600)
                        Text("Looks wrong")
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                    }
                }
                .buttonStyle(.plain)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    // MARK: - Flagged / prompts

    private var markedWrong: some View {
        HStack(spacing: 12) {
            HStack(spacing: 6) {
                Image(systemName: "flag")
                    .font(.system(size: 12))
                    .foregroundStyle(PL.warningText.opacity(0.8))
                Text("Marked wrong")
                    .font(.plCaption)
                    .foregroundStyle(PL.text400)
            }
            Button("Undo") { onFlagToggle() }
                .font(.plCaption)
                .foregroundStyle(PL.text500)
                .underline()
                .buttonStyle(.plain)
            if let onTellUsMore {
                Button("Tell us more") { onTellUsMore() }
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                    .underline()
                    .buttonStyle(.plain)
            }
            Spacer()
        }
    }

    private func orientationPrompt(_ pick: @escaping (String) -> Void) -> some View {
        VStack(spacing: 8) {
            Text("Which end are you?")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(PL.text200)
            HStack(spacing: 8) {
                orientationButton("Near", detail: "bottom of video") { pick("near") }
                orientationButton("Far", detail: "top of video") { pick("far") }
            }
            Text("We'll orient the map so you're always at the bottom.")
                .font(.system(size: 10))
                .foregroundStyle(PL.text500)
        }
        .frame(maxWidth: .infinity)
        .padding(12)
        .background(PL.cyan.opacity(0.06), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(PL.cyan.opacity(0.3), lineWidth: 1)
        )
    }

    private func orientationButton(
        _ label: String, detail: String, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Text(label)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PL.text200)
                Text(detail)
                    .font(.system(size: 10))
                    .foregroundStyle(PL.text500)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(PL.ink.opacity(0.4), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - v3

    @ViewBuilder
    private var v3Body: some View {
        if let hypothesis {
            let notice = placementHypothesisNotice(hypothesis)
            if notice?.mode == .hidden {
                Text(notice!.message)
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                    .multilineTextAlignment(.center)
                    .padding(.vertical, 8)
            } else if let model {
                if let notice, notice.mode == .review {
                    Text(notice.message)
                        .font(.system(size: 11))
                        .foregroundStyle(PL.text500)
                        .multilineTextAlignment(.center)
                }
                controls
                HStack(alignment: .top, spacing: 8) {
                    tableCanvas(model)
                        .aspectRatio(VIEW_W / VIEW_H, contentMode: .fit)
                        .frame(maxWidth: 240)
                    if model.totalCount >= 2 {
                        shotStrip(total: model.totalCount)
                    }
                }
                if model.shownCount < model.totalCount {
                    Text("Showing \(model.shownCount) of \(model.totalCount) shots.")
                        .font(.system(size: 10))
                        .foregroundStyle(PL.text500)
                }
                legend(showRing: true)
            }
        } else {
            VStack(spacing: 4) {
                Text("Confirm who served to unlock this map")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(PL.text200)
                Text("The two camera-side reconstructions are too close to choose safely.")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 20)
            .padding(.horizontal, 16)
            .background(PL.cyan.opacity(0.05), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(PL.cyan.opacity(0.25), lineWidth: 1)
            )
        }
    }

    private var controls: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                segmented(
                    ViewMode.allCases.map(\.rawValue),
                    active: mode.rawValue
                ) { mode = ViewMode(rawValue: $0) ?? .trajectory }
                segmented(
                    ["Me", opponentLabel, "Both"],
                    active: whose == .me ? "Me" : whose == .them ? opponentLabel : "Both"
                ) { picked in
                    whose = picked == "Me" ? .me : picked == opponentLabel ? .them : .both
                }
            }
        }
    }

    private struct ShotStep: Identifiable {
        let id: String
        let label: String
        let value: Int?
    }

    private func shotSteps(total: Int) -> [ShotStep] {
        var steps = [ShotStep(id: "all", label: "All", value: nil)]
        for n in 1...total {
            let label = n == 1 ? "S" : (n == total ? "F" : String(n))
            steps.append(ShotStep(id: String(n), label: label, value: n))
        }
        return steps
    }

    private func shotStrip(total: Int) -> some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: 4) {
                ForEach(shotSteps(total: total)) { step in
                    shotStepButton(step)
                }
            }
        }
        .frame(maxHeight: 356)
        .fixedSize(horizontal: true, vertical: false)
    }

    private func shotStepButton(_ step: ShotStep) -> some View {
        let active = through == step.value
        return Button(step.label) { through = step.value }
            .font(.system(size: 11, weight: .semibold))
            .monospacedDigit()
            .foregroundStyle(active ? PL.cyan : PL.text500)
            .frame(width: 36)
            .padding(.vertical, 4)
            .background(
                active ? PL.cyan.opacity(0.15) : PL.ink.opacity(0.4),
                in: Capsule()
            )
            .overlay(
                Capsule().strokeBorder(
                    active ? PL.cyan.opacity(0.6) : PL.edge, lineWidth: 1
                )
            )
            .buttonStyle(.plain)
    }

    /// Meters → canvas points, oriented so `bottom` is at the bottom,
    /// clamped just past the table edge (out-of-table markers stay visible).
    private func mapXY(_ p: PlacementMapPointM, scale: Double) -> CGPoint {
        let fu = bottom == "near" ? 1 - p.u / TABLE_W : p.u / TABLE_W
        let fv = bottom == "near" ? 1 - p.v / TABLE_L : p.v / TABLE_L
        return CGPoint(
            x: min(max(TX + TW * fu, TX - 12), TX + TW + 12) * scale,
            y: min(max(TY + TH * fv, TY - 14), TY + TH + 14) * scale
        )
    }

    private func colorFor(hitter: String) -> Color {
        if tagged {
            return hitter == bottom ? youColor : themColor
        }
        return hitter == "far" ? youColor : themColor
    }

    private func hitterVisible(_ hitter: String) -> Bool {
        switch whose {
        case .both: return true
        case .me: return tagged ? hitter == bottom : hitter == "near"
        case .them: return tagged ? hitter != bottom : hitter != "near"
        }
    }

    private func tableCanvas(_ model: PlacementRenderModel) -> some View {
        Canvas { context, size in
            let s = size.width / VIEW_W
            drawTable(context, scale: s)

            let isLanding = mode == .landing
            for segment in model.segments where hitterVisible(segment.hitterSide) {
                let color = colorFor(hitter: segment.hitterSide)
                let opacity = hypothesis?.status == "review"
                    ? max(0.42, segment.confidence * 0.78)
                    : max(0.55, segment.confidence)
                var layer = context
                layer.opacity = opacity

                let from = segment.from.map { mapXY($0, scale: s) }
                let to = segment.to.map { mapXY($0, scale: s) }
                let carry = (segment.carryTo != nil && segment.terminal == nil)
                    ? mapXY(segment.carryTo!, scale: s) : nil

                if !isLanding, let from, let to {
                    var line = Path()
                    line.move(to: from)
                    line.addLine(to: to)
                    layer.stroke(
                        line, with: .color(color),
                        style: StrokeStyle(
                            lineWidth: 2 * s, lineCap: .round,
                            dash: segment.fromContext ? [3 * s, 3 * s] : []
                        )
                    )
                    drawArrowhead(layer, from: from, to: to, color: color, scale: s)
                }
                if !isLanding, let to, let carry {
                    var line = Path()
                    line.move(to: to)
                    line.addLine(to: carry)
                    var faded = layer
                    faded.opacity = opacity * 0.75
                    faded.stroke(
                        line, with: .color(color),
                        style: StrokeStyle(lineWidth: 1.4 * s, lineCap: .round, dash: [2 * s, 3 * s])
                    )
                }
                if let firstBounce = segment.serveFirstBounce {
                    let p = mapXY(firstBounce, scale: s)
                    let r = 2.6 * s
                    layer.stroke(
                        Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r)),
                        with: .color(color), lineWidth: 1.4 * s
                    )
                }
                if segment.fromContext, let from, !isLanding {
                    let r = 3 * s
                    var faint = layer
                    faint.opacity = opacity * 0.28
                    faint.fill(
                        Path(ellipseIn: CGRect(x: from.x - r, y: from.y - r, width: 2 * r, height: 2 * r)),
                        with: .color(color)
                    )
                }
                if let to {
                    let r = (segment.phase == "serve" ? 6.0 : 4.5) * s
                    layer.fill(
                        Path(ellipseIn: CGRect(x: to.x - r, y: to.y - r, width: 2 * r, height: 2 * r)),
                        with: .color(color)
                    )
                    layer.stroke(
                        Path(ellipseIn: CGRect(x: to.x - r, y: to.y - r, width: 2 * r, height: 2 * r)),
                        with: .color(Color(hex: 0x0C1222)), lineWidth: 1 * s
                    )
                    layer.draw(
                        Text(segment.phase == "serve" ? "S" : "\(segment.shotNumber)")
                            .font(.system(size: 7.5 * s, weight: .heavy))
                            .foregroundColor(Color(hex: 0x0C1222)),
                        at: to
                    )
                }
                if segment.phase == "final", let to, segment.terminal == nil {
                    let r = 8 * s
                    layer.stroke(
                        Path(ellipseIn: CGRect(x: to.x - r, y: to.y - r, width: 2 * r, height: 2 * r)),
                        with: .color(wonRing), lineWidth: 2.4 * s
                    )
                }
                if let terminal = segment.terminal, let anchor = to ?? from {
                    drawTerminal(
                        layer, terminal: terminal, anchor: anchor,
                        segment: segment, isLanding: isLanding, scale: s
                    )
                }
            }
        }
    }

    private func drawArrowhead(
        _ context: GraphicsContext, from: CGPoint, to: CGPoint, color: Color, scale: Double
    ) {
        let dx = to.x - from.x
        let dy = to.y - from.y
        let len = max(1, hypot(dx, dy))
        let ux = dx / len
        let uy = dy / len
        let size = 5.0 * scale
        let tip = to
        let base = CGPoint(x: tip.x - ux * size, y: tip.y - uy * size)
        var path = Path()
        path.move(to: tip)
        path.addLine(to: CGPoint(x: base.x - uy * size * 0.5, y: base.y + ux * size * 0.5))
        path.addLine(to: CGPoint(x: base.x + uy * size * 0.5, y: base.y - ux * size * 0.5))
        path.closeSubpath()
        context.fill(path, with: .color(color))
    }

    private func drawTerminal(
        _ context: GraphicsContext, terminal: PlacementTerminal, anchor: CGPoint,
        segment: PlacementRenderSegment, isLanding: Bool, scale: Double
    ) {
        var end: CGPoint?
        if terminal.kind == "net" {
            end = CGPoint(x: anchor.x, y: NET_Y * scale)
        } else if terminal.kind == "out" {
            let receiver = segment.hitterSide == "near" ? "far" : "near"
            let u = segment.to?.u ?? segment.from?.u ?? TABLE_W / 2
            let edge = mapXY(
                PlacementMapPointM(u: u, v: receiver == "near" ? 0 : TABLE_L), scale: scale
            )
            end = CGPoint(
                x: edge.x,
                y: edge.y < NET_Y * scale ? edge.y - 11 * scale : edge.y + 11 * scale
            )
        }
        guard let end else {
            // winner_landing / unknown: ring on the landing itself.
            let ring = terminal.kind == "winner_landing" ? wonRing : missRing
            let r = (isLanding ? 8.5 : 7.5) * scale
            var layer = context
            layer.opacity = 0.85
            layer.stroke(
                Path(ellipseIn: CGRect(x: anchor.x - r, y: anchor.y - r, width: 2 * r, height: 2 * r)),
                with: .color(ring), lineWidth: 2.5 * scale
            )
            return
        }
        var layer = context
        layer.opacity = 0.85
        if !isLanding {
            var line = Path()
            line.move(to: anchor)
            line.addLine(to: end)
            layer.stroke(
                line, with: .color(missRing),
                style: StrokeStyle(lineWidth: 1.7 * scale, dash: [3 * scale, 2.5 * scale])
            )
        }
        let d = 3.5 * scale
        var x = Path()
        x.move(to: CGPoint(x: end.x - d, y: end.y - d))
        x.addLine(to: CGPoint(x: end.x + d, y: end.y + d))
        x.move(to: CGPoint(x: end.x - d, y: end.y + d))
        x.addLine(to: CGPoint(x: end.x + d, y: end.y - d))
        layer.stroke(
            x, with: .color(missRing),
            style: StrokeStyle(lineWidth: 2 * scale, lineCap: .round)
        )
    }

    private func drawTable(_ context: GraphicsContext, scale s: Double) {
        drawPlacementTable(
            context, scale: s,
            topLabel: tagged ? opponentLabel : "Far player",
            bottomLabel: tagged ? "Me" : "Near player"
        )
    }

    // MARK: - v2 / v1 fallbacks

    @ViewBuilder
    private func v2Body(_ bounces: [PlacementBounceV2Row]) -> some View {
        controls
        v2Canvas(bounces)
            .aspectRatio(VIEW_W / VIEW_H, contentMode: .fit)
            .frame(maxWidth: 240)
        legend(showRing: true)
    }

    private func v2Canvas(_ bounces: [PlacementBounceV2Row]) -> some View {
        Canvas { context, size in
            let s = size.width / VIEW_W
            drawTable(context, scale: s)
            let chain = bounces.sorted { $0.seq < $1.seq }.filter { $0.role != "serve_1" }
            guard !chain.isEmpty else { return }
            let serverSide = serverPhysicalSide ?? chain[0].hitterSide ?? "near"
            func ownerOf(_ i: Int, _ b: PlacementBounceV2Row) -> String {
                if serverPhysicalSide != nil {
                    return i % 2 == 0 ? serverSide : otherSide(serverSide)
                }
                return b.hitterSide ?? "near"
            }
            let origin = mapXY(
                PlacementMapPointM(u: TABLE_W / 2, v: serverSide == "near" ? 0 : TABLE_L),
                scale: s
            )
            let n = chain.count
            func fade(_ i: Int) -> Double { n <= 3 ? 1 : 0.35 + 0.65 * Double(i) / Double(n - 1) }
            let pts = chain.map { mapXY(PlacementMapPointM(u: $0.u, v: $0.v), scale: s) }

            for (i, b) in chain.enumerated() {
                let owner = ownerOf(i, b)
                guard hitterVisible(owner) else { continue }
                let color = colorFor(hitter: owner)
                var layer = context
                layer.opacity = fade(i)
                let to = pts[i]
                let isServe = b.role == "serve_2"
                if mode == .landing {
                    let r = (isServe ? 6.0 : 5.0) * s
                    layer.fill(
                        Path(ellipseIn: CGRect(x: to.x - r, y: to.y - r, width: 2 * r, height: 2 * r)),
                        with: .color(color)
                    )
                    if isServe {
                        layer.draw(
                            Text("S").font(.system(size: 8 * s, weight: .heavy))
                                .foregroundColor(Color(hex: 0x0C1222)),
                            at: to
                        )
                    }
                } else {
                    let from = i == 0 ? origin : pts[i - 1]
                    var line = Path()
                    line.move(to: from)
                    line.addLine(to: to)
                    layer.stroke(
                        line, with: .color(color),
                        style: StrokeStyle(lineWidth: 2 * s, lineCap: .round)
                    )
                    drawArrowhead(layer, from: from, to: to, color: color, scale: s)
                    layer.draw(
                        Text(i == 0 ? "S" : "\(i + 1)")
                            .font(.system(size: 8 * s, weight: .bold))
                            .foregroundColor(color),
                        at: CGPoint(
                            x: to.x - (to.y - from.y) / max(1, hypot(to.x - from.x, to.y - from.y)) * 9 * s,
                            y: to.y + (to.x - from.x) / max(1, hypot(to.x - from.x, to.y - from.y)) * 9 * s
                        )
                    )
                }
                if i == n - 1, b.role == "final" {
                    let ringColor = b.finalKind == "winner_landing"
                        ? wonRing
                        : b.finalKind == "net" || b.finalKind == "out_adjacent"
                            ? missRing : Color(hex: 0x94A3B8)
                    let r = (mode == .landing ? 8.5 : 7.5) * s
                    context.stroke(
                        Path(ellipseIn: CGRect(x: to.x - r, y: to.y - r, width: 2 * r, height: 2 * r)),
                        with: .color(ringColor), lineWidth: 2.5 * s
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func v1Body(_ bounces: [PlacementBounceV1Row]) -> some View {
        v1Canvas(bounces)
            .aspectRatio(VIEW_W / VIEW_H, contentMode: .fit)
            .frame(maxWidth: 240)
        legend(showRing: false)
    }

    private func v1Canvas(_ bounces: [PlacementBounceV1Row]) -> some View {
        Canvas { context, size in
            let s = size.width / VIEW_W
            drawTable(context, scale: s)
            for (i, b) in bounces.enumerated() {
                let p = mapXY(PlacementMapPointM(u: b.u, v: b.v), scale: s)
                let side = b.side ?? "near"
                let color = tagged
                    ? (side == bottom ? youColor : themColor)
                    : (side == "far" ? youColor : themColor)
                let r = 8.0 * s
                context.fill(
                    Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r)),
                    with: .color(color)
                )
                context.stroke(
                    Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r)),
                    with: .color(.white), lineWidth: 1.5 * s
                )
                context.draw(
                    Text(i == 0 ? "S" : "\(i + 1)")
                        .font(.system(size: 9 * s, weight: .bold))
                        .foregroundColor(Color(hex: 0x0C1222)),
                    at: p
                )
            }
        }
    }

    // MARK: - Legend + controls

    private func legend(showRing: Bool) -> some View {
        let youLabel = tagged ? "Me" : "Far player"
        let themLabel = tagged ? opponentLabel : "Near player"
        return VStack(spacing: 4) {
            HStack(spacing: 12) {
                legendDot(youColor, "\(youLabel) shots")
                legendDot(themColor, "\(themLabel) shots")
                HStack(spacing: 4) {
                    Text("S").font(.system(size: 10, weight: .bold)).foregroundStyle(PL.text300)
                    Text("serve").font(.system(size: 10)).foregroundStyle(PL.text500)
                }
            }
            if showRing {
                HStack(spacing: 12) {
                    HStack(spacing: 5) {
                        Line().stroke(
                            PL.text500, style: StrokeStyle(lineWidth: 1.4, dash: [2, 3])
                        )
                        .frame(width: 14, height: 1)
                        Text("carried to the end")
                            .font(.system(size: 10)).foregroundStyle(PL.text500)
                    }
                    legendRing(wonRing, "won")
                    legendRing(missRing, "net / out")
                }
            }
        }
    }

    private func legendDot(_ color: Color, _ label: String) -> some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label).font(.system(size: 10)).foregroundStyle(PL.text500)
        }
    }

    private func legendRing(_ color: Color, _ label: String) -> some View {
        HStack(spacing: 4) {
            Circle().strokeBorder(color, lineWidth: 1.5).frame(width: 9, height: 9)
            Text(label).font(.system(size: 10)).foregroundStyle(PL.text500)
        }
    }

    private func segmented(
        _ options: [String], active: String, pick: @escaping (String) -> Void
    ) -> some View {
        HStack(spacing: 2) {
            ForEach(options, id: \.self) { option in
                let isActive = option == active
                Button(option) { pick(option) }
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

/// A 1pt horizontal line shape, for the dashed legend swatch.
private struct Line: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.midY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        return p
    }
}

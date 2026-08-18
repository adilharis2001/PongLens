import SwiftUI

/// "Where the ball landed" — the per-point placement card. Trajectory and
/// Landing views over the navy table, drawn to the web's exact palette:
/// table #0F2557, slate border, dashed white net, grey center line.
struct PlacementMapView: View {
    let placement: PlacementData
    let userSide: String?
    let opponentLabel: String
    let flagged: Bool
    let onFlagToggle: () -> Void

    private enum ViewMode: String, CaseIterable { case trajectory = "Trajectory", landing = "Landing" }
    private enum Whose: String, CaseIterable { case me = "Me", them = "Them", both = "Both" }

    @State private var mode: ViewMode = .trajectory
    @State private var whose: Whose = .both

    private let tableFill = Color(hex: 0x0F2557)
    private let tableBorder = Color(hex: 0xCBD5E1)
    private let centerLine = Color(hex: 0x64748B)
    private let themColor = Color(hex: 0xF59E0B)

    private var shots: [PlacementShot] {
        guard case .v3(let data) = placement else { return [] }
        let near = data.hypotheses.near
        let far = data.hypotheses.far
        let pick: PlacementHypothesis
        if near.status == "ready", far.status != "ready" { pick = near }
        else if far.status == "ready", near.status != "ready" { pick = far }
        else { pick = (near.confidence ?? 0) >= (far.confidence ?? 0) ? near : far }
        return pick.shots
    }

    private var hasTrajectory: Bool {
        if case .v3 = placement { return !shots.isEmpty }
        return false
    }

    var body: some View {
        if flagged {
            VStack(alignment: .leading, spacing: 8) {
                Text("Marked as wrong. It's out of every aggregate view.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
                Button("Undo") { onFlagToggle() }
                    .buttonStyle(PLSecondaryButtonStyle())
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            VStack(spacing: 14) {
                HStack {
                    if hasTrajectory {
                        segments(ViewMode.allCases.map(\.rawValue), active: mode.rawValue) {
                            mode = ViewMode(rawValue: $0) ?? .trajectory
                        }
                    }
                    Spacer()
                    segments(
                        [Whose.me.rawValue, opponentLabel, Whose.both.rawValue],
                        active: whose == .them ? opponentLabel : whose.rawValue
                    ) { picked in
                        if picked == opponentLabel { whose = .them }
                        else { whose = Whose(rawValue: picked) ?? .both }
                    }
                }

                Text(opponentLabel)
                    .font(.plCaption)
                    .foregroundStyle(PL.text400)

                table
                    .aspectRatio(230.0 / 320.0, contentMode: .fit)
                    .frame(maxWidth: 280)

                Text("Me")
                    .font(.plCaption)
                    .foregroundStyle(PL.text400)

                legend

                Button {
                    onFlagToggle()
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "flag")
                            .font(.system(size: 13))
                        Text("Looks wrong")
                    }
                    .font(.plBody)
                    .foregroundStyle(PL.text500)
                }
                .buttonStyle(.plain)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var table: some View {
        Canvas { context, size in
            let rect = CGRect(origin: .zero, size: size).insetBy(dx: 2, dy: 2)
            let tablePath = Path(roundedRect: rect, cornerRadius: 5)
            context.fill(tablePath, with: .color(tableFill))
            context.stroke(tablePath, with: .color(tableBorder), lineWidth: 2)

            var center = Path()
            center.move(to: CGPoint(x: rect.midX, y: rect.minY))
            center.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
            context.stroke(center, with: .color(centerLine), lineWidth: 1)

            var net = Path()
            net.move(to: CGPoint(x: rect.minX - 2, y: rect.midY))
            net.addLine(to: CGPoint(x: rect.maxX + 2, y: rect.midY))
            context.stroke(
                net, with: .color(Color(hex: 0xF8FAFC)),
                style: StrokeStyle(lineWidth: 2.5, dash: [5, 3])
            )

            func canvasPoint(_ u: Double, _ v: Double) -> CGPoint {
                let n = placementXY(u: u, v: v, userSide: userSide)
                return CGPoint(
                    x: rect.minX + n.x * rect.width,
                    y: rect.minY + n.y * rect.height
                )
            }

            func isMine(_ hitterSide: String) -> Bool {
                (userSide ?? "near") == hitterSide
            }

            switch placement {
            case .v3:
                // The ball's path: successive bounces connected, each segment
                // colored by the shot that produced its ending bounce.
                struct Marker {
                    let point: CGPoint
                    let color: Color
                    let label: String
                    let show: Bool
                    let terminalKind: String?
                }
                var markers: [Marker] = []
                for shot in shots.sorted(by: { $0.seq < $1.seq }) {
                    let mine = isMine(shot.hitterSide)
                    let color = mine ? PL.cyan : themColor
                    let show: Bool = {
                        switch whose {
                        case .both: true
                        case .me: mine
                        case .them: !mine
                        }
                    }()
                    if let s = shot.serveFirstBounce, let su = s.u, let sv = s.v {
                        markers.append(Marker(
                            point: canvasPoint(su, sv), color: color,
                            label: "S", show: show, terminalKind: nil
                        ))
                    }
                    if let l = shot.landing, let lu = l.u, let lv = l.v {
                        markers.append(Marker(
                            point: canvasPoint(lu, lv), color: color,
                            label: shot.phase == "serve" ? "S" : "\(shot.seq)",
                            show: show,
                            terminalKind: shot.terminal?.kind
                        ))
                    } else if let t = shot.terminal, let tu = t.u, let tv = t.v {
                        markers.append(Marker(
                            point: canvasPoint(tu, tv), color: color,
                            label: "\(shot.seq)", show: show,
                            terminalKind: t.kind
                        ))
                    }
                }
                if whose == .both {
                    for i in 1..<max(1, markers.count) where markers.count >= 2 {
                        var line = Path()
                        line.move(to: markers[i - 1].point)
                        line.addLine(to: markers[i].point)
                        context.stroke(line, with: .color(markers[i].color), lineWidth: 2.5)
                    }
                }
                for m in markers where m.show {
                    drawMarker(context, at: m.point, color: m.color, label: m.label)
                    if let kind = m.terminalKind {
                        let ring = kind == "winner_landing" ? PL.success : PL.dangerFill
                        let ringRect = CGRect(
                            x: m.point.x - 9, y: m.point.y - 9, width: 18, height: 18
                        )
                        context.stroke(Path(ellipseIn: ringRect), with: .color(ring), lineWidth: 2)
                    }
                }
            case .v2(let bounces):
                for b in bounces {
                    let mine = isMine(b.hitterSide ?? "near")
                    if whose == .me, !mine { continue }
                    if whose == .them, mine { continue }
                    let p = canvasPoint(b.u, b.v)
                    drawMarker(
                        context, at: p, color: mine ? PL.cyan : themColor,
                        label: b.role.hasPrefix("serve") ? "S" : "\(b.seq)"
                    )
                }
            case .v1(let bounces):
                for (i, b) in bounces.enumerated() {
                    let p = canvasPoint(b.u, b.v)
                    drawMarker(context, at: p, color: PL.cyan, label: "\(i + 1)")
                }
            }
        }
    }

    private func drawMarker(_ context: GraphicsContext, at p: CGPoint, color: Color, label: String) {
        let dot = CGRect(x: p.x - 6, y: p.y - 6, width: 12, height: 12)
        context.fill(Path(ellipseIn: dot), with: .color(color))
        context.stroke(Path(ellipseIn: dot), with: .color(Color(hex: 0x0C1222)), lineWidth: 1.5)
        context.draw(
            Text(label).font(.system(size: 7, weight: .bold)).foregroundColor(Color(hex: 0x0C1222)),
            at: p
        )
    }

    private var legend: some View {
        HStack(spacing: 14) {
            legendDot(PL.cyan, "Me shots")
            legendDot(themColor, "\(opponentLabel) shots")
            HStack(spacing: 4) {
                Text("S").font(.system(size: 11, weight: .bold)).foregroundStyle(PL.text300)
                Text("serve").font(.plCaption).foregroundStyle(PL.text500)
            }
        }
    }

    private func legendDot(_ color: Color, _ label: String) -> some View {
        HStack(spacing: 5) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label).font(.plCaption).foregroundStyle(PL.text500)
        }
    }

    private func segments(
        _ options: [String], active: String, pick: @escaping (String) -> Void
    ) -> some View {
        HStack(spacing: 2) {
            ForEach(options, id: \.self) { option in
                let isActive = option == active
                Button(option) { pick(option) }
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(isActive ? PL.cyan : PL.text500)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(isActive ? PL.cyan.opacity(0.15) : .clear, in: Capsule())
                    .overlay(
                        Capsule().strokeBorder(isActive ? PL.cyan.opacity(0.6) : .clear, lineWidth: 1)
                    )
                    .buttonStyle(.plain)
            }
        }
        .padding(2)
        .background(PL.ink.opacity(0.4), in: Capsule())
        .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
    }
}

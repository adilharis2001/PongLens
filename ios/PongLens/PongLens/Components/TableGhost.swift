import SwiftUI
import AVFoundation
import UIKit
import simd

/// The Record tab's placement guide: a table drawn in true perspective from
/// a camera position mined out of every match that calibrated well
/// (worker/mine_record_poses.py over 61 hand-marked production matches).
/// The user lines the real table up with the ghost and inherits a proven
/// angle instead of an illustrated one.
///
/// World frame matches the worker's: x runs along the table's length with
/// the near end at -1.370 m, y across the width (positive toward the
/// camera-left corner), z up from the TABLE SURFACE — heights here are
/// above the table, not the floor.
enum GhostPose {
    // The median proven-good camera, metres.
    static let behind = 2.4           // behind the near end line
    static let height = 0.90          // above the table surface

    /// How far round from the end of the table the ghost stands, in
    /// degrees off the long axis measured at the table's centre.
    ///
    /// This is the number that decides whether the serve is readable, and
    /// it is held CONSTANT along the whole corridor. It used to be a fixed
    /// 2.74 m out from the centre line, which meant stepping back swung
    /// the camera toward end-on: measured over the corridor, the drawn
    /// pose fell from 1.00 foreshortening at the near end to 0.45 at the
    /// far end. Every match whose serve detector works sits at 0.73 or
    /// above; the three that collapse to 6-15% sit at 0.25 to 0.32. So the
    /// old corridor taught people to walk out of the working range.
    ///
    /// 38 degrees holds 0.75 the whole way along, and keeps the sideways
    /// room needed under 3.6 m, which real halls have. Measured against 61
    /// hand-marked matches in docs/research/2026-08-21-serve-angle-audit.md.
    static let axisDegrees = 38.0

    /// Metres out from the centre line for a given step back, holding the
    /// angle. The table's half length is the pivot, because the angle is
    /// measured at its centre.
    static func lateral(behind: Double) -> Double {
        tan(axisDegrees * .pi / 180) * (behind + 2.740 / 2)
    }

    /// How far back the drag travels. The near end is the mined 15th
    /// percentile as before; the far end is no longer the 85th (4.09),
    /// because holding the angle out there needs 4.2 m of side room that
    /// no hall reliably has. 3.20 m back needs 3.57 m across, which the
    /// corpus shows is reachable.
    static let behindRange = 1.49...3.20
    // The ghost camera looks at a point above the far half so the table
    // sits low in frame and the far player's space stays visible.
    static let target = SIMD3<Double>(0, 0, 0.4)
    // Horizontal field of view to assume when no capture device answers
    // (the simulator, the gallery): an iPhone main camera filming 16:9.
    static let fallbackFOV = 66.0
}

private let tableL = 2.740, tableW = 1.525
private let netZ = 0.1525, netOverhang = 0.1525

struct TableGhost: View {
    /// Roll in degrees from the motion manager; drawn as the level line.
    let level: Double
    var session: AVCaptureSession? = nil
    /// The live table check. Optional twice over: the model may be absent
    /// and the user may prefer the plain ghost — either way this view
    /// behaves exactly as it did before the engine existed.
    var finder: TableFinderEngine? = nil
    /// Whether to draw the target table. Off when the live check is the
    /// chosen overlay: two quads over a busy hall is more picture than
    /// anyone can read, and the check's caption already says where to go.
    var showTarget = true

    @AppStorage("pl-ghost-side") private var rightSide = true
    /// True once the user has flipped the side by hand. From then on the
    /// handedness default keeps its opinion to itself.
    @AppStorage("pl-ghost-side-chosen") private var sideChosen = false
    @AppStorage("pl-ghost-behind") private var behind = GhostPose.behind
    @State private var dragStart: Double?
    @State private var distanceShown = false
    /// A manual gesture quiets the live check briefly — the user is
    /// saying "let me drive" and the ghost should not fight them.
    @State private var manualUntil = Date.distantPast
    @State private var goodAnnounced = false
    /// Long-press anywhere on the ghost: the engine's one-line truth.
    @State private var showDiag = false
    /// Drives the searching dot's breathing.
    @State private var pulse = false

    /// The theme gallery's way of showing the detected state without a
    /// camera: fixed corners, rendered exactly as a live find would be.
    var previewDetection: [SIMD2<Double>]? = nil
    /// Same, for the amber "found but the gate said no" state.
    var previewDebug: [SIMD2<Double>]? = nil
    /// The gallery's way of showing a worded state: beside a sighting it
    /// is a framing cue, on its own it is the reason nothing was found.
    var previewNote: String? = nil
    /// The gallery's way of showing the angle meter without a camera.
    var previewAngle: Double? = nil
    /// Which side the profile's handedness says to start on, or nil when
    /// the profile does not say. Only a DEFAULT: it applies while the
    /// user has never touched the flip, and the flip wins forever after.
    var preferredRightSide: Bool? = nil

    /// The engine's word, unless the user recently took the wheel.
    private var liveState: TableFinderEngine.State? {
        if let previewDetection { return .good(previewDetection) }
        if previewDebug != nil { return .sighted(previewNote) }
        if let previewNote { return .searching(previewNote) }
        guard let finder, Date() >= manualUntil,
              finder.recording == false else { return nil }
        return finder.state
    }

    /// Where the model currently thinks the table is. Drawn whether or
    /// not the gate accepted it, because "I can see it, I am not sure
    /// about your angle yet" is useful and silence is not. A manual
    /// gesture does not suppress this the way it suppresses the verdict:
    /// the user resizing the target still wants to see the real table.
    private var liveSighting: [SIMD2<Double>]? {
        if let previewDebug { return previewDebug }
        guard let finder, finder.recording == false else { return nil }
        return finder.sighting
    }

    var body: some View {
        GeometryReader { geo in
            let camera = GhostCamera(
                behind: clampedBehind,
                lateral: rightSide
                    ? -GhostPose.lateral(behind: clampedBehind)
                    : GhostPose.lateral(behind: clampedBehind),
                height: GhostPose.height,
                fovDegrees: Self.horizontalFOV(of: session),
                size: geo.size
            )
            ZStack {
                Canvas { context, size in
                    if case .good(let corners) = liveState {
                        drawDetected(corners, size: size, in: &context)
                    } else {
                        if showTarget { drawTable(camera, in: &context) }
                        // Two quads: teal is where to aim, amber is where
                        // the table actually is. Walking them together is
                        // the whole instruction, and it survives not
                        // reading the caption. Amber, never green — this
                        // is "seen", not "accepted".
                        if let sighted = liveSighting {
                            drawDetected(sighted, size: size, in: &context,
                                         tint: Color(hex: 0xFBBF24))
                        } else if showDiag, let raw = finder?.debugCorners {
                            // Under the confidence bar. Only worth seeing
                            // with the readout up, and in a colour that
                            // cannot be mistaken for a real sighting.
                            drawDetected(raw, size: size, in: &context,
                                         tint: Color(hex: 0xF87171))
                        }
                    }
                    drawLevelLine(size: size, in: &context)
                }
                overlayChrome(height: geo.size.height)
            }
            .contentShape(Rectangle())
            // Only when the target is drawn: there is nothing to adjust
            // otherwise, and a stray touch would silence the live check
            // for four seconds for no reason.
            .gesture(showTarget ? ghostDrag(height: geo.size.height) : nil)
            .onAppear {
                pulse = true
                if !sideChosen, let preferred = preferredRightSide {
                    rightSide = preferred
                }
            }
            .onChange(of: finder?.sighting == nil) { _, lost in
                // A light tick the moment the table is picked up. At
                // exactly that point the user is looking at the tripod
                // rather than the screen, which is the case every
                // scanning SDK adds haptics for.
                if lost == false {
                    UIImpactFeedbackGenerator(style: .light)
                        .impactOccurred()
                }
            }
            .onChange(of: liveState) { _, next in
                if case .good = next {
                    if !goodAnnounced {
                        goodAnnounced = true
                        UINotificationFeedbackGenerator()
                            .notificationOccurred(.success)
                    }
                } else {
                    goodAnnounced = false
                }
            }
        }
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0.6).onEnded { _ in
                showDiag.toggle()
            }
        )
        .overlay(alignment: .bottomTrailing) {
            if showDiag, let finder {
                Text(finder.diag)
                    .font(.system(size: 10, weight: .medium,
                                  design: .monospaced))
                    .foregroundStyle(.white.opacity(0.85))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Color.black.opacity(0.6),
                                in: RoundedRectangle(cornerRadius: 8))
                    .padding(.trailing, 96)
                    .padding(.bottom, 12)
            }
        }
    }

    /// The detected table, drawn where it actually is: model-input pixels
    /// mapped through the aspect-fill the preview uses (video width fits
    /// the view width; the vertical crop is centred).
    private func drawDetected(_ corners: [SIMD2<Double>], size: CGSize,
                              in context: inout GraphicsContext,
                              tint: Color? = nil) {
        let scaleX = size.width / Double(TableFinderCore.inputWidth)
        let frameH = size.width * 9 / 16
        let scaleY = frameH / Double(TableFinderCore.inputHeight)
        let yOffset = (frameH - size.height) / 2
        let mapped = corners.map {
            CGPoint(x: $0.x * scaleX, y: $0.y * scaleY - yOffset)
        }
        guard mapped.count == 4 else { return }
        let green = tint ?? Color(hex: 0x34D399)

        var quad = Path()
        quad.move(to: mapped[0])
        for point in mapped.dropFirst() { quad.addLine(to: point) }
        quad.closeSubpath()
        context.fill(quad, with: .color(green.opacity(0.12)))
        context.stroke(quad, with: .color(green.opacity(0.9)),
                       style: StrokeStyle(lineWidth: 2.5))

        // The net's base, by the same midpoint approximation the offline
        // scoring validated.
        let netLeft = CGPoint(x: (mapped[0].x + mapped[3].x) / 2,
                              y: (mapped[0].y + mapped[3].y) / 2)
        let netRight = CGPoint(x: (mapped[1].x + mapped[2].x) / 2,
                               y: (mapped[1].y + mapped[2].y) / 2)
        var net = Path()
        net.move(to: netLeft)
        net.addLine(to: netRight)
        context.stroke(net, with: .color(green.opacity(0.5)),
                       style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))

        for (index, point) in mapped.enumerated() {
            let r: CGFloat = index < 2 ? 5 : 4
            context.fill(
                Path(ellipseIn: CGRect(x: point.x - r, y: point.y - r,
                                       width: r * 2, height: r * 2)),
                with: .color(green))
        }
    }

    private var clampedBehind: Double {
        min(max(behind, GhostPose.behindRange.lowerBound),
            GhostPose.behindRange.upperBound)
    }

    /// One finger, up and down: how far back the target camera stands.
    ///
    /// Up moves the drawn table up the frame and shrinks it, which is
    /// what standing further back looks like — the finger and the table
    /// travel together, so there is nothing to learn. The corridor's ends
    /// are the closest and farthest cameras that ever processed well.
    ///
    /// One finger rather than two because two now belong to the camera's
    /// zoom, which is where a pinch belongs in anything with a viewfinder.
    private func ghostDrag(height: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in
                if dragStart == nil { dragStart = clampedBehind }
                manualUntil = Date().addingTimeInterval(4)
                let span = GhostPose.behindRange.upperBound
                    - GhostPose.behindRange.lowerBound
                // The whole corridor in about two thirds of the screen's
                // height: a comfortable thumb travel rather than a swipe
                // that runs off the edge before it arrives.
                let travel = Double(max(1, height * 0.66))
                let moved = Double(value.translation.height) / travel * span
                behind = min(
                    max((dragStart ?? behind) - moved,
                        GhostPose.behindRange.lowerBound),
                    GhostPose.behindRange.upperBound
                )
                distanceShown = true
            }
            .onEnded { _ in
                dragStart = nil
                Task {
                    try? await Task.sleep(nanoseconds: 1_400_000_000)
                    withAnimation(.easeOut(duration: 0.3)) { distanceShown = false }
                }
            }
    }

    // MARK: - Chrome

    /// The advice that stands whether or not the check ever works.
    private var placementLine: String {
        rightSide
            ? "Stand behind the right corner, about head height"
            : "Stand behind the left corner, about head height"
    }

    private var captionText: String {
        switch liveState {
        case .good:
            return "That's the angle. Tap record."
        case .adjust(let cue):
            return cue
        case .sighted(let cue):
            // A cue when the table is running off the frame, and the
            // plain fact otherwise: seen, angle still being judged.
            return cue ?? "Found the table. Checking the angle."
        case .searching(let reason):
            // With nothing specific to report, the placement instruction
            // stays put rather than becoming "looking for the table". If
            // the model never finds it, the last thing on screen should
            // still be the advice that gets the user to a usable angle
            // on their own. The dot is what says the check is running.
            return reason ?? placementLine
        case nil:
            return placementLine
        }
    }

    private var captionColor: Color {
        switch liveState {
        case .good: Color(hex: 0x34D399)
        case .adjust, .sighted: Color(hex: 0xFBBF24)
        // A stated reason is something the user may be able to fix, so
        // it reads as a nudge; the standing placement line does not.
        case .searching(let reason):
            reason == nil
                ? Color(hex: 0x2DD4BF).opacity(0.9)
                : Color(hex: 0xFBBF24)
        case nil: Color(hex: 0x2DD4BF).opacity(0.9)
        }
    }

    /// The live check as one dot: grey and breathing while it looks,
    /// amber once it can see the table, green when the angle is right.
    /// Nil when no engine is running, so the pill looks exactly as it
    /// did before any of this existed.
    private var statusColor: Color? {
        switch liveState {
        case .good: Color(hex: 0x34D399)
        case .adjust, .sighted: Color(hex: 0xFBBF24)
        case .searching: Color.white.opacity(0.6)
        case nil: nil
        }
    }

    /// The check's one number made visible: how far round the side the
    /// camera stands, as a dot travelling toward the green zone. The cue
    /// above says which way to walk; this shows the walk working, which
    /// is the difference between an instruction and feedback. 33 degrees
    /// is where the cue stops (TableFinderCore.verdict), 38 is the arc
    /// the ghost teaches, so the zone's left edge is the moment the
    /// nagging ends.
    private func angleMeter(_ angle: Double) -> some View {
        let lo = 15.0, hi = 48.0, zone = 33.0
        let frac = min(max((angle - lo) / (hi - lo), 0), 1)
        let zoneFrac = (zone - lo) / (hi - lo)
        let inZone = angle >= zone
        return GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.22))
                Capsule()
                    .fill(Color(hex: 0x34D399).opacity(0.45))
                    .frame(width: geo.size.width * (1 - zoneFrac))
                    .offset(x: geo.size.width * zoneFrac)
                Circle()
                    .fill(inZone ? Color(hex: 0x34D399) : Color(hex: 0xFBBF24))
                    .frame(width: 8, height: 8)
                    .offset(x: geo.size.width * frac - 4, y: -2.5)
                    .animation(.easeOut(duration: 0.25), value: frac)
            }
        }
        .frame(width: 128, height: 3)
        .padding(.top, 2)
    }

    private var isSearching: Bool {
        if case .searching = liveState { return true }
        return false
    }

    private func overlayChrome(height: CGFloat) -> some View {
        VStack(spacing: 8) {
            HStack(spacing: 7) {
                if let statusColor {
                    Circle()
                        .fill(statusColor)
                        .frame(width: 6, height: 6)
                        .opacity(isSearching && pulse ? 0.25 : 1)
                        .animation(
                            isSearching
                                ? .easeInOut(duration: 0.9)
                                    .repeatForever(autoreverses: true)
                                : .easeInOut(duration: 0.2),
                            value: pulse)
                }
                Text(captionText)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(captionColor)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color.black.opacity(0.45), in: Capsule())
            .padding(.top, height * 0.18)
            .animation(.easeInOut(duration: 0.2), value: captionText)

            if let angle = previewAngle ?? finder?.liveAngle,
               liveState != nil {
                angleMeter(angle)
            }

            if distanceShown {
                Text(String(format: "%.1f m behind the end line", clampedBehind))
                    .font(.system(size: 11, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(.white.opacity(0.85))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Color.black.opacity(0.45), in: Capsule())
                    .transition(.opacity)
            }

            Spacer()

            HStack {
                Button {
                    sideChosen = true
                    manualUntil = Date().addingTimeInterval(4)
                    withAnimation(.easeInOut(duration: 0.25)) { rightSide.toggle() }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.left.arrow.right")
                            .font(.system(size: 11, weight: .semibold))
                        Text(rightSide ? "Right side" : "Left side")
                            .font(.system(size: 13, weight: .semibold))
                    }
                    .foregroundStyle(PL.text200)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(Color.black.opacity(0.45), in: Capsule())
                    .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                }
                .buttonStyle(.plain)
                Spacer()
            }
            .padding(.leading, 76)
            .padding(.bottom, 18)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Drawing

    private func drawTable(_ camera: GhostCamera, in context: inout GraphicsContext) {
        let teal = Color(hex: 0x2DD4BF)
        let purple = Color(hex: 0xA855F7)
        let halfW = tableW / 2, halfL = tableL / 2

        // Corners in canonical order: A near-left, B near-right,
        // C far-right, D far-left.
        let corners = [
            SIMD3<Double>(-halfL, halfW, 0), SIMD3<Double>(-halfL, -halfW, 0),
            SIMD3<Double>(halfL, -halfW, 0), SIMD3<Double>(halfL, halfW, 0),
        ]
        guard let quad = camera.path(closed: true, corners) else { return }

        context.fill(quad, with: .color(teal.opacity(0.10)))
        context.stroke(quad, with: .color(teal.opacity(0.75)),
                       style: StrokeStyle(lineWidth: 2))

        // The near end line carries the pipeline's one hard rule — near
        // end lower in frame — so it reads a touch heavier.
        if let nearEdge = camera.path([corners[0], corners[1]]) {
            context.stroke(nearEdge, with: .color(teal.opacity(0.95)),
                           style: StrokeStyle(lineWidth: 3))
        }

        // Centre line down the length, like the table's own.
        if let centre = camera.path([
            SIMD3<Double>(-halfL, 0, 0), SIMD3<Double>(halfL, 0, 0),
        ]) {
            context.stroke(centre, with: .color(.white.opacity(0.22)),
                           style: StrokeStyle(lineWidth: 1))
        }

        // The net: mesh, tape and posts, purple as it always has been.
        let postY = halfW + netOverhang
        let mesh = [
            SIMD3<Double>(0, -postY, 0), SIMD3<Double>(0, postY, 0),
            SIMD3<Double>(0, postY, netZ), SIMD3<Double>(0, -postY, netZ),
        ]
        if let net = camera.path(closed: true, mesh) {
            context.fill(net, with: .color(purple.opacity(0.10)))
        }
        if let tape = camera.path([mesh[3], mesh[2]]) {
            context.stroke(tape, with: .color(purple.opacity(0.8)),
                           style: StrokeStyle(lineWidth: 2))
        }
        for side in [-postY, postY] {
            if let post = camera.path([
                SIMD3<Double>(0, side, 0), SIMD3<Double>(0, side, netZ),
            ]) {
                context.stroke(post, with: .color(purple.opacity(0.6)),
                               style: StrokeStyle(lineWidth: 2))
            }
        }

        // Corner dots: snap targets, the near pair brighter.
        for (index, corner) in corners.enumerated() {
            guard let p = camera.project(corner) else { continue }
            let near = index < 2
            let r: CGFloat = near ? 5 : 4
            context.fill(
                Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r,
                                       width: r * 2, height: r * 2)),
                with: .color(teal.opacity(near ? 0.95 : 0.6))
            )
        }
    }

    /// The roll indicator, unchanged from the first guide: cyan when the
    /// hold is level, amber with the degrees when it isn't.
    private func drawLevelLine(size: CGSize, in context: inout GraphicsContext) {
        let isLevel = abs(level) < 2.5
        let lineColor = isLevel ? Color(hex: 0x22D3EE) : Color(hex: 0xFBBF24)
        let cx = size.width / 2
        let cy = size.height * 0.12
        let half = size.width * 0.12
        let tilt = CGFloat(level * .pi / 180)
        var horizon = Path()
        horizon.move(to: CGPoint(x: cx - cos(tilt) * half, y: cy - sin(tilt) * half))
        horizon.addLine(to: CGPoint(x: cx + cos(tilt) * half, y: cy + sin(tilt) * half))
        context.stroke(horizon, with: .color(lineColor.opacity(0.9)), lineWidth: 2)
        context.draw(
            Text(isLevel ? "Level" : String(format: "%+.0f°", level))
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(lineColor),
            at: CGPoint(x: cx, y: cy - 14)
        )
    }

    /// Horizontal field of view of the live camera, degrees. The preview
    /// fills the screen aspect-fill, and a landscape phone screen is wider
    /// than 16:9 video, so the video's full width maps onto the view's —
    /// which makes the horizontal FOV the one number the projection needs.
    static func horizontalFOV(of session: AVCaptureSession?) -> Double {
        let device = session?.inputs
            .compactMap { $0 as? AVCaptureDeviceInput }
            .first { $0.device.hasMediaType(.video) }?
            .device
        guard let fov = device.map({ Double($0.activeFormat.videoFieldOfView) }),
              fov > 1 else { return GhostPose.fallbackFOV }
        return fov
    }
}

/// A pinhole camera over the table's world frame: position from the mined
/// pose, orientation from a look-at, focal length from the real lens.
struct GhostCamera {
    private let position: SIMD3<Double>
    private let right: SIMD3<Double>
    private let down: SIMD3<Double>
    private let forward: SIMD3<Double>
    private let focal: Double
    private let centre: CGPoint

    init(behind: Double, lateral: Double, height: Double,
         fovDegrees: Double, size: CGSize) {
        position = SIMD3<Double>(-tableL / 2 - behind, lateral, height)
        forward = simd_normalize(GhostPose.target - position)
        right = simd_normalize(simd_cross(forward, SIMD3<Double>(0, 0, 1)))
        down = simd_cross(forward, right)
        focal = Double(size.width) / 2 / tan(fovDegrees * .pi / 360)
        centre = CGPoint(x: size.width / 2, y: size.height / 2)
    }

    func project(_ world: SIMD3<Double>) -> CGPoint? {
        let v = world - position
        let z = simd_dot(v, forward)
        guard z > 0.05 else { return nil }
        return CGPoint(
            x: centre.x + focal * simd_dot(v, right) / z,
            y: centre.y + focal * simd_dot(v, down) / z
        )
    }

    func path(closed: Bool = false, _ points: [SIMD3<Double>]) -> Path? {
        let projected = points.compactMap(project)
        guard projected.count == points.count, let first = projected.first
        else { return nil }
        var path = Path()
        path.move(to: first)
        for point in projected.dropFirst() { path.addLine(to: point) }
        if closed { path.closeSubpath() }
        return path
    }
}

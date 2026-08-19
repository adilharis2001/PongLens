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
    static let behind = 2.82          // behind the near end line
    static let lateral = 2.74         // out from the table's centre line
    static let height = 0.90          // above the table surface
    // The 15th-85th percentile corridor of distances that processed well;
    // the pinch gesture travels this and nothing outside it.
    static let behindRange = 1.49...4.09
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

    @AppStorage("pl-ghost-side") private var rightSide = true
    @AppStorage("pl-ghost-behind") private var behind = GhostPose.behind
    @State private var pinchStart: Double?
    @State private var distanceShown = false
    /// A manual gesture quiets the live check briefly — the user is
    /// saying "let me drive" and the ghost should not fight them.
    @State private var manualUntil = Date.distantPast
    @State private var goodAnnounced = false
    /// Long-press anywhere on the ghost: the engine's one-line truth.
    @State private var showDiag = false

    /// The theme gallery's way of showing the detected state without a
    /// camera: fixed corners, rendered exactly as a live find would be.
    var previewDetection: [SIMD2<Double>]? = nil
    /// Same, for the amber "found but the gate said no" state.
    var previewDebug: [SIMD2<Double>]? = nil

    /// The engine's word, unless the user recently took the wheel.
    private var liveState: TableFinderEngine.State? {
        if let previewDetection { return .good(previewDetection) }
        guard let finder, Date() >= manualUntil,
              finder.recording == false else { return nil }
        return finder.state
    }

    var body: some View {
        GeometryReader { geo in
            let camera = GhostCamera(
                behind: clampedBehind,
                lateral: rightSide ? -GhostPose.lateral : GhostPose.lateral,
                height: GhostPose.height,
                fovDegrees: Self.horizontalFOV(of: session),
                size: geo.size
            )
            ZStack {
                Canvas { context, size in
                    if case .good(let corners) = liveState {
                        drawDetected(corners, size: size, in: &context)
                    } else {
                        drawTable(camera, in: &context)
                        // With the readout up, show what the model found
                        // even when the gate turned it down. Amber, never
                        // green: this is "seen, not accepted".
                        if showDiag || previewDebug != nil,
                           let raw = previewDebug ?? finder?.debugCorners {
                            drawDetected(raw, size: size, in: &context,
                                         tint: Color(hex: 0xFBBF24))
                        }
                    }
                    drawLevelLine(size: size, in: &context)
                }
                overlayChrome(height: geo.size.height)
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
        .contentShape(Rectangle())
        .gesture(pinch)
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

    /// Pinch out = the table grows = step closer. The corridor's ends are
    /// the closest and farthest cameras that ever processed well.
    private var pinch: some Gesture {
        MagnificationGesture()
            .onChanged { value in
                if pinchStart == nil { pinchStart = clampedBehind }
                manualUntil = Date().addingTimeInterval(4)
                behind = min(
                    max((pinchStart ?? behind) / Double(value),
                        GhostPose.behindRange.lowerBound),
                    GhostPose.behindRange.upperBound
                )
                distanceShown = true
            }
            .onEnded { _ in
                pinchStart = nil
                Task {
                    try? await Task.sleep(nanoseconds: 1_400_000_000)
                    withAnimation(.easeOut(duration: 0.3)) { distanceShown = false }
                }
            }
    }

    // MARK: - Chrome

    private var captionText: String {
        switch liveState {
        case .good:
            return "That's the angle. Tap record."
        case .adjust(let cue):
            return cue
        default:
            return rightSide
                ? "Stand behind the right corner, about head height"
                : "Stand behind the left corner, about head height"
        }
    }

    private var captionColor: Color {
        switch liveState {
        case .good: Color(hex: 0x34D399)
        case .adjust: Color(hex: 0xFBBF24)
        default: Color(hex: 0x2DD4BF).opacity(0.9)
        }
    }

    private func overlayChrome(height: CGFloat) -> some View {
        VStack(spacing: 8) {
            Text(captionText)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(captionColor)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Color.black.opacity(0.45), in: Capsule())
                .padding(.top, height * 0.18)

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

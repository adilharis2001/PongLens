import AVFoundation
import CoreMotion
import SwiftUI

struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    final class PreviewView: UIView {
        override static var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }

        override func layoutSubviews() {
            super.layoutSubviews()
            guard let connection = previewLayer.connection,
                  let orientation = window?.windowScene?.interfaceOrientation else { return }
            let angle: CGFloat = switch orientation {
            case .landscapeRight: 0
            case .landscapeLeft: 180
            case .portraitUpsideDown: 270
            default: 90
            }
            if connection.isVideoRotationAngleSupported(angle) {
                connection.videoRotationAngle = angle
            }
        }
    }

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        view.backgroundColor = .black
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {}
}

/// Reads the phone's attitude for the level line — "raised a little, not
/// tilted" is a placement rule, so the viewfinder shows it live.
@Observable
final class LevelMonitor {
    private let manager = CMMotionManager()
    /// Degrees off level in the current hold; 0 is a straight horizon.
    var rollDegrees: Double = 0

    func start() {
        guard manager.isDeviceMotionAvailable else { return }
        manager.deviceMotionUpdateInterval = 1 / 15
        manager.startDeviceMotionUpdates(to: .main) { [weak self] motion, _ in
            guard let g = motion?.gravity else { return }
            // Angle of gravity in the screen plane; level in any hold is a
            // multiple of 90°. Report the distance from the nearest one.
            let angle = atan2(g.x, g.y) * 180 / .pi
            let nearest = (angle / 90).rounded() * 90
            self?.rollDegrees = angle - nearest
        }
    }

    func stop() {
        manager.stopDeviceMotionUpdates()
    }
}

/// The recording experience: viewfinder with the placement ghost and level
/// line, a hardened recorder underneath, and the background upload queue —
/// hit stop and the phone can go in the bag.
struct RecordScreen: View {
    @Environment(\.dismiss) private var dismiss
    @State private var recorder = Recorder()
    @State private var level = LevelMonitor()
    @State private var settings = RecordSettings.load()
    @State private var settingsOpen = false
    @State private var guideVisible = true
    @State private var zoomedOut = false
    @State private var sessionId = UUID()
    @State private var draft = RecordingMetadata()
    @State private var metadataOpen = false

    private var queue: RecordingQueue { RecordingQueue.shared }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Color.black.ignoresSafeArea()

                switch recorder.state {
                case .ready, .recording:
                    CameraPreview(session: recorder.session)
                        .ignoresSafeArea()
                    if guideVisible, recorder.state == .ready {
                        PlacementGhost(level: level.rollDegrees)
                            .ignoresSafeArea()
                            .allowsHitTesting(false)
                    }
                case .denied:
                    permissionCard
                case .failed(let message):
                    Text(message)
                        .font(.plBody)
                        .foregroundStyle(PL.text400)
                        .padding(24)
                case .idle:
                    ProgressView().tint(PL.cyan)
                }

                chrome(portrait: geo.size.height > geo.size.width)
            }
        }
        .statusBarHidden()
        .task {
            recorder.onSegment = { url, duration in
                queue.enqueue(
                    fileURL: url, durationS: duration, sessionId: sessionId,
                    metadata: draft,
                    processOn: settings.processAfterUpload,
                    placementOn: settings.placementMaps
                )
            }
            recorder.onSessionEnd = {
                metadataOpen = true
            }
            guideVisible = settings.placementGuide
            level.start()
            await recorder.configure(fps: settings.fps)
        }
        .onDisappear {
            level.stop()
            recorder.teardown()
        }
        .sheet(isPresented: $settingsOpen) {
            recordSettingsSheet
                .presentationDetents([.medium])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $metadataOpen) {
            metadataSheet
                .presentationDetents([.large])
                .presentationBackground(PL.surface)
                .presentationDragIndicator(.visible)
                .onAppear { queue.holdCompletion(sessionId: sessionId) }
                .onDisappear { queue.releaseCompletion(sessionId: sessionId) }
        }
    }

    // MARK: - Chrome

    @ViewBuilder
    private func chrome(portrait: Bool) -> some View {
        let remaining = Recorder.maxSegmentS - recorder.elapsed
        VStack(spacing: 10) {
            HStack {
                if recorder.state == .recording {
                    HStack(spacing: 8) {
                        Circle().fill(PL.dangerFill).frame(width: 8, height: 8)
                        Text(elapsedString)
                            .font(.system(size: 14, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(.white)
                        if recorder.segment > 1 {
                            Text("Part \(recorder.segment)")
                                .font(.plMicro)
                                .foregroundStyle(PL.text400)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(PL.ink.opacity(0.7), in: Capsule())
                }
                Spacer()
                if recorder.state == .ready {
                    Button {
                        settingsOpen = true
                    } label: {
                        Image(systemName: "gearshape")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(PL.text200)
                            .padding(10)
                            .background(PL.ink.opacity(0.7), in: Circle())
                    }
                    .buttonStyle(.plain)
                }
                Button {
                    recorder.teardown()
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(PL.text300)
                        .padding(10)
                        .background(PL.ink.opacity(0.7), in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(recorder.state == .recording)
                .opacity(recorder.state == .recording ? 0.3 : 1)
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)

            if recorder.thermalWarning {
                banner("The phone is running hot. Recording continues — find some shade for it if you can.", tint: PL.warningText)
            }
            if let note = recorder.interruptionNote {
                banner(note, tint: PL.warningText)
            }
            if recorder.state == .recording, remaining <= 60 {
                banner(
                    "Rolling to a new file in 0:\(String(format: "%02d", Int(max(0, remaining)))) — recording continues, nothing is lost.",
                    tint: PL.cyan
                )
            }
            if recorder.state == .ready, portrait {
                banner("Turn the phone sideways — landscape footage processes best.", tint: PL.text300)
            }
            if recorder.state == .ready, let block = recorder.preflightBlock {
                banner(block, tint: PL.dangerText)
            } else if recorder.state == .ready, recorder.lowBattery {
                banner("Battery is under 20%. A full match takes about 15% — plug in if you can.", tint: PL.warningText)
            }

            Spacer()

            if recorder.state == .ready, !queue.active.isEmpty {
                uploadsShelf
                    .padding(.horizontal, 16)
            }

            HStack(spacing: 22) {
                if recorder.zoomAvailable, recorder.state != .recording {
                    Button {
                        zoomedOut.toggle()
                        recorder.setZoom(zoomedOut ? 0.5 : 1)
                    } label: {
                        Text(zoomedOut ? "0.5x" : "1x")
                            .font(.system(size: 13, weight: .bold))
                            .monospacedDigit()
                            .foregroundStyle(zoomedOut ? PL.cyan : PL.text200)
                            .frame(width: 44, height: 44)
                            .background(PL.ink.opacity(0.7), in: Circle())
                    }
                    .buttonStyle(.plain)
                } else if recorder.zoomAvailable {
                    Color.clear.frame(width: 44, height: 44)
                }

                recordButton

                if recorder.state == .ready {
                    Button {
                        guideVisible.toggle()
                        settings.placementGuide = guideVisible
                        settings.save()
                    } label: {
                        Image(systemName: guideVisible ? "viewfinder" : "viewfinder.rectangular")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(guideVisible ? PL.cyan : PL.text300)
                            .frame(width: 44, height: 44)
                            .background(PL.ink.opacity(0.7), in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(guideVisible ? "Hide the placement guide" : "Show the placement guide")
                } else {
                    Color.clear.frame(width: 44, height: 44)
                }
            }
            .padding(.bottom, 26)
        }
    }

    private func banner(_ text: String, tint: Color) -> some View {
        Text(text)
            .font(.plCaption)
            .foregroundStyle(tint)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(PL.ink.opacity(0.75), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .padding(.horizontal, 24)
    }

    private var elapsedString: String {
        let s = Int(recorder.elapsed)
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    private var recordButton: some View {
        Button {
            if recorder.state == .recording {
                recorder.stop()
            } else {
                sessionId = UUID()
                draft = RecordingMetadata(
                    venue: UserDefaults.standard.string(forKey: "pl-last-venue")
                )
                recorder.start()
            }
        } label: {
            ZStack {
                Circle()
                    .strokeBorder(.white.opacity(0.9), lineWidth: 4)
                    .frame(width: 74, height: 74)
                if recorder.state == .recording {
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(PL.dangerFill)
                        .frame(width: 30, height: 30)
                } else {
                    Circle()
                        .fill(PL.dangerFill)
                        .frame(width: 60, height: 60)
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(
            (recorder.state != .ready && recorder.state != .recording)
                || (recorder.state == .ready && recorder.preflightBlock != nil)
        )
    }

    // MARK: - Uploads shelf

    /// Every recording still on its way up, right where recording happens —
    /// the answer to "did that upload?" without leaving the camera.
    private var uploadsShelf: some View {
        VStack(spacing: 8) {
            ForEach(queue.active.prefix(3)) { item in
                HStack(spacing: 10) {
                    Image(systemName: shelfIcon(item))
                        .font(.system(size: 13))
                        .foregroundStyle(shelfTint(item))
                        .frame(width: 22)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(shelfTitle(item))
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(PL.text100)
                        Text(shelfDetail(item))
                            .font(.plMicro)
                            .foregroundStyle(shelfTint(item))
                    }
                    Spacer()
                    if item.state == .failed {
                        Button("Retry") { queue.retry(item.id) }
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(PL.cyan)
                            .buttonStyle(.plain)
                    } else if item.state == .uploading, item.totalBytes > 0 {
                        Text("\(Int(Double(item.uploadedBytes) / Double(item.totalBytes) * 100))%")
                            .font(.plMicro)
                            .monospacedDigit()
                            .foregroundStyle(PL.text400)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(PL.ink.opacity(0.75), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
        }
    }

    private func shelfIcon(_ item: QueuedRecording) -> String {
        switch item.state {
        case .failed: "exclamationmark.triangle"
        case .finishing: "checkmark.circle"
        default: "arrow.up.circle"
        }
    }

    private func shelfTint(_ item: QueuedRecording) -> Color {
        item.state == .failed ? PL.warningText : PL.cyan
    }

    private func shelfTitle(_ item: QueuedRecording) -> String {
        let minutes = max(1, Int(item.durationS / 60))
        return "\(minutes) min match · \(ByteCountFormatter.string(fromByteCount: item.totalBytes, countStyle: .file))"
    }

    private func shelfDetail(_ item: QueuedRecording) -> String {
        switch item.state {
        case .preparing: "Getting ready to upload"
        case .uploading: "Uploading — keeps going with the app closed"
        case .finishing: "Almost there"
        case .failed: item.errorMessage ?? "Upload failed. The footage is safe on this phone."
        case .done: "Uploaded"
        }
    }

    // MARK: - Settings

    private var recordSettingsSheet: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Recording")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(PL.textBody)

            VStack(alignment: .leading, spacing: 8) {
                Text("Frame rate")
                    .font(.plRowTitle)
                    .foregroundStyle(PL.text100)
                HStack(spacing: 8) {
                    fpsPill(30, note: "recommended")
                    fpsPill(60, note: "smoother slow motion, twice the file")
                }
            }

            Toggle("Placement guide on the viewfinder", isOn: Binding(
                get: { settings.placementGuide },
                set: { settings.placementGuide = $0; guideVisible = $0; settings.save() }
            ))
            .font(.plRowTitle)
            .foregroundStyle(PL.text100)
            .tint(PL.cyan.opacity(0.6))

            Toggle("Upload on Wi-Fi only", isOn: Binding(
                get: { settings.wifiOnlyUploads },
                set: { settings.wifiOnlyUploads = $0; settings.save() }
            ))
            .font(.plRowTitle)
            .foregroundStyle(PL.text100)
            .tint(PL.cyan.opacity(0.6))

            Toggle("Process when the upload finishes", isOn: Binding(
                get: { settings.processAfterUpload },
                set: { settings.processAfterUpload = $0; settings.save() }
            ))
            .font(.plRowTitle)
            .foregroundStyle(PL.text100)
            .tint(PL.cyan.opacity(0.6))

            Toggle("Placement maps", isOn: Binding(
                get: { settings.placementMaps },
                set: { settings.placementMaps = $0; settings.save() }
            ))
            .font(.plRowTitle)
            .foregroundStyle(PL.text100)
            .tint(PL.cyan.opacity(0.6))

            Text("Video is 1080p HEVC — what the pipeline is tuned for. A 45-minute match is about 2 GB at 30fps.")
                .font(.plCaption)
                .foregroundStyle(PL.text500)
            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func fpsPill(_ fps: Int, note: String) -> some View {
        let active = settings.fps == fps
        return Button {
            settings.fps = fps
            settings.save()
            Task { await recorder.configure(fps: fps) }
        } label: {
            VStack(spacing: 2) {
                Text("\(fps) fps")
                    .font(.system(size: 14, weight: .semibold))
                Text(note)
                    .font(.system(size: 10))
                    .opacity(0.7)
            }
            .foregroundStyle(active ? PL.cyan : PL.text300)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(
                active ? PL.cyan.opacity(0.12) : PL.ink.opacity(0.4),
                in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                    .strokeBorder(active ? PL.cyan.opacity(0.6) : PL.edge, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Metadata (upload already running underneath)

    private var metadataSheet: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Match details")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(PL.textBody)
                    Text("The upload is already running — fill in what you know and close this whenever.")
                        .font(.plBody)
                        .foregroundStyle(PL.text400)
                }

                sessionProgress

                TextField("Opponent name", text: Binding(
                    get: { draft.opponent ?? "" },
                    set: { draft.opponent = $0.isEmpty ? nil : $0; pushDraft() }
                ))
                .plField()
                TextField("Club or location", text: Binding(
                    get: { draft.venue ?? "" },
                    set: {
                        draft.venue = $0.isEmpty ? nil : $0
                        UserDefaults.standard.set($0, forKey: "pl-last-venue")
                        pushDraft()
                    }
                ))
                .plField()

                FlowLayout(spacing: 8) {
                    ForEach(["drills", "practice", "match", "league", "tournament"], id: \.self) { value in
                        let active = draft.matchType == value
                        Button(MatchTitle.typeLabel[value] ?? value) {
                            draft.matchType = active ? nil : value
                            pushDraft()
                        }
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(active ? PL.cyan : PL.text400)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .background(active ? PL.cyan.opacity(0.15) : .clear, in: Capsule())
                        .overlay(Capsule().strokeBorder(active ? PL.cyan.opacity(0.5) : PL.edge, lineWidth: 1))
                        .buttonStyle(.plain)
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Which player are you?")
                        .font(.plRowTitle)
                        .foregroundStyle(PL.text100)
                    HStack(spacing: 10) {
                        sidePill("Bottom of video", value: "near")
                        sidePill("Top of video", value: "far")
                    }
                }

                Button("Done") { metadataOpen = false }
                    .buttonStyle(PLPrimaryButtonStyle())
                    .frame(maxWidth: .infinity)
            }
            .padding(24)
        }
    }

    @ViewBuilder
    private var sessionProgress: some View {
        let session = queue.items.filter { $0.sessionId == sessionId }
        if !session.isEmpty {
            let total = session.reduce(Int64(0)) { $0 + $1.totalBytes }
            let sent = session.reduce(Int64(0)) { $0 + $1.uploadedBytes }
            let done = session.allSatisfy { $0.state == .done }
            HStack(spacing: 10) {
                if done {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(PL.successText)
                    Text("Uploaded. It's in your library.")
                        .font(.plCaption)
                        .foregroundStyle(PL.successText)
                } else {
                    ProgressView(value: Double(sent), total: Double(max(1, total)))
                        .tint(PL.cyan)
                    Text("\(Int(Double(sent) / Double(max(1, total)) * 100))%")
                        .font(.plMicro)
                        .monospacedDigit()
                        .foregroundStyle(PL.text400)
                }
            }
            .padding(12)
            .background(PL.ink.opacity(0.4), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
    }

    private func pushDraft() {
        queue.updateMetadata(sessionId: sessionId, draft)
    }

    private func sidePill(_ label: String, value: String) -> some View {
        let active = draft.userSide == value
        return Button(label) {
            draft.userSide = active ? nil : value
            pushDraft()
        }
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(active ? PL.cyan : PL.text400)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(active ? PL.cyan.opacity(0.15) : .clear, in: Capsule())
        .overlay(Capsule().strokeBorder(active ? PL.cyan.opacity(0.5) : PL.edge, lineWidth: 1))
        .buttonStyle(.plain)
    }

    private var permissionCard: some View {
        VStack(spacing: 12) {
            Text("PongLens needs the camera to film your match.")
                .font(.plBody)
                .foregroundStyle(PL.text300)
                .multilineTextAlignment(.center)
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            .buttonStyle(PLPrimaryButtonStyle())
        }
        .padding(24)
    }
}

/// The placement ghost: where the table should sit in frame, the level
/// line, and the three checks — drawn over the viewfinder, never into the
/// footage.
private struct PlacementGhost: View {
    let level: Double

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            let landscape = w > h
            ZStack {
                Canvas { context, size in
                    let teal = Color(hex: 0x2DD4BF)
                    // The table's target zone: centered, roughly the middle
                    // half of the frame, keystoned toward the far end.
                    let midX = size.width / 2
                    let topY = size.height * (landscape ? 0.3 : 0.36)
                    let bottomY = size.height * (landscape ? 0.78 : 0.66)
                    let topHalf = size.width * (landscape ? 0.14 : 0.22)
                    let bottomHalf = size.width * (landscape ? 0.24 : 0.34)
                    var quad = Path()
                    quad.move(to: CGPoint(x: midX - topHalf, y: topY))
                    quad.addLine(to: CGPoint(x: midX + topHalf, y: topY))
                    quad.addLine(to: CGPoint(x: midX + bottomHalf, y: bottomY))
                    quad.addLine(to: CGPoint(x: midX - bottomHalf, y: bottomY))
                    quad.closeSubpath()
                    context.stroke(
                        quad, with: .color(teal.opacity(0.75)),
                        style: StrokeStyle(lineWidth: 2, dash: [7, 6])
                    )
                    let netY = (topY + bottomY) / 2
                    var net = Path()
                    net.move(to: CGPoint(x: midX - (topHalf + bottomHalf) / 2, y: netY))
                    net.addLine(to: CGPoint(x: midX + (topHalf + bottomHalf) / 2, y: netY))
                    context.stroke(
                        net, with: .color(Color(hex: 0xA855F7).opacity(0.6)),
                        style: StrokeStyle(lineWidth: 2, dash: [4, 4])
                    )

                    // The level line: straight and cyan when the phone is
                    // held level, tilted and amber when it isn't.
                    let isLevel = abs(level) < 2.5
                    let lineColor = isLevel ? Color(hex: 0x22D3EE) : Color(hex: 0xFBBF24)
                    let cx = size.width / 2
                    let cy = size.height * 0.14
                    let half = size.width * 0.14
                    let tilt = CGFloat(level * .pi / 180)
                    var horizon = Path()
                    horizon.move(to: CGPoint(x: cx - cos(tilt) * half, y: cy - sin(tilt) * half))
                    horizon.addLine(to: CGPoint(x: cx + cos(tilt) * half, y: cy + sin(tilt) * half))
                    context.stroke(horizon, with: .color(lineColor.opacity(0.9)), lineWidth: 2)
                    context.draw(
                        Text(isLevel ? "Level" : String(format: "%+.0f°", level))
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(lineColor),
                        at: CGPoint(x: cx, y: cy - 16)
                    )
                }
                VStack {
                    Spacer()
                    Text("Table inside the lines · whole table in frame · nobody blocking it")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color(hex: 0x2DD4BF).opacity(0.9))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color.black.opacity(0.45), in: Capsule())
                        .padding(.bottom, h * 0.18)
                }
            }
        }
    }
}

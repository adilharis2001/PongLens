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
            let angle = atan2(g.x, g.y) * 180 / .pi
            let nearest = (angle / 90).rounded() * 90
            self?.rollDegrees = angle - nearest
        }
    }

    func stop() {
        manager.stopDeviceMotionUpdates()
    }
}

/// The recording experience. Landscape is the format — portrait shows the
/// viewfinder but holds the shutter until the phone turns. The ghost draws
/// the SIDE-ON view the pipeline wants: filmed from the side of the table,
/// raised a little, the whole table in frame.
struct RecordScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(LibraryStore.self) private var library
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
            let portrait = geo.size.height > geo.size.width
            ZStack {
                Color.black.ignoresSafeArea()

                switch recorder.state {
                case .ready, .recording:
                    CameraPreview(session: recorder.session)
                        .ignoresSafeArea()
                    if guideVisible, recorder.state == .ready, !portrait {
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

                if portrait {
                    portraitChrome
                } else {
                    landscapeChrome
                }
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
            RecordSettingsSheet(settings: $settings, guideVisible: $guideVisible) { fps in
                Task { await recorder.configure(fps: fps) }
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $metadataOpen) {
            MatchDetailsSheet(
                sessionId: sessionId,
                draft: $draft,
                recentOpponents: recentValues(\.opponentName),
                recentVenues: recentValues(\.venue)
            )
            .presentationDetents([.medium, .large])
            .presentationBackground(PL.surface)
            .presentationDragIndicator(.visible)
            .onAppear { queue.holdCompletion(sessionId: sessionId) }
            .onDisappear { queue.releaseCompletion(sessionId: sessionId) }
        }
    }

    /// Recent distinct values from the library, for one-tap suggestions.
    private func recentValues(_ key: KeyPath<MatchRow, String?>) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        for match in library.matches {
            guard let value = match[keyPath: key]?.trimmingCharacters(in: .whitespaces),
                  !value.isEmpty, seen.insert(value.lowercased()).inserted else { continue }
            out.append(value)
            if out.count == 4 { break }
        }
        return out
    }

    // MARK: - Portrait: viewfinder visible, shutter held until landscape

    private var portraitChrome: some View {
        VStack(spacing: 10) {
            HStack {
                elapsedPill
                Spacer()
                settingsButton
                closeButton
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)

            statusBanners

            if recorder.state == .ready {
                banner("Turn the phone sideways to record — landscape is what processing wants.", tint: PL.cyan)
            }

            Spacer()

            if recorder.state == .ready, !queue.active.isEmpty {
                uploadsShelf.padding(.horizontal, 16)
            }

            shutterRow(recordingAllowed: recorder.state == .recording)
                .padding(.bottom, 26)
        }
    }

    // MARK: - Landscape: camera-app layout, controls on the trailing edge

    private var landscapeChrome: some View {
        HStack(spacing: 0) {
            VStack {
                statusBanners
                Spacer()
                if recorder.state == .ready, !queue.active.isEmpty {
                    uploadsShelf
                        .frame(maxWidth: 420)
                        .padding(.bottom, 16)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 10)

            VStack(spacing: 18) {
                HStack(spacing: 10) {
                    settingsButton
                    closeButton
                }
                Spacer()
                if recorder.zoomAvailable, recorder.state != .recording {
                    zoomButton
                }
                shutter(recordingAllowed: true)
                if recorder.state == .ready {
                    guideButton
                } else {
                    Color.clear.frame(width: 44, height: 44)
                }
                Spacer()
                elapsedPill
                    .frame(minHeight: 30)
            }
            .padding(.trailing, 16)
            .padding(.vertical, 14)
        }
    }

    // MARK: - Shared chrome pieces

    @ViewBuilder
    private var statusBanners: some View {
        VStack(spacing: 8) {
            if recorder.thermalWarning {
                banner("The phone is running hot. Recording continues — find some shade for it if you can.", tint: PL.warningText)
            }
            if let note = recorder.interruptionNote {
                banner(note, tint: PL.warningText)
            }
            if recorder.state == .recording {
                let remaining = Recorder.maxSegmentS - recorder.elapsed
                if remaining <= 60 {
                    banner(
                        "Rolling to a new file in 0:\(String(format: "%02d", Int(max(0, remaining)))) — recording continues, nothing is lost.",
                        tint: PL.cyan
                    )
                }
            }
            if recorder.state == .ready, let block = recorder.preflightBlock {
                banner(block, tint: PL.dangerText)
            } else if recorder.state == .ready, recorder.lowBattery {
                banner("Battery is under 20%. A full match takes about 15% — plug in if you can.", tint: PL.warningText)
            }
        }
    }

    @ViewBuilder
    private var elapsedPill: some View {
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
    }

    private var settingsButton: some View {
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
        .disabled(recorder.state == .recording)
        .opacity(recorder.state == .recording ? 0 : 1)
    }

    private var closeButton: some View {
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

    private var zoomButton: some View {
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
    }

    private var guideButton: some View {
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
    }

    private func shutterRow(recordingAllowed: Bool) -> some View {
        HStack(spacing: 22) {
            Group {
                if recorder.zoomAvailable, recorder.state != .recording {
                    zoomButton
                } else {
                    Color.clear.frame(width: 44, height: 44)
                }
            }
            shutter(recordingAllowed: recordingAllowed)
            Group {
                if recorder.state == .ready {
                    guideButton
                } else {
                    Color.clear.frame(width: 44, height: 44)
                }
            }
        }
    }

    private func shutter(recordingAllowed: Bool) -> some View {
        let enabled = recorder.state == .recording
            || (recorder.state == .ready && recorder.preflightBlock == nil && recordingAllowed)
        return Button {
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
                    .strokeBorder(.white.opacity(enabled ? 0.9 : 0.35), lineWidth: 4)
                    .frame(width: 74, height: 74)
                if recorder.state == .recording {
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(PL.dangerFill)
                        .frame(width: 30, height: 30)
                } else {
                    Circle()
                        .fill(PL.dangerFill.opacity(enabled ? 1 : 0.35))
                        .frame(width: 60, height: 60)
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
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

    // MARK: - Uploads shelf

    private var uploadsShelf: some View {
        VStack(spacing: 8) {
            ForEach(queue.active.prefix(3)) { item in
                RecordingUploadRow(item: item, compact: true)
            }
        }
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

// MARK: - Upload row (shared with the Matches banner)

/// One recording on its way up: state, progress, and the failure actions.
struct RecordingUploadRow: View {
    let item: QueuedRecording
    var compact = false

    private var queue: RecordingQueue { RecordingQueue.shared }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 13))
                .foregroundStyle(tint)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PL.text100)
                Text(detail)
                    .font(.plMicro)
                    .foregroundStyle(tint)
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
        .background(
            compact ? AnyShapeStyle(PL.ink.opacity(0.75)) : AnyShapeStyle(PL.surface),
            in: RoundedRectangle(cornerRadius: 10, style: .continuous)
        )
        .overlay {
            if !compact {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            }
        }
    }

    private var icon: String {
        switch item.state {
        case .failed: "exclamationmark.triangle"
        case .finishing: "checkmark.circle"
        default: "arrow.up.circle"
        }
    }

    private var tint: Color {
        item.state == .failed ? PL.warningText : PL.cyan
    }

    private var title: String {
        let minutes = max(1, Int(item.durationS / 60))
        return "\(minutes) min recording · \(ByteCountFormatter.string(fromByteCount: item.totalBytes, countStyle: .file))"
    }

    private var detail: String {
        switch item.state {
        case .preparing: "Getting ready to upload"
        case .uploading: "Uploading — keeps going with the app closed"
        case .finishing: "Almost there"
        case .failed: item.errorMessage ?? "Upload failed. The footage is safe on this phone."
        case .done: "Uploaded"
        }
    }
}

// MARK: - Settings (a real Form, the way iOS settings read)

private struct RecordSettingsSheet: View {
    @Binding var settings: RecordSettings
    @Binding var guideVisible: Bool
    let onFrameRateChange: (Int) -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Frame rate", selection: Binding(
                        get: { settings.fps },
                        set: {
                            settings.fps = $0
                            settings.save()
                            onFrameRateChange($0)
                        }
                    )) {
                        Text("30 fps").tag(30)
                        Text("60 fps").tag(60)
                    }
                    .pickerStyle(.segmented)
                } footer: {
                    Text("30 fps is what the pipeline is tuned for. 60 makes smoother slow motion at twice the file size.")
                }

                Section {
                    Toggle("Placement guide", isOn: Binding(
                        get: { settings.placementGuide },
                        set: { settings.placementGuide = $0; guideVisible = $0; settings.save() }
                    ))
                    Toggle("Upload on Wi-Fi only", isOn: Binding(
                        get: { settings.wifiOnlyUploads },
                        set: { settings.wifiOnlyUploads = $0; settings.save() }
                    ))
                } footer: {
                    Text("With Wi-Fi only on, recordings wait in the queue until the phone is on Wi-Fi.")
                }

                Section {
                    Toggle("Process when the upload finishes", isOn: Binding(
                        get: { settings.processAfterUpload },
                        set: { settings.processAfterUpload = $0; settings.save() }
                    ))
                    Toggle("Placement maps", isOn: Binding(
                        get: { settings.placementMaps },
                        set: { settings.placementMaps = $0; settings.save() }
                    ))
                } footer: {
                    Text("Video records at 1080p HEVC. A 45-minute match is about 2 GB at 30 fps.")
                }
            }
            .tint(PL.cyan)
            .navigationTitle("Recording")
            .navigationBarTitleDisplayMode(.inline)
        }
        .preferredColorScheme(.dark)
    }
}

// MARK: - Match details (upload already running underneath)

private struct MatchDetailsSheet: View {
    let sessionId: UUID
    @Binding var draft: RecordingMetadata
    let recentOpponents: [String]
    let recentVenues: [String]

    @Environment(\.dismiss) private var dismiss
    @State private var poster: UIImage?

    private var queue: RecordingQueue { RecordingQueue.shared }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Match details")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(PL.textBody)
                    Text("The upload is already running. Fill in what you know and close this whenever.")
                        .font(.plBody)
                        .foregroundStyle(PL.text400)
                }

                sessionProgress

                VStack(alignment: .leading, spacing: 8) {
                    TextField("Opponent name", text: Binding(
                        get: { draft.opponent ?? "" },
                        set: { draft.opponent = $0.isEmpty ? nil : $0; pushDraft() }
                    ))
                    .plField()
                    if !recentOpponents.isEmpty {
                        suggestionRow(recentOpponents, current: draft.opponent) { picked in
                            draft.opponent = picked
                            pushDraft()
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    TextField("Club or location", text: Binding(
                        get: { draft.venue ?? "" },
                        set: {
                            draft.venue = $0.isEmpty ? nil : $0
                            UserDefaults.standard.set($0, forKey: "pl-last-venue")
                            pushDraft()
                        }
                    ))
                    .plField()
                    if !recentVenues.isEmpty {
                        suggestionRow(recentVenues, current: draft.venue) { picked in
                            draft.venue = picked
                            UserDefaults.standard.set(picked, forKey: "pl-last-venue")
                            pushDraft()
                        }
                    }
                }

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

                sidePicker
            }
            .padding(20)
        }
        .safeAreaInset(edge: .bottom) {
            Button("Done") { dismiss() }
                .buttonStyle(PLPrimaryButtonStyle())
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .background(PL.surface)
        }
        .task { await loadPoster() }
    }

    /// "Which end were you at the start?" over the recording's own first
    /// frame — sides change every game, so the answer is anchored to the
    /// opening frame, not to memory.
    private var sidePicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Tap your end — where you started the match")
                .font(.plRowTitle)
                .foregroundStyle(PL.text100)
            ZStack {
                if let poster {
                    Image(uiImage: poster)
                        .resizable()
                        .scaledToFit()
                } else {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(PL.ink.opacity(0.5))
                        .aspectRatio(16 / 9, contentMode: .fit)
                }
                VStack(spacing: 0) {
                    sideBand("Top of video", value: "far")
                    sideBand("Bottom of video", value: "near")
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            )
            Text("Ends swap between games — this is only about the first game.")
                .font(.plCaption)
                .foregroundStyle(PL.text500)
        }
    }

    private func sideBand(_ label: String, value: String) -> some View {
        let active = draft.userSide == value
        return Button {
            draft.userSide = active ? nil : value
            pushDraft()
        } label: {
            Text(active ? "You · \(label)" : label)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(active ? PL.ink : PL.text100)
                .padding(.horizontal, 12)
                .padding(.vertical, 5)
                .background(
                    active ? AnyShapeStyle(PL.cyan) : AnyShapeStyle(PL.ink.opacity(0.55)),
                    in: Capsule()
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(Rectangle())
                .background(active ? PL.cyan.opacity(0.15) : .clear)
        }
        .buttonStyle(.plain)
    }

    private func suggestionRow(
        _ values: [String], current: String?, pick: @escaping (String) -> Void
    ) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(values, id: \.self) { value in
                    let active = current?.lowercased() == value.lowercased()
                    Button(value) { pick(value) }
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(active ? PL.cyan : PL.text400)
                        .lineLimit(1)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(active ? PL.cyan.opacity(0.15) : PL.ink.opacity(0.4), in: Capsule())
                        .overlay(Capsule().strokeBorder(active ? PL.cyan.opacity(0.5) : PL.edge, lineWidth: 1))
                        .buttonStyle(.plain)
                }
            }
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

    private func loadPoster() async {
        guard let item = queue.items.first(where: { $0.sessionId == sessionId }) else { return }
        let url = queue.fileURL(item)
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 900, height: 900)
        if let cg = try? await generator.image(
            at: CMTime(seconds: min(2, item.durationS / 2), preferredTimescale: 600)
        ).image {
            poster = UIImage(cgImage: cg)
        }
    }
}

/// The placement ghost, drawn for the view the pipeline wants: filmed from
/// the SIDE of the table, raised a little — the table runs across the
/// frame with the net upright in the middle. Never recorded into footage.
private struct PlacementGhost: View {
    let level: Double

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            ZStack {
                Canvas { context, size in
                    let teal = Color(hex: 0x2DD4BF)

                    // The table, side-on and slightly from above: a wide
                    // band across the middle of the frame. The top edge is
                    // the far side, a touch narrower.
                    let left = size.width * 0.16
                    let right = size.width * 0.84
                    let topY = size.height * 0.42
                    let bottomY = size.height * 0.62
                    let inset = size.width * 0.015
                    var table = Path()
                    table.move(to: CGPoint(x: left + inset, y: topY))
                    table.addLine(to: CGPoint(x: right - inset, y: topY))
                    table.addLine(to: CGPoint(x: right, y: bottomY))
                    table.addLine(to: CGPoint(x: left, y: bottomY))
                    table.closeSubpath()
                    context.stroke(
                        table, with: .color(teal.opacity(0.75)),
                        style: StrokeStyle(lineWidth: 2, dash: [7, 6])
                    )

                    // The net, upright in the middle, poking above the top.
                    let midX = size.width / 2
                    var net = Path()
                    net.move(to: CGPoint(x: midX, y: bottomY))
                    net.addLine(to: CGPoint(x: midX, y: topY - size.height * 0.06))
                    context.stroke(
                        net, with: .color(Color(hex: 0xA855F7).opacity(0.7)),
                        style: StrokeStyle(lineWidth: 2, dash: [4, 4])
                    )

                    // Player zones, one at each end.
                    for x in [size.width * 0.08, size.width * 0.92] {
                        let r = size.height * 0.035
                        context.stroke(
                            Path(ellipseIn: CGRect(
                                x: x - r, y: (topY + bottomY) / 2 - r,
                                width: 2 * r, height: 2 * r
                            )),
                            with: .color(Color(hex: 0x9CA3AF).opacity(0.7)),
                            lineWidth: 1.5
                        )
                    }

                    // The level line, top center — cyan when the hold is
                    // level, amber with the degrees when it isn't.
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
                // The caption rides high, clear of the shutter column.
                VStack {
                    Text("From the side of the table, raised a little · whole table in the lines")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color(hex: 0x2DD4BF).opacity(0.9))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color.black.opacity(0.45), in: Capsule())
                        .padding(.top, h * 0.2)
                    Spacer()
                }
                .frame(width: w)
            }
        }
    }
}

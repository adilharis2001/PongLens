import AVFoundation
import CoreMotion
import Supabase
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
    @State private var cancelAsk = false

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
                        TableGhost(level: level.rollDegrees,
                                   session: recorder.session)
                            .ignoresSafeArea()
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
        .alert("Discard this recording?", isPresented: $cancelAsk) {
            Button("Discard", role: .destructive) {
                recorder.cancel()
                queue.discardSession(sessionId)
            }
            Button("Keep recording", role: .cancel) {}
        } message: {
            Text("Nothing will be uploaded and the footage is deleted.")
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
                // Hold before the sheet is even up: a short clip on fast
                // Wi-Fi can finish uploading before the sheet appears, and
                // it must not register with untouched fields.
                queue.holdCompletion(sessionId: sessionId)
                metadataOpen = true
            }
            guideVisible = settings.placementGuide
            level.start()
            await recorder.configure(fps: settings.fps)
        }
        .onDisappear {
            level.stop()
            recorder.teardown()
            // Never leave a completion hold behind; releasing twice is
            // harmless, leaking once strands the upload short of register.
            queue.releaseCompletion(sessionId: sessionId)
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
                recentOpponents: library.recentValues(\.opponentName),
                recentVenues: library.recentValues(\.venue),
                processOn: settings.processAfterUpload,
                placementOn: settings.placementMaps
            )
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
            .onAppear { queue.holdCompletion(sessionId: sessionId) }
            .onDisappear { queue.releaseCompletion(sessionId: sessionId) }
        }
    }

    // MARK: - Portrait: viewfinder visible, shutter held until landscape

    private var portraitChrome: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                elapsedPill
                Spacer()
                if recorder.state == .recording {
                    cancelButton
                } else {
                    guideButton
                    settingsButton
                    closeButton
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)

            statusBanners

            if recorder.state == .ready {
                banner("Turn your phone sideways to record.", tint: PL.cyan)
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
                    if recorder.state == .recording {
                        cancelButton
                    } else {
                        guideButton
                        settingsButton
                        closeButton
                    }
                }
                Spacer()
                sideSlot
                shutter(recordingAllowed: true)
                Color.clear.frame(width: 44, height: 44)
                Spacer()
                elapsedPill
                    .frame(minHeight: 30)
            }
            .padding(.trailing, 16)
            .padding(.vertical, 14)
        }
    }

    /// The slot beside the shutter: zoom while idle, pause while recording.
    @ViewBuilder
    private var sideSlot: some View {
        if recorder.state == .recording {
            pauseButton
        } else if recorder.zoomAvailable {
            zoomButton
        } else {
            Color.clear.frame(width: 44, height: 44)
        }
    }

    // MARK: - Shared chrome pieces

    @ViewBuilder
    private var statusBanners: some View {
        VStack(spacing: 8) {
            if recorder.thermalWarning {
                banner("The phone is running hot. Recording continues, but give it some shade if you can.", tint: PL.warningText)
            }
            if let note = recorder.interruptionNote {
                banner(note, tint: PL.warningText)
            }
            if recorder.state == .recording, !recorder.isPaused {
                let remaining = Recorder.maxSegmentS - recorder.elapsed
                if remaining <= 60 {
                    banner(
                        "Rolling to a new file in 0:\(String(format: "%02d", Int(max(0, remaining)))). Recording continues without a break.",
                        tint: PL.cyan
                    )
                }
            }
            if recorder.state == .ready, let block = recorder.preflightBlock {
                banner(block, tint: PL.dangerText)
            } else if recorder.state == .ready, recorder.lowBattery {
                banner("Battery is under 20%. A full match takes about 15%, so plug in if you can.", tint: PL.warningText)
            }
        }
    }

    @ViewBuilder
    private var elapsedPill: some View {
        if recorder.state == .recording {
            HStack(spacing: 8) {
                if recorder.isPaused {
                    Image(systemName: "pause.fill")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(PL.warningText)
                } else {
                    Circle().fill(PL.dangerFill).frame(width: 8, height: 8)
                }
                Text(recorder.isPaused ? "Paused · \(elapsedString)" : elapsedString)
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
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(PL.text200)
                .frame(width: 44, height: 44)
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
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(PL.text300)
                .frame(width: 44, height: 44)
                .background(PL.ink.opacity(0.7), in: Circle())
        }
        .buttonStyle(.plain)
        .disabled(recorder.state == .recording)
        .opacity(recorder.state == .recording ? 0.3 : 1)
    }

    /// During a recording the X means "throw this away", behind a
    /// confirmation. Closing the screen comes back once the camera stops.
    private var cancelButton: some View {
        Button {
            cancelAsk = true
        } label: {
            Image(systemName: "xmark")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(PL.text300)
                .frame(width: 44, height: 44)
                .background(PL.ink.opacity(0.7), in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Discard the recording")
    }

    private var pauseButton: some View {
        Button {
            if recorder.isPaused {
                recorder.resume()
            } else {
                recorder.pause()
            }
        } label: {
            Image(systemName: recorder.isPaused ? "play.fill" : "pause.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(recorder.isPaused ? PL.ink : .white)
                .frame(width: 44, height: 44)
                .background(
                    recorder.isPaused ? AnyShapeStyle(.white) : AnyShapeStyle(PL.ink.opacity(0.7)),
                    in: Circle()
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(recorder.isPaused ? "Resume recording" : "Pause recording")
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
            sideSlot
            shutter(recordingAllowed: recordingAllowed)
            Color.clear.frame(width: 44, height: 44)
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
        case .uploading: "Uploading. It keeps going with the app closed."
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

/// The one sheet both flows share: a recording that just stopped and a
/// video picked from the library land here, over their running upload.
struct MatchDetailsSheet: View {
    let sessionId: UUID
    @Binding var draft: RecordingMetadata
    let recentOpponents: [String]
    let recentVenues: [String]

    @Environment(\.dismiss) private var dismiss
    @State private var poster: UIImage?
    @State private var discardAsk = false
    @State private var processOn: Bool
    @State private var placementOn: Bool
    @State private var minutesBalance: Int?

    private var queue: RecordingQueue { RecordingQueue.shared }

    private static let types = ["drills", "practice", "match", "league", "tournament"]

    init(
        sessionId: UUID,
        draft: Binding<RecordingMetadata>,
        recentOpponents: [String],
        recentVenues: [String],
        processOn: Bool,
        placementOn: Bool
    ) {
        self.sessionId = sessionId
        self._draft = draft
        self.recentOpponents = recentOpponents
        self.recentVenues = recentVenues
        self._processOn = State(initialValue: processOn)
        self._placementOn = State(initialValue: placementOn)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    progressRow
                }

                Section {
                    Toggle("Process when the upload finishes", isOn: $processOn)
                    Toggle("Placement maps", isOn: $placementOn)
                        .disabled(!processOn)
                } header: {
                    Text("Processing")
                } footer: {
                    Text(processingFootnote)
                }

                Section {
                    entryRow("Opponent", text: opponentBinding, options: recentOpponents)
                    entryRow("Club or location", text: venueBinding, options: recentVenues)
                    Picker("Type", selection: typeBinding) {
                        Text("Not set").tag("")
                        ForEach(Self.types, id: \.self) { value in
                            Text(MatchTitle.typeLabel[value] ?? value).tag(value)
                        }
                    }
                } footer: {
                    Text("The upload is already running. Fill in what you know and close this whenever.")
                }

                Section {
                    sidePicker
                        .listRowInsets(EdgeInsets(top: 10, leading: 10, bottom: 10, trailing: 10))
                } header: {
                    Text("Your side")
                } footer: {
                    Text("Tap the side you played at the start of the video. Players swap ends between games, so this is about the first game only.")
                }

                Section {
                    Button("Discard recording", role: .destructive) {
                        discardAsk = true
                    }
                }
            }
            .tint(PL.cyan)
            .navigationTitle("Match details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
            .alert("Discard this recording?", isPresented: $discardAsk) {
                Button("Discard", role: .destructive) {
                    queue.discardSession(sessionId)
                    dismiss()
                }
                Button("Keep uploading", role: .cancel) {}
            } message: {
                Text("The upload stops and the footage is deleted.")
            }
        }
        .preferredColorScheme(.dark)
        .task { await loadPoster() }
        .task {
            struct ProcessingRow: Decodable {
                let minutesBalance: Double?
                enum CodingKeys: String, CodingKey { case minutesBalance = "minutes_balance" }
            }
            let rows: [ProcessingRow]? = try? await supa
                .rpc("my_processing_state").execute().value
            minutesBalance = rows?.first?.minutesBalance.map(Int.init)
        }
        .onChange(of: processOn) { pushProcessing() }
        .onChange(of: placementOn) { pushProcessing() }
        // A recording still merging when the sheet opened enqueues late;
        // re-apply the choices the moment its rows exist.
        .onChange(of: sessionCount) { pushProcessing() }
    }

    private var sessionCount: Int {
        queue.items.count { $0.sessionId == sessionId }
    }

    private var processingFootnote: String {
        if !processOn {
            return "The video just lands in your library. You can process it any time from the match page."
        }
        let session = queue.items.filter { $0.sessionId == sessionId }
        let charge = session.reduce(0) { $0 + max(1, Int(ceil($1.durationS / 60))) }
        var text = charge > 0
            ? "Uses \(charge) minute\(charge == 1 ? "" : "s") of your balance."
            : "Its length in minutes comes off your balance."
        if let minutesBalance {
            text += " You have \(minutesBalance)."
        }
        if placementOn {
            text += " Placement maps show where every ball landed and add processing time."
        }
        return text
    }

    private func pushProcessing() {
        queue.updateProcessing(sessionId: sessionId, process: processOn, placement: placementOn && processOn)
    }

    // MARK: - Fields

    private var opponentBinding: Binding<String> {
        Binding(
            get: { draft.opponent ?? "" },
            set: {
                draft.opponent = $0.isEmpty ? nil : $0
                pushDraft()
            }
        )
    }

    private var venueBinding: Binding<String> {
        Binding(
            get: { draft.venue ?? "" },
            set: {
                draft.venue = $0.isEmpty ? nil : $0
                UserDefaults.standard.set($0, forKey: "pl-last-venue")
                pushDraft()
            }
        )
    }

    private var typeBinding: Binding<String> {
        Binding(
            get: { draft.matchType ?? "" },
            set: {
                draft.matchType = $0.isEmpty ? nil : $0
                pushDraft()
            }
        )
    }

    /// A field you can type into, with the recent answers one tap away
    /// behind the chevron.
    private func entryRow(
        _ placeholder: String, text: Binding<String>, options: [String]
    ) -> some View {
        HStack(spacing: 10) {
            TextField(placeholder, text: text)
            if !options.isEmpty {
                Menu {
                    ForEach(options, id: \.self) { value in
                        Button(value) { text.wrappedValue = value }
                    }
                } label: {
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(PL.text400)
                        .frame(width: 30, height: 30)
                        .contentShape(Rectangle())
                }
            }
        }
    }

    // MARK: - Upload progress

    @ViewBuilder
    private var progressRow: some View {
        let session = queue.items.filter { $0.sessionId == sessionId }
        if session.isEmpty {
            HStack(spacing: 12) {
                ProgressView().tint(PL.cyan)
                Text("Saving the recording")
                    .font(.plBody)
                    .foregroundStyle(PL.text300)
            }
        } else {
            let total = session.reduce(Int64(0)) { $0 + $1.totalBytes }
            let sent = session.reduce(Int64(0)) { $0 + $1.uploadedBytes }
            let done = session.allSatisfy { $0.state == .done }
            HStack(spacing: 12) {
                if done {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(PL.successText)
                    Text("Uploaded. It's in your library.")
                        .font(.plBody)
                        .foregroundStyle(PL.successText)
                } else {
                    ProgressView(value: Double(sent), total: Double(max(1, total)))
                        .tint(PL.cyan)
                    Text("\(Int(Double(sent) / Double(max(1, total)) * 100))%")
                        .font(.system(size: 13, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(PL.text400)
                }
            }
        }
    }

    // MARK: - Side picker

    /// Which side the player was on, answered by tapping the recording's
    /// own first frame. Sides change every game, so the question is
    /// anchored to the opening frame, not to memory.
    private var sidePicker: some View {
        ZStack {
            if let poster {
                Image(uiImage: poster)
                    .resizable()
                    .scaledToFit()
            } else {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(PL.ink.opacity(0.5))
                    .aspectRatio(16 / 9, contentMode: .fit)
            }
            VStack(spacing: 0) {
                sideBand("Top of the video", value: "far")
                sideBand("Bottom of the video", value: "near")
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func sideBand(_ label: String, value: String) -> some View {
        let active = draft.userSide == value
        return Button {
            draft.userSide = active ? nil : value
            pushDraft()
        } label: {
            HStack(spacing: 6) {
                if active {
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .bold))
                }
                Text(label)
                    .font(.system(size: 13, weight: .semibold))
            }
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

    private func pushDraft() {
        queue.updateMetadata(sessionId: sessionId, draft)
    }

    /// The first frame, fetched with patience: the file may still be
    /// merging when the sheet opens, and a fragmented HEVC capture needs a
    /// tolerant, precisely-timed reader before it gives up a frame.
    private func loadPoster() async {
        for _ in 0..<20 {
            if Task.isCancelled { return }
            if let image = await posterAttempt() {
                poster = image
                return
            }
            try? await Task.sleep(for: .seconds(1))
        }
    }

    private func posterAttempt() async -> UIImage? {
        guard let item = queue.items.first(where: { $0.sessionId == sessionId }) else { return nil }
        let url = queue.fileURL(item)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let asset = AVURLAsset(
            url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true]
        )
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 900, height: 900)
        generator.requestedTimeToleranceBefore = .positiveInfinity
        generator.requestedTimeToleranceAfter = .positiveInfinity
        for seconds in [1.0, 0.1] {
            if let cg = try? await generator.image(
                at: CMTime(seconds: seconds, preferredTimescale: 600)
            ).image {
                return UIImage(cgImage: cg)
            }
        }
        return nil
    }
}

extension LibraryStore {
    /// Recent distinct values from the library, newest first, for the
    /// dropdowns beside the opponent and venue fields.
    func recentValues(_ key: KeyPath<MatchRow, String?>, limit: Int = 8) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        for match in matches {
            guard let value = match[keyPath: key]?.trimmingCharacters(in: .whitespaces),
                  !value.isEmpty, seen.insert(value.lowercased()).inserted else { continue }
            out.append(value)
            if out.count == limit { break }
        }
        return out
    }
}

/// The placement ghost, drawn for the view the pipeline wants: filmed from
/// the SIDE of the table, raised a little — the table runs across the
/// frame with the net upright in the middle. Never recorded into footage.
// The placement guide lives in Components/TableGhost.swift: a table drawn
// in true perspective from the camera poses that processed well, replacing
// the side-on trapezoid that taught the one angle the pipeline handles
// worst.

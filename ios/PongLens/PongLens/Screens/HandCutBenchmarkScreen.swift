import SwiftUI

/// Step 0 of the hand-cut plan: the cutting speed test. Admin only, from
/// Account > This iPhone. See HandCutBenchmark.swift for what a run does.
struct HandCutBenchmarkScreen: View {
    @Environment(\.dismiss) private var dismiss
    @State private var pickerOpen = false
    private var bench: HandCutBenchmark { HandCutBenchmark.shared }

    var body: some View {
        ZStack {
            ArenaBackground()
            Form {
                header
                sourceSection
                if bench.source != nil {
                    runSection
                    if !bench.running { runButtons }
                }
                resultsSections
            }
            .scrollContentBackground(.hidden)
            .tint(PL.cyan)
        }
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $pickerOpen) {
            VideoPicker { provider in
                pickerOpen = false
                if let provider { bench.importSource(provider) }
            }
            .ignoresSafeArea()
        }
        #if DEBUG && targetEnvironment(simulator)
        .task { await bench.devAutostart() }
        #endif
        .onDisappear {
            // The scratch copy of the source goes with the screen, unless a
            // run is still reading it.
            if !bench.running { bench.dropSource() }
        }
    }

    // MARK: - Header

    private var header: some View {
        Section {
            VStack(alignment: .leading, spacing: 16) {
                Button { dismiss() } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 12, weight: .semibold))
                        Text("Back")
                    }
                }
                .buttonStyle(PLSecondaryButtonStyle())

                Text("Cutting speed test")
                    .font(.plPageTitle)
                    .tracking(-0.6)
                    .foregroundStyle(PL.textBody)
            }
            .padding(.vertical, 4)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)
        }
    }

    // MARK: - Source

    private var sourceSection: some View {
        Section("Video") {
            if bench.importing {
                ProgressView(value: bench.importFraction) {
                    Text("Copying from Photos")
                }
                Button("Cancel") { bench.cancelImport() }
                    .buttonStyle(PLSoftDestructiveButtonStyle())
            } else if let source = bench.source {
                let info = source.info
                LabeledContent("Name", value: source.name)
                LabeledContent("Picture", value: "\(info.displayWidth)×\(info.displayHeight) · \(Self.fps(info.fps)) fps · \(info.codec)")
                LabeledContent("Length", value: Self.clock(info.duration))
                LabeledContent("Size", value: Self.bytes(info.bytes))
                LabeledContent("Bitrate", value: Self.mbps(info.videoBitrate))
                if !bench.running {
                    Button("Choose another video") { pickerOpen = true }
                        .buttonStyle(PLSecondaryButtonStyle())
                }
            } else {
                Button { pickerOpen = true } label: {
                    Text("Choose a video").frame(maxWidth: .infinity, minHeight: 20)
                }
                .buttonStyle(PLPrimaryButtonStyle())
            }
            if let message = bench.message {
                Text(message).font(.plCaption).foregroundStyle(PL.dangerText)
            }
        }
    }

    // MARK: - Run

    private var runSection: some View {
        Section("Run") {
            if let source = bench.source {
                let plan = HandCutPlan.alternating(duration: source.info.duration)
                LabeledContent("Plan", value: "\(plan.count) pieces of 20 s, \(Self.clock(HandCutPlan.cutDuration(for: plan))) kept, \(plan.count) clips")
                Picker("Quality", selection: Binding(
                    get: { bench.bitsPerPixel },
                    set: { bench.bitsPerPixel = $0 }
                )) {
                    ForEach([0.06, 0.1, 0.15], id: \.self) { bpp in
                        Text("\(Self.mbps(Double(HandCutPlan.bitrate(width: source.info.naturalWidth, height: source.info.naturalHeight, fps: source.info.fps, bitsPerPixel: bpp)))) cut")
                            .tag(bpp)
                    }
                }
                .disabled(bench.running)
            }
            if let current = bench.current {
                Text(bench.stage.isEmpty ? "Starting" : bench.stage)
                    .font(.plBody).foregroundStyle(PL.text200)
                ProgressView(value: bench.progress)
                if current.mode == .background {
                    Text("Lock the phone now and leave it until the run ends.")
                        .font(.plCaption).foregroundStyle(PL.text400)
                }
                Button("Cancel run") { bench.cancelRun() }
                    .buttonStyle(PLSoftDestructiveButtonStyle())
            } else if bench.awaitingBackgroundTask {
                Text("Waiting for iOS to start the task").font(.plBody).foregroundStyle(PL.text300)
            }
        }
    }

    /// Full width and stacked, like every form action on a phone; their
    /// own clear section so the card above keeps its shape.
    private var runButtons: some View {
        Section {
            VStack(spacing: 10) {
                Button {
                    bench.runForeground()
                } label: {
                    Text("Run in the foreground").frame(maxWidth: .infinity, minHeight: 20)
                }
                .buttonStyle(PLPrimaryButtonStyle())
                Button {
                    Task { await bench.runInBackground() }
                } label: {
                    Text("Run in the background").frame(maxWidth: .infinity, minHeight: 28)
                }
                .buttonStyle(PLSecondaryButtonStyle())
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        }
    }

    // MARK: - Results

    @ViewBuilder
    private var resultsSections: some View {
        if !bench.runs.isEmpty {
            Section {
                ShareLink(item: bench.exportURL) {
                    Label("Share results", systemImage: "square.and.arrow.up")
                }
                if !bench.running {
                    Button("Clear results", role: .destructive) { bench.clearResults() }
                }
            }
            ForEach(bench.runs) { run in
                resultSection(run)
            }
        }
    }

    private func resultSection(_ run: HandCutBenchmark.Run) -> some View {
        Section {
            LabeledContent("Result", value: run.outcome ?? "Running")
            LabeledContent("Phone", value: "\(run.device.model) · \(run.device.systemVersion)")
            LabeledContent("Video", value: "\(run.source.info.displayWidth)×\(run.source.info.displayHeight) · \(Self.fps(run.source.info.fps)) fps · \(Self.clock(run.source.info.duration)) · \(Self.bytes(run.source.info.bytes))")
            if run.segmentCount > 0 {
                LabeledContent("Encoded", value: "\(Self.clock(run.keptSeconds)) kept · cut \(Self.mbps(Double(run.cutBitrate))) · clips \(Self.mbps(Double(run.clipBitrate)))")
            }
            if let wall = run.totalWallSeconds {
                LabeledContent("Total time", value: Self.clock(wall))
            }
            if let cut = run.outputs.first(where: { $0.id == "cut" }) {
                LabeledContent("Cut", value: outputSummary(cut))
            }
            let clips = run.outputs.filter { $0.id != "cut" }
            if !clips.isEmpty {
                let done = clips.filter { $0.error == nil && $0.wallSeconds != nil }
                let wall = done.compactMap(\.wallSeconds).reduce(0, +)
                let bytes = done.compactMap(\.bytes).reduce(0, +)
                LabeledContent("Clips", value: "\(done.count) of \(clips.count) · \(Self.clock(wall)) · \(Self.bytes(bytes))")
            }
            if run.source.info.bytes > 0, run.outputBytes > 0 {
                LabeledContent("Output vs source", value: "\(Self.bytes(run.outputBytes)) · \(Int((Double(run.outputBytes) / Double(run.source.info.bytes) * 100).rounded()))%")
            }
            LabeledContent("Battery", value: "\(Self.percent(run.batteryStart)) → \(Self.percent(run.batteryEnd)) · \(run.batteryStateStart)")
            let heat = run.events.filter { $0.kind == "thermal" }
            LabeledContent("Heat", value: "\(run.thermalStart) → \(run.thermalEnd ?? "?")\(heat.isEmpty ? "" : " · \(heat.count) changes")")
            if run.backgroundRequested {
                LabeledContent("Background task", value: run.backgroundGranted == true ? (run.expired ? "Granted, then expired" : "Granted") : "Refused")
                if let error = run.backgroundError {
                    Text(error).font(.plCaption).foregroundStyle(PL.dangerText)
                }
            }
            if run.secondsInBackground > 0 || run.outputsFinishedInBackground > 0 {
                LabeledContent("In background", value: "\(Self.clock(run.secondsInBackground)) · \(run.outputsFinishedInBackground) files finished there")
            }
            if let drift = run.worstStartDrift {
                LabeledContent("Worst start drift", value: String(format: "%.3f s", drift))
            }
            if !run.outputs.isEmpty {
                DisclosureGroup("Files (\(run.outputs.count))") {
                    ForEach(run.outputs) { output in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(output.label).font(.plBody).foregroundStyle(PL.text100)
                            Text(outputSummary(output)).font(.plCaption).foregroundStyle(PL.text400)
                            if let error = output.error {
                                Text(error).font(.plCaption).foregroundStyle(PL.dangerText)
                            }
                        }
                    }
                }
            }
            if !run.events.isEmpty {
                DisclosureGroup("Events (\(run.events.count))") {
                    ForEach(run.events) { event in
                        Text("\(String(format: "%.1f", event.at)) s · \(event.kind): \(event.detail)")
                            .font(.plCaption).foregroundStyle(PL.text300)
                    }
                }
            }
        } header: {
            Text("\(run.mode == .foreground ? "Foreground" : "Background") · \(run.startedAt.formatted(date: .abbreviated, time: .shortened))")
        }
    }

    private func outputSummary(_ output: HandCutBenchmark.Output) -> String {
        var parts: [String] = []
        if let wall = output.wallSeconds { parts.append(Self.clock(wall)) }
        if let speed = output.speed { parts.append(String(format: "%.1f× real time", speed)) }
        if let bytes = output.bytes { parts.append(Self.bytes(bytes)) }
        if let w = output.width, let h = output.height { parts.append("\(w)×\(h)") }
        parts.append("\(output.appStateAtStart) → \(output.appStateAtFinish ?? "?")")
        return parts.joined(separator: " · ")
    }

    // MARK: - Formatting

    private static func clock(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "?" }
        let s = Int(seconds.rounded())
        return s >= 3600
            ? String(format: "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60)
            : String(format: "%d:%02d", s / 60, s % 60)
    }

    private static func bytes(_ value: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: value, countStyle: .file)
    }

    private static func mbps(_ bitsPerSecond: Double) -> String {
        String(format: "%.1f Mbps", bitsPerSecond / 1_000_000)
    }

    private static func fps(_ value: Double) -> String {
        guard value.isFinite else { return "?" }
        return value.rounded() == value ? String(Int(value)) : String(format: "%.2f", value)
    }

    private static func percent(_ level: Double?) -> String {
        level.map { "\(Int(($0 * 100).rounded()))%" } ?? "?"
    }
}

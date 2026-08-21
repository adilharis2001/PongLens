import AVFoundation
import SwiftUI
import UIKit

/// Recording a coaching session, start to written-up notes.
///
/// One live thing on screen and nothing else. A recorder is watched more
/// than it is used — the phone sits on a barrier for two hours — so the
/// screen's whole job is to answer "is it still hearing him?" from across
/// a table, and to stay calm while it does.
///
/// Every state shares the same anchor in the same place, so moving between
/// them changes what the anchor is doing rather than rearranging the
/// screen.
struct LessonRecordScreen: View {

    /// Called once the lesson has been saved, so the journal behind can
    /// reload. The entry is written from here rather than handed onward.
    let onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(JournalStore.self) private var store

    @State private var recorder = LessonRecorder()
    @State private var transcriber = LessonTranscriber()
    @State private var stage: Stage = .ready
    @State private var discardAsk = false
    @State private var starting = false
    /// Recent input levels, oldest first. The waveform is history rather
    /// than a needle: a bar that only shows "now" cannot tell you the
    /// microphone has been dead for the last minute.
    @State private var trace: [Double] = []

    /// The transcript, editable before it is saved. Speech to text gets
    /// names and table tennis words wrong, and the person who was at the
    /// lesson is the only one who can fix them.
    @State private var draft = ""
    @State private var coachName = ""
    @State private var saving = false
    @State private var saveFailed = false

    /// The distilled notes, fetched before anything is written so the
    /// notes can be read at the moment they matter rather than after the
    /// entry already exists.
    @State private var takeaways: LessonTakeaways?
    @State private var previewing = false
    /// Edit the transcript and the notes below it are out of date. They
    /// are refetched when the notes are next looked at, not on every
    /// keystroke.
    @State private var notesStale = false
    @State private var reviewTab = ReviewTab.notes

    private enum ReviewTab: String, CaseIterable {
        case notes = "Notes"
        case transcript = "Transcript"
    }

    private enum Stage { case ready, recording, writingUp, noWords, review }

    private static let traceLength = 38

    /// Raw peak is not what a meter should plot. A coach two metres away
    /// lands around 0.05, which drawn literally is a flat line — so the
    /// scale is shaped to put ordinary speech in the middle of the range
    /// and leave headroom above it.
    private static func shaped(_ level: Double) -> Double {
        min(1, level.squareRoot() * 1.4)
    }

    var body: some View {
        ZStack {
            ArenaBackground()
            if stage == .review {
                reviewLayout
            } else {
                VStack(spacing: 0) {
                    header
                    Spacer(minLength: 24)
                    stageView
                    Spacer(minLength: 24)
                    controls
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 8)
            }
        }
        .preferredColorScheme(.dark)
        .interactiveDismissDisabled(stage != .ready)
        .task { await transcriber.prepare() }
        .onChange(of: recorder.level) { _, level in
            guard stage == .recording else { return }
            trace.append(recorder.phase == .paused ? 0 : Self.shaped(level))
            if trace.count > Self.traceLength {
                trace.removeFirst(trace.count - Self.traceLength)
            }
        }
        // Segments arrive as they close, and each one starts transcribing
        // straight away. By the time the lesson ends there is one segment
        // of work left rather than two hours of it.
        .onChange(of: recorder.segments) { _, segments in
            transcriber.enqueue(segments)
        }
        .onChange(of: transcriber.states) { _, _ in
            guard stage == .writingUp, transcriber.allSettled else { return }
            // Nothing came back at all. Say so and offer the retry rather
            // than dismissing into an empty composer, which would read as
            // the lesson having been thrown away.
            if transcriber.joined.isEmpty {
                stage = .noWords
            } else {
                draft = transcriber.joined
                stage = .review
                Task { await loadNotes() }
            }
        }
        .alert("Discard this lesson?", isPresented: $discardAsk) {
            Button("Discard", role: .destructive) {
                recorder.discard()
                dismiss()
            }
            Button("Keep recording", role: .cancel) {}
        } message: {
            Text("The recording is deleted and nothing is written up.")
        }
    }

    // MARK: - Chrome

    private var header: some View {
        HStack {
            Text(stage == .review ? "Your lesson" : "Record a lesson")
                .font(.plPageTitle)
                .tracking(-0.6)
                .foregroundStyle(PL.textBody)
            Spacer()
            if stage == .ready {
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(PL.text400)
                        .frame(width: 34, height: 34)
                        .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close")
            }
        }
        .padding(.top, 8)
    }

    @ViewBuilder
    private var stageView: some View {
        switch stage {
        case .ready: readyState
        case .recording: recordingState
        case .writingUp: writingUpState
        case .noWords: noWordsState
        // Review builds its own full-height layout, so it never routes
        // through the centred stage slot.
        case .review: EmptyView()
        }
    }

    // MARK: - States

    private var readyState: some View {
        VStack(spacing: 28) {
            // The same disc the timer lives in once this starts, resting.
            ZStack {
                Circle()
                    .fill(PL.cyan.opacity(0.05))
                    .frame(width: 208, height: 208)
                Circle()
                    .strokeBorder(PL.cyan.opacity(0.18), lineWidth: 1)
                    .frame(width: 208, height: 208)
                Circle()
                    .strokeBorder(PL.edge, lineWidth: 1)
                    .frame(width: 168, height: 168)
                Image(systemName: "waveform")
                    .font(.system(size: 56, weight: .light))
                    .foregroundStyle(PL.cyan)
            }
            .shadow(color: PL.cyan.opacity(0.16), radius: 32)

            Text("Put your phone near the net, screen down.")
                .font(.plBody)
                .foregroundStyle(PL.text300)
                .multilineTextAlignment(.center)

            if let warning = preflightWarning {
                Text(warning)
                    .font(.plCaption)
                    .foregroundStyle(PL.warningText)
                    .multilineTextAlignment(.center)
            }
            if let message = recorder.errorMessage {
                VStack(spacing: 6) {
                    Text(message)
                        .font(.plCaption)
                        .foregroundStyle(PL.dangerText)
                        .multilineTextAlignment(.center)
                        .lineSpacing(3)
                    // Quiet enough to ignore, present enough to report. A
                    // recorder that fails on a phone and not here is
                    // debugged from a screenshot or not at all.
                    if let diagnostic = recorder.diagnostic {
                        Text(diagnostic)
                            .font(.plMicro)
                            .monospaced()
                            .foregroundStyle(PL.text600)
                    }
                }
            }
        }
    }

    private var recordingState: some View {
        VStack(spacing: 32) {
            ZStack {
                Circle()
                    .fill(PL.cyan.opacity(0.05))
                    .frame(width: 208, height: 208)
                // The ring breathes with the room. It is the part you can
                // read from two metres away, which is where the phone is.
                let pulse = Self.shaped(recorder.level)
                Circle()
                    .strokeBorder(PL.cyan.opacity(0.25 + pulse * 0.5), lineWidth: 2)
                    .frame(width: 208 + pulse * 22, height: 208 + pulse * 22)
                    .animation(.easeOut(duration: 0.12), value: pulse)

                VStack(spacing: 6) {
                    Text(clock)
                        .font(.system(size: 42, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(PL.textBody)
                    if recorder.phase == .paused {
                        Text("Paused")
                            .font(.plMicro)
                            .textCase(.uppercase)
                            .tracking(1.2)
                            .foregroundStyle(PL.warningText)
                    }
                }
            }
            .shadow(color: PL.cyan.opacity(0.12 + Self.shaped(recorder.level) * 0.2), radius: 34)

            Waveform(
                samples: trace,
                capacity: Self.traceLength,
                live: recorder.phase == .recording
            )
            .frame(height: 64)

            VStack(spacing: 8) {
                Text(recorder.phase == .paused
                     ? "Paused. Nothing is being recorded."
                     : "Recording. You can lock your phone.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)

                if recorder.wasInterrupted {
                    Text("The recording was interrupted. Everything before and after it is kept.")
                        .font(.plCaption)
                        .foregroundStyle(PL.warningText)
                        .multilineTextAlignment(.center)
                }
                if let message = recorder.errorMessage {
                    Text(message)
                        .font(.plCaption)
                        .foregroundStyle(PL.dangerText)
                        .multilineTextAlignment(.center)
                }
            }
        }
    }

    private var writingUpState: some View {
        VStack(spacing: 26) {
            ZStack {
                Circle()
                    .fill(PL.cyan.opacity(0.05))
                    .frame(width: 148, height: 148)
                Circle()
                    .strokeBorder(PL.cyan.opacity(0.2), lineWidth: 1)
                    .frame(width: 148, height: 148)
                Image(systemName: "sparkles")
                    .font(.system(size: 38, weight: .light))
                    .foregroundStyle(PL.cyan)
            }
            .shadow(color: PL.cyan.opacity(0.12), radius: 26)

            VStack(alignment: .leading, spacing: 12) {
                PLSkeletonBar()
                PLSkeletonBar()
                PLSkeletonBar(maxWidth: 240)
            }
            .plShimmer()

            Text("Writing up your lesson.")
                .font(.plBody)
                .foregroundStyle(PL.text400)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Writing up your lesson")
    }

    private var noWordsState: some View {
        VStack(spacing: 20) {
            ZStack {
                Circle()
                    .fill(PL.warning.opacity(0.06))
                    .frame(width: 148, height: 148)
                Circle()
                    .strokeBorder(PL.warning.opacity(0.25), lineWidth: 1)
                    .frame(width: 148, height: 148)
                Image(systemName: "waveform.slash")
                    .font(.system(size: 38, weight: .light))
                    .foregroundStyle(PL.warningText)
            }
            Text("The lesson couldn't be transcribed.")
                .font(.plCardTitle)
                .foregroundStyle(PL.text100)
                .multilineTextAlignment(.center)
            Text("The recording is still on your phone.")
                .font(.plBody)
                .foregroundStyle(PL.text400)
                .multilineTextAlignment(.center)
        }
    }

    // MARK: - Review

    /// What the lesson turned into, before it becomes an entry.
    ///
    /// Notes first, because that is the thing worth reading — an hour of
    /// coaching condensed to the themes it actually covered. The raw
    /// transcript is one tap away for checking a word the microphone got
    /// wrong, and editing it there re-distils the notes.
    private var reviewLayout: some View {
        VStack(spacing: 0) {
            header

            TextField("Who taught it?", text: $coachName)
                .plField()
                .padding(.top, 16)

            Picker("", selection: $reviewTab) {
                ForEach(ReviewTab.allCases, id: \.self) { tab in
                    Text(tab.rawValue).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .padding(.vertical, 14)

            switch reviewTab {
            case .notes: notesTab
            case .transcript: transcriptTab
            }

            controls
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 8)
        .tint(PL.cyan)
        .onChange(of: reviewTab) { _, tab in
            guard tab == .notes, notesStale, !previewing else { return }
            Task { await loadNotes() }
        }
        .onChange(of: draft) { _, _ in notesStale = true }
    }

    @ViewBuilder
    private var notesTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if previewing {
                    VStack(alignment: .leading, spacing: 10) {
                        PLSkeletonBar(maxWidth: 200)
                        PLSkeletonBar()
                        PLSkeletonBar()
                        PLSkeletonBar(maxWidth: 240)
                    }
                    .plShimmer()
                } else if let takeaways, !(takeaways.themes ?? []).isEmpty {
                    // The same shape the journal card uses, so what you
                    // approve here is what you get afterwards.
                    if let title = takeaways.title, !title.isEmpty {
                        Text(title)
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(PL.text100)
                    }
                    ForEach(takeaways.themes ?? [], id: \.name) { theme in
                        VStack(alignment: .leading, spacing: 7) {
                            Text(theme.name.uppercased())
                                .font(.plSection)
                                .tracking(0.6)
                                .foregroundStyle(PL.cyan)
                            ForEach(theme.points, id: \.self) { point in
                                HStack(alignment: .top, spacing: 8) {
                                    Circle().fill(PL.text600)
                                        .frame(width: 4, height: 4)
                                        .padding(.top, 7)
                                    Text(point)
                                        .font(.plBody)
                                        .foregroundStyle(PL.text200)
                                        .lineSpacing(3)
                                    Spacer(minLength: 0)
                                }
                            }
                        }
                    }
                } else {
                    // Short lessons are kept as they are, the same rule the
                    // journal has always used, so there is nothing to show
                    // here and nothing has gone wrong.
                    Text("This one is short enough to keep as it is.")
                        .font(.plBody)
                        .foregroundStyle(PL.text400)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.bottom, 16)
        }
    }

    /// A TextEditor rather than a TextField inside a ScrollView. A
    /// multiline text field swallows the drag for its own selection, so
    /// the page would only scroll if you caught the margin beside it —
    /// which is exactly how it felt. This scrolls itself.
    private var transcriptTab: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextEditor(text: $draft)
                .font(.plBody)
                .foregroundStyle(PL.text200)
                .lineSpacing(4)
                .scrollContentBackground(.hidden)
                .padding(10)
                .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                        .strokeBorder(PL.edge, lineWidth: 1)
                )
                .frame(maxHeight: .infinity)

            Text("Fix anything the microphone got wrong. The notes are written again from this.")
                .font(.plCaption)
                .foregroundStyle(PL.text500)
                .padding(.bottom, 4)
        }
    }

    private func loadNotes() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        previewing = true
        takeaways = await store.previewTakeaways(transcript: text)
        previewing = false
        notesStale = false
    }

    // MARK: - Controls

    @ViewBuilder
    private var controls: some View {
        switch stage {
        case .ready:
            Button { Task { await begin() } } label: {
                wide(starting ? "Starting…" : "Start recording")
            }
            .buttonStyle(PLPrimaryButtonStyle())
            .disabled(starting)

        case .recording:
            VStack(spacing: 12) {
                Button { finish() } label: { wide("Finish") }
                    .buttonStyle(PLPrimaryButtonStyle())
                HStack(spacing: 12) {
                    Button {
                        if recorder.phase == .paused {
                            recorder.resume()
                        } else {
                            recorder.pause()
                        }
                    } label: {
                        wide(recorder.phase == .paused ? "Resume" : "Pause")
                    }
                    .buttonStyle(PLSecondaryButtonStyle())
                    Button { discardAsk = true } label: { wide("Discard") }
                        .buttonStyle(PLSoftDestructiveButtonStyle())
                }
            }

        case .writingUp:
            // Deliberately nothing. There is no useful action while the
            // words are being pulled out, and a cancel here would throw
            // away a lesson someone just sat through.
            EmptyView()

        case .noWords:
            VStack(spacing: 12) {
                Button {
                    transcriber.retryFailed()
                    stage = .writingUp
                } label: {
                    wide("Write it up again")
                }
                .buttonStyle(PLPrimaryButtonStyle())
                Button { discardAsk = true } label: { wide("Discard") }
                    .buttonStyle(PLSoftDestructiveButtonStyle())
            }

        case .review:
            VStack(spacing: 12) {
                Button { Task { await save() } } label: {
                    wide(saving ? "Saving…" : "Add to journal")
                }
                .buttonStyle(PLPrimaryButtonStyle())
                .disabled(saving || draft.trimmingCharacters(in: .whitespaces).isEmpty)
                Button { discardAsk = true } label: { wide("Discard") }
                    .buttonStyle(PLSoftDestructiveButtonStyle())
                    .disabled(saving)
            }
            .padding(.top, 12)
        }
    }

    /// A label that fills its button. Every control on this screen is a
    /// decision of the same weight, so they are all the same width and the
    /// row cannot come out ragged.
    private func wide(_ title: String) -> some View {
        Text(title).frame(maxWidth: .infinity)
    }

    // MARK: - Flow

    private func begin() async {
        starting = true
        defer { starting = false }
        if await recorder.start() {
            trace = []
            stage = .recording
        }
    }

    private func finish() {
        let segments = recorder.finish()
        transcriber.enqueue(segments)
        stage = .writingUp
        // A lesson with nothing in it should not leave someone staring at
        // a skeleton that will never fill.
        if segments.isEmpty { stage = .noWords }
    }

    private func save() async {
        saving = true
        saveFailed = false
        let ok = await store.saveEntry(
            transcript: draft.trimmingCharacters(in: .whitespacesAndNewlines),
            kind: "lesson",
            coachName: coachName.trimmingCharacters(in: .whitespaces).isEmpty
                ? nil : coachName.trimmingCharacters(in: .whitespaces),
            summarize: true,
            editing: nil
        )
        saving = false
        guard ok else {
            saveFailed = true
            return
        }
        // The audio has done its job. Journal entries keep only words, and
        // two hours of a coach's voice is not ours to hold onto.
        recorder.discard()
        onSaved()
        dismiss()
    }

    // MARK: - Bits

    private var clock: String {
        let total = Int(recorder.elapsed)
        return total >= 3600
            ? String(format: "%d:%02d:%02d", total / 3600, (total % 3600) / 60, total % 60)
            : String(format: "%02d:%02d", total / 60, total % 60)
    }

    /// Only speaks up when there is a real problem. A lesson is two hours
    /// of somebody's time, so running out of battery halfway is worth one
    /// sentence beforehand.
    private var preflightWarning: String? {
        UIDevice.current.isBatteryMonitoringEnabled = true
        let battery = UIDevice.current.batteryLevel
        if battery >= 0, battery < 0.25, UIDevice.current.batteryState == .unplugged {
            return "Your battery is at \(Int(battery * 100))%. A long lesson will want a charger."
        }
        if let free = freeBytes, free < 500_000_000 {
            return "Your phone is nearly full. A two hour lesson needs about 30 MB."
        }
        return nil
    }

    private var freeBytes: Int64? {
        try? URL.documentsDirectory
            .resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
            .volumeAvailableCapacityForImportantUsage
    }
}

// MARK: - Waveform

/// The last few seconds of the room, newest on the right.
///
/// Mirrored around the centre line, which is the shape everyone already
/// reads as sound, and it fades toward the past so the movement has a
/// direction rather than twitching in place.
private struct Waveform: View {
    let samples: [Double]
    let capacity: Int
    let live: Bool

    var body: some View {
        GeometryReader { geo in
            HStack(alignment: .center, spacing: 4) {
                ForEach(0..<capacity, id: \.self) { slot in
                    let sample = value(at: slot)
                    let recency = Double(slot) / Double(capacity)
                    Capsule()
                        .fill(live ? PL.cyan.opacity(0.22 + recency * 0.78) : PL.edge)
                        .frame(height: max(5, sample * geo.size.height))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .animation(.linear(duration: 0.1), value: samples)
        }
        .accessibilityHidden(true)
    }

    /// Right-aligned, so a trace that has not filled yet grows from the
    /// right and the newest bar is always in the same place.
    private func value(at slot: Int) -> Double {
        let offset = capacity - samples.count
        let index = slot - offset
        guard index >= 0, index < samples.count else { return 0 }
        return samples[index]
    }
}

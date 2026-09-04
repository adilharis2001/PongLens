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

    /// The coaching workspace hides "Who taught it?" — the coach is the
    /// one recording, and the student was chosen before this opened.
    var hideAuthorField = false

    /// When set, the reviewed transcript is handed here instead of being
    /// written to the player's own journal. The coaching workspace uses
    /// this to file the entry under a student; everything else about the
    /// screen behaves identically.
    var saveAs: ((String) async -> Bool)? = nil

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
    /// An unfinished lesson found on disk when this screen opened.
    @State private var orphan: OrphanedLesson?

    /// The transcript, editable before it is saved. Speech to text gets
    /// names and table tennis words wrong, and the person who was at the
    /// lesson is the only one who can fix them.
    @State private var draft = ""
    /// Which of the player's own coaches taught it, and whether they may
    /// read it (164).
    @State private var coachRefId: UUID?
    @State private var shareWithCoach = false
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

    #if DEBUG
    @State private var tutorialCapturePhase: TutorialCaptureScenario.Phase?

    private var tutorialCaptureActive: Bool {
        TutorialCaptureScenario.current == .coachAudioLesson
    }
    #endif

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

    private var displayedRecorderPhase: LessonRecorder.Phase {
        #if DEBUG
        if tutorialCaptureActive {
            return tutorialCapturePhase == .paused ? .paused : .recording
        }
        #endif
        return recorder.phase
    }

    private var displayedRecorderElapsed: TimeInterval {
        #if DEBUG
        if tutorialCaptureActive {
            return tutorialCapturePhase == .paused ? 32 : 18
        }
        #endif
        return recorder.elapsed
    }

    private var displayedRecorderLevel: Double {
        #if DEBUG
        if tutorialCaptureActive {
            return tutorialCapturePhase == .paused ? 0 : 0.18
        }
        #endif
        return recorder.level
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
        .task {
            #if DEBUG
            guard !tutorialCaptureActive else { return }
            #endif
            await transcriber.prepare()
        }
        .task {
            #if DEBUG
            guard !tutorialCaptureActive else {
                await runTutorialCapture()
                return
            }
            #endif
            guard stage == .ready else { return }
            orphan = LessonRecorder.orphans().first
        }
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
        .onChange(of: transcriber.states) { _, _ in settleWritingUp() }
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

            if let orphan { unfinishedCard(orphan) }

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

    /// A lesson that never got finished, offered back rather than binned.
    ///
    /// Either answer ends with the folder gone, which is the point: the
    /// recording is not silently kept forever, and it is not silently
    /// destroyed either.
    private func unfinishedCard(_ orphan: OrphanedLesson) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("You have an unfinished lesson")
                .font(.plRowTitle)
                .foregroundStyle(PL.text100)
            Text(unfinishedSummary(orphan))
                .font(.plCaption)
                .foregroundStyle(PL.text400)
            HStack(spacing: 12) {
                Button { writeUpOrphan(orphan) } label: { wide("Write it up") }
                    .buttonStyle(PLSecondaryButtonStyle())
                Button {
                    LessonRecorder.remove(orphan)
                    // There may be more than one. Offer the next rather
                    // than waiting for the screen to be opened again.
                    self.orphan = LessonRecorder.orphans().first
                } label: {
                    wide("Delete")
                }
                .buttonStyle(PLSoftDestructiveButtonStyle())
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard(padding: 16)
    }

    private func unfinishedSummary(_ orphan: OrphanedLesson) -> String {
        let when = orphan.startedAt.formatted(date: .abbreviated, time: .shortened)
        let minutes = Int((orphan.seconds / 60).rounded())
        // "1 minutes" is the kind of thing that makes a screen look unfinished.
        if minutes < 1 { return "\(when), under a minute." }
        return "\(when), \(minutes) minute\(minutes == 1 ? "" : "s")."
    }

    private func writeUpOrphan(_ orphan: OrphanedLesson) {
        recorder.adopt(orphan)
        transcriber.enqueue(orphan.segments)
        self.orphan = nil
        stage = .writingUp
        settleWritingUp()
    }

    private var recordingState: some View {
        VStack(spacing: 32) {
            ZStack {
                Circle()
                    .fill(PL.cyan.opacity(0.05))
                    .frame(width: 208, height: 208)
                // The ring breathes with the room. It is the part you can
                // read from two metres away, which is where the phone is.
                let pulse = Self.shaped(displayedRecorderLevel)
                Circle()
                    .strokeBorder(PL.cyan.opacity(0.25 + pulse * 0.5), lineWidth: 2)
                    .frame(width: 208 + pulse * 22, height: 208 + pulse * 22)
                    .animation(.easeOut(duration: 0.12), value: pulse)

                VStack(spacing: 6) {
                    Text(clock)
                        .font(.system(size: 42, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(PL.textBody)
                    if displayedRecorderPhase == .paused {
                        Text("Paused")
                            .font(.plMicro)
                            .textCase(.uppercase)
                            .tracking(1.2)
                            .foregroundStyle(PL.warningText)
                    }
                }
            }
            .shadow(color: PL.cyan.opacity(0.12 + Self.shaped(displayedRecorderLevel) * 0.2), radius: 34)

            Waveform(
                samples: trace,
                capacity: Self.traceLength,
                live: displayedRecorderPhase == .recording
            )
            .frame(height: 64)

            VStack(spacing: 8) {
                Text(displayedRecorderPhase == .paused
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
            Text(heardNothing
                 ? "No speech was picked up."
                 : "The lesson couldn't be transcribed.")
                .font(.plCardTitle)
                .foregroundStyle(PL.text100)
                .multilineTextAlignment(.center)
            Text(heardNothing
                 ? "The recording came through with no words in it. Check nothing is covering the microphone and that the phone is close enough to hear."
                 : "The recording is still on your phone.")
                .font(.plBody)
                .foregroundStyle(PL.text400)
                .multilineTextAlignment(.center)
                .lineSpacing(3)
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

            if !hideAuthorField {
                CoachPickerRow(
                    coaches: store.playerCoaches,
                    coachRefId: $coachRefId,
                    shareWithCoach: $shareWithCoach,
                    onCreate: { await store.createCoach(named: $0) },
                    onAppearReload: { await store.loadCoaches() }
                )
                .padding(.top, 16)
            }

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

    /// Leave the writing-up stage the moment there is nothing left to wait
    /// for.
    ///
    /// Checked on entering the stage as well as on every state change. A
    /// retry that finds nothing to retry changes no state at all, and a
    /// screen listening only for changes then waits forever — which is
    /// what a lesson recorded in silence did, because its segments came
    /// back done-and-empty rather than failed.
    private func settleWritingUp() {
        guard stage == .writingUp, transcriber.allSettled else { return }
        // Nothing came back at all. Say so and offer a way on, rather than
        // dismissing into an empty composer, which would read as the lesson
        // having been thrown away.
        if transcriber.joined.isEmpty {
            // First let the server have a turn, if the phone was doing
            // this itself and heard nothing. It keeps waiting while that
            // runs, and comes back here when it settles.
            if transcriber.escalateToServer() { return }
            stage = .noWords
        } else {
            draft = transcriber.joined
            stage = .review
            Task { await loadNotes() }
        }
    }

    /// No words, and nothing refused either: every segment transcribed
    /// fine and there was no speech in any of them. Worth telling apart
    /// from a failure, because running the same silence through again
    /// returns the same silence and the screen should not offer to.
    private var heardNothing: Bool { transcriber.failedCount == 0 }

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
                        if displayedRecorderPhase == .paused {
                            recorder.resume()
                        } else {
                            recorder.pause()
                        }
                    } label: {
                        wide(displayedRecorderPhase == .paused ? "Resume" : "Pause")
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
                if heardNothing {
                    Button { startOver() } label: { wide("Record again") }
                        .buttonStyle(PLPrimaryButtonStyle())
                } else {
                    Button {
                        transcriber.retry()
                        stage = .writingUp
                        settleWritingUp()
                    } label: {
                        wide("Try again")
                    }
                    .buttonStyle(PLPrimaryButtonStyle())
                }
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
        #if DEBUG
        guard !tutorialCaptureActive else { return }
        #endif
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
        // A lesson with nothing in it should not leave someone staring at
        // a skeleton that will never fill.
        stage = segments.isEmpty ? .noWords : .writingUp
        // The last segment may already have been transcribed while the
        // lesson was still running, in which case there is nothing left to
        // wait for and no further state change to wait for it with.
        settleWritingUp()
    }

    /// Throw away an attempt that picked up nothing and go back to the
    /// start. The files are the silence, so they go with it.
    private func startOver() {
        recorder.discard()
        transcriber.reset()
        trace = []
        draft = ""
        takeaways = nil
        orphan = LessonRecorder.orphans().first
        stage = .ready
    }

    private func save() async {
        #if DEBUG
        guard !tutorialCaptureActive else { return }
        #endif
        saving = true
        saveFailed = false
        let words = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let ok: Bool
        if let saveAs {
            ok = await saveAs(words)
        } else {
            let named = coachRefId.flatMap { id in
                store.playerCoaches.first(where: { $0.id == id })?.displayName
            }
            ok = await store.saveEntry(
                transcript: words,
                kind: "lesson",
                coachName: named,
                summarize: true,
                coachRefId: coachRefId,
                shareWithCoach: shareWithCoach && coachRefId != nil
            )
        }
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

    #if DEBUG
    /// Drives the shipping lesson recorder through its visible stages. It
    /// never starts the microphone or transcriber, creates an audio file, or
    /// reaches either journal save path.
    private func runTutorialCapture() async {
        guard tutorialCaptureActive else { return }
        applyTutorialCapture(.ready)
        print(TutorialCaptureScenario.coachAudioLesson.readinessMarker)

        for transition in TutorialCaptureScenario.coachAudioLesson.transitions {
            try? await Task.sleep(
                nanoseconds: UInt64(transition.after * 1_000_000_000)
            )
            guard !Task.isCancelled else { return }
            applyTutorialCapture(transition.phase)
        }
    }

    private func applyTutorialCapture(_ phase: TutorialCaptureScenario.Phase) {
        tutorialCapturePhase = phase
        switch phase {
        case .ready:
            stage = .ready
            trace = []
            draft = ""
            takeaways = nil
        case .recording:
            stage = .recording
            trace = [
                0.18, 0.3, 0.5, 0.34, 0.62, 0.44, 0.25, 0.56,
                0.38, 0.7, 0.48, 0.22, 0.42, 0.58, 0.31, 0.52,
            ]
        case .paused:
            stage = .recording
        case .writingUp:
            stage = .writingUp
        case .review:
            draft = "Today we worked on keeping the receive short, then stepping in for the first attack. On longer serves, make the first move with the legs and keep the racket in front. Finish each drill by recovering to a balanced ready position."
            takeaways = LessonTakeaways(
                title: "Receive and first attack",
                themes: [
                    .init(
                        name: "Receive",
                        points: [
                            "Keep the touch short over the net.",
                            "Move the legs first against a long serve.",
                        ]
                    ),
                    .init(
                        name: "Recovery",
                        points: [
                            "Return to a balanced ready position after each ball.",
                        ]
                    ),
                ]
            )
            notesStale = false
            reviewTab = .notes
            stage = .review
        case .settings, .handoff:
            break
        }
    }
    #endif

    // MARK: - Bits

    private var clock: String {
        let total = Int(displayedRecorderElapsed)
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

import AVFoundation
import SwiftUI

/// One note in a thread: author line (own notes get Edit/Delete), body,
/// annotated frame, voice-note playback — the web NoteItem, native.
struct NoteItemView: View {
    let note: NoteRow
    let matchId: UUID
    let ownerId: UUID
    let viewerId: UUID
    let authorName: String?
    let notesStore: NotesStore

    @State private var imageURL: URL?
    @State private var audioPlayer: AVPlayer?
    @State private var audioLoading = false
    @State private var editing = false
    @State private var draft = ""
    @State private var confirmDelete = false

    private var isCoachNote: Bool { note.authorId != ownerId }
    private var isMine: Bool { note.authorId == viewerId }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(isMine ? "You" : (authorName ?? (isCoachNote ? "Coach" : "Player")))
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(isCoachNote ? Color(hex: 0xFCD34D) : PL.text400)
                Text("· \(PGDate.shortDate(note.createdAt))")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                if isMine, !editing {
                    Button("Edit") {
                        draft = note.body
                        editing = true
                        confirmDelete = false
                    }
                    .font(.plCaption)
                    .foregroundStyle(PL.text600)
                    .buttonStyle(.plain)
                    Button(confirmDelete ? "Delete?" : "Delete") {
                        if confirmDelete {
                            Task { await notesStore.delete(note) }
                        } else {
                            confirmDelete = true
                        }
                    }
                    .font(.system(size: 11, weight: confirmDelete ? .semibold : .regular))
                    .foregroundStyle(confirmDelete ? PL.dangerText : PL.text600)
                    .buttonStyle(.plain)
                }
                Spacer(minLength: 0)
            }

            if editing {
                TextField("Note", text: $draft, axis: .vertical)
                    .plField()
                    .lineLimit(2...6)
                HStack(spacing: 12) {
                    Button("Save") {
                        editing = false
                        Task { await notesStore.edit(note, body: draft.trimmingCharacters(in: .whitespacesAndNewlines)) }
                    }
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(PL.cyan)
                    .buttonStyle(.plain)
                    Button("Cancel") { editing = false }
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(PL.text500)
                        .buttonStyle(.plain)
                }
            } else if !note.body.isEmpty {
                Text(note.body)
                    .font(.plBody)
                    .foregroundStyle(PL.text200)
                    .lineSpacing(3)
            }

            if note.imagePath != nil {
                if let imageURL {
                    AsyncImage(url: imageURL) { image in
                        image.resizable().scaledToFit()
                    } placeholder: {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(PL.surface2.opacity(0.4))
                            .aspectRatio(16 / 9, contentMode: .fit)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .strokeBorder(PL.edge, lineWidth: 1)
                    )
                    .padding(.top, 4)
                } else {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(PL.surface2.opacity(0.4))
                        .aspectRatio(16 / 9, contentMode: .fit)
                        .padding(.top, 4)
                        .task {
                            imageURL = await NoteMedia.url(
                                matchId: matchId, noteId: note.id, image: true
                            )
                        }
                }
            }

            if note.audioPath != nil {
                Button {
                    Task { await toggleAudio() }
                } label: {
                    HStack(spacing: 6) {
                        if audioLoading {
                            ProgressView().tint(PL.cyan).scaleEffect(0.7)
                        } else {
                            Image(systemName: audioPlayer?.rate ?? 0 > 0 ? "pause.fill" : "play.fill")
                                .font(.system(size: 11))
                        }
                        Text("Voice note")
                    }
                    .font(.plCaption)
                    .foregroundStyle(PL.text300)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .padding(.top, 2)
            }
        }
        .padding(.leading, 12)
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 1)
                .fill(isCoachNote ? Color(hex: 0xFBBF24).opacity(0.5) : PL.cyan.opacity(0.4))
                .frame(width: 2)
        }
        .onDisappear { audioPlayer?.pause() }
    }

    private func toggleAudio() async {
        if let audioPlayer {
            if audioPlayer.rate > 0 {
                audioPlayer.pause()
            } else {
                await audioPlayer.seek(to: .zero)
                audioPlayer.play()
            }
            return
        }
        audioLoading = true
        if let url = await NoteMedia.url(matchId: matchId, noteId: note.id, image: false) {
            let player = AVPlayer(url: url)
            audioPlayer = player
            player.play()
        }
        audioLoading = false
    }
}

/// Chat-style composer: rounded input, mic that becomes a recording pill,
/// circular cyan send. Recording -> stop -> transcribe -> transcript lands
/// in the field with the audio attached; send writes body + audio_path
/// (+ image_path when a frame was drawn on).
struct NoteComposerView: View {
    let matchId: UUID
    let pointId: UUID?
    let userId: UUID
    let notesStore: NotesStore
    let placeholder: String
    /// The pending annotated frame (path + preview), owned by the host so
    /// Redraw can replace it.
    var pendingImagePath: String?
    var onSent: () -> Void = {}

    @State private var draft = ""
    @State private var posting = false
    @State private var recState: RecState = .idle
    @State private var elapsed = 0
    @State private var audioPath: String?
    @State private var error: String?
    @State private var recorder: AVAudioRecorder?
    @State private var timer: Timer?

    enum RecState { case idle, recording, transcribing }

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespaces).isEmpty
            || audioPath != nil || pendingImagePath != nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                if recState == .recording {
                    HStack(spacing: 8) {
                        Circle().fill(PL.dangerFill).frame(width: 8, height: 8)
                        Text(String(format: "0:%02d", elapsed))
                            .font(.system(size: 14, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(PL.text200)
                        Text("Recording — tap to finish")
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                        Spacer()
                    }
                    .padding(.horizontal, 16)
                    .frame(height: 44)
                    .background(PL.ink.opacity(0.4), in: Capsule())
                    .overlay(Capsule().strokeBorder(PL.dangerFill.opacity(0.5), lineWidth: 1))
                    .contentShape(Capsule())
                    .onTapGesture { stopRecording() }
                } else {
                    TextField(placeholder, text: $draft, axis: .vertical)
                        .font(.plBody)
                        .foregroundStyle(PL.text100)
                        .lineLimit(1...4)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .background(PL.ink.opacity(0.4), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 22, style: .continuous)
                                .strokeBorder(PL.edge, lineWidth: 1)
                        )
                }

                Button {
                    if recState == .recording {
                        stopRecording()
                    } else if recState == .idle {
                        Task { await startRecording() }
                    }
                } label: {
                    Group {
                        if recState == .transcribing {
                            ProgressView().tint(PL.cyan).scaleEffect(0.8)
                        } else {
                            Image(systemName: recState == .recording ? "stop.fill" : "mic")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundStyle(recState == .recording ? PL.dangerText : PL.text300)
                        }
                    }
                    .frame(width: 44, height: 44)
                    .overlay(Circle().strokeBorder(
                        recState == .recording ? PL.dangerFill.opacity(0.6) : PL.edge, lineWidth: 1
                    ))
                }
                .buttonStyle(.plain)
                .disabled(recState == .transcribing || posting)
                .accessibilityLabel(recState == .recording ? "Stop recording" : "Record a voice note")

                Button {
                    Task { await send() }
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(PL.ink)
                        .frame(width: 44, height: 44)
                        .background(PL.cyan.opacity(canSend ? 1 : 0.55), in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(posting || !canSend)
                .accessibilityLabel("Send note")
            }

            if audioPath != nil {
                HStack(spacing: 8) {
                    Image(systemName: "waveform")
                        .font(.system(size: 11))
                        .foregroundStyle(PL.cyan)
                    Text("Voice note attached")
                        .font(.plCaption)
                        .foregroundStyle(PL.text400)
                    Button("Remove") { audioPath = nil }
                        .font(.plCaption)
                        .foregroundStyle(PL.text600)
                        .buttonStyle(.plain)
                }
            }

            if let error {
                Text(error)
                    .font(.plCaption)
                    .foregroundStyle(PL.warningText)
            }
        }
    }

    // MARK: - Recording

    private func startRecording() async {
        error = nil
        let granted = await AVAudioApplication.requestRecordPermission()
        guard granted else {
            error = "Microphone access was blocked. Check Settings."
            return
        }
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true)
        } catch {
            self.error = "Couldn't start recording. Try again."
            return
        }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("note-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
        do {
            let rec = try AVAudioRecorder(url: url, settings: settings)
            rec.record()
            recorder = rec
            elapsed = 0
            recState = .recording
            timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
                Task { @MainActor in elapsed += 1 }
            }
        } catch {
            self.error = "Couldn't start recording. Try again."
        }
    }

    private func stopRecording() {
        timer?.invalidate()
        timer = nil
        guard let recorder else {
            recState = .idle
            return
        }
        let url = recorder.url
        recorder.stop()
        self.recorder = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        recState = .transcribing
        Task {
            defer { recState = .idle }
            guard let data = try? Data(contentsOf: url), !data.isEmpty else {
                error = "Nothing was recorded. Try again."
                return
            }
            guard data.count <= 10 * 1024 * 1024 else {
                error = "That recording is too long. Keep voice notes under 10 MB."
                return
            }
            do {
                let result = try await NoteMedia.transcribe(audio: data)
                let transcript = (result.transcript ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                if !transcript.isEmpty {
                    draft = draft.trimmingCharacters(in: .whitespaces).isEmpty
                        ? transcript
                        : draft.trimmingCharacters(in: .whitespacesAndNewlines) + "\n" + transcript
                }
                audioPath = result.audio_path
            } catch {
                self.error = "Couldn't transcribe that. Try again."
            }
            try? FileManager.default.removeItem(at: url)
        }
    }

    private func send() async {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard canSend else { return }
        posting = true
        error = nil
        let ok = await notesStore.add(
            matchId: matchId, pointId: pointId, authorId: userId, body: body,
            audioPath: audioPath, imagePath: pendingImagePath
        )
        if ok {
            draft = ""
            audioPath = nil
            onSent()
        } else {
            error = "Couldn't save that note. Try again."
        }
        posting = false
    }
}

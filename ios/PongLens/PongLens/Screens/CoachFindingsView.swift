import AVFoundation
import SwiftUI
import Supabase

/// "The points" — the workspace's cut player plus the pattern list.
/// Mirrors FindingEditor.tsx: one video of the whole cut, every
/// navigation a seek; findings are drafts until Save; point links write
/// immediately on saved findings.
struct CoachFindingsSection: View {
    @Bindable var store: CoachOrderStore

    @State private var player = AVPlayer()
    @State private var currentIndex: Int?
    @State private var tagSheetOpen = false
    @State private var openFindingId: UUID?
    @State private var draft: DraftFinding?
    @State private var annotateFrame: UIImage?
    @State private var annotateTarget: UUID?  // finding id, or nil = draft
    @State private var captureNote: String?

    // The full watch player over this cut: same takeover as the match
    // page, so the coach gets zoom, hold speeds, double-tap skip and the
    // note and draw circles without a second player growing here.
    @State private var detailModel = MatchDetailModel()
    @State private var takeoverNotes = NotesStore()
    @State private var takeoverOpen = false
    @State private var takeoverLoading = false
    @State private var takeoverTagPointId: UUID?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("The points")
                .font(.plCardTitle)
                .foregroundStyle(PL.text100)

            if store.match != nil, !store.points.isEmpty {
                CutPlayerView(
                    store: store, player: player, currentIndex: $currentIndex,
                    onExpand: { Task { await openTakeover() } },
                    expandBusy: takeoverLoading
                )
                Button("Add to a pattern") {
                    player.pause()
                    tagSheetOpen = true
                }
                .buttonStyle(PLPrimaryButtonStyle())
                .frame(maxWidth: .infinity)
                .disabled(currentIndex == nil)
            }

            if let captureNote {
                Text(captureNote).font(.plCaption).foregroundStyle(PL.warningText)
            }

            SectionHeading("Patterns")
                .padding(.top, 4)

            if draft != nil {
                FindingCardView(
                    store: store, finding: nil, draft: $draft,
                    currentPointId: currentPointId,
                    isOpen: true, onToggle: {},
                    onDraw: { requestFrame(for: nil) }
                )
            }

            ForEach(store.findings) { finding in
                FindingCardView(
                    store: store, finding: finding, draft: $draft,
                    currentPointId: currentPointId,
                    isOpen: openFindingId == finding.id,
                    onToggle: {
                        openFindingId = openFindingId == finding.id ? nil : finding.id
                    },
                    onDraw: { requestFrame(for: finding.id) }
                )
            }

            if store.findings.isEmpty, draft == nil {
                Text("No patterns yet.")
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
            }

            let unused = unusedSuggestions
            if !unused.isEmpty {
                FlowLayout(spacing: 8) {
                    ForEach(unused, id: \.self) { name in
                        Button(name) { startDraft(pointId: nil, title: name) }
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(PL.text500)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .overlay(
                                Capsule().strokeBorder(
                                    PL.edge,
                                    style: StrokeStyle(lineWidth: 1, dash: [4, 3])
                                )
                            )
                            .buttonStyle(.plain)
                    }
                }
            }

            if store.match != nil, !store.points.isEmpty {
                Button("Add a note without a point") { startDraft(pointId: nil, title: "") }
                    .buttonStyle(PLSecondaryButtonStyle())
            } else {
                Button("Add a pattern") { startDraft(pointId: nil, title: "") }
                    .buttonStyle(PLSecondaryButtonStyle())
            }
        }
        .sheet(isPresented: $tagSheetOpen) {
            TagSheet(
                store: store,
                pointIndex: currentIndex,
                draft: $draft,
                onNewPattern: { pointId, title in
                    startDraft(pointId: pointId, title: title)
                }
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .fullScreenCover(isPresented: Binding(
            get: { annotateFrame != nil },
            set: { if !$0 { annotateFrame = nil } }
        )) {
            if let frame = annotateFrame {
                AnnotatorView(frame: frame, onCancel: { annotateFrame = nil }) { jpeg in
                    await saveDrawing(jpeg)
                }
            }
        }
        .fullScreenCover(isPresented: $takeoverOpen) {
            takeoverBody
        }
        .onDisappear { player.pause() }
    }

    /// Loads the match-page model once, then hands the cut to the real
    /// watch player. The pattern circle drops back into the tag sheet.
    private func openTakeover() async {
        guard let match = store.match else { return }
        player.pause()
        takeoverLoading = true
        if detailModel.videoURL == nil {
            await detailModel.load(match)
            await takeoverNotes.load(matchId: match.id)
        }
        takeoverLoading = false
        if detailModel.videoURL != nil { takeoverOpen = true }
    }

    @ViewBuilder
    private var takeoverBody: some View {
        if let match = store.match, let url = detailModel.videoURL {
            PlayerTakeover(
                match: match,
                model: detailModel,
                pad: clipPad(strictness: nil, stored: match.clipPads),
                videoURL: url,
                startAt: currentIndex.flatMap {
                    store.points.indices.contains($0) ? store.points[$0].cutT0 : nil
                },
                mode: .watch,
                notesStore: takeoverNotes,
                onTagPoint: { point in takeoverTagPointId = point.id }
            )
            .sheet(isPresented: Binding(
                get: { takeoverTagPointId != nil },
                set: { if !$0 { takeoverTagPointId = nil } }
            )) {
                TagSheet(
                    store: store,
                    pointIndex: takeoverTagPointId.flatMap { id in
                        store.points.firstIndex(where: { $0.id == id })
                    },
                    draft: $draft,
                    onNewPattern: { pointId, title in
                        startDraft(pointId: pointId, title: title)
                        takeoverOpen = false
                    }
                )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
            }
        } else {
            PL.ink.ignoresSafeArea()
        }
    }

    private var currentPointId: UUID? {
        currentIndex.flatMap { store.points.indices.contains($0) ? store.points[$0].id : nil }
    }

    // MARK: - Drafts

    private func startDraft(pointId: UUID?, title: String) {
        if var open = draft {
            // Starting another draft merges the point in rather than
            // discarding typed text, like the web.
            if let pointId, !open.pointIds.contains(pointId) {
                open.pointIds.append(pointId)
                draft = open
            }
            return
        }
        draft = DraftFinding(
            title: title, body: "", audioPath: nil, imagePath: nil,
            imagePointId: nil, pointIds: pointId.map { [$0] } ?? []
        )
    }

    private var unusedSuggestions: [String] {
        let taken = Set(
            store.findings.map {
                $0.title.trimmingCharacters(in: .whitespaces).lowercased()
            }
        )
        return (store.detail?.suggestedPatterns ?? []).filter {
            !taken.contains($0.trimmingCharacters(in: .whitespaces).lowercased())
        }
    }

    // MARK: - Frame capture (for Draw)

    private func requestFrame(for findingId: UUID?) {
        guard let asset = player.currentItem?.asset else {
            captureNote = "Let the video load first."
            return
        }
        player.pause()
        captureNote = nil
        annotateTarget = findingId
        let generator = AVAssetImageGenerator(asset: asset)
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = .zero
        generator.appliesPreferredTrackTransform = true
        generator.generateCGImageAsynchronously(for: player.currentTime()) { cgImage, _, _ in
            Task { @MainActor in
                if let cgImage {
                    annotateFrame = UIImage(cgImage: cgImage)
                } else {
                    captureNote = "Could not capture the frame. Play the clip once, then retry."
                }
            }
        }
    }

    private func saveDrawing(_ jpeg: Data) async -> Bool {
        do {
            let path = try await NoteMedia.uploadImage(jpeg)
            let fromPoint = currentIndex.flatMap { store.points.indices.contains($0) ? store.points[$0].id : nil }
            if let findingId = annotateTarget,
               let finding = store.findings.first(where: { $0.id == findingId }) {
                _ = await store.updateFinding(
                    findingId, title: finding.title, body: finding.body,
                    audioPath: finding.audioPath, imagePath: path,
                    imagePointId: fromPoint
                )
            } else if var open = draft {
                open.imagePath = path
                open.imagePointId = fromPoint
                draft = open
            }
            annotateFrame = nil
            return true
        } catch {
            captureNote = "Could not save the drawing."
            return false
        }
    }
}

/// A finding that exists only on this phone until Save.
struct DraftFinding {
    var title: String
    var body: String
    var audioPath: String?
    var imagePath: String?
    var imagePointId: UUID?
    var pointIds: [UUID]
}

// MARK: - Cut player

/// One video, the whole cut; chips seek to each point's cut_t0.
private struct CutPlayerView: View {
    let store: CoachOrderStore
    let player: AVPlayer
    @Binding var currentIndex: Int?
    var onExpand: (() -> Void)?
    var expandBusy = false

    @Environment(AppState.self) private var app
    @State private var url: URL?
    @State private var failed = false
    @State private var playing = false
    @State private var timeObserver: Any?
    /// Measured, so a double tap knows which third of the picture it hit.
    @State private var pictureWidth: CGFloat = 0

    var body: some View {
        VStack(spacing: 10) {
            ZStack {
                if url != nil {
                    PlayerLayerView(player: player)
                } else if failed {
                    Text("The match video is not ready yet.")
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                } else {
                    ProgressView().tint(PL.cyan)
                }
                if url != nil {
                    Button {
                        toggle()
                    } label: {
                        Image(systemName: playing ? "pause.fill" : "play.fill")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                            .background(.black.opacity(0.45), in: Circle())
                    }
                    .buttonStyle(.plain)
                    .opacity(playing ? 0.0001 : 1)
                }
                if let onExpand {
                    VStack {
                        HStack {
                            Spacer()
                            Button {
                                onExpand()
                            } label: {
                                Group {
                                    if expandBusy {
                                        ProgressView().tint(.white)
                                    } else {
                                        Image(systemName: "arrow.up.left.and.arrow.down.right")
                                            .font(.system(size: 13, weight: .semibold))
                                            .foregroundStyle(.white)
                                    }
                                }
                                .frame(width: 34, height: 34)
                                .background(.black.opacity(0.45), in: Circle())
                            }
                            .buttonStyle(.plain)
                            .disabled(expandBusy)
                            .accessibilityLabel("Open the full player")
                        }
                        Spacer()
                    }
                    .padding(10)
                }
            }
            .aspectRatio(16 / 9, contentMode: .fit)
            .frame(maxWidth: .infinity)
            .background(PL.ink)
            .clipShape(RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            )
            .contentShape(Rectangle())
            .background(
                GeometryReader { picture in
                    Color.clear.onAppear { pictureWidth = picture.size.width }
                        .onChange(of: picture.size.width) { _, width in
                            pictureWidth = width
                        }
                }
            )
            // The same thirds the match player uses, so a coach who has
            // learned the gesture there does not have to learn a second
            // one over here. The chevrons below stay: this walks the
            // points without moving your thumb off the picture.
            .onTapGesture(count: 2) { location in
                switch TapZone.of(x: location.x, width: pictureWidth) {
                case .prev: step(-1)
                case .next: step(1)
                case .replay: if let current { seek(to: current) }
                }
            }
            .onTapGesture { toggle() }

            pointBar
            chipStrip
        }
        .task { await loadURL() }
        .onDisappear {
            if let timeObserver { player.removeTimeObserver(timeObserver) }
            timeObserver = nil
        }
    }

    private var current: WorkspacePoint? {
        currentIndex.flatMap { store.points.indices.contains($0) ? store.points[$0] : nil }
    }

    private var pointBar: some View {
        HStack {
            Button {
                step(-1)
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PL.text300)
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled((currentIndex ?? 0) <= 0)
            Spacer()
            if let current {
                Text(
                    "Point \(current.idx + 1)\(current.starred ? " ★" : "") · \(current.outcomeLabel)"
                )
                .font(.plBody)
                .foregroundStyle(PL.text200)
            } else {
                Text("Pick a point").font(.plBody).foregroundStyle(PL.text500)
            }
            Spacer()
            Button {
                step(1)
            } label: {
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PL.text300)
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled((currentIndex ?? -1) >= store.points.count - 1)
        }
    }

    private var chipStrip: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(store.points) { point in
                        chip(point)
                            .id(point.id)
                    }
                }
                .padding(.horizontal, 2)
            }
            .onChange(of: currentIndex) { _, index in
                if let index, store.points.indices.contains(index) {
                    withAnimation {
                        proxy.scrollTo(store.points[index].id, anchor: .center)
                    }
                }
            }
        }
    }

    private func chip(_ point: WorkspacePoint) -> some View {
        let isCurrent = current?.id == point.id
        let tagged = !store.findingIdsCiting(point.id).isEmpty
        let disabled = point.cutT0 == nil

        let fill: Color = isCurrent ? PL.cyan : chipFill(point)
        let text: Color = isCurrent ? PL.ink : chipText(point)

        return Button {
            seek(to: point)
        } label: {
            Text(String(point.idx + 1))
                .font(.system(size: 12, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(text)
                .frame(minWidth: 30)
                .padding(.vertical, 7)
                .background(fill, in: Capsule())
                .overlay(
                    Capsule().strokeBorder(
                        tagged && !isCurrent ? PL.cyan.opacity(0.7) : PL.edge.opacity(isCurrent ? 0 : 1),
                        style: point.confirmedWinner == nil && point.isLet != true && !isCurrent
                            ? StrokeStyle(lineWidth: 1, dash: [3, 3])
                            : StrokeStyle(lineWidth: 1)
                    )
                )
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.35 : 1)
    }

    private func chipFill(_ point: WorkspacePoint) -> Color {
        if point.isLet == true { return PL.warning.opacity(0.18) }
        return switch point.confirmedWinner {
        case .user: PL.cyan.opacity(0.3)
        case .opponent: PL.magenta.opacity(0.25)
        case nil: .clear
        }
    }

    private func chipText(_ point: WorkspacePoint) -> Color {
        if point.isLet == true { return PL.warningText }
        return switch point.confirmedWinner {
        case .user: PL.cyan
        case .opponent: PL.magentaSoft
        case nil: PL.text400
        }
    }

    private func toggle() {
        if playing {
            player.pause()
            playing = false
        } else {
            player.play()
            playing = true
        }
    }

    private func step(_ delta: Int) {
        let next = (currentIndex ?? 0) + delta
        guard store.points.indices.contains(next) else { return }
        seek(to: store.points[next])
    }

    private func seek(to point: WorkspacePoint) {
        guard let cutT0 = point.cutT0 else { return }
        currentIndex = store.points.firstIndex(where: { $0.id == point.id })
        player.seek(
            to: CMTime(seconds: cutT0, preferredTimescale: 600),
            toleranceBefore: .zero, toleranceAfter: .zero
        )
    }

    private func loadURL() async {
        guard let matchId = store.match?.id else { return }
        struct Req: Encodable {
            let matchId: String
            let preview = true
        }
        struct Res: Decodable { let url: String? }
        let res: Res? = try? await API.post(
            "api/media-url", Req(matchId: matchId.uuidString.lowercased())
        )
        if let signed = res?.url.flatMap(URL.init) {
            url = signed
            player.replaceCurrentItem(with: AVPlayerItem(url: signed))
            if currentIndex == nil, let first = store.points.first(where: { $0.cutT0 != nil }) {
                currentIndex = store.points.firstIndex(where: { $0.id == first.id })
            }
            startClock()
        } else {
            failed = true
        }
    }

    /// Dead footage the player jumps: deleted cards and, with the
    /// tap-end flag on (138), the tail after each winner tap, and on an
    /// unscored point the tail after the rally ended (143). Recomputed
    /// off the store like the takeover's deadSpans — the list is short.
    private var deadSpans: [TimeSpan] {
        skipSpans(
            all: store.allPoints.map(\.playheadPoint),
            pad: clipPad(strictness: nil, stored: store.match?.clipPads),
            ends: app.endOptions
        )
    }

    /// Follows playback: the current point is the last one whose cut_t0
    /// has passed.
    private func startClock() {
        guard timeObserver == nil else { return }
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main
        ) { time in
            Task { @MainActor in
                guard playing else { return }
                let t = time.seconds
                // Dead footage is dead here too — jump out of it during
                // playback, the same contract as the match players.
                if let out = spanEnd(deadSpans, at: t) {
                    player.seek(
                        to: CMTime(seconds: out, preferredTimescale: 600),
                        toleranceBefore: .zero, toleranceAfter: .zero
                    )
                    return
                }
                if let i = store.points.lastIndex(where: { ($0.cutT0 ?? .infinity) <= t }) {
                    currentIndex = i
                }
            }
        }
    }
}

extension CoachOrderStore {
    func findingIdsCiting(_ pointId: UUID) -> [UUID] {
        findings.filter { pointIds(for: $0.id).contains(pointId) }.map(\.id)
    }
}

// MARK: - Tag sheet

/// The picker over the cut player: which patterns include this point.
/// Dressed on the shared sheet scaffold — rows toggle membership and
/// save right away, Done just closes.
private struct TagSheet: View {
    @Bindable var store: CoachOrderStore
    let pointIndex: Int?
    @Binding var draft: DraftFinding?
    let onNewPattern: (UUID?, String) -> Void

    @Environment(\.dismiss) private var dismiss

    private var point: WorkspacePoint? {
        pointIndex.flatMap { store.points.indices.contains($0) ? store.points[$0] : nil }
    }

    var body: some View {
        PLSheetScaffold(title: "Add to a pattern") {
            Form {
                Section {
                    if store.findings.isEmpty {
                        Text("No patterns yet.")
                            .font(.plBody)
                            .foregroundStyle(PL.text500)
                    }
                    ForEach(store.findings) { finding in
                        let on = point.map { store.pointIds(for: finding.id).contains($0.id) } ?? false
                        Button {
                            guard let point else { return }
                            Task { await store.togglePoint(findingId: finding.id, pointId: point.id) }
                        } label: {
                            HStack(spacing: 12) {
                                Text(displayName(finding))
                                    .font(.plBody)
                                    .foregroundStyle(PL.text100)
                                    .lineLimit(1)
                                Spacer()
                                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                                    .font(.system(size: 20, weight: .regular))
                                    .foregroundStyle(on ? PL.cyan : PL.text600)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Text("Patterns")
                } footer: {
                    if let point {
                        Text(
                            "Tap a pattern to add point \(point.idx + 1) to it, tap again to take it out. Changes save right away."
                        )
                    }
                }

                if !unusedSuggestions.isEmpty {
                    Section {
                        ForEach(unusedSuggestions, id: \.self) { name in
                            Button {
                                onNewPattern(point?.id, name)
                                dismiss()
                            } label: {
                                HStack(spacing: 12) {
                                    Text(name)
                                        .font(.plBody)
                                        .foregroundStyle(PL.text300)
                                        .lineLimit(1)
                                    Spacer()
                                    Image(systemName: "plus.circle")
                                        .font(.system(size: 20, weight: .regular))
                                        .foregroundStyle(PL.text600)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    } header: {
                        Text("Suggested")
                    } footer: {
                        Text("Tap one to start it as a new pattern with this point.")
                    }
                }

                Section {
                    Button(point == nil ? "New pattern" : "New pattern with this point") {
                        onNewPattern(point?.id, "")
                        dismiss()
                    }
                    .buttonStyle(PLPrimaryButtonStyle())
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
            }
        }
    }

    private func displayName(_ finding: ReviewFindingRow) -> String {
        let title = finding.title.trimmingCharacters(in: .whitespaces)
        if !title.isEmpty { return title }
        let firstLine = finding.body.split(separator: "\n").first.map(String.init) ?? ""
        return firstLine.isEmpty ? "Unnamed pattern" : firstLine
    }

    private var unusedSuggestions: [String] {
        guard draft == nil else { return [] }
        let taken = Set(
            store.findings.map {
                $0.title.trimmingCharacters(in: .whitespaces).lowercased()
            }
        )
        return (store.detail?.suggestedPatterns ?? []).filter {
            !taken.contains($0.trimmingCharacters(in: .whitespaces).lowercased())
        }
    }
}

// MARK: - Finding card

/// One pattern — collapsed row or the full editor. Saved rows write on
/// Save; a draft (finding == nil) inserts on Save and vanishes on Discard.
struct FindingCardView: View {
    @Bindable var store: CoachOrderStore
    let finding: ReviewFindingRow?
    @Binding var draft: DraftFinding?
    var currentPointId: UUID?
    let isOpen: Bool
    let onToggle: () -> Void
    let onDraw: () -> Void

    @State private var title = ""
    @State private var body_ = ""
    @State private var audioPath: String?
    @State private var imagePath: String?
    @State private var imagePointId: UUID?
    @State private var hydrated = false
    @State private var recorder = VoiceRecorderModel()
    @State private var note: String?
    @State private var saving = false
    @State private var confirmDelete = false
    @State private var imageURL: URL?
    @State private var audioURL: URL?

    private var isDraft: Bool { finding == nil }

    private var linkedNumbers: [Int] {
        if let finding {
            return store.pointNumbers(for: finding.id)
        }
        let ids = Set(draft?.pointIds ?? [])
        return store.points.filter { ids.contains($0.id) }.map { $0.idx + 1 }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                if !isDraft { onToggle() }
            } label: {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(displayName)
                            .font(.plRowTitle)
                            .foregroundStyle(PL.text100)
                            .lineLimit(1)
                        pointsLine
                            .font(.plCaption)
                            .monospacedDigit()
                    }
                    Spacer()
                    if !isDraft {
                        Image(systemName: "chevron.down")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(PL.text500)
                            .rotationEffect(.degrees(isOpen ? 180 : 0))
                    }
                }
                .padding(16)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isOpen {
                VStack(alignment: .leading, spacing: 12) {
                    pointChips
                    TextField("Name the pattern", text: $title)
                        .plField()
                    TextField(
                        "What you see and what to change", text: $body_, axis: .vertical
                    )
                    .lineLimit(4...12)
                    .plField()
                    mediaPreviews
                    recorderRow
                    if let note {
                        Text(note).font(.plCaption).foregroundStyle(PL.warningText)
                    }
                    footer
                }
                .padding(16)
                .padding(.top, 0)
            }
        }
        .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                .strokeBorder(PL.edge, lineWidth: 1)
        )
        .onAppear { hydrate() }
        .task(id: isOpen) {
            guard isOpen, let finding else { return }
            if finding.audioPath != nil, audioURL == nil {
                audioURL = await store.findingMediaURL(finding.id, kind: "audio")
            }
            if finding.imagePath != nil, imageURL == nil {
                imageURL = await store.findingMediaURL(finding.id, kind: "image")
            }
        }
    }

    private var displayName: String {
        let t = title.trimmingCharacters(in: .whitespaces)
        if !t.isEmpty { return t }
        let firstLine = body_.split(separator: "\n").first.map(String.init) ?? ""
        if !firstLine.isEmpty { return firstLine }
        return isDraft ? "New pattern" : "Unnamed pattern"
    }

    /// "Points 1, 4, 7" under the name, the number of the point on screen
    /// in cyan — the same cyan the chip strip uses for the current point.
    private var pointsLine: Text {
        if linkedNumbers.isEmpty {
            return Text("No points yet.").foregroundStyle(PL.text600)
        }
        let currentN = currentPointId.flatMap { store.pointNumber(for: $0) }
        var line = Text(linkedNumbers.count == 1 ? "Point " : "Points ")
            .foregroundStyle(PL.text500)
        for (i, n) in linkedNumbers.enumerated() {
            if i > 0 { line = line + Text(", ").foregroundStyle(PL.text500) }
            line = line + Text(String(n))
                .foregroundStyle(n == currentN ? PL.cyan : PL.text500)
        }
        return line
    }

    private func hydrate() {
        guard !hydrated else { return }
        hydrated = true
        if let finding {
            title = finding.title
            body_ = finding.body
            audioPath = finding.audioPath
            imagePath = finding.imagePath
            imagePointId = finding.imagePointId
        } else if let draft {
            title = draft.title
            body_ = draft.body
            audioPath = draft.audioPath
            imagePath = draft.imagePath
            imagePointId = draft.imagePointId
        }
    }

    // MARK: chips

    @ViewBuilder
    private var pointChips: some View {
        if !linkedNumbers.isEmpty {
            FlowLayout(spacing: 6) {
                ForEach(linkedPointIds, id: \.self) { pointId in
                    let n = store.pointNumber(for: pointId) ?? 0
                    HStack(spacing: 0) {
                        Button {
                            // Seeking happens from the player; the chip
                            // number is informational here.
                        } label: {
                            Text(String(n))
                                .font(.system(size: 12, weight: .semibold))
                                .monospacedDigit()
                                .foregroundStyle(PL.text200)
                                .padding(.leading, 10)
                                .padding(.vertical, 6)
                        }
                        .buttonStyle(.plain)
                        Button {
                            removePoint(pointId)
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(PL.text500)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 8)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Remove point \(n)")
                    }
                    .background(PL.ink.opacity(0.4), in: Capsule())
                    .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                }
            }
            Text("Tap × to remove a point. Add more from the player above.")
                .font(.plCaption)
                .foregroundStyle(PL.text600)
        }
    }

    private var linkedPointIds: [UUID] {
        if let finding { return store.pointIds(for: finding.id) }
        let ids = Set(draft?.pointIds ?? [])
        return store.points.filter { ids.contains($0.id) }.map(\.id)
    }

    private func removePoint(_ pointId: UUID) {
        if let finding {
            Task { await store.removePoint(findingId: finding.id, pointId: pointId) }
        } else if var open = draft {
            open.pointIds.removeAll { $0 == pointId }
            draft = open
        }
    }

    // MARK: media

    @ViewBuilder
    private var mediaPreviews: some View {
        if audioPath != nil, recorder.state == .idle {
            HStack(spacing: 12) {
                if let audioURL {
                    AudioPlayButton(url: audioURL)
                } else {
                    Text("Voice note attached.")
                        .font(.plCaption)
                        .foregroundStyle(PL.text400)
                }
                Spacer()
                Button("Remove") {
                    audioPath = nil
                    audioURL = nil
                }
                .buttonStyle(PLSoftDestructiveButtonStyle())
            }
            .plInnerRow()
        }
        if imagePath != nil {
            VStack(alignment: .leading, spacing: 6) {
                if let imageURL {
                    AsyncImage(url: imageURL) { phase in
                        if let image = phase.image {
                            image.resizable().scaledToFit()
                        } else {
                            RoundedRectangle(cornerRadius: PL.rSmall)
                                .fill(PL.ink.opacity(0.4))
                                .aspectRatio(16 / 9, contentMode: .fit)
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: PL.rSmall, style: .continuous))
                } else {
                    Text("Drawing attached.")
                        .font(.plCaption)
                        .foregroundStyle(PL.text400)
                }
                HStack {
                    if let imagePointId, let n = store.pointNumber(for: imagePointId) {
                        Text("From point \(n)")
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                    }
                    Spacer()
                    Button("Remove") {
                        imagePath = nil
                        imagePointId = nil
                        imageURL = nil
                    }
                    .buttonStyle(PLSoftDestructiveButtonStyle())
                }
            }
        }
    }

    private var recorderRow: some View {
        HStack(spacing: 12) {
            DictateButton(recorder: recorder, tier: "review") { result in
                if let transcript = result.transcript?
                    .trimmingCharacters(in: .whitespacesAndNewlines), !transcript.isEmpty {
                    body_ = body_.trimmingCharacters(in: .whitespaces).isEmpty
                        ? transcript : body_ + "\n" + transcript
                }
                audioPath = result.audio_path
                audioURL = result.url.flatMap(URL.init)
            } onError: {
                note = "Could not process the recording."
            }
            if recorder.state == .idle {
                Button(imagePath == nil ? "Draw on the frame" : "Redraw") { onDraw() }
                    .buttonStyle(PLSecondaryButtonStyle())
            }
        }
    }

    // MARK: footer

    private var footer: some View {
        HStack {
            if isDraft {
                Button("Discard") { draft = nil }
                    .buttonStyle(PLSoftDestructiveButtonStyle())
            } else {
                Button(confirmDelete ? "Really delete?" : "Delete") {
                    if confirmDelete, let finding {
                        Task { await store.deleteFinding(finding.id) }
                    } else {
                        confirmDelete = true
                    }
                }
                .buttonStyle(PLSoftDestructiveButtonStyle())
            }
            Spacer()
            Button(saving ? "Saving" : "Save") {
                Task { await save() }
            }
            .buttonStyle(PLPrimaryButtonStyle())
            .disabled(saving)
        }
    }

    private func save() async {
        saving = true
        note = nil
        if let finding {
            let ok = await store.updateFinding(
                finding.id, title: title, body: body_,
                audioPath: audioPath, imagePath: imagePath, imagePointId: imagePointId
            )
            if ok { onToggle() } else { note = "Could not save. Try again." }
        } else {
            let row = await store.createFinding(
                title: title, body: body_, audioPath: audioPath,
                imagePath: imagePath, imagePointId: imagePointId,
                pointIds: draft?.pointIds ?? []
            )
            if row != nil { draft = nil } else { note = "Could not save. Try again." }
        }
        saving = false
    }
}

// MARK: - Voice recording

/// AVAudioRecorder → api/transcribe, the point-notes recipe with the
/// review tier so the audio lands under review/<uid>/ and skips voice
/// retention.
@Observable
final class VoiceRecorderModel {
    enum RecState { case idle, recording, transcribing }

    var state: RecState = .idle
    var elapsed = 0

    private var recorder: AVAudioRecorder?
    private var fileURL: URL?
    private var timer: Timer?

    func start() async -> Bool {
        let granted = await AVAudioApplication.requestRecordPermission()
        guard granted else { return false }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true)
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("finding-\(UUID().uuidString).m4a")
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
            ]
            let rec = try AVAudioRecorder(url: url, settings: settings)
            rec.record()
            recorder = rec
            fileURL = url
            elapsed = 0
            state = .recording
            timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
                Task { @MainActor in self.elapsed += 1 }
            }
            return true
        } catch {
            return false
        }
    }

    func stopAndTranscribe(tier: String) async -> ReviewMedia.TranscribeResult? {
        timer?.invalidate()
        timer = nil
        recorder?.stop()
        recorder = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        guard let fileURL, let data = try? Data(contentsOf: fileURL) else {
            state = .idle
            return nil
        }
        defer { try? FileManager.default.removeItem(at: fileURL) }
        guard data.count <= 10 * 1024 * 1024 else {
            state = .idle
            return nil
        }
        state = .transcribing
        let result = try? await ReviewMedia.transcribe(audio: data, tier: tier)
        state = .idle
        return result
    }
}

enum ReviewMedia {
    struct TranscribeResult: Decodable {
        let audio_path: String
        let transcript: String?
        let url: String?
    }

    static func transcribe(audio: Data, tier: String) async throws -> TranscribeResult {
        try await API.postMultipart(
            "api/transcribe", field: "audio", filename: "finding.mp4",
            mime: "audio/mp4", data: audio, fields: ["tier": tier]
        )
    }
}

/// The mic control: idle mic circle → red recording pill with a clock →
/// transcribing spinner.
struct DictateButton: View {
    let recorder: VoiceRecorderModel
    var tier = "review"
    let onResult: (ReviewMedia.TranscribeResult) -> Void
    let onError: () -> Void

    var body: some View {
        switch recorder.state {
        case .idle:
            Button {
                Task {
                    if await recorder.start() == false { onError() }
                }
            } label: {
                Image(systemName: "mic")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(PL.text300)
                    .frame(width: 40, height: 40)
                    .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Record a voice note")
        case .recording:
            Button {
                Task {
                    if let result = await recorder.stopAndTranscribe(tier: tier) {
                        onResult(result)
                    } else {
                        onError()
                    }
                }
            } label: {
                HStack(spacing: 8) {
                    Circle().fill(PL.dangerFill).frame(width: 8, height: 8)
                    Text(String(format: "%d:%02d", recorder.elapsed / 60, recorder.elapsed % 60))
                        .font(.plCaption)
                        .monospacedDigit()
                        .foregroundStyle(PL.text200)
                    Image(systemName: "stop.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(PL.dangerText)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .overlay(Capsule().strokeBorder(PL.dangerFill.opacity(0.6), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Stop recording")
        case .transcribing:
            HStack(spacing: 8) {
                ProgressView().tint(PL.cyan)
                Text("Transcribing…").font(.plCaption).foregroundStyle(PL.text400)
            }
        }
    }
}

/// A "Voice note" play capsule on a signed URL.
struct AudioPlayButton: View {
    let url: URL

    @State private var player: AVPlayer?
    @State private var playing = false

    var body: some View {
        Button {
            if playing {
                player?.pause()
                playing = false
            } else {
                let p = player ?? AVPlayer(url: url)
                player = p
                p.seek(to: .zero)
                p.play()
                playing = true
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: playing ? "pause.fill" : "play.fill")
                    .font(.system(size: 11, weight: .semibold))
                Text("Voice note").font(.plCaption)
            }
            .foregroundStyle(PL.cyan)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(PL.cyan.opacity(0.1), in: Capsule())
            .overlay(Capsule().strokeBorder(PL.cyan.opacity(0.5), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .onDisappear { player?.pause() }
    }
}

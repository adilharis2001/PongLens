import AVFoundation
import SwiftUI

// The Learn hub renders the same guide data the web ships (bundled as
// guides.json, extracted from src/app/learn/guides.ts — regenerate after
// content edits there).

struct GuideSectionData: Codable, Hashable {
    let heading: String?
    let steps: [String]?
    let paragraphs: [String]?
    let bullets: [String]?
    let tip: String?
}

struct GuideData: Codable, Hashable, Identifiable {
    let slug: String
    let title: String
    let summary: String
    let group: String
    let sections: [GuideSectionData]
    let related: [String]?

    var id: String { slug }
}

struct GuidesFile: Codable {
    let groups: [String]
    let guides: [GuideData]
}

enum GuideLibrary {
    static let shared: GuidesFile = {
        guard let url = Bundle.main.url(forResource: "guides", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let file = try? JSONDecoder().decode(GuidesFile.self, from: data) else {
            return GuidesFile(groups: [], guides: [])
        }
        return file
    }()
}

struct LearnScreen: View {
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var results: [GuideData] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return GuideLibrary.shared.guides }
        return GuideLibrary.shared.guides.filter { guide in
            guide.title.lowercased().contains(q)
                || guide.summary.lowercased().contains(q)
                || guide.sections.contains { section in
                    (section.paragraphs ?? []).contains { $0.lowercased().contains(q) }
                        || (section.steps ?? []).contains { $0.lowercased().contains(q) }
                }
        }
    }

    var body: some View {
        ZStack {
            ArenaBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Button {
                        dismiss()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 12, weight: .semibold))
                            Text("Back")
                        }
                    }
                    .buttonStyle(PLSecondaryButtonStyle())

                    Text("Learn")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)

                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 14))
                            .foregroundStyle(PL.text500)
                        TextField("Search the guides", text: $query)
                            .font(.plBody)
                            .foregroundStyle(PL.text200)
                            .tint(PL.cyan)
                    }
                    .padding(.horizontal, 16)
                    .frame(height: 44)
                    .background(PL.surface2.opacity(0.4), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                            .strokeBorder(PL.edge, lineWidth: 1)
                    )

                    if query.isEmpty {
                        NavigationLink(value: "learn-videos") {
                            HStack(spacing: 12) {
                                Circle()
                                    .fill(PL.cyan.opacity(0.1))
                                    .frame(width: 36, height: 36)
                                    .overlay(Circle().strokeBorder(PL.cyan.opacity(0.4), lineWidth: 1))
                                    .overlay(
                                        Image(systemName: "play.fill")
                                            .font(.system(size: 13))
                                            .foregroundStyle(PL.cyan)
                                    )
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Tutorial videos")
                                        .font(.plRowTitle)
                                        .foregroundStyle(PL.text100)
                                    Text("The whole product, one chapter at a time.")
                                        .font(.plCaption)
                                        .foregroundStyle(PL.text500)
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(PL.text600)
                            }
                            .plCard(padding: 14)
                        }
                        .buttonStyle(.plain)
                    }

                    if results.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Nothing found for that.")
                                .font(.plRowTitle)
                                .foregroundStyle(PL.text200)
                            Text("Try another word, or browse the guides below. Missing a guide you needed? Tell us through Send feedback on the Account page.")
                                .font(.plCaption)
                                .foregroundStyle(PL.text500)
                        }
                        .plCard(padding: 18)
                    } else {
                        ForEach(GuideLibrary.shared.groups, id: \.self) { group in
                            let inGroup = results.filter { $0.group == group }
                            if !inGroup.isEmpty {
                                VStack(alignment: .leading, spacing: 10) {
                                    SectionHeading(group)
                                    VStack(spacing: 0) {
                                        ForEach(Array(inGroup.enumerated()), id: \.element.id) { i, guide in
                                            NavigationLink(value: guide) {
                                                HStack {
                                                    VStack(alignment: .leading, spacing: 2) {
                                                        Text(guide.title)
                                                            .font(.plRowTitle)
                                                            .foregroundStyle(PL.text100)
                                                        Text(guide.summary)
                                                            .font(.plCaption)
                                                            .foregroundStyle(PL.text500)
                                                            .lineLimit(2)
                                                    }
                                                    Spacer()
                                                    Image(systemName: "chevron.right")
                                                        .font(.system(size: 12, weight: .semibold))
                                                        .foregroundStyle(PL.text600)
                                                }
                                                .padding(14)
                                                .contentShape(Rectangle())
                                            }
                                            .buttonStyle(.plain)
                                            if i < inGroup.count - 1 {
                                                Rectangle().fill(PL.edge.opacity(0.5)).frame(height: 1).padding(.leading, 14)
                                            }
                                        }
                                    }
                                    .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                                            .strokeBorder(PL.edge, lineWidth: 1)
                                    )
                                }
                            }
                        }
                    }
                }
                .padding(20)
                .padding(.bottom, 60)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .plKeyboardDismiss()
        .navigationDestination(for: GuideData.self) { guide in
            GuideDetailScreen(guide: guide)
        }
    }
}

struct GuideDetailScreen: View {
    let guide: GuideData
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            ArenaBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Button {
                        dismiss()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 12, weight: .semibold))
                            Text("Back")
                        }
                    }
                    .buttonStyle(PLSecondaryButtonStyle())

                    VStack(alignment: .leading, spacing: 8) {
                        Text(guide.title)
                            .font(.plPageTitle)
                            .tracking(-0.6)
                            .foregroundStyle(PL.textBody)
                        Text(guide.summary)
                            .font(.plBody)
                            .foregroundStyle(PL.text400)
                            .lineSpacing(4)
                    }

                    // The upload guide carries the same placement picture
                    // the upload page teaches with.
                    if guide.slug == "upload-a-video" {
                        CameraDiagram()
                            .aspectRatio(340.0 / 300.0, contentMode: .fit)
                            .frame(maxWidth: .infinity)
                            .plCard(padding: 16)
                    }

                    ForEach(Array(guide.sections.enumerated()), id: \.offset) { _, section in
                        VStack(alignment: .leading, spacing: 10) {
                            if let heading = section.heading {
                                Text(heading)
                                    .font(.system(size: 17, weight: .semibold))
                                    .foregroundStyle(PL.text100)
                            }
                            if let steps = section.steps {
                                VStack(alignment: .leading, spacing: 8) {
                                    ForEach(Array(steps.enumerated()), id: \.offset) { i, step in
                                        HStack(alignment: .top, spacing: 10) {
                                            Text("\(i + 1)")
                                                .font(.system(size: 12, weight: .semibold))
                                                .monospacedDigit()
                                                .foregroundStyle(PL.cyan)
                                                .frame(width: 22, height: 22)
                                                .background(PL.cyan.opacity(0.1), in: Circle())
                                                .overlay(Circle().strokeBorder(PL.cyan.opacity(0.4), lineWidth: 1))
                                            Text(step)
                                                .font(.plBody)
                                                .foregroundStyle(PL.text200)
                                                .lineSpacing(3)
                                        }
                                    }
                                }
                            }
                            ForEach(section.paragraphs ?? [], id: \.self) { paragraph in
                                Text(paragraph)
                                    .font(.plBody)
                                    .foregroundStyle(PL.text300)
                                    .lineSpacing(4)
                            }
                            ForEach(section.bullets ?? [], id: \.self) { bullet in
                                HStack(alignment: .top, spacing: 8) {
                                    Circle().fill(PL.text600).frame(width: 4, height: 4).padding(.top, 7)
                                    Text(bullet)
                                        .font(.plBody)
                                        .foregroundStyle(PL.text300)
                                        .lineSpacing(3)
                                }
                            }
                            if let tip = section.tip {
                                (Text("Good to know ").fontWeight(.semibold).foregroundColor(PL.warningText)
                                    + Text(tip).foregroundColor(PL.text300))
                                    .font(.plCaption)
                                    .padding(12)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(PL.warning.opacity(0.06), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                                            .strokeBorder(PL.warning.opacity(0.2), lineWidth: 1)
                                    )
                            }
                        }
                    }

                    if let related = guide.related, !related.isEmpty {
                        SectionHeading("Keep going")
                        ForEach(related, id: \.self) { slug in
                            if let next = GuideLibrary.shared.guides.first(where: { $0.slug == slug }) {
                                NavigationLink(value: next) {
                                    HStack {
                                        Text(next.title)
                                            .font(.plRowTitle)
                                            .foregroundStyle(PL.text100)
                                        Spacer()
                                        Image(systemName: "chevron.right")
                                            .font(.system(size: 12, weight: .semibold))
                                            .foregroundStyle(PL.text600)
                                    }
                                    .plInnerRow()
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .padding(20)
                .padding(.bottom, 60)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
    }
}

// MARK: - Tutorial videos

/// Tutorial videos, watched like videos: a chapter picker to start, then a
/// big player with real transport — scrubbing, times, previous and next
/// chapter — sound on regardless of the silent switch, and full screen the
/// moment the phone turns sideways.
struct TutorialVideosScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    @State private var urls: [String: URL] = [:]
    @State private var currentIndex: Int?
    @State private var player = AVPlayer()
    @State private var isPlaying = false
    @State private var currentT: Double = 0
    @State private var duration: Double = 0
    @State private var scrubbing = false
    @State private var scrubT: Double = 0
    @State private var loading = false
    @State private var observer: Any?
    @State private var chaptersOpen = false

    private let chapters: [(slug: String, title: String)] = [
        ("home", "Start here"),
        ("upload", "Upload a match"),
        ("viewer", "Watch it back"),
        ("point", "Score a point"),
        ("keepscore", "Score the Match"),
        ("analysis", "Read your match"),
        ("export", "Export and share"),
        ("coach", "You and your coach"),
        ("journal", "The journal"),
    ]

    var body: some View {
        GeometryReader { geo in
            let landscape = geo.size.width > geo.size.height
            ZStack {
                PL.ink.ignoresSafeArea()
                if currentIndex == nil {
                    picker
                } else if landscape {
                    // Sideways is full screen: just the footage and its
                    // transport.
                    ZStack {
                        Color.black.ignoresSafeArea()
                        PlayerLayerView(player: player)
                            .ignoresSafeArea()
                        VStack {
                            HStack {
                                Spacer()
                                closeChip
                            }
                            Spacer()
                            transport
                        }
                        .padding(14)
                    }
                } else {
                    VStack(spacing: 0) {
                        HStack {
                            Button {
                                stopPlayback()
                                currentIndex = nil
                            } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: "chevron.left")
                                        .font(.system(size: 12, weight: .semibold))
                                    Text("Chapters")
                                }
                            }
                            .buttonStyle(PLSecondaryButtonStyle())
                            Spacer()
                            if let currentIndex {
                                Text(chapters[currentIndex].title)
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(PL.text100)
                            }
                            Spacer()
                            closeChip
                        }
                        .padding(16)

                        // The chapters are portrait, mobile-first footage —
                        // the video owns the screen and the layer letterboxes
                        // whatever aspect arrives.
                        ZStack {
                            Color.black
                            if loading {
                                ProgressView().tint(PL.cyan)
                            } else {
                                PlayerLayerView(player: player)
                            }
                            Color.clear
                                .contentShape(Rectangle())
                                .onTapGesture { togglePlay() }
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)

                        transport
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                    }
                    .sheet(isPresented: $chaptersOpen) {
                        chaptersSheet
                            .presentationDetents([.medium, .large])
                            .presentationBackground(PL.surface)
                            .presentationDragIndicator(.visible)
                    }
                }
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task {
            // Playback category: tutorials speak, and the silent switch
            // was eating their voice.
            try? AVAudioSession.sharedInstance().setCategory(.playback)
            try? AVAudioSession.sharedInstance().setActive(true)
        }
        .onDisappear { stopPlayback() }
    }

    // MARK: - Picker

    private var picker: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Button {
                    dismiss()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 12, weight: .semibold))
                        Text("Back")
                    }
                }
                .buttonStyle(PLSecondaryButtonStyle())

                Text("Tutorial videos")
                    .font(.plPageTitle)
                    .tracking(-0.6)
                    .foregroundStyle(PL.textBody)

                VStack(spacing: 10) {
                    ForEach(Array(chapters.enumerated()), id: \.element.slug) { i, chapter in
                        Button {
                            Task { await play(index: i) }
                        } label: {
                            HStack(spacing: 14) {
                                Text("\(i + 1)")
                                    .font(.system(size: 14, weight: .bold))
                                    .monospacedDigit()
                                    .foregroundStyle(PL.cyan)
                                    .frame(width: 32, height: 32)
                                    .background(PL.cyan.opacity(0.1), in: Circle())
                                    .overlay(Circle().strokeBorder(PL.cyan.opacity(0.35), lineWidth: 1))
                                Text(chapter.title)
                                    .font(.plRowTitle)
                                    .foregroundStyle(PL.text100)
                                Spacer()
                                Image(systemName: "play.fill")
                                    .font(.system(size: 13))
                                    .foregroundStyle(PL.text500)
                            }
                            .padding(14)
                            .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                                    .strokeBorder(PL.edge, lineWidth: 1)
                            )
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(20)
            .padding(.bottom, 60)
        }
    }

    // MARK: - Playback chrome

    private var closeChip: some View {
        Button {
            stopPlayback()
            dismiss()
        } label: {
            Image(systemName: "xmark")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(PL.text300)
                .padding(9)
                .background(PL.ink.opacity(0.7), in: Circle())
        }
        .buttonStyle(.plain)
    }

    private var transport: some View {
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                Text(timeString(scrubbing ? scrubT : currentT))
                    .font(.plMicro).monospacedDigit().foregroundStyle(PL.text300)
                Slider(
                    value: Binding(
                        get: { scrubbing ? scrubT : min(currentT, max(duration, 0.1)) },
                        set: { scrubT = $0 }
                    ),
                    in: 0...max(duration, 0.1)
                ) { editing in
                    scrubbing = editing
                    if !editing {
                        player.seek(
                            to: CMTime(seconds: scrubT, preferredTimescale: 600),
                            toleranceBefore: .zero, toleranceAfter: .zero
                        )
                        currentT = scrubT
                    }
                }
                .tint(PL.cyan)
                Text(timeString(duration))
                    .font(.plMicro).monospacedDigit().foregroundStyle(PL.text500)
            }
            HStack(spacing: 26) {
                // Balances the chapters button so the play cluster stays
                // centered.
                Color.clear.frame(width: 38, height: 38)
                Spacer()
                Button {
                    if let i = currentIndex, i > 0 {
                        Task { await play(index: i - 1) }
                    }
                } label: {
                    Image(systemName: "backward.end.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(currentIndex ?? 0 > 0 ? PL.text200 : PL.text600)
                }
                .buttonStyle(.plain)
                .disabled((currentIndex ?? 0) == 0)
                Button {
                    togglePlay()
                } label: {
                    Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 24))
                        .foregroundStyle(.white)
                        .frame(width: 46, height: 46)
                }
                .buttonStyle(.plain)
                Button {
                    if let i = currentIndex, i < chapters.count - 1 {
                        Task { await play(index: i + 1) }
                    }
                } label: {
                    Image(systemName: "forward.end.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(
                            (currentIndex ?? 0) < chapters.count - 1 ? PL.text200 : PL.text600
                        )
                }
                .buttonStyle(.plain)
                .disabled((currentIndex ?? 0) >= chapters.count - 1)
                Spacer()
                Button {
                    chaptersOpen = true
                } label: {
                    Image(systemName: "list.bullet")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(PL.text200)
                        .frame(width: 38, height: 38)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Chapters")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(PL.ink.opacity(0.72), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var chaptersSheet: some View {
        ScrollView {
            VStack(spacing: 6) {
                ForEach(Array(chapters.enumerated()), id: \.element.slug) { i, chapter in
                    Button {
                        chaptersOpen = false
                        Task { await play(index: i) }
                    } label: {
                        HStack(spacing: 12) {
                            Text("\(i + 1)")
                                .font(.plMicro)
                                .monospacedDigit()
                                .foregroundStyle(currentIndex == i ? PL.cyan : PL.text500)
                                .frame(width: 24)
                            Text(chapter.title)
                                .font(.plBody)
                                .foregroundStyle(currentIndex == i ? PL.cyan : PL.text300)
                            Spacer()
                            if currentIndex == i {
                                Image(systemName: "waveform")
                                    .font(.system(size: 12))
                                    .foregroundStyle(PL.cyan)
                            }
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(
                            currentIndex == i ? PL.cyan.opacity(0.08) : .clear,
                            in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                        )
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 12)
            .padding(.bottom, 24)
        }
    }

    // MARK: - Playback

    private func play(index: Int) async {
        let slug = chapters[index].slug
        currentIndex = index
        loading = urls[slug] == nil
        if urls[slug] == nil {
            struct Req: Encodable { let slug: String }
            struct Res: Decodable { let urls: [String: String] }
            let res: Res? = try? await API.post("api/tutorial-url", Req(slug: slug))
            if let raw = res?.urls[slug], let url = URL(string: raw) {
                urls[slug] = url
            }
        }
        loading = false
        guard let url = urls[slug] else { return }
        duration = 0
        currentT = 0
        player.replaceCurrentItem(with: AVPlayerItem(url: url))
        if observer == nil {
            observer = player.addPeriodicTimeObserver(
                forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main
            ) { time in
                Task { @MainActor in
                    currentT = time.seconds
                    isPlaying = player.rate > 0
                    if duration == 0, let d = player.currentItem?.duration.seconds,
                       d.isFinite, d > 0 {
                        duration = d
                    }
                    // Chapter finished: roll into the next one.
                    if duration > 0, time.seconds >= duration - 0.1, player.rate > 0,
                       let i = currentIndex, i < chapters.count - 1 {
                        Task { await play(index: i + 1) }
                    }
                }
            }
        }
        player.play()
        isPlaying = true
        await app.setMetadataFlag("tutorial_started", true)
    }

    private func togglePlay() {
        if player.rate > 0 {
            player.pause()
            isPlaying = false
        } else {
            player.play()
            isPlaying = true
        }
    }

    private func stopPlayback() {
        player.pause()
        if let observer { player.removeTimeObserver(observer) }
        observer = nil
        isPlaying = false
    }

    private func timeString(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let s = Int(seconds.rounded())
        return "\(s / 60):" + String(format: "%02d", s % 60)
    }
}

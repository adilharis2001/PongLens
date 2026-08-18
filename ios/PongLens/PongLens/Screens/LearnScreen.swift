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
                            Text("Learn")
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

struct TutorialVideosScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    @State private var urls: [String: URL] = [:]
    @State private var playing: String?
    @State private var player = AVPlayer()

    private let chapters: [(slug: String, title: String)] = [
        ("home", "Start here"),
        ("upload", "Upload a match"),
        ("viewer", "Watch it back"),
        ("point", "Score a point"),
        ("keepscore", "Score Keeper"),
        ("analysis", "Read your match"),
        ("export", "Export and share"),
        ("coach", "You and your coach"),
        ("journal", "The journal"),
    ]

    var body: some View {
        ZStack {
            PL.ink.ignoresSafeArea()
            VStack(spacing: 0) {
                HStack {
                    Button {
                        dismiss()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 12, weight: .semibold))
                            Text("Learn")
                        }
                    }
                    .buttonStyle(PLSecondaryButtonStyle())
                    Spacer()
                    Text("Tutorial videos")
                        .font(.plCardTitle)
                        .foregroundStyle(PL.text100)
                    Spacer()
                }
                .padding(16)

                ZStack {
                    Color.black
                    if playing != nil {
                        PlayerLayerView(player: player)
                    } else {
                        Text("Pick a chapter")
                            .font(.plBody)
                            .foregroundStyle(PL.text500)
                    }
                }
                .aspectRatio(16 / 9, contentMode: .fit)

                ScrollView {
                    VStack(spacing: 8) {
                        ForEach(Array(chapters.enumerated()), id: \.element.slug) { i, chapter in
                            Button {
                                Task { await play(chapter.slug) }
                            } label: {
                                HStack(spacing: 12) {
                                    Text("\(i + 1)")
                                        .font(.plMicro)
                                        .monospacedDigit()
                                        .foregroundStyle(playing == chapter.slug ? PL.cyan : PL.text500)
                                        .frame(width: 24)
                                    Text(chapter.title)
                                        .font(.plBody)
                                        .foregroundStyle(playing == chapter.slug ? PL.cyan : PL.text200)
                                    Spacer()
                                    Image(systemName: playing == chapter.slug ? "pause.fill" : "play.fill")
                                        .font(.system(size: 12))
                                        .foregroundStyle(PL.text500)
                                }
                                .padding(12)
                                .background(
                                    playing == chapter.slug ? PL.cyan.opacity(0.08) : .clear,
                                    in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                                )
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(12)
                }
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .onDisappear { player.pause() }
    }

    private func play(_ slug: String) async {
        if playing == slug {
            player.pause()
            playing = nil
            return
        }
        if urls[slug] == nil {
            struct Req: Encodable { let slug: String }
            struct Res: Decodable { let urls: [String: String] }
            let res: Res? = try? await API.post("api/tutorial-url", Req(slug: slug))
            if let raw = res?.urls[slug], let url = URL(string: raw) {
                urls[slug] = url
            }
        }
        guard let url = urls[slug] else { return }
        player.replaceCurrentItem(with: AVPlayerItem(url: url))
        player.play()
        playing = slug
        await app.setMetadataFlag("tutorial_started", true)
    }
}

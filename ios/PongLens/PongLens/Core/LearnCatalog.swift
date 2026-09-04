import Foundation

enum LearnAudience: String, Codable, CaseIterable, Hashable {
    case player
    case coach
}

struct LearnGuideSection: Codable, Hashable {
    let heading: String?
    let steps: [String]?
    let paragraphs: [String]?
    let bullets: [String]?
    let tip: String?
}

struct LearnGuide: Codable, Hashable, Identifiable {
    let audience: LearnAudience
    let slug: String
    let title: String
    let summary: String
    let group: String
    let sections: [LearnGuideSection]
    let related: [String]?

    var id: String { "\(audience.rawValue):\(slug)" }
}

struct LearnChapter: Codable, Hashable, Identifiable {
    let audience: LearnAudience
    let slug: String
    let title: String
    let blurb: String
    let seconds: Int
    let guide: String?
    let mediaKey: String

    var id: String { "\(audience.rawValue):\(slug)" }
}

struct NumberedLearnChapter: Hashable, Identifiable {
    let number: Int
    let chapter: LearnChapter

    var id: String { chapter.id }
}

struct LearnCatalogGroup: Codable, Hashable {
    let audience: LearnAudience
    let groups: [String]
}

struct LearnCatalogFile: Codable, Hashable {
    let schemaVersion: Int
    let groups: [LearnCatalogGroup]
    let guides: [LearnGuide]
    let chapters: [LearnChapter]
}

struct LearnCatalogStore {
    static let bundled = loadBundled()

    private let file: LearnCatalogFile

    init(data: Data) throws {
        file = try JSONDecoder().decode(LearnCatalogFile.self, from: data)
    }

    private init(file: LearnCatalogFile) {
        self.file = file
    }

    func guides(for audience: LearnAudience) -> [LearnGuide] {
        file.guides.filter { $0.audience == audience }
    }

    func chapters(for audience: LearnAudience) -> [LearnChapter] {
        file.chapters.filter { $0.audience == audience }
    }

    func numberedChapters(for audience: LearnAudience) -> [NumberedLearnChapter] {
        chapters(for: audience).enumerated().map { offset, chapter in
            NumberedLearnChapter(number: offset + 1, chapter: chapter)
        }
    }

    func groups(for audience: LearnAudience) -> [String] {
        file.groups.first { $0.audience == audience }?.groups ?? []
    }

    func related(for guide: LearnGuide, audience: LearnAudience) -> [LearnGuide] {
        let visibleGuides = guides(for: audience)
        let visibleBySlug = Dictionary(uniqueKeysWithValues: visibleGuides.map { ($0.slug, $0) })
        return (guide.related ?? []).compactMap { visibleBySlug[$0] }
    }

    func search(_ query: String, audience: LearnAudience) -> [LearnGuide] {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let visibleGuides = guides(for: audience)
        guard !normalizedQuery.isEmpty else { return visibleGuides }

        return visibleGuides.filter { guide in
            searchText(for: guide).contains(normalizedQuery)
        }
    }

    static func loadBundled(bundle: Bundle = .main) -> LearnCatalogStore {
        guard let url = bundle.url(forResource: "learn-catalog", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let store = try? LearnCatalogStore(data: data) else {
            return LearnCatalogStore(file: LearnCatalogFile(
                schemaVersion: 1,
                groups: [],
                guides: [],
                chapters: []
            ))
        }
        return store
    }

    private func searchText(for guide: LearnGuide) -> String {
        var parts = [guide.title, guide.summary]
        for section in guide.sections {
            if let heading = section.heading { parts.append(heading) }
            parts.append(contentsOf: section.steps ?? [])
            parts.append(contentsOf: section.paragraphs ?? [])
            parts.append(contentsOf: section.bullets ?? [])
            if let tip = section.tip { parts.append(tip) }
        }
        return parts.joined(separator: " ").lowercased()
    }
}

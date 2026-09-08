import SwiftUI

/// The poster of a lesson recap, on a card, at the size a match thumbnail
/// is. A recap used to sit in the feed as a cyan play glyph beside a wall
/// of shared matches with real pictures, and read as the odd one out.
///
/// The poster is a signed link the detail endpoint hands back, so it is
/// fetched once per recap and remembered for the session; a scroll back up
/// paints the memory hit on the first frame rather than flashing the glyph
/// while the await resumes, the same way MatchThumb does. A recap without
/// a poster yet — still rendering, or the file missing — keeps the glyph,
/// which is honest: there is nothing to show.
struct RecapPosterThumb: View {
    let id: UUID
    var width: CGFloat = 104
    var height: CGFloat = 64

    @State private var url: URL?

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                .fill(PL.cyan.opacity(0.12))
            if let url {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        glyph
                    }
                }
            } else {
                glyph
            }
        }
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                .strokeBorder(PL.edge, lineWidth: 1)
        )
        .task(id: id) {
            if let hit = RecapPosterCache.shared.cached(id) {
                url = hit
                return
            }
            url = await RecapPosterCache.shared.load(id)
        }
    }

    private var glyph: some View {
        Image(systemName: "play.rectangle.fill")
            .font(.system(size: 24))
            .foregroundStyle(PL.cyan)
    }
}

/// One fetch per recap per session. The link is signed for four hours,
/// which outlives any feed visit.
final class RecapPosterCache {
    static let shared = RecapPosterCache()
    private var urls: [UUID: URL?] = [:]

    func cached(_ id: UUID) -> URL?? { urls[id] }

    func load(_ id: UUID) async -> URL? {
        let detail: LessonVideoDetail? = try? await API.get(
            "api/lesson-video", query: ["id": id.uuidString.lowercased()]
        )
        let url = detail?.posterUrl.flatMap(URL.init(string:))
        urls[id] = url
        return url
    }
}

import Foundation

/// Signed media URLs from /api/media-url. Signatures last an hour; entries
/// are treated as stale after 50 minutes so a URL is never handed out about
/// to expire.
@Observable
final class MediaStore {
    private struct Entry {
        let url: URL
        let fetched: Date
    }

    private var thumbs: [UUID: Entry] = [:]
    private var inFlight: Set<UUID> = []

    func thumbURL(_ id: UUID) -> URL? {
        guard let entry = thumbs[id],
              Date().timeIntervalSince(entry.fetched) < 3000 else { return nil }
        return entry.url
    }

    /// Batch-signs poster thumbs (the route accepts up to 100 ids per call).
    /// Matches without a thumb simply stay on the placeholder.
    func loadThumbs(_ ids: [UUID]) async {
        let needed = ids.filter { thumbURL($0) == nil && !inFlight.contains($0) }
        guard !needed.isEmpty else { return }
        needed.forEach { inFlight.insert($0) }
        defer { needed.forEach { inFlight.remove($0) } }

        struct Request: Encodable { let thumbs: [String] }
        struct Response: Decodable { let urls: [String: String] }

        var start = 0
        while start < needed.count {
            let chunk = Array(needed[start..<min(start + 100, needed.count)])
            start += 100
            do {
                let response: Response = try await API.post(
                    "api/media-url",
                    Request(thumbs: chunk.map { $0.uuidString.lowercased() })
                )
                let now = Date()
                for (key, value) in response.urls {
                    guard let id = UUID(uuidString: key), let url = URL(string: value) else { continue }
                    thumbs[id] = Entry(url: url, fetched: now)
                }
            } catch {
                // Placeholders stay; the next poll retries.
            }
        }
    }
}

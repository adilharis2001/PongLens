import Supabase
import SwiftUI
import UIKit

/// Match poster thumbs, cached by match id.
///
/// The thing this replaces cached *signed URLs* and decided staleness when
/// a view read one. Going stale mutated nothing, so no view was invalidated
/// and nothing re-signed; thumbnails quietly vanished about fifty minutes
/// into a session and only came back on a relaunch. The refresh was also
/// driven by `onChange(of: library.matches)`, and a settled library
/// compares equal on every poll, so in practice it never ran twice.
///
/// So there is no expiry here at all. `/api/thumb/<id>` is a permanent URL
/// — signing happens on the server, per request — which means the id is a
/// stable cache key and ordinary HTTP caching finally works. A thumb seen
/// once on this device keeps showing: instantly on relaunch, and offline.
///
/// The rules that make it stay fixed:
///   - a failure caches nothing, so it is always retried later
///   - a failure never evicts a picture we already have
///   - when the network is gone, a stale cached copy is better than a
///     placeholder, so we ask the cache for one
@MainActor
@Observable
final class ThumbLoader {
    static let shared = ThumbLoader()

    /// Decoded images, so a scroll back up costs nothing. NSCache empties
    /// itself under memory pressure, which is the correct behaviour here.
    private let memory: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 300
        return cache
    }()

    /// Bytes, on disk, across launches. Its own store rather than
    /// URLCache.shared so a media flood cannot evict API responses.
    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(
            memoryCapacity: 16 * 1024 * 1024,
            diskCapacity: 256 * 1024 * 1024,
            directory: URL.cachesDirectory.appending(path: "pl-thumbs")
        )
        config.requestCachePolicy = .useProtocolCachePolicy
        config.timeoutIntervalForRequest = 20
        return URLSession(configuration: config)
    }()

    /// One request per match, however many cards ask at once.
    private var inFlight: [UUID: Task<UIImage?, Never>] = [:]

    /// Matches the server says have no thumb yet. Held for a minute, not
    /// forever: a match still processing gets its thumb shortly, and the
    /// moment it lands is one the player is usually watching for. A minute
    /// is long enough to stop a scroll re-asking on every cell and short
    /// enough that a finished match does not sit on a placeholder.
    private var missing: [UUID: Date] = [:]
    private let missingTTL: TimeInterval = 60

    private init() {}

    private func key(_ id: UUID) -> NSString {
        id.uuidString.lowercased() as NSString
    }

    /// A thumb already in memory. Lets a view paint on its first frame
    /// instead of flashing the placeholder on every scroll.
    func cached(_ id: UUID) -> UIImage? {
        memory.object(forKey: key(id))
    }

    func image(for id: UUID) async -> UIImage? {
        if let hit = cached(id) { return hit }
        if let seen = missing[id] {
            if Date().timeIntervalSince(seen) < missingTTL { return nil }
            missing[id] = nil
        }
        if let running = inFlight[id] { return await running.value }

        let task = Task { [weak self] in await self?.fetch(id) ?? nil }
        inFlight[id] = task
        let image = await task.value
        inFlight[id] = nil
        return image
    }

    /// Drop everything on sign-out: the next account must not see the last
    /// one's pictures, and the disk cache outlives the process.
    func clear() {
        memory.removeAllObjects()
        missing.removeAll()
        inFlight.values.forEach { $0.cancel() }
        inFlight.removeAll()
        session.configuration.urlCache?.removeAllCachedResponses()
    }

    private func fetch(_ id: UUID) async -> UIImage? {
        let url = AppConfig.apiBase.appending(path: "api/thumb/\(id.uuidString.lowercased())")

        // Three tries with a short backoff. A thumb that fails every one of
        // them is left uncached on purpose, so simply scrolling past the
        // card again asks for it afresh.
        for attempt in 0..<3 {
            if Task.isCancelled { return nil }
            do {
                var request = URLRequest(url: url)
                request.setValue(
                    "Bearer \(try await supa.auth.session.accessToken)",
                    forHTTPHeaderField: "Authorization"
                )
                let (data, response) = try await session.data(for: request)
                let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                if code == 404 {
                    missing[id] = Date()
                    return nil
                }
                guard code == 200, let image = UIImage(data: data) else {
                    // 401 means the token was refreshed under us, and the
                    // next attempt reads the new one. Everything else is
                    // worth one more try too.
                    try? await Task.sleep(for: .milliseconds(300 << attempt))
                    continue
                }
                memory.setObject(image, forKey: key(id))
                return image
            } catch {
                if Task.isCancelled { return nil }
                try? await Task.sleep(for: .milliseconds(300 << attempt))
            }
        }

        // Offline, or the server is having a bad minute. A picture this
        // device already downloaded beats a placeholder, so ask the disk
        // cache directly rather than giving up.
        return await cachedOnDisk(url: url, id: id)
    }

    private func cachedOnDisk(url: URL, id: UUID) async -> UIImage? {
        var request = URLRequest(url: url)
        request.cachePolicy = .returnCacheDataDontLoad
        guard let (data, _) = try? await session.data(for: request),
              let image = UIImage(data: data) else { return nil }
        memory.setObject(image, forKey: key(id))
        return image
    }
}

/// Poster placeholder until the thumb arrives.
struct ThumbPlaceholder: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [PL.surface2, PL.surface],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
            Image(systemName: "play.rectangle")
                .font(.system(size: 18))
                .foregroundStyle(PL.text600)
        }
    }
}

/// A match's poster thumb, addressed by match id.
///
/// Takes the id rather than a URL so that nothing upstream has to hold a
/// link, notice it expiring, or re-fetch it. `.task(id:)` re-runs whenever
/// the card is rebuilt or reused for another match, and a cached image
/// comes back without touching the network.
struct MatchThumb: View {
    let matchId: UUID

    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                ThumbPlaceholder()
            }
        }
        .task(id: matchId) {
            // Paint a memory hit on the first frame; a scroll back up
            // should not flash a placeholder before the await resumes.
            if let hit = ThumbLoader.shared.cached(matchId) {
                image = hit
                return
            }
            image = await ThumbLoader.shared.image(for: matchId)
        }
    }
}

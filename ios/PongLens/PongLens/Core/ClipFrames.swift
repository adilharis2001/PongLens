import AVFoundation
import SwiftUI
import UIKit

/// Presigned clip links, minted once and shared by everything on the
/// Starred shelf.
///
/// Two callers want the same link for different reasons: a tile
/// generating its poster frame, and the sequence player reading one clip
/// ahead. Both come through here, so opening a tile you have already
/// scrolled past costs nothing and the read-ahead is not thrown away.
///
/// R2 signs for an hour (r2.ts presignGet). Forty-five minutes is when a
/// cached one is dropped — early enough that a link handed out right at
/// the boundary still has a quarter of an hour on it, which is longer
/// than any rally.
@MainActor
enum ClipLinks {
    private static let freshFor: TimeInterval = 45 * 60
    private static var cache: [UUID: (url: URL, at: Date)] = [:]
    private static var pending: [UUID: Task<URL?, Never>] = [:]

    static func url(matchId: UUID, pointId: UUID) async -> URL? {
        if let hit = cache[pointId], Date().timeIntervalSince(hit.at) < freshFor {
            return hit.url
        }
        if let running = pending[pointId] { return await running.value }

        let task = Task<URL?, Never> {
            defer { pending[pointId] = nil }
            struct Req: Encodable {
                let matchId: String
                let pointId: String
            }
            struct Res: Decodable { let url: String? }
            let res: Res? = try? await API.post(
                "api/media-url",
                Req(
                    matchId: matchId.uuidString.lowercased(),
                    pointId: pointId.uuidString.lowercased()
                )
            )
            guard let link = res?.url.flatMap(URL.init) else { return nil }
            cache[pointId] = (link, Date())
            return link
        }
        pending[pointId] = task
        return await task.value
    }

    /// The bucket refused the signature: ask for a fresh one next time.
    static func forget(_ pointId: UUID) { cache[pointId] = nil }
}

/// One still out of a point's clip, for the Starred shelf's tiles.
///
/// There is no stored per-point image anywhere in the system, and a
/// match's poster is the same picture for every point in it — a repeated
/// asset rather than imagery. So the frame is read from the clip itself.
///
/// The web can do this by mounting the clip at `#t=` and leaving it
/// paused, because one `<video>` per tile is cheap there. Sixty AVPlayers
/// in a scroll view is not, so here the frame is generated once with
/// AVAssetImageGenerator — a couple of range requests against the object,
/// no player, no layer — and what the tile holds is a UIImage.
///
/// Cached in memory only. A star is looked at in a session; the next
/// launch can spend the range request again rather than carry a disk
/// store that has to be invalidated when a clip is recut.
@MainActor
@Observable
final class ClipFrameLoader {
    static let shared = ClipFrameLoader()

    private let memory: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 200
        return cache
    }()

    /// In-flight work, so a tile that scrolls out and back does not start
    /// a second generator for the same frame.
    private var pending: [String: Task<UIImage?, Never>] = [:]

    private func key(_ pointId: UUID) -> NSString {
        pointId.uuidString.lowercased() as NSString
    }

    func cached(_ pointId: UUID) -> UIImage? {
        memory.object(forKey: key(pointId))
    }

    func frame(matchId: UUID, pointId: UUID, at seconds: Double) async -> UIImage? {
        if let hit = cached(pointId) { return hit }
        let k = pointId.uuidString.lowercased()
        if let running = pending[k] { return await running.value }

        let task = Task<UIImage?, Never> { [weak self] in
            defer { self?.pending[k] = nil }
            guard
                let url = await ClipLinks.url(matchId: matchId, pointId: pointId)
            else { return nil }
            let image = await Self.still(from: url, at: seconds)
            if let image, let self { self.memory.setObject(image, forKey: self.key(pointId)) }
            return image
        }
        pending[k] = task
        return await task.value
    }

    private static func still(from url: URL, at seconds: Double) async -> UIImage? {
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        generator.appliesPreferredTrackTransform = true
        // A tile is never wider than a phone, so a full 720p decode is
        // waste. Tolerance is generous on purpose: the nearest keyframe is
        // the same rally, and demanding an exact frame turns two range
        // requests into a decode of everything since the last one.
        generator.maximumSize = CGSize(width: 900, height: 900)
        // Any keyframe, and only a keyframe.
        //
        // The clips are x264 at its default keyint of 250, which on a
        // seven second rally means exactly one sync sample: frame zero.
        // Asking for a frame at 1.5s therefore asks the decoder to run 45
        // frames forward from it, over an HTTP range that may not have
        // arrived — and a partial decode does not fail, it returns a
        // sheet of green. One tile in three came back like that.
        //
        // Infinite tolerance takes the nearest sync sample instead: one
        // range request at the head of the file, nothing to decode
        // forward from, and a frame that cannot be half-built. What it
        // costs is the frame choice — on these clips it is the opening
        // one, the server about to serve — and that is a different
        // picture for every point, which is all the tile needs. The
        // requested time still leads, so a clip cut with more keyframes
        // gets the better frame for free.
        generator.requestedTimeToleranceBefore = .positiveInfinity
        generator.requestedTimeToleranceAfter = .positiveInfinity
        let time = CMTime(seconds: seconds, preferredTimescale: 600)
        guard let (cgImage, _) = try? await generator.image(at: time) else {
            return nil
        }
        return UIImage(cgImage: cgImage)
    }
}

/// A point's poster frame, addressed by the point. Nothing is fetched
/// until the view appears, which inside a lazy stack means nothing is
/// fetched for a tile that has not been scrolled to.
struct ClipFrame: View {
    let matchId: UUID
    let pointId: UUID
    let at: Double

    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .transition(.opacity)
            } else {
                Color.clear
            }
        }
        .animation(.easeOut(duration: 0.25), value: image != nil)
        .task(id: pointId) {
            if let hit = ClipFrameLoader.shared.cached(pointId) {
                image = hit
                return
            }
            image = await ClipFrameLoader.shared.frame(
                matchId: matchId, pointId: pointId, at: at
            )
        }
    }
}

import AVFoundation
import Foundation

/// Cutting a point's clip file on the phone (spec 2026-09-06, step 5).
///
/// After a timing edit the point already plays right from the cut video
/// (the point screen and the pad window it). The clip FILE — what
/// Starred, share links, coach review and reels read — is what the
/// worker's re-cut job produces. This is the same job done here, with the
/// machinery the Instagram share already uses: a range read of the signed
/// cut video, a composition over the point's window, an export. Measured
/// on that path, under a second of compute for a nine-second rally on
/// current phones, two to four on the oldest supported.
///
/// The worker's job is still requested by the database trigger and is the
/// safety net. Whichever lands first wins: claim_point_clip applies only
/// while the point is still flagged with the same timing, and the route
/// deletes the loser's object. Every failure here is silent — no network,
/// an export error, the app backgrounded mid-export — because the worker
/// covers it, and a retry would only race the job that is already queued.
///
/// Off unless app_config.device_reclip is 'on', like instagram_render.
enum ClipCutter {
    enum CutError: Error {
        case noVideoTrack
        case exportFailed(String)
    }

    /// Cut `[start, end]` (seconds of the file at `source`) to a 720p mp4
    /// with the index in front — H.264 and AAC, what every reader of a clip
    /// file expects. The caller deletes the file when it is done with it.
    static func cut(source: URL, start: Double, end: Double) async throws -> URL {
        let asset = AVURLAsset(url: source)
        guard let vTrack = try await asset.loadTracks(withMediaType: .video).first
        else { throw CutError.noVideoTrack }
        let range = CMTimeRange(
            start: CMTime(seconds: max(0, start), preferredTimescale: 600),
            duration: CMTime(seconds: max(0.5, end - start), preferredTimescale: 600))

        let comp = AVMutableComposition()
        guard let cv = comp.addMutableTrack(
            withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
        else { throw CutError.noVideoTrack }
        try cv.insertTimeRange(range, of: vTrack, at: .zero)
        cv.preferredTransform = try await vTrack.load(.preferredTransform)
        if let aTrack = try await asset.loadTracks(withMediaType: .audio).first,
           let ca = comp.addMutableTrack(
            withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
            // A rally with no audio is not an error; the clip is just silent.
            try? ca.insertTimeRange(range, of: aTrack, at: .zero)
        }

        let out = FileManager.default.temporaryDirectory
            .appendingPathComponent("clip-\(UUID().uuidString).mp4")
        try? FileManager.default.removeItem(at: out)
        guard let ex = AVAssetExportSession(
            asset: comp, presetName: AVAssetExportPreset1280x720)
        else { throw CutError.exportFailed("Couldn't prepare the clip.") }
        ex.shouldOptimizeForNetworkUse = true
        do {
            try await ex.export(to: out, as: .mp4)
        } catch {
            throw CutError.exportFailed(error.localizedDescription)
        }
        return out
    }
}

extension MatchDetailModel {
    /// Cut and upload every flagged point of the match whose window the cut
    /// video holds. Runs after each timing edit; a second call while one is
    /// running queues one more pass rather than a parallel one.
    func recutOnDevice(matchId: UUID, pad: ClipPad) async {
        if deviceRecutRunning {
            deviceRecutAgain = true
            return
        }
        deviceRecutRunning = true
        defer { deviceRecutRunning = false }
        repeat {
            deviceRecutAgain = false
            guard await deviceRecutEnabled() else { return }
            guard let cutURL = await mintCutURL(matchId) else { return }
            let snapshot = visible
            for point in snapshot where point.edited {
                guard let cutT0 = point.cutT0, let t0 = point.t0, let t1 = point.t1,
                      let end = paddedEnd(point, pad),
                      let bounds = contiguousCutBounds(for: point, in: snapshot, pad: pad),
                      cutT0 >= bounds.lo - 0.05, end <= bounds.hi + 0.05
                else { continue }   // the cut does not hold this window: the worker's
                do {
                    let file = try await ClipCutter.cut(source: cutURL, start: cutT0, end: end)
                    defer { try? FileManager.default.removeItem(at: file) }
                    try await uploadDeviceClip(
                        file: file, matchId: matchId, point: point, t0: t0, t1: t1)
                } catch {
                    continue
                }
            }
        } while deviceRecutAgain
    }

    private func deviceRecutEnabled() async -> Bool {
        struct Row: Decodable { let key: String; let value: String }
        let rows: [Row]? = try? await supa
            .from("app_config")
            .select("key,value")
            .eq("key", value: "device_reclip")
            .execute()
            .value
        return rows?.first?.value == "on"
    }

    private func mintCutURL(_ matchId: UUID) async -> URL? {
        struct Req: Encodable {
            let matchId: String
            let preview: Bool
        }
        struct Res: Decodable { let url: String? }
        let res: Res? = try? await API.post(
            "api/media-url",
            Req(matchId: matchId.uuidString.lowercased(), preview: true))
        return res?.url.flatMap(URL.init)
    }

    /// Sign, PUT, claim. The claim is the worker's guard in one statement;
    /// `applied == false` means the timing moved again or the worker's file
    /// landed first, and the route has already dropped this upload.
    private func uploadDeviceClip(
        file: URL, matchId: UUID, point: MatchPoint, t0: Double, t1: Double
    ) async throws {
        let matchIdText = matchId.uuidString.lowercased()
        let pointIdText = point.id.uuidString.lowercased()
        struct SignReq: Encodable {
            let action = "sign"
            let matchId: String
            let pointId: String
        }
        struct SignRes: Decodable {
            let url: String
            let key: String
        }
        let signed: SignRes = try await API.post(
            "api/point-clip", SignReq(matchId: matchIdText, pointId: pointIdText))
        guard let putURL = URL(string: signed.url) else { throw URLError(.badURL) }
        var request = URLRequest(url: putURL)
        request.httpMethod = "PUT"
        request.setValue("video/mp4", forHTTPHeaderField: "Content-Type")
        let (_, response) = try await URLSession.shared.upload(for: request, fromFile: file)
        guard let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode)
        else { throw URLError(.badServerResponse) }

        struct CompleteReq: Encodable {
            let action = "complete"
            let matchId: String
            let pointId: String
            let key: String
            let t0: Double
            let t1: Double
        }
        struct CompleteRes: Decodable { let applied: Bool }
        let done: CompleteRes = try await API.post(
            "api/point-clip",
            CompleteReq(matchId: matchIdText, pointId: pointIdText,
                        key: signed.key, t0: t0, t1: t1))
        if done.applied, let i = points.firstIndex(where: { $0.id == point.id }) {
            points[i].clipPath = "r2://ponglens-media/" + signed.key
            points[i].edited = false
        }
    }
}

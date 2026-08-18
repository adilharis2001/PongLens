import AVFoundation
import Foundation
import UIKit

/// The upload pipeline: plain S3 multipart against /api/upload-url, exactly
/// the web's wire protocol — create, sign-part per 16 MiB chunk (four in
/// flight), complete with register so the match row is born server-side.
@Observable
final class Uploader {
    enum Phase: Equatable {
        case idle
        case probing
        case uploading(Double)
        case finishing
        case done(matchId: UUID?, processed: Bool)
        case failed(String)
    }

    static let partSize = 16 * 1024 * 1024
    static let maxBytes: Int64 = 6 * 1024 * 1024 * 1024
    static let maxDurationS: Double = 45 * 60

    var phase: Phase = .idle
    var fileName = ""
    var durationS: Double?
    var poster: UIImage?
    var totalBytes: Int64 = 0
    var uploadedBytes: Int64 = 0

    private var localURL: URL?
    private var uploadTask: Task<Void, Never>?

    var minutesCharge: Int {
        guard let durationS else { return 0 }
        return max(1, Int(ceil(durationS / 60)))
    }

    func probe(url: URL) async -> String? {
        phase = .probing
        localURL = url
        fileName = url.lastPathComponent
        let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int64) ?? 0
        totalBytes = size ?? 0
        if totalBytes > Self.maxBytes {
            phase = .idle
            return "That file is over 6 GB. Trim it on your phone first, or upload it in two halves."
        }
        let asset = AVURLAsset(url: url)
        if let duration = try? await asset.load(.duration).seconds, duration.isFinite, duration > 0 {
            durationS = duration
            if duration > Self.maxDurationS {
                phase = .idle
                let mins = Int(duration / 60)
                return "That video is \(mins) minutes. The limit is 45 minutes, so trim it first or upload it in two halves."
            }
            let generator = AVAssetImageGenerator(asset: asset)
            generator.appliesPreferredTrackTransform = true
            generator.maximumSize = CGSize(width: 640, height: 640)
            let at = CMTime(seconds: min(60, duration * 0.5), preferredTimescale: 600)
            if let cg = try? await generator.image(at: at).image {
                poster = UIImage(cgImage: cg)
            }
        }
        phase = .idle
        return nil
    }

    struct Register {
        var opponent: String?
        var venue: String?
        var matchType: String?
        var userSide: String?
    }

    func start(register: Register, process: Bool, placement: Bool) {
        guard let url = localURL, uploadTask == nil else { return }
        UIApplication.shared.isIdleTimerDisabled = true
        uploadTask = Task { [weak self] in
            await self?.run(url: url, register: register, process: process, placement: placement)
            await MainActor.run {
                UIApplication.shared.isIdleTimerDisabled = false
                self?.uploadTask = nil
            }
        }
    }

    func cancel() {
        uploadTask?.cancel()
        uploadTask = nil
        phase = .idle
        uploadedBytes = 0
        UIApplication.shared.isIdleTimerDisabled = false
    }

    func reset() {
        cancel()
        localURL = nil
        fileName = ""
        durationS = nil
        poster = nil
        totalBytes = 0
    }

    private struct CreateRes: Decodable {
        let bucket: String
        let key: String
        let uploadId: String
    }

    private struct SignRes: Decodable { let url: String }

    private func run(url: URL, register: Register, process: Bool, placement: Bool) async {
        phase = .uploading(0)
        uploadedBytes = 0
        do {
            struct CreateReq: Encodable {
                let action = "create"
                let fileSize: Int64
                let contentType: String
            }
            let contentType = url.pathExtension.lowercased() == "mp4" ? "video/mp4" : "video/quicktime"
            let created: CreateRes = try await API.post(
                "api/upload-url",
                CreateReq(fileSize: totalBytes, contentType: contentType)
            )

            let partCount = Int((totalBytes + Int64(Self.partSize) - 1) / Int64(Self.partSize))
            var etags = [Int: String]()

            // Four parts in flight, like the web's semaphore.
            try await withThrowingTaskGroup(of: (Int, String, Int64).self) { group in
                var next = 1
                var active = 0
                func addPart(_ n: Int, group: inout ThrowingTaskGroup<(Int, String, Int64), Error>) {
                    group.addTask { [self] in
                        try Task.checkCancellation()
                        let offset = Int64(n - 1) * Int64(Self.partSize)
                        let length = Int(min(Int64(Self.partSize), totalBytes - offset))
                        let handle = try FileHandle(forReadingFrom: url)
                        defer { try? handle.close() }
                        try handle.seek(toOffset: UInt64(offset))
                        guard let data = try handle.read(upToCount: length) else {
                            throw URLError(.cannotOpenFile)
                        }
                        struct SignReq: Encodable {
                            let action = "sign-part"
                            let key: String
                            let uploadId: String
                            let partNumber: Int
                        }
                        let signed: SignRes = try await API.post(
                            "api/upload-url",
                            SignReq(key: created.key, uploadId: created.uploadId, partNumber: n)
                        )
                        guard let putURL = URL(string: signed.url) else {
                            throw URLError(.badURL)
                        }
                        var put = URLRequest(url: putURL)
                        put.httpMethod = "PUT"
                        let (_, response) = try await URLSession.shared.upload(for: put, from: data)
                        guard let http = response as? HTTPURLResponse,
                              (200..<300).contains(http.statusCode),
                              let etag = http.value(forHTTPHeaderField: "ETag") else {
                            throw URLError(.badServerResponse)
                        }
                        return (n, etag, Int64(data.count))
                    }
                }
                while next <= partCount, active < 4 {
                    addPart(next, group: &group)
                    next += 1
                    active += 1
                }
                while let (n, etag, bytes) = try await group.next() {
                    etags[n] = etag
                    await MainActor.run {
                        uploadedBytes += bytes
                        phase = .uploading(Double(uploadedBytes) / Double(max(1, totalBytes)))
                    }
                    if next <= partCount {
                        addPart(next, group: &group)
                        next += 1
                    }
                }
            }

            await MainActor.run { phase = .finishing }

            struct Part: Encodable {
                let PartNumber: Int
                let ETag: String
            }
            struct RegisterPayload: Encodable {
                let durationS: Double?
                let originalName: String
                let capturedAtMs: Int64
                let opponent: String?
                let venue: String?
                let matchType: String?
                let userSide: String?
            }
            struct CompleteReq: Encodable {
                let action = "complete"
                let key: String
                let uploadId: String
                let parts: [Part]
                let register: RegisterPayload
            }
            struct CompleteRes: Decodable {
                let ok: Bool?
                let matchId: String?
            }
            let completed: CompleteRes = try await API.post(
                "api/upload-url",
                CompleteReq(
                    key: created.key,
                    uploadId: created.uploadId,
                    parts: (1...max(1, partCount)).compactMap { n in
                        etags[n].map { Part(PartNumber: n, ETag: $0) }
                    },
                    register: RegisterPayload(
                        durationS: durationS,
                        originalName: fileName,
                        capturedAtMs: Int64(Date().timeIntervalSince1970 * 1000),
                        opponent: register.opponent,
                        venue: register.venue,
                        matchType: register.matchType,
                        userSide: register.userSide
                    )
                )
            )

            let matchId = completed.matchId.flatMap(UUID.init(uuidString:))
            var processed = false
            if process, let matchId {
                struct ProcessReq: Encodable {
                    let matchId: String
                    let points = true
                    let placement: Bool
                    let strictness = "normal"
                }
                struct ProcessRes: Decodable { let code: String? }
                let res: ProcessRes? = try? await API.post(
                    "api/process",
                    ProcessReq(matchId: matchId.uuidString.lowercased(), placement: placement)
                )
                processed = res != nil && res?.code == nil
            }
            await MainActor.run {
                phase = .done(matchId: matchId, processed: processed)
            }
        } catch is CancellationError {
            // cancel() already reset the phase.
        } catch let APIError.http(_, message) {
            await MainActor.run {
                phase = .failed(message.isEmpty ? "The upload hit a snag." : message)
            }
        } catch {
            await MainActor.run {
                phase = .failed("The connection dropped.")
            }
        }
    }
}

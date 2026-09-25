#if DEBUG && targetEnvironment(simulator)
import Foundation
import UIKit

/// Simulator QA for cutting on the iPhone, with no server and no sign-in.
///
///     --dev-device-cut-source <video>   --dev-device-cut-fixture <cut-plan-parity.json>
///     --dev-device-cut-case "<name>"    --dev-device-cut-root <folder on the Mac>
///     [--dev-device-cut-crash-after <clips>]
///     [--dev-device-cut-mac-at-clip <n>]      press "Cut on the Mac instead" there
///     [--dev-device-cut-refuse-from <progress>] the server stops accepting reports
///
/// DeviceHandCutQueue runs for real: the plan, the encoder, a checkpoint per
/// file, the continued processing request, slicing, the order of the work,
/// the manifest, the reports and the submit. Only the far side is a folder:
/// FolderTransport answers as the database and the route do (contract
/// sections 3 and 4), and FolderUploader stands in for R2. `crash-after`
/// kills the app after that many clips, once, to prove a relaunch resumes.
@MainActor
enum DeviceCutQA {
    static let user = UUID(uuidString: "a2e61027-2ee9-4026-a058-dc07441ee633")!
    static let match = UUID(uuidString: "04f1b393-f16f-4242-9f51-a853a276bae8")!

    static func value(_ flag: String) -> String? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: flag), args.indices.contains(i + 1) else { return nil }
        return args[i + 1]
    }

    static var isEnabled: Bool { value("--dev-device-cut-source") != nil }
    static var root: URL { URL(fileURLWithPath: value("--dev-device-cut-root") ?? NSTemporaryDirectory()) }

    static func log(_ event: String, _ detail: String = "") {
        let line = "\(ISO8601DateFormatter().string(from: Date())) \(event) \(detail)\n"
        append(line, to: root.appendingPathComponent("qa.log"))
    }

    static func append(_ text: String, to url: URL) {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile()
            handle.write(text.data(using: .utf8)!)
            try? handle.close()
        } else {
            try? text.data(using: .utf8)!.write(to: url)
        }
    }

    static func noteCrash() {
        log("crash", "the app exits after its clips, as a kill would")
        try? Data().write(to: root.appendingPathComponent("crashed"))
    }

    static func run() async {
        let queue = DeviceHandCutQueue.shared
        let transport = FolderTransport(root: root)
        queue.transport = transport
        queue.uploader = FolderUploader()
        let source = URL(fileURLWithPath: value("--dev-device-cut-source")!)
        queue.sourceFile = { _ in source }
        queue.currentUser = { user }
        if let n = value("--dev-device-cut-crash-after").flatMap(Int.init),
           !FileManager.default.fileExists(atPath: root.appendingPathComponent("crashed").path) {
            queue.crashAfterClips = n
        }
        log("launch", "jobs on disk: \(queue.jobs.count)")
        if let job = queue.job(forMatch: match) {
            log("resume", "clips done \(job.clips.count), cut \(job.cut != nil)")
            queue.resume()
        } else if !FileManager.default.fileExists(atPath: root.appendingPathComponent("submitted.json").path) {
            struct Fx: Decodable {
                struct C: Decodable { let name: String; let duration: Double; let marks: [[Double]] }
                let cases: [C]
            }
            guard let path = value("--dev-device-cut-fixture"), let name = value("--dev-device-cut-case"),
                  let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
                  let fx = try? JSONDecoder().decode(Fx.self, from: data),
                  let c = fx.cases.first(where: { $0.name == name })
            else {
                log("error", "fixture or case not found")
                return
            }
            let marks = c.marks.map {
                HandCutSubmission(t0: $0[0], t1: $0[1], w: nil, isLet: false, star: false, tap: $0[0], rate: 1)
            }
            let started = await queue.start(matchId: match, ownerId: user, durationS: c.duration, marks: marks)
            log("start", "\(started)")
        }
        var last = ""
        let macAt = value("--dev-device-cut-mac-at-clip").flatMap(Int.init)
        while true {
            try? await Task.sleep(for: .milliseconds(500))
            guard let job = queue.job(forMatch: match) else {
                let dir = DeviceHandCutQueue.root
                let left = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
                log("gone", "the job left the queue; left on disk: \(left.sorted())")
                return
            }
            let live = queue.live[job.jobId] ?? .init()
            // 0 means during the cut itself, once it is under way.
            let pressHere = macAt.map { $0 == 0 ? (live.step == .encodeCut && live.progress >= 5)
                                                : live.step == .encodeClip($0) } ?? false
            if pressHere, !live.movingToMac {
                log("press", DeviceCutCopy.cutOnMac)
                Task { await queue.cutOnMac(matchId: match) }
            }
            let now = "\(live.step) \(live.progress)% \(live.title) | \(live.line ?? "-")"
            if now != last {
                log("live", now)
                last = now
            }
        }
    }
}

/// The database and the route, answered from a folder: objects/<key> is R2.
@MainActor
final class FolderTransport: DeviceCutTransport {
    let root: URL
    init(root: URL) { self.root = root }

    private var objects: URL { root.appendingPathComponent("objects", isDirectory: true) }
    private func multipart(_ id: String) -> URL { root.appendingPathComponent("mp/\(id)", isDirectory: true) }
    private var claimFile: URL { root.appendingPathComponent("claim.json") }

    private func claim() -> DeviceCutClaim? {
        (try? Data(contentsOf: claimFile)).flatMap { try? JSONDecoder().decode(DeviceCutClaim.self, from: $0) }
    }

    private func json(_ object: Any, status: Int = 200) -> DeviceCutRouteAnswer {
        DeviceCutRouteAnswer(status: status, data: (try? JSONSerialization.data(withJSONObject: object)) ?? Data())
    }

    private func size(_ url: URL) -> Int64 {
        (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int64).flatMap { $0 } ?? 0
    }

    func enabled(userId: UUID) async -> Bool { true }

    func claim(matchId: UUID, marks: [HandCutSubmission]) async throws -> DeviceCutClaim {
        let uid = DeviceCutQA.user.uuidString.lowercased()
        let job = UUID()
        let jid = job.uuidString.lowercased()
        let mid = matchId.uuidString.lowercased()
        let claim = DeviceCutClaim(
            jobId: job, points: marks.count, bucket: "ponglens-media",
            keys: .init(cut: "results/\(uid)/\(jid).mp4", manifest: "results/\(uid)/\(jid).manifest.json",
                        clips: (1...max(1, marks.count)).map { "points/\(uid)/\(mid)/\(CutPlan.clipName($0))" }),
            clipPads: .init(pre: 1.2, post: 1.3))
        try JSONEncoder().encode(claim).write(to: claimFile)
        DeviceCutQA.log("claim", jid)
        return claim
    }

    func report(jobId: UUID, stage: String, progress: Int) async throws -> DeviceCutReportAnswer {
        if let from = DeviceCutQA.value("--dev-device-cut-refuse-from").flatMap(Int.init), progress >= from {
            DeviceCutQA.log("report refused", "\(stage) \(progress)")
            return DeviceCutReportAnswer(accepted: false, phase: "mac", status: "queued")
        }
        DeviceCutQA.append("{\"at\":\"\(ISO8601DateFormatter().string(from: Date()))\",\"stage\":\"\(stage)\",\"progress\":\(progress)}\n",
                           to: root.appendingPathComponent("reports.jsonl"))
        return DeviceCutReportAnswer(accepted: true, phase: "device", status: "processing")
    }

    func route(_ r: DeviceCutRouteRequest) async throws -> DeviceCutRouteAnswer {
        let fm = FileManager.default
        guard let claim = claim(), claim.jobId.uuidString.lowercased() == r.jobId else {
            return json(["error": "Job not found"], status: 404)
        }
        DeviceCutQA.log("route", r.action + (r.partNumber.map { " part \($0)" } ?? "") + (r.keys.map { " \($0.count) keys" } ?? ""))
        switch r.action {
        case "create":
            let id = UUID().uuidString
            try? fm.createDirectory(at: multipart(id), withIntermediateDirectories: true)
            return json(["bucket": claim.bucket, "key": claim.keys.cut, "uploadId": id])
        case "sign-part":
            return json(["url": multipart(r.uploadId ?? "").appendingPathComponent("\(r.partNumber ?? 0)").absoluteString])
        case "list-parts":
            let dir = multipart(r.uploadId ?? "")
            guard fm.fileExists(atPath: dir.path) else { return json(["parts": [], "gone": true]) }
            let names = (try? fm.contentsOfDirectory(atPath: dir.path)) ?? []
            let parts: [[String: Any]] = names.compactMap { Int($0) }.sorted().map { n in
                let bytes = size(dir.appendingPathComponent("\(n)"))
                return ["PartNumber": n, "Size": bytes, "ETag": "\"\(bytes)\""]
            }
            return json(["parts": parts])
        case "complete":
            let dir = multipart(r.uploadId ?? "")
            let out = objects.appendingPathComponent(claim.keys.cut)
            try? fm.createDirectory(at: out.deletingLastPathComponent(), withIntermediateDirectories: true)
            fm.createFile(atPath: out.path, contents: nil)
            let writer = try FileHandle(forWritingTo: out)
            for part in (r.parts ?? []).sorted(by: { $0.PartNumber < $1.PartNumber }) {
                let file = dir.appendingPathComponent("\(part.PartNumber)")
                guard part.ETag == "\"\(size(file))\"" else { return json(["error": "Bad parts"], status: 400) }
                writer.write(try Data(contentsOf: file))
            }
            try writer.close()
            try? fm.removeItem(at: dir)
            return json(["ok": true, "bytes": size(out)])
        case "abort":
            try? fm.removeItem(at: multipart(r.uploadId ?? ""))
            return json(["ok": true])
        case "sign":
            let allowed = Set(claim.keys.clips + [claim.keys.manifest])
            let refused = (r.keys ?? []).filter { !allowed.contains($0) }
            guard refused.isEmpty else {
                return json(["error": "Those keys do not belong to this cut", "refused": refused], status: 403)
            }
            var urls: [String: String] = [:]
            for key in r.keys ?? [] { urls[key] = objects.appendingPathComponent(key).absoluteString }
            return json(["urls": urls])
        case "submit":
            let manifestURL = objects.appendingPathComponent(claim.keys.manifest)
            guard let data = try? Data(contentsOf: manifestURL),
                  let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let points = manifest["points"] as? [[String: Any]]
            else { return json(["error": "Upload the manifest first", "missing": [claim.keys.manifest]], status: 409) }
            let prefix = claim.keys.clips.first.map { ($0 as NSString).deletingLastPathComponent } ?? ""
            var keys = [claim.keys.cut]
            for p in points { if let clip = p["clip"] as? String { keys.append("\(prefix)/\(clip)") } }
            let missing = keys.filter { size(objects.appendingPathComponent($0)) <= 0 }
            guard missing.isEmpty else {
                return json(["error": "Some files did not finish uploading", "missing": missing], status: 409)
            }
            try data.write(to: root.appendingPathComponent("submitted.json"))
            DeviceCutQA.log("submitted", "\(points.count) points, \(keys.count - 1) clips")
            return json(["ok": true, "phase": "verify"])
        case "release":
            DeviceCutQA.log("release", "toMac \(r.toMac ?? false)")
            return json(["job_id": r.jobId, "phase": r.toMac == true ? "mac" : "released"])
        default:
            return json(["error": "Unknown action"], status: 400)
        }
    }

    func put(_ data: Data, to url: URL, contentType: String) async throws {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url)
    }
}

/// R2, as a folder: each "PUT" copies the file and answers with an ETag.
@MainActor
final class FolderUploader: DeviceCutUploader {
    func send(file: URL, to url: URL, contentType: String?, name: String) {
        Task.detached {
            let fm = FileManager.default
            try? fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? fm.removeItem(at: url)
            let ok = (try? fm.copyItem(at: file, to: url)) != nil
            let bytes = (try? fm.attributesOfItem(atPath: url.path)[.size] as? Int64).flatMap { $0 } ?? 0
            try? await Task.sleep(for: .milliseconds(150))
            await MainActor.run {
                DeviceHandCutQueue.shared.transferFinished(
                    name: name, status: ok ? 200 : 500, etag: "\"\(bytes)\"", failed: !ok)
            }
        }
    }

    func inFlight() async -> Set<String> { [] }
    func cancel(jobId: UUID) async {}
}
#endif

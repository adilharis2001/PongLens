import Foundation
import Supabase

// Keeping the video (spec 2026-09-24, section 6): the rollout answers for
// this account, and the app's own copy of a video that is waiting to be
// marked. The bookkeeping rules are in LocalVideoIndex.swift, which the
// tests compile on their own.

/// The two rollout answers for the signed-in account.
///
/// - `recordingsToPhotos`: app_config.recordings_to_photos ('off' |
///   'admins' | 'on'), where 'admins' means hand_cut_enabled.
/// - `handCut`: hand_cut_enabled(auth.uid()), which decides whether the app
///   keeps its own copy after an upload.
///
/// Both are remembered per account on the device, so a recording that
/// stops in a hall with no signal still follows the last answer the server
/// gave. An account that has never been answered reads false everywhere,
/// which is the app's behaviour before either existed.
@MainActor
@Observable
final class DeviceVideoPolicy {
    static let shared = DeviceVideoPolicy()

    private(set) var userId: UUID?
    private(set) var handCut = false
    private(set) var photosConfig: String?
    @ObservationIgnored private var refreshedAt: Date?

    var recordingsToPhotos: Bool {
        DeviceVideoGate.recordingsToPhotos(configValue: photosConfig, handCut: handCut)
    }

    private static func cacheKey(_ uid: UUID) -> String {
        "pl.deviceVideoPolicy.\(uid.uuidString.lowercased())"
    }

    /// Ask the server, remember the answer. On failure keep (or load) the
    /// last remembered answer for this account.
    func refresh() async {
        guard let uid = supa.auth.currentUser?.id else {
            userId = nil
            handCut = false
            photosConfig = nil
            refreshedAt = nil
            return
        }
        if userId != uid { loadCached(uid) }
        do {
            async let rows: [ConfigRow] = supa.from("app_config")
                .select("value")
                .eq("key", value: "recordings_to_photos")
                .execute().value
            async let enabled: Bool = supa
                .rpc("hand_cut_enabled", params: HandCutParams(p_user: uid))
                .execute().value
            let (configRows, handCutAnswer) = try await (rows, enabled)
            // The account may have changed while the two reads were out.
            guard supa.auth.currentUser?.id == uid else { return }
            userId = uid
            handCut = handCutAnswer
            photosConfig = configRows.first?.value
            refreshedAt = Date()
            UserDefaults.standard.set(
                ["handCut": handCutAnswer, "photos": photosConfig ?? ""],
                forKey: Self.cacheKey(uid)
            )
        } catch {
            // Keep what loadCached found.
        }
    }

    /// The answer for right now: fresh when this process has not asked in
    /// the last ten minutes, otherwise what it already knows.
    func resolve() async {
        let uid = supa.auth.currentUser?.id
        if uid != userId || refreshedAt.map({ Date().timeIntervalSince($0) > 600 }) ?? true {
            await refresh()
        }
    }

    private func loadCached(_ uid: UUID) {
        userId = uid
        let cached = UserDefaults.standard.dictionary(forKey: Self.cacheKey(uid))
        handCut = cached?["handCut"] as? Bool ?? false
        photosConfig = cached?["photos"] as? String
        refreshedAt = nil
    }
}

/// Wire types for the two reads above. Nonisolated because `async let`
/// decodes and encodes them off the main actor.
private nonisolated struct ConfigRow: Decodable { let value: String? }
private nonisolated struct HandCutParams: Encodable { let p_user: UUID }

/// The app's own copy of a match video, kept for accounts that can hand
/// cut until the match is cut or processed, deleted with the match, or
/// deleted by the player from "My app recordings" (Account > Storage).
///
/// Lives in Application Support (never tmp, which the system empties, and
/// never Documents, which is the upload queue's scratch space), excluded
/// from device backups because a match video is gigabytes and is already on
/// the server.
@MainActor
@Observable
final class LocalMatchVideos {
    static let shared = LocalMatchVideos()

    private(set) var index: LocalVideoIndex
    @ObservationIgnored private var reconciling = false

    /// The kept file for a match, if this phone has one. What phase 2's
    /// on-phone cutter reads.
    static func url(for matchId: UUID) -> URL? {
        shared.url(for: matchId)
    }

    func url(for matchId: UUID) -> URL? {
        guard let entry = index.entry(for: matchId) else { return nil }
        let url = Self.directory.appendingPathComponent(entry.fileName)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    /// The signed-in account's copies, newest first.
    func entries(owner: UUID?) -> [LocalVideoEntry] {
        guard let owner else { return [] }
        return index.entries(owner: owner)
    }

    static var directory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MatchVideos", isDirectory: true)
        if !FileManager.default.fileExists(atPath: base.path) {
            try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
            var url = base
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? url.setResourceValues(values)
        }
        return base
    }

    private var indexURL: URL { Self.directory.appendingPathComponent(LocalVideoIndex.fileName) }

    private init() {
        index = LocalVideoIndex.decode(
            try? Data(contentsOf: Self.directory.appendingPathComponent(LocalVideoIndex.fileName)))
        sweep()
    }

    private func persist() {
        guard let data = try? index.encoded() else { return }
        try? data.write(to: indexURL, options: .atomic)
    }

    /// Drop entries whose file is gone and files no entry points at.
    private func sweep() {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: Self.directory.path)) ?? []
        let missing = index.missingFiles(present: Set(names))
        for id in missing { index.remove(matchId: id) }
        for orphan in index.orphans(in: names) {
            try? FileManager.default.removeItem(at: Self.directory.appendingPathComponent(orphan))
        }
        if !missing.isEmpty { persist() }
    }

    /// Take ownership of an uploaded file for a match. The file is MOVED,
    /// so the caller must not delete it afterwards. Throws when the move
    /// fails, in which case the caller's own cleanup still applies.
    func adopt(file: URL, matchId: UUID, ownerId: UUID, title: String?, detail: String?) throws {
        let ext = file.pathExtension.isEmpty ? "mov" : file.pathExtension.lowercased()
        let name = "\(matchId.uuidString.lowercased()).\(ext)"
        let destination = Self.directory.appendingPathComponent(name)
        if FileManager.default.fileExists(atPath: destination.path) {
            try FileManager.default.removeItem(at: destination)
        }
        try FileManager.default.moveItem(at: file, to: destination)
        let bytes = (try? FileManager.default.attributesOfItem(atPath: destination.path)[.size] as? Int64)
            .flatMap { $0 } ?? 0
        let replaced = index.upsert(LocalVideoEntry(
            matchId: matchId, ownerId: ownerId, fileName: name, bytes: bytes,
            createdAt: Date(), title: title, detail: detail))
        if let replaced {
            try? FileManager.default.removeItem(at: Self.directory.appendingPathComponent(replaced))
        }
        persist()
    }

    /// Delete this phone's copy. Never touches Photos or the server.
    func remove(matchId: UUID) {
        guard let entry = index.remove(matchId: matchId) else { return }
        try? FileManager.default.removeItem(at: Self.directory.appendingPathComponent(entry.fileName))
        persist()
    }

    /// Square the kept copies with the server: a match that is gone or
    /// now `ready` loses its copy, and the titles catch up. Only the
    /// signed-in owner's copies are considered, and only a query that
    /// succeeded is read: a failed read deletes nothing.
    func reconcile() async {
        guard !reconciling else { return }
        reconciling = true
        defer { reconciling = false }
        sweep()
        guard let owner = try? await supa.auth.session.user.id else { return }
        let mine = index.entries(owner: owner)
        guard !mine.isEmpty else { return }
        struct Row: Decodable {
            let id: UUID
            let status: String
            let opponent_name: String?
            let venue: String?
            let played_at: String
            let match_type: String?
        }
        let rows: [Row]
        do {
            rows = try await supa.from("matches")
                .select("id,status,opponent_name,venue,played_at,match_type")
                .in("id", values: mine.map { $0.matchId.uuidString.lowercased() })
                .execute().value
        } catch {
            return
        }
        guard supa.auth.currentUser?.id == owner else { return }
        let doomed = LocalVideoReconcile.doomed(
            entries: mine, owner: owner,
            rows: Dictionary(rows.map { ($0.id, $0.status) }, uniquingKeysWith: { a, _ in a }))
        for id in doomed { remove(matchId: id) }
        var titled = false
        for row in rows where index.entry(for: row.id) != nil {
            let parts = MatchTitle.parts(
                opponentName: row.opponent_name, venue: row.venue,
                playedAt: row.played_at, matchType: row.match_type)
            let entry = index.entry(for: row.id)
            if entry?.title != parts.primary || entry?.detail != parts.secondary {
                index.setTitle(parts.primary, detail: parts.secondary, for: row.id)
                titled = true
            }
        }
        if titled { persist() }
    }
}

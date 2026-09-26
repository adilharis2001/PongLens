import Foundation

// Keeping the video on the phone (spec 2026-09-24, section 6), the part
// that is pure bookkeeping. Foundation only, so ios/Tests/run.sh checks
// it. The file moves, the network and the screen live in
// LocalMatchVideos.swift; the Photos save lives in RecordingQueue.

/// The two rollout questions, answered from what the server said. Every
/// unknown answers false, which is the behaviour before either existed.
nonisolated enum DeviceVideoGate {
    /// app_config.recordings_to_photos: 'on' for everyone, 'admins' for
    /// accounts that pass hand_cut_enabled, anything else off.
    static func recordingsToPhotos(configValue: String?, handCut: Bool) -> Bool {
        let value = (configValue ?? "")
            .replacingOccurrences(of: "\"", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        switch value {
        case "on": return true
        case "admins": return handCut
        default: return false
        }
    }

    /// The app keeps its own copy only for an account that can hand cut,
    /// and only when the upload did not ask for automatic processing: a
    /// processed match never needs marking, so the copy would be dead
    /// weight from the moment it was kept.
    static func keepsWorkingCopy(handCut: Bool, processingRequested: Bool) -> Bool {
        handCut && !processingRequested
    }
}

/// One video the app kept for a match that is waiting to be marked.
nonisolated struct LocalVideoEntry: Codable, Equatable, Identifiable, Sendable {
    let matchId: UUID
    /// The account that uploaded it. Only that account's reconciliation may
    /// delete it: another account signed in on the same phone cannot see
    /// the match, and "cannot see" must never read as "deleted".
    let ownerId: UUID
    /// Relative to the store's directory.
    var fileName: String
    var bytes: Int64
    var createdAt: Date
    /// Last title the server gave, so the list reads offline.
    var title: String?
    /// The line under the title (date, type), same source.
    var detail: String?

    var id: UUID { matchId }
}

nonisolated struct LocalVideoIndex: Codable, Equatable, Sendable {
    static let fileName = "index.json"

    var entries: [LocalVideoEntry] = []

    /// A damaged or missing index reads as empty. The orphan sweep then
    /// removes the files nothing points at, so a bad write costs the kept
    /// copies, never the player's footage (that is in Photos and on the
    /// server).
    static func decode(_ data: Data?) -> LocalVideoIndex {
        guard let data else { return LocalVideoIndex() }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return (try? decoder.decode(LocalVideoIndex.self, from: data)) ?? LocalVideoIndex()
    }

    func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(self)
    }

    func entry(for matchId: UUID) -> LocalVideoEntry? {
        entries.first { $0.matchId == matchId }
    }

    /// Newest first, one account's only.
    func entries(owner: UUID) -> [LocalVideoEntry] {
        entries.filter { $0.ownerId == owner }.sorted { $0.createdAt > $1.createdAt }
    }

    /// Adds or replaces the entry for its match. Returns the file the old
    /// entry pointed at when it was a different file, which the caller
    /// deletes: one match keeps one copy.
    @discardableResult
    mutating func upsert(_ entry: LocalVideoEntry) -> String? {
        if let i = entries.firstIndex(where: { $0.matchId == entry.matchId }) {
            let old = entries[i].fileName
            entries[i] = entry
            return old == entry.fileName ? nil : old
        }
        entries.append(entry)
        return nil
    }

    @discardableResult
    mutating func remove(matchId: UUID) -> LocalVideoEntry? {
        guard let i = entries.firstIndex(where: { $0.matchId == matchId }) else { return nil }
        return entries.remove(at: i)
    }

    mutating func setTitle(_ title: String, detail: String?, for matchId: UUID) {
        guard let i = entries.firstIndex(where: { $0.matchId == matchId }) else { return }
        entries[i].title = title
        entries[i].detail = detail
    }

    /// Files in the directory that no entry points at: a crash between the
    /// move and the index write, or an entry dropped by a damaged index.
    func orphans(in fileNames: [String]) -> [String] {
        let known = Set(entries.map(\.fileName))
        return fileNames.filter { $0 != Self.fileName && !$0.hasPrefix(".") && !known.contains($0) }
    }

    /// Entries whose file is gone (the player cleared the app's storage,
    /// or a restore without it). Nothing to show, nothing to delete.
    func missingFiles(present fileNames: Set<String>) -> [UUID] {
        entries.filter { !fileNames.contains($0.fileName) }.map(\.matchId)
    }
}

/// What the owner's own reads said about the kept matches.
nonisolated enum LocalVideoReconcile {
    /// A kept copy nobody has started marking goes this long after it was
    /// kept (Adil, 2026-09-26, post-rollout audit P). The original is on
    /// the server; this is only the phone's working copy.
    static let keepDays = 14.0

    /// The kept copies to delete now.
    ///
    /// - `rows`: every row the owner's match query returned when asked for
    ///   exactly these ids, as id -> status.
    /// - `marked`: for copies past `keepDays`, whether marking has started:
    ///   true when the server's draft or the phone's own draft copy has a
    ///   mark, or a hand-cut job exists for the match; false only when
    ///   every one of those reads answered and found nothing. A match
    ///   missing from the map was not read, or a read failed, and counts
    ///   as marked.
    /// - `inUse`: matches whose copy a phone cut is reading or the marker
    ///   has open. Never deleted, whatever else is true.
    ///
    /// The rules, in order:
    /// - Another account's copy is never touched.
    /// - A copy in use stays.
    /// - A match the owner's query did not return is deleted (RLS hides
    ///   only other people's rows, and every entry here is the owner's).
    /// - A match whose status is `ready` has been cut or processed; the
    ///   video it was kept for is on the server as points.
    /// - Past `keepDays` since it was kept, with marking known not to have
    ///   started, it goes.
    /// - Everything else (uploaded, processing, failed) keeps its copy.
    ///
    /// Only call this with rows from a query that SUCCEEDED. A failed read
    /// is not an empty one, and treating it as one would delete every copy.
    static func doomed(
        entries: [LocalVideoEntry], owner: UUID, rows: [UUID: String],
        now: Date, marked: [UUID: Bool], inUse: Set<UUID>
    ) -> [UUID] {
        entries.compactMap { entry in
            guard entry.ownerId == owner, !inUse.contains(entry.matchId) else { return nil }
            guard let status = rows[entry.matchId] else { return entry.matchId }
            if status == "ready" { return entry.matchId }
            if expired(entry, now: now), marked[entry.matchId] == false { return entry.matchId }
            return nil
        }
    }

    /// Kept `keepDays` or more ago: the copies whose marking the caller
    /// has to read before `doomed` can let them go.
    static func expired(_ entry: LocalVideoEntry, now: Date) -> Bool {
        now.timeIntervalSince(entry.createdAt) >= keepDays * 86_400
    }

    /// One match's reads, folded: any mark or job is marked; nothing found
    /// by reads that all answered is not; any read that failed (nil) with
    /// nothing found counts as marked, so a failed read never deletes.
    static func marked(serverMarks: Int?, phoneMarks: Int?, handCutJob: Bool?) -> Bool {
        if (serverMarks ?? 0) > 0 || (phoneMarks ?? 0) > 0 || handCutJob == true { return true }
        return serverMarks == nil || phoneMarks == nil || handCutJob == nil
    }
}

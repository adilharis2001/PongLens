import Foundation
import Supabase
import UIKit

// The state behind "Mark the points yourself" on iPhone: the draft (one
// `hand_cut_drafts` row per match, the same row the web writes, plus a copy
// on the phone) and the marking session the full-screen player drives.
//
// The rules themselves live in HandCut.swift and are proved against the
// web's fixture. Nothing here decides what a tap means; it decides when the
// work is saved and what the pad is showing.

// MARK: - Where the marker's video comes from

/// Where the marker's video comes from.
///
/// The copy kept on the phone when there is one (`LocalMatchVideos`, only
/// for accounts that can hand cut), so seeking is instant and nothing
/// streams; otherwise the original upload through a presigned link minted
/// once and frozen for the session, as the web does. The marker only ever
/// sees a URL, so the two paths behave the same.
enum HandCutVideo {
    static var localFile: @MainActor (UUID) -> URL? = { LocalMatchVideos.url(for: $0) }
}

// MARK: - The draft

/// One match's marks, saved to the phone at once and to the server shortly
/// after, the same row and the same rules as the web (RawMatchView's
/// saveDraft, codex/hc-web-marker 9ebcdbde).
///
///  - **Never an upsert.** The owner may update only `marks`, `mode` and
///    `updated_at` (20260909181000), and an upsert's conflict branch writes
///    `match_id` and `user_id` too, so every save after the first was
///    refused. A save is a plain insert when no row is known and an update
///    of those three columns otherwise.
///  - **The newer draft wins.** Every update is conditional on the
///    `updated_at` this phone last read or wrote. If another device saved
///    since, nothing is written: saving stops for the session, the server's
///    draft is read back so the row and the next opening show it, and the
///    pad says so and holds back Cut the match.
///  - **Nothing is written on open**, and a pass with nothing marked never
///    writes an empty draft.
///  - **Closing saves at once**, and so does the app going to the
///    background. The phone's own copy (HandCutMirror) has every tap the
///    moment it is made, so a crash loses nothing: taps that never reached
///    the server go up the next time the match is opened, unless the server
///    was saved from elsewhere since, in which case its copy wins and the
///    player is told in one line.
@MainActor @Observable
final class HandCutDraftStore {
    /// The draft table answered. The web hides the row when the read fails,
    /// and so does this.
    private(set) var ready = false
    /// `hand_cut_enabled` said yes for this account.
    private(set) var enabled = false
    private(set) var marks: [HandCutMark] = []
    private(set) var mode: HandCutMode?
    /// Another device saved this draft after this session last did. Nothing
    /// more is saved until the marker is opened again.
    private(set) var conflicted = false
    /// Set when the server's newer copy replaced taps this phone had not
    /// sent, for the marker to say once.
    var notice: String?

    var markedCount: Int { marks.filter { $0.t1 != nil }.count }

    /// The web's words for a conflict found mid-session.
    static let newerDraft = "Marked on another device. Reopen to see the latest."
    /// On opening, when the server's newer copy replaced unsent taps.
    static let replacedNotice = "Unsaved marks on this phone were replaced."

    @ObservationIgnored private var matchId: UUID?
    @ObservationIgnored private var userId: UUID?
    /// The row's `updated_at` exactly as the server last returned it (read
    /// or written). The update is conditional on this very value.
    @ObservationIgnored private var serverStamp: String?
    /// Local changes the server has not got.
    @ObservationIgnored private var dirty = false
    @ObservationIgnored private var debounce: Task<Void, Never>?
    @ObservationIgnored private var saving: Task<Void, Never>?

    static let saveDebounce: Duration = .milliseconds(1500)

    private nonisolated struct Row: Decodable {
        let marks: HandCutJSON?
        let mode: String?
        let updated_at: String?
    }

    private nonisolated struct Stamped: Decodable { let updated_at: String }

    /// Read both copies and decide which one is the draft.
    func load(matchId: UUID, userId: UUID) async {
        self.matchId = matchId
        self.userId = userId
        struct Gate: Encodable { let p_user: String }
        enabled = (try? await supa.rpc(
            "hand_cut_enabled", params: Gate(p_user: userId.uuidString.lowercased())
        ).execute().value) ?? false
        await refresh()
    }

    /// A new marking session: re-read the draft, so the newer copy is the
    /// one that opens, and lift a previous session's conflict.
    func beginSession() async {
        if let saving { await saving.value }
        conflicted = false
        await refresh()
    }

    /// The server's row against the phone's copy.
    func refresh() async {
        guard let matchId, let userId else { return }
        let row: Row?
        do {
            row = try await fetchRow(matchId)
            ready = true
        } catch {
            // The web hides the feature when this read fails; a phone that
            // cannot see the server should not offer a pass it cannot save.
            // The phone's copy stays where it is for next time.
            ready = false
            return
        }
        let serverMarks = HandCut.normalizeMarks(row?.marks)
        let serverMode = row?.mode.flatMap(HandCutMode.init(rawValue:))
        let local = HandCutMirror.read(matchId: matchId, userId: userId)

        guard let local, local.dirty else {
            adopt(serverMarks, serverMode, stamp: row?.updated_at)
            return
        }
        // Unsent taps. They go up only if the server still holds the draft
        // they were made on; a row saved since, from anywhere, wins.
        let serverSavedSince = row != nil && row?.updated_at != local.serverStamp
        if serverSavedSince {
            let lost = local.marks != serverMarks
            adopt(serverMarks, serverMode, stamp: row?.updated_at)
            if lost { notice = Self.replacedNotice }
        } else {
            marks = local.marks
            mode = local.mode
            // No row (never saved, or gone): the next save inserts one.
            serverStamp = row?.updated_at
            dirty = true
            writeMirror()
            Task { await flush() }
        }
    }

    private func adopt(_ m: [HandCutMark], _ md: HandCutMode?, stamp: String?) {
        marks = m
        mode = md
        serverStamp = stamp
        dirty = false
        writeMirror()
    }

    /// Every change to the marks or the mode. The phone's copy is written
    /// now; the server's after the player pauses for a moment.
    func edited(_ marks: [HandCutMark], mode: HandCutMode?) {
        // A newer draft exists: this session's taps are not the draft.
        if conflicted { return }
        // Nothing marked where the server has nothing: not a draft.
        if marks.isEmpty && self.marks.isEmpty && serverStamp == nil {
            self.mode = mode
            return
        }
        self.marks = marks
        self.mode = mode
        dirty = true
        writeMirror()
        debounce?.cancel()
        debounce = Task { [weak self] in
            try? await Task.sleep(for: Self.saveDebounce)
            guard !Task.isCancelled else { return }
            await self?.flush()
        }
    }

    /// Save now, if there is anything to save. Closing the marker, and the
    /// app going to the background, call this.
    func flush() async {
        debounce?.cancel()
        debounce = nil
        if let saving { await saving.value }
        guard dirty, !conflicted else { return }
        let task = Task { await self.save() }
        saving = task
        await task.value
        saving = nil
    }

    /// The marks were handed to the worker. The server row is frozen with
    /// them now, so the phone's copy has nothing left to protect.
    func submitted() {
        debounce?.cancel()
        dirty = false
        if let matchId { HandCutMirror.remove(matchId: matchId) }
    }

    private func save() async {
        guard let matchId, let userId, dirty, !conflicted else { return }
        let sending = marks
        let sendingMode = mode
        let stamp = Self.formatStamp(Date())
        let id = matchId.uuidString.lowercased()
        do {
            if let known = serverStamp {
                let rows: [Stamped] = try await supa.from("hand_cut_drafts")
                    .update(HandCutDraftUpdate(marks: sending, mode: sendingMode, updated_at: stamp))
                    .eq("match_id", value: id)
                    .eq("updated_at", value: known)
                    .select("updated_at")
                    .execute().value
                // Nothing matched: saved since from elsewhere, sent, or gone.
                guard let written = rows.first else {
                    await conflict()
                    return
                }
                landed(written.updated_at, sent: sending, mode: sendingMode)
            } else {
                do {
                    let written: Stamped = try await supa.from("hand_cut_drafts")
                        .insert(HandCutDraftInsert(
                            match_id: id, user_id: userId.uuidString.lowercased(),
                            marks: sending, mode: sendingMode, updated_at: stamp
                        ))
                        .select("updated_at")
                        .single()
                        .execute().value
                    landed(written.updated_at, sent: sending, mode: sendingMode)
                } catch let error as PostgrestError where error.code == "23505" {
                    // The row appeared since this phone last looked.
                    await conflict()
                }
            }
        } catch {
            // Offline or refused. The phone's copy still has every tap;
            // the next edit, close or opening tries again.
        }
    }

    private func landed(_ stamp: String, sent: [HandCutMark], mode sentMode: HandCutMode?) {
        serverStamp = stamp
        // Taps made while the save was in the air are still unsent.
        dirty = !(marks == sent && mode == sentMode)
        writeMirror()
    }

    /// Another device's draft is newer. Stop saving for this session and
    /// read theirs, so the row's count and the next opening show it.
    private func conflict() async {
        conflicted = true
        dirty = false
        debounce?.cancel()
        guard let matchId else { return }
        if let row = try? await fetchRow(matchId) {
            adopt(HandCut.normalizeMarks(row.marks),
                  row.mode.flatMap(HandCutMode.init(rawValue:)),
                  stamp: row.updated_at)
        } else {
            writeMirror()
        }
    }

    private func fetchRow(_ matchId: UUID) async throws -> Row? {
        let rows: [Row] = try await supa.from("hand_cut_drafts")
            .select("marks,mode,updated_at")
            .eq("match_id", value: matchId.uuidString.lowercased())
            .limit(1)
            .execute().value
        return rows.first
    }

    private func writeMirror() {
        guard let matchId, let userId else { return }
        HandCutMirror.write(HandCutMirror.Copy(
            userId: userId, matchId: matchId, marks: marks, mode: mode,
            serverStamp: serverStamp, dirty: dirty
        ))
    }

    /// A new `updated_at`, as the web writes it (toISOString).
    nonisolated static func formatStamp(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        f.timeZone = TimeZone(identifier: "UTC")
        return f.string(from: date)
    }
}

/// The three columns an owner may update, nulls written out.
nonisolated struct HandCutDraftUpdate: Encodable {
    let marks: [HandCutMark]
    let mode: HandCutMode?
    let updated_at: String

    enum CodingKeys: String, CodingKey { case marks, mode, updated_at }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(marks, forKey: .marks)
        if let mode { try c.encode(mode, forKey: .mode) } else { try c.encodeNil(forKey: .mode) }
        try c.encode(updated_at, forKey: .updated_at)
    }
}

/// A new draft row.
nonisolated struct HandCutDraftInsert: Encodable {
    let match_id: String
    let user_id: String
    let marks: [HandCutMark]
    let mode: HandCutMode?
    let updated_at: String

    enum CodingKeys: String, CodingKey { case match_id, user_id, marks, mode, updated_at }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(match_id, forKey: .match_id)
        try c.encode(user_id, forKey: .user_id)
        try c.encode(marks, forKey: .marks)
        if let mode { try c.encode(mode, forKey: .mode) } else { try c.encodeNil(forKey: .mode) }
        try c.encode(updated_at, forKey: .updated_at)
    }
}

/// The phone's own copy of a draft, in Application Support, written on
/// every tap so a crash or a dead battery loses nothing.
enum HandCutMirror {
    struct Copy: Codable {
        let userId: UUID
        let matchId: UUID
        let marks: [HandCutMark]
        let mode: HandCutMode?
        /// The server's `updated_at` these marks were made on.
        let serverStamp: String?
        let dirty: Bool
    }

    static func directory() -> URL? {
        guard var url = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        else { return nil }
        url.appendPathComponent("hand-cut-drafts", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try url.setResourceValues(values)
        } catch { return nil }
        return url
    }

    static func file(_ matchId: UUID) -> URL? {
        directory()?.appendingPathComponent("\(matchId.uuidString.lowercased()).json")
    }

    static func read(matchId: UUID, userId: UUID) -> Copy? {
        guard let url = file(matchId), let data = try? Data(contentsOf: url),
              let copy = try? JSONDecoder().decode(Copy.self, from: data),
              copy.userId == userId, copy.matchId == matchId
        else { return nil }
        return copy
    }

    static func write(_ copy: Copy) {
        guard let url = file(copy.matchId), let data = try? JSONEncoder().encode(copy) else { return }
        try? data.write(to: url, options: .atomic)
    }

    static func remove(matchId: UUID) {
        guard let url = file(matchId) else { return }
        try? FileManager.default.removeItem(at: url)
    }
}

// MARK: - The marking session

/// A start and an end on the source clock.
struct HandCutSpan: Equatable {
    var t0: Double
    var t1: Double
}

/// What the marking screen is showing and what it is waiting for. The web's
/// MarkPoints component state, one field for one field; the player itself
/// (the clock, seeks, play and pause) stays in PlayerTakeover.
@MainActor @Observable
final class HandCutMarker {
    // Constants of the web marker (MarkPoints.tsx), in seconds.
    static let refuseSeconds = 2.0
    static let pauseGlyphSeconds = 0.34
    /// The pads the worker cuts a hand-marked clip with (claim_hand_cut's
    /// clip_pads), so a preview shows the clip the player will get.
    static let clipPre = 1.2
    static let clipPost = 1.3
    /// Mark again lands this far before the point, for a run-up.
    static let redoLead = 3.0
    static let speeds: [Double] = [0.1, 0.25, 0.5, 1, 1.5, 2]

    let matchId: UUID
    let matchType: String?
    let youLabel = "Me"
    let themLabel: String
    /// Decided once on the way in, so a save during the session cannot
    /// change what the screen was opened as.
    let openedAs: HandCutOpenAs
    let store: HandCutDraftStore
    /// Hands the marks to claim_hand_cut. Nil on success, else the sentence.
    @ObservationIgnored let submitMarks: ([HandCutMark]) async -> String?
    /// Writes who served first onto the match, the app's usual way.
    @ObservationIgnored let saveFirstServer: (Winner) async -> Bool

    var state: HandCutState {
        didSet {
            if state.marks != oldValue.marks { store.edited(state.marks, mode: mode) }
            // Adjust belongs to one selected point; when the selection moves
            // on, so does the bar, and an unconfirmed drag goes with it.
            if let adjusting, state.selectedId != adjusting {
                self.adjusting = nil
                adjustDraft = nil
                adjustBounds = nil
            }
        }
    }
    /// The Score switch: on, the pass also says who won each point. Never
    /// empty: a fresh match starts with it on, practice and drills with it
    /// off (HandCut.openingMode).
    var mode: HandCutMode {
        didSet { if mode != oldValue { store.edited(state.marks, mode: mode) } }
    }
    var firstServer: Winner?
    /// "Who served first?" is showing.
    var serveStep: Bool
    /// Does closing the serve card move the picture? On the way in, yes.
    @ObservationIgnored var serveStepCue = true
    /// Until the session starts, the pad is one button.
    var started: Bool
    var refusal: String?
    @ObservationIgnored private var refuseNonce = 0
    /// The point whose edges the bar is showing, and the unconfirmed drag.
    var adjusting: String?
    var adjustDraft: HandCutSpan?
    /// The window the bar draws, fixed when it opens.
    var adjustBounds: HandCutSpan?
    /// While previewing a point, the second to stop at.
    @ObservationIgnored var previewUntil: Double?
    /// Did THIS screen pause the video, waiting for who won? Only a pause the
    /// screen caused is one it undoes.
    @ObservationIgnored var pausedForAnswer = false
    /// Paused long enough to deserve the play glyph.
    var stopped = false
    @ObservationIgnored private var stoppedNonce = 0
    /// Has the picture run in this session?
    var everPlayed = false
    /// The review sheet (Done).
    var reviewing = false
    var busy = false
    var submitError: String?
    /// The file's own shape, for the portrait picture box.
    var aspect: Double = 16 / 9
    /// The video's length: the match row's, then the file's once known.
    var durationS: Double?
    /// The cue on reopen has run.
    @ObservationIgnored var cued = false
    /// One live seek at a time while a handle is dragged.
    @ObservationIgnored var scrubInFlight = false
    @ObservationIgnored var scrubPending: Double?
    @ObservationIgnored private var seq = 0

    /// `mode` is the Score switch as the player left it on the match page;
    /// nil opens as the draft (or the default) says.
    init(
        match: MatchRow,
        store: HandCutDraftStore,
        mode chosen: HandCutMode? = nil,
        submitMarks: @escaping ([HandCutMark]) async -> String?,
        saveFirstServer: @escaping (Winner) async -> Bool
    ) {
        matchId = match.id
        var type = match.matchType
        var first = match.firstServer.flatMap(Winner.init(rawValue:))
        #if DEBUG
        // Local-only overrides for looking at the practice and serve states
        // on a real match without writing to it.
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "--dev-hc-type"), args.indices.contains(i + 1) {
            type = args[i + 1]
        }
        if args.contains("--dev-hc-no-first-server") { first = nil }
        #endif
        matchType = (type?.isEmpty ?? true) ? nil : type
        let opponent = match.opponentName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let firstWord = opponent.split(whereSeparator: { $0.isWhitespace }).first.map(String.init) ?? ""
        themLabel = String((firstWord.isEmpty ? "Them" : firstWord).prefix(12))
        self.store = store
        self.submitMarks = submitMarks
        self.saveFirstServer = saveFirstServer
        firstServer = first
        durationS = match.durationS

        let initial = store.marks
        let resumed = !initial.isEmpty
        // Practice and drills can only ever be cut: a draft reopens as a
        // cut-only pass whatever it was saved as, winners kept. A match
        // opens as the player chose on the match page, else with Score on,
        // or as its draft recorded.
        let scoringAllowed = MatchTitle.tracksServe((type?.isEmpty ?? true) ? nil : type)
        let openedMode = HandCut.openingMode(
            initial, recorded: store.mode, tracksServe: scoringAllowed, chosen: chosen)
        openedAs = HandCut.openAs(initial, durationS: match.durationS, mode: openedMode)
        let openedCalled = openedAs == .review || openedAs == .choice
        state = resumed
            ? HandCutState(
                marks: initial,
                selectedId: openedCalled ? initial.first?.id : HandCut.firstUnscored(initial)?.id
            )
            : HandCutState()
        mode = openedMode
        // Score on, a rotation to follow and nobody named as first server:
        // "Who served first?" on the way in, fresh or resumed.
        serveStep = openedMode == .score && MatchTitle.tracksServe(matchType) && first == nil
        started = resumed && !openedCalled
        // A switch flipped on the match page is the draft's mode from now
        // on. The store writes nothing for a draft that does not exist yet.
        if chosen != nil, openedMode != store.mode {
            store.edited(initial, mode: openedMode)
        }
    }

    // MARK: Derived

    /// Practice and drills: no rotation, no answers, Cut only.
    var practice: Bool { !MatchTitle.tracksServe(matchType) }
    var openedFinished: Bool { openedAs == .review }
    var openedPartial: Bool { openedAs == .choice }
    var open: HandCutMark? { HandCut.openMark(state.marks) }
    var summary: HandCutSummary { HandCut.summarize(state.marks) }
    var score: MatchScore { handCutScore(state.marks) }
    var nextServer: Winner? { handCutNextServer(state.marks, firstServer: firstServer) }
    var awaiting: Bool { state.awaitingId != nil }
    var canAnswer: Bool { awaiting || state.selectedId != nil }
    var selectedMark: HandCutMark? {
        state.selectedId.flatMap { id in state.marks.first { $0.id == id } }
    }
    /// A closed point is selected: the pair means Adjust and Resume.
    var reviewingPoint: Bool { selectedMark?.t1 != nil }
    var adjustOn: Bool { selectedMark != nil && adjusting == selectedMark?.id }
    var gaps: (before: HandCutGap?, after: HandCutGap?) {
        HandCut.gapsAround(state.marks, id: state.selectedId, durationS: durationS)
    }
    var starLit: Bool {
        let id = state.awaitingId ?? state.selectedId
        return state.marks.first { $0.id == id }?.starred ?? false
    }
    var stepIndex: Int {
        state.selectedId.flatMap { id in state.marks.firstIndex { $0.id == id } } ?? -1
    }
    var hasPrev: Bool {
        stepIndex > 0 && state.marks[..<stepIndex].contains { $0.t1 != nil }
    }
    var hasNext: Bool {
        stepIndex >= 0 && state.marks[(stepIndex + 1)...].contains { $0.t1 != nil }
    }

    /// The point the picture is inside, padded as its clip will be.
    func playingId(at t: Double) -> String? {
        state.marks.first { m in
            guard let t1 = m.t1 else { return false }
            return t >= m.t0 - Self.clipPre && t <= t1 + Self.clipPost
        }?.id
    }

    /// Where marking picks up: the rally still open, wherever it sits (one
    /// marked into a gap is not at the end), or else the last point's end.
    static func markingPlace(_ marks: [HandCutMark]) -> Double? {
        HandCut.openMark(marks)?.t0 ?? HandCut.lastClosedEnd(marks)
    }

    /// The earliest second a point may reach back to, given the mark before
    /// it: that point's end, or, for a rally still open, its start plus the
    /// shortest point, which is as far as the rules let a point crowd it.
    static func floorAfter(_ prev: HandCutMark?) -> Double {
        guard let prev else { return 0 }
        return prev.t1 ?? prev.t0 + HandCut.MIN_POINT_S
    }

    /// The speed nearest `rate`, as an index into `speeds`.
    static func speedIndex(_ rate: Double) -> Int {
        var best = 0
        for i in 1..<speeds.count where abs(speeds[i] - rate) < abs(speeds[best] - rate) {
            best = i
        }
        return best
    }

    func nextId() -> String {
        seq += 1
        let alphabet = Array("abcdefghijklmnopqrstuvwxyz0123456789")
        let tail = String((0..<6).map { _ in alphabet.randomElement()! })
        return "m\(seq)-\(tail)"
    }

    // MARK: Refusals and haptics

    func refuse(_ why: String) {
        refusal = why
        refuseNonce += 1
        let mine = refuseNonce
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(Self.refuseSeconds))
            guard let self, self.refuseNonce == mine else { return }
            self.refusal = nil
        }
    }

    /// Apply a rule's answer: the new state, or the reason on screen.
    @discardableResult
    func apply(_ next: HandCutApplied) -> Bool {
        if let refused = next.refused {
            refuse(refused.text)
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            return false
        }
        state = next.state
        return true
    }

    // MARK: The glyph clock

    /// Playback started or stopped. The glyph waits out the double-tap
    /// window so the pause inside a double tap never paints it.
    func playbackChanged(playing: Bool) {
        stoppedNonce += 1
        if playing {
            stopped = false
            everPlayed = true
            return
        }
        let mine = stoppedNonce
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(Self.pauseGlyphSeconds))
            guard let self, self.stoppedNonce == mine else { return }
            self.stopped = true
        }
    }

}

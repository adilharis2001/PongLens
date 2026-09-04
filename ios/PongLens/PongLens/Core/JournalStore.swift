import Foundation
import Supabase

struct NoteFeedRow: Codable, Identifiable, Hashable {
    let id: UUID
    let matchId: UUID
    let pointId: UUID?
    let authorId: UUID
    let body: String
    let audioPath: String?
    let imagePath: String?
    let createdAt: String
    let authorName: String?
    let matchOwnerId: UUID
    let opponentName: String?
    let venue: String?
    let playedAt: String

    enum CodingKeys: String, CodingKey {
        case id, body, venue
        case matchId = "match_id"
        case pointId = "point_id"
        case authorId = "author_id"
        case audioPath = "audio_path"
        case imagePath = "image_path"
        case createdAt = "created_at"
        case authorName = "author_name"
        case matchOwnerId = "match_owner_id"
        case opponentName = "opponent_name"
        case playedAt = "played_at"
    }
}

struct LessonTakeaways: Codable, Hashable {
    let title: String?
    let themes: [Theme]?

    struct Theme: Codable, Hashable {
        let name: String
        let points: [String]
    }
}

struct LessonRow: Codable, Identifiable, Hashable {
    let id: UUID
    let userId: UUID
    let transcript: String
    let takeaways: LessonTakeaways?
    let status: String
    let kind: String
    let coachName: String?
    /// The player_coaches row this entry is attributed to (164). The real
    /// relationship; coachName is the words, kept in step by a trigger so
    /// every reader that predates this keeps working. Defaulted so a
    /// query that does not select it still decodes.
    var coachRefId: UUID? = nil
    /// When that coach was let read it (164). Nil means attributed but
    /// private, which is the default.
    var sharedWithCoachAt: String? = nil
    let imagePath: String?
    /// "Lesson about this match" (037). Defaulted so the journal's own
    /// queries, which never select it, keep decoding.
    var matchId: UUID? = nil
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, transcript, takeaways, status, kind
        case userId = "user_id"
        case coachName = "coach_name"
        case coachRefId = "coach_ref_id"
        case sharedWithCoachAt = "shared_with_coach_at"
        case imagePath = "image_path"
        case matchId = "match_id"
        case createdAt = "created_at"
    }

    /// A copy carrying a hand-edited note. Everything else rides across
    /// untouched on purpose: editing a note writes the note and the
    /// coach's name, and must never disturb the words, the kind or the
    /// status.
    func withNote(
        _ takeaways: LessonTakeaways?, coachName: String?,
        coachRefId: UUID? = nil, sharedWithCoachAt: String? = nil
    ) -> LessonRow {
        LessonRow(
            id: id, userId: userId, transcript: transcript, takeaways: takeaways,
            status: status, kind: kind, coachName: coachName,
            coachRefId: coachRefId, sharedWithCoachAt: sharedWithCoachAt,
            imagePath: imagePath, matchId: matchId, createdAt: createdAt
        )
    }

    /// A copy carrying rewritten words. Only reachable for an entry that
    /// never had a note, where the words are the note.
    func withWords(
        _ transcript: String, coachName: String?,
        coachRefId: UUID? = nil, sharedWithCoachAt: String? = nil
    ) -> LessonRow {
        LessonRow(
            id: id, userId: userId, transcript: transcript, takeaways: takeaways,
            status: status, kind: kind, coachName: coachName,
            coachRefId: coachRefId, sharedWithCoachAt: sharedWithCoachAt,
            imagePath: imagePath, matchId: matchId, createdAt: createdAt
        )
    }
}

/// One of the player's own coaches, as player_coaches_list() returns it
/// (164). The web twin is `PlayerCoach` in src/lib/coaches/playerCoaches.ts;
/// keep the rules in step.
///
/// coachId is optional and that is the point: a coach who has been INVITED
/// has nobody behind their link yet, so an entry could not be attributed to
/// them at all if this pointed at an account. It also covers the coach who
/// will never join, which is most of them.
struct PlayerCoach: Codable, Identifiable, Hashable {
    let id: UUID
    let coachId: UUID?
    let displayName: String
    let coachEmail: String?
    let inviteId: UUID?
    /// "connected" | "invited" | "offline", derived from coach_links.
    let status: String
    let entryCount: Int
    let sharedCount: Int

    enum CodingKeys: String, CodingKey {
        case id, status
        case coachId = "coach_id"
        case displayName = "display_name"
        case coachEmail = "coach_email"
        case inviteId = "invite_id"
        case entryCount = "entry_count"
        case sharedCount = "shared_count"
    }

    /// Whether sharing an entry with them can ever reach them. "invited"
    /// counts: student_shared_lessons() needs an accepted link too, so a
    /// share set while an invite is out simply waits for it.
    var canReceiveEntries: Bool { status == "connected" || status == "invited" }

    /// The line under the share control. Never guesses a pronoun.
    var shareHint: String? {
        switch status {
        case "connected": return "They can read it in their coaching workspace."
        case "invited": return "They can read it once they accept your invite."
        default: return nil
        }
    }
}

/// A coach's shared entry, as coach_shared_entries() returns it: the
/// coach's live words, refreshed on every journal load. Read-only here —
/// the coach owns the row.
struct CoachSharedEntry: Codable, Identifiable, Hashable {
    let entryId: UUID
    /// The coach's own lessons row. It is what signs the photo (163), and
    /// it is the only handle the student ever gets on it.
    let lessonId: UUID
    let coachId: UUID
    let coachName: String
    let transcript: String
    let takeaways: LessonTakeaways?
    let entryKind: String
    /// Pinned to the coach's own folder by the RPC; nil when there is none.
    let imagePath: String?
    let matchId: UUID?
    let sharedAt: String
    let updatedAt: String

    var id: UUID { entryId }

    enum CodingKeys: String, CodingKey {
        case transcript, takeaways
        case entryId = "entry_id"
        case lessonId = "lesson_id"
        case coachId = "coach_id"
        case coachName = "coach_name"
        case entryKind = "entry_kind"
        case imagePath = "image_path"
        case matchId = "match_id"
        case sharedAt = "shared_at"
        case updatedAt = "updated_at"
    }
}

struct TagStatRow: Codable, Identifiable, Hashable {
    let tagId: UUID
    let label: String
    let pointCount: Int
    let matchCount: Int

    var id: UUID { tagId }

    enum CodingKeys: String, CodingKey {
        case label
        case tagId = "tag_id"
        case pointCount = "point_count"
        case matchCount = "match_count"
    }
}

struct FocusPointRow: Codable, Identifiable, Hashable {
    let id: UUID
    let label: String
    let retiredAt: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, label
        case retiredAt = "retired_at"
        case createdAt = "created_at"
    }
}

struct EntryTagRow: Codable, Hashable {
    let lessonId: UUID
    let tagId: UUID

    enum CodingKeys: String, CodingKey {
        case lessonId = "lesson_id"
        case tagId = "tag_id"
    }
}

@Observable
final class JournalStore {
    var notes: [NoteFeedRow] = []
    var lessons: [LessonRow] = []
    var coachShared: [CoachSharedEntry] = []
    /// The player's own coaches (164), connected first. What the entry
    /// composer and the edit sheet pick from.
    var playerCoaches: [PlayerCoach] = []
    var tagStats: [TagStatRow] = []
    var entryTags: [EntryTagRow] = []
    var cues: [FocusPointRow] = []
    /// Whether the Recollect section shows. No preference row means
    /// enabled — the web reads it the same way.
    var recollectEnabled = true
    var loaded = false

    // MARK: - From your coach, seen or not

    /// The newest shared entry's stamp, once the journal has been opened,
    /// so Home can show a card only while something new is waiting.
    private static func coachSeenKey(_ userId: UUID) -> String {
        "pl.coachSeen.\(userId.uuidString.lowercased())"
    }

    var newestCoachShare: CoachSharedEntry? {
        coachShared.max { $0.sharedAt < $1.sharedAt }
    }

    func unseenCoachShare(userId: UUID?) -> CoachSharedEntry? {
        guard let userId, let newest = newestCoachShare else { return nil }
        let seen = UserDefaults.standard.string(forKey: Self.coachSeenKey(userId)) ?? ""
        return newest.sharedAt > seen ? newest : nil
    }

    func markCoachSharesSeen(userId: UUID?) {
        guard let userId, let newest = newestCoachShare else { return }
        UserDefaults.standard.set(newest.sharedAt, forKey: Self.coachSeenKey(userId))
    }

    func entryCount(for tagId: UUID) -> Int {
        entryTags.filter { $0.tagId == tagId }.count
    }

    /// The player's own coaches (164), connected first. Loaded with the
    /// journal, so the composer's picker is populated before it opens.
    func loadCoaches() async {
        let rows: [PlayerCoach]? = try? await supa
            .rpc("player_coaches_list").execute().value
        applyCoaches(rows ?? [])
    }

    /// Connected first, then invited, then offline; alphabetical inside
    /// each. The coach you are working with today is the one you are
    /// about to pick. Mirrors sortCoaches() on the web.
    private func applyCoaches(_ rows: [PlayerCoach]) {
        let rank = ["connected": 0, "invited": 1, "offline": 2]
        playerCoaches = rows.sorted {
            let a = rank[$0.status] ?? 3
            let b = rank[$1.status] ?? 3
            if a != b { return a < b }
            return $0.displayName.localizedCaseInsensitiveCompare($1.displayName)
                == .orderedAscending
        }
    }

    /// Find-or-create a coach by name. Typing a name that already exists
    /// has to resolve to that row: a second row for one person is the
    /// defect this whole feature exists to remove.
    func createCoach(named name: String) async -> PlayerCoach? {
        guard let userId = try? await supa.auth.session.user.id else { return nil }
        let clean = name
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .prefix(80)
        guard !clean.isEmpty else { return nil }
        if let existing = playerCoaches.first(where: {
            $0.displayName.trimmingCharacters(in: .whitespaces)
                .caseInsensitiveCompare(String(clean)) == .orderedSame
        }) { return existing }

        struct NewCoach: Encodable {
            let player_id: String
            let display_name: String
        }
        let inserted: [PlayerCoach]? = try? await supa
            .from("player_coaches")
            .insert(NewCoach(
                player_id: userId.uuidString.lowercased(),
                display_name: String(clean)
            ))
            .select("id,coach_id,display_name,invite_id")
            .execute().value
        guard let id = inserted?.first?.id else {
            // The insert returns a partial row; a full one comes from the
            // RPC, which is the only place status and the counts exist.
            await loadCoaches()
            return playerCoaches.first(where: {
                $0.displayName.caseInsensitiveCompare(String(clean)) == .orderedSame
            })
        }
        await loadCoaches()
        return playerCoaches.first(where: { $0.id == id })
    }

    var activeCues: [FocusPointRow] { cues.filter { $0.retiredAt == nil } }
    var retiredCues: [FocusPointRow] { cues.filter { $0.retiredAt != nil } }

    func load(userId: UUID?) async {
        struct FeedParams: Encodable { let p_limit: Int }
        async let notesQ: [NoteFeedRow]? = try? supa
            .rpc("note_feed", params: FeedParams(p_limit: 500))
            .execute().value
        // Coach entries live in the same table under kind 'coach'; they
        // belong to the coaching workspace, not this journal.
        async let lessonsQ: [LessonRow]? = try? supa
            .from("lessons")
            .select("id,user_id,transcript,takeaways,status,kind,coach_name,coach_ref_id,shared_with_coach_at,image_path,created_at")
            .neq("kind", value: "coach")
            .order("created_at", ascending: false)
            .execute().value
        async let coachSharedQ: [CoachSharedEntry]? = try? supa
            .rpc("coach_shared_entries")
            .execute().value
        async let coachesQ: [PlayerCoach]? = try? supa
            .rpc("player_coaches_list")
            .execute().value
        async let tagsQ: [TagStatRow]? = try? supa
            .rpc("tag_stats").execute().value
        async let cuesQ: [FocusPointRow]? = try? supa
            .from("focus_points")
            .select("id,label,retired_at,created_at")
            .order("created_at", ascending: true)
            .execute().value
        async let entryTagsQ: [EntryTagRow]? = try? supa
            .from("entry_tags")
            .select("lesson_id,tag_id")
            .execute().value
        struct RecollectPref: Decodable { let enabled: Bool }
        async let recollectQ: [RecollectPref]? = try? supa
            .from("recollect_preferences")
            .select("enabled")
            .execute().value

        let (n, l, t, c, e, r) = await (notesQ, lessonsQ, tagsQ, cuesQ, entryTagsQ, recollectQ)
        coachShared = (await coachSharedQ) ?? []
        applyCoaches((await coachesQ) ?? [])
        notes = n ?? []
        lessons = l ?? []
        tagStats = t ?? []
        cues = c ?? []
        entryTags = e ?? []
        recollectEnabled = r?.first?.enabled ?? true
        loaded = true
    }

    /// Merge a cue created elsewhere (Recollect's add) into local state,
    /// the way the web journal's mergeCue does.
    func mergeCue(_ row: FocusPointRow) {
        guard !cues.contains(where: { $0.id == row.id }) else { return }
        cues.append(row)
    }

    func addCue(userId: UUID, label: String) async -> String? {
        let clean = label.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return nil }
        if activeCues.contains(where: { $0.label.caseInsensitiveCompare(clean) == .orderedSame }) {
            return "Already on the list."
        }
        if activeCues.count >= 5 {
            return "The list is full. Tick something off first."
        }
        struct Insert: Encodable {
            let user_id: String
            let label: String
        }
        do {
            let row: FocusPointRow = try await supa
                .from("focus_points")
                .insert(Insert(user_id: userId.uuidString.lowercased(), label: clean))
                .select("id,label,retired_at,created_at")
                .single()
                .execute().value
            cues.append(row)
            return nil
        } catch {
            return "Couldn't save that. Try again."
        }
    }

    func retireCue(_ cue: FocusPointRow) async {
        let stamp = ISO8601DateFormatter().string(from: Date())
        _ = try? await supa
            .from("focus_points")
            .update(["retired_at": AnyJSON.string(stamp)])
            .eq("id", value: cue.id.uuidString.lowercased())
            .execute()
        if let i = cues.firstIndex(of: cue) {
            cues[i] = FocusPointRow(
                id: cue.id, label: cue.label, retiredAt: stamp, createdAt: cue.createdAt
            )
        }
    }

    func restoreCue(_ cue: FocusPointRow) async {
        _ = try? await supa
            .from("focus_points")
            .update(["retired_at": AnyJSON.null])
            .eq("id", value: cue.id.uuidString.lowercased())
            .execute()
        if let i = cues.firstIndex(of: cue) {
            cues[i] = FocusPointRow(
                id: cue.id, label: cue.label, retiredAt: nil, createdAt: cue.createdAt
            )
        }
    }

    /// Deletes a match or point note. Direct table delete like the web's,
    /// then a re-fetch to confirm the row is gone — an RLS-blocked delete
    /// returns cleanly with zero rows removed, and without the check that
    /// reads as success.
    func deleteNote(_ note: NoteFeedRow) async -> Bool {
        let id = note.id.uuidString.lowercased()
        do {
            try await supa.from("notes").delete().eq("id", value: id).execute()
        } catch {
            return false
        }
        struct Row: Decodable { let id: UUID }
        let leftover: [Row]? = try? await supa
            .from("notes").select("id").eq("id", value: id)
            .execute().value
        guard let leftover, leftover.isEmpty else { return false }
        notes.removeAll { $0.id == note.id }
        return true
    }

    func deleteLesson(_ lesson: LessonRow) async -> Bool {
        struct Req: Encodable { let entryId: String }
        struct Res: Decodable { let ok: Bool? }
        let res: Res? = try? await API.request(
            "api/journal-entry", method: "DELETE",
            body: Req(entryId: lesson.id.uuidString.lowercased())
        )
        if res != nil {
            lessons.removeAll { $0.id == lesson.id }
            return true
        }
        return false
    }

    /// Distil a transcript without saving it, so the recorder can show the
    /// notes before anyone commits to an entry.
    func previewTakeaways(transcript: String) async -> LessonTakeaways? {
        struct Req: Encodable {
            let transcript: String
            let kind = "lesson"
            let preview = true
        }
        struct Res: Decodable { let takeaways: LessonTakeaways? }
        let res: Res? = try? await API.post("api/lesson", Req(transcript: transcript))
        return res?.takeaways
    }

    /// Saves a NEW entry through /api/lesson so distillation and the
    /// Recollect side effects run — never a direct table write.
    ///
    /// Creating only. Correcting an existing entry goes through
    /// `saveNote` or `saveWords`, which is why there is no longer a
    /// lessonId here: POST with one is the route's re-distil retry, and
    /// running it over an entry somebody has hand-edited would quietly
    /// throw their edit away.
    func saveEntry(
        transcript: String, kind: String, coachName: String?, summarize: Bool,
        imagePath: String? = nil,
        coachRefId: UUID? = nil, shareWithCoach: Bool = false
    ) async -> Bool {
        struct Req: Encodable {
            let transcript: String
            let kind: String
            let coachName: String?
            let summarize: Bool
            // Already uploaded and checked by /api/entry-image; the route
            // re-checks it sits under this caller's own entry folder.
            let imagePath: String?
            // Which coach, as a row (164), and whether they may read it.
            let coachRefId: String?
            let shareWithCoach: Bool
        }
        struct Res: Decodable {
            let id: String?
            let status: String?
        }
        let req = Req(
            transcript: transcript, kind: kind, coachName: coachName,
            summarize: summarize, imagePath: imagePath,
            coachRefId: coachRefId?.uuidString.lowercased(),
            shareWithCoach: shareWithCoach
        )
        let res: Res? = try? await API.post("api/lesson", req)
        if res?.id != nil, coachRefId != nil { await loadCoaches() }
        return res?.id != nil
    }

    /// Saves a hand-edited note. Returns nil when it lands, or the
    /// sentence to show when it does not.
    ///
    /// This writes the note and nothing else. The words the note came
    /// from are not touched, so nothing is re-distilled and Recollect is
    /// left alone — it reads the transcript, and the transcript did not
    /// change.
    ///
    /// Applied locally first so the card behind the sheet is already
    /// right when it closes, then replaced with what the server stored:
    /// it trims and caps, and the card should show what is actually in
    /// the row rather than what was typed. A refusal puts the old row
    /// back.
    func saveNote(
        lesson: LessonRow, takeaways: LessonTakeaways, coachName: String?,
        photo: EntryPhotoSave = .unchanged,
        coachRefId: UUID? = nil, shareWithCoach: Bool = false
    ) async -> String? {
        struct Req: Encodable {
            let lessonId: String
            let takeaways: LessonTakeaways
            let coachName: String?
            let photo: EntryPhotoSave
            let coachRefId: UUID?
            let shareWithCoach: Bool

            enum CodingKeys: String, CodingKey {
                case lessonId, takeaways, coachName, imagePath
                case coachRefId, shareWithCoach
            }

            func encode(to encoder: Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encode(lessonId, forKey: .lessonId)
                try c.encode(takeaways, forKey: .takeaways)
                // Encoded even when nil, because null is how the coach's
                // name is cleared. The synthesised encoder would drop the
                // key entirely and the old name would survive the save.
                try c.encode(coachName, forKey: .coachName)
                // Same rule for the coach row: null is how an attribution
                // is removed, so the key is always written. The route
                // treats an ABSENT key as "leave it alone", which is what
                // keeps older app builds from clearing one.
                try c.encode(coachRefId?.uuidString.lowercased(), forKey: .coachRefId)
                try c.encode(shareWithCoach, forKey: .shareWithCoach)
                // The photo is the opposite: the key's ABSENCE is what
                // says "leave it alone", so it is written only when the
                // edit actually changed it.
                if case .set(let path) = photo {
                    try c.encode(path, forKey: .imagePath)
                }
            }
        }
        struct Res: Decodable {
            let id: String
            let takeaways: LessonTakeaways?
        }

        let previous = lesson
        // What the row will read once the trigger has had it: the name
        // comes from the coach row when there is one.
        let named = coachRefId.flatMap { id in
            playerCoaches.first(where: { $0.id == id })?.displayName
        } ?? coachName
        let sharedAt = shareWithCoach && coachRefId != nil
            ? (lesson.coachRefId == coachRefId ? lesson.sharedWithCoachAt : nil)
                ?? ISO8601DateFormatter().string(from: Date())
            : nil
        apply(lesson.withNote(
            takeaways, coachName: named,
            coachRefId: coachRefId, sharedWithCoachAt: sharedAt
        ))
        do {
            let res: Res = try await API.request(
                "api/lesson/note", method: "PATCH",
                body: Req(
                    lessonId: lesson.id.uuidString.lowercased(),
                    takeaways: takeaways, coachName: coachName, photo: photo,
                    coachRefId: coachRefId, shareWithCoach: shareWithCoach
                )
            )
            if let stored = res.takeaways {
                apply(lesson.withNote(
                    stored, coachName: named,
                    coachRefId: coachRefId, sharedWithCoachAt: sharedAt
                ))
            }
            await loadCoaches()
            return nil
        } catch {
            apply(previous)
            return (error as? APIError)?.errorDescription
                ?? "Couldn't save it. Your note is still here, so try again."
        }
    }

    /// Saves the words of an entry that never had a note. Returns nil when
    /// it lands, or the sentence to show when it does not.
    ///
    /// PATCH /api/lesson is now only for these. Condensing is sent off
    /// deliberately: the edit sheet does not ask the question, and an
    /// entry kept as plain words should not quietly turn into a written-up
    /// note because a correction pushed it past the length threshold.
    /// The kind is the row's own, carried across so the route does not
    /// default a practice entry into a lesson.
    func saveWords(
        lesson: LessonRow, transcript: String, coachName: String?,
        photo: EntryPhotoSave = .unchanged,
        coachRefId: UUID? = nil, shareWithCoach: Bool = false
    ) async -> String? {
        struct Req: Encodable {
            let lessonId: String
            let transcript: String
            let coachName: String?
            let summarize = false
            let photo: EntryPhotoSave
            let coachRefId: UUID?
            let shareWithCoach: Bool

            enum CodingKeys: String, CodingKey {
                case lessonId, transcript, coachName, summarize, imagePath
                case coachRefId, shareWithCoach
            }

            func encode(to encoder: Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encode(lessonId, forKey: .lessonId)
                try c.encode(transcript, forKey: .transcript)
                try c.encode(coachName, forKey: .coachName)
                try c.encode(summarize, forKey: .summarize)
                try c.encode(coachRefId?.uuidString.lowercased(), forKey: .coachRefId)
                try c.encode(shareWithCoach, forKey: .shareWithCoach)
                if case .set(let path) = photo {
                    try c.encode(path, forKey: .imagePath)
                }
            }
        }
        struct Res: Decodable { let id: String? }

        let previous = lesson
        let named = coachRefId.flatMap { id in
            playerCoaches.first(where: { $0.id == id })?.displayName
        } ?? coachName
        let sharedAt = shareWithCoach && coachRefId != nil
            ? (lesson.coachRefId == coachRefId ? lesson.sharedWithCoachAt : nil)
                ?? ISO8601DateFormatter().string(from: Date())
            : nil
        apply(lesson.withWords(
            transcript, coachName: named,
            coachRefId: coachRefId, sharedWithCoachAt: sharedAt
        ))
        do {
            let _: Res = try await API.request(
                "api/lesson", method: "PATCH",
                body: Req(
                    lessonId: lesson.id.uuidString.lowercased(),
                    transcript: transcript, coachName: coachName, photo: photo,
                    coachRefId: coachRefId, shareWithCoach: shareWithCoach
                )
            )
            await loadCoaches()
            return nil
        } catch {
            apply(previous)
            return (error as? APIError)?.errorDescription
                ?? "Couldn't save it. Your words are still here, so try again."
        }
    }

    /// Swap a row in the feed for a newer copy of itself.
    private func apply(_ row: LessonRow) {
        guard let i = lessons.firstIndex(where: { $0.id == row.id }) else { return }
        lessons[i] = row
    }
}

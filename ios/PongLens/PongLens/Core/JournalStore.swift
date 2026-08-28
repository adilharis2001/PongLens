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
    let imagePath: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, transcript, takeaways, status, kind
        case userId = "user_id"
        case coachName = "coach_name"
        case imagePath = "image_path"
        case createdAt = "created_at"
    }

    /// A copy carrying a hand-edited note. Everything else rides across
    /// untouched on purpose: editing a note writes the note and the
    /// coach's name, and must never disturb the words, the kind or the
    /// status.
    func withNote(_ takeaways: LessonTakeaways?, coachName: String?) -> LessonRow {
        LessonRow(
            id: id, userId: userId, transcript: transcript, takeaways: takeaways,
            status: status, kind: kind, coachName: coachName,
            imagePath: imagePath, createdAt: createdAt
        )
    }

    /// A copy carrying rewritten words. Only reachable for an entry that
    /// never had a note, where the words are the note.
    func withWords(_ transcript: String, coachName: String?) -> LessonRow {
        LessonRow(
            id: id, userId: userId, transcript: transcript, takeaways: takeaways,
            status: status, kind: kind, coachName: coachName,
            imagePath: imagePath, createdAt: createdAt
        )
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
    var tagStats: [TagStatRow] = []
    var entryTags: [EntryTagRow] = []
    var cues: [FocusPointRow] = []
    /// Whether the Recollect section shows. No preference row means
    /// enabled — the web reads it the same way.
    var recollectEnabled = true
    var loaded = false

    func entryCount(for tagId: UUID) -> Int {
        entryTags.filter { $0.tagId == tagId }.count
    }

    var activeCues: [FocusPointRow] { cues.filter { $0.retiredAt == nil } }
    var retiredCues: [FocusPointRow] { cues.filter { $0.retiredAt != nil } }

    func load(userId: UUID?) async {
        struct FeedParams: Encodable { let p_limit: Int }
        async let notesQ: [NoteFeedRow]? = try? supa
            .rpc("note_feed", params: FeedParams(p_limit: 500))
            .execute().value
        async let lessonsQ: [LessonRow]? = try? supa
            .from("lessons")
            .select("id,user_id,transcript,takeaways,status,kind,coach_name,image_path,created_at")
            .order("created_at", ascending: false)
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
        transcript: String, kind: String, coachName: String?, summarize: Bool
    ) async -> Bool {
        struct Req: Encodable {
            let transcript: String
            let kind: String
            let coachName: String?
            let summarize: Bool
        }
        struct Res: Decodable {
            let id: String?
            let status: String?
        }
        let req = Req(
            transcript: transcript, kind: kind, coachName: coachName, summarize: summarize
        )
        let res: Res? = try? await API.post("api/lesson", req)
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
        lesson: LessonRow, takeaways: LessonTakeaways, coachName: String?
    ) async -> String? {
        struct Req: Encodable {
            let lessonId: String
            let takeaways: LessonTakeaways
            let coachName: String?

            enum CodingKeys: String, CodingKey { case lessonId, takeaways, coachName }

            func encode(to encoder: Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encode(lessonId, forKey: .lessonId)
                try c.encode(takeaways, forKey: .takeaways)
                // Encoded even when nil, because null is how the coach's
                // name is cleared. The synthesised encoder would drop the
                // key entirely and the old name would survive the save.
                try c.encode(coachName, forKey: .coachName)
            }
        }
        struct Res: Decodable {
            let id: String
            let takeaways: LessonTakeaways?
        }

        let previous = lesson
        apply(lesson.withNote(takeaways, coachName: coachName))
        do {
            let res: Res = try await API.request(
                "api/lesson/note", method: "PATCH",
                body: Req(
                    lessonId: lesson.id.uuidString.lowercased(),
                    takeaways: takeaways, coachName: coachName
                )
            )
            if let stored = res.takeaways {
                apply(lesson.withNote(stored, coachName: coachName))
            }
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
    func saveWords(lesson: LessonRow, transcript: String, coachName: String?) async -> String? {
        struct Req: Encodable {
            let lessonId: String
            let transcript: String
            let kind: String
            let coachName: String?
            let summarize = false
        }
        struct Res: Decodable { let id: String? }

        let previous = lesson
        apply(lesson.withWords(transcript, coachName: coachName))
        do {
            let _: Res = try await API.request(
                "api/lesson", method: "PATCH",
                body: Req(
                    lessonId: lesson.id.uuidString.lowercased(),
                    transcript: transcript, kind: lesson.kind, coachName: coachName
                )
            )
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

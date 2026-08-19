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

    /// Saves a new entry (or edits) through /api/lesson so distillation and
    /// Recollect side effects run — never a direct table write.
    func saveEntry(
        transcript: String, kind: String, coachName: String?,
        summarize: Bool, editing: LessonRow?
    ) async -> Bool {
        struct Req: Encodable {
            let transcript: String
            let kind: String
            let coachName: String?
            let summarize: Bool
            let lessonId: String?
        }
        struct Res: Decodable {
            let id: String?
            let status: String?
        }
        let req = Req(
            transcript: transcript, kind: kind, coachName: coachName,
            summarize: summarize, lessonId: editing?.id.uuidString.lowercased()
        )
        let res: Res? = try? await API.request(
            "api/lesson", method: editing == nil ? "POST" : "PATCH", body: req
        )
        return res?.id != nil
    }
}

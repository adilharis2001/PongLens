import Foundation
import Supabase

/// One roster row. player_id empty means the student is not on PongLens
/// yet; the coach journals about them anyway, and an invite binds the row
/// to a real account later.
struct CoachStudentRow: Codable, Identifiable, Hashable {
    let id: UUID
    let coachId: UUID
    let playerId: UUID?
    var displayName: String
    let createdAt: String
    let archivedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case coachId = "coach_id"
        case playerId = "player_id"
        case displayName = "display_name"
        case createdAt = "created_at"
        case archivedAt = "archived_at"
    }

    var linked: Bool { playerId != nil }
}

/// The wrapper that makes a lessons row a coach entry: which student it is
/// about, and whether they can read it. The lesson row carries the words.
struct CoachEntryRow: Codable, Identifiable, Hashable {
    let id: UUID
    let coachId: UUID
    let studentId: UUID
    let lessonId: UUID
    let sharedAt: String?
    let createdAt: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case coachId = "coach_id"
        case studentId = "student_id"
        case lessonId = "lesson_id"
        case sharedAt = "shared_at"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

struct StudentInviteRow: Codable, Identifiable, Hashable {
    let id: UUID
    let coachId: UUID
    let studentId: UUID?
    let token: UUID
    let createdAt: String
    let revokedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, token
        case coachId = "coach_id"
        case studentId = "student_id"
        case createdAt = "created_at"
        case revokedAt = "revoked_at"
    }
}

/// The coaching workspace's data: roster, entries, and the lesson rows
/// behind them. Loaded when the workspace opens, refreshed after writes.
/// Matches shared by students stay in LibraryStore — RLS already delivers
/// them there — so this store only answers "whose is it".
@Observable
final class CoachWorkspaceStore {
    var students: [CoachStudentRow] = []
    var entries: [CoachEntryRow] = []
    /// Lesson content keyed by lesson id, for the entries above only.
    var lessons: [UUID: LessonRow] = [:]
    var loaded = false
    /// The roster query itself failed (offline, expired session). Screens
    /// say so rather than showing "No students yet." over a network error.
    var loadFailed = false

    var activeStudents: [CoachStudentRow] {
        students.filter { $0.archivedAt == nil }
    }

    func student(_ id: UUID) -> CoachStudentRow? {
        students.first { $0.id == id }
    }

    func entries(for studentId: UUID) -> [CoachEntryRow] {
        entries.filter { $0.studentId == studentId }
    }

    func lesson(for entry: CoachEntryRow) -> LessonRow? {
        lessons[entry.lessonId]
    }

    func load(userId: UUID?) async {
        guard let userId else { return }
        let uid = userId.uuidString.lowercased()

        async let studentsQ: [CoachStudentRow]? = try? await supa
            .from("coach_students")
            .select("id,coach_id,player_id,display_name,created_at,archived_at")
            .eq("coach_id", value: uid)
            .order("created_at", ascending: false)
            .execute().value
        async let entriesQ: [CoachEntryRow]? = try? await supa
            .from("coach_entries")
            .select("id,coach_id,student_id,lesson_id,shared_at,created_at,updated_at")
            .eq("coach_id", value: uid)
            .order("created_at", ascending: false)
            .execute().value
        async let lessonsQ: [LessonRow]? = try? await supa
            .from("lessons")
            .select("id,user_id,transcript,takeaways,status,kind,coach_name,image_path,match_id,created_at")
            .eq("kind", value: "coach")
            .order("created_at", ascending: false)
            .execute().value

        let (s, e, l) = await (studentsQ, entriesQ, lessonsQ)
        guard let s else {
            loadFailed = true
            return
        }
        loadFailed = false
        students = s
        entries = e ?? []
        lessons = Dictionary(uniqueKeysWithValues: (l ?? []).map { ($0.id, $0) })
        loaded = true
    }

    // MARK: - Roster

    func addStudent(coachId: UUID, name: String) async -> CoachStudentRow? {
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        guard !clean.isEmpty, clean.count <= 80 else { return nil }
        struct Insert: Encodable {
            let coach_id: String
            let display_name: String
        }
        let row: CoachStudentRow? = try? await supa
            .from("coach_students")
            .insert(Insert(coach_id: coachId.uuidString.lowercased(), display_name: clean))
            .select("id,coach_id,player_id,display_name,created_at,archived_at")
            .single()
            .execute().value
        if let row {
            students.insert(row, at: 0)
        }
        return row
    }

    func renameStudent(_ student: CoachStudentRow, to name: String) async -> Bool {
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        guard !clean.isEmpty, clean.count <= 80 else { return false }
        do {
            try await supa
                .from("coach_students")
                .update(["display_name": clean])
                .eq("id", value: student.id.uuidString.lowercased())
                .execute()
        } catch { return false }
        if let i = students.firstIndex(of: student) {
            students[i].displayName = clean
        }
        return true
    }

    /// Archive rather than delete: the entries under the student are the
    /// coach's own record and survive. remove_student (157) also revokes
    /// the coach's links to that player, so "removed" ends match access.
    /// A student who joined from the general invite link, folded into the
    /// row the coach had already typed (161): entries move, the typed name
    /// stays, the account binds to it, the joined row goes.
    func mergeStudent(_ from: CoachStudentRow, into target: CoachStudentRow, userId: UUID?) async -> Bool {
        struct Params: Encodable {
            let p_into: String
            let p_from: String
        }
        do {
            try await supa
                .rpc("merge_students", params: Params(
                    p_into: target.id.uuidString.lowercased(),
                    p_from: from.id.uuidString.lowercased()
                ))
                .execute()
        } catch { return false }
        await load(userId: userId)
        return true
    }

    func archiveStudent(_ student: CoachStudentRow) async -> Bool {
        struct Params: Encodable { let p_student_id: String }
        do {
            try await supa
                .rpc("remove_student", params: Params(p_student_id: student.id.uuidString.lowercased()))
                .execute()
        } catch { return false }
        students.removeAll { $0.id == student.id }
        return true
    }

    /// Turn off every live invite link for a student (or the general one),
    /// for a link that got forwarded too far. The next inviteURL call
    /// mints a fresh token.
    func revokeInvites(coachId: UUID, studentId: UUID?) async -> Bool {
        let stamp = ISO8601DateFormatter().string(from: Date())
        do {
            var query = try supa
                .from("coach_student_invites")
                .update(["revoked_at": AnyJSON.string(stamp)])
                .eq("coach_id", value: coachId.uuidString.lowercased())
            if let studentId {
                query = query.eq("student_id", value: studentId.uuidString.lowercased())
            } else {
                query = query.is("student_id", value: nil)
            }
            try await query.is("revoked_at", value: nil).execute()
        } catch { return false }
        return true
    }

    // MARK: - Invites

    /// The standing invite link for a student (or the general one when nil).
    /// Reuses a live token rather than minting a fresh one per tap, so a
    /// link already sent by text keeps working.
    func inviteURL(coachId: UUID, studentId: UUID?) async -> URL? {
        let uid = coachId.uuidString.lowercased()
        var query = supa
            .from("coach_student_invites")
            .select("id,coach_id,student_id,token,created_at,revoked_at")
            .eq("coach_id", value: uid)
        if let studentId {
            query = query.eq("student_id", value: studentId.uuidString.lowercased())
        } else {
            query = query.is("student_id", value: nil)
        }
        let existing: [StudentInviteRow]? = try? await query
            .is("revoked_at", value: nil)
            .limit(1)
            .execute().value
        if let row = existing?.first {
            return Self.joinURL(row.token)
        }

        struct Insert: Encodable {
            let coach_id: String
            let student_id: String?
        }
        let inserted: StudentInviteRow? = try? await supa
            .from("coach_student_invites")
            .insert(Insert(
                coach_id: uid,
                student_id: studentId?.uuidString.lowercased()
            ))
            .select("id,coach_id,student_id,token,created_at,revoked_at")
            .single()
            .execute().value
        guard let inserted else { return nil }
        return Self.joinURL(inserted.token)
    }

    private static func joinURL(_ token: UUID) -> URL? {
        AppConfig.apiBase.appending(path: "join/\(token.uuidString.lowercased())")
    }

    // MARK: - Entries

    /// Create an entry through /api/lesson so distillation runs, then wrap
    /// it for the student. Returns the new wrapper, or nil with nothing
    /// half-made: a lesson that fails to wrap is deleted again rather than
    /// left to leak into nobody's journal.
    func createEntry(
        coachId: UUID,
        studentId: UUID,
        transcript: String,
        summarize: Bool,
        matchId: UUID? = nil
    ) async -> CoachEntryRow? {
        struct Req: Encodable {
            let transcript: String
            let kind = "coach"
            let summarize: Bool
        }
        struct Res: Decodable { let id: String? }
        let res: Res? = try? await API.post(
            "api/lesson", Req(transcript: transcript, summarize: summarize)
        )
        guard let idString = res?.id, let lessonId = UUID(uuidString: idString) else {
            return nil
        }

        if let matchId {
            _ = try? await supa
                .from("lessons")
                .update(["match_id": matchId.uuidString.lowercased()])
                .eq("id", value: lessonId.uuidString.lowercased())
                .execute()
        }

        struct Wrap: Encodable {
            let coach_id: String
            let student_id: String
            let lesson_id: String
        }
        let wrapper: CoachEntryRow? = try? await supa
            .from("coach_entries")
            .insert(Wrap(
                coach_id: coachId.uuidString.lowercased(),
                student_id: studentId.uuidString.lowercased(),
                lesson_id: lessonId.uuidString.lowercased()
            ))
            .select("id,coach_id,student_id,lesson_id,shared_at,created_at,updated_at")
            .single()
            .execute().value
        guard let wrapper else {
            struct Del: Encodable { let entryId: String }
            struct DelRes: Decodable { let ok: Bool? }
            let _: DelRes? = try? await API.request(
                "api/journal-entry", method: "DELETE",
                body: Del(entryId: lessonId.uuidString.lowercased())
            )
            return nil
        }
        entries.insert(wrapper, at: 0)
        await reloadLesson(lessonId)
        return wrapper
    }

    /// Flip sharing. Sharing is a live grant: the student reads the
    /// current words, and edits after sharing show.
    func setShared(_ entry: CoachEntryRow, shared: Bool) async -> Bool {
        let stamp = shared ? AnyJSON.string(ISO8601DateFormatter().string(from: Date()))
                           : AnyJSON.null
        do {
            try await supa
                .from("coach_entries")
                .update(["shared_at": stamp])
                .eq("id", value: entry.id.uuidString.lowercased())
                .execute()
        } catch { return false }
        if let i = entries.firstIndex(of: entry) {
            entries[i] = CoachEntryRow(
                id: entry.id, coachId: entry.coachId, studentId: entry.studentId,
                lessonId: entry.lessonId,
                sharedAt: shared ? ISO8601DateFormatter().string(from: Date()) : nil,
                createdAt: entry.createdAt, updatedAt: entry.updatedAt
            )
        }
        return true
    }

    /// Delete the entry and its lesson row. The route owns lesson deletion
    /// (it also clears the entry photo, if one ever exists); the wrapper
    /// goes with the lesson by cascade.
    func deleteEntry(_ entry: CoachEntryRow) async -> Bool {
        struct Req: Encodable { let entryId: String }
        struct Res: Decodable { let ok: Bool? }
        let res: Res? = try? await API.request(
            "api/journal-entry", method: "DELETE",
            body: Req(entryId: entry.lessonId.uuidString.lowercased())
        )
        guard res != nil else { return false }
        entries.removeAll { $0.id == entry.id }
        lessons.removeValue(forKey: entry.lessonId)
        return true
    }

    /// Correct the words of an entry, through the same route the journal
    /// uses so trimming and caps match. Distillation is left alone.
    func saveWords(_ entry: CoachEntryRow, transcript: String) async -> String? {
        struct Req: Encodable {
            let lessonId: String
            let transcript: String
            let kind = "coach"
            let summarize = false
        }
        struct Res: Decodable { let id: String? }
        do {
            let _: Res = try await API.request(
                "api/lesson", method: "PATCH",
                body: Req(
                    lessonId: entry.lessonId.uuidString.lowercased(),
                    transcript: transcript
                )
            )
        } catch {
            return (error as? APIError)?.errorDescription
                ?? "Couldn't save it. Your words are still here, so try again."
        }
        await reloadLesson(entry.lessonId)
        return nil
    }

    /// Link (or unlink) one of the student's matches to an entry.
    func setMatch(_ entry: CoachEntryRow, matchId: UUID?) async -> Bool {
        let value = matchId.map { AnyJSON.string($0.uuidString.lowercased()) } ?? AnyJSON.null
        do {
            try await supa
                .from("lessons")
                .update(["match_id": value])
                .eq("id", value: entry.lessonId.uuidString.lowercased())
                .execute()
        } catch { return false }
        await reloadLesson(entry.lessonId)
        return true
    }

    private func reloadLesson(_ id: UUID) async {
        let row: LessonRow? = try? await supa
            .from("lessons")
            .select("id,user_id,transcript,takeaways,status,kind,coach_name,image_path,match_id,created_at")
            .eq("id", value: id.uuidString.lowercased())
            .single()
            .execute().value
        if let row { lessons[row.id] = row }
    }

    // MARK: - Public entry link

    /// Find or mint the public link for an entry's lesson, the same
    /// share_links row the web journal mints. Client-side idempotency:
    /// read the live link first, insert otherwise; the partial unique
    /// index settles a race by refusing the second insert, and the retry
    /// read below picks the winner up.
    func entryLinkURL(owner: UUID, entry: CoachEntryRow, title: String?) async -> URL? {
        struct LinkRow: Decodable { let token: String }
        let existing: [LinkRow]? = try? await supa
            .from("share_links")
            .select("token")
            .eq("kind", value: "entry")
            .eq("lesson_id", value: entry.lessonId.uuidString.lowercased())
            .is("revoked_at", value: nil)
            .limit(1)
            .execute().value
        if let token = existing?.first?.token {
            return AppConfig.apiBase.appending(path: "s/\(token)")
        }

        struct Insert: Encodable {
            let owner: String
            let kind = "entry"
            let lesson_id: String
            let token: String
            let title: String?
        }
        let token = UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: "")
        let inserted: LinkRow? = try? await supa
            .from("share_links")
            .insert(Insert(
                owner: owner.uuidString.lowercased(),
                lesson_id: entry.lessonId.uuidString.lowercased(),
                token: token,
                title: title
            ))
            .select("token")
            .single()
            .execute().value
        if let inserted {
            return AppConfig.apiBase.appending(path: "s/\(inserted.token)")
        }
        // Lost a race, or the insert was refused: read once more.
        let retry: [LinkRow]? = try? await supa
            .from("share_links")
            .select("token")
            .eq("kind", value: "entry")
            .eq("lesson_id", value: entry.lessonId.uuidString.lowercased())
            .is("revoked_at", value: nil)
            .limit(1)
            .execute().value
        guard let token = retry?.first?.token else { return nil }
        return AppConfig.apiBase.appending(path: "s/\(token)")
    }
}

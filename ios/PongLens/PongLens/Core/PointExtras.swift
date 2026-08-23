import Foundation
import Supabase

// The point sheet's supporting cast: tags, the owner's custom loss-reason
// pills, and the Modify modal's split/join/adjust machinery — each a direct
// port of the web's writes (MatchView.tsx, modifyOps.ts) so the two apps can
// never disagree about what an edit does to the data.

struct TagRow: Codable, Identifiable, Hashable {
    let id: UUID
    let label: String
}

struct PointTagRow: Codable, Hashable {
    let pointId: UUID
    let tagId: UUID

    enum CodingKeys: String, CodingKey {
        case pointId = "point_id"
        case tagId = "tag_id"
    }
}

struct CustomReason: Codable, Identifiable, Hashable {
    let id: String
    let label: String
}

/// Tags for one match's points, plus the owner's vocabulary (recent-first).
@Observable
final class TagsStore {
    var vocab: [TagRow] = []
    var pointTags: [PointTagRow] = []
    var loaded = false

    func load(ownerId: UUID, pointIds: [UUID]) async {
        do {
            vocab = try await supa
                .from("tags")
                .select("id,label")
                .eq("owner_id", value: ownerId.uuidString.lowercased())
                .order("created_at", ascending: false)
                .execute()
                .value
            if !pointIds.isEmpty {
                pointTags = try await supa
                    .from("point_tags")
                    .select("point_id,tag_id")
                    .in("point_id", values: pointIds.map { $0.uuidString.lowercased() })
                    .execute()
                    .value
            }
        } catch {
            // Tags stay empty; the picker still lets you create one.
        }
        loaded = true
    }

    func tags(for pointId: UUID) -> [TagRow] {
        let ids = Set(pointTags.filter { $0.pointId == pointId }.map(\.tagId))
        return vocab.filter { ids.contains($0.id) }
    }

    /// Optimistic toggle with rollback, the web's exact write pair.
    func toggle(pointId: UUID, tag: TagRow, userId: UUID) async {
        let applied = pointTags.contains { $0.pointId == pointId && $0.tagId == tag.id }
        if applied {
            pointTags.removeAll { $0.pointId == pointId && $0.tagId == tag.id }
            do {
                try await supa.from("point_tags").delete()
                    .eq("point_id", value: pointId.uuidString.lowercased())
                    .eq("tag_id", value: tag.id.uuidString.lowercased())
                    .execute()
            } catch {
                pointTags.append(PointTagRow(pointId: pointId, tagId: tag.id))
            }
        } else {
            pointTags.append(PointTagRow(pointId: pointId, tagId: tag.id))
            struct Insert: Encodable {
                let point_id: String
                let tag_id: String
                let created_by: String
            }
            do {
                try await supa.from("point_tags")
                    .insert(Insert(
                        point_id: pointId.uuidString.lowercased(),
                        tag_id: tag.id.uuidString.lowercased(),
                        created_by: userId.uuidString.lowercased()
                    ))
                    .execute()
            } catch {
                pointTags.removeAll { $0.pointId == pointId && $0.tagId == tag.id }
            }
        }
    }

    /// Create in the owner's vocabulary and apply. A concurrent create of
    /// the same label hits the unique index — adopt the winner's row.
    func create(pointId: UUID, label: String, ownerId: UUID, userId: UUID) async {
        let clean = String(label.trimmingCharacters(in: .whitespacesAndNewlines).prefix(40))
        guard !clean.isEmpty else { return }
        if let existing = vocab.first(where: { $0.label.lowercased() == clean.lowercased() }) {
            await toggle(pointId: pointId, tag: existing, userId: userId)
            return
        }
        struct Insert: Encodable {
            let owner_id: String
            let label: String
        }
        var tag: TagRow?
        do {
            tag = try await supa.from("tags")
                .insert(Insert(owner_id: ownerId.uuidString.lowercased(), label: clean))
                .select("id,label")
                .single()
                .execute()
                .value
        } catch {
            tag = try? await supa.from("tags")
                .select("id,label")
                .eq("owner_id", value: ownerId.uuidString.lowercased())
                .ilike("label", pattern: clean)
                .single()
                .execute()
                .value
        }
        guard let tag else { return }
        if !vocab.contains(where: { $0.id == tag.id }) {
            vocab.insert(tag, at: 0)
        }
        await toggle(pointId: pointId, tag: tag, userId: userId)
    }
}

/// The owner's own "why I lost it" pills (loss_reason_labels, 060) —
/// owner-keyed like tags, stored on points as "custom:<uuid>".
@Observable
final class CustomReasonsStore {
    var reasons: [CustomReason] = []
    var loaded = false

    func load(ownerId: UUID) async {
        do {
            reasons = try await supa
                .from("loss_reason_labels")
                .select("id,label")
                .eq("owner_id", value: ownerId.uuidString.lowercased())
                .order("created_at", ascending: true)
                .execute()
                .value
        } catch {
            // The built-ins still render.
        }
        loaded = true
    }

    /// Returns the pill's id, existing or created; nil when it can't save.
    func create(label: String, ownerId: UUID) async -> String? {
        let clean = normalizeCustomReasonLabel(label)
        guard !clean.isEmpty else { return nil }
        if let existing = reasons.first(where: { $0.label.lowercased() == clean.lowercased() }) {
            return existing.id
        }
        struct Insert: Encodable {
            let owner_id: String
            let label: String
        }
        var row: CustomReason?
        do {
            row = try await supa.from("loss_reason_labels")
                .insert(Insert(owner_id: ownerId.uuidString.lowercased(), label: clean))
                .select("id,label")
                .single()
                .execute()
                .value
        } catch {
            row = try? await supa.from("loss_reason_labels")
                .select("id,label")
                .eq("owner_id", value: ownerId.uuidString.lowercased())
                .ilike("label", pattern: clean)
                .single()
                .execute()
                .value
        }
        guard let row else { return nil }
        if !reasons.contains(where: { $0.id == row.id }) {
            reasons.append(row)
        }
        return row.id
    }
}

// MARK: - Modify (split / join / adjust) — modifyOps.ts port

extension MatchDetailModel {
    /// Split ONE point into segments at the given CUT-video marker times.
    /// Markers map to source at_t through the span anchor; split_point runs
    /// sequentially down the tail. Children are born edited with tight ends.
    func runSplit(_ point: MatchPoint, pad: ClipPad, cutTimes: [Double]) async -> Bool {
        guard let cutT0 = point.cutT0, let t0 = point.t0, let t1 = point.t1 else {
            return false
        }
        let eff = effectivePad(pad, tightStart: point.tightStart, tightEnd: point.tightEnd)
        let anchor = max(0, t0 - eff.pre)

        var ats: [Double] = []
        var floor = t0 + SPLIT_EDGE_S
        let ceil = t1 - SPLIT_EDGE_S
        for T in cutTimes.map({ anchor + ($0 - cutT0) }).sorted() {
            let v = (min(ceil, max(floor, T)) * 100).rounded() / 100
            if v >= ceil { break }
            ats.append(v)
            floor = v + SPLIT_EDGE_S
        }
        guard !ats.isEmpty else { return false }

        var parentId = point.id
        for at in ats {
            let childCutT0 = ((cutT0 + (at - min(pad.pre, TIGHT_PAD)) - anchor) * 100).rounded() / 100
            struct Params: Encodable {
                let p_id: String
                let at_t: Double
                let child_cut_t0: Double
            }
            do {
                let child: MatchPoint = try await supa
                    .rpc("split_point", params: Params(
                        p_id: parentId.uuidString.lowercased(),
                        at_t: at, child_cut_t0: childCutT0
                    ))
                    .execute()
                    .value
                if let i = points.firstIndex(where: { $0.id == parentId }) {
                    points[i].t1 = at
                    points[i].edited = true
                    points[i].tightEnd = true
                }
                points.append(child)
                parentId = child.id
            } catch {
                return false
            }
        }
        await enqueueReclip(point.matchId)
        return true
    }

    /// Join this point with the next `count` visible points. merge_points
    /// keeps the survivor and hard-deletes the rest — the one Modify action
    /// that cannot be undone.
    func runJoin(_ point: MatchPoint, count: Int) async -> Bool {
        guard let i = visible.firstIndex(where: { $0.id == point.id }) else { return false }
        let nexts = visible.dropFirst(i + 1)
            .filter { $0.cutT0 != nil && $0.t1 != nil }
            .prefix(count)
        guard nexts.count == count else { return false }
        let ids = [point.id] + nexts.map(\.id)
        struct Params: Encodable { let p_ids: [String] }
        do {
            let survivor: MatchPoint = try await supa
                .rpc("merge_points", params: Params(p_ids: ids.map { $0.uuidString.lowercased() }))
                .execute()
                .value
            if let j = points.firstIndex(where: { $0.id == point.id }) {
                points[j].t1 = survivor.t1 ?? point.t1
                points[j].tightEnd = false
                points[j].edited = true
            }
            let mergedIds = Set(nexts.map(\.id))
            points.removeAll { mergedIds.contains($0.id) }
            await enqueueReclip(point.matchId)
            return true
        } catch {
            return false
        }
    }

    /// The Adjust save: new t0/t1, a manually re-timed split edge dissolving
    /// its tight flag so the reclip pads it with full context again.
    func runAdjust(_ point: MatchPoint, t0New: Double, t1New: Double) async -> Bool {
        // NOT `edited`. The client has no UPDATE grant on that column (the
        // grants are column-scoped) and Postgres refuses the whole statement
        // when one column in it is out of bounds — so sending it turned
        // every Adjust into a silent 403 that saved nothing at all. The
        // `points_mark_edited` trigger sets it on any t0/t1 change anyway,
        // which is why the web never sent it either.
        var fields: [String: AnyJSON] = [
            "t0": .double(t0New), "t1": .double(t1New),
        ]
        var dropTightStart = false
        var dropTightEnd = false
        if point.tightStart, t0New != point.t0 {
            fields["tight_start"] = .bool(false)
            dropTightStart = true
        }
        if point.tightEnd, t1New != point.t1 {
            fields["tight_end"] = .bool(false)
            dropTightEnd = true
        }
        guard let i = points.firstIndex(where: { $0.id == point.id }) else { return false }
        let before = points[i]
        points[i].t0 = t0New
        points[i].t1 = t1New
        points[i].edited = true
        if dropTightStart { points[i].tightStart = false }
        if dropTightEnd { points[i].tightEnd = false }
        do {
            try await supa.from("points").update(fields)
                .eq("id", value: point.id.uuidString.lowercased())
                .execute()
            await enqueueReclip(point.matchId)
            return true
        } catch {
            points[i] = before
            return false
        }
    }

    /// One 'reclip' job per match: skip when one is already queued.
    func enqueueReclip(_ matchId: UUID) async {
        guard let uid = try? await supa.auth.session.user.id else { return }
        struct JobId: Decodable { let id: UUID }
        let queued: [JobId]? = try? await supa
            .from("jobs")
            .select("id")
            .eq("kind", value: "reclip")
            .eq("status", value: "queued")
            .eq("options->>match_id", value: matchId.uuidString.lowercased())
            .limit(1)
            .execute()
            .value
        if let queued, !queued.isEmpty { return }
        struct Insert: Encodable {
            let user_id: String
            let kind: String
            let options: [String: String]
        }
        _ = try? await supa.from("jobs")
            .insert(Insert(
                user_id: uid.uuidString.lowercased(),
                kind: "reclip",
                options: ["match_id": matchId.uuidString.lowercased()]
            ))
            .execute()
    }

    /// Bulk "delete everything before this point" — warm-up rallies.
    func deleteBefore(_ point: MatchPoint) async {
        let earlier = visible.prefix(while: { $0.id != point.id })
        guard !earlier.isEmpty else { return }
        let ids = earlier.map(\.id)
        for id in ids {
            if let i = points.firstIndex(where: { $0.id == id }) {
                points[i].deleted = true
            }
        }
        do {
            try await supa.from("points")
                .update(["deleted": true])
                .in("id", values: ids.map { $0.uuidString.lowercased() })
                .execute()
        } catch {
            for id in ids {
                if let i = points.firstIndex(where: { $0.id == id }) {
                    points[i].deleted = false
                }
            }
        }
    }
}

// MARK: - Note media (transcribe + annotated frame)

enum NoteMedia {
    struct TranscribeResult: Decodable {
        let audio_path: String
        let transcript: String?
    }

    /// Voice note: upload the recording, get back its storage path and a
    /// transcript to drop into the composer (the web's /api/transcribe).
    static func transcribe(audio: Data) async throws -> TranscribeResult {
        try await API.postMultipart(
            "api/transcribe", field: "audio", filename: "note.mp4",
            mime: "audio/mp4", data: audio
        )
    }

    struct ImageResult: Decodable { let image_path: String }

    /// Annotated frame: upload the drawn-over JPEG, get its storage path.
    static func uploadImage(_ jpeg: Data) async throws -> String {
        let res: ImageResult = try await API.postMultipart(
            "api/note-image", field: "image", filename: "frame.jpg",
            mime: "image/jpeg", data: jpeg
        )
        return res.image_path
    }

    /// Signed URL for a note's audio or annotated image.
    static func url(matchId: UUID, noteId: UUID, image: Bool) async -> URL? {
        struct Req: Encodable {
            let matchId: String
            let noteId: String
            var image: Bool?
        }
        struct Res: Decodable { let url: String? }
        let res: Res? = try? await API.post("api/media-url", Req(
            matchId: matchId.uuidString.lowercased(),
            noteId: noteId.uuidString.lowercased(),
            image: image ? true : nil
        ))
        return res?.url.flatMap(URL.init)
    }
}

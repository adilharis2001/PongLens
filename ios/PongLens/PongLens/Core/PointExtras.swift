import Foundation
import Supabase

/// Which way a Join reaches: into the points before this one, or after.
enum JoinDirection { case previous, next }

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

/// One split_point call, and everything it takes to reverse it. The web's
/// UnsplitRecord, carrying the child row as well because iOS scores it.
struct SplitChild {
    let parentId: UUID
    let child: MatchPoint
    let prevT1: Double
    let prevTightEnd: Bool
    let prevEdited: Bool
}

// MARK: - Modify (split / join / adjust) — modifyOps.ts port

extension MatchDetailModel {
    /// Split ONE point into segments at the given CUT-video marker times.
    /// Markers map to source at_t through the span anchor; split_point runs
    /// sequentially down the tail. Children are born edited with tight ends.
    ///
    /// Returns the rows it created, newest last, so a caller can go on to
    /// score one of them or reverse the cut. Empty means nothing was split.
    @discardableResult
    func runSplit(
        _ point: MatchPoint, pad: ClipPad, cutTimes: [Double],
        outcomes: [WinnerOrSkip]? = nil
    ) async -> [SplitChild] {
        guard let cutT0 = point.cutT0, let t0 = point.t0, let t1 = point.t1 else {
            return []
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
        guard !ats.isEmpty else { return [] }

        let childCutT0s = ats.map {
            ((cutT0 + ($0 - min(pad.pre, TIGHT_PAD)) - anchor) * 100).rounded() / 100
        }
        let canonicalOutcomes: [String]
        if let outcomes {
            canonicalOutcomes = outcomes.map { value in
                switch value {
                case .user: return "user"
                case .opponent: return "opponent"
                case .skip: return "other"
                }
            }
        } else {
            let first = point.confirmedWinner?.rawValue ?? (point.isLet ? "other" : "clear")
            canonicalOutcomes = [first] + Array(repeating: "clear", count: ats.count)
        }

        let result = await canonicalCommand(
            "split_point_v2",
            args: [
                "p_parent_id": .uuid(point.id),
                "p_split_times": .array(ats.map(CanonicalJSON.number)),
                "p_child_cut_t0s": .array(childCutT0s.map(CanonicalJSON.number)),
                "p_outcomes": .array(canonicalOutcomes.map(CanonicalJSON.string)),
            ]
        ) {
            var created: [SplitChild] = []
            var parentId = point.id
            var prevTightEnd = point.tightEnd
            var prevEdited = point.edited
            for (offset, at) in ats.enumerated() {
                struct Params: Encodable {
                    let p_id: String
                    let at_t: Double
                    let child_cut_t0: Double
                }
                do {
                    let child: MatchPoint = try await supa.rpc(
                        "split_point",
                        params: Params(
                            p_id: parentId.uuidString.lowercased(),
                            at_t: at,
                            child_cut_t0: childCutT0s[offset])).execute().value
                    if let i = points.firstIndex(where: { $0.id == parentId }) {
                        points[i].t1 = at
                        points[i].edited = true
                        points[i].tightEnd = true
                    }
                    points.append(child)
                    created.append(SplitChild(
                        parentId: parentId, child: child, prevT1: t1,
                        prevTightEnd: prevTightEnd, prevEdited: prevEdited))
                    parentId = child.id
                    prevTightEnd = point.tightEnd
                    prevEdited = true
                } catch { return created }
            }
            return created
        }
        switch result {
        case .legacy(let created):
            if !created.isEmpty { Task { await recutOnDevice(matchId: point.matchId, pad: pad) } }
            return created
        case .canonical(let response):
            guard let rows: [MatchPoint] = decodeCanonicalPayload(response, key: "points"),
                  rows.count == ats.count + 1
            else { return [] }
            let ordered = rows.sorted { ($0.t0 ?? 0) < ($1.t0 ?? 0) }
            let children = Array(ordered.dropFirst())
            points.removeAll { row in ordered.contains(where: { $0.id == row.id }) }
            points.append(contentsOf: ordered)
            if let requestId = response.requestId {
                for child in children { canonicalSplitRequestByChild[child.id] = requestId }
            }
            Task { await recutOnDevice(matchId: point.matchId, pad: pad) }
            return children.enumerated().map { offset, child in
                SplitChild(
                    parentId: ordered[offset].id, child: child, prevT1: t1,
                    prevTightEnd: point.tightEnd,
                    prevEdited: offset == 0 ? point.edited : true)
            }
        case .conflict(let snapshot):
            reconcileCanonical(snapshot)
            return []
        case .rejected, .transportError:
            return []
        }
    }

    /// Reverse one split_point call: hard-delete the child and put the
    /// parent's end back, atomically (unsplit_point, migration 026).
    func runUnsplit(
        parentId: UUID, childId: UUID, prevT1: Double,
        prevTightEnd: Bool, prevEdited: Bool, matchId: UUID, pad: ClipPad
    ) async -> Bool {
        struct Params: Encodable {
            let p_parent: String
            let p_child: String
            let parent_t1: Double
            let parent_tight_end: Bool
            let parent_edited: Bool
        }
        let splitRequest = canonicalSplitRequestByChild[childId]
        let legacyUnsplit: () async -> Bool = {
            do {
                try await supa.rpc("unsplit_point", params: Params(
                    p_parent: parentId.uuidString.lowercased(),
                    p_child: childId.uuidString.lowercased(),
                    parent_t1: prevT1,
                    parent_tight_end: prevTightEnd,
                    parent_edited: prevEdited)).execute()
                return true
            } catch { return false }
        }
        let result: CanonicalScoreExecution<Bool>
        if let splitRequest {
            result = await canonicalCommand(
                "unsplit_point_v2",
                args: ["p_split_request_id": .uuid(splitRequest)],
                legacy: legacyUnsplit)
        } else {
            // A split made by an older build has no canonical request id;
            // retain its exact established undo instead of fabricating one.
            result = .legacy(await legacyUnsplit())
        }
        switch result {
        case .legacy(false), .rejected, .transportError: return false
        case .conflict(let snapshot):
            reconcileCanonical(snapshot)
            return false
        case .legacy(true):
            if let i = points.firstIndex(where: { $0.id == parentId }) {
                points[i].t1 = prevT1
                points[i].tightEnd = prevTightEnd
                points[i].edited = true
            }
            points.removeAll { $0.id == childId }
        case .canonical(let response):
            guard let restored: MatchPoint = decodeCanonicalPayload(response, key: "point"),
                  let removed: [UUID] = decodeCanonicalPayload(response, key: "removedPointIds")
            else { return false }
            let removedIds = Set(removed)
            points.removeAll { removedIds.contains($0.id) }
            if let i = points.firstIndex(where: { $0.id == restored.id }) {
                points[i] = restored
            } else { points.append(restored) }
            for id in removed { canonicalSplitRequestByChild[id] = nil }
        }
        Task { await recutOnDevice(matchId: matchId, pad: pad) }
        return true
    }

    /// Join this point with the next `count` visible points. merge_points
    /// keeps the survivor and hard-deletes the rest — the one Modify action
    /// that cannot be undone.
    /// The visible points a Join in `direction` would swallow, nearest
    /// first, at most two. The sheet sizes its stepper and its preview from
    /// this and the write builds the merge from it, so the two cannot
    /// disagree about which rows are on the table.
    func joinNeighbours(_ point: MatchPoint, direction: JoinDirection) -> [MatchPoint] {
        guard let i = visible.firstIndex(where: { $0.id == point.id }) else { return [] }
        let ok: (MatchPoint) -> Bool = { $0.cutT0 != nil && $0.t0 != nil && $0.t1 != nil }
        switch direction {
        case .next: return Array(visible.dropFirst(i + 1).filter(ok).prefix(2))
        case .previous: return Array(visible.prefix(i).filter(ok).suffix(2).reversed())
        }
    }

    /// Merge this point with `count` neighbours in `direction`. Returns the
    /// survivor — the earliest point of the run, which joining backwards
    /// makes one of the NEIGHBOURS, with this point among the rows that go.
    func runJoin(
        _ point: MatchPoint, pad: ClipPad, count: Int, direction: JoinDirection,
        outcome: WinnerOrSkip? = nil
    ) async -> MatchPoint? {
        let neighbours = Array(joinNeighbours(point, direction: direction).prefix(count))
        guard neighbours.count == count else { return nil }
        // merge_points keeps the FIRST id, so the run goes in timeline order.
        let run: [MatchPoint] = direction == .next
            ? [point] + neighbours
            : Array(neighbours.reversed()) + [point]
        let ids = run.map(\.id)
        let requestedOutcome: String = {
            if let outcome {
                switch outcome {
                case .user: return "user"
                case .opponent: return "opponent"
                case .skip: return "other"
                }
            }
            return run[0].confirmedWinner?.rawValue ?? (run[0].isLet ? "other" : "clear")
        }()
        struct Params: Encodable { let p_ids: [String] }
        let legacyJoin: () async -> MatchPoint? = {
            do {
                let survivor: MatchPoint = try await supa.rpc(
                    "merge_points",
                    params: Params(p_ids: ids.map { $0.uuidString.lowercased() })).execute().value
                return survivor
            } catch { return nil }
        }
        let result = await canonicalCommand(
            "merge_points_v2",
            args: [
                "p_point_ids": .array(ids.map(CanonicalJSON.uuid)),
                "p_outcome": .string(requestedOutcome),
            ],
            legacy: legacyJoin)
        let survivor: MatchPoint
        switch result {
        case .legacy(let row): guard let row else { return nil }; survivor = row
        case .canonical(let response):
            guard let rows: [MatchPoint] = decodeCanonicalPayload(response, key: "points"),
                  let row = rows.first(where: { $0.id == ids[0] })
            else { return nil }
            survivor = row
        case .conflict(let snapshot):
            reconcileCanonical(snapshot)
            return nil
        case .rejected, .transportError: return nil
        }
        do {
            let survivorId = ids[0]
            if let j = points.firstIndex(where: { $0.id == survivorId }) {
                points[j] = survivor
            }
            let mergedIds = Set(ids.dropFirst())
            points.removeAll { mergedIds.contains($0.id) }
            Task { await recutOnDevice(matchId: point.matchId, pad: pad) }
            return points.first(where: { $0.id == survivorId })
        }
    }

    /// Add a card for a rally the cut missed.
    ///
    /// insert_point (101) does it all in one statement: creates the card,
    /// trims each neighbour only where the new window overlapped it, and
    /// clears the serve corrections after it — an insert changes the
    /// rotation from here on, so a correction downstream was answering a
    /// rotation that no longer exists.
    ///
    /// The rotation needs nothing else: it is a COUNT of cards, so
    /// restoring the beat fixes who served every later point, the score,
    /// the deuce switch and the game boundaries at once.
    func runInsert(
        prev: MatchPoint?, next: MatchPoint?, pad: ClipPad,
        t0: Double, t1: Double, cutT0: Double,
        winner: Winner?
    ) async -> Bool {
        guard let matchId = prev?.matchId ?? next?.matchId else { return false }
        struct Params: Encodable {
            let p_prev_id: String?
            let p_next_id: String?
            let p_t0: Double
            let p_t1: Double
            let p_cut_t0: Double
        }
        let legacyInsert: () async -> MatchPoint? = {
            do {
                let created: MatchPoint = try await supa.rpc(
                    "insert_point",
                    params: Params(
                        p_prev_id: prev?.id.uuidString.lowercased(),
                        p_next_id: next?.id.uuidString.lowercased(),
                        p_t0: t0, p_t1: t1, p_cut_t0: cutT0)).execute().value
                return created
            } catch { return nil }
        }
        let result = await canonicalCommand(
            "insert_point_v2",
            args: [
                "p_previous_point_id": prev.map { .uuid($0.id) } ?? .null,
                "p_next_point_id": next.map { .uuid($0.id) } ?? .null,
                "p_t0": .number(t0),
                "p_t1": .number(t1),
                "p_cut_t0": .number(cutT0),
                "p_outcome": .string(winner?.rawValue ?? "clear"),
            ],
            legacy: legacyInsert)
        let created: MatchPoint
        let outcomeApplied: Bool
        switch result {
        case .legacy(let row):
            guard let row else { return false }
            created = row
            outcomeApplied = false
        case .canonical(let response):
            guard let createdId: UUID = decodeCanonicalPayload(response, key: "pointId"),
                  let rows: [MatchPoint] = decodeCanonicalPayload(response, key: "points"),
                  let row = rows.first(where: { $0.id == createdId })
            else { return false }
            created = row
            outcomeApplied = true
        case .conflict(let snapshot):
            reconcileCanonical(snapshot)
            return false
        case .rejected, .transportError: return false
        }
        do {
            points.append(created)
            // Mirror what the RPC did to the neighbours and to any stale
            // corrections, so the strip is truthful before any refetch.
            // The trimmed edge is a split boundary now (insert_point marks
            // it tight, so the re-cut keeps 0.3s past the new card instead
            // of a full pad of it), and a moved start moves the cut anchor.
            if let prev, let pt1 = prev.t1, pt1 > t0,
               let j = points.firstIndex(where: { $0.id == prev.id }) {
                points[j].t1 = t0
                points[j].edited = true
                points[j].tightEnd = true
            }
            if let next, let nt0 = next.t0, nt0 < t1,
               let j = points.firstIndex(where: { $0.id == next.id }) {
                points[j].cutT0 = reanchorCutT0(
                    cutT0: next.cutT0, t0: next.t0, tightStart: next.tightStart,
                    tightEnd: next.tightEnd, t0New: t1, tightStartNew: true,
                    pad: pad)
                points[j].t0 = t1
                points[j].edited = true
                points[j].tightStart = true
            }
            for j in points.indices where points[j].serverOverride != nil {
                if let pt0 = points[j].t0, pt0 > t0, points[j].id != created.id {
                    points[j].serverOverride = nil
                }
            }
            if let winner, !outcomeApplied {
                _ = await setOutcome(
                    created, winner == .user ? .user : .opponent)
            }
            // The phone cuts what the cut video holds (a card on a
            // continuous seam, the trimmed neighbours); a card whose
            // footage was cut from the match video is the worker's, from
            // the original.
            Task { await recutOnDevice(matchId: matchId, pad: pad) }
            return true
        }
    }

    /// The Adjust save, through adjust_point: it dissolves the tight flag
    /// on a moved edge, re-anchors cut_t0 so the point's place in the cut
    /// video moves with its start, and clears the observed endings when the
    /// end moved. The optimistic mirror applies the same rules (the pad is
    /// right before the row returns); the returned row is the truth. The
    /// re-cut is requested by a database trigger, never from here.
    func runAdjust(_ point: MatchPoint, pad: ClipPad, t0New: Double, t1New: Double) async -> Bool {
        guard let i = points.firstIndex(where: { $0.id == point.id }) else { return false }
        let before = points[i]
        let tightStartNew = point.tightStart && t0New != point.t0 ? false : point.tightStart
        let tightEndNew = point.tightEnd && t1New != point.t1 ? false : point.tightEnd
        points[i].t0 = t0New
        points[i].t1 = t1New
        points[i].edited = true
        points[i].tightStart = tightStartNew
        points[i].tightEnd = tightEndNew
        points[i].cutT0 = reanchorCutT0(
            cutT0: point.cutT0, t0: point.t0, tightStart: point.tightStart,
            tightEnd: point.tightEnd, t0New: t0New, tightStartNew: tightStartNew,
            pad: pad)
        if t1New != point.t1 {
            points[i].scoredAtCutS = nil
            points[i].rallyEndCutS = nil
        }
        struct Params: Encodable {
            let p_id: String
            let p_t0: Double
            let p_t1: Double
        }
        let legacyAdjust: () async -> MatchPoint? = {
            do {
                let row: MatchPoint = try await supa.rpc(
                    "adjust_point",
                    params: Params(
                        p_id: point.id.uuidString.lowercased(),
                        p_t0: t0New, p_t1: t1New)).execute().value
                return row
            } catch { return nil }
        }
        let result = await canonicalCommand(
            "adjust_point_v2",
            args: [
                "p_point_id": .uuid(point.id),
                "p_t0": .number(t0New),
                "p_t1": .number(t1New),
                "p_tight_start": .bool(tightStartNew),
                "p_tight_end": .bool(tightEndNew),
                "p_scored_at_cut_s": .null,
                "p_rally_end_cut_s": .null,
            ],
            legacy: legacyAdjust)
        let row: MatchPoint
        switch result {
        case .legacy(let value): guard let value else { points[i] = before; return false }; row = value
        case .canonical(let response):
            guard let value: MatchPoint = decodeCanonicalPayload(response, key: "point")
            else { points[i] = before; return false }
            row = value
        case .conflict(let snapshot):
            points[i] = before
            reconcileCanonical(snapshot)
            return false
        case .rejected, .transportError:
            points[i] = before
            return false
        }
        do {
            if let j = points.firstIndex(where: { $0.id == point.id }) {
                points[j].t0 = row.t0
                points[j].t1 = row.t1
                points[j].cutT0 = row.cutT0
                points[j].tightStart = row.tightStart
                points[j].tightEnd = row.tightEnd
                points[j].edited = row.edited
                points[j].scoredAtCutS = row.scoredAtCutS
                points[j].rallyEndCutS = row.rallyEndCutS
            }
            Task { await recutOnDevice(matchId: point.matchId, pad: pad) }
            return true
        }
    }

    // Re-cuts are requested by a database trigger (points_request_reclip)
    // whenever a row ends up edited and not deleted — never from here. The
    // client insert this replaced was silent on failure and, on a
    // mid-sequence split error, was never reached at all.

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
        if canonicalCommandsEnabled {
            for id in ids {
                guard let current = points.first(where: { $0.id == id }) else { continue }
                // The optimistic batch above already hid every row. The
                // helper is still the one revisioned persistence path.
                if !(await setPointVisibility(current, visible: false)) {
                    if let i = points.firstIndex(where: { $0.id == id }) {
                        points[i].deleted = false
                    }
                }
            }
            return
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
        // Deepgram does the transcribing: permission first.
        guard await AiConsent.shared.ensure() else { throw AiConsent.Declined() }
        return try await API.postMultipart(
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

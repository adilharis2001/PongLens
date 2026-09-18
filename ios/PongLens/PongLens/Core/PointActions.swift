import Foundation
import Supabase

/// The three-way outcome the scorecard's "Who won this point?" offers.
enum WinnerOrSkip { case user, opponent, skip }

// The point detail view's write surface — all column-scoped patches,
// optimistic with rollback, mirroring PointScorecard.tsx's writes.
extension MatchDetailModel {
    @discardableResult
    func saveCanonicalOutcome(
        _ point: MatchPoint,
        winner: Winner?,
        confirmedHow: String?,
        isLet: Bool,
        scoredAt: Double? = nil
    ) async -> Bool {
        guard let index = points.firstIndex(where: { $0.id == point.id }) else { return false }
        let before = points[index]
        points[index].confirmedWinner = winner
        points[index].confirmedHow = confirmedHow
        points[index].isLet = isLet
        points[index].scoredAtCutS = winner == nil ? nil : scoredAt
        let skipKind = canonicalSkipCommandKind(confirmedHow)
        let outcome = winner?.rawValue ?? (isLet ? skipKind : "clear")
        let result = await canonicalCommand(
            "set_point_outcome_v2",
            args: [
                "p_point_id": .uuid(point.id),
                "p_outcome": .string(outcome),
                "p_confirmed_how": isLet
                    ? .string(skipKind)
                    : (confirmedHow.map(CanonicalJSON.string) ?? .null),
                "p_scored_at_cut_s": winner == nil
                    ? .null
                    : (scoredAt.map(CanonicalJSON.number) ?? .null),
            ]
        ) {
            do {
                try await supa.from("points").update([
                    "confirmed_winner": winner.map { .string($0.rawValue) } ?? .null,
                    "confirmed_how": confirmedHow.map(AnyJSON.string) ?? .null,
                    "is_let": .bool(isLet),
                ] as [String: AnyJSON])
                .eq("id", value: point.id.uuidString.lowercased()).execute()
                return true
            } catch { return false }
        }
        switch result {
        case .canonical: return true
        case .legacy(let saved):
            if !saved { points[index] = before }
            return saved
        case .conflict(let snapshot):
            reconcileCanonical(snapshot)
            return true
        case .rejected, .transportError:
            points[index] = before
            return false
        }
    }

    /// Set (or clear, with nil) a point's serve correction.
    ///
    /// set_server_override (migration 100) writes the anchor AND clears
    /// every correction after it, in one statement. The rotation anchors to
    /// the most recent override before each point, so a stale correction
    /// further down the match used to win over this one and quietly undo it
    /// from there on. Corrections BEFORE this one stand: they anchor a
    /// stretch this one does not speak for.
    func setServerOverride(_ point: MatchPoint, _ side: Winner?) async {
        struct Params: Encodable {
            let p_id: String
            let p_value: String?
        }
        // The clear is mirrored locally as well as written, or the chips
        // downstream keep showing a correction that is already gone.
        let restore = points.map { ($0.id, $0.serverOverride) }
        var doomed: Set<UUID> = []
        if let at = visible.firstIndex(where: { $0.id == point.id }) {
            doomed = Set(
                visible[(at + 1)...]
                    .filter { $0.serverOverride != nil }
                    .map(\.id)
            )
        }
        for i in points.indices {
            if points[i].id == point.id {
                points[i].serverOverride = side
            } else if doomed.contains(points[i].id) {
                points[i].serverOverride = nil
            }
        }
        let result = await canonicalCommand(
            "set_server_override_v2",
            args: [
                "p_point_id": .uuid(point.id),
                "p_server": side.map { .string($0.rawValue) } ?? .null,
            ]
        ) {
            do {
                _ = try await supa.rpc("set_server_override", params: Params(
                    p_id: point.id.uuidString.lowercased(),
                    p_value: side?.rawValue)).execute()
                return true
            } catch { return false }
        }
        switch result {
        case .canonical, .legacy(true): break
        case .conflict(let snapshot):
            for (id, was) in restore {
                if let i = points.firstIndex(where: { $0.id == id }) {
                    points[i].serverOverride = was
                }
            }
            reconcileCanonical(snapshot)
        case .legacy(false), .rejected, .transportError:
            for (id, was) in restore {
                if let i = points.firstIndex(where: { $0.id == id }) {
                    points[i].serverOverride = was
                }
            }
        }
    }

    /// Loss reasons are multi-select. A follow-up cannot outlive the reason
    /// that asked it: dropping a reason clears its follow-up in the same
    /// pass, the web toggleLossReason's exact contract.
    @discardableResult
    func toggleReason(_ point: MatchPoint, _ value: String) async -> Bool {
        var reasons = point.lossReasons ?? []
        if reasons.contains(value) {
            reasons.removeAll { $0 == value }
        } else {
            reasons.append(value)
        }
        let payload = reasons
        // null rather than [] when empty, so "unanswered" and "answered
        // with nothing" stay one shape in the data.
        let ok = await patch(
            point,
            fields: ["loss_reasons": payload.isEmpty ? .null : .array(payload.map { .string($0) })]
        ) {
            $0.lossReasons = payload.isEmpty ? nil : payload
        }
        guard ok, let current = points.first(where: { $0.id == point.id }) else { return ok }
        if !misreadKindApplies(payload), current.misreadKind != nil {
            await setMisreadKind(current, nil)
        }
        if !outOfPositionApplies(payload), current.direction != nil {
            await setDirection(current, nil)
        }
        if !serveApplies(payload),
           current.serveSpin != nil || current.serveSidespin == true || current.serveLength != nil {
            await clearServeDetail(current)
        }
        return ok
    }

    /// One write for the serve trio going away together.
    func clearServeDetail(_ point: MatchPoint) async {
        await patch(point, fields: [
            "serve_spin": .null, "serve_sidespin": .null, "serve_length": .null,
        ]) {
            $0.serveSpin = nil
            $0.serveSidespin = nil
            $0.serveLength = nil
        }
    }

    /// The web pickOutcome: tapping the confirmed outcome clears it; a
    /// point that stops being a loss drops its reasons, and a skip drops
    /// the serve detail. One atomic write per change.
    @discardableResult
    func pickOutcome(_ point: MatchPoint, _ next: WinnerOrSkip) async -> Bool {
        let confirmed: WinnerOrSkip? = point.isLet
            ? .skip
            : point.confirmedWinner.map { $0 == .user ? .user : .opponent }
        if next == confirmed {
            let ok = await saveCanonicalOutcome(
                point, winner: nil, confirmedHow: nil, isLet: false)
            if ok, let current = points.first(where: { $0.id == point.id }) {
                if current.serveSpin != nil || current.serveSidespin == true || current.serveLength != nil {
                    await clearServeDetail(current)
                }
                if !(current.lossReasons ?? []).isEmpty {
                    await patch(current, fields: ["loss_reasons": .null]) { $0.lossReasons = nil }
                }
            }
            return ok
        }
        let nextHow = next == .skip ? canonicalSkipReason(point.confirmedHow) : ""
        let ok = await saveCanonicalOutcome(
            point,
            winner: next == .skip ? nil : (next == .user ? .user : .opponent),
            confirmedHow: nextHow.isEmpty ? nil : nextHow,
            isLet: next == .skip,
            scoredAt: next == .skip ? nil : point.scoredAtCutS)
        if ok, let current = points.first(where: { $0.id == point.id }) {
            if next != .opponent, !(current.lossReasons ?? []).isEmpty {
                await patch(current, fields: ["loss_reasons": .null]) { $0.lossReasons = nil }
            }
            if next == .skip,
               current.serveSpin != nil || current.serveSidespin == true || current.serveLength != nil {
                await clearServeDetail(current)
            }
        }
        return ok
    }

    /// Hand a point an outcome outright, with no toggle.
    ///
    /// The pad's buttons toggle on purpose: tapping the answer a point
    /// already carries takes it back. Splitting does not work that way. It
    /// hands each new segment the outcome its picker was showing, and the
    /// first segment's picker opens on the answer the parent already had —
    /// so routing that through the toggle CLEARED it, and splitting a
    /// scored point quietly unscored its first half.
    @discardableResult
    func setOutcome(_ point: MatchPoint, _ next: WinnerOrSkip) async -> Bool {
        let confirmed: WinnerOrSkip? = point.isLet
            ? .skip
            : point.confirmedWinner.map { $0 == .user ? .user : .opponent }
        guard next != confirmed else { return true }
        return await pickOutcome(point, next)
    }

    /// Skip reasons write confirmed_how on the is_let partition.
    @discardableResult
    func setSkipReason(_ point: MatchPoint, _ value: String?) async -> Bool {
        await saveCanonicalOutcome(
            point, winner: nil, confirmedHow: value, isLet: true)
    }

    /// Spin and "No spin"/sidespin are mutually exclusive — the web's
    /// pickServeSpin: choosing "none" drops sidespin, and vice versa.
    func pickServeSpin(_ point: MatchPoint, _ value: String) async {
        let nextSpin = point.serveSpin == value ? nil : value
        let nextSide = nextSpin == "none" ? false : (point.serveSidespin ?? false)
        await patch(point, fields: [
            "serve_spin": nextSpin.map { .string($0) } ?? .null,
            "serve_sidespin": nextSide ? .bool(true) : .null,
        ]) {
            $0.serveSpin = nextSpin
            $0.serveSidespin = nextSide ? true : nil
        }
    }

    func toggleServeSidespin(_ point: MatchPoint) async {
        let nextSide = !(point.serveSidespin ?? false)
        let nextSpin = nextSide && point.serveSpin == "none" ? nil : point.serveSpin
        await patch(point, fields: [
            "serve_sidespin": nextSide ? .bool(true) : .null,
            "serve_spin": nextSpin.map { .string($0) } ?? .null,
        ]) {
            $0.serveSidespin = nextSide ? true : nil
            $0.serveSpin = nextSpin
        }
    }

    func setMisreadKind(_ point: MatchPoint, _ value: String?) async {
        await patch(point, fields: ["misread_kind": value.map { .string($0) } ?? .null]) {
            $0.misreadKind = value
        }
    }

    func setDirection(_ point: MatchPoint, _ value: String?) async {
        await patch(point, fields: ["direction": value.map { .string($0) } ?? .null]) {
            $0.direction = value
        }
    }

    func setServeSpin(_ point: MatchPoint, _ value: String?) async {
        await patch(point, fields: ["serve_spin": value.map { .string($0) } ?? .null]) {
            $0.serveSpin = value
        }
    }

    func setServeSidespin(_ point: MatchPoint, _ value: Bool) async {
        await patch(point, fields: ["serve_sidespin": .bool(value)]) {
            $0.serveSidespin = value
        }
    }

    func setServeLength(_ point: MatchPoint, _ value: String?) async {
        await patch(point, fields: ["serve_length": value.map { .string($0) } ?? .null]) {
            $0.serveLength = value
        }
    }

    func togglePlacementFlag(_ point: MatchPoint) async {
        let next = !(point.placementFlagged ?? false)
        await patch(point, fields: ["placement_flagged": .bool(next)]) {
            $0.placementFlagged = next
        }
    }

    /// The Why fast lane's single answer. Replaces rather than toggles: the
    /// overlay is single-select by design, and its one tap is also the exit.
    func setLossReasons(_ point: MatchPoint, _ values: [String]) async {
        await patch(
            point,
            fields: ["loss_reasons": .array(values.map { .string($0) })]
        ) {
            $0.lossReasons = values
        }
    }

    /// Name the winner of a game the score cannot prove (099). A pinned end
    /// at 10-7 — points lost to a cut — decides nothing, so Keep score asks
    /// and stores the answer on the closing point. Passing nil clears it,
    /// which is how tapping the named side again un-names it.
    func setGameWinner(_ point: MatchPoint, _ winner: Winner?) async {
        await saveBoundary(point, boundary: point.gameEndOverride, winner: winner)
    }

    /// One button, web semantics: the label names what the tap DOES.
    /// Reopening an end clears the named winner in the same write.
    func setBoundary(_ point: MatchPoint, next: GameEndOverride?) async {
        await saveBoundary(
            point, boundary: next,
            winner: next == .end ? point.gameWinnerOverride : nil)
    }

    private func saveBoundary(
        _ point: MatchPoint,
        boundary: GameEndOverride?,
        winner: Winner?
    ) async {
        guard let index = points.firstIndex(where: { $0.id == point.id }) else { return }
        let before = points[index]
        let fields: [String: AnyJSON] = [
            "game_end_override": boundary.map { .string($0.rawValue) } ?? .null,
            "game_winner_override": winner.map { .string($0.rawValue) } ?? .null,
        ]
        points[index].gameEndOverride = boundary
        points[index].gameWinnerOverride = winner
        let result = await canonicalCommand(
            "set_game_boundary_v2",
            args: [
                "p_point_id": .uuid(point.id),
                "p_boundary": boundary.map { .string($0.rawValue) } ?? .null,
                "p_game_winner": winner.map { .string($0.rawValue) } ?? .null,
                "p_previous_point_id": .null,
            ]
        ) {
            do {
                try await supa.from("points").update(fields)
                    .eq("id", value: point.id.uuidString.lowercased()).execute()
                return true
            } catch { return false }
        }
        switch result {
        case .canonical, .legacy(true): break
        case .conflict(let snapshot):
            points[index] = before
            reconcileCanonical(snapshot)
        case .legacy(false), .rejected, .transportError:
            points[index] = before
        }
    }

    /// Hide the detected side-change marker that sits after this point
    /// (146). Display only, and deliberately NOT a 'continue' override:
    /// that suppresses the automatic 11-clear-by-2 rule from here on,
    /// which is a real change to the score. Saying "they just changed
    /// ends" must cost the owner nothing.
    func dismissSideChange(_ point: MatchPoint) async {
        await patch(point, fields: ["side_change_dismissed": .bool(true)]) {
            $0.sideChangeDismissed = true
        }
    }
}

/// Notes for one match, plus author display names.
@Observable
final class NotesStore {
    var notes: [NoteRow] = []
    var authorNames: [UUID: String] = [:]
    var loaded = false
    /// The demo match, read by anyone but its owner. A note written there
    /// goes into the list and nowhere else: the database would refuse it,
    /// and an error where a person expected a note is a worse
    /// demonstration than a note that does not outlive the visit. The
    /// composer says so under the box before they type.
    var demo = false

    func load(matchId: UUID) async {
        do {
            notes = try await supa
                .from("notes")
                .select("id,match_id,point_id,author_id,body,audio_path,image_path,created_at")
                .eq("match_id", value: matchId.uuidString.lowercased())
                .order("created_at", ascending: true)
                .execute()
                .value
            let authors: [NoteAuthor] = try await supa
                .rpc("match_note_authors", params: ["p_match_id": matchId.uuidString.lowercased()])
                .execute()
                .value
            authorNames = Dictionary(
                uniqueKeysWithValues: authors.compactMap { a in
                    a.name.map { (a.authorId, $0) }
                }
            )
        } catch {
            // The section shows its empty state; a retry comes with refresh.
        }
        loaded = true
    }

    func add(
        matchId: UUID, pointId: UUID?, authorId: UUID, body: String,
        audioPath: String? = nil, imagePath: String? = nil
    ) async -> Bool {
        struct Insert: Encodable {
            let match_id: String
            let point_id: String?
            let author_id: String
            let body: String
            let audio_path: String?
            let image_path: String?
        }
        if demo {
            notes.append(NoteRow(
                id: UUID(),
                matchId: matchId,
                pointId: pointId,
                authorId: authorId,
                body: body,
                audioPath: nil,
                imagePath: imagePath,
                createdAt: ISO8601DateFormatter().string(from: Date())
            ))
            return true
        }
        do {
            let inserted: NoteRow = try await supa
                .from("notes")
                .insert(Insert(
                    match_id: matchId.uuidString.lowercased(),
                    point_id: pointId?.uuidString.lowercased(),
                    author_id: authorId.uuidString.lowercased(),
                    body: body,
                    audio_path: audioPath,
                    image_path: imagePath
                ))
                .select("id,match_id,point_id,author_id,body,audio_path,image_path,created_at")
                .single()
                .execute()
                .value
            notes.append(inserted)
            return true
        } catch {
            return false
        }
    }

    /// Own-note edit — local-first, the DB is the truth on next load.
    func edit(_ note: NoteRow, body: String) async -> Bool {
        guard let i = notes.firstIndex(where: { $0.id == note.id }) else { return false }
        let before = notes[i]
        notes[i].body = body
        // The demo's notes were never written, so there is no row to edit.
        if demo { return true }
        do {
            try await supa.from("notes").update(["body": body])
                .eq("id", value: note.id.uuidString.lowercased())
                .execute()
            return true
        } catch {
            notes[i] = before
            return false
        }
    }

    func delete(_ note: NoteRow) async -> Bool {
        guard let i = notes.firstIndex(where: { $0.id == note.id }) else { return false }
        let removed = notes.remove(at: i)
        if demo { return true }
        do {
            try await supa.from("notes").delete()
                .eq("id", value: note.id.uuidString.lowercased())
                .execute()
            return true
        } catch {
            notes.insert(removed, at: min(i, notes.count))
            return false
        }
    }

    /// Notes per point, for the count glyphs on the timeline cards.
    func count(for pointId: UUID) -> Int {
        notes.count { $0.pointId == pointId }
    }
}

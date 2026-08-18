import Foundation
import Supabase

/// The three-way outcome the scorecard's "Who won this point?" offers.
enum WinnerOrSkip { case user, opponent, skip }

// The point detail view's write surface — all column-scoped patches,
// optimistic with rollback, mirroring PointScorecard.tsx's writes.
extension MatchDetailModel {
    func setServerOverride(_ point: MatchPoint, _ side: Winner) async {
        await patch(point, fields: ["server_override": .string(side.rawValue)]) {
            $0.serverOverride = side
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
            let ok = await patch(point, fields: [
                "confirmed_winner": .null, "confirmed_how": .null, "is_let": .bool(false),
            ]) {
                $0.confirmedWinner = nil
                $0.confirmedHow = nil
                $0.isLet = false
            }
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
        let ok = await patch(point, fields: [
            "confirmed_winner": next == .skip
                ? .null
                : .string(next == .user ? Winner.user.rawValue : Winner.opponent.rawValue),
            "confirmed_how": nextHow.isEmpty ? .null : .string(nextHow),
            "is_let": .bool(next == .skip),
        ]) {
            $0.confirmedWinner = next == .skip ? nil : (next == .user ? .user : .opponent)
            $0.confirmedHow = nextHow.isEmpty ? nil : nextHow
            $0.isLet = next == .skip
        }
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

    /// Skip reasons write confirmed_how on the is_let partition.
    @discardableResult
    func setSkipReason(_ point: MatchPoint, _ value: String?) async -> Bool {
        await patch(point, fields: [
            "confirmed_winner": .null,
            "confirmed_how": value.map { .string($0) } ?? .null,
            "is_let": .bool(true),
        ]) {
            $0.confirmedWinner = nil
            $0.confirmedHow = value
            $0.isLet = true
        }
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

    /// One button, web semantics: the label names what the tap DOES.
    /// Reopening an end clears the named winner in the same write.
    func setBoundary(_ point: MatchPoint, next: GameEndOverride?) async {
        var fields: [String: AnyJSON] = [
            "game_end_override": next.map { .string($0.rawValue) } ?? .null
        ]
        if next != .end {
            fields["game_winner_override"] = .null
        }
        await patch(point, fields: fields) {
            $0.gameEndOverride = next
            if next != .end { $0.gameWinnerOverride = nil }
        }
    }
}

/// The game-boundary control's offer for one point (gameScore.ts port):
/// the label names what the tap does, never what is true.
func boundaryAction(
    override: GameEndOverride?, walkEndsHere: Bool
) -> (label: String, next: GameEndOverride?) {
    let endsHere = override == .end ? true : override == .continue ? false : walkEndsHere
    if endsHere {
        return ("Didn't end", override == .end ? nil : .continue)
    }
    return ("Game ended", override == .continue ? nil : .end)
}

/// Notes for one match, plus author display names.
@Observable
final class NotesStore {
    var notes: [NoteRow] = []
    var authorNames: [UUID: String] = [:]
    var loaded = false

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

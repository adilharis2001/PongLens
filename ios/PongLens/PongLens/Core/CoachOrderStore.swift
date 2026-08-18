import Foundation
import Supabase
import UniformTypeIdentifiers

/// Everything one order's workspace needs, loaded with the same queries
/// the web's [id]/page.tsx runs, and the writes CoachOrder.tsx makes.
@Observable
final class CoachOrderStore {
    let orderId: UUID

    var detail: ReviewOrderDetail?
    var messages: [ReviewMessageRow] = []
    var sections: [ReviewSectionContent] = []
    var findings: [ReviewFindingRow] = []
    var attachments: [ReviewAttachmentRow] = []
    var match: MatchRow?
    var points: [WorkspacePoint] = []
    var sponsored = false
    var loaded = false

    var docSaving = false
    var docSaved = false
    var sectionNote: String?
    var undoSections: [ReviewSectionContent]?
    var answeredQuestions: [AnsweredQuestion] = []

    private var links: [LinkRow] = []
    private var saveTask: Task<Void, Never>?

    struct AnsweredQuestion: Decodable, Hashable {
        let question: String
        let covered: Bool
    }

    private struct LinkRow: Codable, Hashable {
        let finding_id: UUID
        let point_id: UUID
    }

    init(orderId: UUID) {
        self.orderId = orderId
    }

    var viewerId: UUID? { supa.auth.currentSession?.user.id }

    private var idString: String { orderId.uuidString.lowercased() }

    // MARK: - Load

    func load() async {
        struct DetailParams: Encodable { let p_order_id: String }
        let detailRow: ReviewOrderDetail? = try? await supa
            .rpc("review_order_detail", params: DetailParams(p_order_id: idString))
            .execute().value
        detail = detailRow
        guard let detailRow else {
            loaded = true
            return
        }

        let working = detailRow.status == .inReview || detailRow.status == .clarification
        let delivered = detailRow.status == .delivered || detailRow.status == .completed

        async let messagesQ: [ReviewMessageRow]? = try? await supa
            .from("review_messages").select("*")
            .eq("order_id", value: idString)
            .order("created_at", ascending: true)
            .execute().value

        struct FundingRow: Decodable { let funding: String? }
        async let fundingQ: FundingRow? = try? await supa
            .from("review_orders").select("funding")
            .eq("id", value: idString).single().execute().value

        let (m, funding) = await (messagesQ, fundingQ)
        messages = m ?? []
        sponsored = funding?.funding == "sponsored"

        if working || delivered {
            struct DocRow: Decodable {
                let sections: [ReviewSectionContent]
                let status: String
            }
            async let docQ: DocRow? = try? await supa
                .from("review_documents").select("sections, status")
                .eq("order_id", value: idString).single().execute().value
            async let findingsQ: [ReviewFindingRow]? = try? await supa
                .from("review_findings").select("*")
                .eq("order_id", value: idString)
                .order("sort", ascending: true)
                .order("created_at", ascending: true)
                .execute().value
            async let attachmentsQ: [ReviewAttachmentRow]? = try? await supa
                .from("review_attachments").select("*")
                .eq("order_id", value: idString)
                .order("created_at", ascending: true)
                .execute().value
            let (doc, f, a) = await (docQ, findingsQ, attachmentsQ)
            findings = f ?? []
            attachments = a ?? []
            // The saved document wins; otherwise the offering's snapshotted
            // section headings, empty, ready to type into.
            if let saved = doc?.sections, !saved.isEmpty {
                sections = saved
            } else if sections.isEmpty {
                sections = detailRow.reviewSections.map {
                    ReviewSectionContent(key: $0.key, label: $0.label, body: "")
                }
            }
            if !findings.isEmpty {
                let ids = findings.map { $0.id.uuidString.lowercased() }
                let linkRows: [LinkRow]? = try? await supa
                    .from("review_finding_points").select("finding_id, point_id")
                    .in("finding_id", values: ids).execute().value
                links = linkRows ?? []
            }
        }

        if let matchId = detailRow.matchId {
            let mid = matchId.uuidString.lowercased()
            async let matchQ: MatchRow? = try? await supa
                .from("matches").select(MatchRow.librarySelect)
                .eq("id", value: mid).single().execute().value
            async let pointsQ: [WorkspacePoint]? = try? await supa
                .from("points").select(WorkspacePoint.workspaceSelect)
                .eq("match_id", value: mid)
                .order("idx", ascending: true)
                .execute().value
            let (mt, pts) = await (matchQ, pointsQ)
            match = mt
            // Ranked display numbers, matching the match page (idx skips
            // deleted points there too).
            points = (pts ?? []).filter { $0.deleted != true }
                .enumerated().map { i, p in
                    var p = p
                    p.idx = i
                    return p
                }
        }
        loaded = true
    }

    // MARK: - Point links

    func pointIds(for findingId: UUID) -> [UUID] {
        let linked = Set(links.filter { $0.finding_id == findingId }.map(\.point_id))
        return points.filter { linked.contains($0.id) }.map(\.id)
    }

    func pointNumbers(for findingId: UUID) -> [Int] {
        let linked = Set(links.filter { $0.finding_id == findingId }.map(\.point_id))
        return points.filter { linked.contains($0.id) }.map { $0.idx + 1 }
    }

    func pointNumber(for pointId: UUID) -> Int? {
        points.first(where: { $0.id == pointId }).map { $0.idx + 1 }
    }

    func togglePoint(findingId: UUID, pointId: UUID) async {
        if links.contains(where: { $0.finding_id == findingId && $0.point_id == pointId }) {
            await removePoint(findingId: findingId, pointId: pointId)
        } else {
            await addPoint(findingId: findingId, pointId: pointId)
        }
    }

    func addPoint(findingId: UUID, pointId: UUID) async {
        let row = LinkRow(finding_id: findingId, point_id: pointId)
        guard !links.contains(row) else { return }
        links.append(row)
        do {
            try await supa.from("review_finding_points").insert(row).execute()
        } catch {
            links.removeAll { $0 == row }
        }
    }

    func removePoint(findingId: UUID, pointId: UUID) async {
        let row = LinkRow(finding_id: findingId, point_id: pointId)
        links.removeAll { $0 == row }
        _ = try? await supa.from("review_finding_points").delete()
            .eq("finding_id", value: findingId.uuidString.lowercased())
            .eq("point_id", value: pointId.uuidString.lowercased())
            .execute()
    }

    // MARK: - Findings

    /// Insert with sort = current count; ties break on created_at, same as
    /// the web. Returns the row so the editor can keep it open.
    func createFinding(
        title: String, body: String, audioPath: String?, imagePath: String?,
        imagePointId: UUID?, pointIds: [UUID]
    ) async -> ReviewFindingRow? {
        struct Insert: Encodable {
            let order_id: String
            let title: String
            let body: String
            let audio_path: String?
            let image_path: String?
            let image_point_id: String?
            let sort: Int
        }
        do {
            let row: ReviewFindingRow = try await supa.from("review_findings")
                .insert(Insert(
                    order_id: idString,
                    title: title, body: body,
                    audio_path: audioPath, image_path: imagePath,
                    image_point_id: imagePointId?.uuidString.lowercased(),
                    sort: findings.count
                ))
                .select("*").single().execute().value
            findings.append(row)
            for pointId in pointIds {
                await addPoint(findingId: row.id, pointId: pointId)
            }
            return row
        } catch {
            return nil
        }
    }

    func updateFinding(
        _ id: UUID, title: String, body: String, audioPath: String?,
        imagePath: String?, imagePointId: UUID?
    ) async -> Bool {
        let fields: [String: AnyJSON] = [
            "title": .string(title),
            "body": .string(body),
            "audio_path": audioPath.map { .string($0) } ?? .null,
            "image_path": imagePath.map { .string($0) } ?? .null,
            "image_point_id": imagePointId.map { .string($0.uuidString.lowercased()) } ?? .null,
        ]
        do {
            try await supa.from("review_findings").update(fields)
                .eq("id", value: id.uuidString.lowercased()).execute()
            if let i = findings.firstIndex(where: { $0.id == id }) {
                findings[i].title = title
                findings[i].body = body
                findings[i].audioPath = audioPath
                findings[i].imagePath = imagePath
                findings[i].imagePointId = imagePointId
            }
            return true
        } catch {
            return false
        }
    }

    func deleteFinding(_ id: UUID) async {
        findings.removeAll { $0.id == id }
        links.removeAll { $0.finding_id == id }
        _ = try? await supa.from("review_findings").delete()
            .eq("id", value: id.uuidString.lowercased()).execute()
    }

    // MARK: - Document autosave

    /// Two seconds after the last keystroke, like the web. flush before
    /// delivering.
    func scheduleDocumentSave() {
        docSaved = false
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            await self?.saveDocument()
        }
    }

    func flushDocumentSave() async {
        saveTask?.cancel()
        await saveDocument()
    }

    private func saveDocument() async {
        struct Params: Encodable {
            let p_order_id: String
            let p_sections: [ReviewSectionContent]
        }
        docSaving = true
        _ = try? await supa.rpc(
            "save_review_document",
            params: Params(p_order_id: idString, p_sections: sections)
        ).execute()
        docSaving = false
        docSaved = true
        Task {
            try? await Task.sleep(for: .seconds(1.6))
            docSaved = false
        }
    }

    // MARK: - Transitions

    /// nil on success, the stable error code otherwise.
    func transition(_ action: String, message: String? = nil) async -> String? {
        struct Req: Encodable {
            let orderId: String
            let action: String
            let message: String?
        }
        struct Res: Decodable { let ok: Bool? }
        do {
            let _: Res = try await API.post(
                "api/reviews/transition",
                Req(orderId: idString, action: action, message: message)
            )
            return nil
        } catch let APIError.http(_, code) {
            return code.isEmpty ? "server_error" : code
        } catch {
            return "network"
        }
    }

    // MARK: - Assist

    /// Runs tidy or check; returns the note to show. Mirrors the web's
    /// copy for every outcome.
    func runAssist(_ action: String) async -> String {
        struct Req: Encodable {
            let orderId: String
            let action: String
        }
        struct TidySection: Decodable {
            let key: String
            let after: String
            let changed: Bool
        }
        struct Res: Decodable {
            let sections: [TidySection]?
            let answered: [AnsweredQuestion]?
            let code: String?
        }
        do {
            let res: Res = try await API.post(
                "api/reviews/assist", Req(orderId: idString, action: action)
            )
            if res.code == "unchanged" {
                return "Nothing has changed since the last run."
            }
            if action == "tidy" {
                let changed = (res.sections ?? []).filter(\.changed)
                guard !changed.isEmpty else {
                    return "Nothing to change. It already reads well."
                }
                undoSections = sections
                for change in changed {
                    if let i = sections.firstIndex(where: { $0.key == change.key }) {
                        sections[i].body = change.after
                    }
                }
                scheduleDocumentSave()
                return changed.count == 1
                    ? "Tidied one section." : "Tidied \(changed.count) sections."
            }
            answeredQuestions = res.answered ?? []
            return answeredQuestions.isEmpty
                ? "Nothing to check against yet." : "Checked against their questions."
        } catch let APIError.http(_, code) {
            return switch code {
            case "too_many", "too_many_order":
                "That is enough runs for now. Give it a little while."
            case "nothing_written": "Write something first."
            default: "That did not work. Try again in a moment."
            }
        } catch {
            return "That did not work. Try again in a moment."
        }
    }

    func undoTidy() {
        guard let undo = undoSections else { return }
        sections = undo
        undoSections = nil
        scheduleDocumentSave()
    }

    // MARK: - Delivery gate

    var deliveryBlockerSentence: String? {
        deliveryBlocker(
            findings: findings.map {
                ($0.title, $0.body, $0.audioPath, pointIds(for: $0.id).count)
            },
            sections: sections
        )
    }

    /// The advisory 120-word checklist row counts section bodies only.
    var sectionWordCount: Int {
        sections.map(\.body).joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: \.isWhitespace).count
    }

    // MARK: - Attachments

    /// Three steps, like the web: presign, raw PUT, complete. Returns the
    /// error sentence, or nil when the row landed.
    func uploadAttachment(_ url: URL) async -> String? {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else {
            return "Could not read that file."
        }
        guard data.count <= 50 * 1024 * 1024 else {
            return "Files are limited to 50 MB."
        }
        let filename = url.lastPathComponent
        let contentType = UTType(filenameExtension: url.pathExtension)?
            .preferredMIMEType ?? "application/octet-stream"

        struct CreateReq: Encodable {
            let action = "create"
            let orderId: String
            let filename: String
            let contentType: String
            let size: Int
        }
        struct CreateRes: Decodable {
            let url: String
            let key: String
        }
        struct CompleteReq: Encodable {
            let action = "complete"
            let orderId: String
            let key: String
            let filename: String
            let contentType: String
        }
        struct CompleteRes: Decodable { let attachment: ReviewAttachmentRow }
        do {
            let created: CreateRes = try await API.post(
                "api/review-attachment",
                CreateReq(
                    orderId: idString, filename: filename,
                    contentType: contentType, size: data.count
                )
            )
            guard let putURL = URL(string: created.url) else { return "Could not upload. Try again." }
            var put = URLRequest(url: putURL)
            put.httpMethod = "PUT"
            put.setValue(contentType, forHTTPHeaderField: "Content-Type")
            let (_, response) = try await URLSession.shared.upload(for: put, from: data)
            guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) == true
            else { return "Could not upload. Try again." }
            let completed: CompleteRes = try await API.post(
                "api/review-attachment",
                CompleteReq(
                    orderId: idString, key: created.key,
                    filename: filename, contentType: contentType
                )
            )
            attachments.append(completed.attachment)
            return nil
        } catch let APIError.http(_, code) {
            return switch code {
            case "unsupported_type": "That file type isn't supported."
            case "too_large": "Files are limited to 50 MB."
            default: "Could not upload. Try again."
            }
        } catch {
            return "Could not upload. Try again."
        }
    }

    func removeAttachment(_ attachment: ReviewAttachmentRow) async {
        attachments.removeAll { $0.id == attachment.id }
        _ = try? await supa.from("review_attachments").delete()
            .eq("id", value: attachment.id.uuidString.lowercased()).execute()
    }

    // MARK: - Signed media (api/review-media)

    func findingMediaURL(_ findingId: UUID, kind: String) async -> URL? {
        struct Req: Encodable {
            let findingId: String
            let kind: String
        }
        struct Res: Decodable { let url: String? }
        let res: Res? = try? await API.post(
            "api/review-media",
            Req(findingId: findingId.uuidString.lowercased(), kind: kind)
        )
        return res?.url.flatMap(URL.init)
    }

    func attachmentURL(_ attachmentId: UUID) async -> URL? {
        struct Req: Encodable { let attachmentId: String }
        struct Res: Decodable { let url: String? }
        let res: Res? = try? await API.post(
            "api/review-media", Req(attachmentId: attachmentId.uuidString.lowercased())
        )
        return res?.url.flatMap(URL.init)
    }

    /// Batch-signs cited clips; the route caps a batch at 24 ids.
    func clipURLs(pointIds: [UUID]) async -> [UUID: URL] {
        struct Req: Encodable {
            let orderId: String
            let pointIds: [String]
        }
        struct Res: Decodable { let urls: [String: String] }
        var out: [UUID: URL] = [:]
        for batch in stride(from: 0, to: pointIds.count, by: 24) {
            let slice = Array(pointIds[batch..<min(batch + 24, pointIds.count)])
            let res: Res? = try? await API.post(
                "api/review-media",
                Req(orderId: idString, pointIds: slice.map { $0.uuidString.lowercased() })
            )
            for (key, value) in res?.urls ?? [:] {
                if let id = UUID(uuidString: key), let url = URL(string: value) {
                    out[id] = url
                }
            }
        }
        return out
    }

    // MARK: - Completed-order extras

    func setTestimonialFeatured(_ featured: Bool) async -> Bool {
        struct Params: Encodable {
            let p_order_id: String
            let p_featured: Bool
        }
        do {
            try await supa.rpc(
                "feature_review_testimonial",
                params: Params(p_order_id: idString, p_featured: featured)
            ).execute()
            return true
        } catch {
            return false
        }
    }

    func requestSample() async -> Bool {
        struct Params: Encodable { let p_order_id: String }
        do {
            try await supa.rpc(
                "request_review_sample", params: Params(p_order_id: idString)
            ).execute()
            return true
        } catch {
            return false
        }
    }
}

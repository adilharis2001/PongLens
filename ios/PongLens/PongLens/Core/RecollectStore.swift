import Foundation

extension Notification.Name {
    /// Posted when the Recollect setting changes in Account, so the
    /// journal's tab row can follow without waiting for a reload.
    static let plRecollectChanged = Notification.Name("pl-recollect-changed")
}

// MARK: - Wire models (api/recollect)

/// The entry a revealed point came from.
struct RecollectSource: Decodable, Hashable {
    let lessonId: UUID
    let kind: String
    let createdAt: String
    let title: String?
}

/// A row in the topic queue.
struct RecollectTopicRow: Decodable, Identifiable, Hashable {
    let id: UUID
    let key: String
    let label: String
    var pointCount: Int
    let lessonCount: Int
    var lastReviewedAt: String?
}

/// A point revealed by opening a topic.
struct RecollectRevealedPoint: Decodable, Identifiable, Hashable {
    let id: UUID
    let text: String
    var inWorkingOn: Bool
    let source: RecollectSource
}

struct RecollectViewState: Decodable {
    var enabled: Bool
    var noticeSeen: Bool
    var processing: Bool
    var topics: [RecollectTopicRow]
}

// MARK: - Store

/// The web's Recollect module state, one mount at a time. Every read and
/// write goes through the /api/recollect routes: the underlying RPCs are
/// service-role only, so PostgREST can never be a shortcut here.
@Observable
final class RecollectStore {
    var view: RecollectViewState?
    var failed = false
    /// Points revealed this visit, by topic.
    var opened: [UUID: [RecollectRevealedPoint]] = [:]
    var busy: Set<UUID> = []
    var note: [UUID: String] = [:]

    /// One key per topic per mount, so tapping twice cannot count as two
    /// reviews and reorder the queue twice.
    private var reviewKeys: [UUID: UUID] = [:]
    /// Backstop against a server that always claims progress, not a limit
    /// on how much work a visit may do.
    private var drained = 0

    private struct ActionReq: Encodable {
        let action: String
        var topicId: String?
        var reviewKey: String?
        var pointId: String?

        init(_ action: String, topicId: UUID? = nil, reviewKey: UUID? = nil, pointId: UUID? = nil) {
            self.action = action
            self.topicId = topicId?.uuidString.lowercased()
            self.reviewKey = reviewKey?.uuidString.lowercased()
            self.pointId = pointId?.uuidString.lowercased()
        }
    }

    func load() async {
        drained = 0
        failed = false
        do {
            view = try await fetchView()
            if view?.processing == true { await drain() }
        } catch {
            if !Task.isCancelled { failed = true }
        }
    }

    private func fetchView() async throws -> RecollectViewState {
        try await API.get("api/recollect")
    }

    /// Drain the queue while the section is open. Nothing else processes
    /// Recollect jobs, so a loop that stops early leaves the user with a
    /// spinner forever. Runs until the server says nothing is available;
    /// the surrounding .task cancels it when the section goes away.
    private func drain() async {
        struct Empty: Encodable {}
        struct ProcessResult: Decodable {
            let status: String?
            let pending: Bool?
        }
        do {
            while !Task.isCancelled && drained < 60 {
                drained += 1
                let result: ProcessResult = try await API.post("api/recollect/process", Empty())
                if result.status == "idle" || (result.status == "failed" && result.pending != true) {
                    break
                }
                if result.status == "complete" {
                    view = try await fetchView()
                }
            }
            if !Task.isCancelled {
                view = try await fetchView()
                failed = false
            }
        } catch {
            if !Task.isCancelled { failed = true }
        }
    }

    func openTopic(_ topic: RecollectTopicRow) async {
        if opened[topic.id] != nil || busy.contains(topic.id) { return }
        busy.insert(topic.id)
        defer { busy.remove(topic.id) }

        let reviewKey: UUID
        if let existing = reviewKeys[topic.id] {
            reviewKey = existing
        } else {
            reviewKey = UUID()
            reviewKeys[topic.id] = reviewKey
        }

        struct Res: Decodable { let points: [RecollectRevealedPoint]? }
        do {
            let res: Res = try await API.post(
                "api/recollect", ActionReq("open", topicId: topic.id, reviewKey: reviewKey)
            )
            opened[topic.id] = res.points ?? []
            // The row's own summary line has to stop saying "not opened yet"
            // the moment it is opened. Re-ordering waits for the next visit,
            // so the list does not rearrange itself under the reader's finger.
            if var current = view,
               let i = current.topics.firstIndex(where: { $0.id == topic.id }) {
                current.topics[i].lastReviewedAt = ISO8601DateFormatter().string(from: Date())
                view = current
            }
        } catch {
            note[topic.id] = "Couldn't open this one. Try again."
        }
    }

    func dismiss(topicId: UUID, pointId: UUID) async {
        if busy.contains(pointId) { return }
        busy.insert(pointId)
        defer { busy.remove(pointId) }

        struct Res: Decodable { let dismissed: Bool? }
        do {
            let _: Res = try await API.post("api/recollect", ActionReq("dismiss", pointId: pointId))
            opened[topicId] = (opened[topicId] ?? []).filter { $0.id != pointId }
            if var current = view,
               let i = current.topics.firstIndex(where: { $0.id == topicId }) {
                current.topics[i].pointCount = max(0, current.topics[i].pointCount - 1)
                view = current
            }
        } catch {
            note[pointId] = "Couldn't remove this one. Try again."
        }
    }

    /// Adds a revealed point to Working On. The created (or matched) focus
    /// point is handed back so the journal's card can show it land.
    func addToWorkingOn(topicId: UUID, pointId: UUID, journal: JournalStore) async {
        if busy.contains(pointId) { return }
        busy.insert(pointId)
        defer { busy.remove(pointId) }

        struct Res: Decodable {
            let result: String?
            let focusPoint: FocusPointRow?

            enum CodingKeys: String, CodingKey {
                case result
                case focusPoint = "focus_point"
            }
        }
        do {
            let res: Res = try await API.post(
                "api/recollect", ActionReq("add_to_working_on", pointId: pointId)
            )
            if let focus = res.focusPoint { journal.mergeCue(focus) }
            if res.result != "full" {
                opened[topicId] = (opened[topicId] ?? []).map { point in
                    var point = point
                    if point.id == pointId { point.inWorkingOn = true }
                    return point
                }
            }
            note[pointId] = switch res.result {
            case "full": "Working On is full. Finish one first."
            case "duplicate": "Already in Working On"
            default: "Added to Working On"
            }
        } catch {
            note[pointId] = "Couldn't add this one. Try again."
        }
    }

    func acknowledge() async {
        view?.noticeSeen = true
        struct Res: Decodable { let noticeSeen: Bool? }
        do {
            let _: Res = try await API.post("api/recollect", ActionReq("acknowledge_notice"))
        } catch {
            view?.noticeSeen = false
        }
    }
}

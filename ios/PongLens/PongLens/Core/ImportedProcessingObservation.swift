import Foundation

/// The import ID stays stable; a later processing retry must change the
/// observation task's identity even after the import's task has completed.
struct ImportedProcessingObservation: Equatable {
    private(set) var retryJobID: UUID?
    var kind: String? = "youtube_import"
    var status: String? = "queued"

    func taskID(importJobID: UUID) -> UUID { retryJobID ?? importJobID }

    mutating func processingRequested(jobID: String?) throws {
        guard let jobID, let id = UUID(uuidString: jobID) else { throw URLError(.badServerResponse) }
        retryJobID = id
        kind = "deadspace_cut"
        status = "queued"
    }
}

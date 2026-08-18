import Foundation
import Supabase

/// The match library: matches + active jobs, polled like the web
/// (10 s while anything is queued/processing, 30 s otherwise).
@Observable
final class LibraryStore {
    var matches: [MatchRow] = []
    var activeJobs: [JobRow] = []
    var loaded = false
    var lastError: String?

    private var pollTask: Task<Void, Never>?

    var hasActiveWork: Bool {
        !activeJobs.isEmpty || matches.contains { $0.status == .processing }
    }

    /// The queued or running job working a match, even before the match row
    /// links it — commerce mode writes the row first and the worker attaches
    /// job_id later. Mirrors the web's liveJobFor. activeJobs already holds
    /// only queued/processing rows.
    func liveJob(for match: MatchRow) -> JobRow? {
        if let jobId = match.jobId,
           let linked = activeJobs.first(where: { $0.id == jobId }) {
            return linked
        }
        let id = match.id.uuidString.lowercased()
        return activeJobs.first {
            $0.kind == "deadspace_cut"
                && $0.options?.matchId?.lowercased() == id
        }
    }

    func load() async {
        do {
            async let matchesQuery: [MatchRow] = supa
                .from("matches")
                .select(MatchRow.librarySelect)
                .order("created_at", ascending: false)
                .execute()
                .value
            async let jobsQuery: [JobRow] = supa
                .from("jobs")
                .select("id,status,kind,progress,original_name,options,created_at")
                .in("status", values: ["queued", "processing"])
                .neq("kind", value: "content_check")
                .order("created_at", ascending: false)
                .execute()
                .value
            let (m, j) = try await (matchesQuery, jobsQuery)
            matches = m
            activeJobs = j
            lastError = nil
        } catch {
            #if DEBUG
            lastError = String(describing: error)
            #else
            lastError = "Couldn't load matches. Pull to refresh."
            #endif
        }
        loaded = true
    }

    func startPolling() {
        guard pollTask == nil else { return }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                let interval: UInt64 = (self?.hasActiveWork == true) ? 10 : 30
                try? await Task.sleep(nanoseconds: interval * 1_000_000_000)
                guard !Task.isCancelled else { break }
                await self?.load()
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }
}

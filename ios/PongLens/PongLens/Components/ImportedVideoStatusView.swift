import SwiftUI
import Supabase

/// Download completion and processing are separate. A refused processing claim
/// leaves a saved match, so request minutes here instead of importing it twice.
struct ImportedVideoStatusView: View {
    let jobID: UUID
    @State private var imported: Imported?
    @State private var needsMinutes = false
    @State private var processingStarted = false
    @State private var error: String?
    struct Imported: Decodable {
        let id: UUID
        let status: String
        let duration_s: Double?
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(imported == nil ? "Queued. Your video is being downloaded." : needsMinutes ? "Your video is saved. It needs more minutes to process." : processingStarted ? "Your video is saved. Processing has started." : "Your video is saved in your library.")
                .font(.plBody).foregroundStyle(needsMinutes ? PL.warningText : PL.text300)
            if needsMinutes {
                AllowanceRecoveryView(resource: "minutes", retryLabel: "Try processing again") {
                    guard let imported else { return }
                    struct Req: Encodable { let matchId: String }
                    struct Res: Decodable { let job_id: String? }
                    do {
                        let result: Res = try await API.post("api/process", Req(matchId: imported.id.uuidString.lowercased()))
                        guard result.job_id != nil else { throw URLError(.badServerResponse) }
                        needsMinutes = false
                        processingStarted = true
                        error = nil
                        NotificationCenter.default.post(name: .plUploadRegistered, object: nil)
                    } catch let APIError.http(_, code) where code == "insufficient_minutes" {
                        error = "There aren't enough minutes yet. Your video is saved."
                    }
                }
            }
            if let error { Text(error).font(.plBody).foregroundStyle(PL.warningText) }
        }
        .task(id: jobID) {
            while !Task.isCancelled {
                do {
                    if try await check() { return }
                } catch { /* Keep polling while this screen is open. */ }
                try? await Task.sleep(for: .seconds(8))
            }
        }
    }

    private func check() async throws -> Bool {
        struct Job: Decodable { let status: String; let user_message: String?; let result_path: String? }
        let jobs: [Job] = try await supa.from("jobs").select("status,user_message,result_path")
            .eq("id", value: jobID).execute().value
        if jobs.first?.status == "failed" {
            error = jobs.first?.user_message ?? "The import could not finish. Please try again."
            return true
        }
        guard jobs.first?.status == "done" else { return false }
        var matches: [Imported] = try await supa.from("matches").select("id,status,duration_s")
            .eq("job_id", value: jobID).limit(1).execute().value
        if matches.isEmpty, let path = jobs.first?.result_path {
            matches = try await supa.from("matches").select("id,status,duration_s")
                .eq("raw_path", value: path).limit(1).execute().value
        }
        guard let match = matches.first else { return false }
        struct Active: Decodable { let id: UUID }
        let active: [Active] = try await supa.from("jobs").select("id")
            .eq("options->>match_id", value: match.id.uuidString.lowercased())
            .in("status", values: ["queued", "processing"]).limit(1).execute().value
        struct Balance: Decodable { let minutes_balance: Double }
        let balances: [Balance] = try await supa.rpc("my_processing_state").execute().value
        guard let balance = balances.first else { return false }
        imported = match
        processingStarted = !active.isEmpty
        needsMinutes = !processingStarted && match.status == "uploaded"
            && match.duration_s.map { max(1, ceil($0 / 60)) > balance.minutes_balance } == true
        NotificationCenter.default.post(name: .plUploadRegistered, object: nil)
        return true
    }
}

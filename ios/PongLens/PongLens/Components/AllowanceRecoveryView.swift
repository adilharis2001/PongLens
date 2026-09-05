import SwiftUI
import Supabase

/// Keeps the request beside the limit. Retrying is always the player's choice.
struct AllowanceRecoveryView: View {
    let resource: String
    let retryLabel: String
    let onRetry: () async throws -> Void
    @Environment(\.scenePhase) private var scenePhase
    @State private var purchasesEnabled: Bool?
    @State private var configError = false
    @State private var busy = false
    @State private var refreshToken = 0
    @State private var accountOpen = false
    @State private var retryError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let purchasesEnabled {
                if purchasesEnabled {
                    Button("Get more \(resource)") { accountOpen = true }
                        .buttonStyle(PLSecondaryButtonStyle())
                } else {
                    AllowanceRequestRow(resource: resource, compact: true, refreshToken: refreshToken)
                }
            } else if !configError {
                ProgressView("Checking your options…").font(.plBody)
            }
            if configError {
                Text("Could not check your options. Please try again.")
                    .font(.plBody).foregroundStyle(PL.warningText)
            }
            if let retryError { Text(retryError).font(.plBody).foregroundStyle(PL.warningText) }
            Button(busy ? "Checking…" : purchasesEnabled == nil ? "Try again" : retryLabel) {
                Task {
                    busy = true
                    let hadOptions = purchasesEnabled != nil
                    await load()
                    retryError = nil
                    if hadOptions {
                        do { try await onRetry() }
                        catch { retryError = "Could not check your allowance. Please try again." }
                    }
                    refreshToken += 1
                    busy = false
                }
            }
            .buttonStyle(PLSecondaryButtonStyle())
            .disabled(busy)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task { await load() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await load(); refreshToken += 1 } }
        }
        .sheet(isPresented: $accountOpen) { AccountScreen() }
    }

    private func load() async {
        struct Row: Decodable { let value: String }
        do {
            let rows: [Row] = try await supa.from("app_config").select("value")
                .eq("key", value: "purchases_enabled").execute().value
            guard let row = rows.first else { purchasesEnabled = nil; configError = true; return }
            purchasesEnabled = row.value == "true"
            configError = false
        } catch { purchasesEnabled = nil; configError = true }
    }
}

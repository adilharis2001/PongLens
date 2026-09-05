import SwiftUI
import Supabase

struct AllowanceRequestRow: View {
    let resource: String
    var compact = false
    var refreshToken = 0
    @State private var pending = false
    @State private var loaded = false
    @State private var open = false
    @State private var message = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if pending {
                Text("Request sent. We will notify you when it has been reviewed.")
                    .font(.plBody).foregroundStyle(PL.cyan)
            } else {
                Text(compact ? "Need a little more? You can request a free allowance increase during beta." : "PongLens is in beta. Enjoying the app and need more storage or processing minutes? You can request a free allowance increase.")
                    .font(.plBody).foregroundStyle(PL.text400)
                Button("Request more \(resource)") { open = true }
                    .buttonStyle(PLSecondaryButtonStyle())
                    .disabled(!loaded)
            }
        }
        .task(id: refreshToken) {
            struct Row: Decodable { let id: UUID }
            do {
                let user = try await supa.auth.session.user
                let rows: [Row] = try await supa.from("quota_requests").select("id")
                    .eq("user_id", value: user.id).eq("resource", value: resource)
                    .eq("status", value: "pending").limit(1).execute().value
                pending = !rows.isEmpty
            } catch { /* Submission still checks for duplicates on the server. */ }
            loaded = true
        }
        .sheet(isPresented: $open) {
            NavigationStack {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Anything you would like us to know? (optional)")
                        .font(.plBody)
                    TextEditor(text: $message)
                        .frame(minHeight: 100, maxHeight: 180)
                        .onChange(of: message) { _, value in
                            if value.count > 1000 { message = String(value.prefix(1000)) }
                        }
                    if let error { Text(error).font(.plBody).foregroundStyle(.red) }
                    Button(busy ? "Sending…" : "Send request") {
                        Task {
                            busy = true
                            error = nil
                            defer { busy = false }
                            struct Req: Encodable { let resource: String; let message: String }
                            struct Res: Decodable { let id: UUID }
                            do {
                                let _: Res = try await API.post("api/allowances/request", Req(resource: resource, message: message))
                                pending = true
                                open = false
                            } catch {
                                self.error = "Could not send your request. Please try again later."
                            }
                        }
                    }
                    .buttonStyle(PLSecondaryButtonStyle())
                    .disabled(busy)
                    Spacer()
                }
                .padding(20)
                .navigationTitle("Request more \(resource)")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { open = false }.disabled(busy)
                    }
                }
            }
            .presentationDetents([.medium, .large])
            .interactiveDismissDisabled(busy)
        }
    }
}

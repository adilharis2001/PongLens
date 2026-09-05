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
                    .font(.plBody).foregroundStyle(PL.text300)
            } else {
                Text(compact ? "PongLens is in beta. You can request more \(resource == "minutes" ? "processing minutes" : resource) for free." : "PongLens is in beta. Enjoying the app and need more storage or processing minutes? You can request a free allowance increase.")
                    .font(.plBody).foregroundStyle(PL.text400)
                if compact {
                    requestButton.buttonStyle(PLPrimaryButtonStyle())
                } else {
                    requestButton.buttonStyle(PLSecondaryButtonStyle())
                }
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
                ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Anything you would like us to know? (optional)")
                        .font(.plBody)
                    TextEditor(text: $message)
                        .font(.plBody)
                        .foregroundStyle(PL.text100)
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 100, maxHeight: 180)
                        .padding(12)
                        .background(PL.ink, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(PL.edge, lineWidth: 1))
                        .onChange(of: message) { _, value in
                            if value.count > 1000 { message = String(value.prefix(1000)) }
                        }
                    if let error { Text(error).font(.plBody).foregroundStyle(PL.warningText) }
                    Button {
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
                    } label: {
                        Text(busy ? "Sending…" : "Send request")
                            .frame(maxWidth: .infinity, minHeight: 28)
                    }
                    .buttonStyle(PLPrimaryButtonStyle())
                    .disabled(busy)
                    Button { open = false } label: {
                        Text("Cancel").frame(maxWidth: .infinity, minHeight: 28)
                    }
                    .buttonStyle(PLSecondaryButtonStyle())
                    .disabled(busy)
                }
                .padding(20)
                }
                .background(PL.ink)
                .navigationTitle("Request more \(resource)")
                .navigationBarTitleDisplayMode(.inline)
            }
            .presentationDetents([.medium, .large])
            .interactiveDismissDisabled(busy)
        }
    }

    private var requestButton: some View {
        Button { open = true } label: {
            Text("Request more \(resource)").frame(maxWidth: .infinity, minHeight: 28)
        }
        .disabled(!loaded)
    }
}

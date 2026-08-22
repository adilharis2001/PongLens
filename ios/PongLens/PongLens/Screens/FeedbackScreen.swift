import SwiftUI
import Supabase

/// The feedback form — one box, one button, exactly the web's write: an
/// immediate feedback_items insert (title = first 8 words), then
/// /api/feedback/assist polishes it in the background.
struct FeedbackScreen: View {
    var matchId: UUID?

    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    @Environment(LibraryStore.self) private var library
    @State private var body_ = ""
    @State private var pickedMatch: UUID?
    @State private var sending = false
    @State private var sent = false
    @State private var errorMessage: String?

    var body: some View {
        ZStack {
            ArenaBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Button {
                        dismiss()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 12, weight: .semibold))
                            Text("Back")
                        }
                    }
                    .buttonStyle(PLSecondaryButtonStyle())

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Feedback")
                            .font(.plPageTitle)
                            .tracking(-0.6)
                            .foregroundStyle(PL.textBody)
                        Text("Bugs, ideas, anything off. It lands on the board so others can vote.")
                            .font(.plBody)
                            .foregroundStyle(PL.text400)
                    }

                    if sent {
                        VStack(spacing: 12) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 34))
                                .foregroundStyle(PL.successText)
                            Text("Posted")
                                .font(.system(size: 17, weight: .bold))
                                .foregroundStyle(PL.text100)
                            Text("It's on the board now, where others can upvote it.")
                                .font(.plBody)
                                .foregroundStyle(PL.text400)
                                .multilineTextAlignment(.center)
                            Button("Send another") {
                                sent = false
                                body_ = ""
                                pickedMatch = nil
                            }
                            .buttonStyle(PLSecondaryButtonStyle())
                            .padding(.top, 4)
                        }
                        .frame(maxWidth: .infinity)
                        .plCard(padding: 28)
                    } else {
                        TextField("A bug, an idea, anything.", text: $body_, axis: .vertical)
                            .plField()
                            .lineLimit(4...10)

                        // A real picker over the whole library, not a
                        // handful of chips.
                        Menu {
                            Button("Not about a specific match") { pickedMatch = nil }
                            ForEach(ownMatches) { match in
                                Button {
                                    pickedMatch = match.id
                                } label: {
                                    let parts = MatchTitle.parts(for: match)
                                    Text("\(parts.primary) · \(parts.secondary)")
                                }
                            }
                        } label: {
                            HStack {
                                Text(pickedMatchLabel)
                                    .font(.plBody)
                                    .foregroundStyle(pickedMatch == nil ? PL.text400 : PL.text100)
                                    .lineLimit(1)
                                Spacer()
                                Image(systemName: "chevron.up.chevron.down")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(PL.text500)
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 13)
                            .background(PL.ink.opacity(0.4), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                                    .strokeBorder(PL.edge, lineWidth: 1)
                            )
                        }

                        if let errorMessage {
                            Text(errorMessage)
                                .font(.plCaption)
                                .foregroundStyle(PL.dangerText)
                        }

                        Button(sending ? "Sending…" : "Send") {
                            Task { await send() }
                        }
                        .buttonStyle(PLPrimaryButtonStyle())
                        .frame(maxWidth: .infinity)
                        .disabled(sending || body_.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
                .padding(20)
                .padding(.bottom, 60)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .plKeyboardDismiss()
        .onAppear { pickedMatch = matchId }
    }

    private var ownMatches: [MatchRow] {
        guard let uid = app.userId else { return [] }
        return library.matches.filter { $0.userId == uid }
    }

    private var pickedMatchLabel: String {
        guard let pickedMatch,
              let match = ownMatches.first(where: { $0.id == pickedMatch }) else {
            return "Not about a specific match"
        }
        return MatchTitle.parts(for: match).primary
    }

    private func send() async {
        guard let uid = app.userId else { return }
        let trimmed = body_.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        sending = true
        errorMessage = nil
        struct Insert: Encodable {
            let user_id: String
            let match_id: String?
            let body: String
            let title: String
            let attachments: [String]
        }
        let title = trimmed.split(separator: " ").prefix(8).joined(separator: " ")
        do {
            struct IdRow: Decodable { let id: UUID }
            let row: IdRow = try await supa
                .from("feedback_items")
                .insert(Insert(
                    user_id: uid.uuidString.lowercased(),
                    match_id: pickedMatch?.uuidString.lowercased(),
                    body: trimmed,
                    title: title.isEmpty ? "Feedback" : title,
                    attachments: []
                ))
                .select("id")
                .single()
                .execute()
                .value
            sent = true
            // Background polish, fire and forget — same as the web.
            struct AssistReq: Encodable { let itemId: String }
            struct AssistRes: Decodable { let ok: Bool? }
            let _: AssistRes? = try? await API.post(
                "api/feedback/assist", AssistReq(itemId: row.id.uuidString.lowercased())
            )
        } catch {
            errorMessage = "Could not send. Try again."
        }
        sending = false
    }
}

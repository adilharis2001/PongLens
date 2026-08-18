import SwiftUI

/// The bell's panel: server-composed titles and bodies, unread rows tinted,
/// "Mark all read" when anything is unread.
struct NotificationsPanel: View {
    let store: NotificationsStore
    let onOpenMatch: (UUID) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Notifications")
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                Spacer()
                if store.unreadCount > 0 {
                    Button("Mark all read") {
                        Task { await store.markAllRead() }
                    }
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(PL.cyan)
                    .buttonStyle(.plain)
                }
            }

            if !store.loaded {
                Text("Loading…")
                    .font(.plBody)
                    .foregroundStyle(PL.text500)
            } else if store.rows.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("You're all caught up")
                        .font(.plRowTitle)
                        .foregroundStyle(PL.text200)
                    Text("Coach notes and finished matches land here.")
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                }
                .padding(.top, 8)
            } else {
                ScrollView {
                    VStack(spacing: 8) {
                        ForEach(store.rows) { row in
                            Button {
                                if let matchId = row.matchId {
                                    onOpenMatch(matchId)
                                }
                            } label: {
                                HStack(alignment: .top, spacing: 12) {
                                    Image(systemName: icon(for: row.kind))
                                        .font(.system(size: 14))
                                        .foregroundStyle(tint(for: row.kind))
                                        .frame(width: 28, height: 28)
                                        .background(PL.surface2.opacity(0.6), in: Circle())
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(row.title)
                                            .font(.system(size: 13, weight: .medium))
                                            .foregroundStyle(PL.text200)
                                            .multilineTextAlignment(.leading)
                                        if let body = row.body, !body.isEmpty {
                                            Text(body)
                                                .font(.plCaption)
                                                .foregroundStyle(PL.text500)
                                                .lineLimit(2)
                                                .multilineTextAlignment(.leading)
                                        }
                                        Text(PGDate.shortDate(row.createdAt))
                                            .font(.system(size: 11))
                                            .foregroundStyle(PL.text600)
                                    }
                                    Spacer(minLength: 0)
                                }
                                .padding(10)
                                .background(
                                    row.readAt == nil ? PL.cyan.opacity(0.06) : .clear,
                                    in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                                )
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func icon(for kind: String) -> String {
        switch kind {
        case "note": "bubble.left"
        case "coach_joined": "person.badge.plus"
        case "reel_ready": "arrow.down.circle"
        case "reel_failed", "match_failed", "upload_failed": "exclamationmark.triangle"
        case let k where k.hasPrefix("order") || k.hasPrefix("review") || k.hasPrefix("sample"): "creditcard"
        default: "bell"
        }
    }

    private func tint(for kind: String) -> Color {
        switch kind {
        case "reel_failed", "match_failed", "upload_failed": PL.warningText
        case "note": Color(hex: 0xF0C420)
        default: PL.cyan
        }
    }
}

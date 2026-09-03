import SwiftUI

/// The bell's panel: server-composed titles and bodies, unread rows
/// tinted, relative times on the trailing edge, "Mark all read" up top.
struct NotificationsPanel: View {
    let store: NotificationsStore
    let onOpenMatch: (UUID) -> Void
    /// Rows without a match (a coach's shared entry, a student joining)
    /// hand their href here; each tab view maps it to its own tab.
    var onOpenHref: (String) -> Void = { _ in }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Notifications")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(PL.text100)
                Spacer()
                if store.unreadCount > 0 {
                    Button("Mark all read") {
                        Task { await store.markAllRead() }
                    }
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(PL.cyan)
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 12)

            if !store.loaded {
                Spacer()
                ProgressView().tint(PL.cyan)
                Spacer()
            } else if store.rows.isEmpty {
                Spacer()
                VStack(spacing: 6) {
                    Image(systemName: "bell.slash")
                        .font(.system(size: 26))
                        .foregroundStyle(PL.text600)
                    Text("You're all caught up")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(PL.text200)
                    Text("Coach notes and finished matches land here.")
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                }
                Spacer()
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(store.rows) { row in
                            rowView(row)
                            if row.id != store.rows.last?.id {
                                Rectangle()
                                    .fill(PL.edge.opacity(0.45))
                                    .frame(height: 1)
                                    .padding(.leading, 64)
                            }
                        }
                    }
                    .padding(.bottom, 24)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private func rowView(_ row: NotificationRow) -> some View {
        Button {
            if let matchId = row.matchId {
                onOpenMatch(matchId)
            } else {
                onOpenHref(row.href)
            }
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: icon(for: row.kind))
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(tint(for: row.kind))
                    .frame(width: 32, height: 32)
                    .background(tint(for: row.kind).opacity(0.12), in: Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text(row.title)
                        .font(.system(size: 15, weight: row.readAt == nil ? .semibold : .medium))
                        .foregroundStyle(row.readAt == nil ? PL.text100 : PL.text300)
                        .multilineTextAlignment(.leading)
                    if let body = row.body, !body.isEmpty {
                        Text(body)
                            .font(.system(size: 13))
                            .foregroundStyle(PL.text400)
                            .lineLimit(2)
                            .lineSpacing(2)
                            .multilineTextAlignment(.leading)
                    }
                }

                Spacer(minLength: 8)

                VStack(alignment: .trailing, spacing: 6) {
                    Text(relativeTime(row.createdAt))
                        .font(.system(size: 12))
                        .foregroundStyle(PL.text500)
                    if row.readAt == nil {
                        Circle().fill(PL.cyan).frame(width: 7, height: 7)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 13)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func relativeTime(_ raw: String) -> String {
        guard let date = PGDate.parse(raw) else { return "" }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    private func icon(for kind: String) -> String {
        switch kind {
        case "note": "bubble.left"
        case "coach_joined", "student_joined": "person.badge.plus"
        case "coach_entry": "book.closed"
        case "student_match_ready": "play.rectangle"
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

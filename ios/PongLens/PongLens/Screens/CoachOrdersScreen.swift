import SwiftUI
import Supabase

/// The coach's order queue, grouped the way the web groups it: your move,
/// in progress, waiting on them, done. Rows come from coach_queue().
struct CoachOrdersScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    @Environment(CoachStore.self) private var coach

    var body: some View {
        ZStack {
            ArenaBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Button { dismiss() } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 12, weight: .semibold))
                            Text("Coaching")
                        }
                    }
                    .buttonStyle(PLSecondaryButtonStyle())

                    Text("Orders")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)

                    if coach.queue.isEmpty {
                        Text("No orders yet.")
                            .font(.plBody)
                            .foregroundStyle(PL.text500)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .plCard(padding: 18)
                    } else {
                        group("Your move", statuses: [.submitted])
                        group("In progress", statuses: [.inReview, .clarification])
                        group("Waiting on them", statuses: [.awaitingSubmission, .delivered])
                        group("Done", statuses: [.completed, .declined, .cancelled])
                    }
                }
                .padding(20)
                .padding(.bottom, 60)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { await coach.load(userId: app.userId) }
        .refreshable { await coach.load(userId: app.userId) }
    }

    @ViewBuilder
    private func group(_ label: String, statuses: [ReviewOrderStatus]) -> some View {
        let orders = coach.queue.filter { statuses.contains($0.status) }
        if !orders.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeading(label)
                VStack(spacing: 0) {
                    ForEach(Array(orders.enumerated()), id: \.element.id) { i, order in
                        NavigationLink(value: CoachOrderRoute(id: order.id)) {
                            CoachOrderRowView(order: order)
                        }
                        .buttonStyle(.plain)
                        if i < orders.count - 1 {
                            Rectangle().fill(PL.edge.opacity(0.5)).frame(height: 1)
                                .padding(.leading, 16)
                        }
                    }
                }
                .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                        .strokeBorder(PL.edge, lineWidth: 1)
                )
            }
        }
    }
}

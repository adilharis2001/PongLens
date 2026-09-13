import SwiftUI

/// MatchDetailScreen.rawSection's type, spacing and alignment, without an
/// additional border: the owning screen supplies its existing card.
struct ProcessingAvailabilityNoticeView: View {
    let notice: ProcessingAvailabilityNotice
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(notice.title).font(.plCardTitle).foregroundStyle(PL.text100)
            Text(notice.body).font(.plBody).foregroundStyle(PL.text400)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
    }
}

/// The shipped raw match processing card, shared with the simulator fixture.
struct MatchProcessingCard: View {
    let notice: ProcessingAvailabilityNotice?
    let stageLabel: String?
    let warning: String?
    let progress: Int?
    let sendsReadyEmail: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let notice {
                ProcessingAvailabilityNoticeView(notice: notice)
            } else {
                Text(stageLabel ?? "Processing").font(.plCardTitle).foregroundStyle(PL.text100)
                if let warning { Text(warning).font(.plBody).foregroundStyle(PL.warningText) }
                ProgressView(value: Double(min(100, max(4, progress ?? 0))) / 100).tint(PL.cyan)
                Text(sendsReadyEmail ? "You can leave this page. We email you when the match is ready." : "You can leave this page and return to your match later.")
                    .font(.plBody).foregroundStyle(PL.text400)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard()
    }
}

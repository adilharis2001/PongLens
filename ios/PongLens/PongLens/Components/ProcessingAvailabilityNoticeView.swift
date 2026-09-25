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
    var estimate: ProcessingEstimate? = nil
    var jobStatus: String? = nil
    var serviceState: String? = nil

    var body: some View {
        MatchProcessingContent(
            notice: notice, stageLabel: stageLabel, warning: warning, progress: progress,
            sendsReadyEmail: sendsReadyEmail, estimate: estimate, jobStatus: jobStatus,
            serviceState: serviceState
        )
        .plCard()
    }
}

/// The card's contents without the card, for a sheet row: More options
/// shows a cut running on a processed match in exactly the words and shape
/// the unprocessed page uses (QA 2026-09-25), as the web's MoreOptions
/// reuses RawMatchView's ProcessingProgress.
struct MatchProcessingContent: View {
    let notice: ProcessingAvailabilityNotice?
    let stageLabel: String?
    let warning: String?
    let progress: Int?
    let sendsReadyEmail: Bool
    var estimate: ProcessingEstimate? = nil
    var jobStatus: String? = nil
    var serviceState: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let notice {
                ProcessingAvailabilityNoticeView(notice: notice)
            } else {
                Text(stageLabel ?? "Processing").font(.plCardTitle).foregroundStyle(PL.text100)
            }
            if let warning { Text(warning).font(.plBody).foregroundStyle(PL.warningText) }
            if notice == nil {
                ProgressView(value: Double(min(100, max(4, progress ?? 0))) / 100).tint(PL.cyan)
                Text(sendsReadyEmail ? "You can leave this page. We email you when the match is ready." : "You can leave this page and return to your match later.")
                    .font(.plBody).foregroundStyle(PL.text400)
                ProcessingEstimateNote(estimate: estimate, jobStatus: jobStatus, serviceState: serviceState)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Home keeps available jobs visible alongside jobs waiting for service.
struct HomeProcessingStatusView: View {
    let summary: ProcessingWorkSummary
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let notice = summary.notice { ProcessingAvailabilityNoticeView(notice: notice) }
            if summary.continuingCount > 0 {
                VStack(alignment: .leading, spacing: 10) {
                    StatusChip(status: summary.queued ? .queued : .processing)
                    Text(summary.continuingLabel).font(.plCardTitle).foregroundStyle(PL.text100)
                    Text(summary.exitMessage).font(.plBody).foregroundStyle(PL.text400)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

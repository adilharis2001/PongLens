import SwiftUI

/// Existing processing-card typography; timing and workload stay server-owned.
struct ProcessingEstimateNote: View {
    let estimate: ProcessingEstimate?
    let jobStatus: String?
    let serviceState: String?
    var compact = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: 15)) { context in
            if let note = estimate?.message(jobStatus: jobStatus, serviceState: serviceState, now: context.date) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(note.summary).font(compact ? .plCaption : .plBody).foregroundStyle(PL.text300)
                    if !compact { Text(note.detail).font(.plBody).foregroundStyle(PL.text500) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

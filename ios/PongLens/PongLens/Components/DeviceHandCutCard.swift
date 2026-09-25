import SwiftUI

/// The raw match page's processing card while this iPhone cuts the match:
/// the ordinary MatchProcessingCard, with the hand cut's own stage names and
/// the phone's progress. Nothing on it says where the cut runs.
struct DeviceHandCutCard: View {
    let live: DeviceHandCutQueue.Live

    var body: some View {
        MatchProcessingCard(
            notice: nil,
            stageLabel: live.title,
            warning: nil,
            progress: live.progress,
            // A hand cut ends in the same ready email as an automatic cut.
            sendsReadyEmail: true
        )
    }
}

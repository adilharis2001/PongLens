import SwiftUI

/// The raw match page's processing card while this iPhone cuts the match:
/// MatchProcessingCard's title, bar and line, in the phone's words, with
/// "Cut on the Mac instead" below. One plain line at most under the bar.
struct DeviceHandCutCard: View {
    let live: DeviceHandCutQueue.Live
    let onCutOnMac: () -> Void

    private var line: String {
        if let line = live.line { return line }
        return "You can leave this page. We email you when the match is ready."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(live.title).font(.plCardTitle).foregroundStyle(PL.text100)
            ProgressView(value: Double(min(100, max(4, live.progress))) / 100).tint(PL.cyan)
            Text(line)
                .font(.plBody)
                .foregroundStyle(live.stopped ? PL.warningText : PL.text400)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: onCutOnMac) {
                HStack(spacing: 8) {
                    if live.movingToMac { ProgressView().controlSize(.small).tint(PL.text400) }
                    Text(DeviceCutCopy.cutOnMac)
                }
                .frame(maxWidth: .infinity, minHeight: 28)
            }
            .buttonStyle(PLSecondaryButtonStyle())
            .disabled(live.movingToMac)
            .padding(.top, 4)
            if let error = live.moveError {
                Text(error).font(.plBody).foregroundStyle(PL.warningText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard()
    }
}

/// Under the ordinary processing card, for a phone cut this iPhone does not
/// hold (another device, or the app was reinstalled): after a day with no
/// word from the phone, the web's offer to hand it to the Mac.
struct DeviceHandCutQuietOffer: View {
    let jobId: UUID
    let onMoved: () -> Void
    @State private var moving = false
    @State private var failed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("No update from your iPhone for over a day.")
                .font(.plBody).foregroundStyle(PL.text300)
            Button {
                Task {
                    moving = true
                    failed = false
                    let moved = await DeviceHandCutQueue.releaseToMac(jobId: jobId)
                    moving = false
                    if moved { onMoved() } else { failed = true }
                }
            } label: {
                Text(DeviceCutCopy.cutOnMac).frame(maxWidth: .infinity, minHeight: 28)
            }
            .buttonStyle(PLSecondaryButtonStyle())
            .disabled(moving)
            if failed {
                Text(DeviceCutCopy.moveFailed).font(.plBody).foregroundStyle(PL.warningText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .plCard()
    }
}

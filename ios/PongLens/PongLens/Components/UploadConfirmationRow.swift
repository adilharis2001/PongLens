import SwiftUI

/// The first-upload checkbox. A real 44pt control: the whole row is the
/// button, and ticking it writes upload_confirmed_at so the row never shows
/// again on any device.
///
/// The parent owns `ticked` and shows the row while
/// `UploadConsent.shared.needed || ticked`, so it stays on screen, ticked,
/// for the rest of that visit instead of vanishing under the finger.
struct UploadConfirmationRow: View {
    @Binding var ticked: Bool
    @State private var saving = false
    @State private var failed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                Task { await tick() }
            } label: {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: ticked ? "checkmark.square.fill" : "square")
                        .font(.system(size: 22, weight: .medium))
                        .foregroundStyle(ticked ? PL.cyan : PL.text400)
                        .frame(width: 28, height: 28)
                    Text(UploadConsent.label)
                        .font(.plBody)
                        .foregroundStyle(PL.text200)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(saving || ticked)
            .accessibilityAddTraits(ticked ? [.isSelected] : [])
            if failed {
                Text("Couldn't save that. Try again.")
                    .font(.plCaption)
                    .foregroundStyle(PL.dangerText)
            }
        }
    }

    private func tick() async {
        guard !ticked else { return }
        saving = true
        failed = false
        ticked = true
        if !(await UploadConsent.shared.confirm()) {
            ticked = false
            failed = true
        }
        saving = false
    }
}

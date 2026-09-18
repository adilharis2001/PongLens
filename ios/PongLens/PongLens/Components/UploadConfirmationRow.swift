import SwiftUI

/// The first-upload checkbox. A real 44pt control: the whole row is the
/// button.
///
/// It writes nothing. Ticking sets a flag the screen owns, and the screen
/// saves the answer through `UploadConsent.confirmIfNeeded()` at the
/// moment the upload actually starts. Saving on the tap instead meant a
/// tick that was never followed by an upload confirmed the account
/// anyway, so the box never came back and the first real upload had
/// nothing in front of it.
///
/// It unticks as well, because nothing is written until the upload
/// begins, so changing your mind is free. The parent shows the row while
/// `UploadConsent.shared.needed || ticked`, so it stays on screen for the
/// rest of that visit instead of vanishing under the finger.
///
/// `failed` is the screen's word that the save at upload time did not
/// land, shown here so it sits beside the box it is about.
struct UploadConfirmationRow: View {
    @Binding var ticked: Bool
    var failed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                ticked.toggle()
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
            .accessibilityAddTraits(ticked ? [.isSelected] : [])
            if failed {
                Text("Couldn't save that. Try again.")
                    .font(.plCaption)
                    .foregroundStyle(PL.dangerText)
            }
        }
    }
}

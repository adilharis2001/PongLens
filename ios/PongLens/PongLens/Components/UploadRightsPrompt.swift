import SwiftUI

/// The camera's one question for a new account, asked when the camera
/// opens rather than drawn over the picture: the upload rights sentence,
/// Agree or Cancel.
///
/// It replaced the checkbox row that sat above the shutter until
/// 2026-09-26. The import and lesson screens keep `UploadConfirmationRow`,
/// because on a form the box belongs with the rest of the answers; on a
/// camera it was a panel over the viewfinder for as long as the account
/// had never uploaded.
///
/// Agree writes nothing, the same as ticking the box. The record screen
/// saves the answer at the shutter, when this recording's upload begins,
/// and decides what closing means (`RecordConsentPrompt`): anything but
/// Agree, a swipe down included, leaves the camera.
///
/// `failed` is the screen's word that the save at the shutter did not
/// land. The screen asks again with it, so the line sits in the sheet
/// instead of over the viewfinder.
struct UploadRightsPrompt: View {
    var failed = false
    let onAgree: () -> Void
    let onCancel: () -> Void

    var body: some View {
        PLSheetScaffold(title: "Before you record", showDone: false) {
            // Scrolls only if the words outgrow the sheet (the largest
            // text sizes); otherwise it sits still.
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(UploadConsent.label)
                        .font(.plBody)
                        .foregroundStyle(PL.text200)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if failed {
                        Text("Couldn't save that. Try again.")
                            .font(.plCaption)
                            .foregroundStyle(PL.dangerText)
                    }
                    // Full width and stacked, the label sized before the
                    // style so the whole capsule is the hit area: 52pt for
                    // the primary, 44pt for the outlined one.
                    VStack(spacing: 10) {
                        Button(action: onAgree) {
                            Text("Agree").frame(maxWidth: .infinity, minHeight: 28)
                        }
                        .buttonStyle(PLPrimaryButtonStyle())
                        Button(action: onCancel) {
                            Text("Cancel").frame(maxWidth: .infinity, minHeight: 28)
                        }
                        .buttonStyle(PLSecondaryButtonStyle())
                    }
                    .padding(.top, 4)
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 16)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .presentationDetents([.height(failed ? 300 : 270)])
        // The camera is landscape, and a sheet on a sideways iPhone
        // otherwise fills the whole screen and hides the picture it is
        // asking about. Without adapting, it stays a card of this height
        // over the camera (checked in the simulator, 2026-09-26).
        .presentationCompactAdaptation(.none)
        .presentationDragIndicator(.visible)
    }
}

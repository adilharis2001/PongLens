import SwiftUI

/// The permission sheet in front of every feature that sends content to
/// OpenAI or Deepgram. Raised by AiConsent.ensure(), dressed the way the
/// share sheet is: title at the top, content beneath, a fixed detent and
/// the grabber showing. Twin of src/components/AiConsentSheet.tsx; the
/// copy is identical on both platforms.
struct AiConsentSheet: View {
    static let detentHeight: CGFloat = 300

    @State private var saving = false
    @State private var failed = false
    @State private var answered = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("AI features")
                .font(.plPageTitle)
                .tracking(-0.6)
                .foregroundStyle(PL.textBody)
                .padding(.bottom, 4)

            Text("Deepgram turns voice notes into text. OpenAI reads notes, photos and lesson recordings for summaries, Ask and Improve with AI. Neither may use your content to train its models. Switch this off any time in Account.")
                .font(.plBody)
                .foregroundStyle(PL.text300)
                .fixedSize(horizontal: false, vertical: true)

            if failed {
                Text("Couldn't save that. Try again.")
                    .font(.plCaption)
                    .foregroundStyle(PL.dangerText)
            }

            VStack(spacing: 10) {
                Button {
                    Task { await allow() }
                } label: {
                    Text(saving ? "Saving…" : "Allow")
                        .frame(maxWidth: .infinity, minHeight: 20)
                }
                .buttonStyle(PLPrimaryButtonStyle())
                .disabled(saving)

                Button {
                    answer(false)
                } label: {
                    Text("Not now")
                        .frame(maxWidth: .infinity, minHeight: 28)
                }
                .buttonStyle(PLSecondaryButtonStyle())
                .disabled(saving)
            }
            .padding(.top, 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, 20)
        .padding(.top, 28)
        .padding(.bottom, 20)
        .background(PL.surface)
        .onDisappear {
            // Swiped away: the same answer as Not now.
            if !answered { AiConsent.shared.resolve(false) }
        }
    }

    private func allow() async {
        saving = true
        failed = false
        let ok = await AiConsent.shared.setEnabled(true)
        saving = false
        if ok {
            answer(true)
        } else {
            failed = true
        }
    }

    private func answer(_ allowed: Bool) {
        answered = true
        AiConsent.shared.resolve(allowed)
        AiConsent.shared.dismissSheet()
    }
}

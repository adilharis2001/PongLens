import SwiftUI

/// The permission sheet in front of every feature that sends content to
/// OpenAI or Deepgram. Raised by AiConsent.ensure(), dressed the way the
/// share sheet is: title at the top, content beneath, a fixed detent and
/// the grabber showing. Twin of src/components/AiConsentSheet.tsx; the
/// copy is identical on both platforms.
struct AiConsentSheet: View {
    static let detentHeight: CGFloat = 380

    /// The two paragraphs. Identical to AI_CONSENT_COPY in
    /// src/lib/aiConsentCopy.ts; aiConsentCopy.test.ts checks it.
    static let copy = [
        "OpenAI checks still frames from each match you record or upload, to confirm it is table tennis and to find the table. It also reads notes, photos and lesson recordings for summaries, Ask and Improve with AI. Deepgram turns voice notes into text. Neither may use your content to train its models.",
        "Recording and uploading matches need this. Switch it off any time in Account.",
    ]

    @State private var saving = false
    @State private var failed = false
    @State private var answered = false

    var body: some View {
        // Scrolls only when the words outgrow the sheet: the largest text
        // sizes, or a sideways phone, where the camera's shutter can raise
        // it and a sheet is as tall as the screen allows.
        ScrollView {
            content
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(PL.surface)
        .onDisappear {
            // Swiped away: the same answer as Not now.
            if !answered { AiConsent.shared.resolve(false) }
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("AI features")
                .font(.plPageTitle)
                .tracking(-0.6)
                .foregroundStyle(PL.textBody)
                .padding(.bottom, 4)

            ForEach(Self.copy, id: \.self) { paragraph in
                Text(paragraph)
                    .font(.plBody)
                    .foregroundStyle(PL.text300)
                    .fixedSize(horizontal: false, vertical: true)
            }

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
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .padding(.horizontal, 20)
        .padding(.top, 28)
        .padding(.bottom, 20)
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

    /// The answer goes out once the sheet has gone, so whatever the caller
    /// presents next is not refused for arriving mid-dismissal.
    private func answer(_ allowed: Bool) {
        answered = true
        AiConsent.shared.dismissSheet {
            AiConsent.shared.resolve(allowed)
        }
    }
}

import SwiftUI

struct JournalScreen: View {
    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("Journal")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)

                    VStack(spacing: 12) {
                        Text("📓").font(.system(size: 40))
                        Text("Your journal starts here")
                            .font(.plCardTitle)
                            .foregroundStyle(PL.text100)
                        Text("Notes from your matches collect here on their own. Add a lesson or a practice entry with New. Type it, speak it, or paste it.")
                            .font(.plBody)
                            .foregroundStyle(PL.text400)
                            .multilineTextAlignment(.center)
                            .lineSpacing(4)
                    }
                    .frame(maxWidth: .infinity)
                    .plCard(padding: 40)
                }
                .padding(20)
                .padding(.top, 12)
                .padding(.bottom, 100)
            }

            PLFab(label: "New", systemImage: "plus") {}
                .padding(20)
        }
    }
}

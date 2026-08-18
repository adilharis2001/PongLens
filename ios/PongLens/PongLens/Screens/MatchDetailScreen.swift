import SwiftUI

/// Stub — the full match experience (player, points, scorekeeper) is the
/// next major build phase.
struct MatchDetailScreen: View {
    let match: MatchRow
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let parts = MatchTitle.parts(for: match)
        ZStack {
            ArenaBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Button {
                        dismiss()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 12, weight: .semibold))
                            Text("Matches")
                        }
                        .font(.plButtonSecondary)
                    }
                    .buttonStyle(PLSecondaryButtonStyle())

                    Text(parts.primary)
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)
                    Text(parts.secondary)
                        .font(.plBody)
                        .foregroundStyle(PL.text500)

                    ThumbPlaceholder()
                        .aspectRatio(16 / 9, contentMode: .fit)
                        .clipShape(RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                                .strokeBorder(PL.edge, lineWidth: 1)
                        )

                    Text("The match player lands here next.")
                        .font(.plBody)
                        .foregroundStyle(PL.text500)
                }
                .padding(20)
                .padding(.bottom, 100)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
    }
}

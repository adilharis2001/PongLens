import SwiftUI

struct MatchesScreen: View {
    @Environment(AppState.self) private var app
    @Environment(LibraryStore.self) private var library
    @Environment(MediaStore.self) private var media
    @Environment(ScoresStore.self) private var scores
    @State private var query = ""

    private var ownMatches: [MatchRow] {
        guard let uid = app.userId else { return [] }
        return library.matches.filter { $0.userId == uid }
    }

    private var filtered: [MatchRow] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return ownMatches }
        return ownMatches.filter {
            let parts = MatchTitle.parts(for: $0)
            return parts.primary.lowercased().contains(q)
                || parts.secondary.lowercased().contains(q)
        }
    }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Matches")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)

                    if let error = library.lastError {
                        Text(error)
                            .font(.plCaption)
                            .foregroundStyle(PL.dangerText)
                            .plCard(padding: 14)
                    }

                    searchField

                    content
                }
                .padding(20)
                .padding(.top, 12)
                .padding(.bottom, 120)
            }
            .refreshable { await library.load() }

            PLFab(label: "Upload", systemImage: "arrow.up") {}
                .padding(20)
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14))
                .foregroundStyle(PL.text500)
            TextField("Search matches", text: $query)
                .font(.plBody)
                .foregroundStyle(PL.text200)
                .tint(PL.cyan)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(PL.surface2, in: Capsule())
        .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
    }

    @ViewBuilder
    private var content: some View {
        if !library.loaded {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible())], spacing: 16) {
                ForEach(0..<4, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                        .fill(PL.surface)
                        .aspectRatio(4 / 4.4, contentMode: .fit)
                        .opacity(0.6)
                }
            }
        } else if ownMatches.isEmpty {
            VStack(spacing: 12) {
                Text("🏓").font(.system(size: 40))
                Text("No matches yet")
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                Text("Upload your first match. When processing finishes it will appear here, broken into points and ready to review.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
                Button("Upload a match") {}
                    .buttonStyle(PLPrimaryButtonStyle())
                    .padding(.top, 8)
            }
            .frame(maxWidth: .infinity)
            .plCard(padding: 40)
        } else if filtered.isEmpty {
            Text("No matches for \"\(query)\" with these filters.")
                .font(.plBody)
                .foregroundStyle(PL.text400)
                .frame(maxWidth: .infinity)
                .plCard(padding: 32)
        } else {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible())], spacing: 20) {
                ForEach(filtered) { match in
                    NavigationLink(value: match) {
                        MatchCard(
                            match: match,
                            thumbURL: media.thumbURL(match.id),
                            score: scores.scores[match.id]
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

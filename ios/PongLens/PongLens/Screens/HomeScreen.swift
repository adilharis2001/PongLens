import SwiftUI

struct HomeScreen: View {
    @Environment(AppState.self) private var app
    @Environment(Router.self) private var router
    @Environment(LibraryStore.self) private var library
    @Environment(MediaStore.self) private var media
    @Environment(ScoresStore.self) private var scores

    private var ownMatches: [MatchRow] {
        guard let uid = app.userId else { return [] }
        return library.matches.filter { $0.userId == uid }
    }

    private var latestReady: MatchRow? {
        ownMatches.first { $0.status == .ready }
    }

    private var processingCount: Int {
        ownMatches.filter { $0.status == .processing }.count + library.activeJobs.count
    }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            ScrollView {
                VStack(alignment: .leading, spacing: 36) {
                    Text("Hey \(app.firstName) 👋")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)

                    if let error = library.lastError {
                        Text(error)
                            .font(.plCaption)
                            .foregroundStyle(PL.dangerText)
                            .plCard(padding: 14)
                    }

                    nextAction

                    if !ownMatches.isEmpty {
                        recentMatches
                    }
                }
                .padding(20)
                .padding(.top, 12)
                .padding(.bottom, 120)
            }
            .refreshable { await library.load() }

            PLFab(label: "Upload", systemImage: "tray.and.arrow.up") {}
                .padding(20)
        }
    }

    @ViewBuilder
    private var nextAction: some View {
        if !library.loaded {
            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                .fill(PL.surface)
                .frame(height: 128)
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                        .strokeBorder(PL.edge, lineWidth: 1)
                )
                .opacity(0.6)
        } else if ownMatches.isEmpty && library.activeJobs.isEmpty {
            VStack(spacing: 12) {
                Text("🏓").font(.system(size: 40))
                Text("Upload your first match")
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                Text("PongLens cuts the dead time out of your footage and breaks the match into points, so you can review it point by point and add notes for yourself or a coach.")
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
        } else if processingCount > 0 {
            VStack(alignment: .leading, spacing: 10) {
                StatusChip(status: .processing)
                Text(processingCount == 1 ? "Your match is processing" : "\(processingCount) matches are processing")
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                Text("Most videos finish in under 30 minutes. We'll email you when it's ready.")
                    .font(.plBody)
                    .foregroundStyle(PL.text400)
                if let ready = latestReady {
                    NavigationLink(value: ready) {
                        HStack(spacing: 4) {
                            Text("Meanwhile: review \(MatchTitle.parts(for: ready).primary)")
                            Image(systemName: "arrow.right")
                        }
                        .font(.plBody)
                        .foregroundStyle(PL.cyan)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .plCard()
        } else if let match = latestReady {
            NavigationLink(value: match) {
                let parts = MatchTitle.parts(for: match)
                HStack(spacing: 14) {
                    MatchThumb(url: media.thumbURL(match.id))
                        .frame(width: 128, height: 80)
                        .clipShape(RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                                .strokeBorder(PL.edge, lineWidth: 1)
                        )
                    VStack(alignment: .leading, spacing: 5) {
                        Text(continueEyebrow(for: match))
                            .font(.plSection)
                            .tracking(0.6)
                            .foregroundStyle(PL.cyan)
                            .textCase(.uppercase)
                        Text(parts.primary)
                            .font(.plCardTitle)
                            .foregroundStyle(PL.text100)
                            .lineLimit(1)
                        Text(parts.secondary)
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                            .lineLimit(1)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(PL.text600)
                }
                .plCard(padding: 16)
            }
            .buttonStyle(.plain)
        }
    }

    private func continueEyebrow(for match: MatchRow) -> String {
        guard let entry = scores.scores[match.id] else { return "Continue" }
        if entry.unscoredCount > 0 && entry.confirmedCount == 0 { return "Score it" }
        if entry.unscoredCount > 0 { return "Keep scoring" }
        return "Continue"
    }

    private var recentMatches: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                SectionHeading("Recent matches")
                Spacer()
                Button {
                    router.tab = .matches
                } label: {
                    HStack(spacing: 3) {
                        Text("View all")
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11, weight: .semibold))
                    }
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(PL.cyan)
                }
            }
            VStack(spacing: 10) {
                ForEach(ownMatches.prefix(3)) { match in
                    NavigationLink(value: match) {
                        MatchListRow(
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

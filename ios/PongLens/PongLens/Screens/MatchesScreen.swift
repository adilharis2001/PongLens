import SwiftUI

enum LibraryStatusFilter: String, CaseIterable {
    case all = "All", ready = "Ready", notProcessed = "Not processed",
         processing = "Processing", failed = "Failed"
}

enum LibraryTypeFilter: String, CaseIterable {
    case any = "Any type", drills = "Drills", practice = "Practice",
         match = "Match", league = "League", tournament = "Tournament"
}

enum LibraryScoreFilter: String, CaseIterable {
    case any = "Any score", scored = "Scored", unscored = "Unscored"
}

enum LibrarySort: String, CaseIterable {
    case uploaded = "Recently uploaded", played = "Match date"
}

struct MatchesScreen: View {
    @Environment(AppState.self) private var app
    @Environment(Router.self) private var router
    @Environment(LibraryStore.self) private var library
    @Environment(MediaStore.self) private var media
    @Environment(ScoresStore.self) private var scores
    @State private var query = ""
    @State private var filtersOpen = false
    @State private var statusFilter: LibraryStatusFilter = .all
    @State private var typeFilter: LibraryTypeFilter = .any
    @State private var scoreFilter: LibraryScoreFilter = .any
    @State private var sort: LibrarySort = .uploaded

    private var ownMatches: [MatchRow] {
        guard let uid = app.userId else { return [] }
        return library.matches.filter { $0.userId == uid }
    }

    private var filtersActive: Bool {
        statusFilter != .all || typeFilter != .any || scoreFilter != .any || sort != .uploaded
    }

    private var filtered: [MatchRow] {
        var list = ownMatches

        switch statusFilter {
        case .all: break
        case .ready: list = list.filter { $0.status == .ready }
        case .notProcessed: list = list.filter { $0.status == .uploaded }
        case .processing: list = list.filter { $0.status == .processing }
        case .failed: list = list.filter { $0.status == .failed }
        }

        if typeFilter != .any {
            list = list.filter { $0.matchType == typeFilter.rawValue.lowercased() }
        }

        switch scoreFilter {
        case .any: break
        case .scored:
            list = list.filter { (scores.scores[$0.id]?.confirmedCount ?? 0) > 0 }
        case .unscored:
            list = list.filter { (scores.scores[$0.id]?.confirmedCount ?? 0) == 0 }
        }

        if sort == .played {
            list = list.sorted {
                (PGDate.parse($0.playedAt) ?? .distantPast) > (PGDate.parse($1.playedAt) ?? .distantPast)
            }
        }

        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return list }
        return list.filter {
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

                    HStack(spacing: 10) {
                        searchField
                        Button {
                            filtersOpen = true
                        } label: {
                            Image(systemName: "line.3.horizontal.decrease")
                                .font(.system(size: 15, weight: .medium))
                                .foregroundStyle(filtersActive ? PL.cyan : PL.text400)
                                .frame(width: 44, height: 44)
                                .overlay(
                                    RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                                        .strokeBorder(
                                            filtersActive ? PL.cyan.opacity(0.5) : PL.edge,
                                            lineWidth: 1
                                        )
                                )
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Filter matches")
                    }

                    content
                }
                .padding(20)
                .padding(.top, 12)
                .padding(.bottom, 120)
            }
            .refreshable { await library.load() }

            PLFabStack()
                .padding(20)
        }
        .sheet(isPresented: $filtersOpen) {
            LibraryFilterSheet(
                status: $statusFilter, type: $typeFilter,
                score: $scoreFilter, sort: $sort
            )
            .presentationDetents([.medium, .large])
            .presentationBackground(PL.surface)
            .presentationDragIndicator(.visible)
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
        .frame(height: 44)
        .background(PL.surface2.opacity(0.4), in: RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                .strokeBorder(PL.edge, lineWidth: 1)
        )
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
                Button("Upload a match") { router.uploadOpen = true }
                    .buttonStyle(PLPrimaryButtonStyle())
                    .padding(.top, 8)
            }
            .frame(maxWidth: .infinity)
            .plCard(padding: 40)
        } else if filtered.isEmpty {
            Text(query.isEmpty
                ? "No matches with these filters."
                : "No matches for \"\(query)\" with these filters.")
                .font(.plBody)
                .foregroundStyle(PL.text400)
                .frame(maxWidth: .infinity)
                .plCard(padding: 32)
        } else {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible())], spacing: 16) {
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

struct LibraryFilterSheet: View {
    @Binding var status: LibraryStatusFilter
    @Binding var type: LibraryTypeFilter
    @Binding var score: LibraryScoreFilter
    @Binding var sort: LibrarySort

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                SectionHeading("Status")
                wrapRow(LibraryStatusFilter.allCases, selection: $status)
                SectionHeading("Type")
                wrapRow(LibraryTypeFilter.allCases, selection: $type)
                SectionHeading("Score")
                wrapRow(LibraryScoreFilter.allCases, selection: $score)
                SectionHeading("Sort")
                wrapRow(LibrarySort.allCases, selection: $sort)
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func wrapRow<T: RawRepresentable & CaseIterable & Hashable>(
        _ options: T.AllCases, selection: Binding<T>
    ) -> some View where T.RawValue == String {
        FlowLayout(spacing: 8) {
            ForEach(Array(options), id: \.self) { option in
                let active = selection.wrappedValue == option
                Button(option.rawValue) {
                    selection.wrappedValue = option
                }
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(active ? PL.cyan : PL.text500)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(active ? PL.cyan.opacity(0.15) : .clear, in: Capsule())
                .overlay(
                    Capsule().strokeBorder(active ? PL.cyan.opacity(0.5) : PL.edge, lineWidth: 1)
                )
                .buttonStyle(.plain)
            }
        }
    }
}

/// Minimal wrapping layout for filter chip rows.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    /// Children are measured against the row width, never unbounded — a
    /// chip whose label outgrows the screen wraps to a second line inside
    /// its own capsule instead of running off the right edge (a long
    /// Working-on cue did exactly that).
    private func measure(_ view: LayoutSubview, maxWidth: CGFloat) -> CGSize {
        view.sizeThatFits(ProposedViewSize(width: maxWidth, height: nil))
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 320
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        for view in subviews {
            let size = measure(view, maxWidth: width)
            if x + size.width > width, x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: width, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for view in subviews {
            let size = measure(view, maxWidth: bounds.width)
            if x + size.width > bounds.maxX, x > bounds.minX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

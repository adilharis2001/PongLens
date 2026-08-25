import AVFoundation
import SwiftUI

/// Every point the player has starred, across every match, in one place
/// (Account -> Your game). The web twin is src/app/starred.
///
/// Tapping a tile does not open that point on its own — it starts the
/// whole set playing from there. A grid you have to open and close one
/// rally at a time is a file browser; a grid that becomes a reel is a
/// highlights tape, and the tape is the reason to keep stars in one place.
struct StarredScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    @Environment(LibraryStore.self) private var library

    @State private var store = StarredStore()
    @State private var openIndex: StarredIndex?
    /// Handed over by the player on the way out (see onChange below).
    @State private var pendingMatch: StarredPointRow?
    @State private var openMatch: MatchPointRoute?
    /// Which match's starred set is being shared, when the group header's
    /// share button is tapped.
    @State private var shareMatch: MatchRow?
    /// The emergency switch (136); an unreadable row answers "on".
    @State private var sharingOn = true

    var body: some View {
        ZStack {
            ArenaBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Button {
                        dismiss()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 12, weight: .semibold))
                            Text("Back")
                        }
                    }
                    .buttonStyle(PLSecondaryButtonStyle())

                    header

                    if !store.loaded {
                        loading
                    } else if store.rows.isEmpty {
                        empty
                    } else {
                        shelf
                    }
                }
                .padding(20)
                .padding(.bottom, 60)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .overlay(alignment: .bottom) { undoBar }
        .task {
            sharingOn = await StoryShareModel.sharingEnabled()
            await store.load(userId: app.userId)
        }
        .sheet(item: $shareMatch) { match in
            ShareHighlightsSheet(
                match: match,
                starredCount: store.groups
                    .first { $0.matchId == match.id }?.points.count ?? 0
            )
            .presentationDetents([.height(ShareHighlightsSheet.detentHeight)])
            .presentationBackground(PL.surface)
            .presentationDragIndicator(.visible)
        }
        .fullScreenCover(item: $openIndex) { start in
            StarredPlayerScreen(
                store: store,
                index: start.value,
                onOpenInMatch: { row in pendingMatch = row }
            )
        }
        // The cover has no navigation stack of its own, so "Open in match"
        // hands the row back and the push happens here, after the cover is
        // down. Raising a push into a dismissing cover loses the race and
        // simply does nothing — the same trap the new-match chooser hit.
        .onChange(of: openIndex) { _, now in
            guard now == nil, let row = pendingMatch else { return }
            pendingMatch = nil
            guard let match = library.matches.first(where: { $0.id == row.matchId })
            else { return }
            openMatch = MatchPointRoute(match: match, pointId: row.id)
        }
        .navigationDestination(item: $openMatch) { route in
            MatchDetailScreen(match: route.match, openPointId: route.pointId)
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Starred points")
                    .font(.plPageTitle)
                    .tracking(-0.6)
                    .foregroundStyle(PL.textBody)
                if !store.rows.isEmpty {
                    Text(starredSummaryLine(store.rows))
                        .font(.plBody)
                        .monospacedDigit()
                        .foregroundStyle(PL.text500)
                }
            }
            Spacer(minLength: 12)
            if !store.rows.isEmpty {
                Button {
                    openIndex = StarredIndex(value: 0)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "play.fill")
                            .font(.system(size: 11, weight: .bold))
                        Text("Play all")
                    }
                }
                .buttonStyle(PLCyanGhostButtonStyle())
            }
        }
    }

    private var loading: some View {
        VStack(spacing: 12) {
            ForEach(0..<3, id: \.self) { _ in
                RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                    .fill(PL.surface)
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .overlay(
                        RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                            .strokeBorder(PL.edge, lineWidth: 1)
                    )
            }
        }
        .opacity(0.6)
    }

    private var empty: some View {
        VStack(spacing: 16) {
            Text("No starred points yet. Tap the star on any point to keep it here.")
                .font(.plBody)
                .foregroundStyle(PL.text500)
                .multilineTextAlignment(.center)
                .lineSpacing(3)
            Button("Go to matches") { dismiss() }
                .buttonStyle(PLSecondaryButtonStyle())
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
        .padding(.horizontal, 20)
        .plCard(padding: 0)
    }

    // MARK: - The shelf

    private var shelf: some View {
        LazyVStack(alignment: .leading, spacing: 28) {
            ForEach(store.groups) { group in
                VStack(alignment: .leading, spacing: 14) {
                    groupHeader(group)
                    LazyVGrid(
                        columns: [
                            GridItem(.adaptive(minimum: 260), spacing: 12)
                        ],
                        spacing: 12
                    ) {
                        ForEach(group.points) { row in
                            StarredTile(
                                row: row,
                                reasons: store.customReasons,
                                onOpen: { open(row) },
                                onUnstar: { Task { await store.unstar(row) } }
                            )
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func groupHeader(_ group: StarredGroup) -> some View {
        let destination = library.matches.first { $0.id == group.matchId }
        let content = HStack(spacing: 12) {
            Group {
                if group.hasThumb {
                    MatchThumb(matchId: group.matchId)
                } else {
                    Rectangle().fill(PL.surface2)
                }
            }
            .frame(width: 88, height: 50)
            .clipShape(RoundedRectangle(cornerRadius: PL.rField, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            )

            VStack(alignment: .leading, spacing: 2) {
                Text(group.title)
                    .font(.plCardTitle)
                    .foregroundStyle(PL.text100)
                    .lineLimit(1)
                Text(group.subtitle)
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            HStack(spacing: 4) {
                Text("\(group.points.count) point\(group.points.count == 1 ? "" : "s")")
                    .font(.plCaption)
                    .monospacedDigit()
                if destination != nil {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                }
            }
            .foregroundStyle(PL.text500)
        }

        if let destination {
            HStack(spacing: 10) {
                NavigationLink(value: destination) { content }
                    .buttonStyle(.plain)
                if sharingOn {
                    // Outside the link on purpose: a button nested inside
                    // a NavigationLink's label fights it for the tap.
                    Button {
                        shareMatch = destination
                    } label: {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(PL.text200)
                            .frame(width: 38, height: 38)
                            .background(PL.surface2, in: Circle())
                            .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        } else {
            content
        }
    }

    private func open(_ row: StarredPointRow) {
        guard let i = store.rows.firstIndex(where: { $0.id == row.id }) else { return }
        openIndex = StarredIndex(value: i)
    }

    // MARK: - Undo

    @ViewBuilder
    private var undoBar: some View {
        if let row = store.undo {
            HStack(spacing: 14) {
                Text("Star removed")
                    .font(.plBody)
                    .foregroundStyle(PL.text300)
                Button("Undo") { Task { await store.putBack(row) } }
                    .buttonStyle(PLSecondaryButtonStyle())
            }
            .padding(.leading, 18)
            .padding(.trailing, 8)
            .padding(.vertical, 8)
            .background(PL.surface.opacity(0.96), in: Capsule())
            .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
            .padding(.bottom, 28)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .task(id: row.id) {
                try? await Task.sleep(for: .seconds(7))
                if store.undo?.id == row.id { store.undo = nil }
            }
        }
    }
}

/// `fullScreenCover(item:)` needs an Identifiable, and an Int is not one.
struct StarredIndex: Identifiable, Hashable {
    let value: Int
    var id: Int { value }
}

// MARK: - Tile

/// One starred rally: a real frame out of its own clip, with the four
/// facts in the corners. The wash underneath carries the tile until the
/// frame arrives, and stays if it never does.
struct StarredTile: View {
    let row: StarredPointRow
    let reasons: [CustomReason]
    let onOpen: () -> Void
    let onUnstar: () -> Void

    private var tint: Color {
        switch row.outcome {
        case .won: PL.cyan
        case .lost: PL.magentaSoft
        case .skipped: PL.warningText
        case .unscored: PL.text400
        }
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [tint.opacity(0.16), tint.opacity(0.04), .clear],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            // What the tile looks like before the frame arrives: the
            // point's own number, big enough to be the picture.
            HStack {
                Spacer()
                Text("\(row.displayNo)")
                    .font(.system(size: 76, weight: .black))
                    .monospacedDigit()
                    .foregroundStyle(.white.opacity(0.06))
                    .padding(.trailing, 12)
            }

            if row.hasClip, !row.edited {
                ClipFrame(
                    matchId: row.matchId, pointId: row.id, at: row.posterTime
                )
            }

            // Legibility for the four corners, without flattening the frame.
            VStack(spacing: 0) {
                LinearGradient(
                    colors: [PL.ink.opacity(0.7), .clear],
                    startPoint: .top, endPoint: .bottom
                )
                .frame(height: 54)
                Spacer(minLength: 0)
                LinearGradient(
                    colors: [.clear, PL.ink.opacity(0.5), PL.ink.opacity(0.9)],
                    startPoint: .top, endPoint: .bottom
                )
                .frame(height: 68)
            }

            chrome
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                .strokeBorder(PL.edge, lineWidth: 1)
        )
        .contentShape(Rectangle())
        .onTapGesture(perform: onOpen)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Point \(row.displayNo), \(row.outcomeLabel)")
        .accessibilityAddTraits(.isButton)
    }

    /// Small text sitting directly on a video frame. A scrim alone cannot
    /// carry it: these clips are shot in halls with white floors, and the
    /// bottom of the frame — exactly where the caption goes — is the
    /// brightest part of the picture.
    private func onFrame(_ view: some View) -> some View {
        view
            .shadow(color: .black.opacity(0.95), radius: 2, y: 1)
            .shadow(color: .black.opacity(0.6), radius: 6)
    }

    private var chrome: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 8) {
                HStack(spacing: 7) {
                    Circle().fill(tint).frame(width: 6, height: 6)
                    onFrame(
                        Text(row.outcomeLabel)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(tint)
                            .lineLimit(1)
                    )
                }
                Spacer(minLength: 0)
                Button(action: onUnstar) {
                    Image(systemName: "star.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(Color(hex: 0xFFD230))
                        .padding(6)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(-6)
                .accessibilityLabel("Remove the star from point \(row.displayNo)")
            }

            Spacer(minLength: 0)

            HStack(alignment: .bottom, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    if let sub = subtitle {
                        onFrame(
                            Text(sub)
                                .font(.system(size: 11))
                                .foregroundStyle(PL.text200)
                                .lineLimit(1)
                        )
                    }
                    onFrame(
                        HStack(spacing: 5) {
                            Image(systemName: "play.fill")
                                .font(.system(size: 9))
                                .foregroundStyle(.white.opacity(0.75))
                            Text("Point \(row.displayNo)")
                                .font(.system(size: 12, weight: .semibold))
                                .monospacedDigit()
                                .foregroundStyle(.white)
                        }
                    )
                }
                Spacer(minLength: 0)
                onFrame(
                    Text(row.edited ? "Updating clip" : (row.durationLabel ?? ""))
                        .font(.system(size: 11, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(PL.text200)
                )
            }
        }
        .padding(13)
    }

    private var subtitle: String? {
        let parts = [row.reasonLabel(custom: reasons), row.directionLabel]
            .compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

// MARK: - The sequence player

/// The starred set, played as a tape.
///
/// `ClipPlayerView` is the point sheet's own player, so the pinch zoom,
/// the speed control and their persistence all arrive here without being
/// written twice. What this adds is what makes it a sequence: advance on
/// the clip ending, prev/next, and minting the NEXT clip's link while the
/// current one plays, so the gap between rallies is not a spinner.
struct StarredPlayerScreen: View {
    let store: StarredStore
    @State var index: Int
    /// Pushed onto the shelf's navigation stack after this closes; the
    /// cover has no stack of its own to push onto.
    let onOpenInMatch: (StarredPointRow) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var player = AVPlayer()
    @State private var url: URL?
    @State private var failed = false
    @State private var loadSeq = 0

    private var row: StarredPointRow? {
        store.rows.indices.contains(index) ? store.rows[index] : nil
    }

    var body: some View {
        ZStack {
            PL.ink.ignoresSafeArea()
            if let row {
                VStack(spacing: 0) {
                    header(row)
                    Spacer(minLength: 0)
                    picture(row)
                    controls(row)
                    Spacer(minLength: 0)
                }
            } else {
                ProgressView().tint(PL.cyan)
            }
        }
        .task(id: row?.id) { await load() }
        .onChange(of: store.rows.count) { _, count in
            // A star removed under the player: stand on whatever took its
            // place, or leave when there is nothing left.
            if count == 0 { dismiss() }
            else if index >= count { index = count - 1 }
        }
    }

    // MARK: Parts

    private func header(_ row: StarredPointRow) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    Text("Point \(row.displayNo)")
                        .font(.system(size: 15, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(PL.text100)
                    Text(row.opponentName?.trimmingCharacters(in: .whitespaces).isEmpty == false
                         ? row.opponentName! : "Match")
                        .font(.plBody)
                        .foregroundStyle(PL.text500)
                        .lineLimit(1)
                }
                Text(
                    "\(index + 1) of \(store.rows.count)"
                    + (row.durationLabel.map { " · \($0)" } ?? "")
                )
                .font(.plCaption)
                .monospacedDigit()
                .foregroundStyle(PL.text500)
            }
            Spacer(minLength: 0)
            Button {
                player.pause()
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PL.text300)
                    .frame(width: 34, height: 34)
                    .background(PL.surface, in: Circle())
                    .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")
        }
        .padding(.horizontal, 20)
        .padding(.top, 10)
        .padding(.bottom, 16)
    }

    @ViewBuilder
    private func picture(_ row: StarredPointRow) -> some View {
        if url != nil || !failed {
            ClipPlayerView(
                player: player,
                url: url,
                starred: true,
                tagged: false,
                updating: row.edited,
                hasPrev: index > 0,
                hasNext: index < store.rows.count - 1,
                showTag: false,
                onStar: { Task { await store.unstar(row) } },
                onTag: {},
                onPrev: { go(index - 1) },
                onNext: { go(index + 1) },
                onEnded: {
                    if index < store.rows.count - 1 { go(index + 1) }
                }
            )
            .padding(.horizontal, 12)
        } else {
            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                .fill(Color.black)
                .aspectRatio(16 / 9, contentMode: .fit)
                .overlay(
                    Text(row.edited
                         ? "This clip is still being recut."
                         : "Couldn't load this clip.")
                        .font(.plBody)
                        .foregroundStyle(PL.text500)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                        .strokeBorder(PL.edge, lineWidth: 1)
                )
                .padding(.horizontal, 12)
        }
    }

    private func controls(_ row: StarredPointRow) -> some View {
        VStack(spacing: 16) {
            HStack {
                stepButton("chevron.left", enabled: index > 0) { go(index - 1) }
                    .accessibilityLabel("Previous point")
                Spacer(minLength: 8)
                VStack(spacing: 2) {
                    Text(row.outcomeLabel)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(outcomeTint(row))
                    if let reason = row.reasonLabel(custom: store.customReasons) {
                        Text(reason)
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                stepButton("chevron.right", enabled: index < store.rows.count - 1) {
                    go(index + 1)
                }
                .accessibilityLabel("Next point")
            }

            HStack(spacing: 12) {
                Button("Remove star") { Task { await store.unstar(row) } }
                    .buttonStyle(PLSoftDestructiveButtonStyle())
                Button("Open in match") {
                    player.pause()
                    onOpenInMatch(row)
                    dismiss()
                }
                .buttonStyle(PLSecondaryButtonStyle())
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 18)
    }

    private func stepButton(
        _ icon: String, enabled: Bool, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(enabled ? PL.text200 : PL.text600)
                .frame(width: 44, height: 44)
                .background(PL.surface, in: Circle())
                .overlay(Circle().strokeBorder(PL.edge, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    private func outcomeTint(_ row: StarredPointRow) -> Color {
        switch row.outcome {
        case .won: PL.cyan
        case .lost: PL.magentaSoft
        case .skipped: PL.warningText
        case .unscored: PL.text400
        }
    }

    // MARK: Data

    private func go(_ next: Int) {
        guard store.rows.indices.contains(next) else { return }
        index = next
    }

    private func load() async {
        guard let row else { return }
        let mine = loadSeq + 1
        loadSeq = mine
        url = nil
        failed = false
        guard row.hasClip else {
            failed = true
            return
        }
        let link = await clipURL(row)
        guard loadSeq == mine else { return }
        if let link {
            url = link
        } else {
            failed = true
        }
        // Read one ahead: a six second rally does not leave time to notice
        // a round trip, so the round trip happens during the rally before.
        if let next = store.rows[safe: index + 1], next.hasClip {
            _ = await clipURL(next)
        }
    }

    private func clipURL(_ row: StarredPointRow) async -> URL? {
        await ClipLinks.url(matchId: row.matchId, pointId: row.id)
    }
}

/// `navigationDestination(item:)` wants an Identifiable; the route is
/// Hashable because the stack-typed destinations only ever needed that.
extension MatchPointRoute: Identifiable {
    var id: String {
        "\(match.id.uuidString)-\(pointId?.uuidString ?? "")"
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

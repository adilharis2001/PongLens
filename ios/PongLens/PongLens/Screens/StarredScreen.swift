import AVFoundation
import SwiftUI

/// Every point the player has starred, across every match, in one place
/// (Account -> Your game, and View all on Home). The web twin is
/// src/app/starred.
///
/// Since 2026-09-22 (Adil): compact rows grouped by match instead of big
/// tiles; tapping a point plays it full screen, stepping through the stars
/// (never into the match screen); Select picks points across matches to
/// share as one video or one link. No Play all: a point that ends moves on
/// to the next star by itself.
/// Spec: docs/superpowers/specs/2026-09-22-starred-points-selection-design.md
struct StarredScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    @Environment(LibraryStore.self) private var library

    @State private var store = StarredStore()
    @State private var selecting = false
    @State private var selected: Set<UUID> = []
    @State private var run: StarredRun?
    @State private var sharing = false

    private var picked: [StarredPointRow] { selectedInShelfOrder(store.rows, selected) }

    var body: some View {
        ZStack {
            ArenaBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    topBar

                    header

                    if store.rows.contains(where: \.edited),
                       let notice = ProcessingServiceStore.shared.notice(lane: ProcessingServiceStore.shared.clipLane, context: .fast) {
                        ProcessingAvailabilityNoticeView(notice: notice)
                    }

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
        .overlay(alignment: .bottom) {
            if selecting {
                selectionBar
            } else {
                undoBar
            }
        }
        .animation(.easeOut(duration: 0.2), value: selecting && !selected.isEmpty)
        .task { await store.load(userId: app.userId) }
        .onChange(of: store.rows) { _, rows in
            // A point unstarred elsewhere cannot stay picked.
            selected.formIntersection(rows.map(\.id))
        }
        .sheet(isPresented: $sharing) {
            ShareSelectionSheet(rows: picked)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .fullScreenCover(item: $run) { start in
            StarredPlayerScreen(rows: start.rows, index: start.index) { row, on in
                if on { await store.putBack(row) } else { await store.unstar(row) }
            }
        }
    }

    // MARK: - Header

    /// Back on the left, Select or Cancel on the right: where iOS puts
    /// both, in Photos and Mail alike.
    private var topBar: some View {
        HStack {
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
            Spacer()
            if !store.rows.isEmpty {
                Button(selecting ? "Cancel" : "Select") {
                    if selecting { stopSelecting() } else { startSelecting(with: nil) }
                }
                .buttonStyle(PLSecondaryButtonStyle())
            }
        }
    }

    private var header: some View {
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
    }

    private var loading: some View {
        VStack(spacing: 12) {
            ForEach(0..<3, id: \.self) { _ in
                RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                    .fill(PL.surface)
                    .frame(height: 150)
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
        LazyVStack(alignment: .leading, spacing: 26) {
            ForEach(store.groups) { group in
                VStack(alignment: .leading, spacing: 12) {
                    groupHeader(group)
                    VStack(spacing: 0) {
                        ForEach(Array(group.points.enumerated()), id: \.element.id) { i, row in
                            if i > 0 {
                                Rectangle().fill(PL.edge.opacity(0.6)).frame(height: 1)
                            }
                            StarredRow(
                                row: row,
                                reasons: store.customReasons,
                                selecting: selecting,
                                selected: selected.contains(row.id),
                                onOpen: { play(row) },
                                onToggle: { toggle(row.id) },
                                onUnstar: { Task { await store.unstar(row) } },
                                onLongPress: { startSelecting(with: row.id) }
                            )
                        }
                    }
                    .plCard(padding: 0)
                }
            }
        }
        // Room for the selection bar under the last row.
        .padding(.bottom, selecting ? 90 : 0)
    }

    @ViewBuilder
    private func groupHeader(_ group: StarredGroup) -> some View {
        let words = VStack(alignment: .leading, spacing: 2) {
            Text(group.title)
                .font(.plCardTitle)
                .foregroundStyle(PL.text100)
                .lineLimit(1)
            Text(group.subtitle)
                .font(.plCaption)
                .foregroundStyle(PL.text500)
                .lineLimit(1)
        }
        if selecting {
            let all = group.points.allSatisfy { selected.contains($0.id) }
            HStack(alignment: .bottom, spacing: 12) {
                words
                Spacer(minLength: 8)
                Button(all ? "Deselect all" : "Select all") { toggleGroup(group) }
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(PL.cyan)
                    .buttonStyle(.plain)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
        } else if let match = library.matches.first(where: { $0.id == group.matchId }) {
            NavigationLink(value: match) {
                HStack(alignment: .bottom, spacing: 12) {
                    words
                    Spacer(minLength: 8)
                    HStack(spacing: 4) {
                        Text("\(group.points.count) point\(group.points.count == 1 ? "" : "s")")
                            .font(.plCaption)
                            .monospacedDigit()
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11, weight: .semibold))
                    }
                    .foregroundStyle(PL.text500)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        } else {
            words
        }
    }

    /// Full screen from this point on, stepping through the whole shelf.
    private func play(_ row: StarredPointRow) {
        guard let i = store.rows.firstIndex(where: { $0.id == row.id }) else { return }
        run = StarredRun(rows: store.rows, index: i)
    }

    // MARK: - Selecting

    private func startSelecting(with id: UUID?) {
        store.undo = nil
        selected = id.map { [$0] } ?? []
        selecting = true
    }

    private func stopSelecting() {
        selecting = false
        selected = []
    }

    private func toggle(_ id: UUID) {
        if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }
    }

    private func toggleGroup(_ group: StarredGroup) {
        let ids = group.points.map(\.id)
        if ids.allSatisfy(selected.contains) {
            selected.subtract(ids)
        } else {
            selected.formUnion(ids)
        }
    }

    /// What is picked, and the two things to do with it: Play (outlined)
    /// and Share (the one cyan primary).
    @ViewBuilder
    private var selectionBar: some View {
        if !picked.isEmpty {
            HStack(spacing: 10) {
                Text(selectionSummary(picked))
                    .font(.system(size: 15, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(PL.text100)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Button {
                    run = StarredRun(rows: picked, index: 0)
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "play.fill")
                            .font(.system(size: 10, weight: .bold))
                        Text("Play")
                    }
                    .frame(minHeight: 28)
                }
                .buttonStyle(PLSecondaryButtonStyle())
                Button("Share") { sharing = true }
                    .buttonStyle(PLPrimaryButtonStyle())
            }
            .padding(.leading, 18)
            .padding(.trailing, 8)
            .padding(.vertical, 8)
            // Opaque: rows scroll underneath, and their words must not
            // show through the counts and the buttons.
            .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                    .strokeBorder(PL.edge, lineWidth: 1)
            )
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
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

/// One run of the full-screen player: the rows it steps through and where
/// it starts. A fresh id each time, so opening it twice presents twice.
struct StarredRun: Identifiable {
    let id = UUID()
    let rows: [StarredPointRow]
    let index: Int
}

// MARK: - Row

/// One starred rally, compact: a small frame of it, its number, and
/// outcome · reason · length. Tapping plays it full screen; while
/// selecting, tapping picks it. Holding a row starts selecting with that
/// row picked.
struct StarredRow: View {
    let row: StarredPointRow
    let reasons: [CustomReason]
    let selecting: Bool
    let selected: Bool
    let onOpen: () -> Void
    let onToggle: () -> Void
    let onUnstar: () -> Void
    let onLongPress: () -> Void

    var body: some View {
        if selecting {
            Button(action: onToggle) { content }
                .buttonStyle(.plain)
                .background(selected ? PL.cyan.opacity(0.05) : .clear)
                .accessibilityAddTraits(selected ? .isSelected : [])
        } else {
            HStack(spacing: 0) {
                // A tap and a hold on the same row. Gestures rather than a
                // Button: a Button fires on release however long the finger
                // was down, so the hold would also open the player.
                content
                    .onTapGesture(perform: onOpen)
                    .onLongPressGesture(minimumDuration: 0.45, perform: onLongPress)
                    .accessibilityAddTraits(.isButton)
                    .accessibilityAction(named: "Select", onLongPress)
                // Beside the row's tap target, not inside it, so the two
                // never fight for the same touch.
                Button(action: onUnstar) {
                    Image(systemName: "star.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(Color(hex: 0xFFD230))
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.trailing, 6)
                .accessibilityLabel("Remove the star from point \(row.displayNo)")
            }
        }
    }

    private var content: some View {
        HStack(spacing: 12) {
            if selecting {
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(selected ? PL.cyan : PL.text500)
            }
            StarredFrame(row: row)
                .frame(width: 96)
            VStack(alignment: .leading, spacing: 3) {
                Text("Point \(row.displayNo)")
                    .font(.system(size: 15, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(PL.text100)
                Text("\(Text(row.outcomeLabel).foregroundStyle(row.outcomeTint))\(Text(rest.isEmpty ? "" : " · \(rest)").foregroundStyle(PL.text500))")
                    .font(.plCaption)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 10)
        .padding(.leading, 14)
        .padding(.trailing, selecting ? 14 : 0)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Point \(row.displayNo), \(row.outcomeLabel)")
    }

    /// reason · direction · length, whichever of them exist.
    private var rest: String {
        let length: String? = row.edited
            ? (ProcessingServiceStore.shared.notice(lane: ProcessingServiceStore.shared.clipLane, context: .fast) == nil
               ? "Updating clip" : "Clip update waiting")
            : row.durationLabel
        return [row.reasonLabel(custom: reasons), row.directionLabel, length]
            .compactMap { $0 }
            .joined(separator: " · ")
    }
}

// MARK: - The full-screen player

/// A starred point, full screen, the way the match player shows video:
/// black edge to edge, the picture as large as the screen allows, the
/// match player's rotate button for landscape (rotation lock or not), and
/// its close button in the corner. The arrows on the picture step through
/// the stars, across matches, and a point that ends moves on to the next.
/// Opened from the shelf, a selection's Play, and Home's row; never the
/// match screen (Adil, 2026-09-22).
///
/// The picture is `ClipPlayerView`, the point sheet's own player, in its
/// full-screen form, so its gestures, zoom and their persistence arrive
/// without being written twice.
struct StarredPlayerScreen: View {
    /// A snapshot: unstarring from the player keeps the run as it was, and
    /// the star on the player shows the change.
    let rows: [StarredPointRow]
    @State var index: Int
    /// Star on (true) or off (false). The host owns the write: the shelf
    /// goes through its store and its Undo, Home writes directly.
    let onStarChange: (StarredPointRow, Bool) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var player = AVPlayer()
    @State private var url: URL?
    @State private var failed = false
    @State private var loadSeq = 0
    @State private var unstarred: Set<UUID> = []
    /// The rotate button put the screen in landscape; the way out gives it
    /// back unless the phone really is on its side (PlayerTakeover's rule).
    @State private var forcedLandscape = false

    private var row: StarredPointRow? {
        rows.indices.contains(index) ? rows[index] : nil
    }

    var body: some View {
        GeometryReader { geo in
            let landscape = geo.size.width > geo.size.height
            ZStack {
                Color.black.ignoresSafeArea()
                if let row {
                    picture(row)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        // Sideways, the picture may use the notch's margins;
                        // top and bottom stay clear of the home indicator.
                        .ignoresSafeArea(edges: landscape ? .horizontal : [])
                    VStack(alignment: .leading, spacing: 8) {
                        topBar(row, landscape: landscape)
                        if row.edited,
                           let notice = ProcessingServiceStore.shared.notice(lane: ProcessingServiceStore.shared.clipLane, context: .fast) {
                            ProcessingAvailabilityNoticeView(notice: notice)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 14)
                    .padding(.top, 8)
                } else {
                    ProgressView().tint(PL.cyan)
                }
            }
        }
        .task(id: row?.id) { await load() }
        .onDisappear {
            player.pause()
            releaseForcedLandscape()
        }
    }

    /// Where you are on the left; rotate and close on the right, in the
    /// match player's corner style. Over the picture's top edge sideways,
    /// in the black above it upright.
    private func topBar(_ row: StarredPointRow, landscape: Bool) -> some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Point \(row.displayNo)")
                    .font(.system(size: 15, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(PL.text100)
                Text("\(row.matchTitle) · \(index + 1) of \(rows.count)")
                    .font(.plCaption)
                    .monospacedDigit()
                    .foregroundStyle(PL.text300)
                    .lineLimit(1)
            }
            .shadow(color: .black.opacity(0.9), radius: 2, y: 1)
            .shadow(color: .black.opacity(0.6), radius: 6)
            Spacer(minLength: 8)
            cornerButton(
                landscape ? "rectangle.portrait.arrowtriangle.2.outward"
                          : "rectangle.landscape.rotate",
                label: landscape ? "Back to portrait" : "Turn to landscape"
            ) {
                forcedLandscape = !landscape
                requestOrientation(landscape ? .portrait : .landscapeRight)
            }
            cornerButton("xmark", label: "Close") {
                player.pause()
                dismiss()
            }
        }
    }

    private func cornerButton(
        _ icon: String, label: String, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(PL.text300)
                .padding(9)
                .background(PL.ink.opacity(0.7), in: Circle())
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func requestOrientation(_ orientations: UIInterfaceOrientationMask) {
        guard let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene }).first else { return }
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: orientations))
    }

    private func releaseForcedLandscape() {
        guard forcedLandscape else { return }
        forcedLandscape = false
        guard !UIDevice.current.orientation.isLandscape else { return }
        requestOrientation(.portrait)
    }

    @ViewBuilder
    private func picture(_ row: StarredPointRow) -> some View {
        if url != nil || !failed {
            ClipPlayerView(
                player: player,
                url: url,
                starred: !unstarred.contains(row.id),
                tagged: false,
                updating: row.edited && ProcessingServiceStore.shared.notice(lane: ProcessingServiceStore.shared.clipLane, context: .fast) == nil,
                hasPrev: index > 0,
                hasNext: index < rows.count - 1,
                showTag: false,
                onStar: { Task { await toggleStar(row) } },
                onTag: {},
                onPrev: { go(index - 1) },
                onNext: { go(index + 1) },
                onEnded: {
                    if index < rows.count - 1 { go(index + 1) }
                },
                fullScreen: true
            )
        } else {
            Color.black
                .aspectRatio(16 / 9, contentMode: .fit)
                .overlay(
                    Text(row.edited
                         ? (ProcessingServiceStore.shared.notice(lane: ProcessingServiceStore.shared.clipLane, context: .fast) == nil ? "This clip is still being recut." : "This clip will update when service is restored.")
                         : "Couldn't load this clip.")
                        .font(.plBody)
                        .foregroundStyle(PL.text500)
                )
        }
    }

    // MARK: Data

    private func go(_ next: Int) {
        guard rows.indices.contains(next) else { return }
        index = next
    }

    /// The player's own star: off takes the point off the stars, on puts
    /// it back. The host decides how the write happens.
    private func toggleStar(_ row: StarredPointRow) async {
        if unstarred.contains(row.id) {
            unstarred.remove(row.id)
            await onStarChange(row, true)
        } else {
            unstarred.insert(row.id)
            await onStarChange(row, false)
        }
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
        let link = await ClipLinks.url(matchId: row.matchId, pointId: row.id)
        guard loadSeq == mine else { return }
        if let link {
            url = link
        } else {
            failed = true
        }
        // Read one ahead: a six second rally does not leave time to notice
        // a round trip, so the round trip happens during the rally before.
        if let next = rows[safe: index + 1], next.hasClip {
            _ = await ClipLinks.url(matchId: next.matchId, pointId: next.id)
        }
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

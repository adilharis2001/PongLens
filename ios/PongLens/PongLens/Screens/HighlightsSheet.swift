import AVFoundation
import SwiftUI

/// The match's automatic highlights: what the picker chose, played as a
/// tape, and the three cuts it can leave the app as.
///
/// Opened from the Tools row below Score Keeper. Nothing here re-decides
/// anything: Core/Highlights.swift picks the rallies (the same rule the
/// server renders with — the parity fixture keeps them honest), and the
/// share actions go through the same render pipeline as every other
/// vertical. The preview costs no render at all: it plays the rallies'
/// existing clips back to back.
struct HighlightsSheet: View {
    let match: MatchRow
    /// The match's visible points in timeline order (model.visible).
    let points: [MatchPoint]

    @Environment(\.dismiss) private var dismiss
    @State private var model = StoryShareModel()
    @State private var shareItem: URL?
    /// The emergency switch (136); an unreadable row answers "on".
    @State private var sharingOn = true
    /// Which action row is working, so only it animates.
    @State private var busyAction: String?
    @State private var playStart: HighlightsPlayStart?
    @AppStorage("shareShowNames") private var showNames = true
    @AppStorage("shareShowScore") private var showScore = true

    private var pad: ClipPad {
        clipPad(strictness: nil, stored: match.clipPads)
    }
    private var story: Highlights.Picks {
        Highlights.pick(points, pad: pad, budgetS: Highlights.storyBudgetS)
    }
    private var reel: Highlights.Picks {
        Highlights.pick(points, pad: pad, budgetS: Highlights.reelBudgetS)
    }
    private var long: Highlights.Picks {
        Highlights.pick(points, pad: pad, budgetS: Highlights.longBudgetS)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Highlights")
                    .font(.plPageTitle)
                    .tracking(-0.6)
                    .foregroundStyle(PL.textBody)
                    .padding(.bottom, 4)

                if reel.points.isEmpty {
                    Text("No rallies to pick from yet.")
                        .font(.plBody)
                        .foregroundStyle(PL.text500)
                } else {
                    PLChooserRow(
                        icon: "play.fill",
                        title: "Play the highlights",
                        detail: Highlights.summary(reel) ?? ""
                    ) {
                        playStart = HighlightsPlayStart(index: 0)
                    }

                    rallyList

                    if sharingOn, !story.points.isEmpty,
                       InstagramShare.isAvailable(.story) {
                        PLChooserRow(
                            icon: "camera.aperture",
                            title: busyAction == "story"
                                ? "Preparing…" : "Instagram Story",
                            detail: busyAction == "story"
                                ? model.progressLine : storyDetail,
                            pending: model.busy && busyAction != "story",
                            busy: busyAction == "story"
                        ) {
                            Task { await run("story", to: .story) }
                        }
                    }
                    if sharingOn, InstagramShare.isAvailable(.reel) {
                        PLChooserRow(
                            icon: "camera.aperture",
                            title: busyAction == "reel"
                                ? "Preparing…" : "Instagram Reel",
                            detail: busyAction == "reel"
                                ? model.progressLine
                                : "The same rallies as one vertical video. "
                                    + "Opens Instagram ready to post.",
                            pending: model.busy && busyAction != "reel",
                            busy: busyAction == "reel"
                        ) {
                            Task { await run("reel", to: .reel) }
                        }
                    }
                    PLChooserRow(
                        icon: "square.and.arrow.down",
                        title: busyAction == "save"
                            ? "Preparing…" : "Save the video",
                        detail: busyAction == "save"
                            ? model.progressLine
                            : "The highlights as one vertical video, "
                                + "to save or send anywhere.",
                        pending: model.busy && busyAction != "save",
                        busy: busyAction == "save"
                    ) {
                        Task { await run("reel", to: nil, action: "save") }
                    }
                    if long.totalS > reel.totalS + 1 {
                        PLChooserRow(
                            icon: "square.and.arrow.down",
                            title: busyAction == "long"
                                ? "Preparing…" : "Save the long cut",
                            detail: busyAction == "long"
                                ? model.progressLine : longDetail,
                            pending: model.busy && busyAction != "long",
                            busy: busyAction == "long"
                        ) {
                            Task { await run("long", to: nil, action: "long") }
                        }
                    }

                    Toggle("Include names", isOn: $showNames)
                        .font(.plBody)
                        .foregroundStyle(PL.text200)
                        .tint(PL.cyan.opacity(0.5))
                        .padding(.top, 4)
                    Toggle("Include score", isOn: $showScore)
                        .font(.plBody)
                        .foregroundStyle(PL.text200)
                        .tint(PL.cyan.opacity(0.5))
                }

                if let message = model.errorMessage {
                    Text(message)
                        .font(.plCaption)
                        .foregroundStyle(PL.dangerText)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
        }
        .sheet(item: $shareItem) { url in
            ActivityView(items: [url])
                .presentationDetents([.medium])
        }
        .fullScreenCover(item: $playStart) { start in
            HighlightsPlayerScreen(
                match: match, picks: reel.points, index: start.index)
        }
        .task { sharingOn = await StoryShareModel.sharingEnabled() }
    }

    /// What the picker chose, named. Tapping a rally starts the tape there.
    private var rallyList: some View {
        VStack(spacing: 0) {
            ForEach(Array(reel.points.enumerated()), id: \.element.id) { i, p in
                Button {
                    playStart = HighlightsPlayStart(index: i)
                } label: {
                    HStack(spacing: 10) {
                        Text("Point \(pointNumber(p))")
                            .font(.plRowTitle)
                            .monospacedDigit()
                            .foregroundStyle(PL.text100)
                        if p.starred {
                            Image(systemName: "star.fill")
                                .font(.system(size: 11))
                                .foregroundStyle(PL.warningText)
                        }
                        Spacer()
                        Text(rallyLength(p))
                            .font(.plCaption)
                            .monospacedDigit()
                            .foregroundStyle(PL.text500)
                        Image(systemName: "play.circle")
                            .font(.system(size: 16))
                            .foregroundStyle(PL.text400)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if i < reel.points.count - 1 {
                    Divider().overlay(PL.edge.opacity(0.6))
                }
            }
        }
        .background(PL.surface2.opacity(0.5),
                    in: RoundedRectangle(cornerRadius: PL.rField,
                                         style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PL.rField, style: .continuous)
                .strokeBorder(PL.edge, lineWidth: 1)
        )
    }

    private var storyDetail: String {
        let n = story.points.count
        let s = Int(story.totalS.rounded())
        return n == 1
            ? "Your best rally, \(s) seconds. Opens Instagram ready to post."
            : "Your best \(n) rallies, \(s) seconds. Opens Instagram ready to post."
    }

    private var longDetail: String {
        let n = long.points.count
        let s = Int(long.totalS.rounded())
        return "\(n) rallies · \(String(format: "%d:%02d", s / 60, s % 60)). "
            + "For anywhere that takes more than a minute."
    }

    /// The number the rest of the app calls this point: its position in
    /// the match's visible list, not the worker's idx (which has gaps).
    private func pointNumber(_ p: MatchPoint) -> Int {
        (points.firstIndex { $0.id == p.id } ?? 0) + 1
    }

    private func rallyLength(_ p: MatchPoint) -> String {
        guard let t0 = p.t0, let t1 = p.t1 else { return "" }
        return "\(Int((t1 - t0).rounded()))s"
    }

    private func run(_ kind: String,
                     to destination: InstagramShare.Destination?,
                     action: String? = nil) async {
        busyAction = action ?? kind
        defer { busyAction = nil }
        guard let url = await model.prepareAuto(
            match: match, kind: kind,
            showNames: showNames, showScore: showScore)
        else { return }
        if let destination {
            do {
                try InstagramShare.share(url, to: destination)
                dismiss()
            } catch {
                model.errorMessage = error.localizedDescription
            }
        } else {
            shareItem = url
        }
    }
}

struct HighlightsPlayStart: Identifiable {
    let index: Int
    var id: Int { index }
}

// MARK: - The tape

/// The picked rallies, played back to back — the StarredPlayerScreen
/// shape over one match's picks, sharing ClipPlayerView so the pinch
/// zoom and speed control arrive without being written twice.
struct HighlightsPlayerScreen: View {
    let match: MatchRow
    let picks: [MatchPoint]
    @State var index: Int

    @Environment(\.dismiss) private var dismiss
    @State private var player = AVPlayer()
    @State private var url: URL?
    @State private var failed = false
    @State private var loadSeq = 0

    private var point: MatchPoint? {
        picks.indices.contains(index) ? picks[index] : nil
    }

    var body: some View {
        ZStack {
            PL.ink.ignoresSafeArea()
            if let point {
                VStack(spacing: 0) {
                    header(point)
                    Spacer(minLength: 0)
                    picture(point)
                    Spacer(minLength: 0)
                }
            } else {
                ProgressView().tint(PL.cyan)
            }
        }
        .task(id: point?.id) { await load() }
        .onDisappear { player.pause() }
    }

    private func header(_ point: MatchPoint) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Highlights")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(PL.text100)
                Text("\(index + 1) of \(picks.count)")
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
    private func picture(_ point: MatchPoint) -> some View {
        if url != nil || !failed {
            ClipPlayerView(
                player: player,
                url: url,
                starred: point.starred,
                tagged: false,
                updating: false,
                hasPrev: index > 0,
                hasNext: index < picks.count - 1,
                canEdit: false,
                showTag: false,
                onStar: {},
                onTag: {},
                onPrev: { go(index - 1) },
                onNext: { go(index + 1) },
                onEnded: {
                    if index < picks.count - 1 { go(index + 1) }
                }
            )
            .padding(.horizontal, 12)
        } else {
            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                .fill(Color.black)
                .aspectRatio(16 / 9, contentMode: .fit)
                .overlay(
                    Text("Couldn't load this clip.")
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

    private func go(_ next: Int) {
        guard picks.indices.contains(next) else { return }
        index = next
    }

    private func load() async {
        guard let point else { return }
        let mine = loadSeq + 1
        loadSeq = mine
        url = nil
        failed = false
        guard point.hasClip else {
            failed = true
            return
        }
        let link = await ClipLinks.url(matchId: match.id, pointId: point.id)
        guard loadSeq == mine else { return }
        if let link {
            url = link
        } else {
            failed = true
        }
        // Read one ahead: a six second rally does not leave time to notice
        // a round trip, so the round trip happens during the rally before.
        if let next = picks[safe: index + 1], next.hasClip {
            _ = await ClipLinks.url(matchId: match.id, pointId: next.id)
        }
    }
}

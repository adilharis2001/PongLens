import SwiftUI

/// Sharing starred points picked from any number of matches (2026-09-22).
///
/// The same three rows a single rally's SharePointSheet offers, for a set:
///   Instagram Reel   the worker's 9:16 video of these points, handed over
///   Save the video   the same file, into the system share sheet
///   Share a link     a public link that plays these points
/// then the names, score and logo switches every share sheet carries.
///
/// Replaces ShareHighlightsSheet, which shared one match's stars and was
/// reached only from the shelf's group headers; picking "Select all" on a
/// match does the same job now. The web twin is
/// src/app/starred/ShareSelectionSheet.tsx.
struct ShareSelectionSheet: View {
    /// The picked points, in shelf order.
    let rows: [StarredPointRow]

    @Environment(\.dismiss) private var dismiss
    @State private var model = StoryShareModel()
    /// The rendered video or the minted link, for the system share sheet.
    @State private var shareItem: URL?
    /// The emergency switch (136); an unreadable row answers "on".
    @State private var sharingOn = true
    @AppStorage("shareShowNames") private var showNames = true
    @AppStorage("shareShowScore") private var showScore = true
    @AppStorage("shareShowLogo") private var showLogo = true

    private var pointIds: [UUID] { rows.map(\.id) }
    private var seconds: Double { selectionSeconds(rows) }
    private var tooManyForVideo: Bool { rows.count > StarredSelection.videoMaxPoints }
    private var tooManyForLink: Bool { rows.count > StarredSelection.linkMaxPoints }
    /// Rally time alone already past a Reel: the padded render only grows.
    /// Anything closer is the server's to measure, and it says so.
    private var tooLongForReel: Bool { seconds > StarredSelection.instagramMaxSeconds }

    var body: some View {
        PLChooserSheet(title: "Share \(rows.count) point\(rows.count == 1 ? "" : "s")") {
            if let notice = ProcessingServiceStore.shared.notice(lane: ProcessingServiceStore.shared.clipLane, context: .fast) {
                Section { ProcessingAvailabilityNoticeView(notice: notice) }
            }
            Section {
                if sharingOn, InstagramShare.isAvailable(.reel) {
                    PLChooserRow(
                        icon: "camera.aperture",
                        title: model.busy ? "Preparing…" : "Instagram Reel",
                        detail: reelDetail,
                        pending: tooManyForVideo || tooLongForReel,
                        busy: model.busy
                    ) {
                        Task { await run(to: .reel) }
                    }
                }

                // While the Instagram row is working this one goes flat
                // rather than spinning too, so only the row being acted on
                // animates.
                PLChooserRow(
                    icon: "square.and.arrow.down",
                    title: "Save the video",
                    detail: tooManyForVideo
                        ? "A video takes up to \(StarredSelection.videoMaxPoints) points."
                        : "These points as one vertical video, to save or send anywhere.",
                    pending: tooManyForVideo || model.busy
                ) {
                    Task { await run(to: nil) }
                }

                PLChooserRow(
                    icon: "link",
                    title: "Share a link",
                    detail: tooManyForLink
                        ? "A link takes up to \(StarredSelection.linkMaxPoints) points."
                        : "Anyone with the link can watch these points.",
                    pending: tooManyForLink,
                    busy: model.mintingLink
                ) {
                    Task { shareItem = await model.mintSelectionLink(pointIds: pointIds) }
                }
            }

            // What the video's frame carries: never the link. A match with
            // no confirmed score prints none whatever this says.
            Section {
                Toggle("Include names", isOn: $showNames)
                Toggle("Include score", isOn: $showScore)
                Toggle("Include logo", isOn: $showLogo)
            }

            if let message = model.errorMessage {
                Section {
                    Text(message)
                        .font(.plCaption)
                        .foregroundStyle(PL.dangerText)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .sheet(item: $shareItem) { url in
            ActivityView(items: [url])
                .presentationDetents([.medium])
        }
        .task { sharingOn = await StoryShareModel.sharingEnabled() }
    }

    private var reelDetail: String {
        if model.busy { return model.progressLine }
        if tooManyForVideo {
            return "A video takes up to \(StarredSelection.videoMaxPoints) points."
        }
        if tooLongForReel {
            return "These points run \(Int(seconds.rounded())) seconds. "
                + "Instagram takes up to 60."
        }
        return "Opens Instagram with these points ready to post."
    }

    /// destination nil = hand the finished file to the system share sheet
    /// instead of to Instagram, the same shape SharePointSheet uses.
    private func run(to destination: InstagramShare.Destination?) async {
        guard let url = await model.prepareSelection(
            pointIds: pointIds,
            purpose: destination == nil ? "save" : "instagram",
            showNames: showNames, showScore: showScore, showLogo: showLogo)
        else { return }
        if let destination {
            do {
                try InstagramShare.share(url, to: destination)
                dismiss()
            } catch {
                model.errorMessage = UserFacingError.message(error)
            }
        } else {
            shareItem = url
        }
    }
}

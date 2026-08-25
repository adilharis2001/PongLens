import SwiftUI

/// Sharing a match's starred rallies as one vertical video.
///
/// The sibling of SharePointSheet, for the set instead of the single
/// rally: the worker stitches every starred point back to back on the
/// same 9:16 canvas a Story uses, with the running score updating between
/// rallies, and Instagram opens with it as a Reel. Reached from the match
/// Export sheet and from each match's group on the starred shelf.
///
/// The render always happens on the worker — joining several clips with
/// crossfades is machinery it already has, and a Reel is not the moment
/// the phone's own renderer was built for (a single rally, rendered while
/// its owner watches the spinner).
struct ShareHighlightsSheet: View {
    let match: MatchRow
    let starredCount: Int

    static var detentHeight: CGFloat {
        InstagramShare.isAvailable(.reel) ? 420 : 330
    }

    @Environment(\.dismiss) private var dismiss
    @State private var model = StoryShareModel()
    @State private var shareItem: URL?
    /// The emergency switch (136); an unreadable row answers "on".
    @State private var sharingOn = true
    @AppStorage("shareShowNames") private var showNames = true
    @AppStorage("shareShowScore") private var showScore = true

    var body: some View {
        PLChooserSheet(title: "Share your highlights") {
            if sharingOn, InstagramShare.isAvailable(.reel) {
                PLChooserRow(
                    icon: "camera.aperture",
                    title: model.busy ? "Preparing…" : "Instagram Reel",
                    detail: model.busy
                        ? model.progressLine
                        : "Your starred rallies, back to back. "
                            + "Opens Instagram ready to post.",
                    pending: starredCount == 0,
                    busy: model.busy
                ) {
                    Task { await run(to: .reel) }
                }
            }

            PLChooserRow(
                icon: "square.and.arrow.down",
                title: "Save the video",
                detail: starredCount > 0
                    ? "The same vertical video, to save or send anywhere."
                    : "Star points to share them.",
                pending: starredCount == 0 || model.busy
            ) {
                Task { await run(to: nil) }
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

            if let message = model.errorMessage {
                Text(message)
                    .font(.plCaption)
                    .foregroundStyle(PL.dangerText)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            }
        }
        .sheet(item: $shareItem) { url in
            ActivityView(items: [url])
                .presentationDetents([.medium])
        }
        .task { sharingOn = await StoryShareModel.sharingEnabled() }
    }

    /// destination nil = hand the finished file to the system share sheet
    /// instead of to Instagram — the same shape SharePointSheet uses.
    private func run(to destination: InstagramShare.Destination?) async {
        guard let url = await model.prepareHighlights(
            match: match, showNames: showNames, showScore: showScore)
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

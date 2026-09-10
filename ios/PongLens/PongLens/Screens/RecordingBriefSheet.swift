import SwiftUI

/// Four pages a new account steps through once, before its first recording
/// or upload.
///
/// One picture and one idea per page: where to stand, what to stand the
/// phone on, the one mistake that hides the ball, then what to expect from
/// processing. It replaced the automatic showing of the "Where to place
/// the camera" sheet, which is one tall scroll that people swiped away.
/// Each Next is a small commitment to the next idea, which is what makes
/// four short pages get read where one long sheet did not.
///
/// There were five. "Keep the whole table in frame" drew a phone squared
/// up to the net, which argued with page one's band of side-and-diagonal
/// positions, and its own point — every corner in the picture — was
/// already a clause in page one's body. Its surviving instruction, film
/// landscape, moved to the tripod page, where the phone is being placed
/// anyway.
///
/// There is no way out except through. The presenter switches off
/// drag-to-dismiss and shows no grab handle; Back is always there, a swipe
/// moves between pages, and the last page's button is the only exit. It
/// continues to wherever the tap was going, and `RecordingBriefFirstRun`
/// counts the brief as seen only then, so quitting halfway brings it back
/// from page one.
///
/// The pictures are the web's SVGs (public/brief/) exported to PNG by
/// scripts/brief/export-ios.mjs, so the two platforms cannot drift apart
/// on what a page looks like. The words are written twice, here and in
/// RecordingBrief.tsx, the same way the placement sheet's are.
struct RecordingBriefSheet: View {
    enum Context {
        /// About to hand over to the recorder.
        case recording
        /// About to hand over to the library picker.
        case upload
    }

    let context: Context
    /// The last page's button. The only way out.
    let onDone: () -> Void

    // The page model and the walk itself are shared with the lesson
    // briefs — see BriefSheet.swift. This file is now just the words.
    typealias Page = BriefPage

    private static let pages: [Page] = [
        Page(
            image: "brief-p1",
            title: "Let the camera see both halves",
            body: "Put it to the side of your half, or diagonally behind your corner, raised to about head height. Anywhere in that band works, as long as it can see both halves and every corner of the table is in the picture. Never straight behind a player. Choose the side you do not serve from. For most right-handers that is the forehand side.",
            aspect: 320.0 / 300.0,
            showSetups: true,
            recordingNote: "The next screen draws the table where it should sit. Line the real one up with it before you start."
        ),
        Page(
            image: "brief-p3",
            title: "Use a tripod",
            body: "Film landscape, with the phone on a tripod or something else that does not move, and leave it there for the whole match. A phone held in the hand moves, and when the picture moves PongLens loses track of where the table is."
        ),
        Page(
            image: "brief-p4",
            title: "Don’t film from behind a player",
            body: "From behind, the nearest player hides their half of the table, so the ball disappears exactly where it lands. Keep both players clear of the line between the camera and the table."
        ),
        Page(
            image: "brief-p5",
            title: "Processing is in beta",
            body: "PongLens finds and cuts each point automatically, and it is not perfect yet. A point can be missed, or a cut can start late or run long. Scoring the match tightens them: a point you score ends right at the winning shot. You can fix any point from the match screen, and the model improves with every release. Most matches are ready in about 90 minutes, and we email you when yours is."
        ),
    ]

    var body: some View {
        BriefSheet(
            pages: Self.pages,
            finalLabel: finalLabel,
            showNotes: context == .recording,
            onDone: onDone
        )
    }

    /// The last page's button says where the tap was going.
    private var finalLabel: String {
        switch context {
        case .recording: "Start recording"
        case .upload: "Choose a video"
        }
    }
}

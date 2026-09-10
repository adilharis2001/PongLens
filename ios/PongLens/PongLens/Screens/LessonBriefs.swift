import SwiftUI

/// The two lesson briefs: the pages only. The walk is BriefSheet, the same
/// one the recording brief uses, so all three behave identically.
///
/// The words are written twice, here and in src/components/LessonBriefs.tsx,
/// exactly as the recording brief's are. The pictures come from the same
/// SVGs, exported by scripts/brief/export-ios.mjs.

enum LessonBriefPages {
    /// Audio lessons: iPhone only. There is no audio recorder on the web.
    static let audio: [BriefPage] = [
        BriefPage(
            image: "brief-a1",
            title: "Your lesson, written up",
            body: "Record the lesson and PongLens writes it up for you. You get a short title, the things your coach kept coming back to, and the points under each one. The full transcript is saved with it, so you can go back to the exact words later."
        ),
        BriefPage(
            image: "brief-a2",
            title: "Put the phone near the net",
            body: "Rest it near the net with the screen down and nothing covering the microphone. It only has to hear your coach talking, not the ball. You can lock the phone and leave it there for the whole lesson, and pause it when you take a break. A two-hour lesson is fine."
        ),
        BriefPage(
            image: "brief-a3",
            title: "Read it before it is saved",
            body: "When you finish, the notes and the transcript come up for you to read. Fix any names or terms the microphone got wrong, then add it to your journal. The recording is deleted once you save, and only the written notes and transcript stay in your journal."
        ),
    ]

    /// Lesson videos: the coach's side, on both platforms.
    static let video: [BriefPage] = [
        BriefPage(
            image: "brief-v1",
            title: "A short recap of the whole lesson",
            body: "Import a lesson you filmed and PongLens turns it into a short recap. It finds the moments where you taught something and cuts them together into chapters, with what you said written beside each one. A ninety-minute lesson usually comes back as ten to fifteen minutes.",
            aspect: 320.0 / 300.0
        ),
        BriefPage(
            image: "brief-v2",
            title: "Film so your voice is heard",
            body: "The recap is built from what you say, so put the camera on your side of the table, angled across it and close enough to pick you up over the ball. Film landscape at 1080p and 30 fps. If the video has no sound on it, there is nothing to build a recap from."
        ),
        BriefPage(
            image: "brief-v3",
            title: "Check it, then send it",
            body: "The recap comes back for you to read through first. Rename a chapter, fix a line, or take out anything that does not belong. When you share it, it lands in your student's journal, and nothing reaches them until you do."
        ),
    ]
}

struct LessonAudioBriefSheet: View {
    let onDone: () -> Void

    var body: some View {
        BriefSheet(
            pages: LessonBriefPages.audio,
            finalLabel: "Start recording",
            onDone: onDone
        )
    }
}

struct LessonVideoBriefSheet: View {
    let onDone: () -> Void

    var body: some View {
        BriefSheet(
            pages: LessonBriefPages.video,
            finalLabel: "Continue",
            onDone: onDone
        )
    }
}

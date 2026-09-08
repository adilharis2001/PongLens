import SwiftUI

/// Five pages a new account steps through once, before its first recording
/// or upload.
///
/// One picture and one idea per page: where to stand, what to frame, what
/// to stand the phone on, the one mistake that hides the ball, then what
/// to expect from processing. It replaced the automatic showing of the
/// "Where to place the camera" sheet, which is one tall scroll that people
/// swiped away. Each Next is a small commitment to the next idea, which is
/// what makes five short pages get read where one long sheet did not.
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

    @State private var index = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private struct Page {
        let image: String
        let title: String
        let body: String
        /// The three reference photographs, behind a tap (page one only).
        var showSetups = false
        /// A line under the body that only the record doors get.
        var recordingNote: String? = nil
    }

    private static let pages: [Page] = [
        Page(
            image: "brief-p1",
            title: "Put the camera to the side",
            body: "We recommend filming from the side, as close to side-on as you can get, level with your half and raised to about head height. If filming from the side is difficult, a diagonal view works too. Choose the side you do not serve from, so you are never standing between the camera and the table when a point starts. For most right-handers that is the forehand side.",
            showSetups: true,
            recordingNote: "The next screen draws the table where it should sit. Line the real one up with it before you start."
        ),
        Page(
            image: "brief-p2",
            title: "Keep the whole table in frame",
            body: "Film landscape, with every corner of the table in the picture and both halves clearly visible. If there are other tables nearby, angle the camera so they stay out of the frame where you can."
        ),
        Page(
            image: "brief-p3",
            title: "Use a tripod",
            body: "Put the phone on a tripod or something that does not move, and leave it there for the whole match. A phone held in the hand moves, and when the picture moves PongLens loses track of where the table is."
        ),
        Page(
            image: "brief-p4",
            title: "Don’t film from behind a player",
            body: "From behind, the nearest player hides their half of the table, so the ball disappears exactly where it lands. Keep both players clear of the line between the camera and the table."
        ),
        Page(
            image: "brief-p5",
            title: "Processing is in beta",
            body: "PongLens finds and cuts each point automatically, and it is not perfect yet. A point can be missed, or a cut can start late or run long. You can fix any point from the match screen, and the model improves with every release. Most matches are ready within 30 minutes, and we email you when yours is."
        ),
    ]

    private var last: Int { Self.pages.count - 1 }

    /// The last page's button says where the tap was going.
    private var finalLabel: String {
        switch context {
        case .recording: "Start recording"
        case .upload: "Choose a video"
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            // A paged TabView: the swipe comes free and matches the web's,
            // and setting the index moves it the same way a tap does.
            TabView(selection: $index) {
                ForEach(Array(Self.pages.enumerated()), id: \.offset) { i, page in
                    ScrollView(showsIndicators: false) {
                        pageBody(page)
                            .padding(.horizontal, 20)
                            .padding(.top, 4)
                            .padding(.bottom, 12)
                    }
                    .tag(i)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .animation(reduceMotion ? nil : .easeOut(duration: 0.28), value: index)
        }
        .background(PL.surface.ignoresSafeArea())
        // Pinned, so the way forward is in the first frame of every page.
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 0) {
                Divider().overlay(PL.edge)
                Button {
                    if index < last {
                        index += 1
                    } else {
                        onDone()
                    }
                } label: {
                    // Sized before the style is applied, so the visible
                    // button and its hit area both fill the row.
                    Text(index < last ? "Next" : finalLabel)
                        .frame(maxWidth: .infinity, minHeight: 24)
                }
                .buttonStyle(PLPrimaryButtonStyle())
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 6)
            }
            .background(PL.surface)
        }
        .preferredColorScheme(.dark)
    }

    /// Back, the capsules from onboarding, and where you are.
    private var header: some View {
        ZStack {
            HStack(spacing: 6) {
                ForEach(0..<Self.pages.count, id: \.self) { i in
                    Capsule()
                        .fill(i <= index ? PL.cyan : PL.edge)
                        .frame(width: i == index ? 22 : 8, height: 4)
                        .animation(.easeOut(duration: 0.25), value: index)
                }
            }
            .accessibilityHidden(true)
            HStack {
                Button {
                    if index > 0 { index -= 1 }
                } label: {
                    HStack(spacing: 2) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 15, weight: .semibold))
                        Text("Back")
                            .font(.system(size: 15))
                    }
                    .foregroundStyle(PL.text400)
                    .frame(minHeight: 44)
                    .padding(.trailing, 8)
                }
                .opacity(index == 0 ? 0 : 1)
                .disabled(index == 0)
                .accessibilityHidden(index == 0)
                Spacer()
                Text("\(index + 1) of \(Self.pages.count)")
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(PL.text500)
                    .accessibilityLabel("Page \(index + 1) of \(Self.pages.count)")
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 56)
    }

    private func pageBody(_ page: Page) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            BriefPicture(name: page.image)
            Text(page.title)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(PL.text100)
                .padding(.top, 18)
            Text(page.body)
                .font(.system(size: 15))
                .lineSpacing(3)
                .foregroundStyle(PL.text300)
                .padding(.top, 8)
            // The three reference photographs, the same component the
            // "Where to place the camera" sheet shows. Behind a tap so the
            // page stays one idea, but on the one walk every new account
            // takes.
            if page.showSetups {
                CameraRealSetups()
                    .padding(.top, 14)
            }
            if context == .recording, let note = page.recordingNote {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "viewfinder")
                        .font(.system(size: 15))
                        .foregroundStyle(PL.cyan)
                        .padding(.top, 1)
                    Text(note)
                        .font(.system(size: 13.5))
                        .foregroundStyle(PL.text300)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(PL.surface2.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(PL.edge, lineWidth: 1))
                .padding(.top, 12)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One of the five drawings, in a 4:3 box with the app's ink behind it.
///
/// The PNGs are loose files in Resources/ (`brief-pN@2x.png`, `@3x.png`),
/// the same arrangement as the reference photographs, so `UIImage(named:)`
/// picks the scale on its own.
private struct BriefPicture: View {
    let name: String

    var body: some View {
        ZStack {
            PL.ink
            if let image = UIImage(named: name) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
            }
        }
        .aspectRatio(4.0 / 3.0, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(PL.edge, lineWidth: 1))
        .accessibilityHidden(true)
    }
}

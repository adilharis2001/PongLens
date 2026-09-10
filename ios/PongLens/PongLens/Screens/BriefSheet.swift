import SwiftUI

/// One page of any brief.
///
/// The recording brief was the first. The lesson briefs (audio, video) are
/// the same walk with different pages, so the shell below takes them as an
/// argument rather than being copied once per feature. A page that is
/// copied is a page that drifts, and this project has paid for that twice.
struct BriefPage {
    let image: String
    let title: String
    let body: String
    /// The picture's shape, matching its own drawing. Most are 4:3; the
    /// camera-band page and the recap page are taller, because at 4:3 the
    /// bottom of each was cropped.
    var aspect: CGFloat = 4.0 / 3.0
    /// The three reference photographs, behind a tap (recording brief only).
    var showSetups = false
    /// A line under the body that only the record door gets.
    var recordingNote: String? = nil
}

/// The walk itself: pages side by side, the capsules from onboarding, Back,
/// and one button out.
///
/// There is no way out except through. The presenter switches off
/// drag-to-dismiss and shows no grab handle; Back is always there, a swipe
/// moves between pages, and the last page's button is the only exit. The
/// caller counts the brief as seen only when that button is tapped, so
/// quitting halfway brings it back from page one.
///
/// The pictures are the web's SVGs (public/brief/) exported to PNG by
/// scripts/brief/export-ios.mjs, so the two platforms cannot drift apart on
/// what a page looks like. The words are written twice, here and in the
/// TypeScript twin.
struct BriefSheet: View {
    let pages: [BriefPage]
    /// The last page's button. The only way out.
    let finalLabel: String
    /// Whether a page's `recordingNote` is shown. Only the recorder's own
    /// door has a next screen to point at.
    var showNotes = false
    let onDone: () -> Void

    @State private var index = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var last: Int { pages.count - 1 }

    var body: some View {
        VStack(spacing: 0) {
            header
            // A paged TabView: the swipe comes free and matches the web's,
            // and setting the index moves it the same way a tap does.
            TabView(selection: $index) {
                ForEach(Array(pages.enumerated()), id: \.offset) { i, page in
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
                ForEach(0..<pages.count, id: \.self) { i in
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
                Text("\(index + 1) of \(pages.count)")
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(PL.text500)
                    .accessibilityLabel("Page \(index + 1) of \(pages.count)")
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 56)
    }

    private func pageBody(_ page: BriefPage) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            BriefPicture(name: page.image, aspect: page.aspect)
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
            if showNotes, let note = page.recordingNote {
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

/// One of the drawings, in a box of its own shape with the app's ink
/// behind it. The pages are not all 4:3.
///
/// The PNGs are loose files in Resources/ (`brief-*@2x.png`, `@3x.png`),
/// the same arrangement as the reference photographs, so `UIImage(named:)`
/// picks the scale on its own.
struct BriefPicture: View {
    let name: String
    var aspect: CGFloat = 4.0 / 3.0

    var body: some View {
        ZStack {
            PL.ink
            if let image = UIImage(named: name) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
            }
        }
        .aspectRatio(aspect, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(PL.edge, lineWidth: 1))
        .accessibilityHidden(true)
    }
}

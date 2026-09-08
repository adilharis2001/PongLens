import SwiftUI

/// The match page's media card: the cut with a play button, and beneath it
/// the Original and download controls.
struct MatchVideoHero: View {
    let match: MatchRow
    let videoAvailable: Bool
    let hasOriginal: Bool
    let openingOriginal: Bool
    let onPlay: () -> Void
    let onOriginal: () -> Void
    let onDownload: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Button(action: onPlay) {
                Color.clear
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .overlay(MatchThumb(matchId: match.id))
                    .overlay {
                        if videoAvailable {
                            Circle()
                                .fill(PL.ink.opacity(0.6))
                                .frame(width: 96, height: 96)
                                .overlay(
                                    Image(systemName: "play.fill")
                                        .font(.system(size: 34))
                                        .foregroundStyle(.white)
                                        .offset(x: 3)
                                )
                        }
                    }
                    .clipped()
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!videoAvailable)

            Rectangle().fill(PL.edge).frame(height: 1)

            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(match.status == .ready ? "Full video" : "Original video")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(PL.textBody)
                    Text(match.status == .ready ? "Playtime only" : "As uploaded")
                        .font(.plCaption)
                        .foregroundStyle(PL.text500)
                }
                Spacer()
                // The uncut upload, for when the cut came out poor. Beside
                // the download rather than in Tools, because Tools is
                // `if isOwner` and a coach looking at a bad cut wants the
                // original for the same reason the player does. Labelled
                // "Original" rather than repeating "Full video", which the
                // caption two inches left already says about the cut.
                if match.status == .ready, hasOriginal {
                    Button(action: onOriginal) {
                        HStack(spacing: 5) {
                            if openingOriginal {
                                ProgressView().controlSize(.mini).tint(PL.text300)
                            } else {
                                Image(systemName: "play.fill")
                                    .font(.system(size: 11, weight: .semibold))
                            }
                            Text("Original")
                                .font(.system(size: 14, weight: .medium))
                        }
                        .foregroundStyle(PL.text300)
                        .padding(.horizontal, 14)
                        .frame(height: 38)
                        .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .disabled(openingOriginal)
                    .accessibilityLabel("Watch the original video")
                }
                if match.status == .ready {
                    Button(action: onDownload) {
                        Image(systemName: "arrow.down.to.line")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(PL.text300)
                            .frame(width: 46, height: 38)
                            .overlay(Capsule().strokeBorder(PL.edge, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Download video")
                }
            }
            .padding(16)
        }
        .background(PL.surface, in: RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PL.rCard, style: .continuous)
                .strokeBorder(PL.edge, lineWidth: 1)
        )
    }
}

import SwiftUI

/// Development-only visual QA screen: every token and component in one scroll,
/// compared side by side against the web app during the port.
struct ThemeGallery: View {

    @State private var fieldText = ""
    @State private var toggleOn = true

    var body: some View {
        ZStack {
            ArenaBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 32) {
                    LogoWordmark()

                    Text("Theme gallery")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)

                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeading("Typography")
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Page title").font(.plPageTitle).tracking(-0.6).foregroundStyle(PL.textBody)
                            Text("Card title").font(.plCardTitle).foregroundStyle(PL.text100)
                            Text("Body text runs at fourteen points.").font(.plBody).foregroundStyle(PL.text300)
                            Text("Muted body for supporting lines.").font(.plBody).foregroundStyle(PL.text400)
                            Text("Caption metadata").font(.plCaption).foregroundStyle(PL.text500)
                            Text("0:54 · 11 – 8 · 2.4s").font(.plMicro).monospacedDigit().foregroundStyle(PL.text300)
                        }
                        .plCard()
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeading("Record placement ghost")
                        TableGhost(level: 0)
                            .frame(height: 200)
                            .frame(maxWidth: .infinity)
                            .background(Color.black)
                            .clipShape(RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeading("Recording strip and scoreboard")
                        // Both overlays as they sit over the viewfinder:
                        // the strip top-centre, the board in the corner.
                        // Shown against a stand-in for the picture, since
                        // the point of the redesign is that the picture
                        // stays readable behind them.
                        ZStack {
                            LinearGradient(
                                colors: [Color(hex: 0x1B2430),
                                         Color(hex: 0x0B0E13)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing)
                            VStack {
                                RecordingStrip()
                                Spacer()
                                HStack {
                                    ScoreBoard(
                                        scores: [
                                            SpokenGameScore(game: 1, you: 11, them: 2),
                                            SpokenGameScore(game: 2, you: 9, them: 11),
                                            SpokenGameScore(game: 3, you: 14, them: 12),
                                            SpokenGameScore(game: 4, you: 11, them: 6),
                                            SpokenGameScore(game: 5, you: 8, them: 11),
                                            SpokenGameScore(game: 6, you: 11, them: 9),
                                            SpokenGameScore(game: 7, you: 13, them: 11),
                                        ],
                                        youLabel: "Adil",
                                        missed: nil)
                                    Spacer(minLength: 0)
                                }
                            }
                            .padding(14)
                        }
                        .frame(height: 300)
                        .frame(maxWidth: .infinity)
                        .clipShape(RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))

                        SectionHeading("Someone at the phone, one game in")
                        ZStack {
                            LinearGradient(
                                colors: [Color(hex: 0x1B2430),
                                         Color(hex: 0x0B0E13)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing)
                            VStack {
                                RecordingStrip(hearing: true)
                                Spacer()
                                HStack {
                                    ScoreBoard(
                                        scores: [
                                            SpokenGameScore(game: 1, you: 11, them: 2),
                                            SpokenGameScore(game: 2, you: nil, them: nil),
                                        ],
                                        youLabel: "You",
                                        missed: 2)
                                    Spacer(minLength: 0)
                                }
                            }
                            .padding(14)
                        }
                        .frame(height: 260)
                        .frame(maxWidth: .infinity)
                        .clipShape(RoundedRectangle(cornerRadius: PL.rCard, style: .continuous))
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeading("Buttons")
                        VStack(alignment: .leading, spacing: 14) {
                            HStack(spacing: 12) {
                                Button("Upload a match") {}.buttonStyle(PLPrimaryButtonStyle())
                                Button("Cancel") {}.buttonStyle(PLSecondaryButtonStyle())
                            }
                            HStack(spacing: 12) {
                                Button("Get more minutes") {}.buttonStyle(PLCyanGhostButtonStyle())
                                Button("Discard") {}.buttonStyle(PLSoftDestructiveButtonStyle())
                                Button("Delete match") {}.buttonStyle(PLDestructiveButtonStyle())
                            }
                        }
                        .plCard()
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeading("Status")
                        VStack(alignment: .leading, spacing: 12) {
                            HStack(spacing: 8) {
                                StatusChip(status: .queued)
                                StatusChip(status: .processing)
                                StatusChip(status: .ready)
                            }
                            HStack(spacing: 8) {
                                StatusChip(status: .notProcessed)
                                StatusChip(status: .failed)
                                ScorePill(you: 3, them: 1)
                            }
                        }
                        .plCard()
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeading("Card")
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text("Marco · LYTTC").font(.plRowTitle).foregroundStyle(PL.text100)
                                Spacer()
                                ScorePill(you: 3, them: 2)
                            }
                            Text("Aug 14 · 62 points").font(.plCaption).foregroundStyle(PL.text500)
                            HStack(spacing: 10) {
                                Text("Point 12 · 4.2s").font(.plCaption).foregroundStyle(PL.text500)
                                Spacer()
                                Text("Updating clip").font(.plCaption).foregroundStyle(PL.text400)
                            }
                            .plInnerRow()
                            .padding(.top, 8)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .plCard()
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeading("Loading")
                        VStack(alignment: .leading, spacing: 14) {
                            HStack(spacing: 7) {
                                Image(systemName: "sparkles")
                                    .font(.system(size: 13))
                                    .foregroundStyle(PL.cyan)
                                Text("Reading your journal…")
                                    .font(.plCaption)
                                    .foregroundStyle(PL.text400)
                            }
                            VStack(alignment: .leading, spacing: 10) {
                                PLSkeletonBar()
                                PLSkeletonBar()
                                PLSkeletonBar(maxWidth: 300)
                                PLSkeletonBar(maxWidth: 190)
                            }
                            .plShimmer()
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .plCard(padding: 16)
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeading("Input")
                        VStack(alignment: .leading, spacing: 12) {
                            TextField("Opponent name", text: $fieldText)
                                .plField()
                            Toggle("Placement maps", isOn: $toggleOn)
                                .font(.plBody)
                                .foregroundStyle(PL.text200)
                                .tint(PL.cyan.opacity(0.5))
                        }
                        .plCard()
                    }

                    PLToast(message: "Resuming from point 14")
                        .frame(maxWidth: .infinity)
                }
                .padding(20)
                .padding(.bottom, 60)
            }
        }
    }
}

#Preview {
    ThemeGallery()
        .preferredColorScheme(.dark)
}

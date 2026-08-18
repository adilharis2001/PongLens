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

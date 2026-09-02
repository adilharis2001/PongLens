import SwiftUI

/// The invite that links a student to their coach. One standing link per
/// student (or one general link from Home), shown as a QR for across the
/// table and a URL for a text message. Opening it signed in joins them;
/// their matches and the coach's shared entries connect from then on.
struct StudentInviteSheet: View {
    /// The roster row the invite should bind, or nil for the general
    /// invite that adds whoever opens it.
    let student: CoachStudentRow?

    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    @Environment(CoachWorkspaceStore.self) private var workspace

    @State private var url: URL?
    @State private var failed = false
    @State private var copied = false
    @State private var resetAsk = false

    var body: some View {
        ZStack {
            PL.surface.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(student.map { "Invite \($0.displayName)" } ?? "Invite a student")
                        .font(.plPageTitle)
                        .tracking(-0.6)
                        .foregroundStyle(PL.textBody)

                    Text("Whoever opens this link and signs in joins as your student. You'll see the matches they upload, and the entries you share reach their journal.")
                        .font(.plBody)
                        .foregroundStyle(PL.text400)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)

                    if let url {
                        QRCodeView(url: url)
                        Text(url.absoluteString)
                            .font(.plCaption)
                            .foregroundStyle(PL.text400)
                            .textSelection(.enabled)
                            .lineLimit(2)
                        HStack(spacing: 10) {
                            ShareLink(item: url) {
                                Label("Send the link", systemImage: "square.and.arrow.up")
                                    .font(.plButtonSecondary)
                            }
                            .buttonStyle(PLSecondaryButtonStyle())
                            Button(copied ? "Copied" : "Copy") {
                                UIPasteboard.general.string = url.absoluteString
                                copied = true
                                DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                                    copied = false
                                }
                            }
                            .buttonStyle(PLSecondaryButtonStyle())
                        }
                        Button("Reset link") { resetAsk = true }
                            .buttonStyle(PLSoftDestructiveButtonStyle())
                        Text("Reset turns off every copy of this link that is out there. Use it if it reached someone it shouldn't have.")
                            .font(.plCaption)
                            .foregroundStyle(PL.text500)
                            .fixedSize(horizontal: false, vertical: true)
                    } else if failed {
                        Text("Couldn't get the link. Close this and try again.")
                            .font(.plCaption)
                            .foregroundStyle(PL.dangerText)
                    } else {
                        ProgressView().tint(PL.cyan)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 24)
                    }
                }
                .padding(24)
            }
        }
        .presentationDetents([.large, .medium])
        .presentationDragIndicator(.visible)
        .task {
            guard let uid = app.userId else { return }
            url = await workspace.inviteURL(coachId: uid, studentId: student?.id)
            failed = url == nil
        }
        .confirmationDialog("Reset this invite link?", isPresented: $resetAsk, titleVisibility: .visible) {
            Button("Reset", role: .destructive) {
                Task {
                    guard let uid = app.userId else { return }
                    url = nil
                    _ = await workspace.revokeInvites(coachId: uid, studentId: student?.id)
                    url = await workspace.inviteURL(coachId: uid, studentId: student?.id)
                    failed = url == nil
                }
            }
            Button("Keep", role: .cancel) {}
        } message: {
            Text("The old link stops working. You get a new one straight away.")
        }
    }
}

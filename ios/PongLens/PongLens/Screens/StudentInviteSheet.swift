import SwiftUI

/// The invite that links a student to their coach, in the sheet chrome
/// the rest of the app uses: a grouped form with the QR in one section
/// and the actions as rows. One standing link per student (or one
/// general link from Home); opening it signed in joins them.
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
        PLSheetScaffold(title: student.map { "Invite \($0.displayName)" } ?? "Invite a new student") {
            Form {
                Section {
                    if let url {
                        QRCodeView(url: url)
                            .listRowInsets(EdgeInsets())
                            .listRowBackground(Color.clear)
                    } else if failed {
                        Text("Couldn't get the link. Close this and try again.")
                            .foregroundStyle(PL.dangerText)
                    } else {
                        HStack {
                            Spacer()
                            ProgressView().tint(PL.cyan)
                            Spacer()
                        }
                        .padding(.vertical, 24)
                    }
                } footer: {
                    Text(student == nil
                         ? "For someone not on your list yet. Whoever opens this link and signs in joins as your student; a student already listed gets their own link from their page. They choose whether you see all their matches or only the ones they share, and the entries you share reach their journal."
                         : "Opening this link and signing in connects \(student!.displayName) to this row. They choose whether you see all their matches or only the ones they share, and the entries you share reach their journal.")
                }

                if let url {
                    Section {
                        ShareLink(item: url) {
                            Label("Send the link", systemImage: "square.and.arrow.up")
                        }
                        Button {
                            UIPasteboard.general.string = url.absoluteString
                            copied = true
                            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { copied = false }
                        } label: {
                            Label(copied ? "Copied" : "Copy link", systemImage: copied ? "checkmark" : "doc.on.doc")
                        }
                    } footer: {
                        Text(url.absoluteString)
                            .textSelection(.enabled)
                    }

                    Section {
                        Button(role: .destructive) { resetAsk = true } label: {
                            Label("Reset link", systemImage: "arrow.counterclockwise")
                        }
                    } footer: {
                        Text("Reset turns off every copy of this link that is out there and gives you a new one.")
                    }
                }
            }
        }
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

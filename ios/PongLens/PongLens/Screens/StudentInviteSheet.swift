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
    /// Which roster row a GENERAL invite should bind, when the coach says
    /// it is for somebody already on their list. Nil means someone new.
    @State private var picked: CoachStudentRow?

    /// The row this invite is really for. A general invite that names
    /// nobody creates a BRAND NEW roster row on accept — so a coach who
    /// has been filling a folder for "Emily" and sends the general link
    /// ends up with two rows, and everything they wrote stays behind on
    /// the unbound one (2026-09-04). Today the only repair is the merge
    /// on the new row's page, which a coach finds only if they know to
    /// look for it. Asking here stops it happening.
    private var target: CoachStudentRow? { student ?? picked }

    /// Rows worth offering: the ones with nobody behind them yet. A
    /// student who has already joined has their own link and cannot be
    /// bound twice.
    private var offlineStudents: [CoachStudentRow] {
        workspace.activeStudents.filter { !$0.linked }
    }

    var body: some View {
        PLSheetScaffold(title: target.map { "Invite \($0.displayName)" } ?? "Invite a new student") {
            Form {
                // Only on the GENERAL invite, and only when there is
                // somebody to confuse it with.
                if student == nil, !offlineStudents.isEmpty {
                    Section {
                        Button {
                            picked = nil
                        } label: {
                            pickRow("Someone new", selected: picked == nil)
                        }
                        ForEach(offlineStudents) { row in
                            Button {
                                picked = row
                            } label: {
                                pickRow(row.displayName, selected: picked?.id == row.id)
                            }
                        }
                    } header: {
                        Text("Who is this for?")
                    } footer: {
                        Text("Picking a name links them to that folder, so the entries you have already written are waiting for them. Someone new starts a fresh one.")
                    }
                }

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
                    Text(target == nil
                         ? "For someone not on your list yet. Whoever opens this link and signs in joins as your student; a student already listed gets their own link from their page. They choose whether you see all their matches or only the ones they share, and the entries you share reach their journal."
                         : "Opening this link and signing in connects \(target!.displayName) to this row. They choose whether you see all their matches or only the ones they share, and the entries you share reach their journal.")
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
        .task(id: target?.id) {
            guard let uid = app.userId else { return }
            url = nil
            failed = false
            url = await workspace.inviteURL(coachId: uid, studentId: target?.id)
            failed = url == nil
        }
        .confirmationDialog("Reset this invite link?", isPresented: $resetAsk, titleVisibility: .visible) {
            Button("Reset", role: .destructive) {
                Task {
                    guard let uid = app.userId else { return }
                    url = nil
                    _ = await workspace.revokeInvites(coachId: uid, studentId: target?.id)
                    url = await workspace.inviteURL(coachId: uid, studentId: target?.id)
                    failed = url == nil
                }
            }
            Button("Keep", role: .cancel) {}
        } message: {
            Text("The old link stops working. You get a new one straight away.")
        }
    }

    /// A choice, drawn as a row: the name, and a tick when it is the one.
    private func pickRow(_ label: String, selected: Bool) -> some View {
        HStack {
            Text(label)
                .foregroundStyle(selected ? PL.text100 : PL.text300)
            Spacer()
            if selected {
                Image(systemName: "checkmark")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PL.cyan)
            }
        }
        .contentShape(Rectangle())
    }
}

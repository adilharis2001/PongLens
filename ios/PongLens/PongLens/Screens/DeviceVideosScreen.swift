import SwiftUI

/// "Videos on this iPhone": the copies the app kept for matches waiting to
/// be marked (spec 2026-09-24, section 6). Accounts that can hand cut only,
/// reached from Account. Deleting one removes this phone's copy and
/// nothing else: the match, the upload and the copy in Photos all stay.
///
/// Built like the Processing page: a Form over the arena with the page's
/// own header as its first row.
struct DeviceVideosScreen: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    private var store: LocalMatchVideos { LocalMatchVideos.shared }

    var body: some View {
        let entries = store.entries(owner: app.userId)
        ZStack {
            ArenaBackground()
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 16) {
                        Button { dismiss() } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "chevron.left")
                                    .font(.system(size: 12, weight: .semibold))
                                Text("Back")
                            }
                        }
                        .buttonStyle(PLSecondaryButtonStyle())

                        Text("Videos on this iPhone")
                            .font(.plPageTitle)
                            .tracking(-0.6)
                            .foregroundStyle(PL.textBody)
                    }
                    .padding(.vertical, 4)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)
                }

                Section {
                    if entries.isEmpty {
                        Text("No videos kept on this iPhone.")
                            .font(.plBody)
                            .foregroundStyle(PL.text500)
                    } else {
                        ForEach(entries) { entry in
                            row(entry)
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .tint(PL.cyan)
            .refreshable { await store.reconcile() }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { await store.reconcile() }
    }

    private func row(_ entry: LocalVideoEntry) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(entry.title ?? "Match")
                    .font(.plRowTitle)
                    .foregroundStyle(PL.text100)
                    .lineLimit(2)
                Text([entry.detail, Self.size(entry.bytes)]
                    .compactMap { $0 }
                    .filter { !$0.isEmpty }
                    .joined(separator: " · "))
                    .font(.plCaption)
                    .foregroundStyle(PL.text500)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Button("Delete") {
                store.remove(matchId: entry.matchId)
            }
            .buttonStyle(PLSoftDestructiveButtonStyle())
            .accessibilityLabel("Delete the copy of \(entry.title ?? "this match") on this iPhone")
        }
        .padding(.vertical, 4)
    }

    private static func size(_ bytes: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }
}

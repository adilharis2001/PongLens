import SwiftUI

// MARK: - Sheet scaffold

/// The one way a sheet is dressed: inline navigation title, a semibold
/// Done in the trailing corner, cyan tint, dark scheme. The match details
/// sheet set this look, and every sheet with a Done button builds on it
/// instead of drawing its own header row.
///
/// Content is usually a `Form`, which brings the grouped section chrome
/// the details sheet made the house style. Done dismisses by default; a
/// sheet that saves first passes `onDone` and dismisses itself when the
/// work lands.
struct PLSheetScaffold<Content: View>: View {
    let title: String
    var doneLabel = "Done"
    var doneDisabled = false
    /// Sheets that carry their own pinned primary action turn this off.
    /// Two controls that do the same thing, both on screen at once, read
    /// as two choices — and the camera guide grew a pinned "Got it" when
    /// it started opening unasked.
    var showDone = true
    var onDone: (() -> Void)? = nil
    @ViewBuilder var content: () -> Content

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            content()
                .tint(PL.cyan)
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        if showDone {
                            Button(doneLabel) {
                                if let onDone {
                                    onDone()
                                } else {
                                    dismiss()
                                }
                            }
                            .fontWeight(.semibold)
                            .disabled(doneDisabled)
                        }
                    }
                }
        }
        .preferredColorScheme(.dark)
    }
}

import SwiftUI

// MARK: - Sheet scaffold

/// The one way a sheet is dressed: inline navigation title, a semibold
/// Done in the trailing corner, cyan tint, dark scheme. The match details
/// sheet set this look, and every sheet builds on it instead of drawing
/// its own header row.
///
/// Content is a `Form`, which brings the grouped section chrome the
/// details sheet made the house style: the same ground, the same cells,
/// the same gap between groups, on every sheet. Done dismisses by
/// default; a sheet that saves first passes `onDone` and dismisses itself
/// when the work lands.
///
/// Every sheet the match page can raise went through here on 2026-09-14.
/// Before that, three of them drew a bold title of their own on a
/// different background, with their own row and button styles, and the
/// chooser sheets had a third look again. Tapping down the Tools list
/// read as three apps. The rows below (`PLSheetActionRow`, `PLChoiceRow`,
/// `PLRowLabel`) are the pieces those sheets now share, so a new sheet
/// gets the same look by reaching for them rather than by matching a
/// screenshot.
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
                // A solid ground, always. On iOS 26 a sheet that is not
                // full height is glass by default: the page shows through
                // it, a glowing button underneath bleeds into the rows,
                // and the grey detail lines stop being readable. The
                // simulator draws the same sheet opaque, which is how the
                // glass version shipped in build 201 (Adil, 2026-09-14).
                // The toolbar keeps its glass; only the ground is solid.
                .scrollContentBackground(.hidden)
                .presentationBackground(PL.surface)
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

// MARK: - Rows a sheet is built from

/// A row's words: the title, and under it the one line that says what
/// the title means here. One definition, so a choice, an export and a
/// chooser row all set their type the same way.
struct PLRowLabel: View {
    let title: String
    var detail: String? = nil
    /// Greyed, for a row that is on the list but cannot be taken yet.
    var dimmed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.plCardTitle)
                .foregroundStyle(dimmed ? PL.text500 : PL.text100)
            if let detail, !detail.isEmpty {
                Text(detail)
                    .font(.plCaption)
                    // text400, not 500: a caption on a sheet has to be
                    // read at arm's length over a dark ground.
                    .foregroundStyle(PL.text400)
                    // A detail that runs to two lines must grow the row
                    // rather than be cut off at the first.
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .multilineTextAlignment(.leading)
    }
}

/// The primary action on a sheet: one full-width cyan capsule, standing
/// in its own clear row so it reads as the button it is rather than as a
/// cell with a button inside it. A sheet has at most one of these.
struct PLSheetActionRow: View {
    let label: String
    var disabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label).frame(maxWidth: .infinity, minHeight: 28)
        }
        .buttonStyle(PLPrimaryButtonStyle())
        .disabled(disabled)
        // Room for the glow, which the cell would otherwise trim.
        .padding(.vertical, 4)
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
        .listRowSeparator(.hidden)
    }
}

/// A row's own control, at its trailing edge: a word in the accent, the
/// dress a list gives an action that belongs to one row rather than to
/// the sheet (the coach sheet's Share; Export's Create and Download).
struct PLRowAction: View {
    let label: String
    var disabled = false
    let action: () -> Void

    init(_ label: String, disabled: Bool = false, action: @escaping () -> Void) {
        self.label = label
        self.disabled = disabled
        self.action = action
    }

    var body: some View {
        Button(label, action: action)
            .buttonStyle(.borderless)
            .fontWeight(.semibold)
            .foregroundStyle(disabled ? PL.text500 : PL.cyan)
            .disabled(disabled)
    }
}

/// Choose one of these. Title and detail on the left, a radio mark on the
/// right — drawn on every row, so both read as a choice before either is
/// picked. The share sheet's own row, shared out.
struct PLChoiceRow: View {
    let title: String
    var detail: String? = nil
    let selected: Bool
    /// Working on this row's choice; the mark gives way to a spinner.
    var busy = false
    var disabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                PLRowLabel(title: title, detail: detail)
                Spacer(minLength: 8)
                if busy {
                    ProgressView().controlSize(.small).tint(PL.cyan)
                } else {
                    Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(selected ? PL.cyan : PL.text600)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

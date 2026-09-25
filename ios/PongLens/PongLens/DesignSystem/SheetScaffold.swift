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
                // Where the Form starts, for a block's words (PLCaptionedBlock).
                .plFormOrigin()
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
/// on the sheet's ground so it reads as the button it is rather than as a
/// cell with a button inside it. A sheet has at most one of these.
///
/// A block, not a row: place it in a section's footer with
/// `plFormBlock`. As a clear row it had its glow trimmed to the row's
/// rounded rectangle, a second curve drawn around the capsule (build 244).
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
        // The gap it kept as a row, so the words under it sit where they did.
        .padding(.vertical, 4)
    }
}

// MARK: - Blocks that keep their own shape

extension View {
    /// Stands a block that draws its own shape (choice cards, a video
    /// frame, a QR tile, a row of chips, the sheet's primary action) on a
    /// Form, in a section's footer slot instead of in a row.
    ///
    /// Why not a row: on iOS 26 a Form row is clipped to its section's
    /// corners, about 26pt, whatever the row's background. A clear row
    /// does not help. The Later card's top corners and the Mark card's
    /// bottom ones came out cut by that larger curve, the Your side frame
    /// likewise, and the primary action's glow was trimmed to a rounded
    /// rectangle (build 244; "let it take the natural shape", Adil). The
    /// header and footer slots are never clipped, so a block there keeps
    /// its own corners and its own glow. Ordinary rows stay rows.
    ///
    /// The block runs the full width of the cells above and below it.
    /// `top: 0`, the default, is for a block that opens its section: the
    /// gap above it is then exactly a row's, under a header or after the
    /// section before. `top: nil` keeps the footer's own gap, for a block
    /// under a section's rows (the gap a caption keeps from its rows).
    /// A block with words under it is a `PLCaptionedBlock`.
    func plFormBlock(top: CGFloat? = 0) -> some View {
        self
            .plBlockDress()
            .listRowInsets(.horizontal, 0)
            .listRowInsets(.top, top)
    }

    /// The footer slot sets its content in the caption style; a block gets
    /// back what it had as a row.
    fileprivate func plBlockDress() -> some View {
        self
            .font(.body)
            .foregroundStyle(.primary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A block with the words that belong under it (what was its section's
/// footer), both in the section's footer slot: the block at the cells'
/// full width, the words in the footer's own type at the footer's own
/// inset and gap, exactly where they sat under the rows.
///
/// The inset is read, not written down, because it is not one number: 16
/// on a Pro and 20 on a Pro Max, and in a floating medium sheet the cells
/// also sit a further 7 or so in from the sheet's edge while the words do
/// not. What holds everywhere (measured, iOS 26, both phones, both
/// detents) is that the words sit as far in from the cells' edge as the
/// cells sit from the Form's, to the next whole point. So the block reads
/// its own edge against the Form's (`plFormOrigin`, which
/// `PLSheetScaffold` applies).
///
/// A separate section for the words would keep the inset but not the gap:
/// section spacing is shared by both sides of a section, so pulling the
/// words up also pulled the section above down onto the block's header.
struct PLCaptionedBlock<Block: View, Caption: View>: View {
    /// As `plFormBlock(top:)`.
    var top: CGFloat?
    var block: Block
    var caption: Caption

    @Environment(\.plFormLeading) private var formLeading
    /// The block's leading edge on screen, once laid out.
    @State private var blockLeading: CGFloat?

    init(
        top: CGFloat? = 0,
        @ViewBuilder block: () -> Block,
        @ViewBuilder caption: () -> Caption
    ) {
        self.top = top
        self.block = block()
        self.caption = caption()
    }

    /// The cells' side margin; 16 until the first layout reads it. A Form
    /// without `plFormOrigin` is taken to start at the screen's edge.
    private var inset: CGFloat {
        guard let blockLeading else { return 16 }
        return max(0, (blockLeading - (formLeading ?? 0) - 0.01).rounded(.up))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            block
                .plBlockDress()
                .onGeometryChange(for: CGFloat.self) { proxy in
                    proxy.frame(in: .global).minX
                } action: { minX in
                    blockLeading = minX
                }
            caption
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, inset)
                // A footer's own gap under its rows (measured, iOS 26).
                .padding(.top, 8)
        }
        .listRowInsets(.horizontal, 0)
        .listRowInsets(.top, top)
    }
}

extension View {
    /// On a Form holding a `PLCaptionedBlock`: where the Form starts on
    /// screen, so the block can tell the cells' margin from the sheet's
    /// own offset. `PLSheetScaffold` applies it to every sheet.
    func plFormOrigin() -> some View {
        modifier(PLFormOrigin())
    }
}

private struct PLFormOrigin: ViewModifier {
    @State private var leading: CGFloat?

    func body(content: Content) -> some View {
        content
            .onGeometryChange(for: CGFloat.self) { proxy in
                proxy.frame(in: .global).minX
            } action: { minX in
                leading = minX
            }
            .environment(\.plFormLeading, leading)
    }
}

private struct PLFormLeadingKey: EnvironmentKey {
    static let defaultValue: CGFloat? = nil
}

extension EnvironmentValues {
    /// The Form's leading edge on screen (`plFormOrigin`); nil outside one.
    var plFormLeading: CGFloat? {
        get { self[PLFormLeadingKey.self] }
        set { self[PLFormLeadingKey.self] = newValue }
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

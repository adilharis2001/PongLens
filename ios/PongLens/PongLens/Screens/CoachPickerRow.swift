import SwiftUI

/// "Who taught it?" — a pick from the player's own coaches (164), with a
/// door to name a new one, and the share answer beside it.
///
/// The web twin is `CoachPicker` in src/app/journal/CoachPicker.tsx. Both
/// replaced a free-text box, which is why one person could be "Jonathan"
/// on one entry and "Jonotan" on the next, with nothing that reads the
/// journal able to tell they were the same man or connect either to his
/// account.
///
/// Sharing is asked HERE rather than in a step of its own, because that
/// was Adil's call (2026-09-04): attributing and sharing are one moment,
/// with the answer stated rather than assumed. It defaults to off — a
/// default is what gets accepted when nobody is reading.
///
/// A Menu rather than chips: this sits inside a Form on the edit sheet and
/// inside a plain stack on the recorder's review screen, and a menu row
/// belongs in both. Chips would be a second layout to keep in step.
struct CoachPickerRow: View {
    let coaches: [PlayerCoach]
    @Binding var coachRefId: UUID?
    @Binding var shareWithCoach: Bool
    /// Find-or-create by name; nil if it failed.
    let onCreate: (String) async -> PlayerCoach?

    /// Re-read the list every time the control appears. It changes on
    /// other screens — an invite made or revoked in Coaching — and
    /// without this the composer keeps whatever it loaded when the
    /// journal first rendered.
    let onAppearReload: () async -> Void

    @State private var addingName = ""
    @State private var addOpen = false
    @State private var busy = false
    @State private var failed = false

    private var chosen: PlayerCoach? {
        coaches.first { $0.id == coachRefId }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Menu {
                ForEach(coaches) { coach in
                    Button {
                        coachRefId = coach.id
                        // Moving to someone who cannot receive entries
                        // cannot leave a share switched on behind it.
                        if !coach.canReceiveEntries { shareWithCoach = false }
                    } label: {
                        // Which list they are on. Only the invited are
                        // marked: a connected coach is the ordinary case,
                        // and so is one you typed who is not on PongLens.
                        // The share toggle below says who can read it.
                        let label = coach.stateMark.map {
                            "\(coach.displayName) · \($0)"
                        } ?? coach.displayName
                        if coach.id == coachRefId {
                            Label(label, systemImage: "checkmark")
                        } else {
                            Text(label)
                        }
                    }
                }
                if coachRefId != nil {
                    Button("Nobody", role: .destructive) {
                        coachRefId = nil
                        shareWithCoach = false
                    }
                }
                Divider()
                Button(coaches.isEmpty ? "Add your coach" : "Add a coach") {
                    addingName = ""
                    addOpen = true
                }
            } label: {
                HStack {
                    Text("Who taught it?")
                        .font(.plBody)
                        .foregroundStyle(PL.text400)
                    Spacer(minLength: 12)
                    Text(chosen?.displayName ?? "Choose")
                        .font(.plBody)
                        .foregroundStyle(chosen == nil ? PL.text500 : PL.text100)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(PL.text500)
                }
            }
            .disabled(busy)

            if let chosen, chosen.canReceiveEntries {
                Toggle(isOn: $shareWithCoach) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Share this entry with \(chosen.displayName)")
                            .font(.plBody)
                            .foregroundStyle(PL.text300)
                        if let hint = chosen.shareHint {
                            Text(hint)
                                .font(.plCaption)
                                .foregroundStyle(PL.text500)
                        }
                    }
                }
                .tint(PL.cyan)
            }

            if failed {
                Text("Couldn't add them. Try again.")
                    .font(.plCaption)
                    .foregroundStyle(PL.dangerText)
            }
        }
        .task { await onAppearReload() }
        .alert("Add a coach", isPresented: $addOpen) {
            TextField("Their name", text: $addingName)
                .textInputAutocapitalization(.words)
            Button("Cancel", role: .cancel) {}
            Button("Add") {
                let name = addingName
                Task {
                    busy = true
                    failed = false
                    if let created = await onCreate(name) {
                        coachRefId = created.id
                        // A brand-new coach starts unshared, whatever the
                        // toggle happened to be showing for the last one.
                        shareWithCoach = false
                    } else {
                        failed = true
                    }
                    busy = false
                }
            }
        }
    }
}

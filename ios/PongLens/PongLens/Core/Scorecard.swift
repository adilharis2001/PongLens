import Foundation

// Port of src/app/match/[id]/scorecard.ts — the analysis questions.
// Loss reasons are first-person only: never asked on points you won.

struct ReasonChip: Identifiable, Hashable {
    let value: String
    let label: String
    var id: String { value }
}

let LOSS_REASON_LABELS: [String: String] = [
    "misread_spin": "Misread the spin",
    "out_of_position": "Out of position",
    "too_aggressive": "Too aggressive",
    "too_passive": "Too passive",
    "lost_focus": "Lost focus",
    "their_winner": "They were just better",
    "weak_serve": "Weak serve",
    "receive_error": "Receive error",
    // Stored but never offered again.
    "rushed": "Too aggressive",
]

private let CORE_WHEN_I_SERVED = [
    "too_aggressive", "their_winner", "out_of_position",
    "too_passive", "misread_spin", "lost_focus",
]

private let CORE_WHEN_THEY_SERVED = [
    "misread_spin", "too_passive", "too_aggressive",
    "out_of_position", "their_winner", "lost_focus",
]

/// The reasons to offer on a lost point, in chip order. The rotation-gated
/// serve chip leads: "Weak serve" when I served, "Receive error" when they
/// did, neither when the rotation can't say.
func lossReasonsFor(iServed: Bool?) -> [ReasonChip] {
    var chips: [ReasonChip] = []
    if let iServed {
        let key = iServed ? "weak_serve" : "receive_error"
        chips.append(ReasonChip(value: key, label: LOSS_REASON_LABELS[key]!))
    }
    let core = (iServed ?? false) ? CORE_WHEN_I_SERVED : CORE_WHEN_THEY_SERVED
    chips.append(contentsOf: core.map { ReasonChip(value: $0, label: LOSS_REASON_LABELS[$0]!) })
    return chips
}

/// Analysis exists on exactly one kind of point: one the owner lost.
func hasLossAnalysis(_ point: MatchPoint) -> Bool {
    !point.isLet && point.confirmedWinner == .opponent
}

/// The serve diagnosis applies when the point turned on the serve itself.
func serveApplies(_ reasons: [String]?) -> Bool {
    guard let reasons, !reasons.isEmpty else { return false }
    return reasons.contains("receive_error") || reasons.contains("weak_serve")
}

func misreadKindApplies(_ reasons: [String]?) -> Bool {
    reasons?.contains("misread_spin") ?? false
}

func outOfPositionApplies(_ reasons: [String]?) -> Bool {
    reasons?.contains("out_of_position") ?? false
}

let MISREAD_KINDS: [ReasonChip] = [
    ReasonChip(value: "type", label: "The type of spin"),
    ReasonChip(value: "amount", label: "The amount of spin"),
]

let DIRECTIONS: [ReasonChip] = [
    ReasonChip(value: "bh", label: "Backhand"),
    ReasonChip(value: "mid", label: "Middle"),
    ReasonChip(value: "fh", label: "Forehand"),
]

let SERVE_SPINS: [ReasonChip] = [
    ReasonChip(value: "back", label: "Backspin"),
    ReasonChip(value: "top", label: "Topspin"),
    ReasonChip(value: "none", label: "No spin"),
]

let SERVE_LENGTHS: [ReasonChip] = [
    ReasonChip(value: "short", label: "Short"),
    ReasonChip(value: "half", label: "Half-long"),
    ReasonChip(value: "long", label: "Long"),
]

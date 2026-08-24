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

// MARK: - Skip reasons

/// Optional reasons for the SKIPPED outcome (is_let = true), stored in the
/// same confirmed_how column.
let SKIP_REASONS: [ReasonChip] = [
    ReasonChip(value: "let", label: "Let serve"),
    ReasonChip(value: "misrecorded", label: "Wrong recording"),
    ReasonChip(value: "other", label: "Other"),
]

private let SKIP_LABELS: [String: String] = [
    "let": "Let serve", "misrecorded": "Wrong recording", "other": "Other",
]

// MARK: - Retired "how it ended" values (shown, never offered)

private let HOW_LABELS: [String: String] = [
    "hit_into_net": "Hit into net", "missed_long": "Missed long",
    "missed_wide": "Missed wide", "receive_error": "Receive error",
    "clean_winner": "Clean winner", "service_ace": "Service ace",
    "edge_ball": "Edge ball", "net_cord_dribbler": "Clipped the net",
    "double_bounce": "Double bounce", "serve_fault": "Serve fault",
    "forced_error": "Forced error",
]

private let LEGACY_HOW: [String: String] = [
    "net": "Hit into net", "missed_table": "Missed the table",
    "edge_net_cord": "Edge or net cord",
]

/// Human label for a stored confirmed_how, old or new — the "Recorded
/// earlier" summary row. Nothing writes these on scored points anymore.
func howLabel(_ value: String?) -> String? {
    guard let value, !value.isEmpty else { return nil }
    return HOW_LABELS[value] ?? SKIP_LABELS[value] ?? LEGACY_HOW[value] ?? value
}

/// Normalize a stored skip reason to a selectable value.
func canonicalSkipReason(_ value: String?) -> String {
    guard let value, SKIP_LABELS[value] != nil else { return "" }
    return value
}

// MARK: - Custom reasons ("custom:<uuid>" in loss_reasons)

/// One of the owner's own "why I lost it" pills (loss_reason_labels, 060).
/// Declared here rather than beside its store so the label helpers below
/// stay Foundation-only and testable without a network client.
struct CustomReason: Codable, Identifiable, Hashable {
    let id: String
    let label: String
}

let MAX_CUSTOM_REASON_LEN = 24
private let CUSTOM_PREFIX = "custom:"

/// Sentence case, single-spaced, capped — the shape every built-in has.
func normalizeCustomReasonLabel(_ raw: String) -> String {
    let clean = raw
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        .prefix(MAX_CUSTOM_REASON_LEN)
    guard let first = clean.first else { return "" }
    return String(first).uppercased() + clean.dropFirst().lowercased()
}

func isCustomReason(_ value: String) -> Bool { value.hasPrefix(CUSTOM_PREFIX) }
func customReasonValue(id: String) -> String { CUSTOM_PREFIX + id }
func customReasonId(_ value: String) -> String? {
    isCustomReason(value) ? String(value.dropFirst(CUSTOM_PREFIX.count)) : nil
}

/// Rotation changed under saved reasons: drop the mirror chip the new
/// rotation no longer offers.
func pruneLossReasons(_ reasons: [String]?, iServed: Bool?) -> [String] {
    guard let reasons, !reasons.isEmpty else { return [] }
    let drop: Set<String> = switch iServed {
    case nil: ["weak_serve", "receive_error"]
    case true?: ["receive_error"]
    case false?: ["weak_serve"]
    }
    return reasons.filter { !drop.contains($0) }
}

/// The reasons to offer on a lost point: the rotation-gated serve chip
/// leads, then the core six, then the owner's own pills.
func lossReasonsFor(iServed: Bool?, custom: [CustomReason]) -> [ReasonChip] {
    var chips = lossReasonsFor(iServed: iServed)
    chips.append(contentsOf: custom.map {
        ReasonChip(value: customReasonValue(id: $0.id), label: $0.label)
    })
    return chips
}

/// Human label for one stored loss-reason value, built-in or custom.
///
/// A custom pill whose label row is missing renders as "Removed reason"
/// rather than nil: the array has no foreign key (060), so a label deleted
/// straight from SQL would otherwise make the reason vanish from a point
/// that genuinely carries it.
func lossReasonLabel(_ value: String, custom: [CustomReason] = []) -> String? {
    if let id = customReasonId(value) {
        return custom.first { $0.id == id }?.label ?? "Removed reason"
    }
    return LOSS_REASON_LABELS[value]
}

/// "Too aggressive · Out of position", or nil when nothing is set.
/// Port of scorecard.ts lossReasonsSummary.
func lossReasonsSummary(_ reasons: [String]?, custom: [CustomReason] = []) -> String? {
    guard let reasons, !reasons.isEmpty else { return nil }
    let labels = reasons.compactMap { lossReasonLabel($0, custom: custom) }
    return labels.isEmpty ? nil : labels.joined(separator: " · ")
}

/// What a skipped point says on a card. Port of scorecard.ts skipChipLabel.
func skipChipLabel(_ how: String?) -> String {
    if how == "let" { return "Let" }
    if how == "misrecorded" { return "Wrong recording" }
    return "Skipped"
}

/// "Side-under · Short" — what the saved serve rows compose back into.
func serveSummaryLabel(spin: String?, sidespin: Bool?, length: String?) -> String? {
    var parts: [String] = []
    if sidespin == true {
        parts.append(spin == "back" ? "Side-under" : spin == "top" ? "Side-top" : "Sidespin")
    } else if let spin, let label = SERVE_SPINS.first(where: { $0.value == spin })?.label {
        parts.append(label)
    }
    if let length, let label = SERVE_LENGTHS.first(where: { $0.value == length })?.label {
        parts.append(label)
    }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
}

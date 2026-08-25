import Foundation

/// The iOS half of the camera-guide rule, checked against the same JSON
/// table the web half uses. Neither side produces the table; it is the
/// spec written down once, so that comparing two ports cannot degenerate
/// into reading the same paragraph twice and making the same mistake
/// twice.
func runCameraGuideGateChecks() {
    print("\n— camera guide gate —")

    let url = URL(fileURLWithPath: "fixtures/camera-guide-gate.json")
    guard let data = try? Data(contentsOf: url),
          let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else {
        check(false, "fixture fixtures/camera-guide-gate.json is readable")
        return
    }

    // --- readSeenCount ---------------------------------------------------
    let readCases = root["readSeenCount"] as? [[String: Any]] ?? []
    check(!readCases.isEmpty, "the readSeenCount table is not empty")
    for c in readCases {
        let name = c["name"] as? String ?? "?"
        let expected = CameraGuideGate.coerce(c["expected"])
        let got = CameraGuideGate.readSeenCount(account: c["account"], device: c["device"])
        check(got == expected, "read: \(name) — expected \(String(describing: expected)), got \(String(describing: got))")
    }

    // --- the gate itself -------------------------------------------------
    let gateCases = root["gate"] as? [[String: Any]] ?? []
    check(!gateCases.isEmpty, "the gate table is not empty")
    for c in gateCases {
        let name = c["name"] as? String ?? "?"
        let seen = CameraGuideGate.coerce(c["seen"])
        let hasAnyMatch = c["hasAnyMatch"] as? Bool ?? false
        let shownThisSession = c["shownThisSession"] as? Bool ?? false
        let expected = CameraGuideGate.Decision(
            show: c["show"] as? Bool ?? false,
            persist: CameraGuideGate.coerce(c["persist"])
        )
        let got = CameraGuideGate.gate(
            seen: seen, hasAnyMatch: hasAnyMatch, shownThisSession: shownThisSession
        )
        check(got == expected, "gate: \(name) — expected \(expected), got \(got)")
    }

    // --- the sequences, which a per-row check cannot see ------------------

    // Two showings and no more. The failure that matters here is a counter
    // that never advances, which every individual row would still pass.
    var seen: Int?
    var shown = 0
    for _ in 0..<6 {
        let d = CameraGuideGate.gate(seen: seen, hasAnyMatch: false, shownThisSession: false)
        if d.show { shown += 1 }
        if let p = d.persist { seen = p }
    }
    check(shown == CameraGuideGate.maxShowings, "exactly two showings over six launches (got \(shown))")
    check(seen == CameraGuideGate.maxShowings, "the counter ends at the cap")

    // The sports-hall case: Supabase never accepts anything, so only the
    // device copy advances. The cap has to hold on that alone.
    var device: String?
    shown = 0
    for _ in 0..<6 {
        let s = CameraGuideGate.readSeenCount(account: nil, device: device)
        let d = CameraGuideGate.gate(seen: s, hasAnyMatch: false, shownThisSession: false)
        if d.show { shown += 1 }
        if let p = d.persist { device = String(p) }
    }
    check(shown == CameraGuideGate.maxShowings, "offline, still exactly two showings (got \(shown))")

    // Record, then practice, then upload, without quitting the app.
    seen = nil
    var shownThisSession = false
    shown = 0
    for _ in 0..<3 {
        let d = CameraGuideGate.gate(seen: seen, hasAnyMatch: false, shownThisSession: shownThisSession)
        if d.show { shown += 1; shownThisSession = true }
        if let p = d.persist { seen = p }
    }
    check(shown == 1, "three doors in one launch is one showing (got \(shown))")
    check(seen == 1, "the second showing is still owed")

    // One simulator gets shared between accounts.
    check(
        CameraGuideGate.storageKey(userId: "a") != CameraGuideGate.storageKey(userId: "b"),
        "the device key is per account"
    )
}

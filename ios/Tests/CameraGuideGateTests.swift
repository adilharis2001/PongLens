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

    // --- the recording brief, against the same table --------------------
    let briefCases = root["brief"] as? [[String: Any]] ?? []
    check(!briefCases.isEmpty, "the brief table is not empty")
    for c in briefCases {
        let name = c["name"] as? String ?? "?"
        let expected = RecordingBriefGate.Decision(
            show: c["show"] as? Bool ?? false,
            seed: CameraGuideGate.coerce(c["seed"])
        )
        let got = RecordingBriefGate.gate(
            seen: CameraGuideGate.coerce(c["seen"]),
            hasAnyMatch: c["hasAnyMatch"] as? Bool ?? false
        )
        check(got == expected, "brief: \(name) — expected \(expected), got \(got)")
    }

    // Open it, quit halfway, come back: still owed. Finish it: never again.
    var briefSeen: Int?
    var opened = 0
    for _ in 0..<3 {
        let d = RecordingBriefGate.gate(seen: briefSeen, hasAnyMatch: false)
        if d.show { opened += 1 }
        check(d.seed == nil, "nothing is written for a walk that was abandoned")
    }
    check(opened == 3, "an abandoned walk comes back every time (got \(opened))")
    briefSeen = RecordingBriefGate.done
    for launch in 0..<4 {
        let d = RecordingBriefGate.gate(seen: briefSeen, hasAnyMatch: launch > 0)
        check(!d.show && d.seed == nil, "finished is finished")
    }
    check(
        RecordingBriefGate.storageKey(userId: "a") != CameraGuideGate.storageKey(userId: "a"),
        "the brief's device key is not the sheet's"
    )
}

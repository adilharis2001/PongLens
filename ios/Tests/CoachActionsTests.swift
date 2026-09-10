import Foundation

/// The iOS half of the coach-action rules, checked against the same JSON table
/// the web half uses. Neither side produces the table; it is the spec written
/// down once, so that comparing two ports cannot degenerate into reading the
/// same paragraph twice and making the same mistake twice.
func runCoachActionsChecks() {
    print("\n— coach actions —")

    let url = URL(fileURLWithPath: "fixtures/coach-actions.json")
    guard let data = try? Data(contentsOf: url),
          let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else {
        check(false, "fixture fixtures/coach-actions.json is readable")
        return
    }

    // --- the door onto the coaches list ----------------------------------
    let doorCases = root["tabDoor"] as? [[String: Any]] ?? []
    check(!doorCases.isEmpty, "the tabDoor table is not empty")
    for c in doorCases {
        let name = c["name"] as? String ?? "?"
        let state = CoachActions.ListState(rawValue: c["state"] as? String ?? "") ?? .ready
        let got = CoachActions.tabDoor(
            coachCount: c["coaches"] as? Int ?? 0,
            pendingInviteCount: c["pending"] as? Int ?? 0,
            state: state)
        check(got.rawValue == (c["expected"] as? String ?? ""),
              "door: \(name) — expected \(c["expected"] ?? "?"), got \(got.rawValue)")
    }

    // --- how many invites are waiting -------------------------------------
    for c in root["invitesWaiting"] as? [[String: Any]] ?? [] {
        let n = c["n"] as? Int ?? 0
        let expected = c["expected"] as? String
        let got = CoachActions.invitesWaitingLabel(n)
        check(got == expected,
              "invites waiting \(n) — expected \(expected ?? "nil"), got \(got ?? "nil")")
    }

    // --- who can be invited, whose access can end -------------------------
    for c in root["canSendInvite"] as? [[String: Any]] ?? [] {
        let status = c["status"] as? String ?? ""
        check(CoachActions.canSendInvite(status: status) == (c["expected"] as? Bool ?? false),
              "canSendInvite: \(status)")
    }
    for c in root["canEndAccess"] as? [[String: Any]] ?? [] {
        let status = c["status"] as? String ?? ""
        check(CoachActions.canEndAccess(status: status) == (c["expected"] as? Bool ?? false),
              "canEndAccess: \(status)")
    }

    // --- the words a player reads ----------------------------------------
    for c in root["standingWords"] as? [[String: Any]] ?? [] {
        let status = c["status"] as? String ?? ""
        check(CoachActions.standingWords(status) == (c["expected"] as? String ?? ""),
              "standing: \(status)")
    }

    for c in root["accessLine"] as? [[String: Any]] ?? [] {
        let name = c["name"] as? String ?? "?"
        let got = CoachActions.accessLine(
            status: c["status"] as? String ?? "",
            hasAccount: c["hasAccount"] as? Bool ?? false,
            access: c["access"] as? String)
        check(got == (c["expected"] as? String ?? ""),
              "access line: \(name) — expected \(c["expected"] ?? "?"), got \(got)")
    }

    // --- recognising a name already on the list ---------------------------
    let dupCases = root["duplicateNotice"] as? [[String: Any]] ?? []
    check(!dupCases.isEmpty, "the duplicateNotice table is not empty")
    let decoder = JSONDecoder()
    for c in dupCases {
        let name = c["name"] as? String ?? "?"
        guard let rowsRaw = c["rows"],
              let rowsData = try? JSONSerialization.data(withJSONObject: rowsRaw),
              let rows = try? decoder.decode([PlayerCoach].self, from: rowsData)
        else {
            check(false, "duplicate: \(name) — rows decode")
            continue
        }
        let got = CoachActions.duplicateNotice(rows: rows, typed: c["typed"] as? String ?? "")
        if c["expected"] is NSNull || c["expected"] == nil {
            check(got == nil, "duplicate: \(name) — expected no notice, got \(got?.line ?? "nil")")
            continue
        }
        let want = c["expected"] as? [String: Any] ?? [:]
        check(got?.line == want["line"] as? String,
              "duplicate: \(name) — line")
        check(got?.action.rawValue == want["action"] as? String,
              "duplicate: \(name) — action")
    }

    // --- what the confirmations ask ---------------------------------------
    for c in root["removeConfirm"] as? [[String: Any]] ?? [] {
        let status = c["status"] as? String ?? ""
        let want = c["expected"] as? [String: Any] ?? [:]
        let got = CoachActions.removeConfirm(
            name: c["name"] as? String ?? "", status: status)
        check(got.title == want["title"] as? String, "remove \(status): title")
        check(got.body == want["body"] as? String, "remove \(status): body")
        check(got.confirmLabel == want["confirmLabel"] as? String, "remove \(status): button")
    }

    for c in root["endAccessConfirm"] as? [[String: Any]] ?? [] {
        let want = c["expected"] as? [String: Any] ?? [:]
        let got = CoachActions.endAccessConfirm(name: c["name"] as? String ?? "")
        check(got.title == want["title"] as? String, "end access: title")
        check(got.body == want["body"] as? String, "end access: body")
        check(got.confirmLabel == want["confirmLabel"] as? String, "end access: button")
    }

    // --- afterwards --------------------------------------------------------
    for c in root["restoreNotice"] as? [[String: Any]] ?? [] {
        let status = c["status"] as? String ?? ""
        let expected = c["expected"] as? String
        let got = CoachActions.restoreNotice(status: status)
        check(got == expected, "restore notice: \(status)")
    }

    for c in root["inviteWaitingLine"] as? [[String: Any]] ?? [] {
        let here = c["revokeIsHere"] as? Bool ?? false
        check(CoachActions.inviteWaitingLine(revokeIsHere: here) == (c["expected"] as? String ?? ""),
              "invite waiting line: revoke here \(here)")
    }
}

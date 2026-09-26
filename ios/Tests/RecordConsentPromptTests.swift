import Foundation

/// The camera's upload rights prompt: who is asked, when, and what closing
/// it means. The rows check each rule; the walks check the visits a person
/// actually has, which is where a rule that is right row by row can still
/// leave somebody stuck in front of a shutter that never starts.
func runRecordConsentPromptChecks() {
    print("\n— record consent prompt —")

    // --- who is asked ------------------------------------------------------
    check(RecordConsentPrompt.shouldAsk(needed: true, agreedThisVisit: false, cameraReady: true),
          "a new account is asked when the camera is ready")
    check(!RecordConsentPrompt.shouldAsk(needed: false, agreedThisVisit: false, cameraReady: true),
          "an account that has confirmed is never asked")
    check(!RecordConsentPrompt.shouldAsk(needed: true, agreedThisVisit: true, cameraReady: true),
          "an account that agreed this visit is not asked again")
    check(!RecordConsentPrompt.shouldAsk(needed: true, agreedThisVisit: false, cameraReady: false),
          "nothing is asked before the picture is showing, or while recording")

    // --- the shutter -------------------------------------------------------
    check(RecordConsentPrompt.mayRecord(needed: false, agreedThisVisit: false),
          "a confirmed account records straight away")
    check(RecordConsentPrompt.mayRecord(needed: true, agreedThisVisit: true),
          "a new account records once it has agreed")
    check(!RecordConsentPrompt.mayRecord(needed: true, agreedThisVisit: false),
          "a new account that has not agreed is asked at the shutter instead")

    // --- closing the prompt ------------------------------------------------
    check(!RecordConsentPrompt.closesCamera(agreedThisVisit: true),
          "Agree stays on the camera")
    check(RecordConsentPrompt.closesCamera(agreedThisVisit: false),
          "Cancel or a swipe down leaves the camera")

    // --- a visit, end to end ------------------------------------------------

    // Agree, then leave without recording. Agree writes nothing, so the
    // account is still unconfirmed and the next visit asks again.
    var needed = true
    var agreed = false
    check(RecordConsentPrompt.shouldAsk(needed: needed, agreedThisVisit: agreed, cameraReady: true),
          "first visit: asked on open")
    agreed = true
    check(!RecordConsentPrompt.closesCamera(agreedThisVisit: agreed), "first visit: Agree stays")
    check(RecordConsentPrompt.mayRecord(needed: needed, agreedThisVisit: agreed),
          "first visit: the shutter is free")
    agreed = false // the camera closed; the next visit starts fresh
    check(RecordConsentPrompt.shouldAsk(needed: needed, agreedThisVisit: agreed, cameraReady: true),
          "agreeing without recording saves nothing: the next visit asks again")

    // Agree, press the shutter, the save lands. Nothing is asked again,
    // this visit or any later one.
    agreed = true
    needed = false // confirmIfNeeded() succeeded at the shutter
    check(!RecordConsentPrompt.shouldAsk(needed: needed, agreedThisVisit: agreed, cameraReady: true),
          "after the save at the shutter: not asked this visit")
    check(!RecordConsentPrompt.shouldAsk(needed: needed, agreedThisVisit: false, cameraReady: true),
          "after the save at the shutter: not asked on a later visit")

    // Agree, press the shutter, the save fails. The screen takes the
    // agreement back and asks again, and closing that prompt leaves.
    needed = true
    agreed = false // the failed save hands the answer back
    check(RecordConsentPrompt.shouldAsk(needed: needed, agreedThisVisit: agreed, cameraReady: true),
          "a failed save asks again")
    check(RecordConsentPrompt.closesCamera(agreedThisVisit: agreed),
          "closing the re-asked prompt without agreeing leaves the camera")
}

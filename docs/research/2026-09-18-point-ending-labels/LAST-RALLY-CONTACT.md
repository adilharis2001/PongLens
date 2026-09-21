# Optional last rally paddle contact

The label form now asks who made the last paddle contact during the rally. Near, far and explicit uncertainty are optional answers; leaving it blank or clearing it is allowed. Count attempted returns and mishits that touch the ball, excluding ball collection or stopping after the point ended.

| Contract | Result |
| --- | --- |
| Placement | Below the ending question, inside its existing card; same shipped dropdown styling |
| Semantics | Physical paddle contact while the point remains live, without guessing intent to play a shot |
| Storage | Optional `label.lastRallyContact`: `near`, `far`, `unsure`; absent means unanswered |
| Clearing / old clients | Explicit null clears; omission from an older client preserves an existing answer |
| Save behavior | Existing admin-only revisioned JSON and history; no migration; independent of ending cause |
| Progress | Contact-only answer does not count as an ending label |
| Unit / regression | 246 research tests and 2 mobile-performance tests passed; validation, omission, clearing, uncertainty and retry comparison covered |
| Build / review | Full `npm run build` passed; pre-existing unrelated warnings; independent review has no actionable findings |
| Browser | Desktop1024×900 and mobile393×660; 44px select; no horizontal overflow; all choices and clearing persist after reload; prior note and bounce annotations retained |
| QA isolation | Actual component and normalization with local fixture saves; no production labels modified |
| Media limitation | Automatic approval review rejected refreshing private-video links as broader than earlier clip permission. Local form QA deliberately disables media access; no workaround or credential read performed |
| Surfaces | Desktop/mobile web only; native iOS and worker unchanged, native not tested |
| Authorization | Owner chose optional dropdown location and delegated contact wording; prior instruction to publish page additions without further questions retained |

Screenshots: `/private/tmp/last-rally-contact-mobile.png` and
`/private/tmp/last-rally-contact-desktop.png`. Local fixture font is Arial;
production uses the existing app font. No CSS or typography changes.

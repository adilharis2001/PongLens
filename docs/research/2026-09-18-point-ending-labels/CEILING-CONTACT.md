# Ceiling contact

The optional event dropdown now includes “Ceiling / overhead contact.” “Ball hit ceiling or overhead object” uses the existing reusable custom-ending mechanism. Lester point 29's existing added contact is reclassified at its original timestamp, following the owner's confirmation.

| Item | Verification / contract |
| --- | --- |
| Event kind | `ceiling`; accepted for detected or added events; excluded as last table bounce |
| UI reference | Existing shipped BounceDetails editor and custom reason dropdown; unchanged layout/styles |
| Data correction | Existing added mark at raw 380.6652275782575; ending custom reason; last table bounce 3 per owner note; preserve later non-rally/floor labels, note and source |
| Persistence | Existing revision guard/history and custom-reason trigger; no schema or scoring changes |
| Tests | 247 research tests passed; extended enum test failed before implementation |
| Build/review | Full build passed; independent review found no actionable issue |
| Browser | Desktop 1024×900 and mobile 393×660; contact and ending choices fully visible, saved and retained after reload; no horizontal mobile overflow |
| Limitations | Isolated local form and real validation; media disabled; video and native iOS not tested; worker unchanged |
| Screenshots | `/private/tmp/ceiling-mobile.png`, `/private/tmp/ceiling-desktop.png`, `/private/tmp/ceiling-ending-mobile.png`, `/private/tmp/ceiling-ending-desktop.png` |

The owner approved the proposed labels and point-29 interpretation. Continuing authorization to publish page additions without further questions applies. Private guarded-update scripts and snapshots remain outside the repository.

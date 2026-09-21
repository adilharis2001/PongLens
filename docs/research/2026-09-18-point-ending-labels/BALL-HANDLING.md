# Handling motion mistaken for a bounce

The optional bounce dropdown now includes “Ball handling mistaken for a bounce.” It describes a handling motion falsely detected as a bounce, distinct from a real non-rally table bounce. The owner identified Lester point 38 bounce 1 and point 48 bounce 4 as this kind.

| Contract | Evidence |
| --- | --- |
| Stored kind | `ball_handling`; compatible with existing optional JSON labels and audited revision saves |
| Rally boundary | Cannot be the last rally bounce; changing a marked event to this kind clears that designation |
| UI reference | Existing shipped BounceDetails editor; same controls and styling |
| Browser | 393×660 mobile and 1024×900 desktop; 44px select, no mobile horizontal overflow; label fully visible; autosave and reload passed |
| Automated checks | 247 research tests passed; new enum acceptance failed before implementation |
| Build/review | Full build passed after fixing a JSX apostrophe found by independent review; no semantic findings |
| Data correction | Only the two owner-confirmed events, preserving all other labels, notes and source data; guarded against concurrent revisions |
| Limitations | Local UI fixtures and real validation, media disabled; video playback and native iOS not tested; worker unchanged |
| Screenshots | `/private/tmp/handling-mobile.png`, `/private/tmp/handling-desktop.png` |

Publication follows the owner's continuing instruction to publish these optional page additions without further questions. Private before/after snapshots are kept outside the repository.

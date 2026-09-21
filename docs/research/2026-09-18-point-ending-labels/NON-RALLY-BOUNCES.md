# Non-rally bounce labels

The optional bounce editor separates preparation and ball handling on the playing table from bounces on another table. Earlier ambiguous labels retain their original value until reviewed. The existing editor layout and autosave are preserved.

| Item | Verification |
| --- | --- |
| New kinds | `non_rally`: Non-rally bounces; `other_table`: Bounce on another table |
| Legacy | `non_playing` remains valid; shown only for an existing legacy annotation |
| Rally end | Neither new kind can be marked as the last rally bounce; changing kind clears that marker |
| Storage | Existing admin-only JSON label, revision guard and audit history; no schema migration |
| Automated checks | 247 research tests and 2 performance regressions passed; new validation test failed before implementation |
| Build | Full `npm run build` passed |
| Review | Independent review of three changed source/test files: no actionable findings |
| Browser | Desktop 1024×900 and mobile 393×660; new and legacy states rendered; 44px dropdown; no horizontal overflow; save and reload verified |
| QA isolation | Actual form and validation, local fixture saves; media disabled; private-video playback not tested |
| Other surfaces | Native iOS and worker unchanged and not tested |
| Release authorization | Owner explicitly requested production publication; earlier instruction to publish these page additions without further questions retained |

| Coordinate audit | Outcome |
| --- | --- |
| Lester point 29, bounces 4 and 6 | Inside detected table outline |
| Lester point 48, bounce 3 | Inside detected table outline |
| Lester point 48, bounces 5 and 6; point 49, bounce 1 | Less than one pixel outside boundary; compatible with detected table |
| Lester point 29, added mark at point 0:05.57 | Nearest track sample 9ms away, 316px above outline; consistent with owner's ceiling note; leave unresolved |
| Lester point 38, bounce 1 | 40px outside near edge; leave unresolved |
| Lester point 48, bounce 4 | 74px beyond far edge; leave unresolved |
| Yu Yu Lin point 5, bounces 4 and 5 | Owner confirmed other-table events |

Coordinates only flag discrepancies; they do not prove the physical contact surface. Planned guarded relabeling: six compatible Lester events to `non_rally`, two confirmed Yu Yu Lin events to `other_table`, three flagged Lester events unchanged. Private before/after snapshots and coordinate audit remain outside the repository.

Screenshots: `/private/tmp/non-rally-mobile.png`, `/private/tmp/non-rally-desktop.png`, `/private/tmp/other-table-mobile.png`, `/private/tmp/other-table-desktop.png`, and legacy states alongside them. Local fixture uses Arial; no production font or CSS change.

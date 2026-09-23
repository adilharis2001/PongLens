# Review experiment suggestions

Untouched study points receive amber suggestions for the ending, last paddle contact and detected bounce markers. Existing human annotations are protected at the whole-point level; the original predictions remain separate from saved answers. A confirmation or correction is saved in the existing revision history, so assisted reviews can be distinguished from earlier manual labels.

| Action | Saved behavior |
| --- | --- |
| Open a point | Display suggestions only; no label writes |
| Edit a note | Save the note only |
| Change one answer | Save that field and mark its suggestion reviewed |
| Change a bounce type or side | Save that event only; type and side are reviewed together |
| Correct the proposed last table bounce to floor/paddle/non-rally | Dismiss its dependent last-bounce suggestion |
| Confirm beneath a field | Save only that suggestion |
| Confirm this point’s suggestions | Save remaining non-null suggestions; preserve corrections and leave unresolved fields blank |
| Clear a suggestion | Record dismissal so it stays cleared after reload |
| Next point to review | Prefer remaining suggested answers, including bounces on points with a saved ending |
| Review a previously labeled point | Existing manual form, without injected suggestions |

| Data protection | Rule |
| --- | --- |
| Original model answers | Immutable `point_ending_suggestions` row keyed by point/run; source/evidence hash recorded |
| Human provenance | `label.suggestionReview` identifies explicitly reviewed keys; existing label history records each accepted/corrected/dismissed revision and reviewer |
| Initial import | Skip any point with a nonempty annotation, positive revision, reviewed timestamp, imported flag or archived annotation in either frozen or freshly locked live rows |
| Concurrent edits | Lock and reread before import; normal optimistic revision checks still protect browser saves |
| Model training | Machine suggestions alone are not labels. Future evaluations must separate assisted confirmations/corrections from original blind manual labels |
| Source references | Current saved winners, servers and taps stay unchanged; taps are approximate timing references |
| Missing bounces | Not invented by this experiment; the existing optional Add missed bounce control remains |
| Scope | Research desktop/mobile web only. No automatic match scores, point cuts, worker release or native iOS changes |

| Verification | Result before release |
| --- | --- |
| Whole-recording exclusion | All six label perturbation/refit checks passed |
| Generator | Eight algorithm/contract tests; all 479 payloads and 3,604 event references verified |
| Importer | Fourteen pure tests; final rollback-only database run protected 110 points, including two archived-only reviews, and staged 369 suggestions. All source, label and history hashes remained unchanged |
| Application | 256 research tests, nine suggestion-unit checks, mounted form review flow, both playback performance tests passed |
| Browser | Note-only saving, individual ending and event corrections, dependent last-bounce dismissal, bulk confirmation, unresolved answers, failed-save retry and dismissed suggestion reload, 393×660 mobile and 1365×900 desktop inspected |
| Mobile controls | No horizontal page overflow; confirmation actions fill content width and are at least 44px high |
| Full application build | Passed after the final navigation change |
| Not verified in this form preview | Video playback uses the unchanged player; private QA deliberately disables media. Native iOS not affected. New prediction accuracy remains unvalidated |
| Release | 369 private suggestions committed and migration registered; all human rows/history preserved. Readback and admin-only/insert-only permissions verified. New web UI awaits screenshot approval |

Run the importer without `--apply` for a transaction that rolls back all changes. Apply only the reviewed migration and private prediction bundle, then deploy the web release through the normal main-branch deployment. Never commit private labels, predictions or media to the public repository.

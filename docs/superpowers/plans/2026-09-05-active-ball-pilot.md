# Active-ball preliminary model

Authorized September 5 by Adil. Target: a reviewable preliminary result September 6, trained on the M1 Ultra Mac Studio. Existing production processing stays separate.

1. Audit existing research labels and select authorized owner recordings. Existing event/winner labels choose clips; detector proposals are not gold ball coordinates.
2. Freeze source-match and venue splits. Keep all neighbouring frames together. Record original frame timing and source dimensions.
3. Add an authenticated research page for short frame sequences, visible-ball clicks, hidden/absent/unsure states, and separately displayed predictions. Save revisions and reject stale saves.
4. Train a small original PyTorch temporal heatmap model from random initialization on local images and table context. No BlurBall weights or unlicensed dataset. Report any weak supervision explicitly.
5. Run held-out inference, render actual predictions, publish review samples under the existing private research infrastructure. Do not describe training loss as accuracy.
6. Run targeted data/model tests, the full Next build, and desktop/mobile review at 393x660 before deployment. Integrate only this work; preserve the main checkout's unrelated changes.

Local artifacts: `/Users/adil/ponglens-data/active-ball`. Current worktree: `.worktrees/active-ball-release`, based on the live production commit. The first `.worktrees/active-ball-pilot` was based on a divergent local checkout; do not deploy it. Hourly follow-up `ponglens-preliminary-ball-model` resumes this task; avoid duplicate training jobs. Gemini key has not been supplied; local preparation continues without external model uploads.

Initial evidence: 123 submitted assignments, 316 gold-label rows (primarily point outcomes), 211 human events with no filled screen bounce coordinates. One admin event row contains detector coordinates accompanying a contact verdict; it is not a hand-clicked ball-position corpus. Existing table-corner trainer proves local MPS workflow, not ball accuracy.

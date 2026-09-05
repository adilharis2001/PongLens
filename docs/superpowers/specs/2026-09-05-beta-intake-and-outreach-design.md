# iPhone beta intake, invitations and outreach

Status: approved in conversation on 2026-09-05; implementation authorized.
Date: 2026-09-05.
Scope: public desktop/mobile web signup, admin Outreach and feedback, beta email delivery and private storage. No native iOS or worker changes.

This supersedes the immediate-send behavior in the 2026-09-04 iOS beta signup design. Existing email styling, iPhone logo and installation instructions remain the baseline.

## 1. Outcome

A visitor can request the iPhone beta, tell us what they want to try, and optionally offer feedback. Adil and Anton receive the request and can send the invitation early from the admin portal. Otherwise the invitation is scheduled for 23 hours after the first accepted request. Neither admin must act for access to arrive.

The form promises an email within 24 hours. Scheduling at 23 hours leaves recovery margin; it cannot guarantee inbox delivery during provider outages or to invalid addresses. Delivery problems must be visible to admins rather than reported as successful sends.

Final copy direction at approval: use words sparingly. Keep the approved choices; omit redundant explanations and heading subtitles. Error or consent instructions stay only where needed to use the form correctly.

Applicants belong in the existing Outreach and feedback page even if they have not made a PongLens account. A request or sent invitation is not evidence that they installed the app.

## 2. Public form and approved words

Keep both current landing-page entry points and the primary web action unchanged. They open the same native dialog. Use a single scrollable form, not a wizard or a new page.

- Title: **Join the iPhone beta**
- Field: **Email** (required)
- Role: **I’m joining as a** with Player, Coach, Both (required, nothing preselected).
- Interest question: **What features are you excited to try?** Multi-select checkboxes; at least one relevant option required. Use a fieldset and accessible instruction “Select all that apply.”
- Feedback question: **Would you be open to sharing feedback?** Optional multi-select: Email, Audio call, Video call, Not right now. Nothing preselected. Not right now is exclusive. Leaving this unanswered is allowed.
- Feedback helper: **Choose how we can contact you about your experience. This is optional and won’t affect beta access.** An audio/video preference means willingness to arrange a call, not permission to record it. Scheduling starts through the supplied email; do not collect phone numbers or calendar access.
- Privacy text: **We’ll use your email for beta access and essential beta updates, and to ask for feedback if you choose. No marketing.** Link the existing privacy policy.
- Primary action: **Request beta access**; submitting: **Sending request…**
- Secondary action: **Cancel**.

### Player interests

| Stable value | Checkbox copy |
| --- | --- |
| iphone_recording | Recording matches on my iPhone |
| video_library | Keeping my table tennis videos in one dedicated library |
| point_review | Watching every point without the breaks between rallies |
| match_progress | Tracking my match results, statistics and progress over time |
| placement_maps | Understanding my placement patterns with ball placement maps |
| professional_review | Getting a professional coach to review my match |
| friends_family_sharing | Sharing my matches with friends and family |
| coach_sharing | Sharing my matches with my coach |
| highlight_export | Exporting points and highlights for social media |
| lesson_audio | Recording audio of my lessons to revisit my coach’s advice |
| training_journal | Keeping a training journal of notes from matches and lessons |
| journal_questions | Searching and asking questions about my journal |

Per Adil’s latest direction, do not append a serves-only qualifier to the placement option. The neutral interest wording above stays exact; do not expand it to claim all shots are currently mapped. Internally, current serve-only coverage remains unchanged. Do not claim unlimited storage, free storage forever, or savings on iCloud/Google Photos.

### Coach interests

Show these for Coach; show both labeled groups for Both. The role only controls the survey, not product access.

| Stable value | Checkbox copy |
| --- | --- |
| coach_students | Keeping my students and their coaching history in one place |
| coach_lesson_recording | Recording lessons as audio or video |
| coach_shared_journal | Sharing lesson notes and training journals with students |
| coach_match_feedback | Reviewing my students’ matches and giving feedback on specific points |
| coach_profile | Building a coach profile players can find and share |
| coach_review_orders | Receiving and managing paid match review requests |

Coach interests concern PongLens as a whole, not a promise of native availability for every administrative/payment action. Check the released lesson-recording surface when implementing; this task does not change coach product capabilities.

Switching role can retain in-memory selections for a switch back, but the submitted payload contains only the options for the final role. Do not silently submit hidden answers.

### Confirmation and errors

New accepted request: **Request received.** Then **We’ll email your TestFlight link within 24 hours.** Show the email they entered and a full-width mobile **Done** action. This is on-screen only; no immediate applicant acknowledgement email.

Use the same non-enumerating response for repeat addresses. Neutral repeat-safe confirmation wording: **Thanks for your interest. If you’ve already requested access, your original request is still in place. Check your inbox for an earlier invitation.** The API does not reveal whether an address belongs to an account or applicant. The normal new-request confirmation may include this repeat-safe sentence for all submissions.

Invalid fields show local corrections without clearing selections. Provider scheduling failures preserve the saved request and form, but show **We couldn’t confirm your invitation schedule. Please try again.** Do not promise a successful schedule if the provider has not accepted it. Retrying resumes the same request and original deadline.

No future-feature essay, extra qualification questions or marketing opt-in in this release.

## 3. Layout and accessibility

Follow CLAUDE.md and the approved flattened allowance forms, not a new visual system. Existing dark surfaces, type, borders, inputs, checkboxes and cyan primary/outlined secondary buttons. Left-aligned content, no nested bordered cards, no decorative introduction or subtitle beneath the dialog heading.

One checkbox column on mobile, with wrapping labels and at least 44px row targets. Desktop can use two columns within an interest group; do not place player and coach groups side-by-side in a way that breaks reading order. Keep the dialog within the available viewport using proportional/max-height limits and internal scrolling. The submit actions stay in normal flow so they never cover options or keyboard focus. Mobile action buttons are full-width, stacked and at least 44px high. Retain compact role controls.

Native dialog focus containment, visible close action, Escape support, return focus to the correct trigger, labeled fieldsets, announced validation/success, keyboard checkbox operation and selected states that are not communicated by color alone. Test at 393×660 and 1440×900, plus a narrow 320px viewport for overflow. Form values survive validation/network errors; closing resets the dialog consistently with the existing component.

## 4. Delivery architecture

### Decision

Use Resend’s scheduled-email API, retaining one provider email per invitation. Alternatives considered: a daily application sweep cannot reliably meet the deadline; a new dedicated high-frequency sending worker adds an execution service we do not need for normal delivery. Resend handles the normal 23-hour schedule even when nobody opens the site.

Keep the existing daily sweep as a recovery/reconciliation path, not the deadline mechanism. Initial successful submission requires durable provider acceptance. Admin page refresh also reconciles visible pending records. Failures or an uncertain provider result are actionable admin states. Do not claim the daily sweep can fix every outage before 24 hours.

### New request

1. Validate a bounded JSON payload, normalize email, apply the existing honeypot and rate limit using HMAC source hashes.
2. Atomically create or claim the one request for that normalized email, including questionnaire version and answers. Set its first-request deadline once: created time plus 23 hours. Duplicate calls never reset it.
3. Under a database-backed lease, submit the existing branded invitation to Resend with that absolute UTC scheduled time and a request-specific idempotency key. Persist provider ID and the exact immutable send payload/version used for retries.
4. Mark Scheduled only after provider acceptance and persistence. Accepted is not Sent. If acceptance may have happened before a timeout or failed database write, retain Unknown and reconcile using the same request and provider identity; never blindly create another email.
5. Queue independent notifications to each address in ADMIN_EMAILS. Their failure does not undo a scheduled invitation. Each recipient has separate delivery/idempotency state.

The TestFlight URL remains server-only IOS_TESTFLIGHT_URL, validated against the existing Apple join-URL rules. Do not expose it in API responses or source markup. Existing Resend sender, Reply-To, logo, HTML/plain-text rendering and suppression behavior remain in use.

### Send invite now

An authenticated admin-only POST accepts the request ID, checks the real admin boundary and uses the same database lease as scheduling/retries. Record actor and requested time once. For an existing scheduled provider email, update its schedule to the earliest supported near-immediate time (target within one minute), retaining the same provider ID. Display **Sending…**, not Sent, until provider evidence confirms dispatch.

If the email already dispatched, refresh its state and return an idempotent success without a second send. If scheduling was never attempted, the shared delivery operation can create the one invitation with immediate intent. If the provider result is unknown, reconcile first. Do not cancel and re-create as the default early-send path. Two admins clicking together must not result in two invitations or move an early deadline later.

### Reconciliation and failure rules

Store scheduled, sent, delivered, suppressed and failed/unknown states separately. Match signed Resend events to the stored provider ID; never update unrelated email records by recipient alone. Preserve permanent-bounce/complaint handling for all other platform emails. Handle database write failures before marking webhook events processed, including errors returned as values by the Supabase client.

Use provider retrieval to reconcile pending records if webhooks are delayed. Events are replay-safe and out-of-order safe: an old scheduling event cannot revert Sent/Delivered; a subsequent bounce remains visible. Sent is dispatch evidence, Delivered is provider delivery evidence, neither is proof of reading or installing.

Check suppression before scheduling. A new suppression received before dispatch should attempt to cancel the pending provider email and prevent early-send; record cancellation failure visibly. Do not override existing suppression to meet the deadline.

Persist retry attempts and safe error codes. A retry within the provider’s 24-hour idempotency window uses the same key AND exact payload. Once that window expires, an ambiguous create must be reconciled or escalated, not retried as a fresh message. A definitively failed or canceled provider message can only be replaced through a recorded recovery attempt after confirming it cannot still send. Requests within one hour of their deadline with unknown/failure state appear as Needs attention; overdue requests stay prominent until resolved. Admin notifications use the existing retry sweep, individually per admin.

## 5. Private data contract

Extend ios_beta_requests additively with form version, role, interest keys, feedback choice (unanswered / declined / opted_in), feedback channels, response timestamp, consent-copy version, scheduled time, provider ID, delivery state/evidence, early-send actor/time, operation lease, retry metadata and safe error code. Use arrays/enums constrained to the versioned catalog; enforce bounded counts/lengths server-side and in SQL where practical. Store the original answers, not only rendered labels.

Create a private delivery-attempt/outbox record for the immutable invitation payload and provider operation state, and per-recipient admin notifications. Uniqueness prevents multiple active invitations for a request. Lease expiry permits recovery after process termination; lease expiry alone never proves a provider call failed.

No public SELECT or direct browser INSERT on requests, responses, operations or notification records. Service-only claim/delivery functions and authenticated admin-checking read/update functions follow existing sealed-table conventions. New definer functions pin search_path and revoke default public execution. Email addresses, preferences and IDs must not enter public app_config or client logs.

The email form is unauthenticated: knowing somebody’s address must not let a repeat submission overwrite their saved responses/contact permission. First accepted answers remain authoritative. Verified corrections can be recorded by an admin with an audit note; repeat submissions only update existing request-attempt counters. Do not backfill feedback consent for historic testers.

## 6. Outreach and feedback integration

Add **iPhone beta** as a filter within the existing Outreach and feedback roster, not a separate disconnected admin CRM. Make beta applicants visible without an account. Expanded details show role, selected interests, feedback preferences, requested time, invitation state/deadline and Send invite now. Pending invitations are an operational list distinct from the feedback-contact queue.

Reuse contact status, follow-up date, notes and contact history. Add Audio call and Video call to the contact-log channel choices and database constraints; retain Email, DM and In person. Merely sending an invitation must not mark someone as contacted for feedback.

### Identity and history

Do not implement this by blindly inserting every applicant into user_outreach_people. Add a beta subject to the existing touch-log model with an exactly-one-subject constraint, plus beta outreach status/follow-up state. Resolve a unified admin row by normalized email across beta request, account and manual contact. Prefer account as the displayed identity, then a manual contact, then beta-only. Aggregate histories without deleting or rewriting original author/time/body data. Linking is for admin display and outreach continuity, never authentication or granting access.

On first linking, retain the established account/manual outreach state over a new beta default. If beta outreach already exists when a new account appears, carry that state forward rather than resetting to New. Resolve conflicting existing non-new statuses conservatively: retain the displayed established record’s state and expose the other record’s history. Use the earliest outstanding follow-up date for the unified queue and retain each source date in history until an admin explicitly replaces or clears the unified follow-up. New actions write to the canonical subject under an atomic resolver. Keep linked beta detail/history accessible if an account is later removed. Ambiguous duplicate manual records stay visible to admins for explicit resolution rather than destructive auto-merging.

Apply role/interests/invite-state/contact-channel filters to these unified rows. Counts and queues deduplicate resolved identities, so a beta applicant who registers is not counted twice.

### Contact permission

- Opted in: eligible for feedback outreach through selected channels; email can be used to arrange an opted-in call.
- Declined: show **No feedback contact requested**; do not add to or retain in automated feedback-contact queues due to the beta request, including after matching an account.
- Unanswered or historic: show **Not provided**; do not infer consent or automatically add to feedback-contact queues because of beta signup.
- Existing non-beta operational support needs remain visible separately; feedback preferences do not stop essential beta or account support mail.

Admins can record a withdrawal and remove feedback eligibility without revoking beta access. This feature does not automatically send research outreach or book calls; Anton continues choosing whom to contact and logging feedback.

## 7. Email copy and privacy

Retain the approved invitation design and subject **Your PongLens iPhone beta is ready** with TestFlight installation steps. No reference to approval or being selected; all valid applicants receive access on schedule.

Admin email subject: **New iPhone beta request**. Include email, role, interests, optional feedback preference, request time and scheduled time. CTA **View beta request** opens the authenticated Outreach page with that applicant selected. State that either admin can send the invitation sooner; do not say the applicant has joined/installed or has already received the link. Send separately to Adil and Anton with independent retry state. Do not batch addresses into a public recipient list.

Update the privacy page to describe the optional questionnaire, voluntary feedback contact and restricted admin access. No marketing enrollment, tracking pixels, call-recording consent or new analytics collection. Support can honor feedback withdrawal/correction without requiring a beta applicant to have an account.

## 8. Migration and rollout

1. Add schema/RPCs with compatibility for existing code. Snapshot counts of already-sent, suppressed and pending requests without exporting personal data into the repo.
2. Preserve historic sent/suppressed stamps. Mark historical form answers Not provided. Do not resend invitations or notify Anton about every old request as a migration side effect. Historical pending requests retain their original age; do not defer them another 23 hours.
3. Deploy the new delivery operation and switch the existing sweep to it before enabling delayed public intake. No path may continue the legacy unconditional immediate send for a scheduled request. Preserve the old claim interface during deployment overlap; route old-form payloads through the new delay without inventing missing answers, then retire compatibility after cached clients have rolled over.
4. Verify production Resend credentials can schedule, retrieve and update messages; verify signed delivery/failure events reach the existing webhook. Existing send-only credentials may need a suitably scoped server-only key for management operations. Do not widen or expose browser credentials.
5. Verify the current external TestFlight link/build remains active. No new App Store Connect group or iOS build is required by this feature.
6. Enable the expanded form and admin integration after acceptance tests. Keep already-scheduled emails intact on rollback. Never restore an old daily sweep that interprets Scheduled as Unsent and sends duplicates.

No production deploy, migrations or real mail are part of this spec-writing step. During implementation, any dashboard configuration that cannot be performed with available authorized access will be reported as a concrete release prerequisite. Do not announce completion until actual scheduling and early-send have been exercised.

## 9. Verification and acceptance

Write behavior tests before implementation. Required coverage:

- Every role/interest combination, validation, optional feedback, exclusive decline, role switches, duplicate keys, malicious/oversized payloads, honeypot and rate limit.
- First request establishes a fixed 23-hour schedule; repeat submissions neither change answers/consent nor postpone or duplicate delivery.
- Schedule accepted versus unknown/failed; immutable retry payloads; database failure after provider acceptance; expired idempotency window; crashed leases; both admins pressing Send invite now; early-send racing automatic dispatch.
- No suppression bypass; cancellation/recovery races; signed, duplicate and out-of-order webhooks; provider event before local persistence; per-admin partial notification failure; missing/invalid secrets or URL.
- Admin authorization enforced server-side and in RPCs, public table access denied, ordinary signed-in user denied, no account enumeration.
- Existing sent/suppressed applicants migrated without re-invitation, old pending handled, optional preferences remain unknown, old-form compatibility does not bypass the delayed flow.
- Beta-only/manual/account matching, preserved history and follow-ups, duplicate counts, consent after account linking, no accidental research-contact queue entry for declined/unanswered applicants.
- Existing non-beta email behavior unchanged. Full email suite and real npm run build in an isolated worktree with its own .next, not a filtered typecheck.
- Real browser checks for both landing triggers, scroll/keyboard/focus behavior, error/retry/success, Coach/Both content and admin actions at 393×660 and 1440×900; narrow overflow at 320px.
- Controlled mail tests only to designated team addresses: short scheduled send, early-send of the same provider ID, both admin notifications and rendered HTML/plain text. Use dependency-injected time in automated tests; no public accelerated-delay switch.
- Confirm a real default request is scheduled exactly 23 hours ahead, and separately document whether a full-duration delivery was observed. Do not represent an accelerated test as a 23-hour end-to-end test.

## 10. Implementation boundaries

Likely modules: IosBetaSignup, iosBeta model/client/request/claim/delivery, beta email orchestrator/catalog, a backward-compatible provider scheduling adapter, Resend webhook, reviews-sweep, authenticated admin beta action, outreach view/roster/RPCs, privacy copy and additive migrations. Keep pure catalogs and state transitions separate from provider/database I/O. Avoid broad refactors of the email system or replacing the outreach UI.

Not included: new storage/pricing behavior, automatic feedback campaigns, calendar booking, push notifications, TestFlight installation tracking, native survey screens, new placement capabilities or coach purchasing changes.

## References checked

- [Resend scheduled emails](https://resend.com/docs/dashboard/emails/schedule-email): absolute scheduling, failures and management.
- [Resend update email](https://resend.com/docs/api-reference/emails/update-email): bring forward the same scheduled message.
- [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys): retry protection is bounded, not a substitute for stored delivery state.
- Repository CLAUDE.md, existing beta signup design, ios_beta_requests migration, current beta delivery modules and outreach roster/people/touch models inspected before writing.

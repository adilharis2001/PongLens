# Web parity specs, extracted 2026-08-18

Build specs pulled from the web code for Adil's match-viewer/scorekeeper
feedback round. The player and landscape-scorekeeper parts SHIPPED in the
same round; everything below the line is the remaining work, specced so
the next session can build without re-reading the web.

Shipped already (PlayerTakeover.swift): pinch zoom 1–4x persisting across
points (±1.5x transport buttons, center-anchored, no floating reset —
deliberate web decision), hold left/right 250ms = 0.25x/2x with the
"2x ▶▶" pill, always-on score bug in watch (landscape included), rotate
button via requestGeometryUpdate, quick note/draw circles reusing
NoteComposerView + AnnotatorView, countdown ticker rings, no Point-N
pill, landscape keep-score edge layout (full-bleed video; winner tiles
left 96x88; Skip/Delete/Modify right 96w; score+ticker bands top inset
~48; mini row bottom: Back·Undo·Replay·Speed·Star·Analysis·Details·Next).

---

## Still to build — match page modules

1. MATCH-LEVEL NOTES (Notes.tsx, MatchView.tsx:3908): an "Overall notes"
   SECTION at the bottom of the match page (after analysis and placement),
   not a sheet. matchNotes = notes where point_id is null; authors via rpc
   match_note_authors. NoteItem: 2px accent bar (amber = coach, cyan =
   you), author · "MMM d, h:mm a", own notes get inline Edit/Delete
   (two-tap), image via media-url {noteId, image:true}, audio via
   {noteId}. Composer: pointId nil, placeholder "How did the match go?",
   voice → /api/transcribe appends transcript to the text field. iOS has
   all the pieces (NotesStore, NoteItemView, NoteComposerView) — this is
   assembly, plus making the Tools "Notes" row scroll to the section
   instead of opening the dead overlay Adil hit.

2. PLACEMENT AGGREGATE (PlacementAggregate.tsx): owner-only section below
   analysis. Gate: any drawable placement or view.showAggregate (poll
   matches.placement_status). Controls: Game segmented (when >= 2 games),
   whose shots, serves/rally. Cards: Landings (SVG table, dots cyan you /
   amber them, TABLE consts W_M 1.525 L_M 2.74, viewBox 230x356, TX 35 TY
   40 TW 160 TH 280) + Heat map (sparse → "Not enough trusted landings in
   this view yet."). Coverage line "Mapped for X of Y points." Data via
   collectTrustedPlacementObservations (exclude per-point
   placement_flagged). LooksWrong button sets matches.placement_flagged.
   iOS PlacementMapView (point-level, Components/) already renders the
   table+dots — reuse its renderer for the aggregate.

3. MATCH ANALYSIS BOTTOM: AnalysisCards order = Overview (always, with
   MomentumChart point-differential bars) · Why you lost (>= 3 reasons) ·
   Serve (>= 3 described). The mobile deck ends with a scroll-driven dot
   pager. What Adil experienced as "nothing at the bottom" is mostly the
   MISSING SECTIONS AFTER analysis (placement + overall notes).

4. MATCH DETAILS EDITOR (ready match): web is an inline panel under the
   title (pencil toggle; Tools row scrolls to it). Fields: your name,
   opponent (NameCombobox with past-opponent suggestions), venue (plain
   input), type pills. iOS should reuse the record/upload sheet idiom
   (native Form + recentValues dropdowns) for overlay consistency — Adil
   explicitly wants ONE sheet style everywhere, and venue/opponent
   suggestions were missing.

5. INVITE COACH QR (ShareWithCoach.tsx + ShareQR.tsx): scope cards This
   match / All my matches → insert coach_links {player_id,
   scope_match_id} → link ${origin}/coach-invite/${invite_token}. Post-
   create: copy, system share, QR behind "Show QR" — 160pt QR, white
   card, level M, caption "Scan to open". iOS: CIFilter.qrCodeGenerator
   (correction level M) on a white rounded card.

6. HOME LATEST ACTIVITY (HomeOverview.tsx:689): TWO item types — notes
   (rpc note_feed p_limit 6, show first 2; amber border when author isn't
   viewer; "Voice note" fallback body; deep-link /match/{id}?p={point})
   and exports (match_reels select match_id,scope,status,duration_s,
   manifest,updated_at, show first 3; title from share_links else
   manifest names else "vs {opponent}"; status line Rendering…/Failed/
   duration; share+download buttons when ready). iOS home currently
   shows journal only — port both types. Poll 10s.

7. SCOREKEEPER ZOOM BUTTONS: pinch zoom + persistence now works in keep
   score, but the web renders the same ±zoom buttons in score mode's
   transport row; iOS score mode has no transport. If Adil asks again,
   add ± to the landscape mini row and the portrait pad's control row.

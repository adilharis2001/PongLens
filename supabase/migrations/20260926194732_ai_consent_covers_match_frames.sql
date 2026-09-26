-- Recording and uploading a match now need the AI features permission.
--
-- Every match has still frames checked by OpenAI (the content check, the
-- broadcast check and the table finder), and App Review 5.1.2(i) wants a
-- named, revocable permission before that happens. The AI features sheet
-- already was one, for voice notes, Ask, summaries and photo reading; its
-- wording now covers match frames too (src/lib/aiConsentCopy.ts), the web
-- and iPhone ask for it at the New match door, and /api/upload-url refuses
-- to start an upload without it. The one-time "I have the right to upload
-- this video" checkbox is gone: its promise is in the Terms, and
-- upload_confirmed_at stays only as the record of who ticked it.
--
-- The accounts that allowed the older wording agreed to less than the
-- sheet now asks, so they are asked once more. Their flag goes back to
-- "not asked"; ai_consent_at and ai_consent_version keep the record of the
-- earlier Allow. Nobody had switched it off, so no false is touched.
-- Rollback: this cannot be undone row by row, and does not need to be: an
-- account that is asked again simply taps Allow.

update public.app_config
   set value = '2026-09-26'
 where key = 'ai_consent_version';

update public.player_profiles
   set ai_features_enabled = null,
       updated_at = now()
 where ai_features_enabled is true
   and (ai_consent_version is null or ai_consent_version < '2026-09-26');

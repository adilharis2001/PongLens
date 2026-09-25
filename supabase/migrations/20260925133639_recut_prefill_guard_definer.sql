-- The prefill guard runs on every save the apps make to hand_cut_drafts, as
-- the signed-in player. 20260925133555 revoked EXECUTE on _marks_signature
-- from `authenticated`, so the trigger could not call it and an ordinary
-- draft save was refused ("permission denied for function
-- _marks_signature"). Live for 44 seconds; the only refusal logged in that
-- window was the verification that found it. Both functions now run as
-- their owner, which is what the revoke assumed.
alter function public._hand_cut_draft_prefill_guard() security definer;
alter function public._marks_signature(jsonb) security definer;

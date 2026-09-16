-- The cloud twin's dispatcher says why it did or did not start in words:
-- mac_reporting, nothing_waiting, waiting_not_long_enough, manual,
-- cloud_running, no_cloud_release, mode_changed, manual_session_ended.
-- cloud_worker_decision(), cloud_worker_session() and set_cloud_worker_mode()
-- (20260916141355) all write that word into
-- processing_control.latest_dispatch_reason, a column left behind by the
-- abandoned 2026-09-05 cloud design together with a CHECK constraint that
-- only admitted that design's own vocabulary. Two of the new words happened
-- to be on the old list (disabled, release_mismatch), which is why every
-- minute of dispatch while the switch was Off looked healthy. The first
-- press of Run once on 2026-09-16 was refused with a check violation, and
-- Standby would have failed the same way on its first minute.
--
-- The list goes. The column is the dispatcher's free-text note; the page
-- reads the words from processing_control.cloud_decision, and the reasons
-- are enumerated in cloud_worker_decision() itself.

alter table public.processing_control
  drop constraint if exists processing_control_latest_dispatch_reason_check;

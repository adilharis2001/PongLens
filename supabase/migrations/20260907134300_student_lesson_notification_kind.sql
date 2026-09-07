-- `notifications.kind` is an allow-list, and the trigger that tells a coach
-- their student shared a lesson writes a kind that was not on it. Because
-- the trigger fires AFTER the write on `lessons`, the constraint did not
-- merely lose the notification: it failed the share itself, so a player
-- ticking "share this with Jonathan" got an error and no entry.
--
-- Adding the kind rather than softening the constraint. The allow-list is
-- what makes a typo in a new trigger fail loudly here instead of quietly
-- rendering a blank row in the bell, which is worth keeping.

alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check check (
    kind = any (array[
      'note', 'match_ready', 'match_failed', 'reel_ready', 'reel_failed',
      'coach_joined', 'upload_failed',
      'order_paid', 'order_submitted', 'order_accepted', 'order_declined',
      'clarification_requested', 'review_delivered', 'followup_received',
      'order_completed', 'order_refunded', 'sample_requested',
      'sample_responded', 'testimonial_left', 'clarification_answered',
      'sponsored_claimed', 'qa_bug_comment', 'qa_bug_status',
      'coach_entry', 'student_joined', 'student_match_ready',
      -- A student sharing a lesson with their coach: the mirror of
      -- coach_entry, which is a coach sharing one with their student.
      'student_lesson',
      'allowance_request', 'allowance_decided'
    ])
  );

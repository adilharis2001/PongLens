-- 128: comments join the daily digest.
--
-- The thread (127) rings the in-app bell and nothing else, so a reply sat
-- unseen until the tester happened to open the portal. The obvious fix is
-- an email per comment, and that is the wrong one: it is the shape that
-- just sent one person 120 copies of the same message. Comments go into
-- the digest that already exists instead, so the promise stays exactly
-- "one email a day, or none".
--
-- One column does it. Same pattern as feedback_items.closed_notified_at
-- and qa_bugs.closed_notified_at: null means not yet in an email, a
-- timestamp means it has been. The digest reads null and stamps after a
-- successful send, so a failed send simply leaves the row for tomorrow.
alter table public.qa_bug_messages
  add column if not exists digest_notified_at timestamptz;

-- Partial, because the digest only ever asks for the unstamped ones and
-- that set is small and shrinking. Indexing the whole table would be
-- paying for the rows we never query.
create index if not exists qa_bug_messages_undigested_idx
  on public.qa_bug_messages (created_at)
  where kind = 'comment' and digest_notified_at is null;

-- Everything already written is treated as delivered. Seventeen comments
-- went out on 20 August and the tester has had the bell for all of them;
-- mailing them now would open this feature by dumping two days of
-- backlog, which is the exact experience we are trying to stop.
update public.qa_bug_messages
   set digest_notified_at = now()
 where digest_notified_at is null;

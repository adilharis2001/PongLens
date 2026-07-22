-- Let owners edit their job's options (details form after a fast upload).
-- Column-restricted: only options is writable, and only on own jobs.
create policy "Users can update own job options"
  on public.jobs for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
revoke update on public.jobs from authenticated;
grant update (options) on public.jobs to authenticated;

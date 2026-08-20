-- A coach keeps the record of work he was paid for, even after the student
-- closes their account.
--
-- Before this, review_orders.student_id cascaded, so deleting a student took
-- the coach's completed orders with it — his own findings and delivered
-- review included, since those hang off the order. The money was safe at
-- Stripe; his history in the app was not.
--
-- What survives is the transaction and the coach's own work. What goes is
-- everything the student wrote or filmed: their video (match_id was already
-- SET NULL), their notes, their messages (author_id cascades), their name.
-- Retaining a financial record is the permitted kind of retention; retaining
-- a deleted person's content is not, so none of it is kept.
--
-- The trap: all three functions that expose an order INNER JOIN auth.users on
-- student_id. Flipping the foreign key alone would have made the order vanish
-- from the coach's queue entirely — worse than the bug being fixed. They are
-- rewritten from their own live definitions here, so nothing else in them
-- can drift, and the block fails loudly rather than silently no-opping if the
-- shape it expects is not there.

alter table public.review_orders
  alter column student_id drop not null;

alter table public.review_orders
  drop constraint review_orders_student_id_fkey;

alter table public.review_orders
  add constraint review_orders_student_id_fkey
  foreign key (student_id) references auth.users(id) on delete set null;

do $migrate$
declare
  fn text;
  src text;
  before text;
  alias text;
begin
  foreach fn in array array[
    'public.review_order_detail(uuid)',
    'public.coach_queue()',
    'public.admin_review_orders()'
  ] loop
    src := pg_get_functiondef(fn::regprocedure);
    before := src;

    alias := substring(src from 'join auth\.users ([a-z]+) on [a-z]+\.id = o\.student_id');
    if alias is null then
      raise exception 'no student join found in %', fn;
    end if;

    src := regexp_replace(
      src,
      '(\n\s*)join auth\.users ' || alias || ' on ' || alias || '\.id = o\.student_id',
      '\1left join auth.users ' || alias || ' on ' || alias || '.id = o.student_id',
      'g'
    );

    -- Anonymous rather than the generic "A player", which would be
    -- indistinguishable from a live account with no display name set.
    src := replace(
      src,
      'nullif(btrim(public._display_name(' || alias || '.*)), '''')',
      'case when o.student_id is null then ''Anonymous'' else nullif(btrim(public._display_name(' || alias || '.*)), '''') end'
    );

    if src = before then
      raise exception 'nothing changed in % — the expected shape was not there', fn;
    end if;

    execute src;
  end loop;
end
$migrate$;

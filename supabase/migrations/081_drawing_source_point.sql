-- 081: a drawing knows which point it came from.
--
-- A finding links many points but carries one drawing, captured from one
-- frame. Without attribution the student sees a drawing floating beside
-- three clips. The editor now stamps the point on the player when the
-- frame was captured; both sides caption the drawing "From point N".
-- Nullable: older findings and unlinked frames simply show no caption.

alter table public.review_findings
  add column if not exists image_point_id uuid
    references public.points(id) on delete set null;

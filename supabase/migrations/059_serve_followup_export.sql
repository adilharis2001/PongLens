-- Include review-safe source evidence in the existing admin-only export.

create or replace function public.research_export_batch(p_batch_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.is_admin() then
      jsonb_build_object('error', 'admin only')
    else jsonb_build_object(
      'schema_version', b.schema_version,
      'batch', jsonb_build_object(
        'id', b.id, 'slug', b.slug, 'title', b.title, 'status', b.status
      ),
      'exported_at', now(),
      'assignments', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'assignment_id', a.id,
            'source_id', a.source_id,
            'source_match_id', s.source_match_id,
            'source_point_id', s.source_point_id,
            'source_point_idx', s.source_point_idx,
            'match_label', s.match_label,
            'proposal', s.proposal,
            'prefill', s.prefill,
            'reviewer_id', a.reviewer_id,
            'sequence', a.sequence,
            'duplicate_group', a.duplicate_group,
            'is_repeat', a.is_repeat,
            'status', a.status,
            'human_label', a.human_label,
            'review_metrics', a.review_metrics,
            'started_at', a.started_at,
            'submitted_at', a.submitted_at,
            'updated_at', a.updated_at,
            'gold', g.gold_label,
            'gold_provenance', g.provenance
          )
          order by a.reviewer_id, a.sequence
        )
        from public.research_assignments a
        join public.research_sources s on s.id = a.source_id
        left join public.research_gold_labels g on g.source_id = s.id
        where a.batch_id = b.id
      ), '[]'::jsonb)
    )
  end
  from public.research_batches b
  where b.id = p_batch_id;
$$;

revoke execute on function public.research_export_batch(uuid)
  from public, anon;
grant execute on function public.research_export_batch(uuid)
  to authenticated;

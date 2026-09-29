-- The note attachments of a clinic still referenced by a note: the cleanup
-- function (delete_note_attachments) removes only the others, whatever
-- paths its caller sends
create or replace function public.note_attachment_paths_in_use(org_id bigint, paths text[])
returns setof text
language sql stable security definer
set search_path to ''
as $$
  select p from unnest(paths) p
  where exists (
    select 1
    from (
      select n.attachments from public.deal_notes n where n.organization_id = org_id
      union all
      select n.attachments from public.patient_notes n where n.organization_id = org_id
    ) notes, unnest(notes.attachments) a
    where a ->> 'path' = p or a ->> 'src' like '%/' || p
  )
$$;
revoke all on function public.note_attachment_paths_in_use(bigint, text[]) from public, anon, authenticated;
grant execute on function public.note_attachment_paths_in_use(bigint, text[]) to service_role;

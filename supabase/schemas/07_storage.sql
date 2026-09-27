--
-- Storage
-- This file declares storage bucket policies.
--
-- Files are stored under "<organization_id>/<file>" and each user can only
-- list, upload or delete files of their own organization.
--

create policy "Attachments of own organization: select" on storage.objects for select to authenticated
    using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select private.current_organization_id())::text);
create policy "Attachments of own organization: insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select private.current_organization_id())::text);
create policy "Attachments of own organization: delete" on storage.objects for delete to authenticated
    using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select private.current_organization_id())::text);

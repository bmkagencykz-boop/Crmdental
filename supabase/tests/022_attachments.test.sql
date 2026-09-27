--
-- Attachments (stage 22): deal files follow the visibility of their deal,
-- are deleted by the owner, the head or their uploader, stay in their
-- clinic; the storage policies of the "deal-files" bucket check the
-- "<organization_id>/deals/<deal_id>/" prefix the same way.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m2', tests.invite('m2@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m1_id', (select id from public.sales where email = 'm1@clinic.kz')::text, true);
select set_config('t.m2_id', (select id from public.sales where email = 'm2@clinic.kz')::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);
select set_config('t.other_org', tests.org_of(current_setting('t.other')::uuid)::text, true);

-- The bucket is private, limited to 20 MB and to the allowed types
select tests.assert(
  (select not public and file_size_limit = 20971520 and allowed_mime_types @> array['image/*', 'application/pdf', 'audio/*', 'video/*']
   from storage.buckets where id = 'deal-files'),
  'the deal-files bucket is private, 20 MB, images, PDF, audio and video');

-- Two deals of one patient: one for each manager
select tests.login_as(current_setting('t.owner')::uuid);
update public.task_rules set is_active = false;
insert into public.patients (first_name) values ('Пациент');
insert into public.patients (first_name) values ('Второй');
insert into public.deals (patient_id, name, sales_id)
select p.id, d.name, d.sales_id
from public.patients p,
  (values ('d1', current_setting('t.m1_id')::bigint), ('d2', current_setting('t.m2_id')::bigint)) as d(name, sales_id)
where p.first_name = 'Пациент';
select set_config('t.d1', (select id from public.deals where name = 'd1')::text, true);
select set_config('t.d2', (select id from public.deals where name = 'd2')::text, true);
select set_config('t.patient', (select id from public.patients where first_name = 'Пациент')::text, true);
select set_config('t.p1', current_setting('t.org') || '/deals/' || current_setting('t.d1') || '/', true);
select set_config('t.p2', current_setting('t.org') || '/deals/' || current_setting('t.d2') || '/', true);
select tests.logout();

-- A manager uploads a file to their deal: the patient and the author are set
select tests.login_as(current_setting('t.m1')::uuid);
insert into storage.objects (bucket_id, name) values ('deal-files', current_setting('t.p1') || 'a1-snimok.jpg');
insert into public.deal_files (deal_id, path, name, size, mime)
values (current_setting('t.d1')::bigint, current_setting('t.p1') || 'a1-snimok.jpg', 'Снимок.jpg', 120000, 'image/jpeg');
select tests.assert(
  (select patient_id = current_setting('t.patient')::bigint and sales_id = current_setting('t.m1_id')::bigint
     and organization_id = current_setting('t.org')::bigint
   from public.deal_files where name = 'Снимок.jpg'),
  'a new file gets the patient of the deal, the uploader and the clinic');
select tests.assert(
  exists (select 1 from storage.objects where name = current_setting('t.p1') || 'a1-snimok.jpg'),
  'the uploader reads the stored object');
select tests.throws(
  format($q$insert into public.deal_files (deal_id, path, name, size, mime) values (%s, %L, 'x.pdf', 10, 'application/pdf')$q$,
    current_setting('t.d1'), current_setting('t.p2') || 'x.pdf'),
  '23514', 'the path must be in the folder of the deal');
select tests.throws(
  format($q$insert into public.deal_files (deal_id, path, name, size, mime) values (%s, %L, 'big.mp4', 30000000, 'video/mp4')$q$,
    current_setting('t.d1'), current_setting('t.p1') || 'big.mp4'),
  '23514', 'a file is at most 20 MB');
select tests.throws(
  format($q$insert into public.deal_files (deal_id, path, name, sales_id) values (%s, %L, 'y.pdf', %s)$q$,
    current_setting('t.d1'), current_setting('t.p1') || 'y.pdf', current_setting('t.m2_id')),
  '42501', 'a file cannot be added on behalf of a colleague');
select tests.throws(
  format($q$update public.deal_files set name = 'Другое.jpg' where deal_id = %s$q$, current_setting('t.d1')),
  '42501', 'files are not edited');
select tests.logout();

-- The upload shows in the audit log of the deal
select tests.assert(
  exists (select 1 from public.audit_log where entity = 'file' and action = 'create'
          and deal_id = current_setting('t.d1')::bigint and sales_id = current_setting('t.m1_id')::bigint
          and changes -> 'name' ->> 1 = 'Снимок.jpg'),
  'an upload is logged with its deal and author');

-- A file received in the chat (edge function, service role)
insert into public.messages (organization_id, patient_id, deal_id, transport, chat_id, direction, text, content_type, status,
  attachment_path, attachment_name, attachment_mime, attachment_size)
values (current_setting('t.org')::bigint, current_setting('t.patient')::bigint, current_setting('t.d1')::bigint,
  'whatsapp', '77010000000', 'in', null, 'document', 'inbound',
  current_setting('t.p1') || 'c1-analiz.pdf', 'Анализ.pdf', 'application/pdf', 5000);
insert into public.deal_files (organization_id, deal_id, path, name, size, mime, sales_id, message_id)
select organization_id, deal_id, attachment_path, attachment_name, attachment_size, attachment_mime, null, id
from public.messages where attachment_name = 'Анализ.pdf';
select tests.assert(
  not exists (select 1 from public.audit_log where entity = 'file' and changes -> 'name' ->> 1 = 'Анализ.pdf'),
  'chat files are not logged as uploads');

-- Every employee who sees the deal sees its files; managers cannot fake a chat file
select tests.login_as(current_setting('t.m2')::uuid);
select tests.assert(
  tests.count(format('select * from public.deal_files where deal_id = %s', current_setting('t.d1'))) = 2,
  'all: a colleague sees the files of the deal');
select tests.assert(
  tests.count(format($q$select * from storage.objects where bucket_id = 'deal-files' and name like %L$q$, current_setting('t.p1') || '%')) = 1,
  'all: a colleague reads the stored objects of the deal');
select tests.assert(
  tests.affected(format('delete from public.deal_files where deal_id = %s', current_setting('t.d1'))) = 0,
  'a manager cannot delete a colleague''s file');
select tests.assert(
  tests.affected(format($q$delete from storage.objects where name = %L$q$, current_setting('t.p1') || 'a1-snimok.jpg')) = 0,
  'a manager cannot delete a colleague''s stored object');
select tests.throws(
  format($q$insert into public.deal_files (deal_id, path, name, message_id) values (%s, %L, 'z.pdf', (select id from public.messages limit 1))$q$,
    current_setting('t.d1'), current_setting('t.p1') || 'z.pdf'),
  '42501', 'a manager cannot add a chat file');
select tests.logout();

-- The head restricts managers to their own deals: files follow
select tests.login_as(current_setting('t.head')::uuid);
update public.organization_settings set manager_deal_visibility = 'own';
select tests.logout();

select tests.login_as(current_setting('t.m2')::uuid);
select tests.assert(
  tests.count('select * from public.deal_files') = 0,
  'own: a manager does not see files of a colleague''s deal');
select tests.assert(
  tests.count($q$select * from storage.objects where bucket_id = 'deal-files'$q$) = 0,
  'own: a manager does not read stored objects of a colleague''s deal');
select tests.throws(
  format($q$insert into storage.objects (bucket_id, name) values ('deal-files', %L)$q$, current_setting('t.p1') || 'b.pdf'),
  '42501', 'own: a manager cannot upload to a colleague''s deal');
select tests.throws(
  format($q$insert into public.deal_files (deal_id, path, name) values (%s, %L, 'b.pdf')$q$,
    current_setting('t.d1'), current_setting('t.p1') || 'b.pdf'),
  '42501', 'own: a manager cannot list a file in a colleague''s deal');
-- Storage paths outside the folder of a visible deal are refused
insert into storage.objects (bucket_id, name) values ('deal-files', current_setting('t.p2') || 'own.pdf');
select tests.throws(
  format($q$insert into storage.objects (bucket_id, name) values ('deal-files', %L)$q$, current_setting('t.org') || '/loose.pdf'),
  '42501', 'a file outside a deal folder is refused');
select tests.throws(
  format($q$insert into storage.objects (bucket_id, name) values ('deal-files', %L)$q$, current_setting('t.org') || '/deals/abc/x.pdf'),
  '42501', 'a malformed deal folder is refused');
select tests.throws(
  format($q$insert into storage.objects (bucket_id, name) values ('deal-files', %L)$q$, current_setting('t.p2')),
  '42501', 'the deal folder itself is not a file');
-- Note attachments keep their own bucket and rules
insert into storage.objects (bucket_id, name) values ('attachments', current_setting('t.org') || '/note.png');
select tests.assert(
  tests.count($q$select * from storage.objects where bucket_id = 'attachments'$q$) = 1,
  'note attachments still work in the attachments bucket');
select tests.logout();

-- Deletion: the uploader deletes their own file, chat files stay
select tests.login_as(current_setting('t.m2')::uuid);
insert into public.deal_files (deal_id, path, name, size, mime)
values (current_setting('t.d2')::bigint, current_setting('t.p2') || 'own.pdf', 'План.pdf', 1000, 'application/pdf');
select tests.assert(
  tests.affected($q$delete from public.deal_files where name = 'План.pdf'$q$) = 1,
  'the uploader deletes their file');
select tests.assert(
  tests.affected(format($q$delete from storage.objects where name = %L$q$, current_setting('t.p2') || 'own.pdf')) = 1,
  'the uploader deletes their stored object');
select tests.logout();
select tests.assert(
  exists (select 1 from public.audit_log where entity = 'file' and action = 'delete' and changes -> 'name' ->> 0 = 'План.pdf'),
  'a deletion is logged');

select tests.login_as(current_setting('t.head')::uuid);
select tests.assert(
  tests.affected($q$delete from public.deal_files where name = 'Анализ.pdf'$q$) = 0,
  'a chat file cannot be deleted from the list, even by the head');
select tests.assert(
  tests.affected($q$delete from public.deal_files where name = 'Снимок.jpg'$q$) = 1,
  'the head deletes any uploaded file');
select tests.assert(
  tests.affected(format($q$delete from storage.objects where name = %L$q$, current_setting('t.p1') || 'a1-snimok.jpg')) = 1,
  'the head deletes any stored object');
select tests.logout();

-- A deal moved to another patient takes its files along
select tests.login_as(current_setting('t.owner')::uuid);
update public.deals set patient_id = (select id from public.patients where first_name = 'Второй')
where id = current_setting('t.d1')::bigint;
select tests.assert(
  (select patient_id from public.deal_files where name = 'Анализ.pdf') = (select id from public.patients where first_name = 'Второй'),
  'files follow their deal to another patient');
select tests.logout();

-- Clinic isolation
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.count('select * from public.deal_files') = 0, 'another clinic sees no file');
select tests.assert(
  tests.count($q$select * from storage.objects where bucket_id = 'deal-files'$q$) = 0,
  'another clinic reads no stored object');
select tests.throws(
  format($q$insert into storage.objects (bucket_id, name) values ('deal-files', %L)$q$, current_setting('t.p2') || 'hack.pdf'),
  '42501', 'another clinic cannot upload into our folder');
select tests.throws(
  format($q$insert into storage.objects (bucket_id, name) values ('deal-files', %L)$q$,
    current_setting('t.other_org') || '/deals/' || current_setting('t.d2') || '/hack.pdf'),
  '42501', 'another clinic cannot upload for our deal under its own prefix');
select tests.throws(
  format($q$insert into public.deal_files (deal_id, path, name) values (%s, %L, 'hack.pdf')$q$,
    current_setting('t.d2'), current_setting('t.other_org') || '/deals/' || current_setting('t.d2') || '/hack.pdf'),
  '42501', 'another clinic cannot list a file in our deal');
select tests.assert(
  tests.affected($q$delete from storage.objects where bucket_id = 'deal-files'$q$) = 0,
  'another clinic deletes no stored object');
select tests.logout();

-- Deleting a deal removes its file list
delete from public.deals where id = current_setting('t.d1')::bigint;
select tests.assert(
  not exists (select 1 from public.deal_files where deal_id = current_setting('t.d1')::bigint),
  'the files of a deleted deal are removed from the list');

rollback;

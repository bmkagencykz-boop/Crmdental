--
-- Data safety (stage 41): the patient archive (rights per role, hidden from
-- the search), hard deletion (owner only, no history), ON DELETE RESTRICT
-- of the money and medical tables, deals with payments, the immutable
-- operations of a closed cash shift, the medical data out of the
-- integrator's reach (patient_medical, the write path through patients),
-- the unique IIN and the duplicates by IIN, the patient merge, card
-- numbers, the default rights, retention, the private attachments bucket,
-- the indexes, clinic isolation and the deletion of a whole clinic.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m2', tests.invite('m2@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.int', tests.invite('int@clinic.kz', current_setting('t.org')::bigint, 'integrator')::text, true);
select set_config('t.owner_id', (select id from public.sales where email = 'owner@clinic.kz')::text, true);
select set_config('t.head_id', (select id from public.sales where email = 'head@clinic.kz')::text, true);
select set_config('t.m1_id', (select id from public.sales where email = 'm1@clinic.kz')::text, true);
select set_config('t.m2_id', (select id from public.sales where email = 'm2@clinic.kz')::text, true);
select set_config('t.other', tests.sign_up('owner@second.kz', 'Другая')::text, true);
select set_config('t.other_org', tests.org_of(current_setting('t.other')::uuid)::text, true);

update public.task_rules set is_active = false;

create function tests.pid(name text) returns bigint language sql security definer as $$
  select id from public.patients
  where last_name = name and organization_id in (current_setting('t.org')::bigint, current_setting('t.other_org')::bigint)
$$;
grant execute on all functions in schema tests to authenticated;

--
-- Default rights: a manager neither deletes nor archives patients
--
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert((public.my_access_rights() -> 'rights' -> 'patients' ->> 'delete') = 'none', 'a manager: patients delete «none» by default');
select tests.logout();
select tests.login_as(current_setting('t.head')::uuid);
select tests.assert((public.my_access_rights() -> 'rights' -> 'patients' ->> 'delete') = 'all', 'the head keeps the patients delete right');
select tests.logout();

--
-- Medical data: written through patients, stored in patient_medical
--
select tests.login_as(current_setting('t.m1')::uuid);
insert into public.patients (first_name, last_name, iin, allergies, contraindications, chronic_diseases)
values ('Асель', 'Нурланова', '9005 1540 0123', 'Лидокаин', 'Беременность', 'Диабет');
insert into public.patients (first_name, last_name) values ('Ерлан', 'Омаров');
insert into public.patients (first_name, last_name, card_number) values ('Дана', 'Картова', 'A-15');
select tests.assert(
  (select iin is null and allergies is null and contraindications is null and chronic_diseases is null
   from public.patients where id = tests.pid('Нурланова')),
  'the patients row keeps no medical data');
select tests.assert(
  (select iin = '900515400123' and allergies = 'Лидокаин' and contraindications = 'Беременность' and chronic_diseases = 'Диабет'
     and birth_date = date '1990-05-15' and gender = 'female'
   from public.patients_summary where id = tests.pid('Нурланова')),
  'patients_summary shows the medical data; the IIN still fills the birth date and the sex');
select tests.assert(tests.count('select 1 from public.patient_medical') = 1, 'one medical row: a patient without medical data has none');
-- A column in the SET list is given (cleared); the others stay
update public.patients set allergies = null where id = tests.pid('Нурланова');
update public.patients set city = 'Алматы' where id = tests.pid('Нурланова');
select tests.assert(
  (select allergies is null and iin = '900515400123' and contraindications = 'Беременность'
   from public.patients_summary where id = tests.pid('Нурланова')),
  'clearing one medical field keeps the others; other edits do not touch them');
update public.patients set allergies = 'Латекс' where id = tests.pid('Нурланова');
select tests.throws($$insert into public.patients (first_name, last_name, iin) values ('Ошибка', 'Ошибкин', '900515400124')$$, '22023', 'a wrong IIN is refused');
select tests.throws($$insert into public.patients (first_name, last_name, iin) values ('Двойник', 'Двойников', '900515400123')$$, '23505', 'the IIN is unique in the clinic');
select tests.throws($$update public.patients set iin = '900515400123' where id = tests.pid('Омаров')$$, '23505', 'an IIN of another patient is refused on update too');
select tests.throws($$insert into public.patient_medical (patient_id, allergies) values (tests.pid('Омаров'), 'x')$$, '42501', 'patient_medical is written through patients only');
select tests.logout();
select tests.assert(
  exists (select 1 from public.audit_log where entity = 'patient' and entity_id = tests.pid('Нурланова') and patient_id = tests.pid('Нурланова')
    and changes ? 'allergies'),
  'medical changes are in the audit log of the patient');

-- The integrator sees the patient, never the medical data
select tests.login_as(current_setting('t.int')::uuid);
select tests.assert(tests.count('select 1 from public.patients') = 3, 'the integrator sees the patients');
select tests.assert(tests.count('select 1 from public.patient_medical') = 0, 'the integrator reads no medical row');
select tests.assert(
  (select iin is null and allergies is null and contraindications is null and chronic_diseases is null
   from public.patients_summary where id = tests.pid('Нурланова')),
  'patients_summary: no IIN, no allergies for the integrator');
select tests.assert(jsonb_array_length(public.global_search('900515400123') -> 'patients') = 0, 'the integrator does not find a patient by IIN');
select tests.logout();
select tests.login_as(current_setting('t.head')::uuid);
select tests.assert(
  (select (r ->> 'id')::bigint = tests.pid('Нурланова') and (r ->> 'rank')::integer = 1
   from jsonb_array_elements(public.global_search('9005 1540 0123') -> 'patients') r limit 1),
  'the staff find a patient by IIN');
select tests.logout();

--
-- Card numbers
--
select tests.assert(
  (select card_number from public.patients where id = tests.pid('Нурланова')) = '1'
  and (select card_number from public.patients where id = tests.pid('Омаров')) = '2'
  and (select card_number from public.patients where id = tests.pid('Картова')) = 'A-15',
  'a new patient gets the next card number of the clinic; a given number is kept');
update public.patients set card_number = '3' where id = tests.pid('Картова');
insert into public.patients (organization_id, first_name, last_name) values (current_setting('t.org')::bigint, 'Номер', 'Пропусков');
select tests.assert((select card_number from public.patients where id = tests.pid('Пропусков')) = '4', 'a number in use is skipped');
insert into public.patients (organization_id, first_name, last_name) values (current_setting('t.other_org')::bigint, 'Другой', 'Чужов');
select tests.assert((select card_number from public.patients where id = tests.pid('Чужов')) = '1', 'the counter is per clinic');

--
-- Archive
--
select tests.login_as(current_setting('t.m1')::uuid);
select tests.throws($$update public.patients set archived_at = now() where id = tests.pid('Омаров')$$, '42501', 'a manager cannot archive by default');
select tests.logout();
select tests.login_as(current_setting('t.head')::uuid);
update public.patients set archived_at = now() - interval '5 days', archived_by = current_setting('t.m1_id')::bigint where id = tests.pid('Омаров');
select tests.assert(
  (select archived_at > now() - interval '1 minute' and archived_by = current_setting('t.head_id')::bigint
   from public.patients_summary where id = tests.pid('Омаров')),
  'the head archives: who and when are set by the database');
select tests.assert(jsonb_array_length(public.global_search('Омаров') -> 'patients') = 0, 'an archived patient is not in the search');
select tests.assert(tests.count($$select 1 from public.patients_summary where archived_at is null$$) = 3, 'the list without the archive');
select tests.logout();
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(tests.count($$select 1 from public.patients where id = tests.pid('Омаров')$$) = 1, 'an archived patient stays readable');
select tests.throws($$update public.patients set archived_at = null where id = tests.pid('Омаров')$$, '42501', 'a manager cannot restore');
select tests.logout();
-- The owner lets a manager archive
select tests.login_as(current_setting('t.owner')::uuid);
select public.save_access_rights(current_setting('t.m2_id')::bigint, '{"patients": {"delete": "all"}}'::jsonb, null);
select tests.logout();
select tests.login_as(current_setting('t.m2')::uuid);
update public.patients set archived_at = now() where id = tests.pid('Пропусков');
select tests.assert((select archived_by from public.patients where id = tests.pid('Пропусков')) = current_setting('t.m2_id')::bigint, 'a manager with the right archives');
select tests.throws($$update public.patients set archived_at = null where id = tests.pid('Пропусков')$$, '42501', 'but restoring stays with the owner and the head');
select tests.logout();
select tests.login_as(current_setting('t.owner')::uuid);
update public.patients set archived_at = null where id = tests.pid('Омаров');
select tests.assert((select archived_at is null and archived_by is null from public.patients where id = tests.pid('Омаров')), 'the owner restores');
select tests.logout();
-- Another clinic cannot touch it
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.affected($$update public.patients set archived_at = now() where id = tests.pid('Омаров')$$) = 0, 'another clinic cannot archive');
select tests.assert(tests.count('select 1 from public.patient_medical') = 0, 'another clinic reads no medical row');
select tests.assert(jsonb_array_length(public.global_search('900515400123') -> 'patients') = 0, 'another clinic does not find the IIN');
select tests.logout();

--
-- Money: a payment in a shift, the shift closed
--
select tests.login_as(current_setting('t.m1')::uuid);
insert into public.deals (patient_id, name, sales_id) values (tests.pid('Нурланова'), 'Имплант', current_setting('t.m1_id')::bigint);
select set_config('t.deal', (select id from public.deals where name = 'Имплант')::text, true);
select set_config('t.shift', public.open_cash_shift(0)::text, true);
insert into public.account_operations (patient_id, kind, amount, method, deal_id, comment)
values (tests.pid('Нурланова'), 'payment', 50000, 'cash', current_setting('t.deal')::bigint, 'аванс');
select set_config('t.op', (select id from public.account_operations where comment = 'аванс')::text, true);
select tests.assert((select shift_id from public.account_operations where id = current_setting('t.op')::bigint) = current_setting('t.shift')::bigint, 'the operation is in the shift');
select tests.logout();
-- Open shift: the owner may still fix the comment
select tests.login_as(current_setting('t.owner')::uuid);
update public.account_operations set comment = 'аванс за имплант' where id = current_setting('t.op')::bigint;
select tests.assert((select comment from public.account_operations where id = current_setting('t.op')::bigint) = 'аванс за имплант', 'an operation of an open shift changes');
select tests.logout();
select tests.login_as(current_setting('t.m1')::uuid);
select public.close_cash_shift(current_setting('t.shift')::bigint, 50000);
select tests.logout();
select tests.login_as(current_setting('t.owner')::uuid);
select tests.throws($$update public.account_operations set comment = 'x' where id = current_setting('t.op')::bigint$$, '22023', 'a closed shift: the operation does not change');
select tests.throws($$update public.account_operations set method = 'card' where id = current_setting('t.op')::bigint$$, '22023', 'nor its method');
select tests.throws($$delete from public.account_operations where id = current_setting('t.op')::bigint$$, '22023', 'nor is it cancelled');
select tests.throws($$delete from public.deal_payments where deal_id = current_setting('t.deal')::bigint$$, '22023', 'nor is its deal payment deleted');
select tests.throws($$update public.deal_payments set amount = 1 where deal_id = current_setting('t.deal')::bigint$$, '22023', 'nor changed');
insert into public.account_operations (patient_id, kind, account, amount, comment)
values (tests.pid('Нурланова'), 'correction', 'services', -1000, 'исправление');
select tests.assert(exists (select 1 from public.account_operations where comment = 'исправление'), 'the owner corrects with a correction instead');
select tests.logout();

--
-- Deals with payments are not deleted
--
select tests.login_as(current_setting('t.owner')::uuid);
select tests.throws($$delete from public.deals where id = current_setting('t.deal')::bigint$$, '23503', 'a deal with payments is not deleted');
select tests.assert(
  (select (r ->> 'ok')::boolean = false and r ->> 'code' = 'deal_has_payments'
   from jsonb_array_elements(public.bulk_deals('delete', array[current_setting('t.deal')::bigint], '{}'::jsonb) -> 'results') r),
  'the bulk delete reports the deal with payments');
insert into public.deals (patient_id, name) values (tests.pid('Омаров'), 'Пустая');
delete from public.deals where name = 'Пустая';
select tests.assert(not exists (select 1 from public.deals where name = 'Пустая'), 'a deal without payments is deleted');
select tests.logout();

--
-- Hard deletion of patients
--
select tests.login_as(current_setting('t.head')::uuid);
select tests.throws($$delete from public.patients where id = tests.pid('Омаров')$$, '42501', 'the head does not delete a patient (archive)');
select tests.logout();
select tests.login_as(current_setting('t.owner')::uuid);
select tests.throws($$delete from public.patients where id = tests.pid('Нурланова')$$, '23503', 'a patient with payments is not deleted, even by the owner');
insert into public.visits (patient_id, starts_at, ends_at) values (tests.pid('Омаров'), now() + interval '1 day', now() + interval '1 day 1 hour');
select tests.throws($$delete from public.patients where id = tests.pid('Омаров')$$, '23503', 'a patient with a visit is not deleted');
delete from public.visits where patient_id = tests.pid('Омаров');
insert into public.patient_teeth (patient_id, tooth, state) values (tests.pid('Омаров'), 36, 'caries');
select tests.throws($$delete from public.patients where id = tests.pid('Омаров')$$, '23503', 'a patient with a dental chart is not deleted');
select tests.logout();
-- Even a system write: the guard, then the foreign keys
select tests.throws($$delete from public.patients where id = tests.pid('Омаров')$$, '23503', 'the service role neither');
select tests.assert(
  (select bool_and(c.confdeltype = 'r') from pg_constraint c
   where c.conname in ('account_operations_patient_id_fkey', 'account_operations_deal_id_fkey', 'deal_payments_deal_id_fkey',
     'visits_patient_id_fkey', 'visit_records_patient_id_fkey', 'treatment_plans_patient_id_fkey', 'patient_teeth_patient_id_fkey',
     'patient_tooth_history_patient_id_fkey', 'patient_questionnaires_patient_id_fkey', 'patient_consents_patient_id_fkey',
     'patient_files_patient_id_fkey', 'lab_orders_patient_id_fkey'))
  and (select count(*) from pg_constraint c where c.contype = 'f' and c.confdeltype = 'r' and c.conname in ('account_operations_patient_id_fkey',
     'account_operations_deal_id_fkey', 'deal_payments_deal_id_fkey', 'visits_patient_id_fkey', 'visit_records_patient_id_fkey',
     'treatment_plans_patient_id_fkey', 'patient_teeth_patient_id_fkey', 'patient_tooth_history_patient_id_fkey',
     'patient_questionnaires_patient_id_fkey', 'patient_consents_patient_id_fkey', 'patient_files_patient_id_fkey',
     'lab_orders_patient_id_fkey')) = 12,
  'the money and medical tables reference patients and deals ON DELETE RESTRICT');
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.patients (first_name, last_name) values ('Ошибся', 'Лишний');
insert into public.patient_notes (patient_id, text) values (tests.pid('Лишний'), 'заметка');
delete from public.patients where id = tests.pid('Лишний');
select tests.assert(tests.pid('Лишний') is null, 'the owner deletes a patient without history (notes follow)');
select tests.logout();

--
-- Duplicates by IIN and the merge
--
-- An IIN shared before stage 41 (the migration flags it)
insert into public.patients (organization_id, first_name, last_name, phone_jsonb)
values (current_setting('t.org')::bigint, 'Асель', 'Нурланова-Дубль', '[{"number": "+77015550000"}]');
insert into public.patient_medical (organization_id, patient_id, iin, iin_duplicate, allergies, chronic_diseases)
values (current_setting('t.org')::bigint, tests.pid('Нурланова-Дубль'), '900515400123', true, 'Пенициллин', 'Гипертония');
insert into public.deals (organization_id, patient_id, name) values (current_setting('t.org')::bigint, tests.pid('Нурланова-Дубль'), 'Дубль-сделка');
insert into public.visits (organization_id, patient_id, starts_at, ends_at)
values (current_setting('t.org')::bigint, tests.pid('Нурланова-Дубль'), now() - interval '3 days', now() - interval '3 days' + interval '1 hour');
select tests.login_as(current_setting('t.head')::uuid);
-- A whole form saved again (the same IIN) works for a flagged duplicate
update public.patients set iin = '900515400123', city = 'Астана' where id = tests.pid('Нурланова-Дубль');
select tests.assert((select iin_duplicate from public.patient_medical where patient_id = tests.pid('Нурланова-Дубль')),
  'saving the same IIN keeps a legacy duplicate as it is');
select tests.assert(
  (select reasons @> array['iin'] from public.patient_duplicates(tests.pid('Нурланова')) where patient_id = tests.pid('Нурланова-Дубль')),
  'patients sharing an IIN are proposed as duplicates');
select public.merge_patients(tests.pid('Нурланова'), tests.pid('Нурланова-Дубль'));
select tests.assert(tests.pid('Нурланова-Дубль') is null, 'the merged patient is gone');
select tests.assert(
  (select iin = '900515400123' and allergies = E'Латекс\nПенициллин' and chronic_diseases = E'Диабет\nГипертония'
   from public.patients_summary where id = tests.pid('Нурланова')),
  'the merge keeps the IIN and the medical notes of both');
select tests.assert(
  (select count(*) from public.patient_medical where iin = '900515400123') = 1
  and not (select iin_duplicate from public.patient_medical where patient_id = tests.pid('Нурланова')),
  'one IIN left, no longer a duplicate');
select tests.assert(
  (select count(*) from public.visits where patient_id = tests.pid('Нурланова')) = 1
  and (select patient_id from public.deals where name = 'Дубль-сделка') = tests.pid('Нурланова'),
  'the visits and deals of the merged patient move');
select tests.logout();

--
-- Retention: old technical rows go, recent ones, money and the audit log stay
--
select set_config('t.audit_before', (select count(*) from public.audit_log)::text, true);
insert into public.notifications (organization_id, sales_id, kind, title, created_at, read_at) values
  (current_setting('t.org')::bigint, current_setting('t.m1_id')::bigint, 'lead_assigned', 'old read', now() - interval '200 days', now() - interval '199 days'),
  (current_setting('t.org')::bigint, current_setting('t.m1_id')::bigint, 'lead_assigned', 'old unread', now() - interval '200 days', null),
  (current_setting('t.org')::bigint, current_setting('t.m1_id')::bigint, 'lead_assigned', 'recent read', now() - interval '2 days', now() - interval '1 day');
insert into public.mis_sync_log (organization_id, kind, operation, created_at) values
  (current_setting('t.org')::bigint, 'dentist_plus', 'poll', now() - interval '100 days'),
  (current_setting('t.org')::bigint, 'dentist_plus', 'poll', now() - interval '10 days');
insert into public.lead_submissions (organization_id, phone, payload_hash, patient_id, deal_id, created_at) values
  (current_setting('t.org')::bigint, '+77010000000', 'a', tests.pid('Нурланова'), current_setting('t.deal')::bigint, now() - interval '400 days'),
  (current_setting('t.org')::bigint, '+77010000000', 'b', tests.pid('Нурланова'), current_setting('t.deal')::bigint, now() - interval '30 days');
select set_config('t.purged', private.retention_tick()::text, true);
select tests.assert((current_setting('t.purged')::jsonb ->> 'notifications')::integer >= 1, 'the tick reports what it purged');
select tests.assert(
  not exists (select 1 from public.notifications where title = 'old read')
  and exists (select 1 from public.notifications where title = 'old unread')
  and exists (select 1 from public.notifications where title = 'recent read'),
  'notifications: read and old ones go, unread and recent ones stay');
select tests.assert((select count(*) from public.mis_sync_log where organization_id = current_setting('t.org')::bigint) = 1, 'the MIS log keeps 90 days');
select tests.assert((select array_agg(payload_hash) from public.lead_submissions) = array['b'], 'lead submissions keep a year');
select tests.assert((select count(*) from public.audit_log) >= current_setting('t.audit_before')::bigint
  and exists (select 1 from public.account_operations where id = current_setting('t.op')::bigint),
  'the audit log and the money are never purged');

--
-- Storage, indexes
--
select tests.assert((select not public from storage.buckets where id = 'attachments'), 'the attachments bucket is private');
select tests.assert(
  to_regclass('public.messages_patient_id_idx') is not null and to_regclass('public.account_operations_visit_id_idx') is not null
  and to_regclass('public.patient_medical_iin_key') is not null,
  'the indexes of the hot paths exist');

--
-- Deleting a whole clinic still works (protected rows go first)
--
select tests.login_as(current_setting('t.head')::uuid);
insert into public.patient_teeth (patient_id, tooth, state) values (tests.pid('Нурланова'), 11, 'crown');
select tests.logout();
delete from public.organizations where id = current_setting('t.org')::bigint;
select tests.assert(not exists (select 1 from public.patients where organization_id = current_setting('t.org')::bigint)
  and not exists (select 1 from public.account_operations where organization_id = current_setting('t.org')::bigint)
  and not exists (select 1 from public.cash_shifts where organization_id = current_setting('t.org')::bigint)
  and not exists (select 1 from public.patient_medical where organization_id = current_setting('t.org')::bigint),
  'a clinic with money in a closed shift and medical data is deleted whole');
select tests.assert(exists (select 1 from public.patients where id = tests.pid('Чужов')), 'the other clinic is untouched');

rollback;

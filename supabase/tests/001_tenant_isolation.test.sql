--
-- Tenant isolation: an employee of one clinic can never read, write or
-- reference data of another clinic.
--
begin;
\ir helpers.sql

-- Two clinics sign up by themselves
select set_config('t.alice', tests.sign_up('alice@clinic-a.kz', 'Клиника A')::text, true);
select set_config('t.bob', tests.sign_up('bob@clinic-b.kz', 'Клиника B')::text, true);
select set_config('t.org_a', tests.org_of(current_setting('t.alice')::uuid)::text, true);
select set_config('t.org_b', tests.org_of(current_setting('t.bob')::uuid)::text, true);

select tests.assert(current_setting('t.org_a') <> current_setting('t.org_b'), 'each sign-up creates its own organization');
select tests.assert(
  (select role from public.sales where user_id = current_setting('t.alice')::uuid) = 'owner',
  'the user who signs up owns the organization');
select tests.assert(
  (select name from public.organizations where id = current_setting('t.org_a')::bigint) = 'Клиника A',
  'organization is named after the sign-up form');
select tests.assert(
  (select count(*) from public.configuration where organization_id = current_setting('t.org_a')::bigint) = 1,
  'a configuration row is created with the organization');

-- Alice fills her CRM; organization_id comes from the column default
select tests.login_as(current_setting('t.alice')::uuid);
insert into public.patients (last_name, first_name, phone_jsonb) values ('Пациентова', 'Анна', '[{"number":"8 701 000 00 01"}]');
select set_config('t.patient_a', (select id from public.patients)::text, true);
insert into public.patient_notes (patient_id, text) select id, 'заметка A' from public.patients;
insert into public.deals (patient_id, name) select id, 'Сделка A' from public.patients;
select set_config('t.deal_a', (select id from public.deals)::text, true);
insert into public.deal_notes (deal_id, text) select id, 'заметка сделки A' from public.deals;
insert into public.tasks (deal_id, text, due_date) select id, 'позвонить', now() + interval '1 day' from public.deals;
insert into public.deal_payments (deal_id, amount) select id, 50000 from public.deals;
insert into public.calls (patient_id, direction, duration_seconds) select id, 'in', 60 from public.patients;
insert into public.tags (name, color) values ('VIP', '#ff0000');
select set_config('t.stage_a', (select id from public.stages order by id limit 1)::text, true);
select set_config('t.source_a', (select id from public.lead_sources order by id limit 1)::text, true);
select tests.assert(
  (select bool_and(organization_id = current_setting('t.org_a')::bigint) from public.deals),
  'rows are stamped with the author''s organization');
select tests.assert(
  (select sales_id from public.deals) = (select id from public.sales where user_id = current_setting('t.alice')::uuid),
  'sales_id defaults to the current user');
select tests.assert(tests.count('select * from public.patients_summary') = 1, 'alice sees her patient in the summary view');
select tests.assert(tests.count('select * from public.deals_summary') = 1, 'alice sees her deal in the board view');
select tests.logout();

-- Bob sees nothing of clinic A, in tables or views
select tests.login_as(current_setting('t.bob')::uuid);
select tests.assert(tests.count('select * from public.' || t) = 0, 'bob cannot read ' || t)
from unnest(array['patients', 'patient_notes', 'deals', 'deal_notes', 'deal_payments', 'deal_events', 'tasks', 'calls', 'tags',
                  'patients_summary', 'deals_summary', 'activity_log']) as t;
select tests.assert(tests.count('select * from public.sales') = 1, 'bob only sees himself among sales');
select tests.assert(tests.count('select * from public.organizations') = 1, 'bob only sees his organization');
select tests.assert(tests.count('select * from public.configuration') = 1, 'bob only sees his configuration');
select tests.assert(tests.count('select * from public.organization_settings') = 1, 'bob only sees his settings');
select tests.assert(tests.count('select * from public.pipelines') = 1, 'bob only sees his pipeline');
select tests.assert(tests.count('select * from public.stages') = 8, 'bob only sees his stages');
select tests.assert(tests.count('select * from public.services') = 8, 'bob only sees his services');
select tests.assert(tests.count('select * from public.lead_sources') = 8, 'bob only sees his sources');
select tests.assert(tests.count('select * from public.lost_reasons') = 8, 'bob only sees his lost reasons');
select tests.assert(tests.count('select * from public.find_patients_by_phone(''87010000001'')') = 0, 'bob cannot find A patients by phone');

-- ... cannot change or delete it
select tests.assert(tests.affected('update public.patients set first_name = ''hacked''') = 0, 'bob cannot update A patients');
select tests.assert(tests.affected('delete from public.deals') = 0, 'bob cannot delete A deals');
select tests.assert(tests.affected('update public.stages set name = ''hacked'' where id = ' || current_setting('t.stage_a')) = 0, 'bob cannot rename A stages');
select tests.assert(tests.affected('update public.organizations set name = ''hacked'' where id = ' || current_setting('t.org_a')) = 0, 'bob cannot rename clinic A');
select tests.assert(tests.affected('update public.configuration set config = ''{}'' where organization_id = ' || current_setting('t.org_a')) = 0, 'bob cannot change A configuration');

-- ... cannot write into clinic A
select tests.throws(
  format('insert into public.patients (organization_id, first_name) values (%s, ''intrus'')', current_setting('t.org_a')),
  '42501', 'bob cannot insert a patient into clinic A');
select tests.throws(
  format('insert into public.stages (organization_id, pipeline_id, name) select %s, pipeline_id, ''x'' from public.stages limit 1', current_setting('t.org_a')),
  '42501', 'bob cannot insert a stage into clinic A');

-- ... cannot reference rows of clinic A from his own rows
select tests.throws(
  format('insert into public.deals (patient_id) values (%s)', current_setting('t.patient_a')),
  '23503', 'bob cannot open a deal for a patient of clinic A');
insert into public.patients (first_name) values ('Пациент B');
insert into public.deals (patient_id) select id from public.patients;
select tests.throws(
  format('update public.deals set stage_id = %s', current_setting('t.stage_a')),
  '23503', 'bob cannot put his deal into a stage of clinic A');
select tests.throws(
  format('update public.deals set source_id = %s', current_setting('t.source_a')),
  '23503', 'bob cannot use a lead source of clinic A');
select tests.throws(
  format('insert into public.tasks (deal_id, text, due_date) values (%s, ''x'', now())', current_setting('t.deal_a')),
  '42501', 'bob cannot create a task on a deal of clinic A');

-- ... cannot move his own rows into clinic A
select tests.throws(
  format('update public.patients set organization_id = %s', current_setting('t.org_a')),
  '42501', 'bob cannot move a patient into clinic A');
select tests.logout();

-- Alice's data is intact and she does not see Bob's
select tests.login_as(current_setting('t.alice')::uuid);
select tests.assert((select first_name from public.patients) = 'Анна', 'A patient untouched');
select tests.assert(tests.count('select * from public.deals') = 1, 'A deal still there');
select tests.assert(tests.count('select * from public.patients') = 1, 'alice does not see B patients');
select tests.logout();

-- Anonymous visitors see nothing
select tests.login_anon();
select tests.assert(tests.count('select * from public.' || t) = 0, 'anon cannot read ' || t)
from unnest(array['organizations', 'sales', 'patients', 'deals', 'pipelines', 'configuration']) as t;
select tests.throws('insert into public.patients (first_name) values (''anon'')', '42501', 'anon cannot write');
select tests.logout();

-- A disabled employee loses access
update public.sales set disabled = true where user_id = current_setting('t.alice')::uuid;
select tests.login_as(current_setting('t.alice')::uuid);
select tests.assert(tests.count('select * from public.patients') = 0, 'disabled user sees nothing');
select tests.logout();

rollback;

--
-- Deleting a clinic (service operation) removes all of its data and nothing
-- of the other clinics.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.manager', tests.invite('admin@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая клиника')::text, true);

-- A full clinic: patient, deal on a stage with a service and a source,
-- payment, task, notes, call, tag, with rows authored by both employees
select tests.login_as(current_setting('t.manager')::uuid);
insert into public.patients (last_name, first_name, phone_jsonb, source_id)
select 'Ахметов', 'Даулет', '[{"number":"+77015551234"}]', id from public.lead_sources where code = 'instagram';
insert into public.deals (patient_id, name, service_id, plan_amount)
select p.id, 'Имплантация', s.id, 450000 from public.patients p, public.services s where s.name = 'Имплантация';
insert into public.deal_payments (deal_id, amount) select id, 100000 from public.deals;
insert into public.tasks (deal_id, text, due_date) select id, 'Перезвонить', now() from public.deals;
insert into public.deal_notes (deal_id, text) select id, 'Заметка' from public.deals;
insert into public.patient_notes (patient_id, text) select id, 'Заметка' from public.patients;
insert into public.calls (patient_id, deal_id, direction, duration_seconds) select patient_id, id, 'in', 60 from public.deals;
insert into public.tags (name, color) values ('VIP', '#FFCE87');
select tests.logout();

select tests.login_as(current_setting('t.other')::uuid);
insert into public.patients (first_name) values ('Пациент другой клиники');
insert into public.deals (patient_id, name) select id, 'Сделка другой клиники' from public.patients;
select tests.logout();

select set_config('t.other_org', tests.org_of(current_setting('t.other')::uuid)::text, true);

delete from public.organizations where id = current_setting('t.org')::bigint;

select tests.assert(
  (select count(*) from public.sales where organization_id = current_setting('t.org')::bigint) = 0
  and (select count(*) from public.patients where organization_id = current_setting('t.org')::bigint) = 0
  and (select count(*) from public.deals where organization_id = current_setting('t.org')::bigint) = 0
  and (select count(*) from public.deal_payments where organization_id = current_setting('t.org')::bigint) = 0
  and (select count(*) from public.tasks where organization_id = current_setting('t.org')::bigint) = 0
  and (select count(*) from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.organization_id = current_setting('t.org')::bigint) = 0
  and (select count(*) from public.lead_sources where organization_id = current_setting('t.org')::bigint) = 0
  and (select count(*) from public.organization_settings where organization_id = current_setting('t.org')::bigint) = 0,
  'deleting a clinic removes all of its data');

select tests.assert(
  (select count(*) from public.deals where organization_id = current_setting('t.other_org')::bigint) = 1
  and (select count(*) from public.sales where organization_id = current_setting('t.other_org')::bigint) = 1
  and (select count(*) from public.pipelines where organization_id = current_setting('t.other_org')::bigint) = 1,
  'the other clinic keeps its data');

rollback;

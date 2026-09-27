--
-- Import (import_batch): patients and deals from a file, idempotent reruns,
-- phone deduplication, no automations while importing, rights and isolation
-- of clinics, external references.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m1_id', (select id from public.sales where email = 'm1@clinic.kz')::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);

-- Stages of the default pipeline of the clinic
create function tests.stage(stage_name text) returns bigint language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
  where p.organization_id = current_setting('t.org')::bigint and p.is_default and s.name = stage_name
$$;

-- A stage checklist that would block moving deals out of "Новый лид", and
-- round robin that would give new deals away: the import ignores both
update public.organization_settings
set lead_distribution = 'round_robin', lead_distribution_sales_ids = array[current_setting('t.m1_id')::bigint]
where organization_id = current_setting('t.org')::bigint;
insert into public.stage_checklist_items (organization_id, stage_id, text)
values (current_setting('t.org')::bigint, tests.stage('Записан'), 'Уточнить жалобу');

-- The file: an amoCRM export with three deals, two of them of one patient
-- (the phone written two ways), one refused without a reason
select set_config('t.rows', jsonb_build_array(
  jsonb_build_object('index', 2, 'system', 'amocrm',
    'patient', jsonb_build_object('first_name', 'Асель', 'last_name', 'Нурланова', 'phones', jsonb_build_array('8 701 111 22 33')),
    'deal', jsonb_build_object('external_id', '1001', 'name', 'Имплантация', 'stage_id', tests.stage('В лечении'),
      'plan_amount', 450000, 'paid_amount', 150000, 'created_at', '2026-03-01T10:00:00+05:00')),
  jsonb_build_object('index', 3, 'system', 'amocrm',
    'patient', jsonb_build_object('first_name', 'Асель', 'last_name', 'Нурланова', 'phones', jsonb_build_array('+7 (701) 111-22-33')),
    'deal', jsonb_build_object('external_id', '1002', 'name', 'Гигиена', 'stage_id', tests.stage('Записан'))),
  jsonb_build_object('index', 4, 'system', 'amocrm',
    'patient', jsonb_build_object('first_name', 'Ерлан', 'phones', jsonb_build_array('7012223344')),
    'deal', jsonb_build_object('external_id', '1003', 'name', 'Брекеты', 'stage_id', tests.stage('Отказ'))),
  jsonb_build_object('index', 5, 'system', 'amocrm',
    'patient', jsonb_build_object('phones', jsonb_build_array()),
    'deal', jsonb_build_object('external_id', '1004'))
)::text, true);

-- Employees (managers) cannot import
select tests.login_as(current_setting('t.m1')::uuid);
select tests.throws(
  $q$select public.import_batch('deals', current_setting('t.rows')::jsonb)$q$,
  '42501', 'a manager cannot import');
select tests.logout();

-- The owner imports: patients and deals are created, the bad row is reported
select tests.login_as(current_setting('t.owner')::uuid);
select set_config('t.result', public.import_batch('deals', current_setting('t.rows')::jsonb)::text, true);
select tests.assert(
  (current_setting('t.result')::jsonb ->> 'created')::int = 3
  and (current_setting('t.result')::jsonb ->> 'patients_created')::int = 2
  and (current_setting('t.result')::jsonb ->> 'deals_created')::int = 3
  and jsonb_array_length(current_setting('t.result')::jsonb -> 'errors') = 1
  and (current_setting('t.result')::jsonb -> 'errors' -> 0 ->> 'index')::int = 5,
  'the batch creates patients and deals and reports the bad row: ' || current_setting('t.result'));
select tests.assert(
  (select count(*) from public.patients where phones @> array['+77011112233']) = 1,
  'the same phone written two ways is one patient');
select tests.assert(
  (select count(*) from public.deals d join public.patients p on p.id = d.patient_id where p.phones @> array['+77011112233']) = 2,
  'both deals belong to that patient');
select tests.assert(
  (select paid_amount = 150000 and plan_amount = 450000 and stage_id = tests.stage('В лечении')
     and created_at = '2026-03-01T10:00:00+05:00'::timestamptz and stage_changed_at = created_at
   from public.deals where name = 'Имплантация'),
  'the deal keeps its stage, amounts and date; "paid" becomes a payment');
select tests.assert(
  (select lost_reason_id is not null and closed_at is not null from public.deals where name = 'Брекеты'),
  'a refused deal without a reason gets "Другое"');
select tests.assert(
  (select count(*) from public.deals where sales_id is not null) = 0,
  'imported deals are not given away by round robin');
select tests.assert(
  (select count(*) from public.tasks t join public.deals d on d.id = t.deal_id where d.organization_id = current_setting('t.org')::bigint) = 0,
  'no task rule fires while importing');
select tests.assert(current_setting('crm.importing', true) = 'off', 'the import flag is off after the batch');
select tests.assert(
  (select count(*) from public.external_refs where system = 'amocrm' and entity = 'deal') = 3,
  'the amoCRM ids are kept as external references');

-- Running the same file again changes nothing
select set_config('t.result', public.import_batch('deals', current_setting('t.rows')::jsonb)::text, true);
select tests.assert(
  (current_setting('t.result')::jsonb ->> 'created')::int = 0
  and (current_setting('t.result')::jsonb ->> 'updated')::int = 0
  and (current_setting('t.result')::jsonb ->> 'skipped')::int = 3,
  'a rerun skips every row: ' || current_setting('t.result'));
select tests.assert((select count(*) from public.patients) = 2, 'a rerun creates no patient');
select tests.assert((select count(*) from public.deals) = 3, 'a rerun creates no deal');
select tests.assert((select count(*) from public.deal_payments) = 1, 'a rerun adds no payment');

-- A changed file updates the deal: new stage (the checklist does not block
-- the import), more paid
select set_config('t.result', public.import_batch('deals', jsonb_build_array(
  jsonb_build_object('index', 2, 'system', 'amocrm',
    'patient', jsonb_build_object('first_name', 'Асель', 'phones', jsonb_build_array('87011112233'), 'city', 'Алматы'),
    'deal', jsonb_build_object('external_id', '1002', 'name', 'Гигиена', 'stage_id', tests.stage('Пришёл на консультацию'), 'paid_amount', 20000))
))::text, true);
select tests.assert(
  (current_setting('t.result')::jsonb ->> 'updated')::int = 1
  and (select stage_id = tests.stage('Пришёл на консультацию') and paid_amount = 20000 from public.deals where name = 'Гигиена')
  and (select city = 'Алматы' from public.patients where phones @> array['+77011112233']),
  'a changed row updates the deal and fills the patient: ' || current_setting('t.result'));
select tests.assert(
  (select count(*) from public.tasks) = 0,
  'entering a stage by import creates no task either');

-- Excel rows without ids: patients by phone, deals by patient and name
select set_config('t.excel', jsonb_build_array(
  jsonb_build_object('index', 2, 'system', 'excel',
    'patient', jsonb_build_object('first_name', 'Дана', 'phones', jsonb_build_array('+7 702 000 00 01')),
    'deal', jsonb_build_object('name', 'Терапия')),
  jsonb_build_object('index', 3, 'system', 'excel',
    'patient', jsonb_build_object('first_name', 'Дана', 'phones', jsonb_build_array('87020000001')),
    'deal', jsonb_build_object('name', 'терапия '))
)::text, true);
select set_config('t.result', public.import_batch('deals', current_setting('t.excel')::jsonb)::text, true);
select tests.assert(
  (current_setting('t.result')::jsonb ->> 'created')::int = 1 and (current_setting('t.result')::jsonb ->> 'skipped')::int = 1,
  'a repeated phone and deal name in one file is one patient and one deal: ' || current_setting('t.result'));
select set_config('t.result', public.import_batch('patients', jsonb_build_array(
  jsonb_build_object('index', 2, 'patient', jsonb_build_object('first_name', 'Без', 'last_name', 'Телефона')),
  jsonb_build_object('index', 3, 'patient', jsonb_build_object('first_name', 'Дана', 'phones', jsonb_build_array('+77020000001')))
))::text, true);
select tests.assert(
  (current_setting('t.result')::jsonb ->> 'created')::int = 1 and (current_setting('t.result')::jsonb ->> 'skipped')::int = 1,
  'patients only: a known phone is skipped: ' || current_setting('t.result'));
select public.import_batch('patients', jsonb_build_array(
  jsonb_build_object('index', 2, 'patient', jsonb_build_object('first_name', 'Без', 'last_name', 'Телефона'))));
select tests.assert(
  (select count(*) from public.patients where last_name = 'Телефона') = 1,
  'a patient without a phone is found again by name');
select tests.assert((select count(*) from public.tasks) = 0, 'still no task after all imports');
select tests.logout();

-- A deal created by hand after the import gets its rule tasks as usual
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.deals (patient_id, name) select id, 'ручная' from public.patients where first_name = 'Дана';
select tests.assert(
  (select count(*) from public.tasks t join public.deals d on d.id = t.deal_id where d.name = 'ручная') = 1,
  'task rules work again outside the import');
select tests.logout();

-- The head imports too
select tests.login_as(current_setting('t.head')::uuid);
select tests.assert(
  (public.import_batch('patients', jsonb_build_array(
    jsonb_build_object('index', 2, 'patient', jsonb_build_object('first_name', 'Руководитель', 'phones', jsonb_build_array('+77030000000'))))) ->> 'created')::int = 1,
  'the head can import');
select tests.logout();

-- Isolation: another clinic imports the same file into its own base
select set_config('t.first_stage', tests.stage('Записан')::text, true);
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.count('select * from public.external_refs') = 0, 'another clinic sees no external reference');
select tests.assert(tests.count('select * from public.patients') = 0, 'another clinic sees no imported patient');
select set_config('t.other_stage', (select s.id from public.stages s where s.name = 'Записан')::text, true);
select set_config('t.result', public.import_batch('deals', jsonb_build_array(
  jsonb_build_object('index', 2, 'system', 'amocrm',
    'patient', jsonb_build_object('first_name', 'Асель', 'phones', jsonb_build_array('87011112233')),
    'deal', jsonb_build_object('external_id', '1002', 'name', 'Гигиена', 'stage_id', current_setting('t.other_stage')::bigint))
))::text, true);
select tests.assert(
  (current_setting('t.result')::jsonb ->> 'created')::int = 1,
  'the same amoCRM id and phone are new in another clinic');
select set_config('t.result', public.import_batch('deals', jsonb_build_array(
  jsonb_build_object('index', 2, 'patient', jsonb_build_object('first_name', 'Чужой', 'phones', jsonb_build_array('87019999999')),
    'deal', jsonb_build_object('name', 'x', 'stage_id', current_setting('t.first_stage')::bigint))
))::text, true);
select tests.assert(
  jsonb_array_length(current_setting('t.result')::jsonb -> 'errors') = 1,
  'a stage of another clinic is refused');
select tests.throws(
  $q$insert into public.external_refs (organization_id, entity, entity_id, system, external_id)
     values (current_setting('t.org')::bigint, 'patient', 1, 'ident', 'x')$q$,
  '42501', 'no external reference can be written into another clinic');
select tests.assert(
  tests.affected($q$update public.external_refs set external_id = 'y' where organization_id = current_setting('t.org')::bigint$q$) = 0,
  'external references of another clinic cannot be changed');
select tests.logout();

select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert(
  (select count(*) from public.external_refs where system = 'amocrm' and entity = 'deal') = 3,
  'the clinic still has its own three amoCRM references');
select tests.logout();

-- External references follow deleted patients and deals
select tests.login_as(current_setting('t.owner')::uuid);
delete from public.deals where name = 'Брекеты';
select tests.assert(
  (select count(*) from public.external_refs where entity = 'deal' and external_id = '1003') = 0,
  'deleting a deal removes its external reference');
select tests.logout();

-- Integrations: secrets for the service role only, status and requests
select tests.login_as(current_setting('t.owner')::uuid);
select tests.throws($q$select * from public.integrations$q$, '42501', 'employees cannot read integration settings');
select tests.assert(public.request_integration('ident') = 'requested', 'the owner leaves a request for a MIS connector');
select tests.assert(
  (select count(*) from public.integration_status() where kind = 'ident' and status = 'requested') = 1,
  'the request is visible in the integration status');
select tests.logout();
select tests.login_as(current_setting('t.m1')::uuid);
select tests.throws($q$select public.request_integration('dentalpro')$q$, '42501', 'a manager cannot request a connector');
select tests.logout();
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.count('select * from public.integration_status()') = 0, 'another clinic does not see the request');
select tests.logout();

-- Imports meet auto-messages and the audit log: an active rule on «Новый лид»
-- sends nothing to imported deals, and their audit rows come from the import
update public.automessage_rules r set is_active = true
where r.organization_id = current_setting('t.org')::bigint
  and r.stage_id = tests.stage('Новый лид');
select tests.login_as(current_setting('t.owner')::uuid);
select public.import_batch('deals', jsonb_build_array(jsonb_build_object('index', 2, 'system', 'excel',
  'patient', jsonb_build_object('first_name', 'Мадина', 'phones', jsonb_build_array('+77015550000')),
  'deal', jsonb_build_object('external_id', 'x-1', 'name', 'Консультация', 'stage_id', tests.stage('Новый лид')))));
select tests.logout();
select tests.assert(
  (select count(*) from public.automessages a join public.deals d on d.id = a.deal_id
   where d.organization_id = current_setting('t.org')::bigint and d.name = 'Консультация') = 0,
  'an imported deal gets no auto-message');
select tests.assert(
  exists (select 1 from public.audit_log l join public.deals d on d.id = l.entity_id and l.entity = 'deal'
          where d.name = 'Консультация' and d.organization_id = current_setting('t.org')::bigint and l.source = 'import'),
  'the audit log shows the import as the source');
select tests.assert(
  current_setting('crm.audit_source', true) is null or current_setting('crm.audit_source', true) = '',
  'the import source does not leak to later statements');

select tests.assert(
  not exists (select 1 from public.notifications n join public.deals d on d.id = n.deal_id
              where d.name = 'Консультация' and d.organization_id = current_setting('t.org')::bigint),
  'an imported deal notifies nobody');

rollback;

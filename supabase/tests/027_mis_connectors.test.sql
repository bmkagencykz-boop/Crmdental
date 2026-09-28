--
-- MIS connectors (stage 27): Dentist Plus / MacDent connections, patient
-- matching, appointments that create or attach deals and move them by the
-- status mapping (checklist and closed deals respected), idempotent
-- payments, the outbound push without loops, rights, clinic isolation, and
-- the Sipuni PBX in the telephony module.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника Жемчуг')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.manager', tests.invite('admin@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);
select set_config('t.other_org', tests.org_of(current_setting('t.other')::uuid)::text, true);

create function tests.stage(stage_name text, org bigint default current_setting('t.org')::bigint) returns bigint language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
  where p.organization_id = org and p.is_default and s.name = stage_name
$$;
create function tests.deal_stage(target_deal bigint) returns text language sql as $$
  select s.name from public.deals d join public.stages s on s.id = d.stage_id where d.id = target_deal
$$;
-- A sync call of the edge functions (service role)
create function tests.mis(fn text, connection bigint, payload jsonb) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  execute format('select public.%I($1, $2)', fn) into result using connection, payload;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return result;
end;
$$;
create function tests.as_service(statement text) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  execute statement into result;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return result;
end;
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

insert into public.doctors (organization_id, name, specialty)
values (current_setting('t.org')::bigint, 'Иванов Иван Иванович', 'Хирург'),
       (current_setting('t.org')::bigint, 'Сейткали Дана', 'Ортодонт');
select set_config('t.ivanov', (select id from public.doctors where name = 'Иванов Иван Иванович')::text, true);
select set_config('t.booked', tests.stage('Записан')::text, true);
select set_config('t.seitkali', (select id from public.doctors where name = 'Сейткали Дана')::text, true);

--
-- Settings: owner and head connect, the key never comes back
--
select tests.login_as(current_setting('t.owner')::uuid);
select tests.throws($q$select public.save_mis_connection('dentist_plus', '{"base_url": "http://insecure.kz"}')$q$,
  '22023', 'the API address must be https');
select public.save_mis_connection('dentist_plus', '{"base_url": "https://api.dentist-plus.test/v1", "api_key": "dp-secret"}');
select tests.assert(
  (select (s ->> 'status') = 'connected' and (s ->> 'has_api_key')::boolean and not s ? 'api_key'
     and length(s ->> 'webhook_token') >= 32 and (s ->> 'push_appointments') = 'false'
     from public.mis_connection_status('dentist_plus') as s),
  'the owner connects Dentist Plus: connected, key stored and hidden, push off by default');
select tests.assert(
  (select (s -> 'status_map' -> 'scheduled' ->> 'stage_id')::bigint = tests.stage('Записан')
     and (s -> 'status_map' -> 'arrived' ->> 'stage_id')::bigint = tests.stage('Пришёл на консультацию')
     and (s -> 'status_map' -> 'in_treatment' ->> 'stage_id')::bigint = tests.stage('В лечении')
     and not (s -> 'status_map') ? 'cancelled'
     from public.mis_connection_status('dentist_plus') as s),
  'the default mapping points at the stages of the clinic template');
select tests.throws(
  format($q$select public.save_mis_connection('dentist_plus', '{"status_map": {"no_show": {"stage_id": %s}}}')$q$, tests.stage('Отказ')),
  '22023', 'a refusal stage cannot be mapped (a refusal needs a reason)');
select tests.throws($q$select public.save_mis_connection('dentist_plus', '{"status_map": {"lost_in_space": {}}}')$q$,
  '22023', 'unknown MIS statuses are refused');
select tests.throws($q$select public.save_mis_connection('ident', '{}')$q$, '22023', 'only the real connectors are configured');
select public.save_mis_connection('dentist_plus', '{"base_url": "https://api.dentist-plus.test/v1"}');
select tests.assert((select (s ->> 'has_api_key')::boolean from public.mis_connection_status('dentist_plus') as s),
  'saving without a key keeps the stored one');
select set_config('t.token', (select s ->> 'webhook_token' from public.mis_connection_status('dentist_plus') as s), true);
select tests.assert(public.regenerate_mis_token('dentist_plus') <> current_setting('t.token'), 'a new webhook address');
select tests.logout();

select set_config('t.conn', (select id from public.integrations
  where organization_id = current_setting('t.org')::bigint and kind = 'dentist_plus')::text, true);
select tests.assert(
  (select api_key = 'dp-secret' and base_url = 'https://api.dentist-plus.test/v1' from public.integrations where id = current_setting('t.conn')::bigint),
  'the key is stored for the edge functions');
select tests.assert(
  (select count(*) from public.audit_log where organization_id = current_setting('t.org')::bigint
     and entity = 'mis_connection' and not changes ? 'api_key') >= 1
  and not exists (select 1 from public.audit_log where entity = 'mis_connection' and changes::text like '%dp-secret%'),
  'the audit log shows the connection without its key');

select tests.login_as(current_setting('t.head')::uuid);
select tests.assert((select public.mis_connection_status('dentist_plus') is not null), 'the head sees the connection');
select tests.logout();

select tests.login_as(current_setting('t.manager')::uuid);
select tests.throws('select api_key from public.integrations', '42501', 'a manager cannot read the API key');
select tests.assert(public.mis_connection_status('dentist_plus') is null, 'a manager gets no connection settings');
select tests.assert(
  (select count(*) from public.integration_status() where kind = 'dentist_plus' and status = 'connected') = 1,
  'a manager sees that Dentist Plus is connected');
select tests.throws($q$select public.save_mis_connection('dentist_plus', '{"push_appointments": true}')$q$,
  '42501', 'a manager cannot edit the connection');
select tests.throws($q$select public.disconnect_mis('dentist_plus')$q$, '42501', 'a manager cannot disconnect');
select tests.throws($q$select public.regenerate_mis_token('dentist_plus')$q$, '42501', 'a manager cannot regenerate the token');
select tests.throws(format('select public.mis_upsert_patient(%s, ''{}'')', current_setting('t.conn')),
  '42501', 'employees cannot call the sync functions');
select tests.throws('select public.claim_mis_outbox()', '42501', 'employees cannot claim the push queue');
select tests.logout();

--
-- Patients: by MIS id, by phone, else created
--
insert into public.patients (organization_id, first_name, last_name, phone_jsonb)
values (current_setting('t.org')::bigint, 'Асель', null, '[{"number": "+77011112233", "type": "Mobile"}]');
select set_config('t.asel', (select id from public.patients where first_name = 'Асель' and organization_id = current_setting('t.org')::bigint)::text, true);

select set_config('t.r', tests.mis('mis_upsert_patient', current_setting('t.conn')::bigint,
  '{"external_id": "P1", "full_name": "Ахметова Асель Нурлановна", "phones": ["8 (701) 111-22-33"], "birth_date": "1990-05-04"}')::text, true);
select tests.assert(
  (current_setting('t.r')::jsonb ->> 'patient_id')::bigint = current_setting('t.asel')::bigint
  and current_setting('t.r')::jsonb ->> 'outcome' = 'updated',
  'a MIS patient is found by phone in any notation');
select tests.assert(
  (select last_name = 'Ахметова' and middle_name = 'Нурлановна' and first_name = 'Асель' and birth_date = '1990-05-04'
     from public.patients where id = current_setting('t.asel')::bigint),
  'the patient gets what it lacked, keeps its name');
select tests.assert(
  exists (select 1 from public.external_refs where organization_id = current_setting('t.org')::bigint
    and system = 'dentist_plus' and entity = 'patient' and external_id = 'P1' and entity_id = current_setting('t.asel')::bigint),
  'the MIS id of the patient is stored');

select set_config('t.r', tests.mis('mis_upsert_patient', current_setting('t.conn')::bigint,
  '{"external_id": "P1", "first_name": "Асель", "phone": "+7 701 999 88 77"}')::text, true);
select tests.assert(
  (current_setting('t.r')::jsonb ->> 'patient_id')::bigint = current_setting('t.asel')::bigint
  and (select phones @> array['+77011112233', '+77019998877'] from public.patients where id = current_setting('t.asel')::bigint),
  'the MIS id finds the patient again and a new phone is added');

select set_config('t.r', tests.mis('mis_upsert_patient', current_setting('t.conn')::bigint,
  '{"external_id": "P2", "first_name": "Ерлан", "last_name": "Жаксыбеков", "phones": ["+7 702 000 11 22"]}')::text, true);
select set_config('t.erlan', current_setting('t.r')::jsonb ->> 'patient_id', true);
select tests.assert(
  current_setting('t.r')::jsonb ->> 'outcome' = 'created'
  and (select s.code = 'mis' and s.name = 'МИС' from public.patients p join public.lead_sources s on s.id = p.source_id
       where p.id = current_setting('t.erlan')::bigint),
  'an unknown patient is created with the source «МИС»');
select set_config('t.r', tests.mis('mis_upsert_patient', current_setting('t.conn')::bigint, '{"first_name": "Без телефона"}')::text, true);
select tests.assert(current_setting('t.r')::jsonb ->> 'result' = 'error'
  and exists (select 1 from public.mis_sync_log where organization_id = current_setting('t.org')::bigint
    and operation = 'patient' and result = 'error'),
  'a patient without id and phone is refused and logged, not raised');

--
-- Appointments: a new deal, doctor and service mapped
--
select set_config('t.r', tests.mis('mis_upsert_appointment', current_setting('t.conn')::bigint,
  '{"external_id": "A1", "patient_external_id": "P2", "status": "scheduled", "status_label": "Записан",
    "starts_at": "2026-10-15T10:30:00+05:00", "doctor": {"external_id": "D1", "name": "Иванов  Иван Иванович"},
    "service": "имплантация"}')::text, true);
select set_config('t.deal_a1', current_setting('t.r')::jsonb ->> 'deal_id', true);
select tests.assert(
  current_setting('t.r')::jsonb ->> 'result' = 'ok' and (current_setting('t.r')::jsonb ->> 'created_deal')::boolean,
  'an appointment of a patient without open deal opens a deal');
select tests.assert(
  (select tests.deal_stage(d.id) = 'Записан' and d.appointment_at = '2026-10-15T10:30:00+05:00'
     and d.doctor_id = current_setting('t.ivanov')::bigint
     and d.service_id = (select id from public.services where organization_id = d.organization_id and name = 'Имплантация')
     and (select code from public.lead_sources where id = d.source_id) = 'mis'
     from public.deals d where d.id = current_setting('t.deal_a1')::bigint),
  'the new deal: stage of the mapping, appointment date, doctor matched by name, service, source «МИС»');
select tests.assert(
  exists (select 1 from public.mis_doctors where organization_id = current_setting('t.org')::bigint
    and external_id = 'D1' and doctor_id = current_setting('t.ivanov')::bigint)
  and exists (select 1 from public.external_refs where system = 'dentist_plus' and entity = 'doctor'
    and external_id = 'D1' and entity_id = current_setting('t.ivanov')::bigint)
  and exists (select 1 from public.external_refs where system = 'dentist_plus' and entity = 'appointment'
    and external_id = 'A1' and entity_id = current_setting('t.deal_a1')::bigint),
  'the doctor and the appointment are linked through external_refs');
select set_config('t.d1', (select id from public.mis_doctors where external_id = 'D1')::text, true);
select tests.assert(
  (select count(*) from public.audit_log where organization_id = current_setting('t.org')::bigint
     and deal_id = current_setting('t.deal_a1')::bigint and source = 'mis') >= 1,
  'the audit log shows the MIS as the source');

-- The same appointment, now the patient came: forward to «Пришёл»
select tests.mis('mis_upsert_appointment', current_setting('t.conn')::bigint,
  '{"external_id": "A1", "status": "arrived", "starts_at": "2026-10-15T10:30:00+05:00"}');
select tests.assert(
  (select tests.deal_stage(d.id) = 'Пришёл на консультацию' and d.visit_at = '2026-10-15T10:30:00+05:00'
     from public.deals d where d.id = current_setting('t.deal_a1')::bigint)
  and (select count(*) from public.deals where patient_id = current_setting('t.erlan')::bigint) = 1,
  'the status mapping moves the same deal forward and fills the visit');
select tests.assert(
  exists (select 1 from public.stage_trigger_runs where deal_id = current_setting('t.deal_a1')::bigint
    and trigger_id is null and trigger_name = 'МИС: Dentist Plus' and action = 'move_stage' and status = 'done'
    and (details ->> 'to_stage_id')::bigint = tests.stage('Пришёл на консультацию')),
  'the move is shown in the deal feed');
-- An older status never moves back
select tests.mis('mis_upsert_appointment', current_setting('t.conn')::bigint, '{"external_id": "A1", "status": "confirmed"}');
select tests.assert(tests.deal_stage(current_setting('t.deal_a1')::bigint) = 'Пришёл на консультацию'
  and exists (select 1 from public.mis_sync_log where deal_id = current_setting('t.deal_a1')::bigint
    and operation = 'stage' and result = 'skipped'),
  'a status behind the deal does not move it back');
select set_config('t.r', tests.mis('mis_upsert_appointment', current_setting('t.conn')::bigint,
  '{"external_id": "A1", "status": "lost_in_space"}')::text, true);
select tests.assert(current_setting('t.r')::jsonb ->> 'result' = 'error', 'an unknown status is an error of the record');

-- The patient's latest open deal gets the appointment
insert into public.deals (organization_id, patient_id, name, stage_id, pipeline_id)
values (current_setting('t.org')::bigint, current_setting('t.asel')::bigint, 'Брекеты',
  tests.stage('Новый лид'), (select pipeline_id from public.stages where id = tests.stage('Новый лид')));
select set_config('t.deal_asel', (select id from public.deals where name = 'Брекеты' and organization_id = current_setting('t.org')::bigint)::text, true);
select set_config('t.r', tests.mis('mis_upsert_appointment', current_setting('t.conn')::bigint,
  '{"external_id": "A2", "patient": {"external_id": "P1", "phone": "87011112233"}, "status": "scheduled",
    "starts_at": "2026-10-16 09:00:00+05", "doctor": {"name": "Сейткали Дана Маратовна"}}')::text, true);
select tests.assert(
  (current_setting('t.r')::jsonb ->> 'deal_id')::bigint = current_setting('t.deal_asel')::bigint
  and not (current_setting('t.r')::jsonb ->> 'created_deal')::boolean
  and tests.deal_stage(current_setting('t.deal_asel')::bigint) = 'Записан'
  and (select doctor_id from public.deals where id = current_setting('t.deal_asel')::bigint) = current_setting('t.seitkali')::bigint,
  'an appointment attaches to the open deal, moves it and maps the doctor by surname');

-- The stage checklist blocks the move: skipped and logged, the visit is kept
insert into public.stage_checklist_items (organization_id, stage_id, text)
values (current_setting('t.org')::bigint, tests.stage('Записан'), 'Подтвердить визит за день');
select set_config('t.r', tests.mis('mis_upsert_appointment', current_setting('t.conn')::bigint,
  '{"external_id": "A2", "status": "completed", "completed_at": "2026-10-16T10:00:00+05:00"}')::text, true);
select tests.assert(
  current_setting('t.r')::jsonb ->> 'result' = 'ok'
  and tests.deal_stage(current_setting('t.deal_asel')::bigint) = 'Записан'
  and (select visit_at = '2026-10-16T10:00:00+05:00' from public.deals where id = current_setting('t.deal_asel')::bigint),
  'a move blocked by the checklist is skipped, the visit date is still stored');
select tests.assert(
  exists (select 1 from public.stage_trigger_runs where deal_id = current_setting('t.deal_asel')::bigint
    and status = 'skipped' and error like 'Выполните чек-лист%')
  and exists (select 1 from public.mis_sync_log where deal_id = current_setting('t.deal_asel')::bigint
    and operation = 'stage' and result = 'skipped' and message like '%чек-лист%'),
  'the skipped move is in the deal feed and the sync log');
delete from public.stage_checklist_items where organization_id = current_setting('t.org')::bigint;

-- Visit completed with the treatment started
select set_config('t.r', tests.mis('mis_visit_completed', current_setting('t.conn')::bigint,
  '{"appointment_external_id": "A2", "treatment_started": true, "completed_at": "2026-10-16T11:00:00+05:00"}')::text, true);
select tests.assert(
  current_setting('t.r')::jsonb ->> 'result' = 'ok'
  and tests.deal_stage(current_setting('t.deal_asel')::bigint) = 'В лечении'
  and (select status = 'in_treatment' from public.mis_appointments where external_id = 'A2'),
  'a completed visit with treatment started moves the deal to «В лечении»');
select set_config('t.r', tests.mis('mis_visit_completed', current_setting('t.conn')::bigint,
  '{"appointment_external_id": "nope"}')::text, true);
select tests.assert(current_setting('t.r')::jsonb ->> 'result' = 'error', 'a visit of an unknown appointment is an error');

-- A cancelled appointment of a patient without deal opens nothing; a tag
insert into public.tags (organization_id, name, color) values (current_setting('t.org')::bigint, 'Отменил визит', '#eee');
select tests.login_as(current_setting('t.owner')::uuid);
select public.save_mis_connection('dentist_plus', jsonb_build_object('status_map',
  (select (s -> 'status_map') || jsonb_build_object('cancelled', jsonb_build_object('tag_id', t.id))
   from public.mis_connection_status('dentist_plus') s, public.tags t where t.name = 'Отменил визит' and t.organization_id = current_setting('t.org')::bigint)));
select tests.logout();
select set_config('t.r', tests.mis('mis_upsert_appointment', current_setting('t.conn')::bigint,
  '{"external_id": "A3", "patient": {"external_id": "P3", "full_name": "Нуржан Бекболат", "phone": "+77030000003"}, "status": "cancelled"}')::text, true);
select tests.assert(
  current_setting('t.r')::jsonb ->> 'deal_id' is null
  and exists (select 1 from public.mis_appointments where external_id = 'A3' and deal_id is null and status = 'cancelled'),
  'a cancelled appointment without deal is kept as a visit only');
select tests.mis('mis_upsert_appointment', current_setting('t.conn')::bigint,
  '{"external_id": "A2", "status": "cancelled"}');
select tests.assert(
  (select tags @> array[(select id from public.tags where name = 'Отменил визит' and organization_id = current_setting('t.org')::bigint)] from public.deals where id = current_setting('t.deal_asel')::bigint),
  'the mapping of «cancelled» adds its tag');

-- A closed deal is not moved
select set_config('t.lost_reason', (select id from public.lost_reasons where organization_id = current_setting('t.org')::bigint order by id limit 1)::text, true);
update public.deals set stage_id = tests.stage('Отказ'), lost_reason_id = current_setting('t.lost_reason')::bigint
where id = current_setting('t.deal_a1')::bigint;
select tests.mis('mis_upsert_appointment', current_setting('t.conn')::bigint, '{"external_id": "A1", "status": "in_treatment"}');
select tests.assert(tests.deal_stage(current_setting('t.deal_a1')::bigint) = 'Отказ'
  and exists (select 1 from public.stage_trigger_runs where deal_id = current_setting('t.deal_a1')::bigint
    and status = 'skipped' and error = 'Сделка закрыта'),
  'a refused deal stays refused, the skipped move is logged');

--
-- Payments: idempotent by MIS id
--
select set_config('t.r', tests.mis('mis_upsert_payment', current_setting('t.conn')::bigint,
  '{"external_id": "PAY1", "amount": "50000", "kind": "prepayment", "paid_at": "2026-10-16", "appointment_external_id": "A2"}')::text, true);
select tests.assert(
  current_setting('t.r')::jsonb ->> 'result' = 'ok'
  and (current_setting('t.r')::jsonb ->> 'deal_id')::bigint = current_setting('t.deal_asel')::bigint
  and (select paid_amount = 50000 from public.deals where id = current_setting('t.deal_asel')::bigint)
  and (select kind = 'prepayment' and paid_at = '2026-10-16' from public.deal_payments where deal_id = current_setting('t.deal_asel')::bigint),
  'a MIS payment is added to the deal of its appointment');
select set_config('t.r', tests.mis('mis_upsert_payment', current_setting('t.conn')::bigint,
  '{"external_id": "PAY1", "amount": 50000, "appointment_external_id": "A2"}')::text, true);
select tests.assert(
  current_setting('t.r')::jsonb ->> 'result' = 'skipped' and (current_setting('t.r')::jsonb ->> 'duplicate')::boolean
  and (select count(*) from public.deal_payments where deal_id = current_setting('t.deal_asel')::bigint) = 1
  and (select paid_amount = 50000 from public.deals where id = current_setting('t.deal_asel')::bigint),
  'the same payment twice is stored once');
select tests.mis('mis_upsert_payment', current_setting('t.conn')::bigint,
  '{"external_id": "PAY2", "amount": 120000.4, "patient_external_id": "P1", "paid_at": "2026-10-17T01:00:00+05:00"}');
select tests.assert(
  (select paid_amount = 170000 from public.deals where id = current_setting('t.deal_asel')::bigint)
  and exists (select 1 from public.deal_payments where amount = 120000 and paid_at = '2026-10-17' and kind = 'payment'),
  'a payment of a patient goes to their open deal, dated in the clinic''s time zone');
select set_config('t.r', tests.mis('mis_upsert_payment', current_setting('t.conn')::bigint,
  '{"external_id": "PAY3", "amount": 0, "patient_external_id": "P1"}')::text, true);
select tests.assert(current_setting('t.r')::jsonb ->> 'result' = 'error', 'a zero payment is refused');
select tests.assert(
  exists (select 1 from public.audit_log where organization_id = current_setting('t.org')::bigint
    and entity = 'payment' and source = 'mis'),
  'payments of the MIS are audited with the source «mis»');

-- Directions switched off
select tests.login_as(current_setting('t.owner')::uuid);
select public.save_mis_connection('dentist_plus', '{"sync_payments": false}');
select tests.logout();
select set_config('t.r', tests.mis('mis_upsert_payment', current_setting('t.conn')::bigint,
  '{"external_id": "PAY4", "amount": 1000, "patient_external_id": "P1"}')::text, true);
select tests.assert(current_setting('t.r')::jsonb ->> 'result' = 'skipped'
  and not exists (select 1 from public.external_refs where external_id = 'PAY4'),
  'payments are not taken when the direction is off');

--
-- Outbound push and loop prevention
--
select tests.login_as(current_setting('t.owner')::uuid);
select public.save_mis_connection('dentist_plus', '{"push_appointments": true, "sync_payments": true}');
select tests.logout();

-- Writes of the MIS are never queued back
select tests.mis('mis_upsert_appointment', current_setting('t.conn')::bigint,
  '{"external_id": "A4", "patient_external_id": "P2", "status": "scheduled", "starts_at": "2026-11-01T09:00:00+05:00"}');
select tests.assert((select count(*) from public.mis_outbox) = 0, 'an appointment from the MIS is not pushed back');

-- A deal booked in the CRM is queued once
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.patients (organization_id, first_name, phone_jsonb)
values (current_setting('t.org')::bigint, 'Мадина', '[{"number": "+77074445566"}]');
insert into public.deals (organization_id, patient_id, name, pipeline_id, stage_id)
select current_setting('t.org')::bigint, p.id, 'Гигиена', s.pipeline_id, s.id
from public.patients p, public.stages s
where p.first_name = 'Мадина' and p.organization_id = current_setting('t.org')::bigint and s.id = tests.stage('Новый лид');
select set_config('t.deal_crm', (select id from public.deals where name = 'Гигиена' and organization_id = current_setting('t.org')::bigint)::text, true);
update public.deals set appointment_at = '2026-11-02T15:00:00+05:00', doctor_id = current_setting('t.ivanov')::bigint
where id = current_setting('t.deal_crm')::bigint;
select tests.assert((select count(*) from public.mis_outbox) = 0, 'an appointment date alone at another stage is not pushed');
update public.deals set stage_id = tests.stage('Записан') where id = current_setting('t.deal_crm')::bigint;
update public.deals set description = 'Первичный' where id = current_setting('t.deal_crm')::bigint;
select tests.logout();
select tests.assert(
  (select count(*) from public.mis_outbox where deal_id = current_setting('t.deal_crm')::bigint and status = 'pending') = 1
  and (select payload -> 'appointment' ->> 'doctor_external_id' = 'D1'
            and payload -> 'patient' -> 'phones' ->> 0 = '+77074445566'
     from public.mis_outbox where deal_id = current_setting('t.deal_crm')::bigint),
  'a deal reaching «Записан» with a date is queued once, with the MIS id of its doctor');

select set_config('t.claimed', tests.as_service('select jsonb_agg(to_jsonb(c)) from public.claim_mis_outbox() c')::text, true);
select tests.assert(
  jsonb_array_length(current_setting('t.claimed')::jsonb) = 1
  and current_setting('t.claimed')::jsonb -> 0 ->> 'api_key' = 'dp-secret',
  'the dispatcher claims the row with the connection key');
select tests.assert(
  tests.as_service(format($q$select to_jsonb(public.complete_mis_outbox(%s, true, null, '{"patient_external_id": "P9", "appointment_external_id": "A9"}'))$q$,
    current_setting('t.claimed')::jsonb -> 0 ->> 'id')) #>> '{}' = 'done',
  'the push is completed');
select tests.assert(
  exists (select 1 from public.mis_appointments where external_id = 'A9' and deal_id = current_setting('t.deal_crm')::bigint
    and starts_at = '2026-11-02T15:00:00+05:00')
  and exists (select 1 from public.external_refs where system = 'dentist_plus' and entity = 'patient' and external_id = 'P9'),
  'the ids given by the MIS are stored');
-- The MIS echoes the appointment back: recognised, nothing queued again
select tests.mis('mis_upsert_appointment', current_setting('t.conn')::bigint,
  '{"external_id": "A9", "patient_external_id": "P9", "status": "confirmed", "starts_at": "2026-11-02T15:00:00+05:00"}');
select tests.assert(
  (select count(*) from public.mis_outbox) = 1
  and (select count(*) from public.deals where patient_id = (select patient_id from public.deals where id = current_setting('t.deal_crm')::bigint)) = 1,
  'the echo of a pushed appointment neither duplicates the deal nor loops');
-- A date the MIS already has is not pushed again
select tests.login_as(current_setting('t.owner')::uuid);
update public.deals set stage_id = tests.stage('Новый лид') where id = current_setting('t.deal_crm')::bigint;
update public.deals set stage_id = tests.stage('Записан') where id = current_setting('t.deal_crm')::bigint;
select tests.logout();
select tests.assert((select count(*) from public.mis_outbox) = 1, 'a date the MIS sent is not pushed back');

-- A failed push is retried, then the MIS is disconnected: the queue is cancelled
select tests.login_as(current_setting('t.owner')::uuid);
update public.deals set appointment_at = '2026-11-03T15:00:00+05:00' where id = current_setting('t.deal_crm')::bigint;
select tests.logout();
select set_config('t.claimed', tests.as_service('select jsonb_agg(to_jsonb(c)) from public.claim_mis_outbox() c')::text, true);
select tests.assert(
  tests.as_service(format($q$select to_jsonb(public.complete_mis_outbox(%s, false, 'HTTP 502'))$q$,
    current_setting('t.claimed')::jsonb -> 0 ->> 'id')) #>> '{}' = 'pending',
  'a failed push is retried later');
select tests.assert(
  exists (select 1 from public.mis_sync_log where direction = 'out' and result = 'error' and message like '%HTTP 502%')
  and (select attempts = 1 and next_attempt_at > now() from public.mis_outbox where status = 'pending'),
  'the failure is logged and the next attempt is later');
select tests.login_as(current_setting('t.manager')::uuid);
select tests.assert(tests.count('select * from public.mis_outbox') = 0, 'a manager does not see the push queue');
select tests.assert(tests.count('select * from public.mis_sync_log') = 0, 'a manager does not see the sync log');
select tests.assert(tests.count('select * from public.mis_doctors') = 0, 'a manager does not see the doctor mapping');
select tests.assert(tests.count('select * from public.mis_appointments') >= 3, 'a manager sees the visits of the deals');
select tests.throws(format('select public.link_mis_doctor(%s, null)', current_setting('t.d1')),
  '42501', 'a manager cannot change the doctor mapping');
select tests.logout();

-- Doctor mapping by hand
select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert(tests.count('select * from public.mis_sync_log') > 5, 'the owner reads the sync log');
select public.link_mis_doctor(current_setting('t.d1')::bigint, current_setting('t.seitkali')::bigint);
select tests.assert(
  (select doctor_id from public.mis_appointments where external_id = 'A1') = current_setting('t.seitkali')::bigint
  and (select entity_id from public.external_refs where system = 'dentist_plus' and entity = 'doctor' and external_id = 'D1') = current_setting('t.seitkali')::bigint,
  'the owner links a MIS doctor by hand, the visits follow');
select public.disconnect_mis('dentist_plus');
select tests.logout();
select tests.assert(
  (select count(*) from public.mis_outbox where status = 'pending') = 0
  and (select status = 'disabled' and api_key is null from public.integrations where id = current_setting('t.conn')::bigint),
  'disconnecting removes the key and cancels the queue');
select tests.throws(format($q$select tests.mis('mis_upsert_patient', %s, '{"external_id": "P5", "phone": "+77010000005"}')$q$, current_setting('t.conn')),
  '55000', 'a disconnected MIS takes nothing');

-- Sync status reported by the edge functions
select tests.login_as(current_setting('t.owner')::uuid);
select public.save_mis_connection('dentist_plus', '{"api_key": "dp-secret-2"}');
select tests.logout();
select tests.as_service(format($q$select to_jsonb(public.mis_record_sync(%s, 'poll', false, 'HTTP 401: неверный ключ'))$q$, current_setting('t.conn')));
select tests.assert(
  (select status = 'error' and last_error like 'HTTP 401%' from public.integrations where id = current_setting('t.conn')::bigint),
  'a failed poll puts the connection in error');
select tests.as_service(format($q$select to_jsonb(public.mis_record_sync(%s, 'poll', true, 'Получено: 3', '2026-10-20T00:00:00Z'))$q$, current_setting('t.conn')));
select tests.assert(
  (select status = 'connected' and last_error is null and last_sync_at is not null and sync_cursor = '2026-10-20T00:00:00Z'
   from public.integrations where id = current_setting('t.conn')::bigint),
  'a successful poll reconnects and moves the cursor');

--
-- Clinic isolation
--
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(public.mis_connection_status('dentist_plus') is null, 'another clinic does not see the connection');
select tests.assert(tests.count('select * from public.mis_appointments') = 0, 'another clinic sees no visits');
select tests.assert(tests.count('select * from public.mis_sync_log') = 0, 'another clinic sees no log');
select tests.assert(tests.count('select * from public.mis_doctors') = 0, 'another clinic sees no MIS doctors');
select tests.throws(
  format($q$select public.save_mis_connection('macdent', '{"status_map": {"scheduled": {"stage_id": %s}}}')$q$, current_setting('t.booked')),
  '22023', 'a stage of another clinic cannot be mapped');
select public.save_mis_connection('macdent', '{"api_key": "md-key"}');
select tests.throws(format('select public.link_mis_doctor(%s, null)', current_setting('t.d1')),
  'P0002', 'the doctors of another clinic cannot be linked');
select tests.logout();
select set_config('t.other_conn', (select id from public.integrations
  where organization_id = current_setting('t.other_org')::bigint and kind = 'macdent')::text, true);
select set_config('t.r', tests.mis('mis_upsert_appointment', current_setting('t.other_conn')::bigint,
  '{"external_id": "A1", "patient": {"external_id": "P2", "phone": "+7 702 000 11 22"}, "status": "scheduled", "starts_at": "2026-10-15T10:30:00+05:00"}')::text, true);
select tests.assert(
  (select organization_id from public.deals where id = (current_setting('t.r')::jsonb ->> 'deal_id')::bigint) = current_setting('t.other_org')::bigint
  and (current_setting('t.r')::jsonb ->> 'patient_id')::bigint <> current_setting('t.erlan')::bigint
  and tests.deal_stage((current_setting('t.r')::jsonb ->> 'deal_id')::bigint) = 'Записан',
  'the same ids and phone in another clinic give its own patient and deal');
select tests.assert(
  (select count(*) from public.mis_appointments where external_id = 'A1') = 2
  and (select deal_id from public.mis_appointments where external_id = 'A1' and organization_id = current_setting('t.org')::bigint)
      = current_setting('t.deal_a1')::bigint,
  'the first clinic keeps its appointment');

--
-- Sipuni in the telephony module
--
select tests.login_as(current_setting('t.owner')::uuid);
select public.save_telephony('sipuni');
select tests.assert((select provider = 'sipuni' from public.telephony_status()), 'Sipuni is a telephony provider');
select set_config('t.tel', (select webhook_token from public.telephony_status()), true);
select tests.logout();
update public.sales set phone_extension = '201' where user_id = current_setting('t.manager')::uuid;

create function tests.call(token text, provider text, call jsonb) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  execute 'set local role service_role';
  result := public.ingest_call(token, provider, call);
  execute 'reset role';
  return result;
end;
$$;
-- event 1 (start), 3 (answer), 2 (hangup) of one Sipuni call_id
select set_config('t.c1', tests.call(current_setting('t.tel'), 'sipuni',
  '{"call_id": "1760000000.101", "direction": "in", "phone": "77015550001", "extension": "201", "started_at": "2026-10-09T05:00:00.000Z", "status": null}')::text, true);
select tests.assert(
  (select status = 'in_progress' and provider = 'sipuni' and sales_id = (select id from public.sales where user_id = current_setting('t.manager')::uuid)
   from public.calls where id = (current_setting('t.c1')::jsonb ->> 'call_id')::bigint),
  'a Sipuni call start creates the call, the extension maps to the employee');
select tests.call(current_setting('t.tel'), 'sipuni', '{"call_id": "1760000000.101", "direction": "in", "phone": "77015550001", "extension": "201", "status": null}');
select tests.call(current_setting('t.tel'), 'sipuni',
  '{"call_id": "1760000000.101", "direction": "in", "phone": "77015550001", "extension": "201", "duration": 42, "status": "answered", "record_url": "https://sipuni.com/api/crm/record?id=1760000000.101"}');
select tests.assert(
  (select count(*) = 1 and bool_and(status = 'answered' and duration_seconds = 42 and recording_url like 'https://sipuni.com/%')
   from public.calls where provider = 'sipuni' and external_id = '1760000000.101'),
  'start, answer and hangup update one call with the recording');
select set_config('t.c2', tests.call(current_setting('t.tel'), 'sipuni',
  '{"call_id": "1760000000.202", "direction": "in", "phone": "+7 701 555 00 02", "status": "missed"}')::text, true);
select tests.assert(
  (current_setting('t.c2')::jsonb ->> 'created_task')::boolean
  and exists (select 1 from public.tasks where deal_id = (current_setting('t.c2')::jsonb ->> 'deal_id')::bigint and text = 'Перезвонить'),
  'a missed Sipuni call creates the call-back task');

rollback;

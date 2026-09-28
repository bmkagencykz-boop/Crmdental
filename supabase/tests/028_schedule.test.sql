--
-- Stage 28: the appointment schedule. Defaults of a clinic, chairs and
-- doctors' hours, overlap prevention (doctor, chair, exclusion constraints),
-- the deal linkage (appointment_at / visit_at, doctor, status → stage
-- mapping with the checklist-blocked skip, tag and tasks), the confirmation
-- replies («1», «2») with the salesbot precedence, the MIS mode (mirrored,
-- read-only visits), rights per role and clinic isolation.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника Жемчуг')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.owner_id', (select id from public.sales where email = 'owner@clinic.kz')::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m1_id', (select id from public.sales where email = 'm1@clinic.kz')::text, true);
select set_config('t.int', tests.invite('dev@agency.kz', current_setting('t.org')::bigint, 'integrator')::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);
select set_config('t.other_org', tests.org_of(current_setting('t.other')::uuid)::text, true);
select set_config('t.mis_owner', tests.sign_up('owner@mis.kz', 'Клиника с МИС')::text, true);
select set_config('t.mis_org', tests.org_of(current_setting('t.mis_owner')::uuid)::text, true);

create function tests.stage(stage_name text) returns bigint language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
  where p.organization_id = current_setting('t.org')::bigint and p.is_default and s.name = stage_name
$$;
create function tests.deal_stage(target_deal bigint) returns text language sql as $$
  select s.name from public.deals d join public.stages s on s.id = d.stage_id where d.id = target_deal
$$;
-- A deal of the test clinic in a stage, with its own patient
create function tests.new_deal(deal_name text, stage_name text default 'В работе', responsible bigint default null) returns bigint language plpgsql as $$
declare
  patient_id bigint;
  deal_id bigint;
begin
  insert into public.patients (organization_id, first_name) values (current_setting('t.org')::bigint, deal_name)
  returning id into patient_id;
  insert into public.deals (organization_id, patient_id, name, stage_id, pipeline_id, sales_id)
  select current_setting('t.org')::bigint, patient_id, deal_name, s.id, s.pipeline_id,
    coalesce(responsible, current_setting('t.owner_id')::bigint)
  from public.stages s where s.id = tests.stage(stage_name)
  returning id into deal_id;
  return deal_id;
end;
$$;
-- A moment N days from today at hh:mm (UTC)
create function tests.at(days integer, hhmm text) returns timestamptz language sql as $$
  select date_trunc('day', now()) + make_interval(days => days) + hhmm::interval
$$;
-- A visit of a deal (its patient) with a doctor and a chair; returns its id
create function tests.book(target_deal bigint, starts timestamptz, minutes integer, doctor bigint, chair bigint default null) returns bigint language plpgsql as $$
declare new_id bigint;
begin
  insert into public.visits (organization_id, patient_id, deal_id, doctor_id, chair_id, starts_at, ends_at)
  select d.organization_id, d.patient_id, d.id, doctor, chair, starts, starts + make_interval(mins => minutes)
  from public.deals d where d.id = target_deal
  returning id into new_id;
  return new_id;
end;
$$;
create function tests.message(target_deal bigint, message_text text) returns bigint language plpgsql as $$
declare new_id bigint;
begin
  insert into public.messages (organization_id, patient_id, deal_id, transport, chat_id, direction, status, text)
  select d.organization_id, d.patient_id, d.id, 'whatsapp', '77010000000', 'in', 'inbound', message_text
  from public.deals d where d.id = target_deal
  returning id into new_id;
  return new_id;
end;
$$;
create function tests.visit_status(target_visit bigint) returns text language sql as $$
  select status from public.visits where id = target_visit
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

--
-- Defaults of a new clinic
--
select tests.assert(
  (select (s.status_map -> 'scheduled' ->> 'stage_id')::bigint = tests.stage('Записан')
     and (s.status_map -> 'confirmed' ->> 'stage_id')::bigint = tests.stage('Записан')
     and (s.status_map -> 'arrived' ->> 'stage_id')::bigint = tests.stage('Пришёл на консультацию')
     and s.status_map -> 'no_show' ->> 'task' like 'Перезвонить%'
     and s.status_map -> 'cancelled' ->> 'task' = 'Перезаписать'
     and not (s.status_map -> 'cancelled') ? 'stage_id'
     and s.hours_start = '09:00' and s.hours_end = '21:00'
     and s.confirm_keywords @> array['1', 'да', 'подтверждаю'] and s.reschedule_keywords @> array['2', 'перенести']
   from public.schedule_settings s where s.organization_id = current_setting('t.org')::bigint),
  'a new clinic gets the schedule settings: mapping by stage names, clinic hours, keywords');
select tests.assert(
  (select s.status_map -> 'no_show' ->> 'tag' = 'Не пришёл'
   from public.schedule_settings s where s.organization_id = current_setting('t.org')::bigint)
  and not exists (select 1 from public.tags where organization_id = current_setting('t.org')::bigint),
  'no-show adds the tag «Не пришёл», created when first needed');
select tests.assert(
  (select count(*) from public.automessage_rules r
     join public.message_templates t on t.id = r.template_id
   where r.organization_id = current_setting('t.org')::bigint and t.name = 'Подтверждение записи'
     and r.stage_id = tests.stage('Записан') and r.timing = 'before_visit' and r.offset_minutes = 1440
     and not r.is_active and t.body like '%Ответьте 1 — подтверждаю, 2 — нужно перенести%') = 1,
  'the confirmation auto-message exists, 1 day before the visit, switched off');

--
-- Chairs and doctors' hours: configuration roles only
--
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.chairs (name, position) values ('Кресло 1', 0), ('Кресло 2', 1);
insert into public.doctors (name, specialty) values ('Иванов Иван', 'Хирург'), ('Сейткали Дана', 'Терапевт'), ('Омаров Ерлан', 'Ортопед');
select public.save_doctor_hours((select id from public.doctors where name = 'Иванов Иван'),
  '{"1": {"start": "09:00", "end": "18:00", "breaks": [{"start": "13:00", "end": "14:00"}]}, "3": {"start": "12:00", "end": "20:00"}}', 45);
select tests.assert(
  (select visit_minutes = 45 and working_hours -> '1' -> 'breaks' -> 0 ->> 'start' = '13:00' and not working_hours ? '2'
   from public.doctors where name = 'Иванов Иван'),
  'the owner saves the weekly hours and the default duration of a doctor');
select tests.throws($q$select public.save_doctor_hours((select id from public.doctors where name = 'Иванов Иван'), '{"8": {"start": "09:00", "end": "18:00"}}')$q$,
  '22023', 'weekdays are 1..7');
select tests.throws($q$select public.save_doctor_hours((select id from public.doctors where name = 'Иванов Иван'), '{"1": {"start": "18:00", "end": "09:00"}}')$q$,
  '22023', 'a day ends after it starts');
select tests.throws($q$select public.save_doctor_hours((select id from public.doctors where name = 'Иванов Иван'), '{"1": {"start": "09:00", "end": "12:00", "breaks": [{"start": "11:00", "end": "13:00"}]}}')$q$,
  '22023', 'a break stays inside the day');
insert into public.doctor_exceptions (doctor_id, day) select id, current_date + 10 from public.doctors where name = 'Иванов Иван';
select tests.throws($q$select public.save_schedule_settings(jsonb_build_object('status_map', jsonb_build_object('arrived', jsonb_build_object('stage_id', tests.stage('Отказ')))))$q$,
  '22023', 'a refusal stage cannot be mapped (a refusal needs a reason)');
select tests.throws($q$select public.save_schedule_settings('{"status_map": {"teleported": {}}}')$q$,
  '22023', 'unknown statuses are refused');
select tests.throws($q$select public.save_schedule_settings('{"hours_start": "20:00", "hours_end": "08:00"}')$q$,
  '22023', 'clinic hours end after they start');
select tests.assert(
  (select s ->> 'hours_start' = '08:30' and s -> 'confirm_keywords' ? 'ок' and s ->> 'mis_kind' is null
   from public.save_schedule_settings('{"hours_start": "08:30", "confirm_keywords": ["1", "да", "подтверждаю", "ок", " "]}') as s),
  'the owner saves clinic hours and keywords (blank words dropped)');
select tests.logout();

select set_config('t.ivanov', (select id from public.doctors where name = 'Иванов Иван')::text, true);
select set_config('t.seitkali', (select id from public.doctors where name = 'Сейткали Дана')::text, true);
-- The reply tests book relative to now(): a doctor of their own keeps them
-- clear of the fixed visits whatever the time of the run
select set_config('t.omarov', (select id from public.doctors where name = 'Омаров Ерлан')::text, true);
select set_config('t.chair1', (select id from public.chairs where name = 'Кресло 1')::text, true);
select set_config('t.chair2', (select id from public.chairs where name = 'Кресло 2')::text, true);

select tests.login_as(current_setting('t.m1')::uuid);
select tests.throws($q$insert into public.chairs (name) values ('Кресло 3')$q$, '42501', 'a manager cannot add chairs');
select tests.assert(tests.affected($q$update public.chairs set name = 'x'$q$) = 0, 'a manager cannot rename chairs');
select tests.throws(format('select public.save_doctor_hours(%s, ''{}'')', current_setting('t.ivanov')), '42501',
  'a manager cannot edit the hours');
select tests.throws($q$select public.save_schedule_settings('{"hours_start": "07:00"}')$q$, '42501',
  'a manager cannot edit the schedule settings');
select tests.throws($q$insert into public.doctor_exceptions (doctor_id, day) values (1, current_date)$q$, '42501',
  'a manager cannot add day exceptions');
select tests.assert(
  (select count(*) from public.chairs) = 2 and (public.get_schedule_settings() ->> 'hours_start') = '08:30',
  'a manager reads the chairs and the settings');
select tests.logout();

select tests.login_as(current_setting('t.int')::uuid);
insert into public.chairs (name, position) values ('Кресло 3', 2);
select public.save_schedule_settings('{"hours_end": "20:30"}');
select tests.assert(
  (select count(*) from public.chairs) = 3 and (public.get_schedule_settings() ->> 'hours_end') = '20:30',
  'the integrator configures chairs and hours');
select tests.logout();

--
-- Booking: the deal follows its visits
--
select set_config('t.d1', tests.new_deal('Асель')::text, true);
select tests.login_as(current_setting('t.owner')::uuid);
select set_config('t.v1', tests.book(current_setting('t.d1')::bigint, tests.at(3, '10:00'), 30,
  current_setting('t.ivanov')::bigint, current_setting('t.chair1')::bigint)::text, true);
select tests.assert(
  (select d.appointment_at = tests.at(3, '10:00') and d.doctor_id = current_setting('t.ivanov')::bigint
     and tests.deal_stage(d.id) = 'Записан'
   from public.deals d where d.id = current_setting('t.d1')::bigint),
  'booking a visit sets the appointment date, the doctor and moves the deal to «Записан»');
select tests.assert(
  (select v.created_by = current_setting('t.owner_id')::bigint and v.source = 'crm' and v.status = 'scheduled'
   from public.visits v where v.id = current_setting('t.v1')::bigint),
  'the visit keeps its author, source crm, status scheduled');
select tests.assert(
  (select count(*) from public.stage_trigger_runs r
   where r.deal_id = current_setting('t.d1')::bigint and r.trigger_name = 'Расписание' and r.action = 'move_stage'
     and r.status = 'done' and (r.details ->> 'to_stage_id')::bigint = tests.stage('Записан')) = 1,
  'the move is written to the deal feed');

-- Overlaps
select tests.throws(format($q$select tests.book(%s, tests.at(3, '10:15'), 30, %s)$q$,
    tests.new_deal('Берик'), current_setting('t.ivanov')),
  '23P01', 'the same doctor cannot have two visits at the same time');
select tests.throws(format($q$select tests.book(%s, tests.at(3, '09:45'), 30, %s, %s)$q$,
    tests.new_deal('Гульнар'), current_setting('t.seitkali'), current_setting('t.chair1')),
  '23P01', 'the same chair cannot have two visits at the same time');
select set_config('t.d2', tests.new_deal('Данияр', 'Записан')::text, true);
select set_config('t.v2', tests.book(current_setting('t.d2')::bigint, tests.at(3, '10:30'), 30,
  current_setting('t.ivanov')::bigint, current_setting('t.chair1')::bigint)::text, true);
select tests.assert(current_setting('t.v2')::bigint > 0, 'back-to-back visits are fine');
select tests.throws(format($q$update public.visits set starts_at = tests.at(3, '10:10'), ends_at = tests.at(3, '10:40') where id = %s$q$,
    current_setting('t.v2')),
  '23P01', 'moving a visit onto a busy doctor is refused');
select tests.logout();

-- The exclusion constraints hold without the friendly check (races)
set local session_replication_role = replica;
select tests.throws(format($q$insert into public.visits (organization_id, patient_id, doctor_id, starts_at, ends_at)
  select organization_id, patient_id, doctor_id, starts_at, ends_at from public.visits where id = %s$q$, current_setting('t.v1')),
  '23P01', 'the exclusion constraint refuses an overlapping doctor');
select tests.throws(format($q$insert into public.visits (organization_id, patient_id, chair_id, starts_at, ends_at)
  select organization_id, patient_id, chair_id, starts_at, ends_at from public.visits where id = %s$q$, current_setting('t.v1')),
  '23P01', 'the exclusion constraint refuses an overlapping chair');
set local session_replication_role = origin;

select tests.login_as(current_setting('t.owner')::uuid);
-- A cancelled visit frees the slot
select set_config('t.v3', tests.book(current_setting('t.d1')::bigint, tests.at(2, '09:00'), 30,
  current_setting('t.ivanov')::bigint)::text, true);
select tests.assert(
  (select appointment_at = tests.at(2, '09:00') from public.deals where id = current_setting('t.d1')::bigint),
  'the appointment date is the next visit of the deal');
update public.visits set status = 'cancelled' where id = current_setting('t.v3')::bigint;
select tests.assert(
  (select appointment_at = tests.at(3, '10:00') from public.deals where id = current_setting('t.d1')::bigint)
  and (select count(*) from public.tasks where deal_id = current_setting('t.d1')::bigint and text = 'Перезаписать' and done_date is null) = 1,
  'cancelling gives back the other visit date and creates the task «Перезаписать»');
select tests.assert(
  tests.book(tests.new_deal('Ерлан'), tests.at(2, '09:00'), 30, current_setting('t.ivanov')::bigint) > 0,
  'a cancelled visit does not hold its slot');
-- Dragging a visit to another time moves the appointment date
update public.visits set starts_at = tests.at(3, '11:00'), ends_at = tests.at(3, '11:30') where id = current_setting('t.v1')::bigint;
select tests.assert(
  (select appointment_at = tests.at(3, '11:00') from public.deals where id = current_setting('t.d1')::bigint),
  'moving the visit moves the appointment date');
select tests.throws(format($q$update public.visits set deal_id = %s where id = %s$q$, current_setting('t.d2'), current_setting('t.v1')),
  '23514', 'a visit cannot be linked to the deal of another patient');

-- «Пришёл»: next stage and the visit date
update public.visits set status = 'arrived' where id = current_setting('t.v1')::bigint;
select tests.assert(
  (select tests.deal_stage(d.id) = 'Пришёл на консультацию' and d.visit_at = tests.at(3, '11:00') and d.appointment_at is null
   from public.deals d where d.id = current_setting('t.d1')::bigint),
  '«Пришёл» moves the deal to «Пришёл на консультацию», sets the visit and frees the appointment');
-- A new scheduled visit does not bring the deal back
select set_config('t.v4', tests.book(current_setting('t.d1')::bigint, tests.at(9, '10:00'), 30,
  current_setting('t.ivanov')::bigint)::text, true);
select tests.assert(
  (select tests.deal_stage(d.id) = 'Пришёл на консультацию' and d.appointment_at = tests.at(9, '10:00')
   from public.deals d where d.id = current_setting('t.d1')::bigint),
  'the mapping only moves forward: a follow-up visit keeps the stage and sets the date');
delete from public.visits where id = current_setting('t.v4')::bigint;
select tests.assert(
  (select appointment_at is null from public.deals where id = current_setting('t.d1')::bigint),
  'deleting the visit frees its date');
select tests.logout();

-- Checklist: a blocked move is skipped and written to the feed
insert into public.stage_checklist_items (organization_id, stage_id, text)
values (current_setting('t.org')::bigint, tests.stage('Записан'), 'Отправить адрес клиники');
select tests.login_as(current_setting('t.owner')::uuid);
update public.visits set status = 'arrived' where id = current_setting('t.v2')::bigint;
select tests.assert(
  (select tests.deal_stage(d.id) = 'Записан' and d.visit_at = tests.at(3, '10:30')
   from public.deals d where d.id = current_setting('t.d2')::bigint),
  'the checklist blocks the move, the visit date is still set');
select tests.assert(
  (select count(*) from public.stage_trigger_runs r
   where r.deal_id = current_setting('t.d2')::bigint and r.trigger_name = 'Расписание' and r.status = 'skipped'
     and r.error like '%чек-лист%') = 1,
  'the skipped move is in the deal feed with its reason');

-- «Не пришёл»: tag and call-back task
select set_config('t.d3', tests.new_deal('Жанна', 'Записан')::text, true);
select set_config('t.v5', tests.book(current_setting('t.d3')::bigint, tests.at(4, '15:00'), 30,
  current_setting('t.seitkali')::bigint)::text, true);
update public.visits set status = 'no_show' where id = current_setting('t.v5')::bigint;
select set_config('t.no_show_tag', (select id from public.tags
  where organization_id = current_setting('t.org')::bigint and name = 'Не пришёл')::text, true);
select tests.assert(
  (select current_setting('t.no_show_tag')::bigint = any(d.tags) and tests.deal_stage(d.id) = 'Записан'
   from public.deals d where d.id = current_setting('t.d3')::bigint)
  and (select count(*) from public.tasks where deal_id = current_setting('t.d3')::bigint and text like 'Перезвонить%') = 1,
  '«Не пришёл» adds the tag and a call-back task');
-- Cancelled can go back to «В работе» when the clinic chooses it
select public.save_schedule_settings(jsonb_build_object('status_map',
  (select status_map from public.schedule_settings where organization_id = current_setting('t.org')::bigint)
  || jsonb_build_object('cancelled', jsonb_build_object('stage_id', tests.stage('В работе'), 'task', 'Перезаписать'))));
select set_config('t.v6', tests.book(current_setting('t.d3')::bigint, tests.at(5, '15:00'), 30,
  current_setting('t.seitkali')::bigint)::text, true);
update public.visits set status = 'cancelled' where id = current_setting('t.v6')::bigint;
select tests.assert(
  tests.deal_stage(current_setting('t.d3')::bigint) = 'В работе',
  'a cancelled visit moves the deal back to «В работе» when mapped');
select tests.logout();

select tests.assert(
  (select count(*) from public.audit_log a
   where a.organization_id = current_setting('t.org')::bigint and a.entity = 'visit' and a.deal_id = current_setting('t.d1')::bigint) >= 4,
  'visits are in the audit log');

--
-- Confirmation replies
--
select tests.assert(
  private.visit_reply_kind('1', array['1', 'да', 'подтверждаю'], array['2', 'перенести']) = 'confirm'
  and private.visit_reply_kind('Да, подтверждаю!', array['1', 'да', 'подтверждаю'], array['2', 'перенести']) = 'confirm'
  and private.visit_reply_kind('ДА', array['1', 'да'], array['2']) = 'confirm'
  and private.visit_reply_kind('2', array['1', 'да'], array['2', 'перенести']) = 'reschedule'
  and private.visit_reply_kind('Да, но нужно перенести', array['1', 'да'], array['2', 'перенести']) = 'reschedule'
  and private.visit_reply_kind('не подтверждаю', array['1', 'подтверждаю'], array['2']) is null
  and private.visit_reply_kind('приду в 12', array['1', 'да'], array['2']) is null
  and private.visit_reply_kind('дайте адрес', array['1', 'да'], array['2']) is null
  and private.visit_reply_kind('', array['1'], array['2']) is null,
  'the reply parser: numbers first, whole words, reschedule wins, «не» never confirms');

select set_config('t.d4', tests.new_deal('Карина', 'Записан')::text, true);
select set_config('t.v7', tests.book(current_setting('t.d4')::bigint, now() + interval '20 hours', 30,
  current_setting('t.omarov')::bigint)::text, true);
select tests.message(current_setting('t.d4')::bigint, 'Спасибо');
select tests.assert(tests.visit_status(current_setting('t.v7')::bigint) = 'scheduled', 'another reply changes nothing');
select tests.message(current_setting('t.d4')::bigint, '1');
select tests.assert(tests.visit_status(current_setting('t.v7')::bigint) = 'confirmed', 'a reply «1» confirms the visit');

select set_config('t.d5', tests.new_deal('Лаура', 'Записан', current_setting('t.m1_id')::bigint)::text, true);
select set_config('t.v8', tests.book(current_setting('t.d5')::bigint, now() + interval '30 hours', 30,
  current_setting('t.omarov')::bigint)::text, true);
select tests.message(current_setting('t.d5')::bigint, '2');
select tests.message(current_setting('t.d5')::bigint, 'Нужно перенести');
select tests.assert(
  tests.visit_status(current_setting('t.v8')::bigint) = 'scheduled'
  and (select count(*) from public.tasks t where t.deal_id = current_setting('t.d5')::bigint
         and t.text like 'Перенести запись%' and t.sales_id = current_setting('t.m1_id')::bigint and t.done_date is null) = 1
  and (select count(*) from public.notifications n where n.deal_id = current_setting('t.d5')::bigint
         and n.kind = 'visit_reschedule' and n.sales_id = current_setting('t.m1_id')::bigint) = 1,
  'a reply «2» creates one task «Перенести запись» and notifies the responsible');

select set_config('t.d6', tests.new_deal('Мадина', 'Записан')::text, true);
-- Well over 48 hours away, late in a day, so it never meets the fixed visits above
select set_config('t.v9', tests.book(current_setting('t.d6')::bigint, date_trunc('day', now()) + interval '5 days 21 hours', 30,
  current_setting('t.omarov')::bigint)::text, true);
select tests.message(current_setting('t.d6')::bigint, 'да');
select tests.assert(tests.visit_status(current_setting('t.v9')::bigint) = 'scheduled',
  'a visit more than 48 hours away is not confirmed');

-- A salesbot waiting on the deal handles the reply
select set_config('t.d7', tests.new_deal('Нурлан', 'Записан')::text, true);
select set_config('t.v10', tests.book(current_setting('t.d7')::bigint, now() + interval '5 hours', 30,
  current_setting('t.omarov')::bigint)::text, true);
insert into public.salesbot_sessions (organization_id, deal_id, bot_name, bot_version, scenario, current_step, state, status, trigger)
values (current_setting('t.org')::bigint, current_setting('t.d7')::bigint, 'Бот', 1,
  '{"start": "w", "steps": [{"id": "w", "type": "wait_reply", "timeout_minutes": 60}]}', 'w', '{"wait": "reply"}', 'waiting', 'manual');
select tests.message(current_setting('t.d7')::bigint, '1');
select tests.assert(tests.visit_status(current_setting('t.v10')::bigint) = 'scheduled',
  'with a salesbot waiting on the deal, the bot gets the reply, the visit is not confirmed');

--
-- Rights per role
--
update public.organization_settings set manager_deal_visibility = 'own'
where organization_id = current_setting('t.org')::bigint;
insert into public.patients (organization_id, first_name) values (current_setting('t.org')::bigint, 'Без сделки');
insert into public.visits (organization_id, patient_id, doctor_id, starts_at, ends_at)
select current_setting('t.org')::bigint, p.id, current_setting('t.seitkali')::bigint, tests.at(6, '09:00'), tests.at(6, '09:30')
from public.patients p where p.first_name = 'Без сделки';

select set_config('t.p1', (select patient_id from public.deals where id = current_setting('t.d1')::bigint)::text, true);
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(
  (select count(*) from public.visits where deal_id = current_setting('t.d1')::bigint) = 0
  and (select count(*) from public.visits where deal_id = current_setting('t.d5')::bigint) = 1
  and (select count(*) from public.visits where deal_id is null) = 1,
  'a manager sees the visits of their deals and those without a deal, not the others');
select tests.throws(format($q$insert into public.visits (patient_id, deal_id, starts_at, ends_at)
    values (%s, %s, tests.at(7, '09:00'), tests.at(7, '09:30'))$q$, current_setting('t.p1'), current_setting('t.d1')),
  '42501', 'a manager cannot book on a deal they do not see');
select tests.assert(
  tests.affected(format('update public.visits set note = ''x'' where id = %s', current_setting('t.v1'))) = 0,
  'a manager cannot edit the visit of a deal they do not see');
update public.visits set status = 'confirmed' where id = current_setting('t.v8')::bigint;
select tests.assert(
  (select status = 'confirmed' from public.visits where id = current_setting('t.v8')::bigint),
  'a manager marks the visit of their deal');
select tests.assert(
  tests.affected(format('delete from public.visits where id = %s', current_setting('t.v8'))) = 0,
  'a manager cannot delete visits');
select tests.assert(
  (select count(*) from public.schedule_busy(tests.at(3, '00:00'), tests.at(4, '00:00'))
   where starts_at = tests.at(3, '11:00') and doctor_id = current_setting('t.ivanov')::bigint) = 1,
  'the busy time of the hidden visits is known, without details');
select tests.logout();

select tests.login_as(current_setting('t.int')::uuid);
select tests.assert((select count(*) from public.visits) > 0, 'the integrator reads the visits');
select tests.throws(format($q$insert into public.visits (patient_id, deal_id, starts_at, ends_at)
    values (%s, %s, tests.at(8, '09:00'), tests.at(8, '09:30'))$q$, current_setting('t.p1'), current_setting('t.d1')),
  '42501', 'the integrator cannot book');
select tests.assert(
  tests.affected(format('update public.visits set note = ''x'' where id = %s', current_setting('t.v1'))) = 0,
  'the integrator cannot edit visits');
select tests.logout();

select tests.login_as(current_setting('t.head')::uuid);
select tests.assert(
  tests.affected(format('delete from public.visits where id = %s', current_setting('t.v8'))) = 1,
  'the head deletes a visit');
select tests.logout();

--
-- Clinic isolation
--
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(
  (select count(*) from public.visits) = 0 and (select count(*) from public.chairs) = 0
  and (select count(*) from public.schedule_settings) = 1,
  'another clinic sees none of the visits, chairs and settings');
select tests.throws(format($q$insert into public.visits (patient_id, starts_at, ends_at) values (%s, now(), now() + interval '30 minutes')$q$,
    current_setting('t.p1')),
  '23503', 'another clinic cannot book a patient of this clinic');
insert into public.patients (first_name) values ('Чужой');
select tests.throws(format($q$insert into public.visits (patient_id, chair_id, starts_at, ends_at)
    select id, %s, now(), now() + interval '30 minutes' from public.patients where first_name = 'Чужой'$q$, current_setting('t.chair1')),
  '23503', 'another clinic cannot use a chair of this clinic');
select tests.assert(
  tests.affected(format('update public.visits set note = ''x'' where id = %s', current_setting('t.v1'))) = 0,
  'another clinic cannot edit the visits');
select tests.logout();

--
-- MIS mode: visits come from the MIS and are read-only
--
select tests.login_as(current_setting('t.mis_owner')::uuid);
select public.save_mis_connection('dentist_plus', '{"base_url": "https://api.dentist-plus.test/v1", "api_key": "dp-secret"}');
select tests.assert(public.get_schedule_settings() ->> 'mis_kind' = 'dentist_plus', 'the settings tell the MIS mode');
insert into public.patients (first_name, phone_jsonb) values ('Айгерим', '[{"number": "+77015556677", "type": "Mobile"}]');
select tests.throws($q$insert into public.visits (patient_id, starts_at, ends_at)
    select id, now() + interval '1 day', now() + interval '1 day 30 minutes' from public.patients where first_name = 'Айгерим'$q$,
  '42501', 'no CRM visit is booked while the MIS keeps the schedule');
select tests.logout();

select set_config('t.conn', (select id from public.integrations
  where organization_id = current_setting('t.mis_org')::bigint and kind = 'dentist_plus')::text, true);
select tests.as_service(format($q$select public.mis_upsert_appointment(%s, '{"external_id": "A1", "status": "scheduled",
    "patient": {"external_id": "P1", "full_name": "Айгерим", "phones": ["87015556677"]},
    "starts_at": "2026-10-15T10:30:00+05:00", "service": "Имплантация", "comment": "Первичная"}')$q$, current_setting('t.conn')));
select tests.assert(
  (select v.source = 'mis' and v.external_id = 'dentist_plus:A1' and v.status = 'scheduled'
     and v.starts_at = '2026-10-15T10:30:00+05:00' and v.ends_at = '2026-10-15T11:00:00+05:00'
     and v.service_id is not null and v.deal_id is not null and v.note = 'Первичная'
   from public.visits v where v.organization_id = current_setting('t.mis_org')::bigint),
  'an MIS appointment is mirrored into the visits (service matched, 30 minutes by default)');
select tests.as_service(format($q$select public.mis_upsert_appointment(%s, '{"external_id": "A1", "status": "in_treatment",
    "starts_at": "2026-10-15T10:30:00+05:00", "ends_at": "2026-10-15T11:30:00+05:00"}')$q$, current_setting('t.conn')));
select tests.assert(
  (select v.status = 'completed' and v.ends_at = '2026-10-15T11:30:00+05:00'
   from public.visits v where v.organization_id = current_setting('t.mis_org')::bigint),
  'MIS updates follow (treatment started = completed visit)');
select tests.login_as(current_setting('t.mis_owner')::uuid);
select tests.throws($q$update public.visits set note = 'x'$q$, '42501', 'MIS visits are read-only');
select tests.throws($q$delete from public.visits$q$, '42501', 'MIS visits cannot be deleted in the CRM');
select tests.logout();
select tests.assert(
  (select count(*) from public.visits where organization_id = current_setting('t.mis_org')::bigint) = 1,
  'the MIS visit is still there');

-- Direct edits only: a merge moves the MIS visit, removing the clinic removes it
insert into public.patients (organization_id, first_name, last_name)
values (current_setting('t.mis_org')::bigint, 'Айгерим', 'Дубль');
select private.merge_patient_rows(current_setting('t.mis_org')::bigint,
  (select id from public.patients where organization_id = current_setting('t.mis_org')::bigint and last_name = 'Дубль'),
  (select patient_id from public.visits where organization_id = current_setting('t.mis_org')::bigint),
  '{}'::jsonb);
select tests.assert(
  (select p.last_name = 'Дубль' from public.visits v
     join public.patients p on p.organization_id = v.organization_id and p.id = v.patient_id
   where v.organization_id = current_setting('t.mis_org')::bigint),
  'merging patients moves the MIS visit to the kept patient');
delete from public.organizations where id = current_setting('t.mis_org')::bigint;
select tests.assert(
  (select count(*) from public.visits where organization_id = current_setting('t.mis_org')::bigint) = 0,
  'removing the clinic removes its MIS visits');

rollback;

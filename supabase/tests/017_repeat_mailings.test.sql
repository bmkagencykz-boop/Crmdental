--
-- Repeat sales and segment mailings (stage 17): recalls created once when
-- due, skipped or cancelled; segments; anti-ban limits of the dispatcher;
-- opt-out by keyword; rights and isolation.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника Жемчуг')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.owner_id', (select id from public.sales where email = 'owner@clinic.kz')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);
select set_config('t.other_org', tests.org_of(current_setting('t.other')::uuid)::text, true);

create function tests.stage(org bigint, stage_name text) returns bigint language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
  where p.organization_id = org and p.is_default and s.name = stage_name
$$;
create function tests.service(org bigint, service_name text) returns bigint language sql as $$
  select s.id from public.services s where s.organization_id = org and s.name = service_name
$$;
grant execute on function tests.stage(bigint, text) to authenticated;
grant execute on function tests.service(bigint, text) to authenticated;

-- Demo data of the seed must not interfere
update public.recall_rules set is_active = false;

--
-- Defaults
--
select tests.assert(
  (select count(*) from public.recall_rules r
   where r.organization_id = current_setting('t.org')::bigint
     and r.name = 'Профгигиена' and r.delay_months = 6 and r.service_id is null
     and not r.is_active and r.deal_service_id = tests.service(r.organization_id, 'Гигиена')
     and r.stage_id = tests.stage(r.organization_id, 'Новый лид')) = 1,
  'a new clinic gets the disabled rule «Профгигиена» every 6 months after any won deal');
select tests.assert(
  (select per_minute = 10 and per_day = 300 and work_start = '09:00' and work_end = '21:00'
   from public.mailing_settings where organization_id = current_setting('t.org')::bigint),
  'a new clinic gets the default limits');
select tests.assert(
  private.is_opt_out_text(' СТОП! ') and private.is_opt_out_text('Stop') and private.is_opt_out_text('Отписаться.')
  and not private.is_opt_out_text('стоп, я передумал') and not private.is_opt_out_text(null),
  'opt-out keywords: the whole message, any case');

--
-- Repeat sales
--
-- The owner switches the default rule on, with a "show first" message
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.message_templates (name, body) values ('Повтор', 'Здравствуйте, {имя}! Пора на {услуга}.');
update public.recall_rules set is_active = true,
  template_id = (select id from public.message_templates where name = 'Повтор');
-- Patients: Асель (won 6 months ago), Бота (won, but has an open deal),
-- Вика (won, opted out), Гуля (won 5 months ago: due in the next 30 days)
insert into public.patients (first_name, phone_jsonb) values
  ('Асель', '[{"number": "+7 701 000 00 01"}]'),
  ('Бота', '[{"number": "+7 701 000 00 02"}]'),
  ('Вика', '[{"number": "+7 701 000 00 03"}]'),
  ('Гуля', '[{"number": "+7 701 000 00 04"}]');
insert into public.deals (patient_id, name, service_id, sales_id)
select p.id, 'лечение ' || p.first_name, tests.service(current_setting('t.org')::bigint, 'Терапия'), current_setting('t.owner_id')::bigint
from public.patients p where p.first_name in ('Асель', 'Бота', 'Вика', 'Гуля');
update public.deals set stage_id = tests.stage(current_setting('t.org')::bigint, 'Лечение завершено')
where name like 'лечение %';
insert into public.deals (patient_id, name) select id, 'открытая Бота' from public.patients where first_name = 'Бота';
update public.patients set messaging_opt_out = true where first_name = 'Вика';
select tests.logout();
update public.deals set closed_at = now() - interval '6 months 1 day' where name in ('лечение Асель', 'лечение Бота', 'лечение Вика');
update public.deals set closed_at = now() - interval '5 months 20 days' where name = 'лечение Гуля';

select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert(
  (select jsonb_agg(u ->> 'deal_name') from jsonb_array_elements(public.report_recalls() -> 'upcoming') u)
    = '["лечение Гуля"]'::jsonb,
  'upcoming recalls: the ones due in the next 30 days');
select tests.logout();

select tests.assert(private.process_recalls() = 3, 'the daily job handles the three due recalls');
select tests.assert(private.process_recalls() = 0, 'a recall is handled once');

select tests.assert(
  (select count(*) from public.deals d
     join public.lead_sources s on s.id = d.source_id
     join public.patients p on p.id = d.patient_id
   where d.name = 'Повторный визит: Гигиена' and s.code = 'repeat' and s.is_system
     and s.name = 'Повторное обращение' and p.first_name = 'Асель'
     and d.sales_id = current_setting('t.owner_id')::bigint
     and d.stage_id = tests.stage(current_setting('t.org')::bigint, 'Новый лид')
     and d.service_id = tests.service(current_setting('t.org')::bigint, 'Гигиена')) = 1,
  'a recall deal is created: name, source «Повторное обращение», responsible, stage, service');
select tests.assert(
  (select x.status = 'created' and x.recall_deal_id is not null from public.recalls x
     join public.patients p on p.id = x.patient_id where p.first_name = 'Асель'),
  'the recall is logged as created');
select tests.assert(
  (select x.status = 'skipped' and x.reason = 'У пациента уже есть открытая сделка' and x.recall_deal_id is null
   from public.recalls x join public.patients p on p.id = x.patient_id where p.first_name = 'Бота'),
  'skipped when the patient has an open deal, with the reason');
select tests.assert(
  (select x.status = 'cancelled' and x.reason = 'Пациент отказался от сообщений'
   from public.recalls x join public.patients p on p.id = x.patient_id where p.first_name = 'Вика'),
  'cancelled when the patient opted out');
select tests.assert(
  (select count(*) from public.deals d join public.patients p on p.id = d.patient_id
   where p.first_name in ('Бота', 'Вика') and d.name like 'Повторный визит%') = 0,
  'no deal for a skipped or cancelled recall');
select tests.assert(
  (select a.status = 'awaiting' and a.text = 'Здравствуйте, Асель! Пора на Гигиена.'
     and t.type = 'message' and t.text = a.text and t.sales_id = current_setting('t.owner_id')::bigint
   from public.automessages a
     join public.tasks t on t.automessage_id = a.id
     join public.deals d on d.id = a.deal_id
   where d.name = 'Повторный визит: Гигиена'),
  '"show first": the stage 6 task with the text and the «Отправить» button');

-- A newer won deal of the same patient: the recall counts from it
update public.deals set closed_at = now() - interval '6 months 2 days' where name = 'лечение Гуля';
select tests.assert(private.process_recalls() = 1, 'Гуля is due now');
select tests.assert(
  (select count(*) from public.recalls x join public.patients p on p.id = x.patient_id where p.first_name = 'Гуля') = 1,
  'one recall per rule and won deal');

-- "auto" rules go through the mailing queue
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.recall_rules (name, service_id, delay_months, pipeline_id, stage_id, template_id, message_mode, is_active)
select 'Имплантация', tests.service(current_setting('t.org')::bigint, 'Имплантация'), 12, p.id,
  tests.stage(current_setting('t.org')::bigint, 'В работе'), (select id from public.message_templates where name = 'Повтор'), 'auto', true
from public.pipelines p where p.is_default;
insert into public.patients (first_name, phone_jsonb) values ('Дана', '[{"number": "+7 701 000 00 05"}]');
insert into public.deals (patient_id, name, service_id)
select id, 'импланты Дана', tests.service(current_setting('t.org')::bigint, 'Имплантация') from public.patients where first_name = 'Дана';
update public.deals set stage_id = tests.stage(current_setting('t.org')::bigint, 'Лечение завершено') where name = 'импланты Дана';
select tests.logout();
update public.deals set closed_at = now() - interval '12 months 1 day' where name = 'импланты Дана';
update public.recall_rules set is_active = false where name = 'Профгигиена';
select tests.assert(private.process_recalls() = 1, 'the implantation recall is due');
select tests.assert(
  (select mm.status = 'pending' and mm.recall_id is not null and d.name = 'Повторный визит: Имплантация'
     and mm.body = 'Здравствуйте, {имя}! Пора на {услуга}.'
   from public.mailing_messages mm join public.deals d on d.id = mm.deal_id
   join public.patients p on p.id = mm.patient_id where p.first_name = 'Дана'),
  '"auto": the message waits in the mailing queue, attached to the recall deal');

-- Reports of the repeat sales
select tests.login_as(current_setting('t.owner')::uuid);
update public.deals set stage_id = tests.stage(current_setting('t.org')::bigint, 'Лечение завершено')
where name = 'Повторный визит: Гигиена' and patient_id = (select id from public.patients where first_name = 'Асель');
select tests.assert(
  (public.report_recalls() -> 'totals') @> '{"created": 3, "skipped": 1, "cancelled": 1, "won": 1}'::jsonb,
  'totals: created, skipped, cancelled, won recall deals');
select tests.logout();

--
-- Segments (a third clinic with known patients)
--
select set_config('t.c_owner', tests.sign_up('owner@c.kz', 'Клиника С')::text, true);
select set_config('t.c_org', tests.org_of(current_setting('t.c_owner')::uuid)::text, true);
select set_config('t.c_m', tests.invite('m@c.kz', current_setting('t.c_org')::bigint, 'manager')::text, true);
select set_config('t.c_m_id', (select id from public.sales where email = 'm@c.kz')::text, true);

select tests.login_as(current_setting('t.c_owner')::uuid);
insert into public.tags (name, color) values ('VIP', '#FFCE87'), ('Дети', '#83A2DB');
select set_config('t.t1', (select id from public.tags where name = 'VIP')::text, true);
select set_config('t.t2', (select id from public.tags where name = 'Дети')::text, true);
-- P1: VIP+Дети, Instagram, won implantation 8 months ago; P2: VIP, open deal,
-- of the manager; P3: Дети, no phone; P4: VIP, opted out; P5: VIP, same
-- phone as P2, seen earlier (a duplicate)
insert into public.patients (first_name, last_name, phone_jsonb, tags, source_id) values
  ('P1', 'A', '[{"number": "+7 702 000 00 01"}]', array[current_setting('t.t1')::bigint, current_setting('t.t2')::bigint],
    (select id from public.lead_sources where code = 'instagram')),
  ('P2', 'B', '[{"number": "+7 702 000 00 02"}]', array[current_setting('t.t1')::bigint],
    (select id from public.lead_sources where code = 'whatsapp')),
  ('P3', 'C', '[]', array[current_setting('t.t2')::bigint], null),
  ('P4', 'D', '[{"number": "+7 702 000 00 04"}]', array[current_setting('t.t1')::bigint], null),
  ('P5', 'E', '[{"number": "+7 702 000 00 02"}]', array[current_setting('t.t1')::bigint], null);
update public.patients set messaging_opt_out = true where first_name = 'P4';
update public.patients set sales_id = current_setting('t.c_m_id')::bigint where first_name = 'P2';
insert into public.deals (patient_id, name, service_id)
select id, 'импланты P1', tests.service(current_setting('t.c_org')::bigint, 'Имплантация') from public.patients where first_name = 'P1';
update public.deals set stage_id = tests.stage(current_setting('t.c_org')::bigint, 'Лечение завершено') where name = 'импланты P1';
insert into public.deals (patient_id, name, service_id)
select id, 'терапия P2', tests.service(current_setting('t.c_org')::bigint, 'Терапия') from public.patients where first_name = 'P2';
select tests.logout();
update public.deals set closed_at = now() - interval '8 months' where name = 'импланты P1';
update public.patients set last_seen = now() - interval '1 day' where first_name = 'P5';

create function tests.segment(segment jsonb) returns jsonb language sql as $$
  select public.mailing_segment_preview(segment) - 'patients'
$$;
grant execute on function tests.segment(jsonb) to authenticated;

select tests.login_as(current_setting('t.c_owner')::uuid);
select tests.assert(
  tests.segment('{}') = '{"count": 2, "matched": 5, "opted_out": 1, "no_contact": 1, "duplicates": 1}'::jsonb,
  'all patients: opted out, without contact and duplicates are left out');
select tests.assert(
  (select jsonb_agg(p ->> 'first_name') from jsonb_array_elements(public.mailing_segment_preview('{}') -> 'patients') p)
    = '["P1", "P2"]'::jsonb,
  'the preview lists the recipients');
select tests.assert(
  (tests.segment(jsonb_build_object('tag_ids', jsonb_build_array(current_setting('t.t1')::bigint))) ->> 'count')::int = 2
  and (tests.segment(jsonb_build_object('tag_ids', jsonb_build_array(current_setting('t.t1')::bigint))) ->> 'matched')::int = 4,
  'tags, any: VIP');
select tests.assert(
  (tests.segment(jsonb_build_object('tag_ids', jsonb_build_array(current_setting('t.t1')::bigint, current_setting('t.t2')::bigint), 'tag_mode', 'all')) ->> 'matched')::int = 1
  and (tests.segment(jsonb_build_object('tag_ids', jsonb_build_array(current_setting('t.t1')::bigint, current_setting('t.t2')::bigint), 'tag_mode', 'any')) ->> 'matched')::int = 5,
  'tags, all vs any');
select tests.assert(
  (tests.segment(jsonb_build_object('service_ids', jsonb_build_array(tests.service(current_setting('t.c_org')::bigint, 'Имплантация')))) ->> 'count')::int = 1,
  'service of past deals');
select tests.assert(
  (tests.segment('{"inactive_months": 6}') ->> 'count')::int = 1
  and (tests.segment('{"inactive_months": 12}') ->> 'count')::int = 0,
  '«давно не был»: last won deal older than N months');
select tests.assert(
  (tests.segment(jsonb_build_object('source_ids', jsonb_build_array((select id from public.lead_sources where code = 'instagram')))) ->> 'count')::int = 1,
  'source');
select tests.assert(
  (tests.segment('{"has_open_deal": true}') ->> 'count')::int = 1
  and (tests.segment('{"has_open_deal": false}') ->> 'count')::int = 2,
  'has an open deal: yes / no');
select tests.assert(
  (tests.segment(jsonb_build_object('sales_ids', jsonb_build_array(current_setting('t.c_m_id')::bigint))) ->> 'count')::int = 1,
  'responsible');
select tests.logout();

--
-- Rights and isolation
--
select tests.login_as(current_setting('t.c_m')::uuid);
select tests.throws($q$insert into public.mailings (name, body) values ('x', 'y')$q$, '42501',
  'a manager cannot create mailings');
select tests.throws($q$select public.mailing_segment_preview('{}')$q$, '42501',
  'a manager cannot count segments');
select tests.throws($q$select public.report_recalls()$q$, '42501',
  'a manager cannot see the repeat sales');
select tests.throws($q$select * from public.claim_mailing_messages()$q$, '42501',
  'only the service role runs the dispatcher');
select tests.assert(tests.affected($q$update public.recall_rules set is_active = true$q$) = 0,
  'a manager cannot change recall rules');
select tests.assert(tests.affected($q$update public.mailing_settings set per_minute = 20$q$) = 0,
  'a manager cannot change the limits');
select tests.logout();

select tests.login_as(current_setting('t.head')::uuid);
select tests.throws($q$update public.mailing_settings set per_minute = 50$q$, '23514',
  'limits stay within safe bounds');
select tests.throws($q$update public.mailing_settings set work_end = '23:00'$q$, '23514',
  'working hours stay within safe bounds');
select tests.logout();

select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(
  tests.count($q$select * from public.recalls$q$) = 0
  and tests.count($q$select * from public.recall_rules where organization_id <> current_setting('t.other_org')::bigint$q$) = 0
  and tests.count($q$select * from public.mailing_messages$q$) = 0,
  'another clinic sees none of the recalls, rules or queue');
select tests.assert((tests.segment('{}') ->> 'matched')::int = 0, 'segments only count the own patients');
select tests.logout();

--
-- A mailing: queue, dispatcher limits, pause, cancel, opt-out
--
select tests.login_as(current_setting('t.c_owner')::uuid);
insert into public.mailings (name, segment, body)
values ('VIP', jsonb_build_object('tag_ids', jsonb_build_array(current_setting('t.t1')::bigint)), 'Здравствуйте, {имя}! Акция в {клиника}.');
select tests.assert(
  (select recipients_count = 2 and status = 'scheduled' and created_by is not null from public.mailings where name = 'VIP'),
  'the recipients of the segment are queued');
select tests.throws($q$update public.mailings set body = 'x'$q$, '42501',
  'the text cannot be changed after creation');
select tests.logout();

select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.count('select * from public.mailings') = 0, 'another clinic does not see the mailing');
select tests.logout();

select set_config('t.vip', (select id from public.mailings where name = 'VIP')::text, true);

-- Allowance: 10 per minute, working hours 9-21 (Asia/Almaty), per day
select tests.assert(
  private.mailing_allowance(current_setting('t.c_org')::bigint, '2026-03-12 10:00+05') = 10,
  'nothing sent yet: 10 per minute');
update public.mailing_messages set claimed_at = '2026-03-12 09:59:30+05'
where mailing_id = current_setting('t.vip')::bigint;
select tests.assert(
  private.mailing_allowance(current_setting('t.c_org')::bigint, '2026-03-12 10:00+05') = 8,
  'two sent in the last minute: 8 left');
select tests.assert(
  private.mailing_allowance(current_setting('t.c_org')::bigint, '2026-03-12 10:01+05') = 10,
  'a minute later: 10 again');
update public.mailing_settings set per_day = 3 where organization_id = current_setting('t.c_org')::bigint;
select tests.assert(
  private.mailing_allowance(current_setting('t.c_org')::bigint, '2026-03-12 15:00+05') = 1,
  'per day: 3 - 2 = 1 left');
select tests.assert(
  private.mailing_allowance(current_setting('t.c_org')::bigint, '2026-03-13 10:00+05') = 3,
  'the next day starts again');
select tests.assert(
  private.mailing_allowance(current_setting('t.c_org')::bigint, '2026-03-12 21:00+05') = 0
  and private.mailing_allowance(current_setting('t.c_org')::bigint, '2026-03-12 08:59+05') = 0,
  'nothing outside the working hours');
update public.mailing_messages set claimed_at = null where mailing_id = current_setting('t.vip')::bigint;
update public.mailing_settings set per_day = 300, per_minute = 1 where organization_id = current_setting('t.c_org')::bigint;

-- The dispatcher: noon in the clinic (time zone chosen from the current time)
update public.organizations
set timezone = (select case when off >= 0 then 'Etc/GMT-' || off else 'Etc/GMT+' || -off end
                from (select 12 - extract(hour from now() at time zone 'UTC')::int as off) o)
where id = current_setting('t.c_org')::bigint;
-- (the other clinics have no messenger: their rows wait)
set local role service_role;
select tests.assert(tests.count('select * from public.claim_mailing_messages()') = 0,
  'without a messenger nothing is taken');
reset role;
insert into public.messenger_integrations (organization_id, api_key) values (current_setting('t.c_org')::bigint, 'key');
set local role service_role;
create temp table claimed on commit drop as select * from public.claim_mailing_messages(10);
reset role;
select tests.assert((select count(*) from claimed) = 1, 'per minute: one message (per_minute = 1)');
select tests.assert(
  (select c.message_text = 'Здравствуйте, P1! Акция в Клиника С.' and d.name = 'импланты P1'
   from claimed c join public.deals d on d.id = c.deal_id),
  'rendered, attached to the latest deal (no open deal)');
set local role service_role;
select tests.assert(tests.count('select * from public.claim_mailing_messages(10)') = 0,
  'the minute is used up');
reset role;
update public.mailing_messages set claimed_at = now() - interval '2 minutes' where status = 'sending';

-- Pause, resume
select tests.login_as(current_setting('t.c_owner')::uuid);
update public.mailings set status = 'paused' where id = current_setting('t.vip')::bigint;
select tests.logout();
set local role service_role;
select tests.assert(tests.count('select * from public.claim_mailing_messages(10)') = 0, 'a paused mailing waits');
reset role;
select tests.login_as(current_setting('t.c_owner')::uuid);
update public.mailings set status = 'scheduled' where id = current_setting('t.vip')::bigint;
select tests.throws($q$update public.mailings set status = 'done'$q$, '23514', 'only the system finishes a mailing');
select tests.logout();

-- Outside the working hours nothing is taken
update public.organizations
set timezone = (select case when off >= 0 then 'Etc/GMT-' || off else 'Etc/GMT+' || -off end
                from (select 3 - extract(hour from now() at time zone 'UTC')::int as off) o)
where id = current_setting('t.c_org')::bigint;
set local role service_role;
select tests.assert(tests.count('select * from public.claim_mailing_messages(10)') = 0, 'not at 3 at night');
reset role;
update public.organizations
set timezone = (select case when off >= 0 then 'Etc/GMT-' || off else 'Etc/GMT+' || -off end
                from (select 12 - extract(hour from now() at time zone 'UTC')::int as off) o)
where id = current_setting('t.c_org')::bigint;
set local role service_role;
create temp table claimed2 on commit drop as select * from public.claim_mailing_messages(10);
reset role;
select tests.assert(
  (select d.name = 'терапия P2' from claimed2 c join public.deals d on d.id = c.deal_id),
  'the second recipient: attached to the open deal');

-- Sent messages: the rows are sent, the open deal gets no first answer
insert into public.messages (organization_id, patient_id, deal_id, transport, chat_id, direction, text, external_id, mailing_message_id)
select c.organization_id, c.patient_id, c.deal_id, 'whatsapp', '7702', 'out', c.message_text, 'ext-' || c.id, c.id
from (select * from claimed union all select * from claimed2) c;
select tests.assert(
  (select count(*) from public.mailing_messages where mailing_id = current_setting('t.vip')::bigint and status = 'sent' and message_id is not null) = 2,
  'stored messages mark the rows sent');
select tests.assert(
  (select first_response_at is null from public.deals where name = 'терапия P2'),
  'a mailing message is not the first answer of the clinic');
update public.messages set status = 'read' where external_id = 'ext-' || (select id from claimed2);
select tests.login_as(current_setting('t.c_owner')::uuid);
select tests.assert(
  (select sent_count = 2 and read_count = 1 and delivered_count = 1 and queued_count = 0
   from public.mailings_summary where id = current_setting('t.vip')::bigint),
  'progress counts from the message statuses');
select tests.logout();
set local role service_role;
select tests.assert(tests.count('select * from public.claim_mailing_messages(10)') = 0, 'nothing left');
reset role;
select tests.assert((select status = 'done' from public.mailings where id = current_setting('t.vip')::bigint),
  'a mailing with nothing left is done');

-- Opt-out by an incoming «стоп»: pending rows cancelled, left out of segments
select tests.login_as(current_setting('t.c_owner')::uuid);
insert into public.mailings (name, segment, body, scheduled_at)
values ('Завтра', '{}', 'Привет, {имя}', now() + interval '1 day');
select tests.assert((select recipients_count from public.mailings where name = 'Завтра') = 2, 'P1 and P2 queued');
select tests.logout();
select public.ingest_message(
  (select webhook_token from public.messenger_integrations where organization_id = current_setting('t.c_org')::bigint),
  '{"transport": "whatsapp", "chat_id": "77020000001", "direction": "in", "text": " Стоп! ", "external_id": "in-stop"}');
select tests.assert(
  (select messaging_opt_out and messaging_opt_out_at is not null from public.patients where first_name = 'P1'),
  'an incoming «Стоп!» opts the patient out');
select tests.assert(
  (select mm.status = 'cancelled' from public.mailing_messages mm
     join public.mailings ml on ml.id = mm.mailing_id join public.patients p on p.id = mm.patient_id
   where ml.name = 'Завтра' and p.first_name = 'P1'),
  'the waiting mailing message of the patient is cancelled');
select public.ingest_message(
  (select webhook_token from public.messenger_integrations where organization_id = current_setting('t.c_org')::bigint),
  '{"transport": "whatsapp", "chat_id": "77020000002", "direction": "in", "text": "стоп, а цена?", "external_id": "in-2"}');
select tests.assert(
  (select not messaging_opt_out from public.patients where first_name = 'P2'),
  'a message that only contains the word does not opt out');
select tests.login_as(current_setting('t.c_owner')::uuid);
select tests.assert(tests.segment('{}') @> '{"count": 1, "opted_out": 2}'::jsonb, 'opted-out patients are left out');
-- Cancel
update public.mailings set status = 'cancelled' where name = 'Завтра';
select tests.assert(
  (select count(*) from public.mailing_messages mm join public.mailings ml on ml.id = mm.mailing_id
   where ml.name = 'Завтра' and mm.status = 'cancelled') = 2
  and (select finished_at is not null from public.mailings where name = 'Завтра'),
  'cancelling a mailing cancels its waiting messages');
select tests.throws($q$update public.mailings set status = 'scheduled' where name = 'Завтра'$q$, '23514',
  'a cancelled mailing stays cancelled');
select tests.logout();

-- A refusal «Не беспокоить» opts out
select tests.login_as(current_setting('t.c_owner')::uuid);
insert into public.lost_reasons (name) values ('Не беспокоить');
update public.deals set stage_id = tests.stage(current_setting('t.c_org')::bigint, 'Отказ'),
  lost_reason_id = (select id from public.lost_reasons where name = 'Не беспокоить')
where name = 'терапия P2';
select tests.assert((select messaging_opt_out from public.patients where first_name = 'P2'),
  'a refusal «Не беспокоить» opts the patient out');
-- The toggle of the patient card
update public.patients set messaging_opt_out = false where first_name = 'P2';
select tests.assert((select not messaging_opt_out and messaging_opt_out_at is null from public.patients where first_name = 'P2'),
  'an employee can switch the opt-out off');
select tests.logout();

-- A recall message of an opted-out patient is not sent
select tests.assert(
  (select count(*) from public.automessages a join public.deals d on d.id = a.deal_id
   where d.name = 'Повторный визит: Гигиена' and a.status = 'sent') = 0, 'not sent yet');
update public.patients set messaging_opt_out = true where first_name = 'Дана';
select tests.assert(
  (select mm.status = 'cancelled' from public.mailing_messages mm join public.patients p on p.id = mm.patient_id
   where p.first_name = 'Дана'),
  'opting out cancels the waiting recall message');

rollback;

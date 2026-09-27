--
-- Employee notifications and response-time control (stage 16): who gets
-- lead_assigned / patient_message / task_overdue / response_overdue (and not
-- the author of the change), coalescing, working minutes, waiting episodes,
-- rights, clinic isolation and the Telegram link flow.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@notify.kz', 'Клиника Улыбка')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.head', tests.invite('head@notify.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@notify.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m2', tests.invite('m2@notify.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.other', tests.sign_up('owner@other-notify.kz', 'Другая клиника')::text, true);
select set_config('t.other_org', tests.org_of(current_setting('t.other')::uuid)::text, true);

create function tests.sid(email text) returns bigint language sql as $$
  select id from public.sales where sales.email = sid.email
$$;
select set_config('t.owner_id', tests.sid('owner@notify.kz')::text, true);
select set_config('t.head_id', tests.sid('head@notify.kz')::text, true);
select set_config('t.m1_id', tests.sid('m1@notify.kz')::text, true);
select set_config('t.m2_id', tests.sid('m2@notify.kz')::text, true);

-- Notifications of an employee, of a kind (and of a deal)
create function tests.notes(recipient bigint, notification_kind text, target_deal_id bigint default null)
returns bigint language sql as $$
  select count(*) from public.notifications n
  where n.sales_id = recipient and n.kind = notification_kind
    and (target_deal_id is null or n.deal_id = target_deal_id)
$$;

-- Everything in a test shares now(): move what happened so far 10 minutes
-- back (out of the coalescing window, no longer "this transaction")
create function tests.age() returns void language sql as $$
  update public.notifications set created_at = created_at - interval '10 minutes',
    updated_at = updated_at - interval '10 minutes';
  update public.messages set created_at = created_at - interval '10 minutes';
$$;

create function tests.inbound(token text, chat text, body text, sent timestamptz default now())
returns bigint language sql as $$
  select (public.ingest_message(token, jsonb_build_object(
    'channel_id', 'wa-1', 'transport', 'whatsapp', 'chat_id', chat, 'direction', 'in',
    'text', body, 'external_id', gen_random_uuid()::text, 'sent_at', sent,
    'contact', jsonb_build_object('name', 'Пациент ' || chat))) ->> 'deal_id')::bigint
$$;

-- An answer sent by an employee through Wazzup24 (what messenger_send stores)
create function tests.answer(target_deal_id bigint, author bigint, sent timestamptz default now())
returns void language sql as $$
  insert into public.messages (organization_id, patient_id, deal_id, transport, chat_id, direction, sales_id, text, status, sent_at)
  select d.organization_id, d.patient_id, d.id, 'whatsapp', 'x', 'out', author, 'Ответ', 'sent', sent
  from public.deals d where d.id = target_deal_id
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

insert into public.messenger_integrations (organization_id, api_key, webhook_token)
values (current_setting('t.org')::bigint, 'key', 'tok-notify'),
       (current_setting('t.other_org')::bigint, 'key', 'tok-other');
-- Seed data and the default task rules are out of the way
delete from public.notifications;
update public.task_rules set is_active = false where organization_id in (current_setting('t.org')::bigint, current_setting('t.other_org')::bigint);

--
-- Working minutes (Asia/Tashkent = UTC+5, working hours 9:00-21:00)
--
select tests.assert(
  private.working_minutes('2026-03-12 04:00+00', '2026-03-12 04:23+00', 'Asia/Tashkent', 9, 21) = 23,
  '9:00-9:23 local: 23 working minutes');
select tests.assert(
  private.working_minutes('2026-03-12 15:50+00', '2026-03-13 04:10+00', 'Asia/Tashkent', 9, 21) = 20,
  '20:50 to 9:10 next day: 10 + 10 minutes, the night does not count');
select tests.assert(
  private.working_minutes('2026-03-12 02:00+00', '2026-03-12 03:00+00', 'Asia/Tashkent', 9, 21) = 0,
  '7:00-8:00 local is outside the working hours');
select tests.assert(
  private.working_minutes('2026-03-12 04:00+00', '2026-03-14 04:00+00', 'Asia/Tashkent', 9, 21) = 1440,
  'two days: twice 12 working hours');
select tests.assert(
  private.working_minutes('2026-03-12 22:00+00', '2026-03-13 00:30+00', 'Asia/Tashkent', 0, 24) = 150,
  'round the clock: plain minutes, across midnight');
select tests.assert(
  private.working_minutes('2026-03-12 05:00+00', '2026-03-12 04:00+00', 'Asia/Tashkent', 9, 21) = 0,
  'no time went by');
select tests.assert(
  private.working_minutes('2026-03-12 05:00+00', '2026-03-12 05:30+00', null, 0, 24) = 30,
  'no time zone: the default one');

--
-- lead_assigned
--
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.patients (first_name, last_name) values ('Асель', 'Иванова');
insert into public.deals (patient_id, name, sales_id)
select id, 'Имплант', current_setting('t.m1_id')::bigint from public.patients where first_name = 'Асель';
select set_config('t.deal1', (select id from public.deals where name = 'Имплант')::text, true);
select tests.logout();
select tests.assert(tests.notes(current_setting('t.m1_id')::bigint, 'lead_assigned', current_setting('t.deal1')::bigint) = 1,
  'a deal created by the owner for m1 notifies m1');
select tests.assert(
  (select title = 'Вам передали сделку' and body = 'Иванова Асель · Имплант · от owner Test'
   from public.notifications where sales_id = current_setting('t.m1_id')::bigint and kind = 'lead_assigned'),
  'the notification names the deal and who assigned it');
select tests.assert(tests.notes(current_setting('t.owner_id')::bigint, 'lead_assigned') = 0,
  'the owner is not notified of their own action');

select tests.login_as(current_setting('t.m1')::uuid);
insert into public.patients (first_name) values ('Свой');
insert into public.deals (patient_id, name) select id, 'Свой лид' from public.patients where first_name = 'Свой';
select tests.logout();
select tests.assert(tests.notes(current_setting('t.m1_id')::bigint, 'lead_assigned') = 1,
  'a deal an employee creates for themselves notifies nobody');

select tests.login_as(current_setting('t.owner')::uuid);
update public.deals set sales_id = current_setting('t.m2_id')::bigint where id = current_setting('t.deal1')::bigint;
select tests.logout();
select tests.assert(tests.notes(current_setting('t.m2_id')::bigint, 'lead_assigned', current_setting('t.deal1')::bigint) = 1
  and tests.notes(current_setting('t.m1_id')::bigint, 'lead_assigned') = 1,
  'reassigning notifies the new responsible only');

select tests.login_as(current_setting('t.m1')::uuid);
update public.deals set sales_id = current_setting('t.m1_id')::bigint where id = current_setting('t.deal1')::bigint;
select tests.logout();
select tests.assert(tests.notes(current_setting('t.m1_id')::bigint, 'lead_assigned') = 1,
  'taking a deal yourself notifies nobody');
update public.deals set sales_id = current_setting('t.m2_id')::bigint where id = current_setting('t.deal1')::bigint;
update public.deals set sales_id = current_setting('t.m2_id')::bigint, name = 'Имплант' where id = current_setting('t.deal1')::bigint;
select tests.assert(tests.notes(current_setting('t.m2_id')::bigint, 'lead_assigned', current_setting('t.deal1')::bigint) = 2,
  'the system assigning notifies once, an update keeping the responsible does not');
select tests.age();

-- Round robin: the new lead notifies its responsible once ("Новое обращение"),
-- the first message of the patient does not add a second notification
update public.organization_settings
set lead_distribution = 'round_robin', lead_distribution_sales_ids = array[current_setting('t.m1_id')::bigint]
where organization_id = current_setting('t.org')::bigint;
select set_config('t.rr', tests.inbound('tok-notify', '77010000001', 'Здравствуйте')::text, true);
select tests.assert(
  (select sales_id from public.deals where id = current_setting('t.rr')::bigint) = current_setting('t.m1_id')::bigint,
  'round robin gave the lead to m1');
select tests.assert(
  (select count(*) from public.notifications where deal_id = current_setting('t.rr')::bigint) = 1
  and (select title from public.notifications where deal_id = current_setting('t.rr')::bigint) = 'Новое обращение',
  'a distributed lead: one notification to its responsible');
select tests.age();

-- First to answer takes the lead: every chosen employee hears about the
-- message; the one who answers gets the deal without a notification
update public.organization_settings
set lead_distribution = 'first_response', lead_distribution_sales_ids = '{}'
where organization_id = current_setting('t.org')::bigint;
select set_config('t.fr', tests.inbound('tok-notify', '77010000002', 'Сколько стоит?')::text, true);
select tests.assert(
  (select array_agg(sales_id order by sales_id) from public.notifications where deal_id = current_setting('t.fr')::bigint)
  = array[current_setting('t.owner_id')::bigint, current_setting('t.head_id')::bigint,
          current_setting('t.m1_id')::bigint, current_setting('t.m2_id')::bigint],
  'first to answer, empty list: everybody is told about the message');
update public.organization_settings
set lead_distribution_sales_ids = array[current_setting('t.m2_id')::bigint]
where organization_id = current_setting('t.org')::bigint;
select tests.age();
select tests.inbound('tok-notify', '77010000002', 'Алло?');
select tests.assert(
  (select array_agg(sales_id) from public.notifications where deal_id = current_setting('t.fr')::bigint and updated_at = now())
  = array[current_setting('t.m2_id')::bigint],
  'first to answer with a list: only the chosen employees');
select tests.answer(current_setting('t.fr')::bigint, current_setting('t.m2_id')::bigint);
select tests.assert(
  (select sales_id from public.deals where id = current_setting('t.fr')::bigint) = current_setting('t.m2_id')::bigint
  and tests.notes(current_setting('t.m2_id')::bigint, 'lead_assigned', current_setting('t.fr')::bigint) = 0,
  'the first answer gives m2 the deal, without notifying m2');
select tests.age();

--
-- patient_message and coalescing
--
update public.organization_settings set lead_distribution = 'off', lead_distribution_sales_ids = '{}'
where organization_id = current_setting('t.org')::bigint;
select tests.inbound('tok-notify', '77010000001', 'Можно на завтра?');
select tests.assert(
  tests.notes(current_setting('t.m1_id')::bigint, 'patient_message', current_setting('t.rr')::bigint) = 1
  and (select count(*) from public.notifications where deal_id = current_setting('t.rr')::bigint and kind = 'patient_message') = 1,
  'a message on m1''s deal notifies m1 only');
select tests.inbound('tok-notify', '77010000001', 'После обеда');
select tests.inbound('tok-notify', '77010000001', 'Или вечером');
select tests.assert(
  (select message_count = 3 and title = 'Новые сообщения (3)' and body like '%3 сообщения: Или вечером'
   from public.notifications where sales_id = current_setting('t.m1_id')::bigint and kind = 'patient_message'
     and deal_id = current_setting('t.rr')::bigint),
  'three messages within minutes: one notification with a count');
select tests.age();
select tests.inbound('tok-notify', '77010000001', 'Ответьте, пожалуйста');
select tests.assert(tests.notes(current_setting('t.m1_id')::bigint, 'patient_message', current_setting('t.rr')::bigint) = 2,
  'a message after the coalescing window: a new notification');
update public.notifications set read_at = now()
where sales_id = current_setting('t.m1_id')::bigint and deal_id = current_setting('t.rr')::bigint;
select tests.inbound('tok-notify', '77010000001', 'Ещё вопрос');
select tests.assert(tests.notes(current_setting('t.m1_id')::bigint, 'patient_message', current_setting('t.rr')::bigint) = 3,
  'a read notification is not reused');
select tests.answer(current_setting('t.rr')::bigint, current_setting('t.m1_id')::bigint);
select tests.assert(tests.notes(current_setting('t.m1_id')::bigint, 'patient_message', current_setting('t.rr')::bigint) = 3,
  'an outgoing message notifies nobody');

select set_config('t.un', tests.inbound('tok-notify', '77010000003', 'Новый вопрос')::text, true);
select tests.assert(
  (select array_agg(sales_id order by sales_id) from public.notifications where deal_id = current_setting('t.un')::bigint)
  = array[current_setting('t.owner_id')::bigint, current_setting('t.head_id')::bigint],
  'an unassigned deal (no distribution): the owner and the head');
select tests.age();

--
-- Waiting for an answer
--
insert into public.patients (organization_id, first_name) values (current_setting('t.org')::bigint, 'Ждёт');
insert into public.deals (organization_id, patient_id, name, sales_id)
select current_setting('t.org')::bigint, id, 'Ожидание', current_setting('t.m1_id')::bigint from public.patients where first_name = 'Ждёт';
select set_config('t.w', (select id from public.deals where name = 'Ожидание')::text, true);
create function tests.msg(direction text, sent timestamptz, author bigint default null, auto bigint default null)
returns void language sql as $$
  insert into public.messages (organization_id, patient_id, deal_id, transport, chat_id, direction, sales_id, text, status, sent_at, automessage_id)
  select d.organization_id, d.patient_id, d.id, 'whatsapp', 'w', direction, author, 'm',
    case when direction = 'in' then 'inbound' else 'sent' end, sent, auto
  from public.deals d where d.id = current_setting('t.w')::bigint
$$;
select tests.assert(private.deal_waiting_since(current_setting('t.org')::bigint, current_setting('t.w')::bigint) is null,
  'no message, nobody waits');
select tests.msg('in', '2026-03-12 05:00+00');
select tests.msg('in', '2026-03-12 05:10+00');
select tests.assert(private.deal_waiting_since(current_setting('t.org')::bigint, current_setting('t.w')::bigint) = '2026-03-12 05:00+00',
  'the wait starts at the first unanswered message');
select tests.msg('out', '2026-03-12 05:20+00');
select tests.assert(private.deal_waiting_since(current_setting('t.org')::bigint, current_setting('t.w')::bigint) is null,
  'an answer from the phone ends the wait');
select tests.msg('in', '2026-03-12 06:00+00');
insert into public.automessages (organization_id, deal_id, stage_id, timing, send_at, status)
select d.organization_id, d.id, d.stage_id, 'after_stage', now(), 'sending' from public.deals d where d.id = current_setting('t.w')::bigint;
select tests.msg('out', '2026-03-12 06:05+00', null, (select max(id) from public.automessages where deal_id = current_setting('t.w')::bigint));
select tests.assert(private.deal_waiting_since(current_setting('t.org')::bigint, current_setting('t.w')::bigint) = '2026-03-12 06:00+00',
  'an automatic message is not an answer');
select tests.msg('out', '2026-03-12 06:30+00', current_setting('t.m1_id')::bigint);
select tests.assert(private.deal_waiting_since(current_setting('t.org')::bigint, current_setting('t.w')::bigint) is null,
  'an answer of the employee ends the wait');

-- response_overdue: round the clock so that the test does not depend on the time
update public.organization_settings
set response_hours_start = 0, response_hours_end = 24, response_limit_minutes = 15
where organization_id = current_setting('t.org')::bigint;
select tests.throws(
  $q$update public.organization_settings set response_hours_start = 21, response_hours_end = 9 where organization_id = current_setting('t.org')::bigint$q$,
  '23514', 'working hours must start before they end');
-- Other waiting deals of the test are answered
select tests.answer(id, current_setting('t.m1_id')::bigint, now() - interval '1 minute')
from public.deals where organization_id = current_setting('t.org')::bigint and id <> current_setting('t.w')::bigint;
select tests.age();
delete from public.notifications;

select tests.msg('in', now() - interval '10 minutes');
select private.notifications_tick();
select tests.assert((select count(*) from public.notifications where kind = 'response_overdue') = 0,
  'waiting 10 minutes of 15: no alert');
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(
  (select waiting_minutes = 10 and not overdue and limit_minutes = 15 from public.deals_waiting where id = current_setting('t.w')::bigint),
  'the view shows the minutes waited, not overdue yet');
select tests.logout();

delete from public.messages where deal_id = current_setting('t.w')::bigint and sent_at > now() - interval '1 hour';
select tests.msg('in', now() - interval '20 minutes');
select tests.msg('in', now() - interval '5 minutes');
select private.notifications_tick();
select tests.assert(
  (select array_agg(sales_id order by sales_id) from public.notifications where kind = 'response_overdue')
  = array[current_setting('t.owner_id')::bigint, current_setting('t.head_id')::bigint, current_setting('t.m1_id')::bigint],
  'waiting 20 minutes of 15: the responsible, the owner and the head are alerted');
select tests.assert(
  (select body from public.notifications where kind = 'response_overdue' and sales_id = current_setting('t.m1_id')::bigint)
  = 'Ждёт · Ожидание · ждёт 20 мин',
  'the alert says how long the patient waits');
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(
  (select overdue and waiting_minutes = 20 from public.deals_waiting where id = current_setting('t.w')::bigint),
  'the view marks the deal overdue');
select tests.logout();
select private.notifications_tick();
select tests.assert((select count(*) from public.notifications where kind = 'response_overdue') = 3,
  'once per waiting episode');

-- 3x the limit (the limit is now 5 minutes): the owner and the head once more
update public.organization_settings set response_limit_minutes = 5 where organization_id = current_setting('t.org')::bigint;
select private.notifications_tick();
select tests.assert(
  (select array_agg(sales_id order by sales_id) from public.notifications
   where kind = 'response_overdue' and title = 'Пациент всё ещё ждёт ответа')
  = array[current_setting('t.owner_id')::bigint, current_setting('t.head_id')::bigint],
  'at 3x the limit the owner and the head are alerted again');
select private.notifications_tick();
select tests.assert((select count(*) from public.notifications where kind = 'response_overdue') = 5,
  'and not a third time');

-- An answer ends the episode; the next unanswered message starts a new one
update public.organization_settings
set response_limit_minutes = 15, response_alert_managers = false,
    response_alert_sales_ids = array[current_setting('t.m2_id')::bigint]
where organization_id = current_setting('t.org')::bigint;
select tests.msg('out', now() - interval '4 minutes', current_setting('t.m1_id')::bigint);
select tests.msg('in', now() - interval '3 minutes');
update public.messages set sent_at = now() - interval '16 minutes'
where deal_id = current_setting('t.w')::bigint and sent_at = now() - interval '3 minutes';
update public.messages set sent_at = now() - interval '17 minutes'
where deal_id = current_setting('t.w')::bigint and sent_at = now() - interval '4 minutes';
delete from public.notifications;
select private.notifications_tick();
select tests.assert(
  (select array_agg(sales_id order by sales_id) from public.notifications where kind = 'response_overdue')
  = array[current_setting('t.m1_id')::bigint, current_setting('t.m2_id')::bigint],
  'a new episode alerts again, to the configured people (responsible and m2, not the managers)');

-- Closed deals and a clinic with the control off do not wait
update public.organization_settings set response_control_enabled = false where organization_id = current_setting('t.org')::bigint;
select tests.assert(
  (select count(*) from public.deals_waiting where organization_id = current_setting('t.org')::bigint) = 0,
  'response control off: nothing waits');
update public.organization_settings set response_control_enabled = true where organization_id = current_setting('t.org')::bigint;
update public.deals set stage_id = (select s.id from public.stages s where s.pipeline_id = deals.pipeline_id and s.kind = 'won' limit 1)
where id = current_setting('t.w')::bigint;
select tests.assert(
  (select count(*) from public.deals_waiting where id = current_setting('t.w')::bigint) = 0,
  'a closed deal does not wait');

--
-- task_overdue
--
delete from public.notifications;
insert into public.tasks (organization_id, deal_id, type, text, due_date, sales_id)
values (current_setting('t.org')::bigint, current_setting('t.deal1')::bigint, 'call', 'Перезвонить', now() - interval '10 minutes', current_setting('t.m1_id')::bigint),
       (current_setting('t.org')::bigint, current_setting('t.deal1')::bigint, 'call', 'Давно', now() - interval '2 days', current_setting('t.m1_id')::bigint),
       (current_setting('t.org')::bigint, current_setting('t.deal1')::bigint, 'call', 'Готово', now() - interval '10 minutes', current_setting('t.m1_id')::bigint),
       (current_setting('t.org')::bigint, current_setting('t.deal1')::bigint, 'call', 'Позже', now() + interval '1 hour', current_setting('t.m1_id')::bigint);
update public.tasks set done_date = now() where text = 'Готово';
select private.notifications_tick();
select tests.assert(
  (select count(*) from public.notifications where kind = 'task_overdue') = 1
  and (select body like 'Перезвонить · %' and task_id is not null from public.notifications where kind = 'task_overdue'),
  'the overdue open task is notified to its employee; done, future and long overdue ones are not');
select private.notifications_tick();
select tests.assert(tests.notes(current_setting('t.m1_id')::bigint, 'task_overdue') = 1, 'once per task');
update public.tasks set due_date = now() - interval '1 minute' where text = 'Перезвонить';
select private.notifications_tick();
select tests.assert(tests.notes(current_setting('t.m1_id')::bigint, 'task_overdue') = 2,
  'a task with a new due date may be notified again');
update public.tasks set sales_id = current_setting('t.m2_id')::bigint where text = 'Позже';
update public.sales set disabled = true where id = current_setting('t.m2_id')::bigint;
update public.tasks set due_date = now() - interval '1 minute' where text = 'Позже';
select private.notifications_tick();
select tests.assert(tests.notes(current_setting('t.m2_id')::bigint, 'task_overdue') = 0,
  'a disabled employee gets nothing');
update public.sales set disabled = false where id = current_setting('t.m2_id')::bigint;

--
-- Rights: own notifications only
--
select private.add_notification(current_setting('t.org')::bigint, current_setting('t.owner_id')::bigint, 'lead_assigned', 'Для владельца', null);
select private.add_notification(current_setting('t.org')::bigint, current_setting('t.m1_id')::bigint, 'lead_assigned', 'Для m1', null);
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(
  tests.count('select * from public.notifications') = tests.count($q$select * from public.notifications where sales_id = current_setting('t.m1_id')::bigint$q$)
  and tests.count('select * from public.notifications') > 0,
  'an employee reads only their own notifications');
select tests.assert(
  tests.affected($q$update public.notifications set read_at = now() where title = 'Для владельца'$q$) = 0,
  'nor marks those of others');
select tests.assert(
  tests.affected($q$update public.notifications set read_at = now() where title = 'Для m1'$q$) = 1,
  'an employee marks their own notification read');
select tests.throws($q$update public.notifications set title = 'x'$q$, '42501', 'only read_at can be changed');
select tests.throws(
  $q$insert into public.notifications (organization_id, sales_id, kind, title) values (1, 1, 'lead_assigned', 'x')$q$,
  '42501', 'employees cannot create notifications');
select tests.throws($q$delete from public.notifications$q$, '42501', 'nor delete them');
select tests.throws($q$select private.notifications_tick()$q$, '42501', 'nor run the job');
select tests.throws($q$select * from public.response_alerts$q$, '42501', 'nor read the alerts');
select tests.throws($q$select * from public.notification_preferences$q$, '42501', 'preferences go through the functions');
select public.mark_all_notifications_read();
select tests.logout();
select tests.assert(
  (select count(*) from public.notifications where sales_id = current_setting('t.m1_id')::bigint and read_at is null) = 0
  and (select count(*) from public.notifications where sales_id = current_setting('t.owner_id')::bigint and read_at is null) > 0,
  '«Прочитать все» marks only the caller''s notifications');

--
-- Clinic isolation
--
select set_config('t.od', tests.inbound('tok-other', '77019999999', 'Другая клиника')::text, true);
select tests.assert(
  (select array_agg(n.sales_id) from public.notifications n where n.deal_id = current_setting('t.od')::bigint)
  = array[tests.sid('owner@other-notify.kz')],
  'a message of the other clinic notifies its owner only');
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(
  tests.count($q$select * from public.notifications where organization_id = current_setting('t.org')::bigint$q$) = 0
  and tests.count('select * from public.notifications') = 1,
  'the other clinic sees only its own notifications');
select tests.assert(
  tests.count($q$select * from public.deals_waiting where organization_id = current_setting('t.org')::bigint$q$) = 0
  and tests.count('select * from public.deals_waiting') = 1,
  'and only its own waiting deals');
select tests.logout();

--
-- Preferences and the Telegram link
--
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(
  public.get_notification_preferences() = jsonb_build_object(
    'kinds', jsonb_build_array('lead_assigned', 'patient_message', 'task_overdue', 'response_overdue'),
    'browser_enabled', false, 'telegram_enabled', true, 'telegram_linked', false,
    'telegram_username', null, 'telegram_link_code', null, 'telegram_link_expires_at', null),
  'defaults when never saved');
select public.save_notification_preferences(array['patient_message', 'lead_assigned', 'lead_assigned'], true, true);
select tests.assert(
  public.get_notification_preferences() -> 'kinds' = '["lead_assigned", "patient_message"]'::jsonb
  and (public.get_notification_preferences() ->> 'browser_enabled')::boolean,
  'preferences are saved (kinds without duplicates)');
select tests.throws($q$select public.save_notification_preferences(array['nope'], false, false)$q$, '23514', 'unknown kinds are refused');
select set_config('t.code', public.create_telegram_link_code(), true);
select tests.assert(length(current_setting('t.code')) = 16
  and public.get_notification_preferences() ->> 'telegram_link_code' = current_setting('t.code'),
  'a link code for the deep link');
select tests.throws($q$select public.link_telegram_chat('x', '1')$q$, '42501', 'employees cannot link a chat themselves');
select tests.throws($q$select * from public.claim_telegram_notifications()$q$, '42501', 'nor run the dispatcher');
select tests.logout();

select tests.login_as(current_setting('t.m2')::uuid);
select set_config('t.code2', public.create_telegram_link_code(), true);
select tests.logout();
update public.notification_preferences set telegram_link_expires_at = now() - interval '1 minute'
where sales_id = current_setting('t.m2_id')::bigint;

set local role service_role;
select tests.assert(
  public.link_telegram_chat(current_setting('t.code'), '555001', 'm1_tg') = '{"linked": true, "first_name": "m1", "clinic": "Клиника Улыбка"}'::jsonb,
  'the bot links the chat with the code');
select tests.assert(
  public.link_telegram_chat(current_setting('t.code'), '555002') ->> 'linked' = 'false',
  'a code works once');
select tests.assert(
  public.link_telegram_chat(current_setting('t.code2'), '555003') ->> 'linked' = 'false',
  'an expired code does not work');
select tests.assert(public.link_telegram_chat('', '555003') ->> 'linked' = 'false', 'no code, no link');
reset role;
select tests.assert(
  (select telegram_chat_id = '555001' and telegram_link_code is null from public.notification_preferences
   where sales_id = current_setting('t.m1_id')::bigint),
  'the chat is stored, the code is gone');

-- The dispatcher takes the new notifications of m1 (Telegram linked), skips
-- the kinds m1 switched off, and never takes a row twice
update public.notifications set telegram_status = 'skipped';
select private.add_notification(current_setting('t.org')::bigint, current_setting('t.m1_id')::bigint, 'lead_assigned', 'В Telegram', 'тело', current_setting('t.deal1')::bigint);
select private.add_notification(current_setting('t.org')::bigint, current_setting('t.m1_id')::bigint, 'task_overdue', 'Выключено', 'тело');
select private.add_notification(current_setting('t.org')::bigint, current_setting('t.owner_id')::bigint, 'lead_assigned', 'Не связан', 'тело');
set local role service_role;
create temp table claimed on commit drop as select * from public.claim_telegram_notifications();
select tests.assert(
  (select count(*) from claimed) = 1
  and (select chat_id = '555001' and notification_title = 'В Telegram' and notification_deal_id = current_setting('t.deal1')::bigint
       and clinic_name = 'Клиника Улыбка' from claimed),
  'the dispatcher returns the notification with the chat and the clinic');
select tests.assert((select count(*) from public.claim_telegram_notifications()) = 0, 'a row is taken once');
reset role;
select tests.assert(
  (select telegram_status from public.notifications where title = 'В Telegram') = 'sending'
  and (select telegram_status from public.notifications where title = 'Выключено') = 'skipped'
  and (select telegram_status from public.notifications where title = 'Не связан') is null,
  'claimed: sending; switched-off kind: skipped; not linked: untouched');

set local role service_role;
select tests.assert(public.unlink_telegram_chat('555001') = 1, '/stop unlinks the chat');
reset role;
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert((public.get_notification_preferences() ->> 'telegram_linked')::boolean = false, 'the chat is unlinked');
select tests.logout();

-- Deleting a clinic removes its notifications and preferences
delete from public.organizations where id = current_setting('t.org')::bigint;
select tests.assert(
  (select count(*) from public.notifications where organization_id = current_setting('t.org')::bigint) = 0
  and (select count(*) from public.notification_preferences where organization_id = current_setting('t.org')::bigint) = 0,
  'a deleted clinic leaves no notifications');

rollback;

--
-- Automatic messages (stage 6): templates, rules "stage -> template", the
-- queue scheduled and cancelled by the deal triggers, quiet hours, the
-- dispatcher RPC, "show to the employee first" tasks, rights and isolation.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника Жемчуг')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m1_id', (select id from public.sales where email = 'm1@clinic.kz')::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);

create function tests.stage(stage_name text) returns bigint language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
  where p.organization_id = current_setting('t.org')::bigint and p.is_default and s.name = stage_name
$$;
grant execute on function tests.stage(text) to authenticated;

-- Demo data of the seed may have due messages: out of the way
update public.automessages set status = 'cancelled';

--
-- Rendering
--
select tests.assert(
  private.render_template('Здравствуйте, {имя}!  Ждём вас {дата_визита} в {клиника}.',
    jsonb_build_object('имя', 'Асель', 'дата_визита', '12 марта в 14:30', 'клиника', 'Жемчуг'))
  = 'Здравствуйте, Асель! Ждём вас 12 марта в 14:30 в Жемчуг.',
  'variables are replaced');
select tests.assert(
  private.render_template('Здравствуйте, {имя} {услуга} !' || E'\n' || '  До встречи  ',
    jsonb_build_object('имя', null, 'услуга', null))
  = 'Здравствуйте, !' || E'\n' || 'До встречи',
  'missing values give an empty string and the spaces are collapsed');
select tests.assert(
  private.format_visit_date('2026-03-12 09:30+00', 'Asia/Tashkent') = '12 марта в 14:30',
  'the visit date is written in Russian in the clinic time zone');
select tests.assert(private.format_visit_date(null, 'Asia/Almaty') is null, 'no visit, no date');

--
-- Quiet hours (Asia/Tashkent = UTC+5)
--
select tests.assert(
  private.automessage_send_time('2026-03-12 10:00+00', 'Asia/Tashkent') = '2026-03-12 10:00+00'::timestamptz,
  '15:00 local is within 9:00-21:00');
select tests.assert(
  private.automessage_send_time('2026-03-12 17:00+00', 'Asia/Tashkent') = '2026-03-13 04:00+00'::timestamptz,
  '22:00 local moves to 9:00 next morning');
select tests.assert(
  private.automessage_send_time('2026-03-12 16:00+00', 'Asia/Tashkent') = '2026-03-13 04:00+00'::timestamptz,
  '21:00 local is already quiet');
select tests.assert(
  private.automessage_send_time('2026-03-12 01:00+00', 'Asia/Tashkent') = '2026-03-12 04:00+00'::timestamptz,
  '6:00 local moves to 9:00 the same day');

--
-- Defaults of a new clinic
--
select tests.assert(
  (select count(*) from public.message_templates where organization_id = current_setting('t.org')::bigint) = 4,
  'a new clinic gets the default templates (with «Подтверждение записи» of the schedule)');
select tests.assert(
  (select array_agg(s.name || ':' || r.timing || ':' || r.mode || ':' || r.is_active order by r.position)
   from public.automessage_rules r join public.stages s on s.id = r.stage_id
   where r.organization_id = current_setting('t.org')::bigint)
  = array['Записан:before_visit:auto:true', 'Отказ:after_stage:confirm:false', 'Новый лид:after_stage:confirm:false',
      'Записан:before_visit:auto:false'],
  'default rules: reminder before the visit (on), reactivation and greeting (off, shown first), confirmation of the schedule (off)');

--
-- Rights and isolation
--
select tests.login_as(current_setting('t.m1')::uuid);
select tests.throws(
  $q$insert into public.message_templates (name, body) values ('x', 'y')$q$,
  '42501', 'managers cannot add templates');
select tests.assert(
  tests.affected($q$update public.message_templates set body = 'x'$q$) = 0,
  'managers cannot edit templates');
select tests.throws(
  $q$insert into public.automessage_rules (stage_id, template_id) select tests.stage('В работе'), id from public.message_templates limit 1$q$,
  '42501', 'managers cannot add rules');
select tests.assert(
  tests.affected($q$update public.automessage_rules set is_active = true$q$) = 0,
  'managers cannot switch rules');
select tests.throws(
  $q$insert into public.automessages (deal_id, stage_id, timing, send_at) values (1, 1, 'after_stage', now())$q$,
  '42501', 'employees cannot queue messages by hand');
select tests.throws(
  $q$select * from public.claim_automessages()$q$,
  '42501', 'only the service role runs the dispatcher');
select tests.logout();

select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(
  tests.count('select * from public.message_templates') = 4
  and tests.count('select * from public.automessage_rules') = 4
  and tests.count($q$select * from public.message_templates where organization_id = current_setting('t.org')::bigint$q$) = 0,
  'another clinic only sees its own templates and rules');
select tests.logout();

-- The owner adds a template and a rule: 1 hour after entering "В работе"
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.message_templates (name, body)
values ('Спасибо', 'Здравствуйте, {имя}! Спасибо, что выбрали {клиника}. Услуга: {услуга}.');
insert into public.automessage_rules (stage_id, template_id, timing, offset_minutes, mode)
select tests.stage('В работе'), id, 'after_stage', 60, 'auto' from public.message_templates where name = 'Спасибо';
select tests.logout();

--
-- Scheduling on stage entry, cancelling on stage exit
--
select tests.login_as(current_setting('t.m1')::uuid);
insert into public.patients (first_name, phone_jsonb) values ('Асель', '[{"number": "+7 701 111 22 33", "type": "mobile"}]');
insert into public.deals (patient_id, name, service_id)
select p.id, 'авто', (select id from public.services where name = 'Имплантация')
from public.patients p where p.first_name = 'Асель';
select set_config('t.deal', (select id from public.deals where name = 'авто')::text, true);
select tests.assert(
  tests.count($q$select * from public.automessages where deal_id = current_setting('t.deal')::bigint$q$) = 0,
  'the greeting rule is off: nothing is queued for a new deal');

update public.deals set stage_id = tests.stage('В работе') where id = current_setting('t.deal')::bigint;
select tests.assert(
  (select count(*) = 1
     and bool_and(status = 'pending' and timing = 'after_stage')
     and bool_and(send_at = private.automessage_send_time(now() + interval '1 hour', 'Asia/Almaty'))
   from public.automessages where deal_id = current_setting('t.deal')::bigint),
  'entering a stage queues its message, 1 hour later within the quiet hours');
select tests.assert(
  tests.count($q$select * from public.automessages where deal_id = current_setting('t.deal')::bigint$q$) = 1,
  'the employee sees the queued messages of the deal');

-- "Записан" without a visit date: the reminder does nothing
update public.deals set stage_id = tests.stage('Записан') where id = current_setting('t.deal')::bigint;
select tests.assert(
  (select status = 'cancelled' and error = 'Сделка ушла с этапа' from public.automessages
   where deal_id = current_setting('t.deal')::bigint and stage_id = tests.stage('В работе')),
  'leaving the stage cancels its pending messages');
select tests.assert(
  tests.count($q$select * from public.automessages where deal_id = current_setting('t.deal')::bigint and status = 'pending'$q$) = 0,
  'a "before the visit" rule does nothing without a visit date');

--
-- Before the visit, rescheduled when the visit moves
--
update public.deals set appointment_at = date_trunc('hour', now()) + interval '3 days 2 hours'
where id = current_setting('t.deal')::bigint;
select tests.assert(
  (select count(*) = 1
     and bool_and(timing = 'before_visit')
     and bool_and(send_at = private.automessage_send_time(date_trunc('hour', now()) + interval '2 days 2 hours', 'Asia/Almaty'))
   from public.automessages where deal_id = current_setting('t.deal')::bigint and status = 'pending'),
  'setting the visit queues the reminder a day before it');
update public.deals set appointment_at = date_trunc('hour', now()) + interval '5 days 2 hours'
where id = current_setting('t.deal')::bigint;
select tests.assert(
  (select count(*) = 1
     and bool_and(send_at = private.automessage_send_time(date_trunc('hour', now()) + interval '4 days 2 hours', 'Asia/Almaty'))
   from public.automessages where deal_id = current_setting('t.deal')::bigint and status = 'pending')
  and tests.count($q$select * from public.automessages where deal_id = current_setting('t.deal')::bigint and error = 'Дата визита изменилась'$q$) = 1,
  'moving the visit reschedules the reminder');
update public.deals set appointment_at = null where id = current_setting('t.deal')::bigint;
select tests.assert(
  tests.count($q$select * from public.automessages where deal_id = current_setting('t.deal')::bigint and status = 'pending'$q$) = 0,
  'removing the visit cancels the reminder');
update public.deals set appointment_at = date_trunc('hour', now()) + interval '3 days 2 hours'
where id = current_setting('t.deal')::bigint;
select tests.logout();

--
-- Dispatcher: no messenger connected
--
update public.automessages set send_at = now() - interval '1 minute'
where deal_id = current_setting('t.deal')::bigint and status = 'pending';
set local role service_role;
select tests.assert(
  tests.count('select * from public.claim_automessages()') = 0,
  'nothing to send while the clinic has no messenger');
reset role;
select tests.assert(
  (select count(*) = 1 and bool_and(error like 'Мессенджеры не подключены%')
     and bool_and(text like 'Здравствуйте, Асель! Напоминаем, что вы записаны в Клиника Жемчуг на %')
   from public.automessages where deal_id = current_setting('t.deal')::bigint and status = 'failed'),
  'without a messenger the message fails with a clear reason');

--
-- Dispatcher: sending
--
insert into public.messenger_integrations (organization_id, api_key, connected_at)
values (current_setting('t.org')::bigint, 'key', now());
select tests.login_as(current_setting('t.m1')::uuid);
update public.deals set appointment_at = date_trunc('hour', now()) + interval '6 days 2 hours'
where id = current_setting('t.deal')::bigint;
select tests.logout();
update public.automessages set send_at = now() - interval '1 minute'
where deal_id = current_setting('t.deal')::bigint and status = 'pending';
set local role service_role;
create temporary table claimed on commit drop as select * from public.claim_automessages();
reset role;
select tests.assert(
  (select count(*) = 1 and bool_and(message_text like 'Здравствуйте, Асель! Напоминаем, что вы записаны в Клиника Жемчуг на %')
     and bool_and(deal_id = current_setting('t.deal')::bigint)
   from claimed),
  'a due message is claimed with its rendered text');
select tests.assert(
  (select a.status = 'sending' from public.automessages a join claimed c on c.id = a.id),
  'a claimed message is marked as being sent');
set local role service_role;
select tests.assert(
  tests.count('select * from public.claim_automessages()') = 0,
  'a message is never claimed twice');
reset role;
insert into public.messages (organization_id, patient_id, deal_id, transport, chat_id, direction, text, automessage_id)
select organization_id, patient_id, deal_id, 'whatsapp', '77011112233', 'out', message_text, id from claimed;
select tests.assert(
  (select a.status = 'sent' and a.processed_at is not null from public.automessages a join claimed c on c.id = a.id),
  'the stored message marks the automessage sent');
select tests.assert(
  (select first_response_at is null from public.deals where id = current_setting('t.deal')::bigint),
  'an automatic message is not the first answer of the clinic');

--
-- Lost stage: the reactivation is shown to the employee first
--
select tests.login_as(current_setting('t.owner')::uuid);
update public.automessage_rules set is_active = true where stage_id = tests.stage('Отказ');
select tests.logout();
select tests.login_as(current_setting('t.m1')::uuid);
update public.deals
set stage_id = tests.stage('Отказ'), lost_reason_id = (select id from public.lost_reasons limit 1)
where id = current_setting('t.deal')::bigint;
select tests.assert(
  (select count(*) = 1
     and bool_and(send_at = private.automessage_send_time(now() + interval '30 days', 'Asia/Almaty'))
   from public.automessages
   where deal_id = current_setting('t.deal')::bigint and status = 'pending' and stage_id = tests.stage('Отказ')),
  'a lost deal gets the reactivation 30 days later');
select tests.logout();

update public.automessages set send_at = now() - interval '1 minute'
where deal_id = current_setting('t.deal')::bigint and status = 'pending';
set local role service_role;
select tests.assert(
  tests.count('select * from public.claim_automessages()') = 0,
  '"show first" messages are not sent by the dispatcher');
reset role;
select set_config('t.react', (select id from public.automessages
  where deal_id = current_setting('t.deal')::bigint and stage_id = tests.stage('Отказ'))::text, true);
select tests.assert(
  (select status = 'awaiting' from public.automessages where id = current_setting('t.react')::bigint)
  and (select count(*) = 1 and bool_and(type = 'message' and sales_id = current_setting('t.m1_id')::bigint
          and text like 'Здравствуйте, Асель! Это Клиника Жемчуг.%' and done_date is null)
       from public.tasks where automessage_id = current_setting('t.react')::bigint),
  'a "show first" message becomes a task with the text for the responsible');

-- The employee sends it (messenger_send stores the message with its automessage)
insert into public.messages (organization_id, patient_id, deal_id, transport, chat_id, direction, text, sales_id, automessage_id)
select a.organization_id, d.patient_id, a.deal_id, 'whatsapp', '77011112233', 'out', 'Исправленный текст',
  current_setting('t.m1_id')::bigint, a.id
from public.automessages a join public.deals d on d.id = a.deal_id
where a.id = current_setting('t.react')::bigint;
select tests.assert(
  (select status = 'sent' and text = 'Исправленный текст' from public.automessages where id = current_setting('t.react')::bigint)
  and (select done_date is not null from public.tasks where automessage_id = current_setting('t.react')::bigint),
  'sending from the task marks the message sent and completes the task');

--
-- Greeting shown first, cancelled by the employee; rule switched off
--
select tests.login_as(current_setting('t.owner')::uuid);
update public.automessage_rules set is_active = true where stage_id = tests.stage('Новый лид');
select tests.logout();
select tests.login_as(current_setting('t.m1')::uuid);
insert into public.deals (patient_id, name) select id, 'приветствие' from public.patients where first_name = 'Асель';
select set_config('t.greet_deal', (select id from public.deals where name = 'приветствие')::text, true);
select tests.logout();
update public.automessages set send_at = now() - interval '1 minute'
where deal_id = current_setting('t.greet_deal')::bigint;
set local role service_role;
select count(*) from public.claim_automessages();
reset role;
select set_config('t.greet', (select id from public.automessages where deal_id = current_setting('t.greet_deal')::bigint)::text, true);
select tests.assert(
  (select status from public.automessages where id = current_setting('t.greet')::bigint) = 'awaiting'
  and tests.count($q$select * from public.tasks where automessage_id = current_setting('t.greet')::bigint$q$) = 1,
  'the greeting waits for the employee');

select tests.login_as(current_setting('t.m1')::uuid);
select tests.throws(
  format($q$update public.automessages set status = 'sent' where id = %s$q$, current_setting('t.greet')),
  '23514', 'an employee cannot mark a message sent');
select tests.throws(
  format($q$update public.automessages set text = 'x' where id = %s$q$, current_setting('t.greet')),
  '42501', 'an employee cannot rewrite a queued message');
update public.automessages set status = 'cancelled' where id = current_setting('t.greet')::bigint;
select tests.assert(
  (select status = 'cancelled' and error = 'Отменено сотрудником' from public.automessages where id = current_setting('t.greet')::bigint)
  and tests.count($q$select * from public.tasks where automessage_id = current_setting('t.greet')::bigint$q$) = 0,
  'an employee cancels a waiting message, its task goes away');
select tests.logout();

-- A rule switched off after scheduling: the queued message is cancelled
select tests.login_as(current_setting('t.m1')::uuid);
insert into public.deals (patient_id, name) select id, 'выключено' from public.patients where first_name = 'Асель';
select set_config('t.off_deal', (select id from public.deals where name = 'выключено')::text, true);
select tests.logout();
select tests.login_as(current_setting('t.owner')::uuid);
update public.automessage_rules set is_active = false where stage_id = tests.stage('Новый лид');
select tests.logout();
update public.automessages set send_at = now() - interval '1 minute'
where deal_id = current_setting('t.off_deal')::bigint;
set local role service_role;
select count(*) from public.claim_automessages();
reset role;
select tests.assert(
  (select status = 'cancelled' and error = 'Правило выключено или удалено' from public.automessages
   where deal_id = current_setting('t.off_deal')::bigint),
  'a rule switched off does not send its queued messages');

-- Another clinic never sees the queue of this one
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.count('select * from public.automessages') = 0, 'another clinic does not see the queue');
select tests.assert(
  tests.affected(format($q$update public.automessages set status = 'cancelled' where id = %s$q$, current_setting('t.greet'))) = 0,
  'another clinic cannot cancel');
select tests.logout();

-- A manager who does not see the deal does not see its queue
select tests.login_as(current_setting('t.owner')::uuid);
update public.organization_settings set manager_deal_visibility = 'own';
insert into public.patients (first_name) values ('Чужой');
insert into public.deals (patient_id, name, stage_id)
select id, 'чужая', tests.stage('В работе') from public.patients where first_name = 'Чужой';
select set_config('t.hidden', (select id from public.deals where name = 'чужая')::text, true);
select tests.logout();
select tests.assert(
  tests.count($q$select * from public.automessages where deal_id = current_setting('t.hidden')::bigint and status = 'pending'$q$) = 1,
  'the deal of the owner has a queued message');
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(
  tests.count($q$select * from public.automessages where deal_id = current_setting('t.hidden')::bigint$q$) = 0,
  'the queue follows the visibility of deals');
select tests.assert(
  tests.affected($q$update public.automessages set status = 'cancelled' where deal_id = current_setting('t.hidden')::bigint$q$) = 0,
  'a manager cannot cancel the messages of a deal they do not see');
select tests.logout();

--
-- Stage scripts: written by the owner and the head, read by everyone
--
select tests.login_as(current_setting('t.owner')::uuid);
update public.stages set script = 'Поздоровайтесь и представьтесь' where id = tests.stage('Новый лид');
select tests.logout();
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(
  (select script from public.stages where id = tests.stage('Новый лид')) = 'Поздоровайтесь и представьтесь',
  'employees read the script of a stage');
select tests.assert(
  tests.affected($q$update public.stages set script = 'x'$q$) = 0,
  'managers cannot edit scripts');
select tests.logout();

rollback;

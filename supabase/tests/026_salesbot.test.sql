--
-- Stage 26: «Салесбот». Scenario checks on save, every way to start a bot
-- (new lead, keyword, digital pipeline, by hand), the steps (message, wait,
-- condition, set, task, handoff, webhook, delay, stop), timeouts through the
-- tick, an employee taking over, the unsorted and import guards, one session
-- per deal, loop protection, the stage checklist, the dispatcher, rights and
-- clinic isolation.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника Жемчуг')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.owner_id', (select id from public.sales where email = 'owner@clinic.kz')::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m1_id', (select id from public.sales where email = 'm1@clinic.kz')::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);
select set_config('t.other_org', tests.org_of(current_setting('t.other')::uuid)::text, true);

insert into public.messenger_integrations (organization_id, api_key, webhook_token, connected_at)
values (current_setting('t.org')::bigint, 'key-a', 'token-a', now()),
       (current_setting('t.other_org')::bigint, 'key-b', 'token-b', now());

create function tests.stage(stage_name text) returns bigint language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
  where p.organization_id = current_setting('t.org')::bigint and p.is_default and s.name = stage_name
$$;
create function tests.deal_stage(target_deal bigint) returns text language sql as $$
  select s.name from public.deals d join public.stages s on s.id = d.stage_id where d.id = target_deal
$$;
create function tests.ingest(token text, message jsonb) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  execute 'set local role service_role';
  result := public.ingest_message(token, message);
  execute 'reset role';
  return result;
end;
$$;
-- A WhatsApp message of a phone number; returns the deal
create function tests.wa(phone text, message_text text, message_direction text default 'in') returns bigint language plpgsql as $$
begin
  return (tests.ingest('token-a', jsonb_build_object('transport', 'whatsapp', 'chat_id', phone,
    'direction', message_direction, 'text', message_text, 'contact', jsonb_build_object('name', 'Асель'))) ->> 'deal_id')::bigint;
end;
$$;
-- A deal of the test clinic in a stage, with its own patient
create function tests.new_deal(deal_name text, stage_name text default 'Новый лид') returns bigint language plpgsql as $$
declare
  patient_id bigint;
  deal_id bigint;
begin
  insert into public.patients (organization_id, first_name) values (current_setting('t.org')::bigint, deal_name)
  returning id into patient_id;
  insert into public.deals (organization_id, patient_id, name, stage_id, pipeline_id, sales_id)
  select current_setting('t.org')::bigint, patient_id, deal_name, s.id, s.pipeline_id, current_setting('t.owner_id')::bigint
  from public.stages s where s.id = tests.stage(stage_name)
  returning id into deal_id;
  return deal_id;
end;
$$;
create function tests.message(target_deal bigint, message_direction text, message_text text, author bigint default null) returns bigint language plpgsql as $$
declare new_id bigint;
begin
  insert into public.messages (organization_id, patient_id, deal_id, transport, chat_id, direction, status, text, sales_id)
  select d.organization_id, d.patient_id, d.id, 'whatsapp', '77010000000', message_direction,
    case when message_direction = 'in' then 'inbound' else 'sent' end, message_text, author
  from public.deals d where d.id = target_deal
  returning id into new_id;
  return new_id;
end;
$$;
create function tests.session(target_deal bigint) returns public.salesbot_sessions language sql as $$
  select * from public.salesbot_sessions s where s.deal_id = target_deal order by s.id desc limit 1
$$;
create function tests.queued(target_deal bigint) returns text[] language sql as $$
  select coalesce(array_agg(a.text order by a.id), '{}') from public.automessages a
  where a.deal_id = target_deal and a.salesbot_session_id is not null and a.status = 'pending'
$$;
create function tests.log_kinds(target_deal bigint) returns text[] language sql as $$
  select coalesce(array_agg(l.kind order by l.id), '{}') from public.salesbot_logs l where l.deal_id = target_deal
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- Tags and a custom field used by the scenarios
insert into public.tags (organization_id, name, color)
values (current_setting('t.org')::bigint, 'Боль', 'red'), (current_setting('t.org')::bigint, 'Имплантация', 'blue');
select set_config('t.tag_pain', (select id from public.tags where name = 'Боль' and organization_id = current_setting('t.org')::bigint)::text, true);
select set_config('t.tag_impl', (select id from public.tags where name = 'Имплантация' and organization_id = current_setting('t.org')::bigint)::text, true);
insert into public.custom_fields (organization_id, entity, name, type)
values (current_setting('t.org')::bigint, 'deal', 'Жалоба', 'text');
select set_config('t.field', (select id from public.custom_fields where name = 'Жалоба' and organization_id = current_setting('t.org')::bigint)::text, true);

-- The consultation bot: greeting with buttons → wait → condition → set →
-- offer → wait → «да» books (stage + task), anything else hands off
select set_config('t.scenario', format($json$
{"start": "greet", "steps": [
  {"id": "greet", "type": "send_message", "text": "Здравствуйте, {имя}! Что вас беспокоит?",
   "buttons": ["Боль", "Имплантация", "Брекеты", "Другое"], "next": "wait1"},
  {"id": "wait1", "type": "wait_reply", "timeout_minutes": 60, "next": "cond1", "timeout_next": "handoff"},
  {"id": "cond1", "type": "condition", "branches": [
    {"match": "option", "value": "1", "next": "set_pain"},
    {"match": "option", "value": "2", "next": "set_impl"},
    {"match": "keywords", "value": "имплант, зуб выпал", "next": "set_impl"}], "else_next": "handoff"},
  {"id": "set_pain", "type": "set", "actions": [{"kind": "tag_add", "tag_id": %1$s}], "next": "offer"},
  {"id": "set_impl", "type": "set", "actions": [{"kind": "tag_add", "tag_id": %2$s},
    {"kind": "field", "field_id": %3$s, "value": "{ответ}"}], "next": "offer"},
  {"id": "offer", "type": "send_message", "text": "Записать вас на консультацию?", "next": "wait2"},
  {"id": "wait2", "type": "wait_reply", "timeout_minutes": 30, "next": "cond2", "timeout_next": "handoff"},
  {"id": "cond2", "type": "condition", "branches": [{"match": "keywords", "value": "да, давайте", "next": "book"}],
   "else_next": "handoff"},
  {"id": "book", "type": "set", "actions": [{"kind": "stage", "stage_id": %4$s}], "next": "task"},
  {"id": "task", "type": "create_task", "task_type": "call", "text": "Записать пациента ({ответ})", "due_minutes": 15, "next": "bye"},
  {"id": "bye", "type": "send_message", "text": "Спасибо! Администратор свяжется с вами."},
  {"id": "handoff", "type": "handoff", "text": "Нужен администратор", "create_task": true}
]}
$json$, current_setting('t.tag_pain'), current_setting('t.tag_impl'), current_setting('t.field'), tests.stage('Записан')), true);

--
-- Rights: bots are read by every employee, edited by the owner and the head
--
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.salesbots (name, scenario, is_active, trigger_new_lead, trigger_transports)
values ('Первичная консультация', current_setting('t.scenario')::jsonb, true, true, array['whatsapp']);
select set_config('t.bot', (select id from public.salesbots where name = 'Первичная консультация')::text, true);
select tests.assert((select version = 1 and created_by = current_setting('t.owner_id')::bigint from public.salesbots
  where id = current_setting('t.bot')::bigint), 'a new bot has version 1 and its author');
select tests.logout();

select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(tests.count('select * from public.salesbots') = 1, 'managers read the bots');
select tests.throws($q$insert into public.salesbots (name) values ('Мой бот')$q$, '42501', 'managers cannot add bots');
select tests.assert(tests.affected('update public.salesbots set is_active = false') = 0, 'managers cannot switch bots');
select tests.assert(tests.affected('delete from public.salesbots') = 0, 'managers cannot delete bots');
select tests.throws($q$select private.salesbot_tick()$q$, '42501', 'employees cannot run the tick');
select tests.throws($q$insert into public.salesbot_sessions (organization_id, deal_id, bot_name, bot_version, scenario, trigger)
  values (1, 1, 'x', 1, '{}', 'manual')$q$, '42501', 'sessions are written by the functions only');
select tests.logout();

select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.count('select * from public.salesbots') = 0, 'another clinic does not see our bots');
select tests.assert(tests.affected('update public.salesbots set is_active = false') = 0, 'another clinic cannot switch our bots');
select tests.logout();

--
-- Scenario checks on save
--
select tests.login_as(current_setting('t.head')::uuid);
select tests.throws($q$insert into public.salesbots (name, scenario) values ('Сломанный', '{"steps": "x"}')$q$,
  '23514', 'a broken structure is refused');
select tests.throws($q$insert into public.salesbots (name, scenario) values ('Дубли', '{"start": "a", "steps": [{"id": "a", "type": "stop"}, {"id": "a", "type": "stop"}]}')$q$,
  '23514', 'duplicate step ids are refused');
select tests.throws($q$insert into public.salesbots (name, scenario) values ('Непонятный', '{"start": "a", "steps": [{"id": "a", "type": "dance"}]}')$q$,
  '23514', 'unknown step types are refused');
insert into public.salesbots (name, scenario)
values ('Черновик', '{"start": "a", "steps": [{"id": "a", "type": "wait_reply", "timeout_minutes": 5, "next": "b"}, {"id": "c", "type": "stop"}]}');
select tests.assert(
  (select array_agg(e.value ->> 'code' order by e.value ->> 'code') from public.salesbots b, jsonb_array_elements(private.salesbot_errors(b.scenario)) e
   where b.name = 'Черновик') = array['dangling_next', 'missing_target', 'unreachable'],
  'a draft with errors is saved: dangling next, missing timeout target, unreachable step');
select tests.throws($q$update public.salesbots set is_active = true where name = 'Черновик'$q$,
  '23514', 'a bot with errors cannot be switched on');
select tests.assert(private.salesbot_errors('{"start": "x", "steps": [{"id": "a", "type": "stop"}]}') @> '[{"code": "no_start"}]',
  'the start must be a step');
select tests.assert(private.salesbot_errors('{"start": "a", "steps": [{"id": "a", "type": "condition", "branches": [{"match": "regex", "value": "(", "next": "a"}], "else_next": "a"}]}') @> '[{"code": "invalid_regex"}]',
  'a regex that does not compile is an error');
select tests.assert(jsonb_array_length(private.salesbot_errors(current_setting('t.scenario')::jsonb)) = 0,
  'the consultation scenario is valid');
update public.salesbots set scenario = '{"start": "a", "steps": [{"id": "a", "type": "stop"}]}' where name = 'Черновик';
select tests.assert((select version from public.salesbots where name = 'Черновик') = 2, 'changing the scenario bumps the version');
update public.salesbots set description = 'Тест' where name = 'Черновик';
select tests.assert((select version from public.salesbots where name = 'Черновик') = 2, 'other changes keep the version');
select tests.throws($q$update public.salesbots set version = 10 where name = 'Черновик'$q$, '42501', 'the version is not written by hand');
select tests.logout();
select tests.assert((select count(*) from public.audit_log where entity = 'salesbot') >= 3, 'bots are in the audit log');

--
-- New lead: the first WhatsApp message of a new deal starts the bot
--
select set_config('t.d1', tests.wa('77011110001', 'Здравствуйте')::text, true);
select tests.assert((tests.session(current_setting('t.d1')::bigint)).status = 'waiting'
  and (tests.session(current_setting('t.d1')::bigint)).trigger = 'new_lead'
  and (tests.session(current_setting('t.d1')::bigint)).current_step = 'wait1',
  'the new-lead bot started and waits for the reply');
select tests.assert(tests.queued(current_setting('t.d1')::bigint)
  = array[E'Здравствуйте, Асель! Что вас беспокоит?\n\n1 — Боль\n2 — Имплантация\n3 — Брекеты\n4 — Другое'],
  'the greeting with numbered buttons is queued');
select tests.assert(
  (select a.rule_id is null and a.template_id is null from public.automessages a where a.deal_id = current_setting('t.d1')::bigint),
  'a bot message has no rule and no template');
select tests.assert(
  (select abs(extract(epoch from (s.wait_until - greatest(now(), (s.state ->> 'last_send_at')::timestamptz) - interval '60 minutes'))) < 1
   from public.salesbot_sessions s where s.deal_id = current_setting('t.d1')::bigint),
  'the timeout counts from the moment the message goes out (quiet hours included)');

-- The reply «2» sets the tag and the custom field, the offer is queued
select tests.message(current_setting('t.d1')::bigint, 'in', '2. Хочу имплант');
select tests.assert(current_setting('t.tag_impl')::bigint = any((select tags from public.deals where id = current_setting('t.d1')::bigint)::bigint[]),
  'option 2 adds the tag');
select tests.assert((select custom_values ->> current_setting('t.field') from public.deals where id = current_setting('t.d1')::bigint) = '2. Хочу имплант',
  '{ответ} fills the custom field with the reply');
select tests.assert((tests.session(current_setting('t.d1')::bigint)).current_step = 'wait2'
  and (tests.session(current_setting('t.d1')::bigint)).last_reply = '2. Хочу имплант',
  'the bot waits for the second answer with the reply stored');
select tests.assert(cardinality(tests.queued(current_setting('t.d1')::bigint)) = 2, 'the offer is queued');

-- «Да, давайте» books: stage «Записан», task, thanks; the session is done
select tests.message(current_setting('t.d1')::bigint, 'in', 'Да, давайте');
select tests.assert(tests.deal_stage(current_setting('t.d1')::bigint) = 'Записан', 'the bot moves the deal to «Записан»');
select tests.assert(exists (select 1 from public.tasks where deal_id = current_setting('t.d1')::bigint and text = 'Записать пациента (Да, давайте)'),
  'the bot creates the task for the admin');
select tests.assert((tests.session(current_setting('t.d1')::bigint)).status = 'done', 'the scenario ends');
select tests.assert((tests.queued(current_setting('t.d1')::bigint))[3] = 'Спасибо! Администратор свяжется с вами.',
  'the last message stays queued after the stage change');
select tests.assert(tests.log_kinds(current_setting('t.d1')::bigint)
  = array['started', 'sent', 'waiting', 'reply', 'branch', 'set', 'set', 'sent', 'waiting', 'reply', 'branch', 'set', 'task', 'sent', 'done'],
  'every step is logged');
select tests.assert(
  (select sales_id is null from public.deal_events where deal_id = current_setting('t.d1')::bigint and type = 'stage_changed' order by id desc limit 1),
  'a move of the bot has no author in the deal log');

-- The dispatcher sends the text of the bot, even though the stage changed;
-- the bot message is not the clinic's answer (response time)
select tests.assert((select count(*) from public.claim_automessages() c where c.deal_id = current_setting('t.d1')::bigint) = 3,
  'the dispatcher takes the three bot messages');
insert into public.messages (organization_id, patient_id, deal_id, transport, chat_id, direction, status, text, automessage_id)
select a.organization_id, d.patient_id, a.deal_id, 'whatsapp', '77011110001', 'out', 'sent', a.text, a.id
from public.automessages a join public.deals d on d.id = a.deal_id
where a.deal_id = current_setting('t.d1')::bigint and a.status = 'sending';
select tests.assert((select bool_and(status = 'sent') from public.automessages where deal_id = current_setting('t.d1')::bigint),
  'sent bot messages are marked sent');
select tests.assert((select first_response_at is null from public.deals where id = current_setting('t.d1')::bigint),
  'a bot message does not count as the first answer of the clinic');

--
-- Timeout through the tick: the timeout branch hands off (notification + task)
--
select set_config('t.d2', tests.wa('77011110002', 'Добрый день')::text, true);
select tests.assert(private.salesbot_tick(now() + interval '30 minutes') = 0, 'nothing is due before the timeout');
select tests.assert(private.salesbot_tick(now() + interval '2 days') >= 1, 'the tick resumes the timed-out session');
select tests.assert((tests.session(current_setting('t.d2')::bigint)).status = 'handed_off', 'the timeout branch hands off');
select tests.assert((tests.log_kinds(current_setting('t.d2')::bigint))[4:5] = array['timeout', 'handoff'], 'the timeout is logged');
select tests.assert(exists (
  select 1 from public.notifications n join public.deals d on d.id = n.deal_id
  where n.deal_id = current_setting('t.d2')::bigint and n.kind = 'bot_handoff' and n.title = 'Бот передал диалог'
    and n.body like '%Нужен администратор' and n.sales_id = coalesce(d.sales_id, current_setting('t.owner_id')::bigint) and n.task_id is not null),
  'the handoff notifies the responsible (no one: the owner and the heads) with the task');
select tests.assert(exists (select 1 from public.tasks where deal_id = current_setting('t.d2')::bigint
  and text = 'Ответить пациенту: бот передал диалог'), 'the handoff task');

-- A reply outside the options hands off too
select set_config('t.d3', tests.wa('77011110003', 'Здравствуйте')::text, true);
select tests.message(current_setting('t.d3')::bigint, 'in', 'Просто спросить');
select tests.assert((tests.session(current_setting('t.d3')::bigint)).status = 'handed_off', 'the else branch hands off');
-- Option 1 by the text of the button
select set_config('t.d4', tests.wa('77011110004', 'Здравствуйте')::text, true);
select tests.message(current_setting('t.d4')::bigint, 'in', 'боль');
select tests.assert(current_setting('t.tag_pain')::bigint = any((select tags from public.deals where id = current_setting('t.d4')::bigint)::bigint[]),
  'the text of a button chooses its option');

--
-- An employee's own message stops the bot and cancels its queue
--
select tests.message(current_setting('t.d4')::bigint, 'out', 'Здравствуйте, это администратор', current_setting('t.m1_id')::bigint);
select tests.assert((tests.session(current_setting('t.d4')::bigint)).status = 'stopped'
  and (tests.session(current_setting('t.d4')::bigint)).stopped_reason = 'Сотрудник ответил сам',
  'a human took over');
select tests.assert(cardinality(tests.queued(current_setting('t.d4')::bigint)) = 0, 'the queued bot messages are cancelled');
select tests.message(current_setting('t.d4')::bigint, 'in', 'Да');
select tests.assert((select count(*) from public.salesbot_sessions where deal_id = current_setting('t.d4')::bigint) = 1,
  'a reply after the takeover does not restart the bot');

--
-- Keyword trigger; the stage checklist blocks a move of the bot (skipped)
--
insert into public.stage_checklist_items (organization_id, stage_id, text)
values (current_setting('t.org')::bigint, tests.stage('В работе'), 'Уточнить жалобу');
insert into public.salesbots (organization_id, name, is_active, trigger_keywords, position, scenario)
values (current_setting('t.org')::bigint, 'Цены', true, array[' Цена ', 'прайс'], 1, format($json$
{"start": "a", "steps": [
  {"id": "a", "type": "set", "actions": [{"kind": "stage", "stage_id": %1$s}], "next": "b"},
  {"id": "b", "type": "set", "actions": [{"kind": "stage", "stage_id": %2$s}], "next": "c"},
  {"id": "c", "type": "send_message", "text": "Консультация — 5000 ₸", "next": "d"},
  {"id": "d", "type": "delay", "minutes": 10, "next": "e"},
  {"id": "e", "type": "condition", "branches": [{"match": "regex", "value": "^спасибо", "next": "f"}], "else_next": "g"},
  {"id": "f", "type": "stop"},
  {"id": "g", "type": "send_message", "text": "Остались вопросы?"}
]}
$json$, tests.stage('В работе'), tests.stage('Записан'))::jsonb);
select tests.assert((select trigger_keywords from public.salesbots where name = 'Цены') = array['прайс', 'цена'],
  'keywords are trimmed and lowercased');
select set_config('t.d5', tests.new_deal('Мадина')::text, true);
-- Not the first message of the deal: the new-lead bot is not for it
select tests.message(current_setting('t.d5')::bigint, 'out', 'Здравствуйте! Чем помочь?');
select tests.message(current_setting('t.d5')::bigint, 'in', 'Какая ЦЕНА на брекеты?');
select tests.assert((tests.session(current_setting('t.d5')::bigint)).trigger = 'keyword', 'a keyword starts the bot');
select tests.assert(tests.deal_stage(current_setting('t.d5')::bigint) = 'В работе', 'the first move is done');
select tests.assert(
  (select l.kind = 'skipped' and l.text like 'Выполните чек-лист%' from public.salesbot_logs l
   where l.deal_id = current_setting('t.d5')::bigint and l.step_id = 'b'),
  'the stage checklist skips the second move, logged');
select tests.assert((tests.session(current_setting('t.d5')::bigint)).status = 'waiting'
  and (tests.session(current_setting('t.d5')::bigint)).state ->> 'wait' = 'delay',
  'the scenario went on to the delay');
-- A reply during a delay is kept for the next condition
select tests.message(current_setting('t.d5')::bigint, 'in', 'Спасибо!');
select tests.assert((tests.session(current_setting('t.d5')::bigint)).status = 'waiting', 'a reply does not end a delay');
select private.salesbot_tick(now() + interval '11 minutes');
select tests.assert((tests.session(current_setting('t.d5')::bigint)).status = 'done'
  and (tests.log_kinds(current_setting('t.d5')::bigint))[cardinality(tests.log_kinds(current_setting('t.d5')::bigint)) - 1] = 'branch',
  'after the delay the regex matches the reply kept, the bot stops');

--
-- Digital pipeline action «Запустить салесбот»; one session per deal
--
insert into public.stage_triggers (organization_id, stage_id, event, action, salesbot_id, name)
values (current_setting('t.org')::bigint, tests.stage('Пришёл на консультацию'), 'stage_entered', 'start_salesbot',
  current_setting('t.bot')::bigint, 'Бот после консультации');
select tests.throws(
  $q$insert into public.stage_triggers (organization_id, stage_id, event, action) values (current_setting('t.org')::bigint, tests.stage('Записан'), 'stage_entered', 'start_salesbot')$q$,
  '23514', 'the action needs a bot');
select set_config('t.d6', tests.new_deal('Ерлан', 'Записан')::text, true);
update public.deals set sales_id = current_setting('t.m1_id')::bigint where id = current_setting('t.d6')::bigint;
update public.deals set stage_id = tests.stage('Пришёл на консультацию') where id = current_setting('t.d6')::bigint;
select tests.assert((tests.session(current_setting('t.d6')::bigint)).trigger = 'pipeline'
  and (tests.session(current_setting('t.d6')::bigint)).status = 'waiting', 'the digital pipeline starts the bot');
select tests.assert((select r.status = 'done' and (r.details ->> 'salesbot_id')::bigint = current_setting('t.bot')::bigint
  from public.stage_trigger_runs r where r.deal_id = current_setting('t.d6')::bigint and r.action = 'start_salesbot'),
  'the run of the trigger is logged');

-- By hand: the manager starts another bot, the old session is stopped
update public.salesbots set is_active = true where name = 'Черновик';
select tests.login_as(current_setting('t.m1')::uuid);
select public.start_salesbot(current_setting('t.d6')::bigint, (select id from public.salesbots where name = 'Черновик'));
select tests.logout();
select tests.assert(
  (select array_agg(s.status || ':' || coalesce(s.stopped_reason, '') order by s.id) from public.salesbot_sessions s
   where s.deal_id = current_setting('t.d6')::bigint) = array['stopped:Запущен бот «Черновик»', 'done:'],
  'a new start replaces the running session');
select tests.assert(
  (select started_by = current_setting('t.m1_id')::bigint and trigger = 'manual' from public.salesbot_sessions
   where deal_id = current_setting('t.d6')::bigint order by id desc limit 1),
  'a manual start records the employee');
select tests.assert(cardinality(tests.queued(current_setting('t.d6')::bigint)) = 0, 'the replaced session''s queue is cancelled');
-- Stop by hand
select tests.login_as(current_setting('t.owner')::uuid);
select public.start_salesbot(current_setting('t.d6')::bigint, current_setting('t.bot')::bigint);
select tests.assert(public.stop_salesbot(current_setting('t.d6')::bigint), '«Остановить бота»');
select tests.assert(not public.stop_salesbot(current_setting('t.d6')::bigint), 'nothing left to stop');
select tests.throws(format('select public.start_salesbot(%s, %s)', current_setting('t.d6'),
  (select id from public.salesbots where name = 'Цены') + 1000), '22023', 'an unknown bot');
select tests.logout();
select tests.assert(
  (select count(*) from public.salesbot_sessions where deal_id = current_setting('t.d6')::bigint and status in ('running', 'waiting')) = 0,
  'no running session after the stop');

--
-- Unsorted and import guards
--
update public.organization_settings set unsorted_enabled = true where organization_id = current_setting('t.org')::bigint;
select set_config('t.lead', tests.wa('77011110007', 'Хочу на консультацию')::text, true);
select tests.assert((select unsorted_at is not null from public.deals where id = current_setting('t.lead')::bigint), 'the lead is unsorted');
select tests.assert((tests.session(current_setting('t.lead')::bigint)).id is null, 'no bot on an unsorted lead');
select tests.login_as(current_setting('t.owner')::uuid);
select tests.throws(format('select public.start_salesbot(%s, %s)', current_setting('t.lead'), current_setting('t.bot')),
  '23514', 'no manual start either');
select public.accept_unsorted(current_setting('t.lead')::bigint);
select tests.logout();
select tests.assert((tests.session(current_setting('t.lead')::bigint)).trigger = 'new_lead'
  and (tests.session(current_setting('t.lead')::bigint)).status = 'waiting',
  '«Принять» starts the new-lead bot of the first message');
update public.organization_settings set unsorted_enabled = false where organization_id = current_setting('t.org')::bigint;

select set_config('crm.importing', 'on', true);
select set_config('t.d8', tests.new_deal('Импорт')::text, true);
select tests.message(current_setting('t.d8')::bigint, 'in', 'цена');
select set_config('crm.importing', 'off', true);
select tests.assert((tests.session(current_setting('t.d8')::bigint)).id is null, 'an import starts no bot');

-- Other channels and sources are not the bot's
select set_config('t.d9', (tests.ingest('token-a', '{"transport": "instagram", "chat_id": "asel.ig", "text": "Привет", "contact": {"username": "asel.ig"}}') ->> 'deal_id'), true);
select tests.assert((tests.session(current_setting('t.d9')::bigint)).id is null, 'the new-lead bot is for WhatsApp only');

--
-- Archive stops the bot; a closed deal's session follows the patient
--
select set_config('t.d10', tests.wa('77011110010', 'Здравствуйте')::text, true);
update public.deals set archived_at = now() where id = current_setting('t.d10')::bigint;
select tests.assert((tests.session(current_setting('t.d10')::bigint)).status = 'stopped', 'archiving stops the bot');

-- Reactivation of a refusal: the answer opens a new deal, the session moves there
insert into public.salesbots (organization_id, name, is_active, scenario) values (current_setting('t.org')::bigint, 'Реактивация', true, format($json$
{"start": "ask", "steps": [
  {"id": "ask", "type": "send_message", "text": "Вопрос ещё актуален?", "next": "wait"},
  {"id": "wait", "type": "wait_reply", "timeout_minutes": 1440, "next": "cond", "timeout_next": "end"},
  {"id": "cond", "type": "condition", "branches": [{"match": "keywords", "value": "да", "next": "yes"}], "else_next": "end"},
  {"id": "yes", "type": "set", "actions": [{"kind": "stage", "stage_id": %1$s}], "next": "hand"},
  {"id": "hand", "type": "handoff"},
  {"id": "end", "type": "stop"}
]}
$json$, tests.stage('В работе'))::jsonb);
select set_config('t.d11', tests.wa('77011110011', 'Здравствуйте')::text, true);
select tests.login_as(current_setting('t.owner')::uuid);
select public.stop_salesbot(current_setting('t.d11')::bigint);
select tests.logout();
update public.deals set stage_id = tests.stage('Отказ'), lost_reason_id = (select id from public.lost_reasons where organization_id = current_setting('t.org')::bigint limit 1)
where id = current_setting('t.d11')::bigint;
select private.salesbot_start((select id from public.salesbots where name = 'Реактивация'), current_setting('t.d11')::bigint, 'manual');
select set_config('t.d12', tests.wa('77011110011', 'Да, актуально')::text, true);
select tests.assert(current_setting('t.d12') <> current_setting('t.d11'), 'the answer opened a new deal');
select tests.assert((tests.session(current_setting('t.d12')::bigint)).bot_name = 'Реактивация'
  and (tests.session(current_setting('t.d12')::bigint)).status = 'handed_off'
  and tests.deal_stage(current_setting('t.d12')::bigint) = 'В работе',
  'the reactivation session followed the patient to the new deal and moved it');

--
-- Loop protection: 50 steps per activation, 30 messages per session
--
insert into public.salesbots (organization_id, name, is_active, scenario) values
  (current_setting('t.org')::bigint, 'Петля', true, format(
    '{"start": "a", "steps": [{"id": "a", "type": "condition", "branches": [{"match": "tag", "tag_id": %s, "next": "a"}], "else_next": "b"}, {"id": "b", "type": "set", "actions": [{"kind": "tag_add", "tag_id": %s}], "next": "a"}]}',
    current_setting('t.tag_pain'), current_setting('t.tag_pain'))::jsonb),
  (current_setting('t.org')::bigint, 'Болтун', true,
    '{"start": "a", "steps": [{"id": "a", "type": "send_message", "text": "Раз", "next": "b"}, {"id": "b", "type": "send_message", "text": "Два", "next": "a"}]}');
select set_config('t.d13', tests.new_deal('Петля')::text, true);
select private.salesbot_start((select id from public.salesbots where name = 'Петля'), current_setting('t.d13')::bigint, 'manual');
select tests.assert((tests.session(current_setting('t.d13')::bigint)).status = 'failed'
  and (tests.session(current_setting('t.d13')::bigint)).stopped_reason like 'Слишком много шагов%', 'a loop stops after 50 steps');
select set_config('t.d14', tests.new_deal('Болтун')::text, true);
select private.salesbot_start((select id from public.salesbots where name = 'Болтун'), current_setting('t.d14')::bigint, 'manual');
select tests.assert((tests.session(current_setting('t.d14')::bigint)).status = 'failed'
  and (tests.session(current_setting('t.d14')::bigint)).messages_sent = 30
  and cardinality(tests.queued(current_setting('t.d14')::bigint)) = 30, 'a session sends 30 messages at most');

--
-- Webhook step: fire-and-forget through the stage 20 queue
--
insert into public.webhooks (organization_id, name, url, events) values (current_setting('t.org')::bigint, 'МИС', 'https://example.com/hook', '{}');
insert into public.salesbots (organization_id, name, is_active, scenario) values (current_setting('t.org')::bigint, 'Вебхук', true, format(
  '{"start": "a", "steps": [{"id": "a", "type": "webhook", "webhook_id": %s}]}',
  (select id from public.webhooks where name = 'МИС'))::jsonb);
select set_config('t.d15', tests.new_deal('Вебхук')::text, true);
select private.salesbot_start((select id from public.salesbots where name = 'Вебхук'), current_setting('t.d15')::bigint, 'manual');
select tests.assert(
  (select d.event = 'salesbot' and d.payload -> 'data' -> 'salesbot' ->> 'name' = 'Вебхук'
     and (d.payload -> 'data' ->> 'deal_id')::bigint = current_setting('t.d15')::bigint
   from public.webhook_deliveries d join public.webhooks w on w.id = d.webhook_id where w.name = 'МИС'),
  'the webhook step queues a delivery with the deal');

--
-- Rights and isolation of the sessions
--
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(tests.count(format('select * from public.salesbot_logs where deal_id = %s', current_setting('t.d1'))) > 0,
  'managers read the log of the deals they see');
select tests.logout();
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.count('select * from public.salesbot_sessions') = 0 and tests.count('select * from public.salesbot_logs') = 0,
  'another clinic sees none of our sessions');
select tests.throws(format('select public.start_salesbot(%s, %s)', current_setting('t.d1'), current_setting('t.bot')),
  '42501', 'another clinic cannot start a bot on our deal');
select tests.throws(format('select public.stop_salesbot(%s)', current_setting('t.d1')), '42501', 'nor stop one');
insert into public.salesbots (name, is_active, scenario) values ('Чужой', true, '{"start": "a", "steps": [{"id": "a", "type": "stop"}]}');
select tests.logout();
select set_config('t.alien', (select id from public.salesbots where name = 'Чужой')::text, true);
select tests.login_as(current_setting('t.owner')::uuid);
select tests.throws(format('select public.start_salesbot(%s, %s)', current_setting('t.d15'), current_setting('t.alien')),
  '22023', 'a bot of another clinic cannot run on our deal');
select tests.logout();

rollback;

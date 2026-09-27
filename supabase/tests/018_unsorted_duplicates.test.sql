--
-- Stage 18: «Неразобранное» (unsorted leads of the system channels, accept,
-- reject, merge into a deal) and duplicate patients (detection by phone,
-- chat, name and birth date; merge of two patients).
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.manager', tests.invite('admin@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.manager_id', (select id from public.sales where user_id = current_setting('t.manager')::uuid)::text, true);
select set_config('t.head_id', (select id from public.sales where user_id = current_setting('t.head')::uuid)::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);
select set_config('t.other_org', tests.org_of(current_setting('t.other')::uuid)::text, true);

insert into public.messenger_integrations (organization_id, api_key, webhook_token, connected_at)
values (current_setting('t.org')::bigint, 'key-a', 'token-a', now()),
       (current_setting('t.other_org')::bigint, 'key-b', 'token-b', now());
insert into public.lead_integrations (organization_id, token)
values (current_setting('t.org')::bigint, 'lead-token-a');
insert into public.telephony_integrations (organization_id, provider, webhook_token)
values (current_setting('t.org')::bigint, 'generic', 'call-token-a');

create function tests.ingest(token text, message jsonb) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  execute 'set local role service_role';
  result := public.ingest_message(token, message);
  execute 'reset role';
  return result;
end;
$$;
create function tests.lead(token text, lead jsonb) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  execute 'set local role service_role';
  result := public.ingest_lead(token, lead);
  execute 'reset role';
  return result;
end;
$$;
create function tests.call(token text, call jsonb) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  execute 'set local role service_role';
  result := public.ingest_call(token, 'generic', call);
  execute 'reset role';
  return result;
end;
$$;
create function tests.stage(org bigint, stage_name text) returns bigint language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
  where p.organization_id = org and p.is_default and s.name = stage_name
$$;
create function tests.source(org bigint, source_code text) returns bigint language sql as $$
  select id from public.lead_sources where organization_id = org and code = source_code
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- Round robin to the manager; the greeting auto-message of the first stage on
update public.organization_settings
set lead_distribution = 'round_robin',
    lead_distribution_sales_ids = array[current_setting('t.manager_id')::bigint]
where organization_id = current_setting('t.org')::bigint;
update public.automessage_rules r set is_active = true
from public.message_templates t
where t.id = r.template_id and t.name = 'Приветствие' and r.organization_id = current_setting('t.org')::bigint;

--
-- Off (default): a new request goes straight to work, as before
--
select tests.assert(
  (select not unsorted_enabled and unsorted_source_ids = '{}' from public.organization_settings
   where organization_id = current_setting('t.org')::bigint),
  'unsorted leads are off by default');
select set_config('t.r0', tests.ingest('token-a', '{"transport":"whatsapp","chat_id":"77010000001","external_id":"u0","text":"Добрый день"}')::text, true);
select set_config('t.plain', current_setting('t.r0')::jsonb ->> 'deal_id', true);
select tests.assert(
  (select unsorted_at is null and sales_id = current_setting('t.manager_id')::bigint
   from public.deals where id = current_setting('t.plain')::bigint),
  'off: the new deal is distributed and not unsorted');
select tests.assert(
  (select count(*) from public.tasks where deal_id = current_setting('t.plain')::bigint) = 1
  and (select count(*) from public.automessages where deal_id = current_setting('t.plain')::bigint) = 1,
  'off: the task rules and the auto-messages run');

--
-- The setting: owner and head only
--
select tests.login_as(current_setting('t.manager')::uuid);
select tests.assert(
  tests.affected('update public.organization_settings set unsorted_enabled = true') = 0,
  'a manager cannot switch unsorted leads on');
select tests.logout();
select tests.login_as(current_setting('t.head')::uuid);
select tests.assert(
  tests.affected('update public.organization_settings set unsorted_enabled = true') = 1,
  'the head switches unsorted leads on');
select tests.logout();
select tests.assert(
  (select count(*) from public.audit_log where organization_id = current_setting('t.org')::bigint
     and entity = 'settings' and changes ? 'unsorted_enabled') = 1,
  'the setting change is in the audit log');

--
-- On: a message of a new contact opens an unsorted lead
--
select set_config('t.r1', tests.ingest('token-a', '{"transport":"whatsapp","chat_id":"77010000002","external_id":"u1","text":"Сколько стоит чистка?","contact":{"name":"Асель"}}')::text, true);
select set_config('t.lead1', current_setting('t.r1')::jsonb ->> 'deal_id', true);
select set_config('t.lead1_patient', current_setting('t.r1')::jsonb ->> 'patient_id', true);
select tests.assert(
  (select unsorted_at is not null and sales_id is null and stage_id = tests.stage(organization_id, 'Новый лид')
   from public.deals where id = current_setting('t.lead1')::bigint),
  'on: the lead is unsorted, not distributed, at the first stage');
select tests.assert(
  (select count(*) from public.tasks where deal_id = current_setting('t.lead1')::bigint) = 0,
  'on: no automatic task while unsorted');
select tests.assert(
  (select count(*) from public.automessages where deal_id = current_setting('t.lead1')::bigint) = 0,
  'on: no auto-message while unsorted');
select tests.assert(
  (select count(*) from public.deals_waiting where id = current_setting('t.lead1')::bigint) = 0,
  'on: an unsorted lead is not «waiting for an answer»');
update public.messages set sent_at = now() - interval '3 hours' where external_id = 'u1';
update public.organization_settings set response_hours_start = 0, response_hours_end = 24
where organization_id = current_setting('t.org')::bigint;
select private.notify_response_overdue();
select tests.assert(
  (select count(*) from public.response_alerts where deal_id = current_setting('t.lead1')::bigint) = 0,
  'on: no response alert for an unsorted lead');
select tests.ingest('token-a', '{"transport":"whatsapp","chat_id":"77010000002","external_id":"u1b","text":"И отбеливание"}');
select tests.assert(
  (select count(*) from public.messages where deal_id = current_setting('t.lead1')::bigint) = 2,
  'the next message joins the unsorted lead');
select tests.assert(
  (select channel = 'whatsapp' and first_text = 'Сколько стоит чистка?' and nb_messages = 2
     and patient_first_name = 'Асель'
   from public.unsorted_leads where id = current_setting('t.lead1')::bigint),
  'the column shows the channel and the first message');
select tests.assert(
  (select unsorted_at is not null from public.deals_summary where id = current_setting('t.lead1')::bigint),
  'deals_summary shows the flag');

-- Per source: only WhatsApp is sorted by hand, a website form goes to work
update public.organization_settings
set unsorted_source_ids = array[tests.source(current_setting('t.org')::bigint, 'whatsapp')]
where organization_id = current_setting('t.org')::bigint;
select set_config('t.r2', tests.lead('lead-token-a', '{"name":"Ержан","phone":"87010000003","comment":"Хочу на консультацию"}')::text, true);
select tests.assert(
  (select unsorted_at is null and sales_id = current_setting('t.manager_id')::bigint
   from public.deals where id = (current_setting('t.r2')::jsonb ->> 'deal_id')::bigint),
  'a source outside the list goes straight to work');
update public.organization_settings set unsorted_source_ids = '{}'
where organization_id = current_setting('t.org')::bigint;
select set_config('t.r3', tests.lead('lead-token-a', '{"name":"Мадина","phone":"87010000004","comment":"Нужен имплант"}')::text, true);
select set_config('t.lead3', current_setting('t.r3')::jsonb ->> 'deal_id', true);
select tests.assert(
  (select unsorted_at is not null and sales_id is null from public.deals where id = current_setting('t.lead3')::bigint)
  and (select channel = 'form' and first_text like '%Нужен имплант%' from public.unsorted_leads where id = current_setting('t.lead3')::bigint),
  'a website form opens an unsorted lead (all sources)');

-- A missed incoming call opens one too; an outgoing one does not
select set_config('t.r4', tests.call('call-token-a', '{"call_id":"c1","direction":"in","phone":"87010000005","status":"missed"}')::text, true);
select set_config('t.lead4', current_setting('t.r4')::jsonb ->> 'deal_id', true);
select tests.assert(
  (select unsorted_at is not null from public.deals where id = current_setting('t.lead4')::bigint)
  and (select channel = 'call' from public.unsorted_leads where id = current_setting('t.lead4')::bigint),
  'an incoming call opens an unsorted lead');
select set_config('t.r5', tests.call('call-token-a', '{"call_id":"c2","direction":"out","phone":"87010000006","status":"answered"}')::text, true);
select tests.assert(
  (select unsorted_at is null from public.deals where id = (current_setting('t.r5')::jsonb ->> 'deal_id')::bigint),
  'an outgoing call does not');

-- A deal created by an employee is never unsorted, a deal never goes back
select tests.login_as(current_setting('t.manager')::uuid);
select tests.assert(
  (select unsorted_at is null from public.deals where id = current_setting('t.plain')::bigint), 'sanity');
update public.deals set unsorted_at = now() where id = current_setting('t.plain')::bigint;
select tests.assert(
  (select unsorted_at is null from public.deals where id = current_setting('t.plain')::bigint),
  'a sorted deal cannot go back to «Неразобранное»');
select tests.logout();

--
-- Accept: the automations of a new deal
--
select tests.login_as(current_setting('t.manager')::uuid);
select public.accept_unsorted(current_setting('t.lead1')::bigint);
select tests.logout();
select tests.assert(
  (select unsorted_at is null and sales_id = current_setting('t.manager_id')::bigint
     and stage_id = tests.stage(organization_id, 'Новый лид')
   from public.deals where id = current_setting('t.lead1')::bigint),
  'accept: default stage and responsible by the distribution rule');
select tests.assert(
  (select count(*) from public.tasks where deal_id = current_setting('t.lead1')::bigint
     and text = 'Связаться с пациентом по новому обращению' and sales_id = current_setting('t.manager_id')::bigint) = 1,
  'accept: the task rules run');
select tests.assert(
  (select count(*) from public.automessages where deal_id = current_setting('t.lead1')::bigint and status = 'pending') = 1,
  'accept: the auto-messages of the stage are queued');
select tests.assert(
  (select count(*) from public.deal_events where deal_id = current_setting('t.lead1')::bigint
     and type = 'updated' and changes ? 'unsorted_at' and changes ? 'sales_id') = 1,
  'accept: the deal log shows it');
select tests.assert(
  (select count(*) from public.notifications where deal_id = current_setting('t.lead1')::bigint
     and kind = 'lead_assigned') = 0,
  'accept: the employee who takes the lead is not notified of their own action');
select tests.login_as(current_setting('t.manager')::uuid);
select tests.throws(format('select public.accept_unsorted(%s)', current_setting('t.lead1')), '23514', 'a lead is accepted once');
select tests.logout();

-- Accept into a chosen stage with a chosen responsible (checklists do not block)
insert into public.stage_checklist_items (organization_id, stage_id, text)
values (current_setting('t.org')::bigint, tests.stage(current_setting('t.org')::bigint, 'Новый лид'), 'Уточнить услугу');
select tests.login_as(current_setting('t.owner')::uuid);
select tests.throws(
  format('select public.accept_unsorted(%s, %s)', current_setting('t.lead3'), tests.stage(current_setting('t.org')::bigint, 'Отказ')),
  '23514', 'accept needs an open stage');
select public.accept_unsorted(current_setting('t.lead3')::bigint,
  tests.stage(current_setting('t.org')::bigint, 'Записан'), current_setting('t.head_id')::bigint);
select tests.logout();
select tests.assert(
  (select unsorted_at is null and sales_id = current_setting('t.head_id')::bigint
     and stage_id = tests.stage(organization_id, 'Записан')
   from public.deals where id = current_setting('t.lead3')::bigint),
  'accept: chosen stage and responsible');
select tests.assert(
  (select count(*) from public.tasks where deal_id = current_setting('t.lead3')::bigint
     and text = 'Связаться с пациентом по новому обращению' and sales_id = current_setting('t.head_id')::bigint) = 1,
  'accept: the new deal task goes to the chosen responsible');
select tests.assert(
  (select count(*) from public.notifications where deal_id = current_setting('t.lead3')::bigint
     and kind = 'lead_assigned' and sales_id = current_setting('t.head_id')::bigint) = 1,
  'accept: the chosen responsible is notified');

--
-- Reject: lost, «Спам / не целевое», open tasks done
--
select set_config('t.reasons', (select count(*) from public.lost_reasons where organization_id = current_setting('t.org')::bigint)::text, true);
select tests.assert(
  (select count(*) from public.tasks where deal_id = current_setting('t.lead4')::bigint and text = 'Перезвонить' and done_date is null) = 1,
  'the missed call left a call-back task');
select tests.login_as(current_setting('t.manager')::uuid);
select public.reject_unsorted(current_setting('t.lead4')::bigint, 'Ошиблись номером');
select tests.logout();
select tests.assert(
  (select d.unsorted_at is null and s.kind = 'lost' and r.name = 'Спам / не целевое' and r.code = 'spam'
     and d.lost_comment = 'Ошиблись номером' and d.closed_at is not null
   from public.deals d join public.stages s on s.id = d.stage_id join public.lost_reasons r on r.id = d.lost_reason_id
   where d.id = current_setting('t.lead4')::bigint),
  'reject: lost with the system reason');
select tests.assert(
  (select count(*) from public.lost_reasons where organization_id = current_setting('t.org')::bigint)
    = current_setting('t.reasons')::bigint + 1,
  'reject: the reason is added to the dictionary once');
select tests.assert(
  (select count(*) from public.tasks where deal_id = current_setting('t.lead4')::bigint and done_date is null) = 0
  and (select count(*) from public.automessages where deal_id = current_setting('t.lead4')::bigint) = 0,
  'reject: open tasks done, no auto-message of the lost stage');
select set_config('t.r6', tests.ingest('token-a', '{"transport":"telegram","chat_id":"tg-600","external_id":"u6","text":"Реклама","contact":{"name":"Спамер"}}')::text, true);
select tests.login_as(current_setting('t.owner')::uuid);
select public.reject_unsorted((current_setting('t.r6')::jsonb ->> 'deal_id')::bigint);
select tests.logout();
select tests.assert(
  (select count(*) from public.lost_reasons where organization_id = current_setting('t.org')::bigint and code = 'spam') = 1,
  'reject: the system reason is reused');

-- Moving an unsorted lead to a stage by hand accepts it
select set_config('t.r7', tests.ingest('token-a', '{"transport":"whatsapp","chat_id":"77010000007","external_id":"u7","text":"Запишите меня"}')::text, true);
select tests.login_as(current_setting('t.manager')::uuid);
update public.deals set stage_id = tests.stage(organization_id, 'В работе'), sales_id = current_setting('t.manager_id')::bigint
where id = (current_setting('t.r7')::jsonb ->> 'deal_id')::bigint;
select tests.logout();
select tests.assert(
  (select unsorted_at is null from public.deals where id = (current_setting('t.r7')::jsonb ->> 'deal_id')::bigint)
  and (select count(*) from public.tasks where deal_id = (current_setting('t.r7')::jsonb ->> 'deal_id')::bigint
         and text = 'Связаться с пациентом по новому обращению') = 1,
  'moving a lead to a stage accepts it with the automations');

--
-- Merge a lead into an open deal
--
-- Of another patient: a new Instagram contact who is a known patient
select set_config('t.known', (select patient_id::text from public.deals where id = current_setting('t.lead1')::bigint), true);
select set_config('t.r8', tests.ingest('token-a', '{"transport":"instagram","chat_id":"ig-800","external_id":"u8","text":"Это Асель, писала в WhatsApp","contact":{"username":"asel_ig"}}')::text, true);
select set_config('t.lead8', current_setting('t.r8')::jsonb ->> 'deal_id', true);
select set_config('t.lead8_patient', current_setting('t.r8')::jsonb ->> 'patient_id', true);
insert into public.deal_notes (organization_id, deal_id, text) values (current_setting('t.org')::bigint, current_setting('t.lead8')::bigint, 'Заметка заявки');
insert into public.calls (organization_id, patient_id, deal_id, direction, sales_id)
values (current_setting('t.org')::bigint, current_setting('t.lead8_patient')::bigint, current_setting('t.lead8')::bigint, 'in', null);
select tests.login_as(current_setting('t.other')::uuid);
select tests.throws(format('select public.merge_unsorted(%s, %s)', current_setting('t.lead8'), current_setting('t.lead1')),
  'P0002', 'another clinic cannot merge the lead');
select tests.throws(format('select public.accept_unsorted(%s)', current_setting('t.lead8')), 'P0002', 'another clinic cannot accept the lead');
select tests.throws(format('select public.reject_unsorted(%s)', current_setting('t.lead8')), 'P0002', 'another clinic cannot reject the lead');
select tests.assert((select count(*) from public.unsorted_leads) = 0, 'another clinic sees none of the unsorted leads');
select tests.logout();
select tests.login_as(current_setting('t.manager')::uuid);
select tests.throws(format('select public.merge_unsorted(%s, %s)', current_setting('t.lead8'), current_setting('t.lead4')),
  '23514', 'a lead is merged into an open deal only');
select set_config('t.m8', public.merge_unsorted(current_setting('t.lead8')::bigint, current_setting('t.lead1')::bigint)::text, true);
select tests.logout();
select tests.assert(not exists (select 1 from public.deals where id = current_setting('t.lead8')::bigint), 'merge: the lead is deleted');
select tests.assert(
  (select count(*) from public.messages where deal_id = current_setting('t.lead1')::bigint
     and patient_id = current_setting('t.known')::bigint and external_id = 'u8') = 1
  and (select count(*) from public.deal_notes where deal_id = current_setting('t.lead1')::bigint and text = 'Заметка заявки') = 1
  and (select count(*) from public.calls where deal_id = current_setting('t.lead1')::bigint and patient_id = current_setting('t.known')::bigint) = 1,
  'merge: messages, notes and calls go to the deal and its patient');
select tests.assert(
  (current_setting('t.m8')::jsonb ->> 'merged_patient_id')::bigint = current_setting('t.lead8_patient')::bigint
  and not exists (select 1 from public.patients where id = current_setting('t.lead8_patient')::bigint)
  and (select patient_id from public.patient_chats where chat_id = 'ig-800') = current_setting('t.known')::bigint,
  'merge: the contact left without deals joins the deal''s patient');
select tests.ingest('token-a', '{"transport":"instagram","chat_id":"ig-800","external_id":"u8b","text":"Спасибо"}');
select tests.assert(
  (select deal_id from public.messages where external_id = 'u8b') = current_setting('t.lead1')::bigint,
  'the next message of that chat reaches the deal');

-- Of the same patient (the patient stays)
insert into public.deals (organization_id, patient_id, unsorted_at)
values (current_setting('t.org')::bigint, current_setting('t.known')::bigint, now());
select set_config('t.lead9', (select max(id)::text from public.deals where organization_id = current_setting('t.org')::bigint), true);
insert into public.deal_notes (organization_id, deal_id, text, type) values (current_setting('t.org')::bigint, current_setting('t.lead9')::bigint, 'Заявка (Сайт)', 'lead');
select tests.login_as(current_setting('t.head')::uuid);
select set_config('t.m9', public.merge_unsorted(current_setting('t.lead9')::bigint, current_setting('t.lead1')::bigint)::text, true);
select tests.logout();
select tests.assert(
  (current_setting('t.m9')::jsonb ->> 'merged_patient_id') is null
  and exists (select 1 from public.patients where id = current_setting('t.known')::bigint)
  and (select count(*) from public.deal_notes where deal_id = current_setting('t.lead1')::bigint and text = 'Заявка (Сайт)') = 1,
  'merge within the same patient keeps the patient');

-- Visibility: a manager who only sees their own deals cannot take an unassigned lead
select set_config('t.r10', tests.ingest('token-a', '{"transport":"whatsapp","chat_id":"77010000010","external_id":"u10","text":"Здравствуйте"}')::text, true);
update public.organization_settings set manager_deal_visibility = 'own' where organization_id = current_setting('t.org')::bigint;
select tests.login_as(current_setting('t.manager')::uuid);
select tests.assert(
  (select count(*) from public.unsorted_leads where id = (current_setting('t.r10')::jsonb ->> 'deal_id')::bigint) = 0,
  'own visibility: the manager does not see unassigned leads');
select tests.throws(format('select public.accept_unsorted(%s)', current_setting('t.r10')::jsonb ->> 'deal_id'), 'P0002', 'own visibility: cannot accept');
select tests.throws(format('select public.merge_unsorted(%s, %s)', current_setting('t.r10')::jsonb ->> 'deal_id', current_setting('t.lead1')),
  'P0002', 'own visibility: cannot merge');
select tests.logout();
update public.organization_settings set manager_deal_visibility = 'all' where organization_id = current_setting('t.org')::bigint;

select tests.login_anon();
select tests.throws(format('select public.accept_unsorted(%s)', current_setting('t.r10')::jsonb ->> 'deal_id'), '42501', 'anonymous: no accept');
select tests.throws('select * from public.duplicate_groups()', '42501', 'anonymous: no duplicates');
select tests.logout();

--
-- Duplicates: detection by each criterion
--
insert into public.patients (organization_id, first_name, last_name, phone_jsonb)
values (current_setting('t.org')::bigint, 'Даулет', 'Ахметов', '[{"number":"8 701 777 11 22"}]'),
       (current_setting('t.org')::bigint, 'Даулет', '', '[{"number":"+7 (701) 777-11-22"}]');
select set_config('t.p_phone1', (select id::text from public.patients where organization_id = current_setting('t.org')::bigint and last_name = 'Ахметов'), true);
select set_config('t.p_phone2', (select id::text from public.patients where organization_id = current_setting('t.org')::bigint and phones = array['+77017771122'] and last_name = ''), true);

insert into public.patients (organization_id, first_name, last_name, telegram)
values (current_setting('t.org')::bigint, 'Мария', 'Ким', '@Maria_Kim');
select set_config('t.p_chat1', (select id::text from public.patients where organization_id = current_setting('t.org')::bigint and last_name = 'Ким'), true);
insert into public.patients (organization_id, first_name) values (current_setting('t.org')::bigint, 'maria_kim');
select set_config('t.p_chat2', (select max(id)::text from public.patients where organization_id = current_setting('t.org')::bigint and first_name = 'maria_kim'), true);
insert into public.patient_chats (organization_id, patient_id, transport, chat_id, username)
values (current_setting('t.org')::bigint, current_setting('t.p_chat2')::bigint, 'telegram_bot', '555001', 'maria_kim');

insert into public.patients (organization_id, first_name, last_name, middle_name, birth_date)
values (current_setting('t.org')::bigint, 'Алия', 'Сейтжанова', 'Ерлановна', '1990-05-12'),
       (current_setting('t.org')::bigint, ' алия ', 'СЕЙТЖАНОВА', 'Ерлановна', '1990-05-12'),
       (current_setting('t.org')::bigint, 'Алия', 'Сейтжанова', 'Ерлановна', '1991-05-12');
select set_config('t.p_name1', (select min(id)::text from public.patients where organization_id = current_setting('t.org')::bigint and last_name ilike 'сейтжанова' and birth_date = '1990-05-12'), true);
select set_config('t.p_name2', (select max(id)::text from public.patients where organization_id = current_setting('t.org')::bigint and last_name ilike 'сейтжанова' and birth_date = '1990-05-12'), true);
select set_config('t.p_name3', (select id::text from public.patients where organization_id = current_setting('t.org')::bigint and last_name = 'Сейтжанова' and birth_date = '1991-05-12'), true);
-- A third one linked to the name pair by a phone: one group of three
update public.patients set phone_jsonb = '[{"number":"87012223344"}]' where id = current_setting('t.p_name2')::bigint;
insert into public.patients (organization_id, first_name, phone_jsonb)
values (current_setting('t.org')::bigint, 'Алия (звонок)', '[{"number":"87012223344"}]');
select set_config('t.p_name4', (select id::text from public.patients where organization_id = current_setting('t.org')::bigint and first_name = 'Алия (звонок)'), true);

-- The other clinic has the same phone: never a duplicate across clinics
insert into public.patients (organization_id, first_name, phone_jsonb)
values (current_setting('t.other_org')::bigint, 'Чужой', '[{"number":"87017771122"}]');

select tests.login_as(current_setting('t.manager')::uuid);
select tests.assert(
  (select reasons = array['phone'] from public.patient_duplicates(current_setting('t.p_phone1')::bigint)
   where patient_id = current_setting('t.p_phone2')::bigint)
  and (select count(*) from public.patient_duplicates(current_setting('t.p_phone1')::bigint)) = 1,
  'duplicate by phone (any format), not across clinics');
select tests.assert(
  (select reasons = array['chat'] from public.patient_duplicates(current_setting('t.p_chat1')::bigint)
   where patient_id = current_setting('t.p_chat2')::bigint),
  'duplicate by Telegram username (patient handle vs bot chat)');
select tests.assert(
  (select reasons = array['name_birth'] from public.patient_duplicates(current_setting('t.p_name1')::bigint)
   where patient_id = current_setting('t.p_name2')::bigint)
  and not exists (select 1 from public.patient_duplicates(current_setting('t.p_name1')::bigint)
                  where patient_id = current_setting('t.p_name3')::bigint),
  'duplicate by full name and birth date (case and spaces ignored), not with another birth date');
select tests.assert(
  (select count(distinct group_id) from public.duplicate_groups()
   where patient_id in (current_setting('t.p_name1')::bigint, current_setting('t.p_name2')::bigint, current_setting('t.p_name4')::bigint)) = 1
  and (select count(*) from public.duplicate_groups()
       where group_id = current_setting('t.p_name1')::bigint) = 3,
  'duplicate groups join the patients linked through another one');
select tests.assert(
  (select count(distinct group_id) from public.duplicate_groups()) = 3,
  'the manager sees the three groups of the clinic');
select tests.logout();

select tests.login_as(current_setting('t.other')::uuid);
select tests.assert((select count(*) from public.duplicate_groups()) = 0, 'another clinic sees none of these groups');
select tests.assert(
  (select count(*) from public.patient_duplicates(current_setting('t.p_phone1')::bigint)) = 0,
  'another clinic cannot probe a patient of this clinic');
select tests.logout();

--
-- Merge two patients
--
-- Rows of the patient to merge (p_phone2): a deal with a task, a payment and
-- a message, a note, a chat, a call, a mailing row, a recall, an external
-- reference, a lead submission, a notification
insert into public.deals (organization_id, patient_id, sales_id, name)
values (current_setting('t.org')::bigint, current_setting('t.p_phone2')::bigint, current_setting('t.manager_id')::bigint, 'Дубль: сделка');
select set_config('t.dup_deal', (select id::text from public.deals where organization_id = current_setting('t.org')::bigint and name = 'Дубль: сделка'), true);
insert into public.deal_payments (organization_id, deal_id, amount) values (current_setting('t.org')::bigint, current_setting('t.dup_deal')::bigint, 5000);
insert into public.patient_notes (organization_id, patient_id, text) values (current_setting('t.org')::bigint, current_setting('t.p_phone2')::bigint, 'Аллергия на лидокаин');
insert into public.patient_chats (organization_id, patient_id, transport, chat_id)
values (current_setting('t.org')::bigint, current_setting('t.p_phone2')::bigint, 'whatsapp', '77017771122');
insert into public.messages (organization_id, patient_id, deal_id, transport, chat_id, direction, text, status)
values (current_setting('t.org')::bigint, current_setting('t.p_phone2')::bigint, current_setting('t.dup_deal')::bigint, 'whatsapp', '77017771122', 'in', 'Привет', 'inbound');
insert into public.calls (organization_id, patient_id, direction) values (current_setting('t.org')::bigint, current_setting('t.p_phone2')::bigint, 'out');
insert into public.mailings (organization_id, name, body, status) values (current_setting('t.org')::bigint, 'Акция', 'Скидка', 'done');
insert into public.mailing_messages (organization_id, mailing_id, patient_id, body, status)
select current_setting('t.org')::bigint, m.id, p.id, 'Скидка', 'sent'
from public.mailings m, (values (current_setting('t.p_phone1')::bigint), (current_setting('t.p_phone2')::bigint)) as p(id)
where m.name = 'Акция' and m.organization_id = current_setting('t.org')::bigint
on conflict (mailing_id, patient_id) where mailing_id is not null do nothing;
insert into public.recalls (organization_id, deal_id, patient_id, due_at, status)
values (current_setting('t.org')::bigint, current_setting('t.dup_deal')::bigint, current_setting('t.p_phone2')::bigint, now(), 'skipped');
insert into public.external_refs (organization_id, entity, entity_id, system, external_id)
values (current_setting('t.org')::bigint, 'patient', current_setting('t.p_phone2')::bigint, 'amocrm', 'contact-42');
insert into public.lead_submissions (organization_id, phone, payload_hash, patient_id, deal_id)
values (current_setting('t.org')::bigint, '+77017771122', 'h', current_setting('t.p_phone2')::bigint, current_setting('t.dup_deal')::bigint);
select private.add_notification(current_setting('t.org')::bigint, current_setting('t.manager_id')::bigint, 'patient_message', 'Новое сообщение', 'Привет',
  current_setting('t.dup_deal')::bigint, current_setting('t.p_phone2')::bigint, null);
insert into public.tags (organization_id, name, color) values (current_setting('t.org')::bigint, 'VIP', '#fff'), (current_setting('t.org')::bigint, 'Имплант', '#000');
update public.patients set tags = array[(select id from public.tags where organization_id = current_setting('t.org')::bigint and name = 'VIP')], birth_date = '1985-01-02',
  background = 'Пришёл по рекомендации', sales_id = current_setting('t.manager_id')::bigint, city = 'Алматы',
  phone_jsonb = phone_jsonb || '[{"number":"87051234567"}]'
where id = current_setting('t.p_phone2')::bigint;
update public.patients set tags = array[(select id from public.tags where organization_id = current_setting('t.org')::bigint and name = 'Имплант')], sales_id = current_setting('t.head_id')::bigint
where id = current_setting('t.p_phone1')::bigint;

-- Rights
select tests.login_as(current_setting('t.manager')::uuid);
select tests.throws(format('select public.merge_patients(%s, %s)', current_setting('t.p_phone1'), current_setting('t.p_phone2')),
  '42501', 'a manager cannot merge patients');
select tests.logout();
select tests.login_as(current_setting('t.other')::uuid);
select tests.throws(format('select public.merge_patients(%s, %s)', current_setting('t.p_phone1'), current_setting('t.p_phone2')),
  'P0002', 'another clinic cannot merge these patients');
select tests.logout();
select tests.login_as(current_setting('t.head')::uuid);
select tests.throws(format('select public.merge_patients(%s, %s)', current_setting('t.p_phone1'), current_setting('t.p_phone1')),
  '22023', 'a patient is not merged with itself');

-- The head keeps p_phone1 with the other's birth date and responsible
select public.merge_patients(current_setting('t.p_phone1')::bigint, current_setting('t.p_phone2')::bigint,
  '{"name":"keep","birth_date":"merge","responsible":"merge","comment":"merge"}');
select tests.logout();

select tests.assert(not exists (select 1 from public.patients where id = current_setting('t.p_phone2')::bigint), 'merge: the other patient is deleted');
select tests.assert(
  (select last_name = 'Ахметов' and first_name = 'Даулет' and birth_date = '1985-01-02'
     and sales_id = current_setting('t.manager_id')::bigint and background = 'Пришёл по рекомендации' and city = 'Алматы'
     and phones = array['+77017771122', '+77051234567']
     and tags = array[(select id from public.tags where organization_id = current_setting('t.org')::bigint and name = 'Имплант'), (select id from public.tags where organization_id = current_setting('t.org')::bigint and name = 'VIP')]
   from public.patients where id = current_setting('t.p_phone1')::bigint),
  'merge: chosen fields, phones and tags unioned, details completed');
select tests.assert(
  (select count(*) from public.deals where patient_id = current_setting('t.p_phone1')::bigint and name = 'Дубль: сделка') = 1
  and (select paid_amount from public.deals where id = current_setting('t.dup_deal')::bigint) = 5000
  and (select count(*) from public.patient_notes where patient_id = current_setting('t.p_phone1')::bigint) = 1
  and (select count(*) from public.patient_chats where patient_id = current_setting('t.p_phone1')::bigint) = 1
  and (select count(*) from public.messages where patient_id = current_setting('t.p_phone1')::bigint and text = 'Привет') = 1
  and (select count(*) from public.calls where patient_id = current_setting('t.p_phone1')::bigint) = 1
  and (select count(*) from public.recalls where patient_id = current_setting('t.p_phone1')::bigint) = 1
  and (select count(*) from public.lead_submissions where patient_id = current_setting('t.p_phone1')::bigint) = 1
  -- the inbound message notified the manager too
  and (select count(*) from public.notifications where patient_id = current_setting('t.p_phone1')::bigint and deal_id = current_setting('t.dup_deal')::bigint) = 2
  and (select count(*) from public.external_refs where entity = 'patient' and entity_id = current_setting('t.p_phone1')::bigint) = 1,
  'merge: every related row moves to the kept patient');
select tests.assert(
  (select count(*) from public.mailing_messages where patient_id = current_setting('t.p_phone1')::bigint) = 1,
  'merge: a mailing keeps one row per patient');
select tests.assert(
  (select count(*) from public.audit_log where organization_id = current_setting('t.org')::bigint
     and entity = 'patient' and action = 'merge' and entity_id = current_setting('t.p_phone1')::bigint
     and sales_id = current_setting('t.head_id')::bigint
     and changes -> 'merged_patient_id' = jsonb_build_array(current_setting('t.p_phone2')::bigint, current_setting('t.p_phone1')::bigint)) = 1,
  'merge: an audit row with both ids');
select tests.login_as(current_setting('t.head')::uuid);
select tests.assert(
  (select count(*) from public.patient_duplicates(current_setting('t.p_phone1')::bigint)) = 0,
  'after the merge the pair is no longer a duplicate');
select tests.assert(
  (select count(distinct group_id) from public.duplicate_groups()) = 2,
  'two groups are left');
select tests.logout();

rollback;

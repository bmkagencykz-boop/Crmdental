--
-- Stage 8: requests from the website / Tilda / 2GIS (public.ingest_lead) and
-- the clinic's own Telegram bot (public.ingest_telegram_message).
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.manager', tests.invite('admin@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.manager_id', (select id from public.sales where user_id = current_setting('t.manager')::uuid)::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);
select set_config('t.other_org', tests.org_of(current_setting('t.other')::uuid)::text, true);

create function tests.lead(token text, lead jsonb) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  execute 'set local role service_role';
  result := public.ingest_lead(token, lead);
  execute 'reset role';
  return result;
end;
$$;

create function tests.telegram(token text, secret text, message jsonb) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  execute 'set local role service_role';
  result := public.ingest_telegram_message(token, secret, message);
  execute 'reset role';
  return result;
end;
$$;

--
-- The token: owner and head only
--
select tests.login_as(current_setting('t.owner')::uuid);
select set_config('t.token', public.lead_webhook_token(), true);
select tests.assert(length(current_setting('t.token')) >= 32, 'the owner gets a long random token');
select tests.assert(public.lead_webhook_token() = current_setting('t.token'), 'the token is stable');
select tests.logout();

select tests.login_as(current_setting('t.head')::uuid);
select tests.assert(public.lead_webhook_token() = current_setting('t.token'), 'the head sees the same token');
select tests.logout();

select tests.login_as(current_setting('t.manager')::uuid);
select tests.throws('select public.lead_webhook_token()', '42501', 'employees cannot read the lead token');
select tests.throws('select public.regenerate_lead_webhook_token()', '42501', 'employees cannot change the lead token');
select tests.throws('select * from public.lead_integrations', '42501', 'the token table is not readable');
select tests.throws('select * from public.telegram_bots', '42501', 'the bot table is not readable');
select tests.throws($q$select public.ingest_lead('x', '{}')$q$, '42501', 'employees cannot call the lead webhook function');
select tests.throws($q$select public.ingest_telegram_message('x', 'y', '{}')$q$, '42501', 'employees cannot call the Telegram webhook function');
select tests.logout();

select tests.login_as(current_setting('t.other')::uuid);
select set_config('t.other_token', public.lead_webhook_token(), true);
select tests.assert(current_setting('t.other_token') <> current_setting('t.token'), 'every clinic has its own token');
select tests.logout();

select tests.login_anon();
select tests.throws('select public.lead_webhook_token()', '42501', 'anonymous visitors cannot read tokens');
select tests.logout();

--
-- Bad requests
--
select tests.throws(
  $q$select tests.lead('nope', '{"name":"Х","phone":"87015551234"}')$q$,
  '28000', 'an unknown token is refused');
select tests.throws(
  format('select tests.lead(%L, %L)', current_setting('t.token'), '{"name":"Без телефона"}'),
  '22023', 'a lead without a phone number is refused');
select tests.throws(
  format('select tests.lead(%L, %L)', current_setting('t.token'), '{"phone":"123"}'),
  '22023', 'a lead with a broken phone number is refused');

--
-- A new request: patient + deal + note, distributed by the clinic rules
--
update public.organization_settings
set lead_distribution = 'round_robin',
    lead_distribution_sales_ids = array[current_setting('t.manager_id')::bigint]
where organization_id = current_setting('t.org')::bigint;

select set_config('t.r1', tests.lead(current_setting('t.token'), jsonb_build_object(
  'name', 'Даулет', 'phone', '8 (701) 555-12-34', 'source', '2gis',
  'service', 'имплантация', 'comment', 'Перезвоните после 18:00',
  'utm', jsonb_build_object('utm_source', 'google', 'utm_campaign', 'implants'),
  'utm_medium', 'cpc'))::text, true);
select set_config('t.patient', current_setting('t.r1')::jsonb ->> 'patient_id', true);
select set_config('t.deal', current_setting('t.r1')::jsonb ->> 'deal_id', true);
select tests.assert(
  (current_setting('t.r1')::jsonb ->> 'created_patient')::boolean
  and (current_setting('t.r1')::jsonb ->> 'created_deal')::boolean
  and not (current_setting('t.r1')::jsonb ->> 'duplicate')::boolean,
  'a first request creates the patient and the deal');
select tests.assert(
  (select first_name = 'Даулет' and phones = array['+77015551234']
     and source_id = (select id from public.lead_sources where organization_id = p.organization_id and code = '2gis')
   from public.patients p where id = current_setting('t.patient')::bigint),
  'the patient gets the name, the normalized phone and the source of the form');
select tests.assert(
  (select s.name = 'Новый лид' and p.is_default
     and d.source_id = (select id from public.lead_sources where organization_id = d.organization_id and code = '2gis')
     and d.service_id = (select id from public.services where organization_id = d.organization_id and name = 'Имплантация')
   from public.deals d join public.stages s on s.id = d.stage_id join public.pipelines p on p.id = d.pipeline_id
   where d.id = current_setting('t.deal')::bigint),
  'the deal starts at the first stage of the default pipeline with the source and the service');
select tests.assert(
  (select sales_id from public.deals where id = current_setting('t.deal')::bigint) = current_setting('t.manager_id')::bigint,
  'the clinic''s distribution assigns the new request');
select tests.assert(
  (select count(*) from public.tasks where deal_id = current_setting('t.deal')::bigint
     and text = 'Связаться с пациентом по новому обращению' and sales_id = current_setting('t.manager_id')::bigint) = 1,
  'the task rules create the first task for the responsible');
select tests.assert(
  (select text like 'Заявка (2GIS)%' and text like '%Имя: Даулет%' and text like '%Телефон: +77015551234%'
     and text like '%Услуга: имплантация%' and text like '%Комментарий: Перезвоните после 18:00%'
     and text like '%utm_campaign: implants%' and text like '%utm_medium: cpc%' and text like '%utm_source: google%'
     and type = 'lead' and sales_id is null
   from public.deal_notes where id = (current_setting('t.r1')::jsonb ->> 'note_id')::bigint),
  'the note of the deal holds the whole form, UTM tags included');
select tests.assert(
  (select payload -> 'utm' ->> 'utm_medium' = 'cpc' from public.lead_submissions
   where id = (current_setting('t.r1')::jsonb ->> 'lead_id')::bigint),
  'the submission keeps the UTM tags');

-- The same form sent twice: stored once
select set_config('t.r2', tests.lead(current_setting('t.token'), jsonb_build_object(
  'name', 'Даулет', 'phone', '+7 701 555 12 34', 'source', '2gis',
  'service', 'имплантация', 'comment', 'Перезвоните после 18:00',
  'utm', jsonb_build_object('utm_source', 'google', 'utm_campaign', 'implants'),
  'utm_medium', 'cpc'))::text, true);
select tests.assert(
  (current_setting('t.r2')::jsonb ->> 'duplicate')::boolean
  and current_setting('t.r2')::jsonb ->> 'deal_id' = current_setting('t.deal')
  and (select count(*) from public.deal_notes where deal_id = current_setting('t.deal')::bigint) = 1,
  'an identical submission within 5 minutes is ignored');

-- The same form later: a repeat request in the same open deal
update public.lead_submissions set created_at = now() - interval '6 minutes';
select set_config('t.r3', tests.lead(current_setting('t.token'), jsonb_build_object(
  'name', 'Даулет', 'phone', '+7 701 555 12 34', 'source', '2gis',
  'service', 'имплантация', 'comment', 'Перезвоните после 18:00',
  'utm', jsonb_build_object('utm_source', 'google', 'utm_campaign', 'implants'),
  'utm_medium', 'cpc'))::text, true);
select tests.assert(
  not (current_setting('t.r3')::jsonb ->> 'duplicate')::boolean
  and current_setting('t.r3')::jsonb ->> 'deal_id' = current_setting('t.deal'),
  'the same form after 5 minutes is a new request');

-- Another form of the same phone: attached to the open deal with a note
select set_config('t.r4', tests.lead(current_setting('t.token'),
  '{"name":"Даулет","phone":"7015551234","comment":"Можно в субботу?"}')::text, true);
select tests.assert(
  current_setting('t.r4')::jsonb ->> 'deal_id' = current_setting('t.deal')
  and current_setting('t.r4')::jsonb ->> 'patient_id' = current_setting('t.patient')
  and not (current_setting('t.r4')::jsonb ->> 'created_deal')::boolean
  and not (current_setting('t.r4')::jsonb ->> 'created_patient')::boolean,
  'a repeat request of a known phone goes to the open deal');
select tests.assert(
  (select count(*) from public.deal_notes where deal_id = current_setting('t.deal')::bigint) = 3
  and (select text like 'Повторная заявка (Сайт)%' from public.deal_notes where id = (current_setting('t.r4')::jsonb ->> 'note_id')::bigint),
  'every request adds a note to the deal (default source: website)');
select tests.assert((select count(*) from public.deals where patient_id = current_setting('t.patient')::bigint) = 1,
  'no second deal is opened');

-- A patient registered by hand with "8 707..." is found; source by name,
-- unknown service kept in the note only
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.patients (last_name, first_name, phone_jsonb) values ('Каримова', 'Мадина', '[{"number":"8 707 555 00 00"}]');
select tests.logout();
select set_config('t.r5', tests.lead(current_setting('t.token'),
  '{"name":"Мадина","phone":"+7 (707) 555-00-00","source":"сайт","service":"Отбеливание"}')::text, true);
select tests.assert(
  (select last_name from public.patients where id = (current_setting('t.r5')::jsonb ->> 'patient_id')::bigint) = 'Каримова'
  and (current_setting('t.r5')::jsonb ->> 'created_deal')::boolean,
  'a patient without an open deal gets a new deal');
select tests.assert(
  (select d.service_id is null and d.source_id = (select id from public.lead_sources where organization_id = d.organization_id and code = 'website')
   from public.deals d where d.id = (current_setting('t.r5')::jsonb ->> 'deal_id')::bigint),
  'the source is matched by name, an unknown service is left empty');
select tests.assert(
  (select text like '%Услуга: Отбеливание%' from public.deal_notes where id = (current_setting('t.r5')::jsonb ->> 'note_id')::bigint),
  'an unknown service is kept in the note');

-- An unknown source falls back to the website and is written in the note
select set_config('t.r6', tests.lead(current_setting('t.token'),
  '{"name":"Асель","phone":"+77471112233","source":"Лендинг"}')::text, true);
select tests.assert(
  (select d.source_id = (select id from public.lead_sources where organization_id = d.organization_id and code = 'website')
   from public.deals d where d.id = (current_setting('t.r6')::jsonb ->> 'deal_id')::bigint)
  and (select text like '%Источник: Лендинг%' from public.deal_notes where id = (current_setting('t.r6')::jsonb ->> 'note_id')::bigint),
  'an unknown source is the website, the original is in the note');

-- A refused deal is not reopened: new deal (DECISIONS #13)
update public.deals
set stage_id = (select id from public.stages where pipeline_id = deals.pipeline_id and kind = 'lost'),
    lost_reason_id = (select id from public.lost_reasons where organization_id = deals.organization_id limit 1)
where id = current_setting('t.deal')::bigint;
select tests.assert(
  (tests.lead(current_setting('t.token'), '{"name":"Даулет","phone":"87015551234","comment":"Снова я"}') ->> 'deal_id')
    <> current_setting('t.deal'),
  'after a refusal a new request opens a new deal');

--
-- Clinic isolation
--
select set_config('t.r7', tests.lead(current_setting('t.other_token'), '{"name":"Чужой","phone":"87015551234"}')::text, true);
select tests.assert(
  (current_setting('t.r7')::jsonb ->> 'created_patient')::boolean
  and (select organization_id from public.deals where id = (current_setting('t.r7')::jsonb ->> 'deal_id')::bigint) = current_setting('t.other_org')::bigint,
  'the other clinic''s token creates its own patient with the same phone');

select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert(tests.count('select * from public.lead_submissions') = 6, 'the owner sees the clinic''s submissions');
select tests.assert(
  public.regenerate_lead_webhook_token() <> current_setting('t.token'),
  'the owner can regenerate the token');
select tests.logout();
select tests.throws(
  format('select tests.lead(%L, %L)', current_setting('t.token'), '{"phone":"87015550000"}'),
  '28000', 'the old token no longer works');

select tests.login_as(current_setting('t.manager')::uuid);
select tests.assert(tests.count('select * from public.lead_submissions') = 0, 'employees do not read the submissions');
select tests.logout();

select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.count('select * from public.lead_submissions') = 1, 'the other clinic sees only its submission');
select tests.assert(tests.count('select * from public.deal_notes') = 1, 'and only its notes');
select tests.logout();

--
-- Telegram bot
--
update public.organization_settings set lead_distribution = 'off'
where organization_id = current_setting('t.org')::bigint;
insert into public.telegram_bots (organization_id, bot_token, bot_id, username, name, webhook_token, secret_token, connected_at)
values (current_setting('t.org')::bigint, '123:abc', 123, 'smile_clinic_bot', 'Smile', 'tg-a', 'secret-a', now()),
       (current_setting('t.other_org')::bigint, '456:def', 456, 'other_bot', 'Other', 'tg-b', 'secret-b', now());

select tests.throws(
  $q$select tests.telegram('tg-a', 'wrong', '{"chat_id":"501","text":"Привет"}')$q$,
  '28000', 'a wrong secret token header is refused');
select tests.throws(
  $q$select tests.telegram('nope', 'secret-a', '{"chat_id":"501","text":"Привет"}')$q$,
  '28000', 'an unknown bot is refused');

select set_config('t.t1', tests.telegram('tg-a', 'secret-a', '{
  "chat_id": "501", "external_id": "tg:501:1", "text": "Здравствуйте!",
  "contact": {"name": "Aigerim S", "username": "aigerim_s"}}')::text, true);
select set_config('t.tpatient', current_setting('t.t1')::jsonb ->> 'patient_id', true);
select tests.assert(
  (current_setting('t.t1')::jsonb ->> 'created_patient')::boolean
  and (select first_name = 'Aigerim S' and telegram = 'aigerim_s' and cardinality(phones) = 0
         and source_id = (select id from public.lead_sources where organization_id = p.organization_id and code = 'telegram')
       from public.patients p where id = current_setting('t.tpatient')::bigint),
  'a first bot message creates a patient with the Telegram source');
select tests.assert(
  (select transport = 'telegram_bot' and chat_id = '501' and direction = 'in'
     and channel_id = (select id from public.messenger_channels where external_id = 'tgbot:123' and transport = 'telegram_bot')
   from public.messages where external_id = 'tg:501:1'),
  'the message is stored on the bot channel');
select tests.assert(
  tests.telegram('tg-a', 'secret-a', '{"chat_id":"501","external_id":"tg:501:2","text":"Ещё","contact":{"username":"aigerim_new"}}') ->> 'patient_id'
    = current_setting('t.tpatient'),
  'the patient is identified by the Telegram chat id');
select tests.assert(
  (tests.telegram('tg-a', 'secret-a', '{"chat_id":"501","external_id":"tg:501:2","text":"Ещё"}') ->> 'duplicate')::boolean,
  'a retried update is stored once');

-- Wazzup Telegram and the bot are different channels: same chat id, other patient
insert into public.messenger_integrations (organization_id, api_key, webhook_token, connected_at)
values (current_setting('t.org')::bigint, 'key', 'wz-a', now());
set local role service_role;
select tests.assert(
  (public.ingest_message('wz-a', '{"transport":"telegram","chat_id":"501","external_id":"wz-1","text":"Через Wazzup"}') ->> 'patient_id')
    <> current_setting('t.tpatient'),
  'a Wazzup Telegram chat is another channel than the bot');
select tests.throws(
  $q$select public.ingest_message('wz-a', '{"transport":"telegram_bot","chat_id":"501","text":"x"}')$q$,
  '28000', 'the Wazzup token cannot post bot messages');
reset role;

-- Sharing the contact: the phone is saved on the patient
select set_config('t.t2', tests.telegram('tg-a', 'secret-a', '{
  "chat_id": "501", "external_id": "tg:501:3", "text": "Контакт: +7 702 111 22 33",
  "contact": {"phone": "+7 702 111 22 33", "username": "aigerim_s"}}')::text, true);
select tests.assert(
  (select phones = array['+77021112233'] from public.patients where id = current_setting('t.tpatient')::bigint)
  and current_setting('t.t2')::jsonb ->> 'patient_id' = current_setting('t.tpatient'),
  'a shared contact stores the phone on the chat''s patient');

-- A new chat sharing a known phone joins the known patient
select tests.assert(
  (tests.telegram('tg-a', 'secret-a', '{"chat_id":"777","external_id":"tg:777:1","text":"Мой номер",
     "contact":{"phone":"87021112233","name":"Айгерим"}}') ->> 'patient_id') = current_setting('t.tpatient'),
  'a new chat that shares a known phone is the known patient');

-- A bot-only patient sharing the phone of a known patient is merged into it
select set_config('t.t3', tests.telegram('tg-a', 'secret-a',
  '{"chat_id":"888","external_id":"tg:888:1","text":"Привет","contact":{"name":"Мадина"}}')::text, true);
select set_config('t.t4', tests.telegram('tg-a', 'secret-a',
  '{"chat_id":"888","external_id":"tg:888:2","text":"Мой номер","contact":{"phone":"+77075550000"}}')::text, true);
select tests.assert(
  (select last_name from public.patients where id = (current_setting('t.t4')::jsonb ->> 'patient_id')::bigint) = 'Каримова'
  and (current_setting('t.t4')::jsonb ->> 'merged_patient_id') = (current_setting('t.t3')::jsonb ->> 'patient_id')
  and not exists (select 1 from public.patients where id = (current_setting('t.t3')::jsonb ->> 'patient_id')::bigint),
  'a patient known only by the bot chat is merged into the patient with that phone');
select tests.assert(
  (select patient_id from public.deals where id = (current_setting('t.t3')::jsonb ->> 'deal_id')::bigint)
    = (current_setting('t.t4')::jsonb ->> 'patient_id')::bigint
  and (select count(*) from public.messages where chat_id = '888' and patient_id = (current_setting('t.t4')::jsonb ->> 'patient_id')::bigint) = 2,
  'its deal and messages move to the known patient');

-- Not trivial (the patient has a note): the phone is only stored
select set_config('t.t5', tests.telegram('tg-a', 'secret-a',
  '{"chat_id":"999","external_id":"tg:999:1","text":"Привет","contact":{"name":"Ерлан"}}')::text, true);
insert into public.patient_notes (organization_id, patient_id, text)
values (current_setting('t.org')::bigint, (current_setting('t.t5')::jsonb ->> 'patient_id')::bigint, 'важная заметка');
select tests.assert(
  (tests.telegram('tg-a', 'secret-a', '{"chat_id":"999","external_id":"tg:999:2","text":"Номер","contact":{"phone":"+77075550000"}}')
    ->> 'patient_id') = (current_setting('t.t5')::jsonb ->> 'patient_id'),
  'a patient with its own history is not merged');
select tests.assert(
  (select phones = array['+77075550000'] from public.patients where id = (current_setting('t.t5')::jsonb ->> 'patient_id')::bigint),
  'the shared phone is stored on it');

-- The other clinic's bot and the employees
select tests.assert(
  (tests.telegram('tg-b', 'secret-b', '{"chat_id":"501","external_id":"tg:501:1","text":"Привет"}') ->> 'created_patient')::boolean,
  'each clinic''s bot has its own patients');
select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert(
  (select connected and username = 'smile_clinic_bot' from public.telegram_bot_status()),
  'the owner sees the bot is connected');
select tests.logout();
select tests.login_as(current_setting('t.manager')::uuid);
select tests.assert(tests.count('select * from public.telegram_bot_status()') = 0, 'managers do not see the bot');
select tests.logout();
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.count($q$select * from public.messages where transport = 'telegram_bot'$q$) = 1,
  'the other clinic only sees its bot messages');
select tests.logout();

rollback;

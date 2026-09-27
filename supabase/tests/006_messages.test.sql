--
-- Messengers (stage 4): messages received through the Wazzup24 webhook find
-- or create the patient and the deal; employees only read and mark read;
-- every clinic keeps its messages and its API key to itself.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.manager', tests.invite('admin@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);
select set_config('t.other_org', tests.org_of(current_setting('t.other')::uuid)::text, true);

-- The edge function wazzup_connect stores the key (service role)
insert into public.messenger_integrations (organization_id, api_key, webhook_token, connected_at)
values (current_setting('t.org')::bigint, 'secret-key', 'token-a', now()),
       (current_setting('t.other_org')::bigint, 'other-key', 'token-b', now());

create function tests.ingest(token text, message jsonb) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  execute 'set local role service_role';
  result := public.ingest_message(token, message);
  execute 'reset role';
  return result;
end;
$$;

select tests.throws(
  $q$select tests.ingest('nope', '{"transport":"whatsapp","chat_id":"77010000000"}')$q$,
  '28000', 'an unknown webhook token is refused');
select tests.throws(
  $q$select tests.ingest('token-a', '{"transport":"vk","chat_id":"1"}')$q$,
  '22023', 'unsupported messengers are refused');

-- A new WhatsApp number: new patient, new deal, unread message
select set_config('t.r1', tests.ingest('token-a', '{
  "channel_id": "ch-wa", "transport": "whatsapp", "chat_id": "77015551234",
  "external_id": "m1", "direction": "in", "text": "Здравствуйте, сколько стоит имплант?",
  "contact": {"name": "Даулет"}}')::text, true);
select set_config('t.patient', (current_setting('t.r1')::jsonb ->> 'patient_id'), true);
select set_config('t.deal', (current_setting('t.r1')::jsonb ->> 'deal_id'), true);
select tests.assert((current_setting('t.r1')::jsonb ->> 'created_patient')::boolean and (current_setting('t.r1')::jsonb ->> 'created_deal')::boolean,
  'a first message creates the patient and the deal');
select tests.assert(
  (select first_name = 'Даулет' and phones = array['+77015551234'] and whatsapp = '+77015551234'
     and source_id = (select id from public.lead_sources where organization_id = p.organization_id and code = 'whatsapp')
   from public.patients p where id = current_setting('t.patient')::bigint),
  'the patient gets the contact name, the normalized phone and the WhatsApp source');
select tests.assert(
  (select s.name = 'Новый лид' and d.source_id is not null and d.sales_id is null
   from public.deals d join public.stages s on s.id = d.stage_id where d.id = current_setting('t.deal')::bigint),
  'the new deal starts at the first stage of the default pipeline, unassigned');
select tests.assert(
  (select nb_unread_messages from public.deals_summary where id = current_setting('t.deal')::bigint) = 1,
  'the message is unread');
select tests.assert((select count(*) from public.messenger_channels where organization_id = current_setting('t.org')::bigint) = 1,
  'the channel is recorded');

-- Retried webhook: stored once
select tests.assert(
  (tests.ingest('token-a', '{"transport":"whatsapp","chat_id":"77015551234","external_id":"m1","text":"x"}') ->> 'duplicate')::boolean
  and (select count(*) from public.messages where external_id = 'm1') = 1,
  'a message already received is ignored');

-- Next message of the same chat: same patient, same deal
select tests.assert(
  (tests.ingest('token-a', '{"transport":"whatsapp","chat_id":"77015551234","external_id":"m2","text":"Алло?"}') ->> 'deal_id')
    = current_setting('t.deal'),
  'the conversation continues in the same deal');

-- A patient registered by hand with "8 707..." is found by the WhatsApp number
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.patients (last_name, first_name, phone_jsonb) values ('Каримова', 'Мадина', '[{"number":"8 707 555 00 00"}]');
insert into public.deals (patient_id, name) select id, 'старая' from public.patients where last_name = 'Каримова';
insert into public.deals (patient_id, name) select id, 'свежая' from public.patients where last_name = 'Каримова';
update public.deals set description = 'обновлена последней' where name = 'свежая';
select tests.logout();
select set_config('t.r3', tests.ingest('token-a', '{"transport":"whatsapp","chat_id":"77075550000","external_id":"m3","text":"Это Мадина"}')::text, true);
select tests.assert(
  (select last_name from public.patients where id = (current_setting('t.r3')::jsonb ->> 'patient_id')::bigint) = 'Каримова'
  and not (current_setting('t.r3')::jsonb ->> 'created_patient')::boolean,
  'a known patient is found by phone');
select tests.assert(
  (select name from public.deals where id = (current_setting('t.r3')::jsonb ->> 'deal_id')::bigint) = 'свежая',
  'with several open deals the message goes to the most recently updated one');

-- Lost deals are not reopened: a new request is a new deal
update public.deals
set stage_id = (select id from public.stages where pipeline_id = deals.pipeline_id and kind = 'lost'),
    lost_reason_id = (select id from public.lost_reasons where organization_id = deals.organization_id limit 1)
where id = current_setting('t.deal')::bigint;
select set_config('t.r4', tests.ingest('token-a', '{"transport":"whatsapp","chat_id":"77015551234","external_id":"m4","text":"Я снова"}')::text, true);
select tests.assert(
  (current_setting('t.r4')::jsonb ->> 'deal_id') <> current_setting('t.deal')
  and (current_setting('t.r4')::jsonb ->> 'patient_id') = current_setting('t.patient')
  and (current_setting('t.r4')::jsonb ->> 'created_deal')::boolean,
  'after a refusal the patient''s next message opens a new deal');
select set_config('t.deal2', current_setting('t.r4')::jsonb ->> 'deal_id', true);

-- Instagram: identified by chat id, whatever the user name becomes
select set_config('t.r5', tests.ingest('token-a', '{"transport":"instagram","chat_id":"ig-1001","external_id":"m5","text":"Привет","contact":{"name":"Asel","username":"asel.smile"}}')::text, true);
select tests.assert(
  (select instagram from public.patients where id = (current_setting('t.r5')::jsonb ->> 'patient_id')::bigint) = 'asel.smile',
  'an Instagram patient keeps the user name');
select tests.assert(
  (tests.ingest('token-a', '{"transport":"instagram","chat_id":"ig-1001","external_id":"m6","text":"Ещё","contact":{"username":"asel.new"}}') ->> 'patient_id')
    = (current_setting('t.r5')::jsonb ->> 'patient_id'),
  'the same Instagram chat is the same patient');

-- Answer from the phone (echo): outgoing, first response time
select tests.ingest('token-a', '{"transport":"whatsapp","chat_id":"77015551234","external_id":"m7","direction":"out","text":"Добрый день!"}');
select tests.assert(
  (select first_response_at is not null from public.deals where id = current_setting('t.deal2')::bigint),
  'the first outgoing message sets the first response time');

-- Delivery statuses
set local role service_role;
select tests.assert(public.update_message_status('token-a', 'm7', 'delivered'), 'a status is updated');
select tests.assert(not public.update_message_status('token-a', 'm7', 'bogus'), 'unknown statuses are ignored');
select tests.assert(not public.update_message_status('token-b', 'm7', 'read'), 'another clinic cannot touch the message');
reset role;
select tests.assert((select status from public.messages where external_id = 'm7') = 'delivered', 'the status is stored');

-- The other clinic: same phone number, separate patient
select tests.assert(
  (tests.ingest('token-b', '{"transport":"whatsapp","chat_id":"77015551234","external_id":"m1","text":"Здравствуйте"}') ->> 'created_patient')::boolean,
  'each clinic has its own patients and message ids');

-- Employees: read, mark read, nothing else
select tests.login_as(current_setting('t.manager')::uuid);
select tests.assert(tests.count('select * from public.messages') = 7, 'the manager reads the clinic''s messages');
select tests.assert(public.mark_deal_messages_read(current_setting('t.deal2')::bigint) = 1, 'opening a deal marks its messages read');
select tests.assert((select nb_unread_messages from public.deals_summary where id = current_setting('t.deal2')::bigint) = 0, 'no unread message left');
select tests.throws(
  format('insert into public.messages (patient_id, deal_id, transport, chat_id, direction, text) values (%s, %s, ''whatsapp'', ''1'', ''in'', ''fake'')',
    current_setting('t.patient'), current_setting('t.deal2')),
  '42501', 'employees cannot forge messages');
select tests.throws('update public.messages set text = ''changed''', '42501', 'employees cannot rewrite messages');
select tests.throws('select * from public.messenger_integrations', '42501', 'the API key is not readable');
select tests.throws($q$select public.ingest_message('token-a', '{}')$q$, '42501', 'employees cannot call the webhook function');
select tests.assert(tests.count('select * from public.messenger_status()') = 0, 'managers do not see the connection');
select tests.logout();

select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert((select connected from public.messenger_status()), 'the owner sees the clinic is connected');
update public.organization_settings set manager_deal_visibility = 'own';
select tests.logout();
select tests.login_as(current_setting('t.manager')::uuid);
select tests.assert(tests.count('select * from public.messages') = 0, 'messages follow the deal visibility of managers');
select tests.logout();

select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.count('select * from public.messages') = 1, 'the other clinic only sees its own message');
select tests.assert(tests.count('select * from public.patient_chats') = 1, 'and its own chats');
select tests.assert(tests.count('select * from public.messenger_channels') = 0, 'and its own channels');
select tests.logout();

rollback;

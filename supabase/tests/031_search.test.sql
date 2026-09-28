--
-- Global search (stage 31): public.global_search matches patients by name
-- (word beginnings, ё = е, Cyrillic and Latin) and by phone in any format,
-- card and deal numbers, deals, tasks and messages; row level security
-- decides what is found (deal visibility of managers, clinic isolation).
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@search.kz', 'Клиника поиска')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.m1', tests.invite('m1@search.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m2', tests.invite('m2@search.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m1_id', (select id from public.sales where email = 'm1@search.kz')::text, true);
select set_config('t.m2_id', (select id from public.sales where email = 'm2@search.kz')::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая клиника')::text, true);
select set_config('t.org2', tests.org_of(current_setting('t.other')::uuid)::text, true);

-- Search helpers: the ids or a field of the found rows of one kind
create function tests.found(query text, kind text, field text default 'id', lim integer default 10) returns text
language sql as $$
  select coalesce(string_agg(e ->> field, ',' order by ord), '')
  from jsonb_array_elements(public.global_search(query, lim) -> kind) with ordinality as x(e, ord)
$$;
grant execute on function tests.found(text, text, text, integer) to authenticated, anon;

select tests.login_as(current_setting('t.owner')::uuid);
update public.task_rules set is_active = false;
insert into public.patients (last_name, first_name, middle_name, phone_jsonb)
values
  ('Иванова', 'Анна', 'Сергеевна', '[{"number": "+7 701 555 12 34", "type": "Mobile"}]'),
  ('Семёнов', 'Пётр', null, '[{"number": "87077770011", "type": "Mobile"}]'),
  ('Nurlanova', 'Aigerim', null, '[{"number": "+77021112233", "type": "Mobile"}]'),
  ('Кимова', 'Дана', null, '[{"number": "+77055512340", "type": "Mobile"}]');
select set_config('t.ivanova', (select id from public.patients where last_name = 'Иванова')::text, true);
select set_config('t.semenov', (select id from public.patients where last_name = 'Семёнов')::text, true);
select set_config('t.latin', (select id from public.patients where last_name = 'Nurlanova')::text, true);
select set_config('t.kimova', (select id from public.patients where last_name = 'Кимова')::text, true);
insert into public.deals (patient_id, name, sales_id, plan_amount)
values
  (current_setting('t.ivanova')::bigint, 'Имплантация', current_setting('t.m1_id')::bigint, 450000),
  (current_setting('t.semenov')::bigint, 'Брекеты', current_setting('t.m2_id')::bigint, 900000);
select set_config('t.deal_m1', (select id from public.deals where name = 'Имплантация')::text, true);
select set_config('t.deal_m2', (select id from public.deals where name = 'Брекеты')::text, true);
insert into public.tasks (deal_id, text, due_date)
values (current_setting('t.deal_m2')::bigint, 'Перезвонить по брекетам', now());
select tests.logout();

-- Messages come from the edge functions; the card number from a MIS
insert into public.messages (organization_id, patient_id, deal_id, transport, chat_id, direction, text, status)
values
  (current_setting('t.org')::bigint, current_setting('t.semenov')::bigint, current_setting('t.deal_m2')::bigint,
   'whatsapp', '77077770011', 'in', 'Добрый день! Сколько стоят брекеты с установкой?', 'inbound'),
  (current_setting('t.org')::bigint, current_setting('t.ivanova')::bigint, current_setting('t.deal_m1')::bigint,
   'whatsapp', '77015551234', 'in', 'Здравствуйте, хочу на имплантацию', 'inbound');
insert into public.external_refs (organization_id, entity, entity_id, system, external_id)
values (current_setting('t.org')::bigint, 'patient', current_setting('t.ivanova')::bigint, 'dentistplus', 'MIS-7788');

-- The other clinic has a patient with the same number and name
select tests.login_as(current_setting('t.other')::uuid);
insert into public.patients (last_name, first_name, phone_jsonb)
values ('Иванова', 'Анна', '[{"number": "+77015551234", "type": "Mobile"}]');
select set_config('t.other_ivanova', (select id from public.patients where last_name = 'Иванова')::text, true);
select tests.logout();

--
-- Matching (a manager, every deal visible by default)
--
select tests.login_as(current_setting('t.m1')::uuid);

-- Phones in any format
select tests.assert(tests.found('+7 701 555 12 34', 'patients') = current_setting('t.ivanova'), 'phone: +7 with spaces');
select tests.assert(tests.found('87015551234', 'patients') = current_setting('t.ivanova'), 'phone: 8 prefix');
select tests.assert(tests.found('7015551234', 'patients') = current_setting('t.ivanova'), 'phone: 10 digits');
select tests.assert(tests.found('15 55', 'patients') = current_setting('t.ivanova'), 'phone: partial digits');
select tests.assert(tests.found('(701) 555-1', 'patients') = current_setting('t.ivanova'), 'phone: brackets and dashes');
select tests.assert(tests.found('87077770011', 'patients') = current_setting('t.semenov'), 'phone: stored from 8…');
-- Partial digits find both, the exact number ranks first
select tests.assert(
  tests.found('5551234', 'patients', 'id') in (current_setting('t.ivanova') || ',' || current_setting('t.kimova'), current_setting('t.kimova') || ',' || current_setting('t.ivanova')),
  'phone: partial digits find every patient containing them');
select tests.assert(tests.found('+77015551234', 'patients', 'rank') = '0', 'phone: the exact number is ranked first');
select tests.assert(tests.found('+77015551234', 'patients') = current_setting('t.ivanova'), 'phone: the exact number is not mixed with neighbours');

-- Names: case, word beginnings, any order, ё = е, Latin
select tests.assert(tests.found('ИВАНОВА', 'patients') = current_setting('t.ivanova'), 'name: case-insensitive');
select tests.assert(tests.found('ан ив', 'patients') = current_setting('t.ivanova'), 'name: word beginnings in any order');
select tests.assert(tests.found('Иванова Анна Сергеевна', 'patients', 'rank') = '2', 'name: the exact full name ranks high');
select tests.assert(tests.found('ванова', 'patients') = '', 'name: the middle of a word is not a match');
select tests.assert(tests.found('семенов', 'patients') = current_setting('t.semenov'), 'name: е finds ё');
select tests.assert(tests.found('СЕМЁН ПЕТР', 'patients') = current_setting('t.semenov'), 'name: ё finds ё, е finds ё');
select tests.assert(tests.found('aigerim', 'patients') = current_setting('t.latin'), 'name: Latin');
select tests.assert(tests.found('NURL', 'patients') = current_setting('t.latin'), 'name: Latin upper case');
select tests.assert(tests.found('иванова 701', 'patients') = current_setting('t.ivanova'), 'mixed: name and phone digits');
select tests.assert(tests.found('иванова 709', 'patients') = '', 'mixed: every word must match');
select tests.assert(tests.found('ив%', 'patients') = current_setting('t.ivanova'), 'LIKE wildcards are plain text');
select tests.assert(tests.found('и', 'patients') = '', 'a single character finds nothing');

-- Card numbers: the CRM number and the MIS number
select tests.assert(tests.found('#' || current_setting('t.ivanova'), 'patients') = current_setting('t.ivanova'), 'card: #id');
select tests.assert(tests.found('№' || current_setting('t.semenov'), 'patients') = current_setting('t.semenov'), 'card: №id');
select tests.assert(tests.found('MIS-7788', 'patients') = current_setting('t.ivanova'), 'card: the number in the MIS');
select tests.assert(
  (select public.global_search('иванова', 5) #>> '{patients,0,card}') = 'MIS-7788',
  'card: the MIS number comes with the patient');

-- Deals: by name, patient, phone, number; with stage, responsible, amount
select tests.assert(tests.found('брек', 'deals') = current_setting('t.deal_m2'), 'deal: by its name');
select tests.assert(tests.found('семенов', 'deals') = current_setting('t.deal_m2'), 'deal: by the patient');
select tests.assert(tests.found('иванова имплант', 'deals') = current_setting('t.deal_m1'), 'deal: patient and deal name together');
select tests.assert(tests.found('8 701 555', 'deals') = current_setting('t.deal_m1'), 'deal: by the patient phone');
select tests.assert(tests.found('#' || current_setting('t.deal_m2'), 'deals', 'rank') like '0%', 'deal: by its number, first');
select tests.assert(tests.found('брекеты', 'deals', 'sales_name') = 'm2 Test', 'deal: the responsible');
select tests.assert(tests.found('брекеты', 'deals', 'plan_amount') = '900000', 'deal: the amount');
select tests.assert(tests.found('брекеты', 'deals', 'stage_name') <> '', 'deal: the stage');

-- Tasks and messages
select tests.assert(tests.found('перезвон', 'tasks') <> '', 'task: by its text');
select tests.assert(tests.found('семенов', 'tasks', 'text') = 'Перезвонить по брекетам', 'task: by the patient');
select tests.assert(tests.found('стоят брекеты', 'messages', 'deal_id') = current_setting('t.deal_m2'), 'message: by a phrase');
select tests.assert(tests.found('СТОЯТ БРЕКЕТЫ', 'messages', 'snippet') like '%брекеты с установкой%', 'message: a snippet of the text');
select tests.assert(tests.found('стоят брекеты', 'messages', 'patient_last_name') = 'Семёнов', 'message: the patient');
select tests.assert(tests.found('87077770011', 'messages') = '', 'message: phones are not searched in texts');

-- Limits
select tests.assert(tests.found('5551234', 'patients', 'id', 1) not like '%,%', 'max_per_kind limits every kind');

--
-- Clinic isolation
--
select tests.assert(position(current_setting('t.other_ivanova') in tests.found('иванова', 'patients')) = 0
  and tests.found('иванова', 'patients') = current_setting('t.ivanova'), 'isolation: the other clinic''s patient is not found');
select tests.logout();

select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.found('+77015551234', 'patients') = current_setting('t.other_ivanova'), 'isolation: each clinic finds its own patient');
select tests.assert(tests.found('брек', 'deals') = '', 'isolation: no deal of the other clinic');
select tests.assert(tests.found('стоят брекеты', 'messages') = '', 'isolation: no message of the other clinic');
select tests.assert(tests.found('MIS-7788', 'patients') = '', 'isolation: no MIS card of the other clinic');
select tests.logout();

--
-- Deal visibility: a manager restricted to their own deals
--
select tests.login_as(current_setting('t.owner')::uuid);
update public.organization_settings set manager_deal_visibility = 'own';
select tests.assert(tests.found('брек', 'deals') = current_setting('t.deal_m2'), 'owner: every deal');
select tests.logout();

select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(tests.found('брек', 'deals') = '', 'own: a colleague''s deal is not found');
select tests.assert(tests.found('#' || current_setting('t.deal_m2'), 'deals') = '', 'own: not even by its number');
select tests.assert(tests.found('перезвон', 'tasks') = '', 'own: nor its tasks');
select tests.assert(tests.found('стоят брекеты', 'messages') = '', 'own: nor its messages');
select tests.assert(tests.found('семенов', 'patients') = current_setting('t.semenov'), 'own: patients stay visible to the clinic');
select tests.assert(tests.found('имплант', 'deals') = current_setting('t.deal_m1'), 'own: own deals are found');
select tests.assert(tests.found('хочу на имплантацию', 'messages') <> '', 'own: own messages are found');
select tests.logout();

select tests.login_as(current_setting('t.m2')::uuid);
select tests.assert(tests.found('брек', 'deals') = current_setting('t.deal_m2'), 'own: the responsible finds the deal');
select tests.logout();

-- Anonymous visitors cannot search
select tests.login_anon();
select tests.throws($q$select public.global_search('иванова', 5)$q$, '42501', 'anon cannot search');
select tests.logout();

rollback;

--
-- Custom fields (stage 19): rights on the definitions and clinic isolation,
-- the validation of every type, unknown keys stripped, archived fields kept,
-- required fields (deals outside the first stage, patients), filtering by
-- jsonb containment, the summaries, the deal and audit logs, the import and
-- the {поле:Название} template variables.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);

-- Stages of the default pipeline of the clinic
create function tests.stage(stage_name text) returns bigint language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
  where p.organization_id = current_setting('t.org')::bigint and p.is_default and s.name = stage_name
$$;
-- Id of a field of the clinic, by name
create function tests.field(field_name text) returns text language sql security definer as $$
  select f.id::text from public.custom_fields f
  where f.organization_id = current_setting('t.org')::bigint and f.name = field_name
$$;
-- A deal field of the given type, then the value it stores for a raw value
create function tests.cv(field_name text, raw jsonb) returns jsonb language sql security definer as $$
  select private.custom_value(f, raw) from public.custom_fields f
  where f.organization_id = current_setting('t.org')::bigint and f.name = field_name
$$;
grant execute on all functions in schema tests to authenticated;

--
-- Definitions: the owner and the head, not the managers, not other clinics
--

select tests.login_as(current_setting('t.owner')::uuid);
insert into public.custom_fields (entity, name, type, options, position) values
  ('deal', '  Жалоба ', 'textarea', '["ignored"]', 0),
  ('deal', 'Откуда узнал', 'select', '[" Инстаграм ", "2GIS", "инстаграм", "", "Рекомендация", "Реклама"]', 1),
  ('deal', 'Есть снимок КТ', 'checkbox', '[]', 2),
  ('deal', 'Полис ДМС', 'text', '[]', 3),
  ('deal', 'Сумма рассрочки', 'money', '[]', 4),
  ('deal', 'Зубов', 'number', '[]', 5),
  ('deal', 'Дата снимка', 'date', '[]', 6),
  ('deal', 'Созвон', 'datetime', '[]', 7),
  ('deal', 'Аллергии', 'multiselect', '["Лидокаин", "Латекс", "Пенициллин"]', 8),
  ('deal', 'Телефон родственника', 'phone', '[]', 9),
  ('deal', 'Сайт', 'url', '[]', 10);
select tests.assert(
  (select name from public.custom_fields where id = tests.field('Жалоба')::bigint) = 'Жалоба'
  and (select options from public.custom_fields where id = tests.field('Жалоба')::bigint) = '[]'::jsonb,
  'the name is trimmed, a field that is not a list has no options');
select tests.assert(
  (select options from public.custom_fields where id = tests.field('Откуда узнал')::bigint)
    = '["Инстаграм", "2GIS", "Рекомендация", "Реклама"]'::jsonb,
  'options are trimmed, without blanks nor duplicates, in their order');
select tests.assert(
  (select organization_id from public.custom_fields where id = tests.field('Жалоба')::bigint) = current_setting('t.org')::bigint,
  'a new field belongs to the clinic of the owner');
select tests.throws($q$insert into public.custom_fields (entity, name, type) values ('deal', 'Список', 'select')$q$,
  '23514', 'a list needs options');
select tests.throws($q$insert into public.custom_fields (entity, name, type) values ('deal', 'жалоба', 'text')$q$,
  '23505', 'two fields of an entity cannot have the same name');
select tests.throws($q$insert into public.custom_fields (entity, name, type) values ('deal', 'Поле {x}', 'text')$q$,
  '23514', 'a name cannot hold braces (template variables)');
select tests.throws($q$insert into public.custom_fields (entity, name, type) values ('clinic', 'X', 'text')$q$,
  '23514', 'only deals and patients have custom fields');
select tests.throws($q$insert into public.custom_fields (entity, name, type) values ('deal', 'X', 'color')$q$,
  '23514', 'only the known types exist');
select tests.throws(
  format($q$update public.custom_fields set type = 'text' where id = %s$q$, tests.field('Зубов')),
  '23514', 'the type of a field cannot change');
-- The kanban card shows two fields at most
update public.custom_fields set show_on_card = true where name in ('Откуда узнал', 'Есть снимок КТ');
select tests.throws(
  format('update public.custom_fields set show_on_card = true where id = %s', tests.field('Полис ДМС')),
  '23514', 'a third field cannot go on the card');
select tests.logout();

select tests.login_as(current_setting('t.head')::uuid);
insert into public.custom_fields (entity, name, type, required) values ('patient', 'Аллергия', 'text', true);
select tests.assert(
  tests.affected(format('update public.custom_fields set position = 1 where id = %s', tests.field('Аллергия'))) = 1,
  'the head edits a field');
insert into public.custom_fields (entity, name, type) values ('patient', 'Временное', 'text');
select tests.assert(tests.affected('delete from public.custom_fields where name = ''Временное''') = 1, 'the head deletes a field');
insert into public.custom_fields (entity, name, type, show_on_card) values ('patient', 'Карта', 'text', true);
select tests.assert(not (select show_on_card from public.custom_fields where name = 'Карта'), 'only deal fields go on the kanban card');
delete from public.custom_fields where name = 'Карта';
select tests.logout();

select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(tests.count('select * from public.custom_fields') = 12, 'a manager reads the fields (forms, cards, filters)');
select tests.throws($q$insert into public.custom_fields (entity, name, type) values ('deal', 'X', 'text')$q$,
  '42501', 'a manager cannot add a field');
select tests.assert(tests.affected('update public.custom_fields set name = name || ''!''') = 0, 'a manager cannot rename a field');
select tests.assert(tests.affected('delete from public.custom_fields') = 0, 'a manager cannot delete a field');
select tests.logout();

select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.count('select * from public.custom_fields') = 0, 'another clinic sees no fields of this one');
select tests.assert(tests.affected('update public.custom_fields set required = true') = 0, 'nor changes them');
select tests.assert(tests.affected('delete from public.custom_fields') = 0, 'nor deletes them');
select tests.throws(
  format($q$insert into public.custom_fields (organization_id, entity, name, type) values (%s, 'deal', 'Чужое', 'text')$q$, current_setting('t.org')),
  '42501', 'nor adds a field to it');
-- Its deals cannot hold values of this clinic's fields: unknown keys are dropped
insert into public.patients (first_name) values ('Чужой');
insert into public.deals (patient_id, name, custom_values)
select id, 'Чужая сделка', jsonb_build_object(tests.field('Полис ДМС'), 'AB-1') from public.patients;
select tests.assert(
  (select custom_values from public.deals where name = 'Чужая сделка') = '{}'::jsonb,
  'the fields of another clinic are unknown keys');
select tests.logout();

select tests.login_anon();
select tests.assert(tests.count('select * from public.custom_fields') = 0, 'anonymous users see no fields');
select tests.logout();

--
-- Validation of every type (the same rules as normalizeCustomValue)
--

select tests.assert(tests.cv('Полис ДМС', '"  AB-123 "') = '"AB-123"', 'text: trimmed');
select tests.assert(tests.cv('Полис ДМС', '"  "') is null, 'text: blank is empty');
select tests.assert(tests.cv('Полис ДМС', '42') = '"42"', 'text: a number is read as text');
select tests.throws($q$select tests.cv('Полис ДМС', to_jsonb(repeat('x', 1001)))$q$, '23514', 'text: 1000 characters at most');
select tests.throws($q$select tests.cv('Полис ДМС', '{"a": 1}')$q$, '23514', 'text: not an object');
select tests.assert(tests.cv('Жалоба', to_jsonb(E'Болит зуб\nслева'::text)) = to_jsonb(E'Болит зуб\nслева'::text), 'long text keeps its lines');
select tests.assert(tests.cv('Зубов', '"1 234,5"') = '1234.5', 'number: spaces and decimal comma');
select tests.assert(tests.cv('Зубов', '-3') = '-3', 'number: negative numbers');
select tests.assert(tests.cv('Зубов', '2.50') = '2.5', 'number: no trailing zeros');
select tests.throws($q$select tests.cv('Зубов', '"два"')$q$, '23514', 'number: not a word');
select tests.assert(tests.cv('Сумма рассрочки', '"150 000 ₸"') = '150000', 'money: tenge sign and spaces');
select tests.assert(tests.cv('Сумма рассрочки', '1500.6') = '1501', 'money: whole tenge');
select tests.throws($q$select tests.cv('Сумма рассрочки', '-5')$q$, '23514', 'money: not negative');
select tests.assert(tests.cv('Дата снимка', '"2026-03-01"') = '"2026-03-01"', 'date: ISO date');
select tests.throws($q$select tests.cv('Дата снимка', '"2026-02-30"')$q$, '23514', 'date: a real day');
select tests.throws($q$select tests.cv('Дата снимка', '"01.03.2026"')$q$, '23514', 'date: ISO only');
select tests.assert(tests.cv('Созвон', '"2026-03-01T10:00:00+05:00"') = '"2026-03-01T05:00:00.000Z"', 'datetime: stored in UTC like toISOString');
select tests.throws($q$select tests.cv('Созвон', '"2026-03-01T10:00"')$q$, '23514', 'datetime: needs a time zone');
select tests.assert(tests.cv('Есть снимок КТ', 'true') = 'true' and tests.cv('Есть снимок КТ', '"Да"') = 'true'
  and tests.cv('Есть снимок КТ', '"нет"') = 'false' and tests.cv('Есть снимок КТ', 'false') = 'false',
  'checkbox: booleans, да / нет');
select tests.throws($q$select tests.cv('Есть снимок КТ', '"может быть"')$q$, '23514', 'checkbox: yes or no only');
select tests.assert(tests.cv('Откуда узнал', '" инстаграм"') = '"Инстаграм"', 'select: the option as written in the list');
select tests.throws($q$select tests.cv('Откуда узнал', '"Telegram"')$q$, '23514', 'select: one of the options');
select tests.assert(tests.cv('Аллергии', '["пенициллин", "Лидокаин", "Лидокаин"]') = '["Лидокаин", "Пенициллин"]',
  'multiselect: options of the list, once, in its order');
select tests.assert(tests.cv('Аллергии', '[]') is null, 'multiselect: nothing chosen is empty');
select tests.throws($q$select tests.cv('Аллергии', '["Мёд"]')$q$, '23514', 'multiselect: options of the list only');
select tests.assert(tests.cv('Телефон родственника', '"8 701 111 22 33"') = '"+77011112233"', 'phone: normalized to +7');
select tests.throws($q$select tests.cv('Телефон родственника', '"12345"')$q$, '23514', 'phone: a real number');
select tests.assert(tests.cv('Сайт', '"clinic.kz/about"') = '"https://clinic.kz/about"', 'url: https:// added');
select tests.assert(tests.cv('Сайт', '"http://clinic.kz"') = '"http://clinic.kz"', 'url: kept with its scheme');
select tests.throws($q$select tests.cv('Сайт', '"не ссылка"')$q$, '23514', 'url: a link');

--
-- Values of deals: normalized by the trigger, unknown keys dropped
--

select tests.login_as(current_setting('t.m1')::uuid);
insert into public.patients (first_name, last_name) values ('Асель', 'Нурланова');
select set_config('t.patient', (select id from public.patients where first_name = 'Асель')::text, true);
insert into public.deals (patient_id, name, custom_values)
values (current_setting('t.patient')::bigint, 'Имплантация', jsonb_build_object(
  tests.field('Откуда узнал'), 'инстаграм',
  tests.field('Сумма рассрочки'), '200 000',
  tests.field('Полис ДМС'), '',
  '999999', 'неизвестное поле',
  'abc', 1));
select set_config('t.deal', (select id from public.deals where name = 'Имплантация')::text, true);
select tests.assert(
  (select custom_values from public.deals where id = current_setting('t.deal')::bigint)
    = jsonb_build_object(tests.field('Откуда узнал'), 'Инстаграм', tests.field('Сумма рассрочки'), 200000),
  'values are normalized, empty values and unknown keys are dropped');
select tests.throws(
  format($q$update public.deals set custom_values = custom_values || jsonb_build_object(%L, 'Telegram') where id = %s$q$,
    tests.field('Откуда узнал'), current_setting('t.deal')),
  '23514', 'a wrong value is refused');
select tests.throws(
  format($q$update public.deals set custom_values = '[]' where id = %s$q$, current_setting('t.deal')),
  '23514', 'the values are an object');
select tests.assert(
  (select custom_values from public.deals_summary where id = current_setting('t.deal')::bigint)
    ->> tests.field('Откуда узнал') = 'Инстаграм',
  'deals_summary shows the values');
select tests.logout();

-- An option removed from the list stays on the deals that have it; an
-- archived field keeps its value and ignores changes
select tests.login_as(current_setting('t.owner')::uuid);
update public.custom_fields set options = '["2GIS", "Рекомендация", "Реклама"]' where id = tests.field('Откуда узнал')::bigint;
update public.custom_fields set is_active = false where id = tests.field('Сумма рассрочки')::bigint;
select tests.assert(
  (select show_on_card from public.custom_fields where id = tests.field('Откуда узнал')::bigint),
  'the card flag stays while the field is active');
select tests.logout();
select tests.login_as(current_setting('t.m1')::uuid);
update public.deals
set custom_values = custom_values
  || jsonb_build_object(tests.field('Полис ДМС'), 'AB-7', tests.field('Сумма рассрочки'), 1)
where id = current_setting('t.deal')::bigint;
select tests.assert(
  (select custom_values from public.deals where id = current_setting('t.deal')::bigint)
    = jsonb_build_object(tests.field('Откуда узнал'), 'Инстаграм', tests.field('Сумма рассрочки'), 200000,
      tests.field('Полис ДМС'), 'AB-7'),
  'unchanged values stay (even a removed option), an archived field keeps its value');
update public.deals set custom_values = '{}' where id = current_setting('t.deal')::bigint;
select tests.assert(
  (select custom_values from public.deals where id = current_setting('t.deal')::bigint)
    = jsonb_build_object(tests.field('Сумма рассрочки'), 200000),
  'clearing the values keeps the archived one');
select tests.logout();
select tests.login_as(current_setting('t.owner')::uuid);
update public.custom_fields set is_active = true where id = tests.field('Сумма рассрочки')::bigint;
update public.custom_fields set options = '["Инстаграм", "2GIS", "Рекомендация", "Реклама"]' where id = tests.field('Откуда узнал')::bigint;
update public.custom_fields set is_active = false where id = tests.field('Есть снимок КТ')::bigint;
select tests.assert(
  not (select show_on_card from public.custom_fields where id = tests.field('Есть снимок КТ')::bigint),
  'an archived field leaves the kanban card');
update public.custom_fields set is_active = true where id = tests.field('Есть снимок КТ')::bigint;
select tests.logout();

--
-- Deal log and audit log: one line per field
--

select tests.login_as(current_setting('t.m1')::uuid);
update public.deals set custom_values = jsonb_build_object(tests.field('Полис ДМС'), 'ZZ-1', tests.field('Сумма рассрочки'), 200000)
where id = current_setting('t.deal')::bigint;
select tests.assert(
  (select changes -> ('cf:' || tests.field('Полис ДМС')) from public.deal_events
   where deal_id = current_setting('t.deal')::bigint and type = 'updated' order by id desc limit 1) = '[null, "ZZ-1"]'::jsonb,
  'the deal log shows the changed field with its values');
select tests.logout();
select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert(
  (select changes ? ('cf:' || tests.field('Полис ДМС')) from public.audit_log
   where entity = 'deal' and entity_id = current_setting('t.deal')::bigint and action = 'update' order by id desc limit 1),
  'the audit log shows the changed field');
select tests.assert(
  (select count(*) from public.audit_log where entity = 'custom_field' and action = 'create') >= 11,
  'creating a field is in the audit log');
select tests.logout();

--
-- Required fields
--

select tests.login_as(current_setting('t.owner')::uuid);
update public.custom_fields set required = true where name in ('Жалоба', 'Есть снимок КТ') and entity = 'deal';
select tests.logout();

select tests.login_as(current_setting('t.m1')::uuid);
-- A new lead on the first stage can be empty, and edited
insert into public.deals (patient_id, name) values (current_setting('t.patient')::bigint, 'Брекеты');
select set_config('t.deal2', (select id from public.deals where name = 'Брекеты')::text, true);
update public.deals set custom_values = jsonb_build_object(tests.field('Полис ДМС'), 'P-1') where id = current_setting('t.deal2')::bigint;
select tests.assert(
  (select custom_values ->> tests.field('Полис ДМС') from public.deals where id = current_setting('t.deal2')::bigint) = 'P-1',
  'required fields do not block the first stage');
-- Leaving the first stage needs them
select tests.throws(
  format('update public.deals set stage_id = %s where id = %s', tests.stage('В работе'), current_setting('t.deal2')),
  '23514', 'a deal cannot leave the first stage without its required fields');
select tests.throws(
  format($q$insert into public.deals (patient_id, name, stage_id) values (%s, 'Сразу в работе', %s)$q$,
    current_setting('t.patient'), tests.stage('В работе')),
  '23514', 'nor be created further in the pipeline');
-- A required checkbox must be ticked
select tests.throws(
  format($q$update public.deals set stage_id = %s, custom_values = custom_values || jsonb_build_object(%L, 'Болит', %L, false) where id = %s$q$,
    tests.stage('В работе'), tests.field('Жалоба'), tests.field('Есть снимок КТ'), current_setting('t.deal2')),
  '23514', 'a required checkbox must be ticked');
update public.deals
set stage_id = tests.stage('В работе'),
    custom_values = custom_values || jsonb_build_object(tests.field('Жалоба'), 'Болит', tests.field('Есть снимок КТ'), true)
where id = current_setting('t.deal2')::bigint;
select tests.assert(
  (select stage_id from public.deals where id = current_setting('t.deal2')::bigint) = tests.stage('В работе'),
  'with its required fields the deal moves on');
select tests.throws(
  format($q$update public.deals set custom_values = custom_values - %L where id = %s$q$,
    tests.field('Жалоба'), current_setting('t.deal2')),
  '23514', 'a required field cannot be cleared outside the first stage');
update public.deals set name = 'Брекеты (верх)' where id = current_setting('t.deal2')::bigint;
select tests.assert(
  (select name from public.deals where id = current_setting('t.deal2')::bigint) = 'Брекеты (верх)',
  'other edits do not check the custom fields');
-- Refusing is always possible
select tests.logout();
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.custom_fields (entity, name, type, required) values ('deal', 'Новое обязательное', 'text', true);
select tests.logout();
select tests.login_as(current_setting('t.m1')::uuid);
update public.deals
set stage_id = tests.stage('Отказ'),
    lost_reason_id = (select id from public.lost_reasons where organization_id = current_setting('t.org')::bigint limit 1)
where id = current_setting('t.deal2')::bigint;
select tests.assert(
  (select stage_id from public.deals where id = current_setting('t.deal2')::bigint) = tests.stage('Отказ'),
  'a deal can be refused without its required fields');
select tests.logout();

-- Automations and webhooks (no employee) are not blocked
insert into public.deals (organization_id, patient_id, name, stage_id)
values (current_setting('t.org')::bigint, current_setting('t.patient')::bigint, 'Системная', tests.stage('В работе'));
select tests.assert(tests.count('select 1 from public.deals where name = ''Системная''') = 1,
  'a deal written by the system does not check the required fields');

-- Patients: checked when an employee saves their custom fields
select tests.login_as(current_setting('t.m1')::uuid);
insert into public.patients (first_name) values ('Быстрый');
select tests.assert(tests.count('select 1 from public.patients where first_name = ''Быстрый''') = 1,
  'a patient created without custom fields is not blocked');
select tests.logout();
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.custom_fields (entity, name, type) values ('patient', 'Полис', 'text');
select tests.logout();
select tests.login_as(current_setting('t.m1')::uuid);
select tests.throws(
  format($q$update public.patients set custom_values = jsonb_build_object(%L, 'П-1') where first_name = 'Быстрый'$q$, tests.field('Полис')),
  '23514', 'saving the custom fields of a patient needs its required ones');
update public.patients set custom_values = jsonb_build_object(tests.field('Полис'), 'П-1', tests.field('Аллергия'), 'нет')
where first_name = 'Быстрый';
select tests.assert(
  (select custom_values ->> tests.field('Аллергия') from public.patients_summary where first_name = 'Быстрый') = 'нет',
  'patients_summary shows the values');
select tests.logout();
select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert(
  (select changes -> ('cf:' || tests.field('Аллергия')) from public.audit_log
   where entity = 'patient' and action = 'update' order by id desc limit 1) = '[null, "нет"]'::jsonb,
  'the audit log shows the changed patient field');
select tests.logout();

--
-- Filtering: jsonb containment (custom_values@cs of the lists)
--

select tests.login_as(current_setting('t.m1')::uuid);
update public.deals
set custom_values = custom_values || jsonb_build_object(tests.field('Откуда узнал'), 'Реклама', tests.field('Аллергии'), jsonb_build_array('Латекс', 'Лидокаин'))
where id = current_setting('t.deal2')::bigint;
update public.deals
set custom_values = custom_values || jsonb_build_object(tests.field('Откуда узнал'), 'Инстаграм', tests.field('Есть снимок КТ'), true)
where id = current_setting('t.deal')::bigint;
select tests.assert(
  tests.count(format($q$select 1 from public.deals_summary where custom_values @> jsonb_build_object(%L, 'Инстаграм')$q$, tests.field('Откуда узнал'))) = 1,
  'filter by a select field');
select tests.assert(
  tests.count(format($q$select 1 from public.deals_summary where custom_values @> jsonb_build_object(%L, true)$q$, tests.field('Есть снимок КТ'))) = 2,
  'filter by a checkbox');
select tests.assert(
  tests.count(format($q$select 1 from public.deals_summary where custom_values @> jsonb_build_object(%L, jsonb_build_array('Лидокаин'))$q$, tests.field('Аллергии'))) = 1,
  'filter by an option of a multiselect');
select tests.assert(
  tests.count(format($q$select 1 from public.deals_summary where custom_values @> jsonb_build_object(%L, 'Инстаграм', %L, true)$q$,
    tests.field('Откуда узнал'), tests.field('Есть снимок КТ'))) = 1,
  'several fields: all of them');
select tests.logout();
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(
  tests.count(format($q$select 1 from public.deals_summary where custom_values @> jsonb_build_object(%L, 'Инстаграм')$q$, tests.field('Откуда узнал'))) = 0,
  'another clinic finds none of these deals');
select tests.logout();

--
-- Template variables {поле:Название}
--

update public.deals
set custom_values = custom_values || jsonb_build_object(
  tests.field('Сумма рассрочки'), 1250000, tests.field('Созвон'), '2026-03-12T09:30:00.000Z',
  tests.field('Дата снимка'), '2026-03-01', tests.field('Аллергии'), jsonb_build_array('Латекс', 'Пенициллин'))
where id = current_setting('t.deal')::bigint;
select set_config('t.vars', (select private.automessage_vars(d)::text from public.deals d where d.id = current_setting('t.deal')::bigint), true);
select tests.assert(current_setting('t.vars')::jsonb ->> 'поле:Откуда узнал' = 'Инстаграм', 'a select value');
select tests.assert(current_setting('t.vars')::jsonb ->> 'поле:Сумма рассрочки' = '1 250 000 ₸', 'money in tenge');
select tests.assert(current_setting('t.vars')::jsonb ->> 'поле:Созвон' = '12 марта в 14:30', 'date and time in the clinic time zone');
select tests.assert(current_setting('t.vars')::jsonb ->> 'поле:Дата снимка' = '01.03.2026', 'a date');
select tests.assert(current_setting('t.vars')::jsonb ->> 'поле:Есть снимок КТ' = 'да', 'a checkbox');
select tests.assert(current_setting('t.vars')::jsonb ->> 'поле:Аллергии' = 'Латекс, Пенициллин', 'a multiselect');
select tests.assert(current_setting('t.vars')::jsonb ? 'поле:Жалоба' and current_setting('t.vars')::jsonb ->> 'поле:Жалоба' is null,
  'a field without a value is an empty variable');
select tests.assert(
  private.render_template('{имя}, рассрочка {поле:Сумма рассрочки}, источник {поле:Откуда узнал}. {поле:Жалоба} {поле:Нет такого}',
    current_setting('t.vars')::jsonb)
    = 'Асель, рассрочка 1 250 000 ₸, источник Инстаграм. {поле:Нет такого}',
  'a template renders the fields, an unknown field stays as written');
select tests.assert(
  not (select private.automessage_vars(d) ? 'поле:Откуда узнал' from public.deals d where d.name = 'Чужая сделка'),
  'another clinic only has the variables of its own fields');

--
-- Import: values of the file, never over the clinic's values
--

select tests.login_as(current_setting('t.owner')::uuid);
select set_config('t.result', public.import_batch('deals', jsonb_build_array(
  jsonb_build_object('index', 2, 'system', 'amocrm',
    'patient', jsonb_build_object('first_name', 'Ерлан', 'phones', jsonb_build_array('7012223344'),
      'custom_values', jsonb_build_object(tests.field('Аллергия'), 'Лидокаин')),
    'deal', jsonb_build_object('external_id', '501', 'name', 'Виниры', 'stage_id', tests.stage('Записан'),
      'custom_values', jsonb_build_object(tests.field('Откуда узнал'), '2gis'))),
  jsonb_build_object('index', 3, 'system', 'amocrm',
    'patient', jsonb_build_object('first_name', 'Дана', 'phones', jsonb_build_array('7013334455')),
    'deal', jsonb_build_object('external_id', '502', 'name', 'Гигиена',
      'custom_values', jsonb_build_object(tests.field('Откуда узнал'), 'Telegram')))
))::text, true);
select tests.assert(
  (current_setting('t.result')::jsonb ->> 'created')::int = 1
  and jsonb_array_length(current_setting('t.result')::jsonb -> 'errors') = 1
  and current_setting('t.result')::jsonb -> 'errors' -> 0 ->> 'message' like 'Поле «Откуда узнал»%',
  'the import stores the values, a wrong value fails its row');
select tests.assert(
  (select custom_values ->> tests.field('Откуда узнал') from public.deals where name = 'Виниры') = '2GIS'
  and (select custom_values ->> tests.field('Аллергия') from public.patients where first_name = 'Ерлан') = 'Лидокаин',
  'imported values are normalized; required fields do not block the import');
select public.import_batch('deals', jsonb_build_array(
  jsonb_build_object('index', 2, 'system', 'amocrm',
    'patient', jsonb_build_object('first_name', 'Ерлан', 'phones', jsonb_build_array('7012223344')),
    'deal', jsonb_build_object('external_id', '501', 'name', 'Виниры',
      'custom_values', jsonb_build_object(tests.field('Откуда узнал'), 'Реклама', tests.field('Полис ДМС'), 'D-5')))));
select tests.assert(
  (select custom_values from public.deals where name = 'Виниры')
    = jsonb_build_object(tests.field('Откуда узнал'), '2GIS', tests.field('Полис ДМС'), 'D-5'),
  'a second import only fills the missing fields');
select tests.logout();

-- Deleting the clinic removes its fields
delete from public.organizations where id = current_setting('t.org')::bigint;
select tests.assert(
  (select count(*) from public.custom_fields where organization_id = current_setting('t.org')::bigint) = 0,
  'deleting the clinic deletes its fields');

rollback;

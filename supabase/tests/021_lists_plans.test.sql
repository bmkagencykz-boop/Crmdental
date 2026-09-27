--
-- Stage 21: saved filters (personal and clinic-wide, per role), bulk actions
-- on deals (rights through RLS, per-deal failures, audit rows, messages
-- through the mailing queue), the sales plan (targets per role, facts of a
-- month against known data) and clinic isolation.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m2', tests.invite('m2@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.owner_id', (select id from public.sales where email = 'owner@clinic.kz')::text, true);
select set_config('t.head_id', (select id from public.sales where email = 'head@clinic.kz')::text, true);
select set_config('t.m1_id', (select id from public.sales where email = 'm1@clinic.kz')::text, true);
select set_config('t.m2_id', (select id from public.sales where email = 'm2@clinic.kz')::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);

-- No automatic tasks: the tests count their own
delete from public.task_rules;

create function tests.stage(org bigint, stage_name text) returns bigint language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
  where p.organization_id = org and p.is_default and s.name = stage_name
$$;
create function tests.deal(deal_name text) returns bigint language sql security definer as $$
  select id from public.deals where organization_id = current_setting('t.org')::bigint and name = deal_name
$$;
-- The result of one deal in a bulk_deals answer
create function tests.result(answer jsonb, deal_name text) returns jsonb language sql security definer as $$
  select r from jsonb_array_elements(answer -> 'results') r where (r ->> 'id')::bigint = tests.deal(deal_name)
$$;
grant execute on function tests.stage(bigint, text) to authenticated;
grant execute on function tests.deal(text) to authenticated;
grant execute on function tests.result(jsonb, text) to authenticated;

--
-- Saved filters
--
select tests.login_as(current_setting('t.m1')::uuid);
insert into public.saved_filters (name, filter) values ('Мои горячие', '{"sales_id": "$me", "tags@cs": "{1}"}');
select tests.assert(
  (select sales_id = current_setting('t.m1_id')::bigint and resource = 'deals' from public.saved_filters where name = 'Мои горячие'),
  'a filter is personal by default');
select tests.throws(
  $q$insert into public.saved_filters (name, filter, sales_id) values ('Общий', '{}', null)$q$,
  '42501', 'a manager cannot save a clinic-wide filter');
select tests.throws(
  format($q$insert into public.saved_filters (name, filter, sales_id) values ('Чужой', '{}', %s)$q$, current_setting('t.m2_id')),
  '42501', 'a manager cannot save a filter for another employee');
select tests.throws(
  $q$insert into public.saved_filters (name, filter) values ('Массив', '[]')$q$,
  '23514', 'a filter is an object');
select tests.throws(
  $q$insert into public.saved_filters (name, filter) values ('  ', '{}')$q$,
  '23514', 'a filter has a name');
select tests.logout();

select tests.login_as(current_setting('t.head')::uuid);
insert into public.saved_filters (name, filter, sales_id, position) values ('Без задач', '{"task_state": "no_task"}', null, 1);
select tests.assert(tests.count('select * from public.saved_filters') = 1, 'the head does not see personal filters of a manager');
select tests.logout();

select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(tests.count('select * from public.saved_filters') = 2, 'a manager sees the clinic filters and their own');
select tests.assert(
  tests.affected($q$update public.saved_filters set name = 'Взлом' where sales_id is null$q$) = 0,
  'a manager cannot edit a clinic filter');
select tests.assert(
  tests.affected($q$delete from public.saved_filters where sales_id is null$q$) = 0,
  'a manager cannot delete a clinic filter');
select tests.assert(
  tests.affected($q$update public.saved_filters set filter = '{"sales_id": "$me"}' where name = 'Мои горячие'$q$) = 1,
  'a manager edits their own filter');
select tests.throws(
  $q$update public.saved_filters set sales_id = null where name = 'Мои горячие'$q$,
  '42501', 'a manager cannot turn a personal filter into a clinic one');
select tests.logout();

select tests.login_as(current_setting('t.m2')::uuid);
select tests.assert(tests.count('select * from public.saved_filters') = 1, 'another manager only sees the clinic filter');
select tests.assert(
  tests.affected($q$delete from public.saved_filters where name = 'Мои горячие'$q$) = 0,
  'another manager cannot delete my filter');
select tests.logout();

select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert(
  tests.affected($q$update public.saved_filters set name = 'Сделки без задач' where sales_id is null$q$) = 1,
  'the owner edits a clinic filter');
select tests.logout();

--
-- Bulk actions: the fixture
--
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.tags (name, color) values ('VIP', '#EF3B6E'), ('Рассрочка', '#83A2DB');
select set_config('t.vip', (select id from public.tags where name = 'VIP')::text, true);
select set_config('t.credit', (select id from public.tags where name = 'Рассрочка')::text, true);
insert into public.patients (first_name, phone_jsonb) values
  ('Асель', '[{"number": "+7 701 000 00 01"}]'),
  ('Бота', '[{"number": "+7 701 000 00 02"}]'),
  ('Вика', '[{"number": "+7 701 000 00 03"}]'),
  ('Гуля', '[]');
insert into public.deals (patient_id, name, sales_id, tags)
select p.id, v.name, v.sales_id, v.tags
from (values
  ('Асель', 'd1', current_setting('t.m1_id')::bigint, array[current_setting('t.credit')::bigint]),
  ('Асель', 'd2', current_setting('t.m1_id')::bigint, array[]::bigint[]),
  ('Бота', 'd3', current_setting('t.m2_id')::bigint, array[]::bigint[]),
  ('Вика', 'd4', null, array[]::bigint[]),
  ('Гуля', 'd5', current_setting('t.m1_id')::bigint, array[]::bigint[])
) as v(patient, name, sales_id, tags)
join public.patients p on p.first_name = v.patient and p.organization_id = current_setting('t.org')::bigint;
-- A checklist on the first stage, done for d1 only
insert into public.stage_checklist_items (stage_id, text)
values (tests.stage(current_setting('t.org')::bigint, 'Новый лид'), 'Уточнить жалобу');
insert into public.deal_checklist_checks (deal_id, item_id)
select tests.deal('d1'), i.id from public.stage_checklist_items i where i.text = 'Уточнить жалобу';
-- Managers only see their own deals
update public.organization_settings set manager_deal_visibility = 'own';
select tests.logout();

--
-- Stage: the checklist blocks one deal, the others move
--
select tests.login_as(current_setting('t.owner')::uuid);
select set_config('t.answer', public.bulk_deals('stage', array[tests.deal('d1'), tests.deal('d2'), tests.deal('d1'), -1],
  jsonb_build_object('stage_id', tests.stage(current_setting('t.org')::bigint, 'Записан')))::text, true);
select tests.assert(
  jsonb_array_length(current_setting('t.answer')::jsonb -> 'results') = 3
    and (current_setting('t.answer')::jsonb ->> 'ok')::int = 1 and (current_setting('t.answer')::jsonb ->> 'failed')::int = 2,
  'one result per distinct deal');
select tests.assert(
  (tests.result(current_setting('t.answer')::jsonb, 'd1') ->> 'ok')::boolean,
  'd1 (checklist done) moves');
select tests.assert(
  tests.result(current_setting('t.answer')::jsonb, 'd2') ->> 'code' = 'stage_checklist_incomplete'
    and tests.result(current_setting('t.answer')::jsonb, 'd2') ->> 'error' like 'Выполните чек-лист этапа%',
  'd2 is blocked by the checklist, with the reason');
select tests.assert(
  (select r ->> 'code' from jsonb_array_elements(current_setting('t.answer')::jsonb -> 'results') r where (r ->> 'id')::bigint = -1) = 'not_found',
  'an unknown deal is reported');
select tests.assert(
  (select s.name from public.deals d join public.stages s on s.id = d.stage_id where d.id = tests.deal('d1')) = 'Записан'
    and (select s.name from public.deals d join public.stages s on s.id = d.stage_id where d.id = tests.deal('d2')) = 'Новый лид',
  'only d1 changed stage');
select tests.assert(
  (select count(*) from public.audit_log a
   where a.organization_id = current_setting('t.org')::bigint and a.entity = 'deal' and a.action = 'stage_change'
     and a.deal_id = tests.deal('d1') and a.source = 'user' and a.sales_id = current_setting('t.owner_id')::bigint) = 1,
  'the stage change is in the audit log, by the owner, source user');

-- A lost stage needs a reason, a lost deal stays lost
select set_config('t.answer', public.bulk_deals('stage', array[tests.deal('d4')],
  jsonb_build_object('stage_id', tests.stage(current_setting('t.org')::bigint, 'Отказ')))::text, true);
select tests.assert(
  tests.result(current_setting('t.answer')::jsonb, 'd4') ->> 'code' = 'lost_reason_required',
  'a refusal without a reason fails');
select set_config('t.answer', public.bulk_deals('stage', array[tests.deal('d4')],
  jsonb_build_object('stage_id', tests.stage(current_setting('t.org')::bigint, 'Отказ'),
    'lost_reason_id', (select id from public.lost_reasons where organization_id = current_setting('t.org')::bigint and name = 'Дорого'),
    'lost_comment', 'Дорого для неё'))::text, true);
select tests.assert(
  (tests.result(current_setting('t.answer')::jsonb, 'd4') ->> 'ok')::boolean
    and (select lost_comment from public.deals where id = tests.deal('d4')) = 'Дорого для неё',
  'a refusal with a reason works');
select set_config('t.answer', public.bulk_deals('stage', array[tests.deal('d4')],
  jsonb_build_object('stage_id', tests.stage(current_setting('t.org')::bigint, 'В работе')))::text, true);
select tests.assert(
  tests.result(current_setting('t.answer')::jsonb, 'd4') ->> 'code' = 'deal_lost_locked',
  'a lost deal does not come back');
select tests.throws(
  $q$select public.bulk_deals('stage', array[1], '{}')$q$,
  '22023', 'the stage is required');
select tests.throws(
  $q$select public.bulk_deals('explode', array[1], '{}')$q$,
  '22023', 'an unknown action is refused');
select tests.logout();

--
-- Managers: RLS decides, the owner-only actions are refused
--
select tests.login_as(current_setting('t.m1')::uuid);
select set_config('t.answer', public.bulk_deals('add_tags', array[tests.deal('d1'), tests.deal('d3')],
  jsonb_build_object('tag_ids', jsonb_build_array(current_setting('t.vip')::bigint, current_setting('t.credit')::bigint)))::text, true);
select tests.assert(
  (tests.result(current_setting('t.answer')::jsonb, 'd1') ->> 'ok')::boolean
    and tests.result(current_setting('t.answer')::jsonb, 'd3') ->> 'code' = 'not_found',
  'a manager tags their deal, not the deal of another manager');
select tests.throws(
  format($q$select public.bulk_deals('archive', array[%s], '{}')$q$, tests.deal('d1')),
  '42501', 'a manager cannot archive in bulk');
select tests.throws(
  format($q$select public.bulk_deals('delete', array[%s], '{}')$q$, tests.deal('d1')),
  '42501', 'a manager cannot delete in bulk');
select tests.throws(
  format($q$select public.bulk_deals('message', array[%s], '{"body": "Привет"}')$q$, tests.deal('d1')),
  '42501', 'a manager cannot message in bulk');
select public.bulk_deals('task', array[tests.deal('d1'), tests.deal('d3')],
  '{"text": "Перезвонить", "due_date": "2026-10-01T10:00:00+05:00"}');
select tests.logout();
select tests.assert(
  (select tags from public.deals where id = tests.deal('d1')) = array[current_setting('t.credit')::bigint, current_setting('t.vip')::bigint]
    and (select tags from public.deals where id = tests.deal('d3')) = '{}',
  'tags are added once, the hidden deal is untouched');
select tests.assert(
  (select count(*) from public.tasks where text = 'Перезвонить' and deal_id = tests.deal('d1') and sales_id = current_setting('t.m1_id')::bigint) = 1
    and (select count(*) from public.tasks where text = 'Перезвонить' and deal_id = tests.deal('d3')) = 0,
  'a task for each visible deal, given to its responsible');
select tests.assert(
  (select count(*) from public.audit_log a
   where a.entity = 'task' and a.action = 'create' and a.deal_id = tests.deal('d1')
     and a.source = 'user' and a.sales_id = current_setting('t.m1_id')::bigint) = 1,
  'the bulk task is logged with the manager as author');

--
-- Owner: responsible, tags removal, messages, archive, delete
--
select tests.login_as(current_setting('t.owner')::uuid);
select set_config('t.answer', public.bulk_deals('responsible', array[tests.deal('d2'), tests.deal('d4')],
  jsonb_build_object('sales_id', current_setting('t.m2_id')::bigint))::text, true);
select tests.assert((current_setting('t.answer')::jsonb ->> 'ok')::int = 2, 'the responsible changes on both deals');
select tests.throws(
  $q$select public.bulk_deals('responsible', array[1], '{"sales_id": -5}')$q$,
  '22023', 'the employee must exist in the clinic');
select public.bulk_deals('remove_tags', array[tests.deal('d1')], jsonb_build_object('tag_ids', jsonb_build_array(current_setting('t.credit')::bigint)));
select tests.logout();
select tests.assert(
  (select count(*) from public.deals where id in (tests.deal('d2'), tests.deal('d4')) and sales_id = current_setting('t.m2_id')::bigint) = 2,
  'both deals belong to m2');
select tests.assert(
  (select count(*) from public.audit_log a
   where a.entity = 'deal' and a.action = 'update' and a.deal_id = tests.deal('d2') and a.changes ? 'sales_id'
     and a.source = 'user' and a.sales_id = current_setting('t.owner_id')::bigint) = 1,
  'the new responsible is logged');
select tests.assert(
  (select tags from public.deals where id = tests.deal('d1')) = array[current_setting('t.vip')::bigint],
  'a tag is removed, the others stay');

-- Messages: d1 and d2 share a patient (one message), Вика opted out, Гуля has no phone
update public.patients set messaging_opt_out = true where first_name = 'Вика' and organization_id = current_setting('t.org')::bigint;
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.message_templates (name, body) values ('Акция', 'Здравствуйте, {имя}! Скидка на {услуга}.');
select set_config('t.answer', public.bulk_deals('message', array[tests.deal('d1'), tests.deal('d2'), tests.deal('d3'), tests.deal('d4'), tests.deal('d5')],
  jsonb_build_object('template_id', (select id from public.message_templates where name = 'Акция')))::text, true);
select tests.assert(
  (current_setting('t.answer')::jsonb ->> 'ok')::int = 2 and (current_setting('t.answer')::jsonb ->> 'mailing_id') is not null,
  'two patients are queued');
select tests.assert(
  (select count(*) from jsonb_array_elements(current_setting('t.answer')::jsonb -> 'results') r where (r ->> 'ok')::boolean
     and (r ->> 'id')::bigint in (tests.deal('d2'), tests.deal('d3'))) = 2,
  'the latest updated deal of a patient gets the message');
select tests.assert(
  tests.result(current_setting('t.answer')::jsonb, 'd1') ->> 'code' = 'duplicate'
    and tests.result(current_setting('t.answer')::jsonb, 'd4') ->> 'code' = 'opted_out'
    and tests.result(current_setting('t.answer')::jsonb, 'd5') ->> 'code' = 'no_contact',
  'the other deals say why');
select tests.assert(
  (select m.name = 'Акция' and m.recipients_count = 2 and m.body like 'Здравствуйте, {имя}!%' and m.segment ? 'deal_ids'
   from public.mailings m where m.id = (current_setting('t.answer')::jsonb ->> 'mailing_id')::bigint),
  'a mailing of the chosen deals, named after the template');
select tests.assert(
  (select count(*) from public.mailing_messages mm
   where mm.mailing_id = (current_setting('t.answer')::jsonb ->> 'mailing_id')::bigint
     and mm.status = 'pending' and mm.deal_id in (tests.deal('d2'), tests.deal('d3'))) = 2,
  'the queue rows are attached to the chosen deals and wait for the dispatcher');
select tests.assert(
  (select count(*) from public.audit_log a
   where a.entity = 'mailing' and a.action = 'create' and a.source = 'user'
     and a.sales_id = current_setting('t.owner_id')::bigint and a.changes -> 'name' ->> 1 = 'Акция') = 1,
  'the mailing is in the audit log');
select tests.throws(
  $q$select public.bulk_deals('message', array[1], '{}')$q$,
  '22023', 'a message needs a template or a text');

select set_config('t.answer', public.bulk_deals('archive', array[tests.deal('d5')], '{}')::text, true);
select tests.assert((current_setting('t.answer')::jsonb ->> 'ok')::int = 1, 'the owner archives');
select tests.assert(
  (select archived_at is not null from public.deals where id = tests.deal('d5')),
  'the deal is archived');
select set_config('t.d5', tests.deal('d5')::text, true);
select set_config('t.answer', public.bulk_deals('delete', array[tests.deal('d5')], '{}')::text, true);
select tests.assert((current_setting('t.answer')::jsonb ->> 'ok')::int = 1, 'the owner deletes');
select tests.logout();
select tests.assert(tests.deal('d5') is null, 'the deal is gone');
select tests.assert(
  (select count(*) from public.audit_log a
   where a.entity = 'deal' and a.action = 'delete' and a.entity_id = current_setting('t.d5')::bigint
     and a.source = 'user' and a.sales_id = current_setting('t.owner_id')::bigint) = 1,
  'the deletion is logged');
select tests.assert(
  (select count(*) from public.audit_log a
   where a.entity = 'deal' and a.action = 'archive' and a.entity_id = current_setting('t.d5')::bigint and a.source = 'user') = 1,
  'the archiving is logged');

-- The head archives too
select tests.login_as(current_setting('t.head')::uuid);
select tests.assert(
  (public.bulk_deals('archive', array[tests.deal('d4')], '{}') ->> 'ok')::int = 1,
  'the head archives');
select tests.logout();

-- Another clinic changes nothing
select tests.login_as(current_setting('t.other')::uuid);
select set_config('t.answer', public.bulk_deals('add_tags', array[tests.deal('d1'), tests.deal('d2')],
  jsonb_build_object('tag_ids', jsonb_build_array(current_setting('t.credit')::bigint)))::text, true);
select tests.assert(
  (current_setting('t.answer')::jsonb ->> 'failed')::int = 2 and (current_setting('t.answer')::jsonb ->> 'ok')::int = 0,
  'another clinic cannot touch these deals');
select tests.assert(
  (public.bulk_deals('delete', array[tests.deal('d1')], '{}') -> 'results' -> 0 ->> 'code') = 'not_found',
  'another clinic cannot delete them');
select tests.assert(tests.count('select * from public.saved_filters') = 0, 'another clinic sees no saved filter');
select tests.throws(
  format($q$insert into public.saved_filters (organization_id, name, filter, sales_id) values (%s, 'Чужой', '{}', null)$q$, current_setting('t.org')),
  '42501', 'another clinic cannot add filters to the first one');
select tests.logout();
select tests.assert(
  (select tags from public.deals where id = tests.deal('d1')) = array[current_setting('t.vip')::bigint],
  'the deal of the first clinic is unchanged');

--
-- Sales plan: a clinic with known facts this month
--
select set_config('t.powner', tests.sign_up('owner@plan.kz', 'План')::text, true);
select set_config('t.porg', tests.org_of(current_setting('t.powner')::uuid)::text, true);
select set_config('t.pm1', tests.invite('pm1@plan.kz', current_setting('t.porg')::bigint, 'manager')::text, true);
select set_config('t.pm1_id', (select id from public.sales where email = 'pm1@plan.kz')::text, true);
select set_config('t.powner_id', (select id from public.sales where email = 'owner@plan.kz')::text, true);
select set_config('t.month', to_char(date_trunc('month', now() at time zone 'Asia/Almaty'), 'YYYY-MM-DD'), true);
select set_config('t.today', to_char(now() at time zone 'Asia/Almaty', 'YYYY-MM-DD'), true);
delete from public.task_rules where organization_id = current_setting('t.porg')::bigint;

select tests.login_as(current_setting('t.powner')::uuid);
insert into public.patients (first_name) values ('П');
-- This month: p1 (pm1) won, p2 (pm1) came to the consultation, p3 (owner) new,
-- p4 (nobody) won; p5 (pm1) is old and won long ago
insert into public.deals (patient_id, name, sales_id)
select p.id, v.name, v.sales_id
from public.patients p, (values
  ('p1', current_setting('t.pm1_id')::bigint),
  ('p2', current_setting('t.pm1_id')::bigint),
  ('p3', current_setting('t.powner_id')::bigint),
  ('p4', null::bigint),
  ('p5', current_setting('t.pm1_id')::bigint)
) as v(name, sales_id)
where p.organization_id = current_setting('t.porg')::bigint;
update public.deals set stage_id = tests.stage(current_setting('t.porg')::bigint, 'Пришёл на консультацию')
where organization_id = current_setting('t.porg')::bigint and name in ('p1', 'p2');
update public.deals set stage_id = tests.stage(current_setting('t.porg')::bigint, 'Лечение завершено')
where organization_id = current_setting('t.porg')::bigint and name in ('p1', 'p4', 'p5');
insert into public.deal_payments (deal_id, amount, paid_at)
select d.id, v.amount, v.paid_at::date
from public.deals d, (values
  ('p1', 150000, current_setting('t.today')),
  ('p4', 50000, current_setting('t.today')),
  ('p1', 70000, (current_setting('t.month')::date - 1)::text)
) as v(name, amount, paid_at)
where d.organization_id = current_setting('t.porg')::bigint and d.name = v.name;
select tests.logout();
-- p5 belongs to last year: created, visited and won then; p4 has no responsible
-- (a deal created by an employee gets them by default)
set local session_replication_role = replica;
update public.deals set sales_id = null
where organization_id = current_setting('t.porg')::bigint and name = 'p4';
update public.deals set created_at = now() - interval '1 year', stage_changed_at = now() - interval '1 year'
where organization_id = current_setting('t.porg')::bigint and name = 'p5';
update public.deal_events set created_at = now() - interval '1 year'
where deal_id = (select id from public.deals where organization_id = current_setting('t.porg')::bigint and name = 'p5');
set local session_replication_role = origin;

-- Managers have no plan
select tests.login_as(current_setting('t.pm1')::uuid);
select tests.throws($q$select public.report_sales_plan()$q$, '42501', 'a manager cannot read the plan report');
select tests.throws(
  $q$select public.save_sales_plan(current_date, '[{"sales_id": null, "paid_amount": 1}]')$q$,
  '42501', 'a manager cannot set the plan');
select tests.throws(
  $q$insert into public.sales_plans (month, paid_amount) values (date_trunc('month', current_date), 1)$q$,
  '42501', 'a manager cannot write the plan table');
select tests.logout();

select tests.login_as(current_setting('t.powner')::uuid);
select public.save_sales_plan(current_setting('t.month')::date + 10, jsonb_build_array(
  jsonb_build_object('sales_id', null, 'new_deals', 10, 'won_deals', 4, 'paid_amount', 1000000, 'visits', 6),
  jsonb_build_object('sales_id', current_setting('t.pm1_id')::bigint, 'new_deals', 5, 'paid_amount', 500000),
  jsonb_build_object('sales_id', current_setting('t.powner_id')::bigint, 'new_deals', 3)
));
-- Saving again updates, an empty row removes
select public.save_sales_plan(current_setting('t.month')::date, jsonb_build_array(
  jsonb_build_object('sales_id', current_setting('t.pm1_id')::bigint, 'new_deals', 6, 'paid_amount', 600000, 'won_deals', 2),
  jsonb_build_object('sales_id', current_setting('t.powner_id')::bigint)
));
select tests.assert(
  tests.count('select * from public.sales_plans') = 2,
  'one plan per employee and month, the empty one removed');
select tests.throws(
  $q$select public.save_sales_plan(current_date, '[{"sales_id": null, "paid_amount": -1}]')$q$,
  '23514', 'a target is not negative');
select tests.throws(
  $q$insert into public.sales_plans (month, paid_amount) values ('2026-09-15', 1)$q$,
  '23514', 'a plan is for a whole month');

select set_config('t.report', public.report_sales_plan()::text, true);
select tests.logout();

select tests.assert(
  current_setting('t.report')::jsonb ->> 'month' = current_setting('t.month')
    and (current_setting('t.report')::jsonb ->> 'days_elapsed')::int = extract(day from current_setting('t.today')::date)::int
    and (current_setting('t.report')::jsonb ->> 'days_total')::int
      = ((current_setting('t.month')::date + interval '1 month')::date - current_setting('t.month')::date),
  'the month and its days in the clinic time zone');
select tests.assert(
  current_setting('t.report')::jsonb -> 'clinic' -> 'plan'
    = '{"new_deals": 10, "won_deals": 4, "paid_amount": 1000000, "visits": 6}'::jsonb,
  'the clinic plan');
select tests.assert(
  current_setting('t.report')::jsonb -> 'clinic' -> 'fact'
    = '{"new_deals": 4, "won_deals": 2, "paid_amount": 200000, "visits": 3}'::jsonb,
  'the clinic facts: 4 new deals, 2 won, the payments of the month, 3 visits (won deals went past the visit)');
select tests.assert(
  (select s -> 'fact' = '{"new_deals": 2, "won_deals": 1, "paid_amount": 150000, "visits": 2}'::jsonb
     and s -> 'plan' = '{"new_deals": 6, "won_deals": 2, "paid_amount": 600000, "visits": null}'::jsonb
   from jsonb_array_elements(current_setting('t.report')::jsonb -> 'by_sales') s
   where (s ->> 'id')::bigint = current_setting('t.pm1_id')::bigint),
  'the facts and the plan of a manager');
select tests.assert(
  (select s -> 'fact' = '{"new_deals": 1, "won_deals": 0, "paid_amount": 0, "visits": 0}'::jsonb and s -> 'plan' = 'null'::jsonb
   from jsonb_array_elements(current_setting('t.report')::jsonb -> 'by_sales') s
   where (s ->> 'id')::bigint = current_setting('t.powner_id')::bigint),
  'an employee without a plan');

-- A month without data
select tests.login_as(current_setting('t.powner')::uuid);
select tests.assert(
  (public.report_sales_plan('2020-02-10') -> 'clinic' -> 'fact') = '{"new_deals": 0, "won_deals": 0, "paid_amount": 0, "visits": 0}'::jsonb
    and (public.report_sales_plan('2020-02-10') ->> 'days_total')::int = 29
    and (public.report_sales_plan('2020-02-10') ->> 'days_elapsed')::int = 29
    and public.report_sales_plan('2020-02-10') -> 'clinic' -> 'plan' = 'null'::jsonb,
  'a past month: all its days elapsed, no plan');
select tests.logout();

-- The audit log records the plan
select tests.assert(
  (select count(*) from public.audit_log a
   where a.organization_id = current_setting('t.porg')::bigint and a.entity = 'sales_plan' and a.source = 'user'
     and a.sales_id = current_setting('t.powner_id')::bigint) = 5,
  'the plan changes are logged: 3 created, 1 updated, 1 deleted');

-- Isolation: the first clinic sees nothing of this plan
select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert(tests.count('select * from public.sales_plans') = 0, 'another clinic sees no plan');
select tests.assert(
  (public.report_sales_plan() -> 'clinic' -> 'fact' ->> 'paid_amount')::bigint = 0,
  'the facts of another clinic are not counted');
select tests.assert(
  tests.affected(format($q$delete from public.sales_plans where organization_id = %s$q$, current_setting('t.porg'))) = 0,
  'another clinic cannot delete the plan');
select tests.logout();

rollback;

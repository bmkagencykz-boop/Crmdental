--
-- Treatment plans with an estimate (stage 29): totals and discounts, the
-- agreed plan sets the plan amount of the deal and moves it to «План
-- согласован» (the stage checklist may refuse: skipped and logged), one main
-- plan per deal, progress, the discount limit per role, the price list,
-- rights, clinic isolation, the light patient card.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m2', tests.invite('m2@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.int', tests.invite('dev@agency.kz', current_setting('t.org')::bigint, 'integrator')::text, true);
select set_config('t.m1_id', (select id from public.sales where email = 'm1@clinic.kz')::text, true);
select set_config('t.m2_id', (select id from public.sales where email = 'm2@clinic.kz')::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);

create function tests.stage_id(stage_name text) returns bigint language sql as $$
  select s.id from public.stages s
  where s.organization_id = current_setting('t.org')::bigint and s.name = stage_name
$$;
create function tests.deal_stage(target bigint) returns text language sql as $$
  select s.name from public.deals d join public.stages s on s.id = d.stage_id where d.id = target
$$;
create function tests.plan_amount(target bigint) returns bigint language sql as $$
  select d.plan_amount from public.deals d where d.id = target
$$;
create function tests.plan_id(plan_name text) returns bigint language sql as $$
  select p.id from public.treatment_plans p where p.name = plan_name
$$;
grant execute on all functions in schema tests to authenticated;

-- The clinic: the price list, a doctor, a patient with two deals of m1
select tests.login_as(current_setting('t.owner')::uuid);
update public.task_rules set is_active = false;
insert into public.services (name, code, category, price, position) values
  ('Имплант Osstem', 'IMP-01', 'Имплантация', 180000, 20),
  ('Коронка циркониевая', 'ORT-02', 'Ортопедия', 120000, 21);
insert into public.doctors (name) values ('Ахметова Айгуль');
insert into public.patients (first_name, last_name) values ('Асель', 'Нурланова');
insert into public.deals (patient_id, name, sales_id, stage_id, doctor_id)
select p.id, d.name, current_setting('t.m1_id')::bigint, tests.stage_id(d.stage), (select id from public.doctors)
from public.patients p,
  (values ('d1', 'Пришёл на консультацию'), ('d2', 'Записан'), ('d3', 'В лечении')) as d(name, stage);
select set_config('t.patient', (select id from public.patients where first_name = 'Асель')::text, true);
select set_config('t.d1', (select id from public.deals where name = 'd1')::text, true);
select set_config('t.d2', (select id from public.deals where name = 'd2')::text, true);
select set_config('t.d3', (select id from public.deals where name = 'd3')::text, true);
select set_config('t.implant', (select id from public.services where code = 'IMP-01')::text, true);
select set_config('t.crown', (select id from public.services where code = 'ORT-02')::text, true);
select tests.logout();

select tests.assert(
  (select code = 'IMP-01' and category = 'Имплантация' and price = 180000 from public.services where id = current_setting('t.implant')::bigint),
  'the price list keeps a code, a category and a price');
select tests.assert(
  (select max_discount_percent = 10 from public.organization_settings where organization_id = current_setting('t.org')::bigint),
  'the discount limit of a clinic is 10 % by default');

--
-- Totals and discounts
--

select tests.login_as(current_setting('t.m1')::uuid);
insert into public.treatment_plans (deal_id, name) values (current_setting('t.d1')::bigint, 'Эконом');
select set_config('t.p1', tests.plan_id('Эконом')::text, true);
select tests.assert(
  (select patient_id = current_setting('t.patient')::bigint and status = 'draft' and not is_main
     and doctor_id = (select id from public.doctors) and created_by = current_setting('t.m1_id')::bigint
     and organization_id = current_setting('t.org')::bigint
   from public.treatment_plans where id = current_setting('t.p1')::bigint),
  'a new plan: draft, the patient and the doctor of the deal, its author');

insert into public.treatment_plan_items (plan_id, stage_no, service_id, name, tooth, quantity, unit_price, discount_percent, position) values
  (current_setting('t.p1')::bigint, 1, current_setting('t.implant')::bigint, null, ' 36 ', 2, 180000, 5, 0),
  (current_setting('t.p1')::bigint, 2, current_setting('t.crown')::bigint, 'Коронка на имплант', '36, 37', 2, 120000, 0, 1),
  (current_setting('t.p1')::bigint, 2, null, 'Снимок КТ', null, 1, 15000, 0, 2);
select tests.assert(
  (select name = 'Имплант Osstem' and tooth = '36' and line_total = 342000
   from public.treatment_plan_items where plan_id = current_setting('t.p1')::bigint and stage_no = 1),
  'an item takes the name of its service; line total = qty × price − discount');
update public.treatment_plans set discount_percent = 3, discount_amount = 2000 where id = current_setting('t.p1')::bigint;
select tests.assert(
  (select items_count = 3 and gross_amount = 615000 and subtotal_amount = 597000
     and total_amount = 577090 and discount_total = 37910 and done_count = 0
   from public.treatment_plans_summary where id = current_setting('t.p1')::bigint),
  'plan totals: gross 615 000, after item discounts 597 000, after 3 % and 2 000 ₸: 577 090');
select tests.assert(
  (select string_agg(stage_no || ':' || subtotal_amount, ',' order by stage_no)
   from public.treatment_plan_stages where plan_id = current_setting('t.p1')::bigint) = '1:342000,2:255000',
  'stage subtotals');
select tests.assert(tests.plan_amount(current_setting('t.d1')::bigint) = 0, 'a draft plan does not change the deal amount');
select tests.logout();

-- Rounding to whole tenge, half away from zero, like the TS twin
select tests.assert(private.treatment_plan_total(1001, 12.5, 0) = 876, 'plan discount rounds to whole tenge');
select tests.assert(private.treatment_plan_total(1000, 5, 5000) = 0, 'a plan total is never below zero');
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.treatment_plans (deal_id, name) values (current_setting('t.d3')::bigint, 'Округление');
insert into public.treatment_plan_items (plan_id, name, quantity, unit_price, discount_percent)
values (tests.plan_id('Округление'), 'Позиция', 1, 1001, 50), (tests.plan_id('Округление'), 'Ещё', 3, 333, 12.5);
select tests.assert(
  (select array_agg(line_total order by id) = array[501, 874]::bigint[] from public.treatment_plan_items where plan_id = tests.plan_id('Округление')),
  'line totals round half up (500.5 → 501, 874.125 → 874)');
select tests.logout();

--
-- Agreeing: plan amount and stage
--

select tests.login_as(current_setting('t.m1')::uuid);
update public.treatment_plans set status = 'presented' where id = current_setting('t.p1')::bigint;
select tests.assert(tests.deal_stage(current_setting('t.d1')::bigint) = 'Пришёл на консультацию', 'presenting does not move the deal');
update public.treatment_plans set status = 'agreed' where id = current_setting('t.p1')::bigint;
select tests.assert(
  (select is_main and agreed_at is not null from public.treatment_plans where id = current_setting('t.p1')::bigint),
  'an agreed plan becomes the main plan of the deal');
select tests.assert(tests.plan_amount(current_setting('t.d1')::bigint) = 577090, 'agreeing sets the plan amount of the deal');
select tests.assert(tests.deal_stage(current_setting('t.d1')::bigint) = 'План согласован', 'agreeing moves the deal to «План согласован»');
select tests.assert(
  exists (select 1 from public.stage_trigger_runs where deal_id = current_setting('t.d1')::bigint
    and event = 'treatment_plan' and action = 'move_stage' and status = 'done' and trigger_name = 'План лечения «Эконом»'),
  'the move is written to the deal feed');
select tests.logout();
select tests.assert(
  (private.automessage_vars((select d from public.deals d where d.id = current_setting('t.d1')::bigint)) ->> 'сумма_плана') = '577 090 ₸',
  '{сумма_плана} is the agreed total');
select tests.login_as(current_setting('t.m1')::uuid);

-- Items of the agreed plan change the amount
update public.treatment_plan_items set quantity = 1 where plan_id = current_setting('t.p1')::bigint and stage_no = 2 and name = 'Коронка на имплант';
select tests.assert(tests.plan_amount(current_setting('t.d1')::bigint) = 460690,
  'changing an item of the agreed plan updates the plan amount (477 000 − 3 % − 2 000)');
delete from public.treatment_plan_items where plan_id = current_setting('t.p1')::bigint and name = 'Снимок КТ';
select tests.assert(tests.plan_amount(current_setting('t.d1')::bigint) = (select total_amount from public.treatment_plans_summary where id = current_setting('t.p1')::bigint),
  'deleting an item updates the plan amount');

-- Progress: done items move the plan to in progress, all of them to completed
update public.treatment_plan_items set done = true where plan_id = current_setting('t.p1')::bigint and stage_no = 1;
select tests.assert(
  (select status = 'in_progress' and is_main from public.treatment_plans where id = current_setting('t.p1')::bigint)
  and (select done_at is not null from public.treatment_plan_items where plan_id = current_setting('t.p1')::bigint and stage_no = 1),
  'a done item moves the agreed plan to in progress');
update public.treatment_plan_items set done = true where plan_id = current_setting('t.p1')::bigint;
select tests.assert(
  (select status = 'completed' and done_count = items_count from public.treatment_plans_summary where id = current_setting('t.p1')::bigint),
  'all items done: the plan is completed («Выполнено N из M»)');
update public.treatment_plan_items set done = false where plan_id = current_setting('t.p1')::bigint and stage_no = 2;
select tests.assert(
  (select status = 'in_progress' from public.treatment_plans where id = current_setting('t.p1')::bigint),
  'an item undone: back to in progress');

--
-- One main plan per deal
--

select set_config('t.p2', public.duplicate_treatment_plan(current_setting('t.p1')::bigint)::text, true);
select tests.assert(
  (select name = 'Эконом (копия)' and status = 'draft' and not is_main and discount_percent = 3
   from public.treatment_plans where id = current_setting('t.p2')::bigint)
  and (select count(*) = 2 and bool_and(not done) from public.treatment_plan_items where plan_id = current_setting('t.p2')::bigint),
  '«Дублировать план»: a draft copy with the items, not done');
update public.treatment_plans set name = 'Премиум' where id = current_setting('t.p2')::bigint;
update public.treatment_plan_items set unit_price = 250000 where plan_id = current_setting('t.p2')::bigint and stage_no = 1;
update public.treatment_plans set status = 'agreed' where id = current_setting('t.p2')::bigint;
select tests.assert(
  (select count(*) from public.treatment_plans where deal_id = current_setting('t.d1')::bigint and is_main) = 1
  and (select is_main from public.treatment_plans where id = current_setting('t.p2')::bigint)
  and (select not is_main and status = 'in_progress' from public.treatment_plans where id = current_setting('t.p1')::bigint),
  'agreeing another variant makes it the main plan; the previous one keeps its status');
select tests.assert(
  tests.plan_amount(current_setting('t.d1')::bigint) = (select total_amount from public.treatment_plans_summary where id = current_setting('t.p2')::bigint),
  'the plan amount follows the new main plan');
update public.treatment_plan_items set quantity = 5 where plan_id = current_setting('t.p1')::bigint and stage_no = 1;
select tests.assert(
  tests.plan_amount(current_setting('t.d1')::bigint) = (select total_amount from public.treatment_plans_summary where id = current_setting('t.p2')::bigint),
  'items of a plan that is not the main one do not change the amount');
update public.treatment_plans set status = 'declined' where id = current_setting('t.p2')::bigint;
select tests.assert(
  (select not is_main from public.treatment_plans where id = current_setting('t.p2')::bigint)
  and (select count(*) from public.treatment_plans where deal_id = current_setting('t.d1')::bigint and is_main) = 0,
  'a declined plan is not the main plan');
update public.treatment_plans set is_main = true where id = current_setting('t.p1')::bigint;
select tests.assert(
  (select count(*) from public.treatment_plans where deal_id = current_setting('t.d1')::bigint and is_main) = 1,
  'an agreed plan can be made the main plan again');
update public.treatment_plans set is_main = true where id = current_setting('t.p2')::bigint;
select tests.assert(
  (select not is_main from public.treatment_plans where id = current_setting('t.p2')::bigint),
  'a declined plan cannot be the main plan');
select tests.throws(
  format($q$update public.treatment_plans set deal_id = %s where id = %s$q$, current_setting('t.d2'), current_setting('t.p1')),
  '22023', 'a plan stays in its deal');
select tests.logout();
select tests.assert(
  exists (select 1 from pg_indexes where indexname = 'treatment_plans_main_idx' and indexdef like '%UNIQUE%WHERE is_main%'),
  'the database keeps one main plan per deal');

--
-- The stage checklist refuses the move: skipped and logged
--

select tests.login_as(current_setting('t.owner')::uuid);
insert into public.stage_checklist_items (stage_id, text) values (tests.stage_id('Записан'), 'Подтвердить визит');
select tests.logout();
select tests.login_as(current_setting('t.m1')::uuid);
insert into public.treatment_plans (deal_id, name) values (current_setting('t.d2')::bigint, 'План d2');
insert into public.treatment_plan_items (plan_id, service_id, name, quantity, unit_price)
values (tests.plan_id('План d2'), current_setting('t.crown')::bigint, 'Коронка', 1, 120000);
update public.treatment_plans set status = 'agreed' where id = tests.plan_id('План d2');
select tests.assert(
  tests.deal_stage(current_setting('t.d2')::bigint) = 'Записан'
  and tests.plan_amount(current_setting('t.d2')::bigint) = 120000
  and (select status = 'agreed' from public.treatment_plans where id = tests.plan_id('План d2')),
  'a move refused by the checklist is skipped: the plan is agreed, the amount set');
select tests.assert(
  exists (select 1 from public.stage_trigger_runs where deal_id = current_setting('t.d2')::bigint
    and event = 'treatment_plan' and status = 'skipped' and error like 'Выполните чек-лист%'),
  'the skipped move is written to the deal feed');

-- A deal further along is not moved back
insert into public.treatment_plans (deal_id, name, status) values (current_setting('t.d3')::bigint, 'План d3', 'agreed');
select tests.assert(
  tests.deal_stage(current_setting('t.d3')::bigint) = 'В лечении'
  and not exists (select 1 from public.stage_trigger_runs where deal_id = current_setting('t.d3')::bigint),
  'a deal already in treatment stays where it is');
select tests.logout();

--
-- The discount limit per role, the price list
--

select tests.login_as(current_setting('t.m1')::uuid);
select tests.throws(
  format($q$insert into public.treatment_plan_items (plan_id, name, unit_price, discount_percent) values (%s, 'Скидка', 10000, 15)$q$, current_setting('t.p2')),
  '42501', 'a manager cannot give an item more than 10 %');
select tests.throws(
  format($q$update public.treatment_plans set discount_percent = 12 where id = %s$q$, current_setting('t.p2')),
  '42501', 'a manager cannot give the plan more than 10 %');
select tests.throws(
  format($q$update public.treatment_plans set discount_percent = 8, discount_amount = 100000 where id = %s$q$, current_setting('t.p2')),
  '42501', 'percent and amount together count against the limit');
update public.treatment_plans set discount_percent = 10, discount_amount = 0 where id = current_setting('t.p2')::bigint;
select tests.assert((select discount_percent = 10 from public.treatment_plans where id = current_setting('t.p2')::bigint),
  'a manager gives up to 10 %');
select tests.throws(
  format($q$insert into public.treatment_plan_items (plan_id, service_id, name, unit_price) values (%s, %s, 'Имплант', 150000)$q$,
    current_setting('t.p2'), current_setting('t.implant')),
  '42501', 'a manager cannot sell below the price list');
insert into public.treatment_plan_items (plan_id, service_id, name, unit_price) values (current_setting('t.p2')::bigint, current_setting('t.implant')::bigint, 'Имплант', 200000);
select tests.assert(
  tests.affected(format($q$update public.services set price = 1 where id = %s$q$, current_setting('t.implant'))) = 0,
  'a manager cannot change the price list');
select tests.logout();

select tests.login_as(current_setting('t.head')::uuid);
update public.treatment_plans set discount_percent = 20 where id = current_setting('t.p2')::bigint;
insert into public.treatment_plan_items (plan_id, service_id, name, unit_price, discount_percent)
values (current_setting('t.p2')::bigint, current_setting('t.implant')::bigint, 'Имплант по акции', 150000, 25);
update public.services set price = 190000 where id = current_setting('t.implant')::bigint;
update public.organization_settings set max_discount_percent = 30;
select tests.logout();
select tests.assert(
  (select discount_percent = 20 from public.treatment_plans where id = current_setting('t.p2')::bigint)
  and exists (select 1 from public.treatment_plan_items where name = 'Имплант по акции' and discount_percent = 25),
  'the head gives any discount and sells below the price list');
select tests.assert(
  exists (select 1 from public.audit_log where entity = 'service' and action = 'update' and changes ? 'price'),
  'a price change is in the audit log');

select tests.login_as(current_setting('t.m1')::uuid);
update public.treatment_plan_items set quantity = 2 where name = 'Имплант по акции';
select tests.assert((select quantity = 2 from public.treatment_plan_items where name = 'Имплант по акции'),
  'a manager edits an item with a discount given by the head');
update public.treatment_plans set discount_percent = 25 where id = current_setting('t.p2')::bigint;
select tests.assert((select discount_percent = 25 from public.treatment_plans where id = current_setting('t.p2')::bigint),
  'the clinic raised the limit: the manager gives 25 %');
select tests.logout();

--
-- Rights and clinic isolation
--

select tests.login_as(current_setting('t.int')::uuid);
select tests.assert(tests.count('select * from public.treatment_plans') = 0, 'the integrator sees no plans (no money)');
select tests.throws(
  format($q$insert into public.treatment_plans (deal_id, name) values (%s, 'x')$q$, current_setting('t.d1')),
  '42501', 'the integrator cannot create a plan');
select tests.logout();

select tests.login_as(current_setting('t.head')::uuid);
update public.organization_settings set manager_deal_visibility = 'own';
select tests.logout();
select tests.login_as(current_setting('t.m2')::uuid);
select tests.assert(tests.count('select * from public.treatment_plans') = 0
  and tests.count('select * from public.treatment_plan_items') = 0
  and tests.count('select * from public.treatment_plans_summary') = 0,
  'own: a manager does not see the plans of a colleague''s deal');
select tests.throws(
  format($q$insert into public.treatment_plans (deal_id, name) values (%s, 'x')$q$, current_setting('t.d1')),
  '42501', 'own: a manager cannot add a plan to a colleague''s deal');
select tests.throws(
  format($q$insert into public.treatment_plan_items (plan_id, name) values (%s, 'x')$q$, current_setting('t.p1')),
  '42501', 'own: a manager cannot add items to a colleague''s plan');
select tests.assert(
  tests.affected(format($q$update public.treatment_plans set name = 'x' where id = %s$q$, current_setting('t.p1'))) = 0,
  'own: a manager cannot edit a colleague''s plan');
select tests.logout();
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(tests.count('select * from public.treatment_plans') = 5, 'the manager of the deals sees their plans');
select tests.throws('select public.report_plan_services()', '42501', 'reports stay for the owner and the head');
select tests.logout();

select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.count('select * from public.treatment_plans') = 0
  and tests.count('select * from public.treatment_plan_items') = 0,
  'another clinic sees no plans');
select tests.assert(
  tests.affected(format($q$update public.treatment_plan_items set unit_price = 1 where plan_id = %s$q$, current_setting('t.p1'))) = 0,
  'another clinic cannot edit the items');
select tests.throws(
  format($q$select public.duplicate_treatment_plan(%s)$q$, current_setting('t.p1')),
  'P0002', 'another clinic cannot duplicate a plan');
select tests.logout();

--
-- Report «Согласованные планы по позициям»
--

select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert(
  (select (r -> 0 ->> 'name') = 'Имплант Osstem' and (r -> 0 ->> 'amount')::bigint > 0
   from (select public.report_plan_services() as r) q),
  'the report lists the services of the agreed plans by sum');

--
-- The light patient card
--

update public.patients set allergies = 'Лидокаин', preferred_doctor_id = (select id from public.doctors)
where id = current_setting('t.patient')::bigint;
select tests.assert(
  (select allergies = 'Лидокаин' and preferred_doctor_id is not null from public.patients_summary where id = current_setting('t.patient')::bigint),
  'the patient card shows allergies and the preferred doctor');
select tests.assert(
  exists (select 1 from public.audit_log where entity = 'patient' and changes ? 'allergies'),
  'medical notes are in the audit log');
insert into public.patients (first_name, last_name, allergies, chronic_diseases) values ('Асель', 'Дубль', 'Пенициллин', 'Диабет 2 типа');
insert into public.deals (patient_id, name) select id, 'd4' from public.patients where last_name = 'Дубль';
insert into public.treatment_plans (deal_id, name) select id, 'План дубля' from public.deals where name = 'd4';
select public.merge_patients(current_setting('t.patient')::bigint, (select id from public.patients where last_name = 'Дубль'), '{}'::jsonb);
select tests.assert(
  (select allergies = E'Лидокаин\nПенициллин' and chronic_diseases = 'Диабет 2 типа'
   from public.patients where id = current_setting('t.patient')::bigint),
  'merging patients keeps the medical notes of both');
select tests.assert(
  (select patient_id = current_setting('t.patient')::bigint from public.treatment_plans where name = 'План дубля'),
  'the plans follow their deal to the kept patient');
select tests.logout();

-- The audit log of the plans
select tests.assert(
  exists (select 1 from public.audit_log where entity = 'treatment_plan' and action = 'update'
    and changes -> 'status' ->> 1 = 'agreed' and deal_id = current_setting('t.d1')::bigint
    and sales_id = current_setting('t.m1_id')::bigint),
  'agreeing a plan is in the audit log of the deal');
select tests.assert(
  exists (select 1 from public.audit_log where entity = 'treatment_plan_item' and action = 'create'),
  'items are in the audit log');

rollback;

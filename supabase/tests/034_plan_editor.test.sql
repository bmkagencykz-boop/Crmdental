--
-- The treatment plan editor (stage 34): the dictionaries of a clinic (plan
-- types, directions), the header of a plan, real stages (numbers, status,
-- discount, cancelled ones aside), the totals with the extra discount in
-- percent or tenge, «Оплачено», stage templates, the duplicate, rights per
-- role, clinic isolation and the move of the stage-29 items to stages.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@plan.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.head', tests.invite('head@plan.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@plan.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m2', tests.invite('m2@plan.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.int', tests.invite('dev@agency.kz', current_setting('t.org')::bigint, 'integrator')::text, true);
select set_config('t.m1_id', (select id from public.sales where email = 'm1@plan.kz')::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);

create function tests.stage(target_plan bigint, stage_position integer) returns public.treatment_stages language sql as $$
  select * from public.treatment_stages s where s.plan_id = target_plan and s.position = stage_position
$$;
create function tests.summary(target_plan bigint) returns public.treatment_plans_summary language sql as $$
  select * from public.treatment_plans_summary s where s.id = target_plan
$$;
grant execute on all functions in schema tests to authenticated;

--
-- The dictionaries of a new clinic
--

select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert(
  (select string_agg(name, ',' order by position) from public.treatment_plan_types) = 'Основной,Альтернативный,Эконом,Премиум',
  'a new clinic gets the plan types');
select tests.assert(
  (select string_agg(name, ',' order by position) from public.treatment_directions)
    = 'Терапия,Хирургия,Ортопедия,Ортодонтия,Пародонтология,Имплантация,Гигиена,Детская стоматология',
  'a new clinic gets the directions of the stages');

update public.task_rules set is_active = false;
insert into public.services (name, code, category, price, position) values
  ('Лечение кариеса', 'T-01', 'Терапия', 25000, 20),
  ('Имплант Osstem', 'I-01', 'Имплантация', 100000, 21),
  ('Коронка циркониевая', 'O-02', 'Ортопедия', 60000, 22);
insert into public.doctors (name) values ('Ахметова Айгуль'), ('Жумабаев Ерлан');
insert into public.patients (first_name, last_name) values ('Асель', 'Нурланова');
insert into public.deals (patient_id, name, sales_id, doctor_id)
select p.id, d.name, current_setting('t.m1_id')::bigint, (select min(id) from public.doctors)
from public.patients p, (values ('d1'), ('d2')) as d(name);
select set_config('t.d1', (select id from public.deals where name = 'd1')::text, true);
select set_config('t.d2', (select id from public.deals where name = 'd2')::text, true);
select set_config('t.caries', (select id from public.services where code = 'T-01')::text, true);
select set_config('t.implant', (select id from public.services where code = 'I-01')::text, true);
select set_config('t.crown', (select id from public.services where code = 'O-02')::text, true);
select set_config('t.doc2', (select max(id) from public.doctors)::text, true);
select set_config('t.surgery', (select id from public.treatment_directions where name = 'Хирургия')::text, true);
select set_config('t.premium', (select id from public.treatment_plan_types where name = 'Премиум')::text, true);
select tests.logout();

--
-- A plan: the header and its first stage
--

select tests.login_as(current_setting('t.m1')::uuid);
insert into public.treatment_plans (deal_id, name, plan_type_id, complaints, insurance_policy)
values (current_setting('t.d1')::bigint, 'План лечения, 28.09.2026', current_setting('t.premium')::bigint,
  'Болит зуб справа', 'ДМС №123');
select set_config('t.p1', (select id from public.treatment_plans where deal_id = current_setting('t.d1')::bigint)::text, true);
select tests.assert(
  (select plan_type_id = current_setting('t.premium')::bigint and complaints = 'Болит зуб справа' and insurance_policy = 'ДМС №123'
   from public.treatment_plans where id = current_setting('t.p1')::bigint),
  'the header keeps the type, the complaints and the insurance policy');
select tests.assert(
  (select count(*) = 1 from public.treatment_stages where plan_id = current_setting('t.p1')::bigint)
  and (tests.stage(current_setting('t.p1')::bigint, 1)).name = 'Этап 1'
  and (tests.stage(current_setting('t.p1')::bigint, 1)).status = 'new'
  and (tests.stage(current_setting('t.p1')::bigint, 1)).doctor_id = (select min(id) from public.doctors),
  'a new plan starts with «Этап 1» and the doctor of the plan');

-- More stages: the next number, «Этап N» for a blank name
insert into public.treatment_stages (plan_id, name, direction_id, doctor_id, deadline, description)
values (current_setting('t.p1')::bigint, '  ', current_setting('t.surgery')::bigint, current_setting('t.doc2')::bigint,
  '2026-10-15', ' Имплантация 36 ');
insert into public.treatment_stages (plan_id, name) values (current_setting('t.p1')::bigint, 'Ортопедия');
select tests.assert(
  (select string_agg(position || ':' || name, ',' order by position) from public.treatment_stages
   where plan_id = current_setting('t.p1')::bigint) = '1:Этап 1,2:Этап 2,3:Ортопедия',
  'a new stage takes the next number, a blank name becomes «Этап N»');
select tests.assert(
  (select description = 'Имплантация 36' and deadline = '2026-10-15' and direction_id = current_setting('t.surgery')::bigint
     and doctor_id = current_setting('t.doc2')::bigint
   from public.treatment_stages where plan_id = current_setting('t.p1')::bigint and position = 2),
  'a stage keeps its direction, doctor, deadline and description');
select set_config('t.s1', (tests.stage(current_setting('t.p1')::bigint, 1)).id::text, true);
select set_config('t.s2', (tests.stage(current_setting('t.p1')::bigint, 2)).id::text, true);
select set_config('t.s3', (tests.stage(current_setting('t.p1')::bigint, 3)).id::text, true);

-- Items: by the id of their stage (the editor), or by a stage number only
-- (stage 29 clients): the stage with this number, created when missing
insert into public.treatment_plan_items (plan_id, stage_id, service_id, tooth, quantity, unit_price, discount_percent, position) values
  (current_setting('t.p1')::bigint, current_setting('t.s1')::bigint, current_setting('t.caries')::bigint, '16', 2, 25000, 10, 0),
  (current_setting('t.p1')::bigint, current_setting('t.s1')::bigint, current_setting('t.caries')::bigint, '17', 2, 25000, 10, 1),
  (current_setting('t.p1')::bigint, current_setting('t.s2')::bigint, current_setting('t.implant')::bigint, '36', 1, 100000, 0, 0),
  (current_setting('t.p1')::bigint, current_setting('t.s3')::bigint, current_setting('t.crown')::bigint, '36', 1, 60000, 0, 0);
select tests.assert(
  (select bool_and(i.stage_no = s.position) from public.treatment_plan_items i join public.treatment_stages s on s.id = i.stage_id
   where i.plan_id = current_setting('t.p1')::bigint),
  'the stage number of an item follows its stage');
insert into public.treatment_plan_items (plan_id, stage_no, name, quantity, unit_price) values
  (current_setting('t.p1')::bigint, 4, 'Гигиена', 1, 999);
select tests.assert(
  (select s.position = 4 and s.name = 'Этап 4' from public.treatment_plan_items i join public.treatment_stages s on s.id = i.stage_id
   where i.plan_id = current_setting('t.p1')::bigint and i.name = 'Гигиена'),
  'an item written with a stage number only goes to that stage, created when missing');
select set_config('t.s4', (tests.stage(current_setting('t.p1')::bigint, 4)).id::text, true);
select tests.logout();

--
-- Totals: stage discounts, cancelled stages, the extra discount
--

select tests.login_as(current_setting('t.owner')::uuid);
update public.treatment_stages set discount_percent = 5 where id = current_setting('t.s1')::bigint;
update public.treatment_stages set status = 'cancelled' where id = current_setting('t.s4')::bigint;
-- Stage 1: 2 × 25 000 − 10 % twice = 90 000, − 5 % = 85 500
-- Stage 2: 100 000; stage 3: 60 000; stage 4 is cancelled (999 aside)
select tests.assert(
  (select string_agg(stage_no || ':' || subtotal_amount || ':' || total_amount || ':' || status, ',' order by stage_no)
   from public.treatment_plan_stages where plan_id = current_setting('t.p1')::bigint)
    = '1:90000:85500:new,2:100000:100000:new,3:60000:60000:new,4:999:999:cancelled',
  'stage totals: Σ lines, then the stage discount');
select tests.assert(
  (select gross_amount = 260000 and subtotal_amount = 245500 and stages_discount_amount = 14500
     and total_amount = 245500 and extra_discount_amount = 0 and items_count = 4 and stages_count = 3
   from public.treatment_plans_summary where id = current_setting('t.p1')::bigint),
  'plan totals: «Итого» 260 000, «Скидка в этапах» 14 500, a cancelled stage aside');

update public.treatment_plans set discount_percent = 10 where id = current_setting('t.p1')::bigint;
select tests.assert(
  (tests.summary(current_setting('t.p1')::bigint)).extra_discount_amount = 24550
  and (tests.summary(current_setting('t.p1')::bigint)).total_amount = 220950
  and (tests.summary(current_setting('t.p1')::bigint)).discount_total = 39050,
  'extra discount 10 %: 24 550, «Итого со скидкой» 220 950');
update public.treatment_plans set discount_percent = 0, discount_amount = 5500 where id = current_setting('t.p1')::bigint;
select tests.assert(
  (tests.summary(current_setting('t.p1')::bigint)).extra_discount_amount = 5500
  and (tests.summary(current_setting('t.p1')::bigint)).total_amount = 240000,
  'extra discount in tenge: 5 500 ₸, «Итого со скидкой» 240 000');
select tests.assert(private.treatment_stage_total(1001, 12.5) = 876, 'a stage discount rounds to whole tenge');

-- «Оплачено»: the payments of the deal
insert into public.deal_payments (deal_id, amount) values (current_setting('t.d1')::bigint, 50000);
select tests.assert((tests.summary(current_setting('t.p1')::bigint)).paid_amount = 50000, '«Оплачено» is what the deal was paid');
select tests.logout();

--
-- Agreed plan: deal amount, progress of the stages and the plan
--

select tests.login_as(current_setting('t.m1')::uuid);
update public.treatment_plans set status = 'agreed' where id = current_setting('t.p1')::bigint;
select tests.assert(
  (select plan_amount = 240000 from public.deals where id = current_setting('t.d1')::bigint),
  'the agreed plan sets the deal amount with the stage and extra discounts');
update public.treatment_plan_items set done = true where stage_id = current_setting('t.s1')::bigint and tooth = '16';
select tests.assert(
  (tests.stage(current_setting('t.p1')::bigint, 1)).status = 'in_progress'
  and (select status = 'in_progress' from public.treatment_plans where id = current_setting('t.p1')::bigint),
  'a done item: the stage and the plan are in progress');
update public.treatment_plan_items set done = true where stage_id = current_setting('t.s1')::bigint;
select tests.assert((tests.stage(current_setting('t.p1')::bigint, 1)).status = 'done', 'all items done: the stage is done');
update public.treatment_plan_items set done = true where stage_id in (current_setting('t.s2')::bigint, current_setting('t.s3')::bigint);
select tests.assert(
  (select status = 'completed' from public.treatment_plans where id = current_setting('t.p1')::bigint),
  'every stage done (the cancelled one aside): the plan is completed');
update public.treatment_plan_items set done = false where stage_id = current_setting('t.s3')::bigint;
select tests.assert(
  (tests.stage(current_setting('t.p1')::bigint, 3)).status = 'in_progress'
  and (select status = 'in_progress' from public.treatment_plans where id = current_setting('t.p1')::bigint),
  'an item no longer done: back in progress');

-- A cancelled stage back in the plan changes the deal amount
update public.treatment_stages set status = 'new' where id = current_setting('t.s4')::bigint;
select tests.assert(
  (select plan_amount = 240999 from public.deals where id = current_setting('t.d1')::bigint),
  'a stage back from «Отменён» counts again in the deal amount');
update public.treatment_stages set status = 'cancelled' where id = current_setting('t.s4')::bigint;

-- The discount limit of a stage (10 % for a manager)
select tests.throws(
  format($q$update public.treatment_stages set discount_percent = 15 where id = %s$q$, current_setting('t.s2')),
  '42501', 'a manager cannot give a stage discount above the limit');
update public.treatment_stages set discount_percent = 5 where id = current_setting('t.s2')::bigint;
select tests.assert((tests.stage(current_setting('t.p1')::bigint, 2)).discount_percent = 5, 'a stage discount within the limit');
update public.treatment_stages set discount_percent = 0 where id = current_setting('t.s2')::bigint;
select tests.logout();
select tests.login_as(current_setting('t.head')::uuid);
update public.treatment_stages set discount_percent = 20 where id = current_setting('t.s3')::bigint;
select tests.assert((tests.stage(current_setting('t.p1')::bigint, 3)).discount_percent = 20, 'the head goes beyond the limit');
update public.treatment_stages set discount_percent = 0 where id = current_setting('t.s3')::bigint;
select tests.logout();

--
-- Stage templates
--

select tests.login_as(current_setting('t.m1')::uuid);
select set_config('t.tpl', public.save_stage_template(current_setting('t.s1')::bigint, 'Кариес, две поверхности')::text, true);
select tests.assert(
  (select name = 'Кариес, две поверхности' and direction_id is null
     and jsonb_array_length(items) = 1
     and items -> 0 ->> 'quantity' = '4' and items -> 0 ->> 'unit_price' = '25000' and items -> 0 ->> 'discount_percent' = '10.00'
     and not (items -> 0 ? 'tooth')
   from public.treatment_stage_templates where id = current_setting('t.tpl')::bigint),
  'a stage template: no teeth, identical lines merged (2 + 2)');
select set_config('t.tpl2', public.save_stage_template(current_setting('t.s2')::bigint)::text, true);
select tests.assert(
  (select name = 'Этап 2' and direction_id = current_setting('t.surgery')::bigint and description = 'Имплантация 36'
   from public.treatment_stage_templates where id = current_setting('t.tpl2')::bigint),
  'a template takes the name, the direction and the description of the stage');
select tests.logout();

-- The price list changed since: the new stage takes the current price
select tests.login_as(current_setting('t.owner')::uuid);
update public.services set price = 30000 where id = current_setting('t.caries')::bigint;
select tests.logout();

select tests.login_as(current_setting('t.m1')::uuid);
insert into public.treatment_plans (deal_id, name) values (current_setting('t.d2')::bigint, 'Второй план');
select set_config('t.p2', (select id from public.treatment_plans where name = 'Второй план')::text, true);
select tests.throws(
  format($q$insert into public.treatment_plan_items (plan_id, stage_id, name) values (%s, %s, 'x')$q$,
    current_setting('t.p2'), current_setting('t.s1')),
  '23503', 'an item goes only to a stage of its own plan');
select set_config('t.s_new', public.add_stage_from_template(current_setting('t.p2')::bigint, current_setting('t.tpl')::bigint)::text, true);
select tests.assert(
  (select position = 2 and name = 'Кариес, две поверхности' from public.treatment_stages where id = current_setting('t.s_new')::bigint)
  and (select count(*) = 1 and min(quantity) = 4 and min(unit_price) = 30000 and min(discount_percent) = 10 and bool_and(tooth is null)
       from public.treatment_plan_items where stage_id = current_setting('t.s_new')::bigint),
  '«Добавить этап из шаблона»: a stage at the end, the items at the current prices, no teeth');
select tests.logout();

--
-- Deleting a stage: the next ones move up
--

select tests.login_as(current_setting('t.m1')::uuid);
delete from public.treatment_stages where id = current_setting('t.s2')::bigint;
select tests.assert(
  (select string_agg(position || ':' || name, ',' order by position) from public.treatment_stages
   where plan_id = current_setting('t.p1')::bigint) = '1:Этап 1,2:Ортопедия,3:Этап 4',
  'a deleted stage: the next stages move up');
select tests.assert(
  (select bool_and(i.stage_no = s.position) from public.treatment_plan_items i join public.treatment_stages s on s.id = i.stage_id
   where i.plan_id = current_setting('t.p1')::bigint)
  and not exists (select 1 from public.treatment_plan_items where stage_id = current_setting('t.s2')::bigint),
  'the items of a deleted stage go with it, the others follow their stage number');
select tests.assert(
  (select plan_amount = 140000 from public.deals where id = current_setting('t.d1')::bigint),
  'the deal amount follows a deleted stage (85 500 + 60 000 − 5 500)');

-- «Дублировать план» copies the header and the stages
select set_config('t.copy', public.duplicate_treatment_plan(current_setting('t.p1')::bigint)::text, true);
select tests.assert(
  (select plan_type_id = current_setting('t.premium')::bigint and complaints = 'Болит зуб справа' and status = 'draft'
   from public.treatment_plans where id = current_setting('t.copy')::bigint)
  and (select string_agg(position || ':' || name || ':' || status || ':' || discount_percent, ',' order by position)
       from public.treatment_stages where plan_id = current_setting('t.copy')::bigint)
      = '1:Этап 1:new:5.00,2:Ортопедия:new:0.00,3:Этап 4:cancelled:0.00'
  and (select count(*) = 4 and bool_and(not done) from public.treatment_plan_items where plan_id = current_setting('t.copy')::bigint)
  and (tests.summary(current_setting('t.copy')::bigint)).total_amount = 140000,
  'a duplicate: the header, the stages (a cancelled one stays cancelled), the items not done, the same totals');
select tests.logout();

--
-- Rights and clinic isolation
--

-- Dictionaries: every employee reads, whoever configures the clinic edits
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(tests.count('select * from public.treatment_directions') = 8, 'a manager reads the directions');
select tests.throws($q$insert into public.treatment_directions (name) values ('Эндодонтия')$q$, '42501',
  'a manager cannot add a direction');
select tests.assert(tests.affected($q$update public.treatment_plan_types set name = 'x'$q$) = 0,
  'a manager cannot rename a plan type');
select tests.logout();
select tests.login_as(current_setting('t.int')::uuid);
insert into public.treatment_directions (name, position) values ('Эндодонтия', 8);
select tests.assert(tests.count('select * from public.treatment_directions') = 9, 'the integrator configures the directions');
select tests.assert(tests.count('select * from public.treatment_stages') = 0
  and tests.count('select * from public.treatment_stage_templates') = 0,
  'the integrator sees no stages and no templates (no money)');
select tests.throws(format($q$select public.save_stage_template(%s)$q$, current_setting('t.s1')), 'P0002',
  'the integrator cannot save a template');
select tests.logout();
select tests.login_as(current_setting('t.head')::uuid);
update public.treatment_plan_types set name = 'Базовый' where name = 'Эконом';
select tests.assert(tests.count($q$select * from public.treatment_plan_types where name = 'Базовый'$q$) = 1, 'the head renames a plan type');
update public.organization_settings set manager_deal_visibility = 'own';
select tests.logout();

-- «Только свои сделки»: the stages follow the plans
select tests.login_as(current_setting('t.m2')::uuid);
select tests.assert(tests.count('select * from public.treatment_stages') = 0
  and tests.count('select * from public.treatment_plan_stages') = 0,
  'own: a manager does not see the stages of a colleague''s plans');
select tests.throws(
  format($q$insert into public.treatment_stages (plan_id, name) values (%s, 'x')$q$, current_setting('t.p1')),
  '42501', 'own: a manager cannot add a stage to a colleague''s plan');
select tests.assert(
  tests.affected(format($q$update public.treatment_stages set name = 'x' where plan_id = %s$q$, current_setting('t.p1'))) = 0,
  'own: a manager cannot edit a colleague''s stages');
select tests.throws(
  format($q$select public.add_stage_from_template(%s, %s)$q$, current_setting('t.p1'), current_setting('t.tpl')),
  'P0002', 'own: a manager cannot add a template stage to a colleague''s plan');
select tests.assert(tests.count('select * from public.treatment_stage_templates') = 2, 'templates are shared by the clinic staff');
select tests.logout();

select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.count('select * from public.treatment_stages') = 0
  and tests.count('select * from public.treatment_stage_templates') = 0
  and (select count(*) = 4 from public.treatment_plan_types),
  'another clinic sees only its own dictionaries, no stages or templates');
select tests.assert(
  tests.affected(format($q$delete from public.treatment_stages where plan_id = %s$q$, current_setting('t.p1'))) = 0,
  'another clinic cannot delete the stages');
select tests.throws(
  format($q$select public.add_stage_from_template(%s, %s)$q$, current_setting('t.p1'), current_setting('t.tpl')),
  'P0002', 'another clinic cannot add a stage to a plan');
select tests.throws(
  format($q$select public.save_stage_template(%s)$q$, current_setting('t.s1')),
  'P0002', 'another clinic cannot save a template of a stage');
select tests.logout();
select tests.assert(
  (select count(*) = 9 from public.treatment_directions where organization_id = current_setting('t.org')::bigint)
  and (select count(*) = 8 from public.treatment_directions where organization_id = tests.org_of(current_setting('t.other')::uuid)),
  'the directions of a clinic are its own');

--
-- The audit log
--

select tests.assert(
  exists (select 1 from public.audit_log where entity = 'treatment_stage' and action = 'update'
    and changes -> 'discount_percent' ->> 1 = '5.00'),
  'stage changes are in the audit log');
select tests.assert(
  exists (select 1 from public.audit_log where entity = 'treatment_stage_template' and action = 'create'),
  'stage templates are in the audit log');
select tests.assert(
  exists (select 1 from public.audit_log where entity = 'treatment_plan' and action = 'create'
    and changes -> 'plan_type_id' ->> 1 = current_setting('t.premium')),
  'the plan type is in the audit log');

--
-- The move of the stage-29 data (the migration): items with a stage number
-- only get a stage per number, a plan without items gets «Этап 1»
--

alter table public.treatment_plan_items drop constraint treatment_plan_items_stage_id_fkey;
alter table public.treatment_plan_items alter column stage_id drop not null;
alter table public.treatment_plan_items disable trigger user;
alter table public.treatment_stages disable trigger user;
insert into public.treatment_plans (organization_id, deal_id, name, status, doctor_id)
values (current_setting('t.org')::bigint, current_setting('t.d2')::bigint, 'План этапа 29', 'draft', current_setting('t.doc2')::bigint),
       (current_setting('t.org')::bigint, current_setting('t.d2')::bigint, 'Пустой план этапа 29', 'draft', null);
select set_config('t.legacy', (select id from public.treatment_plans where name = 'План этапа 29')::text, true);
select set_config('t.empty', (select id from public.treatment_plans where name = 'Пустой план этапа 29')::text, true);
delete from public.treatment_stages where plan_id in (current_setting('t.legacy')::bigint, current_setting('t.empty')::bigint);
insert into public.treatment_plan_items (organization_id, plan_id, stage_id, stage_no, name, quantity, unit_price, position) values
  (current_setting('t.org')::bigint, current_setting('t.legacy')::bigint, null, 1, 'Снимок', 1, 5000, 0),
  (current_setting('t.org')::bigint, current_setting('t.legacy')::bigint, null, 3, 'Коронка', 2, 60000, 0),
  (current_setting('t.org')::bigint, current_setting('t.legacy')::bigint, null, 3, 'Вкладка', 1, 25000, 1),
  (current_setting('t.org')::bigint, current_setting('t.p2')::bigint, null, 1, 'Консультация', 1, 5000, 5);
alter table public.treatment_plan_items enable trigger user;
alter table public.treatment_stages enable trigger user;

select tests.assert(private.move_treatment_items_to_stages() = 4, 'the migration moves every item without a stage');
select tests.assert(
  (select string_agg(position || ':' || name || ':' || coalesce(doctor_id::text, '-'), ',' order by position)
   from public.treatment_stages where plan_id = current_setting('t.legacy')::bigint)
    = '1:Этап 1:' || current_setting('t.doc2') || ',3:Этап 3:' || current_setting('t.doc2'),
  'a stage per stage number, with the doctor of the plan');
select tests.assert(
  (select string_agg(i.name || ':' || s.position, ',' order by i.name)
   from public.treatment_plan_items i join public.treatment_stages s on s.id = i.stage_id
   where i.plan_id = current_setting('t.legacy')::bigint) = 'Вкладка:3,Коронка:3,Снимок:1',
  'the items are linked to the stage of their number');
select tests.assert(
  (select s.position = 1 and s.id = (tests.stage(current_setting('t.p2')::bigint, 1)).id
   from public.treatment_plan_items i join public.treatment_stages s on s.id = i.stage_id
   where i.name = 'Консультация'),
  'an item goes to the existing stage of its number');
select tests.assert(
  (select count(*) = 1 and min(name) = 'Этап 1' from public.treatment_stages where plan_id = current_setting('t.empty')::bigint),
  'a plan without items gets «Этап 1»');
select tests.assert(
  (tests.summary(current_setting('t.legacy')::bigint)).total_amount = 150000,
  'the totals of a moved plan stay the same');
select tests.assert(private.move_treatment_items_to_stages() = 0, 'the move runs once: nothing left the second time');

rollback;

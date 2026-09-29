--
-- Payroll (stage 39): every scheme type (percent of the price, of the paid
-- part, minus materials, category rates overriding the default, a subsection
-- over its section, the history of schemes, a rate per visit, the salary and
-- the minimum guaranteed, a percent of the payments for an employee), the
-- doctor of the item / stage / plan, bonuses, penalties and payouts, the
-- calendar (days off, overdue stages), closing a month (frozen lines, no
-- bonus, payouts still), rights per role, the audit log, clinic isolation.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.int', tests.invite('int@clinic.kz', current_setting('t.org')::bigint, 'integrator')::text, true);
select set_config('t.m1_id', (select id from public.sales where email = 'm1@clinic.kz')::text, true);
select set_config('t.other', tests.sign_up('owner@second.kz', 'Другая')::text, true);

update public.task_rules set is_active = false;

-- The month of the test: August 2026 (Asia/Almaty, +05)
create function tests.pm() returns jsonb language sql as $$
  select public.payroll_month('2026-08-01')
$$;
-- One employee of a payroll month, by name
create function tests.emp(month jsonb, person text) returns jsonb language sql as $$
  select e from jsonb_array_elements(month -> 'employees') e where e ->> 'name' = person
$$;
create function tests.line(month jsonb, person text, line_source text, line_service text) returns jsonb language sql as $$
  select l from jsonb_array_elements(tests.emp(month, person) -> 'lines') l
  where l ->> 'source' = line_source and l ->> 'service_name' is not distinct from line_service
  limit 1
$$;
create function tests.day(month jsonb, person text, target date) returns jsonb language sql as $$
  select d from jsonb_array_elements(tests.emp(month, person) -> 'days') d where (d ->> 'day')::date = target
$$;
create function tests.id_of(tbl text, col text, val text) returns bigint language plpgsql as $$
declare result bigint;
begin
  execute format('select id from public.%I where %I = %L', tbl, col, val) into result;
  return result;
end;
$$;
grant execute on all functions in schema tests to authenticated;

--
-- The clinic: the price list with cost prices, doctors, patients, deals
--
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.service_categories (name, position) values ('Терапия', 0), ('Ортопедия', 1);
insert into public.service_categories (parent_id, name) values (tests.id_of('service_categories', 'name', 'Терапия'), 'Лечение кариеса');
insert into public.services (name, code, price, category_id) values
  ('Пломба', 'T-1', 30000, tests.id_of('service_categories', 'name', 'Лечение кариеса')),
  ('Коронка', 'O-1', 100000, tests.id_of('service_categories', 'name', 'Ортопедия')),
  ('Консультация', 'D-1', 10000, null);
select public.set_service_cost(tests.id_of('services', 'name', 'Пломба'), 5000);
select public.set_service_cost(tests.id_of('services', 'name', 'Коронка'), 20000);
insert into public.doctors (name, specialty, position) values
  ('Терапевт', 'терапевт', 0), ('Ортопед', 'ортопед', 1), ('Гигиенист', 'гигиенист', 2);
select set_config('t.a', tests.id_of('doctors', 'name', 'Терапевт')::text, true);
select set_config('t.b', tests.id_of('doctors', 'name', 'Ортопед')::text, true);
select set_config('t.c', tests.id_of('doctors', 'name', 'Гигиенист')::text, true);
insert into public.patients (first_name, last_name) values ('Асель', 'Нурланова'), ('Ерлан', 'Омаров'), ('Дана', 'Ким');
select set_config('t.p1', tests.id_of('patients', 'first_name', 'Асель')::text, true);
select set_config('t.p2', tests.id_of('patients', 'first_name', 'Ерлан')::text, true);
select set_config('t.p3', tests.id_of('patients', 'first_name', 'Дана')::text, true);
insert into public.deals (patient_id, name, sales_id) values
  (current_setting('t.p1')::bigint, 'd1', current_setting('t.m1_id')::bigint),
  (current_setting('t.p2')::bigint, 'd2', current_setting('t.m1_id')::bigint);

-- Plan 1 (doctor: Терапевт), 10 % off: Пломба ×2 (60 000) + Пломба (30 000)
-- in stage 1; an empty stage 2 with a deadline in August (overdue)
insert into public.treatment_plans (deal_id, name, doctor_id, discount_percent)
values (tests.id_of('deals', 'name', 'd1'), 'plan1', current_setting('t.a')::bigint, 10);
select set_config('t.plan1', tests.id_of('treatment_plans', 'name', 'plan1')::text, true);
insert into public.treatment_plan_items (plan_id, stage_no, service_id, name, tooth, quantity, unit_price, position) values
  (current_setting('t.plan1')::bigint, 1, tests.id_of('services', 'name', 'Пломба'), 'Пломба 2', '36, 37', 2, 30000, 0),
  (current_setting('t.plan1')::bigint, 1, tests.id_of('services', 'name', 'Пломба'), 'Пломба 1', '46', 1, 30000, 1);
insert into public.treatment_stages (plan_id, position, name, deadline)
values (current_setting('t.plan1')::bigint, 2, 'Этап 2', '2026-08-14');
-- Plan 2 (doctor of the plan: Терапевт, of the stage: Ортопед): Коронка
insert into public.treatment_plans (deal_id, name, doctor_id)
values (tests.id_of('deals', 'name', 'd2'), 'plan2', current_setting('t.a')::bigint);
select set_config('t.plan2', tests.id_of('treatment_plans', 'name', 'plan2')::text, true);
update public.treatment_stages set doctor_id = current_setting('t.b')::bigint where plan_id = current_setting('t.plan2')::bigint;
insert into public.treatment_plan_items (plan_id, stage_no, service_id, name, quantity, unit_price)
values (current_setting('t.plan2')::bigint, 1, tests.id_of('services', 'name', 'Коронка'), 'Коронка 2', 1, 100000);
-- Plan 3 (doctor: Терапевт), the item's own doctor: Ортопед
insert into public.treatment_plans (deal_id, name, doctor_id)
values (tests.id_of('deals', 'name', 'd1'), 'plan3', current_setting('t.a')::bigint);
select set_config('t.plan3', tests.id_of('treatment_plans', 'name', 'plan3')::text, true);
insert into public.treatment_plan_items (plan_id, stage_no, service_id, name, quantity, unit_price, doctor_id)
values (current_setting('t.plan3')::bigint, 1, tests.id_of('services', 'name', 'Коронка'), 'Коронка 3', 1, 100000, current_setting('t.b')::bigint);

-- Done in August (the dates set afterwards: done_at follows «done»)
update public.treatment_plan_items set done = true;
update public.treatment_plan_items set done_at = case name
  when 'Пломба 2' then '2026-08-10 11:00+05'::timestamptz
  when 'Пломба 1' then '2026-08-20 11:00+05'::timestamptz
  when 'Коронка 2' then '2026-08-12 11:00+05'::timestamptz
  when 'Коронка 3' then '2026-08-25 11:00+05'::timestamptz end;
-- Not in August: done on 1 September, 00:30 in Almaty (31 August in UTC)
insert into public.treatment_plan_items (plan_id, stage_no, service_id, name, quantity, unit_price, done)
values (current_setting('t.plan1')::bigint, 1, tests.id_of('services', 'name', 'Пломба'), 'Пломба сентябрь', 1, 30000, true);
update public.treatment_plan_items set done_at = '2026-09-01 00:30+05' where name = 'Пломба сентябрь';

-- Payments: plan 2 — 60 000 on 12 August, a refund of 10 000 on 20 August
insert into public.account_operations (patient_id, kind, amount, method, deal_id, plan_id, occurred_at, comment)
values (current_setting('t.p2')::bigint, 'payment', 60000, 'card', tests.id_of('deals', 'name', 'd2'),
  current_setting('t.plan2')::bigint, '2026-08-12 12:00+05', 'pay plan2');
insert into public.account_operations (patient_id, kind, account, amount, method, deal_id, plan_id, occurred_at, comment)
values (current_setting('t.p2')::bigint, 'refund', 'services', 10000, 'cash', tests.id_of('deals', 'name', 'd2'),
  current_setting('t.plan2')::bigint, '2026-08-20 12:00+05', 'refund plan2');

-- Visits: a priced consultation without a deal (Терапевт); three completed
-- visits and a cancelled one of the hygienist
insert into public.visits (patient_id, doctor_id, service_id, starts_at, ends_at, status) values
  (current_setting('t.p3')::bigint, current_setting('t.a')::bigint, tests.id_of('services', 'name', 'Консультация'),
    '2026-08-11 10:00+05', '2026-08-11 10:30+05', 'completed'),
  (current_setting('t.p3')::bigint, current_setting('t.c')::bigint, null, '2026-08-03 10:00+05', '2026-08-03 11:00+05', 'completed'),
  (current_setting('t.p1')::bigint, current_setting('t.c')::bigint, null, '2026-08-04 10:00+05', '2026-08-04 11:00+05', 'completed'),
  (current_setting('t.p2')::bigint, current_setting('t.c')::bigint, null, '2026-08-05 10:00+05', '2026-08-05 11:00+05', 'completed'),
  (current_setting('t.p2')::bigint, current_setting('t.c')::bigint, null, '2026-08-06 10:00+05', '2026-08-06 11:00+05', 'cancelled');

-- The schedule of the therapist: Monday to Friday; 5 August off, Saturday
-- 8 August at work
update public.doctors set working_hours =
  '{"1": {"start": "09:00", "end": "18:00"}, "2": {"start": "09:00", "end": "18:00"}, "3": {"start": "09:00", "end": "18:00"}, "4": {"start": "09:00", "end": "18:00"}, "5": {"start": "09:00", "end": "18:00"}}'
where id = current_setting('t.a')::bigint;
insert into public.doctor_exceptions (doctor_id, day, start_time, end_time) values
  (current_setting('t.a')::bigint, '2026-08-05', null, null),
  (current_setting('t.a')::bigint, '2026-08-08', '10:00', '14:00');

--
-- No scheme yet: the work is there, nothing accrued
--
select tests.assert(
  (select (e ->> 'works_count')::int = 3 and (e ->> 'accrued')::bigint = 0 and e -> 'scheme' = 'null'::jsonb
   from tests.emp(tests.pm(), 'Терапевт') e),
  'no scheme: the works are counted, nothing is accrued');

--
-- The schemes
--
-- Терапевт: 20 %, «Терапия» 30 % (from 1 January); from 15 August its
-- subsection «Лечение кариеса» 35 %
insert into public.payroll_schemes (doctor_id, effective_from, percent, category_rates) values
  (current_setting('t.a')::bigint, '2026-01-01', 20,
    jsonb_build_array(jsonb_build_object('category_id', tests.id_of('service_categories', 'name', 'Терапия'), 'percent', 30))),
  (current_setting('t.a')::bigint, '2026-08-15', 20,
    jsonb_build_array(
      jsonb_build_object('category_id', tests.id_of('service_categories', 'name', 'Терапия'), 'percent', 30),
      jsonb_build_object('category_id', tests.id_of('service_categories', 'name', 'Лечение кариеса'), 'percent', 35)));
-- Ортопед: 25 % of the paid part, minus materials
insert into public.payroll_schemes (doctor_id, effective_from, percent, percent_base, deduct_materials)
values (current_setting('t.b')::bigint, '2026-01-01', 25, 'paid', true);
-- Гигиенист: salary 150 000, 2 000 per visit, 200 000 guaranteed
insert into public.payroll_schemes (doctor_id, effective_from, fixed_salary, visit_rate, min_guaranteed)
values (current_setting('t.c')::bigint, '2026-01-01', 150000, 2000, 200000);
-- The administrator: salary 100 000 and 5 % of the payments of her deals
insert into public.payroll_schemes (sales_id, effective_from, fixed_salary, percent)
values (current_setting('t.m1_id')::bigint, '2026-07-01', 100000, 5);

-- The category rates are checked
select tests.throws(format($q$insert into public.payroll_schemes (doctor_id, effective_from, category_rates) values (%s, '2026-02-01', '[{"category_id": 999999, "percent": 30}]')$q$,
  current_setting('t.a')), '22023', 'a category of the clinic');
select tests.throws(format($q$insert into public.payroll_schemes (doctor_id, effective_from, category_rates) values (%s, '2026-02-01', '[{"category_id": %s, "percent": 130}]')$q$,
  current_setting('t.a'), tests.id_of('service_categories', 'name', 'Терапия')), '22023', 'a rate of 0..100 %');
select tests.throws(format($q$insert into public.payroll_schemes (doctor_id, effective_from, category_rates) values (%s, '2026-02-01', '[{"category_id": %s, "percent": 30}, {"category_id": %s, "percent": 20}]')$q$,
  current_setting('t.a'), tests.id_of('service_categories', 'name', 'Терапия'), tests.id_of('service_categories', 'name', 'Терапия')),
  '22023', 'one rate per category');
select tests.throws(format($q$insert into public.payroll_schemes (doctor_id, effective_from, percent) values (%s, '2026-01-01', 10)$q$,
  current_setting('t.a')), '23505', 'one scheme per doctor and effective date');
select tests.throws(format($q$insert into public.payroll_schemes (doctor_id, sales_id) values (%s, %s)$q$,
  current_setting('t.a'), current_setting('t.m1_id')), '23514', 'a doctor or an employee, not both');
select tests.throws(format($q$insert into public.payroll_schemes (doctor_id, percent_base) values (%s, 'profit')$q$,
  current_setting('t.a')), '23514', 'the base is the price or the paid part');

select set_config('t.pm', tests.pm()::text, true);

-- Терапевт. Plan 1: subtotal 90 000, total 81 000 (−10 %): the items carry
-- 54 000 and 27 000
select tests.assert(
  (select (l ->> 'amount')::bigint = 54000 and (l ->> 'base')::bigint = 54000 and (l ->> 'percent')::numeric = 30
     and (l ->> 'accrued')::bigint = 16200 and (l ->> 'materials')::bigint = 0 and l ->> 'work_day' = '2026-08-10'
     and l ->> 'category_name' = 'Терапия' and l ->> 'patient_name' = 'Нурланова Асель'
   from tests.line(current_setting('t.pm')::jsonb, 'Терапевт', 'plan_item', 'Пломба 2') l),
  'the section rate (30 %) before 15 August, the plan discount pro rata');
select tests.assert(
  (select (l ->> 'amount')::bigint = 27000 and (l ->> 'percent')::numeric = 35 and (l ->> 'accrued')::bigint = 9450
   from tests.line(current_setting('t.pm')::jsonb, 'Терапевт', 'plan_item', 'Пломба 1') l),
  'the new scheme from 15 August: the subsection rate (35 %) wins over its section');
select tests.assert(
  (select (l ->> 'amount')::bigint = 10000 and (l ->> 'percent')::numeric = 20 and (l ->> 'accrued')::bigint = 2000
     and l ->> 'patient_name' = 'Ким Дана'
   from tests.line(current_setting('t.pm')::jsonb, 'Терапевт', 'visit', 'Консультация') l),
  'a completed priced visit without a plan: the default percent');
select tests.assert(tests.line(current_setting('t.pm')::jsonb, 'Терапевт', 'plan_item', 'Пломба сентябрь') is null,
  'done on 1 September in the clinic''s time zone: not August');
select tests.assert(tests.line(current_setting('t.pm')::jsonb, 'Терапевт', 'plan_item', 'Коронка 2') is null,
  'the stage''s doctor wins over the plan''s');
select tests.assert(
  (select (e ->> 'works_count')::int = 3 and (e ->> 'work_amount')::bigint = 91000 and (e ->> 'work_accrued')::bigint = 27650
     and (e ->> 'accrued')::bigint = 27650 and (e ->> 'balance')::bigint = 27650 and e -> 'scheme' ->> 'effective_from' = '2026-08-15'
   from tests.emp(current_setting('t.pm')::jsonb, 'Терапевт') e),
  'Терапевт: 3 works, 27 650 accrued; the scheme of the month end');

-- Ортопед: Коронка 2 of plan 2 (stage doctor): paid 50 000 of 100 000 →
-- (100 000 − 20 000 materials) × 50 % = 40 000 × 25 % = 10 000
select tests.assert(
  (select (l ->> 'amount')::bigint = 100000 and (l ->> 'materials')::bigint = 20000 and (l ->> 'base')::bigint = 40000
     and (l ->> 'percent')::numeric = 25 and (l ->> 'accrued')::bigint = 10000
   from tests.line(current_setting('t.pm')::jsonb, 'Ортопед', 'plan_item', 'Коронка 2') l),
  'percent of the paid part minus materials');
-- Коронка 3: the item's own doctor; nothing paid yet → 0
select tests.assert(
  (select (l ->> 'base')::bigint = 0 and (l ->> 'accrued')::bigint = 0
   from tests.line(current_setting('t.pm')::jsonb, 'Ортопед', 'plan_item', 'Коронка 3') l),
  'the item''s doctor wins; an unpaid work gives nothing in the paid mode');
select tests.assert(
  (select (e ->> 'works_count')::int = 2 and (e ->> 'materials')::bigint = 40000 and (e ->> 'accrued')::bigint = 10000
   from tests.emp(current_setting('t.pm')::jsonb, 'Ортопед') e),
  'Ортопед: 2 works, 10 000 accrued');

-- Гигиенист: 150 000 + 3 visits × 2 000 = 156 000, topped up to 200 000
select tests.assert(
  (select (e ->> 'visits_count')::int = 3 and (e ->> 'visits_accrued')::bigint = 6000 and (e ->> 'fixed')::bigint = 150000
     and (e ->> 'minimum')::bigint = 44000 and (e ->> 'accrued')::bigint = 200000 and (e ->> 'works_count')::int = 0
   from tests.emp(current_setting('t.pm')::jsonb, 'Гигиенист') e),
  'salary, a rate per completed visit (not the cancelled one), the minimum guaranteed');

-- The administrator: 100 000 + 5 % of 60 000 − 5 % of the refund 10 000
select tests.assert(
  (select e ->> 'kind' = 'sales' and (e ->> 'work_amount')::bigint = 50000 and (e ->> 'work_accrued')::bigint = 2500
     and (e ->> 'fixed')::bigint = 100000 and (e ->> 'accrued')::bigint = 102500
     and (select count(*) from jsonb_array_elements(e -> 'lines') l where l ->> 'source' = 'payment') = 2
   from tests.emp(current_setting('t.pm')::jsonb, 'm1 Test') e),
  'an employee: salary and a percent of the payments of her deals, a refund negative');
select tests.assert(tests.emp(current_setting('t.pm')::jsonb, 'head Test') is null, 'an employee without a scheme is not listed');

-- The calendar of the therapist: 10 weekend days − Saturday 8 at work + the
-- 5th off = 10 days off; the empty stage 2 overdue on the 14th
select tests.assert(
  (select (e ->> 'days_off')::int = 10 and (e ->> 'overdue_count')::int = 1 and jsonb_array_length(e -> 'days') = 31
   from tests.emp(current_setting('t.pm')::jsonb, 'Терапевт') e),
  'days off from the hours and the exceptions; overdue plan stages');
select tests.assert(
  (select (d ->> 'works')::int = 1 and (d ->> 'amount')::bigint = 16200 and not (d ->> 'off')::boolean
   from tests.day(current_setting('t.pm')::jsonb, 'Терапевт', '2026-08-10') d)
  and (select (d ->> 'off')::boolean from tests.day(current_setting('t.pm')::jsonb, 'Терапевт', '2026-08-05') d)
  and (select not (d ->> 'off')::boolean from tests.day(current_setting('t.pm')::jsonb, 'Терапевт', '2026-08-08') d)
  and (select (d ->> 'overdue')::int = 1 from tests.day(current_setting('t.pm')::jsonb, 'Терапевт', '2026-08-14') d),
  'the calendar: works and accrual per day, off days, the overdue deadline');
select tests.assert(
  (select (e ->> 'days_off')::int = 0 from tests.emp(current_setting('t.pm')::jsonb, 'Ортопед') e),
  'no weekly hours: the clinic hours every day');

--
-- Bonuses, penalties, payouts
--
insert into public.payroll_adjustments (doctor_id, month, kind, amount, note) values
  (current_setting('t.a')::bigint, '2026-08-17', 'bonus', 5000, 'Премия за отзывы'),
  (current_setting('t.a')::bigint, '2026-08-01', 'penalty', 1000, 'Опоздание'),
  (current_setting('t.a')::bigint, '2026-08-01', 'payout', 20000, 'Аванс');
select tests.assert((select count(*) = 3 from public.payroll_adjustments where month = '2026-08-01'), 'the month is its first day');
select tests.assert(
  (select (e ->> 'bonuses')::bigint = 5000 and (e ->> 'penalties')::bigint = 1000 and (e ->> 'paid_out')::bigint = 20000
     and (e ->> 'accrued')::bigint = 31650 and (e ->> 'balance')::bigint = 11650 and jsonb_array_length(e -> 'adjustments') = 3
   from tests.emp(tests.pm(), 'Терапевт') e),
  'accrued = lines + bonuses − penalties; balance = accrued − payouts');
select tests.throws(format($q$insert into public.payroll_adjustments (doctor_id, month, kind, amount) values (%s, '2026-08-01', 'bonus', 0)$q$,
  current_setting('t.a')), '23514', 'a positive amount');
select tests.logout();

--
-- Rights: the owner and the head; not a manager, not the integrator
--
select tests.login_as(current_setting('t.head')::uuid);
select tests.assert((select count(*) = 5 from public.payroll_schemes), 'the head reads the schemes');
select tests.assert(jsonb_array_length(tests.pm() -> 'employees') = 4, 'the head sees the payroll');
insert into public.payroll_adjustments (doctor_id, month, kind, amount) values (current_setting('t.b')::bigint, '2026-08-01', 'bonus', 3000);
select tests.logout();

select tests.login_as(current_setting('t.m1')::uuid);
select tests.throws('select public.payroll_month(''2026-08-01'')', '42501', 'a manager sees no payroll');
select tests.assert((select count(*) = 0 from public.payroll_schemes), 'a manager reads no scheme');
select tests.assert((select count(*) = 0 from public.payroll_adjustments), 'a manager reads no adjustment');
select tests.throws(format($q$insert into public.payroll_adjustments (sales_id, month, kind, amount) values (%s, '2026-08-01', 'bonus', 99000)$q$,
  current_setting('t.m1_id')), '42501', 'a manager gives herself no bonus');
select tests.throws(format($q$insert into public.payroll_schemes (sales_id, effective_from, percent) values (%s, '2026-09-01', 50)$q$,
  current_setting('t.m1_id')), '42501', 'a manager writes no scheme');
select tests.assert(tests.affected(format('update public.payroll_schemes set percent = 90 where sales_id = %s', current_setting('t.m1_id'))) = 0,
  'a manager changes no scheme');
select tests.throws('select public.close_payroll_month(''2026-08-01'')', '42501', 'a manager closes no month');
select tests.logout();

select tests.login_as(current_setting('t.int')::uuid);
select tests.throws('select public.payroll_month(''2026-08-01'')', '42501', 'the integrator sees no payroll');
select tests.assert((select count(*) = 0 from public.payroll_schemes), 'the integrator reads no scheme');
select tests.logout();

select tests.login_anon();
select tests.throws('select public.payroll_month(''2026-08-01'')', '42501', 'anonymous: no payroll');
select tests.logout();

--
-- Isolation: another clinic
--
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(jsonb_array_length(tests.pm() -> 'employees') = 0, 'another clinic sees none of these employees');
select tests.assert((select count(*) = 0 from public.payroll_schemes) and (select count(*) = 0 from public.payroll_adjustments),
  'another clinic reads no scheme, no adjustment');
select tests.throws(format($q$insert into public.payroll_schemes (doctor_id, percent) values (%s, 50)$q$, current_setting('t.a')),
  '23503', 'no scheme for a doctor of another clinic');
select tests.throws(format($q$insert into public.payroll_adjustments (doctor_id, month, kind, amount) values (%s, '2026-08-01', 'payout', 1000)$q$,
  current_setting('t.a')), '23503', 'no payout to a doctor of another clinic');
select tests.logout();

--
-- Closing the month
--
select tests.login_as(current_setting('t.head')::uuid);
select tests.throws('select public.close_payroll_month(''2099-01-01'')', '22023', 'a month that has not started');
select tests.assert((public.close_payroll_month('2026-08-01') ->> 'accrued')::bigint = 27650 + 10000 + 200000 + 102500,
  'closing freezes the lines of every employee');
select tests.throws('select public.close_payroll_month(''2026-08-15'')', '23505', 'a month is closed once');
select tests.assert((tests.pm() ->> 'closed')::boolean, 'the month shows closed');
select tests.logout();

-- A payment for plan 3 after the closing: the frozen month does not move
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.account_operations (patient_id, kind, amount, method, deal_id, plan_id, occurred_at)
values (current_setting('t.p1')::bigint, 'payment', 100000, 'cash', tests.id_of('deals', 'name', 'd1'),
  current_setting('t.plan3')::bigint, '2026-08-26 12:00+05');
update public.payroll_schemes set percent = 50 where doctor_id = current_setting('t.a')::bigint;
select tests.assert(
  (select (tests.line(tests.pm(), 'Ортопед', 'plan_item', 'Коронка 3') ->> 'accrued')::bigint = 0)
  and (select (tests.line(tests.pm(), 'Терапевт', 'visit', 'Консультация') ->> 'accrued')::bigint = 2000),
  'a closed month keeps its lines: new payments, new percentages do not change it');
select tests.throws(format($q$insert into public.payroll_adjustments (doctor_id, month, kind, amount) values (%s, '2026-08-01', 'bonus', 1000)$q$,
  current_setting('t.a')), '22023', 'no bonus in a closed month');
select tests.throws(format($q$update public.payroll_adjustments set amount = 1 where kind = 'penalty' and doctor_id = %s$q$,
  current_setting('t.a')), '22023', 'a penalty of a closed month does not change');
select tests.throws(format($q$delete from public.payroll_adjustments where kind = 'bonus' and doctor_id = %s$q$,
  current_setting('t.a')), '22023', 'a bonus of a closed month is not deleted');
insert into public.payroll_adjustments (doctor_id, month, kind, amount, note)
values (current_setting('t.a')::bigint, '2026-08-01', 'payout', 11650, 'Зарплата за август');
select tests.assert(
  (select (e ->> 'paid_out')::bigint = 31650 and (e ->> 'balance')::bigint = 0 from tests.emp(tests.pm(), 'Терапевт') e),
  'payouts of a closed month: the balance goes to zero');
select tests.logout();

-- Reopening: the owner only; the lines are computed again
select tests.login_as(current_setting('t.head')::uuid);
select tests.throws('select public.reopen_payroll_month(''2026-08-01'')', '42501', 'the head does not reopen a month');
select tests.logout();
select tests.login_as(current_setting('t.owner')::uuid);
select public.reopen_payroll_month('2026-08-01');
select tests.assert(
  (select (tests.line(tests.pm(), 'Ортопед', 'plan_item', 'Коронка 3') ->> 'accrued')::bigint = 20000),
  'reopened: the paid crown now gives (100 000 − 20 000) × 25 %');
select tests.assert(
  (select (tests.line(tests.pm(), 'Ортопед', 'plan_item', 'Коронка 2') ->> 'accrued')::bigint = 10000),
  'the other plan keeps its paid share');
select tests.throws('select public.reopen_payroll_month(''2026-08-01'')', 'P0002', 'an open month is not reopened');

--
-- The audit log
--
select tests.assert(
  (select count(*) = 5 from public.audit_log where entity = 'payroll_scheme' and action = 'create')
  and (select count(*) >= 1 from public.audit_log where entity = 'payroll_scheme' and action = 'update' and changes ? 'percent')
  and (select count(*) = 5 from public.audit_log where entity = 'payroll_adjustment' and action = 'create')
  and (select count(*) = 1 from public.audit_log where entity = 'payroll_month' and action = 'create')
  and (select count(*) = 1 from public.audit_log where entity = 'payroll_month' and action = 'delete'),
  'schemes, adjustments, closing and reopening are in the audit log');

-- A clinic with a closed month can still be deleted: the cascade takes
-- its bonuses and penalties
select public.close_payroll_month('2026-08-01');
select tests.logout();
delete from public.organizations where id = current_setting('t.org')::bigint;
select tests.assert(
  (select count(*) = 0 from public.payroll_adjustments where organization_id = current_setting('t.org')::bigint),
  'deleting the clinic takes the adjustments of a closed month');

rollback;

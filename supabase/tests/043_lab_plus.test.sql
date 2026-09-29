--
-- The lab module strengthened (stage 43): prices per lab with their
-- history (a line takes the price of the order's lab on the day of the
-- order, another lab reprices it), standard terms in the lab's working
-- days, remakes (reason, fault → paid or free, the cost in
-- lab_order_costs, the owner's override), the history of an order, the
-- invitation of the patient when the work is ready (a task once per ready
-- cycle, a notification without a deal), the fitting visit, the warranty,
-- the quality report, the reconciliation act, payments allocated to
-- orders, rights per role, the audit log, clinic isolation.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.int', tests.invite('int@clinic.kz', current_setting('t.org')::bigint, 'integrator')::text, true);
select set_config('t.owner_id', (select id from public.sales where email = 'owner@clinic.kz')::text, true);
select set_config('t.m1_id', (select id from public.sales where email = 'm1@clinic.kz')::text, true);
select set_config('t.other', tests.sign_up('owner@second.kz', 'Другая')::text, true);
select set_config('t.other_org', tests.org_of(current_setting('t.other')::uuid)::text, true);

update public.task_rules set is_active = false;

create function tests.today() returns date language sql security definer as $$
  select private.lab_today(current_setting('t.org')::bigint)
$$;
create function tests.id_of(target text) returns bigint language sql as $$
  select current_setting('t.' || target)::bigint
$$;
create function tests.order_of(order_number integer) returns bigint language sql security definer as $$
  select id from public.lab_orders where organization_id = current_setting('t.org')::bigint and number = order_number
$$;
create function tests.last_remake(target bigint) returns public.lab_order_remakes language sql security definer as $$
  select * from public.lab_order_remakes where order_id = target order by id desc limit 1
$$;
create function tests.costs(target bigint) returns bigint language sql security definer as $$
  select coalesce(sum(amount), 0)::bigint from public.lab_order_costs where order_id = target
$$;
create function tests.price_on(org bigint, work_type bigint, lab bigint, day date) returns bigint language sql security definer as $$
  select private.lab_price_on(org, work_type, lab, day)
$$;
grant execute on all functions in schema tests to authenticated;

--
-- Dictionaries: reasons, terms, prices per lab
--
select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert(
  (select string_agg(name, ',' order by position) = 'Не подошёл цвет,Не сел,Скол,Ошибка оттиска' from public.lab_remake_reasons),
  'a new clinic has the four reasons of a remake');
select tests.assert(
  (select fitting_days = 3 and ready_days = 7 and warranty_months = 12 from public.lab_work_types where name = 'Коронка металлокерамическая'),
  'the work types come with their terms and warranty');
insert into public.labs (name) values ('Дентал-Арт');
insert into public.labs (name, work_weekdays) values ('Смайл-Лаб', '{1,2,3,4,5}');
insert into public.labs (name) values ('Акт-Лаб');
select set_config('t.labA', (select id from public.labs where name = 'Дентал-Арт')::text, true);
select set_config('t.labB', (select id from public.labs where name = 'Смайл-Лаб')::text, true);
select set_config('t.labC', (select id from public.labs where name = 'Акт-Лаб')::text, true);
insert into public.lab_technicians (lab_id, name) values (tests.id_of('labA'), 'Серик'), (tests.id_of('labB'), 'Марина'), (tests.id_of('labA'), 'Качество');
select set_config('t.techA', (select id from public.lab_technicians where name = 'Серик')::text, true);
select set_config('t.techB', (select id from public.lab_technicians where name = 'Марина')::text, true);
select set_config('t.techQ', (select id from public.lab_technicians where name = 'Качество')::text, true);
select set_config('t.crown', (select id from public.lab_work_types where name = 'Коронка металлокерамическая')::text, true);
select set_config('t.temp', (select id from public.lab_work_types where name = 'Временная коронка')::text, true);
insert into public.doctors (name, admin_sales_id) values ('Ахметова Айгуль', current_setting('t.m1_id')::bigint), ('Сериков Бахыт', null);
select set_config('t.d1', (select id from public.doctors where name = 'Ахметова Айгуль')::text, true);
select set_config('t.d2', (select id from public.doctors where name = 'Сериков Бахыт')::text, true);
insert into public.patients (first_name, last_name, sales_id) values ('Асель', 'Нурланова', current_setting('t.m1_id')::bigint);
insert into public.patients (first_name, last_name) values ('Ерлан', 'Омаров');
select set_config('t.p1', (select id from public.patients where first_name = 'Асель')::text, true);
select set_config('t.p2', (select id from public.patients where first_name = 'Ерлан')::text, true);
insert into public.deals (patient_id, name, sales_id) values (tests.id_of('p1'), 'ortho', current_setting('t.owner_id')::bigint);
select set_config('t.deal', (select id from public.deals where name = 'ortho')::text, true);

-- Prices: the default (seeded 18 000 from 2000-01-01), a new default from
-- five days ago, Смайл-Лаб's own price from 30 days ago and a future one
insert into public.lab_work_type_prices (work_type_id, lab_id, effective_from, price)
values (tests.id_of('crown'), null, tests.today() - 5, 19000),
  (tests.id_of('crown'), tests.id_of('labB'), tests.today() - 30, 20000),
  (tests.id_of('crown'), tests.id_of('labB'), tests.today() + 10, 22000);
select tests.throws(format('insert into public.lab_work_type_prices (work_type_id, lab_id, effective_from, price) values (%s, %s, %L, 1)',
  current_setting('t.crown'), current_setting('t.labB'), tests.today() - 30), '23505', 'one price of a lab per day');
select tests.throws(format('insert into public.lab_work_type_prices (work_type_id, effective_from, price) values (%s, %L, 1)',
  current_setting('t.crown'), '2000-01-01'), '23505', 'one default price per day');
select tests.assert(tests.price_on(tests.id_of('org'), tests.id_of('crown'), tests.id_of('labA'), tests.today() - 10) = 18000, 'lab A ten days ago: the old default');
select tests.assert(tests.price_on(tests.id_of('org'), tests.id_of('crown'), tests.id_of('labA'), tests.today()) = 19000, 'lab A today: the new default');
select tests.assert(tests.price_on(tests.id_of('org'), tests.id_of('crown'), tests.id_of('labB'), tests.today() - 40) = 18000, 'lab B before its own price: the default');
select tests.assert(tests.price_on(tests.id_of('org'), tests.id_of('crown'), tests.id_of('labB'), tests.today()) = 20000, 'lab B today: its own price');
select tests.assert(tests.price_on(tests.id_of('org'), tests.id_of('crown'), tests.id_of('labB'), tests.today() + 10) = 22000, 'lab B from the future day: the new price');
select tests.assert(tests.price_on(tests.id_of('org'), tests.id_of('crown'), null, tests.today()) = 19000, 'no lab: the default');

-- Terms: working days of the lab (Смайл-Лаб: Mon–Fri), the lab's own term
select tests.assert(private.lab_add_work_days('2026-10-03', 1, '{1,2,3,4,5,6}') = '2026-10-05', 'Saturday + 1 working day skips Sunday');
select tests.assert(private.lab_add_work_days('2026-10-02', 0, '{1,2,3,4,5}') = '2026-10-02', 'no days: the same day');
select tests.assert(
  (select (r ->> 'fitting_at')::date = '2026-10-07' and (r ->> 'due_at')::date = '2026-10-13' and (r ->> 'ready_days')::int = 7
   from public.lab_propose_dates(tests.id_of('labB'), array[tests.id_of('crown'), tests.id_of('temp')], '2026-10-02') as r),
  'the terms of the order: the longest ones, Mon–Fri from Friday');
insert into public.lab_work_type_terms (lab_id, work_type_id, ready_days) values (tests.id_of('labB'), tests.id_of('crown'), 5);
select tests.assert(
  (select (r ->> 'fitting_at')::date = '2026-10-07' and (r ->> 'due_at')::date = '2026-10-09'
   from public.lab_propose_dates(tests.id_of('labB'), array[tests.id_of('crown')], '2026-10-02') as r),
  'the lab''s own term wins, the fitting falls back to the work type');
select tests.assert(
  (select (r ->> 'fitting_at') is null and (r ->> 'due_at')::date = tests.today() + 2
   from public.lab_propose_dates(null, array[tests.id_of('temp')], null) as r),
  'no lab: every day counts, from today');

--
-- Orders: the price of the order's lab and day
--
-- O1: Смайл-Лаб, the deal of Асель (her doctor's administrator m1)
insert into public.lab_orders (patient_id, deal_id, doctor_id, technician_id, due_at)
values (tests.id_of('p1'), tests.id_of('deal'), tests.id_of('d1'), tests.id_of('techB'), tests.today() + 7);
insert into public.lab_order_items (order_id, work_type_id, qty) values (tests.order_of(1), tests.id_of('crown'), 2);
-- O2: Дентал-Арт today, then moved to Смайл-Лаб
insert into public.lab_orders (patient_id, lab_id, doctor_id) values (tests.id_of('p2'), tests.id_of('labA'), tests.id_of('d2'));
insert into public.lab_order_items (order_id, work_type_id, qty) values (tests.order_of(2), tests.id_of('crown'), 1);
-- O3: Дентал-Арт, an order of twenty days ago
insert into public.lab_orders (patient_id, lab_id, created_at) values (tests.id_of('p2'), tests.id_of('labA'), now() - interval '20 days');
insert into public.lab_order_items (order_id, work_type_id, qty) values (tests.order_of(3), tests.id_of('crown'), 1);
select tests.assert(
  (select lab_id = tests.id_of('labB') and responsible_id = current_setting('t.m1_id')::bigint and lab_cost = 40000 from public.lab_orders_summary where number = 1),
  'a line takes the price of the order''s lab');
select tests.assert((select lab_cost = 19000 from public.lab_orders_summary where number = 2), 'the default price of today');
select tests.assert((select lab_cost = 18000 from public.lab_orders_summary where number = 3), 'an old order keeps the price of its day');
update public.lab_orders set lab_id = tests.id_of('labB') where number = 2;
select tests.assert((select lab_cost = 20000 from public.lab_orders_summary where number = 2), 'another lab reprices the lines');
select tests.assert(
  (select string_agg(kind || ':' || to_status, ',' order by id) = 'created:clinic' from public.lab_order_events where order_id = tests.order_of(1)),
  'the history starts with the creation');
select tests.logout();

--
-- Rights on the dictionaries and prices
--
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert((select count(*) from public.lab_work_type_prices) = 0, 'a manager sees no price');
select tests.throws(format('insert into public.lab_work_type_prices (work_type_id, lab_id, price) values (%s, %s, 1)', current_setting('t.crown'), current_setting('t.labA')),
  '42501', 'a manager writes no price');
select tests.throws(format('insert into public.lab_work_type_terms (lab_id, work_type_id, ready_days) values (%s, %s, 3)', current_setting('t.labA'), current_setting('t.crown')),
  '42501', 'a manager writes no term');
select tests.throws($$insert into public.lab_remake_reasons (name) values ('Своя')$$, '42501', 'a manager adds no reason');
select tests.assert((select count(*) = 4 from public.lab_remake_reasons) and (select count(*) = 1 from public.lab_work_type_terms),
  'a manager reads the reasons and the terms');
select tests.logout();
select tests.login_as(current_setting('t.int')::uuid);
insert into public.lab_remake_reasons (name, position) values ('Не тот материал', 4);
insert into public.lab_work_type_terms (lab_id, work_type_id, fitting_days) values (tests.id_of('labA'), tests.id_of('crown'), 2);
select tests.assert((select count(*) = 0 from public.lab_order_events) and (select count(*) = 0 from public.lab_order_remakes),
  'the integrator configures the dictionaries and sees no order history');
select tests.throws(format('select public.lab_order_remake(%s)', tests.order_of(1)), '42501', 'the integrator makes no remake');
select tests.logout();

--
-- Remakes: reason, fault, paid or free; the history; the invitation
--
select tests.login_as(current_setting('t.m1')::uuid);
update public.lab_orders set status = 'lab' where number = 1;
update public.lab_orders set status = 'fitting' where number = 1;
select public.lab_order_remake(tests.order_of(1), (select id from public.lab_remake_reasons where name = 'Не сел'), null, 'clinic', '  контакт  ');
select tests.assert(
  (select r.reason = 'Не сел' and r.fault = 'clinic' and r.is_paid and not r.is_warranty and r.from_status = 'fitting'
     and r.comment = 'контакт' and r.occurred_on = tests.today() and r.ready_at is null and r.created_by = current_setting('t.m1_id')::bigint
   from tests.last_remake(tests.order_of(1)) r),
  'a remake: the reason of the dictionary, the clinic''s fault — paid');
select tests.assert((select status = 'remake' and remake_count = 1 from public.lab_orders where number = 1), 'the order is in «Переделка»');
select tests.throws(format('update public.lab_order_remakes set is_paid = false where order_id = %s', tests.order_of(1)),
  '42501', 'a manager does not waive the payment');
select tests.throws(format('insert into public.lab_order_remakes (organization_id, order_id, occurred_on) values (%s, %s, current_date)', current_setting('t.org'), tests.order_of(1)),
  '42501', 'remakes are written by the order, not by hand');
update public.lab_orders set status = 'ready' where number = 1;
select tests.assert(
  (select string_agg(kind || ':' || coalesce(from_status, '') || '>' || coalesce(to_status, ''), ',' order by id)
     = 'created:>clinic,status:clinic>lab,status:lab>fitting,remake:fitting>remake,status:remake>ready,invite:>ready'
   from public.lab_order_events where order_id = tests.order_of(1)),
  'the history: every status, the remake and the invitation');
select tests.assert(
  (select bool_and(sales_id = current_setting('t.m1_id')::bigint) from public.lab_order_events where order_id = tests.order_of(1) and kind <> 'created'),
  'the history knows who');
select tests.logout();
select tests.assert(
  (select count(*) = 1 and bool_and(sales_id = current_setting('t.m1_id')::bigint and deal_id = tests.id_of('deal') and type = 'call')
   from public.tasks where text like 'Пригласить пациента на примерку/сдачу: наряд №1%'),
  'ready: a task on the deal for the responsible');
select tests.assert((select ready_at = tests.today() from tests.last_remake(tests.order_of(1))), 'the remade work came back');
select tests.assert(tests.costs(tests.order_of(1)) = 80000, 'a paid remake: the lines cost again');
select tests.assert(
  (select count(*) = 1 and bool_and(id < 0 and qty = 1 and amount = 40000 and name = 'Переделка: Не сел' and billed_on = tests.today()
     and month = date_trunc('month', tests.today())::date)
   from public.lab_order_costs where order_id = tests.order_of(1) and kind = 'remake'),
  'the remake row of lab_order_costs');
-- Toggling the status does not invite twice
select tests.login_as(current_setting('t.m1')::uuid);
update public.lab_orders set status = 'lab' where number = 1;
update public.lab_orders set status = 'ready' where number = 1;
select tests.logout();
select tests.assert((select count(*) = 1 from public.tasks where text like 'Пригласить пациента%наряд №1%'), 'one invitation per ready cycle');

-- The lab's fault: free; the fault changes the default; the owner decides
select tests.login_as(current_setting('t.owner')::uuid);
select public.lab_order_remake(tests.order_of(2), null, 'Трещина', 'lab', null);
select tests.assert(
  (select r.reason = 'Трещина' and r.fault = 'lab' and not r.is_paid and r.from_status = 'clinic' from tests.last_remake(tests.order_of(2)) r),
  'the lab''s fault: free, a reason of its own');
update public.lab_order_remakes set fault = 'patient' where order_id = tests.order_of(2);
select tests.assert((select is_paid from tests.last_remake(tests.order_of(2))), 'the patient''s fault: paid');
update public.lab_order_remakes set is_paid = false where order_id = tests.order_of(2);
update public.lab_order_remakes set comment = 'договорились' where order_id = tests.order_of(2);
select tests.assert((select not is_paid from tests.last_remake(tests.order_of(2))), 'the owner waives it and it stays so');
update public.lab_orders set status = 'ready' where number = 2;
select tests.assert(tests.costs(tests.order_of(2)) = 20000 and (select count(*) = 0 from public.lab_order_costs where order_id = tests.order_of(2) and kind = 'remake'),
  'a free remake adds nothing to what the clinic owes');
-- Without a deal: a notification for the responsible
select tests.assert(
  (select count(*) = 1 from public.notifications where sales_id = current_setting('t.owner_id')::bigint and kind = 'lab_order' and title like 'Работа готова%'),
  'ready without a deal: a notification for the responsible');
select tests.assert(
  (select count(*) >= 2 from public.audit_log where entity = 'lab_order_remake' and patient_id = tests.id_of('p2')),
  'the remake changes are in the audit log with the patient');

--
-- The fitting visit
--
insert into public.visits (patient_id, doctor_id, starts_at, ends_at)
values (tests.id_of('p2'), tests.id_of('d2'), (tests.today() + 3) + time '10:00', (tests.today() + 3) + time '10:30');
insert into public.visits (patient_id, doctor_id, starts_at, ends_at)
values (tests.id_of('p1'), tests.id_of('d1'), (tests.today() + 4) + time '11:00', (tests.today() + 4) + time '11:30');
select set_config('t.visit2', (select id from public.visits where patient_id = tests.id_of('p2'))::text, true);
select set_config('t.visit1', (select id from public.visits where patient_id = tests.id_of('p1'))::text, true);
select tests.throws(format('update public.lab_orders set fitting_visit_id = %s where number = 1', current_setting('t.visit2')),
  '22023', 'a visit of another patient is not the fitting');
insert into public.lab_orders (patient_id, lab_id) values (tests.id_of('p1'), tests.id_of('labA'));
update public.lab_orders set fitting_visit_id = tests.id_of('visit1') where number = 4;
select tests.assert(
  (select fitting1_at = tests.today() + 4 and fitting_visit_at is not null from public.lab_orders_summary where number = 4),
  'the fitting visit gives the fitting day');
select tests.assert((select count(*) = 1 from public.lab_order_events where order_id = tests.order_of(4) and kind = 'fitting_visit' and note is not null),
  'the fitting visit is in the history');

--
-- Warranty
--
-- O5: a crown (12 months) delivered today, remade: under the warranty
insert into public.lab_orders (patient_id, lab_id) values (tests.id_of('p2'), tests.id_of('labA'));
insert into public.lab_order_items (order_id, work_type_id, qty) values (tests.order_of(5), tests.id_of('crown'), 1);
update public.lab_orders set status = 'delivered' where number = 5;
select tests.assert(
  (select first_delivered_at = tests.today() and warranty_months = 12 and warranty_until = (tests.today() + interval '12 months')::date
   from public.lab_orders_summary where number = 5),
  'a delivered order is under the warranty of its works');
select public.lab_order_remake(tests.order_of(5), (select id from public.lab_remake_reasons where name = 'Скол'), null, 'clinic', null);
select tests.assert(
  (select r.is_warranty and not r.is_paid and r.from_status = 'delivered' from tests.last_remake(tests.order_of(5)) r),
  'a remake within the warranty: free by default, even at the clinic''s fault');
select tests.assert(
  (select first_ready_at = tests.today() and first_delivered_at = tests.today() and ready_at is null and last_remake_warranty
   from public.lab_orders_summary where number = 5),
  'the first ready and delivered days survive the remake');
select tests.assert(tests.costs(tests.order_of(5)) = 19000, 'the warranty remake costs nothing');
-- O6: a temporary crown (no warranty) delivered and remade
insert into public.lab_orders (patient_id, lab_id) values (tests.id_of('p2'), tests.id_of('labA'));
insert into public.lab_order_items (order_id, work_type_id, qty) values (tests.order_of(6), tests.id_of('temp'), 1);
update public.lab_orders set status = 'delivered' where number = 6;
select public.lab_order_remake(tests.order_of(6), null, null, 'patient', null);
select tests.assert((select not r.is_warranty and r.is_paid from tests.last_remake(tests.order_of(6)) r), 'no warranty: the patient''s fault is paid');
select tests.logout();

--
-- Quality: technician «Качество» (Дентал-Арт), doctor Сериков
--
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.lab_orders (patient_id, technician_id, doctor_id) select tests.id_of('p2'), tests.id_of('techQ'), tests.id_of('d2') from generate_series(1, 4);
insert into public.lab_order_items (order_id, work_type_id, qty) select id, tests.id_of('crown'), 1 from public.lab_orders where technician_id = tests.id_of('techQ');
-- Q1 on time (6 days), Q2 late (7 days), Q3 overdue now, Q4 remade (the lab's fault)
update public.lab_orders set status = 'ready', sent_at = tests.today() - 10, due_at = tests.today() - 3, ready_at = tests.today() - 4 where number = 7;
update public.lab_orders set status = 'ready', sent_at = tests.today() - 8, due_at = tests.today() - 2, ready_at = tests.today() - 1 where number = 8;
update public.lab_orders set status = 'lab', sent_at = tests.today() - 5, due_at = tests.today() - 1 where number = 9;
update public.lab_orders set status = 'lab', sent_at = tests.today() - 6, due_at = tests.today() + 5 where number = 10;
select public.lab_order_remake(tests.order_of(10), (select id from public.lab_remake_reasons where name = 'Скол'), null, 'lab', null);
select set_config('t.q', public.report_lab_quality(tests.today() - 30, tests.today())::text, true);
select tests.assert(
  (select (t ->> 'orders')::int = 4 and (t ->> 'remade_orders')::int = 1 and (t ->> 'remake_rate')::numeric = 25
     and (t ->> 'ready')::int = 2 and (t ->> 'on_time')::int = 1 and (t ->> 'on_time_pct')::numeric = 50
     and (t ->> 'avg_lead_days')::numeric = 6.5 and (t ->> 'remakes')::int = 1 and (t ->> 'lab_fault')::int = 1
     and (t ->> 'overdue_now')::int = 1 and (t ->> 'cost')::bigint = 38000
     and t -> 'reasons' = '[{"count": 1, "reason": "Скол"}]'::jsonb and t ->> 'name' = 'Качество'
   from jsonb_array_elements(current_setting('t.q')::jsonb -> 'technicians') t
   where (t ->> 'id')::bigint = tests.id_of('techQ')),
  'quality of a technician: orders, on time, lead time, remakes and reasons, overdue, cost');
select tests.assert(
  (select (d ->> 'orders')::int = 5 and (d ->> 'remakes')::int = 2 and (d ->> 'remade_orders')::int = 2
   from jsonb_array_elements(current_setting('t.q')::jsonb -> 'doctors') d
   where (d ->> 'id')::bigint = tests.id_of('d2')),
  'quality of a doctor: his orders and remakes');
select tests.assert(
  (select (l ->> 'remakes')::int = 3 and (l ->> 'lab_fault')::int = 1 and (l ->> 'clinic_fault')::int = 1 and (l ->> 'patient_fault')::int = 1
     and (l ->> 'warranty')::int = 1
   from jsonb_array_elements(current_setting('t.q')::jsonb -> 'labs') l
   where (l ->> 'id')::bigint = tests.id_of('labA')),
  'quality of a lab: remakes by fault and under the warranty');
select tests.assert(
  (select (current_setting('t.q')::jsonb -> 'totals' ->> 'remakes')::int = 5
     and jsonb_array_length(current_setting('t.q')::jsonb -> 'reasons') >= 3),
  'the totals and the reasons of the clinic');
insert into public.branches (name, position) values ('Филиал', 0);
select tests.assert(
  (public.report_lab_quality(tests.today() - 30, tests.today(), (select id from public.branches where name = 'Филиал')) -> 'totals' ->> 'orders')::int = 0,
  'the branch filter');
select tests.assert(
  jsonb_array_length(public.report_lab_quality(tests.today() - 90, tests.today() - 60) -> 'technicians') = 1,
  'another period: only the technician with an overdue order now');
select tests.logout();
select tests.login_as(current_setting('t.m1')::uuid);
select tests.throws($$select public.report_lab_quality(current_date - 30, current_date)$$, '42501', 'a manager has no quality report');
select tests.logout();

--
-- Reconciliation and allocations: Акт-Лаб
--
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.lab_orders (patient_id, lab_id) values (tests.id_of('p1'), tests.id_of('labC')), (tests.id_of('p1'), tests.id_of('labC'));
insert into public.lab_order_items (order_id, work_type_id, qty) values (tests.order_of(11), tests.id_of('crown'), 1), (tests.order_of(12), tests.id_of('temp'), 2);
-- R1 (19 000) ready 40 days ago; R2 (10 000) ready 10 days ago
update public.lab_orders set status = 'ready', ready_at = tests.today() - 40 where number = 11;
update public.lab_orders set status = 'ready', ready_at = tests.today() - 10 where number = 12;
select public.record_lab_payment(tests.id_of('labC'), tests.today() - 40, 15000, 'bank_transfer', tests.today() - 35, 'аванс');
select set_config('t.pay', (public.record_lab_payment(tests.id_of('labC'), tests.today() - 10, 12000, 'kaspi_transfer', tests.today() - 5, null, false,
  jsonb_build_array(jsonb_build_object('order_id', tests.order_of(12), 'amount', 10000))) ->> 'payment_id'), true);
select tests.assert(
  (select count(*) = 1 and bool_and(order_id = tests.order_of(12) and amount = 10000) from public.lab_payment_allocations where payment_id = tests.id_of('pay')),
  'a payment allocated to an order');
select tests.assert(
  (select cost = 10000 and allocated = 10000 and due = 0 from public.lab_order_balances where id = tests.order_of(12))
  and (select cost = 19000 and allocated = 0 and due = 19000 from public.lab_order_balances where id = tests.order_of(11)),
  'the balance of each order');
select tests.throws(format('insert into public.lab_payment_allocations (payment_id, order_id, amount) values (%s, %s, 1000)', current_setting('t.pay'), tests.order_of(1)),
  '22023', 'an order of another lab');
select tests.throws(format('insert into public.lab_payment_allocations (payment_id, order_id, amount) values (%s, %s, 5000)', current_setting('t.pay'), tests.order_of(11)),
  '22023', 'more than the payment');
select tests.throws(format('update public.lab_payment_allocations set amount = 11000 where payment_id = %s', current_setting('t.pay')),
  '22023', 'more than the order''s cost');
select tests.throws(format('update public.lab_payments set amount = 9000 where id = %s', current_setting('t.pay')),
  '22023', 'a payment is not reduced below its allocations');
insert into public.lab_payment_allocations (payment_id, order_id, amount) values (tests.id_of('pay'), tests.order_of(11), 2000);
select set_config('t.act', public.report_lab_reconciliation(tests.id_of('labC'), tests.today() - 30, tests.today())::text, true);
select tests.assert(
  (select (a ->> 'opening')::bigint = 4000 and (a ->> 'charged')::bigint = 10000 and (a ->> 'paid')::bigint = 12000
     and (a ->> 'closing')::bigint = 2000 and a ->> 'lab_name' = 'Акт-Лаб' and jsonb_array_length(a -> 'lines') = 2
   from (select current_setting('t.act')::jsonb as a) x),
  'the act: opening 19 000 − 15 000, works 10 000, paid 12 000, closing 2 000');
select tests.assert(
  (select l -> 0 ->> 'kind' = 'work' and (l -> 0 ->> 'debit')::bigint = 10000 and (l -> 0 ->> 'day')::date = tests.today() - 10
     and l -> 1 ->> 'kind' = 'payment' and (l -> 1 ->> 'credit')::bigint = 12000 and l -> 1 ->> 'orders' = format('№%s, №%s', 11, 12)
   from (select current_setting('t.act')::jsonb -> 'lines' as l) x),
  'the lines of the act by date, the payment with its orders');
select tests.assert(
  (select total_balance = 2000 from public.report_lab_settlement(tests.today()) where lab_id = tests.id_of('labC')),
  'the settlement agrees with the act: allocations change nothing');
select tests.assert(
  (select (report_lab_reconciliation ->> 'closing')::bigint = 29000 - 27000 from public.report_lab_reconciliation(tests.id_of('labC'), tests.today() - 100, tests.today())),
  'the whole history: opening 0');
select tests.logout();

select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert((select count(*) from public.lab_payment_allocations) = 0 and (select count(*) from public.lab_order_balances) = 0,
  'a manager sees no allocation and no balance');
select tests.assert((select count(*) from public.lab_order_costs) = 0, 'a manager sees no cost, the remakes included');
select tests.assert((select remakes_cost is null and due_amount is null and last_remake_reason = 'Не сел' from public.lab_orders_summary where number = 1),
  'a manager sees the remake, not its money');
select tests.throws(format('select public.report_lab_reconciliation(%s, current_date - 30, current_date)', current_setting('t.labC')), '42501', 'a manager has no act');
select tests.throws(format('insert into public.lab_payment_allocations (payment_id, order_id, amount) values (%s, %s, 1)', current_setting('t.pay'), tests.order_of(12)),
  '42501', 'a manager allocates nothing');
select tests.logout();

select tests.login_as(current_setting('t.head')::uuid);
select tests.assert((select remakes_cost = 40000 and due_amount = 80000 from public.lab_orders_summary where number = 1), 'the head sees the remakes cost and the due');
select tests.assert((select count(*) from public.report_lab_settlement(tests.today()) where lab_id = tests.id_of('labB')) = 1, 'the head has the settlement');
select tests.logout();

--
-- Clinic isolation
--
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(
  (select count(*) = 4 from public.lab_remake_reasons) and (select count(*) = 0 from public.lab_order_remakes)
  and (select count(*) = 0 from public.lab_order_events) and (select count(*) = 0 from public.lab_payment_allocations)
  and (select count(*) = 0 from public.lab_work_type_terms) and (select count(*) = 0 from public.lab_order_balances),
  'another clinic sees only its own reasons');
select tests.throws(format('select public.report_lab_reconciliation(%s, current_date - 30, current_date)', current_setting('t.labC')), 'P0002', 'another clinic''s lab is unknown');
select tests.assert((public.report_lab_quality(current_date - 30, current_date) -> 'totals' ->> 'orders')::int = 0, 'another clinic: an empty quality report');
select tests.throws(format('select public.lab_order_remake(%s)', tests.order_of(1)), 'P0002', 'another clinic cannot remake our order');
select tests.logout();
select tests.assert((select status = 'ready' from public.lab_orders where number = 1 and organization_id = tests.id_of('org')), 'our order is untouched');

rollback;

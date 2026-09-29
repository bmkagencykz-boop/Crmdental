--
-- Dental lab work orders (stage 40): dictionaries (labs, technicians, work
-- types seeded with their lab prices), orders (number per clinic, links to
-- the plan, its stage and deal, doctor's administrator as the responsible,
-- teeth), lines (name and lab price from the work type, plan items of the
-- patient), statuses and their dates, remakes, overdue days, lab cost and
-- the monthly settlement, payroll helpers, reminders before fittings and
-- due dates, rights per role (prices for the owner and the head only, the
-- integrator sees no order), access rights «only own», files of an order,
-- audit log, patient merge, clinic isolation.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m2', tests.invite('m2@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.int', tests.invite('int@clinic.kz', current_setting('t.org')::bigint, 'integrator')::text, true);
select set_config('t.owner_id', (select id from public.sales where email = 'owner@clinic.kz')::text, true);
select set_config('t.head_id', (select id from public.sales where email = 'head@clinic.kz')::text, true);
select set_config('t.m1_id', (select id from public.sales where email = 'm1@clinic.kz')::text, true);
select set_config('t.m2_id', (select id from public.sales where email = 'm2@clinic.kz')::text, true);
select set_config('t.other', tests.sign_up('owner@second.kz', 'Другая')::text, true);
select set_config('t.other_org', tests.org_of(current_setting('t.other')::uuid)::text, true);

update public.task_rules set is_active = false;

create function tests.audit_count(entity_name text, target bigint) returns bigint language sql security definer as $$
  select count(*) from public.audit_log where entity = entity_name and entity_id = target
$$;
create function tests.notifications_of(target bigint) returns bigint language sql security definer as $$
  select count(*) from public.notifications where sales_id = target and kind = 'lab_order'
$$;
create function tests.today(org bigint) returns date language sql security definer as $$
  select private.lab_today(org)
$$;
grant execute on all functions in schema tests to authenticated;

--
-- Dictionaries
--
select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert((select count(*) from public.lab_work_types) = 13, 'a new clinic gets 13 work types');
select tests.assert(
  (select p.price from public.lab_work_type_prices p join public.lab_work_types w on w.id = p.work_type_id where w.name = 'Временная коронка') = 5000,
  'the work types come with their lab prices');
insert into public.labs (name, is_own, phone) values ('Дентал-Арт', false, '+77011234567');
insert into public.labs (name, is_own) values ('Своя лаборатория', true);
select set_config('t.lab', (select id from public.labs where name = 'Дентал-Арт')::text, true);
select set_config('t.own_lab', (select id from public.labs where name = 'Своя лаборатория')::text, true);
insert into public.lab_technicians (lab_id, name) values (current_setting('t.lab')::bigint, 'Серик Техник');
insert into public.lab_technicians (lab_id, name) values (current_setting('t.own_lab')::bigint, 'Олег Свой');
select set_config('t.tech', (select id from public.lab_technicians where name = 'Серик Техник')::text, true);
select set_config('t.own_tech', (select id from public.lab_technicians where name = 'Олег Свой')::text, true);
select set_config('t.crown', (select id from public.lab_work_types where name = 'Коронка металлокерамическая')::text, true);
select set_config('t.temp', (select id from public.lab_work_types where name = 'Временная коронка')::text, true);
insert into public.doctors (name, admin_sales_id) values ('Ахметова Айгуль', current_setting('t.m1_id')::bigint);
select set_config('t.doctor', (select id from public.doctors where name = 'Ахметова Айгуль')::text, true);
insert into public.patients (first_name, last_name, sales_id) values ('Асель', 'Нурланова', current_setting('t.m1_id')::bigint);
insert into public.patients (first_name, last_name) values ('Ерлан', 'Омаров');
select set_config('t.p', (select id from public.patients where first_name = 'Асель')::text, true);
select set_config('t.e', (select id from public.patients where first_name = 'Ерлан')::text, true);
insert into public.deals (patient_id, name, sales_id) values (current_setting('t.p')::bigint, 'ortho', current_setting('t.m1_id')::bigint);
insert into public.deals (patient_id, name, sales_id) values (current_setting('t.e')::bigint, 'erlan', current_setting('t.m1_id')::bigint);
select set_config('t.d1', (select id from public.deals where name = 'ortho')::text, true);
select set_config('t.d2', (select id from public.deals where name = 'erlan')::text, true);
insert into public.treatment_plans (deal_id, name, doctor_id) values (current_setting('t.d1')::bigint, 'Ортопедия', current_setting('t.doctor')::bigint);
insert into public.treatment_plans (deal_id, name) values (current_setting('t.d2')::bigint, 'Чужой план');
select set_config('t.plan', (select id from public.treatment_plans where name = 'Ортопедия')::text, true);
select set_config('t.plan2', (select id from public.treatment_plans where name = 'Чужой план')::text, true);
select set_config('t.stage', (select id from public.treatment_stages where plan_id = current_setting('t.plan')::bigint and position = 1)::text, true);
insert into public.treatment_plan_items (plan_id, stage_no, name, tooth, quantity, unit_price)
values (current_setting('t.plan')::bigint, 1, 'Коронка металлокерамическая', '36', 1, 90000);
insert into public.treatment_plan_items (plan_id, stage_no, name, tooth, quantity, unit_price)
values (current_setting('t.plan2')::bigint, 1, 'Коронка чужая', '11', 1, 90000);
select set_config('t.item', (select id from public.treatment_plan_items where name = 'Коронка металлокерамическая')::text, true);
select set_config('t.item2', (select id from public.treatment_plan_items where name = 'Коронка чужая')::text, true);
select tests.assert(tests.audit_count('lab', current_setting('t.lab')::bigint) = 1, 'a new lab is in the audit log');
select tests.logout();

-- Dictionaries: managers read them, the integrator configures them; prices
-- are for the owner and the head
select tests.login_as(current_setting('t.m2')::uuid);
select tests.assert((select count(*) from public.labs) = 2 and (select count(*) from public.lab_work_types) = 13, 'a manager reads the dictionaries');
select tests.assert((select count(*) from public.lab_work_type_prices) = 0, 'a manager does not see the lab prices');
select tests.throws($$insert into public.labs (name) values ('Своя')$$, '42501', 'a manager cannot add a lab');
select tests.throws(format('insert into public.lab_work_type_prices (work_type_id, price) values (%s, 1)', current_setting('t.temp')), '42501', 'a manager cannot write a price');
select tests.logout();
select tests.login_as(current_setting('t.int')::uuid);
insert into public.lab_work_types (name, position) values ('Ночная каппа', 20);
select tests.assert((select count(*) from public.lab_work_types where name = 'Ночная каппа') = 1, 'the integrator configures the work types');
select tests.assert((select count(*) from public.lab_work_type_prices) = 0, 'the integrator does not see the prices');
select tests.logout();
select tests.login_as(current_setting('t.head')::uuid);
update public.lab_work_type_prices set price = 20000 where work_type_id = current_setting('t.crown')::bigint;
select tests.assert(tests.audit_count('lab_work_type_price', (select id from public.lab_work_type_prices where work_type_id = current_setting('t.crown')::bigint)) = 1,
  'a price change is in the audit log');
select tests.logout();

--
-- Orders
--
select tests.login_as(current_setting('t.m2')::uuid);
insert into public.lab_orders (patient_id, stage_id, lab_id, technician_id, teeth, shade, material, comment, due_at)
values (current_setting('t.p')::bigint, current_setting('t.stage')::bigint, current_setting('t.lab')::bigint,
  current_setting('t.tech')::bigint, '{37,36,36}', ' A2 ', 'Металлокерамика', ' ', tests.today(current_setting('t.org')::bigint) + 10);
select set_config('t.o1', (select id from public.lab_orders where shade = 'A2')::text, true);
select tests.assert(
  (select number = 1 and plan_id = current_setting('t.plan')::bigint and deal_id = current_setting('t.d1')::bigint
     and doctor_id = current_setting('t.doctor')::bigint and responsible_id = current_setting('t.m1_id')::bigint
     and created_by = current_setting('t.m2_id')::bigint and teeth = '{36,37}' and comment is null and status = 'clinic'
   from public.lab_orders where id = current_setting('t.o1')::bigint),
  'the first order: №1, plan and deal of the stage, doctor of the plan, the doctor''s administrator, teeth sorted');
insert into public.lab_orders (patient_id, technician_id) values (current_setting('t.e')::bigint, current_setting('t.own_tech')::bigint);
select set_config('t.o2', (select id from public.lab_orders where patient_id = current_setting('t.e')::bigint)::text, true);
select tests.assert(
  (select number = 2 and lab_id = current_setting('t.own_lab')::bigint and responsible_id = current_setting('t.m2_id')::bigint
   from public.lab_orders where id = current_setting('t.o2')::bigint),
  'the second order: №2, the lab of the technician, the author as the responsible');
select tests.throws(format('insert into public.lab_orders (patient_id, plan_id) values (%s, %s)', current_setting('t.p'), current_setting('t.plan2')), '22023', 'a plan of another patient');
select tests.throws(format('insert into public.lab_orders (patient_id, deal_id) values (%s, %s)', current_setting('t.p'), current_setting('t.d2')), '22023', 'a deal of another patient');
select tests.throws(format('insert into public.lab_orders (patient_id, lab_id, technician_id) values (%s, %s, %s)', current_setting('t.p'), current_setting('t.lab'), current_setting('t.own_tech')), '22023', 'a technician of another lab');
select tests.throws(format('insert into public.lab_orders (patient_id, teeth) values (%s, ''{19}'')', current_setting('t.p')), '23514', 'tooth 19 does not exist');
select tests.throws(format('insert into public.lab_orders (patient_id, status) values (%s, ''lost'')', current_setting('t.p')), '23514', 'an unknown status');

-- Lines: the name and the lab price of the work type
insert into public.lab_order_items (order_id, work_type_id, qty, plan_item_id)
values (current_setting('t.o1')::bigint, current_setting('t.crown')::bigint, 2, current_setting('t.item')::bigint);
insert into public.lab_order_items (order_id, work_type_id, qty, position)
values (current_setting('t.o1')::bigint, current_setting('t.temp')::bigint, 2, 1);
select tests.assert(
  (select string_agg(name, ',' order by position) = 'Коронка металлокерамическая,Временная коронка' from public.lab_order_items where order_id = current_setting('t.o1')::bigint),
  'a line takes the name of its work type');
select tests.throws(format('insert into public.lab_order_items (order_id, plan_item_id, name) values (%s, %s, ''x'')', current_setting('t.o1'), current_setting('t.item2')), '22023', 'a plan item of another patient');
select tests.throws(format('insert into public.lab_order_items (order_id) values (%s)', current_setting('t.o1')), '22023', 'a line needs a work');
select tests.throws(format('update public.lab_order_items set order_id = %s where order_id = %s', current_setting('t.o2'), current_setting('t.o1')), '22023', 'a line does not move to another order');
select tests.assert(
  (select items_count = 2 and units = 4 and works = 'Коронка металлокерамическая × 2, Временная коронка × 2' and lab_cost is null
     and patient_name = 'Нурланова Асель' and lab_name = 'Дентал-Арт' and technician_name = 'Серик Техник' and doctor_name = 'Ахметова Айгуль'
   from public.lab_orders_summary where id = current_setting('t.o1')::bigint),
  'the summary: works, names; no lab cost for a manager');
select tests.assert((select count(*) from public.lab_order_item_prices) = 0, 'a manager does not see the line prices');
select tests.assert(tests.affected('update public.lab_order_item_prices set price = 1') = 0, 'a manager cannot change a line price');
select tests.assert((select count(*) from public.lab_order_costs) = 0, 'a manager does not see the costs');
select tests.throws($$select * from public.report_lab_settlement(current_date)$$, '42501', 'a manager has no settlement');
select tests.logout();

select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert(
  (select lab_cost = 2 * 20000 + 2 * 5000 from public.lab_orders_summary where id = current_setting('t.o1')::bigint),
  'the owner sees the lab cost: Σ qty × price at the time of the line');
update public.lab_order_item_prices set price = 6000
where item_id = (select id from public.lab_order_items where order_id = current_setting('t.o1')::bigint and work_type_id = current_setting('t.temp')::bigint);
select tests.assert(
  (select lab_cost = 52000 from public.lab_orders_summary where id = current_setting('t.o1')::bigint),
  'the owner adjusts a line price');
select tests.assert(
  (select count(*) from public.audit_log where entity = 'lab_order_price' and patient_id = current_setting('t.p')::bigint) = 1,
  'a line price change is in the audit log with the patient');
update public.lab_work_type_prices set price = 99999 where work_type_id = current_setting('t.crown')::bigint;
select tests.assert(
  (select lab_cost = 52000 from public.lab_orders_summary where id = current_setting('t.o1')::bigint),
  'a new dictionary price does not change the lines already written');
select tests.logout();

--
-- Statuses and dates
--
select tests.login_as(current_setting('t.m2')::uuid);
update public.lab_orders set status = 'lab' where id = current_setting('t.o1')::bigint;
select tests.assert(
  (select sent_at = tests.today(current_setting('t.org')::bigint) and ready_at is null from public.lab_orders where id = current_setting('t.o1')::bigint),
  'sent to the lab: the date is stamped');
update public.lab_orders set status = 'fitting', fitting1_at = tests.today(current_setting('t.org')::bigint) + 1 where id = current_setting('t.o1')::bigint;
update public.lab_orders set status = 'ready' where id = current_setting('t.o1')::bigint;
select tests.assert(
  (select ready_at = tests.today(current_setting('t.org')::bigint) and delivered_at is null and overdue_days = 0 from public.lab_orders_summary where id = current_setting('t.o1')::bigint),
  'ready: the date is stamped');
update public.lab_orders set status = 'remake' where id = current_setting('t.o1')::bigint;
select tests.assert(
  (select remake_count = 1 and ready_at is null from public.lab_orders where id = current_setting('t.o1')::bigint),
  'a remake counts and reopens the order');
update public.lab_orders set remake_count = 10, number = 99 where id = current_setting('t.o1')::bigint;
select tests.assert(
  (select remake_count = 1 and number = 1 from public.lab_orders where id = current_setting('t.o1')::bigint),
  'the number and the remakes are not written by hand');
update public.lab_orders set delivered_at = tests.today(current_setting('t.org')::bigint) where id = current_setting('t.o1')::bigint;
select tests.assert(
  (select status = 'delivered' and ready_at = tests.today(current_setting('t.org')::bigint) and delivered_at is not null
   from public.lab_orders where id = current_setting('t.o1')::bigint),
  'a date given to the patient closes the order');

-- Overdue
update public.lab_orders set status = 'lab', due_at = tests.today(current_setting('t.org')::bigint) - 3 where id = current_setting('t.o2')::bigint;
select tests.assert((select overdue_days = 3 from public.lab_orders_summary where id = current_setting('t.o2')::bigint), 'three days overdue');
select tests.assert(private.lab_overdue_days('ready', date '2026-01-01', date '2026-01-10') = 0, 'a ready work is not overdue');
select tests.assert(private.lab_overdue_days('fitting', date '2026-01-01', date '2026-01-10') = 9, 'an active work is');
select tests.assert(private.lab_overdue_days('lab', date '2026-01-10', date '2026-01-10') = 0, 'the due day itself is not overdue');
select tests.logout();

--
-- Money: settlement and payroll helpers
--
select tests.login_as(current_setting('t.head')::uuid);
select tests.assert(
  (select count(*) = 1 and bool_and(lab_id = current_setting('t.lab')::bigint and orders_count = 1 and items_count = 4 and amount = 52000)
   from public.report_lab_settlement(tests.today(current_setting('t.org')::bigint))),
  'the settlement of the month: the lab, its orders, works and sum');
select tests.assert((select count(*) from public.report_lab_settlement(tests.today(current_setting('t.org')::bigint) - 62)) = 0, 'nothing two months ago');
select tests.assert(
  (select count(*) = 2 and sum(amount) = 52000 and bool_and(month = date_trunc('month', tests.today(current_setting('t.org')::bigint))::date)
   from public.lab_order_costs where order_id = current_setting('t.o1')::bigint),
  'the head sees the costs per line with their month');
select tests.logout();
select tests.assert(private.lab_cost_for_doctor(current_setting('t.org')::bigint, current_setting('t.doctor')::bigint, private.lab_today(current_setting('t.org')::bigint)) = 52000,
  'the lab cost of the doctor in the month (payroll)');
select tests.assert(private.lab_cost_for_plan_item(current_setting('t.org')::bigint, current_setting('t.item')::bigint) = 40000,
  'the lab cost of the plan item (payroll)');

--
-- Reminders
--
select tests.login_as(current_setting('t.m2')::uuid);
insert into public.lab_orders (patient_id, doctor_id, lab_id, status, fitting1_at, due_at)
values (current_setting('t.p')::bigint, current_setting('t.doctor')::bigint, current_setting('t.lab')::bigint, 'lab',
  tests.today(current_setting('t.org')::bigint) + 1, tests.today(current_setting('t.org')::bigint) + 5);
select set_config('t.o3', (select id from public.lab_orders where number = 3)::text, true);
select tests.logout();
select private.lab_orders_tick();
select tests.assert(tests.notifications_of(current_setting('t.m1_id')::bigint) = 1, 'the doctor''s administrator: fitting tomorrow');
select tests.assert(
  (select title = 'Примерка 1 завтра' and body like 'Наряд №3 · Нурланова Асель%' and patient_id = current_setting('t.p')::bigint
   from public.notifications where sales_id = current_setting('t.m1_id')::bigint and kind = 'lab_order'),
  'the reminder names the order and the patient');
select tests.assert(tests.notifications_of(current_setting('t.m2_id')::bigint) = 1, 'the responsible of the overdue order №2');
select private.lab_orders_tick();
select tests.assert(tests.notifications_of(current_setting('t.m1_id')::bigint) = 1 and tests.notifications_of(current_setting('t.m2_id')::bigint) = 1,
  'each reminder once');
update public.sales set disabled = true where id = current_setting('t.m2_id')::bigint;
update public.lab_orders set due_at = due_at - 1 where id = current_setting('t.o2')::bigint;
select private.lab_orders_tick();
select tests.assert(tests.notifications_of(current_setting('t.owner_id')::bigint) = 1 and tests.notifications_of(current_setting('t.head_id')::bigint) = 1,
  'a moved date reminds again; a disabled responsible: the owner and the heads');
update public.sales set disabled = false where id = current_setting('t.m2_id')::bigint;
select tests.assert(
  (select 'lab_order' = any(kinds) from public.notification_preferences limit 1) is not false,
  'the preferences know the kind');

--
-- Rights
--
select tests.login_as(current_setting('t.int')::uuid);
select tests.assert((select count(*) from public.lab_orders) = 0 and (select count(*) from public.lab_order_items) = 0, 'the integrator sees no order');
select tests.throws(format('insert into public.lab_orders (patient_id) values (%s)', current_setting('t.p')), '42501', 'the integrator cannot write an order');
select tests.logout();

-- A manager deletes their own order while it is in the clinic
select tests.login_as(current_setting('t.m2')::uuid);
insert into public.lab_orders (patient_id) values (current_setting('t.e')::bigint);
select set_config('t.o4', (select id from public.lab_orders where number = 4)::text, true);
select tests.logout();
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(tests.affected(format('delete from public.lab_orders where id = %s', current_setting('t.o4'))) = 0, 'another manager cannot delete it');
select tests.logout();
select tests.login_as(current_setting('t.m2')::uuid);
select tests.assert(tests.affected(format('delete from public.lab_orders where id = %s', current_setting('t.o2'))) = 0, 'the author cannot delete a sent order');
select tests.assert(tests.affected(format('delete from public.lab_orders where id = %s', current_setting('t.o4'))) = 1, 'the author deletes an order still in the clinic');
select tests.logout();

-- Access rights «only own» (stage 30): orders follow their patient
select tests.login_as(current_setting('t.owner')::uuid);
select public.save_access_rights(current_setting('t.m2_id')::bigint, '{"patients": {"view": "own"}, "deals": {"view": "own"}}');
select tests.logout();
select tests.login_as(current_setting('t.m2')::uuid);
select tests.assert((select count(*) from public.lab_orders) = 0, 'a manager with «only own» patients sees no orders of other patients');
select tests.throws(format('insert into public.lab_orders (patient_id) values (%s)', current_setting('t.p')), '42501', 'nor writes them');
select tests.logout();
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert((select count(*) from public.lab_orders) = 3, 'the other manager sees all orders');

-- Files of an order: patient files tied to it
insert into public.patient_files (patient_id, path, name, kind, lab_order_id, sales_id)
values (current_setting('t.p')::bigint, current_setting('t.org') || '/patients/' || current_setting('t.p') || '/a-scan.stl', 'scan.stl', 'document',
  current_setting('t.o1')::bigint, current_setting('t.m1_id')::bigint);
select tests.assert((select count(*) from public.patient_files where lab_order_id = current_setting('t.o1')::bigint) = 1, 'a scan attached to the order');
select tests.logout();

--
-- Audit log
--
select tests.assert(
  (select count(*) from public.audit_log where entity = 'lab_order' and entity_id = current_setting('t.o1')::bigint
     and patient_id = current_setting('t.p')::bigint and deal_id = current_setting('t.d1')::bigint) >= 5,
  'the order and its changes are in the audit log, with the patient and the deal');
select tests.assert(
  (select changes -> 'status' = '["clinic", "lab"]'::jsonb and sales_id = current_setting('t.m2_id')::bigint
   from public.audit_log where entity = 'lab_order' and entity_id = current_setting('t.o1')::bigint and action = 'update' and changes ? 'status' order by id limit 1),
  'the status change with its author');
select tests.assert(
  (select count(*) from public.audit_log where entity = 'lab_order_item' and patient_id = current_setting('t.p')::bigint) = 2,
  'the lines are in the audit log with the patient');
select tests.assert(
  (select count(*) from public.audit_log where entity = 'lab_order' and entity_id = current_setting('t.o4')::bigint and action = 'delete') = 1,
  'a deleted order is in the audit log');

--
-- Patient merge (stage 18): the orders move
--
select tests.login_as(current_setting('t.owner')::uuid);
select public.merge_patients(current_setting('t.p')::bigint, current_setting('t.e')::bigint);
select tests.assert((select count(*) from public.lab_orders where patient_id = current_setting('t.p')::bigint) = 3, 'the orders of the merged patient move');
select tests.logout();

--
-- Isolation
--
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert((select count(*) from public.lab_orders) = 0 and (select count(*) from public.labs) = 0
  and (select count(*) from public.lab_order_costs) = 0 and (select count(*) from public.lab_work_types) = 13,
  'another clinic sees nothing of ours (and has its own work types)');
select tests.assert((select count(*) from public.report_lab_settlement(current_date)) = 0, 'another clinic: an empty settlement');
insert into public.patients (first_name) values ('Чужой');
select tests.throws(format('insert into public.lab_orders (patient_id, lab_id) values ((select id from public.patients where first_name = ''Чужой''), %s)', current_setting('t.lab')), '23503', 'a lab of another clinic');
select tests.throws(format('insert into public.lab_order_items (order_id, name) values (%s, ''x'')', current_setting('t.o1')), '42501', 'a line on an order of another clinic');
select tests.assert(tests.affected(format('update public.lab_orders set status = ''lab'' where id = %s', current_setting('t.o3'))) = 0, 'cannot change our orders');
select tests.logout();

rollback;

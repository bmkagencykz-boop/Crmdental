--
-- Money going out of the cash desk (stage 42): expense categories of a
-- clinic, expenses in the ledger (no patient, a category), the expected
-- cash of a shift with expenses, the reports, payroll payouts and lab
-- payments linked to their expense both ways, the lab settlement with paid
-- and balance, the plan item doctor (saved, duplicated, used by the
-- payroll), rights per role, the audit log, clinic isolation.
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
select set_config('t.m1_id', (select id from public.sales where email = 'm1@clinic.kz')::text, true);
select set_config('t.m2_id', (select id from public.sales where email = 'm2@clinic.kz')::text, true);
select set_config('t.other', tests.sign_up('owner@second.kz', 'Другая')::text, true);
select set_config('t.other_org', tests.org_of(current_setting('t.other')::uuid)::text, true);

update public.task_rules set is_active = false;

create function tests.cat(org bigint, category_code text) returns bigint language sql security definer as $$
  select id from public.cash_expense_categories where organization_id = org and code = category_code
$$;
create function tests.op(op_comment text) returns bigint language sql security definer as $$
  select id from public.account_operations where comment = op_comment
$$;
create function tests.op_exists(target bigint) returns boolean language sql security definer as $$
  select exists (select 1 from public.account_operations where id = target)
$$;
create function tests.month_start() returns date language sql security definer as $$
  select date_trunc('month', private.clinic_date(current_setting('t.org')::bigint, now()))::date
$$;
create function tests.day_of(moment timestamptz) returns date language sql security definer as $$
  select private.clinic_date(current_setting('t.org')::bigint, moment)
$$;
grant execute on all functions in schema tests to authenticated;

--
-- Categories: seeded for every clinic, system ones kept
--
select tests.assert(
  (select string_agg(name || ':' || code, ',' order by position) = 'Зарплата:salary,Лаборатория:lab,Материалы:materials,Аренда:rent,Прочее:other'
   from public.cash_expense_categories where organization_id = current_setting('t.org')::bigint),
  'a new clinic has the five categories');
select tests.assert(
  (select count(*) = 5 from public.cash_expense_categories where organization_id = current_setting('t.other_org')::bigint),
  'so does the other clinic');
select tests.assert(
  (select count(*) = 0 from public.audit_log where entity = 'cash_expense_category'),
  'the seeded categories are not in the audit log');

select tests.login_as(current_setting('t.owner')::uuid);
insert into public.cash_expense_categories (name, code, position) values ('  Реклама ', 'rent', 5);
select tests.assert(
  (select code is null and name = 'Реклама' from public.cash_expense_categories where name = 'Реклама'),
  'an own category: no system code, the name trimmed');
select tests.throws(format('delete from public.cash_expense_categories where id = %s', tests.cat(current_setting('t.org')::bigint, 'rent')),
  '22023', 'a system category is not deleted');
select tests.throws($$update public.cash_expense_categories set name = 'Зарплата' where name = 'Реклама'$$,
  '23505', 'category names are unique in a clinic');
select tests.assert(
  (select count(*) = 1 from public.audit_log where entity = 'cash_expense_category' and action = 'create'),
  'an own category is in the audit log');
insert into public.branches (name, position) values ('Филиал Достык', 0);
select set_config('t.branch', (select id from public.branches where name = 'Филиал Достык')::text, true);
insert into public.patients (first_name, last_name) values ('Асель', 'Нурланова');
select set_config('t.p', (select id from public.patients where first_name = 'Асель')::text, true);
select tests.logout();

select tests.login_as(current_setting('t.m1')::uuid);
select tests.throws($$insert into public.cash_expense_categories (name) values ('Своя')$$, '42501', 'a manager adds no category');
select tests.assert((select count(*) = 6 from public.cash_expense_categories), 'a manager reads the categories');
select tests.logout();
select tests.login_as(current_setting('t.int')::uuid);
select tests.assert((select count(*) = 0 from public.cash_expense_categories), 'the integrator reads no category');
select tests.logout();

--
-- Expenses and the expected cash of a shift
--
select tests.login_as(current_setting('t.owner')::uuid);
select public.open_cash_shift(50000, current_setting('t.branch')::bigint);
select set_config('t.shift', (select id from public.cash_shifts where sales_id = current_setting('t.owner_id')::bigint)::text, true);
-- In: a cash payment of 30 000
insert into public.account_operations (patient_id, kind, amount, method, comment)
values (current_setting('t.p')::bigint, 'payment', 30000, 'cash', 'pay 30k');
-- Out: rent 20 000 in cash, materials 15 000 by card
insert into public.account_operations (kind, amount, method, category_id, comment)
values ('expense', 20000, 'cash', tests.cat(current_setting('t.org')::bigint, 'rent'), 'rent cash');
insert into public.account_operations (kind, amount, method, category_id, comment)
values ('expense', 15000, 'card', tests.cat(current_setting('t.org')::bigint, 'materials'), 'materials card');
select tests.assert(
  (select o.patient_id is null and o.till_delta = -20000 and o.paid_delta = 0 and o.deposit_delta = 0
     and o.shift_id = current_setting('t.shift')::bigint and o.branch_id = current_setting('t.branch')::bigint
     and o.sales_id = current_setting('t.owner_id')::bigint and o.deal_payment_id is null
   from public.account_operations o where o.comment = 'rent cash'),
  'an expense: no patient, money out of the till, the shift and its branch');
select tests.assert(public.cash_shift_expected(current_setting('t.shift')::bigint) = 50000 + 30000 - 20000,
  'expected cash: at start + cash in − cash expenses (the card expense aside)');
select tests.assert(
  (select patient_name is null and category_name = 'Аренда' and category_code = 'rent' and cashier_name is not null
   from public.account_operations_summary where comment = 'rent cash'),
  'the cash desk journal shows the expense with its category');

-- The rules of an expense
select tests.throws(format($q$insert into public.account_operations (kind, amount, method, category_id) values ('expense', 1000, 'cash', null)$q$),
  '22023', 'an expense needs a category');
select tests.throws(format($q$insert into public.account_operations (patient_id, kind, amount, method, category_id) values (%s, 'expense', 1000, 'cash', %s)$q$,
  current_setting('t.p'), tests.cat(current_setting('t.org')::bigint, 'rent')),
  '22023', 'an expense is not tied to a patient');
select tests.throws(format($q$insert into public.account_operations (kind, amount, method, category_id) values ('expense', 1000, 'deposit', %s)$q$,
  tests.cat(current_setting('t.org')::bigint, 'rent')),
  '22023', 'an expense is not paid from a deposit');
select tests.throws(format($q$insert into public.account_operations (kind, amount, method, category_id) values ('expense', 0, 'cash', %s)$q$,
  tests.cat(current_setting('t.org')::bigint, 'rent')),
  '23514', 'an expense has an amount');
select tests.throws(format($q$insert into public.account_operations (kind, amount, method, category_id) values ('expense', 1000, 'cash', %s)$q$,
  tests.cat(current_setting('t.other_org')::bigint, 'rent')),
  '22023', 'a category of another clinic');
select tests.throws(format($q$insert into public.account_operations (patient_id, kind, amount, method, category_id) values (%s, 'payment', 1000, 'cash', %s)$q$,
  current_setting('t.p'), tests.cat(current_setting('t.org')::bigint, 'rent')),
  '22023', 'a payment has no category');
select tests.throws($q$insert into public.account_operations (kind, amount, method) values ('payment', 1000, 'cash')$q$,
  '42501', 'a payment keeps its patient');
update public.cash_expense_categories set is_active = false where name = 'Реклама';
select tests.throws(format($q$insert into public.account_operations (kind, amount, method, category_id) values ('expense', 1000, 'cash', %s)$q$,
  (select id from public.cash_expense_categories where name = 'Реклама')),
  '22023', 'an archived category takes no new expense');
select tests.throws(format('delete from public.cash_expense_categories where id = %s', tests.cat(current_setting('t.org')::bigint, 'materials')),
  '22023', 'a used system category is not deleted');
-- The category and the method change (owner, head): the expected cash follows
update public.account_operations set method = 'cash', category_id = tests.cat(current_setting('t.org')::bigint, 'other')
where comment = 'materials card';
select tests.assert(public.cash_shift_expected(current_setting('t.shift')::bigint) = 50000 + 30000 - 20000 - 15000,
  'a card expense turned cash lowers the expected cash');
update public.account_operations set method = 'card', category_id = tests.cat(current_setting('t.org')::bigint, 'materials')
where comment = 'materials card';

-- The audit log
select tests.assert(
  (select count(*) = 1 from public.audit_log a
   where a.entity = 'account_operation' and a.action = 'create' and a.patient_id is null
     and a.changes -> 'kind' ->> 1 = 'expense' and (a.changes -> 'category_id' ->> 1)::bigint = tests.cat(current_setting('t.org')::bigint, 'rent')),
  'an expense is in the audit log with its category');

--
-- Reports
--
select tests.assert(
  (select (m ->> 'income')::bigint = 30000 and (m ->> 'expenses')::bigint = 20000 and (m ->> 'refunds')::bigint = 0 and (m ->> 'net')::bigint = 10000
   from jsonb_array_elements(public.report_cash_methods()) m where m ->> 'method' = 'cash'),
  'report by method: cash in, cash expenses apart from refunds, net');
select tests.assert(
  (select (m ->> 'expenses')::bigint = 15000 and (m ->> 'net')::bigint = -15000
   from jsonb_array_elements(public.report_cash_methods()) m where m ->> 'method' = 'card'),
  'report by method: the card expense');
select tests.assert(
  (select jsonb_agg(jsonb_build_object('code', e ->> 'code', 'amount', (e ->> 'amount')::bigint, 'cash', (e ->> 'cash')::bigint)
     order by e ->> 'code')
   from jsonb_array_elements(public.report_cash_expenses()) e)
  = '[{"code": "materials", "cash": 0, "amount": 15000}, {"code": "rent", "cash": 20000, "amount": 20000}]'::jsonb,
  'report of expenses by category');
select tests.assert(jsonb_array_length(public.report_cash_expenses(filter_branch_id => -1)) = 0, 'the branch filter');
select tests.logout();

--
-- Rights: the manager (refused by default, allowed by the clinic setting)
--
select tests.login_as(current_setting('t.m1')::uuid);
select public.open_cash_shift(10000);
select set_config('t.m1_shift', (select id from public.cash_shifts where sales_id = current_setting('t.m1_id')::bigint)::text, true);
select tests.throws(format($q$insert into public.account_operations (kind, amount, method, category_id) values ('expense', 1000, 'cash', %s)$q$,
  tests.cat(current_setting('t.org')::bigint, 'other')),
  '42501', 'a manager records no expense by default');
select tests.assert((select count(*) = 0 from public.account_operations where kind = 'expense'),
  'a manager without the reports right sees no expense of others');
select tests.throws($$select public.report_cash_expenses()$$, '42501', 'a manager without reports: no report of expenses');
select tests.assert(tests.affected('update public.organization_settings set manager_cash_expenses = true') = 0,
  'a manager does not change the setting');
select tests.logout();

select tests.login_as(current_setting('t.owner')::uuid);
update public.organization_settings set manager_cash_expenses = true;
select tests.assert(
  (select count(*) = 1 from public.audit_log where entity = 'settings' and changes ? 'manager_cash_expenses'),
  'the setting is in the audit log');
select tests.logout();

select tests.login_as(current_setting('t.m1')::uuid);
insert into public.account_operations (kind, amount, method, category_id, comment)
values ('expense', 3000, 'cash', tests.cat(current_setting('t.org')::bigint, 'other'), 'water m1');
select tests.assert(
  (select sales_id = current_setting('t.m1_id')::bigint and shift_id = current_setting('t.m1_shift')::bigint from public.account_operations where comment = 'water m1'),
  'allowed: the manager records an expense in their shift');
select tests.assert(public.cash_shift_expected(current_setting('t.m1_shift')::bigint) = 7000, 'the manager''s expected cash');
select tests.assert((select count(*) = 1 from public.account_operations where kind = 'expense'),
  'the manager sees their own expense only');
select tests.assert(tests.affected('delete from public.account_operations where comment = ''water m1''') = 0,
  'a manager does not cancel an expense');
select tests.assert(tests.affected('update public.account_operations set comment = ''x'' where comment = ''water m1''') = 0,
  'a manager does not change an expense');
select tests.throws($$select public.record_payroll_payout(null, 1, '2026-08-01', 100)$$, '42501', 'a manager gives no payout');
select tests.throws($$select public.record_lab_payment(1, '2026-08-01', 100)$$, '42501', 'a manager pays no lab');
select tests.logout();

-- The manager with the «Отчёты» right sees every expense
select tests.login_as(current_setting('t.owner')::uuid);
select public.save_access_rights(current_setting('t.m2_id')::bigint, '{"reports": {"view": "all"}}'::jsonb);
update public.organization_settings set manager_cash_expenses = false;
select tests.logout();
select tests.login_as(current_setting('t.m2')::uuid);
select tests.assert((select count(*) = 3 from public.account_operations where kind = 'expense'), 'a manager with reports sees every expense');
select tests.assert(jsonb_array_length(public.report_cash_expenses()) = 3, 'and the report of expenses');
select tests.throws(format($q$insert into public.account_operations (kind, amount, method, category_id) values ('expense', 1000, 'cash', %s)$q$,
  tests.cat(current_setting('t.org')::bigint, 'other')),
  '42501', 'the setting off again: no expense');
select tests.logout();

-- The integrator sees nothing
select tests.login_as(current_setting('t.int')::uuid);
select tests.assert((select count(*) = 0 from public.account_operations), 'the integrator sees no operation');
select tests.assert((select count(*) = 0 from public.account_operations_summary), 'nor the journal');
select tests.throws(format($q$insert into public.account_operations (kind, amount, method, category_id) values ('expense', 1000, 'cash', %s)$q$,
  tests.cat(current_setting('t.org')::bigint, 'other')),
  '42501', 'the integrator records no expense');
select tests.assert((select count(*) = 0 from public.lab_payments), 'the integrator sees no lab payment');
select tests.logout();

--
-- Payroll: a payout from the cash desk, a payout by bank transfer
--
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.doctors (name, specialty) values ('Терапевт', 'терапевт'), ('Ортопед', 'ортопед');
select set_config('t.a', (select id from public.doctors where name = 'Терапевт')::text, true);
select set_config('t.b', (select id from public.doctors where name = 'Ортопед')::text, true);
select set_config('t.pay1', (public.record_payroll_payout(current_setting('t.a')::bigint, null, tests.month_start(), 40000,
  null, 'аванс', true, 'cash'))::text, true);
select tests.assert(
  (select a.kind = 'payout' and a.amount = 40000 and a.note = 'аванс' and a.month = tests.month_start()
     and a.account_operation_id = (current_setting('t.pay1')::jsonb ->> 'operation_id')::bigint
   from public.payroll_adjustments a where a.id = (current_setting('t.pay1')::jsonb ->> 'adjustment_id')::bigint),
  'the payout is linked to its operation');
select tests.assert(
  (select o.kind = 'expense' and o.amount = 40000 and o.method = 'cash' and o.category_id = tests.cat(current_setting('t.org')::bigint, 'salary')
     and o.shift_id = current_setting('t.shift')::bigint and o.comment like 'Зарплата: Терапевт, %аванс'
   from public.account_operations o where o.id = (current_setting('t.pay1')::jsonb ->> 'operation_id')::bigint),
  'the expense Зарплата in the open shift');
select tests.assert(
  (select payroll_adjustment_id = (current_setting('t.pay1')::jsonb ->> 'adjustment_id')::bigint
   from public.account_operations_summary where id = (current_setting('t.pay1')::jsonb ->> 'operation_id')::bigint),
  'the journal knows the payout');
select tests.assert(public.cash_shift_expected(current_setting('t.shift')::bigint) = 50000 + 30000 - 20000 - 40000,
  'the payout lowers the expected cash');
select tests.assert(
  (select (e ->> 'paid_out')::bigint = 40000 from jsonb_array_elements(public.payroll_month(tests.month_start()) -> 'employees') e
   where e ->> 'name' = 'Терапевт'),
  'the payroll counts the payout');
-- Without the cash desk (bank transfer)
select set_config('t.pay2', (public.record_payroll_payout(current_setting('t.a')::bigint, null, tests.month_start(), 25000,
  null, 'перевод'))::text, true);
select tests.assert(
  (select account_operation_id is null from public.payroll_adjustments where id = (current_setting('t.pay2')::jsonb ->> 'adjustment_id')::bigint),
  'a payout by bank transfer has no operation');
-- The linked side does not change its amount
select tests.throws(format('update public.payroll_adjustments set amount = 1 where id = %s', current_setting('t.pay1')::jsonb ->> 'adjustment_id'),
  '22023', 'the amount of a cash payout changes in the cash desk only');
update public.payroll_adjustments set note = 'аванс за неделю' where id = (current_setting('t.pay1')::jsonb ->> 'adjustment_id')::bigint;
-- The operation moved to yesterday: the payout day follows
update public.account_operations set occurred_at = now() - interval '1 day'
where id = (current_setting('t.pay1')::jsonb ->> 'operation_id')::bigint;
select tests.assert(
  (select occurred_on = tests.day_of(now() - interval '1 day')
   from public.payroll_adjustments where id = (current_setting('t.pay1')::jsonb ->> 'adjustment_id')::bigint),
  'the payout day follows its operation');
-- A payout linked by hand must be a salary expense of the same amount
select tests.throws(format('insert into public.payroll_adjustments (doctor_id, month, kind, amount, account_operation_id) values (%s, %L, ''payout'', 999, %s)',
  current_setting('t.a'), tests.month_start(), tests.op('rent cash')),
  '22023', 'a payout is linked to a salary expense only');
select tests.throws(format('insert into public.payroll_adjustments (doctor_id, month, kind, amount, account_operation_id) values (%s, %L, ''bonus'', 20000, %s)',
  current_setting('t.a'), tests.month_start(), tests.op('rent cash')),
  '22023', 'only a payout is linked');
-- Cancelling the operation deletes the payout
select set_config('t.pay3', (public.record_payroll_payout(current_setting('t.b')::bigint, null, tests.month_start(), 10000,
  null, null, true, 'card'))::text, true);
delete from public.account_operations where id = (current_setting('t.pay3')::jsonb ->> 'operation_id')::bigint;
select tests.assert(
  (select count(*) = 0 from public.payroll_adjustments where id = (current_setting('t.pay3')::jsonb ->> 'adjustment_id')::bigint),
  'cancelling the expense deletes its payout');
-- Deleting the payout cancels the operation
delete from public.payroll_adjustments where id = (current_setting('t.pay1')::jsonb ->> 'adjustment_id')::bigint;
select tests.assert(not tests.op_exists((current_setting('t.pay1')::jsonb ->> 'operation_id')::bigint),
  'deleting the payout cancels its expense');
select tests.assert(public.cash_shift_expected(current_setting('t.shift')::bigint) = 50000 + 30000 - 20000,
  'the expected cash is back');
-- A closed month still takes payouts, from the cash desk too
select public.close_payroll_month((tests.month_start() - interval '1 month')::date);
select set_config('t.pay4', (public.record_payroll_payout(current_setting('t.b')::bigint, null,
  (tests.month_start() - interval '1 month')::date, 5000, null, null, true, 'cash'))::text, true);
select tests.assert((current_setting('t.pay4')::jsonb ->> 'operation_id') is not null, 'a closed month takes a cash payout');
-- A cash payout needs an open shift
select public.close_cash_shift(current_setting('t.shift')::bigint, 25000);
select tests.throws(format($q$select public.record_payroll_payout(%s, null, %L, 1000, null, null, true, 'cash')$q$,
  current_setting('t.b'), tests.month_start()), '22023', 'cash from the till needs an open shift');
select public.record_payroll_payout(current_setting('t.b')::bigint, null, tests.month_start(), 1000, null, 'карта', true, 'bank_transfer');
select tests.assert(
  (select count(*) = 1 from public.account_operations where kind = 'expense' and method = 'bank_transfer' and shift_id is null),
  'a transfer from the cash desk goes without a shift');
select public.open_cash_shift(0);
select set_config('t.shift2', (select id from public.cash_shifts where sales_id = current_setting('t.owner_id')::bigint and closed_at is null)::text, true);
select tests.logout();

--
-- Lab payments and the settlement
--
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.labs (name) values ('Дентал-Арт'), ('Своя');
select set_config('t.lab', (select id from public.labs where name = 'Дентал-Арт')::text, true);
select set_config('t.lab2', (select id from public.labs where name = 'Своя')::text, true);
insert into public.lab_orders (patient_id, lab_id) values (current_setting('t.p')::bigint, current_setting('t.lab')::bigint);
select set_config('t.order', (select id from public.lab_orders where lab_id = current_setting('t.lab')::bigint)::text, true);
insert into public.lab_order_items (order_id, work_type_id, qty)
values (current_setting('t.order')::bigint, (select id from public.lab_work_types where name = 'Коронка металлокерамическая'), 2);
update public.lab_orders set status = 'ready' where id = current_setting('t.order')::bigint;
-- Owed 36 000 this month; paid 10 000 from the cash desk, 20 000 by transfer
select set_config('t.lp1', (public.record_lab_payment(current_setting('t.lab')::bigint, tests.month_start(), 10000, 'cash', null, 'наличными', true))::text, true);
select set_config('t.lp2', (public.record_lab_payment(current_setting('t.lab')::bigint, tests.month_start(), 20000, 'bank_transfer', null, 'счёт 15'))::text, true);
select tests.assert(
  (select l.account_operation_id = (current_setting('t.lp1')::jsonb ->> 'operation_id')::bigint and l.method = 'cash'
     and l.created_by = current_setting('t.owner_id')::bigint and l.comment = 'наличными'
   from public.lab_payments l where l.id = (current_setting('t.lp1')::jsonb ->> 'payment_id')::bigint),
  'the lab payment is linked to its operation');
select tests.assert(
  (select o.category_id = tests.cat(current_setting('t.org')::bigint, 'lab') and o.amount = 10000 and o.shift_id = current_setting('t.shift2')::bigint
     and o.comment like 'Лаборатория: Дентал-Арт, %'
   from public.account_operations o where o.id = (current_setting('t.lp1')::jsonb ->> 'operation_id')::bigint),
  'the expense Лаборатория in the open shift');
select tests.assert(public.cash_shift_expected(current_setting('t.shift2')::bigint) = -10000, 'the lab payment leaves the till');
select tests.assert(
  (select account_operation_id is null and method = 'bank_transfer' from public.lab_payments where id = (current_setting('t.lp2')::jsonb ->> 'payment_id')::bigint),
  'a transfer to the lab without the cash desk');
select tests.assert(
  (select amount = 36000 and paid = 30000 and balance = 6000 and total_balance = 6000 and orders_count = 1
   from public.report_lab_settlement(tests.month_start()) where lab_id = current_setting('t.lab')::bigint),
  'the settlement: owed, paid, balance per lab');
-- A payment of the own lab without works: listed with a negative balance
insert into public.lab_payments (lab_id, month, amount, method) values (current_setting('t.lab2')::bigint, tests.month_start(), 5000, 'card');
select tests.assert(
  (select amount = 0 and paid = 5000 and balance = -5000 from public.report_lab_settlement(tests.month_start()) where lab_id = current_setting('t.lab2')::bigint),
  'a lab paid ahead');
-- Next month: nothing owed, the old balance carried
select tests.assert(
  (select amount = 0 and paid = 0 and total_balance = 6000
   from public.report_lab_settlement((tests.month_start() + interval '1 month')::date) where lab_id = current_setting('t.lab')::bigint),
  'the balance carries over to the next month');
select tests.assert(
  (select lab_name = 'Дентал-Арт' and created_by_name is not null from public.lab_payments_summary where id = (current_setting('t.lp1')::jsonb ->> 'payment_id')::bigint),
  'lab payments with the names');
-- Linked: the amount changes in the cash desk only; the method follows the operation
select tests.throws(format('update public.lab_payments set amount = 1 where id = %s', current_setting('t.lp1')::jsonb ->> 'payment_id'),
  '22023', 'the amount of a cash lab payment is locked');
update public.account_operations set method = 'card' where id = (current_setting('t.lp1')::jsonb ->> 'operation_id')::bigint;
select tests.assert(
  (select method = 'card' from public.lab_payments where id = (current_setting('t.lp1')::jsonb ->> 'payment_id')::bigint),
  'the method of the lab payment follows its operation');
select tests.throws(format('update public.account_operations set category_id = %s where id = %s',
  tests.cat(current_setting('t.org')::bigint, 'rent'), current_setting('t.lp1')::jsonb ->> 'operation_id'),
  '22023', 'a linked expense keeps its category');
select tests.throws(format('insert into public.lab_payments (lab_id, month, amount, account_operation_id) values (%s, %L, 20000, %s)',
  current_setting('t.lab'), tests.month_start(), tests.op('rent cash')),
  '22023', 'a lab payment is linked to a lab expense only');
-- Deleting either side
delete from public.lab_payments where id = (current_setting('t.lp1')::jsonb ->> 'payment_id')::bigint;
select tests.assert(not tests.op_exists((current_setting('t.lp1')::jsonb ->> 'operation_id')::bigint),
  'deleting the lab payment cancels its expense');
select set_config('t.lp3', (public.record_lab_payment(current_setting('t.lab')::bigint, tests.month_start(), 6000, 'kaspi_transfer', null, null, true))::text, true);
delete from public.account_operations where id = (current_setting('t.lp3')::jsonb ->> 'operation_id')::bigint;
select tests.assert(
  (select count(*) = 0 from public.lab_payments where id = (current_setting('t.lp3')::jsonb ->> 'payment_id')::bigint),
  'cancelling the expense deletes the lab payment');
select tests.assert(
  (select count(*) = 1 from public.audit_log where entity = 'lab_payment' and action = 'create' and (changes -> 'amount' ->> 1)::bigint = 20000),
  'lab payments are in the audit log');
select tests.throws(format('delete from public.labs where id = %s', current_setting('t.lab2')), '23503', 'a paid lab is not deleted');
select tests.logout();

-- The head pays too; the manager reads no lab payment
select tests.login_as(current_setting('t.head')::uuid);
select public.record_lab_payment(current_setting('t.lab')::bigint, tests.month_start(), 1000, 'bank_transfer');
select tests.assert((select count(*) = 3 from public.lab_payments), 'the head reads the lab payments');
select tests.logout();
select tests.login_as(current_setting('t.m2')::uuid);
select tests.assert((select count(*) = 0 from public.lab_payments), 'a manager reads no lab payment');
select tests.throws(format('insert into public.lab_payments (lab_id, month, amount) values (%s, %L, 100)', current_setting('t.lab'), tests.month_start()),
  '42501', 'a manager adds no lab payment');
select tests.throws($$select * from public.report_lab_settlement(current_date)$$, '42501', 'a manager sees no settlement');
select tests.logout();

--
-- The plan item doctor: saved on the item, copied with the plan, used by
-- the payroll
--
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.deals (patient_id, name) values (current_setting('t.p')::bigint, 'plan deal');
insert into public.treatment_plans (deal_id, name, doctor_id)
values ((select id from public.deals where name = 'plan deal'), 'Лечение', current_setting('t.a')::bigint);
select set_config('t.plan', (select id from public.treatment_plans where name = 'Лечение')::text, true);
insert into public.treatment_plan_items (plan_id, stage_no, name, quantity, unit_price, position) values
  (current_setting('t.plan')::bigint, 1, 'Пломба', 1, 30000, 0),
  (current_setting('t.plan')::bigint, 1, 'Коронка', 1, 100000, 1);
-- The editor sets the doctor of one item (else: the stage's, the plan's)
update public.treatment_plan_items set doctor_id = current_setting('t.b')::bigint where plan_id = current_setting('t.plan')::bigint and name = 'Коронка';
select tests.assert(
  (select doctor_id = current_setting('t.b')::bigint from public.treatment_plan_items where plan_id = current_setting('t.plan')::bigint and name = 'Коронка'),
  'the item doctor is saved');
select set_config('t.copy', public.duplicate_treatment_plan(current_setting('t.plan')::bigint)::text, true);
select tests.assert(
  (select doctor_id = current_setting('t.b')::bigint from public.treatment_plan_items
   where plan_id = current_setting('t.copy')::bigint and name = 'Коронка'),
  'a duplicated plan keeps the item doctor');
insert into public.payroll_schemes (doctor_id, effective_from, percent) values
  (current_setting('t.a')::bigint, '2020-01-01', 10), (current_setting('t.b')::bigint, '2020-01-01', 20);
update public.treatment_plan_items set done = true where plan_id = current_setting('t.plan')::bigint;
select tests.assert(
  (select string_agg((e ->> 'name') || ':' || (l ->> 'service_name') || ':' || (l ->> 'accrued'), ',' order by e ->> 'name')
   from jsonb_array_elements(public.payroll_month(tests.month_start()) -> 'employees') e,
     jsonb_array_elements(e -> 'lines') l
   where l ->> 'source' = 'plan_item') = 'Ортопед:Коронка:20000,Терапевт:Пломба:3000',
  'the payroll pays the item doctor, the plan doctor for the rest');
select tests.logout();

--
-- Clinic isolation
--
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert((select count(*) = 0 from public.account_operations), 'another clinic sees no expense');
select tests.assert((select count(*) = 0 from public.lab_payments), 'nor lab payments');
select tests.assert((select count(*) = 5 from public.cash_expense_categories), 'only its own categories');
select tests.assert(jsonb_array_length(public.report_cash_expenses()) = 0, 'an empty report of expenses');
select tests.throws(format('select public.record_lab_payment(%s, %L, 100)', current_setting('t.lab'), tests.month_start()),
  'P0002', 'a lab of another clinic');
select tests.throws(format('select public.record_payroll_payout(%s, null, %L, 100)', current_setting('t.a'), tests.month_start()),
  'P0002', 'a doctor of another clinic');
select tests.throws(format($q$insert into public.account_operations (kind, amount, method, category_id) values ('expense', 1000, 'cash', %s)$q$,
  tests.cat(current_setting('t.org')::bigint, 'rent')),
  '22023', 'a category of another clinic');
select tests.logout();

-- Deleting a clinic takes its expenses, categories and lab payments
delete from public.organizations where id = current_setting('t.org')::bigint;
select tests.assert(
  (select count(*) = 0 from public.cash_expense_categories where organization_id = current_setting('t.org')::bigint)
  and (select count(*) = 0 from public.lab_payments where organization_id = current_setting('t.org')::bigint),
  'a deleted clinic leaves nothing');

rollback;

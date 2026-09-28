--
-- Payments, deposits and the cash desk (stage 36): the patient ledger
-- (payments, deposits, payments from the deposit, refunds, corrections),
-- mixed payments and the change, the balances and the debt, deal payments
-- and deals.paid_amount in sync both ways, the paid amount of a plan, cash
-- shifts (expected against counted), the report by method, rights per
-- role, the audit log, patient merge, clinic isolation.
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

-- Security definer helpers: the numbers whoever is logged in
create function tests.account(target bigint) returns public.patient_accounts language sql security definer as $$
  select * from public.patient_accounts where id = target
$$;
create function tests.paid_amount(target bigint) returns bigint language sql security definer as $$
  select paid_amount from public.deals where id = target
$$;
create function tests.deal_payments_sum(target bigint) returns bigint language sql security definer as $$
  select coalesce(sum(amount), 0)::bigint from public.deal_payments where deal_id = target
$$;
create function tests.ledger_count(target bigint) returns bigint language sql security definer as $$
  select count(*) from public.account_operations where patient_id = target
$$;
create function tests.op(op_comment text) returns bigint language sql security definer as $$
  select id from public.account_operations where comment = op_comment
$$;
grant execute on all functions in schema tests to authenticated;

-- The clinic: a service with a price, a doctor, two patients
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.services (name, code, price, position) values ('Лечение кариеса', 'TER-01', 25000, 0);
insert into public.doctors (name) values ('Ахметова Айгуль');
insert into public.branches (name, position) values ('Филиал Достык', 0);
insert into public.patients (first_name, last_name) values ('Асель', 'Нурланова'), ('Ерлан', 'Омаров');
insert into public.deals (patient_id, name, sales_id)
select p.id, d.name, current_setting('t.m1_id')::bigint
from public.patients p, (values ('implant'), ('visit')) as d(name)
where p.first_name = 'Асель';
insert into public.deals (patient_id, name, sales_id)
select id, 'erlan', current_setting('t.m1_id')::bigint from public.patients where first_name = 'Ерлан';
select set_config('t.p', (select id from public.patients where first_name = 'Асель')::text, true);
select set_config('t.e', (select id from public.patients where first_name = 'Ерлан')::text, true);
select set_config('t.d1', (select id from public.deals where name = 'implant')::text, true);
select set_config('t.d2', (select id from public.deals where name = 'visit')::text, true);
select set_config('t.de', (select id from public.deals where name = 'erlan')::text, true);
select set_config('t.branch', (select id from public.branches where name = 'Филиал Достык')::text, true);
-- The plan of the deal: 200 000 + 100 000, agreed
insert into public.treatment_plans (deal_id, name) values (current_setting('t.d1')::bigint, 'Имплантация');
select set_config('t.plan', (select id from public.treatment_plans where name = 'Имплантация')::text, true);
insert into public.treatment_plan_items (plan_id, stage_no, name, quantity, unit_price, position) values
  (current_setting('t.plan')::bigint, 1, 'Имплант', 1, 200000, 0),
  (current_setting('t.plan')::bigint, 2, 'Коронка', 1, 100000, 1);
update public.treatment_plans set status = 'agreed' where id = current_setting('t.plan')::bigint;
select set_config('t.item1', (select id from public.treatment_plan_items where name = 'Имплант')::text, true);
select set_config('t.item2', (select id from public.treatment_plan_items where name = 'Коронка')::text, true);
select tests.logout();

--
-- A fresh account
--
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(
  (select deposit = 0 and paid = 0 and charged = 0 and debt = 0 and balance = 0 and operations_count = 0
   from public.patient_accounts where id = current_setting('t.p')::bigint),
  'a new patient: an empty account');

--
-- Cash shift: the cashier opens it with the cash at start
--
select public.open_cash_shift(10000, current_setting('t.branch')::bigint);
select set_config('t.shift', (select id from public.cash_shifts where sales_id = current_setting('t.m1_id')::bigint)::text, true);
select tests.throws('select public.open_cash_shift(0)', '23505', 'one open shift per cashier');
select tests.throws('select public.open_cash_shift(-5)', '22023', 'no negative cash at start');

--
-- Payment in cash with change: the deal payment and the paid amount follow
--
insert into public.account_operations (patient_id, kind, amount, method, cash_received, deal_id, plan_id, plan_item_ids, comment)
values (current_setting('t.p')::bigint, 'payment', 50000, 'cash', 60000, current_setting('t.d1')::bigint,
  current_setting('t.plan')::bigint, array[current_setting('t.item1')::bigint], 'cash 50k');
select tests.assert(
  (select o.sales_id = current_setting('t.m1_id')::bigint and o.shift_id = current_setting('t.shift')::bigint
     and o.branch_id = current_setting('t.branch')::bigint and o.source = 'cash_desk' and o.cash_received = 60000
     and o.paid_delta = 50000 and o.deposit_delta = 0 and o.till_delta = 50000 and o.deal_payment_id is not null
   from public.account_operations o where o.comment = 'cash 50k'),
  'a payment: the cashier, the shift and its branch, the effect, its deal payment');
select tests.assert(
  (select p.amount = 50000 and p.kind = 'payment' and p.comment = 'cash 50k' and p.sales_id = current_setting('t.m1_id')::bigint
   from public.deal_payments p where p.id = (select deal_payment_id from public.account_operations where comment = 'cash 50k')),
  'the deal payment of the operation');
select tests.assert(tests.paid_amount(current_setting('t.d1')::bigint) = 50000, 'deals.paid_amount follows the ledger');
select tests.throws(
  format($q$insert into public.account_operations (patient_id, kind, amount, method, cash_received) values (%s, 'payment', 1000, 'cash', 500)$q$,
    current_setting('t.p')),
  '22023', 'less cash received than due');

-- Mixed payment: card + Kaspi QR (+ cash) whose parts make the amount
insert into public.account_operations (patient_id, kind, amount, method, parts, cash_received, deal_id, comment)
values (current_setting('t.p')::bigint, 'payment', 70000, 'mixed',
  '[{"method": "card", "amount": 40000}, {"method": "kaspi_qr", "amount": 20000}, {"method": "cash", "amount": 10000}]',
  20000, current_setting('t.d1')::bigint, 'mixed 70k');
select tests.assert(
  (select private.operation_method_amount(method, parts, amount, 'card') = 40000
     and private.operation_method_amount(method, parts, amount, 'cash') = 10000
   from public.account_operations where comment = 'mixed 70k'),
  'a mixed payment splits by method');
select tests.throws(
  format($q$insert into public.account_operations (patient_id, kind, amount, method, parts) values (%s, 'payment', 70000, 'mixed', '[{"method": "card", "amount": 40000}, {"method": "cash", "amount": 20000}]')$q$,
    current_setting('t.p')),
  '22023', 'the parts must make the amount');
select tests.throws(
  format($q$insert into public.account_operations (patient_id, kind, amount, method, parts) values (%s, 'payment', 40000, 'mixed', '[{"method": "card", "amount": 40000}]')$q$,
    current_setting('t.p')),
  '22023', 'a mixed payment has two methods or more');
select tests.throws(
  format($q$insert into public.account_operations (patient_id, kind, amount, method, parts) values (%s, 'payment', 2000, 'mixed', '[{"method": "deposit", "amount": 1000}, {"method": "cash", "amount": 1000}]')$q$,
    current_setting('t.p')),
  '22023', 'the deposit is no part of a mixed payment');
select tests.assert(tests.paid_amount(current_setting('t.d1')::bigint) = 120000, 'mixed payment: paid 120 000');

-- Deposit top-up by Kaspi transfer: money on the balance, no deal payment
insert into public.account_operations (patient_id, kind, amount, method, comment)
values (current_setting('t.p')::bigint, 'deposit', 100000, 'kaspi_transfer', 'deposit 100k');
select tests.assert(
  (select deposit_delta = 100000 and paid_delta = 0 and till_delta = 100000 and deal_payment_id is null and account = 'deposit'
   from public.account_operations where comment = 'deposit 100k'),
  'a deposit: on the balance, not a payment for services');
select tests.assert(
  (select deposit = 100000 and paid = 120000 and charged = 0 and debt = 0 and advance = 120000 and balance = 220000
   from public.patient_accounts where id = current_setting('t.p')::bigint),
  'balance = deposit + paid − services done');

-- Payment from the deposit: the deposit goes down, the deal is paid
insert into public.account_operations (patient_id, kind, amount, deal_id, plan_id, comment)
values (current_setting('t.p')::bigint, 'deposit_payment', 60000, current_setting('t.d1')::bigint, current_setting('t.plan')::bigint, 'from deposit');
select tests.assert(
  (select method = 'deposit' and deposit_delta = -60000 and paid_delta = 60000 and till_delta = 0
   from public.account_operations where comment = 'from deposit'),
  'a payment from the deposit: no money in the till');
select tests.assert(tests.paid_amount(current_setting('t.d1')::bigint) = 180000, 'the deposit pays the deal');
select tests.throws(
  format($q$insert into public.account_operations (patient_id, kind, amount) values (%s, 'deposit_payment', 50000)$q$, current_setting('t.p')),
  '22023', 'no payment from the deposit beyond it (40 000 left)');
select tests.assert((select deposit from public.patient_accounts where id = current_setting('t.p')::bigint) = 40000, 'deposit left: 40 000');

--
-- The paid amount of the plan (stage 34 reads it): operations of the plan
-- and those of its deal without a plan (main plan)
--
select tests.assert(public.plan_paid_amount(current_setting('t.plan')::bigint) = 180000, 'plan_paid_amount: 50 000 + 70 000 + 60 000');
select tests.assert(
  (select total_amount = 300000 and paid_amount = 180000 and due_amount = 120000 and done_amount = 0 and debt_amount = 0
   from public.treatment_plan_payments where id = current_setting('t.plan')::bigint),
  'treatment_plan_payments: total, paid, due');

--
-- Debt: done items and a completed visit with a price
--
update public.treatment_plan_items set done = true where plan_id = current_setting('t.plan')::bigint;
select tests.assert(
  (select charged = 300000 and paid = 180000 and debt = 120000 and deposit = 40000 and balance = -80000
   from public.patient_accounts where id = current_setting('t.p')::bigint),
  'all the plan done: debt 120 000, the deposit is still there');
select tests.assert(
  (select debt_amount = 120000 from public.treatment_plan_payments where id = current_setting('t.plan')::bigint),
  'the plan owes 120 000');
select tests.logout();

select tests.login_as(current_setting('t.owner')::uuid);
insert into public.visits (patient_id, deal_id, doctor_id, service_id, starts_at, ends_at)
select current_setting('t.p')::bigint, current_setting('t.d2')::bigint, (select id from public.doctors),
  (select id from public.services where code = 'TER-01'), now() - interval '2 days', now() - interval '2 days' + interval '1 hour';
update public.visits set status = 'completed' where deal_id = current_setting('t.d2')::bigint;
select set_config('t.visit', (select id from public.visits where deal_id = current_setting('t.d2')::bigint)::text, true);
select tests.assert(
  (select charged = 325000 and debt = 145000 and last_visit_at is not null
   from public.patient_accounts where id = current_setting('t.p')::bigint),
  'a completed visit with a priced service adds to the services done');
select tests.assert(
  (select count(*) = 1 from public.patient_accounts where debt > 0 and organization_id = current_setting('t.org')::bigint),
  'the debtors list: patients with a debt');
select tests.logout();

-- The visit is paid in card: the visit's deal is paid
select tests.login_as(current_setting('t.m1')::uuid);
insert into public.account_operations (patient_id, kind, amount, method, visit_id, comment)
values (current_setting('t.p')::bigint, 'payment', 25000, 'card', current_setting('t.visit')::bigint, 'visit card');
select tests.assert(
  (select deal_id = current_setting('t.d2')::bigint from public.account_operations where comment = 'visit card'),
  'a payment for a visit goes to the visit''s deal');
select tests.assert(tests.paid_amount(current_setting('t.d2')::bigint) = 25000, 'the visit deal is paid');
select tests.throws(
  format($q$insert into public.account_operations (patient_id, kind, amount, method, visit_id) values (%s, 'payment', 100, 'cash', %s)$q$,
    current_setting('t.e'), current_setting('t.visit')),
  '22023', 'a visit of another patient');
select tests.throws(
  format($q$insert into public.account_operations (patient_id, kind, amount, method, deal_id) values (%s, 'payment', 100, 'cash', %s)$q$,
    current_setting('t.e'), current_setting('t.d1')),
  '22023', 'a deal of another patient');
select tests.throws(
  format($q$insert into public.account_operations (patient_id, kind, amount, method, plan_id, plan_item_ids) values (%s, 'payment', 100, 'cash', %s, array[999999]::bigint[])$q$,
    current_setting('t.p'), current_setting('t.plan')),
  '22023', 'plan items of another plan');

--
-- Rights: a manager (the cashier) neither refunds nor corrects, nor
-- changes or cancels operations
--
select tests.throws(
  format($q$insert into public.account_operations (patient_id, kind, account, amount, method, deal_id) values (%s, 'refund', 'services', 1000, 'cash', %s)$q$,
    current_setting('t.p'), current_setting('t.d1')),
  '42501', 'a manager does not refund');
select tests.throws(
  format($q$insert into public.account_operations (patient_id, kind, account, amount) values (%s, 'correction', 'deposit', 1000)$q$, current_setting('t.p')),
  '42501', 'a manager does not correct');
select tests.assert(tests.affected('delete from public.account_operations') = 0, 'a manager does not cancel operations');
select tests.assert(tests.affected('update public.account_operations set comment = ''x''') = 0, 'a manager does not change operations');
select tests.throws(
  format('delete from public.deal_payments where deal_id = %s', current_setting('t.d1')),
  '42501', 'a manager does not delete a deal payment either');
-- The cashier sees their shift only, and no report
select tests.assert(tests.count('select * from public.cash_shifts') = 1, 'a cashier sees their shift');
select tests.throws('select public.report_cash_methods()', '42501', 'a cashier has no report');
select tests.logout();

select tests.login_as(current_setting('t.m2')::uuid);
select tests.assert(tests.count('select * from public.cash_shifts') = 0, 'another cashier does not see the shift');
select tests.throws(format('select public.close_cash_shift(%s, 0)', current_setting('t.shift')), '42501', 'nor closes it');
-- The patient card: a cashier sees the account of the patients
select tests.assert(tests.count(format('select * from public.account_operations where patient_id = %s', current_setting('t.p'))) = 5,
  'a cashier sees the operations of a patient');
select tests.logout();

select tests.login_as(current_setting('t.owner')::uuid);
select public.save_access_rights(current_setting('t.m2_id')::bigint, '{"reports": {"view": "all"}}'::jsonb);
select tests.logout();
select tests.login_as(current_setting('t.m2')::uuid);
select tests.assert(tests.count('select * from public.cash_shifts') = 1, 'with the reports right: every shift');
select tests.logout();

select tests.login_as(current_setting('t.int')::uuid);
select tests.assert(tests.count('select * from public.account_operations') = 0, 'the integrator sees no money');
select tests.throws(
  format($q$insert into public.account_operations (patient_id, kind, amount, method) values (%s, 'payment', 100, 'cash')$q$, current_setting('t.p')),
  '42501', 'the integrator accepts no payment');
select tests.throws('select public.open_cash_shift(0)', '42501', 'the integrator opens no shift');
select tests.logout();

--
-- Refunds (head): in cash from the paid services, back to the deposit,
-- from the deposit
--
select tests.login_as(current_setting('t.head')::uuid);
insert into public.account_operations (patient_id, kind, account, amount, method, deal_id, comment)
values (current_setting('t.p')::bigint, 'refund', 'services', 10000, 'cash', current_setting('t.d1')::bigint, 'refund cash');
select tests.assert(
  (select paid_delta = -10000 and till_delta = -10000 and deposit_delta = 0 from public.account_operations where comment = 'refund cash'),
  'a cash refund: out of the till, off the paid services');
select tests.assert(
  (select p.amount = -10000 from public.deal_payments p where p.id = (select deal_payment_id from public.account_operations where comment = 'refund cash')),
  'a refund is a negative deal payment');
select tests.assert(tests.paid_amount(current_setting('t.d1')::bigint) = 170000, 'paid amount after the refund');
insert into public.account_operations (patient_id, kind, account, amount, method, deal_id, comment)
values (current_setting('t.p')::bigint, 'refund', 'services', 20000, 'deposit', current_setting('t.d1')::bigint, 'refund to deposit');
select tests.assert(
  (select paid_delta = -20000 and deposit_delta = 20000 and till_delta = 0 from public.account_operations where comment = 'refund to deposit'),
  'a refund to the deposit: no money moves');
select tests.assert(tests.paid_amount(current_setting('t.d1')::bigint) = 150000, 'paid 150 000');
insert into public.account_operations (patient_id, kind, account, amount, method, comment)
values (current_setting('t.p')::bigint, 'refund', 'deposit', 15000, 'kaspi_transfer', 'refund deposit');
select tests.assert(
  (select deposit = 45000 from public.patient_accounts where id = current_setting('t.p')::bigint),
  'deposit 40 000 + 20 000 − 15 000');
select tests.throws(
  format($q$insert into public.account_operations (patient_id, kind, account, amount, method, deal_id) values (%s, 'refund', 'services', 500000, 'cash', %s)$q$,
    current_setting('t.p'), current_setting('t.d1')),
  '22023', 'no refund beyond what was paid');
select tests.throws(
  format($q$insert into public.account_operations (patient_id, kind, account, amount, method) values (%s, 'refund', 'deposit', 100000, 'cash')$q$, current_setting('t.p')),
  '22023', 'no refund beyond the deposit');
select tests.throws(
  format($q$insert into public.account_operations (patient_id, kind, account, amount) values (%s, 'correction', 'deposit', 1000)$q$, current_setting('t.p')),
  '42501', 'the head does not correct');
-- The head changes the comment and the time; the deal payment follows
update public.account_operations set comment = 'cash 50k (чек 12)' where comment = 'cash 50k';
select tests.assert(
  (select p.comment = 'cash 50k (чек 12)' from public.deal_payments p
   where p.id = (select deal_payment_id from public.account_operations where comment = 'cash 50k (чек 12)')),
  'a new comment reaches the deal payment');
select tests.throws($q$update public.account_operations set method = 'cash' where comment = 'from deposit'$q$, '22023',
  'a payment from the deposit keeps its method');
select tests.logout();

--
-- Correction (owner): signed, on the deposit or the paid services
--
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.account_operations (patient_id, kind, account, amount, comment)
values (current_setting('t.p')::bigint, 'correction', 'deposit', -5000, 'correction -5k');
select tests.assert(
  (select method = 'other' and deposit_delta = -5000 and till_delta = 0 from public.account_operations where comment = 'correction -5k'),
  'a correction moves no money');
insert into public.account_operations (patient_id, kind, account, amount, deal_id, comment)
values (current_setting('t.p')::bigint, 'correction', 'services', 5000, current_setting('t.d1')::bigint, 'correction +5k');
select tests.assert(tests.paid_amount(current_setting('t.d1')::bigint) = 155000, 'a correction of the services reaches the deal');
select tests.assert(
  (select deposit = 40000 and paid = 155000 + 25000 and charged = 325000 and debt = 145000
   from public.patient_accounts where id = current_setting('t.p')::bigint),
  'the account after refunds and corrections');

--
-- deal_payments written directly (old deal page, MIS, import): the ledger
-- follows; deals.paid_amount = Σ deal payments = Σ paid of the deal ledger
--
insert into public.deal_payments (deal_id, amount, paid_at, comment, kind)
values (current_setting('t.de')::bigint, 30000, current_date, 'direct', 'prepayment');
select tests.assert(
  (select o.kind = 'payment' and o.method = 'other' and o.source = 'deal' and o.amount = 30000 and o.prepayment
     and o.patient_id = current_setting('t.e')::bigint
   from public.account_operations o where o.comment = 'direct'),
  'a deal payment written directly gets its ledger row');
update public.deal_payments set amount = 35000 where comment = 'direct';
select tests.assert((select amount from public.account_operations where comment = 'direct') = 35000, 'its change follows');
select tests.assert(tests.paid_amount(current_setting('t.de')::bigint) = 35000, 'the paid amount of the deal');
delete from public.deal_payments where comment = 'direct';
select tests.assert(tests.op('direct') is null, 'its deletion takes the ledger row');
select tests.assert(tests.paid_amount(current_setting('t.de')::bigint) = 0, 'paid amount back to 0');

-- Cancelling an operation takes its deal payment
select tests.assert(tests.affected(format('delete from public.account_operations where id = %s', tests.op('visit card'))) = 1,
  'the owner cancels an operation');
select tests.assert(tests.paid_amount(current_setting('t.d2')::bigint) = 0, 'the cancelled payment leaves the deal');
-- A deposit already spent is not cancelled
select tests.throws(format('delete from public.account_operations where id = %s', tests.op('deposit 100k')), '22023',
  'a spent deposit cannot be cancelled');

select tests.assert(
  (select bool_and(d.paid_amount = coalesce((select sum(o.paid_delta) from public.account_operations o where o.deal_id = d.id), 0)
     and d.paid_amount = coalesce((select sum(p.amount) from public.deal_payments p where p.deal_id = d.id), 0))
   from public.deals d where d.organization_id = current_setting('t.org')::bigint),
  'deal payments, the ledger and deals.paid_amount agree for every deal');

-- The audit log: every operation of the cash desk, not its deal payment
select tests.assert(
  (select count(*) from public.audit_log where entity = 'account_operation' and action = 'create'
     and patient_id = current_setting('t.p')::bigint) = 10,
  'every operation of the cash desk is in the audit log');
select tests.assert(
  (select count(*) from public.audit_log where entity = 'payment' and action = 'create'
     and deal_id = current_setting('t.d1')::bigint) = 0,
  'its deal payment is not logged twice');
select tests.assert(
  (select count(*) from public.audit_log where entity = 'payment' and action = 'create' and deal_id = current_setting('t.de')::bigint) = 1,
  'a deal payment written directly is logged as a payment');

--
-- The report by method (owner): income and refunds of the till
--
select tests.assert(
  (select r ->> 'income' = '60000' and r ->> 'refunds' = '10000' and r ->> 'net' = '50000'
   from jsonb_array_elements(public.report_cash_methods()) r where r ->> 'method' = 'cash'),
  'cash: 50 000 + 10 000 (mixed) in, 10 000 out');
select tests.assert(
  (select r ->> 'income' = '100000' and r ->> 'refunds' = '15000'
   from jsonb_array_elements(public.report_cash_methods()) r where r ->> 'method' = 'kaspi_transfer'),
  'Kaspi transfer: the deposit in, its refund out');
select tests.assert(
  not exists (select 1 from jsonb_array_elements(public.report_cash_methods()) r where r ->> 'method' in ('deposit', 'mixed', 'other')),
  'no deposit, mixed or «other» line in the till report');
select tests.logout();

--
-- Closing the shift: expected = 10 000 at start + 50 000 + 10 000 cash in
-- (the head's cash refund is not in the cashier's shift)
--
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(public.cash_shift_expected(current_setting('t.shift')::bigint) = 70000, 'the cash expected in the shift');
select tests.assert(
  (public.close_cash_shift(current_setting('t.shift')::bigint, 69000, 'не хватает 1000')) ->> 'discrepancy' = '-1000',
  'closing: the discrepancy');
select tests.assert(
  (select closed_at is not null and closed_by = current_setting('t.m1_id')::bigint and expected_cash = 70000
     and counted_cash = 69000 and discrepancy = -1000 and note = 'не хватает 1000'
   from public.cash_shifts where id = current_setting('t.shift')::bigint),
  'the closed shift keeps expected, counted, discrepancy');
select tests.throws(format('select public.close_cash_shift(%s, 0)', current_setting('t.shift')), '22023', 'a shift closes once');
-- A new operation goes to no shift until one is opened
insert into public.account_operations (patient_id, kind, amount, method, comment)
values (current_setting('t.e')::bigint, 'deposit', 5000, 'cash', 'no shift');
select tests.assert((select shift_id is null from public.account_operations where comment = 'no shift'), 'no open shift: no shift');
select public.open_cash_shift(0);
select tests.logout();
select tests.assert(
  (select count(*) from public.audit_log where entity = 'cash_shift' and organization_id = current_setting('t.org')::bigint) = 3,
  'shifts are in the audit log (open, close, open)');

--
-- Patients merged: the account moves to the kept patient
--
select tests.login_as(current_setting('t.owner')::uuid);
select public.merge_patients(current_setting('t.p')::bigint, current_setting('t.e')::bigint);
select tests.assert(tests.ledger_count(current_setting('t.e')::bigint) = 0, 'no operation left on the merged patient');
select tests.assert(
  (select deposit = 45000 from public.patient_accounts where id = current_setting('t.p')::bigint),
  'the kept patient has both deposits');
select tests.logout();

--
-- Isolation: another clinic sees nothing, links to nothing
--
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.count('select * from public.account_operations') = 0, 'another clinic sees no operation');
select tests.assert(tests.count('select * from public.cash_shifts') = 0, 'nor a shift');
select tests.assert(tests.count('select * from public.patient_accounts') = 0, 'nor an account');
select tests.throws(
  format($q$insert into public.account_operations (patient_id, kind, amount, method) values (%s, 'payment', 100, 'cash')$q$, current_setting('t.p')),
  '42501', 'nor pays for a patient of another clinic');
select tests.assert(public.plan_paid_amount(current_setting('t.plan')::bigint) = 0, 'nor reads the paid amount of its plan');
select tests.throws(format('select public.close_cash_shift(%s, 0)', current_setting('t.shift')), 'P0002', 'nor closes its shift');
select tests.logout();

rollback;

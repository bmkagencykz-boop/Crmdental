--
-- Finance (stage 44): the seeded accounts, articles and method map; the
-- ДДС (totals, balances with the opening balance, transfers neutral, mixed
-- payments split, deposit_payment not cash, payouts and lab payments paid
-- from the till counted once through their operation and paid by bank
-- through their linked transaction), the drill-down, the P&L (revenue
-- recognition, refunds, materials, lab, payroll, advertising, cash-basis
-- articles, accruals, ratios), the branch filter, the model (drivers,
-- lines, scenarios, a month override, break-even, cash plan, payback, plan
-- vs fact), the rules of the transactions, rights per role, the audit log,
-- clinic isolation.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m2', tests.invite('m2@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.int', tests.invite('int@clinic.kz', current_setting('t.org')::bigint, 'integrator')::text, true);
select set_config('t.m1_id', (select id from public.sales where email = 'm1@clinic.kz')::text, true);
select set_config('t.m2_id', (select id from public.sales where email = 'm2@clinic.kz')::text, true);
select set_config('t.other', tests.sign_up('owner@second.kz', 'Другая')::text, true);
select set_config('t.other_org', tests.org_of(current_setting('t.other')::uuid)::text, true);

update public.task_rules set is_active = false;

create function tests.acc(org bigint, account_code text) returns bigint language sql security definer as $$
  select id from public.finance_accounts where organization_id = org and code = account_code
$$;
create function tests.art(org bigint, article_code text) returns bigint language sql security definer as $$
  select id from public.finance_articles where organization_id = org and code = article_code
$$;
create function tests.id_of(tbl text, col text, val text) returns bigint language plpgsql security definer as $$
declare result bigint;
begin
  execute format('select id from public.%I where %I = %L and organization_id = %s', tbl, col, val, current_setting('t.org')) into result;
  return result;
end;
$$;
-- A value of the ДДС: the article row of a period
create function tests.cf_row(report jsonb, article bigint, period date) returns bigint language sql as $$
  select coalesce((select (r ->> 'amount')::bigint from jsonb_array_elements(report -> 'rows') r
    where (r ->> 'article_id')::bigint = article and (r ->> 'period')::date = period), 0)
$$;
create function tests.cf_total(report jsonb, period date) returns jsonb language sql as $$
  select t from jsonb_array_elements(report -> 'totals') t where (t ->> 'period')::date = period
$$;
create function tests.cf_account(report jsonb, account bigint) returns jsonb language sql as $$
  select a from jsonb_array_elements(report -> 'accounts') a where (a ->> 'account_id')::bigint = account
$$;
create function tests.pnl_month(report jsonb, target date) returns jsonb language sql as $$
  select s from jsonb_array_elements(report -> 'summary') s where (s ->> 'month')::date = target
$$;
create function tests.model_month(report jsonb, idx int) returns jsonb language sql as $$
  select report -> 'months' -> idx
$$;
grant execute on all functions in schema tests to authenticated;

--
-- Seeded for every clinic
--
select tests.assert(
  (select string_agg(name || ':' || code, ',' order by position) = 'Касса:till,Kaspi:kaspi,Банк:bank'
   from public.finance_accounts where organization_id = current_setting('t.org')::bigint),
  'a new clinic has Касса, Kaspi and Банк');
select tests.assert(
  (select count(*) = 20 from public.finance_articles where organization_id = current_setting('t.org')::bigint and code is not null),
  'a new clinic has the 20 system articles');
select tests.assert(
  (select string_agg(m.method || '>' || a.code, ',' order by m.method) =
     'bank_transfer>bank,card>kaspi,cash>till,insurance>bank,kaspi_qr>kaspi,kaspi_transfer>kaspi,other>bank'
   from public.finance_method_accounts m join public.finance_accounts a on a.id = m.account_id
   where m.organization_id = current_setting('t.org')::bigint),
  'the default method map');
select tests.assert(
  (select string_agg(c.code || '>' || a.code, ',' order by c.position) =
     'salary>salary_staff,lab>lab,materials>materials,rent>rent,other>other_out'
   from public.cash_expense_categories c join public.finance_articles a on a.id = c.article_id
   where c.organization_id = current_setting('t.org')::bigint),
  'the expense categories of stage 42 are mapped to articles');
select tests.assert(
  (select count(*) = 3 from public.finance_accounts where organization_id = current_setting('t.other_org')::bigint),
  'so does the other clinic');
select tests.assert(
  (select count(*) = 0 from public.audit_log where entity in ('finance_account', 'finance_article')),
  'the seeded rows are not in the audit log');

--
-- The clinic
--
select tests.login_as(current_setting('t.owner')::uuid);
select public.save_access_rights(current_setting('t.m2_id')::bigint, '{"reports": {"view": "all"}}'::jsonb);
insert into public.branches (name, position) values ('Достык', 0), ('Абая', 1);
select set_config('t.b1', tests.id_of('branches', 'name', 'Достык')::text, true);
select set_config('t.b2', tests.id_of('branches', 'name', 'Абая')::text, true);
insert into public.chairs (name, branch_id) values ('Кресло 1', current_setting('t.b1')::bigint),
  ('Кресло 2', current_setting('t.b1')::bigint), ('Кресло 3', current_setting('t.b2')::bigint);
insert into public.services (name, code, price) values ('Пломба', 'F-1', 30000), ('Консультация', 'F-2', 10000);
select public.set_service_cost(tests.id_of('services', 'name', 'Пломба'), 5000);
insert into public.doctors (name, specialty, branch_id) values ('Терапевт', 'терапевт', current_setting('t.b1')::bigint);
select set_config('t.a', tests.id_of('doctors', 'name', 'Терапевт')::text, true);
insert into public.patients (first_name, last_name) values ('Асель', 'Нурланова');
select set_config('t.p', tests.id_of('patients', 'first_name', 'Асель')::text, true);
insert into public.deals (patient_id, name, branch_id) values (current_setting('t.p')::bigint, 'd1', current_setting('t.b1')::bigint);
select set_config('t.d', tests.id_of('deals', 'name', 'd1')::text, true);

-- Payroll: the therapist 30 % of the work, the administrator a salary
insert into public.payroll_schemes (doctor_id, effective_from, percent) values (current_setting('t.a')::bigint, '2026-01-01', 30);
insert into public.payroll_schemes (sales_id, effective_from, fixed_salary) values (current_setting('t.m1_id')::bigint, '2026-01-01', 200000);

-- A plan, 10 % off: Пломба ×2 (60 000) + Пломба (30 000), done in June
insert into public.treatment_plans (deal_id, name, doctor_id, discount_percent)
values (current_setting('t.d')::bigint, 'plan', current_setting('t.a')::bigint, 10);
select set_config('t.plan', tests.id_of('treatment_plans', 'name', 'plan')::text, true);
insert into public.treatment_plan_items (plan_id, stage_no, service_id, name, quantity, unit_price, position) values
  (current_setting('t.plan')::bigint, 1, tests.id_of('services', 'name', 'Пломба'), 'Пломба 2', 2, 30000, 0),
  (current_setting('t.plan')::bigint, 1, tests.id_of('services', 'name', 'Пломба'), 'Пломба 1', 1, 30000, 1),
  (current_setting('t.plan')::bigint, 1, tests.id_of('services', 'name', 'Пломба'), 'Пломба позже', 1, 30000, 2);
update public.treatment_plan_items set done = true where name in ('Пломба 2', 'Пломба 1');
update public.treatment_plan_items set done_at = case name
  when 'Пломба 2' then '2026-06-10 11:00+05'::timestamptz else '2026-06-30 23:30+05'::timestamptz end
where done;
-- A priced consultation without a deal
insert into public.visits (patient_id, doctor_id, service_id, starts_at, ends_at, status) values
  (current_setting('t.p')::bigint, current_setting('t.a')::bigint, tests.id_of('services', 'name', 'Консультация'),
    '2026-06-20 10:00+05', '2026-06-20 10:30+05', 'completed');
-- A lab order ready in June: 2 × 18 000
insert into public.labs (name) values ('Дентал-Арт');
select set_config('t.lab', tests.id_of('labs', 'name', 'Дентал-Арт')::text, true);
insert into public.lab_orders (patient_id, lab_id, doctor_id) values (current_setting('t.p')::bigint, current_setting('t.lab')::bigint, current_setting('t.a')::bigint);
select set_config('t.order', (select id from public.lab_orders where lab_id = current_setting('t.lab')::bigint)::text, true);
insert into public.lab_order_items (order_id, work_type_id, qty)
values (current_setting('t.order')::bigint, (select id from public.lab_work_types where name = 'Коронка металлокерамическая'), 2);
update public.lab_orders set status = 'ready', ready_at = '2026-06-15' where id = current_setting('t.order')::bigint;
-- Advertising 30 000 over 16 June – 15 July (15 days in each month)
insert into public.ad_spend (source_id, spent_from, spent_to, amount)
values ((select id from public.lead_sources where code = 'instagram'), '2026-06-16', '2026-07-15', 30000);
-- A bonus of the therapist in June
insert into public.payroll_adjustments (doctor_id, month, kind, amount, occurred_on) values (current_setting('t.a')::bigint, '2026-06-01', 'bonus', 5000, '2026-06-30');

-- Opening balances on 1 June: Касса 100 000, Банк 500 000
update public.finance_accounts set opening_balance = 100000, opening_date = '2026-06-01' where code = 'till';
update public.finance_accounts set opening_balance = 500000, opening_date = '2026-06-01' where code = 'bank';

-- The cash desk in June
insert into public.account_operations (patient_id, kind, amount, method, deal_id, occurred_at, comment, branch_id)
values (current_setting('t.p')::bigint, 'payment', 50000, 'cash', current_setting('t.d')::bigint, '2026-06-10 12:00+05', 'pay cash', current_setting('t.b1')::bigint);
insert into public.account_operations (patient_id, kind, amount, method, parts, deal_id, occurred_at, comment)
values (current_setting('t.p')::bigint, 'payment', 50000, 'mixed', '[{"method": "card", "amount": 30000}, {"method": "kaspi_qr", "amount": 20000}]',
  current_setting('t.d')::bigint, '2026-06-11 12:00+05', 'pay mixed');
insert into public.account_operations (patient_id, kind, account, amount, method, occurred_at, comment)
values (current_setting('t.p')::bigint, 'deposit', 'deposit', 40000, 'kaspi_transfer', '2026-06-12 12:00+05', 'deposit');
insert into public.account_operations (patient_id, kind, amount, method, deal_id, occurred_at, comment)
values (current_setting('t.p')::bigint, 'deposit_payment', 20000, 'deposit', current_setting('t.d')::bigint, '2026-06-13 12:00+05', 'from deposit');
insert into public.account_operations (patient_id, kind, account, amount, method, deal_id, occurred_at, comment, branch_id)
values (current_setting('t.p')::bigint, 'refund', 'services', 5000, 'cash', current_setting('t.d')::bigint, '2026-06-14 12:00+05', 'refund', current_setting('t.b1')::bigint);
insert into public.account_operations (kind, amount, method, category_id, occurred_at, comment)
values ('expense', 20000, 'cash', (select id from public.cash_expense_categories where code = 'rent'), '2026-06-15 12:00+05', 'rent');
-- The therapist's payout from the cash desk (Kaspi), the administrator's by bank
select set_config('t.pay_cash', public.record_payroll_payout(current_setting('t.a')::bigint, null, '2026-06-01', 30000, '2026-06-25', 'аванс', true, 'kaspi_transfer')::text, true);
select set_config('t.pay_bank', public.record_payroll_payout(null, current_setting('t.m1_id')::bigint, '2026-06-01', 150000, '2026-06-30', null)::text, true);
-- The lab: 36 000 by bank, 4 000 from the cash desk by card
select set_config('t.lp_bank', public.record_lab_payment(current_setting('t.lab')::bigint, '2026-06-01', 36000, 'bank_transfer', '2026-06-28')::text, true);
select set_config('t.lp_cash', public.record_lab_payment(current_setting('t.lab')::bigint, '2026-06-01', 4000, 'card', '2026-06-28', null, true)::text, true);

-- Money outside the cash desk
insert into public.finance_transactions (kind, occurred_on, account_id, article_id, amount, comment) values
  ('in', '2026-05-20', tests.acc(current_setting('t.org')::bigint, 'bank'), tests.art(current_setting('t.org')::bigint, 'other_in'), 7777, 'before the opening'),
  ('in', '2026-06-05', tests.acc(current_setting('t.org')::bigint, 'bank'), tests.art(current_setting('t.org')::bigint, 'loans_in'), 1000000, 'loan'),
  ('out', '2026-06-07', tests.acc(current_setting('t.org')::bigint, 'bank'), tests.art(current_setting('t.org')::bigint, 'equipment'), 200000, 'x-ray'),
  ('out', '2026-06-18', tests.acc(current_setting('t.org')::bigint, 'bank'), tests.art(current_setting('t.org')::bigint, 'marketing'), 5000, 'flyers'),
  ('out', '2026-06-25', tests.acc(current_setting('t.org')::bigint, 'bank'), tests.art(current_setting('t.org')::bigint, 'taxes'), 30000, 'tax'),
  ('accrual', '2026-06-30', null, tests.art(current_setting('t.org')::bigint, 'depreciation'), 8000, 'depreciation'),
  ('out', '2026-07-05', tests.acc(current_setting('t.org')::bigint, 'bank'), tests.art(current_setting('t.org')::bigint, 'dividends'), 100000, 'dividends');
insert into public.finance_transactions (kind, occurred_on, account_id, article_id, amount, comment, branch_id) values
  ('out', '2026-06-20', tests.acc(current_setting('t.org')::bigint, 'bank'), tests.art(current_setting('t.org')::bigint, 'utilities'), 25000, 'utilities', current_setting('t.b1')::bigint);
insert into public.finance_transactions (kind, occurred_on, account_id, to_account_id, amount, comment) values
  ('transfer', '2026-06-30', tests.acc(current_setting('t.org')::bigint, 'till'), tests.acc(current_setting('t.org')::bigint, 'bank'), 10000, 'to the bank');
select tests.logout();

--
-- Payouts and lab payments: linked transactions only for the bank ones
--
select tests.assert(
  (select count(*) = 1 from public.finance_transactions t
   where t.payroll_adjustment_id = (current_setting('t.pay_bank')::jsonb ->> 'adjustment_id')::bigint
     and t.kind = 'out' and t.amount = 150000 and t.occurred_on = '2026-06-30'
     and t.account_id = tests.acc(current_setting('t.org')::bigint, 'bank')
     and t.article_id = tests.art(current_setting('t.org')::bigint, 'salary_staff')),
  'a payout by bank gets its transaction: Банк, «Зарплата персонала»');
select tests.assert(
  (select count(*) = 0 from public.finance_transactions t
   where t.payroll_adjustment_id = (current_setting('t.pay_cash')::jsonb ->> 'adjustment_id')::bigint),
  'a payout from the cash desk gets none (its operation is the money)');
select tests.assert(
  (select count(*) = 1 from public.finance_transactions t
   where t.lab_payment_id = (current_setting('t.lp_bank')::jsonb ->> 'payment_id')::bigint
     and t.amount = 36000 and t.occurred_on = '2026-06-28' and t.counterparty = 'Дентал-Арт'
     and t.article_id = tests.art(current_setting('t.org')::bigint, 'lab'))
  and (select count(*) = 0 from public.finance_transactions t
   where t.lab_payment_id = (current_setting('t.lp_cash')::jsonb ->> 'payment_id')::bigint),
  'a lab payment by bank gets its transaction, one from the cash desk does not');

--
-- ДДС
--
select tests.login_as(current_setting('t.owner')::uuid);
select set_config('t.cf', public.report_cash_flow('2026-06-01', '2026-08-01')::text, true);
select tests.assert(
  (select jsonb_array_length(current_setting('t.cf')::jsonb -> 'periods') = 2 and (current_setting('t.cf')::jsonb ->> 'balances')::boolean),
  'two months, with the balances');
select tests.assert(
  tests.cf_row(current_setting('t.cf')::jsonb, tests.art(current_setting('t.org')::bigint, 'services'), '2026-06-01') = 100000
  and tests.cf_row(current_setting('t.cf')::jsonb, tests.art(current_setting('t.org')::bigint, 'prepayments'), '2026-06-01') = 40000
  and tests.cf_row(current_setting('t.cf')::jsonb, tests.art(current_setting('t.org')::bigint, 'refunds'), '2026-06-01') = -5000,
  'payments 100 000 (the mixed one whole), the deposit 40 000, the refund −5 000; the deposit payment is no money');
select tests.assert(
  tests.cf_row(current_setting('t.cf')::jsonb, tests.art(current_setting('t.org')::bigint, 'salary_doctors'), '2026-06-01') = -30000
  and tests.cf_row(current_setting('t.cf')::jsonb, tests.art(current_setting('t.org')::bigint, 'salary_staff'), '2026-06-01') = -150000
  and tests.cf_row(current_setting('t.cf')::jsonb, tests.art(current_setting('t.org')::bigint, 'lab'), '2026-06-01') = -40000
  and tests.cf_row(current_setting('t.cf')::jsonb, tests.art(current_setting('t.org')::bigint, 'rent'), '2026-06-01') = -20000,
  'salaries and lab payments counted once each (cash desk or bank), the rent of the cash desk by its category');
select tests.assert(
  (select (t ->> 'inflow')::bigint = 1135000 and (t ->> 'outflow')::bigint = 500000 and (t ->> 'net')::bigint = 635000
     and (t ->> 'opening')::bigint = 600000 and (t ->> 'closing')::bigint = 1235000
   from tests.cf_total(current_setting('t.cf')::jsonb, '2026-06-01') t),
  'June: in 1 135 000, out 500 000, net 635 000, 600 000 → 1 235 000');
select tests.assert(
  (select (t ->> 'net')::bigint = -100000 and (t ->> 'opening')::bigint = 1235000 and (t ->> 'closing')::bigint = 1135000
   from tests.cf_total(current_setting('t.cf')::jsonb, '2026-07-01') t),
  'July: the dividends; the closing of June is the opening of July');
select tests.assert(
  (select (a ->> 'opening')::bigint = 100000 and (a ->> 'closing')::bigint = 115000
   from tests.cf_account(current_setting('t.cf')::jsonb, tests.acc(current_setting('t.org')::bigint, 'till')) a)
  and (select (a ->> 'opening')::bigint = 0 and (a ->> 'closing')::bigint = 56000
   from tests.cf_account(current_setting('t.cf')::jsonb, tests.acc(current_setting('t.org')::bigint, 'kaspi')) a)
  and (select (a ->> 'opening')::bigint = 500000 and (a ->> 'closing')::bigint = 964000
   from tests.cf_account(current_setting('t.cf')::jsonb, tests.acc(current_setting('t.org')::bigint, 'bank')) a),
  'the accounts: the transfer moves 10 000 from Касса to Банк; the movement before the opening date is inside the opening');
select tests.assert(
  (select sum((a ->> 'flow')::bigint) = 535000 from jsonb_array_elements(current_setting('t.cf')::jsonb -> 'accounts') a)
  and (current_setting('t.cf')::jsonb -> 'total' ->> 'net')::bigint = 535000
  and tests.cf_row(current_setting('t.cf')::jsonb, tests.art(current_setting('t.org')::bigint, 'other_in'), '2026-06-01') = 0,
  'a transfer is neutral for the total');
-- May, before the opening date: 500 000 − 7 777 + 7 777
select tests.assert(
  (select (a ->> 'opening')::bigint = 492223 and (a ->> 'closing')::bigint = 500000
   from tests.cf_account(public.report_cash_flow('2026-05-01', '2026-06-01'), tests.acc(current_setting('t.org')::bigint, 'bank')) a),
  'a period before the opening date ends at the opening balance');
-- Days and weeks
select tests.assert(
  (select jsonb_array_length(r -> 'periods') = 30
     and tests.cf_row(r, tests.art(current_setting('t.org')::bigint, 'services'), '2026-06-11') = 50000
   from public.report_cash_flow('2026-06-01', '2026-07-01', null, 'day') r),
  'by day');
select tests.assert(
  (select (r -> 'periods' ->> 0)::date = '2026-06-01'
     and tests.cf_row(r, tests.art(current_setting('t.org')::bigint, 'services'), '2026-06-08') = 100000
   from public.report_cash_flow('2026-06-01', '2026-07-01', null, 'week') r),
  'by week (Mondays)');
-- The drill-down
select tests.assert(
  (select jsonb_array_length(m) = 3 and (select sum((x ->> 'amount')::bigint) from jsonb_array_elements(m) x) = 100000
   from public.report_cash_flow_movements('2026-06-01', '2026-07-01', null, tests.art(current_setting('t.org')::bigint, 'services')) m),
  'the drill-down of «Оплата услуг»: cash and the two parts of the mixed payment');
select tests.assert(
  (select jsonb_array_length(m) = 2 and (select sum((x ->> 'amount')::bigint) from jsonb_array_elements(m) x) = 0
   from public.report_cash_flow_movements('2026-06-01', '2026-07-01', null, null, null, true) m),
  'the drill-down of the transfers');
select tests.assert(
  (select jsonb_array_length(m) = 4 and (select sum((x ->> 'amount')::bigint) from jsonb_array_elements(m) x) = 15000
   from public.report_cash_flow_movements('2026-06-01', '2026-07-01', null, null, tests.acc(current_setting('t.org')::bigint, 'till')) m),
  'the drill-down of an account');
-- The branch filter
select tests.assert(
  (select (r ->> 'balances')::boolean = false and (r -> 'total' ->> 'opening') is null
     and tests.cf_row(r, tests.art(current_setting('t.org')::bigint, 'utilities'), '2026-06-01') = -25000
     and tests.cf_row(r, tests.art(current_setting('t.org')::bigint, 'services'), '2026-06-01') = 100000
     and tests.cf_row(r, tests.art(current_setting('t.org')::bigint, 'prepayments'), '2026-06-01') = 0
     and tests.cf_row(r, tests.art(current_setting('t.org')::bigint, 'taxes'), '2026-06-01') = 0
   from public.report_cash_flow('2026-06-01', '2026-07-01', current_setting('t.b1')::bigint) r),
  'a branch: its movements only (payments of its deals, its transactions), no balances');
select tests.throws($$select public.report_cash_flow('2026-06-01', '2026-06-01')$$, '22023', 'an empty period');
select tests.throws($$select public.report_cash_flow('2026-06-01', '2026-07-01', null, 'year')$$, '22023', 'an unknown granularity');

--
-- ПиУ
--
select set_config('t.pnl', public.report_pnl('2026-06-01', '2026-08-01')::text, true);
select tests.assert(
  (select (s ->> 'revenue')::bigint = 86000 and (s ->> 'refunds')::bigint = 5000
   from tests.pnl_month(current_setting('t.pnl')::jsonb, '2026-06-01') s),
  'revenue: the items at their net price (54 000 + 27 000, the one done at 23:30 in Almaty is June) + the visit 10 000 − the refund 5 000');
select tests.assert(
  (select (s ->> 'materials')::bigint = 15000 and (s ->> 'lab')::bigint = 36000 and (s ->> 'doctors')::bigint = 32300
     and (s ->> 'cogs')::bigint = 83300 and (s ->> 'gross')::bigint = 2700 and (s ->> 'gross_margin')::numeric = 3.1
   from tests.pnl_month(current_setting('t.pnl')::jsonb, '2026-06-01') s),
  'cost of sales: materials 3 × 5 000, the lab 36 000, the therapist 30 % (27 300) + the bonus 5 000');
select tests.assert(
  (select (s ->> 'staff')::bigint = 200000 and (s ->> 'marketing')::bigint = 20000 and (s ->> 'opex_other')::bigint = 45000
     and (s ->> 'opex')::bigint = 265000 and (s ->> 'ebitda')::bigint = -262300
   from tests.pnl_month(current_setting('t.pnl')::jsonb, '2026-06-01') s),
  'operating: the salary 200 000 (not the payouts), advertising 15 000 + flyers 5 000, rent 20 000 + utilities 25 000');
select tests.assert(
  (select (s ->> 'depreciation')::bigint = 8000 and (s ->> 'tax')::bigint = 30000 and (s ->> 'interest')::bigint = 0
     and (s ->> 'net')::bigint = -300300
   from tests.pnl_month(current_setting('t.pnl')::jsonb, '2026-06-01') s),
  'depreciation (an accrual), taxes, net profit; loans, equipment, dividends and lab payments are no P&L');
select tests.assert(
  (select (s ->> 'visits')::bigint = 1 and (s ->> 'avg_check')::bigint = 86000 and (s ->> 'revenue_per_chair')::bigint = 28667
     and (s ->> 'lab_share')::numeric = 41.9 and (s ->> 'payroll_share')::numeric = 270.1
   from tests.pnl_month(current_setting('t.pnl')::jsonb, '2026-06-01') s),
  'the ratios: average check, revenue per chair (3 chairs), lab and payroll shares');
select tests.assert(
  (select (s ->> 'revenue')::bigint = 0 and (s ->> 'marketing')::bigint = 15000 and (s ->> 'staff')::bigint = 200000
     and (s ->> 'net')::bigint = -215000
   from tests.pnl_month(current_setting('t.pnl')::jsonb, '2026-07-01') s),
  'July: the rest of the advertising, the salary; the dividends are no expense');
select tests.assert(
  (select (current_setting('t.pnl')::jsonb -> 'total' ->> 'net')::bigint = -515300
     and exists (select 1 from jsonb_array_elements(current_setting('t.pnl')::jsonb -> 'rows') r
       where r ->> 'line' = 'opex' and (r ->> 'article_id')::bigint = tests.art(current_setting('t.org')::bigint, 'rent')
         and (r ->> 'amount')::bigint = 20000)),
  'the total and the rows by article');
-- A branch: Достык
select tests.assert(
  (select (s ->> 'revenue')::bigint = 86000 and (s ->> 'lab')::bigint = 36000 and (s ->> 'doctors')::bigint = 32300
     and (s ->> 'staff')::bigint = 0 and (s ->> 'opex_other')::bigint = 25000 and (s ->> 'marketing')::bigint = 0
     and (s ->> 'revenue_per_chair')::bigint = 43000
   from tests.pnl_month(public.report_pnl('2026-06-01', '2026-07-01', current_setting('t.b1')::bigint), '2026-06-01') s),
  'a branch: its revenue, doctors, lab orders, chairs and articles; the salary and the advertising have no branch');
select tests.assert(
  (select (s ->> 'revenue')::bigint = 0 and (s ->> 'net')::bigint = 0
   from tests.pnl_month(public.report_pnl('2026-06-01', '2026-07-01', current_setting('t.b2')::bigint), '2026-06-01') s),
  'another branch: nothing');
-- Manual revenue (history from another system) is revenue
insert into public.finance_transactions (kind, occurred_on, article_id, amount, comment)
values ('accrual', '2026-07-10', tests.art(current_setting('t.org')::bigint, 'services'), 1000000, 'history');
select tests.assert(
  (select (s ->> 'revenue')::bigint = 1000000
   from tests.pnl_month(public.report_pnl('2026-07-01', '2026-08-01'), '2026-07-01') s),
  'an accrual on «Оплата услуг» is revenue');
select tests.throws($$select public.report_pnl('2026-06-01', '2026-06-15')$$, '22023', 'at least a month');

--
-- The rules of a transaction
--
select tests.throws(format($q$insert into public.finance_transactions (kind, account_id, article_id, amount) values ('in', %s, %s, 100)$q$,
  tests.acc(current_setting('t.org')::bigint, 'bank'), tests.art(current_setting('t.org')::bigint, 'rent')),
  '22023', 'money in by an article of payments');
select tests.throws(format($q$insert into public.finance_transactions (kind, article_id, amount) values ('accrual', %s, 100)$q$,
  tests.art(current_setting('t.org')::bigint, 'dividends')),
  '22023', 'an accrual on an article outside the P&L');
select tests.throws(format($q$insert into public.finance_transactions (kind, account_id, to_account_id, amount) values ('transfer', %s, %s, 100)$q$,
  tests.acc(current_setting('t.org')::bigint, 'bank'), tests.acc(current_setting('t.org')::bigint, 'bank')),
  '23514', 'a transfer to the same account');
select tests.throws(format($q$insert into public.finance_transactions (kind, account_id, article_id, amount) values ('out', %s, %s, 100)$q$,
  tests.acc(current_setting('t.other_org')::bigint, 'bank'), tests.art(current_setting('t.org')::bigint, 'rent')),
  '23503', 'an account of another clinic');
select tests.throws(format('delete from public.finance_articles where id = %s', tests.art(current_setting('t.org')::bigint, 'rent')),
  '22023', 'a system article is not deleted');
select tests.throws(format($q$update public.finance_articles set section = 'in' where id = %s$q$, tests.art(current_setting('t.org')::bigint, 'rent')),
  '22023', 'a system article keeps its section');
select tests.throws(format('delete from public.finance_accounts where id = %s', tests.acc(current_setting('t.org')::bigint, 'kaspi')),
  '22023', 'a system account is not deleted');
insert into public.finance_articles (name, section, activity, pnl_line) values ('Обучение врачей', 'out', 'operating', 'opex');
insert into public.finance_accounts (name, kind) values ('Халык', 'bank');
select tests.assert(
  (select code is null from public.finance_articles where name = 'Обучение врачей')
  and (select count(*) = 1 from public.audit_log where entity = 'finance_article' and action = 'create')
  and (select count(*) = 1 from public.audit_log where entity = 'finance_account' and action = 'create'),
  'own articles and accounts, in the audit log');
select tests.assert(
  (select count(*) = 10 from public.audit_log where entity = 'finance_transaction' and action = 'create'),
  'the transactions written by hand are in the audit log, the linked ones are not');
-- The method map
update public.finance_method_accounts set account_id = tests.acc(current_setting('t.org')::bigint, 'bank') where method = 'card';
select tests.assert(
  (select (a ->> 'closing')::bigint = 30000
   from tests.cf_account(public.report_cash_flow('2026-06-01', '2026-07-01'), tests.acc(current_setting('t.org')::bigint, 'kaspi')) a),
  'card payments follow the method map to Банк');
update public.finance_method_accounts set account_id = tests.acc(current_setting('t.org')::bigint, 'kaspi') where method = 'card';
-- A linked transaction: amount and day on the payroll side, the account here
select set_config('t.linked', (select id from public.finance_transactions
  where payroll_adjustment_id = (current_setting('t.pay_bank')::jsonb ->> 'adjustment_id')::bigint)::text, true);
select tests.throws(format('update public.finance_transactions set amount = 1 where id = %s', current_setting('t.linked')),
  '22023', 'the amount of a linked transaction');
select tests.throws(format('delete from public.finance_transactions where id = %s', current_setting('t.linked')),
  '22023', 'a linked transaction is not deleted here');
update public.finance_transactions set account_id = tests.acc(current_setting('t.org')::bigint, 'kaspi') where id = current_setting('t.linked')::bigint;
update public.payroll_adjustments set amount = 140000 where id = (current_setting('t.pay_bank')::jsonb ->> 'adjustment_id')::bigint;
select tests.assert(
  (select amount = 140000 and account_id = tests.acc(current_setting('t.org')::bigint, 'kaspi')
   from public.finance_transactions where id = current_setting('t.linked')::bigint),
  'the payout changed: its transaction follows, keeping the account chosen');
delete from public.payroll_adjustments where id = (current_setting('t.pay_bank')::jsonb ->> 'adjustment_id')::bigint;
select tests.assert(
  (select count(*) = 0 from public.finance_transactions where id = current_setting('t.linked')::bigint),
  'the payout deleted: its transaction too');
update public.lab_payments set method = 'kaspi_transfer' where id = (current_setting('t.lp_bank')::jsonb ->> 'payment_id')::bigint;
select tests.assert(
  (select account_id = tests.acc(current_setting('t.org')::bigint, 'kaspi') from public.finance_transactions
   where lab_payment_id = (current_setting('t.lp_bank')::jsonb ->> 'payment_id')::bigint),
  'the method of a lab payment changed: the account follows the map');
select tests.logout();

--
-- «Финмодель»
--
select tests.login_as(current_setting('t.head')::uuid);
insert into public.finance_models (name, start_month, chairs, working_days, hours_per_day, utilization, visits_per_chair_hour,
  avg_check, opening_cash, investment_amount, investment_month)
values ('База 2026', '2026-06-15', 2, 20, 10, 50, 1, 20000, 1000000, 3000000, 0);
select set_config('t.model', tests.id_of('finance_models', 'name', 'База 2026')::text, true);
insert into public.finance_model_lines (model_id, name, pnl_line, kind, amount, percent, position) values
  (current_setting('t.model')::bigint, 'Врачи', 'doctors', 'percent', 0, 30, 0),
  (current_setting('t.model')::bigint, 'Лаборатория', 'lab', 'percent', 0, 8, 1),
  (current_setting('t.model')::bigint, 'Материалы', 'materials', 'percent', 0, 6, 2),
  (current_setting('t.model')::bigint, 'Аренда', 'opex', 'fixed', 500000, 0, 3),
  (current_setting('t.model')::bigint, 'Персонал', 'staff', 'fixed', 800000, 0, 4),
  (current_setting('t.model')::bigint, 'Налог 3 %', 'tax', 'percent', 0, 3, 5),
  (current_setting('t.model')::bigint, 'Амортизация', 'depreciation', 'fixed', 50000, 0, 6);
insert into public.finance_model_months (model_id, month_index, utilization) values (current_setting('t.model')::bigint, 1, 75);
select set_config('t.fm', public.report_finance_model(current_setting('t.model')::bigint)::text, true);
select tests.assert(
  (select (current_setting('t.fm')::jsonb ->> 'start_month')::date = '2026-06-01'
     and (m ->> 'visits')::bigint = 200 and (m ->> 'revenue')::bigint = 4000000
     and (m ->> 'doctors')::bigint = 1200000 and (m ->> 'lab')::bigint = 320000 and (m ->> 'materials')::bigint = 240000
     and (m ->> 'cogs')::bigint = 1760000 and (m ->> 'gross')::bigint = 2240000 and (m ->> 'opex')::bigint = 1300000
     and (m ->> 'ebitda')::bigint = 940000 and (m ->> 'net')::bigint = 770000
   from tests.model_month(current_setting('t.fm')::jsonb, 0) m),
  'a month of the model: 2 chairs × 20 days × 10 h × 1 visit × 50 % = 200 visits × 20 000; the lines');
select tests.assert(
  (select (m ->> 'break_even_revenue')::bigint = 2547170 and (m ->> 'break_even_utilization')::numeric = 31.8
   from tests.model_month(current_setting('t.fm')::jsonb, 0) m),
  'break-even: 1 350 000 / (1 − 47 %) = 2 547 170, at 31.8 % utilization');
select tests.assert(
  (select (m ->> 'cash_flow')::bigint = -2180000 and (m ->> 'cash')::bigint = -1180000
   from tests.model_month(current_setting('t.fm')::jsonb, 0) m)
  and (current_setting('t.fm')::jsonb ->> 'payback_months')::int = 3
  and (current_setting('t.fm')::jsonb ->> 'payback_in_horizon')::boolean,
  'the cash plan with the investment, payback in 3 months (820 000 + 1 880 000 + 820 000)');
select tests.assert(
  (select (m ->> 'visits')::bigint = 300 and (m ->> 'revenue')::bigint = 6000000
   from tests.model_month(current_setting('t.fm')::jsonb, 1) m)
  and (current_setting('t.fm')::jsonb -> 'total' ->> 'revenue')::bigint = 50000000,
  'a month override: 75 %; the total of the year');
select tests.assert(
  (select (m ->> 'visits')::bigint = 170 and (m ->> 'revenue')::bigint = 3400000
   from tests.model_month(public.report_finance_model(current_setting('t.model')::bigint, 'pessimistic'), 0) m)
  and (select (m ->> 'visits')::bigint = 230
   from tests.model_month(public.report_finance_model(current_setting('t.model')::bigint, 'optimistic'), 0) m),
  'scenarios multiply the utilization (0.85, 1.15)');
select tests.assert(
  (select (f ->> 'revenue')::bigint = 86000 and (f ->> 'revenue_delta')::bigint = 86000 - 4000000
     and (f ->> 'net')::bigint = -300300
   from jsonb_array_elements(current_setting('t.fm')::jsonb -> 'fact') f where (f ->> 'month')::date = '2026-06-01'),
  'plan vs fact: June from the P&L');
update public.finance_models set investment_amount = 30000000 where id = current_setting('t.model')::bigint;
select tests.assert(
  (select (r ->> 'payback_months')::int = 12 + 22 and not (r ->> 'payback_in_horizon')::boolean
   from public.report_finance_model(current_setting('t.model')::bigint) r),
  'payback beyond the horizon: estimated from the average flow');
update public.finance_models set investment_amount = 3000000 where id = current_setting('t.model')::bigint;
select tests.throws($$select public.report_finance_model(1, 'best')$$, '22023', 'an unknown scenario');
update public.finance_model_lines set to_index = 0 where name = 'Амортизация';
select tests.assert(
  (select (m ->> 'depreciation')::bigint = 0 from tests.model_month(public.report_finance_model(current_setting('t.model')::bigint), 1) m),
  'a line limited to its months');
select tests.logout();

--
-- Rights
--
-- An administrator without «Отчёты»: nothing
select tests.login_as(current_setting('t.m1')::uuid);
select tests.throws($$select public.report_cash_flow('2026-06-01', '2026-07-01')$$, '42501', 'no ДДС for an administrator');
select tests.throws($$select public.report_pnl('2026-06-01', '2026-07-01')$$, '42501', 'no P&L for an administrator');
select tests.assert(
  (select count(*) from public.finance_accounts) + (select count(*) from public.finance_articles)
  + (select count(*) from public.finance_transactions) + (select count(*) from public.finance_models) = 0,
  'an administrator reads no finance row');
select tests.throws(format($q$insert into public.finance_transactions (kind, account_id, article_id, amount) values ('out', %s, %s, 100)$q$,
  tests.acc(current_setting('t.org')::bigint, 'bank'), tests.art(current_setting('t.org')::bigint, 'rent')),
  '42501', 'an administrator writes no transaction');
select tests.logout();
-- With «Отчёты»: the ДДС, read-only; no P&L, no model
select tests.login_as(current_setting('t.m2')::uuid);
select tests.assert(
  (select (tests.cf_total(public.report_cash_flow('2026-06-01', '2026-07-01'), '2026-06-01') ->> 'inflow')::bigint = 1135000),
  'an administrator with «Отчёты» sees the ДДС');
select tests.assert((select count(*) = 4 from public.finance_accounts), 'and the accounts');
select tests.throws($$select public.report_pnl('2026-06-01', '2026-07-01')$$, '42501', 'but not the P&L');
select tests.throws(format('select public.report_finance_model(%s)', current_setting('t.model')), '42501', 'nor the model');
select tests.assert((select count(*) = 0 from public.finance_models), 'no model row');
select tests.throws(format($q$insert into public.finance_transactions (kind, account_id, article_id, amount) values ('out', %s, %s, 100)$q$,
  tests.acc(current_setting('t.org')::bigint, 'bank'), tests.art(current_setting('t.org')::bigint, 'rent')),
  '42501', 'nor writes');
select tests.assert(tests.affected('update public.finance_accounts set opening_balance = 1') = 0, 'nor changes an account');
select tests.logout();
-- The integrator
select tests.login_as(current_setting('t.int')::uuid);
select tests.throws($$select public.report_cash_flow('2026-06-01', '2026-07-01')$$, '42501', 'no ДДС for the integrator');
select tests.throws($$select public.report_pnl('2026-06-01', '2026-07-01')$$, '42501', 'no P&L for the integrator');
select tests.assert(
  (select count(*) from public.finance_accounts) + (select count(*) from public.finance_transactions)
  + (select count(*) from public.finance_models) + (select count(*) from public.finance_model_lines) = 0,
  'the integrator reads nothing');
select tests.logout();
-- Anonymous
select tests.login_anon();
select tests.throws($$select public.report_cash_flow('2026-06-01', '2026-07-01')$$, '42501', 'no ДДС for anonymous');
select tests.logout();

--
-- Clinic isolation
--
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(
  (select count(*) = 3 from public.finance_accounts) and (select count(*) = 0 from public.finance_transactions)
  and (select count(*) = 0 from public.finance_models),
  'the other clinic sees its own accounts only');
select tests.assert(
  (select (r -> 'total' ->> 'net')::bigint = 0 and (r -> 'total' ->> 'opening')::bigint = 0
   from public.report_cash_flow('2026-06-01', '2026-08-01') r)
  and (select (r -> 'total' ->> 'revenue')::bigint = 0 from public.report_pnl('2026-06-01', '2026-08-01') r),
  'its reports are empty');
select tests.throws(format('select public.report_finance_model(%s)', current_setting('t.model')), 'P0002', 'the model of another clinic');
select tests.assert(tests.affected(format('delete from public.finance_models where id = %s', current_setting('t.model'))) = 0,
  'nor deletes it');
select tests.logout();

-- Deleting the clinic removes its finance
delete from public.organizations where id = current_setting('t.org')::bigint;
select tests.assert(
  (select count(*) from public.finance_accounts where organization_id = current_setting('t.org')::bigint)
  + (select count(*) from public.finance_transactions where organization_id = current_setting('t.org')::bigint)
  + (select count(*) from public.finance_models where organization_id = current_setting('t.org')::bigint) = 0,
  'deleting a clinic removes its finance');

rollback;

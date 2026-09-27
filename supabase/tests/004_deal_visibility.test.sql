--
-- Deal visibility of managers (administrators / curators): all, own, or own
-- and unassigned, set by the clinic. Owners and heads always see everything.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m2', tests.invite('m2@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m1_id', (select id from public.sales where email = 'm1@clinic.kz')::text, true);
select set_config('t.m2_id', (select id from public.sales where email = 'm2@clinic.kz')::text, true);

-- Three deals: one per manager and one without a responsible, each with a task
select tests.login_as(current_setting('t.owner')::uuid);
update public.task_rules set is_active = false;  -- only the tasks below
insert into public.patients (first_name) values ('Пациент');
insert into public.deals (patient_id, name, sales_id)
select p.id, d.name, d.sales_id
from public.patients p,
  (values ('m1', current_setting('t.m1_id')::bigint), ('m2', current_setting('t.m2_id')::bigint)) as d(name, sales_id);
insert into public.deals (patient_id, name) select id, 'unassigned' from public.patients;
update public.deals set sales_id = null where name = 'unassigned';
insert into public.tasks (deal_id, text, due_date) select id, 'task ' || name, now() from public.deals;
select set_config('t.deal_m2', (select id from public.deals where name = 'm2')::text, true);
select tests.logout();

-- Default: every manager sees every deal
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(tests.count('select * from public.deals') = 3, 'all: a manager sees every deal');
select tests.assert(tests.count('select * from public.tasks') = 3, 'all: a manager sees every task');
select tests.assert(
  tests.affected('update public.organization_settings set manager_deal_visibility = ''own''') = 0,
  'managers cannot change the visibility');
select tests.logout();

-- The head restricts managers to their own deals
select tests.login_as(current_setting('t.head')::uuid);
select tests.assert(
  tests.affected('update public.organization_settings set manager_deal_visibility = ''own''') = 1,
  'the head sets the visibility');
select tests.assert(tests.count('select * from public.deals') = 3, 'own: the head still sees every deal');
select tests.logout();

select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert((select string_agg(name, ',') from public.deals) = 'm1', 'own: a manager only sees own deals');
select tests.assert(tests.count('select * from public.deals_summary') = 1, 'own: the board view follows');
select tests.assert(tests.count('select * from public.tasks') = 1, 'own: tasks follow the deals');
select tests.assert(tests.count('select * from public.deal_events') = 1, 'own: the deal log follows');
select tests.assert((select nb_open_deals from public.patients_summary) = 1, 'own: patient counters only count visible deals');
select tests.assert(tests.count('select * from public.patients') = 1, 'own: patients stay visible to the whole clinic');
select tests.assert(
  tests.affected('update public.deals set name = ''x'' where id = ' || current_setting('t.deal_m2')) = 0,
  'own: a manager cannot edit a colleague''s deal');
select tests.throws(
  format('insert into public.tasks (deal_id, text, due_date) values (%s, ''x'', now())', current_setting('t.deal_m2')),
  '42501', 'own: a manager cannot add a task to a colleague''s deal');
select tests.throws(
  format('insert into public.deal_payments (deal_id, amount) values (%s, 1000)', current_setting('t.deal_m2')),
  '42501', 'own: a manager cannot add a payment to a colleague''s deal');
select tests.logout();

-- Own and unassigned
select tests.login_as(current_setting('t.owner')::uuid);
update public.organization_settings set manager_deal_visibility = 'own_and_unassigned';
select tests.assert(tests.count('select * from public.deals') = 3, 'the owner always sees every deal');
select tests.logout();

select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(
  (select string_agg(name, ',' order by name) from public.deals) = 'm1,unassigned',
  'own_and_unassigned: own deals plus the ones without a responsible');
-- Taking an unassigned deal
select tests.assert(
  tests.affected('update public.deals set sales_id = ' || current_setting('t.m1_id') || ' where name = ''unassigned''') = 1,
  'own_and_unassigned: a manager can take an unassigned deal');
select tests.logout();

select tests.login_as(current_setting('t.m2')::uuid);
select tests.assert(
  (select string_agg(name, ',') from public.deals) = 'm2',
  'own_and_unassigned: a taken deal disappears for the others');
select tests.logout();

rollback;

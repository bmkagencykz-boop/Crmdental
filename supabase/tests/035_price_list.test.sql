--
-- The clinic price list (stage 35): the category tree and the path kept in
-- services.category, the price history, bulk actions (move, price change by
-- a percentage or an amount rounded to 100 ₸, archive, delete vs archive of
-- used services), plans keep their prices, rights per role (the cost price
-- hidden from managers and the integrator), clinic isolation.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.int', tests.invite('dev@agency.kz', current_setting('t.org')::bigint, 'integrator')::text, true);
select set_config('t.owner_id', (select id from public.sales where email = 'owner@clinic.kz')::text, true);
select set_config('t.head_id', (select id from public.sales where email = 'head@clinic.kz')::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);

create function tests.cat(cat_name text) returns bigint language sql as $$
  select c.id from public.service_categories c
  where c.organization_id = current_setting('t.org')::bigint and c.name = cat_name
$$;
create function tests.svc(svc_code text) returns bigint language sql as $$
  select s.id from public.services s
  where s.organization_id = current_setting('t.org')::bigint and s.code = svc_code
$$;
create function tests.price(svc_code text) returns numeric language sql as $$
  select s.price from public.services s
  where s.organization_id = current_setting('t.org')::bigint and s.code = svc_code
$$;
grant execute on all functions in schema tests to authenticated;

--
-- The category tree and services.category
--

select tests.login_as(current_setting('t.owner')::uuid);
insert into public.service_categories (name, position) values ('Терапия', 0), ('  Хирургия ', 1);
insert into public.service_categories (parent_id, name) values (tests.cat('Терапия'), 'Лечение кариеса');
select tests.assert(tests.cat('Хирургия') is not null, 'a category name is trimmed');

insert into public.services (name, code, category_id, price, unit, duration_minutes, specialty, materials_note, position) values
  ('Кариес поверхностный', 'T-01', tests.cat('Лечение кариеса'), 25000, 'tooth', 60, 'Терапевт', ' Filtek Z550 ', 0);
select tests.assert(
  (select category = 'Терапия / Лечение кариеса' and unit = 'tooth' and duration_minutes = 60
     and specialty = 'Терапевт' and materials_note = 'Filtek Z550'
   from public.services where id = tests.svc('T-01')),
  'a service of a subsection: its path in services.category, unit, duration, specialty, materials');

-- A writer that only knows the text (stage-29 import, API): found or created
insert into public.services (name, code, category, price, position) values
  ('Кариес средний', 'T-02', ' терапия /  лечение   кариеса ', 33333, 1),
  ('Удаление простое', 'S-01', 'Хирургия / Удаление', 45050, 2),
  ('Консультация', 'D-01', 'Диагностика', 10000, 3),
  ('Без цены', 'X-01', null, null, 4);
select tests.assert(
  (select category_id = tests.cat('Лечение кариеса') and category = 'Терапия / Лечение кариеса'
   from public.services where id = tests.svc('T-02')),
  'a path matches the existing categories, case and spaces ignored');
select tests.assert(
  (select c.parent_id = tests.cat('Хирургия') from public.service_categories c where c.id = tests.cat('Удаление'))
  and (select category_id = tests.cat('Удаление') and category = 'Хирургия / Удаление' from public.services where id = tests.svc('S-01'))
  and (select category_id = tests.cat('Диагностика') and category = 'Диагностика' from public.services where id = tests.svc('D-01'))
  and (select c.position = 2 from public.service_categories c where c.id = tests.cat('Диагностика')),
  'a missing path creates the section and the subsection at the end');
select tests.assert(
  (select unit = 'service' and category is null and category_id is null from public.services where id = tests.svc('X-01')),
  'a service without a category, unit «услуга» by default');

update public.services set category = 'Хирургия' where id = tests.svc('D-01');
select tests.assert(
  (select category_id = tests.cat('Хирургия') from public.services where id = tests.svc('D-01')),
  'changing the text moves the service to that category');
update public.services set category_id = tests.cat('Диагностика') where id = tests.svc('D-01');
select tests.assert(
  (select category = 'Диагностика' from public.services where id = tests.svc('D-01')),
  'changing category_id rewrites the text');
update public.services set category = '' where id = tests.svc('D-01');
select tests.assert(
  (select category is null and category_id is null from public.services where id = tests.svc('D-01')),
  'an empty text removes the category');
update public.services set category_id = tests.cat('Диагностика') where id = tests.svc('D-01');

-- Rename: the paths follow (the services of the subsections too)
update public.service_categories set name = 'Терапевтическая стоматология' where id = tests.cat('Терапия');
select tests.assert(
  (select bool_and(category = 'Терапевтическая стоматология / Лечение кариеса') from public.services
   where id in (tests.svc('T-01'), tests.svc('T-02'))),
  'renaming a section rewrites the paths of its subsections'' services');
update public.service_categories set name = 'Терапия' where id = tests.cat('Терапевтическая стоматология');

-- Two levels, no «/», unique among siblings
select tests.throws(format('insert into public.service_categories (parent_id, name) values (%s, %L)', tests.cat('Лечение кариеса'), 'Глубокий'),
  '22023', 'a third level is refused');
select tests.throws(format('update public.service_categories set parent_id = %s where id = %s', tests.cat('Диагностика'), tests.cat('Хирургия')),
  '22023', 'a section with subsections cannot become a subsection');
select tests.throws($q$insert into public.service_categories (name) values ('Ортопедия/Протезы')$q$,
  '23514', 'a name with «/» is refused');
select tests.throws($q$insert into public.service_categories (name) values ('терапия')$q$,
  '23505', 'two sections with the same name are refused');
insert into public.service_categories (parent_id, name) values (tests.cat('Хирургия'), 'Лечение кариеса');
select tests.assert(tests.count($q$select 1 from public.service_categories where name = 'Лечение кариеса'$q$) = 2,
  'the same name in another section is fine');

-- Deleting a subsection: its services go to the section
insert into public.services (name, code, category, price, position) values ('Пломба', 'T-03', 'Терапия', 20000, 5);
delete from public.service_categories where id = tests.cat('Удаление');
select tests.assert(
  (select category_id = tests.cat('Хирургия') and category = 'Хирургия' from public.services where id = tests.svc('S-01')),
  'deleting a subsection moves its services to the section');
-- Deleting a section: its subsections go, all the services lose the category
insert into public.service_categories (name) values ('Временный');
insert into public.service_categories (parent_id, name) values (tests.cat('Временный'), 'Под');
insert into public.services (name, code, category, position) values
  ('Временная 1', 'V-01', 'Временный', 6), ('Временная 2', 'V-02', 'Временный / Под', 7);
delete from public.service_categories where id = tests.cat('Временный');
select tests.assert(
  (select bool_and(category is null and category_id is null) from public.services where code in ('V-01', 'V-02'))
  and tests.cat('Под') is null,
  'deleting a section deletes its subsections, the services stay without a category');
select tests.assert(
  exists (select 1 from public.audit_log where entity = 'service_category' and action = 'delete'
    and changes -> 'name' ->> 0 = 'Временный'),
  'the category changes are in the audit log');

--
-- Price history
--

select tests.assert(
  (select old_price is null and new_price = 25000 and sales_id = current_setting('t.owner_id')::bigint
   from public.service_price_history where service_id = tests.svc('T-01')),
  'the first price is in the history, with its author');
select tests.assert(not exists (select 1 from public.service_price_history where service_id = tests.svc('X-01')),
  'no price, no history');
select tests.logout();

select tests.login_as(current_setting('t.head')::uuid);
update public.services set price = 27000 where id = tests.svc('T-01');
update public.services set name = 'Кариес поверхностный (эмаль)' where id = tests.svc('T-01');
update public.services set price = 27000 where id = tests.svc('T-01');
select tests.assert(
  (select count(*) = 2 and bool_or(old_price = 25000 and new_price = 27000 and sales_id = current_setting('t.head_id')::bigint)
   from public.service_price_history where service_id = tests.svc('T-01')),
  'a price change adds old → new with its author; other changes add nothing');
select tests.logout();

--
-- Bulk actions
--

-- A deal with a treatment plan: the plan keeps its price
select tests.login_as(current_setting('t.owner')::uuid);
update public.task_rules set is_active = false;
insert into public.patients (first_name, last_name) values ('Асель', 'Нурланова');
insert into public.deals (patient_id, name, service_id)
select p.id, 'Лечение', tests.svc('T-02') from public.patients p;
insert into public.treatment_plans (deal_id, name) select d.id, 'План' from public.deals d where d.name = 'Лечение';
insert into public.treatment_plan_items (plan_id, service_id, name, quantity, unit_price)
select p.id, tests.svc('S-01'), null, 1, 45050 from public.treatment_plans p where p.name = 'План';

select tests.assert(
  public.bulk_services(array[tests.svc('T-01'), tests.svc('T-02'), tests.svc('S-01'), tests.svc('X-01')], 'price_percent', 10)
    = '{"updated": 3, "deleted": 0, "archived": 0}'::jsonb,
  'the price change skips the services without a price');
select tests.assert(
  tests.price('T-01') = 29700 and tests.price('T-02') = 36700 and tests.price('S-01') = 49600 and tests.price('X-01') is null,
  '+10 %: 27 000 → 29 700, 33 333 → 36 666,3 → 36 700, 45 050 → 49 555 → 49 600');
select public.bulk_services(array[tests.svc('T-01'), tests.svc('S-01')], 'price_percent', -7.5);
select tests.assert(tests.price('T-01') = 27500 and tests.price('S-01') = 45900,
  '−7,5 %: 29 700 → 27 472,5 → 27 500, 49 600 → 45 880 → 45 900');
select public.bulk_services(array[tests.svc('T-01'), tests.svc('D-01')], 'price_amount', 1249);
select tests.assert(tests.price('T-01') = 28700 and tests.price('D-01') = 11200,
  '+1 249 ₸: 27 500 → 28 749 → 28 700, 10 000 → 11 249 → 11 200');
select public.bulk_services(array[tests.svc('D-01')], 'price_amount', -50000);
select tests.assert(tests.price('D-01') = 0, 'a price never goes below 0');
select tests.assert(
  (select count(*) from public.service_price_history where service_id = tests.svc('T-01')) = 5,
  'every bulk change is in the history');
select tests.throws($q$select public.bulk_services(array[1::bigint], 'price_percent', -100)$q$, '22023', '−100 % is refused');
select tests.throws($q$select public.bulk_services(array[1::bigint], 'price_percent', null)$q$, '22023', 'a change needs a value');
select tests.throws($q$select public.bulk_services(array[1::bigint], 'explode')$q$, '22023', 'an unknown action is refused');
select tests.assert(
  (select unit_price = 45050 and line_total = 45050 from public.treatment_plan_items where name = 'Удаление простое'),
  'a treatment plan keeps the price it was made with');

-- Move
select tests.assert(
  (public.bulk_services(array[tests.svc('T-03'), tests.svc('X-01')], 'move', null, tests.cat('Диагностика')) ->> 'updated')::int = 2,
  'moving services to a category');
select tests.assert((select bool_and(category = 'Диагностика') from public.services where code in ('T-03', 'X-01')),
  'the moved services have the path of their new category');
select public.bulk_services(array[tests.svc('X-01')], 'move', null, null);
select tests.assert((select category is null from public.services where id = tests.svc('X-01')), 'moving to «Без раздела»');

-- Archive, restore
select public.bulk_services(array[tests.svc('T-03'), tests.svc('X-01')], 'archive');
select tests.assert((select bool_and(is_archived) from public.services where code in ('T-03', 'X-01')), 'archive');
select public.bulk_services(array[tests.svc('T-03')], 'restore');
select tests.assert((select not is_archived from public.services where id = tests.svc('T-03')), 'restore');

-- Delete: used services (a deal, a plan item, a visit) are archived instead
insert into public.doctors (name) values ('Ахметова');
insert into public.visits (patient_id, doctor_id, service_id, starts_at, ends_at)
select p.id, (select id from public.doctors), tests.svc('T-03'), now() + interval '1 day', now() + interval '1 day 1 hour' from public.patients p;
select tests.assert(
  (select in_use from public.price_list where id = tests.svc('T-02'))
  and (select in_use from public.price_list where id = tests.svc('S-01'))
  and (select in_use from public.price_list where id = tests.svc('T-03'))
  and not (select in_use from public.price_list where id = tests.svc('X-01')),
  'the page knows which services are used (deal, plan, visit)');
select tests.assert(
  public.bulk_services(array[tests.svc('T-02'), tests.svc('S-01'), tests.svc('T-03'), tests.svc('X-01'), tests.svc('V-01')], 'delete')
    = '{"updated": 0, "deleted": 2, "archived": 3}'::jsonb,
  'delete: two unused deleted, three used archived');
select tests.assert(
  tests.svc('X-01') is null and tests.svc('V-01') is null
  and (select bool_and(is_archived) from public.services where code in ('T-02', 'S-01', 'T-03'))
  and (select service_id = tests.svc('T-02') from public.deals where name = 'Лечение'),
  'the deal keeps its archived service');

--
-- Cost price and rights
--

select public.set_service_cost(tests.svc('T-01'), 9000);
select tests.assert((select cost_price = 9000 and price = 28700 from public.price_list where id = tests.svc('T-01')),
  'the owner sees the cost price on the page');
select public.set_service_cost(tests.svc('T-01'), 9500);
select tests.assert((select cost_price = 9500 and updated_by = current_setting('t.owner_id')::bigint from public.service_costs where service_id = tests.svc('T-01')),
  'the cost price is replaced');
select public.set_service_cost(tests.svc('D-01'), 1000);
select public.set_service_cost(tests.svc('D-01'), null);
select tests.assert(not exists (select 1 from public.service_costs where service_id = tests.svc('D-01')), 'null removes the cost price');
select tests.throws($q$select public.set_service_cost(tests.svc('T-01'), -1)$q$, '23514', 'a negative cost price is refused');
select tests.logout();

select tests.login_as(current_setting('t.head')::uuid);
select tests.assert((select cost_price = 9500 from public.price_list where id = tests.svc('T-01')), 'the head sees the cost price');
select public.set_service_cost(tests.svc('T-01'), 9600);
select tests.logout();

-- A manager reads the prices, not the cost price, and changes nothing
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(
  (select price = 28700 and cost_price is null and code = 'T-01' from public.price_list where id = tests.svc('T-01')),
  'a manager reads the price but not the cost price');
select tests.assert(tests.count('select 1 from public.service_costs') = 0, 'a manager reads no cost price at all');
select tests.assert(tests.count('select 1 from public.service_categories') > 0
  and tests.count('select 1 from public.service_price_history') > 0,
  'a manager reads the categories and the price history');
select tests.throws($q$select public.set_service_cost(tests.svc('T-01'), 1)$q$, '42501', 'a manager cannot set a cost price');
select tests.throws($q$insert into public.service_costs (service_id, cost_price) values (tests.svc('T-01'), 1)$q$, '42501', 'nor write it directly');
select tests.throws($q$select public.bulk_services(array[tests.svc('T-01')], 'price_percent', 50)$q$, '42501', 'a manager cannot change prices in bulk');
select tests.throws($q$insert into public.service_categories (name) values ('Ортопедия')$q$, '42501', 'a manager cannot add a category');
select tests.assert(tests.affected($q$update public.service_categories set name = 'X'$q$) = 0, 'nor rename one');
select tests.assert(tests.affected($q$update public.services set price = 1$q$) = 0, 'nor change a price');
select tests.throws($q$insert into public.service_price_history (organization_id, service_id, new_price) values (current_setting('t.org')::bigint, tests.svc('T-01'), 1)$q$,
  '42501', 'nobody writes the price history directly');
select tests.logout();

-- The integrator configures the price list but sees no money
select tests.login_as(current_setting('t.int')::uuid);
insert into public.service_categories (name) values ('Ортопедия');
select public.bulk_services(array[tests.svc('D-01')], 'move', null, tests.cat('Ортопедия'));
update public.services set price = 12000 where id = tests.svc('D-01');
select tests.assert(tests.price('D-01') = 12000
  and (select category = 'Ортопедия' from public.services where id = tests.svc('D-01')),
  'the integrator edits the price list and its categories');
select tests.assert((select cost_price is null from public.price_list where id = tests.svc('T-01')), 'the integrator does not see the cost price');
select tests.throws($q$select public.set_service_cost(tests.svc('T-01'), 1)$q$, '42501', 'nor set it');
select tests.logout();

--
-- Clinic isolation
--

select set_config('t.t01', tests.svc('T-01')::text, true);
select set_config('t.ther', tests.cat('Терапия')::text, true);
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.count('select 1 from public.service_categories') = 0
  and tests.count('select 1 from public.service_price_history') = 0
  and tests.count('select 1 from public.service_costs') = 0
  and tests.count(format('select 1 from public.price_list where id = %s', current_setting('t.t01')::bigint)) = 0,
  'another clinic sees nothing of the price list');
select tests.assert(
  public.bulk_services(array[current_setting('t.t01')::bigint], 'price_percent', 50) = '{"updated": 0, "deleted": 0, "archived": 0}'::jsonb
  and public.bulk_services(array[current_setting('t.t01')::bigint], 'delete') = '{"updated": 0, "deleted": 0, "archived": 0}'::jsonb,
  'bulk actions do not reach another clinic');
select tests.throws(format('select public.set_service_cost(%s, 1)', current_setting('t.t01')::bigint), 'P0002', 'nor the cost price');
select tests.throws(format($q$select public.bulk_services(array[1::bigint], 'move', null, %s)$q$, current_setting('t.ther')::bigint),
  '23503', 'a category of another clinic is unknown');
select tests.throws(format($q$insert into public.services (name, category_id) values ('Чужая', %s)$q$, current_setting('t.ther')::bigint),
  '23503', 'a service cannot use a category of another clinic');
insert into public.services (name, category, price) values ('Своя', 'Терапия', 100);
select tests.assert(
  (select category_id <> current_setting('t.ther')::bigint from public.services where name = 'Своя')
  and tests.count('select 1 from public.service_categories') = 1,
  'the same path creates the category in the own clinic');
select tests.logout();

select tests.assert(tests.price('T-01') = 28700, 'the other clinic changed nothing');

rollback;

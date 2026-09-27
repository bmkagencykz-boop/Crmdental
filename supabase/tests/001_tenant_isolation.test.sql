--
-- Tenant isolation: an employee of one clinic can never read, write or
-- reference data of another clinic.
--
begin;
\ir helpers.sql

-- Two clinics sign up by themselves
select set_config('t.alice', tests.sign_up('alice@clinic-a.kz', 'Клиника A')::text, true);
select set_config('t.bob', tests.sign_up('bob@clinic-b.kz', 'Клиника B')::text, true);
select set_config('t.org_a', tests.org_of(current_setting('t.alice')::uuid)::text, true);
select set_config('t.org_b', tests.org_of(current_setting('t.bob')::uuid)::text, true);

select tests.assert(current_setting('t.org_a') <> current_setting('t.org_b'), 'each sign-up creates its own organization');
select tests.assert(
  (select role from public.sales where user_id = current_setting('t.alice')::uuid) = 'owner',
  'the user who signs up owns the organization');
select tests.assert(
  (select name from public.organizations where id = current_setting('t.org_a')::bigint) = 'Клиника A',
  'organization is named after the sign-up form');
select tests.assert(
  (select count(*) from public.configuration where organization_id = current_setting('t.org_a')::bigint) = 1,
  'a configuration row is created with the organization');

-- Alice fills her CRM; organization_id comes from the column default
select tests.login_as(current_setting('t.alice')::uuid);
insert into public.companies (name) values ('Компания A');
insert into public.contacts (first_name, last_name, company_id)
  select 'Пациент', 'A', id from public.companies where name = 'Компания A';
insert into public.contact_notes (contact_id, text) select id, 'заметка A' from public.contacts;
insert into public.deals (name, stage, contact_ids) select 'Сделка A', 'opportunity', array[id] from public.contacts;
insert into public.deal_notes (deal_id, text) select id, 'заметка сделки A' from public.deals;
insert into public.tasks (contact_id, text) select id, 'позвонить' from public.contacts;
insert into public.tags (name, color) values ('VIP', '#ff0000');
select set_config('t.company_a', (select id from public.companies)::text, true);
select set_config('t.contact_a', (select id from public.contacts)::text, true);
select set_config('t.deal_a', (select id from public.deals)::text, true);
select tests.assert(
  (select bool_and(organization_id = current_setting('t.org_a')::bigint) from public.contacts),
  'rows are stamped with the author''s organization');
select tests.assert(
  (select sales_id from public.contacts) = (select id from public.sales where user_id = current_setting('t.alice')::uuid),
  'sales_id defaults to the current user');
select tests.assert(tests.count('select * from public.contacts_summary') = 1, 'alice sees her contact in the summary view');
select tests.logout();

-- Bob sees nothing of clinic A, in tables or views
select tests.login_as(current_setting('t.bob')::uuid);
select tests.assert(tests.count('select * from public.' || t) = 0, 'bob cannot read ' || t)
from unnest(array['companies', 'contacts', 'contact_notes', 'deals', 'deal_notes', 'tasks', 'tags',
                  'contacts_summary', 'companies_summary', 'activity_log']) as t;
select tests.assert(tests.count('select * from public.sales') = 1, 'bob only sees himself among sales');
select tests.assert(tests.count('select * from public.organizations') = 1, 'bob only sees his organization');
select tests.assert(tests.count('select * from public.configuration') = 1, 'bob only sees his configuration');

-- ... cannot change or delete it
select tests.assert(tests.affected('update public.contacts set first_name = ''hacked''') = 0, 'bob cannot update A contacts');
select tests.assert(tests.affected('delete from public.deals') = 0, 'bob cannot delete A deals');
select tests.assert(tests.affected('update public.organizations set name = ''hacked'' where id = ' || current_setting('t.org_a')) = 0, 'bob cannot rename clinic A');
select tests.assert(tests.affected('update public.configuration set config = ''{}'' where organization_id = ' || current_setting('t.org_a')) = 0, 'bob cannot change A configuration');

-- ... cannot write into clinic A
select tests.throws(
  format('insert into public.contacts (organization_id, first_name) values (%s, ''intrus'')', current_setting('t.org_a')),
  '42501', 'bob cannot insert a contact into clinic A');
select tests.throws(
  format('insert into public.tasks (organization_id, contact_id, text) values (%s, %s, ''x'')', current_setting('t.org_a'), current_setting('t.contact_a')),
  '42501', 'bob cannot insert a task into clinic A');

-- ... cannot reference rows of clinic A from his own rows
select tests.throws(
  format('insert into public.contacts (first_name, company_id) values (''B'', %s)', current_setting('t.company_a')),
  '23503', 'bob cannot link a contact to a company of clinic A');
select tests.throws(
  format('insert into public.tasks (contact_id, text) values (%s, ''x'')', current_setting('t.contact_a')),
  '23503', 'bob cannot create a task on a contact of clinic A');
select tests.throws(
  format('insert into public.deal_notes (deal_id, text) values (%s, ''x'')', current_setting('t.deal_a')),
  '23503', 'bob cannot add a note to a deal of clinic A');

-- ... cannot move his own rows into clinic A
insert into public.contacts (first_name) values ('Пациент B');
select tests.throws(
  format('update public.contacts set organization_id = %s', current_setting('t.org_a')),
  '42501', 'bob cannot move a contact into clinic A');
select tests.logout();

-- Alice's data is intact and she does not see Bob's
select tests.login_as(current_setting('t.alice')::uuid);
select tests.assert((select first_name from public.contacts) = 'Пациент', 'A contact untouched');
select tests.assert(tests.count('select * from public.deals') = 1, 'A deal still there');
select tests.assert(tests.count('select * from public.contacts') = 1, 'alice does not see B contacts');
select tests.logout();

-- Anonymous visitors see nothing
select tests.login_anon();
select tests.assert(tests.count('select * from public.' || t) = 0, 'anon cannot read ' || t)
from unnest(array['organizations', 'sales', 'contacts', 'deals', 'configuration']) as t;
select tests.throws('insert into public.contacts (first_name) values (''anon'')', '42501', 'anon cannot write');
select tests.logout();

-- A disabled employee loses access
update public.sales set disabled = true where user_id = current_setting('t.alice')::uuid;
select tests.login_as(current_setting('t.alice')::uuid);
select tests.assert(tests.count('select * from public.contacts') = 0, 'disabled user sees nothing');
select tests.logout();

rollback;

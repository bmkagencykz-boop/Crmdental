--
-- Access rights (stage 30): the defaults are the rules of the roles; the
-- owner changes the matrix of an employee (view, create, edit, delete,
-- export per entity with a scope all / own / own and unassigned / none,
-- reports), and RLS, the reports and the bulk actions follow it. The owner
-- keeps every right; every change is in the audit log; clinics are isolated.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m2', tests.invite('m2@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.int', tests.invite('int@agency.kz', current_setting('t.org')::bigint, 'integrator')::text, true);
select set_config('t.owner_id', (select id from public.sales where email = 'owner@clinic.kz')::text, true);
select set_config('t.head_id', (select id from public.sales where email = 'head@clinic.kz')::text, true);
select set_config('t.m1_id', (select id from public.sales where email = 'm1@clinic.kz')::text, true);
select set_config('t.m2_id', (select id from public.sales where email = 'm2@clinic.kz')::text, true);
select set_config('t.int_id', (select id from public.sales where email = 'int@agency.kz')::text, true);

-- Another clinic
select set_config('t.other', tests.sign_up('owner@second.kz', 'Другая')::text, true);
select set_config('t.other_owner_id', (select id from public.sales where email = 'owner@second.kz')::text, true);
select tests.login_as(current_setting('t.other')::uuid);
update public.task_rules set is_active = false;
insert into public.patients (first_name) values ('Чужой');
insert into public.deals (patient_id, name) select id, 'other' from public.patients;
insert into public.tasks (deal_id, text, due_date) select id, 'other task', now() from public.deals;
select tests.logout();

-- Patients p1 (m1), p2 (m2), p0 (nobody); deals d1 (m1), d2 (m2), d0
-- (unassigned); a task per deal for its responsible, and one for m1 on d2
select tests.login_as(current_setting('t.owner')::uuid);
update public.task_rules set is_active = false;
insert into public.patients (first_name, sales_id) values
  ('p1', current_setting('t.m1_id')::bigint),
  ('p2', current_setting('t.m2_id')::bigint),
  ('p0', null);
update public.patients set sales_id = null where first_name = 'p0';
insert into public.deals (patient_id, name, sales_id)
select p.id, replace(p.first_name, 'p', 'd'), p.sales_id from public.patients p;
update public.deals set sales_id = null where name = 'd0';
insert into public.tasks (deal_id, text, due_date, sales_id)
select d.id, 'task ' || d.name, now(), d.sales_id from public.deals d;
insert into public.tasks (deal_id, text, due_date, sales_id)
select d.id, 'task m1 on d2', now(), current_setting('t.m1_id')::bigint from public.deals d where d.name = 'd2';
insert into public.patient_notes (patient_id, text) select id, 'note ' || first_name from public.patients;
insert into public.calls (patient_id, direction) select id, 'in' from public.patients;
select set_config('t.d1', (select id from public.deals where name = 'd1')::text, true);
select set_config('t.d2', (select id from public.deals where name = 'd2')::text, true);
select set_config('t.d0', (select id from public.deals where name = 'd0')::text, true);
select set_config('t.p2', (select id from public.patients where first_name = 'p2')::text, true);
select tests.logout();

--
-- Defaults: the rules of the roles
--
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(
  (select public.my_access_rights() -> 'rights') = '{
    "deals": {"view": "all", "create": "all", "edit": "all", "delete": "none", "export": "all"},
    "patients": {"view": "all", "create": "all", "edit": "all", "delete": "all", "export": "all"},
    "tasks": {"view": "all", "create": "all", "edit": "all", "delete": "all", "export": "all"},
    "reports": {"view": "none"}}'::jsonb,
  'defaults: a manager works with everything, deletes no deal, has no reports');
select tests.assert((select public.my_access_rights() ->> 'customized') = 'false', 'defaults: not customized');
select tests.assert(tests.count('select * from public.deals') = 3, 'defaults: a manager sees every deal');
select tests.assert(tests.count('select * from public.tasks') = 4, 'defaults: every task');
select tests.assert(tests.count('select * from public.patients') = 3, 'defaults: every patient');
select tests.assert(tests.affected('delete from public.deals where id = ' || current_setting('t.d0')) = 0, 'defaults: a manager deletes no deal');
select tests.throws('select public.report_conversion()', '42501', 'defaults: a manager has no reports');
select tests.throws(format('select public.bulk_deals(''delete'', array[%s])', current_setting('t.d0')), '42501', 'defaults: no bulk deletion for a manager');
select tests.logout();

select tests.login_as(current_setting('t.head')::uuid);
select tests.assert(
  not exists (select 1 from jsonb_each(public.my_access_rights() -> 'rights') e, jsonb_each_text(e.value) a where a.value <> 'all'),
  'defaults: the head has everything');
select tests.logout();

select tests.login_as(current_setting('t.int')::uuid);
select tests.assert(
  (select public.my_access_rights() -> 'rights' -> 'deals') = '{"view": "all", "create": "none", "edit": "none", "delete": "none", "export": "none"}'::jsonb,
  'defaults: the integrator only reads the deals');
select tests.logout();

-- A manager's default view follows the clinic setting
select tests.login_as(current_setting('t.owner')::uuid);
update public.organization_settings set manager_deal_visibility = 'own';
select tests.logout();
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert((select public.my_access_rights() #>> '{rights,deals,view}') = 'own', 'defaults: the clinic setting is the default view');
select tests.assert((select string_agg(name, ',') from public.deals) = 'd1', 'defaults: the clinic setting still applies');
select tests.logout();
select tests.login_as(current_setting('t.owner')::uuid);
update public.organization_settings set manager_deal_visibility = 'all';
select tests.logout();

--
-- Only the owner edits rights; the owner and the integrator are fixed
--
select tests.login_as(current_setting('t.head')::uuid);
select tests.throws(format('select public.save_access_rights(%s, ''{}'')', current_setting('t.m1_id')), '42501', 'the head cannot change rights');
select tests.logout();
select tests.login_as(current_setting('t.m1')::uuid);
select tests.throws(format('select public.save_access_rights(%s, ''{"deals": {"view": "all"}}'')', current_setting('t.m1_id')), '42501', 'an employee cannot change their own rights');
select tests.assert(tests.count('select * from public.access_rights') = 0, 'an employee has no rights row yet');
select tests.throws('insert into public.access_rights (sales_id, rights) values (' || current_setting('t.m1_id') || ', ''{}'')', '42501', 'no direct writes');
select tests.logout();

select tests.login_as(current_setting('t.owner')::uuid);
select tests.throws(format('select public.save_access_rights(%s, ''{"deals": {"view": "none"}}'')', current_setting('t.owner_id')), '22023', 'the owner''s rights are fixed');
select tests.throws(format('select public.save_access_rights(%s, null, false)', current_setting('t.owner_id')), '22023', 'the owner cannot lose the role');
select tests.throws(format('select public.save_access_rights(%s, ''{"deals": {"edit": "all"}}'')', current_setting('t.int_id')), '22023', 'the integrator''s rights are fixed');
select tests.throws(format('select public.save_access_rights(%s, ''{"deals": {"view": "some"}}'')', current_setting('t.m1_id')), '22023', 'an unknown scope is refused');
select tests.throws(format('select public.save_access_rights(%s, ''{"deals": {"create": "own"}}'')', current_setting('t.m1_id')), '22023', 'create only knows all and none');
select tests.throws(format('select public.save_access_rights(%s, ''{"patients": {"view": "own_and_unassigned"}}'')', current_setting('t.m1_id')), '22023', 'own_and_unassigned is for deals only');
select tests.throws(format('select public.save_access_rights(%s, ''{"calls": {"view": "all"}}'')', current_setting('t.m1_id')), '22023', 'an unknown entity is refused');
select tests.throws(format('select public.save_access_rights(%s, ''{}'')', current_setting('t.other_owner_id')), '22023', 'an employee of another clinic is not found');

-- m1: own deals, patients and tasks; no export of deals; reports
select tests.assert(
  (select public.save_access_rights(current_setting('t.m1_id')::bigint, '{
    "deals": {"view": "own", "edit": "own", "delete": "own", "export": "none"},
    "patients": {"view": "own", "edit": "own", "delete": "none", "export": "own"},
    "tasks": {"view": "own", "edit": "own", "delete": "own"},
    "reports": {"view": "all"}}'::jsonb) #>> '{deals,export}') = 'none',
  'the owner saves the rights of a manager');
select tests.assert(
  (select changes -> 'deals.view' from public.audit_log where entity = 'access_rights' and entity_id = current_setting('t.m1_id')::bigint and action = 'update')
    = '["all", "own"]'::jsonb,
  'audit: the change of rights is logged cell by cell');
select tests.assert(
  (select sales_id from public.audit_log where entity = 'access_rights' and entity_id = current_setting('t.m1_id')::bigint) = current_setting('t.owner_id')::bigint,
  'audit: by the owner');
select tests.assert(tests.count('select * from public.access_rights') = 1, 'the owner reads the matrix');
select tests.logout();

select tests.login_as(current_setting('t.head')::uuid);
select tests.assert(tests.count('select * from public.access_rights') = 1, 'the head reads the matrix');
select tests.logout();

select tests.login_as(current_setting('t.m2')::uuid);
select tests.assert(tests.count('select * from public.access_rights') = 0, 'an employee does not read the rights of a colleague');
select tests.logout();

--
-- Scope «own»
--
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert((select public.my_access_rights() ->> 'customized') = 'true', 'own: customized');
select tests.assert(tests.count('select * from public.access_rights') = 1, 'own: an employee reads their own row');
select tests.assert((select string_agg(name, ',') from public.deals) = 'd1', 'own: only own deals');
select tests.assert(tests.count('select * from public.deals_summary') = 1, 'own: the board view follows');
select tests.assert((select string_agg(text, ',') from public.tasks) = 'task d1', 'own: own tasks of visible deals only');
select tests.assert(tests.count('select * from public.deal_events') = 1, 'own: the deal log follows the deal');
select tests.assert((select string_agg(first_name, ',') from public.patients) = 'p1', 'own: only own patients');
select tests.assert((select string_agg(text, ',') from public.patient_notes) = 'note p1', 'own: notes follow the patient');
select tests.assert(tests.count('select * from public.calls') = 1, 'own: calls follow the patient');
select tests.assert(tests.affected('update public.deals set name = ''x'' where id = ' || current_setting('t.d2')) = 0, 'own: no edit of a colleague''s deal');
select tests.assert(tests.affected('update public.deals set name = ''d1'' where id = ' || current_setting('t.d1')) = 1, 'own: edit of an own deal');
select tests.assert(tests.affected('update public.patients set city = ''Алматы'' where id = ' || current_setting('t.p2')) = 0, 'own: no edit of a colleague''s patient');
select tests.assert(tests.affected('update public.patients set city = ''Алматы'' where first_name = ''p1''') = 1, 'own: edit of an own patient');
select tests.assert(tests.affected('delete from public.patients where first_name = ''p1''') = 0, 'own: patients delete «none»');
select tests.throws(
  format('insert into public.tasks (deal_id, text, due_date) values (%s, ''x'', now())', current_setting('t.d2')),
  '42501', 'own: no task on an invisible deal');
-- Reports are computed on what the employee sees
select tests.assert(public.report_conversion() is not null, 'own: the reports are open');
select tests.logout();

-- SECURITY DEFINER code: private.deal_visible follows the same rule
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('t.m1'), 'role', 'authenticated')::text, true);
select tests.assert((select count(*) from public.deals d where private.deal_visible(d)) = 1, 'own: private.deal_visible follows the view scope');
select tests.logout();

--
-- Scope «own and unassigned», «none», create «none»
--
select tests.login_as(current_setting('t.owner')::uuid);
select public.save_access_rights(current_setting('t.m2_id')::bigint, '{
  "deals": {"view": "own_and_unassigned", "edit": "own_and_unassigned", "delete": "own_and_unassigned"},
  "tasks": {"create": "none", "delete": "none"},
  "patients": {"create": "none"}}'::jsonb);
select tests.logout();

select tests.login_as(current_setting('t.m2')::uuid);
select tests.assert((select string_agg(name, ',' order by name) from public.deals) = 'd0,d2', 'own_and_unassigned: own deals and the unassigned ones');
select tests.assert(tests.count('select * from public.patients') = 3, 'own_and_unassigned: patients stay «all»');
select tests.throws(
  format('insert into public.tasks (deal_id, text, due_date) values (%s, ''x'', now())', current_setting('t.d2')),
  '42501', 'create none: no new task');
select tests.throws('insert into public.patients (first_name) values (''new'')', '42501', 'create none: no new patient');
select tests.assert(tests.affected('delete from public.tasks where deal_id = ' || current_setting('t.d2')) = 0, 'delete none: no task deleted');
select tests.assert(
  tests.affected('update public.deals set sales_id = ' || current_setting('t.m2_id') || ' where id = ' || current_setting('t.d0')) = 1,
  'own_and_unassigned: takes an unassigned deal');
select tests.logout();

select tests.login_as(current_setting('t.owner')::uuid);
update public.deals set sales_id = null where id = current_setting('t.d0')::bigint;
select public.save_access_rights(current_setting('t.m2_id')::bigint, '{"deals": {"view": "none", "create": "none"}}'::jsonb);
select tests.logout();

select tests.login_as(current_setting('t.m2')::uuid);
select tests.assert(tests.count('select * from public.deals') = 0, 'none: no deal');
select tests.assert(tests.count('select * from public.tasks') = 0, 'none: no task of a deal');
select tests.assert(tests.count('select * from public.patients') = 3, 'none on deals: patients stay visible');
select tests.throws(
  format('insert into public.deals (patient_id, name) values (%s, ''new'')', current_setting('t.p2')),
  '42501', 'create none: no new deal');
select tests.logout();

-- Patients «none»: only the patients of visible deals
select tests.login_as(current_setting('t.owner')::uuid);
select public.save_access_rights(current_setting('t.m2_id')::bigint, '{"deals": {"view": "own"}, "patients": {"view": "none"}}'::jsonb);
select tests.logout();
select tests.login_as(current_setting('t.m2')::uuid);
select tests.assert((select string_agg(first_name, ',') from public.patients) = 'p2', 'patients none: only the patient of a visible deal');
select tests.logout();

--
-- Delete scopes and bulk deletion
--
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(tests.affected('delete from public.tasks where text = ''task d1''') = 1, 'tasks delete own: own task deleted');
select tests.assert(
  (select (public.bulk_deals('delete', array[current_setting('t.d1')::bigint]) ->> 'ok')::int) = 1,
  'deals delete own: bulk deletion of an own deal');
select tests.logout();

--
-- The head: rights can be narrowed; «Настройки» is the role
--
select tests.login_as(current_setting('t.owner')::uuid);
select public.save_access_rights(current_setting('t.head_id')::bigint, '{"deals": {"view": "own"}, "reports": {"view": "none"}}'::jsonb);
select tests.logout();
select tests.login_as(current_setting('t.head')::uuid);
select tests.assert(tests.count('select * from public.deals') = 0, 'head: the owner narrows the deals of a head');
select tests.throws('select public.report_conversion()', '42501', 'head: the owner takes the reports');
select tests.logout();

select tests.login_as(current_setting('t.owner')::uuid);
select public.save_access_rights(current_setting('t.head_id')::bigint, null);
select tests.assert(
  exists (select 1 from public.audit_log where entity = 'access_rights' and entity_id = current_setting('t.head_id')::bigint and action = 'reset'),
  'audit: a reset is logged');
select public.save_access_rights(current_setting('t.m2_id')::bigint, '{"reports": {"view": "all"}}'::jsonb, true);
select tests.assert((select role from public.sales where id = current_setting('t.m2_id')::bigint) = 'head', 'settings: the owner gives the settings (role head)');
select tests.assert(
  exists (select 1 from public.audit_log where entity = 'employee' and entity_id = current_setting('t.m2_id')::bigint and action = 'role_change'),
  'audit: the role change is logged');
select public.save_access_rights(current_setting('t.m2_id')::bigint, null, false);
select tests.assert((select role from public.sales where id = current_setting('t.m2_id')::bigint) = 'manager', 'settings: and takes them back');
select tests.assert(tests.count('select * from public.access_rights') = 1, 'reset: only m1 keeps custom rights');
select tests.logout();

select tests.login_as(current_setting('t.head')::uuid);
select tests.assert(tests.count('select * from public.deals') = 2, 'head: back to every deal after the reset');
select tests.logout();

--
-- The owner keeps every right, even with a row written behind the API
--
insert into public.access_rights (organization_id, sales_id, rights)
values (current_setting('t.org')::bigint, current_setting('t.owner_id')::bigint, '{"deals": {"view": "none"}, "reports": {"view": "none"}}');
select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert(tests.count('select * from public.deals') = 2, 'owner: always every deal');
select tests.assert(public.report_conversion() is not null, 'owner: always the reports');
select tests.assert((select count(*) from public.sales where role = 'owner') = 1, 'owner: the clinic keeps its owner');
select tests.logout();

--
-- Clinic isolation
--
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.count('select * from public.access_rights') = 0, 'isolation: another clinic reads no rights');
select tests.throws(format('select public.save_access_rights(%s, ''{}'')', current_setting('t.m1_id')), '22023', 'isolation: another clinic cannot change them');
select tests.assert(tests.count('select * from public.audit_log where entity = ''access_rights''') = 0, 'isolation: nor read their log');
select tests.logout();

select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(tests.count('select * from public.deals where name = ''other''') = 0, 'isolation: «all» stays inside the clinic');
select tests.logout();

rollback;

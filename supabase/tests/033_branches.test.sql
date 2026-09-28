--
-- Branches (stage 33): the dictionary and the employees' branches (owner and
-- head), the branch of deals, tasks and visits, the scope «Мой филиал» of
-- the access rights, lead routing to a branch (channel, website form, call)
-- and distribution among its employees, the branch filter of the reports,
-- a clinic without branches unchanged, clinic isolation.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m2', tests.invite('m2@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m3', tests.invite('m3@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.owner_id', (select id from public.sales where email = 'owner@clinic.kz')::text, true);
select set_config('t.m1_id', (select id from public.sales where email = 'm1@clinic.kz')::text, true);
select set_config('t.m2_id', (select id from public.sales where email = 'm2@clinic.kz')::text, true);
select set_config('t.m3_id', (select id from public.sales where email = 'm3@clinic.kz')::text, true);
select set_config('t.other', tests.sign_up('owner@second.kz', 'Другая')::text, true);
select set_config('t.other_org', tests.org_of(current_setting('t.other')::uuid)::text, true);

update public.task_rules set is_active = false;

create function tests.ingest(token text, message jsonb) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  execute 'set local role service_role';
  result := public.ingest_message(token, message);
  execute 'reset role';
  return result;
end;
$$;
create function tests.lead(token text, lead jsonb) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  execute 'set local role service_role';
  result := public.ingest_lead(token, lead);
  execute 'reset role';
  return result;
end;
$$;
create function tests.call(token text, call jsonb) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  execute 'set local role service_role';
  result := public.ingest_call(token, 'generic', call);
  execute 'reset role';
  return result;
end;
$$;
-- A lead from outside (no user): distributed by the clinic rules
create function tests.external_deal(label text, branch bigint default null) returns bigint language plpgsql as $$
declare patient bigint; deal bigint;
begin
  insert into public.patients (organization_id, first_name)
  values (current_setting('t.org')::bigint, label) returning id into patient;
  insert into public.deals (organization_id, patient_id, name, branch_id)
  values (current_setting('t.org')::bigint, patient, label, branch) returning id into deal;
  return deal;
end;
$$;
create function tests.branch(branch_name text) returns bigint language sql as $$
  select id from public.branches where name = branch_name
$$;
-- Security definer: the id whoever is logged in
create function tests.deal(deal_name text) returns bigint language sql security definer as $$
  select id from public.deals where name = deal_name
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

--
-- A clinic without branches works as before
--
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(public.my_access_rights() -> 'branch_ids' = '[]'::jsonb, 'no branches: an employee works in none');
insert into public.patients (first_name) values ('До филиалов');
insert into public.deals (patient_id, name) select id, 'before' from public.patients where first_name = 'До филиалов';
select tests.assert((select branch_id from public.deals where name = 'before') is null, 'no branches: a deal has no branch');
select tests.assert(
  (select branch_id is null and branch_name is null from public.deals_summary where name = 'before'),
  'deals_summary shows no branch');
insert into public.tasks (deal_id, text, due_date) select id, 'before task', now() from public.deals where name = 'before';
select tests.assert((select branch_id from public.tasks where text = 'before task') is null, 'no branches: a task has no branch');
select tests.logout();

--
-- The dictionary: the owner and the head manage it, everybody reads it
--
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.branches (name, address, phone, position) values
  ('Филиал Достык', 'пр. Достык, 5', '+7 727 111 11 11', 0),
  ('Филиал на Абая', 'пр. Абая, 10', '+7 727 222 22 22', 1);
select set_config('t.A', tests.branch('Филиал Достык')::text, true);
select set_config('t.B', tests.branch('Филиал на Абая')::text, true);
-- m1 works in A, m2 in B, m3 in both
insert into public.sales_branches (sales_id, branch_id) values
  (current_setting('t.m1_id')::bigint, current_setting('t.A')::bigint),
  (current_setting('t.m2_id')::bigint, current_setting('t.B')::bigint),
  (current_setting('t.m3_id')::bigint, current_setting('t.A')::bigint),
  (current_setting('t.m3_id')::bigint, current_setting('t.B')::bigint);
select tests.logout();

select tests.login_as(current_setting('t.head')::uuid);
update public.branches set phone = '+7 727 222 22 23' where id = current_setting('t.B')::bigint;
select tests.assert((select phone from public.branches where id = current_setting('t.B')::bigint) = '+7 727 222 22 23', 'the head edits a branch');
select tests.logout();

select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(tests.count('select * from public.branches') = 2, 'an employee reads the branches');
select tests.assert(public.my_access_rights() -> 'branch_ids' = jsonb_build_array(current_setting('t.A')::bigint), 'an employee knows their branches');
select tests.throws($q$insert into public.branches (name) values ('Мой')$q$, '42501', 'a manager cannot add a branch');
select tests.assert(tests.affected('update public.branches set name = ''x''') = 0, 'a manager cannot rename a branch');
select tests.throws(
  format('insert into public.sales_branches (sales_id, branch_id) values (%s, %s)', current_setting('t.m1_id'), current_setting('t.B')),
  '42501', 'a manager cannot choose their branches');
select tests.throws(format('select public.assign_branch_to_unassigned(%s)', current_setting('t.A')), '42501', 'a manager cannot attach the deals to a branch');
select tests.logout();

select tests.login_as(current_setting('t.owner')::uuid);
select tests.throws($q$insert into public.branches (name) values (' ')$q$, '23514', 'a branch needs a name');
-- The audit log
select tests.assert(
  exists (select 1 from public.audit_log where entity = 'branch' and action = 'create' and changes -> 'name' ->> 1 = 'Филиал Достык'),
  'a new branch is in the audit log');
select tests.logout();

--
-- The branch of a new deal: given, else the doctor's, else the responsible's
--
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.doctors (name, branch_id) values ('Врач Абая', current_setting('t.B')::bigint), ('Врач сети', null);
insert into public.chairs (name, branch_id) values ('Кресло Достык', current_setting('t.A')::bigint);
insert into public.patients (first_name) values ('Пациент');
select set_config('t.patient', (select id from public.patients where first_name = 'Пациент')::text, true);
insert into public.deals (patient_id, name, branch_id, sales_id) values
  (current_setting('t.patient')::bigint, 'given A', current_setting('t.A')::bigint, current_setting('t.m2_id')::bigint);
insert into public.deals (patient_id, name, doctor_id)
  select current_setting('t.patient')::bigint, 'doctor B', id from public.doctors where name = 'Врач Абая';
insert into public.deals (patient_id, name, sales_id) values
  (current_setting('t.patient')::bigint, 'resp m1', current_setting('t.m1_id')::bigint),
  (current_setting('t.patient')::bigint, 'resp m2', current_setting('t.m2_id')::bigint),
  (current_setting('t.patient')::bigint, 'resp m3', current_setting('t.m3_id')::bigint),
  (current_setting('t.patient')::bigint, 'owner none', null);
select tests.assert(
  (select branch_id from public.deals where name = 'given A') = current_setting('t.A')::bigint
  and (select branch_id from public.deals where name = 'doctor B') = current_setting('t.B')::bigint
  and (select branch_id from public.deals where name = 'resp m1') = current_setting('t.A')::bigint
  and (select branch_id from public.deals where name = 'resp m2') = current_setting('t.B')::bigint,
  'a deal gets the given branch, else the doctor''s, else its responsible''s');
select tests.assert(
  (select branch_id from public.deals where name = 'resp m3') is null
  and (select branch_id from public.deals where name = 'owner none') is null,
  'no guess for an employee of several branches or of none');
select tests.assert(
  (select branch_name from public.deals_summary where name = 'doctor B') = 'Филиал на Абая',
  'deals_summary shows the branch name');
-- Choosing a doctor for a deal without a branch gives it the doctor's branch
update public.deals set doctor_id = (select id from public.doctors where name = 'Врач Абая') where name = 'owner none';
select tests.assert((select branch_id from public.deals where name = 'owner none') = current_setting('t.B')::bigint, 'the doctor gives a branch to a deal without one');
-- A branch removed by hand stays removed
update public.deals set branch_id = null where name = 'owner none';
update public.deals set doctor_id = null where name = 'owner none';
select tests.assert((select branch_id from public.deals where name = 'owner none') is null, 'a removed branch is not guessed again');
select tests.logout();

-- The employee creating a deal gives it their branch
select tests.login_as(current_setting('t.m2')::uuid);
insert into public.deals (patient_id, name) values (current_setting('t.patient')::bigint, 'created by m2');
select tests.assert((select branch_id from public.deals where name = 'created by m2') = current_setting('t.B')::bigint, 'a deal created by an employee of one branch is in that branch');
select tests.logout();

--
-- Tasks follow the branch of their deal
--
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.tasks (deal_id, text, due_date, sales_id, branch_id)
select id, 'task given A', now(), current_setting('t.m2_id')::bigint, current_setting('t.B')::bigint from public.deals where name = 'given A';
select tests.assert((select branch_id from public.tasks where text = 'task given A') = current_setting('t.A')::bigint, 'a task is in the branch of its deal, whatever is written');
update public.deals set branch_id = current_setting('t.B')::bigint where name = 'given A';
select tests.assert((select branch_id from public.tasks where text = 'task given A') = current_setting('t.B')::bigint, 'a task follows its deal to another branch');
update public.deals set branch_id = current_setting('t.A')::bigint where name = 'given A';
select tests.assert((select branch_id from public.tasks where text = 'task given A') = current_setting('t.A')::bigint, 'and back');
insert into public.tasks (deal_id, text, due_date, sales_id)
select id, 'task doctor B', now(), current_setting('t.m1_id')::bigint from public.deals where name = 'doctor B';
insert into public.tasks (deal_id, text, due_date, sales_id)
select id, 'task resp m2', now(), current_setting('t.m2_id')::bigint from public.deals where name = 'resp m2';

--
-- Visits: the branch of the chair, else of the doctor, else of the deal
--
insert into public.visits (patient_id, deal_id, chair_id, starts_at, ends_at)
select current_setting('t.patient')::bigint, tests.deal('doctor B'), c.id, '2026-10-01 10:00+05', '2026-10-01 10:30+05'
from public.chairs c where c.name = 'Кресло Достык';
insert into public.visits (patient_id, deal_id, doctor_id, starts_at, ends_at)
select current_setting('t.patient')::bigint, tests.deal('given A'), d.id, '2026-10-01 11:00+05', '2026-10-01 11:30+05'
from public.doctors d where d.name = 'Врач Абая';
insert into public.visits (patient_id, deal_id, starts_at, ends_at)
values (current_setting('t.patient')::bigint, tests.deal('resp m2'), '2026-10-01 12:00+05', '2026-10-01 12:30+05');
select tests.assert(
  (select array_agg(branch_id order by starts_at) from public.visits where patient_id = current_setting('t.patient')::bigint)
    = array[current_setting('t.A')::bigint, current_setting('t.B')::bigint, current_setting('t.B')::bigint],
  'a visit is in the branch of its chair, else its doctor, else its deal');
update public.visits set chair_id = null, doctor_id = (select id from public.doctors where name = 'Врач Абая')
where starts_at = '2026-10-01 10:00+05';
select tests.assert(
  (select branch_id from public.visits where starts_at = '2026-10-01 10:00+05') = current_setting('t.B')::bigint,
  'moving a visit to a doctor of another branch moves it there');
select tests.logout();

--
-- Rights: «Мой филиал»
--
select tests.login_as(current_setting('t.owner')::uuid);
select public.save_access_rights(current_setting('t.m1_id')::bigint,
  '{"deals": {"view": "branch", "edit": "branch", "delete": "branch", "export": "branch"}, "tasks": {"view": "branch", "edit": "branch"}}'::jsonb);
select tests.throws(
  format($q$select public.save_access_rights(%s, '{"patients": {"view": "branch"}}')$q$, current_setting('t.m1_id')),
  '22023', 'patients are shared by the network: no «Мой филиал»');
select tests.throws(
  format($q$select public.save_access_rights(%s, '{"deals": {"create": "branch"}}')$q$, current_setting('t.m1_id')),
  '22023', 'creating is yes or no');
select tests.assert(
  exists (select 1 from public.audit_log where entity = 'access_rights' and changes -> 'deals.view' = '["all", "branch"]'::jsonb),
  'the new scope is in the audit log');
select tests.logout();

select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert((public.my_access_rights() #>> '{rights,deals,view}') = 'branch', 'm1 has «Мой филиал»');
-- Deals of A ('given A', 'resp m1'), without a branch ('before', 'resp m3',
-- 'owner none'), not of B ('doctor B', 'resp m2', 'created by m2')
select tests.assert(
  (select array_agg(name order by name) from public.deals where organization_id = current_setting('t.org')::bigint)
    = array['before', 'given A', 'owner none', 'resp m1', 'resp m3'],
  '«Мой филиал»: deals of my branches and without a branch');
select tests.assert(tests.affected(format('update public.deals set name = %L where id = %s', 'x', tests.deal('doctor B'))) = 0,
  '«Мой филиал»: a deal of another branch cannot be edited');
select tests.assert(tests.affected(format('update public.deals set description = %L where id = %s', 'ok', tests.deal('given A'))) = 1,
  '«Мой филиал»: a deal of my branch can be edited');
select tests.logout();

-- Own deals stay visible in another branch
select tests.login_as(current_setting('t.owner')::uuid);
update public.deals set sales_id = current_setting('t.m1_id')::bigint where name = 'resp m2';
insert into public.tasks (deal_id, text, due_date, sales_id)
select id, 'm1 task on resp m2', now(), current_setting('t.m1_id')::bigint from public.deals where name = 'resp m2';
select tests.logout();
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(tests.count(format('select 1 from public.deals where id = %s', tests.deal('resp m2'))) = 1, '«Мой филиал»: own deals of another branch stay visible');
-- Tasks: of my branch, and my own
select tests.assert(
  (select array_agg(text order by text) from public.tasks where organization_id = current_setting('t.org')::bigint)
    = array['before task', 'm1 task on resp m2', 'task given A'],
  '«Мой филиал»: tasks of my branches, without a branch, and my own of visible deals');
select tests.assert(tests.count('select 1 from public.tasks where text = ''task doctor B''') = 0,
  '«Мой филиал»: my task on a deal of another branch is hidden with the deal');
-- Visits follow the deals
select tests.assert(tests.count(format('select 1 from public.visits where deal_id = %s', tests.deal('doctor B'))) = 0,
  'visits of hidden deals are hidden');
select tests.logout();

-- private.deal_visible follows the same rule (SECURITY DEFINER code)
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('t.m1'), 'role', 'authenticated')::text, true);
select tests.assert(
  private.deal_visible((select d from public.deals d where d.name = 'given A'))
  and private.deal_visible((select d from public.deals d where d.name = 'resp m2'))
  and not private.deal_visible((select d from public.deals d where d.name = 'doctor B')),
  'deal_visible: my branch and my own, not another branch');
select tests.logout();

-- An employee of several branches sees both; the head sees everything
select tests.login_as(current_setting('t.owner')::uuid);
select public.save_access_rights(current_setting('t.m3_id')::bigint, '{"deals": {"view": "branch"}}'::jsonb);
select tests.logout();
select tests.login_as(current_setting('t.m3')::uuid);
select tests.assert(tests.count('select 1 from public.deals') = 8, 'an employee of two branches sees both');
select tests.logout();

--
-- Lead routing: a channel, a website form, a call; distribution in the branch
--
insert into public.messenger_integrations (organization_id, api_key, webhook_token, connected_at)
values (current_setting('t.org')::bigint, 'key', 'wz-branches', now());
select tests.ingest('wz-branches', '{"channel_id":"ch-abaya","transport":"whatsapp","chat_id":"77010000001","text":"Здравствуйте"}');
select set_config('t.channel', (select id from public.messenger_channels where external_id = 'ch-abaya')::text, true);

select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(tests.affected(format('update public.messenger_channels set branch_id = %s', current_setting('t.B'))) = 0,
  'a manager cannot map a channel');
select tests.logout();
select tests.login_as(current_setting('t.head')::uuid);
select tests.assert(tests.affected(format('update public.messenger_channels set branch_id = %s where id = %s', current_setting('t.B'), current_setting('t.channel'))) = 1,
  'the head maps a channel to a branch');
select tests.throws(format('update public.messenger_channels set name = %L', 'x'), '42501', 'only the branch of a channel is writable');
select tests.logout();

update public.organization_settings
set lead_distribution = 'round_robin',
    lead_distribution_sales_ids = array[current_setting('t.m1_id')::bigint, current_setting('t.m2_id')::bigint],
    last_distributed_sales_id = null
where organization_id = current_setting('t.org')::bigint;

select set_config('t.msg', tests.ingest('wz-branches', '{"channel_id":"ch-abaya","transport":"whatsapp","chat_id":"77010000002","text":"Хочу на приём"}')::text, true);
select tests.assert(
  (select branch_id from public.deals where id = (current_setting('t.msg')::jsonb ->> 'deal_id')::bigint) = current_setting('t.B')::bigint,
  'a message of a mapped channel opens a deal in its branch');
select tests.assert(
  (select sales_id from public.deals where id = (current_setting('t.msg')::jsonb ->> 'deal_id')::bigint) = current_setting('t.m2_id')::bigint,
  'the lead of a branch goes to a chosen employee of that branch');
select tests.assert(tests.external_deal('lead B2', current_setting('t.B')::bigint) is not null, 'second lead of B');
select tests.assert((select sales_id from public.deals where name = 'lead B2') = current_setting('t.m2_id')::bigint,
  'every lead of the branch goes to its employees (not the next in the clinic''s turn)');
select tests.assert(tests.external_deal('lead A', current_setting('t.A')::bigint) is not null, 'lead of A');
select tests.assert((select sales_id from public.deals where name = 'lead A') = current_setting('t.m1_id')::bigint,
  'a lead of the other branch goes to its employee');
-- None of the chosen employees works in the branch: all the chosen ones
update public.organization_settings set lead_distribution_sales_ids = array[current_setting('t.m1_id')::bigint]
where organization_id = current_setting('t.org')::bigint;
select tests.assert(tests.external_deal('lead B3', current_setting('t.B')::bigint) is not null, 'third lead of B');
select tests.assert((select sales_id from public.deals where name = 'lead B3') = current_setting('t.m1_id')::bigint,
  'a branch without a chosen employee: the lead is not lost');
-- A lead without a branch: the usual turn
update public.organization_settings set lead_distribution_sales_ids = array[current_setting('t.m1_id')::bigint, current_setting('t.m2_id')::bigint],
  last_distributed_sales_id = current_setting('t.m1_id')::bigint
where organization_id = current_setting('t.org')::bigint;
select tests.assert(tests.external_deal('lead any') is not null, 'lead without a branch');
select tests.assert((select sales_id from public.deals where name = 'lead any') = current_setting('t.m2_id')::bigint,
  'a lead without a branch follows the clinic''s turn');

-- First to answer: among the chosen employees of the branch
update public.organization_settings set lead_distribution = 'first_response'
where organization_id = current_setting('t.org')::bigint;
select tests.assert(tests.external_deal('fr B', current_setting('t.B')::bigint) is not null, 'first response lead');
insert into public.messages (organization_id, patient_id, deal_id, transport, chat_id, direction, text, sales_id)
select organization_id, patient_id, id, 'whatsapp', '1', 'out', 'Здравствуйте', current_setting('t.m1_id')::bigint
from public.deals where name = 'fr B';
select tests.assert((select sales_id from public.deals where name = 'fr B') is null,
  'an employee of another branch does not take the lead by answering');
insert into public.messages (organization_id, patient_id, deal_id, transport, chat_id, direction, text, sales_id)
select organization_id, patient_id, id, 'whatsapp', '1', 'out', 'Добрый день', current_setting('t.m2_id')::bigint
from public.deals where name = 'fr B';
select tests.assert((select sales_id from public.deals where name = 'fr B') = current_setting('t.m2_id')::bigint,
  'an employee of the branch takes it');
select tests.assert(
  private.deal_audience((select d from public.deals d where d.name = 'lead any')) is not null,
  'audience of a deal');
update public.deals set sales_id = null where name = 'fr B';
select tests.assert(
  private.deal_audience((select d from public.deals d where d.name = 'fr B')) = array[current_setting('t.m2_id')::bigint],
  'an unassigned lead of a branch notifies the chosen employees of that branch');
update public.organization_settings set lead_distribution = 'off'
where organization_id = current_setting('t.org')::bigint;

-- A website form names the branch
select tests.login_as(current_setting('t.owner')::uuid);
select set_config('t.token', public.lead_webhook_token(), true);
select tests.logout();
select set_config('t.lead', tests.lead(current_setting('t.token'), '{"name":"Сайт","phone":"87010000003","branch":"филиал на абая"}')::text, true);
select tests.assert(
  (select branch_id from public.deals where id = (current_setting('t.lead')::jsonb ->> 'deal_id')::bigint) = current_setting('t.B')::bigint,
  'a website form with a branch name lands in that branch');
select tests.assert(
  (select text from public.deal_notes where deal_id = (current_setting('t.lead')::jsonb ->> 'deal_id')::bigint) like '%Филиал: Филиал на Абая%',
  'the note names the branch');
select set_config('t.lead2', tests.lead(current_setting('t.token'), jsonb_build_object('name', 'Сайт 2', 'phone', '87010000004', 'branch', current_setting('t.A')))::text, true);
select tests.assert(
  (select branch_id from public.deals where id = (current_setting('t.lead2')::jsonb ->> 'deal_id')::bigint) = current_setting('t.A')::bigint,
  'a website form with a branch id lands in that branch');
select set_config('t.lead3', tests.lead(current_setting('t.token'), '{"name":"Сайт 3","phone":"87010000005","branch":"Нет такого"}')::text, true);
select tests.assert(
  (select branch_id from public.deals where id = (current_setting('t.lead3')::jsonb ->> 'deal_id')::bigint) is null,
  'an unknown branch: the lead has no branch');

-- A call through a branch's number
insert into public.telephony_integrations (organization_id, provider, webhook_token)
values (current_setting('t.org')::bigint, 'generic', 'tel-branches');
select set_config('t.call', tests.call('tel-branches', '{"call_id":"c1","phone":"+77010000006","line":"87272222223","status":"answered"}')::text, true);
select tests.assert(
  (select branch_id from public.deals where id = (current_setting('t.call')::jsonb ->> 'deal_id')::bigint) = current_setting('t.B')::bigint,
  'a call to a branch''s number lands in that branch');
select tests.login_as(current_setting('t.owner')::uuid);
select public.set_sales_phone_extension(current_setting('t.m1_id')::bigint, '101');
select tests.logout();
select set_config('t.call2', tests.call('tel-branches', '{"call_id":"c2","phone":"+77010000007","extension":"101","status":"answered"}')::text, true);
select tests.assert(
  (select branch_id from public.deals where id = (current_setting('t.call2')::jsonb ->> 'deal_id')::bigint) = current_setting('t.A')::bigint,
  'a call answered by an employee of one branch lands in that branch');

--
-- Reports: the branch filter
--
select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert(
  (public.report_conversion(filter_branch_id => current_setting('t.A')::bigint) -> 'totals' ->> 'deals')::int
    = (select count(*) from public.deals where branch_id = current_setting('t.A')::bigint),
  'the conversion report counts the deals of the branch');
select tests.assert(
  (public.report_conversion() -> 'totals' ->> 'deals')::int = (select count(*) from public.deals),
  'without a branch: every deal');
select tests.assert(
  (public.report_lost_reasons(null, null, null, null, null, null, current_setting('t.B')::bigint) -> 'totals' ->> 'deals')::int = 0
  and public.report_money(filter_branch_id => current_setting('t.B')::bigint) ? 'totals'
  and public.report_speed(filter_branch_id => current_setting('t.B')::bigint) ? 'by_sales'
  and jsonb_typeof(public.report_plan_services(filter_branch_id => current_setting('t.B')::bigint)) = 'array',
  'every report takes the branch');
select tests.assert(
  not exists (
    select 1 from jsonb_array_elements(public.report_speed(filter_branch_id => current_setting('t.A')::bigint) -> 'by_sales') s
    where (s ->> 'id')::bigint = (select id from public.sales where email = 'head@clinic.kz')
  )
  and exists (
    select 1 from jsonb_array_elements(public.report_speed() -> 'by_sales') s
    where (s ->> 'id')::bigint = (select id from public.sales where email = 'head@clinic.kz')
  ),
  'the speed report of a branch lists its employees and those with activity in it');
select tests.logout();

--
-- «Привязать к филиалу» and deleting a branch
--
select tests.login_as(current_setting('t.owner')::uuid);
select set_config('t.moved', public.assign_branch_to_unassigned(current_setting('t.A')::bigint)::text, true);
select tests.assert((current_setting('t.moved')::jsonb ->> 'deals')::int > 0, 'the deals without a branch are attached');
select tests.assert(tests.count('select 1 from public.deals where branch_id is null') = 0, 'no deal without a branch any more');
select tests.assert(tests.count('select 1 from public.tasks where branch_id is null') = 0, 'their tasks follow');
select tests.throws(format('delete from public.branches where id = %s', current_setting('t.A')), '23503', 'a branch with deals cannot be deleted');
insert into public.branches (name) values ('Пустой');
insert into public.doctors (name, branch_id) values ('Врач пустого', tests.branch('Пустой'));
delete from public.branches where name = 'Пустой';
select tests.assert((select branch_id from public.doctors where name = 'Врач пустого') is null, 'a deleted branch leaves its doctors to the network');
select tests.logout();

--
-- Clinic isolation
--
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.count('select 1 from public.branches') = 0, 'another clinic sees no branch');
select tests.assert(tests.count('select 1 from public.sales_branches') = 0, 'nor the employees'' branches');
insert into public.patients (first_name) values ('Чужой');
select tests.throws(
  format('insert into public.deals (patient_id, name, branch_id) select id, %L, %s from public.patients', 'foreign', current_setting('t.A')),
  '23503', 'a deal cannot point at a branch of another clinic');
insert into public.branches (name) values ('Свой');
select tests.throws(
  format('insert into public.sales_branches (sales_id, branch_id) values (%s, %s)', current_setting('t.m1_id'), (select id from public.branches where name = 'Свой')),
  '23503', 'an employee of another clinic cannot be put in a branch');
select tests.assert(tests.affected(format('update public.branches set name = %L where id = %s', 'x', current_setting('t.A'))) = 0,
  'another clinic cannot rename a branch');
select tests.throws(format('select public.assign_branch_to_unassigned(%s)', current_setting('t.A')), '22023', 'nor attach deals to it');
select tests.logout();

rollback;

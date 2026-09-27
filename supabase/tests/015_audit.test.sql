--
-- Audit log (stage 15): every covered action logs its author, source and the
-- diff of the changed fields; system actions have no author and a source;
-- only the owner and the head read the log; nobody writes or deletes it;
-- clinics are isolated; secrets never reach the log.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.owner_id', (select id from public.sales where email = 'owner@clinic.kz')::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.head_id', (select id from public.sales where email = 'head@clinic.kz')::text, true);
select set_config('t.m1_id', (select id from public.sales where email = 'm1@clinic.kz')::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);
select set_config('t.other_org', tests.org_of(current_setting('t.other')::uuid)::text, true);

-- The last log row of an entity (as the superuser: RLS does not apply)
create function tests.last(entity_name text, action_name text default null) returns public.audit_log
language sql as $$
  select * from public.audit_log
  where organization_id = current_setting('t.org')::bigint and entity = entity_name
    and (action_name is null or action = action_name)
  order by id desc limit 1
$$;
create function tests.stage(stage_name text) returns bigint language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
  where p.organization_id = current_setting('t.org')::bigint and p.is_default and s.name = stage_name
$$;
-- The edge functions call PostgREST with the service role key, and say which
-- employee they act for in the x-crm-actor header
create function tests.as_service(actor bigint default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.headers',
    case when actor is null then '{}' else jsonb_build_object('x-crm-actor', actor::text)::text end, true);
  execute 'set local role service_role';
end;
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- Employees: the owner's sign-up, invitations with the inviting employee
select tests.assert(
  (select sales_id from public.audit_log where entity = 'employee' and entity_id = current_setting('t.owner_id')::bigint) = current_setting('t.owner_id')::bigint
  and (select action from public.audit_log where entity = 'employee' and entity_id = current_setting('t.owner_id')::bigint) = 'create',
  'the owner signing up is logged');
select tests.assert(
  (select action from public.audit_log where entity = 'employee' and entity_id = current_setting('t.m1_id')::bigint) = 'invite'
  and (select changes -> 'role' from public.audit_log where entity = 'employee' and entity_id = current_setting('t.m1_id')::bigint) = '[null, "manager"]'::jsonb,
  'an invitation is logged with the role');

-- The users edge function puts the inviting owner in app_metadata
insert into auth.users (email, raw_user_meta_data, raw_app_meta_data)
values ('m2@clinic.kz', '{"first_name": "Мадина", "last_name": "Test"}',
  jsonb_build_object('organization_id', current_setting('t.org')::bigint, 'role', 'manager',
    'invited_by', current_setting('t.owner_id')::bigint));
select set_config('t.m2_id', (select id from public.sales where email = 'm2@clinic.kz')::text, true);
select tests.assert(
  (tests.last('employee', 'invite')).sales_id = current_setting('t.owner_id')::bigint
  and (tests.last('employee', 'invite')).entity_id = current_setting('t.m2_id')::bigint
  and (tests.last('employee', 'invite')).source = 'user',
  'the invitation is authored by the inviting owner');

-- Role change and disabling through the users edge function
select tests.as_service(current_setting('t.owner_id')::bigint);
update public.sales set role = 'head' where id = current_setting('t.m2_id')::bigint;
update public.sales set disabled = true where id = current_setting('t.m2_id')::bigint;
select tests.logout();
select tests.assert(
  (tests.last('employee', 'role_change')).changes = '{"role": ["manager", "head"]}'::jsonb
  and (tests.last('employee', 'role_change')).sales_id = current_setting('t.owner_id')::bigint,
  'a role change is logged with the owner as author');
select tests.assert(
  (tests.last('employee', 'disable')).changes = '{"disabled": [false, true]}'::jsonb
  and (tests.last('employee', 'disable')).sales_id = current_setting('t.owner_id')::bigint
  and (tests.last('employee', 'disable')).source = 'user',
  'disabling an employee is logged');
-- The header is not trusted from employees, nor for an employee of another clinic
select tests.as_service((select id from public.sales where organization_id = current_setting('t.other_org')::bigint));
update public.sales set disabled = false where id = current_setting('t.m2_id')::bigint;
select tests.logout();
select tests.assert(
  (tests.last('employee', 'enable')).sales_id is null and (tests.last('employee', 'enable')).source = 'webhook',
  'an employee of another clinic cannot be named as the author');

-- No automatic tasks except where the test asks for them
delete from public.task_rules;

-- Patients
select tests.login_as(current_setting('t.m1')::uuid);
insert into public.patients (last_name, first_name, phone_jsonb) values ('Ахметов', 'Даулет', '[{"number": "8 701 555 12 34"}]');
select set_config('t.patient', (select id from public.patients where last_name = 'Ахметов')::text, true);
update public.patients set first_name = 'Данияр', phone_jsonb = '[{"number": "+7 701 555 00 00"}]' where id = current_setting('t.patient')::bigint;
update public.patients set sales_id = current_setting('t.head_id')::bigint, tags = '{1}' where id = current_setting('t.patient')::bigint;
update public.patients set last_seen = now() + interval '1 hour', city = 'Алматы' where id = current_setting('t.patient')::bigint;
select tests.logout();

select tests.assert(
  (tests.last('patient', 'create')).changes = jsonb_build_object(
    'last_name', '[null, "Ахметов"]'::jsonb, 'first_name', '[null, "Даулет"]'::jsonb,
    'phones', '[null, ["+77015551234"]]'::jsonb, 'sales_id', jsonb_build_array(null, current_setting('t.m1_id')::bigint))
  and (tests.last('patient', 'create')).sales_id = current_setting('t.m1_id')::bigint
  and (tests.last('patient', 'create')).patient_id = current_setting('t.patient')::bigint
  and (tests.last('patient', 'create')).source = 'user',
  'a new patient is logged with its fields and author');
select tests.assert(
  (select count(*) from public.audit_log where organization_id = current_setting('t.org')::bigint and entity = 'patient' and action = 'update') = 2,
  'fields that are not logged (last seen, city) make no row');
select tests.assert(
  (select changes from public.audit_log where organization_id = current_setting('t.org')::bigint and entity = 'patient' and action = 'update' order by id limit 1)
    = '{"first_name": ["Даулет", "Данияр"], "phones": [["+77015551234"], ["+77015550000"]]}'::jsonb,
  'name and phone changes: before and after, changed fields only');
select tests.assert(
  (tests.last('patient', 'update')).changes = jsonb_build_object(
    'sales_id', jsonb_build_array(current_setting('t.m1_id')::bigint, current_setting('t.head_id')::bigint),
    'tags', '[[], [1]]'::jsonb),
  'responsible and tags changes are logged');

-- Deals: creation, amount, responsible, stage, refusal, archiving (a copy of
-- the deal log, which keeps working unchanged)
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.deals (patient_id, name, plan_amount, sales_id)
values (current_setting('t.patient')::bigint, 'Имплантация', 100000, current_setting('t.m1_id')::bigint);
select set_config('t.deal', (select id from public.deals where name = 'Имплантация')::text, true);
update public.deals set plan_amount = 120000 where id = current_setting('t.deal')::bigint;
update public.deals set sales_id = current_setting('t.head_id')::bigint where id = current_setting('t.deal')::bigint;
update public.deals set stage_id = tests.stage('Записан') where id = current_setting('t.deal')::bigint;
update public.deals set archived_at = now() where id = current_setting('t.deal')::bigint;
update public.deals set archived_at = null where id = current_setting('t.deal')::bigint;
update public.deals set index = 5 where id = current_setting('t.deal')::bigint;
select tests.logout();

select tests.assert(
  (tests.last('deal', 'create')).changes = jsonb_build_object(
    'name', '[null, "Имплантация"]'::jsonb,
    'pipeline_id', jsonb_build_array(null, (select pipeline_id from public.deals where id = current_setting('t.deal')::bigint)),
    'stage_id', jsonb_build_array(null, tests.stage('Новый лид')),
    'sales_id', jsonb_build_array(null, current_setting('t.m1_id')::bigint),
    'plan_amount', '[null, 100000]'::jsonb)
  and (tests.last('deal', 'create')).sales_id = current_setting('t.owner_id')::bigint
  and (tests.last('deal', 'create')).deal_id = current_setting('t.deal')::bigint
  and (tests.last('deal', 'create')).patient_id = current_setting('t.patient')::bigint,
  'a new deal is logged with its fields, deal and patient');
select tests.assert(
  (select count(*) from public.audit_log where entity = 'deal' and action = 'update'
    and changes = '{"plan_amount": [100000, 120000]}'::jsonb and sales_id = current_setting('t.owner_id')::bigint) = 1,
  'the amount change is logged with its author');
select tests.assert(
  (select count(*) from public.audit_log where entity = 'deal' and action = 'update'
    and changes = jsonb_build_object('sales_id', jsonb_build_array(current_setting('t.m1_id')::bigint, current_setting('t.head_id')::bigint))) = 1,
  'the responsible change is logged');
select tests.assert(
  (tests.last('deal', 'stage_change')).changes = jsonb_build_object('stage_id', jsonb_build_array(tests.stage('Новый лид'), tests.stage('Записан'))),
  'the stage change is logged');
select tests.assert(
  (tests.last('deal', 'archive')).changes -> 'archived_at' ->> 0 is null
  and (tests.last('deal', 'unarchive')).changes -> 'archived_at' ->> 1 is null,
  'archiving and restoring are logged');
select tests.assert(
  (select count(*) from public.audit_log where entity = 'deal' and deal_id = current_setting('t.deal')::bigint)
    = (select count(*) from public.deal_events where deal_id = current_setting('t.deal')::bigint),
  'one log row per deal event; moving a card (index) logs nothing');

-- Refusal with its reason
select tests.login_as(current_setting('t.head')::uuid);
update public.deals
set stage_id = tests.stage('Отказ'),
    lost_reason_id = (select id from public.lost_reasons where organization_id = current_setting('t.org')::bigint and name = 'Дорого')
where id = current_setting('t.deal')::bigint;
select tests.logout();
select tests.assert(
  (tests.last('deal', 'stage_change')).changes ->> 'lost_reason_id' is not null
  and (tests.last('deal', 'stage_change')).changes -> 'stage_id' ->> 1 = tests.stage('Отказ')::text
  and (tests.last('deal', 'stage_change')).sales_id = current_setting('t.head_id')::bigint,
  'the refusal is logged with its reason');

-- Payments: added and deleted; the deal total follows automatically
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.deals (patient_id, name) values (current_setting('t.patient')::bigint, 'Брекеты');
select set_config('t.deal2', (select id from public.deals where name = 'Брекеты')::text, true);
insert into public.deal_payments (deal_id, amount, comment) values (current_setting('t.deal2')::bigint, 50000, 'Kaspi');
delete from public.deal_payments where deal_id = current_setting('t.deal2')::bigint;
select tests.logout();
select tests.assert(
  (tests.last('payment', 'create')).changes -> 'amount' = '[null, 50000]'::jsonb
  and (tests.last('payment', 'create')).changes -> 'comment' = '[null, "Kaspi"]'::jsonb
  and (tests.last('payment', 'create')).deal_id = current_setting('t.deal2')::bigint
  and (tests.last('payment', 'create')).patient_id = current_setting('t.patient')::bigint
  and (tests.last('payment', 'create')).sales_id = current_setting('t.owner_id')::bigint,
  'a new payment is logged');
select tests.assert(
  (tests.last('payment', 'delete')).changes -> 'amount' = '[50000, null]'::jsonb
  and (tests.last('payment', 'delete')).sales_id = current_setting('t.owner_id')::bigint,
  'a deleted payment is logged with its amount');
select tests.assert(
  (select count(*) from public.audit_log where entity = 'deal' and deal_id = current_setting('t.deal2')::bigint
    and changes ? 'paid_amount' and source = 'automation' and sales_id is null) = 2,
  'the paid total of the deal changes automatically');

-- Tasks: created, completed, reassigned, deleted; automatic tasks
select tests.login_as(current_setting('t.m1')::uuid);
insert into public.tasks (deal_id, text, due_date) values (current_setting('t.deal2')::bigint, 'Перезвонить', '2026-10-01 10:00+05');
select set_config('t.task', (select id from public.tasks where text = 'Перезвонить')::text, true);
update public.tasks set done_date = now() where id = current_setting('t.task')::bigint;
update public.tasks set done_date = null where id = current_setting('t.task')::bigint;
update public.tasks set sales_id = current_setting('t.head_id')::bigint where id = current_setting('t.task')::bigint;
delete from public.tasks where id = current_setting('t.task')::bigint;
select tests.logout();
select tests.assert(
  (tests.last('task', 'create')).changes -> 'text' = '[null, "Перезвонить"]'::jsonb
  and (tests.last('task', 'create')).sales_id = current_setting('t.m1_id')::bigint
  and (tests.last('task', 'create')).deal_id = current_setting('t.deal2')::bigint,
  'a new task is logged');
select tests.assert(
  (tests.last('task', 'complete')).changes -> 'done_date' ->> 0 is null
  and (tests.last('task', 'complete')).changes -> 'done_date' ->> 1 is not null
  and (tests.last('task', 'reopen')).entity_id = current_setting('t.task')::bigint,
  'completing and reopening a task are logged');
select tests.assert(
  (tests.last('task', 'reassign')).changes = jsonb_build_object('sales_id',
    jsonb_build_array(current_setting('t.m1_id')::bigint, current_setting('t.head_id')::bigint)),
  'reassigning a task is logged');
select tests.assert(
  (tests.last('task', 'delete')).changes -> 'text' = '["Перезвонить", null]'::jsonb
  and (tests.last('task', 'delete')).sales_id = current_setting('t.m1_id')::bigint,
  'a deleted task is logged');

insert into public.task_rules (organization_id, event, type, text, due_in_minutes)
values (current_setting('t.org')::bigint, 'deal_created', 'call', 'Связаться', 15);
select tests.login_as(current_setting('t.m1')::uuid);
insert into public.deals (patient_id, name) values (current_setting('t.patient')::bigint, 'Виниры');
select tests.logout();
select tests.assert(
  (tests.last('task', 'create')).source = 'automation' and (tests.last('task', 'create')).sales_id is null
  and (tests.last('task', 'create')).changes -> 'text' = '[null, "Связаться"]'::jsonb,
  'a task created by a rule is logged as automation, without author');

-- Deleting a deal: one row, not one per task or payment
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.deal_payments (deal_id, amount) select id, 1000 from public.deals where name = 'Виниры';
select set_config('t.before_delete', (select max(id) from public.audit_log)::text, true);
delete from public.deals where name = 'Виниры';
select tests.logout();
select tests.assert(
  (select count(*) from public.audit_log where id > current_setting('t.before_delete')::bigint) = 1
  and (tests.last('deal', 'delete')).changes -> 'name' = '["Виниры", null]'::jsonb,
  'deleting a deal logs the deal only');

-- Settings: pipelines and stages, access, distribution, task rules, checklists
select tests.login_as(current_setting('t.head')::uuid);
select set_config('t.pipeline', public.create_pipeline('Ортодонтия')::text, true);
update public.stages set name = 'Первичный звонок' where pipeline_id = current_setting('t.pipeline')::bigint and name = 'Новый лид';
update public.organization_settings set manager_deal_visibility = 'own';
update public.organization_settings set lead_distribution = 'round_robin', lead_distribution_sales_ids = array[current_setting('t.m1_id')::bigint];
insert into public.task_rules (event, type, text, due_in_minutes) values ('deal_created', 'call', 'Позвонить', 10);
update public.task_rules set is_active = false where text = 'Позвонить';
insert into public.stage_checklist_items (stage_id, text) values (tests.stage('Записан'), 'Подтвердить запись');
select tests.logout();
select tests.assert(
  (tests.last('pipeline', 'create')).changes -> 'name' = '[null, "Ортодонтия"]'::jsonb
  and (tests.last('pipeline', 'create')).sales_id = current_setting('t.head_id')::bigint
  and (select count(*) from public.audit_log where organization_id = current_setting('t.org')::bigint and entity = 'stage' and action = 'create') = 3,
  'a new pipeline and its stages are logged');
select tests.assert(
  (tests.last('stage', 'update')).changes = '{"name": ["Новый лид", "Первичный звонок"]}'::jsonb,
  'renaming a stage is logged');
select tests.assert(
  (select changes from public.audit_log where organization_id = current_setting('t.org')::bigint and entity = 'settings' order by id limit 1) = '{"manager_deal_visibility": ["all", "own"]}'::jsonb
  and (tests.last('settings')).changes = jsonb_build_object('lead_distribution', '["off", "round_robin"]'::jsonb,
    'lead_distribution_sales_ids', jsonb_build_array('[]'::jsonb, jsonb_build_array(current_setting('t.m1_id')::bigint))),
  'access and distribution settings are logged');
select tests.assert(
  (tests.last('task_rule', 'create')).changes -> 'text' = '[null, "Позвонить"]'::jsonb
  and (tests.last('task_rule', 'update')).changes = '{"is_active": [true, false]}'::jsonb
  and (tests.last('checklist_item', 'create')).changes -> 'text' = '[null, "Подтвердить запись"]'::jsonb,
  'task rules and checklists are logged');
select tests.assert(
  (select count(*) from public.audit_log where organization_id = current_setting('t.org')::bigint and entity in ('pipeline', 'stage') and sales_id is null) = 0,
  'the template of a new clinic is not logged');

-- Round robin (below) moves organization_settings.last_distributed_sales_id: not logged
select set_config('t.before_rr', (select count(*) from public.audit_log where organization_id = current_setting('t.org')::bigint and entity = 'settings')::text, true);

-- Messengers: connect and disconnect through the edge function, never the key
select tests.as_service(current_setting('t.owner_id')::bigint);
insert into public.messenger_integrations (organization_id, api_key, webhook_token, connected_at)
values (current_setting('t.org')::bigint, 'secret-api-key-123', 'secret-webhook-token-456', now());
update public.messenger_integrations set last_error = 'secret-api-key-123 refused' where organization_id = current_setting('t.org')::bigint;
select tests.logout();
select tests.assert(
  (tests.last('messenger', 'connect')).sales_id = current_setting('t.owner_id')::bigint
  and (tests.last('messenger', 'connect')).changes -> 'connected' = '[false, true]'::jsonb,
  'connecting a messenger is logged');

-- A lead from the messenger webhook: no author, source webhook
select tests.as_service();
select public.ingest_message('secret-webhook-token-456',
  '{"transport": "whatsapp", "chat_id": "77019998877", "external_id": "m-1", "text": "Здравствуйте", "contact": {"name": "Асель"}}');
select tests.logout();
select tests.assert(
  (tests.last('patient', 'create')).sales_id is null and (tests.last('patient', 'create')).source = 'webhook'
  and (tests.last('deal', 'create')).sales_id is null and (tests.last('deal', 'create')).source = 'webhook',
  'a lead from a webhook is logged without author, with its source');
select tests.assert(
  (select count(*) from public.audit_log where organization_id = current_setting('t.org')::bigint and entity = 'settings') = current_setting('t.before_rr')::bigint,
  'round robin bookkeeping is not logged');

select tests.as_service(current_setting('t.owner_id')::bigint);
update public.messenger_integrations set api_key = null, connected_at = null where organization_id = current_setting('t.org')::bigint;
select tests.logout();
select tests.assert(
  (tests.last('messenger', 'disconnect')).changes -> 'connected' = '[true, false]'::jsonb,
  'disconnecting a messenger is logged');
select tests.assert(
  (select count(*) from public.audit_log where changes::text like '%secret%') = 0,
  'API keys, webhook tokens and errors never reach the log');

-- Other sources: an import sets crm.audit_source
select tests.login_as(current_setting('t.owner')::uuid);
select set_config('crm.audit_source', 'import', true);
insert into public.patients (first_name) values ('Импортированный');
select set_config('crm.audit_source', '', true);
select tests.logout();
select tests.assert(
  (tests.last('patient', 'create')).source = 'import' and (tests.last('patient', 'create')).sales_id = current_setting('t.owner_id')::bigint,
  'the source set by an import is kept');

-- Reading: owner and head see the log of their clinic, nobody else
select set_config('t.total', (select count(*) from public.audit_log where organization_id = current_setting('t.org')::bigint)::text, true);
select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert((select count(*) from public.audit_log) = current_setting('t.total')::bigint, 'the owner reads the whole log');
select tests.assert(
  (select count(*) from public.audit_log_summary) = current_setting('t.total')::bigint
  and (select count(*) from public.audit_log_summary where deal_name = 'Имплантация' and patient_name = 'Ахметов Данияр') > 0
  and (select count(*) from public.audit_log_summary where search_text like '%ахметов%') > 0,
  'the summary view names the deal and the patient');
select tests.logout();
select tests.login_as(current_setting('t.head')::uuid);
select tests.assert((select count(*) from public.audit_log) = current_setting('t.total')::bigint, 'the head reads the whole log');
select tests.logout();
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert((select count(*) from public.audit_log) = 0, 'a manager reads nothing');
select tests.assert((select count(*) from public.audit_log_summary) = 0, 'a manager reads nothing through the view');
select tests.logout();
select tests.login_anon();
select tests.throws('select * from public.audit_log', '42501', 'anonymous users cannot read the log');
select tests.logout();

-- Isolation: the other clinic reads its own log only
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(
  (select count(*) from public.audit_log) > 0
  and (select count(*) from public.audit_log where organization_id <> current_setting('t.other_org')::bigint) = 0,
  'another clinic sees its own log only');
select tests.logout();

-- Writing: nobody, not even the owner or the service role
select tests.login_as(current_setting('t.owner')::uuid);
select tests.throws(format($q$insert into public.audit_log (organization_id, entity, action) values (%s, 'deal', 'create')$q$, current_setting('t.org')),
  '42501', 'the owner cannot insert log rows');
select tests.throws('update public.audit_log set action = $$x$$', '42501', 'the owner cannot change log rows');
select tests.throws('delete from public.audit_log', '42501', 'the owner cannot delete log rows');
select tests.throws('update public.audit_log_summary set action = $$x$$', '55000', 'nor through the view (not updatable)');
select tests.logout();
select tests.as_service();
select tests.throws(format($q$insert into public.audit_log (organization_id, entity, action) values (%s, 'deal', 'create')$q$, current_setting('t.org')),
  '42501', 'the service role cannot insert log rows');
select tests.throws('delete from public.audit_log', '42501', 'the service role cannot delete log rows');
select tests.logout();
select tests.assert(
  (select count(*) from public.audit_log where organization_id = current_setting('t.org')::bigint) = current_setting('t.total')::bigint,
  'the log is intact');

rollback;

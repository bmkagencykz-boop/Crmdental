--
-- Marketplace (stage 25): developer apps (install / uninstall: key and
-- webhooks, manifest import), fine API scopes per endpoint function, the
-- configuration endpoints of the API, the integrator role (configuration
-- yes, deals and patients read-only, no money, messages with access only,
-- expiry) and clinic isolation.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника Жемчуг')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.owner_id', (select id from public.sales where email = 'owner@clinic.kz')::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m1_id', (select id from public.sales where email = 'm1@clinic.kz')::text, true);
select set_config('t.int', tests.invite('dev@agency.kz', current_setting('t.org')::bigint, 'integrator')::text, true);
select set_config('t.int_id', (select id from public.sales where email = 'dev@agency.kz')::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);
select set_config('t.other_org', tests.org_of(current_setting('t.other')::uuid)::text, true);

create function tests.login_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end;
$$;
create function tests.stage(stage_name text) returns bigint language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
  where p.organization_id = current_setting('t.org')::bigint and p.is_default and s.name = stage_name
$$;
create function tests.pipeline() returns bigint language sql as $$
  select p.id from public.pipelines p where p.organization_id = current_setting('t.org')::bigint and p.is_default
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- Two deals of the clinic: the owner's and the manager's; managers only see their own
update public.organization_settings set manager_deal_visibility = 'own' where organization_id = current_setting('t.org')::bigint;
insert into public.patients (organization_id, first_name, phone_jsonb)
values (current_setting('t.org')::bigint, 'Айжан-25', '[{"number": "+77010000001", "type": "mobile"}]');
select set_config('t.patient', (select id from public.patients where first_name = 'Айжан-25' and organization_id = current_setting('t.org')::bigint)::text, true);
insert into public.deals (organization_id, patient_id, name, pipeline_id, stage_id, sales_id)
values (current_setting('t.org')::bigint, current_setting('t.patient')::bigint, 'Имплантация', tests.pipeline(), tests.stage('Новый лид'), current_setting('t.owner_id')::bigint),
       (current_setting('t.org')::bigint, current_setting('t.patient')::bigint, 'Брекеты', tests.pipeline(), tests.stage('Новый лид'), current_setting('t.m1_id')::bigint);
select set_config('t.d1', (select id from public.deals where name = 'Имплантация' and organization_id = current_setting('t.org')::bigint)::text, true);
select set_config('t.d2', (select id from public.deals where name = 'Брекеты' and organization_id = current_setting('t.org')::bigint)::text, true);
insert into public.messages (organization_id, patient_id, deal_id, transport, chat_id, direction, status, text)
values (current_setting('t.org')::bigint, current_setting('t.patient')::bigint, current_setting('t.d1')::bigint,
  'whatsapp', '77010000001', 'in', 'inbound', 'Сколько стоит имплант?');
insert into public.deal_payments (organization_id, deal_id, amount)
values (current_setting('t.org')::bigint, current_setting('t.d1')::bigint, 150000);

--
-- The integrator: an invited technical account
--
select tests.assert((select role from public.sales where id = current_setting('t.int_id')::bigint) = 'integrator',
  'an invitation can make an integrator');
select tests.assert((select not administrator from public.sales where id = current_setting('t.int_id')::bigint),
  'an integrator is not an administrator');

select tests.login_as(current_setting('t.int')::uuid);
-- Configuration: pipelines, stages, digital pipeline, fields, templates, webhooks, settings
select tests.assert(tests.affected($q$update public.pipelines set name = 'Основная (настроено)' where is_default$q$) = 1,
  'the integrator edits a pipeline');
insert into public.stages (pipeline_id, name, position, kind) values (tests.pipeline(), 'Консультация', 1, 'open');
select tests.assert(exists (select 1 from public.stages where name = 'Консультация'), 'the integrator adds a stage');
insert into public.stage_triggers (stage_id, event, action, target_stage_id, name)
values (tests.stage('Новый лид'), 'message_in', 'move_stage', tests.stage('Консультация'), 'Ответ → консультация');
select tests.assert(tests.affected($q$update public.stage_triggers set is_active = false where name = 'Ответ → консультация'$q$) = 1,
  'the integrator configures the digital pipeline');
insert into public.custom_fields (entity, name, type) values ('deal', 'UTM метка', 'text');
insert into public.message_templates (name, body) values ('Напоминание', 'Ждём вас, {имя}');
insert into public.task_rules (event, stage_id, type, text, due_in_minutes)
values ('stage_entered', tests.stage('Консультация'), 'call', 'Позвонить', 60);
insert into public.webhooks (name, url, events) values ('CRM агентства', 'https://agency.kz/hook', array['deal.created']);
select tests.assert(tests.affected($q$update public.organization_settings set lead_distribution = 'round_robin'$q$) = 1,
  'the integrator edits the clinic settings');
select tests.assert(tests.count('select 1 from public.webhooks') = 1 and tests.count('select 1 from public.api_keys') = 0,
  'the integrator reads the webhooks and the keys');
select tests.assert((public.create_api_key('Ключ агентства', 'read')) ->> 'key' like 'dcrm_%', 'the integrator creates API keys');
insert into public.quick_replies (title, shortcut, text, sales_id) values ('Адрес', 'адрес', 'Мы на Абая 10', null);
select tests.assert(exists (select 1 from public.quick_replies where shortcut = 'адрес' and sales_id is null),
  'the integrator writes clinic-wide quick replies');

-- Deals and patients: all read (whatever the manager visibility), nothing written
select tests.assert(tests.count('select 1 from public.deals') = 2, 'the integrator reads every deal');
select tests.assert(tests.count('select 1 from public.deals_summary') = 2, 'and the deal list');
select tests.assert(tests.count('select 1 from public.patients') = 1, 'the integrator reads the patients');
select tests.assert(tests.affected($q$update public.deals set name = 'x'$q$) = 0, 'the integrator cannot edit a deal');
select tests.assert(tests.affected($q$delete from public.deals$q$) = 0, 'the integrator cannot delete a deal');
select tests.assert(tests.affected($q$delete from public.patients$q$) = 0, 'the integrator cannot delete a patient');
select tests.assert(tests.affected($q$update public.patients set first_name = 'x'$q$) = 0, 'the integrator cannot edit a patient');
select tests.throws(format($q$insert into public.deals (patient_id, pipeline_id, stage_id) values (%s, %s, %s)$q$,
  current_setting('t.patient'), tests.pipeline(), tests.stage('Новый лид')), '42501', 'the integrator cannot create a deal');
select tests.throws(format($q$insert into public.patients (first_name) values ('x')$q$), '42501', 'the integrator cannot create a patient');
select tests.throws(format($q$insert into public.deal_notes (deal_id, text) values (%s, 'x')$q$, current_setting('t.d1')),
  '42501', 'the integrator cannot write a note');
select tests.throws(format($q$insert into public.tasks (deal_id, text, due_date) values (%s, 'x', now())$q$, current_setting('t.d1')),
  '42501', 'the integrator cannot create a task');
select tests.throws(format('select public.merge_unsorted(%s, %s)', current_setting('t.d1'), current_setting('t.d2')),
  '42501', 'the integrator cannot merge leads');
-- No money, no staff, no audit, no reports
select tests.assert(tests.count('select 1 from public.deal_payments') = 0, 'the integrator does not see the payments');
select tests.assert(tests.count('select 1 from public.audit_log') = 0, 'the integrator does not read the audit log');
select tests.throws($q$select public.report_conversion()$q$, '42501', 'the integrator cannot read the reports');
select tests.assert(tests.count('select 1 from public.sales_plans') = 0, 'the integrator does not see the sales plans');
select tests.throws(format('select public.set_integrator_access(%s, null, true)', current_setting('t.int_id')),
  '42501', 'the integrator cannot open the conversations to itself');
-- Messages: hidden without «доступ к переписке»
select tests.assert(tests.count('select 1 from public.messages') = 0, 'the integrator does not read the messages by default');
select tests.assert((select last_message_text is null from public.deals_summary where id = current_setting('t.d1')::bigint),
  'nor the last message of the deal list');
select tests.logout();

-- The head cannot open the conversations either: the owner does
select tests.login_as(current_setting('t.head')::uuid);
select tests.throws(format('select public.set_integrator_access(%s, null, true)', current_setting('t.int_id')),
  '42501', 'only the owner sets the integrator access');
select tests.logout();
select tests.login_as(current_setting('t.owner')::uuid);
select tests.throws(format('select public.set_integrator_access(%s, null, true)', current_setting('t.m1_id')),
  'P0002', 'the access is for integrators only');
select public.set_integrator_access(current_setting('t.int_id')::bigint, now() + interval '30 days', true);
select tests.logout();
select tests.assert(
  exists (select 1 from public.audit_log a where a.entity = 'employee' and a.entity_id = current_setting('t.int_id')::bigint
    and a.changes ? 'can_read_messages' and a.sales_id = current_setting('t.owner_id')::bigint),
  'opening the conversations is in the audit log');

select tests.login_as(current_setting('t.int')::uuid);
select tests.assert(tests.count('select 1 from public.messages') = 1, 'with the access, the integrator reads the messages');
select tests.assert(tests.affected($q$update public.messages set read_at = now()$q$) = 0, 'but cannot mark them read');
select tests.logout();

-- The actions of the integrator are in the audit log with their name
select tests.assert(
  exists (select 1 from public.audit_log a where a.entity = 'pipeline' and a.action = 'update'
    and a.sales_id = current_setting('t.int_id')::bigint),
  'the audit log shows the integrator as the author');

-- Managers are unchanged: their deals only, no configuration
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(tests.count('select 1 from public.deals') = 1, 'a manager still sees their deals only');
select tests.assert(tests.affected($q$update public.pipelines set name = 'x'$q$) = 0, 'a manager cannot edit a pipeline');
select tests.assert(tests.count('select 1 from public.developer_apps') = 0, 'managers do not see the apps');
select tests.throws($q$insert into public.developer_apps (slug, name, developer_name, scopes) values ('x1', 'x', 'x', array['deals:read'])$q$,
  '42501', 'managers cannot register apps');
select tests.logout();

--
-- Developer apps: register, install (key + webhook), uninstall
--
select tests.login_as(current_setting('t.int')::uuid);
insert into public.developer_apps (slug, name, description, developer_name, developer_contact, website_url, scopes, webhook_url, webhook_events)
values ('Roistat-Like ', 'Сквозная аналитика', 'Источники и выручка', 'Digital Agency', 'hello@agency.kz', 'https://agency.kz',
  array['deals:read', 'webhooks', 'deals:read', 'patients:read'], 'https://agency.kz/hooks', array['deal.created', 'deal.won']);
select set_config('t.app', (select id from public.developer_apps where slug = 'roistat-like')::text, true);
select tests.assert((select scopes = array['deals:read', 'patients:read', 'webhooks'] from public.developer_apps where id = current_setting('t.app')::bigint),
  'the app is normalized (slug, sorted distinct scopes)');
select tests.throws($q$insert into public.developer_apps (slug, name, developer_name, scopes) values ('bad', 'x', 'x', array['admin'])$q$,
  '23514', 'unknown scopes are refused');
select tests.throws($q$insert into public.developer_apps (slug, name, developer_name, scopes, webhook_url, webhook_events) values ('bad2', 'x', 'x', array['deals:read'], 'https://x.kz', array['deal.created'])$q$,
  '23514', 'webhook events need the webhooks scope');

select set_config('t.install', public.install_developer_app(current_setting('t.app')::bigint)::text, true);
select set_config('t.app_key', current_setting('t.install')::jsonb ->> 'key', true);
select tests.assert(
  (select k.app_id = current_setting('t.app')::bigint and k.scopes = array['deals:read', 'patients:read', 'webhooks']
     and k.revoked_at is null and k.scope = 'write'
   from public.api_keys k where k.id = (select api_key_id from public.developer_apps where id = current_setting('t.app')::bigint)),
  'installing creates a key bound to the app with its scopes');
select tests.assert(
  (select w.url = 'https://agency.kz/hooks' and w.events = array['deal.created', 'deal.won'] and w.is_active
     and w.secret = current_setting('t.install')::jsonb ->> 'webhook_secret'
   from public.webhooks w where w.app_id = current_setting('t.app')::bigint),
  'installing subscribes the webhook of the app');
select tests.assert((select installed_at is not null and installed_by = current_setting('t.int_id')::bigint
  from public.developer_apps where id = current_setting('t.app')::bigint), 'the app is installed by the integrator');
select tests.throws(format('select public.install_developer_app(%s)', current_setting('t.app')), '23514', 'an app is installed once');
select tests.throws(format($q$update public.developer_apps set scopes = array['deals:write'] where id = %s$q$, current_setting('t.app')),
  '23514', 'the scopes of an installed app do not change');
select tests.assert(tests.affected(format($q$update public.developer_apps set description = 'Новое описание' where id = %s$q$, current_setting('t.app'))) = 1,
  'its description does');
select tests.throws(format($q$update public.developer_apps set installed_at = null where id = %s$q$, current_setting('t.app')),
  '42501', 'the installation is written by the functions only');
select tests.logout();

-- A new deal reaches the webhook of the app
insert into public.deals (organization_id, patient_id, name, pipeline_id, stage_id)
values (current_setting('t.org')::bigint, current_setting('t.patient')::bigint, 'Отбеливание', tests.pipeline(), tests.stage('Новый лид'));
select tests.assert(
  exists (select 1 from public.webhook_deliveries d join public.webhooks w on w.id = d.webhook_id
    where w.app_id = current_setting('t.app')::bigint and d.event = 'deal.created'),
  'the app gets its events');

-- The app key: deals and patients read, nothing else
select tests.login_service();
select tests.assert((select (r -> 'meta' ->> 'total')::integer = 3 from public.api_list_deals(current_setting('t.app_key'), '{}') as r),
  'deals:read lists the deals');
select tests.assert((select jsonb_array_length(r -> 'data') = 1 from public.api_list_patients(current_setting('t.app_key'), '{}') as r),
  'patients:read lists the patients');
select tests.throws(format($q$select public.api_create_deal(%L, '{"patient_id": %s}')$q$, current_setting('t.app_key'), current_setting('t.patient')),
  'PT403', 'without deals:write no deal is created');
select tests.throws(format($q$select public.api_list_pipelines(%L)$q$, current_setting('t.app_key')),
  'PT403', 'without settings:read no pipelines');
select tests.throws(format($q$select public.api_create_pipeline(%L, '{"name": "x"}')$q$, current_setting('t.app_key')),
  'PT403', 'without pipelines:write no pipeline');
select tests.throws(format($q$select public.api_send_message(%L, '{"deal_id": %s, "text": "x"}')$q$, current_setting('t.app_key'), current_setting('t.d1')),
  'PT403', 'without messages:write no message');
select tests.throws(format($q$select public.api_list_tasks(%L)$q$, current_setting('t.app_key')), 'PT403', 'without tasks no tasks');
select tests.logout();

-- Uninstall: the key is revoked, the webhooks deleted
select tests.login_as(current_setting('t.int')::uuid);
select tests.assert(public.uninstall_developer_app(current_setting('t.app')::bigint), 'the integrator uninstalls the app');
select tests.assert(not public.uninstall_developer_app(current_setting('t.app')::bigint), 'uninstalling twice does nothing');
select tests.logout();
select tests.assert(
  (select count(*) = 1 and bool_and(revoked_at is not null) from public.api_keys where app_id = current_setting('t.app')::bigint),
  'uninstalling revokes the key of the app');
select tests.assert(not exists (select 1 from public.webhooks where app_id = current_setting('t.app')::bigint),
  'uninstalling removes the webhooks of the app');
select tests.assert((select installed_at is null and uninstalled_at is not null and api_key_id is null
  from public.developer_apps where id = current_setting('t.app')::bigint), 'the app is not installed any more');
select tests.login_service();
select tests.throws(format($q$select public.api_list_deals(%L)$q$, current_setting('t.app_key')), 'PT401', 'the key of an uninstalled app is refused');
select tests.logout();

-- Reinstalling gives a new key; deleting an installed app revokes it
select tests.login_as(current_setting('t.owner')::uuid);
select set_config('t.app_key2', (public.install_developer_app(current_setting('t.app')::bigint)) ->> 'key', true);
select tests.assert(current_setting('t.app_key2') <> current_setting('t.app_key'), 'a reinstall gives a new key');
delete from public.developer_apps where id = current_setting('t.app')::bigint;
select tests.logout();
select tests.assert(
  not exists (select 1 from public.api_keys where key_hash = private.api_key_hash(current_setting('t.app_key2')) and revoked_at is null)
  and not exists (select 1 from public.webhooks where name = 'Сквозная аналитика'),
  'deleting an installed app revokes its key and removes its webhook');

--
-- Manifest: the same app in another clinic
--
select tests.login_as(current_setting('t.int')::uuid);
select set_config('t.manifest', $j${
  "manifest_version": 1, "id": "clinic-setup", "name": "Настройка клиники",
  "description": "Воронки и цифровая воронка от агентства",
  "developer": { "name": "Digital Agency", "contact": "hello@agency.kz", "website": "https://agency.kz" },
  "settings_url": "https://agency.kz/app",
  "scopes": ["settings:read", "settings:write", "pipelines:write", "tasks", "messages:read", "messages:write"],
  "webhook": null
}$j$, true);
select set_config('t.app2', public.import_app_manifest(current_setting('t.manifest')::jsonb)::text, true);
select tests.assert((select name = 'Настройка клиники' and developer_name = 'Digital Agency' and settings_url = 'https://agency.kz/app'
  and cardinality(scopes) = 6 from public.developer_apps where id = current_setting('t.app2')::bigint), 'a manifest registers the app');
select tests.assert(public.import_app_manifest(current_setting('t.manifest')::jsonb) = current_setting('t.app2')::bigint,
  'importing the same manifest updates the app');
select tests.throws($q$select public.import_app_manifest('{"manifest_version": 2, "id": "x1", "name": "x", "developer": {"name": "x"}, "scopes": ["deals:read"]}')$q$,
  '22023', 'an unknown manifest version is refused');
select tests.throws($q$select public.import_app_manifest('{"id": "x1", "name": "x", "developer": {"name": "x"}, "scopes": "deals:read"}')$q$,
  '22023', 'scopes must be an array');
select tests.throws($q$select public.import_app_manifest('{"id": "x1", "name": "x", "developer": {"name": "x"}, "scopes": ["root"]}')$q$,
  '23514', 'unknown scopes in a manifest are refused');
select tests.throws($q$select public.import_app_manifest('{"id": "X Y", "name": "x", "developer": {"name": "x"}, "scopes": ["deals:read"]}')$q$,
  '23514', 'a manifest id is a slug');
select set_config('t.cfg_key', (public.install_developer_app(current_setting('t.app2')::bigint)) ->> 'key', true);
select tests.throws($q$select public.import_app_manifest(current_setting('t.manifest')::jsonb)$q$, '23514',
  'an installed app is not overwritten by a manifest');
select tests.assert(not exists (select 1 from public.webhooks where app_id = current_setting('t.app2')::bigint),
  'no webhook without webhook scope');
select tests.logout();

-- The other clinic imports the same manifest: its own app
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.count('select 1 from public.developer_apps') = 0, 'another clinic does not see our apps');
select tests.throws(format('select public.install_developer_app(%s)', current_setting('t.app2')), 'P0002', 'nor installs them');
select tests.assert(not public.uninstall_developer_app(current_setting('t.app2')::bigint), 'nor uninstalls them');
select set_config('t.other_app', public.import_app_manifest(current_setting('t.manifest')::jsonb)::text, true);
select tests.assert(current_setting('t.other_app') <> current_setting('t.app2'), 'the other clinic gets its own app');
select set_config('t.other_key', (public.install_developer_app(current_setting('t.other_app')::bigint)) ->> 'key', true);
select tests.logout();

--
-- API: configuration endpoints with the scopes of the app
--
select tests.login_service();
select tests.assert(
  (select r -> 'data' ->> 'name' = 'Клиника Жемчуг' and jsonb_array_length(r #> '{data,users}') = 4
     and jsonb_array_length(r #> '{data,pipelines}') >= 1
   from public.api_get_account(current_setting('t.cfg_key')) as r),
  'GET /api/account: the clinic, its users and pipelines');
select set_config('t.api_pipeline', (public.api_create_pipeline(current_setting('t.cfg_key'), '{"name": "Ортодонтия"}') #>> '{data,id}'), true);
select tests.assert((select count(*) = 3 from public.stages where pipeline_id = current_setting('t.api_pipeline')::bigint),
  'POST /api/pipelines creates the default stages');
select tests.assert((select jsonb_array_length(r #> '{data,stages}') = 4 from public.api_create_pipeline(current_setting('t.cfg_key'),
  '{"name": "Имплантация", "stages": [{"name": "Заявка"}, {"name": "Лечение"}, {"name": "Готово", "kind": "won"}, {"name": "Отказ", "kind": "lost"}]}') as r),
  'POST /api/pipelines with stages creates them');
select tests.assert((select r #>> '{data,name}' = 'Ортодонтия 2' from public.api_update_pipeline(current_setting('t.cfg_key'),
  current_setting('t.api_pipeline')::bigint, '{"name": "Ортодонтия 2"}') as r), 'PATCH /api/pipelines/:id');
select set_config('t.api_stage', (public.api_create_stage(current_setting('t.cfg_key'),
  format('{"pipeline_id": %s, "name": "Консультация"}', current_setting('t.api_pipeline'))::jsonb) #>> '{data,id}'), true);
select tests.assert((select s.position = 1 and (select position from public.stages where pipeline_id = s.pipeline_id and kind = 'won') = 2
  from public.stages s where s.id = current_setting('t.api_stage')::bigint), 'POST /api/stages puts the stage before the won and lost ones');
select tests.assert((select r #>> '{data,color}' = '#FFAA00' from public.api_update_stage(current_setting('t.cfg_key'),
  current_setting('t.api_stage')::bigint, '{"color": "#FFAA00"}') as r), 'PATCH /api/stages/:id');
select tests.assert((select jsonb_array_length(r -> 'data') = 4 from public.api_list_stages(current_setting('t.cfg_key'),
  format('{"pipeline_id": %s}', current_setting('t.api_pipeline'))::jsonb) as r), 'GET /api/stages?pipeline_id=');
select set_config('t.api_trigger', (public.api_create_stage_trigger(current_setting('t.cfg_key'), format(
  '{"stage_id": %s, "event": "message_in", "action": "create_task", "task_type": "call", "task_text": "Перезвонить", "task_due_minutes": 30}',
  current_setting('t.api_stage'))::jsonb) #>> '{data,id}'), true);
select tests.assert((select pipeline_id = current_setting('t.api_pipeline')::bigint and is_active and action = 'create_task'
  from public.stage_triggers where id = current_setting('t.api_trigger')::bigint), 'POST /api/stage_triggers');
select tests.assert((select r #>> '{data,task_text}' = 'Позвонить' and (r #>> '{data,is_active}')::boolean is false
  from public.api_update_stage_trigger(current_setting('t.cfg_key'), current_setting('t.api_trigger')::bigint,
    '{"task_text": "Позвонить", "is_active": false}') as r), 'PATCH /api/stage_triggers/:id changes only the given fields');
select tests.assert((select jsonb_array_length(r -> 'data') = 1 from public.api_list_stage_triggers(current_setting('t.cfg_key'),
  format('{"stage_id": %s}', current_setting('t.api_stage'))::jsonb) as r), 'GET /api/stage_triggers');
select tests.throws(format($q$select public.api_create_stage_trigger(%L, '{"stage_id": %s, "event": "nope", "action": "add_tag"}')$q$,
  current_setting('t.cfg_key'), current_setting('t.api_stage')), '23514', 'the trigger rules apply');
select public.api_delete_stage_trigger(current_setting('t.cfg_key'), current_setting('t.api_trigger')::bigint);
select tests.assert(not exists (select 1 from public.stage_triggers where id = current_setting('t.api_trigger')::bigint), 'DELETE /api/stage_triggers/:id');
select tests.assert((select r #>> '{data,type}' = 'select' from public.api_create_custom_field(current_setting('t.cfg_key'),
  '{"entity": "deal", "name": "Канал рекламы", "type": "select", "options": ["Instagram", "2GIS"]}') as r), 'POST /api/custom_fields');
select tests.assert((select jsonb_array_length(r -> 'data') = 2 from public.api_list_custom_fields(current_setting('t.cfg_key'),
  '{"entity": "deal"}') as r), 'GET /api/custom_fields');
select set_config('t.api_task', (public.api_create_task(current_setting('t.cfg_key'),
  format('{"deal_id": %s, "text": "Проверить заявку"}', current_setting('t.d2'))::jsonb) #>> '{data,id}'), true);
select tests.assert((select sales_id = current_setting('t.m1_id')::bigint from public.tasks where id = current_setting('t.api_task')::bigint),
  'POST /api/tasks: the task goes to the responsible of the deal');
select tests.assert((select (r -> 'meta' ->> 'total')::integer = (select count(*) from public.tasks where deal_id = current_setting('t.d2')::bigint and done_date is null)
    and r -> 'data' @> format('[{"id": %s}]', current_setting('t.api_task'))::jsonb
  from public.api_list_tasks(current_setting('t.cfg_key'), format('{"deal_id": %s, "done": false}', current_setting('t.d2'))::jsonb) as r),
  'GET /api/tasks');
select tests.assert((select r #>> '{data,0,text}' = 'Сколько стоит имплант?' from public.api_list_messages(current_setting('t.cfg_key'),
  format('{"deal_id": %s}', current_setting('t.d1'))::jsonb) as r), 'GET /api/messages');
-- Messages: refused without a messenger, then queued and sent by the dispatcher
select tests.throws(format($q$select public.api_send_message(%L, '{"deal_id": %s, "text": "Здравствуйте!"}')$q$,
  current_setting('t.cfg_key'), current_setting('t.d1')), '23514', 'no message without a connected messenger');
insert into public.messenger_integrations (organization_id, api_key, connected_at) values (current_setting('t.org')::bigint, 'wz', now());
select set_config('t.api_message', (public.api_send_message(current_setting('t.cfg_key'),
  format('{"deal_id": %s, "text": "Здравствуйте! Напоминаем о визите."}', current_setting('t.d1'))::jsonb) #>> '{data,id}'), true);
select tests.assert(
  exists (select 1 from public.claim_automessages() c where c.id = current_setting('t.api_message')::bigint
    and c.message_text = 'Здравствуйте! Напоминаем о визите.'),
  'POST /api/messages: the dispatcher sends the text as given');
-- Isolation: the key of another clinic never reaches ours
select tests.throws(format($q$select public.api_update_pipeline(%L, %s, '{"name": "x"}')$q$, current_setting('t.other_key'), current_setting('t.api_pipeline')),
  'PT404', 'another clinic cannot rename our pipeline');
select tests.throws(format($q$select public.api_create_stage(%L, '{"pipeline_id": %s, "name": "x"}')$q$, current_setting('t.other_key'), current_setting('t.api_pipeline')),
  '23503', 'another clinic cannot add a stage to our pipeline');
select tests.throws(format($q$select public.api_update_stage(%L, %s, '{"name": "x"}')$q$, current_setting('t.other_key'), current_setting('t.api_stage')),
  'PT404', 'another clinic cannot rename our stage');
select tests.throws(format($q$select public.api_create_task(%L, '{"deal_id": %s, "text": "x"}')$q$, current_setting('t.other_key'), current_setting('t.d1')),
  'PT404', 'another clinic cannot add a task to our deal');
select tests.assert((select jsonb_array_length(r -> 'data') = 0 from public.api_list_messages(current_setting('t.other_key'),
  format('{"deal_id": %s}', current_setting('t.d1'))::jsonb) as r), 'another clinic reads none of our messages');
select tests.assert((select jsonb_array_length(r -> 'data') = 0 from public.api_list_stage_triggers(current_setting('t.other_key'),
  format('{"pipeline_id": %s}', current_setting('t.api_pipeline'))::jsonb) as r), 'nor our triggers');

-- Keys of stage 20 keep their rights
select tests.logout();
select tests.login_as(current_setting('t.owner')::uuid);
select set_config('t.key_read', (public.create_api_key('Чтение', 'read')) ->> 'key', true);
select set_config('t.key_write', (public.create_api_key('Сайт', 'write')) ->> 'key', true);
select tests.logout();
select tests.login_service();
select tests.assert((select jsonb_array_length(r -> 'data') >= 1 from public.api_list_pipelines(current_setting('t.key_read')) as r),
  'a read key of stage 20 still lists the pipelines');
select tests.assert((select r -> 'data' ->> 'name' is not null from public.api_get_account(current_setting('t.key_read')) as r),
  'and reads the account');
select tests.throws(format($q$select public.api_create_patient(%L, '{"first_name": "x"}')$q$, current_setting('t.key_read')),
  'PT403', 'a read key still cannot write');
select tests.assert((select r -> 'data' ->> 'id' is not null from public.api_create_patient(current_setting('t.key_write'),
  '{"first_name": "Ерлан", "phone": "+77019998877"}') as r), 'a write key of stage 20 still creates patients');
select tests.throws(format($q$select public.api_create_pipeline(%L, '{"name": "x"}')$q$, current_setting('t.key_write')),
  'PT403', 'a write key of stage 20 does not configure the clinic');
select tests.throws(format($q$select public.api_send_message(%L, '{"deal_id": %s, "text": "x"}')$q$, current_setting('t.key_write'), current_setting('t.d1')),
  'PT403', 'nor sends messages');
select tests.logout();

-- Only the service role calls the API functions
select tests.login_as(current_setting('t.owner')::uuid);
select tests.throws($q$select public.api_get_account('dcrm_x')$q$, '42501', 'the API functions are for the service role');
select tests.throws($q$select public.api_create_pipeline('dcrm_x', '{}')$q$, '42501', 'the API functions are for the service role (write)');
select tests.logout();

--
-- Expiry: after it, the integrator behaves as disabled
--
update public.sales set access_expires_at = now() - interval '1 minute' where id = current_setting('t.int_id')::bigint;
select tests.login_as(current_setting('t.int')::uuid);
select tests.assert(private.current_organization_id() is null and private.current_user_role() is null
  and private.current_sales_id() is null, 'an expired integrator belongs to no clinic');
select tests.assert(tests.count('select 1 from public.deals') = 0, 'an expired integrator reads no deal');
select tests.assert(tests.count('select 1 from public.sales') = 0, 'nor the staff');
select tests.assert(tests.affected($q$update public.pipelines set name = 'x'$q$) = 0, 'nor edits the pipelines');
select tests.throws(format('select public.install_developer_app(%s)', current_setting('t.app2')), '42501', 'nor installs apps');
select tests.throws($q$select public.create_api_key('x', 'read')$q$, '42501', 'nor creates keys');
select tests.logout();
update public.sales set access_expires_at = now() + interval '1 day' where id = current_setting('t.int_id')::bigint;
select tests.login_as(current_setting('t.int')::uuid);
select tests.assert(tests.count('select 1 from public.deals') = 3, 'a prolonged access works again');
select tests.logout();

rollback;

--
-- Digital pipeline, outgoing webhooks and the public API (stage 20): every
-- event and action of the stage triggers, conditions, loop protection, the
-- stage checklist, delayed triggers, webhook deliveries per event and their
-- retries, API keys (auth, scopes, rate limit, clinic isolation), rights.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника Жемчуг')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.owner_id', (select id from public.sales where email = 'owner@clinic.kz')::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m1_id', (select id from public.sales where email = 'm1@clinic.kz')::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);
select set_config('t.other_org', tests.org_of(current_setting('t.other')::uuid)::text, true);
select set_config('t.other_stage', (select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
  where p.organization_id = current_setting('t.other_org')::bigint order by s.id limit 1)::text, true);

create function tests.stage(stage_name text) returns bigint language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
  where p.organization_id = current_setting('t.org')::bigint and p.is_default and s.name = stage_name
$$;
create function tests.deal_stage(target_deal bigint) returns text language sql as $$
  select s.name from public.deals d join public.stages s on s.id = d.stage_id where d.id = target_deal
$$;
create function tests.login_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end;
$$;
-- A deal of the test clinic in a stage, with its own patient
create function tests.new_deal(deal_name text, stage_name text default 'Новый лид') returns bigint language plpgsql as $$
declare
  patient_id bigint;
  deal_id bigint;
begin
  insert into public.patients (organization_id, first_name) values (current_setting('t.org')::bigint, deal_name)
  returning id into patient_id;
  insert into public.deals (organization_id, patient_id, name, stage_id, pipeline_id, sales_id)
  select current_setting('t.org')::bigint, patient_id, deal_name, s.id, s.pipeline_id, current_setting('t.owner_id')::bigint
  from public.stages s where s.id = tests.stage(stage_name)
  returning id into deal_id;
  return deal_id;
end;
$$;
create function tests.message(target_deal bigint, message_direction text) returns bigint language plpgsql as $$
declare new_id bigint;
begin
  insert into public.messages (organization_id, patient_id, deal_id, transport, chat_id, direction, status, text)
  select d.organization_id, d.patient_id, d.id, 'whatsapp', '77010000000', message_direction,
    case when message_direction = 'in' then 'inbound' else 'sent' end, 'Здравствуйте'
  from public.deals d where d.id = target_deal
  returning id into new_id;
  return new_id;
end;
$$;
create function tests.runs(target_deal bigint) returns text[] language sql as $$
  select coalesce(array_agg(r.action || ':' || r.status order by r.id), '{}') from public.stage_trigger_runs r where r.deal_id = target_deal
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

--
-- Rights: triggers are read by everybody, written by the owner and the head;
-- webhooks, deliveries and API keys are for the owner and the head only
--
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.webhooks (name, url, events)
values ('CRM партнёра', 'https://example.com/hook', array['deal.created', 'deal.stage_changed', 'deal.won', 'deal.lost',
  'patient.created', 'message.received', 'payment.added', 'task.completed']);
select set_config('t.webhook', (select id from public.webhooks where name = 'CRM партнёра')::text, true);
insert into public.tags (name, color) values ('VIP', 'pink'), ('Горячий', 'red');
insert into public.stage_triggers (stage_id, event, action, target_stage_id, name)
values (tests.stage('Новый лид'), 'message_in', 'move_stage', tests.stage('В работе'), 'Ответил пациент');
select tests.throws(
  $q$update public.webhooks set secret = 'x'$q$,
  '42501', 'the secret is not written by hand');
select tests.throws(
  $q$update public.webhooks set failure_count = 0$q$,
  '42501', 'the delivery state is not written by hand');
select tests.assert(
  (select pipeline_id from public.stage_triggers where name = 'Ответил пациент')
  = (select pipeline_id from public.stages where id = tests.stage('Новый лид')),
  'the pipeline of a trigger comes from its stage');
select tests.throws(
  $q$insert into public.stage_triggers (stage_id, event, action, target_stage_id)
     values (tests.stage('Новый лид'), 'message_in', 'move_stage', current_setting('t.other_stage')::bigint)$q$,
  '23503', 'a move goes to a stage of the same pipeline and clinic');
select tests.throws(
  $q$insert into public.stage_triggers (stage_id, event, action) values (tests.stage('Новый лид'), 'idle', 'create_task')$q$,
  '23514', 'an idle trigger needs a delay, a task needs its text');
select tests.logout();

select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(tests.count('select * from public.stage_triggers') = 1, 'managers read the triggers');
select tests.throws(
  $q$insert into public.stage_triggers (stage_id, event, action, tag_id) select tests.stage('В работе'), 'message_in', 'add_tag', id from public.tags limit 1$q$,
  '42501', 'managers cannot add triggers');
select tests.assert(tests.affected('update public.stage_triggers set is_active = false') = 0, 'managers cannot switch triggers');
select tests.assert(tests.affected('delete from public.stage_triggers') = 0, 'managers cannot delete triggers');
select tests.assert(tests.count('select * from public.webhooks') = 0, 'managers do not see the webhooks (secrets)');
select tests.throws(
  $q$insert into public.webhooks (url, events) values ('https://evil.example/hook', '{}')$q$,
  '42501', 'managers cannot add webhooks');
select tests.throws($q$select public.create_api_key('x', 'write')$q$, '42501', 'managers cannot create API keys');
select tests.throws($q$select public.send_test_webhook(1)$q$, '42501', 'managers cannot test webhooks');
select tests.throws($q$select * from public.claim_webhook_deliveries()$q$, '42501', 'only the service role dispatches webhooks');
select tests.throws($q$select public.api_list_deals('dcrm_x', '{}')$q$, '42501', 'the API functions are for the service role');
select tests.throws($q$select private.stage_triggers_tick()$q$, '42501', 'employees cannot run the tick');
select tests.logout();

select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(
  tests.count('select * from public.stage_triggers') = 0 and tests.count('select * from public.webhooks') = 0,
  'another clinic sees none of the triggers and webhooks');
select tests.assert(
  tests.affected($q$update public.stage_triggers set is_active = false$q$) = 0,
  'another clinic cannot switch our triggers');
select tests.logout();

-- The head manages them too
select tests.login_as(current_setting('t.head')::uuid);
insert into public.stage_triggers (stage_id, event, action, tag_id, name)
select tests.stage('В работе'), 'message_out', 'add_tag', id, 'Ответили — горячий' from public.tags where name = 'Горячий';
select tests.logout();

--
-- message_in → move_stage; message_out → add_tag; audit and deal log
--
select set_config('t.d1', tests.new_deal('Асель')::text, true);
select tests.message(current_setting('t.d1')::bigint, 'in');
select tests.assert(tests.deal_stage(current_setting('t.d1')::bigint) = 'В работе',
  'an inbound message on «Новый лид» moves the deal to «В работе»');
select tests.assert(
  (select r.status = 'done' and r.trigger_name = 'Ответил пациент' and r.event = 'message_in'
     and (r.details ->> 'from_stage_id')::bigint = tests.stage('Новый лид')
     and (r.details ->> 'to_stage_id')::bigint = tests.stage('В работе')
   from public.stage_trigger_runs r where r.deal_id = current_setting('t.d1')::bigint),
  'the run is logged for the deal feed with the rule and the stages');
select tests.assert(
  (select e.sales_id is null from public.deal_events e
   where e.deal_id = current_setting('t.d1')::bigint and e.type = 'stage_changed'),
  'the automatic stage change has no author in the deal log');
select tests.assert(
  exists (select 1 from public.audit_log a
          where a.deal_id = current_setting('t.d1')::bigint and a.action = 'stage_change'
            and a.source = 'automation' and a.sales_id is null),
  'the audit log shows the move with the source automation');
select tests.message(current_setting('t.d1')::bigint, 'out');
select tests.assert(
  (select d.tags = array[(select id from public.tags where name = 'Горячий')] from public.deals d where d.id = current_setting('t.d1')::bigint),
  'an outbound message on «В работе» adds the tag');
select tests.message(current_setting('t.d1')::bigint, 'out');
select tests.assert(
  (select count(*) from public.stage_trigger_runs r where r.deal_id = current_setting('t.d1')::bigint and r.action = 'add_tag') = 2
  and (select cardinality(d.tags) from public.deals d where d.id = current_setting('t.d1')::bigint) = 1,
  'every message is its own event; a tag already there is not doubled');

-- Once per event instance: the same message does not fire twice
select tests.assert(
  private.fire_stage_trigger(t, current_setting('t.d1')::bigint,
    (select r.event_key from public.stage_trigger_runs r where r.trigger_id = t.id order by r.id limit 1)) is null,
  'a trigger never runs twice for the same deal and event')
from public.stage_triggers t where t.name = 'Ответили — горячий';

update public.stage_triggers set is_active = false;

--
-- Conditions: source, service, doctor, responsible, tags present / absent
--
insert into public.doctors (organization_id, name) values (current_setting('t.org')::bigint, 'Иванов И.И.');
insert into public.stage_triggers (organization_id, stage_id, event, action, tag_id, name, source_ids, service_ids, doctor_ids, sales_ids, tags_present, tags_absent)
select current_setting('t.org')::bigint, tests.stage('Новый лид'), 'message_in', 'add_tag',
  (select id from public.tags where organization_id = current_setting('t.org')::bigint and name = 'VIP'), 'Условия',
  array[(select id from public.lead_sources where organization_id = current_setting('t.org')::bigint and code = 'instagram')],
  array[(select id from public.services where organization_id = current_setting('t.org')::bigint and name = 'Имплантация')],
  array[(select id from public.doctors where organization_id = current_setting('t.org')::bigint)],
  array[current_setting('t.owner_id')::bigint],
  array[(select id from public.tags where organization_id = current_setting('t.org')::bigint and name = 'Горячий')],
  array[(select id from public.tags where organization_id = current_setting('t.org')::bigint and name = 'VIP')];
select set_config('t.d2', tests.new_deal('Условия')::text, true);
update public.deals set
  source_id = (select id from public.lead_sources where organization_id = current_setting('t.org')::bigint and code = 'instagram'),
  service_id = (select id from public.services where organization_id = current_setting('t.org')::bigint and name = 'Имплантация'),
  doctor_id = (select id from public.doctors where organization_id = current_setting('t.org')::bigint),
  tags = array[(select id from public.tags where organization_id = current_setting('t.org')::bigint and name = 'Горячий')]
where id = current_setting('t.d2')::bigint;

-- Each condition missing in turn: nothing runs
update public.deals set source_id = null where id = current_setting('t.d2')::bigint;
select tests.message(current_setting('t.d2')::bigint, 'in');
update public.deals set source_id = (select id from public.lead_sources where organization_id = current_setting('t.org')::bigint and code = 'instagram'),
  service_id = (select id from public.services where organization_id = current_setting('t.org')::bigint and name = 'Терапия')
where id = current_setting('t.d2')::bigint;
select tests.message(current_setting('t.d2')::bigint, 'in');
update public.deals set service_id = (select id from public.services where organization_id = current_setting('t.org')::bigint and name = 'Имплантация'),
  doctor_id = null where id = current_setting('t.d2')::bigint;
select tests.message(current_setting('t.d2')::bigint, 'in');
update public.deals set doctor_id = (select id from public.doctors where organization_id = current_setting('t.org')::bigint),
  sales_id = current_setting('t.m1_id')::bigint where id = current_setting('t.d2')::bigint;
select tests.message(current_setting('t.d2')::bigint, 'in');
update public.deals set sales_id = current_setting('t.owner_id')::bigint, tags = '{}' where id = current_setting('t.d2')::bigint;
select tests.message(current_setting('t.d2')::bigint, 'in');
select tests.assert(tests.runs(current_setting('t.d2')::bigint) = '{}',
  'source, service, doctor, responsible and a required tag must all match');
-- Everything matches
update public.deals set tags = array[(select id from public.tags where organization_id = current_setting('t.org')::bigint and name = 'Горячий')]
where id = current_setting('t.d2')::bigint;
select tests.message(current_setting('t.d2')::bigint, 'in');
select tests.assert(tests.runs(current_setting('t.d2')::bigint) = array['add_tag:done'], 'all conditions match: the trigger runs');
-- Now the deal has the excluded tag «VIP»: no more runs
select tests.message(current_setting('t.d2')::bigint, 'in');
select tests.assert(tests.runs(current_setting('t.d2')::bigint) = array['add_tag:done'], 'an excluded tag stops the trigger');
update public.stage_triggers set is_active = false;

--
-- Other events and actions
--
insert into public.stage_triggers (organization_id, stage_id, event, action, name, task_type, task_text, task_due_minutes)
values (current_setting('t.org')::bigint, tests.stage('В работе'), 'call_missed', 'create_task', 'Пропущенный', 'call', 'Перезвонить срочно', 5);
insert into public.stage_triggers (organization_id, stage_id, event, action, name, target_stage_id)
values (current_setting('t.org')::bigint, tests.stage('План согласован'), 'payment_added', 'move_stage', 'Оплата', tests.stage('В лечении'));
insert into public.stage_triggers (organization_id, stage_id, event, action, name, target_sales_id)
values (current_setting('t.org')::bigint, tests.stage('Записан'), 'appointment_set', 'set_responsible', 'Записан — m1', current_setting('t.m1_id')::bigint);
insert into public.stage_triggers (organization_id, stage_id, event, action, name, field_name, plan_amount)
values (current_setting('t.org')::bigint, tests.stage('В лечении'), 'stage_entered', 'set_field', 'Сумма', 'plan_amount', 500000);
insert into public.stage_triggers (organization_id, stage_id, event, action, name, field_name, doctor_id)
select current_setting('t.org')::bigint, tests.stage('В лечении'), 'stage_entered', 'set_field', 'Врач', 'doctor_id', id
from public.doctors where organization_id = current_setting('t.org')::bigint;
insert into public.stage_triggers (organization_id, stage_id, event, action, name, field_name, service_id)
select current_setting('t.org')::bigint, tests.stage('В лечении'), 'stage_entered', 'set_field', 'Услуга', 'service_id', id
from public.services where organization_id = current_setting('t.org')::bigint and name = 'Ортодонтия';
insert into public.stage_triggers (organization_id, stage_id, event, action, name, tag_id)
select current_setting('t.org')::bigint, tests.stage('В лечении'), 'stage_entered', 'remove_tag', 'Снять горячий', id
from public.tags where organization_id = current_setting('t.org')::bigint and name = 'Горячий';
insert into public.stage_triggers (organization_id, stage_id, event, action, name, webhook_id)
values (current_setting('t.org')::bigint, tests.stage('В лечении'), 'stage_entered', 'send_webhook', 'В МИС', current_setting('t.webhook')::bigint);
insert into public.stage_triggers (organization_id, stage_id, event, action, name, template_id, message_mode)
select current_setting('t.org')::bigint, tests.stage('В лечении'), 'stage_entered', 'send_template', 'Памятка', id, 'auto'
from public.message_templates where organization_id = current_setting('t.org')::bigint and name = 'Приветствие';
insert into public.stage_triggers (organization_id, stage_id, event, action, name, template_id, message_mode)
select current_setting('t.org')::bigint, tests.stage('В лечении'), 'stage_entered', 'send_template', 'Памятка сотруднику', id, 'confirm'
from public.message_templates where organization_id = current_setting('t.org')::bigint and name = 'Напоминание о визите';

-- Missed call → task
select set_config('t.d3', tests.new_deal('Звонок', 'В работе')::text, true);
insert into public.calls (organization_id, patient_id, deal_id, direction, status, provider, external_id)
select organization_id, patient_id, id, 'in', 'in_progress', 'generic', 'c-1' from public.deals where id = current_setting('t.d3')::bigint;
select tests.assert(tests.runs(current_setting('t.d3')::bigint) = '{}', 'a call in progress is not missed');
update public.calls set status = 'missed' where external_id = 'c-1';
select tests.assert(
  tests.runs(current_setting('t.d3')::bigint) = array['create_task:done']
  and exists (select 1 from public.tasks t where t.deal_id = current_setting('t.d3')::bigint and t.text = 'Перезвонить срочно'
    and t.type = 'call' and t.sales_id = current_setting('t.owner_id')::bigint and t.due_date > now()),
  'a missed call gives the responsible a task');
update public.calls set duration_seconds = 1 where external_id = 'c-1';
select tests.assert(tests.runs(current_setting('t.d3')::bigint) = array['create_task:done'], 'the same missed call runs once');

-- Appointment set → responsible
select set_config('t.d4', tests.new_deal('Запись', 'Записан')::text, true);
select tests.assert(tests.runs(current_setting('t.d4')::bigint) = '{}', 'no visit date, no event');
update public.deals set appointment_at = now() + interval '2 days' where id = current_setting('t.d4')::bigint;
select tests.assert(
  (select sales_id from public.deals where id = current_setting('t.d4')::bigint) = current_setting('t.m1_id')::bigint,
  'a visit date set gives the deal to the chosen employee');

-- Payment → «В лечении» → set fields, remove tag, webhook, auto-message, message shown first
select set_config('t.d5', tests.new_deal('Оплата', 'План согласован')::text, true);
update public.deals set tags = array[(select id from public.tags where organization_id = current_setting('t.org')::bigint and name = 'Горячий')]
where id = current_setting('t.d5')::bigint;
insert into public.deal_payments (organization_id, deal_id, amount) values (current_setting('t.org')::bigint, current_setting('t.d5')::bigint, 100000);
select tests.assert(tests.deal_stage(current_setting('t.d5')::bigint) = 'В лечении', 'a payment moves the deal to «В лечении»');
select tests.assert(
  (select d.plan_amount = 500000 and d.doctor_id is not null and d.tags = '{}'
     and d.service_id = (select id from public.services where organization_id = current_setting('t.org')::bigint and name = 'Ортодонтия')
   from public.deals d where d.id = current_setting('t.d5')::bigint),
  'the triggers of the new stage set the plan amount, the doctor and the service and remove the tag');
select tests.assert(
  exists (select 1 from public.webhook_deliveries w where w.event = 'automation'
    and (w.payload -> 'data' ->> 'deal_id')::bigint = current_setting('t.d5')::bigint
    and w.payload -> 'data' -> 'trigger' ->> 'name' = 'В МИС'),
  'the webhook action queues a delivery with the deal and the rule');
select tests.assert(
  exists (select 1 from public.automessages a where a.deal_id = current_setting('t.d5')::bigint and a.rule_id is null
    and a.template_id is not null and a.status = 'pending'),
  'the template action queues an auto-message in the stage 6 queue');
select tests.assert(
  exists (select 1 from public.automessages a join public.tasks t on t.automessage_id = a.id
    where a.deal_id = current_setting('t.d5')::bigint and a.status = 'awaiting' and t.text like 'Здравствуйте, Оплата!%'),
  '"show first" becomes the task with the rendered text');
select tests.assert(
  (select count(*) from public.stage_trigger_runs where deal_id = current_setting('t.d5')::bigint and status = 'done') = 8,
  'all the triggers ran once');
-- The dispatcher renders the trigger's template (no rule): no messenger here
update public.automessages set send_at = now() - interval '1 minute'
where deal_id = current_setting('t.d5')::bigint and status = 'pending';
select tests.login_service();
select count(*) from public.claim_automessages();
select tests.logout();
select tests.assert(
  (select a.status = 'failed' and a.text like 'Здравствуйте, Оплата!%' and a.error like 'Мессенджеры не подключены%'
   from public.automessages a where a.deal_id = current_setting('t.d5')::bigint and a.template_id is not null and a.status <> 'awaiting'),
  'the dispatcher takes the trigger''s template instead of cancelling a row without a rule');

-- A failing action is logged, not raised: nobody to give the deal to
insert into public.stage_triggers (organization_id, stage_id, event, action, name)
values (current_setting('t.org')::bigint, tests.stage('Пришёл на консультацию'), 'stage_entered', 'set_responsible', 'По очереди');
select set_config('t.d6', tests.new_deal('Очередь', 'Пришёл на консультацию')::text, true);
select tests.assert(
  (select r.status = 'failed' and r.error like 'Некому назначить%' from public.stage_trigger_runs r where r.deal_id = current_setting('t.d6')::bigint),
  'an action that cannot be done is logged as failed');
-- ... and with the round robin on, the next employee gets it
update public.organization_settings set lead_distribution = 'round_robin', lead_distribution_sales_ids = array[current_setting('t.m1_id')::bigint]
where organization_id = current_setting('t.org')::bigint;
select set_config('t.d7', tests.new_deal('Очередь 2', 'Пришёл на консультацию')::text, true);
select tests.assert(
  (select sales_id from public.deals where id = current_setting('t.d7')::bigint) = current_setting('t.m1_id')::bigint,
  'set_responsible without an employee takes the next one of the round robin');
update public.stage_triggers set is_active = false;

--
-- Stage checklist: an automatic move blocked by it is skipped, the message is stored
--
insert into public.stage_checklist_items (organization_id, stage_id, text)
values (current_setting('t.org')::bigint, tests.stage('В работе'), 'Уточнить жалобы');
insert into public.stage_triggers (organization_id, stage_id, event, action, name, target_stage_id)
values (current_setting('t.org')::bigint, tests.stage('В работе'), 'message_in', 'move_stage', 'Сразу записать', tests.stage('Записан'));
select set_config('t.d8', tests.new_deal('Чек-лист', 'В работе')::text, true);
select tests.assert(tests.message(current_setting('t.d8')::bigint, 'in') is not null, 'the inbound message is stored');
select tests.assert(
  tests.deal_stage(current_setting('t.d8')::bigint) = 'В работе'
  and (select r.status = 'skipped' and r.error like 'Выполните чек-лист этапа%' from public.stage_trigger_runs r
       where r.deal_id = current_setting('t.d8')::bigint),
  'the move blocked by the checklist is skipped and logged');
update public.stage_triggers set is_active = false;
delete from public.stage_checklist_items where organization_id = current_setting('t.org')::bigint;

--
-- Imports run no automation
--
insert into public.stage_triggers (organization_id, stage_id, event, action, name, target_stage_id)
values (current_setting('t.org')::bigint, tests.stage('Новый лид'), 'stage_entered', 'move_stage', 'Импорт', tests.stage('В работе'));
select set_config('crm.importing', 'on', true);
select set_config('t.d9', tests.new_deal('Импорт')::text, true);
select set_config('crm.importing', 'off', true);
select tests.assert(tests.deal_stage(current_setting('t.d9')::bigint) = 'Новый лид' and tests.runs(current_setting('t.d9')::bigint) = '{}',
  'crm.importing: no trigger runs');
update public.stage_triggers set is_active = false;

--
-- Loop protection: A → B → A stops (same event instance); a chain stops at 3 levels
--
insert into public.pipelines (organization_id, name, position) values (current_setting('t.org')::bigint, 'Цепочка', 5);
insert into public.stages (organization_id, pipeline_id, name, position, kind)
select current_setting('t.org')::bigint, p.id, s.name, s.position, s.kind
from public.pipelines p,
  (values ('S1', 0, 'open'), ('S2', 1, 'open'), ('S3', 2, 'open'), ('S4', 3, 'open'), ('S5', 4, 'open'),
          ('Успех', 5, 'won'), ('Отказ', 6, 'lost')) as s(name, position, kind)
where p.organization_id = current_setting('t.org')::bigint and p.name = 'Цепочка';
create function tests.chain(stage_name text) returns bigint language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
  where p.organization_id = current_setting('t.org')::bigint and p.name = 'Цепочка' and s.name = stage_name
$$;
insert into public.stage_triggers (organization_id, stage_id, event, action, name, target_stage_id)
values (current_setting('t.org')::bigint, tests.chain('S1'), 'stage_entered', 'move_stage', 'S1→S2', tests.chain('S2')),
       (current_setting('t.org')::bigint, tests.chain('S2'), 'stage_entered', 'move_stage', 'S2→S1', tests.chain('S1'));
insert into public.patients (organization_id, first_name) values (current_setting('t.org')::bigint, 'Петля');
insert into public.deals (organization_id, patient_id, name, pipeline_id, stage_id)
select current_setting('t.org')::bigint, p.id, 'Петля', (select pipeline_id from public.stages where id = tests.chain('S1')), tests.chain('S1')
from public.patients p where p.first_name = 'Петля' and p.organization_id = current_setting('t.org')::bigint;
select set_config('t.loop', (select id from public.deals where name = 'Петля')::text, true);
select tests.assert(
  tests.runs(current_setting('t.loop')::bigint) = array['move_stage:done', 'move_stage:done']
  and tests.deal_stage(current_setting('t.loop')::bigint) = 'S1',
  'two triggers moving a deal back and forth run once each and stop');
update public.stage_triggers set is_active = false;

insert into public.stage_triggers (organization_id, stage_id, event, action, name, target_stage_id)
values (current_setting('t.org')::bigint, tests.chain('S1'), 'stage_entered', 'move_stage', 'c1', tests.chain('S2')),
       (current_setting('t.org')::bigint, tests.chain('S2'), 'stage_entered', 'move_stage', 'c2', tests.chain('S3')),
       (current_setting('t.org')::bigint, tests.chain('S3'), 'stage_entered', 'move_stage', 'c3', tests.chain('S4')),
       (current_setting('t.org')::bigint, tests.chain('S4'), 'stage_entered', 'move_stage', 'c4', tests.chain('S5'));
insert into public.deals (organization_id, patient_id, name, pipeline_id, stage_id)
select current_setting('t.org')::bigint, p.id, 'Цепь', (select pipeline_id from public.stages where id = tests.chain('S1')), tests.chain('S1')
from public.patients p where p.first_name = 'Петля' and p.organization_id = current_setting('t.org')::bigint;
select set_config('t.chain', (select id from public.deals where name = 'Цепь')::text, true);
select tests.assert(
  tests.deal_stage(current_setting('t.chain')::bigint) = 'S4'
  and tests.runs(current_setting('t.chain')::bigint) = array['move_stage:done', 'move_stage:done', 'move_stage:done', 'move_stage:skipped']
  and (select error from public.stage_trigger_runs where deal_id = current_setting('t.chain')::bigint and status = 'skipped')
      like 'Слишком длинная цепочка%',
  'a chain of automatic moves stops after 3 levels (crm.automation_depth)');
select tests.assert(coalesce(current_setting('crm.automation_depth', true), '0') = '0', 'the depth is restored');
update public.stage_triggers set is_active = false;

--
-- Delayed triggers: N hours without activity, N hours after the visit
--
insert into public.stage_triggers (organization_id, stage_id, event, action, name, delay_minutes, task_type, task_text, task_due_minutes)
values (current_setting('t.org')::bigint, tests.stage('Новый лид'), 'idle', 'create_task', 'Тишина 2 часа', 120, 'call', 'Напомнить о себе', 0);
insert into public.stage_triggers (organization_id, stage_id, event, action, name, delay_minutes, target_stage_id)
values (current_setting('t.org')::bigint, tests.stage('Записан'), 'visit_passed', 'move_stage', 'Визит прошёл', 60, tests.stage('Пришёл на консультацию'));
-- The deals of the earlier sections are out of the way (archived deals are skipped)
update public.deals set archived_at = now() where organization_id = current_setting('t.org')::bigint;
select set_config('t.d10', tests.new_deal('Тишина')::text, true);
select set_config('t.d11', tests.new_deal('Визит', 'Записан')::text, true);
update public.deals set appointment_at = now() + interval '30 minutes' where id = current_setting('t.d11')::bigint;
select tests.assert(private.stage_triggers_tick(now() + interval '1 hour') = 0, 'nothing is due after 1 hour');
select tests.assert(private.stage_triggers_tick(now() + interval '3 hours') = 2, 'after 3 hours both delayed triggers run');
select tests.assert(
  exists (select 1 from public.tasks where deal_id = current_setting('t.d10')::bigint and text = 'Напомнить о себе')
  and tests.deal_stage(current_setting('t.d11')::bigint) = 'Пришёл на консультацию',
  'idle creates the task, visit passed moves the deal');
select tests.assert(private.stage_triggers_tick(now() + interval '6 hours') = 0, 'a delayed trigger runs once per quiet period');
-- New activity: a new quiet period
insert into public.deal_notes (organization_id, deal_id, text, date)
values (current_setting('t.org')::bigint, current_setting('t.d10')::bigint, 'Позвонили', now() + interval '4 hours');
select tests.assert(private.stage_triggers_tick(now() + interval '5 hours') = 0, 'the note restarts the wait');
select tests.assert(private.stage_triggers_tick(now() + interval '7 hours') = 1, 'two hours after the note it runs again');
update public.stage_triggers set is_active = false;

--
-- Webhooks: one delivery per event, dispatcher, retries, switching off
--
update public.webhook_deliveries set status = 'cancelled';
select set_config('t.d12', tests.new_deal('Вебхук')::text, true);
update public.deals set stage_id = tests.stage('В работе') where id = current_setting('t.d12')::bigint;
select tests.message(current_setting('t.d12')::bigint, 'in');
select tests.message(current_setting('t.d12')::bigint, 'out');
insert into public.deal_payments (organization_id, deal_id, amount) values (current_setting('t.org')::bigint, current_setting('t.d12')::bigint, 5000);
insert into public.tasks (organization_id, deal_id, text, due_date) values (current_setting('t.org')::bigint, current_setting('t.d12')::bigint, 'Позвонить', now());
update public.tasks set done_date = now() where deal_id = current_setting('t.d12')::bigint and text = 'Позвонить';
update public.deals set stage_id = tests.stage('Лечение завершено') where id = current_setting('t.d12')::bigint;
select set_config('t.d13', tests.new_deal('Отказник')::text, true);
update public.deals set stage_id = tests.stage('Отказ'), lost_reason_id = (select id from public.lost_reasons where organization_id = current_setting('t.org')::bigint limit 1)
where id = current_setting('t.d13')::bigint;
select tests.assert(
  (select array_agg(distinct event order by event) from public.webhook_deliveries where status = 'pending')
  = array['deal.created', 'deal.lost', 'deal.stage_changed', 'deal.won', 'message.received', 'patient.created', 'payment.added', 'task.completed'],
  'every subscribed event is queued');
select tests.assert(
  (select count(*) from public.webhook_deliveries where status = 'pending' and event = 'message.received') = 1,
  'only inbound messages are «message received»');
select tests.assert(
  (select d.payload ->> 'event' = 'deal.stage_changed' and (d.payload ->> 'organization_id')::bigint = current_setting('t.org')::bigint
     and (d.payload -> 'data' ->> 'deal_id')::bigint = current_setting('t.d12')::bigint
     and (d.payload -> 'data' ->> 'previous_stage_id')::bigint = tests.stage('Новый лид')
     and d.payload -> 'data' -> 'deal' ->> 'stage_name' = 'В работе'
   from public.webhook_deliveries d where d.status = 'pending' and d.event = 'deal.stage_changed' order by d.id limit 1),
  'the payload carries the event, the ids and the deal');

-- A webhook of another clinic, and a switched off one, get nothing
select tests.login_as(current_setting('t.other')::uuid);
insert into public.webhooks (url, events) values ('https://other.example/hook', array['deal.created']);
select tests.logout();
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.webhooks (name, url, events, is_active) values ('Выключен', 'https://off.example/hook', array['deal.created'], false);
select tests.throws($q$insert into public.webhooks (url, events) values ('ftp://x', '{}')$q$, '23514', 'a webhook URL is http(s)');
select tests.throws($q$insert into public.webhooks (url, events) values ('https://x.kz', array['deal.deleted'])$q$, '23514', 'unknown events are refused');
select tests.logout();
select tests.new_deal('Ещё одна');
select tests.assert(
  (select count(*) from public.webhook_deliveries d join public.webhooks w on w.id = d.webhook_id
   where w.url in ('https://other.example/hook', 'https://off.example/hook')) = 0,
  'deliveries go to the active webhooks of the clinic only');
select tests.assert(
  private.has_webhook(current_setting('t.org')::bigint, 'deal.created')
  and not private.has_webhook(current_setting('t.org')::bigint, 'ping'),
  'has_webhook checks the subscribed events');

-- The dispatcher: claim, success, failure with backoff
update public.webhook_deliveries set status = 'cancelled' where status = 'pending';
select tests.new_deal('Доставка');
select set_config('t.delivery', (select id from public.webhook_deliveries where status = 'pending' and event = 'deal.created' order by id desc limit 1)::text, true);
select tests.login_service();
select tests.assert(
  (select count(*) = 2 and bool_and(c.url = 'https://example.com/hook' and length(c.secret) = 64)
   from public.claim_webhook_deliveries(10) c),
  'the dispatcher gets the due deliveries with the URL and the secret');
select tests.assert((select count(*) from public.claim_webhook_deliveries(10)) = 0, 'a delivery is taken once');
select tests.assert(public.complete_webhook_delivery(current_setting('t.delivery')::bigint, true, 200) = 'delivered', 'success');
select tests.assert(
  public.complete_webhook_delivery((select id from public.webhook_deliveries where status = 'sending' limit 1), false, 500, null) = 'pending',
  'a failure is retried');
select tests.logout();
select tests.assert(
  (select d.attempts = 1 and d.error = 'HTTP 500' and d.next_attempt_at > now() and d.response_status = 500
   from public.webhook_deliveries d where d.status = 'pending' and d.attempts = 1),
  'the retry waits (backoff) and keeps the error');
select tests.assert(
  (select w.failure_count = 1 and w.last_error = 'HTTP 500' and w.is_active from public.webhooks w where w.id = current_setting('t.webhook')::bigint),
  'the webhook shows the last error');
select tests.assert(
  private.webhook_retry_delay(1) = interval '1 minute' and private.webhook_retry_delay(3) = interval '30 minutes'
  and private.webhook_retry_delay(9) = interval '6 hours',
  'backoff: 1 min, 5 min, 30 min, 2 h, 6 h');

-- 10 failures in a row switch the webhook off and cancel its queue
select tests.new_deal('Сбой ' || n) from generate_series(1, 6) as n;
update public.webhook_deliveries set next_attempt_at = now() where status = 'pending';
select tests.login_service();
select public.complete_webhook_delivery(c.id, false, null, 'connection refused') from public.claim_webhook_deliveries(9) c;
select tests.logout();
select tests.assert(
  (select not w.is_active and w.disabled_at is not null and w.last_error like 'Отключён после 10 ошибок подряд: connection refused'
   from public.webhooks w where w.id = current_setting('t.webhook')::bigint),
  'after 10 failures in a row the webhook is switched off with the error');
select tests.assert(
  (select count(*) from public.webhook_deliveries where webhook_id = current_setting('t.webhook')::bigint and status = 'pending') = 0
  and (select count(*) from public.webhook_deliveries where webhook_id = current_setting('t.webhook')::bigint and status = 'cancelled' and error = 'Вебхук выключен') > 0,
  'its pending deliveries are cancelled');
-- Five attempts at most for one delivery
select tests.assert(
  (select count(*) from public.webhook_deliveries where attempts >= 5 and status = 'pending') = 0,
  'a delivery is not retried forever');

-- Switched on again by the owner: a fresh start; test ping
select tests.login_as(current_setting('t.owner')::uuid);
update public.webhooks set is_active = true where id = current_setting('t.webhook')::bigint;
select tests.assert(
  (select w.failure_count = 0 and w.disabled_at is null and w.last_error is null from public.webhooks w where w.id = current_setting('t.webhook')::bigint),
  'switching on resets the failures');
select tests.assert(public.send_test_webhook(current_setting('t.webhook')::bigint) = 1, 'the test ping is queued');
select tests.assert(
  (select length(public.regenerate_webhook_secret(current_setting('t.webhook')::bigint))) = 64,
  'the owner regenerates the secret');
select tests.assert(tests.count($q$select * from public.webhook_deliveries where event = 'ping'$q$) = 1, 'the owner sees the deliveries');
select tests.logout();
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(tests.count('select * from public.webhook_deliveries') = 0, 'managers do not see the deliveries');
select tests.logout();
select tests.login_as(current_setting('t.other')::uuid);
select tests.throws(format('select public.send_test_webhook(%s)', current_setting('t.webhook')), '22023', 'another clinic cannot ping our webhook');
select tests.assert(tests.count('select * from public.webhook_deliveries') = 0, 'another clinic sees none of our deliveries');
select tests.logout();

-- Imports queue nothing
update public.webhook_deliveries set status = 'cancelled' where status = 'pending';
select set_config('crm.importing', 'on', true);
select tests.new_deal('Импорт 2');
select set_config('crm.importing', 'off', true);
select tests.assert(tests.count($q$select * from public.webhook_deliveries where status = 'pending'$q$) = 0, 'crm.importing: no webhooks');

--
-- API keys and the public API
--
select tests.login_as(current_setting('t.owner')::uuid);
select set_config('t.key_read', (public.create_api_key('Чтение', 'read')) ->> 'key', true);
select set_config('t.key_write', (public.create_api_key('Сайт', 'write')) ->> 'key', true);
select set_config('t.key_limit', (public.create_api_key('Лимит', 'read')) ->> 'key', true);
select tests.throws($q$select public.create_api_key('x', 'admin')$q$, '22023', 'the scope is read or write');
select tests.assert(tests.count('select id, name, prefix, scope, revoked_at from public.api_keys') = 3, 'the owner lists the keys');
select tests.throws($q$select key_hash from public.api_keys$q$, '42501', 'nobody reads the key hashes');
select tests.throws($q$insert into public.api_keys (organization_id, name, prefix, key_hash) values (1, 'x', 'x', 'x')$q$, '42501', 'keys are created by the function only');
select tests.logout();
select tests.assert(
  current_setting('t.key_write') like 'dcrm_%' and length(current_setting('t.key_write')) = 69
  and (select k.prefix = left(current_setting('t.key_write'), 12) and k.key_hash = private.api_key_hash(current_setting('t.key_write'))
       and k.key_hash <> current_setting('t.key_write')
       from public.api_keys k where k.name = 'Сайт'),
  'only the hash of the key is stored, with a recognizable prefix');
select tests.assert(
  exists (select 1 from public.audit_log a where a.entity = 'api_key' and a.action = 'create' and not a.changes ? 'key_hash'),
  'key creation is audited without the hash');

select tests.login_as(current_setting('t.other')::uuid);
select set_config('t.key_other', (public.create_api_key('Другая', 'write')) ->> 'key', true);
select tests.assert(tests.count('select id from public.api_keys') = 1, 'another clinic only sees its own keys');
select tests.logout();
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(tests.count('select id from public.api_keys') = 0, 'managers do not see the keys');
select tests.logout();

select tests.login_service();
-- Auth and scopes
select tests.throws($q$select public.api_list_deals('dcrm_wrong', '{}')$q$, 'PT401', 'an unknown key is refused (401)');
select tests.throws($q$select public.api_list_deals(null, '{}')$q$, 'PT401', 'no key is refused (401)');
select tests.throws(
  format($q$select public.api_create_deal(%L, '{"patient": {"first_name": "Тест"}}')$q$, current_setting('t.key_read')),
  'PT403', 'a read key cannot write (403)');
-- Reading
select tests.assert(
  (select (r -> 'meta' ->> 'total')::integer = (select count(*) from public.deals where organization_id = current_setting('t.org')::bigint)
     and jsonb_array_length(r -> 'data') = least((r -> 'meta' ->> 'total')::integer, 50)
   from public.api_list_deals(current_setting('t.key_read'), '{}') as r),
  'the list has the deals of the key''s clinic, 50 per page');
select tests.assert(
  (select (r -> 'meta' ->> 'total')::integer = (select count(*) from public.deals where stage_id = tests.stage('В работе'))
     and jsonb_array_length(r -> 'data') = 2 and (r -> 'meta' ->> 'per_page')::integer = 2
     and not exists (select 1 from jsonb_array_elements(r -> 'data') e where (e ->> 'stage_id')::bigint <> tests.stage('В работе'))
   from public.api_list_deals(current_setting('t.key_read'),
     jsonb_build_object('stage_id', tests.stage('В работе'), 'per_page', 2)) as r),
  'filter by stage, page size');
select tests.assert(
  (select (r -> 'meta' ->> 'total')::integer = 0 from public.api_list_deals(current_setting('t.key_read'),
     jsonb_build_object('updated_since', now() + interval '1 day')) as r),
  'filter by updated_since');
select tests.assert(
  (select (r -> 'meta' ->> 'total')::integer = 0 from public.api_list_deals(current_setting('t.key_other'), '{}') as r)
  or (select not exists (
        select 1 from jsonb_array_elements(r -> 'data') e
        where (e ->> 'id')::bigint in (select id from public.deals where organization_id = current_setting('t.org')::bigint))
      from public.api_list_deals(current_setting('t.key_other'), '{}') as r),
  'another clinic''s key lists none of our deals');
select tests.assert(
  (select r -> 'data' ->> 'name' = 'Асель' and r -> 'data' -> 'patient' ->> 'first_name' = 'Асель'
   from public.api_get_deal(current_setting('t.key_read'), current_setting('t.d1')::bigint) as r),
  'a deal with its patient');
select tests.throws(
  format('select public.api_get_deal(%L, %s)', current_setting('t.key_other'), current_setting('t.d1')),
  'PT404', 'a deal of another clinic is not found (404)');
select tests.assert(
  (select jsonb_array_length(r -> 'data') = 2
     and (select array_agg(s ->> 'name' order by (s ->> 'position')::integer) from jsonb_array_elements(r -> 'data' -> 0 -> 'stages') s)[1] = 'Новый лид'
   from public.api_list_pipelines(current_setting('t.key_read')) as r),
  'pipelines with their stages, of the clinic only');
-- Writing
select set_config('t.api_deal', (public.api_create_deal(current_setting('t.key_write'),
  jsonb_build_object('name', 'С сайта', 'plan_amount', 150000,
    'service_id', (select id from public.services where organization_id = current_setting('t.org')::bigint and name = 'Гигиена'),
    'patient', jsonb_build_object('first_name', 'Дана', 'phone', '8 701 555 44 33')))) -> 'data' ->> 'id', true);
select tests.assert(
  (select d.name = 'С сайта' and d.plan_amount = 150000 and d.organization_id = current_setting('t.org')::bigint
     and p.phones = array['+77015554433'] and d.stage_id = tests.stage('Новый лид')
   from public.deals d join public.patients p on p.id = d.patient_id where d.id = current_setting('t.api_deal')::bigint),
  'a deal is created with a new patient (phone normalized) on the first stage');
select tests.assert(
  (select (r ->> 'created_patient')::boolean = false and (r -> 'data' ->> 'patient_id')::bigint
     = (select patient_id from public.deals where id = current_setting('t.api_deal')::bigint)
   from public.api_create_deal(current_setting('t.key_write'),
     '{"patient": {"first_name": "Дана", "phone": "+7 (701) 555-44-33"}}'::jsonb) as r),
  'the patient is found by phone, not doubled');
select tests.assert(
  (select r -> 'data' ->> 'stage_name' = 'Записан' and (r -> 'data' -> 'tags') = '[]'::jsonb
   from public.api_update_deal(current_setting('t.key_write'), current_setting('t.api_deal')::bigint,
     jsonb_build_object('stage_id', tests.stage('Записан'), 'appointment_at', now() + interval '1 day')) as r),
  'PATCH moves the deal and sets the visit');
select tests.assert(
  exists (select 1 from public.audit_log a where a.deal_id = current_setting('t.api_deal')::bigint and a.source = 'api'),
  'changes made through the API are audited with the source api');
select tests.throws(
  format($q$select public.api_update_deal(%L, %s, '{"stage_id": %s}')$q$, current_setting('t.key_write'), current_setting('t.api_deal'), tests.stage('Отказ')),
  '23514', 'the deal rules apply (a refusal needs its reason)');
select tests.throws(
  format($q$select public.api_update_deal(%L, %s, '{"name": "x"}')$q$, current_setting('t.key_other'), current_setting('t.api_deal')),
  'PT404', 'another clinic cannot change our deal');
select tests.throws(
  format($q$select public.api_create_deal(%L, jsonb_build_object('patient_id', %s))$q$, current_setting('t.key_other'),
    (select patient_id from public.deals where id = current_setting('t.api_deal')::bigint)),
  'PT404', 'another clinic cannot attach a deal to our patient');
select tests.throws(
  format($q$select public.api_create_deal(%L, jsonb_build_object('patient', jsonb_build_object('first_name', 'Икс'), 'stage_id', %s))$q$,
    current_setting('t.key_other'), tests.stage('Записан')),
  '23503', 'another clinic cannot use our stages');
select tests.throws(
  format($q$select public.api_create_deal(%L, jsonb_build_object('patient', jsonb_build_object('first_name', 'Икс'), 'sales_id', %s))$q$,
    current_setting('t.key_other'), current_setting('t.m1_id')),
  '23503', 'another clinic cannot give a deal to our employee');
select tests.throws(
  format($q$select public.api_create_deal(%L, '{"patient": {"first_name": "Икс"}, "tags": [999999999]}')$q$, current_setting('t.key_write')),
  '23503', 'unknown tags are refused');
select tests.assert(
  (select r -> 'data' ->> 'text' = 'Заявка из МИС' from public.api_add_deal_note(current_setting('t.key_write'),
     current_setting('t.api_deal')::bigint, '{"text": " Заявка из МИС "}') as r),
  'a note is added to the deal');
select tests.assert(
  exists (select 1 from public.deal_notes n where n.deal_id = current_setting('t.api_deal')::bigint and n.type = 'api'),
  'the note is stored with the type api');
select tests.throws(
  format($q$select public.api_add_deal_note(%L, %s, '{"text": "x"}')$q$, current_setting('t.key_other'), current_setting('t.api_deal')),
  'PT404', 'another clinic cannot add notes to our deal');
select tests.throws(
  format($q$select public.api_add_deal_note(%L, %s, '{"text": " "}')$q$, current_setting('t.key_write'), current_setting('t.api_deal')),
  '22023', 'a note needs a text');
-- Patients
select tests.assert(
  (select (r ->> 'created')::boolean and r -> 'data' ->> 'last_name' = 'Сейтова'
   from public.api_create_patient(current_setting('t.key_write'),
     '{"first_name": "Алия", "last_name": "Сейтова", "phones": ["87770001122"], "city": "Алматы"}') as r),
  'a patient is created');
select tests.assert(
  (select not (r ->> 'created')::boolean from public.api_create_patient(current_setting('t.key_write'), '{"phone": "+77770001122"}') as r),
  'the same phone returns the same patient');
select tests.assert(
  (select (r -> 'meta' ->> 'total')::integer = 1 and r -> 'data' -> 0 ->> 'first_name' = 'Алия'
   from public.api_list_patients(current_setting('t.key_read'), '{"phone": "8 777 000 11 22"}') as r),
  'patients are found by phone');
select tests.assert(
  (select (r -> 'meta' ->> 'total')::integer = 0
   from public.api_list_patients(current_setting('t.key_other'), '{"phone": "8 777 000 11 22"}') as r),
  'another clinic does not find our patients');
select tests.throws(
  format($q$select public.api_create_patient(%L, '{"city": "Алматы"}')$q$, current_setting('t.key_write')),
  '22023', 'a patient needs a name or a phone');
-- Revoked key
select tests.logout();
select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert(public.revoke_api_key((select id from public.api_keys where name = 'Чтение')), 'the owner revokes a key');
select tests.logout();
select tests.login_service();
select tests.throws(format($q$select public.api_list_pipelines(%L)$q$, current_setting('t.key_read')), 'PT401', 'a revoked key is refused');
-- Rate limit: 60 requests per minute per key
select count(public.api_list_pipelines(current_setting('t.key_limit'))) from generate_series(1, 60);
select tests.throws(format($q$select public.api_list_pipelines(%L)$q$, current_setting('t.key_limit')), 'PT429', 'the 61st request of the minute is refused (429)');
select tests.assert((public.api_list_pipelines(current_setting('t.key_write')) -> 'data') is not null, 'another key is not limited');
select tests.logout();
select tests.assert(
  (select last_used_at is not null from public.api_keys where name = 'Лимит'),
  'the last use of a key is shown');
select private.stage_triggers_tick(now() + interval '2 hours');
select tests.assert((select count(*) from public.api_request_counts) = 0, 'the tick purges the old rate limit windows');

--
-- A clinic with triggers, runs, webhooks, deliveries and keys can be deleted
--
insert into public.stage_triggers (organization_id, stage_id, event, action, name, target_sales_id)
values (current_setting('t.org')::bigint, tests.stage('Записан'), 'stage_entered', 'set_responsible', 'Удаление', current_setting('t.m1_id')::bigint);
delete from public.organizations where id = current_setting('t.org')::bigint;
select tests.assert(
  not exists (select 1 from public.stage_triggers where organization_id = current_setting('t.org')::bigint)
  and not exists (select 1 from public.webhook_deliveries where organization_id = current_setting('t.org')::bigint)
  and not exists (select 1 from public.api_keys where organization_id = current_setting('t.org')::bigint),
  'deleting the clinic removes its automations, webhooks and keys');

rollback;

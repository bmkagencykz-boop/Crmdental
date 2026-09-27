--
-- Reports (stage 7): conversion, speed and KPI, lost reasons, money on a small
-- clinic with known timestamps; filters; only the owner and the head may call
-- them; another clinic sees nothing of this one.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.head_id', (select id from public.sales where email = 'head@clinic.kz')::text, true);
select set_config('t.m1_id', (select id from public.sales where email = 'm1@clinic.kz')::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);

-- No automatic tasks: the fixture creates its own
delete from public.task_rules;

create function tests.source(code text) returns bigint language sql as $$
  select id from public.lead_sources where organization_id = current_setting('t.org')::bigint and lead_sources.code = source.code
$$;
create function tests.service(service_name text) returns bigint language sql as $$
  select id from public.services where organization_id = current_setting('t.org')::bigint and name = service_name
$$;
create function tests.stage(stage_name text) returns bigint language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
  where p.organization_id = current_setting('t.org')::bigint and p.is_default and s.name = stage_name
$$;
create function tests.deal(deal_name text) returns bigint language sql as $$
  select id from public.deals where organization_id = current_setting('t.org')::bigint and name = deal_name
$$;
-- Moves a deal through stages, one statement per stage (the log gets one event each)
create function tests.walk(deal_name text, stage_names text[]) returns void language plpgsql as $$
declare stage_name text;
begin
  foreach stage_name in array stage_names loop
    update public.deals
    set stage_id = tests.stage(stage_name),
        lost_reason_id = case when stage_name = 'Отказ'
          then (select id from public.lost_reasons where organization_id = current_setting('t.org')::bigint and name = 'Дорого') end
    where id = tests.deal(deal_name);
  end loop;
end;
$$;
-- Spreads the log of a deal: its creation at `created`, then one event per
-- `step` (all rows of a transaction share now()); the deal columns follow
create function tests.timeline(deal_name text, created timestamptz, steps interval[]) returns void language plpgsql as $$
declare
  target_id bigint := tests.deal(deal_name);
  last_at timestamptz;
begin
  set local session_replication_role = replica;
  with numbered as (
    select e.id, row_number() over (order by e.id) as n
    from public.deal_events e
    where e.deal_id = target_id and e.type in ('created', 'stage_changed')
  )
  update public.deal_events e
  set created_at = created + coalesce((select sum(x) from unnest(steps[1:numbered.n - 1]) x), interval '0')
  from numbered
  where numbered.id = e.id;
  select max(created_at) into last_at from public.deal_events where deal_events.deal_id = target_id;
  update public.deals d
  set created_at = created,
      stage_changed_at = last_at,
      closed_at = case when d.closed_at is not null then last_at end
  where d.id = target_id;
  set local session_replication_role = origin;
end;
$$;

-- The clinic: four deals in September, one a year before
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.patients (first_name) values ('Пациент');
insert into public.deals (patient_id, name, source_id, service_id, sales_id, plan_amount)
select p.id, v.name, tests.source(v.source), tests.service(v.service), v.sales_id, v.plan_amount
from public.patients p, (values
  ('d1', 'whatsapp', 'Имплантация', current_setting('t.m1_id')::bigint, 300000),
  ('d2', 'whatsapp', 'Терапия', current_setting('t.m1_id')::bigint, 50000),
  ('d3', 'instagram', 'Гигиена', current_setting('t.head_id')::bigint, 20000),
  ('d4', 'instagram', 'Ортодонтия', current_setting('t.head_id')::bigint, 200000),
  ('d5', 'whatsapp', 'Имплантация', current_setting('t.m1_id')::bigint, 400000)
) as v(name, source, service, sales_id, plan_amount);

select tests.walk('d1', array['Записан', 'Пришёл на консультацию', 'План согласован', 'В лечении']);
select tests.walk('d2', array['Записан', 'Отказ']);
select tests.walk('d4', array['В работе', 'План согласован', 'Лечение завершено']);
select tests.walk('d5', array['Записан']);

insert into public.deal_payments (deal_id, amount, paid_at) values
  (tests.deal('d1'), 100000, '2026-09-12'),
  (tests.deal('d1'), 50000, '2026-08-01'),
  (tests.deal('d4'), 200000, '2026-09-13');

-- Tasks of m1: one done late, one done in time, one still open past its due date
insert into public.tasks (deal_id, text, sales_id, created_at, due_date, done_date) values
  (tests.deal('d1'), 'late', current_setting('t.m1_id')::bigint, '2026-09-10 12:00+05', '2026-09-11 12:00+05', '2026-09-12 12:00+05'),
  (tests.deal('d2'), 'in time', current_setting('t.m1_id')::bigint, '2026-09-10 12:00+05', '2026-09-11 12:00+05', '2026-09-10 18:00+05'),
  (tests.deal('d1'), 'open', current_setting('t.m1_id')::bigint, '2026-09-10 12:00+05', '2026-09-15 12:00+05', null);
select tests.logout();

-- Timestamps: d1, d2, d4 on September 10th, d3 on the 20th, d5 a year before
select tests.timeline('d1', '2026-09-10 10:00+05', array[interval '1 hour', interval '2 hours', interval '3 hours', interval '4 hours']);
select tests.timeline('d2', '2026-09-10 10:00+05', array[interval '1 hour', interval '4 hours']);
select tests.timeline('d3', '2026-09-20 10:00+05', array[]::interval[]);
select tests.timeline('d4', '2026-09-10 10:00+05', array[interval '1 hour', interval '1 hour', interval '1 hour']);
select tests.timeline('d5', '2025-09-10 10:00+05', array[interval '1 hour']);
set local session_replication_role = replica;
update public.deals set first_response_at = created_at + interval '30 minutes' where id = tests.deal('d1');
update public.deals set first_response_at = created_at + interval '90 minutes' where id = tests.deal('d3');
insert into public.messages (organization_id, patient_id, deal_id, transport, chat_id, direction, text, sales_id, sent_at)
select d.organization_id, d.patient_id, d.id, 'whatsapp', '1', 'out', v.text, current_setting('t.m1_id')::bigint, v.sent_at::timestamptz
from public.deals d, (values ('a', '2026-09-10 11:00+05'), ('b', '2026-09-11 11:00+05'), ('c', '2026-08-01 11:00+05')) as v(text, sent_at)
where d.id = tests.deal('d1');
set local session_replication_role = origin;

select set_config('t.from', '2026-09-01 00:00+05', true);
select set_config('t.to', '2026-10-01 00:00+05', true);

-- Only the owner and the head see the reports
select tests.login_as(current_setting('t.m1')::uuid);
select tests.throws($q$select public.report_conversion()$q$, '42501', 'a manager cannot read the conversion report');
select tests.throws($q$select public.report_speed()$q$, '42501', 'a manager cannot read the speed report');
select tests.throws($q$select public.report_lost_reasons()$q$, '42501', 'a manager cannot read the lost reasons');
select tests.throws($q$select public.report_money()$q$, '42501', 'a manager cannot read the money report');
select tests.logout();
select tests.login_anon();
select tests.throws($q$select public.report_money()$q$, '42501', 'anonymous users cannot call the reports');
select tests.logout();
select tests.login_as(current_setting('t.head')::uuid);
select tests.assert((public.report_conversion() -> 'totals' ->> 'deals')::int = 5, 'the head reads the reports');
select tests.logout();

select tests.login_as(current_setting('t.owner')::uuid);

-- Conversion
create temporary table conv on commit drop as
select public.report_conversion(current_setting('t.from')::timestamptz, current_setting('t.to')::timestamptz) as r;
select tests.assert(
  (select r -> 'totals' from conv)
    = '{"deals": 4, "appointment": 3, "visit": 2, "plan": 2, "paid": 2, "won": 1, "lost": 1}'::jsonb,
  'conversion totals of the deals created in the period');
select tests.assert(
  (select string_agg((f ->> 'name') || '=' || (f ->> 'deals'), ', ' order by ord) from conv, jsonb_array_elements(r -> 'funnel') with ordinality as x(f, ord))
    = 'Новый лид=4, В работе=3, Записан=3, Пришёл на консультацию=2, План согласован=2, В лечении=2, Лечение завершено=1, Отказ=1',
  'the funnel counts the deals that reached each stage, skipped stages included');
select tests.assert(
  (select jsonb_agg(x - 'id' order by x ->> 'name') from conv, jsonb_array_elements(r -> 'by_source') x)
    = '[{"name": "Instagram", "deals": 2, "appointment": 1, "visit": 1, "plan": 1, "paid": 1, "won": 1, "lost": 0},
        {"name": "WhatsApp", "deals": 2, "appointment": 2, "visit": 1, "plan": 1, "paid": 1, "won": 0, "lost": 1}]'::jsonb,
  'conversion by source');
select tests.assert(
  (select jsonb_agg((x ->> 'id')::bigint order by x ->> 'id') from conv, jsonb_array_elements(r -> 'by_sales') x)
    = jsonb_build_array(current_setting('t.head_id')::bigint, current_setting('t.m1_id')::bigint)
    or (select jsonb_agg((x ->> 'id')::bigint order by x ->> 'id') from conv, jsonb_array_elements(r -> 'by_sales') x)
    = jsonb_build_array(current_setting('t.m1_id')::bigint, current_setting('t.head_id')::bigint),
  'conversion by employee');

-- Filters
select tests.assert(
  (public.report_conversion(current_setting('t.from')::timestamptz, current_setting('t.to')::timestamptz, null, null, tests.source('instagram')) -> 'totals' ->> 'deals')::int = 2,
  'source filter');
select tests.assert(
  (public.report_conversion(current_setting('t.from')::timestamptz, current_setting('t.to')::timestamptz, null, current_setting('t.m1_id')::bigint) -> 'totals')
    = '{"deals": 2, "appointment": 2, "visit": 1, "plan": 1, "paid": 1, "won": 0, "lost": 1}'::jsonb,
  'employee filter');
select tests.assert((public.report_conversion() -> 'totals' ->> 'deals')::int = 5, 'no period: every deal');
select set_config('t.pipeline2', public.create_pipeline('Ортодонтия')::text, true);
select tests.assert(
  (public.report_conversion(null, null, current_setting('t.pipeline2')::bigint) -> 'totals' ->> 'deals')::int = 0
  and jsonb_array_length(public.report_conversion(null, null, current_setting('t.pipeline2')::bigint) -> 'funnel') = 3,
  'pipeline filter: its own stages, none of the other deals');

-- Speed and KPI
create temporary table speed on commit drop as
select public.report_speed(current_setting('t.from')::timestamptz, current_setting('t.to')::timestamptz) as r;
select tests.assert(
  (select r -> 'first_response' from speed) = '{"deals": 2, "avg_seconds": 3600}'::jsonb,
  'average first response of the deals created in the period');
select tests.assert(
  (select x from speed, jsonb_array_elements(r -> 'stages') x where x ->> 'name' = 'Записан') ->> 'avg_seconds' = '10800'
  and (select x from speed, jsonb_array_elements(r -> 'stages') x where x ->> 'name' = 'Записан') ->> 'stays' = '2',
  'average time in a stage (2 h and 4 h)');
select tests.assert(
  (select x from speed, jsonb_array_elements(r -> 'stages') x where x ->> 'name' = 'План согласован') ->> 'avg_seconds' = '9000',
  'average time in a stage (4 h and 1 h)');
select tests.assert(
  (select count(*) from speed, jsonb_array_elements(r -> 'stages') x where x ->> 'name' in ('Лечение завершено', 'Отказ')) = 0,
  'only open stages have a time');
select tests.assert(
  (select x - 'id' - 'name' from speed, jsonb_array_elements(r -> 'by_sales') x where (x ->> 'id')::bigint = current_setting('t.m1_id')::bigint)
    = '{"deals": 2, "first_response_seconds": 1800, "tasks_created": 3, "tasks_done": 2, "tasks_due": 3,
        "tasks_overdue": 2, "messages_sent": 2, "open_deals": 2, "deals_without_task": 1}'::jsonb,
  'KPI of an employee: deals, tasks, overdue, messages, deals without a task');
select tests.assert(
  (select jsonb_array_length(r -> 'by_sales') from speed) = 3,
  'every active employee has a KPI row');
select tests.assert(
  jsonb_array_length(public.report_speed(null, null, null, current_setting('t.m1_id')::bigint) -> 'by_sales') = 1,
  'employee filter on the KPI');

-- Lost reasons
select tests.assert(
  public.report_lost_reasons(current_setting('t.from')::timestamptz, current_setting('t.to')::timestamptz)
    = jsonb_build_object(
        'totals', '{"deals": 1, "plan_amount": 50000}'::jsonb,
        'by_reason', jsonb_build_array(jsonb_build_object('id', (select id from public.lost_reasons where name = 'Дорого'), 'name', 'Дорого', 'deals', 1, 'plan_amount', 50000)),
        'by_stage', jsonb_build_array(jsonb_build_object('id', tests.stage('Записан'), 'name', 'Записан', 'pipeline_name', 'Основная', 'deals', 1, 'plan_amount', 50000))),
  'lost deals by reason and by the stage they were lost from');
select tests.assert(
  (public.report_lost_reasons('2026-10-01', null) -> 'totals' ->> 'deals')::int = 0,
  'lost reasons follow the period');

-- Money
create temporary table money on commit drop as
select public.report_money(current_setting('t.from')::timestamptz, current_setting('t.to')::timestamptz) as r;
select tests.assert(
  (select r -> 'totals' from money)
    = '{"agreed_deals": 2, "agreed_amount": 500000, "paid_amount": 300000, "paying_deals": 2, "average_check": 150000}'::jsonb,
  'agreed plans, payments of the period and the average check');
select tests.assert(
  (select jsonb_object_agg(x ->> 'name', x -> 'paid_amount') from money, jsonb_array_elements(r -> 'by_service') x)
    = '{"Имплантация": 100000, "Ортодонтия": 200000}'::jsonb,
  'money by service');
select tests.assert(
  (select x -> 'agreed_amount' from money, jsonb_array_elements(r -> 'by_sales') x where (x ->> 'id')::bigint = current_setting('t.m1_id')::bigint) = '300000'::jsonb,
  'money by employee');
select tests.assert(
  (public.report_money(null, null) -> 'totals' ->> 'paid_amount')::int = 350000,
  'no period: every payment');
select tests.logout();

-- Another clinic sees nothing of this one
select set_config('t.pipeline1', (select id from public.pipelines where organization_id = current_setting('t.org')::bigint and is_default)::text, true);
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert((public.report_conversion() -> 'totals' ->> 'deals')::int = 0, 'another clinic sees none of these deals');
select tests.assert(
  jsonb_array_length(public.report_conversion(null, null, current_setting('t.pipeline1')::bigint) -> 'funnel') = 0,
  'nor the stages of this clinic');
select tests.assert((public.report_money() -> 'totals' ->> 'paid_amount')::int = 0, 'nor its payments');
select tests.assert(
  (select count(*) from jsonb_array_elements(public.report_speed() -> 'by_sales')) = 1,
  'nor its employees');
select tests.logout();

rollback;

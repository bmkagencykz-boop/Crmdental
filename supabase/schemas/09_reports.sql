--
-- Reports (stage 7): conversion, speed and KPI, lost reasons, money.
--
-- Stage history comes from public.deal_events: every deal logs its creation
-- (to_stage_id = first stage) and every stage change, with a timestamp, since
-- stage 2. No extra table is needed.
--
-- The report_* functions run with the caller's rights (SECURITY INVOKER): RLS
-- keeps them inside the caller's clinic. They are for the owner and the head
-- only; anybody else gets insufficient_privilege. Periods are half-open
-- [period_from, period_to), a null bound is open. The same computations for
-- the demo live in src/components/atomic-crm/reports/reportMath.ts.
--
-- Stage 13 adds the doctor: a filter_doctor_id parameter on every report, the
-- conversion and the money by doctor, and the prepayments (payments of kind
-- 'prepayment') in the money. The doctor columns are declared in
-- 13_doctors.sql, loaded after this file: the functions that read them are
-- plpgsql, resolved when they run.
--

create index if not exists deals_created_at_idx on public.deals using btree (organization_id, created_at);
create index if not exists deal_events_stage_idx on public.deal_events using btree (organization_id, to_stage_id) where to_stage_id is not null;

-- Reports are for the owner and the head, and for whom the owner gives the
-- right «Отчёты» (stage 30)
CREATE OR REPLACE FUNCTION "private"."report_check_access"() RETURNS "void"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
begin
  if coalesce(private.access_scope('reports', 'view') = 'all', false) is false then
    raise exception 'Нет доступа к отчётам'
      using errcode = 'insufficient_privilege', hint = 'reports_forbidden';
  end if;
end;
$$;

-- Positions of the key stages of every pipeline of the clinic: by the names of
-- the template, else by the template order among the open stages. A pipeline
-- without a "plan agreed" stage counts its first won stage instead.
CREATE OR REPLACE FUNCTION "private"."report_key_stages"() RETURNS TABLE("pipeline_id" bigint, "appointment_position" integer, "visit_position" integer, "plan_position" integer)
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select
    p.id,
    coalesce(
      (select s.position from public.stages s where s.pipeline_id = p.id and s.kind = 'open' and s.name = 'Записан' order by s.position, s.id limit 1),
      (select s.position from public.stages s where s.pipeline_id = p.id and s.kind = 'open' order by s.position, s.id offset 2 limit 1)
    ),
    coalesce(
      (select s.position from public.stages s where s.pipeline_id = p.id and s.kind = 'open' and s.name = 'Пришёл на консультацию' order by s.position, s.id limit 1),
      (select s.position from public.stages s where s.pipeline_id = p.id and s.kind = 'open' order by s.position, s.id offset 3 limit 1)
    ),
    coalesce(
      (select s.position from public.stages s where s.pipeline_id = p.id and s.kind = 'open' and s.name = 'План согласован' order by s.position, s.id limit 1),
      (select s.position from public.stages s where s.pipeline_id = p.id and s.kind = 'open' order by s.position, s.id offset 4 limit 1),
      (select s.position from public.stages s where s.pipeline_id = p.id and s.kind = 'won' order by s.position, s.id limit 1)
    )
  from public.pipelines p
  where p.organization_id = private.current_organization_id()
$$;

-- Every deal of the clinic (matching the filters) with how far it went in its
-- current pipeline: the furthest open or won stage it entered, the key stages
-- reached, when it first reached the "plan agreed" stage, and for a lost deal
-- the stage it was lost from.
CREATE OR REPLACE FUNCTION "private"."report_deal_progress"("filter_pipeline_id" bigint, "filter_sales_id" bigint, "filter_source_id" bigint, "filter_doctor_id" bigint) RETURNS TABLE("deal_id" bigint, "pipeline_id" bigint, "stage_id" bigint, "stage_kind" "text", "sales_id" bigint, "source_id" bigint, "service_id" bigint, "doctor_id" bigint, "lost_reason_id" bigint, "plan_amount" bigint, "paid_amount" bigint, "created_at" timestamp with time zone, "closed_at" timestamp with time zone, "first_response_at" timestamp with time zone, "archived_at" timestamp with time zone, "reached_position" integer, "reached_appointment" boolean, "reached_visit" boolean, "reached_plan" boolean, "agreed_at" timestamp with time zone, "lost_from_stage_id" bigint)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
#variable_conflict use_column
begin
  return query
  with scope as (
    select d.*, s.kind as stage_kind
    from public.deals d
      join public.stages s on s.id = d.stage_id
    where d.organization_id = private.current_organization_id()
      and (filter_pipeline_id is null or d.pipeline_id = filter_pipeline_id)
      and (filter_sales_id is null or d.sales_id = filter_sales_id)
      and (filter_source_id is null or d.source_id = filter_source_id)
      and (filter_doctor_id is null or d.doctor_id = filter_doctor_id)
  ),
  -- Open and won stages entered in the current pipeline, the current one included
  entries as (
    select e.deal_id, s.position, e.created_at
    from public.deal_events e
      join scope d on d.id = e.deal_id
      join public.stages s on s.id = e.to_stage_id and s.pipeline_id = d.pipeline_id
    where e.organization_id = private.current_organization_id()
      and e.type in ('created', 'stage_changed')
      and s.kind <> 'lost'
    union all
    select d.id, s.position, d.stage_changed_at
    from scope d
      join public.stages s on s.id = d.stage_id
    where s.kind <> 'lost'
  ),
  keys as (
    select * from private.report_key_stages()
  ),
  progress as (
    select
      en.deal_id,
      max(en.position) as reached_position,
      min(en.created_at) filter (where en.position >= k.plan_position) as agreed_at
    from entries en
      join scope d on d.id = en.deal_id
      left join keys k on k.pipeline_id = d.pipeline_id
    group by en.deal_id
  )
  select
    d.id, d.pipeline_id, d.stage_id, d.stage_kind, d.sales_id, d.source_id, d.service_id,
    d.doctor_id, d.lost_reason_id, d.plan_amount, d.paid_amount, d.created_at, d.closed_at,
    d.first_response_at, d.archived_at,
    p.reached_position,
    coalesce(p.reached_position >= k.appointment_position, false),
    coalesce(p.reached_position >= k.visit_position, false),
    coalesce(p.reached_position >= k.plan_position, false),
    p.agreed_at,
    case when d.stage_kind = 'lost' then (
      select e.from_stage_id
      from public.deal_events e
      where e.organization_id = d.organization_id and e.deal_id = d.id
        and e.type = 'stage_changed' and e.to_stage_id = d.stage_id
      order by e.created_at desc, e.id desc
      limit 1
    ) end
  from scope d
    left join progress p on p.deal_id = d.id
    left join keys k on k.pipeline_id = d.pipeline_id;
end;
$$;

-- Conversion: the deals created in the period, how far they went.
--   funnel: deals that reached each stage of the pipeline (the chosen one, else
--     the default one); a won or lost stage counts the deals standing in it
--   totals, by_source, by_sales, by_doctor: deals, reached appointment /
--     visit / plan, paid (reached the plan and has a payment), won, lost
CREATE OR REPLACE FUNCTION "public"."report_conversion"("period_from" timestamp with time zone DEFAULT NULL::timestamp with time zone, "period_to" timestamp with time zone DEFAULT NULL::timestamp with time zone, "filter_pipeline_id" bigint DEFAULT NULL::bigint, "filter_sales_id" bigint DEFAULT NULL::bigint, "filter_source_id" bigint DEFAULT NULL::bigint, "filter_doctor_id" bigint DEFAULT NULL::bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
declare
  funnel_pipeline_id bigint;
  report jsonb;
begin
  perform private.report_check_access();
  funnel_pipeline_id := coalesce(filter_pipeline_id, (
    select p.id from public.pipelines p
    where p.organization_id = private.current_organization_id()
    order by p.is_default desc, p.position, p.id
    limit 1
  ));

  with cohort as (
    select *
    from private.report_deal_progress(filter_pipeline_id, filter_sales_id, filter_source_id, filter_doctor_id) d
    where (period_from is null or d.created_at >= period_from)
      and (period_to is null or d.created_at < period_to)
  ),
  grouped as (
    select
      grouping(c.source_id) as by_source,
      grouping(c.sales_id) as by_sales,
      grouping(c.doctor_id) as by_doctor,
      c.source_id,
      c.sales_id,
      c.doctor_id,
      count(*) as deals,
      count(*) filter (where c.reached_appointment) as appointment,
      count(*) filter (where c.reached_visit) as visit,
      count(*) filter (where c.reached_plan) as plan,
      count(*) filter (where c.reached_plan and c.paid_amount > 0) as paid,
      count(*) filter (where c.stage_kind = 'won') as won,
      count(*) filter (where c.stage_kind = 'lost') as lost
    from cohort c
    group by grouping sets ((), (c.source_id), (c.sales_id), (c.doctor_id))
  ),
  metrics as (
    select g.*, jsonb_build_object(
      'deals', g.deals, 'appointment', g.appointment, 'visit', g.visit, 'plan', g.plan,
      'paid', g.paid, 'won', g.won, 'lost', g.lost
    ) as row_json
    from grouped g
  )
  select jsonb_build_object(
    'pipeline_id', funnel_pipeline_id,
    'funnel', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'stage_id', s.id, 'name', s.name, 'kind', s.kind, 'color', s.color,
        'deals', (
          select count(*) from cohort c
          where c.pipeline_id = s.pipeline_id
            and case when s.kind = 'open' then c.reached_position >= s.position else c.stage_id = s.id end
        )
      ) order by s.position, s.id), '[]'::jsonb)
      from public.stages s
      where s.pipeline_id = funnel_pipeline_id
    ),
    'totals', (select m.row_json from metrics m where m.by_source = 1 and m.by_sales = 1 and m.by_doctor = 1),
    'by_source', (
      select coalesce(jsonb_agg(
        jsonb_build_object('id', m.source_id, 'name', ls.name) || m.row_json
        order by m.deals desc, ls.position, ls.id
      ), '[]'::jsonb)
      from metrics m
        left join public.lead_sources ls on ls.id = m.source_id
      where m.by_source = 0
    ),
    'by_sales', (
      select coalesce(jsonb_agg(
        jsonb_build_object('id', m.sales_id, 'name', btrim(concat_ws(' ', sa.first_name, sa.last_name))) || m.row_json
        order by m.deals desc, sa.last_name, sa.id
      ), '[]'::jsonb)
      from metrics m
        left join public.sales sa on sa.id = m.sales_id
      where m.by_sales = 0
    ),
    'by_doctor', (
      select coalesce(jsonb_agg(
        jsonb_build_object('id', m.doctor_id, 'name', dr.name) || m.row_json
        order by m.deals desc, dr.position, dr.id
      ), '[]'::jsonb)
      from metrics m
        left join public.doctors dr on dr.id = m.doctor_id
      where m.by_doctor = 0
    )
  ) into report;
  return report;
end;
$$;

-- Speed and KPI.
--   first_response: deals created in the period that got an answer, and the
--     average time from creation to the first answer, in seconds
--   stages: open stages (of the chosen pipeline, else all), the stays that
--     started in the period and their average length (a stay still going on
--     counts until now)
--   by_sales: per employee, deals created in the period, first answer, tasks
--     created / done / due (already due in the period) / overdue (not done by
--     their due date), messages sent, and now: open deals, open deals without
--     an open task
CREATE OR REPLACE FUNCTION "public"."report_speed"("period_from" timestamp with time zone DEFAULT NULL::timestamp with time zone, "period_to" timestamp with time zone DEFAULT NULL::timestamp with time zone, "filter_pipeline_id" bigint DEFAULT NULL::bigint, "filter_sales_id" bigint DEFAULT NULL::bigint, "filter_source_id" bigint DEFAULT NULL::bigint, "filter_doctor_id" bigint DEFAULT NULL::bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
declare
  report jsonb;
begin
  perform private.report_check_access();

  with scope as (
    -- Tasks and messages belong to an employee whoever leads the deal
    select * from private.report_deal_progress(filter_pipeline_id, null, filter_source_id, filter_doctor_id)
  ),
  cohort as (
    select * from scope d
    where (period_from is null or d.created_at >= period_from)
      and (period_to is null or d.created_at < period_to)
  ),
  answered as (
    select c.sales_id, extract(epoch from c.first_response_at - c.created_at) as seconds
    from cohort c
    where c.first_response_at is not null and c.first_response_at >= c.created_at
      and (filter_sales_id is null or c.sales_id = filter_sales_id)
  ),
  stays as (
    select
      e.to_stage_id as stage_id,
      e.created_at as entered_at,
      coalesce(
        lead(e.created_at) over (partition by e.deal_id order by e.created_at, e.id),
        case when d.stage_id = e.to_stage_id then now() end
      ) as left_at,
      d.sales_id,
      d.source_id,
      d.doctor_id
    from public.deal_events e
      join public.deals d on d.organization_id = e.organization_id and d.id = e.deal_id
    where e.organization_id = private.current_organization_id()
      and e.type in ('created', 'stage_changed')
  ),
  stage_stats as (
    select st.stage_id, count(*) as stays, round(avg(extract(epoch from st.left_at - st.entered_at))) as avg_seconds
    from stays st
    where st.left_at is not null
      and (period_from is null or st.entered_at >= period_from)
      and (period_to is null or st.entered_at < period_to)
      and (filter_sales_id is null or st.sales_id = filter_sales_id)
      and (filter_source_id is null or st.source_id = filter_source_id)
      and (filter_doctor_id is null or st.doctor_id = filter_doctor_id)
    group by st.stage_id
  ),
  staff as (
    select
      sa.id,
      btrim(concat_ws(' ', sa.first_name, sa.last_name)) as name,
      sa.last_name,
      sa.disabled,
      (select count(*) from cohort c where c.sales_id = sa.id) as deals,
      (select round(avg(a.seconds)) from answered a where a.sales_id = sa.id) as first_response_seconds,
      (select count(*) from public.tasks t join scope d on d.deal_id = t.deal_id
        where t.organization_id = sa.organization_id and t.sales_id = sa.id
          and (period_from is null or t.created_at >= period_from)
          and (period_to is null or t.created_at < period_to)) as tasks_created,
      (select count(*) from public.tasks t join scope d on d.deal_id = t.deal_id
        where t.organization_id = sa.organization_id and t.sales_id = sa.id
          and t.done_date is not null
          and (period_from is null or t.done_date >= period_from)
          and (period_to is null or t.done_date < period_to)) as tasks_done,
      (select count(*) from public.tasks t join scope d on d.deal_id = t.deal_id
        where t.organization_id = sa.organization_id and t.sales_id = sa.id
          and t.due_date < now()
          and (period_from is null or t.due_date >= period_from)
          and (period_to is null or t.due_date < period_to)) as tasks_due,
      (select count(*) from public.tasks t join scope d on d.deal_id = t.deal_id
        where t.organization_id = sa.organization_id and t.sales_id = sa.id
          and t.due_date < now()
          and (period_from is null or t.due_date >= period_from)
          and (period_to is null or t.due_date < period_to)
          and (t.done_date is null or t.done_date > t.due_date)) as tasks_overdue,
      (select count(*) from public.messages m join scope d on d.deal_id = m.deal_id
        where m.organization_id = sa.organization_id and m.sales_id = sa.id and m.direction = 'out'
          and (period_from is null or m.sent_at >= period_from)
          and (period_to is null or m.sent_at < period_to)) as messages_sent,
      (select count(*) from scope d
        where d.sales_id = sa.id and d.stage_kind = 'open' and d.archived_at is null) as open_deals,
      (select count(*) from scope d
        where d.sales_id = sa.id and d.stage_kind = 'open' and d.archived_at is null
          and not exists (
            select 1 from public.tasks t
            where t.organization_id = sa.organization_id and t.deal_id = d.deal_id and t.done_date is null
          )) as deals_without_task
    from public.sales sa
    where sa.organization_id = private.current_organization_id()
      and (filter_sales_id is null or sa.id = filter_sales_id)
  )
  select jsonb_build_object(
    'first_response', (
      select jsonb_build_object('deals', count(*), 'avg_seconds', round(avg(a.seconds)))
      from answered a
    ),
    'stages', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'stage_id', s.id, 'name', s.name, 'color', s.color,
        'pipeline_id', p.id, 'pipeline_name', p.name,
        'stays', coalesce(ss.stays, 0), 'avg_seconds', ss.avg_seconds
      ) order by p.position, p.id, s.position, s.id), '[]'::jsonb)
      from public.stages s
        join public.pipelines p on p.id = s.pipeline_id
        left join stage_stats ss on ss.stage_id = s.id
      where s.organization_id = private.current_organization_id()
        and s.kind = 'open'
        and (filter_pipeline_id is null or s.pipeline_id = filter_pipeline_id)
    ),
    'by_sales', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', st.id, 'name', st.name, 'deals', st.deals,
        'first_response_seconds', st.first_response_seconds,
        'tasks_created', st.tasks_created, 'tasks_done', st.tasks_done,
        'tasks_due', st.tasks_due, 'tasks_overdue', st.tasks_overdue,
        'messages_sent', st.messages_sent,
        'open_deals', st.open_deals, 'deals_without_task', st.deals_without_task
      ) order by st.deals desc, st.last_name, st.id), '[]'::jsonb)
      from staff st
      where not st.disabled
        or st.deals + st.tasks_created + st.tasks_done + st.messages_sent + st.open_deals > 0
    )
  ) into report;
  return report;
end;
$$;

-- Lost reasons: the deals lost in the period (closed in a lost stage), by
-- reason and by the stage they were lost from, with their treatment plans
CREATE OR REPLACE FUNCTION "public"."report_lost_reasons"("period_from" timestamp with time zone DEFAULT NULL::timestamp with time zone, "period_to" timestamp with time zone DEFAULT NULL::timestamp with time zone, "filter_pipeline_id" bigint DEFAULT NULL::bigint, "filter_sales_id" bigint DEFAULT NULL::bigint, "filter_source_id" bigint DEFAULT NULL::bigint, "filter_doctor_id" bigint DEFAULT NULL::bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
declare
  report jsonb;
begin
  perform private.report_check_access();

  with lost as (
    select *
    from private.report_deal_progress(filter_pipeline_id, filter_sales_id, filter_source_id, filter_doctor_id) d
    where d.stage_kind = 'lost'
      and (period_from is null or d.closed_at >= period_from)
      and (period_to is null or d.closed_at < period_to)
  )
  select jsonb_build_object(
    'totals', (
      select jsonb_build_object('deals', count(*), 'plan_amount', coalesce(sum(l.plan_amount), 0))
      from lost l
    ),
    'by_reason', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.lost_reason_id, 'name', lr.name, 'deals', r.deals, 'plan_amount', r.plan_amount
      ) order by r.deals desc, lr.position, lr.id), '[]'::jsonb)
      from (
        select l.lost_reason_id, count(*) as deals, sum(l.plan_amount) as plan_amount
        from lost l
        group by l.lost_reason_id
      ) r
        left join public.lost_reasons lr on lr.id = r.lost_reason_id
    ),
    'by_stage', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.lost_from_stage_id, 'name', s.name, 'pipeline_name', p.name,
        'deals', r.deals, 'plan_amount', r.plan_amount
      ) order by p.position, p.id, s.position, s.id), '[]'::jsonb)
      from (
        select l.lost_from_stage_id, count(*) as deals, sum(l.plan_amount) as plan_amount
        from lost l
        group by l.lost_from_stage_id
      ) r
        left join public.stages s on s.id = r.lost_from_stage_id
        left join public.pipelines p on p.id = s.pipeline_id
    )
  ) into report;
  return report;
end;
$$;

-- Money: treatment plans agreed in the period (the deal first reached the
-- "plan agreed" stage or a later one), payments received in the period (dates
-- in the clinic's time zone) and the prepayments among them, the average
-- check (paid / paying deals), in total, by service, by employee and by doctor
CREATE OR REPLACE FUNCTION "public"."report_money"("period_from" timestamp with time zone DEFAULT NULL::timestamp with time zone, "period_to" timestamp with time zone DEFAULT NULL::timestamp with time zone, "filter_pipeline_id" bigint DEFAULT NULL::bigint, "filter_sales_id" bigint DEFAULT NULL::bigint, "filter_source_id" bigint DEFAULT NULL::bigint, "filter_doctor_id" bigint DEFAULT NULL::bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
declare
  clinic_tz text;
  first_day date;
  after_last_day date;
  report jsonb;
begin
  perform private.report_check_access();
  select o.timezone into clinic_tz
  from public.organizations o
  where o.id = private.current_organization_id();
  first_day := (period_from at time zone coalesce(clinic_tz, 'Asia/Almaty'))::date;
  after_last_day := (period_to at time zone coalesce(clinic_tz, 'Asia/Almaty'))::date;

  with per_deal as (
    select
      d.deal_id,
      d.service_id,
      d.sales_id,
      d.doctor_id,
      d.plan_amount,
      coalesce(
        d.agreed_at is not null
          and (period_from is null or d.agreed_at >= period_from)
          and (period_to is null or d.agreed_at < period_to),
        false
      ) as agreed,
      coalesce((
        select sum(p.amount)
        from public.deal_payments p
        where p.organization_id = private.current_organization_id() and p.deal_id = d.deal_id
          and (first_day is null or p.paid_at >= first_day)
          and (after_last_day is null or p.paid_at < after_last_day)
      ), 0) as paid,
      coalesce((
        select sum(p.amount)
        from public.deal_payments p
        where p.organization_id = private.current_organization_id() and p.deal_id = d.deal_id
          and p.kind = 'prepayment'
          and (first_day is null or p.paid_at >= first_day)
          and (after_last_day is null or p.paid_at < after_last_day)
      ), 0) as prepaid
    from private.report_deal_progress(filter_pipeline_id, filter_sales_id, filter_source_id, filter_doctor_id) d
  ),
  grouped as (
    select
      grouping(pd.service_id) as by_service,
      grouping(pd.sales_id) as by_sales,
      grouping(pd.doctor_id) as by_doctor,
      pd.service_id,
      pd.sales_id,
      pd.doctor_id,
      count(*) filter (where pd.agreed) as agreed_deals,
      coalesce(sum(pd.plan_amount) filter (where pd.agreed), 0) as agreed_amount,
      coalesce(sum(pd.paid), 0) as paid_amount,
      coalesce(sum(pd.prepaid), 0) as prepaid_amount,
      count(*) filter (where pd.paid > 0) as paying_deals
    from per_deal pd
    where pd.agreed or pd.paid > 0
    group by grouping sets ((), (pd.service_id), (pd.sales_id), (pd.doctor_id))
  ),
  metrics as (
    select g.*, jsonb_build_object(
      'agreed_deals', g.agreed_deals,
      'agreed_amount', g.agreed_amount,
      'paid_amount', g.paid_amount,
      'prepaid_amount', g.prepaid_amount,
      'paying_deals', g.paying_deals,
      'average_check', case when g.paying_deals > 0 then round(g.paid_amount / g.paying_deals) end
    ) as row_json
    from grouped g
  )
  select jsonb_build_object(
    'totals', (select m.row_json from metrics m where m.by_service = 1 and m.by_sales = 1 and m.by_doctor = 1),
    'by_service', (
      select coalesce(jsonb_agg(
        jsonb_build_object('id', m.service_id, 'name', sv.name) || m.row_json
        order by m.paid_amount desc, m.agreed_amount desc, sv.position, sv.id
      ), '[]'::jsonb)
      from metrics m
        left join public.services sv on sv.id = m.service_id
      where m.by_service = 0
    ),
    'by_sales', (
      select coalesce(jsonb_agg(
        jsonb_build_object('id', m.sales_id, 'name', btrim(concat_ws(' ', sa.first_name, sa.last_name))) || m.row_json
        order by m.paid_amount desc, m.agreed_amount desc, sa.last_name, sa.id
      ), '[]'::jsonb)
      from metrics m
        left join public.sales sa on sa.id = m.sales_id
      where m.by_sales = 0
    ),
    'by_doctor', (
      select coalesce(jsonb_agg(
        jsonb_build_object('id', m.doctor_id, 'name', dr.name) || m.row_json
        order by m.paid_amount desc, m.agreed_amount desc, dr.position, dr.id
      ), '[]'::jsonb)
      from metrics m
        left join public.doctors dr on dr.id = m.doctor_id
      where m.by_doctor = 0
    )
  ) into report;
  return report;
end;
$$;

-- Grants: the helpers are called by the report functions with the caller's
-- rights; the reports themselves are for signed-in users (checked inside)
revoke all on function private.report_check_access() from public;
grant execute on function private.report_check_access() to authenticated;
grant execute on function private.report_check_access() to service_role;
revoke all on function private.report_key_stages() from public;
grant execute on function private.report_key_stages() to authenticated;
grant execute on function private.report_key_stages() to service_role;
revoke all on function private.report_deal_progress(bigint, bigint, bigint, bigint) from public;
grant execute on function private.report_deal_progress(bigint, bigint, bigint, bigint) to authenticated;
grant execute on function private.report_deal_progress(bigint, bigint, bigint, bigint) to service_role;

revoke all on function public.report_conversion(timestamp with time zone, timestamp with time zone, bigint, bigint, bigint, bigint) from public, anon;
grant execute on function public.report_conversion(timestamp with time zone, timestamp with time zone, bigint, bigint, bigint, bigint) to authenticated;
grant execute on function public.report_conversion(timestamp with time zone, timestamp with time zone, bigint, bigint, bigint, bigint) to service_role;
revoke all on function public.report_speed(timestamp with time zone, timestamp with time zone, bigint, bigint, bigint, bigint) from public, anon;
grant execute on function public.report_speed(timestamp with time zone, timestamp with time zone, bigint, bigint, bigint, bigint) to authenticated;
grant execute on function public.report_speed(timestamp with time zone, timestamp with time zone, bigint, bigint, bigint, bigint) to service_role;
revoke all on function public.report_lost_reasons(timestamp with time zone, timestamp with time zone, bigint, bigint, bigint, bigint) from public, anon;
grant execute on function public.report_lost_reasons(timestamp with time zone, timestamp with time zone, bigint, bigint, bigint, bigint) to authenticated;
grant execute on function public.report_lost_reasons(timestamp with time zone, timestamp with time zone, bigint, bigint, bigint, bigint) to service_role;
revoke all on function public.report_money(timestamp with time zone, timestamp with time zone, bigint, bigint, bigint, bigint) from public, anon;
grant execute on function public.report_money(timestamp with time zone, timestamp with time zone, bigint, bigint, bigint, bigint) to authenticated;
grant execute on function public.report_money(timestamp with time zone, timestamp with time zone, bigint, bigint, bigint, bigint) to service_role;

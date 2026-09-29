--
-- Stage 43: the lab module strengthened — prices per lab with history,
-- standard terms, remakes with reasons and fault, the history of an order,
-- quality, fittings in the schedule, warranty, the reconciliation act and
-- payments allocated to orders. Source of truth: supabase/schemas/
-- 43_lab_plus.sql (and the edits of 40_lab_orders.sql, 42_cash_outflows.sql).
--

--
-- New columns of the stage 40 tables
--
alter table public.labs add column work_weekdays smallint[] not null default '{1,2,3,4,5,6}'::smallint[];
alter table public.labs add constraint labs_work_weekdays_check check (cardinality(work_weekdays) >= 1 and work_weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]);

alter table public.lab_work_types add column fitting_days smallint;
alter table public.lab_work_types add column ready_days smallint;
alter table public.lab_work_types add column warranty_months smallint not null default 0;
alter table public.lab_work_types add constraint lab_work_types_terms_check check ((fitting_days is null or fitting_days between 0 and 365) and (ready_days is null or ready_days between 0 and 365));
alter table public.lab_work_types add constraint lab_work_types_warranty_check check (warranty_months between 0 and 120);

alter table public.lab_work_type_prices add column lab_id bigint;
alter table public.lab_work_type_prices add column effective_from date not null default '2000-01-01'::date;
alter table public.lab_work_type_prices drop constraint lab_work_type_prices_work_type_key;
alter table public.lab_work_type_prices add constraint lab_work_type_prices_work_type_key unique nulls not distinct (organization_id, work_type_id, lab_id, effective_from);
alter table public.lab_work_type_prices
    add constraint lab_work_type_prices_lab_id_fkey foreign key (organization_id, lab_id) references public.labs(organization_id, id) on delete cascade;

alter table public.lab_orders add column first_ready_at date;
alter table public.lab_orders add column first_delivered_at date;
alter table public.lab_orders add column fitting_visit_id bigint;
alter table public.lab_orders
    add constraint lab_orders_fitting_visit_id_fkey foreign key (organization_id, fitting_visit_id) references public.visits(organization_id, id) on delete set null (fitting_visit_id);
create index lab_orders_fitting_visit_idx on public.lab_orders using btree (organization_id, fitting_visit_id) where fitting_visit_id is not null;

-- The orders already ready or given keep their days as the first ones
alter table public.lab_orders disable trigger lab_order_before_write;
alter table public.lab_orders disable trigger audit_lab_order;
update public.lab_orders set first_ready_at = ready_at, first_delivered_at = delivered_at
where ready_at is not null or delivered_at is not null;
alter table public.lab_orders enable trigger lab_order_before_write;
alter table public.lab_orders enable trigger audit_lab_order;

-- The terms and the warranty of the seeded work types of existing clinics
update public.lab_work_types w
set fitting_days = v.fitting_days, ready_days = v.ready_days, warranty_months = v.warranty_months
from (values
  ('Коронка металлокерамическая', 3, 7, 12),
  ('Коронка из диоксида циркония', 4, 8, 24),
  ('Коронка E.max', 4, 8, 24),
  ('Коронка на имплант', 5, 10, 24),
  ('Временная коронка', null, 2, 0),
  ('Винир керамический', 5, 10, 24),
  ('Культевая вкладка', null, 3, 12),
  ('Бюгельный протез', 5, 14, 12),
  ('Частичный съёмный протез', 5, 10, 12),
  ('Полный съёмный протез', 5, 12, 12),
  ('Каппа (сплинт)', null, 5, 6),
  ('Индивидуальная ложка', null, 2, 0),
  ('Хирургический шаблон', null, 4, 0)
) as v(name, fitting_days, ready_days, warranty_months)
where w.name = v.name and w.fitting_days is null and w.ready_days is null and w.warranty_months = 0;

--
-- Changed functions of 40_lab_orders.sql
--
CREATE OR REPLACE FUNCTION "private"."seed_lab_work_types"("org_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if exists (select 1 from public.lab_work_types t where t.organization_id = org_id) then
    return;
  end if;
  -- Terms (working days to the fitting and to the ready work) and the
  -- warranty in months (stage 43)
  with seeded as (
    insert into public.lab_work_types (organization_id, name, position, fitting_days, ready_days, warranty_months)
    select org_id, w.name, w.position, w.fitting_days, w.ready_days, w.warranty_months
    from (values
      ('Коронка металлокерамическая', 0, 3, 7, 12),
      ('Коронка из диоксида циркония', 1, 4, 8, 24),
      ('Коронка E.max', 2, 4, 8, 24),
      ('Коронка на имплант', 3, 5, 10, 24),
      ('Временная коронка', 4, null, 2, 0),
      ('Винир керамический', 5, 5, 10, 24),
      ('Культевая вкладка', 6, null, 3, 12),
      ('Бюгельный протез', 7, 5, 14, 12),
      ('Частичный съёмный протез', 8, 5, 10, 12),
      ('Полный съёмный протез', 9, 5, 12, 12),
      ('Каппа (сплинт)', 10, null, 5, 6),
      ('Индивидуальная ложка', 11, null, 2, 0),
      ('Хирургический шаблон', 12, null, 4, 0)
    ) as w(name, position, fitting_days, ready_days, warranty_months)
    returning id, name
  )
  insert into public.lab_work_type_prices (organization_id, work_type_id, price)
  select org_id, s.id, p.price
  from seeded s
    join (values
      ('Коронка металлокерамическая', 18000),
      ('Коронка из диоксида циркония', 35000),
      ('Коронка E.max', 40000),
      ('Коронка на имплант', 45000),
      ('Временная коронка', 5000),
      ('Винир керамический', 38000),
      ('Культевая вкладка', 8000),
      ('Бюгельный протез', 60000),
      ('Частичный съёмный протез', 45000),
      ('Полный съёмный протез', 55000),
      ('Каппа (сплинт)', 15000),
      ('Индивидуальная ложка', 4000),
      ('Хирургический шаблон', 25000)
    ) as p(name, price) on p.name = s.name;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."handle_lab_order_before_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  plan public.treatment_plans;
  stage_plan_id bigint;
  tech_lab_id bigint;
  deal_patient_id bigint;
  visit_day date;
  today date := private.lab_today(new.organization_id);
begin
  new.shade := nullif(btrim(coalesce(new.shade, '')), '');
  new.material := nullif(btrim(coalesce(new.material, '')), '');
  new.comment := nullif(btrim(coalesce(new.comment, '')), '');
  new.teeth := array(select distinct t from unnest(coalesce(new.teeth, '{}'::smallint[])) as t order by t);

  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtextextended('lab_orders:' || new.organization_id, 0));
    select coalesce(max(o.number), 0) + 1 into new.number
    from public.lab_orders o
    where o.organization_id = new.organization_id;
    new.remake_count := 0;
    new.first_ready_at := null;
    new.first_delivered_at := null;
  else
    new.number := old.number;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.remake_count := old.remake_count;
    new.first_ready_at := old.first_ready_at;
    new.first_delivered_at := old.first_delivered_at;
  end if;

  -- The fitting visit (stage 43): a visit of the same patient; its day is
  -- the first fitting when the order has none
  if new.fitting_visit_id is not null
    and (tg_op = 'INSERT' or new.fitting_visit_id is distinct from old.fitting_visit_id) then
    select private.clinic_date(v.organization_id, v.starts_at) into visit_day
    from public.visits v
    where v.organization_id = new.organization_id and v.id = new.fitting_visit_id and v.patient_id = new.patient_id;
    if visit_day is null then
      raise exception 'Запись другого пациента' using errcode = '22023', hint = 'lab_order_visit';
    end if;
    new.fitting1_at := coalesce(new.fitting1_at, visit_day);
  end if;

  -- The stage gives its plan; the plan gives its deal and doctor
  if new.stage_id is not null and (tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id) then
    select s.plan_id into stage_plan_id
    from public.treatment_stages s
    where s.organization_id = new.organization_id and s.id = new.stage_id;
    if new.plan_id is null then
      new.plan_id := stage_plan_id;
    elsif new.plan_id is distinct from stage_plan_id then
      raise exception 'Этап из другого плана лечения' using errcode = '22023', hint = 'lab_order_stage';
    end if;
  end if;
  if new.plan_id is null then
    new.stage_id := null;
  elsif tg_op = 'INSERT' or new.plan_id is distinct from old.plan_id then
    select * into plan
    from public.treatment_plans p
    where p.organization_id = new.organization_id and p.id = new.plan_id;
    if plan.patient_id is distinct from new.patient_id then
      raise exception 'План лечения другого пациента' using errcode = '22023', hint = 'lab_order_plan';
    end if;
    new.deal_id := plan.deal_id;
    new.doctor_id := coalesce(new.doctor_id, plan.doctor_id);
  end if;
  if new.deal_id is not null and new.plan_id is null
    and (tg_op = 'INSERT' or new.deal_id is distinct from old.deal_id) then
    select d.patient_id into deal_patient_id
    from public.deals d
    where d.organization_id = new.organization_id and d.id = new.deal_id;
    if deal_patient_id is distinct from new.patient_id then
      raise exception 'Сделка другого пациента' using errcode = '22023', hint = 'lab_order_deal';
    end if;
  end if;

  -- The technician works in the lab of the order
  if new.technician_id is not null and (tg_op = 'INSERT'
    or new.technician_id is distinct from old.technician_id or new.lab_id is distinct from old.lab_id) then
    select t.lab_id into tech_lab_id
    from public.lab_technicians t
    where t.organization_id = new.organization_id and t.id = new.technician_id;
    if new.lab_id is null then
      new.lab_id := tech_lab_id;
    elsif new.lab_id is distinct from tech_lab_id then
      raise exception 'Техник работает в другой лаборатории' using errcode = '22023', hint = 'lab_order_technician';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.responsible_id is null and new.doctor_id is not null then
      select d.admin_sales_id into new.responsible_id
      from public.doctors d
      where d.organization_id = new.organization_id and d.id = new.doctor_id;
    end if;
    new.responsible_id := coalesce(new.responsible_id, private.current_sales_id());
    if new.branch_id is null and new.doctor_id is not null then
      select d.branch_id into new.branch_id
      from public.doctors d
      where d.organization_id = new.organization_id and d.id = new.doctor_id;
    end if;
    if new.branch_id is null and new.deal_id is not null then
      select d.branch_id into new.branch_id
      from public.deals d
      where d.organization_id = new.organization_id and d.id = new.deal_id;
    end if;
  end if;

  -- A date given to the patient closes the order
  if new.delivered_at is not null and new.status <> 'delivered'
    and (tg_op = 'INSERT' or old.delivered_at is null) then
    new.status := 'delivered';
  end if;
  if new.status = 'remake' and (tg_op = 'INSERT' or old.status <> 'remake') then
    new.remake_count := new.remake_count + 1;
  end if;
  if new.status in ('lab', 'courier', 'fitting') and new.sent_at is null then
    new.sent_at := today;
  end if;
  if new.status in ('ready', 'delivered') then
    new.ready_at := coalesce(new.ready_at, today);
  else
    new.ready_at := null;
  end if;
  if new.status = 'delivered' then
    new.delivered_at := coalesce(new.delivered_at, today);
  else
    new.delivered_at := null;
  end if;
  -- The first readiness and delivery (stage 43) survive a remake. While the
  -- current one is the first, it follows its date (a correction of the
  -- date, or of the status: undone without a remake)
  if tg_op = 'UPDATE' and new.status <> 'remake' then
    if old.first_ready_at is not null and old.first_ready_at = old.ready_at then
      new.first_ready_at := new.ready_at;
    end if;
    if old.first_delivered_at is not null and old.first_delivered_at = old.delivered_at then
      new.first_delivered_at := new.delivered_at;
    end if;
  end if;
  new.first_ready_at := coalesce(new.first_ready_at, new.ready_at);
  new.first_delivered_at := coalesce(new.first_delivered_at, new.delivered_at);
  new.updated_at := now();
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."handle_lab_order_item_price"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  ord record;
begin
  if tg_op = 'INSERT' or new.work_type_id is distinct from old.work_type_id then
    select o.lab_id, private.clinic_date(o.organization_id, o.created_at) as day into ord
    from public.lab_orders o
    where o.organization_id = new.organization_id and o.id = new.order_id;
    insert into public.lab_order_item_prices (organization_id, item_id, price)
    values (new.organization_id, new.id, private.lab_price_on(new.organization_id, new.work_type_id, ord.lab_id, ord.day))
    on conflict on constraint lab_order_item_prices_item_key
    do update set price = excluded.price, updated_at = now();
  end if;
  return null;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."audit_lab_row"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  entity_name text := tg_argv[0];
  fields text[] := string_to_array(tg_argv[1], ',');
  old_row jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  new_row jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  row_data jsonb := coalesce(new_row, old_row);
  org_id bigint := (row_data ->> 'organization_id')::bigint;
  target_order_id bigint;
  diff jsonb;
  row_deal_id bigint;
  row_patient_id bigint;
  actor record;
begin
  if pg_trigger_depth() > 1 and tg_op = 'DELETE' then
    return null;
  end if;
  if tg_op = 'DELETE' and not exists (select 1 from public.organizations o where o.id = org_id) then
    return null;
  end if;
  diff := private.audit_diff(old_row, new_row, fields);
  if tg_op = 'UPDATE' and diff = '{}'::jsonb then
    return null;
  end if;
  if entity_name = 'lab_order' then
    row_patient_id := (row_data ->> 'patient_id')::bigint;
    row_deal_id := (row_data ->> 'deal_id')::bigint;
  else
    if entity_name in ('lab_order_item', 'lab_order_remake') then
      target_order_id := (row_data ->> 'order_id')::bigint;
    else
      select i.order_id into target_order_id
      from public.lab_order_items i
      where i.organization_id = org_id and i.id = (row_data ->> 'item_id')::bigint;
    end if;
    select o.patient_id, o.deal_id into row_patient_id, row_deal_id
    from public.lab_orders o
    where o.organization_id = org_id and o.id = target_order_id;
  end if;
  select * into actor from private.audit_actor(org_id);
  if pg_trigger_depth() > 1 then
    actor.actor_id := null;
    actor.actor_source := 'automation';
  end if;
  insert into public.audit_log (organization_id, sales_id, source, entity, entity_id, action, changes, deal_id, patient_id)
  values (org_id, actor.actor_id, actor.actor_source, entity_name, (row_data ->> 'id')::bigint,
    case tg_op when 'INSERT' then 'create' when 'DELETE' then 'delete' else 'update' end,
    diff, row_deal_id, row_patient_id);
  return null;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."lab_cost_for_doctor"("org_id" bigint, "target_doctor_id" bigint, "in_month" "date") RETURNS bigint
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  return coalesce((
    select sum(c.amount)
    from public.lab_order_costs c
    where c.organization_id = org_id and c.doctor_id = target_doctor_id
      and c.month = date_trunc('month', in_month)::date
  ), 0)::bigint;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."lab_cost_for_plan_item"("org_id" bigint, "target_plan_item_id" bigint) RETURNS bigint
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  return coalesce((
    select sum(c.amount)
    from public.lab_order_costs c
    where c.organization_id = org_id and c.plan_item_id = target_plan_item_id
  ), 0)::bigint;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."report_lab_settlement"("in_month" "date") RETURNS TABLE("lab_id" bigint, "lab_name" "text", "is_own" boolean, "orders_count" integer, "items_count" integer, "amount" bigint, "paid" bigint, "balance" bigint, "total_balance" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
#variable_conflict use_column
declare
  org_id bigint := private.current_organization_id();
  month_start date := date_trunc('month', in_month)::date;
  month_end date := (date_trunc('month', in_month) + interval '1 month')::date;
begin
  if org_id is null or private.current_user_role() not in ('owner', 'head') then
    raise exception 'Суммы лабораторий видят владелец и руководитель' using errcode = '42501';
  end if;
  return query
  with owed as (
    select c.lab_id, c.month,
      coalesce(sum(c.amount), 0)::bigint as amount
    from public.lab_order_costs c
    where c.organization_id = org_id and c.month < month_end
    group by c.lab_id, c.month
  ),
  works as (
    select o.lab_id,
      count(distinct o.id)::integer as orders_count,
      coalesce(sum(i.qty), 0)::integer as items_count
    from public.lab_orders o
      left join public.lab_order_items i on i.organization_id = o.organization_id and i.order_id = o.id
    where o.organization_id = org_id and o.first_ready_at >= month_start and o.first_ready_at < month_end
    group by o.lab_id
  ),
  paid as (
    select p.lab_id, p.month, sum(p.amount)::bigint as amount
    from public.lab_payments p
    where p.organization_id = org_id and p.month < month_end
    group by p.lab_id, p.month
  ),
  per_lab as (
    select l.id, l.name, l.is_own,
      coalesce((select sum(w.orders_count) from works w where w.lab_id = l.id), 0)::integer as orders_count,
      coalesce((select sum(w.items_count) from works w where w.lab_id = l.id), 0)::integer as items_count,
      coalesce((select sum(w.amount) from owed w where w.lab_id = l.id and w.month = month_start), 0)::bigint as amount,
      coalesce((select sum(p.amount) from paid p where p.lab_id = l.id and p.month = month_start), 0)::bigint as paid,
      (coalesce((select sum(w.amount) from owed w where w.lab_id = l.id), 0)
        - coalesce((select sum(p.amount) from paid p where p.lab_id = l.id), 0))::bigint as total_balance
    from public.labs l
    where l.organization_id = org_id
  )
  select x.id, x.name, x.is_own, x.orders_count, x.items_count, x.amount, x.paid, x.amount - x.paid, x.total_balance
  from per_lab x
  where x.orders_count > 0 or x.paid > 0 or x.total_balance <> 0
  order by 6 desc, 2;
end;
$$;

-- Audit fields of stage 40 (new columns)
create or replace trigger audit_lab_order
    after insert or update or delete on public.lab_orders
    for each row execute function private.audit_lab_row('lab_order', 'number,status,lab_id,technician_id,doctor_id,responsible_id,plan_id,teeth,shade,material,comment,sent_at,fitting1_at,fitting2_at,due_at,ready_at,delivered_at,fitting_visit_id');

create or replace trigger audit_lab
    after insert or update or delete on public.labs
    for each row when (pg_trigger_depth() = 0) execute function private.audit_row('lab', 'name,is_own,contact_person,phone,email,address,is_active,work_weekdays');

create or replace trigger audit_lab_work_type
    after insert or update or delete on public.lab_work_types
    for each row when (pg_trigger_depth() = 0) execute function private.audit_row('lab_work_type', 'name,is_active,fitting_days,ready_days,warranty_months');

create or replace trigger audit_lab_work_type_price
    after insert or update or delete on public.lab_work_type_prices
    for each row when (pg_trigger_depth() = 0) execute function private.audit_row('lab_work_type_price', 'work_type_id,lab_id,effective_from,price');

--
-- Changed functions of 42_cash_outflows.sql
--
CREATE OR REPLACE FUNCTION "private"."handle_lab_payment_before_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  op public.account_operations;
begin
  new.month := date_trunc('month', new.month)::date;
  new.comment := nullif(btrim(new.comment), '');
  if tg_op = 'UPDATE' then
    if new.account_operation_id is distinct from old.account_operation_id then
      raise exception 'Связь оплаты с кассой не меняется' using errcode = '22023', hint = 'cash_linked';
    end if;
    if new.lab_id <> old.lab_id and exists (select 1 from public.labs l where l.organization_id = new.organization_id and l.id = old.lab_id) then
      raise exception 'Оплату нельзя перенести в другую лабораторию' using errcode = '22023', hint = 'lab_payment_lab';
    end if;
    if old.account_operation_id is not null and coalesce(current_setting('crm.cash_link', true), '') <> 'on'
      and (new.amount <> old.amount or new.method <> old.method or new.paid_at <> old.paid_at) then
      raise exception 'Оплата проведена через кассу: сумму, способ и время меняют в кассе или отменяют оплату'
        using errcode = '22023', hint = 'cash_linked';
    end if;
    -- Stage 43: the orders it pays keep their part, in the same lab
    if new.amount < old.amount and new.amount < coalesce((
      select sum(a.amount) from public.lab_payment_allocations a
      where a.organization_id = new.organization_id and a.payment_id = new.id), 0) then
      raise exception 'Оплата распределена по нарядам на большую сумму' using errcode = '22023', hint = 'lab_allocation_over_payment';
    end if;
    if new.lab_id <> old.lab_id and exists (
      select 1 from public.lab_payment_allocations a
      where a.organization_id = new.organization_id and a.payment_id = new.id) then
      raise exception 'Оплата распределена по нарядам этой лаборатории' using errcode = '22023', hint = 'lab_allocation_lab';
    end if;
    return new;
  end if;
  if pg_trigger_depth() = 1 and private.current_user_role() is not null then
    new.created_by := private.current_sales_id();
    new.created_at := now();
  end if;
  if new.account_operation_id is not null then
    select * into op from public.account_operations o
    where o.organization_id = new.organization_id and o.id = new.account_operation_id;
    if not found or op.kind <> 'expense' or op.amount <> new.amount
      or op.category_id is distinct from private.cash_expense_category_id(new.organization_id, 'lab')
      or exists (select 1 from public.payroll_adjustments a where a.account_operation_id = op.id) then
      raise exception 'Оплату лаборатории связывают с расходом «Лаборатория» той же суммы' using errcode = '22023', hint = 'cash_link_invalid';
    end if;
    new.method := op.method;
    new.paid_at := op.occurred_at;
  end if;
  return new;
end;
$$;

drop function public.record_lab_payment(bigint, date, bigint, text, date, text, boolean);
CREATE OR REPLACE FUNCTION "public"."record_lab_payment"("target_lab_id" bigint, "target_month" "date", "payment_amount" bigint, "payment_method" "text" DEFAULT 'bank_transfer'::"text", "payment_day" "date" DEFAULT NULL::"date", "payment_comment" "text" DEFAULT NULL::"text", "from_cash" boolean DEFAULT false, "payment_allocations" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  org_id bigint := private.current_organization_id();
  lab_name text;
  op_id bigint;
  payment_id bigint;
  moment timestamp with time zone;
begin
  if org_id is null or coalesce(private.current_user_role() in ('owner', 'head'), false) is false then
    raise exception 'Оплату лаборатории проводят владелец и руководитель' using errcode = '42501', hint = 'lab_payment_forbidden';
  end if;
  if target_month is null or payment_amount is null or payment_amount <= 0 then
    raise exception 'Укажите месяц и сумму оплаты' using errcode = '22023';
  end if;
  select l.name into lab_name from public.labs l where l.organization_id = org_id and l.id = target_lab_id;
  if lab_name is null then
    raise exception 'Лаборатория не найдена' using errcode = 'P0002';
  end if;
  moment := private.cash_moment(org_id, payment_day);
  if from_cash then
    if coalesce(payment_method, 'cash') = 'cash' and not exists (
      select 1 from public.cash_shifts s
      where s.organization_id = org_id and s.sales_id = private.current_sales_id() and s.closed_at is null) then
      raise exception 'Откройте смену кассы, чтобы выдать наличные' using errcode = '22023', hint = 'shift_required';
    end if;
    insert into public.account_operations (organization_id, kind, amount, method, occurred_at, category_id, comment)
    values (org_id, 'expense', payment_amount, coalesce(payment_method, 'cash'), moment,
      private.cash_expense_category_id(org_id, 'lab'),
      left(concat_ws(' — ', 'Лаборатория: ' || lab_name || ', ' || to_char(date_trunc('month', target_month), 'MM.YYYY'),
        nullif(btrim(payment_comment), '')), 1000))
    returning id into op_id;
  end if;
  insert into public.lab_payments (organization_id, lab_id, month, amount, method, paid_at, comment, account_operation_id)
  values (org_id, target_lab_id, target_month, payment_amount, coalesce(payment_method, 'bank_transfer'), moment,
    payment_comment, op_id)
  returning id into payment_id;
  if jsonb_typeof(payment_allocations) = 'array' then
    insert into public.lab_payment_allocations (organization_id, payment_id, order_id, amount)
    select org_id, payment_id, (a.value ->> 'order_id')::bigint, (a.value ->> 'amount')::bigint
    from jsonb_array_elements(payment_allocations) as a(value)
    where coalesce((a.value ->> 'amount')::bigint, 0) > 0;
  end if;
  return jsonb_build_object('payment_id', payment_id, 'operation_id', op_id);
end;
$$;

revoke all on function public.record_lab_payment(bigint, date, bigint, text, date, text, boolean, jsonb) from public, anon;
grant execute on function public.record_lab_payment(bigint, date, bigint, text, date, text, boolean, jsonb) to authenticated, service_role;

--
-- 43_lab_plus.sql
--
--
-- Tables
--

create table public.lab_work_type_terms (
    id bigint generated by default as identity primary key,
    organization_id bigint not null default private.current_organization_id(),
    lab_id bigint not null,
    work_type_id bigint not null,
    fitting_days smallint,
    ready_days smallint,
    created_at timestamp with time zone not null default now(),
    constraint lab_work_type_terms_days_check check ((fitting_days is null or fitting_days between 0 and 365) and (ready_days is null or ready_days between 0 and 365))
);

create table public.lab_remake_reasons (
    id bigint generated by default as identity primary key,
    organization_id bigint not null default private.current_organization_id(),
    name text not null,
    is_active boolean not null default true,
    position integer not null default 0,
    created_at timestamp with time zone not null default now(),
    constraint lab_remake_reasons_name_not_blank check (btrim(name) <> ''),
    constraint lab_remake_reasons_name_length check (char_length(name) <= 200)
);

create table public.lab_order_remakes (
    id bigint generated by default as identity primary key,
    organization_id bigint not null,
    order_id bigint not null,
    reason_id bigint,
    -- The name of the reason (a copy), or a reason of its own
    reason text,
    -- lab, clinic, patient; null: not known yet
    fault text,
    is_warranty boolean not null default false,
    -- The lab charges the clinic for the remake (the lines' cost again)
    is_paid boolean not null default false,
    comment text,
    -- The status the order was in
    from_status text,
    occurred_on date not null,
    -- The remade work came back ready (the day a paid remake is billed)
    ready_at date,
    created_by bigint,
    created_at timestamp with time zone not null default now(),
    constraint lab_order_remakes_fault_check check (fault is null or fault in ('lab', 'clinic', 'patient')),
    constraint lab_order_remakes_text_length check (char_length(coalesce(reason, '')) <= 200 and char_length(coalesce(comment, '')) <= 2000)
);

create table public.lab_order_events (
    id bigint generated by default as identity primary key,
    organization_id bigint not null,
    order_id bigint not null,
    -- created, status, remake, fitting_visit, invite
    kind text not null,
    from_status text,
    to_status text,
    note text,
    sales_id bigint,
    created_at timestamp with time zone not null default now(),
    constraint lab_order_events_kind_check check (kind in ('created', 'status', 'remake', 'fitting_visit', 'invite'))
);

create table public.lab_payment_allocations (
    id bigint generated by default as identity primary key,
    organization_id bigint not null default private.current_organization_id(),
    payment_id bigint not null,
    order_id bigint not null,
    amount bigint not null,
    created_at timestamp with time zone not null default now(),
    constraint lab_payment_allocations_amount_check check (amount > 0 and amount <= 1000000000)
);

alter table public.lab_work_type_terms add constraint lab_work_type_terms_organization_id_id_key unique (organization_id, id);
alter table public.lab_work_type_terms add constraint lab_work_type_terms_key unique (organization_id, lab_id, work_type_id);
alter table public.lab_remake_reasons add constraint lab_remake_reasons_organization_id_id_key unique (organization_id, id);
alter table public.lab_remake_reasons add constraint lab_remake_reasons_name_key unique (organization_id, name);
alter table public.lab_order_remakes add constraint lab_order_remakes_organization_id_id_key unique (organization_id, id);
alter table public.lab_order_events add constraint lab_order_events_organization_id_id_key unique (organization_id, id);
alter table public.lab_payment_allocations add constraint lab_payment_allocations_organization_id_id_key unique (organization_id, id);
alter table public.lab_payment_allocations add constraint lab_payment_allocations_key unique (organization_id, payment_id, order_id);

alter table public.lab_work_type_terms
    add constraint lab_work_type_terms_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade;
alter table public.lab_work_type_terms
    add constraint lab_work_type_terms_lab_id_fkey foreign key (organization_id, lab_id) references public.labs(organization_id, id) on delete cascade;
alter table public.lab_work_type_terms
    add constraint lab_work_type_terms_work_type_id_fkey foreign key (organization_id, work_type_id) references public.lab_work_types(organization_id, id) on delete cascade;
alter table public.lab_remake_reasons
    add constraint lab_remake_reasons_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade;
alter table public.lab_order_remakes
    add constraint lab_order_remakes_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade;
alter table public.lab_order_remakes
    add constraint lab_order_remakes_order_id_fkey foreign key (organization_id, order_id) references public.lab_orders(organization_id, id) on delete cascade;
alter table public.lab_order_remakes
    add constraint lab_order_remakes_reason_id_fkey foreign key (organization_id, reason_id) references public.lab_remake_reasons(organization_id, id) on delete set null (reason_id);
alter table public.lab_order_remakes
    add constraint lab_order_remakes_created_by_fkey foreign key (organization_id, created_by) references public.sales(organization_id, id) on delete set null (created_by);
alter table public.lab_order_events
    add constraint lab_order_events_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade;
alter table public.lab_order_events
    add constraint lab_order_events_order_id_fkey foreign key (organization_id, order_id) references public.lab_orders(organization_id, id) on delete cascade;
alter table public.lab_order_events
    add constraint lab_order_events_sales_id_fkey foreign key (organization_id, sales_id) references public.sales(organization_id, id) on delete set null (sales_id);
alter table public.lab_payment_allocations
    add constraint lab_payment_allocations_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade;
alter table public.lab_payment_allocations
    add constraint lab_payment_allocations_payment_id_fkey foreign key (organization_id, payment_id) references public.lab_payments(organization_id, id) on delete cascade;
alter table public.lab_payment_allocations
    add constraint lab_payment_allocations_order_id_fkey foreign key (organization_id, order_id) references public.lab_orders(organization_id, id) on delete cascade;

create index lab_order_remakes_order_idx on public.lab_order_remakes using btree (organization_id, order_id);
create index lab_order_remakes_occurred_idx on public.lab_order_remakes using btree (organization_id, occurred_on);
create index lab_order_events_order_idx on public.lab_order_events using btree (organization_id, order_id, created_at);
create index lab_payment_allocations_order_idx on public.lab_payment_allocations using btree (organization_id, order_id);

--
-- Dictionaries of a new clinic: the usual reasons of a remake
--

CREATE OR REPLACE FUNCTION "private"."seed_lab_remake_reasons"("org_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.lab_remake_reasons (organization_id, name, position)
  select org_id, r.name, r.position
  from (values
    ('Не подошёл цвет', 0),
    ('Не сел', 1),
    ('Скол', 2),
    ('Ошибка оттиска', 3)
  ) as r(name, position)
  on conflict on constraint lab_remake_reasons_name_key do nothing;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."handle_organization_lab_remake_reasons"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform private.seed_lab_remake_reasons(new.id);
  return new;
end;
$$;

--
-- Prices, terms, the warranty
--

-- The lab price of a work type on a day: the price of that lab effective
-- then, else the default price effective then, else 0. Twin: labPriceOn()
CREATE OR REPLACE FUNCTION "private"."lab_price_on"("org_id" bigint, "target_work_type_id" bigint, "target_lab_id" bigint, "on_day" "date") RETURNS bigint
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  return coalesce((
    select p.price
    from public.lab_work_type_prices p
    where p.organization_id = org_id and p.work_type_id = target_work_type_id
      and (p.lab_id = target_lab_id or p.lab_id is null)
      and p.effective_from <= coalesce(on_day, current_date)
    order by (p.lab_id is null), p.effective_from desc
    limit 1
  ), 0);
end;
$$;

-- The day `days` working days after start_day (the lab works on the ISO
-- weekdays given; none: every day). Twin: addWorkDays()
CREATE OR REPLACE FUNCTION "private"."lab_add_work_days"("start_day" "date", "days" integer, "weekdays" smallint[]) RETURNS "date"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
declare
  day date := start_day;
  counted integer := 0;
  open_days smallint[] := case when coalesce(cardinality(weekdays), 0) = 0 then '{1,2,3,4,5,6,7}'::smallint[] else weekdays end;
begin
  if start_day is null or days is null then
    return null;
  end if;
  while counted < days loop
    day := day + 1;
    if extract(isodow from day)::smallint = any(open_days) then
      counted := counted + 1;
    end if;
  end loop;
  return day;
end;
$$;

-- «Предложить даты»: the fitting and the due date of a new order of the
-- lab with these works, from the day it is sent (today by default) — the
-- longest term of the works, the lab's own terms first, counted in the
-- lab's working days. Twin: proposeDates()
CREATE OR REPLACE FUNCTION "public"."lab_propose_dates"("target_lab_id" bigint, "work_type_ids" bigint[], "start_day" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
declare
  org_id bigint := private.current_organization_id();
  base date := coalesce(start_day, private.lab_today(org_id));
  open_days smallint[];
  fitting integer;
  ready integer;
begin
  select l.work_weekdays into open_days
  from public.labs l
  where l.organization_id = org_id and l.id = target_lab_id;
  select max(coalesce(t.fitting_days, w.fitting_days)), max(coalesce(t.ready_days, w.ready_days))
  into fitting, ready
  from public.lab_work_types w
    left join public.lab_work_type_terms t
      on t.organization_id = w.organization_id and t.work_type_id = w.id and t.lab_id = target_lab_id
  where w.organization_id = org_id and w.id = any(work_type_ids);
  return jsonb_build_object(
    'fitting_days', fitting,
    'ready_days', ready,
    'fitting_at', private.lab_add_work_days(base, fitting, open_days),
    'due_at', private.lab_add_work_days(base, ready, open_days));
end;
$$;

-- The warranty of an order: the longest warranty of its works, months
CREATE OR REPLACE FUNCTION "private"."lab_order_warranty_months"("org_id" bigint, "target_order_id" bigint) RETURNS integer
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  return coalesce((
    select max(w.warranty_months)
    from public.lab_order_items i
      join public.lab_work_types w on w.organization_id = i.organization_id and w.id = i.work_type_id
    where i.organization_id = org_id and i.order_id = target_order_id
  ), 0);
end;
$$;

--
-- Orders: history, remakes, the invitation, prices of another lab
--

-- After an order is written: the history (created, a status change, the
-- fitting visit), a remake when the status becomes «Переделка» (under the
-- warranty when the order was delivered within it), the day the remade
-- work came back, and — «Готово» — the invitation of the patient
-- (once per ready cycle): a task on the deal, else a notification.
CREATE OR REPLACE FUNCTION "private"."handle_lab_order_after_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  actor bigint := private.current_sales_id();
  today date := private.lab_today(new.organization_id);
  old_status text := case when tg_op = 'UPDATE' then old.status end;
  months integer;
  recipients bigint[];
  recipient bigint;
  assignee bigint;
  patient_name text;
  lab_name text;
  visit_at timestamp with time zone;
begin
  if tg_op = 'INSERT' then
    insert into public.lab_order_events (organization_id, order_id, kind, to_status, sales_id)
    values (new.organization_id, new.id, 'created', new.status, actor);
  elsif new.status <> old.status then
    insert into public.lab_order_events (organization_id, order_id, kind, from_status, to_status, sales_id)
    values (new.organization_id, new.id, case when new.status = 'remake' then 'remake' else 'status' end,
      old.status, new.status, actor);
  end if;

  if new.fitting_visit_id is not null and (tg_op = 'INSERT' or new.fitting_visit_id is distinct from old.fitting_visit_id) then
    select v.starts_at into visit_at
    from public.visits v
    where v.organization_id = new.organization_id and v.id = new.fitting_visit_id;
    insert into public.lab_order_events (organization_id, order_id, kind, note, sales_id)
    values (new.organization_id, new.id, 'fitting_visit',
      to_char(visit_at at time zone coalesce((select nullif(o.timezone, '') from public.organizations o where o.id = new.organization_id), 'Asia/Almaty'), 'DD.MM.YYYY HH24:MI'),
      actor);
  end if;

  -- A remake: under the warranty when the order was delivered within it
  if new.status = 'remake' and old_status is distinct from 'remake' then
    months := private.lab_order_warranty_months(new.organization_id, new.id);
    insert into public.lab_order_remakes (organization_id, order_id, from_status, occurred_on, is_warranty, created_by)
    values (new.organization_id, new.id, old_status, today,
      coalesce(new.first_delivered_at is not null and months > 0
        and today <= (new.first_delivered_at + make_interval(months => months))::date, false),
      actor);
  end if;

  -- The day the remade work came back follows the ready day of the order
  if tg_op = 'UPDATE' and old.ready_at is not null and new.ready_at is distinct from old.ready_at and new.status <> 'remake' then
    update public.lab_order_remakes r set ready_at = new.ready_at
    where r.organization_id = new.organization_id and r.order_id = new.id and r.ready_at = old.ready_at;
  end if;
  if new.ready_at is not null then
    update public.lab_order_remakes r set ready_at = new.ready_at
    where r.organization_id = new.organization_id and r.order_id = new.id and r.ready_at is null;
  end if;

  -- «Готово»: invite the patient, once per ready cycle
  if new.status = 'ready' and old_status is distinct from 'ready' and old_status is distinct from 'delivered'
    and coalesce(current_setting('crm.importing', true), '') <> 'on' then
    -- Not invited yet since the last remake
    if not exists (
      select 1 from public.lab_order_events e
      where e.organization_id = new.organization_id and e.order_id = new.id and e.kind = 'invite'
        and e.id > coalesce((
          select max(e2.id) from public.lab_order_events e2
          where e2.organization_id = new.organization_id and e2.order_id = new.id and e2.kind = 'remake'), 0)
    ) then
      insert into public.lab_order_events (organization_id, order_id, kind, to_status, sales_id)
      values (new.organization_id, new.id, 'invite', new.status, actor);
      select coalesce(nullif(btrim(concat_ws(' ', p.last_name, p.first_name)), ''), p.phones[1], 'Пациент') into patient_name
      from public.patients p
      where p.organization_id = new.organization_id and p.id = new.patient_id;
      select l.name into lab_name from public.labs l where l.organization_id = new.organization_id and l.id = new.lab_id;
      select s.id into assignee from public.sales s
      where s.organization_id = new.organization_id and s.id = new.responsible_id and not s.disabled;
      if new.deal_id is not null then
        insert into public.tasks (organization_id, deal_id, type, text, due_date, sales_id)
        select new.organization_id, d.id, 'call',
          'Пригласить пациента на примерку/сдачу: наряд №' || new.number || coalesce(' · ' || lab_name, ''),
          now(), coalesce(assignee, d.sales_id)
        from public.deals d
        where d.organization_id = new.organization_id and d.id = new.deal_id;
      else
        recipients := case when assignee is not null then array[assignee] else private.clinic_managers(new.organization_id) end;
        foreach recipient in array recipients loop
          perform private.add_notification(new.organization_id, recipient, 'lab_order',
            'Работа готова: пригласите пациента на примерку/сдачу',
            'Наряд №' || new.number || ' · ' || patient_name || coalesce(' · ' || lab_name, ''),
            null, new.patient_id, null);
        end loop;
      end if;
    end if;
  end if;
  return null;
end;
$$;

-- Another lab: the lines take the price of the new lab (on the day of the
-- order)
CREATE OR REPLACE FUNCTION "private"."handle_lab_order_lab_changed"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  update public.lab_order_item_prices pr
  set price = private.lab_price_on(i.organization_id, i.work_type_id, new.lab_id, private.clinic_date(new.organization_id, new.created_at)),
    updated_at = now()
  from public.lab_order_items i
  where i.organization_id = new.organization_id and i.order_id = new.id
    and pr.organization_id = i.organization_id and pr.item_id = i.id and i.work_type_id is not null;
  return null;
end;
$$;

-- A remake: the name of its reason; paid when the clinic or the patient is
-- at fault and it is not under the warranty (free: the lab's fault, the
-- warranty, a fault not known yet) — recomputed when the fault changes;
-- «оплачивается» and «по гарантии» by hand: the owner and the head. The
-- order, the day and the status it came from never change. Twin:
-- remakeDefaults()
CREATE OR REPLACE FUNCTION "private"."handle_lab_order_remake_before_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  reason_name text;
  default_paid boolean;
begin
  if tg_op = 'UPDATE' then
    new.order_id := old.order_id;
    new.occurred_on := old.occurred_on;
    new.from_status := old.from_status;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if pg_trigger_depth() = 1 then
      new.ready_at := old.ready_at;
    end if;
  end if;
  new.reason := nullif(btrim(coalesce(new.reason, '')), '');
  new.comment := nullif(btrim(coalesce(new.comment, '')), '');
  if new.reason_id is not null and (tg_op = 'INSERT' or new.reason_id is distinct from old.reason_id) then
    select r.name into reason_name
    from public.lab_remake_reasons r
    where r.organization_id = new.organization_id and r.id = new.reason_id;
    new.reason := coalesce(reason_name, new.reason);
  end if;
  if tg_op = 'UPDATE' and pg_trigger_depth() = 1 and private.current_user_role() is not null
    and private.current_user_role() not in ('owner', 'head')
    and (new.is_paid is distinct from old.is_paid or new.is_warranty is distinct from old.is_warranty) then
    raise exception 'Оплату переделки и гарантию меняют владелец и руководитель' using errcode = '42501', hint = 'lab_remake_paid';
  end if;
  default_paid := coalesce(new.fault in ('clinic', 'patient'), false) and not new.is_warranty;
  if tg_op = 'INSERT' then
    new.is_paid := default_paid;
  elsif (new.fault is distinct from old.fault or new.is_warranty is distinct from old.is_warranty)
    and new.is_paid is not distinct from old.is_paid then
    new.is_paid := default_paid;
  end if;
  return new;
end;
$$;

-- «Переделка» with its reason (a reason of the dictionary, or its own
-- text), who is at fault and a comment: sets the status (the order trigger
-- writes the remake) and fills the remake. Called again while the order is
-- in «Переделка», it fills the last remake. Rights of the caller (RLS).
CREATE OR REPLACE FUNCTION "public"."lab_order_remake"("target_order_id" bigint, "target_reason_id" bigint DEFAULT NULL::bigint, "reason_text" "text" DEFAULT NULL::"text", "remake_fault" "text" DEFAULT NULL::"text", "remake_comment" "text" DEFAULT NULL::"text") RETURNS bigint
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  remake_id bigint;
begin
  if coalesce(private.current_user_role() in ('owner', 'head', 'manager'), false) is false then
    raise exception 'Нет права менять заказ-наряды' using errcode = '42501';
  end if;
  update public.lab_orders set status = 'remake'
  where id = target_order_id and status <> 'remake';
  select r.id into remake_id
  from public.lab_order_remakes r
  where r.order_id = target_order_id
  order by r.id desc
  limit 1;
  if remake_id is null then
    raise exception 'Наряд не найден' using errcode = 'P0002';
  end if;
  update public.lab_order_remakes r
  set reason_id = target_reason_id,
    reason = case when target_reason_id is null then reason_text else r.reason end,
    fault = remake_fault,
    comment = remake_comment
  where r.id = remake_id;
  return remake_id;
end;
$$;

--
-- Allocations of the lab payments
--

-- An allocation pays an order of the payment's lab; the allocations of a
-- payment stay within its amount, those of an order within its cost
-- (public.lab_order_costs: the lines and the paid remakes)
CREATE OR REPLACE FUNCTION "private"."handle_lab_payment_allocation_before_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  pay public.lab_payments;
  order_lab_id bigint;
  allocated bigint;
  order_cost bigint;
begin
  -- Money: the owner and the head (checked before the RLS of the table,
  -- which runs after this trigger)
  if coalesce(private.current_user_role() not in ('owner', 'head'), false) then
    raise exception 'Оплаты лабораторий распределяют владелец и руководитель' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    new.payment_id := old.payment_id;
    new.order_id := old.order_id;
  end if;
  select * into pay from public.lab_payments p
  where p.organization_id = new.organization_id and p.id = new.payment_id;
  select o.lab_id into order_lab_id from public.lab_orders o
  where o.organization_id = new.organization_id and o.id = new.order_id;
  if pay.id is null or order_lab_id is distinct from pay.lab_id then
    raise exception 'Наряд другой лаборатории' using errcode = '22023', hint = 'lab_allocation_lab';
  end if;
  select coalesce(sum(a.amount), 0) into allocated from public.lab_payment_allocations a
  where a.organization_id = new.organization_id and a.payment_id = new.payment_id and a.id <> new.id;
  if allocated + new.amount > pay.amount then
    raise exception 'По нарядам распределено больше суммы оплаты' using errcode = '22023', hint = 'lab_allocation_over_payment';
  end if;
  select coalesce(sum(c.amount), 0) into order_cost from public.lab_order_costs c
  where c.organization_id = new.organization_id and c.order_id = new.order_id;
  select coalesce(sum(a.amount), 0) into allocated from public.lab_payment_allocations a
  where a.organization_id = new.organization_id and a.order_id = new.order_id and a.id <> new.id;
  if allocated + new.amount > order_cost then
    raise exception 'Оплата наряда больше его стоимости' using errcode = '22023', hint = 'lab_allocation_over_order';
  end if;
  return new;
end;
$$;

--
-- Views
--

-- The orders (40_lab_orders.sql) and, at the end (stage 43): the first
-- ready and delivered days, the fitting visit and its time, the warranty,
-- the last remake, the cost of the paid remakes and what is still due
-- (null: the prices are hidden)
create or replace view public.lab_orders_summary with (security_invoker = on) as
select
    o.id,
    o.organization_id,
    o.number,
    o.patient_id,
    o.deal_id,
    o.plan_id,
    o.stage_id,
    o.doctor_id,
    o.lab_id,
    o.technician_id,
    o.responsible_id,
    o.branch_id,
    o.teeth,
    o.shade,
    o.material,
    o.comment,
    o.status,
    o.sent_at,
    o.fitting1_at,
    o.fitting2_at,
    o.due_at,
    o.ready_at,
    o.delivered_at,
    o.remake_count,
    o.created_by,
    o.created_at,
    o.updated_at,
    nullif(btrim(concat_ws(' ', p.last_name, p.first_name, p.middle_name)), '') as patient_name,
    p.phones[1] as patient_phone,
    d.name as doctor_name,
    l.name as lab_name,
    t.name as technician_name,
    nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), '') as responsible_name,
    coalesce(w.items_count, 0) as items_count,
    coalesce(w.units, 0) as units,
    w.works,
    private.lab_overdue_days(o.status, o.due_at, private.lab_today(o.organization_id)) as overdue_days,
    c.lab_cost,
    o.first_ready_at,
    o.first_delivered_at,
    o.fitting_visit_id,
    v.starts_at as fitting_visit_at,
    coalesce(w.warranty_months, 0) as warranty_months,
    case when o.first_delivered_at is not null and w.warranty_months > 0
        then (o.first_delivered_at + make_interval(months => w.warranty_months))::date end as warranty_until,
    rk.reason as last_remake_reason,
    rk.fault as last_remake_fault,
    rk.is_warranty as last_remake_warranty,
    c.lab_cost * coalesce(rk.paid_count, 0) as remakes_cost,
    c.lab_cost * (1 + coalesce(rk.paid_count, 0)) - coalesce(a.allocated, 0) as due_amount
from public.lab_orders o
    left join public.patients p on p.organization_id = o.organization_id and p.id = o.patient_id
    left join public.doctors d on d.organization_id = o.organization_id and d.id = o.doctor_id
    left join public.labs l on l.organization_id = o.organization_id and l.id = o.lab_id
    left join public.lab_technicians t on t.organization_id = o.organization_id and t.id = o.technician_id
    left join public.sales s on s.organization_id = o.organization_id and s.id = o.responsible_id
    left join public.visits v on v.organization_id = o.organization_id and v.id = o.fitting_visit_id
    left join lateral (
        select count(*)::integer as items_count,
            sum(i.qty)::integer as units,
            string_agg(i.name || case when i.qty > 1 then ' × ' || i.qty else '' end, ', ' order by i.position, i.id) as works,
            max(wt.warranty_months)::integer as warranty_months
        from public.lab_order_items i
            left join public.lab_work_types wt on wt.organization_id = i.organization_id and wt.id = i.work_type_id
        where i.organization_id = o.organization_id and i.order_id = o.id
    ) w on true
    left join lateral (
        select sum(i.qty::bigint * pr.price)::bigint as lab_cost
        from public.lab_order_items i
            join public.lab_order_item_prices pr on pr.organization_id = i.organization_id and pr.item_id = i.id
        where i.organization_id = o.organization_id and i.order_id = o.id
    ) c on true
    left join lateral (
        select r.reason, r.fault, r.is_warranty,
            (select count(*)::integer from public.lab_order_remakes r2
             where r2.organization_id = o.organization_id and r2.order_id = o.id and r2.is_paid) as paid_count
        from public.lab_order_remakes r
        where r.organization_id = o.organization_id and r.order_id = o.id
        order by r.id desc
        limit 1
    ) rk on true
    left join lateral (
        select sum(pa.amount)::bigint as allocated
        from public.lab_payment_allocations pa
        where pa.organization_id = o.organization_id and pa.order_id = o.id
    ) a on true;

-- The lab cost (owner and head: RLS of the prices), the source of the
-- payroll (stage 39), the settlement and the finance reports: one row per
-- work line (kind 'work', billed_on — the day the work was first ready),
-- and one row per paid remake (kind 'remake', id = −remake id, the cost of
-- the order's lines again, billed_on — the day the remade work came back).
-- month is the month of billed_on (null: not billed yet).
create or replace view public.lab_order_costs with (security_invoker = on) as
select
    i.id,
    i.organization_id,
    i.order_id,
    o.number as order_number,
    o.patient_id,
    o.doctor_id,
    o.lab_id,
    o.technician_id,
    o.branch_id,
    o.plan_id,
    i.plan_item_id,
    i.work_type_id,
    i.name,
    i.qty,
    pr.price,
    i.qty::bigint * pr.price as amount,
    o.status,
    o.ready_at,
    date_trunc('month', o.first_ready_at)::date as month,
    'work'::text as kind,
    null::bigint as remake_id,
    o.first_ready_at as billed_on
from public.lab_order_items i
    join public.lab_order_item_prices pr on pr.organization_id = i.organization_id and pr.item_id = i.id
    join public.lab_orders o on o.organization_id = i.organization_id and o.id = i.order_id
union all
select
    - r.id as id,
    r.organization_id,
    r.order_id,
    o.number as order_number,
    o.patient_id,
    o.doctor_id,
    o.lab_id,
    o.technician_id,
    o.branch_id,
    o.plan_id,
    null::bigint as plan_item_id,
    null::bigint as work_type_id,
    'Переделка' || coalesce(': ' || r.reason, '') as name,
    1 as qty,
    c.amount as price,
    c.amount,
    o.status,
    o.ready_at,
    date_trunc('month', r.ready_at)::date as month,
    'remake'::text as kind,
    r.id as remake_id,
    r.ready_at as billed_on
from public.lab_order_remakes r
    join public.lab_orders o on o.organization_id = r.organization_id and o.id = r.order_id
    join lateral (
        select sum(i.qty::bigint * pr.price)::bigint as amount
        from public.lab_order_items i
            join public.lab_order_item_prices pr on pr.organization_id = i.organization_id and pr.item_id = i.id
        where i.organization_id = o.organization_id and i.order_id = o.id
    ) c on c.amount is not null
where r.is_paid;

-- Per order (owner and head): its cost (the lines and the paid remakes),
-- the payments allocated to it and what is still due
create or replace view public.lab_order_balances with (security_invoker = on) as
select
    o.id,
    o.organization_id,
    o.number,
    o.lab_id,
    o.patient_id,
    o.status,
    o.first_ready_at as billed_on,
    nullif(btrim(concat_ws(' ', p.last_name, p.first_name, p.middle_name)), '') as patient_name,
    c.cost,
    coalesce(a.allocated, 0)::bigint as allocated,
    (c.cost - coalesce(a.allocated, 0))::bigint as due
from public.lab_orders o
    left join public.patients p on p.organization_id = o.organization_id and p.id = o.patient_id
    join lateral (
        select sum(lc.amount)::bigint as cost
        from public.lab_order_costs lc
        where lc.organization_id = o.organization_id and lc.order_id = o.id
    ) c on c.cost is not null
    left join lateral (
        select sum(pa.amount)::bigint as allocated
        from public.lab_payment_allocations pa
        where pa.organization_id = o.organization_id and pa.order_id = o.id
    ) a on true;

--
-- Reports (owner and head)
--

-- «Акт сверки» with a lab for a period (both days included), by the dates
-- of the documents: the opening balance (billed − paid before the period),
-- the works billed (per order: the lines on the first ready day, a paid
-- remake the day it came back), the payments (the day paid, the orders
-- they were allocated to), the closing balance. Twin: labReconciliation()
CREATE OR REPLACE FUNCTION "public"."report_lab_reconciliation"("target_lab_id" bigint, "period_from" "date", "period_to" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  org_id bigint := private.current_organization_id();
  lab public.labs;
  opening bigint;
  charged bigint;
  paid bigint;
  lines jsonb;
begin
  if org_id is null or coalesce(private.current_user_role() in ('owner', 'head'), false) is false then
    raise exception 'Акт сверки видят владелец и руководитель' using errcode = '42501';
  end if;
  select * into lab from public.labs l where l.organization_id = org_id and l.id = target_lab_id;
  if lab.id is null then
    raise exception 'Лаборатория не найдена' using errcode = 'P0002';
  end if;
  opening := coalesce((
      select sum(c.amount) from public.lab_order_costs c
      where c.organization_id = org_id and c.lab_id = target_lab_id and c.billed_on < period_from), 0)
    - coalesce((
      select sum(p.amount) from public.lab_payments p
      where p.organization_id = org_id and p.lab_id = target_lab_id
        and private.clinic_date(org_id, p.paid_at) < period_from), 0);
  charged := coalesce((
    select sum(c.amount) from public.lab_order_costs c
    where c.organization_id = org_id and c.lab_id = target_lab_id and c.billed_on between period_from and period_to), 0);
  paid := coalesce((
    select sum(p.amount) from public.lab_payments p
    where p.organization_id = org_id and p.lab_id = target_lab_id
      and private.clinic_date(org_id, p.paid_at) between period_from and period_to), 0);
  select coalesce(jsonb_agg(x.line order by x.day, x.sort, x.number, x.ref), '[]'::jsonb) into lines
  from (
    select c.billed_on as day, 0 as sort, c.order_number as number, c.order_id as ref,
      jsonb_build_object(
        'day', c.billed_on,
        'kind', min(c.kind),
        'order_id', c.order_id,
        'number', c.order_number,
        'remake_id', c.remake_id,
        'patient_name', min(nullif(btrim(concat_ws(' ', pt.last_name, pt.first_name)), '')),
        'works', string_agg(c.name || case when c.qty > 1 then ' × ' || c.qty else '' end, ', ' order by c.id),
        'debit', sum(c.amount)::bigint,
        'credit', 0) as line
    from public.lab_order_costs c
      left join public.patients pt on pt.organization_id = c.organization_id and pt.id = c.patient_id
    where c.organization_id = org_id and c.lab_id = target_lab_id and c.billed_on between period_from and period_to
    group by c.billed_on, c.order_id, c.order_number, c.remake_id
    union all
    select private.clinic_date(org_id, p.paid_at), 1, null, p.id,
      jsonb_build_object(
        'day', private.clinic_date(org_id, p.paid_at),
        'kind', 'payment',
        'payment_id', p.id,
        'method', p.method,
        'comment', p.comment,
        'month', p.month,
        'orders', (
          select string_agg('№' || o.number, ', ' order by o.number)
          from public.lab_payment_allocations a
            join public.lab_orders o on o.organization_id = a.organization_id and o.id = a.order_id
          where a.organization_id = org_id and a.payment_id = p.id),
        'debit', 0,
        'credit', p.amount) as line
    from public.lab_payments p
    where p.organization_id = org_id and p.lab_id = target_lab_id
      and private.clinic_date(org_id, p.paid_at) between period_from and period_to
  ) x;
  return jsonb_build_object(
    'lab_id', lab.id,
    'lab_name', lab.name,
    'period_from', period_from,
    'period_to', period_to,
    'opening', opening,
    'charged', charged,
    'paid', paid,
    'closing', opening + charged - paid,
    'lines', lines);
end;
$$;

-- «Качество»: per lab, per technician and per doctor, for a period (both
-- days included) and a branch:
--   orders          created in the period; remade_orders — of them with a
--                   remake, remake_rate = remade_orders / orders, %;
--   ready           first ready in the period; on_time — of them ready by
--                   the due date (on_time_pct over those with a due date);
--                   avg_lead_days — sent → first ready, days;
--   remakes         remakes recorded in the period, by fault (lab_fault,
--                   clinic_fault, patient_fault), under the warranty, and
--                   their reasons;
--   overdue_now     active orders overdue today (whatever the period);
--   cost            lab cost billed in the period (public.lab_order_costs).
-- Rows with anything to show; «reasons» of the whole clinic; «totals».
-- Owner and head. Twin: labQuality()
CREATE OR REPLACE FUNCTION "public"."report_lab_quality"("period_from" "date", "period_to" "date", "filter_branch_id" bigint DEFAULT NULL::bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  org_id bigint := private.current_organization_id();
  today date;
  result jsonb;
begin
  if org_id is null or coalesce(private.current_user_role() in ('owner', 'head'), false) is false then
    raise exception 'Качество лабораторий видят владелец и руководитель' using errcode = '42501';
  end if;
  today := private.lab_today(org_id);
  with base as (
    select o.id, o.lab_id, o.technician_id, o.doctor_id, o.sent_at, o.due_at, o.first_ready_at, o.remake_count,
      private.clinic_date(o.organization_id, o.created_at) as created_on,
      private.lab_overdue_days(o.status, o.due_at, today) as overdue
    from public.lab_orders o
    where o.organization_id = org_id and (filter_branch_id is null or o.branch_id = filter_branch_id)
  ),
  dims as (
    select 'lab'::text as dim, b.lab_id as key, b.id, b.sent_at, b.due_at, b.first_ready_at, b.remake_count, b.created_on, b.overdue from base b
    union all
    select 'technician', b.technician_id, b.id, b.sent_at, b.due_at, b.first_ready_at, b.remake_count, b.created_on, b.overdue from base b
    union all
    select 'doctor', b.doctor_id, b.id, b.sent_at, b.due_at, b.first_ready_at, b.remake_count, b.created_on, b.overdue from base b
    union all
    select 'total', 0, b.id, b.sent_at, b.due_at, b.first_ready_at, b.remake_count, b.created_on, b.overdue from base b
  ),
  order_stats as (
    select k.dim, k.key,
      count(d.id) filter (where d.created_on between period_from and period_to)::integer as orders,
      count(d.id) filter (where d.created_on between period_from and period_to and d.remake_count > 0)::integer as remade_orders,
      count(d.id) filter (where d.first_ready_at between period_from and period_to)::integer as ready,
      count(d.id) filter (where d.first_ready_at between period_from and period_to and d.due_at is not null)::integer as ready_with_due,
      count(d.id) filter (where d.first_ready_at between period_from and period_to and d.first_ready_at <= d.due_at)::integer as on_time,
      avg(d.first_ready_at - d.sent_at) filter (where d.first_ready_at between period_from and period_to and d.sent_at is not null) as lead,
      count(d.id) filter (where d.overdue > 0)::integer as overdue_now
    from (
      select distinct d0.dim, d0.key from dims d0 where d0.key is not null
      union
      select 'total', 0
    ) k
      left join dims d on d.dim = k.dim and d.key = k.key
    group by k.dim, k.key
  ),
  remakes as (
    select d.dim, d.key, r.reason, r.fault, r.is_warranty
    from dims d
      join public.lab_order_remakes r on r.organization_id = org_id and r.order_id = d.id
    where d.key is not null and r.occurred_on between period_from and period_to
  ),
  remake_stats as (
    select m.dim, m.key,
      count(*)::integer as remakes,
      count(*) filter (where m.fault = 'lab')::integer as lab_fault,
      count(*) filter (where m.fault = 'clinic')::integer as clinic_fault,
      count(*) filter (where m.fault = 'patient')::integer as patient_fault,
      count(*) filter (where m.is_warranty)::integer as warranty
    from remakes m
    group by m.dim, m.key
  ),
  reason_stats as (
    select x.dim, x.key, jsonb_agg(jsonb_build_object('reason', x.reason, 'count', x.n) order by x.n desc, x.reason nulls last) as reasons
    from (
      select m.dim, m.key, m.reason, count(*)::integer as n
      from remakes m
      group by m.dim, m.key, m.reason
    ) x
    group by x.dim, x.key
  ),
  cost_stats as (
    select d.dim, d.key, sum(c.amount)::bigint as cost
    from dims d
      join public.lab_order_costs c on c.organization_id = org_id and c.order_id = d.id
    where d.key is not null and c.billed_on between period_from and period_to
    group by d.dim, d.key
  ),
  names as (
    select 'lab'::text as dim, l.id as key, l.name from public.labs l where l.organization_id = org_id
    union all
    select 'technician', t.id, t.name from public.lab_technicians t where t.organization_id = org_id
    union all
    select 'doctor', dr.id, dr.name from public.doctors dr where dr.organization_id = org_id
    union all
    select 'total', 0, null
  ),
  stat_rows as (
    select s.dim, s.key,
      jsonb_build_object(
        'id', case when s.dim = 'total' then null else s.key end,
        'name', n.name,
        'orders', s.orders,
        'remade_orders', s.remade_orders,
        'remake_rate', case when s.orders > 0 then round(100.0 * s.remade_orders / s.orders) end,
        'ready', s.ready,
        'ready_with_due', s.ready_with_due,
        'on_time', s.on_time,
        'on_time_pct', case when s.ready_with_due > 0 then round(100.0 * s.on_time / s.ready_with_due) end,
        'avg_lead_days', round(s.lead, 1),
        'remakes', coalesce(rs.remakes, 0),
        'lab_fault', coalesce(rs.lab_fault, 0),
        'clinic_fault', coalesce(rs.clinic_fault, 0),
        'patient_fault', coalesce(rs.patient_fault, 0),
        'warranty', coalesce(rs.warranty, 0),
        'reasons', coalesce(rn.reasons, '[]'::jsonb),
        'overdue_now', s.overdue_now,
        'cost', coalesce(cs.cost, 0)) as data,
      coalesce(cs.cost, 0) as cost,
      s.orders,
      n.name
    from order_stats s
      left join names n on n.dim = s.dim and n.key = s.key
      left join remake_stats rs on rs.dim = s.dim and rs.key = s.key
      left join reason_stats rn on rn.dim = s.dim and rn.key = s.key
      left join cost_stats cs on cs.dim = s.dim and cs.key = s.key
    where s.orders > 0 or s.ready > 0 or s.overdue_now > 0 or coalesce(rs.remakes, 0) > 0 or coalesce(cs.cost, 0) > 0
      or s.dim = 'total'
  )
  select jsonb_build_object(
    'labs', coalesce((select jsonb_agg(r.data order by r.orders desc, r.name) from stat_rows r where r.dim = 'lab'), '[]'::jsonb),
    'technicians', coalesce((select jsonb_agg(r.data order by r.orders desc, r.name) from stat_rows r where r.dim = 'technician'), '[]'::jsonb),
    'doctors', coalesce((select jsonb_agg(r.data order by r.orders desc, r.name) from stat_rows r where r.dim = 'doctor'), '[]'::jsonb),
    'reasons', coalesce((select r.data -> 'reasons' from stat_rows r where r.dim = 'total'), '[]'::jsonb),
    'totals', (select r.data from stat_rows r where r.dim = 'total'))
  into result;
  return result;
end;
$$;

--
-- Triggers
--

create or replace trigger seed_lab_remake_reasons
    after insert on public.organizations
    for each row execute function private.handle_organization_lab_remake_reasons();

create or replace trigger lab_order_after_write
    after insert or update on public.lab_orders
    for each row execute function private.handle_lab_order_after_write();

create or replace trigger lab_order_lab_changed
    after update of lab_id on public.lab_orders
    for each row
    when (new.lab_id is distinct from old.lab_id)
    execute function private.handle_lab_order_lab_changed();

create or replace trigger lab_order_remake_before_write
    before insert or update on public.lab_order_remakes
    for each row execute function private.handle_lab_order_remake_before_write();

create or replace trigger lab_payment_allocation_before_write
    before insert or update on public.lab_payment_allocations
    for each row execute function private.handle_lab_payment_allocation_before_write();

-- Audit log: the remakes with the patient of their order (group
-- «Пациенты»), the allocations (group «Оплаты»), the dictionaries (group
-- «Настройки»; not the reasons seeded for a new clinic)
create or replace trigger audit_lab_order_remake
    after update on public.lab_order_remakes
    for each row execute function private.audit_lab_row('lab_order_remake', 'reason_id,reason,fault,is_warranty,is_paid,comment');

create or replace trigger audit_lab_payment_allocation
    after insert or update or delete on public.lab_payment_allocations
    for each row execute function private.audit_row('lab_payment_allocation', 'payment_id,order_id,amount');

create or replace trigger audit_lab_work_type_term
    after insert or update or delete on public.lab_work_type_terms
    for each row when (pg_trigger_depth() = 0) execute function private.audit_row('lab_work_type_term', 'lab_id,work_type_id,fitting_days,ready_days');

create or replace trigger audit_lab_remake_reason
    after insert or update or delete on public.lab_remake_reasons
    for each row when (pg_trigger_depth() = 0) execute function private.audit_row('lab_remake_reason', 'name,is_active');

--
-- Row Level Security
--

alter table public.lab_work_type_terms enable row level security;
alter table public.lab_remake_reasons enable row level security;
alter table public.lab_order_remakes enable row level security;
alter table public.lab_order_events enable row level security;
alter table public.lab_payment_allocations enable row level security;

-- Dictionaries: the clinic reads them, whoever configures it writes them
create policy "Clinic can read" on public.lab_work_type_terms for select to authenticated
    using (organization_id = (select private.current_organization_id()));
create policy "Configurators can insert" on public.lab_work_type_terms for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and (select private.can_configure()));
create policy "Configurators can update" on public.lab_work_type_terms for update to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.can_configure()))
    with check (organization_id = (select private.current_organization_id()));
create policy "Configurators can delete" on public.lab_work_type_terms for delete to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.can_configure()));

create policy "Clinic can read" on public.lab_remake_reasons for select to authenticated
    using (organization_id = (select private.current_organization_id()));
create policy "Configurators can insert" on public.lab_remake_reasons for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and (select private.can_configure()));
create policy "Configurators can update" on public.lab_remake_reasons for update to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.can_configure()))
    with check (organization_id = (select private.current_organization_id()));
create policy "Configurators can delete" on public.lab_remake_reasons for delete to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.can_configure()));

-- Remakes and the history follow their order (the order trigger writes
-- them); the staff fill a remake
create policy "Remakes of visible orders can be read" on public.lab_order_remakes for select to authenticated
    using (organization_id = (select private.current_organization_id())
        and exists (select 1 from public.lab_orders o where o.organization_id = lab_order_remakes.organization_id and o.id = lab_order_remakes.order_id));
create policy "Staff can fill remakes of visible orders" on public.lab_order_remakes for update to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head', 'manager')
        and exists (select 1 from public.lab_orders o where o.organization_id = lab_order_remakes.organization_id and o.id = lab_order_remakes.order_id))
    with check (organization_id = (select private.current_organization_id()));

create policy "History of visible orders can be read" on public.lab_order_events for select to authenticated
    using (organization_id = (select private.current_organization_id())
        and exists (select 1 from public.lab_orders o where o.organization_id = lab_order_events.organization_id and o.id = lab_order_events.order_id));

-- Allocations: money, the owner and the head
create policy "Owner and head read allocations" on public.lab_payment_allocations for select to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'));
create policy "Owner and head add allocations" on public.lab_payment_allocations for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'));
create policy "Owner and head change allocations" on public.lab_payment_allocations for update to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'))
    with check (organization_id = (select private.current_organization_id()));
create policy "Owner and head delete allocations" on public.lab_payment_allocations for delete to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'));

--
-- Grants
--

revoke all on table public.lab_work_type_terms from anon;
grant select, insert, update, delete on table public.lab_work_type_terms to authenticated;
grant all on table public.lab_work_type_terms to service_role;
revoke all on sequence public.lab_work_type_terms_id_seq from anon;
grant usage on sequence public.lab_work_type_terms_id_seq to authenticated;
grant all on sequence public.lab_work_type_terms_id_seq to service_role;

revoke all on table public.lab_remake_reasons from anon;
grant select, insert, update, delete on table public.lab_remake_reasons to authenticated;
grant all on table public.lab_remake_reasons to service_role;
revoke all on sequence public.lab_remake_reasons_id_seq from anon;
grant usage on sequence public.lab_remake_reasons_id_seq to authenticated;
grant all on sequence public.lab_remake_reasons_id_seq to service_role;

revoke all on table public.lab_order_remakes from anon, authenticated;
grant select on table public.lab_order_remakes to authenticated;
grant update (reason_id, reason, fault, comment, is_paid, is_warranty) on table public.lab_order_remakes to authenticated;
grant all on table public.lab_order_remakes to service_role;
revoke all on sequence public.lab_order_remakes_id_seq from anon, authenticated;
grant all on sequence public.lab_order_remakes_id_seq to service_role;

revoke all on table public.lab_order_events from anon, authenticated;
grant select on table public.lab_order_events to authenticated;
grant all on table public.lab_order_events to service_role;
revoke all on sequence public.lab_order_events_id_seq from anon, authenticated;
grant all on sequence public.lab_order_events_id_seq to service_role;

revoke all on table public.lab_payment_allocations from anon;
grant select, insert, delete on table public.lab_payment_allocations to authenticated;
grant update (amount) on table public.lab_payment_allocations to authenticated;
grant all on table public.lab_payment_allocations to service_role;
revoke all on sequence public.lab_payment_allocations_id_seq from anon;
grant usage on sequence public.lab_payment_allocations_id_seq to authenticated;
grant all on sequence public.lab_payment_allocations_id_seq to service_role;

revoke all on table public.lab_order_balances from anon;
grant select on table public.lab_order_balances to authenticated;
grant all on table public.lab_order_balances to service_role;

revoke all on function private.seed_lab_remake_reasons(bigint) from public;
grant execute on function private.seed_lab_remake_reasons(bigint) to service_role;
revoke all on function private.handle_organization_lab_remake_reasons() from public;
revoke all on function private.lab_price_on(bigint, bigint, bigint, date) from public;
grant execute on function private.lab_price_on(bigint, bigint, bigint, date) to service_role;
revoke all on function private.lab_order_warranty_months(bigint, bigint) from public;
grant execute on function private.lab_order_warranty_months(bigint, bigint) to service_role;
revoke all on function private.handle_lab_order_after_write() from public;
revoke all on function private.handle_lab_order_lab_changed() from public;
revoke all on function private.handle_lab_order_remake_before_write() from public;
revoke all on function private.handle_lab_payment_allocation_before_write() from public;

revoke all on function public.lab_propose_dates(bigint, bigint[], date) from public, anon;
grant execute on function public.lab_propose_dates(bigint, bigint[], date) to authenticated, service_role;
revoke all on function public.lab_order_remake(bigint, bigint, text, text, text) from public, anon;
grant execute on function public.lab_order_remake(bigint, bigint, text, text, text) to authenticated, service_role;
revoke all on function public.report_lab_reconciliation(bigint, date, date) from public, anon;
grant execute on function public.report_lab_reconciliation(bigint, date, date) to authenticated, service_role;
revoke all on function public.report_lab_quality(date, date, bigint) from public, anon;
grant execute on function public.report_lab_quality(date, date, bigint) to authenticated, service_role;

--
-- The reasons of a remake for the existing clinics
--
select private.seed_lab_remake_reasons(o.id) from public.organizations o;

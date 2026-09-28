--
-- Stage 36: payments, deposits and the cash desk (see
-- supabase/schemas/36_payments.sql). The patient ledger
-- (account_operations) with deposits, refunds and corrections, cash
-- shifts, debts; deal payments stay the projection of the ledger that the
-- reports read. Existing deal payments are copied into the ledger.
--

-- A refund is a negative deal payment
alter table public.deal_payments drop constraint deal_payments_amount_positive;
alter table public.deal_payments add constraint deal_payments_amount_not_zero check (amount <> 0);

-- The audit log links an account operation without a deal to its patient
CREATE OR REPLACE FUNCTION "private"."audit_row"() RETURNS "trigger"
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
  diff jsonb;
  row_action text;
  row_deal_id bigint;
  row_patient_id bigint;
  actor record;
begin
  -- Cascades, and settings written by other code (template of a new clinic)
  if pg_trigger_depth() > 1
    and (tg_op = 'DELETE' or entity_name in ('pipeline', 'stage', 'task_rule', 'checklist_item', 'settings'))
  then
    return null;
  end if;
  -- A row deleted with its parent (deal of a deleted patient, task of a
  -- deleted deal, stage of a deleted pipeline, anything of a deleted clinic):
  -- only the parent's deletion is logged
  if tg_op = 'DELETE' and (
    not exists (select 1 from public.organizations o where o.id = org_id)
    or (entity_name in ('task', 'payment') and not exists (
      select 1 from public.deals d where d.organization_id = org_id and d.id = (row_data ->> 'deal_id')::bigint))
    or (entity_name = 'deal' and not exists (
      select 1 from public.patients p where p.organization_id = org_id and p.id = (row_data ->> 'patient_id')::bigint))
    or (entity_name = 'stage' and not exists (
      select 1 from public.pipelines p where p.id = (row_data ->> 'pipeline_id')::bigint))
    or (entity_name in ('checklist_item', 'task_rule') and row_data ->> 'stage_id' is not null and not exists (
      select 1 from public.stages s where s.id = (row_data ->> 'stage_id')::bigint))
  ) then
    return null;
  end if;

  diff := private.audit_diff(old_row, new_row, fields);
  if tg_op = 'UPDATE' and diff = '{}'::jsonb then
    return null;
  end if;

  row_action := case tg_op when 'INSERT' then 'create' when 'DELETE' then 'delete' else 'update' end;
  if entity_name = 'task' and tg_op = 'UPDATE' then
    if diff ? 'done_date' then
      row_action := case when new_row ->> 'done_date' is null then 'reopen' else 'complete' end;
    elsif diff ? 'sales_id' and (select count(*) from jsonb_object_keys(diff)) = 1 then
      row_action := 'reassign';
    end if;
  end if;

  if entity_name = 'patient' then
    row_patient_id := (row_data ->> 'id')::bigint;
  elsif entity_name = 'deal' then
    row_deal_id := (row_data ->> 'id')::bigint;
    row_patient_id := (row_data ->> 'patient_id')::bigint;
  elsif row_data ? 'deal_id' then
    row_deal_id := (row_data ->> 'deal_id')::bigint;
    select d.patient_id into row_patient_id
    from public.deals d
    where d.organization_id = org_id and d.id = row_deal_id;
  end if;
  -- Rows of a patient without a deal (account operations, stage 36)
  if row_patient_id is null and entity_name = 'account_operation' then
    row_patient_id := (row_data ->> 'patient_id')::bigint;
  end if;

  select * into actor from private.audit_actor(org_id);
  if pg_trigger_depth() > 1 then
    actor.actor_id := null;
    actor.actor_source := 'automation';
  end if;

  insert into public.audit_log (organization_id, sales_id, source, entity, entity_id, action, changes, deal_id, patient_id)
  values (org_id, actor.actor_id, actor.actor_source, entity_name, (row_data ->> 'id')::bigint,
    row_action, diff, row_deal_id, row_patient_id);
  return null;
end;
$$;

-- A deal payment written by the cash desk is logged as the account operation
create or replace trigger audit_deal_payment
    after insert or update or delete on public.deal_payments
    for each row
    when (coalesce(current_setting('crm.ledger_sync', true), '') <> 'ledger')
    execute function private.audit_row('payment', 'amount,paid_at,comment');

-- A refund (negative payment) is no «payment added»
create or replace trigger deal_payment_pipeline
    after insert on public.deal_payments
    for each row
    when (new.amount > 0)
    execute function private.handle_payment_pipeline();

--
-- Payments, deposits and the cash desk (stage 36): «лицевой счёт пациента»,
-- «Касса», debts, like a dental MIS.
--
--   account_operations   the ledger of the patient accounts: one row per
--                        money operation. kind:
--                          payment          money received for services
--                          deposit          «пополнение депозита» (аванс):
--                                           money put on the balance for a
--                                           future treatment
--                          deposit_payment  services paid from the deposit
--                          refund           money given back: from the paid
--                                           services (account 'services') or
--                                           from the deposit ('deposit'), in
--                                           cash/card… or back to the deposit
--                                           (method 'deposit', from services)
--                          correction       owner only, signed amount, on the
--                                           deposit or on the paid services
--                        method: cash, card (POS), kaspi_qr, kaspi_transfer,
--                        bank_transfer, insurance, deposit, mixed (parts:
--                        [{method, amount}], two or more real methods whose
--                        sum is the amount), other (payments of a deal written
--                        without a method: MIS, import, the API).
--                        The effect of a row — generated columns:
--                          deposit_delta  on the deposit
--                          paid_delta     on the services paid
--                          till_delta     money in (+) or out (−) of the till
--                        Links: deal, treatment plan, plan items (ids), visit;
--                        the cashier (sales_id), the branch, the cash shift.
--   cash_shifts          «смена кассира»: opened with the cash at start,
--                        closed with the cash counted; expected = opening +
--                        cash in − cash out of the shift's operations
--                        (discrepancy = counted − expected).
--
-- Deal payments stay the source of the reports, the marketing revenue, the
-- digital pipeline («оплата добавлена»), the webhooks and deals.paid_amount:
-- every ledger row that pays the services of a deal (paid_delta ≠ 0 and a
-- deal) writes its deal_payments row (amount = paid_delta: a refund is a
-- negative deal payment, which the reports sum like any other), linked by
-- account_operations.deal_payment_id. The other way round, a deal payment
-- written directly (the old deal page, the MIS connector, the import, the
-- API) gets its ledger row (method 'other', source 'deal'/'import'): the two
-- tables never diverge. crm.ledger_sync ('ledger' / 'deal' / 'system') marks
-- the write of one side by the other, so nothing loops and the audit log
-- only records the side that was written.
--
-- Balances (twin: src/components/atomic-crm/payments/paymentMath.ts):
--   deposit  = Σ deposit_delta
--   paid     = Σ paid_delta
--   charged  = services done: the done items of the treatment plans (with
--              the plan discount, pro rata) + the completed visits of the
--              CRM with a priced service whose deal has no treatment plan
--   debt     = max(0, charged − paid)      «Долг»
--   advance  = max(0, paid − charged)      paid ahead of the treatment
--   balance  = deposit + paid − charged
-- A plan's paid amount (public.treatment_plan_payments, plan_paid_amount):
-- the operations linked to the plan and, for the main plan of the deal, the
-- operations of the deal without a plan.
--
-- Rights: whoever sees the patient (owner, head, manager — not the
-- integrator) sees the account and accepts payments and deposits. Refunds:
-- owner and head; corrections: the owner; changing the comment, time or
-- method of an operation and cancelling (deleting) one: owner and head. The
-- cash desk of the whole clinic and the shifts of everybody: owner, head and
-- employees with the «Отчёты» right; a cashier (administrator) without it
-- works with their own shift and operations. Every operation and shift is in
-- the audit log.
--

create table public.account_operations (
    id bigint generated by default as identity primary key,
    organization_id bigint not null default private.current_organization_id(),
    patient_id bigint not null,
    kind text not null,
    account text not null default 'services',
    amount bigint not null,
    method text not null default 'cash',
    -- method 'mixed': [{ "method": "cash", "amount": 20000 }, …]
    parts jsonb,
    -- Cash handed over by the patient (the change is given back)
    cash_received bigint,
    -- The deal payment is a prepayment (deal_payments.kind)
    prepayment boolean not null default false,
    occurred_at timestamp with time zone not null default now(),
    -- The cashier
    sales_id bigint default private.current_sales_id(),
    branch_id bigint,
    shift_id bigint,
    deal_id bigint,
    plan_id bigint,
    plan_item_ids bigint[] not null default '{}'::bigint[],
    visit_id bigint,
    comment text,
    -- cash_desk: the ledger; deal: a deal payment written directly; import
    source text not null default 'cash_desk',
    deal_payment_id bigint,
    created_at timestamp with time zone not null default now(),
    deposit_delta bigint generated always as (
        case
            when kind = 'deposit' then amount
            when kind = 'deposit_payment' then - amount
            when kind = 'refund' and account = 'deposit' then - amount
            when kind = 'refund' and method = 'deposit' then amount
            when kind = 'correction' and account = 'deposit' then amount
            else 0
        end) stored,
    paid_delta bigint generated always as (
        case
            when kind in ('payment', 'deposit_payment') then amount
            when kind = 'refund' and account = 'services' then - amount
            when kind = 'correction' and account = 'services' then amount
            else 0
        end) stored,
    till_delta bigint generated always as (
        case
            when method = 'deposit' or kind = 'correction' then 0
            when kind in ('payment', 'deposit') then amount
            when kind = 'refund' then - amount
            else 0
        end) stored,
    constraint account_operations_kind_check check (kind in ('payment', 'deposit', 'deposit_payment', 'refund', 'correction')),
    constraint account_operations_account_check check (account in ('services', 'deposit')),
    constraint account_operations_method_check check (method in ('cash', 'card', 'kaspi_qr', 'kaspi_transfer', 'bank_transfer', 'insurance', 'deposit', 'mixed', 'other')),
    constraint account_operations_source_check check (source in ('cash_desk', 'deal', 'import')),
    constraint account_operations_amount_check check (case when kind = 'correction' then amount <> 0 else amount > 0 end),
    constraint account_operations_kind_rules check (
        case kind
            when 'payment' then account = 'services' and method <> 'deposit'
            when 'deposit' then account = 'deposit' and method not in ('deposit', 'other')
            when 'deposit_payment' then account = 'services' and method = 'deposit'
            when 'refund' then not (account = 'deposit' and method = 'deposit')
            else method = 'other'
        end),
    constraint account_operations_parts_check check ((method = 'mixed') = (parts is not null)),
    constraint account_operations_cash_received_check check (cash_received is null or cash_received >= 0),
    constraint account_operations_comment_length check (comment is null or char_length(comment) <= 1000)
);

create table public.cash_shifts (
    id bigint generated by default as identity primary key,
    organization_id bigint not null default private.current_organization_id(),
    -- The cashier
    sales_id bigint not null default private.current_sales_id(),
    branch_id bigint,
    opened_at timestamp with time zone not null default now(),
    opening_cash bigint not null default 0,
    closed_at timestamp with time zone,
    closed_by bigint,
    expected_cash bigint,
    counted_cash bigint,
    discrepancy bigint generated always as (counted_cash - expected_cash) stored,
    note text,
    created_at timestamp with time zone not null default now(),
    constraint cash_shifts_opening_check check (opening_cash >= 0),
    constraint cash_shifts_counted_check check (counted_cash is null or counted_cash >= 0),
    constraint cash_shifts_closed_check check ((closed_at is null) = (counted_cash is null)),
    constraint cash_shifts_note_length check (note is null or char_length(note) <= 1000)
);

alter table public.account_operations add constraint account_operations_organization_id_id_key unique (organization_id, id);
alter table public.account_operations add constraint account_operations_deal_payment_id_key unique (deal_payment_id);
alter table public.cash_shifts add constraint cash_shifts_organization_id_id_key unique (organization_id, id);

alter table public.account_operations
    add constraint account_operations_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade;
alter table public.account_operations
    add constraint account_operations_patient_id_fkey foreign key (organization_id, patient_id) references public.patients(organization_id, id) on delete cascade;
alter table public.account_operations
    add constraint account_operations_sales_id_fkey foreign key (organization_id, sales_id) references public.sales(organization_id, id) on delete set null (sales_id);
alter table public.account_operations
    add constraint account_operations_branch_id_fkey foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete set null (branch_id);
alter table public.account_operations
    add constraint account_operations_shift_id_fkey foreign key (organization_id, shift_id) references public.cash_shifts(organization_id, id) on delete set null (shift_id);
alter table public.account_operations
    add constraint account_operations_deal_id_fkey foreign key (organization_id, deal_id) references public.deals(organization_id, id) on delete set null (deal_id);
alter table public.account_operations
    add constraint account_operations_plan_id_fkey foreign key (organization_id, plan_id) references public.treatment_plans(organization_id, id) on delete set null (plan_id);
alter table public.account_operations
    add constraint account_operations_visit_id_fkey foreign key (organization_id, visit_id) references public.visits(organization_id, id) on delete set null (visit_id);
-- A deal payment deleted directly takes its ledger row along
alter table public.account_operations
    add constraint account_operations_deal_payment_id_fkey foreign key (organization_id, deal_payment_id) references public.deal_payments(organization_id, id) on delete cascade;
alter table public.cash_shifts
    add constraint cash_shifts_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade;
alter table public.cash_shifts
    add constraint cash_shifts_sales_id_fkey foreign key (organization_id, sales_id) references public.sales(organization_id, id) on delete cascade;
alter table public.cash_shifts
    add constraint cash_shifts_closed_by_fkey foreign key (organization_id, closed_by) references public.sales(organization_id, id) on delete set null (closed_by);
alter table public.cash_shifts
    add constraint cash_shifts_branch_id_fkey foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete set null (branch_id);

create index account_operations_patient_id_idx on public.account_operations using btree (organization_id, patient_id, occurred_at desc);
create index account_operations_occurred_at_idx on public.account_operations using btree (organization_id, occurred_at);
create index account_operations_deal_id_idx on public.account_operations using btree (organization_id, deal_id) where deal_id is not null;
create index account_operations_plan_id_idx on public.account_operations using btree (organization_id, plan_id) where plan_id is not null;
create index account_operations_shift_id_idx on public.account_operations using btree (organization_id, shift_id) where shift_id is not null;
-- One open shift per cashier
create unique index cash_shifts_open_idx on public.cash_shifts using btree (organization_id, sales_id) where closed_at is null;
create index cash_shifts_opened_at_idx on public.cash_shifts using btree (organization_id, opened_at desc);

--
-- Functions
--

-- The date of a moment in the clinic's time zone
CREATE OR REPLACE FUNCTION "private"."clinic_date"("org_id" bigint, "moment" timestamp with time zone) RETURNS "date"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  return (moment at time zone coalesce((
    select nullif(o.timezone, '') from public.organizations o where o.id = org_id), 'Asia/Almaty'))::date;
end;
$$;

-- The moment of a deal payment written with a date only: its creation time
-- when it was paid that day, else noon of the clinic
CREATE OR REPLACE FUNCTION "private"."payment_moment"("org_id" bigint, "paid_at" "date", "created_at" timestamp with time zone) RETURNS timestamp with time zone
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if paid_at = private.clinic_date(org_id, created_at) then
    return created_at;
  end if;
  return (paid_at + time '12:00') at time zone coalesce((
    select nullif(o.timezone, '') from public.organizations o where o.id = org_id), 'Asia/Almaty');
end;
$$;

-- The part of an operation paid with one method (mixed payments are split
-- in parts). Twin: methodAmount() in paymentMath.ts
CREATE OR REPLACE FUNCTION "private"."operation_method_amount"("method" "text", "parts" "jsonb", "amount" bigint, "target_method" "text") RETURNS bigint
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case
    when method = 'mixed' then coalesce((
      select sum((p ->> 'amount')::bigint)
      from jsonb_array_elements(parts) as p
      where p ->> 'method' = target_method), 0)::bigint
    when method = target_method then abs(amount)
    else 0::bigint
  end;
$$;

-- The value of the done items of a plan, with the plan discount pro rata.
-- Twin: planDoneCharge() in paymentMath.ts
CREATE OR REPLACE FUNCTION "private"."plan_done_charge"("subtotal" bigint, "done_subtotal" bigint, "discount_percent" numeric, "discount_amount" bigint) RETURNS bigint
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case
    when subtotal <= 0 or done_subtotal <= 0 then 0::bigint
    when done_subtotal >= subtotal then private.treatment_plan_total(subtotal, discount_percent, discount_amount)
    else round(done_subtotal::numeric * private.treatment_plan_total(subtotal, discount_percent, discount_amount) / subtotal)::bigint
  end;
$$;

-- Cash expected in the till of a shift: the cash at start, plus the cash in,
-- minus the cash out of its operations
CREATE OR REPLACE FUNCTION "private"."cash_shift_expected"("target_shift_id" bigint) RETURNS bigint
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  shift public.cash_shifts;
begin
  select * into shift from public.cash_shifts s where s.id = target_shift_id;
  if not found then
    return null;
  end if;
  return shift.opening_cash + coalesce((
    select sum(sign(o.till_delta) * private.operation_method_amount(o.method, o.parts, o.amount, 'cash'))
    from public.account_operations o
    where o.organization_id = shift.organization_id and o.shift_id = shift.id and o.till_delta <> 0
  ), 0)::bigint;
end;
$$;

-- Before an operation is written: rights, links, mixed parts, balances, the
-- cashier's shift and branch, and its deal payment
CREATE OR REPLACE FUNCTION "private"."handle_account_operation_before_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  sync text := coalesce(current_setting('crm.ledger_sync', true), '');
  role text := private.current_user_role();
  deal public.deals;
  plan public.treatment_plans;
  visit public.visits;
  shift public.cash_shifts;
  part jsonb;
  parts_total bigint := 0;
  available bigint;
  paid bigint;
  cash_part bigint;
  payment_id bigint;
begin
  if tg_op = 'INSERT' then
    if new.kind = 'payment' then
      new.account := 'services';
    elsif new.kind = 'deposit' then
      new.account := 'deposit';
    elsif new.kind = 'deposit_payment' then
      new.account := 'services';
      new.method := 'deposit';
    elsif new.kind = 'correction' then
      new.method := 'other';
    end if;
    if sync = '' and role is not null then
      if role not in ('owner', 'head', 'manager') then
        raise exception 'Нет права на операции по счёту пациента' using errcode = '42501';
      end if;
      if new.kind = 'refund' and role not in ('owner', 'head') then
        raise exception 'Возврат проводят владелец или руководитель' using errcode = '42501', hint = 'refund_forbidden';
      end if;
      if new.kind = 'correction' and role <> 'owner' then
        raise exception 'Корректировку проводит только владелец' using errcode = '42501', hint = 'correction_forbidden';
      end if;
      new.sales_id := private.current_sales_id();
      new.source := 'cash_desk';
      new.deal_payment_id := null;
      new.shift_id := null;
      new.created_at := now();
    end if;
    new.comment := nullif(btrim(new.comment), '');

    -- Links: the visit, the plan and the deal are of the patient
    if new.visit_id is not null then
      select * into visit from public.visits v where v.organization_id = new.organization_id and v.id = new.visit_id;
      if not found or (new.patient_id is not null and visit.patient_id <> new.patient_id) then
        raise exception 'Визит другого пациента' using errcode = '22023';
      end if;
      new.patient_id := visit.patient_id;
      new.deal_id := coalesce(new.deal_id, visit.deal_id);
    end if;
    if new.plan_id is not null then
      select * into plan from public.treatment_plans p where p.organization_id = new.organization_id and p.id = new.plan_id;
      if not found or (new.deal_id is not null and plan.deal_id <> new.deal_id) then
        raise exception 'План лечения другой сделки' using errcode = '22023';
      end if;
      new.deal_id := plan.deal_id;
    end if;
    if cardinality(new.plan_item_ids) > 0 and (new.plan_id is null or exists (
      select 1 from unnest(new.plan_item_ids) as x(item_id)
      where not exists (
        select 1 from public.treatment_plan_items i
        where i.organization_id = new.organization_id and i.plan_id = new.plan_id and i.id = x.item_id))) then
      raise exception 'Позиции не из этого плана лечения' using errcode = '22023';
    end if;
    if new.deal_id is not null then
      select * into deal from public.deals d where d.organization_id = new.organization_id and d.id = new.deal_id;
      if not found then
        raise exception 'Сделка не найдена' using errcode = 'P0002';
      end if;
      if sync = 'deal' or new.patient_id is null then
        new.patient_id := deal.patient_id;
      elsif new.patient_id <> deal.patient_id then
        raise exception 'Сделка другого пациента' using errcode = '22023';
      end if;
    end if;
  end if;

  -- Mixed payment: two or more real methods, their sum is the amount
  if new.method = 'mixed' then
    if jsonb_typeof(new.parts) is distinct from 'array' or jsonb_array_length(new.parts) < 2 then
      raise exception 'Смешанная оплата — два способа или больше' using errcode = '22023';
    end if;
    for part in select * from jsonb_array_elements(new.parts) loop
      if coalesce(part ->> 'method', '') not in ('cash', 'card', 'kaspi_qr', 'kaspi_transfer', 'bank_transfer', 'insurance')
        or jsonb_typeof(part -> 'amount') is distinct from 'number'
        or (part ->> 'amount')::numeric <= 0 or (part ->> 'amount')::numeric <> round((part ->> 'amount')::numeric) then
        raise exception 'Неверная часть смешанной оплаты' using errcode = '22023';
      end if;
      parts_total := parts_total + (part ->> 'amount')::bigint;
    end loop;
    if parts_total <> abs(new.amount) then
      raise exception 'Сумма частей (% ₸) не равна сумме оплаты (% ₸)',
        private.format_tenge(parts_total), private.format_tenge(abs(new.amount)) using errcode = '22023';
    end if;
  else
    new.parts := null;
  end if;

  -- Cash handed over: at least the cash part (the rest is the change)
  cash_part := private.operation_method_amount(new.method, new.parts, new.amount, 'cash');
  if new.kind not in ('payment', 'deposit') or cash_part = 0 then
    new.cash_received := null;
  elsif new.cash_received is not null and new.cash_received < cash_part then
    raise exception 'Получено наличными меньше, чем к оплате' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    -- The cashier's open shift, the branch
    select * into shift from public.cash_shifts s
    where s.organization_id = new.organization_id and s.sales_id = new.sales_id and s.closed_at is null;
    if new.shift_id is null and sync <> 'deal' then
      new.shift_id := shift.id;
    end if;
    new.branch_id := coalesce(new.branch_id, shift.branch_id, deal.branch_id, visit.branch_id);

    -- Balances, one operation of the patient at a time
    if sync = '' then
      perform 1 from public.patients p where p.organization_id = new.organization_id and p.id = new.patient_id for update;
      if new.kind = 'deposit_payment' or (new.kind = 'refund' and new.account = 'deposit')
        or (new.kind = 'correction' and new.account = 'deposit' and new.amount < 0) then
        select coalesce(sum(o.deposit_delta), 0) into available
        from public.account_operations o
        where o.organization_id = new.organization_id and o.patient_id = new.patient_id;
        if available < abs(new.amount) then
          raise exception 'На депозите % ₸ — меньше суммы операции', private.format_tenge(available)
            using errcode = '22023', hint = 'deposit_insufficient';
        end if;
      end if;
      if new.kind = 'refund' and new.account = 'services' then
        select coalesce(sum(o.paid_delta), 0) into paid
        from public.account_operations o
        where o.organization_id = new.organization_id and o.patient_id = new.patient_id
          and (new.deal_id is null or o.deal_id = new.deal_id);
        if paid < new.amount then
          raise exception 'Вернуть можно не больше оплаченного: % ₸', private.format_tenge(paid)
            using errcode = '22023', hint = 'refund_exceeds_paid';
        end if;
      end if;
    end if;
  end if;

  -- The deal payment: the ledger row that pays the services of a deal
  if sync not in ('deal', 'system') then
    paid := case
      when new.kind in ('payment', 'deposit_payment') then new.amount
      when new.kind = 'refund' and new.account = 'services' then - new.amount
      when new.kind = 'correction' and new.account = 'services' then new.amount
      else 0
    end;
    if tg_op = 'INSERT' and new.deal_id is not null and paid <> 0 then
      perform set_config('crm.ledger_sync', 'ledger', true);
      insert into public.deal_payments (organization_id, deal_id, amount, paid_at, comment, sales_id, kind)
      values (new.organization_id, new.deal_id, paid, private.clinic_date(new.organization_id, new.occurred_at),
        new.comment, new.sales_id, case when new.prepayment then 'prepayment' else 'payment' end)
      returning id into payment_id;
      perform set_config('crm.ledger_sync', sync, true);
      new.deal_payment_id := payment_id;
    elsif tg_op = 'UPDATE' and new.deal_payment_id is not null
      and (new.comment is distinct from old.comment or new.occurred_at <> old.occurred_at) then
      perform set_config('crm.ledger_sync', 'ledger', true);
      update public.deal_payments p
      set comment = new.comment, paid_at = private.clinic_date(new.organization_id, new.occurred_at)
      where p.id = new.deal_payment_id;
      perform set_config('crm.ledger_sync', sync, true);
    end if;
  end if;
  return new;
end;
$$;

-- A cancelled (deleted) operation takes its deal payment along
CREATE OR REPLACE FUNCTION "private"."handle_account_operation_deleted"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  sync text := coalesce(current_setting('crm.ledger_sync', true), '');
begin
  if old.deal_payment_id is not null and sync <> 'deal' then
    perform set_config('crm.ledger_sync', 'ledger', true);
    delete from public.deal_payments p where p.id = old.deal_payment_id;
    perform set_config('crm.ledger_sync', sync, true);
  end if;
  return null;
end;
$$;

-- A deal payment written directly (old deal page, MIS, import, API): the
-- ledger follows. A manager does not change or delete payments.
CREATE OR REPLACE FUNCTION "private"."handle_deal_payment_ledger_before"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  sync text := coalesce(current_setting('crm.ledger_sync', true), '');
begin
  if sync = 'ledger' then
    return coalesce(new, old);
  end if;
  if tg_op <> 'INSERT' and pg_trigger_depth() = 1 and private.current_user_role() = 'manager'
    and (tg_op = 'DELETE' or new.amount <> old.amount or new.paid_at <> old.paid_at) then
    raise exception 'Изменить или удалить оплату могут владелец или руководитель' using errcode = '42501', hint = 'payment_locked';
  end if;
  if tg_op = 'DELETE' then
    perform set_config('crm.ledger_sync', 'deal', true);
    delete from public.account_operations o where o.deal_payment_id = old.id;
    perform set_config('crm.ledger_sync', sync, true);
    return old;
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."handle_deal_payment_ledger_after"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  sync text := coalesce(current_setting('crm.ledger_sync', true), '');
begin
  if sync = 'ledger' then
    return null;
  end if;
  perform set_config('crm.ledger_sync', 'deal', true);
  if tg_op = 'INSERT' then
    insert into public.account_operations (organization_id, patient_id, kind, account, amount, method, prepayment,
      occurred_at, sales_id, branch_id, deal_id, comment, source, deal_payment_id, created_at)
    select new.organization_id, d.patient_id, case when new.amount > 0 then 'payment' else 'refund' end, 'services',
      abs(new.amount), 'other', new.kind = 'prepayment',
      private.payment_moment(new.organization_id, new.paid_at, new.created_at), new.sales_id, d.branch_id,
      new.deal_id, new.comment,
      case when current_setting('crm.importing', true) = 'on' then 'import' else 'deal' end, new.id, new.created_at
    from public.deals d
    where d.organization_id = new.organization_id and d.id = new.deal_id;
  else
    update public.account_operations o
    set kind = case
          when (new.amount > 0) = (old.amount > 0) then o.kind
          when new.amount > 0 then 'payment'
          else 'refund'
        end,
        account = case when (new.amount > 0) = (old.amount > 0) then o.account else 'services' end,
        method = case when (new.amount > 0) = (old.amount > 0) then o.method else 'other' end,
        parts = case when (new.amount > 0) = (old.amount > 0) then o.parts end,
        amount = abs(new.amount),
        deal_id = new.deal_id,
        patient_id = coalesce((
          select d.patient_id from public.deals d
          where d.organization_id = new.organization_id and d.id = new.deal_id), o.patient_id),
        prepayment = new.kind = 'prepayment',
        comment = new.comment,
        occurred_at = case when new.paid_at <> old.paid_at
          then private.payment_moment(new.organization_id, new.paid_at, new.created_at) else o.occurred_at end
    where o.deal_payment_id = new.id;
  end if;
  perform set_config('crm.ledger_sync', sync, true);
  return null;
end;
$$;

-- A deal moved to another patient (patients merged) takes its operations
CREATE OR REPLACE FUNCTION "private"."handle_deal_patient_operations"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  sync text := coalesce(current_setting('crm.ledger_sync', true), '');
begin
  perform set_config('crm.ledger_sync', 'system', true);
  update public.account_operations o
  set patient_id = new.patient_id
  where o.organization_id = new.organization_id and o.deal_id = new.id and o.patient_id <> new.patient_id;
  perform set_config('crm.ledger_sync', sync, true);
  return null;
end;
$$;

-- «Открыть смену»: the cashier's shift, with the cash at start. The branch:
-- the one given, else the cashier's only branch.
CREATE OR REPLACE FUNCTION "public"."open_cash_shift"("opening_cash" bigint DEFAULT 0, "target_branch_id" bigint DEFAULT NULL::bigint) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  org_id bigint := private.current_organization_id();
  me bigint := private.current_sales_id();
  branches bigint[] := private.current_branch_ids();
  shift_id bigint;
begin
  if org_id is null or me is null or coalesce(private.current_user_role(), '') not in ('owner', 'head', 'manager') then
    raise exception 'Нет права открыть смену' using errcode = '42501';
  end if;
  if coalesce(opening_cash, 0) < 0 then
    raise exception 'Сумма на начало смены не может быть отрицательной' using errcode = '22023';
  end if;
  if exists (select 1 from public.cash_shifts s where s.organization_id = org_id and s.sales_id = me and s.closed_at is null) then
    raise exception 'Смена уже открыта' using errcode = '23505', hint = 'shift_open';
  end if;
  if target_branch_id is not null and not exists (
    select 1 from public.branches b where b.organization_id = org_id and b.id = target_branch_id) then
    raise exception 'Филиал не найден' using errcode = 'P0002';
  end if;
  insert into public.cash_shifts (organization_id, sales_id, branch_id, opening_cash)
  values (org_id, me, coalesce(target_branch_id, case when cardinality(branches) = 1 then branches[1] end),
    coalesce(opening_cash, 0))
  returning id into shift_id;
  return shift_id;
end;
$$;

-- «Закрыть смену»: the cash counted against the cash expected. The cashier
-- of the shift, the owner or the head.
CREATE OR REPLACE FUNCTION "public"."close_cash_shift"("target_shift_id" bigint, "counted_cash" bigint, "note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  org_id bigint := private.current_organization_id();
  me bigint := private.current_sales_id();
  role text := private.current_user_role();
  shift public.cash_shifts;
  expected bigint;
begin
  select * into shift from public.cash_shifts s
  where s.organization_id = org_id and s.id = target_shift_id
  for update;
  if not found then
    raise exception 'Смена не найдена' using errcode = 'P0002';
  end if;
  if coalesce(role, '') not in ('owner', 'head') and (role is distinct from 'manager' or shift.sales_id <> me) then
    raise exception 'Закрыть смену может кассир смены, владелец или руководитель' using errcode = '42501';
  end if;
  if shift.closed_at is not null then
    raise exception 'Смена уже закрыта' using errcode = '22023', hint = 'shift_closed';
  end if;
  if counted_cash is null or counted_cash < 0 then
    raise exception 'Укажите сумму в кассе' using errcode = '22023';
  end if;
  expected := private.cash_shift_expected(shift.id);
  update public.cash_shifts s
  set closed_at = now(), closed_by = me, expected_cash = expected, counted_cash = close_cash_shift.counted_cash,
      note = nullif(btrim(close_cash_shift.note), '')
  where s.id = shift.id;
  return jsonb_build_object('shift_id', shift.id, 'expected_cash', expected, 'counted_cash', counted_cash,
    'discrepancy', counted_cash - expected);
end;
$$;

-- The cash expected in an open shift (the dialog «Закрыть смену»); whoever
-- sees the shift
CREATE OR REPLACE FUNCTION "public"."cash_shift_expected"("target_shift_id" bigint) RETURNS bigint
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
begin
  if not exists (select 1 from public.cash_shifts s where s.id = target_shift_id) then
    return null;
  end if;
  return private.cash_shift_expected(target_shift_id);
end;
$$;

-- «Оплачено» of a treatment plan: for the plan editor (stage 34) and the
-- estimate. The caller's rights apply.
CREATE OR REPLACE FUNCTION "public"."plan_paid_amount"("target_plan_id" bigint) RETURNS bigint
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
begin
  return coalesce((select t.paid_amount from public.treatment_plan_payments t where t.id = target_plan_id), 0);
end;
$$;

-- Reports «Деньги» → «Поступления по способам оплаты»: money in and out of
-- the till by method in the period (the ledger), with the branch filter
CREATE OR REPLACE FUNCTION "public"."report_cash_methods"("period_from" timestamp with time zone DEFAULT NULL::timestamp with time zone, "period_to" timestamp with time zone DEFAULT NULL::timestamp with time zone, "filter_branch_id" bigint DEFAULT NULL::bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
begin
  perform private.report_check_access();
  return coalesce((
    select jsonb_agg(jsonb_build_object('method', r.method, 'income', r.income, 'refunds', r.refunds,
      'net', r.income - r.refunds, 'operations', r.operations) order by r.income - r.refunds desc, r.method)
    from (
      select m.method,
        coalesce(sum(m.amount) filter (where m.sign > 0), 0)::bigint as income,
        coalesce(sum(m.amount) filter (where m.sign < 0), 0)::bigint as refunds,
        count(distinct m.id) as operations
      from (
        select o.id, sign(o.till_delta) as sign, x.method, x.amount
        from public.account_operations o
          cross join lateral (
            select p ->> 'method' as method, (p ->> 'amount')::bigint as amount
            from jsonb_array_elements(case when o.method = 'mixed' then o.parts else '[]'::jsonb end) as p
            union all
            select o.method, o.amount where o.method <> 'mixed'
          ) x
        where o.organization_id = private.current_organization_id()
          and o.till_delta <> 0
          and (period_from is null or o.occurred_at >= period_from)
          and (period_to is null or o.occurred_at < period_to)
          and (filter_branch_id is null or o.branch_id = filter_branch_id)
      ) m
      group by m.method
    ) r
  ), '[]'::jsonb);
end;
$$;

--
-- Views
--

-- Operations with the names the lists need (patient card, cash desk)
create or replace view public.account_operations_summary with (security_invoker = on) as
select
    o.id,
    o.organization_id,
    o.patient_id,
    o.kind,
    o.account,
    o.amount,
    o.method,
    o.parts,
    o.cash_received,
    o.prepayment,
    o.occurred_at,
    o.sales_id,
    o.branch_id,
    o.shift_id,
    o.deal_id,
    o.plan_id,
    o.plan_item_ids,
    o.visit_id,
    o.comment,
    o.source,
    o.deal_payment_id,
    o.created_at,
    o.deposit_delta,
    o.paid_delta,
    o.till_delta,
    nullif(btrim(concat_ws(' ', p.last_name, p.first_name, p.middle_name)), '') as patient_name,
    p.phones[1] as patient_phone,
    nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), '') as cashier_name,
    d.name as deal_name,
    tp.name as plan_name,
    b.name as branch_name
from public.account_operations o
    join public.patients p on p.organization_id = o.organization_id and p.id = o.patient_id
    left join public.sales s on s.organization_id = o.organization_id and s.id = o.sales_id
    left join public.deals d on d.organization_id = o.organization_id and d.id = o.deal_id
    left join public.treatment_plans tp on tp.organization_id = o.organization_id and tp.id = o.plan_id
    left join public.branches b on b.organization_id = o.organization_id and b.id = o.branch_id;

-- «Счёт» of every patient: deposit, paid, services done, debt, balance
create or replace view public.patient_accounts with (security_invoker = on) as
select
    p.id,
    p.organization_id,
    p.first_name,
    p.last_name,
    p.middle_name,
    p.phones,
    p.sales_id,
    a.deposit,
    a.paid,
    c.charged,
    greatest(0, c.charged - a.paid) as debt,
    greatest(0, a.paid - c.charged) as advance,
    a.deposit + a.paid - c.charged as balance,
    a.last_payment_at,
    a.operations_count,
    (
        select max(v.starts_at)
        from public.visits v
        where v.organization_id = p.organization_id and v.patient_id = p.id
            and v.status in ('arrived', 'completed')
    ) as last_visit_at,
    (
        select d.id
        from public.deals d
        where d.organization_id = p.organization_id and d.patient_id = p.id
        order by d.created_at desc, d.id desc
        limit 1
    ) as last_deal_id
from public.patients p
    cross join lateral (
        select
            coalesce(sum(o.deposit_delta), 0)::bigint as deposit,
            coalesce(sum(o.paid_delta), 0)::bigint as paid,
            max(o.occurred_at) as last_payment_at,
            count(o.id)::integer as operations_count
        from public.account_operations o
        where o.organization_id = p.organization_id and o.patient_id = p.id
    ) a
    cross join lateral (
        select (
            coalesce((
                select sum(private.plan_done_charge(t.subtotal, t.done_subtotal, tp.discount_percent, tp.discount_amount))
                from public.treatment_plans tp
                    cross join lateral (
                        select
                            coalesce(sum(i.line_total), 0)::bigint as subtotal,
                            coalesce(sum(i.line_total) filter (where i.done), 0)::bigint as done_subtotal
                        from public.treatment_plan_items i
                        where i.organization_id = tp.organization_id and i.plan_id = tp.id
                    ) t
                where tp.organization_id = p.organization_id and tp.patient_id = p.id and tp.status <> 'declined'
            ), 0)
            + coalesce((
                select sum(round(sv.price))
                from public.visits v
                    join public.services sv on sv.organization_id = v.organization_id and sv.id = v.service_id
                where v.organization_id = p.organization_id and v.patient_id = p.id
                    and v.status = 'completed' and v.source = 'crm' and sv.price > 0
                    and not exists (
                        select 1 from public.treatment_plans tp
                        where tp.organization_id = v.organization_id and tp.deal_id = v.deal_id and tp.status <> 'declined'
                    )
            ), 0)
        )::bigint as charged
    ) c;

-- Every treatment plan with what is paid for it and what is due
create or replace view public.treatment_plan_payments with (security_invoker = on) as
select
    tp.id,
    tp.organization_id,
    tp.deal_id,
    tp.patient_id,
    tp.status,
    tp.is_main,
    private.treatment_plan_total(t.subtotal, tp.discount_percent, tp.discount_amount) as total_amount,
    private.plan_done_charge(t.subtotal, t.done_subtotal, tp.discount_percent, tp.discount_amount) as done_amount,
    pay.paid_amount,
    greatest(0, private.treatment_plan_total(t.subtotal, tp.discount_percent, tp.discount_amount) - pay.paid_amount) as due_amount,
    greatest(0, private.plan_done_charge(t.subtotal, t.done_subtotal, tp.discount_percent, tp.discount_amount) - pay.paid_amount) as debt_amount
from public.treatment_plans tp
    cross join lateral (
        select
            coalesce(sum(i.line_total), 0)::bigint as subtotal,
            coalesce(sum(i.line_total) filter (where i.done), 0)::bigint as done_subtotal
        from public.treatment_plan_items i
        where i.organization_id = tp.organization_id and i.plan_id = tp.id
    ) t
    cross join lateral (
        select coalesce(sum(o.paid_delta), 0)::bigint as paid_amount
        from public.account_operations o
        where o.organization_id = tp.organization_id
            and (o.plan_id = tp.id or (tp.is_main and o.deal_id = tp.deal_id and o.plan_id is null))
    ) pay;

--
-- Triggers
--

create or replace trigger account_operation_before_write
    before insert or update on public.account_operations
    for each row execute function private.handle_account_operation_before_write();

create or replace trigger account_operation_deleted
    after delete on public.account_operations
    for each row execute function private.handle_account_operation_deleted();

create or replace trigger deal_payment_ledger_before
    before insert or update or delete on public.deal_payments
    for each row execute function private.handle_deal_payment_ledger_before();

create or replace trigger deal_payment_ledger_after
    after insert or update on public.deal_payments
    for each row execute function private.handle_deal_payment_ledger_after();

create or replace trigger move_deal_operations_with_patient
    after update of patient_id on public.deals
    for each row
    when (old.patient_id is distinct from new.patient_id)
    execute function private.handle_deal_patient_operations();

-- Audit log: the side that was written (a deal payment written by the
-- ledger is logged as the operation)
create or replace trigger audit_account_operation
    after insert or update or delete on public.account_operations
    for each row
    when (coalesce(current_setting('crm.ledger_sync', true), '') not in ('deal', 'system'))
    execute function private.audit_row('account_operation', 'kind,account,amount,method,parts,occurred_at,comment,deal_id,plan_id,visit_id,shift_id');

create or replace trigger audit_cash_shift
    after insert or update on public.cash_shifts
    for each row execute function private.audit_row('cash_shift', 'opening_cash,closed_at,expected_cash,counted_cash,note,branch_id');

--
-- Row Level Security
--

alter table public.account_operations enable row level security;
alter table public.cash_shifts enable row level security;

-- The account follows the patient; the integrator sees no money
create policy "Staff read accounts of visible patients" on public.account_operations for select to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head', 'manager')
        and exists (select 1 from public.patients p where p.organization_id = account_operations.organization_id and p.id = account_operations.patient_id));
create policy "Staff write operations of visible patients" on public.account_operations for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head', 'manager')
        and exists (select 1 from public.patients p where p.organization_id = account_operations.organization_id and p.id = account_operations.patient_id)
        and (deal_id is null or exists (select 1 from public.deals d where d.organization_id = account_operations.organization_id and d.id = account_operations.deal_id)));
create policy "Owner and head change operations" on public.account_operations for update to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'))
    with check (organization_id = (select private.current_organization_id()));
create policy "Owner and head cancel operations" on public.account_operations for delete to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'));

-- Shifts: the cashier's own; all of them with the «Отчёты» right
create policy "Cashiers read their shifts, reports read all" on public.cash_shifts for select to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head', 'manager')
        and (sales_id = (select private.current_sales_id()) or (select private.access_scope('reports', 'view')) = 'all'));

--
-- Grants
--

revoke all on table public.account_operations from anon;
grant select, insert, delete on table public.account_operations to authenticated;
-- Only the comment, the time and the method of an operation change
grant update (comment, occurred_at, method, parts, cash_received) on table public.account_operations to authenticated;
grant all on table public.account_operations to service_role;
revoke all on sequence public.account_operations_id_seq from anon;
grant usage on sequence public.account_operations_id_seq to authenticated;
grant all on sequence public.account_operations_id_seq to service_role;

revoke all on table public.cash_shifts from anon;
grant select on table public.cash_shifts to authenticated;
grant all on table public.cash_shifts to service_role;
revoke all on sequence public.cash_shifts_id_seq from anon;
grant all on sequence public.cash_shifts_id_seq to service_role;

revoke all on table public.account_operations_summary from anon;
grant select on table public.account_operations_summary to authenticated;
grant all on table public.account_operations_summary to service_role;
revoke all on table public.patient_accounts from anon;
grant select on table public.patient_accounts to authenticated;
grant all on table public.patient_accounts to service_role;
revoke all on table public.treatment_plan_payments from anon;
grant select on table public.treatment_plan_payments to authenticated;
grant all on table public.treatment_plan_payments to service_role;

revoke all on function private.clinic_date(bigint, timestamp with time zone) from public;
grant execute on function private.clinic_date(bigint, timestamp with time zone) to service_role;
revoke all on function private.payment_moment(bigint, date, timestamp with time zone) from public;
grant execute on function private.payment_moment(bigint, date, timestamp with time zone) to service_role;
revoke all on function private.cash_shift_expected(bigint) from public;
grant execute on function private.cash_shift_expected(bigint) to authenticated, service_role;
revoke all on function private.handle_account_operation_before_write() from public;
revoke all on function private.handle_account_operation_deleted() from public;
revoke all on function private.handle_deal_payment_ledger_before() from public;
revoke all on function private.handle_deal_payment_ledger_after() from public;
revoke all on function private.handle_deal_patient_operations() from public;

revoke all on function public.open_cash_shift(bigint, bigint) from public, anon;
grant execute on function public.open_cash_shift(bigint, bigint) to authenticated, service_role;
revoke all on function public.close_cash_shift(bigint, bigint, text) from public, anon;
grant execute on function public.close_cash_shift(bigint, bigint, text) to authenticated, service_role;
revoke all on function public.cash_shift_expected(bigint) from public, anon;
grant execute on function public.cash_shift_expected(bigint) to authenticated, service_role;
revoke all on function public.plan_paid_amount(bigint) from public, anon;
grant execute on function public.plan_paid_amount(bigint) to authenticated, service_role;
revoke all on function public.report_cash_methods(timestamp with time zone, timestamp with time zone, bigint) from public, anon;
grant execute on function public.report_cash_methods(timestamp with time zone, timestamp with time zone, bigint) to authenticated, service_role;

--
-- Existing deal payments: one ledger row each (method unknown: «Другое»)
--

select set_config('crm.ledger_sync', 'deal', false);
insert into public.account_operations (organization_id, patient_id, kind, account, amount, method, prepayment,
  occurred_at, sales_id, branch_id, deal_id, comment, source, deal_payment_id, created_at)
select p.organization_id, d.patient_id, 'payment', 'services', p.amount, 'other', p.kind = 'prepayment',
  private.payment_moment(p.organization_id, p.paid_at, p.created_at), p.sales_id, d.branch_id, p.deal_id, p.comment,
  'deal', p.id, p.created_at
from public.deal_payments p
  join public.deals d on d.organization_id = p.organization_id and d.id = p.deal_id
order by p.id;
select set_config('crm.ledger_sync', '', false);

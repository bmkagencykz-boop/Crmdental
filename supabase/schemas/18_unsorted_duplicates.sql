--
-- «Неразобранное» (incoming leads to accept or reject) and duplicate
-- patients (stage 18)
--
-- Unsorted leads. With the clinic setting on (organization_settings.
-- unsorted_enabled, optionally only for some sources), a new deal opened by a
-- system channel (public.ingest_message and the Telegram bot, ingest_lead,
-- ingest_call) is created with deals.unsorted_at = now() instead of going
-- straight to work. The flag lives on the deal (declared in 13_doctors.sql,
-- because deals_summary shows it), so messages, calls and notes attach as
-- usual. While a deal is unsorted it gets no distribution, no automatic
-- tasks, no auto-messages and no response alerts (handle_deal_before_write,
-- handle_deal_after_write, handle_deal_automessages, deals_waiting,
-- notify_response_overdue); the board shows it in a leftmost
-- «Неразобранное» column (view unsorted_leads). An employee:
--   accepts it (public.accept_unsorted): chosen stage and responsible
--     (default: the first stage, the distribution rule); the deal then gets
--     the automations of a new deal;
--   rejects it (public.reject_unsorted): lost with the system reason
--     «Спам / не целевое» (lost_reasons.code = 'spam', created when needed);
--   merges it into an open deal (public.merge_unsorted): its messages,
--     calls, notes and tasks move there and the lead is deleted; a patient
--     left without deals is merged into the deal's patient.
-- Moving an unsorted lead to a stage by hand accepts it as well.
--
-- Duplicates. Two patients of a clinic are possible duplicates when they
-- share a normalized phone, a chat (Telegram / Instagram id or username),
-- or the same full name and birth date. public.patient_duplicates(id) lists
-- the duplicates of one patient, public.duplicate_groups() the groups of the
-- clinic; both run with the caller's rights (RLS). public.merge_patients
-- (owner and head) keeps one patient, moves every row that references the
-- other one (any composite foreign key to patients, and external_refs),
-- unions phones, tags and chats, takes the chosen value of the name, birth
-- date, source, responsible and comment, deletes the other patient and
-- writes an audit row (entity patient, action merge). The same rules in the
-- app: duplicates/duplicates.ts and unsorted/unsorted.ts.
--

--
-- Settings, dictionary
--

-- New leads of the system channels go to «Неразобранное» (off: straight to work)
alter table public.organization_settings add column unsorted_enabled boolean not null default false;
-- Only the leads of these sources (empty: every source)
alter table public.organization_settings add column unsorted_source_ids bigint[] not null default '{}'::bigint[];

-- System values of the lost reasons: 'spam' is «Спам / не целевое»
alter table public.lost_reasons add column code text;

create unique index lost_reasons_code_idx on public.lost_reasons using btree (organization_id, code) where code is not null;
create index deals_unsorted_idx on public.deals using btree (organization_id, unsorted_at) where unsorted_at is not null;

--
-- Unsorted leads
--

-- When a new deal of this source goes to «Неразобранное»: now, or null
CREATE OR REPLACE FUNCTION "private"."unsorted_intake"("org_id" bigint, "lead_source_id" bigint) RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select now()
  from public.organization_settings s
  where s.organization_id = org_id
    and s.unsorted_enabled
    and (cardinality(s.unsorted_source_ids) = 0 or lead_source_id = any(s.unsorted_source_ids))
$$;

-- «Спам / не целевое» of the current clinic, added to its lost reasons when
-- missing (a reason of that name written by hand becomes the system one)
CREATE OR REPLACE FUNCTION "private"."spam_lost_reason"() RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  org_id bigint := private.current_organization_id();
  reason_id bigint;
begin
  if org_id is null then
    return null;
  end if;
  select r.id into reason_id from public.lost_reasons r
  where r.organization_id = org_id and r.code = 'spam';
  if reason_id is null then
    update public.lost_reasons r
    set code = 'spam'
    where r.id = (
      select n.id from public.lost_reasons n
      where n.organization_id = org_id and n.code is null
        and lower(btrim(n.name)) = lower('Спам / не целевое')
      order by n.id
      limit 1
    )
    returning r.id into reason_id;
  end if;
  if reason_id is null then
    insert into public.lost_reasons (organization_id, name, code, position)
    select org_id, 'Спам / не целевое', 'spam', coalesce(max(r.position) + 1, 0)
    from public.lost_reasons r
    where r.organization_id = org_id
    returning id into reason_id;
  end if;
  return reason_id;
end;
$$;

-- The deals RLS policy for SECURITY DEFINER code: may the current user see it
CREATE OR REPLACE FUNCTION "private"."deal_visible"("deal" "public"."deals") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  return coalesce(
    deal.id is not null
    and deal.organization_id = private.current_organization_id()
    and (
      private.manager_deal_visibility() = 'all'
      or deal.sales_id = private.current_sales_id()
      or (private.manager_deal_visibility() = 'own_and_unassigned' and deal.sales_id is null)
    ),
    false);
end;
$$;

-- «Принять»: the lead goes to the chosen open stage (default: the first
-- stage of its pipeline) with the chosen responsible (default: its own, else
-- the clinic's distribution), and gets the automations of a new deal (see
-- handle_deal_after_write, handle_deal_automessages). Runs with the caller's
-- rights: only a lead the employee sees.
CREATE OR REPLACE FUNCTION "public"."accept_unsorted"("lead_deal_id" bigint, "target_stage_id" bigint DEFAULT NULL::bigint, "target_sales_id" bigint DEFAULT NULL::bigint) RETURNS bigint
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  lead_row public.deals;
  stage_row public.stages;
  responsible bigint := target_sales_id;
begin
  select * into lead_row from public.deals d
  where d.id = lead_deal_id and d.organization_id = private.current_organization_id();
  if not found then
    raise exception 'Сделка не найдена' using errcode = 'P0002';
  end if;
  if lead_row.unsorted_at is null then
    raise exception 'Заявка уже разобрана' using errcode = 'check_violation', hint = 'deal_not_unsorted';
  end if;
  if target_stage_id is null then
    select * into stage_row from public.stages s
    where s.pipeline_id = lead_row.pipeline_id and s.kind = 'open'
    order by s.position, s.id
    limit 1;
  else
    select * into stage_row from public.stages s
    where s.id = target_stage_id and s.organization_id = lead_row.organization_id;
  end if;
  if stage_row.id is null or stage_row.kind <> 'open' then
    raise exception 'Выберите этап в работе' using errcode = 'check_violation', hint = 'unsorted_stage_not_open';
  end if;
  if responsible is null then
    responsible := coalesce(lead_row.sales_id, private.next_responsible(lead_row.organization_id));
  elsif not exists (
    select 1 from public.sales s
    where s.organization_id = lead_row.organization_id and s.id = responsible and not s.disabled
  ) then
    raise exception 'Сотрудник не найден' using errcode = 'check_violation', hint = 'unsorted_sales_unknown';
  end if;
  update public.deals d
  set unsorted_at = null,
      pipeline_id = stage_row.pipeline_id,
      stage_id = stage_row.id,
      sales_id = responsible,
      stage_changed_at = now()
  where d.id = lead_row.id;
  return lead_row.id;
end;
$$;

-- «Отклонить»: the lead is closed as lost, reason «Спам / не целевое», and
-- its open tasks (a missed call...) are done. Caller's rights.
CREATE OR REPLACE FUNCTION "public"."reject_unsorted"("lead_deal_id" bigint, "comment" "text" DEFAULT NULL::"text") RETURNS bigint
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  lead_row public.deals;
  lost_stage_id bigint;
begin
  select * into lead_row from public.deals d
  where d.id = lead_deal_id and d.organization_id = private.current_organization_id();
  if not found then
    raise exception 'Сделка не найдена' using errcode = 'P0002';
  end if;
  if lead_row.unsorted_at is null then
    raise exception 'Заявка уже разобрана' using errcode = 'check_violation', hint = 'deal_not_unsorted';
  end if;
  select s.id into lost_stage_id from public.stages s
  where s.pipeline_id = lead_row.pipeline_id and s.kind = 'lost'
  order by s.position, s.id
  limit 1;
  update public.deals d
  set unsorted_at = null,
      stage_id = lost_stage_id,
      lost_reason_id = private.spam_lost_reason(),
      lost_comment = nullif(btrim(reject_unsorted.comment), '')
  where d.id = lead_row.id;
  update public.tasks t
  set done_date = now()
  where t.organization_id = lead_row.organization_id and t.deal_id = lead_row.id and t.done_date is null;
  return lead_row.id;
end;
$$;

-- «Объединить с…»: the lead's messages, calls, notes, tasks, payments and
-- requests go to an open deal (of the same patient or another one), then
-- the lead is deleted. When the lead's patient is another person with no
-- deal left, it is merged into the deal's patient (its chats and phones go
-- there, so the next messages reach that deal). Both deals must be visible
-- to the employee.
CREATE OR REPLACE FUNCTION "public"."merge_unsorted"("lead_deal_id" bigint, "target_deal_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  org_id bigint := private.current_organization_id();
  lead_row public.deals;
  target_row public.deals;
  merged_patient_id bigint;
begin
  -- The integrator (stage 25) only reads the deals
  if org_id is null or private.current_user_role() = 'integrator' then
    raise exception 'Нет доступа' using errcode = '42501';
  end if;
  select * into lead_row from public.deals d
  where d.organization_id = org_id and d.id = lead_deal_id
  for update;
  select * into target_row from public.deals d
  where d.organization_id = org_id and d.id = target_deal_id
  for update;
  if not private.deal_visible(lead_row) or not private.deal_visible(target_row) then
    raise exception 'Сделка не найдена' using errcode = 'P0002';
  end if;
  if lead_row.unsorted_at is null then
    raise exception 'Заявка уже разобрана' using errcode = 'check_violation', hint = 'deal_not_unsorted';
  end if;
  if target_row.id = lead_row.id or target_row.archived_at is not null
    or (select s.kind from public.stages s where s.id = target_row.stage_id) <> 'open' then
    raise exception 'Выберите открытую сделку' using errcode = 'check_violation', hint = 'unsorted_merge_target';
  end if;

  update public.messages m set deal_id = target_row.id, patient_id = target_row.patient_id
  where m.organization_id = org_id and m.deal_id = lead_row.id;
  update public.calls c set deal_id = target_row.id, patient_id = target_row.patient_id
  where c.organization_id = org_id and c.deal_id = lead_row.id;
  update public.deal_notes n set deal_id = target_row.id
  where n.organization_id = org_id and n.deal_id = lead_row.id;
  update public.tasks t set deal_id = target_row.id, sales_id = coalesce(t.sales_id, target_row.sales_id)
  where t.organization_id = org_id and t.deal_id = lead_row.id;
  update public.deal_payments p set deal_id = target_row.id
  where p.organization_id = org_id and p.deal_id = lead_row.id;
  update public.lead_submissions s set deal_id = target_row.id, patient_id = target_row.patient_id
  where s.organization_id = org_id and s.deal_id = lead_row.id;
  update public.notifications n set deal_id = target_row.id, patient_id = target_row.patient_id
  where n.organization_id = org_id and n.deal_id = lead_row.id;
  update public.mailing_messages m set deal_id = target_row.id
  where m.organization_id = org_id and m.deal_id = lead_row.id;
  update public.external_refs r set entity_id = target_row.id
  where r.organization_id = org_id and r.entity = 'deal' and r.entity_id = lead_row.id;
  update public.deals d set updated_at = now()
  where d.organization_id = org_id and d.id = target_row.id;

  delete from public.deals d where d.organization_id = org_id and d.id = lead_row.id;

  if lead_row.patient_id <> target_row.patient_id and not exists (
    select 1 from public.deals d
    where d.organization_id = org_id and d.patient_id = lead_row.patient_id
  ) then
    perform private.merge_patient_rows(org_id, target_row.patient_id, lead_row.patient_id, '{}'::jsonb);
    merged_patient_id := lead_row.patient_id;
  end if;

  return jsonb_build_object('deal_id', target_row.id, 'patient_id', target_row.patient_id,
    'merged_patient_id', merged_patient_id);
end;
$$;

-- The «Неразобранное» column: unsorted leads with where they came from and
-- what they said first (the first incoming message, else the form, else the
-- call). Caller's rights.
create or replace view public.unsorted_leads with (security_invoker = on) as
select
    d.id,
    d.organization_id,
    d.patient_id,
    d.pipeline_id,
    d.stage_id,
    d.source_id,
    d.sales_id,
    d.name,
    d.unsorted_at,
    p.first_name as patient_first_name,
    p.last_name as patient_last_name,
    p.phones[1] as patient_phone,
    f.channel,
    f.first_text,
    f.first_at,
    (
        select count(*)
        from public.messages m
        where m.organization_id = d.organization_id and m.deal_id = d.id and m.direction = 'in'
    ) as nb_messages
from public.deals d
    join public.patients p on p.organization_id = d.organization_id and p.id = d.patient_id
    left join lateral (
        select x.channel, x.first_text, x.first_at
        from (
            select m.transport as channel, m.text as first_text, m.sent_at as first_at, 0 as rank
            from public.messages m
            where m.organization_id = d.organization_id and m.deal_id = d.id and m.direction = 'in'
            union all
            select 'form', n.text, n.date, 1
            from public.deal_notes n
            where n.organization_id = d.organization_id and n.deal_id = d.id and n.type = 'lead'
            union all
            select 'call', null, c.called_at, 2
            from public.calls c
            where c.organization_id = d.organization_id and c.deal_id = d.id and c.direction = 'in'
        ) x
        order by x.first_at, x.rank
        limit 1
    ) f on true
where d.unsorted_at is not null;

--
-- Duplicates
--

-- «Иванов  Иван Ёлкин» -> «иванов иван елкин»
CREATE OR REPLACE FUNCTION "private"."normalize_person_name"("last_name" "text", "first_name" "text", "middle_name" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select nullif(translate(lower(regexp_replace(btrim(concat_ws(' ',
    nullif(btrim(last_name), ''), nullif(btrim(first_name), ''), nullif(btrim(middle_name), ''))),
    '\s+', ' ', 'g')), 'ё', 'е'), '')
$$;

-- What identifies a patient of a clinic (only_patient_id: one patient):
--   phone       a normalized number;
--   chat        a Telegram or Instagram chat id or username (the patient's
--               handles and chats; Telegram through Wazzup24 and the
--               clinic's bot are one messenger);
--   name_birth  full name (last and first name at least) and birth date.
-- Runs with the caller's rights (RLS of patients and patient_chats).
CREATE OR REPLACE FUNCTION "private"."patient_match_keys"("org_id" bigint, "only_patient_id" bigint DEFAULT NULL::bigint) RETURNS TABLE("patient_id" bigint, "kind" "text", "match_key" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select p.id, 'phone', n.number
  from public.patients p
    cross join lateral unnest(p.phones) as n(number)
  where p.organization_id = org_id and (only_patient_id is null or p.id = only_patient_id)
  union
  select p.id, 'chat', 'tg:' || lower(btrim(p.telegram))
  from public.patients p
  where p.organization_id = org_id and (only_patient_id is null or p.id = only_patient_id)
    and nullif(btrim(p.telegram), '') is not null
  union
  select p.id, 'chat', 'ig:' || lower(btrim(p.instagram))
  from public.patients p
  where p.organization_id = org_id and (only_patient_id is null or p.id = only_patient_id)
    and nullif(btrim(p.instagram), '') is not null
  union
  select c.patient_id, 'chat',
    case when c.transport = 'instagram' then 'igid:' else 'tgid:' end || c.chat_id
  from public.patient_chats c
  where c.organization_id = org_id and (only_patient_id is null or c.patient_id = only_patient_id)
    and c.transport in ('instagram', 'telegram', 'telegram_bot')
  union
  select c.patient_id, 'chat',
    case when c.transport = 'instagram' then 'ig:' else 'tg:' end || lower(ltrim(btrim(c.username), '@'))
  from public.patient_chats c
  where c.organization_id = org_id and (only_patient_id is null or c.patient_id = only_patient_id)
    and c.transport in ('instagram', 'telegram', 'telegram_bot')
    and nullif(ltrim(btrim(c.username), '@'), '') is not null
  union
  select p.id, 'name_birth',
    private.normalize_person_name(p.last_name, p.first_name, p.middle_name) || '|' || p.birth_date::text
  from public.patients p
  where p.organization_id = org_id and (only_patient_id is null or p.id = only_patient_id)
    and p.birth_date is not null
    and nullif(btrim(p.last_name), '') is not null
    and nullif(btrim(p.first_name), '') is not null
$$;

-- Possible duplicates of a patient, with what they share (phone, chat,
-- name_birth). Caller's rights.
CREATE OR REPLACE FUNCTION "public"."patient_duplicates"("target_patient_id" bigint) RETURNS TABLE("patient_id" bigint, "reasons" "text"[], "first_name" "text", "last_name" "text", "middle_name" "text", "birth_date" "date", "phones" "text"[])
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  with target as (
    select p.organization_id from public.patients p where p.id = target_patient_id
  ),
  mine as (
    select k.kind, k.match_key
    from target t
      cross join lateral private.patient_match_keys(t.organization_id, target_patient_id) k
  ),
  matches as (
    select k.patient_id, array_agg(distinct k.kind order by k.kind) as reasons
    from target t
      cross join lateral private.patient_match_keys(t.organization_id) k
      join mine on mine.kind = k.kind and mine.match_key = k.match_key
    where k.patient_id <> target_patient_id
    group by k.patient_id
  )
  select p.id, m.reasons, p.first_name, p.last_name, p.middle_name, p.birth_date, p.phones
  from matches m
    join public.patients p on p.id = m.patient_id
  order by p.last_seen desc, p.id
$$;

-- Groups of possible duplicates of the current clinic: patients linked by a
-- shared phone, chat or name and birth date, directly or through another
-- one of the group (group_id: the smallest patient id of the group).
-- Caller's rights: counts only the deals the employee sees.
CREATE OR REPLACE FUNCTION "public"."duplicate_groups"() RETURNS TABLE("group_id" bigint, "patient_id" bigint, "reasons" "text"[], "first_name" "text", "last_name" "text", "middle_name" "text", "birth_date" "date", "phones" "text"[], "last_seen" timestamp with time zone, "nb_deals" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  with recursive keys as (
    select k.patient_id, k.kind, k.match_key
    from private.patient_match_keys(private.current_organization_id()) k
  ),
  pairs as (
    select distinct a.patient_id as a, b.patient_id as b, a.kind
    from keys a
      join keys b on b.kind = a.kind and b.match_key = a.match_key and b.patient_id <> a.patient_id
  ),
  reach (root, patient_id) as (
    select distinct pr.a, pr.a from pairs pr
    union
    select r.root, pr.b
    from reach r
      join pairs pr on pr.a = r.patient_id
  ),
  groups as (
    select r.patient_id, min(r.root) as group_id
    from reach r
    group by r.patient_id
  ),
  reasons as (
    select pr.a as patient_id, array_agg(distinct pr.kind order by pr.kind) as reasons
    from pairs pr
    group by pr.a
  )
  select g.group_id, p.id, rs.reasons, p.first_name, p.last_name, p.middle_name, p.birth_date,
    p.phones, p.last_seen,
    (
      select count(*)
      from public.deals d
      where d.organization_id = p.organization_id and d.patient_id = p.id
    ) as nb_deals
  from groups g
    join reasons rs on rs.patient_id = g.patient_id
    join public.patients p on p.id = g.patient_id
  order by g.group_id, p.id
$$;

-- Merges patient merge_id into keep_id (no rights check: callers check).
-- field_choices: { name, birth_date, source, responsible, comment } ->
-- 'keep' | 'merge'; a missing choice keeps the kept patient's value, or the
-- other one's when the kept one is empty. Phones, tags and chats are
-- unioned, the other details are completed. Every row referencing the
-- merged patient moves (composite foreign keys (organization_id, <column>)
-- to patients, whatever the table, and external_refs), then it is deleted
-- and the merge is written to the audit log.
CREATE OR REPLACE FUNCTION "private"."merge_patient_rows"("org_id" bigint, "keep_id" bigint, "merge_id" bigint, "field_choices" "jsonb") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  keep_row public.patients;
  merge_row public.patients;
  choices jsonb := coalesce(field_choices, '{}'::jsonb);
  take_name boolean;
  take_birth boolean;
  take_source boolean;
  take_sales boolean;
  take_comment boolean;
  reference record;
  actor record;
  merged_label text;
begin
  if keep_id is not distinct from merge_id then
    raise exception 'Выберите двух разных пациентов' using errcode = '22023';
  end if;
  select * into keep_row from public.patients p
  where p.organization_id = org_id and p.id = keep_id
  for update;
  select * into merge_row from public.patients p
  where p.organization_id = org_id and p.id = merge_id
  for update;
  if keep_row.id is null or merge_row.id is null then
    raise exception 'Пациент не найден' using errcode = 'P0002';
  end if;

  take_name := case choices ->> 'name' when 'merge' then true when 'keep' then false
    else private.normalize_person_name(keep_row.last_name, keep_row.first_name, keep_row.middle_name) is null end;
  take_birth := case choices ->> 'birth_date' when 'merge' then true when 'keep' then false
    else keep_row.birth_date is null end;
  take_source := case choices ->> 'source' when 'merge' then true when 'keep' then false
    else keep_row.source_id is null end;
  take_sales := case choices ->> 'responsible' when 'merge' then true when 'keep' then false
    else keep_row.sales_id is null end;
  take_comment := case choices ->> 'comment' when 'merge' then true when 'keep' then false
    else nullif(btrim(keep_row.background), '') is null end;
  merged_label := coalesce(nullif(btrim(concat_ws(' ', merge_row.last_name, merge_row.first_name)), ''),
    merge_row.phones[1], 'Пациент') || ' (#' || merge_row.id || ')';

  -- A mailing reaches a patient once: the merged patient's row goes when
  -- the kept one has its own
  delete from public.mailing_messages m
  where m.organization_id = org_id and m.patient_id = merge_id and m.mailing_id is not null
    and exists (
      select 1 from public.mailing_messages k
      where k.mailing_id = m.mailing_id and k.patient_id = keep_id
    );

  for reference in
    select c.conrelid::regclass as table_name, a.attname as column_name
    from pg_catalog.pg_constraint c
      join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f'
      and c.confrelid = 'public.patients'::regclass
      and cardinality(c.conkey) = 2
      and a.attname <> 'organization_id'
    order by 1, 2
  loop
    execute format('update %s set %I = $1 where organization_id = $2 and %I = $3',
      reference.table_name, reference.column_name, reference.column_name)
    using keep_id, org_id, merge_id;
  end loop;
  update public.external_refs r set entity_id = keep_id
  where r.organization_id = org_id and r.entity = 'patient' and r.entity_id = merge_id;

  delete from public.patients p where p.organization_id = org_id and p.id = merge_id;

  update public.patients p
  set first_name = case when take_name then merge_row.first_name else keep_row.first_name end,
      last_name = case when take_name then merge_row.last_name else keep_row.last_name end,
      middle_name = case when take_name then merge_row.middle_name else keep_row.middle_name end,
      birth_date = case when take_birth then merge_row.birth_date else keep_row.birth_date end,
      source_id = case when take_source then merge_row.source_id else keep_row.source_id end,
      sales_id = case when take_sales then merge_row.sales_id else keep_row.sales_id end,
      background = case when take_comment then merge_row.background else keep_row.background end,
      phone_jsonb = keep_row.phone_jsonb || coalesce((
        select jsonb_agg(e)
        from jsonb_array_elements(merge_row.phone_jsonb) as e
        where not (keep_row.phones @> array[private.normalize_phone(e ->> 'number')])
      ), '[]'::jsonb),
      whatsapp = coalesce(keep_row.whatsapp, merge_row.whatsapp),
      instagram = coalesce(keep_row.instagram, merge_row.instagram),
      telegram = coalesce(keep_row.telegram, merge_row.telegram),
      city = coalesce(nullif(btrim(keep_row.city), ''), merge_row.city),
      gender = coalesce(keep_row.gender, merge_row.gender),
      avatar = coalesce(keep_row.avatar, merge_row.avatar),
      status = coalesce(keep_row.status, merge_row.status),
      tags = keep_row.tags || array(
        select t from unnest(merge_row.tags) as t where t <> all(keep_row.tags)
      ),
      first_seen = least(keep_row.first_seen, merge_row.first_seen),
      last_seen = greatest(keep_row.last_seen, merge_row.last_seen),
      messaging_opt_out = keep_row.messaging_opt_out or merge_row.messaging_opt_out,
      messaging_opt_out_at = coalesce(keep_row.messaging_opt_out_at, merge_row.messaging_opt_out_at)
  where p.organization_id = org_id and p.id = keep_id;

  select * into actor from private.audit_actor(org_id);
  insert into public.audit_log (organization_id, sales_id, source, entity, entity_id, action, changes, patient_id)
  select org_id, actor.actor_id, actor.actor_source, 'patient', keep_id, 'merge',
    jsonb_build_object(
      'merged_patient_id', jsonb_build_array(merge_id, keep_id),
      'merged_patient', jsonb_build_array(merged_label,
        coalesce(nullif(btrim(concat_ws(' ', p.last_name, p.first_name)), ''), p.phones[1], 'Пациент')
          || ' (#' || p.id || ')')
    ),
    keep_id
  from public.patients p
  where p.organization_id = org_id and p.id = keep_id;
  return keep_id;
end;
$$;

-- Merge of two patients of the clinic (owner and head)
CREATE OR REPLACE FUNCTION "public"."merge_patients"("keep_id" bigint, "merge_id" bigint, "field_choices" "jsonb" DEFAULT '{}'::"jsonb") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  org_id bigint := private.current_organization_id();
begin
  if org_id is null or private.current_user_role() not in ('owner', 'head') then
    raise exception 'Объединять пациентов могут владелец и руководитель' using errcode = '42501';
  end if;
  return private.merge_patient_rows(org_id, keep_id, merge_id, field_choices);
end;
$$;

--
-- Grants
--

grant all on table public.unsorted_leads to anon;
grant all on table public.unsorted_leads to authenticated;
grant all on table public.unsorted_leads to service_role;

revoke all on function private.unsorted_intake(bigint, bigint) from public;
grant execute on function private.unsorted_intake(bigint, bigint) to service_role;
revoke all on function private.spam_lost_reason() from public;
grant execute on function private.spam_lost_reason() to authenticated, service_role;
revoke all on function private.deal_visible(public.deals) from public;
grant execute on function private.deal_visible(public.deals) to service_role;
revoke all on function private.merge_patient_rows(bigint, bigint, bigint, jsonb) from public;
grant execute on function private.merge_patient_rows(bigint, bigint, bigint, jsonb) to service_role;
revoke all on function private.normalize_person_name(text, text, text) from public;
grant execute on function private.normalize_person_name(text, text, text) to authenticated, service_role;
revoke all on function private.patient_match_keys(bigint, bigint) from public;
grant execute on function private.patient_match_keys(bigint, bigint) to authenticated, service_role;

revoke all on function public.accept_unsorted(bigint, bigint, bigint) from public, anon;
grant execute on function public.accept_unsorted(bigint, bigint, bigint) to authenticated, service_role;
revoke all on function public.reject_unsorted(bigint, text) from public, anon;
grant execute on function public.reject_unsorted(bigint, text) to authenticated, service_role;
revoke all on function public.merge_unsorted(bigint, bigint) from public, anon;
grant execute on function public.merge_unsorted(bigint, bigint) to authenticated, service_role;
revoke all on function public.patient_duplicates(bigint) from public, anon;
grant execute on function public.patient_duplicates(bigint) to authenticated, service_role;
revoke all on function public.duplicate_groups() from public, anon;
grant execute on function public.duplicate_groups() to authenticated, service_role;
revoke all on function public.merge_patients(bigint, bigint, jsonb) from public, anon;
grant execute on function public.merge_patients(bigint, bigint, jsonb) to authenticated, service_role;

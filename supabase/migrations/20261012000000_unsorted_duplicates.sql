--
-- «Неразобранное» (incoming leads to accept or reject) and duplicate
-- patients (stage 18). See supabase/schemas/18_unsorted_duplicates.sql.
--
-- deals.unsorted_at is declared in 13_doctors.sql (deals_summary shows it);
-- the ingest functions, the deal triggers, deals_waiting and the response
-- alerts learn about unsorted leads; the audit log of the clinic settings
-- logs the new settings.
--

-- A new lead of a system channel waiting in «Неразобранное» since this time
alter table public.deals add column unsorted_at timestamp with time zone;

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
  if org_id is null then
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

--
-- Existing functions and views that learn about unsorted leads
--

-- Defaults, stage rules and maintained columns
CREATE OR REPLACE FUNCTION "public"."handle_deal_before_write"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  new_kind text;
  old_kind text;
  stage_changed boolean;
begin
  if tg_op = 'INSERT' then
    if new.pipeline_id is null then
      select p.id into new.pipeline_id
      from public.pipelines p
      where p.organization_id = new.organization_id
      order by p.is_default desc, p.position, p.id
      limit 1;
    end if;
    if new.stage_id is null then
      select s.id into new.stage_id
      from public.stages s
      where s.pipeline_id = new.pipeline_id
      order by s.position, s.id
      limit 1;
    end if;
    new.paid_amount := 0;
    new.stage_changed_at := now();
    -- A lead coming from outside (no user) is distributed by the clinic
    -- rules; an unsorted one (18_unsorted_duplicates.sql) waits to be accepted
    if new.sales_id is null and auth.uid() is null and new.unsorted_at is null
      and current_setting('crm.importing', true) is distinct from 'on' then
      new.sales_id := private.next_responsible(new.organization_id);
    end if;
  else
    new.created_at := old.created_at;
    -- paid_amount is the total of the payments, only their trigger writes it
    if current_setting('crm.sync_paid_amount', true) is distinct from 'on' then
      new.paid_amount := old.paid_amount;
    end if;
    -- A deal never goes back to «Неразобранное»; moving an unsorted lead to
    -- a stage accepts it (see public.accept_unsorted)
    if old.unsorted_at is null
      or new.stage_id is distinct from old.stage_id
      or new.pipeline_id is distinct from old.pipeline_id then
      new.unsorted_at := null;
    end if;
    if (to_jsonb(new) - 'index' - 'updated_at') is distinct from (to_jsonb(old) - 'index' - 'updated_at') then
      new.updated_at := now();
    end if;
    -- Moved to another pipeline: to its first stage, unless the clinic lets
    -- employees choose the stage (organization_settings.pipeline_move_mode)
    -- or an unsorted lead is accepted into a chosen stage
    if new.pipeline_id is distinct from old.pipeline_id and old.unsorted_at is null and coalesce((
      select os.pipeline_move_mode from public.organization_settings os
      where os.organization_id = new.organization_id
    ), 'first_stage') = 'first_stage' then
      select s.id into new.stage_id
      from public.stages s
      where s.pipeline_id = new.pipeline_id
      order by s.position, s.id
      limit 1;
    end if;
  end if;

  select s.kind into new_kind from public.stages s where s.id = new.stage_id;
  stage_changed := tg_op = 'INSERT'
    or new.stage_id is distinct from old.stage_id
    or new.pipeline_id is distinct from old.pipeline_id;

  if tg_op = 'UPDATE' and stage_changed then
    select s.kind into old_kind from public.stages s where s.id = old.stage_id;
    if old_kind = 'lost' then
      raise exception 'Сделка в отказе не возвращается в работу. Для повторного обращения создайте новую сделку.'
        using errcode = 'check_violation', hint = 'deal_lost_locked';
    end if;
    -- The checklist of the stage blocks moving forward (refusing is always
    -- possible; an import moves deals to the stage of the file)
    if new.pipeline_id = old.pipeline_id and new_kind is distinct from 'lost'
      and current_setting('crm.importing', true) is distinct from 'on'
      and old.unsorted_at is null
      and (select s.position from public.stages s where s.id = new.stage_id)
        > (select s.position from public.stages s where s.id = old.stage_id)
      and exists (
        select 1 from public.stage_checklist_items i
        where i.stage_id = old.stage_id
          and not exists (
            select 1 from public.deal_checklist_checks c
            where c.deal_id = old.id and c.item_id = i.id
          )
      )
    then
      raise exception 'Выполните чек-лист этапа «%»', (select s.name from public.stages s where s.id = old.stage_id)
        using errcode = 'check_violation', hint = 'stage_checklist_incomplete';
    end if;
  end if;

  if new_kind = 'lost' and new.lost_reason_id is null then
    raise exception 'Укажите причину отказа'
      using errcode = 'check_violation', hint = 'lost_reason_required';
  end if;

  if stage_changed then
    new.stage_changed_at := now();
    new.closed_at := case when new_kind in ('won', 'lost') then now() else null end;
  end if;

  return new;
end;
$$;

-- Deal log and first source of the patient
CREATE OR REPLACE FUNCTION "public"."handle_deal_after_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  tracked text[] := array[
    'name', 'patient_id', 'pipeline_id', 'sales_id', 'source_id', 'service_id',
    'plan_amount', 'paid_amount', 'lost_reason_id', 'lost_comment',
    'appointment_at', 'visit_at', 'tags', 'archived_at',
    'doctor_id', 'consultation_amount', 'unsorted_at'
  ];
  field text;
  old_json jsonb;
  new_json jsonb;
  changes jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.deal_events (organization_id, deal_id, type, to_stage_id, sales_id)
    values (new.organization_id, new.id, 'created', new.stage_id, private.current_sales_id());

    if new.source_id is not null then
      update public.patients
      set source_id = new.source_id
      where organization_id = new.organization_id
        and id = new.patient_id
        and source_id is null;
    end if;
    if new.sales_id is not null then
      update public.patients
      set sales_id = new.sales_id
      where organization_id = new.organization_id
        and id = new.patient_id
        and sales_id is null;
    end if;
    -- An unsorted lead gets its automatic tasks when it is accepted
    if new.unsorted_at is null then
      perform private.create_rule_tasks(new, 'deal_created', null);
      perform private.create_rule_tasks(new, 'stage_entered', new.stage_id);
    end if;
    return null;
  end if;

  -- A responsible assigned later (first answer, by hand) takes the
  -- unassigned open tasks of the deal
  if new.sales_id is not null and old.sales_id is null then
    update public.tasks
    set sales_id = new.sales_id
    where organization_id = new.organization_id and deal_id = new.id
      and sales_id is null and done_date is null;
    update public.patients
    set sales_id = new.sales_id
    where organization_id = new.organization_id
      and id = new.patient_id
      and sales_id is null;
  end if;
  if old.unsorted_at is not null then
    -- An unsorted lead accepted into an open stage starts like a new deal;
    -- a rejected one (lost stage) gets nothing
    if new.unsorted_at is null
      and (select s.kind from public.stages s where s.id = new.stage_id) = 'open' then
      perform private.create_rule_tasks(new, 'deal_created', null);
      perform private.create_rule_tasks(new, 'stage_entered', new.stage_id);
    end if;
  elsif new.stage_id is distinct from old.stage_id then
    perform private.create_rule_tasks(new, 'stage_entered', new.stage_id);
  end if;

  old_json := to_jsonb(old);
  new_json := to_jsonb(new);
  foreach field in array tracked loop
    if old_json -> field is distinct from new_json -> field then
      changes := changes || jsonb_build_object(field, jsonb_build_array(old_json -> field, new_json -> field));
    end if;
  end loop;

  if new.stage_id is distinct from old.stage_id then
    insert into public.deal_events (organization_id, deal_id, type, from_stage_id, to_stage_id, changes, sales_id)
    values (new.organization_id, new.id, 'stage_changed', old.stage_id, new.stage_id, changes, private.current_sales_id());
  elsif changes <> '{}'::jsonb then
    insert into public.deal_events (organization_id, deal_id, type, changes, sales_id)
    values (new.organization_id, new.id, 'updated', changes, private.current_sales_id());
  end if;
  return null;
end;
$$;

-- A message received from Wazzup24 (edge function wazzup_webhook, service role),
-- in a provider-neutral shape:
--   { channel_id, transport, chat_id, external_id, direction, text,
--     content_uri, content_type, sent_at, contact: { name, phone, username } }
-- Finds the patient (WhatsApp by phone, Instagram and Telegram by chat id) or
-- creates one, attaches the message to the patient's most recently updated
-- open deal or opens a new deal, and ignores a message already received.
-- telegram_bot messages (the clinic's own bot, public.ingest_telegram_message)
-- carry the bot's webhook token instead of the Wazzup24 one.
CREATE OR REPLACE FUNCTION "public"."ingest_message"("webhook_token" "text", "message" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  org_id bigint;
  msg_transport text := message ->> 'transport';
  msg_chat_id text := nullif(btrim(message ->> 'chat_id'), '');
  msg_external_id text := nullif(btrim(message ->> 'external_id'), '');
  msg_direction text := coalesce(message ->> 'direction', 'in');
  contact jsonb := coalesce(message -> 'contact', '{}'::jsonb);
  contact_phone text;
  contact_name text;
  source_id bigint;
  found_message public.messages;
  new_channel_id bigint;
  found_patient_id bigint;
  found_deal_id bigint;
  new_message_id bigint;
  created_patient boolean := false;
  created_deal boolean := false;
begin
  if msg_transport = 'telegram_bot' then
    select b.organization_id into org_id
    from public.telegram_bots b
    where b.webhook_token = ingest_message.webhook_token;
  else
    select i.organization_id into org_id
    from public.messenger_integrations i
    where i.webhook_token = ingest_message.webhook_token;
  end if;
  if org_id is null then
    raise exception 'Unknown webhook token' using errcode = '28000';
  end if;
  if msg_transport is null or msg_transport not in ('whatsapp', 'instagram', 'telegram', 'telegram_bot')
    or msg_chat_id is null or msg_direction not in ('in', 'out') then
    raise exception 'Unsupported message' using errcode = '22023';
  end if;

  -- Webhooks are retried: a message is stored once
  if msg_external_id is not null then
    select * into found_message from public.messages m
    where m.organization_id = org_id and m.external_id = msg_external_id;
    if found then
      return jsonb_build_object('message_id', found_message.id, 'patient_id', found_message.patient_id,
        'deal_id', found_message.deal_id, 'duplicate', true);
    end if;
  end if;

  if nullif(btrim(message ->> 'channel_id'), '') is not null then
    insert into public.messenger_channels (organization_id, external_id, transport)
    values (org_id, btrim(message ->> 'channel_id'), msg_transport)
    on conflict (organization_id, external_id) do update set transport = excluded.transport
    returning id into new_channel_id;
  end if;

  select s.id into source_id from public.lead_sources s
  where s.organization_id = org_id
    and s.code = case when msg_transport = 'telegram_bot' then 'telegram' else msg_transport end;

  -- The patient: known chat, else (WhatsApp) the phone number, else a new one
  select c.patient_id into found_patient_id from public.patient_chats c
  where c.organization_id = org_id and c.transport = msg_transport and c.chat_id = msg_chat_id;
  if msg_transport = 'whatsapp' then
    contact_phone := private.normalize_phone(coalesce(nullif(btrim(contact ->> 'phone'), ''), msg_chat_id));
  end if;
  if found_patient_id is null and contact_phone is not null then
    select p.id into found_patient_id from public.patients p
    where p.organization_id = org_id and p.phones @> array[contact_phone]
    order by p.last_seen desc, p.id desc
    limit 1;
  end if;
  if found_patient_id is null then
    contact_name := coalesce(
      nullif(btrim(contact ->> 'name'), ''),
      nullif(btrim(contact ->> 'username'), ''),
      contact_phone,
      msg_chat_id
    );
    insert into public.patients (organization_id, first_name, phone_jsonb, whatsapp, instagram, telegram, source_id)
    values (
      org_id,
      contact_name,
      case when contact_phone is not null
        then jsonb_build_array(jsonb_build_object('number', contact_phone, 'type', 'mobile'))
        else '[]'::jsonb end,
      contact_phone,
      case when msg_transport = 'instagram' then coalesce(nullif(btrim(contact ->> 'username'), ''), msg_chat_id) end,
      case when msg_transport in ('telegram', 'telegram_bot') then nullif(btrim(contact ->> 'username'), '') end,
      source_id
    )
    returning id into found_patient_id;
    created_patient := true;
  end if;
  insert into public.patient_chats (organization_id, patient_id, transport, chat_id, username)
  values (org_id, found_patient_id, msg_transport, msg_chat_id, nullif(btrim(contact ->> 'username'), ''))
  on conflict (organization_id, transport, chat_id) do nothing;

  -- The deal: the most recently updated open one, else a new request
  select d.id into found_deal_id
  from public.deals d
    join public.stages s on s.id = d.stage_id
  where d.organization_id = org_id and d.patient_id = found_patient_id
    and s.kind = 'open' and d.archived_at is null
  order by d.updated_at desc, d.id desc
  limit 1;
  if found_deal_id is null then
    -- A patient's message may open an unsorted lead (clinic setting)
    insert into public.deals (organization_id, patient_id, source_id, unsorted_at)
    values (org_id, found_patient_id, source_id,
      case when msg_direction = 'in' then private.unsorted_intake(org_id, source_id) end)
    returning id into found_deal_id;
    created_deal := true;
  end if;

  insert into public.messages (
    organization_id, patient_id, deal_id, channel_id, transport, chat_id, direction,
    text, content_uri, content_type, status, external_id, sent_at
  ) values (
    org_id, found_patient_id, found_deal_id, new_channel_id, msg_transport, msg_chat_id, msg_direction,
    message ->> 'text',
    nullif(message ->> 'content_uri', ''),
    coalesce(nullif(message ->> 'content_type', ''), 'text'),
    case when msg_direction = 'in' then 'inbound' else 'sent' end,
    msg_external_id,
    coalesce((message ->> 'sent_at')::timestamp with time zone, now())
  )
  returning id into new_message_id;

  update public.patients set last_seen = now()
  where organization_id = org_id and id = found_patient_id;

  return jsonb_build_object('message_id', new_message_id, 'patient_id', found_patient_id,
    'deal_id', found_deal_id, 'created_patient', created_patient, 'created_deal', created_deal,
    'duplicate', false);
end;
$$;

-- Deal trigger: entering a stage queues its messages, leaving it cancels
-- them, moving the visit reschedules the "before the visit" ones
CREATE OR REPLACE FUNCTION "private"."handle_deal_automessages"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  -- Imported deals (crm.importing, see import_batch) get no auto-messages
  if current_setting('crm.importing', true) = 'on' then
    return null;
  end if;
  -- Unsorted leads (18_unsorted_duplicates.sql) get no auto-messages until
  -- they are accepted into an open stage
  if tg_op = 'INSERT' then
    if new.unsorted_at is null then
      perform private.schedule_automessages(new);
    end if;
    return null;
  end if;
  if old.unsorted_at is not null then
    if new.unsorted_at is null
      and (select s.kind from public.stages s where s.id = new.stage_id) = 'open' then
      perform private.schedule_automessages(new);
    end if;
    return null;
  end if;
  if new.stage_id is distinct from old.stage_id then
    perform private.cancel_automessages(new.organization_id, new.id, array['pending', 'awaiting'], null,
      'Сделка ушла с этапа');
    perform private.schedule_automessages(new);
  elsif new.archived_at is not null and old.archived_at is null then
    perform private.cancel_automessages(new.organization_id, new.id, array['pending', 'awaiting'], null,
      'Сделка в архиве');
  elsif new.appointment_at is distinct from old.appointment_at then
    perform private.cancel_automessages(new.organization_id, new.id, array['pending'], 'before_visit',
      'Дата визита изменилась');
    perform private.schedule_automessages(new, 'before_visit');
  end if;
  return null;
end;
$$;

-- A request from a website form, Tilda or 2GIS (edge function leads_webhook,
-- service role):
--   { name, phone, source, service, comment, utm: { utm_source, ... } }
-- source is a code or a name of the clinic's sources (default: website),
-- service a name of its services (case-insensitive). Finds the patient by
-- phone or creates one, attaches the request to the patient's most recently
-- updated open deal or opens a new deal (distributed by the clinic rules, with
-- its automatic tasks), and always writes the form into a note of the deal.
-- The same form sent again within 5 minutes is ignored.
CREATE OR REPLACE FUNCTION "public"."ingest_lead"("token" "text", "lead" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  org_id bigint;
  lead_name text := nullif(btrim(lead ->> 'name'), '');
  lead_phone text := private.normalize_phone(nullif(btrim(lead ->> 'phone'), ''));
  lead_source text := nullif(btrim(lead ->> 'source'), '');
  lead_service text := nullif(btrim(lead ->> 'service'), '');
  lead_comment text := nullif(btrim(lead ->> 'comment'), '');
  utm jsonb;
  payload jsonb;
  hash text;
  previous public.lead_submissions;
  found_source public.lead_sources;
  found_service_id bigint;
  found_patient_id bigint;
  found_deal_id bigint;
  created_patient boolean := false;
  created_deal boolean := false;
  note_text text;
  new_note_id bigint;
  new_submission_id bigint;
begin
  select i.organization_id into org_id
  from public.lead_integrations i
  where i.token = ingest_lead.token;
  if org_id is null then
    raise exception 'Unknown lead token' using errcode = '28000';
  end if;
  if jsonb_typeof(lead) is distinct from 'object'
    or lead_phone is null or length(lead_phone) not between 11 and 16 then
    raise exception 'A lead needs a phone number' using errcode = '22023';
  end if;

  -- UTM tags: an utm object and/or top-level utm_* fields
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into utm
  from (
    select u.key, u.value
    from jsonb_each_text(case when jsonb_typeof(lead -> 'utm') = 'object' then lead -> 'utm' else '{}'::jsonb end) as u
    union
    select u.key, u.value
    from jsonb_each_text(lead) as u
    where u.key like 'utm\_%'
  ) as e
  where nullif(btrim(e.value), '') is not null;
  payload := jsonb_strip_nulls(jsonb_build_object(
    'name', lead_name, 'phone', lead_phone, 'source', lead_source,
    'service', lead_service, 'comment', lead_comment,
    'utm', case when utm <> '{}'::jsonb then utm end
  ));
  hash := md5(payload::text);

  -- Forms are often submitted twice: the same request within 5 minutes is
  -- stored once (concurrent submissions of a phone wait for each other)
  perform pg_advisory_xact_lock(hashtextextended(org_id::text || ':' || lead_phone, 0));
  select * into previous from public.lead_submissions s
  where s.organization_id = org_id and s.phone = lead_phone and s.payload_hash = hash
    and s.created_at > now() - interval '5 minutes'
  order by s.created_at desc
  limit 1;
  if found then
    return jsonb_build_object('lead_id', previous.id, 'patient_id', previous.patient_id,
      'deal_id', previous.deal_id, 'duplicate', true);
  end if;

  select * into found_source from public.lead_sources s
  where s.organization_id = org_id
    and (lower(s.code) = lower(coalesce(lead_source, 'website')) or lower(s.name) = lower(coalesce(lead_source, 'website')))
  order by s.is_archived, s.is_system desc, s.position, s.id
  limit 1;
  if not found then
    select * into found_source from public.lead_sources s
    where s.organization_id = org_id and s.code = 'website';
  end if;

  if lead_service is not null then
    select s.id into found_service_id from public.services s
    where s.organization_id = org_id and lower(btrim(s.name)) = lower(lead_service)
    order by s.is_archived, s.position, s.id
    limit 1;
  end if;

  -- The patient: by phone, else a new one
  select p.id into found_patient_id from public.patients p
  where p.organization_id = org_id and p.phones @> array[lead_phone]
  order by p.last_seen desc, p.id desc
  limit 1;
  if found_patient_id is null then
    insert into public.patients (organization_id, first_name, phone_jsonb, source_id)
    values (
      org_id,
      coalesce(lead_name, lead_phone),
      jsonb_build_array(jsonb_build_object('number', lead_phone, 'type', 'mobile')),
      found_source.id
    )
    returning id into found_patient_id;
    created_patient := true;
  end if;

  -- The deal: the most recently updated open one, else a new request
  select d.id into found_deal_id
  from public.deals d
    join public.stages s on s.id = d.stage_id
  where d.organization_id = org_id and d.patient_id = found_patient_id
    and s.kind = 'open' and d.archived_at is null
  order by d.updated_at desc, d.id desc
  limit 1;
  if found_deal_id is null then
    insert into public.deals (organization_id, patient_id, source_id, service_id, unsorted_at)
    values (org_id, found_patient_id, found_source.id, found_service_id,
      private.unsorted_intake(org_id, found_source.id))
    returning id into found_deal_id;
    created_deal := true;
  elsif found_service_id is not null then
    update public.deals
    set service_id = found_service_id
    where organization_id = org_id and id = found_deal_id and service_id is null;
  end if;

  note_text := concat_ws(E'\n',
    case when created_deal then 'Заявка' else 'Повторная заявка' end
      || ' (' || coalesce(found_source.name, 'Сайт') || ')',
    'Имя: ' || lead_name,
    'Телефон: ' || lead_phone,
    case when lead_source is not null and lower(lead_source) not in (lower(found_source.name), lower(coalesce(found_source.code, '')))
      then 'Источник: ' || lead_source end,
    'Услуга: ' || lead_service,
    'Комментарий: ' || lead_comment,
    (select string_agg(u.key || ': ' || u.value, E'\n' order by u.key) from jsonb_each_text(utm) as u)
  );
  insert into public.deal_notes (organization_id, deal_id, type, text, date)
  values (org_id, found_deal_id, 'lead', note_text, now())
  returning id into new_note_id;

  update public.patients set last_seen = now()
  where organization_id = org_id and id = found_patient_id;

  insert into public.lead_submissions (organization_id, phone, payload_hash, payload, patient_id, deal_id)
  values (org_id, lead_phone, hash, payload, found_patient_id, found_deal_id)
  returning id into new_submission_id;

  return jsonb_build_object('lead_id', new_submission_id, 'patient_id', found_patient_id,
    'deal_id', found_deal_id, 'note_id', new_note_id, 'created_patient', created_patient,
    'created_deal', created_deal, 'duplicate', false);
end;
$$;

-- A call event received from the PBX (edge function telephony_webhook,
-- service role), in a provider-neutral shape:
--   { call_id, direction: in|out, phone, extension, started_at, duration,
--     status: in_progress|answered|missed (null: not over yet), record_url, name }
-- Events of the same call (start, end, recording) update one row. A new call
-- finds the patient by phone or creates one (source «Звонок»), goes to the
-- patient's most recently updated open deal or opens a new deal (stage 5
-- distribution and task rules apply), and maps the employee by extension.
-- A missed incoming call gives the responsible a task «Перезвонить».
CREATE OR REPLACE FUNCTION "public"."ingest_call"("webhook_token" "text", "provider" "text", "call" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  org_id bigint;
  call_provider text := lower(btrim(coalesce(ingest_call.provider, '')));
  call_external_id text := nullif(btrim(call ->> 'call_id'), '');
  call_direction text := coalesce(nullif(btrim(call ->> 'direction'), ''), 'in');
  call_status text := nullif(btrim(call ->> 'status'), '');
  call_phone text := private.normalize_phone(nullif(btrim(call ->> 'phone'), ''));
  call_extension text := nullif(btrim(call ->> 'extension'), '');
  call_started_at timestamp with time zone := nullif(btrim(call ->> 'started_at'), '')::timestamp with time zone;
  call_duration integer := greatest(coalesce(nullif(btrim(call ->> 'duration'), '')::numeric, 0), 0)::integer;
  call_record_url text := nullif(btrim(call ->> 'record_url'), '');
  employee_id bigint;
  call_source_id bigint;
  found_call public.calls;
  new_status text;
  found_patient_id bigint;
  found_deal_id bigint;
  new_call_id bigint;
  created_patient boolean := false;
  created_deal boolean := false;
  created_task boolean := false;
begin
  select i.organization_id into org_id
  from public.telephony_integrations i
  where i.webhook_token = ingest_call.webhook_token;
  if org_id is null then
    raise exception 'Unknown webhook token' using errcode = '28000';
  end if;
  if call_provider not in ('binotel', 'zadarma', 'mango', 'generic')
    or call_external_id is null
    or call_direction not in ('in', 'out')
    or coalesce(call_status, 'in_progress') not in ('in_progress', 'answered', 'missed') then
    raise exception 'Unsupported call' using errcode = '22023';
  end if;

  update public.telephony_integrations
  set last_event_at = now()
  where organization_id = org_id;

  -- The events of one call may arrive at the same time
  perform pg_advisory_xact_lock(hashtextextended(format('call:%s:%s:%s', org_id, call_provider, call_external_id), 0));

  if call_extension is not null then
    select s.id into employee_id
    from public.sales s
    where s.organization_id = org_id and s.phone_extension = call_extension and not s.disabled;
  end if;

  select * into found_call
  from public.calls c
  where c.organization_id = org_id and c.provider = call_provider and c.external_id = call_external_id;

  if found then
    -- A final status replaces "in progress", never the other way round
    new_status := case
      when call_status in ('answered', 'missed') then call_status
      else found_call.status
    end;
    update public.calls c
    set status = new_status,
        duration_seconds = greatest(c.duration_seconds, call_duration),
        recording_url = coalesce(call_record_url, c.recording_url),
        sales_id = coalesce(employee_id, c.sales_id),
        extension = coalesce(call_extension, c.extension),
        phone = coalesce(c.phone, call_phone)
    where c.id = found_call.id;
    if new_status = 'missed' and found_call.status <> 'missed' and found_call.direction = 'in'
      and found_call.deal_id is not null then
      insert into public.tasks (organization_id, deal_id, type, text, due_date, sales_id)
      select org_id, d.id, 'call', 'Перезвонить', now(), d.sales_id
      from public.deals d
      where d.organization_id = org_id and d.id = found_call.deal_id;
      created_task := true;
    end if;
    return jsonb_build_object('call_id', found_call.id, 'patient_id', found_call.patient_id,
      'deal_id', found_call.deal_id, 'created_patient', false, 'created_deal', false,
      'created_task', created_task, 'duplicate', true);
  end if;

  -- A new call needs the patient's number (a recording of an unknown call,
  -- a hidden number: nothing to attach it to)
  if call_phone is null then
    return jsonb_build_object('ignored', true);
  end if;

  -- Two new calls from one new number must not create two patients
  perform pg_advisory_xact_lock(hashtextextended(format('phone:%s:%s', org_id, call_phone), 0));

  select s.id into call_source_id from public.lead_sources s
  where s.organization_id = org_id and s.code = 'call';
  if call_source_id is null then
    insert into public.lead_sources (organization_id, name, code, is_system, position)
    select org_id, 'Звонок', 'call', true, coalesce(max(s.position) + 1, 0)
    from public.lead_sources s
    where s.organization_id = org_id
    returning id into call_source_id;
  end if;

  select p.id into found_patient_id from public.patients p
  where p.organization_id = org_id and p.phones @> array[call_phone]
  order by p.last_seen desc, p.id desc
  limit 1;
  if found_patient_id is null then
    insert into public.patients (organization_id, first_name, phone_jsonb, source_id)
    values (
      org_id,
      coalesce(nullif(btrim(call ->> 'name'), ''), call_phone),
      jsonb_build_array(jsonb_build_object('number', call_phone, 'type', 'mobile')),
      call_source_id
    )
    returning id into found_patient_id;
    created_patient := true;
  end if;

  -- The deal: the most recently updated open one, else a new request. An
  -- outgoing call to a new number belongs to the employee who made it; an
  -- incoming one is distributed by the clinic rules (handle_deal_before_write).
  select d.id into found_deal_id
  from public.deals d
    join public.stages s on s.id = d.stage_id
  where d.organization_id = org_id and d.patient_id = found_patient_id
    and s.kind = 'open' and d.archived_at is null
  order by d.updated_at desc, d.id desc
  limit 1;
  if found_deal_id is null then
    -- An incoming call may open an unsorted lead (clinic setting)
    insert into public.deals (organization_id, patient_id, source_id, sales_id, unsorted_at)
    values (org_id, found_patient_id, call_source_id, case when call_direction = 'out' then employee_id end,
      case when call_direction = 'in' then private.unsorted_intake(org_id, call_source_id) end)
    returning id into found_deal_id;
    created_deal := true;
  end if;

  insert into public.calls (
    organization_id, patient_id, deal_id, direction, duration_seconds, called_at,
    sales_id, external_id, recording_url, provider, status, phone, extension
  ) values (
    org_id, found_patient_id, found_deal_id, call_direction, call_duration,
    -- Unknown start (a PBX in another time zone): now, minus the talk of a finished call
    coalesce(call_started_at, now() - make_interval(secs => call_duration)),
    employee_id, call_external_id, call_record_url, call_provider,
    coalesce(call_status, 'in_progress'), call_phone, call_extension
  )
  returning id into new_call_id;

  if call_status = 'missed' and call_direction = 'in' then
    insert into public.tasks (organization_id, deal_id, type, text, due_date, sales_id)
    select org_id, d.id, 'call', 'Перезвонить', now(), d.sales_id
    from public.deals d
    where d.organization_id = org_id and d.id = found_deal_id;
    created_task := true;
  end if;

  update public.patients set last_seen = now()
  where organization_id = org_id and id = found_patient_id;

  return jsonb_build_object('call_id', new_call_id, 'patient_id', found_patient_id,
    'deal_id', found_deal_id, 'created_patient', created_patient, 'created_deal', created_deal,
    'created_task', created_task, 'duplicate', false);
end;
$$;

-- response_overdue: deals waiting longer than the limit of their clinic.
-- Level 1 (the limit) goes to the configured people, level 2 (3x the limit)
-- to the owner and heads; each level once per waiting episode.
CREATE OR REPLACE FUNCTION "private"."notify_response_overdue"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  item record;
  reached integer;
  new_level integer;
  recipients bigint[];
  recipient bigint;
  notified integer := 0;
begin
  for item in
    select d as deal, os as settings, w.waiting_since,
      private.working_minutes(w.waiting_since, now(), o.timezone, os.response_hours_start, os.response_hours_end) as minutes
    from public.deals d
      join public.stages s on s.id = d.stage_id and s.kind = 'open'
      join public.organizations o on o.id = d.organization_id
      join public.organization_settings os on os.organization_id = d.organization_id and os.response_control_enabled
      cross join lateral (select private.deal_waiting_since(d.organization_id, d.id) as waiting_since) w
    where d.archived_at is null
      and d.unsorted_at is null
      and w.waiting_since is not null
      and w.waiting_since < now() - make_interval(mins => os.response_limit_minutes)
      and not exists (
        select 1 from public.response_alerts a
        where a.organization_id = d.organization_id and a.deal_id = d.id
          and a.waiting_since = w.waiting_since and a.level = 2
      )
  loop
    reached := case
      when item.minutes >= 3 * (item.settings).response_limit_minutes then 2
      when item.minutes >= (item.settings).response_limit_minutes then 1
      else 0
    end;
    recipients := '{}'::bigint[];
    new_level := 0;
    for level_no in 1..reached loop
      insert into public.response_alerts (organization_id, deal_id, waiting_since, level)
      values ((item.deal).organization_id, (item.deal).id, item.waiting_since, level_no)
      on conflict do nothing;
      if not found then
        continue;
      end if;
      new_level := level_no;
      if level_no = 1 then
        if (item.settings).response_alert_responsible then
          recipients := recipients || private.deal_audience(item.deal);
        end if;
        if (item.settings).response_alert_managers then
          recipients := recipients || private.clinic_managers((item.deal).organization_id);
        end if;
        recipients := recipients || (item.settings).response_alert_sales_ids;
      else
        recipients := recipients || private.clinic_managers((item.deal).organization_id);
      end if;
    end loop;
    if new_level = 0 then
      continue;
    end if;
    for recipient in select distinct r from unnest(recipients) r loop
      if private.add_notification((item.deal).organization_id, recipient, 'response_overdue',
        case when new_level = 2 then 'Пациент всё ещё ждёт ответа' else 'Пациент ждёт ответа' end,
        private.deal_label(item.deal) || ' · ждёт ' || item.minutes || ' мин',
        (item.deal).id, (item.deal).patient_id, null) is not null then
        notified := notified + 1;
      end if;
    end loop;
  end loop;
  return notified;
end;
$$;

-- Deals with what the board and the lists display
create or replace view public.deals_summary with (security_invoker = on) as
select
    d.id,
    d.organization_id,
    d.patient_id,
    d.pipeline_id,
    d.stage_id,
    d.name,
    d.source_id,
    d.service_id,
    d.plan_amount,
    d.paid_amount,
    d.sales_id,
    d.lost_reason_id,
    d.lost_comment,
    d.appointment_at,
    d.visit_at,
    d.tags,
    d.description,
    d.index,
    d.created_at,
    d.updated_at,
    d.stage_changed_at,
    d.closed_at,
    d.first_response_at,
    d.archived_at,
    s.kind as stage_kind,
    p.first_name as patient_first_name,
    p.last_name as patient_last_name,
    p.phones[1] as patient_phone,
    lower(concat_ws(' ', d.name, p.last_name, p.first_name, p.middle_name, array_to_string(p.phones, ' '))) as search_text,
    (
        select count(*)
        from public.tasks t
        where t.organization_id = d.organization_id and t.deal_id = d.id and t.done_date is null
    ) as nb_open_tasks,
    (
        select min(t.due_date)
        from public.tasks t
        where t.organization_id = d.organization_id and t.deal_id = d.id and t.done_date is null
    ) as next_task_due_at,
    (
        select count(*)
        from public.messages m
        where m.organization_id = d.organization_id and m.deal_id = d.id and m.direction = 'in' and m.read_at is null
    ) as nb_unread_messages,
    (
        select max(m.sent_at)
        from public.messages m
        where m.organization_id = d.organization_id and m.deal_id = d.id
    ) as last_message_at,
    (
        select m.text
        from public.messages m
        where m.organization_id = d.organization_id and m.deal_id = d.id
        order by m.sent_at desc, m.id desc
        limit 1
    ) as last_message_text,
    d.doctor_id,
    dr.name as doctor_name,
    d.consultation_amount,
    (
        select coalesce(sum(pay.amount), 0)::bigint
        from public.deal_payments pay
        where pay.organization_id = d.organization_id and pay.deal_id = d.id and pay.kind = 'prepayment'
    ) as prepayment_amount,
    d.unsorted_at
from public.deals d
    join public.stages s on s.id = d.stage_id
    join public.patients p on p.organization_id = d.organization_id and p.id = d.patient_id
    left join public.doctors dr on dr.organization_id = d.organization_id and dr.id = d.doctor_id;

-- Open deals whose patient waits for an answer, with the working minutes
-- waited and the clinic's limit (overdue: the limit is reached). The board
-- marks the overdue ones, the dashboard lists them.
create or replace view public.deals_waiting with (security_invoker = on) as
select
    d.id,
    d.organization_id,
    d.patient_id,
    d.pipeline_id,
    d.stage_id,
    d.sales_id,
    d.name,
    p.first_name as patient_first_name,
    p.last_name as patient_last_name,
    p.phones[1] as patient_phone,
    w.waiting_since,
    w.waiting_minutes,
    os.response_limit_minutes as limit_minutes,
    w.waiting_minutes >= os.response_limit_minutes as overdue
from public.deals d
    join public.stages s on s.id = d.stage_id and s.kind = 'open'
    join public.patients p on p.organization_id = d.organization_id and p.id = d.patient_id
    join public.organizations o on o.id = d.organization_id
    join public.organization_settings os on os.organization_id = d.organization_id and os.response_control_enabled
    cross join lateral (
        select
            ws.since as waiting_since,
            private.working_minutes(ws.since, now(), o.timezone, os.response_hours_start, os.response_hours_end) as waiting_minutes
        from (select private.deal_waiting_since(d.organization_id, d.id) as since) ws
    ) w
where d.archived_at is null and d.unsorted_at is null and w.waiting_since is not null;

create or replace trigger audit_settings
    after update on public.organization_settings
    for each row execute function private.audit_row('settings', 'manager_deal_visibility,pipeline_move_mode,lead_distribution,lead_distribution_sales_ids,unsorted_enabled,unsorted_source_ids');

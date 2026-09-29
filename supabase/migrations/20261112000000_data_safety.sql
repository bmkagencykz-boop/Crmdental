--
-- Stage 41: data safety (see supabase/schemas/41_data_safety.sql): patient
-- archive, protected money and medical rows (ON DELETE RESTRICT, guarded
-- deletion of patients and deals), immutable operations of closed cash
-- shifts, the medical data (IIN, allergies…) out of the integrator's reach
-- in public.patient_medical, a unique IIN per clinic, card numbers, the
-- private bucket of the note attachments, indexes and data retention.
--

--
-- Money and medical rows: ON DELETE RESTRICT (01, 28, 29, 36, 37, 40)
--

alter table public.deal_payments drop constraint deal_payments_deal_id_fkey;
alter table public.deal_payments
    add constraint deal_payments_deal_id_fkey foreign key (organization_id, deal_id) references public.deals(organization_id, id) on delete restrict;

alter table public.account_operations drop constraint account_operations_patient_id_fkey;
alter table public.account_operations
    add constraint account_operations_patient_id_fkey foreign key (organization_id, patient_id) references public.patients(organization_id, id) on delete restrict;

alter table public.account_operations drop constraint account_operations_deal_id_fkey;
alter table public.account_operations
    add constraint account_operations_deal_id_fkey foreign key (organization_id, deal_id) references public.deals(organization_id, id) on delete restrict;

alter table public.visits drop constraint visits_patient_id_fkey;
alter table public.visits
    add constraint visits_patient_id_fkey foreign key (organization_id, patient_id) references public.patients(organization_id, id) on delete restrict;

alter table public.treatment_plans drop constraint treatment_plans_patient_id_fkey;
alter table public.treatment_plans
    add constraint treatment_plans_patient_id_fkey foreign key (organization_id, patient_id) references public.patients(organization_id, id) on delete restrict;

alter table public.patient_teeth drop constraint patient_teeth_patient_id_fkey;
alter table public.patient_teeth
    add constraint patient_teeth_patient_id_fkey foreign key (organization_id, patient_id) references public.patients(organization_id, id) on delete restrict;

alter table public.patient_tooth_history drop constraint patient_tooth_history_patient_id_fkey;
alter table public.patient_tooth_history
    add constraint patient_tooth_history_patient_id_fkey foreign key (organization_id, patient_id) references public.patients(organization_id, id) on delete restrict;

alter table public.visit_records drop constraint visit_records_patient_id_fkey;
alter table public.visit_records
    add constraint visit_records_patient_id_fkey foreign key (organization_id, patient_id) references public.patients(organization_id, id) on delete restrict;

alter table public.patient_questionnaires drop constraint patient_questionnaires_patient_id_fkey;
alter table public.patient_questionnaires
    add constraint patient_questionnaires_patient_id_fkey foreign key (organization_id, patient_id) references public.patients(organization_id, id) on delete restrict;

alter table public.patient_files drop constraint patient_files_patient_id_fkey;
alter table public.patient_files
    add constraint patient_files_patient_id_fkey foreign key (organization_id, patient_id) references public.patients(organization_id, id) on delete restrict;

alter table public.patient_consents drop constraint patient_consents_patient_id_fkey;
alter table public.patient_consents
    add constraint patient_consents_patient_id_fkey foreign key (organization_id, patient_id) references public.patients(organization_id, id) on delete restrict;

alter table public.lab_orders drop constraint lab_orders_patient_id_fkey;
alter table public.lab_orders
    add constraint lab_orders_patient_id_fkey foreign key (organization_id, patient_id) references public.patients(organization_id, id) on delete restrict;

--
-- Changed functions (02, 15, 18, 30, 31, 37)
--

CREATE OR REPLACE FUNCTION "private"."delete_organization_data"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  delete from public.account_operations where organization_id = old.id;
  delete from public.deal_payments where organization_id = old.id;
  delete from public.lab_orders where organization_id = old.id;
  delete from public.visit_records where organization_id = old.id;
  delete from public.patient_consents where organization_id = old.id;
  delete from public.patient_files where organization_id = old.id;
  delete from public.patient_teeth where organization_id = old.id;
  delete from public.patient_tooth_history where organization_id = old.id;
  delete from public.patient_questionnaires where organization_id = old.id;
  delete from public.treatment_plans where organization_id = old.id;
  delete from public.visits where organization_id = old.id;
  delete from public.patients where organization_id = old.id;
  return old;
end;
$$;

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
    -- The patient, or the medical data of a patient (patient_medical, stage 41)
    row_patient_id := coalesce(row_data ->> 'patient_id', row_data ->> 'id')::bigint;
  elsif entity_name = 'deal' then
    row_deal_id := (row_data ->> 'id')::bigint;
    row_patient_id := (row_data ->> 'patient_id')::bigint;
  elsif row_data ? 'deal_id' then
    row_deal_id := (row_data ->> 'deal_id')::bigint;
    select d.patient_id into row_patient_id
    from public.deals d
    where d.organization_id = org_id and d.id = row_deal_id;
  end if;
  -- Rows of a patient without a deal (account operations, stage 36; the
  -- patient card, stage 37; the waiting list, stage 38)
  if row_patient_id is null and entity_name in ('account_operation', 'patient_tooth', 'visit_record',
    'patient_questionnaire', 'patient_consent', 'patient_file', 'waiting_list') then
    row_patient_id := (row_data ->> 'patient_id')::bigint;
  end if;

  select * into actor from private.audit_actor(org_id);
  if pg_trigger_depth() > 1 then
    actor.actor_id := null;
    actor.actor_source := 'automation';
  end if;

  insert into public.audit_log (organization_id, sales_id, source, entity, entity_id, action, changes, deal_id, patient_id)
  values (org_id, actor.actor_id, actor.actor_source, entity_name,
    case when entity_name = 'patient' then row_patient_id else (row_data ->> 'id')::bigint end,
    row_action, diff, row_deal_id, row_patient_id);
  return null;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."patient_match_keys"("org_id" bigint, "only_patient_id" bigint DEFAULT NULL::bigint) RETURNS TABLE("patient_id" bigint, "kind" "text", "match_key" "text")
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
begin
  return query
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
  union
  select m.patient_id, 'iin', m.iin
  from public.patient_medical m
  where m.organization_id = org_id and (only_patient_id is null or m.patient_id = only_patient_id)
    and m.iin is not null;
end;
$$;

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
  -- Ledger rows of the lead without a deal payment (stage 41: a deal with
  -- ledger rows is not deleted)
  perform set_config('crm.ledger_sync', 'system', true);
  update public.account_operations o set deal_id = target_row.id, patient_id = target_row.patient_id
  where o.organization_id = org_id and o.deal_id = lead_row.id;
  perform set_config('crm.ledger_sync', '', true);
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

CREATE OR REPLACE FUNCTION "private"."access_default"("org_id" bigint, "user_role" "text", "entity" "text", "action" "text") RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if user_role is null or private.access_scopes(entity, action) is null then
    return 'none';
  end if;
  if user_role in ('owner', 'head') then
    return 'all';
  end if;
  -- Stage 25: the integrator reads the deals, patients and tasks
  if user_role = 'integrator' then
    return case when action = 'view' and entity <> 'reports' then 'all' else 'none' end;
  end if;
  -- Manager (administrator). Stage 41: the patients «delete» right (moving
  -- a patient to the archive) is the owner's choice, none by default
  if entity = 'reports' or (entity in ('deals', 'patients') and action = 'delete') then
    return 'none';
  end if;
  if entity = 'deals' and action in ('view', 'edit') then
    return coalesce((
      select s.manager_deal_visibility
      from public.organization_settings s
      where s.organization_id = org_id
    ), 'all');
  end if;
  return 'all';
end;
$$;

CREATE OR REPLACE FUNCTION "public"."global_search"("q" "text", "max_per_kind" integer DEFAULT 5) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $_$
declare
  org_id bigint := private.current_organization_id();
  lim integer := least(greatest(coalesce(max_per_kind, 5), 1), 50);
  raw text := btrim(coalesce(q, ''));
  norm text;
  tokens text[];
  name_words text[];
  digit_words text[];
  phone_digits text;
  exact_phone text;
  id_number bigint;
  phrase text;
  is_phone boolean;
  iin_value text;
  result_patients jsonb;
  result_deals jsonb;
  result_tasks jsonb;
  result_messages jsonb;
begin
  if org_id is null or char_length(raw) < 2 then
    return jsonb_build_object('patients', '[]'::jsonb, 'deals', '[]'::jsonb, 'tasks', '[]'::jsonb, 'messages', '[]'::jsonb);
  end if;

  -- The query: normalized words without LIKE wildcards
  norm := btrim(regexp_replace(private.search_norm(raw), '[%_\\]+', ' ', 'g'));
  tokens := array(select t from regexp_split_to_table(norm, '\s+') as t where t <> '');
  is_phone := raw !~ '[^0-9\s()+-]';
  if raw ~ '^[#№]\s*[0-9]{1,18}$' or (raw ~ '^[0-9]{1,6}$') then
    id_number := regexp_replace(raw, '[^0-9]', '', 'g')::bigint;
  end if;
  if regexp_replace(raw, '[\s-]', '', 'g') ~ '^[0-9]{12}$' then
    iin_value := regexp_replace(raw, '[\s-]', '', 'g');
  end if;
  if is_phone then
    phone_digits := regexp_replace(raw, '[^0-9]', '', 'g');
    if length(phone_digits) >= 4 and phone_digits ~ '^[78]7' then
      phone_digits := substr(phone_digits, 2);
    end if;
    if length(phone_digits) < 3 then
      phone_digits := null;
    end if;
    if length(regexp_replace(raw, '[^0-9]', '', 'g')) >= 10 then
      exact_phone := private.normalize_phone(raw);
    end if;
    name_words := '{}';
    digit_words := '{}';
  else
    -- «#12» and «№12» are numbers, not words
    tokens := array(select regexp_replace(t, '^[#№]', '') from unnest(tokens) as t where regexp_replace(t, '^[#№]', '') <> '');
    name_words := array(select t from unnest(tokens) as t where t !~ '^[0-9]+$');
    digit_words := array(select t from unnest(tokens) as t where t ~ '^[0-9]+$' and length(t) >= 3);
    if cardinality(name_words) = 0 then
      name_words := '{}';
    end if;
    phrase := case when char_length(norm) >= 3 then norm end;
  end if;

  -- Patients: shared by the clinic
  with found as (
    select p.*,
      private.patient_search_name(p.last_name, p.first_name, p.middle_name) as search_name,
      (select min(r.external_id) from public.external_refs r
       where r.organization_id = p.organization_id and r.entity = 'patient' and r.entity_id = p.id) as card,
      (iin_value is not null and exists (
        select 1 from public.patient_medical m
        where m.organization_id = p.organization_id and m.patient_id = p.id and m.iin = iin_value)) as iin_match
    from public.patients p
    where p.organization_id = org_id
      -- Archived patients (stage 41) are found on the patient list's «Архив»
      and p.archived_at is null
      and (
        (phone_digits is not null and private.phones_search_digits(p.phones) like '%' || phone_digits || '%')
        or (id_number is not null and p.id = id_number)
        -- The IIN (stage 41): row level security keeps it from the integrator
        or (iin_value is not null and exists (
          select 1 from public.patient_medical m
          where m.organization_id = p.organization_id and m.patient_id = p.id and m.iin = iin_value))
        or exists (
          select 1 from public.external_refs r
          where r.organization_id = p.organization_id and r.entity = 'patient'
            and r.entity_id = p.id and r.external_id = raw)
        or (
          cardinality(name_words) > 0
          and private.patient_search_name(p.last_name, p.first_name, p.middle_name) like '% ' || name_words[1] || '%'
          and not exists (
            select 1 from unnest(name_words) as w
            where private.patient_search_name(p.last_name, p.first_name, p.middle_name) not like '% ' || w || '%')
          and not exists (
            select 1 from unnest(digit_words) as w
            where private.phones_search_digits(p.phones) not like '%' || w || '%')
        )
      )
  ),
  ranked as (
    select f.*,
      case
        when exact_phone is not null and exact_phone = any(f.phones) then 0
        when id_number is not null and f.id = id_number then 1
        when f.card = raw then 1
        when f.iin_match then 1
        when cardinality(name_words) > 0 and btrim(f.search_name) = array_to_string(name_words, ' ') then 2
        when cardinality(name_words) > 0 and f.search_name like ' ' || name_words[1] || '%' then 3
        when cardinality(name_words) > 0 then 4
        else 5
      end as rank
    from found f
    order by rank, f.last_seen desc, f.id desc
    limit lim
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'first_name', r.first_name,
      'last_name', r.last_name,
      'middle_name', r.middle_name,
      'phones', to_jsonb(r.phones),
      'birth_date', r.birth_date,
      'card', r.card,
      'rank', r.rank
    ) order by r.rank, r.last_seen desc, r.id desc), '[]'::jsonb)
  into result_patients
  from ranked r;

  -- Deals: row level security keeps the deals the user cannot see out
  with found as (
    select d.*, p.first_name as patient_first_name, p.last_name as patient_last_name, p.phones as patient_phones,
      private.patient_search_name(p.last_name, p.first_name, p.middle_name) as patient_name,
      ' ' || private.search_norm(d.name) as deal_name,
      s.name as stage_name, s.kind as stage_kind, s.color as stage_color,
      nullif(btrim(coalesce(sa.first_name, '') || ' ' || coalesce(sa.last_name, '')), '') as sales_name
    from public.deals d
    join public.patients p on p.organization_id = d.organization_id and p.id = d.patient_id
    join public.stages s on s.organization_id = d.organization_id and s.id = d.stage_id
    left join public.sales sa on sa.organization_id = d.organization_id and sa.id = d.sales_id
    where d.organization_id = org_id
      and (
        (id_number is not null and d.id = id_number)
        or (phone_digits is not null and private.phones_search_digits(p.phones) like '%' || phone_digits || '%')
        or (
          cardinality(name_words) > 0
          and not exists (
            select 1 from unnest(name_words) as w
            where private.patient_search_name(p.last_name, p.first_name, p.middle_name) || ' ' || private.search_norm(d.name) not like '% ' || w || '%')
          and not exists (
            select 1 from unnest(digit_words) as w
            where private.phones_search_digits(p.phones) not like '%' || w || '%')
        )
      )
  ),
  ranked as (
    select f.*,
      case
        when id_number is not null and f.id = id_number then 0
        when exact_phone is not null and exact_phone = any(f.patient_phones) then 1
        when cardinality(name_words) > 0 and (f.patient_name like ' ' || name_words[1] || '%' or f.deal_name like ' ' || name_words[1] || '%') then 2
        when cardinality(name_words) > 0 then 3
        else 4
      end as rank
    from found f
    order by rank, (f.stage_kind = 'open' and f.archived_at is null) desc, f.updated_at desc, f.id desc
    limit lim
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'name', r.name,
      'patient_id', r.patient_id,
      'patient_first_name', r.patient_first_name,
      'patient_last_name', r.patient_last_name,
      'pipeline_id', r.pipeline_id,
      'stage_id', r.stage_id,
      'stage_name', r.stage_name,
      'stage_kind', r.stage_kind,
      'stage_color', r.stage_color,
      'sales_id', r.sales_id,
      'sales_name', r.sales_name,
      'plan_amount', r.plan_amount,
      'archived_at', r.archived_at,
      'rank', r.rank
    ) order by r.rank, (r.stage_kind = 'open' and r.archived_at is null) desc, r.updated_at desc, r.id desc), '[]'::jsonb)
  into result_deals
  from ranked r;

  -- Tasks: by their text, or by the patient of their deal
  with found as (
    select t.*, p.first_name as patient_first_name, p.last_name as patient_last_name, p.id as patient_id
    from public.tasks t
    join public.deals d on d.organization_id = t.organization_id and d.id = t.deal_id
    join public.patients p on p.organization_id = d.organization_id and p.id = d.patient_id
    where t.organization_id = org_id
      and (
        (phone_digits is not null and private.phones_search_digits(p.phones) like '%' || phone_digits || '%')
        or (
          cardinality(name_words) > 0
          and not exists (
            select 1 from unnest(name_words) as w
            where private.patient_search_name(p.last_name, p.first_name, p.middle_name) || ' ' || private.search_norm(t.text) not like '% ' || w || '%')
          and not exists (
            select 1 from unnest(digit_words) as w
            where private.phones_search_digits(p.phones) not like '%' || w || '%')
        )
      )
    order by (t.done_date is null) desc, t.due_date, t.id
    limit lim
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id,
      'text', f.text,
      'type', f.type,
      'due_date', f.due_date,
      'done_date', f.done_date,
      'deal_id', f.deal_id,
      'sales_id', f.sales_id,
      'patient_id', f.patient_id,
      'patient_first_name', f.patient_first_name,
      'patient_last_name', f.patient_last_name
    ) order by (f.done_date is null) desc, f.due_date, f.id), '[]'::jsonb)
  into result_tasks
  from found f;

  -- Messages: the query as a phrase inside the text, with a snippet around it
  with found as (
    select m.id, m.deal_id, m.patient_id, m.direction, m.transport, m.sent_at, m.text,
      strpos(private.search_norm(m.text), phrase) as pos,
      p.first_name as patient_first_name, p.last_name as patient_last_name
    from public.messages m
    join public.patients p on p.organization_id = m.organization_id and p.id = m.patient_id
    where phrase is not null
      and m.organization_id = org_id
      and private.search_norm(m.text) like '%' || phrase || '%'
    order by m.sent_at desc, m.id desc
    limit lim
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id,
      'deal_id', f.deal_id,
      'patient_id', f.patient_id,
      'patient_first_name', f.patient_first_name,
      'patient_last_name', f.patient_last_name,
      'direction', f.direction,
      'transport', f.transport,
      'sent_at', f.sent_at,
      'snippet',
        case when f.pos > 41 then '…' else '' end
        || substr(f.text, greatest(f.pos - 40, 1), 160)
        || case when char_length(f.text) >= greatest(f.pos - 40, 1) + 160 then '…' else '' end
    ) order by f.sent_at desc, f.id desc), '[]'::jsonb)
  into result_messages
  from found f;

  return jsonb_build_object(
    'patients', result_patients,
    'deals', result_deals,
    'tasks', result_tasks,
    'messages', result_messages
  );
end;
$_$;

CREATE OR REPLACE FUNCTION "private"."handle_patient_tooth_after_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  row_data public.patient_teeth := coalesce(new, old);
  change_source text := coalesce(nullif(current_setting('crm.tooth_source', true), ''), 'manual');
  item_id bigint := nullif(current_setting('crm.tooth_plan_item', true), '')::bigint;
begin
  if tg_op = 'UPDATE' and (new.patient_id is distinct from old.patient_id
    or (new.state is not distinct from old.state and new.note is not distinct from old.note)) then
    return null;
  end if;
  -- Deleted with the patient (or the clinic), or given way to the kept
  -- patient's own tooth in a merge (stage 41): nothing to tell
  if tg_op = 'DELETE' and (current_setting('crm.patient_merge', true) = 'on' or not exists (
    select 1 from public.patients p where p.organization_id = old.organization_id and p.id = old.patient_id
  )) then
    return null;
  end if;
  insert into public.patient_tooth_history (organization_id, patient_id, tooth, state_before, state, note_before, note, sales_id, source, plan_item_id)
  values (row_data.organization_id, row_data.patient_id, row_data.tooth,
    case when tg_op <> 'INSERT' then old.state end,
    case when tg_op <> 'DELETE' then new.state end,
    case when tg_op <> 'INSERT' then old.note end,
    case when tg_op <> 'DELETE' then new.note end,
    private.current_sales_id(),
    change_source,
    case when change_source = 'plan' then item_id end);
  return null;
end;
$$;

--
-- Merge of patients (18): the medical data
--

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
  keep_medical record;
  merge_medical record;
  merged_iin text;
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

  -- The medical data (stage 41: IIN, allergies, contraindications, chronic
  -- diseases): nothing is lost, the kept patient's IIN wins
  select * into keep_medical from public.patient_medical m where m.organization_id = org_id and m.patient_id = keep_id;
  select * into merge_medical from public.patient_medical m where m.organization_id = org_id and m.patient_id = merge_id;
  if merge_medical.patient_id is not null then
    delete from public.patient_medical m where m.organization_id = org_id and m.patient_id = merge_id;
    merged_iin := coalesce(keep_medical.iin, merge_medical.iin);
    insert into public.patient_medical (organization_id, patient_id, iin, iin_duplicate, allergies, contraindications,
      chronic_diseases, updated_by)
    values (org_id, keep_id, merged_iin,
      merged_iin is not null and exists (
        select 1 from public.patient_medical o
        where o.organization_id = org_id and o.iin = merged_iin and o.patient_id <> keep_id and not o.iin_duplicate),
      private.merge_note_text(keep_medical.allergies, merge_medical.allergies),
      private.merge_note_text(keep_medical.contraindications, merge_medical.contraindications),
      private.merge_note_text(keep_medical.chronic_diseases, merge_medical.chronic_diseases),
      private.current_sales_id())
    on conflict (patient_id) do update
    set iin = excluded.iin, iin_duplicate = excluded.iin_duplicate, allergies = excluded.allergies,
        contraindications = excluded.contraindications, chronic_diseases = excluded.chronic_diseases,
        updated_at = now(), updated_by = excluded.updated_by;
  end if;

  -- The visits of the MIS move with their patient
  perform set_config('crm.visit_sync', 'on', true);
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
  perform set_config('crm.visit_sync', '', true);
  update public.external_refs r set entity_id = keep_id
  where r.organization_id = org_id and r.entity = 'patient' and r.entity_id = merge_id;

  -- The rows that gave way to the kept patient's own (a tooth, the
  -- questionnaire): the medical rows no longer cascade (stage 41)
  perform set_config('crm.patient_merge', 'on', true);
  delete from public.patient_teeth t where t.organization_id = org_id and t.patient_id = merge_id;
  delete from public.patient_questionnaires q where q.organization_id = org_id and q.patient_id = merge_id;
  delete from public.patients p where p.organization_id = org_id and p.id = merge_id;
  perform set_config('crm.patient_merge', '', true);

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
      messaging_opt_out_at = coalesce(keep_row.messaging_opt_out_at, merge_row.messaging_opt_out_at),
      preferred_doctor_id = coalesce(keep_row.preferred_doctor_id, merge_row.preferred_doctor_id)
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

--
-- Data safety (stage 41): what real clinics need before they trust the CRM
-- with money and medical records.
--
--   Patient archive   patients.archived_at / archived_by. «В архив» hides a
--                     patient from the lists, the search and the pickers
--                     (the app filters archived_at is null unless the
--                     «Архив» filter is on); the card stays readable and
--                     «Вернуть из архива» restores it. Archiving needs the
--                     patients «delete» right of stage 30 (owner and head by
--                     default, a manager only when the owner grants it);
--                     restoring: the owner or the head.
--   Hard delete       only the owner, only a patient without money, visits
--                     or medical rows (private.patient_has_history), else a
--                     clear error (hint patient_has_history). The money and
--                     medical tables reference patients ON DELETE RESTRICT
--                     (account_operations, visits, visit_records,
--                     treatment_plans, patient_teeth, patient_tooth_history,
--                     patient_questionnaires, patient_consents,
--                     patient_files, lab_orders); deal_payments and
--                     account_operations reference deals ON DELETE RESTRICT.
--                     Communications and automation rows (notes, calls,
--                     messages, chats, notifications, recalls, mailings,
--                     lead submissions, deal files, the waiting list, the
--                     MIS appointments) still follow the patient.
--                     private.delete_organization_data removes the
--                     protected rows first when a whole clinic is deleted.
--   Deals             a deal with payments or ledger rows is not deleted
--                     (hint deal_has_payments): archive it.
--   Closed shifts     an account operation of a closed cash shift is
--                     neither changed nor cancelled (hint shift_closed): the
--                     owner writes a correction instead. Re-linking an
--                     operation (patients or deals merged, a plan, visit or
--                     branch removed) still works; a cascade (a clinic
--                     deleted) too.
--   Medical data      IIN, allergies, contraindications and chronic
--                     diseases live in public.patient_medical, whose rows
--                     the integrator never reads. The columns of the same
--                     names on patients stay as the write path (the form,
--                     the imports, the tests write them): a trigger moves
--                     every value given into patient_medical and stores
--                     null on patients. patients_summary reads them back
--                     from patient_medical.
--   IIN               unique per clinic (a partial unique index); IINs that
--                     were already duplicated keep iin_duplicate = true and
--                     show up as duplicates to merge (reason «iin»).
--   Card numbers      a new patient without a card number gets the next
--                     number of the clinic (patient_card_counters); the
--                     existing patients keep the number the card showed
--                     (their CRM id).
--   Retention         private.retention_tick() (pg_cron, daily) purges old
--                     technical rows; the audit log, money and medical data
--                     are never purged.
--

--
-- Patient archive
--

alter table public.patients add column archived_at timestamp with time zone;
alter table public.patients add column archived_by bigint;

alter table public.patients
    add constraint patients_archived_by_fkey foreign key (organization_id, archived_by) references public.sales(organization_id, id) on delete set null (archived_by);

create index patients_archived_at_idx on public.patients using btree (organization_id, archived_at) where archived_at is not null;

-- «В архив» and «Вернуть из архива»: the rights, who and when
CREATE OR REPLACE FUNCTION "private"."handle_patient_archive"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  role text := private.current_user_role();
  me bigint := private.current_sales_id();
  scope text;
begin
  if new.archived_at is not distinct from old.archived_at then
    new.archived_by := old.archived_by;
    return new;
  end if;
  if old.archived_at is not null and new.archived_at is not null then
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
    return new;
  end if;
  if new.archived_at is not null then
    if role is not null then
      scope := private.access_scope('patients', 'delete');
      if scope = 'all' or (scope = 'own' and (old.sales_id = me or exists (
        select 1 from public.deals d
        where d.organization_id = old.organization_id and d.patient_id = old.id and d.sales_id = me))) then
        null;
      else
        raise exception 'Нет права переместить пациента в архив' using errcode = '42501', hint = 'patient_archive_forbidden';
      end if;
    end if;
    new.archived_at := now();
    new.archived_by := me;
  else
    if role is not null and role not in ('owner', 'head') then
      raise exception 'Вернуть пациента из архива могут владелец или руководитель' using errcode = '42501', hint = 'patient_restore_forbidden';
    end if;
    new.archived_by := null;
  end if;
  return new;
end;
$$;

-- Money, visits or medical rows of a patient: such a patient is archived,
-- never deleted
CREATE OR REPLACE FUNCTION "private"."patient_has_history"("org_id" bigint, "target_patient_id" bigint) RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  return exists (select 1 from public.account_operations o where o.organization_id = org_id and o.patient_id = target_patient_id)
    or exists (select 1 from public.deal_payments dp join public.deals d on d.organization_id = dp.organization_id and d.id = dp.deal_id
               where d.organization_id = org_id and d.patient_id = target_patient_id)
    or exists (select 1 from public.visits v where v.organization_id = org_id and v.patient_id = target_patient_id)
    or exists (select 1 from public.visit_records r where r.organization_id = org_id and r.patient_id = target_patient_id)
    or exists (select 1 from public.treatment_plans tp where tp.organization_id = org_id and tp.patient_id = target_patient_id)
    or exists (select 1 from public.patient_teeth t where t.organization_id = org_id and t.patient_id = target_patient_id)
    or exists (select 1 from public.patient_tooth_history h where h.organization_id = org_id and h.patient_id = target_patient_id)
    or exists (select 1 from public.patient_questionnaires q where q.organization_id = org_id and q.patient_id = target_patient_id)
    or exists (select 1 from public.patient_consents c where c.organization_id = org_id and c.patient_id = target_patient_id)
    or exists (select 1 from public.patient_files f where f.organization_id = org_id and f.patient_id = target_patient_id)
    or exists (select 1 from public.lab_orders l where l.organization_id = org_id and l.patient_id = target_patient_id);
end;
$$;

-- Deleting a patient: the owner only, a patient without history only. A
-- cascade (a clinic deleted) passes; a merge (crm.patient_merge, the rows
-- moved first) needs no owner.
CREATE OR REPLACE FUNCTION "private"."handle_patient_before_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  role text := private.current_user_role();
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  -- Patients merged (stage 18): whoever may merge, once the rows moved
  if role is not null and role <> 'owner' and coalesce(current_setting('crm.patient_merge', true), '') <> 'on' then
    raise exception 'Удалить пациента насовсем может только владелец. Переместите пациента в архив'
      using errcode = '42501', hint = 'patient_delete_owner_only';
  end if;
  if private.patient_has_history(old.organization_id, old.id) then
    raise exception 'У пациента есть оплаты, визиты или медицинские записи — удалить его нельзя. Переместите пациента в архив'
      using errcode = '23503', hint = 'patient_has_history';
  end if;
  return old;
end;
$$;

-- Deleting a deal with payments or ledger rows is refused (archive it). A
-- cascade (a patient without history, a clinic) passes.
CREATE OR REPLACE FUNCTION "private"."handle_deal_before_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  if exists (select 1 from public.deal_payments p where p.organization_id = old.organization_id and p.deal_id = old.id)
    or exists (select 1 from public.account_operations o where o.organization_id = old.organization_id and o.deal_id = old.id) then
    raise exception 'По сделке есть оплаты — удалить её нельзя. Переместите сделку в архив'
      using errcode = '23503', hint = 'deal_has_payments';
  end if;
  return old;
end;
$$;

--
-- Closed cash shifts
--

-- An operation of a closed shift stays as it was counted. Re-linking
-- (patient, deal, plan, visit, branch: merges and set-null cascades) passes,
-- and so does a cascade (a clinic deleted) unless it comes from a deal
-- payment changed or deleted directly (crm.ledger_sync = 'deal').
CREATE OR REPLACE FUNCTION "private"."handle_account_operation_shift_lock"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  sync text := coalesce(current_setting('crm.ledger_sync', true), '');
  links text[] := array['patient_id', 'deal_id', 'plan_id', 'visit_id', 'branch_id'];
begin
  if old.shift_id is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - links) = (to_jsonb(old) - links) then
    return new;
  end if;
  if pg_trigger_depth() > 1 and sync <> 'deal' then
    return coalesce(new, old);
  end if;
  if exists (
    select 1 from public.cash_shifts s
    where s.organization_id = old.organization_id and s.id = old.shift_id and s.closed_at is not null
  ) then
    raise exception 'Смена закрыта: операцию нельзя изменить или отменить. Проведите корректировку'
      using errcode = '22023', hint = 'shift_closed';
  end if;
  return coalesce(new, old);
end;
$$;

--
-- Medical data out of the integrator's reach
--

create table public.patient_medical (
    patient_id bigint not null primary key,
    organization_id bigint not null default private.current_organization_id(),
    iin text,
    -- An IIN shared with another patient before stage 41 (merge them)
    iin_duplicate boolean not null default false,
    allergies text,
    contraindications text,
    chronic_diseases text,
    updated_at timestamp with time zone not null default now(),
    updated_by bigint,
    constraint patient_medical_iin_check check (iin is null or private.iin_valid(iin))
);

alter table public.patient_medical add constraint patient_medical_organization_id_patient_id_key unique (organization_id, patient_id);
alter table public.patient_medical
    add constraint patient_medical_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade;
-- Deferred: the row is written by the patient's BEFORE INSERT trigger
alter table public.patient_medical
    add constraint patient_medical_patient_id_fkey foreign key (organization_id, patient_id) references public.patients(organization_id, id) on delete cascade deferrable initially deferred;
alter table public.patient_medical
    add constraint patient_medical_updated_by_fkey foreign key (organization_id, updated_by) references public.sales(organization_id, id) on delete set null (updated_by);

create unique index patient_medical_iin_key on public.patient_medical using btree (organization_id, iin) where iin is not null and not iin_duplicate;
create index patient_medical_iin_idx on public.patient_medical using btree (organization_id, iin) where iin is not null;

-- Writes the given fields ({ iin, allergies, contraindications,
-- chronic_diseases }, only the keys present) of a patient's medical data.
-- The IIN is checked (hint patient_iin_invalid) and unique in the clinic
-- (hint patient_iin_duplicate).
CREATE OR REPLACE FUNCTION "private"."save_patient_medical"("org_id" bigint, "target_patient_id" bigint, "given" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  new_iin text := nullif(regexp_replace(coalesce(given ->> 'iin', ''), '[\s-]', '', 'g'), '');
begin
  if given ? 'iin' and new_iin is not null then
    if not private.iin_valid(new_iin) then
      raise exception 'Неверный ИИН: 12 цифр с контрольной суммой' using errcode = '22023', hint = 'patient_iin_invalid';
    end if;
    if exists (
      select 1 from public.patient_medical m
      where m.organization_id = org_id and m.iin = new_iin and m.patient_id <> target_patient_id and not m.iin_duplicate
    ) then
      raise exception 'Пациент с ИИН % уже есть в клинике', new_iin using errcode = '23505', hint = 'patient_iin_duplicate';
    end if;
  end if;
  insert into public.patient_medical as m (organization_id, patient_id, iin, allergies, contraindications, chronic_diseases, updated_by)
  values (org_id, target_patient_id, new_iin, given ->> 'allergies', given ->> 'contraindications',
    given ->> 'chronic_diseases', private.current_sales_id())
  on conflict (patient_id) do update
  set iin = case when given ? 'iin' then excluded.iin else m.iin end,
      iin_duplicate = case when given ? 'iin' and excluded.iin is distinct from m.iin then false else m.iin_duplicate end,
      allergies = case when given ? 'allergies' then excluded.allergies else m.allergies end,
      contraindications = case when given ? 'contraindications' then excluded.contraindications else m.contraindications end,
      chronic_diseases = case when given ? 'chronic_diseases' then excluded.chronic_diseases else m.chronic_diseases end,
      updated_at = now(),
      updated_by = excluded.updated_by;
end;
$$;

-- The medical columns of patients are a write path: the values given go to
-- patient_medical, the patients row keeps null. One trigger per column on
-- update (a column in the SET list is given, even when cleared).
CREATE OR REPLACE FUNCTION "private"."handle_patient_medical_transit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  fields text[] := case when tg_op = 'INSERT'
    then array['iin', 'allergies', 'contraindications', 'chronic_diseases'] else array[tg_argv[0]] end;
  row_data jsonb := to_jsonb(new);
  given jsonb := '{}'::jsonb;
  cleared jsonb := '{}'::jsonb;
  field text;
begin
  foreach field in array fields loop
    given := given || jsonb_build_object(field, row_data -> field);
    cleared := cleared || jsonb_build_object(field, null);
  end loop;
  if tg_op = 'INSERT' and not exists (select 1 from jsonb_each(given) e where e.value <> 'null'::jsonb) then
    return new;
  end if;
  perform private.save_patient_medical(new.organization_id, new.id, given);
  new := jsonb_populate_record(new, cleared);
  return new;
end;
$$;

--
-- Card numbers
--

create table public.patient_card_counters (
    organization_id bigint not null primary key,
    last_number bigint not null default 0
);

alter table public.patient_card_counters
    add constraint patient_card_counters_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade;

-- The next free card number of a clinic
CREATE OR REPLACE FUNCTION "private"."next_card_number"("org_id" bigint) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  next_number bigint;
begin
  insert into public.patient_card_counters (organization_id, last_number)
  values (org_id, 0)
  on conflict (organization_id) do nothing;
  loop
    update public.patient_card_counters c
    set last_number = c.last_number + 1
    where c.organization_id = org_id
    returning c.last_number into next_number;
    exit when not exists (
      select 1 from public.patients p where p.organization_id = org_id and p.card_number = next_number::text);
  end loop;
  return next_number::text;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."handle_patient_card_number"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if new.organization_id is not null and nullif(btrim(coalesce(new.card_number, '')), '') is null then
    new.card_number := private.next_card_number(new.organization_id);
  end if;
  return new;
end;
$$;

--
-- Retention
--

-- Purges the old technical rows, daily (pg_cron «retention-daily»). Periods:
--   webhook_deliveries   90 days, delivered / failed / cancelled
--   mis_sync_log         90 days
--   mis_outbox           90 days, done / failed / cancelled
--   notifications        90 days after being read
--   salesbot_logs        180 days
--   stage_trigger_runs   180 days, when the deal is no longer in the
--                        trigger's stage (a run marks «done once»)
--   lead_submissions     365 days (the dedupe window is minutes)
--   net._http_response   7 days (pg_net responses), when accessible
-- Never: audit_log, money, medical data, messages. At most 50 000 rows per
-- table and run. Returns the rows purged per table.
CREATE OR REPLACE FUNCTION "private"."retention_tick"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  batch constant integer := 50000;
  technical_days constant integer := 90;
  log_days constant integer := 180;
  lead_days constant integer := 365;
  http_days constant integer := 7;
  purged jsonb := '{}'::jsonb;
  n bigint;
begin
  delete from public.webhook_deliveries w
  where w.id in (
    select x.id from public.webhook_deliveries x
    where x.status in ('delivered', 'failed', 'cancelled') and x.created_at < now() - make_interval(days => technical_days)
    limit batch);
  get diagnostics n = row_count;
  purged := purged || jsonb_build_object('webhook_deliveries', n);

  delete from public.mis_sync_log l
  where l.id in (
    select x.id from public.mis_sync_log x
    where x.created_at < now() - make_interval(days => technical_days)
    limit batch);
  get diagnostics n = row_count;
  purged := purged || jsonb_build_object('mis_sync_log', n);

  delete from public.mis_outbox o
  where o.id in (
    select x.id from public.mis_outbox x
    where x.status in ('done', 'failed', 'cancelled') and x.created_at < now() - make_interval(days => technical_days)
    limit batch);
  get diagnostics n = row_count;
  purged := purged || jsonb_build_object('mis_outbox', n);

  delete from public.notifications nt
  where nt.id in (
    select x.id from public.notifications x
    where x.read_at is not null and x.read_at < now() - make_interval(days => technical_days)
    limit batch);
  get diagnostics n = row_count;
  purged := purged || jsonb_build_object('notifications', n);

  delete from public.salesbot_logs l
  where l.id in (
    select x.id from public.salesbot_logs x
    where x.created_at < now() - make_interval(days => log_days)
    limit batch);
  get diagnostics n = row_count;
  purged := purged || jsonb_build_object('salesbot_logs', n);

  delete from public.stage_trigger_runs r
  where r.id in (
    select x.id from public.stage_trigger_runs x
    where x.created_at < now() - make_interval(days => log_days)
      and not exists (
        select 1 from public.stage_triggers t
          join public.deals d on d.organization_id = t.organization_id and d.stage_id = t.stage_id
        where t.id = x.trigger_id and d.id = x.deal_id and d.archived_at is null)
    limit batch);
  get diagnostics n = row_count;
  purged := purged || jsonb_build_object('stage_trigger_runs', n);

  delete from public.lead_submissions s
  where s.id in (
    select x.id from public.lead_submissions x
    where x.created_at < now() - make_interval(days => lead_days)
    limit batch);
  get diagnostics n = row_count;
  purged := purged || jsonb_build_object('lead_submissions', n);

  if to_regclass('net._http_response') is not null then
    begin
      execute format('delete from net._http_response where created < now() - interval %L', http_days || ' days');
      get diagnostics n = row_count;
      purged := purged || jsonb_build_object('http_responses', n);
    exception when others then
      purged := purged || jsonb_build_object('http_responses', null);
    end;
  end if;
  return purged;
end;
$$;


--
-- Data of the existing clinics
--

-- The medical data moves to patient_medical; an IIN already shared by two
-- patients of a clinic stays on each (iin_duplicate on all but the oldest):
-- the duplicates page proposes to merge them (reason «iin»)
insert into public.patient_medical (organization_id, patient_id, iin, iin_duplicate, allergies, contraindications, chronic_diseases, updated_by)
select p.organization_id, p.id, p.iin,
    p.iin is not null and row_number() over (partition by p.organization_id, p.iin order by p.id) > 1,
    p.allergies, p.contraindications, p.chronic_diseases, null
from public.patients p
where p.iin is not null or p.allergies is not null or p.contraindications is not null or p.chronic_diseases is not null;

-- The patients rows keep null (no audit entry: nothing changed for the user)
alter table public.patients disable trigger audit_patient_card;
alter table public.patients disable trigger audit_patient_medical;
update public.patients
set iin = null, allergies = null, contraindications = null, chronic_diseases = null
where iin is not null or allergies is not null or contraindications is not null or chronic_diseases is not null;

-- Card numbers: a patient without one keeps the number the card showed (the
-- CRM id); the counter of each clinic continues after its highest number
update public.patients set card_number = id::text where card_number is null;
alter table public.patients enable trigger audit_patient_card;
alter table public.patients enable trigger audit_patient_medical;
insert into public.patient_card_counters (organization_id, last_number)
select p.organization_id, max(p.card_number::bigint)
from public.patients p
where p.card_number ~ '^[0-9]{1,15}$'
group by p.organization_id;

--
-- Views
--

-- patients_summary (19, 29, 37) with the medical data from patient_medical
-- (null for the integrator) and the archive at the end
create or replace view public.patients_summary with (security_invoker = on) as
select
    p.id,
    p.organization_id,
    p.first_name,
    p.last_name,
    p.middle_name,
    p.phone_jsonb,
    p.phones,
    p.birth_date,
    p.city,
    p.whatsapp,
    p.instagram,
    p.telegram,
    p.source_id,
    p.tags,
    p.sales_id,
    p.gender,
    p.avatar,
    p.background,
    p.status,
    p.first_seen,
    p.last_seen,
    array_to_string(p.phones, ' ') as phone_fts,
    (
        select count(*)
        from public.deals d
        where d.organization_id = p.organization_id and d.patient_id = p.id
    ) as nb_deals,
    (
        select count(*)
        from public.deals d
            join public.stages s on s.id = d.stage_id
        where d.organization_id = p.organization_id and d.patient_id = p.id and s.kind = 'open'
    ) as nb_open_deals,
    (
        select count(*)
        from public.tasks t
            join public.deals d on d.organization_id = t.organization_id and d.id = t.deal_id
        where d.organization_id = p.organization_id and d.patient_id = p.id and t.done_date is null
    ) as nb_tasks,
    p.custom_values,
    m.allergies,
    m.contraindications,
    m.chronic_diseases,
    p.preferred_doctor_id,
    m.iin,
    p.card_number,
    p.archived_at,
    p.archived_by
from public.patients p
    left join public.patient_medical m on m.organization_id = p.organization_id and m.patient_id = p.id;

--
-- Indexes of hot paths
--

-- «История» of the patient card: the messages of a patient by date
create index messages_patient_id_idx on public.messages using btree (organization_id, patient_id, sent_at desc);
-- Foreign keys set to null when a visit or a deal is deleted
create index account_operations_visit_id_idx on public.account_operations using btree (organization_id, visit_id) where visit_id is not null;
create index lab_orders_deal_id_idx on public.lab_orders using btree (organization_id, deal_id) where deal_id is not null;

--
-- Triggers
--

create or replace trigger patient_archive
    before update of archived_at, archived_by on public.patients
    for each row execute function private.handle_patient_archive();

create or replace trigger patient_before_delete
    before delete on public.patients
    for each row execute function private.handle_patient_before_delete();

create or replace trigger deal_before_delete
    before delete on public.deals
    for each row execute function private.handle_deal_before_delete();

create or replace trigger account_operation_shift_lock
    before update or delete on public.account_operations
    for each row execute function private.handle_account_operation_shift_lock();

-- After patient_iin (37), which checks the IIN and fills the birth date
create or replace trigger patient_medical_insert
    before insert on public.patients
    for each row execute function private.handle_patient_medical_transit();

create or replace trigger patient_medical_iin
    before update of iin on public.patients
    for each row execute function private.handle_patient_medical_transit('iin');

create or replace trigger patient_medical_allergies
    before update of allergies on public.patients
    for each row execute function private.handle_patient_medical_transit('allergies');

create or replace trigger patient_medical_contraindications
    before update of contraindications on public.patients
    for each row execute function private.handle_patient_medical_transit('contraindications');

create or replace trigger patient_medical_chronic_diseases
    before update of chronic_diseases on public.patients
    for each row execute function private.handle_patient_medical_transit('chronic_diseases');

create or replace trigger assign_patient_card_number
    before insert on public.patients
    for each row execute function private.handle_patient_card_number();

-- Audit log (group «Пациенты»): the medical data of the patient
create or replace trigger audit_patient_medical_data
    after insert or update or delete on public.patient_medical
    for each row execute function private.audit_row('patient', 'iin,allergies,contraindications,chronic_diseases');

--
-- Row Level Security
--

alter table public.patient_medical enable row level security;
alter table public.patient_card_counters enable row level security;

-- Whoever sees the patient, never the integrator; written through patients
create policy "Medical data of visible patients can be read" on public.patient_medical for select to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head', 'manager')
        and exists (select 1 from public.patients p where p.organization_id = patient_medical.organization_id and p.id = patient_medical.patient_id));

--
-- Storage: note attachments, avatars and logos in a private bucket (read
-- through signed links, the policies of 07_storage.sql)
--

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do update set public = false;

--
-- Grants
--

revoke all on table public.patient_medical from anon, authenticated;
grant select on table public.patient_medical to authenticated;
grant all on table public.patient_medical to service_role;

revoke all on table public.patient_card_counters from anon, authenticated;
grant all on table public.patient_card_counters to service_role;

revoke all on function private.handle_patient_archive() from public;
revoke all on function private.patient_has_history(bigint, bigint) from public;
grant execute on function private.patient_has_history(bigint, bigint) to service_role;
revoke all on function private.handle_patient_before_delete() from public;
revoke all on function private.handle_deal_before_delete() from public;
revoke all on function private.handle_account_operation_shift_lock() from public;
revoke all on function private.save_patient_medical(bigint, bigint, jsonb) from public;
grant execute on function private.save_patient_medical(bigint, bigint, jsonb) to service_role;
revoke all on function private.handle_patient_medical_transit() from public;
revoke all on function private.next_card_number(bigint) from public;
grant execute on function private.next_card_number(bigint) to service_role;
revoke all on function private.handle_patient_card_number() from public;
revoke all on function private.retention_tick() from public;
grant execute on function private.retention_tick() to service_role;

-- Retention every night (pg_cron; skipped where it is not installed, e.g.
-- the SQL tests)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('retention-daily', '40 2 * * *', 'select private.retention_tick()');
  end if;
end;
$$;

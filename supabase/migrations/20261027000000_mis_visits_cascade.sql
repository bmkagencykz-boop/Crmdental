-- Visits of the MIS stay read-only for direct edits only: removing a patient,
-- a deal, a service or a clinic cascades to them, and merging two patients
-- moves them to the kept one.

-- from supabase/schemas/28_schedule.sql
CREATE OR REPLACE FUNCTION "private"."handle_visit_before_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  syncing boolean := coalesce(current_setting('crm.visit_sync', true), '') = 'on';
  -- A cascade (a patient, deal, service or clinic removed) is not an edit
  cascading boolean := pg_trigger_depth() > 1;
  busy public.visits;
begin
  if tg_op = 'DELETE' then
    if old.source = 'mis' and not syncing and not cascading then
      raise exception 'Запись ведётся в МИС' using errcode = '42501', hint = 'visit_mis_readonly';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.source = 'mis' and not syncing then
      raise exception 'Записи МИС приходят только из МИС' using errcode = '42501', hint = 'visit_mis_readonly';
    end if;
    if new.source = 'crm' and not syncing and private.schedule_mis_kind(new.organization_id) is not null then
      raise exception 'Запись ведётся в МИС' using errcode = '42501', hint = 'visit_mis_mode';
    end if;
    new.created_by := coalesce(new.created_by, private.current_sales_id());
    new.created_at := now();
    new.updated_at := now();
    new.status_changed_at := now();
  else
    if old.source = 'mis' and not syncing and not cascading then
      raise exception 'Запись ведётся в МИС' using errcode = '42501', hint = 'visit_mis_readonly';
    end if;
    new.source := old.source;
    new.external_id := old.external_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
    if new.status is distinct from old.status then
      new.status_changed_at := now();
    end if;
  end if;

  if new.deal_id is not null and not exists (
    select 1 from public.deals d
    where d.organization_id = new.organization_id and d.id = new.deal_id and d.patient_id = new.patient_id
  ) then
    raise exception 'Сделка другого пациента' using errcode = '23514', hint = 'visit_deal_patient';
  end if;

  if new.source = 'crm' and new.status not in ('cancelled', 'no_show') then
    if new.doctor_id is not null then
      select v.* into busy from public.visits v
      where v.organization_id = new.organization_id and v.id <> new.id and v.source = 'crm'
        and v.doctor_id = new.doctor_id and v.status not in ('cancelled', 'no_show')
        and tstzrange(v.starts_at, v.ends_at) && tstzrange(new.starts_at, new.ends_at)
      order by v.starts_at
      limit 1;
      if busy.id is not null then
        raise exception 'Врач уже занят: %–%',
          private.schedule_time_label(new.organization_id, busy.starts_at),
          right(private.schedule_time_label(new.organization_id, busy.ends_at), 5)
          using errcode = '23P01', hint = 'visit_doctor_busy';
      end if;
    end if;
    if new.chair_id is not null then
      select v.* into busy from public.visits v
      where v.organization_id = new.organization_id and v.id <> new.id and v.source = 'crm'
        and v.chair_id = new.chair_id and v.status not in ('cancelled', 'no_show')
        and tstzrange(v.starts_at, v.ends_at) && tstzrange(new.starts_at, new.ends_at)
      order by v.starts_at
      limit 1;
      if busy.id is not null then
        raise exception 'Кресло уже занято: %–%',
          private.schedule_time_label(new.organization_id, busy.starts_at),
          right(private.schedule_time_label(new.organization_id, busy.ends_at), 5)
          using errcode = '23P01', hint = 'visit_chair_busy';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- from supabase/schemas/18_unsorted_duplicates.sql
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
      messaging_opt_out_at = coalesce(keep_row.messaging_opt_out_at, merge_row.messaging_opt_out_at),
      -- The light patient card (stage 29): nothing medical is lost
      allergies = private.merge_note_text(keep_row.allergies, merge_row.allergies),
      contraindications = private.merge_note_text(keep_row.contraindications, merge_row.contraindications),
      chronic_diseases = private.merge_note_text(keep_row.chronic_diseases, merge_row.chronic_diseases),
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

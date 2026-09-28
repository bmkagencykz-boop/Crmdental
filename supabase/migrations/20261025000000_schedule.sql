--
-- Stage 28: the appointment schedule «Расписание».
-- Same statements as supabase/schemas/28_schedule.sql, plus the notification
-- kind visit_reschedule (16_notifications.sql) and the data: settings, tag
-- and confirmation template of the existing clinics, the MIS appointments
-- already synced.
--

--
-- Notification kind visit_reschedule (16_notifications.sql)
--

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
    check (kind in ('lead_assigned', 'patient_message', 'task_overdue', 'response_overdue', 'bot_handoff', 'visit_reschedule'));
alter table public.notification_preferences drop constraint notification_preferences_kinds_check;
alter table public.notification_preferences add constraint notification_preferences_kinds_check
    check (kinds <@ array['lead_assigned', 'patient_message', 'task_overdue', 'response_overdue', 'bot_handoff', 'visit_reschedule']);
alter table public.notification_preferences alter column kinds set default array['lead_assigned', 'patient_message', 'task_overdue', 'response_overdue', 'bot_handoff', 'visit_reschedule'];

CREATE OR REPLACE FUNCTION "public"."get_notification_preferences"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  me bigint := private.current_sales_id();
  prefs public.notification_preferences;
begin
  if me is null then
    raise exception 'Not an employee' using errcode = '42501';
  end if;
  select * into prefs from public.notification_preferences p where p.sales_id = me;
  return jsonb_build_object(
    'kinds', to_jsonb(coalesce(prefs.kinds, array['lead_assigned', 'patient_message', 'task_overdue', 'response_overdue', 'bot_handoff', 'visit_reschedule'])),
    'browser_enabled', coalesce(prefs.browser_enabled, false),
    'telegram_enabled', coalesce(prefs.telegram_enabled, true),
    'telegram_linked', prefs.telegram_chat_id is not null,
    'telegram_username', prefs.telegram_username,
    'telegram_link_code', case when prefs.telegram_link_expires_at > now() then prefs.telegram_link_code end,
    'telegram_link_expires_at', case when prefs.telegram_link_expires_at > now() then prefs.telegram_link_expires_at end
  );
end;
$$;

--
-- Appointment schedule «Расписание» (stage 28): a light, sales-oriented
-- appointment book, not a classic MIS schedule.
--
-- Resources:
--   public.chairs              dictionary «Кресла» of the clinic
--   doctors.working_hours      weekly template of a doctor, ISO weekday
--                              "1" (Monday) … "7" (Sunday) →
--                              { "start": "09:00", "end": "18:00",
--                                "breaks": [{ "start": "13:00", "end": "14:00" }] }
--                              a missing weekday is a day off; an empty
--                              object means "not set": the clinic hours apply
--   doctors.visit_minutes      default duration of a visit
--   public.doctor_exceptions   a date off (no hours) or custom hours of a day
--   public.schedule_settings   clinic hours of the grid, the status → deal
--                              mapping, the keywords of the confirmation
--                              replies (one row per clinic)
-- Hours only warn (the app, schedule/scheduleLayout.ts): a visit outside the
-- doctor's hours is saved.
--
-- public.visits: a visit of a patient, optionally of a deal, with a doctor,
-- a chair and a service. Two active visits (not cancelled, not missed) never
-- overlap for one doctor or one chair: a friendly check in the BEFORE
-- trigger (the message names the busy time) and exclusion constraints
-- (btree_gist) against races.
--
-- A visit drives its deal (AFTER trigger, private.visit_apply_status):
--   * deals.appointment_at = the next scheduled / confirmed visit (a
--     cancelled one frees the date), deals.doctor_id and service_id when
--     empty; «Пришёл» (and «Приём завершён») set deals.visit_at;
--   * the status moves the deal by the mapping of Settings → Расписание:
--     { "<status>": { "stage_id", "tag_id", "task" } }. By default
--     scheduled / confirmed → «Записан», arrived → «Пришёл на консультацию»,
--     no_show → tag «Не пришёл» + a call-back task, cancelled → a task
--     «Перезаписать» (a stage, e.g. «В работе», can be chosen). A stage move
--     goes forward only, except for cancelled / no_show (back to work); it
--     respects the stage checklist and never refuses nor reopens a deal, like
--     the digital pipeline and the MIS mapping; a blocked move is skipped
--     and written to the deal feed (stage_trigger_runs «Расписание»).
--
-- MIS mode: when Dentist Plus or MacDent syncs appointments, every row of
-- public.mis_appointments is mirrored into public.visits with source 'mis'
-- (one table for the grid, the deal, the patient card and the dashboard).
-- Those rows are read-only («Запись ведётся в МИС»), new CRM visits are
-- refused, and the MIS moves the deal itself (27_mis_connectors.sql).
--
-- Confirmation by WhatsApp: a default auto-message «Подтверждение записи»
-- (off) the day before the visit; an inbound reply «1» / «да» /
-- «подтверждаю» confirms the patient's scheduled visit of the next 48 hours,
-- «2» / «перенести» creates a task «Перенести запись» and notifies the
-- responsible. A salesbot waiting on the deal handles the reply instead.
--
-- Rights: visits follow their deal (a manager sees the visits of the deals
-- they see, and those without a deal); every employee books, the owner and
-- the head delete; the integrator only reads. Chairs, hours and the mapping:
-- private.can_configure() (owner, head, integrator).
--

create extension if not exists "btree_gist" with schema "extensions";

--
-- Tables
--

create table public.chairs (
    id bigint generated by default as identity primary key,
    organization_id bigint not null default private.current_organization_id(),
    name text not null,
    is_active boolean not null default true,
    position integer not null default 0,
    created_at timestamp with time zone not null default now(),
    constraint chairs_name_not_blank check (btrim(name) <> '')
);

alter table public.doctors add column working_hours jsonb not null default '{}'::jsonb;
alter table public.doctors add column visit_minutes integer not null default 30;
alter table public.doctors add constraint doctors_working_hours_is_object check (jsonb_typeof(working_hours) = 'object');
alter table public.doctors add constraint doctors_visit_minutes_check check (visit_minutes between 5 and 480);

-- A day of a doctor that differs from the weekly template: off (no hours)
-- or custom hours
create table public.doctor_exceptions (
    id bigint generated by default as identity primary key,
    organization_id bigint not null default private.current_organization_id(),
    doctor_id bigint not null,
    day date not null,
    start_time time without time zone,
    end_time time without time zone,
    note text,
    created_at timestamp with time zone not null default now(),
    constraint doctor_exceptions_day_key unique (doctor_id, day),
    constraint doctor_exceptions_hours_check check (
        (start_time is null and end_time is null) or (start_time is not null and end_time is not null and end_time > start_time))
);

-- Clinic hours of the grid, mapping and confirmation keywords
create table public.schedule_settings (
    organization_id bigint primary key,
    hours_start time without time zone not null default '09:00:00',
    hours_end time without time zone not null default '21:00:00',
    -- { "<visit status>": { "stage_id": …, "tag_id": …, "task": "…" } }
    status_map jsonb not null default '{}'::jsonb,
    confirm_keywords text[] not null default array['1', 'да', 'подтверждаю'],
    reschedule_keywords text[] not null default array['2', 'перенести', 'перенос'],
    updated_at timestamp with time zone not null default now(),
    constraint schedule_settings_hours_check check (hours_end > hours_start),
    constraint schedule_settings_status_map_is_object check (jsonb_typeof(status_map) = 'object')
);

create table public.visits (
    id bigint generated by default as identity primary key,
    organization_id bigint not null default private.current_organization_id(),
    patient_id bigint not null,
    deal_id bigint,
    doctor_id bigint,
    chair_id bigint,
    service_id bigint,
    starts_at timestamp with time zone not null,
    ends_at timestamp with time zone not null,
    status text not null default 'scheduled',
    note text,
    -- crm: booked in the CRM; mis: mirrored from public.mis_appointments
    source text not null default 'crm',
    -- MIS visits: "<kind>:<id in the MIS>"
    external_id text,
    created_by bigint,
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now(),
    -- When the status last changed (confirmed by the patient, arrived…)
    status_changed_at timestamp with time zone,
    constraint visits_status_check check (status in ('scheduled', 'confirmed', 'arrived', 'no_show', 'cancelled', 'completed')),
    constraint visits_source_check check (source in ('crm', 'mis')),
    constraint visits_time_check check (ends_at > starts_at),
    constraint visits_duration_check check (ends_at <= starts_at + interval '12 hours'),
    constraint visits_note_length_check check (note is null or char_length(note) <= 2000)
);

alter table public.chairs add constraint chairs_organization_id_id_key unique (organization_id, id);
alter table public.doctor_exceptions add constraint doctor_exceptions_organization_id_id_key unique (organization_id, id);
alter table public.visits add constraint visits_organization_id_id_key unique (organization_id, id);

-- Active visits of the CRM never overlap for a doctor or a chair
alter table public.visits add constraint visits_doctor_overlap
    exclude using gist (doctor_id with =, tstzrange(starts_at, ends_at) with &&)
    where (source = 'crm' and doctor_id is not null and status not in ('cancelled', 'no_show'));
alter table public.visits add constraint visits_chair_overlap
    exclude using gist (chair_id with =, tstzrange(starts_at, ends_at) with &&)
    where (source = 'crm' and chair_id is not null and status not in ('cancelled', 'no_show'));

alter table public.chairs
    add constraint chairs_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade;
alter table public.doctor_exceptions
    add constraint doctor_exceptions_doctor_id_fkey foreign key (organization_id, doctor_id) references public.doctors(organization_id, id) on delete cascade;
alter table public.schedule_settings
    add constraint schedule_settings_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade;
alter table public.visits
    add constraint visits_patient_id_fkey foreign key (organization_id, patient_id) references public.patients(organization_id, id) on delete cascade;
alter table public.visits
    add constraint visits_deal_id_fkey foreign key (organization_id, deal_id) references public.deals(organization_id, id) on delete set null (deal_id);
alter table public.visits
    add constraint visits_doctor_id_fkey foreign key (organization_id, doctor_id) references public.doctors(organization_id, id);
alter table public.visits
    add constraint visits_chair_id_fkey foreign key (organization_id, chair_id) references public.chairs(organization_id, id);
alter table public.visits
    add constraint visits_service_id_fkey foreign key (organization_id, service_id) references public.services(organization_id, id) on delete set null (service_id);
alter table public.visits
    add constraint visits_created_by_fkey foreign key (organization_id, created_by) references public.sales(organization_id, id) on delete set null (created_by);

create index chairs_organization_id_idx on public.chairs using btree (organization_id, position);
create index visits_starts_at_idx on public.visits using btree (organization_id, starts_at);
create index visits_patient_id_idx on public.visits using btree (organization_id, patient_id, starts_at desc);
create index visits_deal_id_idx on public.visits using btree (organization_id, deal_id) where deal_id is not null;
create unique index visits_external_id_idx on public.visits using btree (organization_id, external_id) where source = 'mis';

--
-- Helpers
--

-- The clinic books through its MIS: Dentist Plus or MacDent connected with
-- the appointments sync on. Returns the kind, null otherwise.
CREATE OR REPLACE FUNCTION "private"."schedule_mis_kind"("org_id" bigint) RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  return (
    select i.kind from public.integrations i
    where i.organization_id = org_id and i.kind in ('dentist_plus', 'macdent')
      and i.status in ('connected', 'error') and i.sync_appointments
    order by i.connected_at desc nulls last, i.id
    limit 1
  );
end;
$$;

-- A tag of the clinic by name (case-insensitive), created on first use
CREATE OR REPLACE FUNCTION "private"."schedule_tag"("org_id" bigint, "tag_name" "text") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  found_id bigint;
  clean_name text := nullif(btrim(tag_name), '');
begin
  if clean_name is null then
    return null;
  end if;
  select t.id into found_id from public.tags t
  where t.organization_id = org_id and private.salesbot_normalize(btrim(t.name)) = private.salesbot_normalize(clean_name)
  order by t.id limit 1;
  if found_id is null then
    insert into public.tags (organization_id, name, color)
    values (org_id, clean_name, '#f8b4c6')
    returning id into found_id;
  end if;
  return found_id;
end;
$$;

-- Default mapping: the stages of the clinic template found by name (default
-- pipeline first), the tag «Не пришёл» (created when first needed) and the
-- tasks
CREATE OR REPLACE FUNCTION "private"."schedule_default_status_map"("org_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  result jsonb;
begin
  select coalesce(jsonb_object_agg(m.status, jsonb_build_object('stage_id', found.id)), '{}'::jsonb)
  into result
  from (values
    ('scheduled', 'Записан'),
    ('confirmed', 'Записан'),
    ('arrived', 'Пришёл на консультацию')
  ) as m(status, stage_name)
    cross join lateral (
      select s.id
      from public.stages s
        join public.pipelines p on p.id = s.pipeline_id
      where p.organization_id = org_id and s.name = m.stage_name and s.kind <> 'lost'
      order by p.is_default desc, p.position, p.id, s.position
      limit 1
    ) as found;
  return result || jsonb_build_object(
    'no_show', jsonb_build_object('tag', 'Не пришёл', 'task', 'Перезвонить: пациент не пришёл на приём'),
    'cancelled', jsonb_build_object('task', 'Перезаписать'));
end;
$$;

-- The settings row of a clinic, created with the defaults when missing
CREATE OR REPLACE FUNCTION "private"."schedule_settings_of"("org_id" bigint) RETURNS "public"."schedule_settings"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  settings public.schedule_settings;
begin
  select * into settings from public.schedule_settings s where s.organization_id = org_id;
  if found or not exists (select 1 from public.organizations o where o.id = org_id) then
    return settings;
  end if;
  insert into public.schedule_settings (organization_id, hours_start, hours_end, status_map)
  select org_id,
    make_time(coalesce(os.response_hours_start, 9), 0, 0),
    case when coalesce(os.response_hours_end, 21) >= 24 then time '23:45'
      else make_time(coalesce(os.response_hours_end, 21), 0, 0) end,
    private.schedule_default_status_map(org_id)
  from (select 1) as one
    left join public.organization_settings os on os.organization_id = org_id
  on conflict (organization_id) do nothing;
  select * into settings from public.schedule_settings s where s.organization_id = org_id;
  return settings;
end;
$$;

-- A mapping sent by the settings, checked: known statuses, a stage of the
-- clinic that is not a refusal (a refusal needs a reason), a tag of the
-- clinic (tag_id) or a tag name (tag, created when first needed), a task
-- text of up to 500 characters
CREATE OR REPLACE FUNCTION "private"."schedule_clean_status_map"("org_id" bigint, "status_map" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  entry record;
  stage_value bigint;
  tag_value bigint;
  task_value text;
  tag_name text;
  cleaned jsonb;
  result jsonb := '{}'::jsonb;
begin
  if status_map is null or jsonb_typeof(status_map) <> 'object' then
    raise exception 'Сопоставление статусов — объект' using errcode = '22023';
  end if;
  for entry in select e.key, e.value from jsonb_each(status_map) as e loop
    if entry.key not in ('scheduled', 'confirmed', 'arrived', 'no_show', 'cancelled', 'completed') then
      raise exception 'Неизвестный статус записи: %', entry.key using errcode = '22023';
    end if;
    if jsonb_typeof(entry.value) <> 'object' then
      continue;
    end if;
    cleaned := '{}'::jsonb;
    stage_value := nullif(entry.value ->> 'stage_id', '')::bigint;
    tag_value := nullif(entry.value ->> 'tag_id', '')::bigint;
    task_value := nullif(btrim(entry.value ->> 'task'), '');
    tag_name := nullif(btrim(entry.value ->> 'tag'), '');
    if stage_value is not null then
      if not exists (
        select 1 from public.stages s
        where s.organization_id = org_id and s.id = stage_value and s.kind <> 'lost'
      ) then
        raise exception 'Этап для статуса «%» не найден или это этап отказа', entry.key using errcode = '22023';
      end if;
      cleaned := cleaned || jsonb_build_object('stage_id', stage_value);
    end if;
    if tag_value is not null then
      if not exists (select 1 from public.tags t where t.organization_id = org_id and t.id = tag_value) then
        raise exception 'Тег для статуса «%» не найден', entry.key using errcode = '22023';
      end if;
      cleaned := cleaned || jsonb_build_object('tag_id', tag_value);
    elsif tag_name is not null then
      cleaned := cleaned || jsonb_build_object('tag', left(tag_name, 50));
    end if;
    if task_value is not null then
      cleaned := cleaned || jsonb_build_object('task', left(task_value, 500));
    end if;
    result := result || jsonb_build_object(entry.key, cleaned);
  end loop;
  return result;
end;
$$;

-- "HH:MM" of a working-hours template, as minutes after midnight
CREATE OR REPLACE FUNCTION "private"."schedule_minutes"("value" "text") RETURNS integer
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
begin
  if value is null or value !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Время в формате ЧЧ:ММ: %', coalesce(value, '—') using errcode = '22023';
  end if;
  return split_part(value, ':', 1)::integer * 60 + split_part(value, ':', 2)::integer;
end;
$$;

-- A weekly template sent by the settings, checked and normalised (see the
-- header): weekdays "1"…"7", start before end, breaks inside the day
CREATE OR REPLACE FUNCTION "private"."schedule_clean_hours"("hours" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
declare
  entry record;
  pause jsonb;
  day_start integer;
  day_end integer;
  pause_start integer;
  pause_end integer;
  breaks jsonb;
  result jsonb := '{}'::jsonb;
begin
  if hours is null or jsonb_typeof(hours) <> 'object' then
    raise exception 'Часы работы — объект' using errcode = '22023';
  end if;
  for entry in select e.key, e.value from jsonb_each(hours) as e loop
    if entry.key not in ('1', '2', '3', '4', '5', '6', '7') then
      raise exception 'День недели от 1 до 7: %', entry.key using errcode = '22023';
    end if;
    if jsonb_typeof(entry.value) <> 'object' then
      continue;
    end if;
    day_start := private.schedule_minutes(entry.value ->> 'start');
    day_end := private.schedule_minutes(entry.value ->> 'end');
    if day_end <= day_start then
      raise exception 'Конец рабочего дня раньше начала' using errcode = '22023';
    end if;
    breaks := '[]'::jsonb;
    if jsonb_typeof(entry.value -> 'breaks') = 'array' then
      for pause in select * from jsonb_array_elements(entry.value -> 'breaks') loop
        pause_start := private.schedule_minutes(pause ->> 'start');
        pause_end := private.schedule_minutes(pause ->> 'end');
        if pause_end <= pause_start or pause_start < day_start or pause_end > day_end then
          raise exception 'Перерыв вне рабочего дня' using errcode = '22023';
        end if;
        breaks := breaks || jsonb_build_array(jsonb_build_object('start', pause ->> 'start', 'end', pause ->> 'end'));
      end loop;
    end if;
    result := result || jsonb_build_object(entry.key,
      jsonb_build_object('start', entry.value ->> 'start', 'end', entry.value ->> 'end', 'breaks', breaks));
  end loop;
  return result;
end;
$$;

-- "12:30" of a moment in the time zone of the clinic
CREATE OR REPLACE FUNCTION "private"."schedule_time_label"("org_id" bigint, "value" timestamp with time zone) RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  return to_char(value at time zone coalesce(
    (select nullif(o.timezone, '') from public.organizations o where o.id = org_id), 'Asia/Almaty'), 'DD.MM HH24:MI');
end;
$$;

--
-- Deal linkage
--

-- deals.appointment_at = the next scheduled or confirmed visit of the deal
-- (else the latest one not marked yet). Without such a visit, a date that
-- was one of the deal's visits (freed_at: the visit just changed) is freed;
-- a date set by hand without visit stays.
CREATE OR REPLACE FUNCTION "private"."sync_deal_appointment"("org_id" bigint, "target_deal_id" bigint, "freed_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  deal public.deals;
  next_at timestamp with time zone;
begin
  if target_deal_id is null then
    return;
  end if;
  select * into deal from public.deals d where d.organization_id = org_id and d.id = target_deal_id;
  if not found then
    return;
  end if;
  select v.starts_at into next_at from public.visits v
  where v.organization_id = org_id and v.deal_id = deal.id and v.source = 'crm'
    and v.status in ('scheduled', 'confirmed') and v.ends_at > now()
  order by v.starts_at, v.id
  limit 1;
  if next_at is null then
    select max(v.starts_at) into next_at from public.visits v
    where v.organization_id = org_id and v.deal_id = deal.id and v.source = 'crm'
      and v.status in ('scheduled', 'confirmed');
  end if;
  if next_at is null then
    if deal.appointment_at is null or not (
      deal.appointment_at = freed_at
      or exists (
        select 1 from public.visits v
        where v.organization_id = org_id and v.deal_id = deal.id and v.starts_at = deal.appointment_at
      )
    ) then
      return;
    end if;
  end if;
  if deal.appointment_at is distinct from next_at then
    update public.deals d set appointment_at = next_at
    where d.organization_id = org_id and d.id = deal.id;
  end if;
end;
$$;

-- What a status of a visit does to its deal (see the header): the stage of
-- the mapping (forward only, except for cancelled / no_show), the tag, the
-- task. A move refused by the deal rules (checklist) is skipped; done and
-- skipped moves go to the deal feed. Returns what happened.
CREATE OR REPLACE FUNCTION "private"."visit_apply_status"("visit" "public"."visits", "status_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  org_id bigint := visit.organization_id;
  entry jsonb;
  deal public.deals;
  target_stage public.stages;
  current_stage public.stages;
  tag_value bigint;
  task_text text;
  reason text;
  label text := 'Расписание';
  event_key text := 'visit:' || visit.id || ':' || status_key;
  result jsonb := jsonb_build_object('moved', false);
begin
  if visit.deal_id is null then
    return result;
  end if;
  entry := (private.schedule_settings_of(org_id)).status_map -> status_key;
  if entry is null or jsonb_typeof(entry) <> 'object' then
    return result;
  end if;
  select * into deal from public.deals d where d.organization_id = org_id and d.id = visit.deal_id;
  if not found or deal.archived_at is not null or deal.unsorted_at is not null then
    return result;
  end if;
  select * into current_stage from public.stages s where s.id = deal.stage_id;

  if nullif(entry ->> 'stage_id', '') is not null then
    select * into target_stage from public.stages s
    where s.organization_id = org_id and s.id = (entry ->> 'stage_id')::bigint;
    -- A deal of another pipeline: the stage of the same name there
    if target_stage.id is not null and target_stage.pipeline_id <> deal.pipeline_id then
      select * into target_stage from public.stages s
      where s.organization_id = org_id and s.pipeline_id = deal.pipeline_id
        and s.name = target_stage.name and s.kind <> 'lost'
      order by s.position
      limit 1;
    end if;
    if target_stage.id is null or target_stage.id = deal.stage_id then
      null;
    elsif status_key not in ('cancelled', 'no_show') and target_stage.position <= current_stage.position then
      -- The deal is already further
      null;
    else
      if current_stage.kind <> 'open' then
        reason := 'Сделка закрыта';
      elsif target_stage.kind = 'lost' then
        reason := 'Перевод в отказ требует причины';
      else
        begin
          update public.deals d set stage_id = target_stage.id
          where d.organization_id = org_id and d.id = deal.id;
        exception when others then
          get stacked diagnostics reason = message_text;
        end;
      end if;
      insert into public.stage_trigger_runs (organization_id, deal_id, trigger_id, trigger_name, event, event_key, action, status, details, error)
      values (org_id, deal.id, null, label, 'visit', event_key, 'move_stage',
        case when reason is null then 'done' else 'skipped' end,
        jsonb_build_object('from_stage_id', deal.stage_id, 'to_stage_id', target_stage.id, 'visit_id', visit.id),
        left(reason, 500));
      result := result || jsonb_build_object('moved', reason is null, 'skipped', reason is not null,
        'reason', reason, 'to_stage_id', target_stage.id);
    end if;
  end if;

  tag_value := coalesce(nullif(entry ->> 'tag_id', '')::bigint, private.schedule_tag(org_id, entry ->> 'tag'));
  if tag_value is not null and exists (select 1 from public.tags t where t.organization_id = org_id and t.id = tag_value) then
    select * into deal from public.deals d where d.organization_id = org_id and d.id = visit.deal_id;
    if not tag_value = any(deal.tags) then
      update public.deals d set tags = array_append(d.tags, tag_value)
      where d.organization_id = org_id and d.id = deal.id;
      insert into public.stage_trigger_runs (organization_id, deal_id, trigger_id, trigger_name, event, event_key, action, status, details)
      values (org_id, deal.id, null, label, 'visit', event_key, 'add_tag', 'done',
        jsonb_build_object('tag_id', tag_value, 'visit_id', visit.id));
    end if;
    result := result || jsonb_build_object('tag_id', tag_value);
  end if;

  task_text := nullif(btrim(entry ->> 'task'), '');
  if task_text is not null and not exists (
    select 1 from public.tasks t
    where t.organization_id = org_id and t.deal_id = deal.id and t.done_date is null and t.text = task_text
  ) then
    insert into public.tasks (organization_id, deal_id, type, text, due_date, sales_id)
    values (org_id, deal.id, 'call', task_text, now(), deal.sales_id);
    result := result || jsonb_build_object('task', task_text);
  end if;
  return result;
end;
$$;

--
-- Triggers of the visits
--

-- Checks and bookkeeping: MIS rows are read-only and no CRM visit is booked
-- while the MIS keeps the schedule; the deal belongs to the patient; a
-- friendly message when the doctor or the chair is busy.
CREATE OR REPLACE FUNCTION "private"."handle_visit_before_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  syncing boolean := coalesce(current_setting('crm.visit_sync', true), '') = 'on';
  busy public.visits;
begin
  if tg_op = 'DELETE' then
    if old.source = 'mis' and not syncing then
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
    if old.source = 'mis' and not syncing then
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

-- The deal of a CRM visit: dates, doctor, service, and the status mapping
CREATE OR REPLACE FUNCTION "private"."handle_visit_after_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if current_setting('crm.importing', true) = 'on' then
    return null;
  end if;
  if tg_op = 'DELETE' then
    if old.source = 'crm' then
      perform private.sync_deal_appointment(old.organization_id, old.deal_id, old.starts_at);
    end if;
    return null;
  end if;
  if new.source <> 'crm' then
    return null;
  end if;

  if tg_op = 'UPDATE' and old.deal_id is distinct from new.deal_id then
    perform private.sync_deal_appointment(old.organization_id, old.deal_id, old.starts_at);
  end if;
  if new.deal_id is null then
    return null;
  end if;
  perform private.sync_deal_appointment(new.organization_id, new.deal_id,
    case when tg_op = 'UPDATE' then old.starts_at end);

  -- Doctor and service of the deal, when it has none
  if tg_op = 'INSERT' or old.deal_id is distinct from new.deal_id
    or old.doctor_id is distinct from new.doctor_id or old.service_id is distinct from new.service_id then
    update public.deals d
    set doctor_id = coalesce(d.doctor_id, new.doctor_id),
        service_id = coalesce(d.service_id, new.service_id)
    where d.organization_id = new.organization_id and d.id = new.deal_id
      and ((d.doctor_id is null and new.doctor_id is not null) or (d.service_id is null and new.service_id is not null));
  end if;

  -- «Пришёл», «Приём завершён»: the visit of the deal
  if new.status in ('arrived', 'completed') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    update public.deals d set visit_at = new.starts_at
    where d.organization_id = new.organization_id and d.id = new.deal_id
      and (d.visit_at is null or (new.status = 'arrived' and d.visit_at < new.starts_at));
  end if;

  if tg_op = 'INSERT' or old.status is distinct from new.status then
    perform private.visit_apply_status(new, new.status);
  end if;
  return null;
end;
$$;

--
-- MIS mode: public.mis_appointments mirrored into public.visits
--

CREATE OR REPLACE FUNCTION "private"."mirror_mis_appointment"("appt" "public"."mis_appointments") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  key text := appt.kind || ':' || appt.external_id;
  minutes integer;
  matched_service_id bigint;
  visit_status text := case appt.status when 'in_treatment' then 'completed' else appt.status end;
begin
  perform set_config('crm.visit_sync', 'on', true);
  if appt.starts_at is null then
    delete from public.visits v
    where v.organization_id = appt.organization_id and v.source = 'mis' and v.external_id = key;
    perform set_config('crm.visit_sync', '', true);
    return;
  end if;
  select d.visit_minutes into minutes from public.doctors d
  where d.organization_id = appt.organization_id and d.id = appt.doctor_id;
  if appt.service_name is not null then
    select s.id into matched_service_id from public.services s
    where s.organization_id = appt.organization_id and lower(btrim(s.name)) = lower(btrim(appt.service_name))
    order by s.is_archived, s.position, s.id
    limit 1;
  end if;
  insert into public.visits (organization_id, patient_id, deal_id, doctor_id, service_id, starts_at, ends_at,
    status, note, source, external_id)
  values (appt.organization_id, appt.patient_id, appt.deal_id, appt.doctor_id, matched_service_id, appt.starts_at,
    case when appt.ends_at > appt.starts_at and appt.ends_at <= appt.starts_at + interval '12 hours' then appt.ends_at
      else appt.starts_at + make_interval(mins => coalesce(minutes, 30)) end,
    visit_status,
    nullif(concat_ws(' · ',
      case when matched_service_id is null then appt.service_name end,
      case when appt.doctor_id is null then appt.doctor_name end,
      appt.comment), ''),
    'mis', key)
  on conflict (organization_id, external_id) where source = 'mis' do update
  set patient_id = excluded.patient_id,
      deal_id = excluded.deal_id,
      doctor_id = excluded.doctor_id,
      service_id = excluded.service_id,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      status = excluded.status,
      note = excluded.note;
  perform set_config('crm.visit_sync', '', true);
end;
$$;

CREATE OR REPLACE FUNCTION "private"."handle_mis_appointment_visit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'DELETE' then
    perform set_config('crm.visit_sync', 'on', true);
    delete from public.visits v
    where v.organization_id = old.organization_id and v.source = 'mis' and v.external_id = old.kind || ':' || old.external_id;
    perform set_config('crm.visit_sync', '', true);
    return null;
  end if;
  perform private.mirror_mis_appointment(new);
  return null;
end;
$$;

--
-- Confirmation replies
--

-- Whether a keyword is in a normalised reply: a number only as the first
-- word («1», «2»), a word or a phrase anywhere as whole words
CREATE OR REPLACE FUNCTION "private"."visit_reply_has"("normalized" "text", "keyword" "text") RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
declare
  word text := btrim(regexp_replace(private.salesbot_normalize(keyword), '[^0-9a-zа-яәғқңөұүһі]+', ' ', 'g'));
begin
  if word = '' then
    return false;
  end if;
  if word ~ '^[0-9]+$' then
    return split_part(normalized, ' ', 1) = word;
  end if;
  return position(' ' || word || ' ' in ' ' || normalized || ' ') > 0;
end;
$_$;

-- What a patient's reply means for the visit: 'confirm', 'reschedule' or
-- null. A long message is a conversation, not an answer; a reschedule word
-- wins; «не …» never confirms. Same as parseVisitReply() in
-- schedule/visitReply.ts.
CREATE OR REPLACE FUNCTION "private"."visit_reply_kind"("reply" "text", "confirm_words" "text"[], "reschedule_words" "text"[]) RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
declare
  normalized text := btrim(regexp_replace(private.salesbot_normalize(reply), '[^0-9a-zа-яәғқңөұүһі]+', ' ', 'g'));
  keyword text;
begin
  if normalized = '' or cardinality(string_to_array(normalized, ' ')) > 8 then
    return null;
  end if;
  foreach keyword in array coalesce(reschedule_words, '{}'::text[]) loop
    if private.visit_reply_has(normalized, keyword) then
      return 'reschedule';
    end if;
  end loop;
  if 'не' = any(string_to_array(normalized, ' ')) then
    return null;
  end if;
  foreach keyword in array coalesce(confirm_words, '{}'::text[]) loop
    if private.visit_reply_has(normalized, keyword) then
      return 'confirm';
    end if;
  end loop;
  return null;
end;
$$;

-- An inbound message answering the confirmation: the patient's scheduled
-- visit of the next 48 hours is confirmed, or a task «Перенести запись» and
-- a notification go to the responsible. A salesbot waiting on the deal
-- handles the reply itself. Never refuses the message.
CREATE OR REPLACE FUNCTION "private"."handle_message_visit_reply"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  settings public.schedule_settings;
  reply_kind text;
  visit public.visits;
  deal public.deals;
  task_id bigint;
  task_text text;
  recipient bigint;
begin
  if new.direction <> 'in' or new.patient_id is null or coalesce(btrim(new.text), '') = ''
    or current_setting('crm.importing', true) = 'on' then
    return null;
  end if;
  if new.deal_id is not null and exists (
    select 1 from public.salesbot_sessions s
    where s.organization_id = new.organization_id and s.deal_id = new.deal_id and s.status in ('running', 'waiting')
  ) then
    return null;
  end if;
  begin
    select * into settings from public.schedule_settings s where s.organization_id = new.organization_id;
    if not found then
      return null;
    end if;
    reply_kind := private.visit_reply_kind(new.text, settings.confirm_keywords, settings.reschedule_keywords);
    if reply_kind is null then
      return null;
    end if;
    select v.* into visit from public.visits v
    where v.organization_id = new.organization_id and v.patient_id = new.patient_id and v.source = 'crm'
      and v.status in ('scheduled', 'confirmed')
      and v.starts_at > now() and v.starts_at <= now() + interval '48 hours'
    order by (v.deal_id is not distinct from new.deal_id) desc, v.starts_at, v.id
    limit 1;
    if visit.id is null then
      return null;
    end if;

    if reply_kind = 'confirm' then
      if visit.status = 'scheduled' then
        update public.visits v set status = 'confirmed'
        where v.organization_id = visit.organization_id and v.id = visit.id;
      end if;
      return null;
    end if;

    select * into deal from public.deals d
    where d.organization_id = new.organization_id and d.id = coalesce(visit.deal_id, new.deal_id);
    if deal.id is null then
      return null;
    end if;
    task_text := 'Перенести запись ' || private.schedule_time_label(visit.organization_id, visit.starts_at);
    select t.id into task_id from public.tasks t
    where t.organization_id = deal.organization_id and t.deal_id = deal.id and t.done_date is null and t.text = task_text;
    if task_id is not null then
      return null;
    end if;
    insert into public.tasks (organization_id, deal_id, type, text, due_date, sales_id)
    values (deal.organization_id, deal.id, 'call', task_text, now(), deal.sales_id)
    returning id into task_id;
    if current_setting('crm.notifications', true) is distinct from 'off' then
      for recipient in
        select deal.sales_id where deal.sales_id is not null
        union
        select s.id from public.sales s
        where deal.sales_id is null and s.organization_id = deal.organization_id
          and s.role in ('owner', 'head') and not s.disabled
      loop
        perform private.add_notification(deal.organization_id, recipient, 'visit_reschedule',
          'Пациент просит перенести запись',
          private.deal_label(deal) || ' · ' || private.schedule_time_label(visit.organization_id, visit.starts_at),
          deal.id, deal.patient_id, task_id);
      end loop;
    end if;
  exception when others then
    raise warning 'schedule: reply % not handled: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

--
-- Clinic template
--

-- Settings, the tag «Не пришёл» and the auto-message «Подтверждение записи»
-- (off) of a clinic: 1 day before the visit, on the stage «Записан»
CREATE OR REPLACE FUNCTION "private"."seed_schedule"("org_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  template_id bigint;
begin
  perform private.schedule_settings_of(org_id);
  if exists (
    select 1 from public.message_templates t
    where t.organization_id = org_id and t.name = 'Подтверждение записи'
  ) then
    return;
  end if;
  insert into public.message_templates (organization_id, name, body, position)
  select org_id, 'Подтверждение записи',
    'Здравствуйте, {имя}! Напоминаем о записи {дата_визита} к врачу {врач}. Ответьте 1 — подтверждаю, 2 — нужно перенести.',
    coalesce(max(t.position) + 1, 0)
  from public.message_templates t
  where t.organization_id = org_id
  returning id into template_id;
  insert into public.automessage_rules (organization_id, stage_id, template_id, timing, offset_minutes, mode, is_active, position)
  select org_id, s.id, template_id, 'before_visit', 24 * 60, 'auto', false,
    coalesce((select max(r.position) + 1 from public.automessage_rules r where r.organization_id = org_id), 0)
  from public.stages s
    join public.pipelines p on p.id = s.pipeline_id
  where p.organization_id = org_id and p.is_default and s.name = 'Записан'
  limit 1;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."handle_owner_created_schedule"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform private.seed_schedule(new.organization_id);
  return null;
end;
$$;

--
-- API of the app
--

-- Settings of the schedule for every employee (defaults when never saved),
-- plus the MIS mode: { hours_start, hours_end, status_map, confirm_keywords,
-- reschedule_keywords, mis_kind }
CREATE OR REPLACE FUNCTION "public"."get_schedule_settings"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  org_id bigint := private.current_organization_id();
  settings public.schedule_settings;
begin
  if org_id is null then
    raise exception 'Not an employee' using errcode = '42501';
  end if;
  settings := private.schedule_settings_of(org_id);
  return jsonb_build_object(
    'hours_start', to_char(settings.hours_start, 'HH24:MI'),
    'hours_end', to_char(settings.hours_end, 'HH24:MI'),
    'status_map', settings.status_map,
    'confirm_keywords', to_jsonb(settings.confirm_keywords),
    'reschedule_keywords', to_jsonb(settings.reschedule_keywords),
    'mis_kind', private.schedule_mis_kind(org_id)
  );
end;
$$;

-- Saves the schedule settings (owner, head, integrator). Keys left out stay.
CREATE OR REPLACE FUNCTION "public"."save_schedule_settings"("settings" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  org_id bigint := private.current_organization_id();
  current public.schedule_settings;
  new_start time without time zone;
  new_end time without time zone;
begin
  if org_id is null or not private.can_configure() then
    raise exception 'Only the owner, the head or the integrator configure the schedule' using errcode = '42501';
  end if;
  if settings is null or jsonb_typeof(settings) <> 'object' then
    raise exception 'Настройки — объект' using errcode = '22023';
  end if;
  current := private.schedule_settings_of(org_id);
  new_start := current.hours_start;
  new_end := current.hours_end;
  if settings ? 'hours_start' then
    new_start := make_time(private.schedule_minutes(settings ->> 'hours_start') / 60,
      private.schedule_minutes(settings ->> 'hours_start') % 60, 0);
  end if;
  if settings ? 'hours_end' then
    new_end := make_time(private.schedule_minutes(settings ->> 'hours_end') / 60,
      private.schedule_minutes(settings ->> 'hours_end') % 60, 0);
  end if;
  if new_end <= new_start then
    raise exception 'Конец рабочего дня раньше начала' using errcode = '22023';
  end if;
  update public.schedule_settings s
  set hours_start = new_start,
      hours_end = new_end,
      status_map = case when settings ? 'status_map'
        then private.schedule_clean_status_map(org_id, settings -> 'status_map') else s.status_map end,
      updated_at = now()
  where s.organization_id = org_id;
  if jsonb_typeof(settings -> 'confirm_keywords') = 'array' then
    update public.schedule_settings s
    set confirm_keywords = array(
      select distinct left(btrim(w), 50) from jsonb_array_elements_text(settings -> 'confirm_keywords') as w
      where btrim(w) <> '')
    where s.organization_id = org_id;
  end if;
  if jsonb_typeof(settings -> 'reschedule_keywords') = 'array' then
    update public.schedule_settings s
    set reschedule_keywords = array(
      select distinct left(btrim(w), 50) from jsonb_array_elements_text(settings -> 'reschedule_keywords') as w
      where btrim(w) <> '')
    where s.organization_id = org_id;
  end if;
  return public.get_schedule_settings();
end;
$$;

-- Working hours and default visit duration of a doctor (owner, head,
-- integrator). hours: see the header; null leaves them, {} clears them.
CREATE OR REPLACE FUNCTION "public"."save_doctor_hours"("target_doctor_id" bigint, "hours" "jsonb", "minutes" integer DEFAULT NULL::integer) RETURNS "public"."doctors"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  org_id bigint := private.current_organization_id();
  result public.doctors;
begin
  if org_id is null or not private.can_configure() then
    raise exception 'Only the owner, the head or the integrator configure the schedule' using errcode = '42501';
  end if;
  if minutes is not null and (minutes < 5 or minutes > 480) then
    raise exception 'Длительность визита от 5 до 480 минут' using errcode = '22023';
  end if;
  update public.doctors d
  set working_hours = case when hours is null then d.working_hours else private.schedule_clean_hours(hours) end,
      visit_minutes = coalesce(minutes, d.visit_minutes)
  where d.organization_id = org_id and d.id = target_doctor_id
  returning * into result;
  if result.id is null then
    raise exception 'Врач не найден' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

-- Busy time of the visits the current employee does not see (deals of
-- colleagues): the grid shows «Занято» without any detail
CREATE OR REPLACE FUNCTION "public"."schedule_busy"("from_at" timestamp with time zone, "to_at" timestamp with time zone) RETURNS TABLE("doctor_id" bigint, "chair_id" bigint, "starts_at" timestamp with time zone, "ends_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  org_id bigint := private.current_organization_id();
begin
  if org_id is null then
    raise exception 'Not an employee' using errcode = '42501';
  end if;
  if to_at - from_at > interval '32 days' then
    raise exception 'Слишком большой период' using errcode = '22023';
  end if;
  return query
  select v.doctor_id, v.chair_id, v.starts_at, v.ends_at
  from public.visits v
    join public.deals d on d.organization_id = v.organization_id and d.id = v.deal_id
  where v.organization_id = org_id and v.status not in ('cancelled', 'no_show')
    and v.starts_at < to_at and v.ends_at > from_at
    and not private.deal_visible(d)
  order by v.starts_at;
end;
$$;

--
-- Triggers
--

create or replace trigger visit_before_write
    before insert or update or delete on public.visits
    for each row execute function private.handle_visit_before_write();

create or replace trigger visit_after_write
    after insert or update or delete on public.visits
    for each row execute function private.handle_visit_after_write();

create or replace trigger mis_appointment_visit
    after insert or update or delete on public.mis_appointments
    for each row execute function private.handle_mis_appointment_visit();

-- Fires before the salesbot trigger (names run in order): the bot's waiting
-- session is seen as it was when the reply came
create or replace trigger message_appointment_reply
    after insert on public.messages
    for each row
    when (new.direction = 'in')
    execute function private.handle_message_visit_reply();

create or replace trigger owner_created_schedule
    after insert on public.sales
    for each row
    when (new.role = 'owner')
    execute function private.handle_owner_created_schedule();

create or replace trigger audit_visit
    after insert or update or delete on public.visits
    for each row execute function private.audit_row('visit', 'patient_id,deal_id,doctor_id,chair_id,service_id,starts_at,ends_at,status,note');

create or replace trigger audit_chair
    after insert or update or delete on public.chairs
    for each row execute function private.audit_row('chair', 'name,is_active');

create or replace trigger audit_doctor_exception
    after insert or update or delete on public.doctor_exceptions
    for each row execute function private.audit_row('doctor_exception', 'doctor_id,day,start_time,end_time,note');

create or replace trigger audit_schedule_settings
    after update on public.schedule_settings
    for each row execute function private.audit_row('schedule_settings', 'hours_start,hours_end,status_map,confirm_keywords,reschedule_keywords');

--
-- Row Level Security
--

alter table public.chairs enable row level security;
alter table public.doctor_exceptions enable row level security;
alter table public.schedule_settings enable row level security;
alter table public.visits enable row level security;

-- Dictionaries: every employee reads them, configuration roles edit them
create policy "Organization members can read" on public.chairs for select to authenticated
    using (organization_id = (select private.current_organization_id()));
create policy "Configuration roles can insert" on public.chairs for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and (select private.can_configure()));
create policy "Configuration roles can update" on public.chairs for update to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.can_configure()))
    with check (organization_id = (select private.current_organization_id()));
create policy "Configuration roles can delete" on public.chairs for delete to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.can_configure()));

create policy "Organization members can read" on public.doctor_exceptions for select to authenticated
    using (organization_id = (select private.current_organization_id()));
create policy "Configuration roles can insert" on public.doctor_exceptions for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and (select private.can_configure()));
create policy "Configuration roles can update" on public.doctor_exceptions for update to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.can_configure()))
    with check (organization_id = (select private.current_organization_id()));
create policy "Configuration roles can delete" on public.doctor_exceptions for delete to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.can_configure()));

-- Written by save_schedule_settings only
create policy "Organization members can read" on public.schedule_settings for select to authenticated
    using (organization_id = (select private.current_organization_id()));

-- Visits follow their deal; without a deal, the whole clinic sees them
create policy "Visits of visible deals can be read" on public.visits for select to authenticated
    using (organization_id = (select private.current_organization_id()) and (deal_id is null or exists (select 1 from public.deals d where d.organization_id = visits.organization_id and d.id = visits.deal_id)));
create policy "Employees can book visits of visible deals" on public.visits for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) is distinct from 'integrator' and (deal_id is null or exists (select 1 from public.deals d where d.organization_id = visits.organization_id and d.id = visits.deal_id)));
create policy "Employees can update visits of visible deals" on public.visits for update to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) is distinct from 'integrator' and (deal_id is null or exists (select 1 from public.deals d where d.organization_id = visits.organization_id and d.id = visits.deal_id)))
    with check (organization_id = (select private.current_organization_id()) and (deal_id is null or exists (select 1 from public.deals d where d.organization_id = visits.organization_id and d.id = visits.deal_id)));
create policy "Owner and head can delete" on public.visits for delete to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'));

--
-- Grants
--

grant all on table public.chairs to anon;
grant all on table public.chairs to authenticated;
grant all on table public.chairs to service_role;
grant all on sequence public.chairs_id_seq to anon, authenticated, service_role;

grant all on table public.doctor_exceptions to anon;
grant all on table public.doctor_exceptions to authenticated;
grant all on table public.doctor_exceptions to service_role;
grant all on sequence public.doctor_exceptions_id_seq to anon, authenticated, service_role;

revoke all on table public.schedule_settings from anon, authenticated;
grant select on table public.schedule_settings to authenticated;
grant all on table public.schedule_settings to service_role;

grant all on table public.visits to anon;
grant all on table public.visits to authenticated;
grant all on table public.visits to service_role;
grant all on sequence public.visits_id_seq to anon, authenticated, service_role;

revoke all on function public.get_schedule_settings() from public, anon;
grant execute on function public.get_schedule_settings() to authenticated, service_role;
revoke all on function public.save_schedule_settings(jsonb) from public, anon;
grant execute on function public.save_schedule_settings(jsonb) to authenticated, service_role;
revoke all on function public.save_doctor_hours(bigint, jsonb, integer) from public, anon;
grant execute on function public.save_doctor_hours(bigint, jsonb, integer) to authenticated, service_role;
revoke all on function public.schedule_busy(timestamp with time zone, timestamp with time zone) from public, anon;
grant execute on function public.schedule_busy(timestamp with time zone, timestamp with time zone) to authenticated, service_role;

-- Definer helpers: not callable by clients
revoke all on function private.schedule_mis_kind(bigint) from public, anon, authenticated;
revoke all on function private.schedule_tag(bigint, text) from public, anon, authenticated;
revoke all on function private.schedule_default_status_map(bigint) from public, anon, authenticated;
revoke all on function private.schedule_settings_of(bigint) from public, anon, authenticated;
revoke all on function private.schedule_clean_status_map(bigint, jsonb) from public, anon, authenticated;
revoke all on function private.schedule_time_label(bigint, timestamp with time zone) from public, anon, authenticated;
revoke all on function private.sync_deal_appointment(bigint, bigint, timestamp with time zone) from public, anon, authenticated;
revoke all on function private.visit_apply_status(public.visits, text) from public, anon, authenticated;
revoke all on function private.handle_visit_before_write() from public, anon, authenticated;
revoke all on function private.handle_visit_after_write() from public, anon, authenticated;
revoke all on function private.mirror_mis_appointment(public.mis_appointments) from public, anon, authenticated;
revoke all on function private.handle_mis_appointment_visit() from public, anon, authenticated;
revoke all on function private.handle_message_visit_reply() from public, anon, authenticated;
revoke all on function private.seed_schedule(bigint) from public, anon, authenticated;
revoke all on function private.handle_owner_created_schedule() from public, anon, authenticated;
grant execute on function private.schedule_mis_kind(bigint) to service_role;
grant execute on function private.schedule_settings_of(bigint) to service_role;
grant execute on function private.seed_schedule(bigint) to service_role;
grant execute on function private.visit_reply_kind(text, text[], text[]) to service_role;


--
-- Data
--

-- Employees who saved their preferences receive the new kind too
update public.notification_preferences
set kinds = array_append(kinds, 'visit_reschedule')
where not 'visit_reschedule' = any(kinds);

-- Settings, tag «Не пришёл» and the template «Подтверждение записи» of the
-- existing clinics; the MIS appointments already synced
do $$
begin
  perform private.seed_schedule(o.id) from public.organizations o;
  perform private.mirror_mis_appointment(a) from public.mis_appointments a;
end;
$$;

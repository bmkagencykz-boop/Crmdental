--
-- Telephony (stage 12): calls received from the clinic's PBX (Binotel,
-- Zadarma, Mango Office or any PBX able to post JSON) through the edge
-- function telephony_webhook, which maps the provider payload to one
-- provider-neutral shape and hands it to public.ingest_call.
--

--
-- Tables
--

-- Connection of the clinic to its PBX. The secret and the API key are only
-- read by the edge functions (service role): no client role can read this
-- table, owners and heads go through the telephony_* functions below.
create table public.telephony_integrations (
    organization_id bigint primary key,
    provider text not null default 'generic',
    -- Part of the webhook URL given to the PBX: identifies the clinic
    webhook_token text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
    -- Signature secret (Zadarma secret, Mango Office salt, Binotel API secret,
    -- X-Webhook-Secret of the generic format)
    secret text,
    -- API key to fetch recordings (Zadarma key, Mango Office vpbx_api_key, Binotel key)
    api_key text,
    created_at timestamp with time zone not null default now(),
    last_event_at timestamp with time zone,
    constraint telephony_integrations_provider_check check (provider in ('binotel', 'zadarma', 'mango', 'generic'))
);

alter table public.telephony_integrations
    add constraint telephony_integrations_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade;

create unique index telephony_integrations_webhook_token_idx on public.telephony_integrations using btree (webhook_token);

-- Calls from the PBX: provider and its call id (external_id), status, the
-- patient's number and the employee's internal number as the PBX sent them.
-- Calls logged by hand keep provider null and status 'answered'.
alter table public.calls add column provider text;
alter table public.calls add column status text not null default 'answered';
alter table public.calls add column phone text;
alter table public.calls add column extension text;
alter table public.calls add constraint calls_status_check check (status in ('in_progress', 'answered', 'missed'));

-- One row per call of a provider: its start and end events update the same row
drop index public.calls_external_id_idx;
create unique index calls_provider_call_idx on public.calls using btree (organization_id, provider, external_id) where external_id is not null;

-- Internal number of the employee in the PBX: maps a call to its employee
alter table public.sales add column phone_extension text;
create unique index sales_phone_extension_idx on public.sales using btree (organization_id, phone_extension) where phone_extension is not null;

--
-- Functions
--

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
    insert into public.deals (organization_id, patient_id, source_id, sales_id)
    values (org_id, found_patient_id, call_source_id, case when call_direction = 'out' then employee_id end)
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

-- Telephony connection of the clinic (owner and head; the secrets stay hidden)
CREATE OR REPLACE FUNCTION "public"."telephony_status"() RETURNS TABLE("provider" "text", "webhook_token" "text", "has_secret" boolean, "has_api_key" boolean, "created_at" timestamp with time zone, "last_event_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select i.provider, i.webhook_token, i.secret is not null, i.api_key is not null, i.created_at, i.last_event_at
  from public.telephony_integrations i
  where i.organization_id = private.current_organization_id()
    and private.current_user_role() in ('owner', 'head')
$$;

-- Connects the clinic's PBX or changes its settings (owner and head). A null
-- secret or key keeps the stored one, an empty one removes it.
CREATE OR REPLACE FUNCTION "public"."save_telephony"("telephony_provider" "text", "new_secret" "text" DEFAULT NULL::"text", "new_api_key" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if private.current_organization_id() is null
    or private.current_user_role() is distinct from 'owner' and private.current_user_role() is distinct from 'head' then
    raise exception 'Only the owner and the head manage telephony' using errcode = '42501';
  end if;
  if telephony_provider is null or telephony_provider not in ('binotel', 'zadarma', 'mango', 'generic') then
    raise exception 'Unknown telephony provider' using errcode = '22023';
  end if;
  insert into public.telephony_integrations (organization_id, provider, secret, api_key)
  values (
    private.current_organization_id(),
    telephony_provider,
    nullif(btrim(new_secret), ''),
    nullif(btrim(new_api_key), '')
  )
  on conflict (organization_id) do update
  set provider = excluded.provider,
      secret = case when new_secret is null then public.telephony_integrations.secret else excluded.secret end,
      api_key = case when new_api_key is null then public.telephony_integrations.api_key else excluded.api_key end;
end;
$$;

-- New webhook address: the old one stops working (owner and head)
CREATE OR REPLACE FUNCTION "public"."regenerate_telephony_token"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  new_token text;
begin
  if private.current_organization_id() is null
    or private.current_user_role() is distinct from 'owner' and private.current_user_role() is distinct from 'head' then
    raise exception 'Only the owner and the head manage telephony' using errcode = '42501';
  end if;
  update public.telephony_integrations
  set webhook_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
  where organization_id = private.current_organization_id()
  returning webhook_token into new_token;
  if new_token is null then
    raise exception 'Telephony is not connected' using errcode = 'P0002';
  end if;
  return new_token;
end;
$$;

-- Disconnects the PBX: its webhook address stops working (owner and head)
CREATE OR REPLACE FUNCTION "public"."disconnect_telephony"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if private.current_organization_id() is null
    or private.current_user_role() is distinct from 'owner' and private.current_user_role() is distinct from 'head' then
    raise exception 'Only the owner and the head manage telephony' using errcode = '42501';
  end if;
  delete from public.telephony_integrations
  where organization_id = private.current_organization_id();
end;
$$;

-- «Тестовый звонок» of the settings: a missed incoming call from a test
-- number goes through ingest_call like a real one (owner and head)
CREATE OR REPLACE FUNCTION "public"."telephony_test_call"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  token text;
begin
  if private.current_organization_id() is null
    or private.current_user_role() is distinct from 'owner' and private.current_user_role() is distinct from 'head' then
    raise exception 'Only the owner and the head manage telephony' using errcode = '42501';
  end if;
  select i.webhook_token into token
  from public.telephony_integrations i
  where i.organization_id = private.current_organization_id();
  if token is null then
    raise exception 'Telephony is not connected' using errcode = 'P0002';
  end if;
  return public.ingest_call(token, 'generic', jsonb_build_object(
    'call_id', 'test-' || gen_random_uuid()::text,
    'direction', 'in',
    'phone', '+77000000000',
    'name', 'Тестовый звонок',
    'status', 'missed',
    'started_at', now()
  ));
end;
$$;

-- Internal number of an employee in the PBX (owner and head)
CREATE OR REPLACE FUNCTION "public"."set_sales_phone_extension"("target_sales_id" bigint, "extension" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if private.current_organization_id() is null
    or private.current_user_role() is distinct from 'owner' and private.current_user_role() is distinct from 'head' then
    raise exception 'Only the owner and the head set internal numbers' using errcode = '42501';
  end if;
  update public.sales s
  set phone_extension = nullif(btrim(extension), '')
  where s.organization_id = private.current_organization_id() and s.id = target_sales_id;
  if not found then
    raise exception 'Unknown employee' using errcode = 'P0002';
  end if;
end;
$$;

--
-- Row level security and grants
--

-- telephony_integrations has no policy at all: its secret and API key are
-- only read by the edge functions (service role)
alter table public.telephony_integrations enable row level security;

revoke all on table public.telephony_integrations from anon, authenticated;
grant all on table public.telephony_integrations to service_role;

revoke all on function public.ingest_call(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_call(text, text, jsonb) to service_role;
revoke all on function public.telephony_status() from public, anon;
grant execute on function public.telephony_status() to authenticated, service_role;
revoke all on function public.save_telephony(text, text, text) from public, anon;
grant execute on function public.save_telephony(text, text, text) to authenticated, service_role;
revoke all on function public.regenerate_telephony_token() from public, anon;
grant execute on function public.regenerate_telephony_token() to authenticated, service_role;
revoke all on function public.disconnect_telephony() from public, anon;
grant execute on function public.disconnect_telephony() to authenticated, service_role;
revoke all on function public.telephony_test_call() from public, anon;
grant execute on function public.telephony_test_call() to authenticated, service_role;
revoke all on function public.set_sales_phone_extension(bigint, text) from public, anon;
grant execute on function public.set_sales_phone_extension(bigint, text) to authenticated, service_role;

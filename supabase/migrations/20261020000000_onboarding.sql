--
-- First-run setup wizard («Мастер запуска», stage 24)
--
-- A clinic that just signed up is walked through eight steps (clinic,
-- services and prices, doctors, team, pipeline, channels, import, done).
-- Every step saves through the existing tables and functions; this file only
-- adds what they lacked:
--   onboarding_progress   one row per clinic: the status of each step
--                         ({"clinic": "done", "team": "skipped"}), when the
--                         wizard was put off («Настроить позже»: no more
--                         automatic opening, a dashboard card instead), hidden
--                         for good, or finished. New clinics get a row from
--                         the AFTER INSERT trigger on organizations; clinics
--                         that existed before this stage are marked finished
--                         by the migration. Members read it, the owner and
--                         the head change it.
--   clinic_city, clinic_phone, clinic_address (organization_settings)
--                         the clinic's contacts, saved with its name and time
--                         zone by public.save_clinic_profile().
--   services.price        an optional price in tenge.
-- The default quick replies carry placeholders: saving the address fills
-- «[укажите адрес клиники]», the price of the consultation service fills
-- «[укажите цену]» (only while the placeholder is still in the text).
--

alter table public.organization_settings add column clinic_city text;
alter table public.organization_settings add column clinic_phone text;
alter table public.organization_settings add column clinic_address text;

alter table public.services add column price numeric(12,2);
alter table public.services add constraint services_price_check
    check (price is null or price >= 0);

create table public.onboarding_progress (
    organization_id bigint primary key,
    -- step id -> 'done' | 'skipped'
    steps jsonb not null default '{}'::jsonb,
    postponed_at timestamp with time zone,
    dismissed_at timestamp with time zone,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone not null default now(),
    constraint onboarding_progress_steps_check check (
        jsonb_typeof(steps) = 'object'
        and not jsonb_path_exists(steps, '$.* ? (@ != "done" && @ != "skipped")')
    )
);

alter table public.onboarding_progress
    add constraint onboarding_progress_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade;

--
-- Functions
--

-- 5000 -> '5 000' (tenge, no decimals), as the app prints prices
CREATE OR REPLACE FUNCTION "private"."format_tenge"("amount" numeric) RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select reverse(regexp_replace(reverse(round(amount)::bigint::text), '(\d{3})(?=\d)', '\1 ', 'g'));
$$;

-- Replaces a placeholder in the clinic-wide quick replies of a clinic
CREATE OR REPLACE FUNCTION "private"."fill_quick_reply_placeholder"("org_id" bigint, "placeholder" "text", "value" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if nullif(btrim(value), '') is null then
    return;
  end if;
  update public.quick_replies q
  set text = replace(q.text, placeholder, btrim(value))
  where q.organization_id = org_id
    and q.sales_id is null
    and strpos(q.text, placeholder) > 0;
end;
$$;

-- Step «Клиника» of the wizard (and the clinic settings): name (also the
-- title of the app, {клиника} in the texts), time zone, city, phone and
-- address. Owner and head only.
CREATE OR REPLACE FUNCTION "public"."save_clinic_profile"("clinic_name" "text", "city" "text", "time_zone" "text", "phone" "text", "address" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  org_id bigint := private.current_organization_id();
  zone text := coalesce(nullif(btrim(time_zone), ''), 'Asia/Almaty');
begin
  if org_id is null
    or private.current_user_role() is distinct from 'owner' and private.current_user_role() is distinct from 'head' then
    raise exception 'Only the owner and the head edit the clinic' using errcode = '42501';
  end if;
  if nullif(btrim(clinic_name), '') is null then
    raise exception 'The clinic needs a name' using errcode = '23514';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = zone) then
    raise exception 'Unknown time zone %', zone using errcode = '22023';
  end if;

  update public.organizations o
  set name = btrim(clinic_name), timezone = zone
  where o.id = org_id;

  update public.configuration c
  set config = coalesce(c.config, '{}'::jsonb) || jsonb_build_object('title', btrim(clinic_name))
  where c.organization_id = org_id;

  update public.organization_settings s
  set clinic_city = nullif(btrim(city), ''),
      clinic_phone = coalesce(private.normalize_phone(phone), nullif(btrim(phone), '')),
      clinic_address = nullif(btrim(address), '')
  where s.organization_id = org_id;

  perform private.fill_quick_reply_placeholder(org_id, '[укажите адрес клиники]', address);
end;
$$;

-- The price of the consultation fills «[укажите цену]» in the quick replies
CREATE OR REPLACE FUNCTION "private"."handle_service_price"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if new.price is not null and not new.is_archived
    and lower(btrim(new.name)) like 'консультац%' then
    perform private.fill_quick_reply_placeholder(new.organization_id, '[укажите цену]', private.format_tenge(new.price));
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."handle_organization_onboarding"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.onboarding_progress (organization_id) values (new.id)
  on conflict (organization_id) do nothing;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."touch_onboarding_progress"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;

--
-- Triggers
--

create or replace trigger seed_onboarding_progress
    after insert on public.organizations
    for each row execute function private.handle_organization_onboarding();

create or replace trigger service_price_quick_replies
    after insert or update of price, name, is_archived on public.services
    for each row execute function private.handle_service_price();

create or replace trigger onboarding_progress_updated_at
    before update on public.onboarding_progress
    for each row execute function private.touch_onboarding_progress();

--
-- Row level security and grants
--

alter table public.onboarding_progress enable row level security;

create policy "Organization members can read" on public.onboarding_progress for select to authenticated
    using (organization_id = (select private.current_organization_id()));
create policy "Owner and head can update" on public.onboarding_progress for update to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'))
    with check (organization_id = (select private.current_organization_id()));

grant all on table public.onboarding_progress to anon;
grant all on table public.onboarding_progress to authenticated;
grant all on table public.onboarding_progress to service_role;

revoke all on function public.save_clinic_profile(text, text, text, text, text) from public, anon;
grant execute on function public.save_clinic_profile(text, text, text, text, text) to authenticated, service_role;
revoke all on function private.fill_quick_reply_placeholder(bigint, text, text) from public;
grant execute on function private.fill_quick_reply_placeholder(bigint, text, text) to service_role;
revoke all on function private.handle_service_price() from public;
grant execute on function private.handle_service_price() to service_role;
revoke all on function private.handle_organization_onboarding() from public;
grant execute on function private.handle_organization_onboarding() to service_role;

-- Clinics that existed before the wizard count as set up
insert into public.onboarding_progress (organization_id, completed_at)
select o.id, now() from public.organizations o
on conflict (organization_id) do nothing;

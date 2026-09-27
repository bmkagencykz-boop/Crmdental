-- 1. Invitations: Supabase Auth creates the user, then writes app_metadata
--    (organization and role) with a second statement. handle_new_user only saw
--    the first one and gave every invited employee a new clinic of their own.
--    The organization is now read when app_metadata arrives, and only the
--    sign-up form (organization_name) creates a clinic.
-- 2. Deleting a clinic failed: the organization cascade removed staff and
--    dictionaries while payments, tasks or deals still pointed at them.
--    Patients (and every clinical row cascading from them) now go first.
-- 3. pg_net was lost when the Atomic CRM migrations were squashed: deleting a
--    note through the API failed (schema "net" does not exist).
-- 4. organization_settings.pipeline_move_mode is applied: a deal moved to
--    another pipeline lands on its first stage unless the clinic lets
--    employees choose.

create extension if not exists "pg_net" with schema "extensions";

CREATE OR REPLACE FUNCTION "private"."create_sales_for_user"("auth_user" "auth"."users", "org_id" bigint, "user_role" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not exists (select 1 from public.organizations o where o.id = org_id) then
    raise exception 'Organization % does not exist', org_id;
  end if;
  insert into public.sales (organization_id, first_name, last_name, email, user_id, role)
  values (
    org_id,
    coalesce(auth_user.raw_user_meta_data ->> 'first_name', auth_user.raw_user_meta_data -> 'custom_claims' ->> 'first_name', 'Pending'),
    coalesce(auth_user.raw_user_meta_data ->> 'last_name', auth_user.raw_user_meta_data -> 'custom_claims' ->> 'last_name', 'Pending'),
    auth_user.email,
    auth_user.id,
    user_role
  );
end;
$$;

CREATE OR REPLACE FUNCTION "private"."invited_role"("app_metadata" "jsonb") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case when app_metadata ->> 'role' in ('head', 'manager') then app_metadata ->> 'role' else 'manager' end
$$;

CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
-- A new auth user either:
--  * signed up by themselves (the sign-up form always sends organization_name
--    in user metadata): a new organization is created and they own it;
--  * was invited by a clinic owner: the users edge function (service role) puts
--    organization_id and role in app_metadata, which end users cannot write.
--    Supabase Auth writes app_metadata with a second statement right after the
--    insert, so the invited user usually joins in handle_update_user;
--  * anything else gets no organization, hence no access.
declare
  org_id bigint;
  org_name text;
begin
  org_id := nullif(new.raw_app_meta_data ->> 'organization_id', '')::bigint;

  if org_id is not null then
    perform private.create_sales_for_user(new, org_id, private.invited_role(new.raw_app_meta_data));
  elsif coalesce(new.raw_user_meta_data, '{}'::jsonb) ? 'organization_name' then
    org_name := coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'organization_name'), ''),
      'Моя клиника'
    );
    insert into public.organizations (name) values (org_name) returning id into org_id;
    perform private.seed_organization(org_id);
    perform private.create_sales_for_user(new, org_id, 'owner');
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."handle_update_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  org_id bigint;
begin
  if not exists (select 1 from public.sales where user_id = new.id) then
    -- Invitation: app_metadata arrived after the insert (see handle_new_user)
    org_id := nullif(new.raw_app_meta_data ->> 'organization_id', '')::bigint;
    if org_id is not null then
      perform private.create_sales_for_user(new, org_id, private.invited_role(new.raw_app_meta_data));
    end if;
    return new;
  end if;

  update public.sales
  set
    first_name = coalesce(new.raw_user_meta_data ->> 'first_name', new.raw_user_meta_data -> 'custom_claims' ->> 'first_name', 'Pending'),
    last_name = coalesce(new.raw_user_meta_data ->> 'last_name', new.raw_user_meta_data -> 'custom_claims' ->> 'last_name', 'Pending'),
    email = new.email
  where user_id = new.id;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."delete_organization_data"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  delete from public.patients where organization_id = old.id;
  return old;
end;
$$;

create or replace trigger delete_organization_data
    before delete on public.organizations
    for each row execute function private.delete_organization_data();

revoke all on function private.create_sales_for_user(auth.users, bigint, text) from public;
grant execute on function private.create_sales_for_user(auth.users, bigint, text) to service_role;
revoke all on function private.invited_role(jsonb) from public;
grant execute on function private.invited_role(jsonb) to service_role;
revoke all on function private.delete_organization_data() from public;
grant execute on function private.delete_organization_data() to service_role;

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
  else
    new.created_at := old.created_at;
    -- paid_amount is the total of the payments, only their trigger writes it
    if current_setting('crm.sync_paid_amount', true) is distinct from 'on' then
      new.paid_amount := old.paid_amount;
    end if;
    if (to_jsonb(new) - 'index' - 'updated_at') is distinct from (to_jsonb(old) - 'index' - 'updated_at') then
      new.updated_at := now();
    end if;
    -- Moved to another pipeline: to its first stage, unless the clinic lets
    -- employees choose the stage (organization_settings.pipeline_move_mode)
    if new.pipeline_id is distinct from old.pipeline_id and coalesce((
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

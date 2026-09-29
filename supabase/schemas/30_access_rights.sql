--
-- Access rights (stage 30): «кто что видит, правит, удаляет и выгружает».
--
-- A matrix per employee, like amoCRM's «Права доступа»: for deals, patients
-- and tasks the actions view, create, edit, delete and export, each with a
-- scope; reports as a single «view» toggle.
--
--   scope               deals  patients  tasks   meaning
--   all                   x       x        x     every row of the clinic
--   branch                x                x     «Мой филиал» (stage 33): own rows, rows
--                                                of the employee's branches and rows
--                                                without a branch
--   own_and_unassigned    x                      own rows and deals without a responsible
--   own                   x       x        x     the employee is responsible
--   none                  x       x        x     nothing
--
-- «Own»: a deal or a task whose sales_id is the employee; a patient whose
-- responsible is the employee or who has a deal of the employee. «Create»
-- and reports only know all/none.
--
-- The model: every employee has the defaults of their role (exactly the
-- rules before this stage, so nothing changes for existing clinics), and
-- public.access_rights stores the cells the owner changed for an employee
-- (override per employee). The owner always has everything and is not in
-- the matrix; the integrator keeps the fixed rules of stage 25 (reads the
-- deals, patients and tasks, nothing else). «Настройки» is not a cell: the
-- settings belong to the role «Руководитель» (head), which the owner gives or
-- takes in the same screen (save_access_rights, settings_access).
--
-- Role defaults (private.access_default, twin: accessRights.ts):
--   head     everything, reports;
--   manager  deals: view and edit per the clinic setting manager_deal_visibility,
--            create, export, no delete; patients and tasks: everything;
--            no reports.
--
-- Enforcement: private.access_scope(entity, action) — declared in
-- 01_tables.sql because the policies use it — gives the scope of the current
-- user; the policies of deals, patients and tasks (05_policies.sql) apply it.
-- Every row that belongs to a deal (notes, payments, log, messages, files,
-- visits, treatment plans, checklist, automessages...) is filtered through
-- the deals policy (EXISTS on public.deals) and SECURITY DEFINER code
-- through private.deal_visible(): they follow the view scope of deals
-- automatically. The reports check private.access_scope('reports', 'view')
-- and bulk deletion of deals the delete scope. Export is done in the browser
-- from what the employee can see: the server cannot tell an export from a
-- list, the UI hides the export buttons.
--
-- Only the owner changes rights (save_access_rights); the owner and the head
-- read the matrix, every employee reads their own rights (my_access_rights).
-- Every change is written to the audit log (entity 'access_rights', one
-- field per changed cell: "deals.view": [before, after]).
--

create table public.access_rights (
    organization_id bigint not null default private.current_organization_id(),
    sales_id bigint not null,
    -- { "deals": { "view": "own", ... }, "reports": { "view": "all" } }:
    -- only the cells that differ from the role's defaults matter
    rights jsonb not null default '{}'::jsonb,
    updated_at timestamp with time zone not null default now(),
    updated_by bigint,
    constraint access_rights_pkey primary key (organization_id, sales_id),
    constraint access_rights_rights_object check (jsonb_typeof(rights) = 'object')
);

alter table public.access_rights
    add constraint access_rights_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade;
alter table public.access_rights
    add constraint access_rights_sales_id_fkey foreign key (organization_id, sales_id) references public.sales(organization_id, id) on delete cascade;

--
-- Rules
--

-- Scopes an action accepts; null for an unknown entity or action
CREATE OR REPLACE FUNCTION "private"."access_scopes"("entity" "text", "action" "text") RETURNS "text"[]
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
begin
  if entity = 'reports' then
    return case when action = 'view' then array['all', 'none'] end;
  end if;
  if entity not in ('deals', 'patients', 'tasks') or action not in ('view', 'create', 'edit', 'delete', 'export') then
    return null;
  end if;
  if action = 'create' then
    return array['all', 'none'];
  end if;
  if entity = 'deals' then
    return array['all', 'branch', 'own_and_unassigned', 'own', 'none'];
  end if;
  if entity = 'tasks' then
    return array['all', 'branch', 'own', 'none'];
  end if;
  return array['all', 'own', 'none'];
end;
$$;

-- The rules of the roles before stage 30: the default of every cell
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

-- The scope of a cell for an employee: the owner's choice, else the role's
-- default. The owner and the integrator have fixed rights.
CREATE OR REPLACE FUNCTION "private"."access_resolve"("org_id" bigint, "user_role" "text", "overrides" "jsonb", "entity" "text", "action" "text") RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  chosen text;
begin
  if user_role in ('head', 'manager') then
    chosen := overrides -> entity ->> action;
    if chosen = any(private.access_scopes(entity, action)) then
      return chosen;
    end if;
  end if;
  return private.access_default(org_id, user_role, entity, action);
end;
$$;

-- The whole matrix: { deals: { view, create, edit, delete, export }, patients,
-- tasks, reports: { view } }
CREATE OR REPLACE FUNCTION "private"."access_matrix"("org_id" bigint, "user_role" "text", "overrides" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  entity_name text;
  action_name text;
  cells jsonb;
  matrix jsonb := '{}'::jsonb;
begin
  foreach entity_name in array array['deals', 'patients', 'tasks', 'reports'] loop
    cells := '{}'::jsonb;
    foreach action_name in array array['view', 'create', 'edit', 'delete', 'export'] loop
      if private.access_scopes(entity_name, action_name) is not null then
        cells := cells || jsonb_build_object(action_name,
          private.access_resolve(org_id, user_role, overrides, entity_name, action_name));
      end if;
    end loop;
    matrix := matrix || jsonb_build_object(entity_name, cells);
  end loop;
  return matrix;
end;
$$;

--
-- Audit: one row per change of an employee's rights, the changed cells only
--

CREATE OR REPLACE FUNCTION "private"."audit_access_rights"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  org_id bigint := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  target_id bigint := case when tg_op = 'DELETE' then old.sales_id else new.sales_id end;
  target_role text;
  before jsonb;
  after jsonb;
  diff jsonb := '{}'::jsonb;
  entity_name text;
  action_name text;
  actor record;
begin
  -- Removed with the employee or the clinic (cascade): nothing to log
  if tg_op = 'DELETE' and (pg_trigger_depth() > 1 or not exists (select 1 from public.organizations o where o.id = org_id)) then
    return null;
  end if;
  select s.role into target_role
  from public.sales s
  where s.organization_id = org_id and s.id = target_id;
  if target_role is null then
    return null;
  end if;
  before := private.access_matrix(org_id, target_role, case when tg_op <> 'INSERT' then old.rights end);
  after := private.access_matrix(org_id, target_role, case when tg_op <> 'DELETE' then new.rights end);
  for entity_name in select jsonb_object_keys(after) loop
    for action_name in select jsonb_object_keys(after -> entity_name) loop
      if (before -> entity_name ->> action_name) is distinct from (after -> entity_name ->> action_name) then
        diff := diff || jsonb_build_object(entity_name || '.' || action_name,
          jsonb_build_array(before -> entity_name ->> action_name, after -> entity_name ->> action_name));
      end if;
    end loop;
  end loop;
  if diff = '{}'::jsonb then
    return null;
  end if;
  select * into actor from private.audit_actor(org_id);
  insert into public.audit_log (organization_id, sales_id, source, entity, entity_id, action, changes)
  values (org_id, actor.actor_id, actor.actor_source, 'access_rights', target_id,
    case when tg_op = 'DELETE' then 'reset' else 'update' end, diff);
  return null;
end;
$$;

create or replace trigger audit_access_rights
    after insert or update or delete on public.access_rights
    for each row execute function private.audit_access_rights();

--
-- API
--

-- The rights of the signed-in employee, for the interface:
-- { sales_id, role, rights: <matrix>, customized, branch_ids } (branch_ids:
-- the branches the employee works in, the scope «Мой филиал», stage 33)
CREATE OR REPLACE FUNCTION "public"."my_access_rights"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  me public.sales;
  overrides jsonb;
begin
  select s.* into me
  from public.sales s
  where s.user_id = auth.uid() and not s.disabled
    and (s.access_expires_at is null or s.access_expires_at > now());
  if me.id is null then
    return null;
  end if;
  select r.rights into overrides
  from public.access_rights r
  where r.organization_id = me.organization_id and r.sales_id = me.id;
  return jsonb_build_object(
    'sales_id', me.id,
    'role', me.role,
    'rights', private.access_matrix(me.organization_id, me.role, overrides),
    'customized', overrides is not null and me.role in ('head', 'manager'),
    'branch_ids', coalesce((
      select jsonb_agg(sb.branch_id order by sb.branch_id)
      from public.sales_branches sb
      where sb.organization_id = me.organization_id and sb.sales_id = me.id
    ), '[]'::jsonb)
  );
end;
$$;

-- The owner sets the rights of an employee (head or manager). target_rights:
-- the cells, { entity: { action: scope } }; null resets the employee to the
-- defaults of the role. settings_access (optional): true makes the employee a
-- head («Настройки»), false a manager. Returns the resulting matrix.
CREATE OR REPLACE FUNCTION "public"."save_access_rights"("target_sales_id" bigint, "target_rights" "jsonb", "settings_access" boolean DEFAULT NULL::boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  org_id bigint := private.current_organization_id();
  target public.sales;
  cleaned jsonb := '{}'::jsonb;
  entity_item record;
  action_item record;
  saved jsonb;
begin
  if org_id is null or private.current_user_role() is distinct from 'owner' then
    raise exception 'Права доступа меняет только владелец'
      using errcode = '42501', hint = 'access_rights_forbidden';
  end if;
  select s.* into target
  from public.sales s
  where s.organization_id = org_id and s.id = target_sales_id;
  if target.id is null then
    raise exception 'Сотрудник не найден'
      using errcode = '22023', hint = 'access_rights_not_found';
  end if;
  -- The owner keeps every right; the integrator has the fixed rules of stage 25
  if target.role not in ('head', 'manager') then
    raise exception 'Права владельца и интегратора не настраиваются'
      using errcode = '22023', hint = 'access_rights_fixed';
  end if;

  if target_rights is not null then
    if jsonb_typeof(target_rights) <> 'object' then
      raise exception 'Неверный формат прав' using errcode = '22023', hint = 'access_rights_invalid';
    end if;
    for entity_item in select * from jsonb_each(target_rights) loop
      if jsonb_typeof(entity_item.value) <> 'object' then
        raise exception 'Неверный формат прав: %', entity_item.key using errcode = '22023', hint = 'access_rights_invalid';
      end if;
      for action_item in select * from jsonb_each(entity_item.value) loop
        if jsonb_typeof(action_item.value) <> 'string'
          or not (action_item.value #>> '{}' = any(coalesce(private.access_scopes(entity_item.key, action_item.key), array[]::text[])))
        then
          raise exception 'Недопустимое право: %.% = %', entity_item.key, action_item.key, action_item.value
            using errcode = '22023', hint = 'access_rights_invalid';
        end if;
        cleaned := cleaned || jsonb_build_object(entity_item.key,
          coalesce(cleaned -> entity_item.key, '{}'::jsonb) || jsonb_build_object(action_item.key, action_item.value));
      end loop;
    end loop;
  end if;

  -- «Настройки»: the role head (the users edge function does the same)
  if settings_access is not null and (target.role = 'head') is distinct from settings_access then
    update public.sales s
    set role = case when settings_access then 'head' else 'manager' end
    where s.organization_id = org_id and s.id = target.id
    returning s.role into target.role;
  end if;

  if target_rights is null then
    delete from public.access_rights r
    where r.organization_id = org_id and r.sales_id = target.id;
  else
    insert into public.access_rights (organization_id, sales_id, rights, updated_at, updated_by)
    values (org_id, target.id, cleaned, now(), private.current_sales_id())
    on conflict (organization_id, sales_id) do update
    set rights = excluded.rights, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
    saved := cleaned;
  end if;
  return private.access_matrix(org_id, target.role, saved);
end;
$$;

--
-- RLS: the owner and the head read the matrix, an employee their own row;
-- writes only through save_access_rights
--

alter table public.access_rights enable row level security;

create policy "Owner, head or the employee can read" on public.access_rights for select to authenticated
    using (
        organization_id = (select private.current_organization_id())
        and ((select private.current_user_role()) in ('owner', 'head') or sales_id = (select private.current_sales_id()))
    );

--
-- Grants
--

revoke all on table public.access_rights from anon, authenticated, service_role;
grant select on table public.access_rights to authenticated;
grant all on table public.access_rights to service_role;

revoke all on function private.access_scope(text, text) from public;
grant execute on function private.access_scope(text, text) to authenticated;
grant execute on function private.access_scope(text, text) to service_role;
revoke all on function private.access_scopes(text, text) from public;
grant execute on function private.access_scopes(text, text) to authenticated;
grant execute on function private.access_scopes(text, text) to service_role;
revoke all on function private.access_default(bigint, text, text, text) from public;
grant execute on function private.access_default(bigint, text, text, text) to service_role;
revoke all on function private.access_resolve(bigint, text, jsonb, text, text) from public;
grant execute on function private.access_resolve(bigint, text, jsonb, text, text) to service_role;
revoke all on function private.access_matrix(bigint, text, jsonb) from public;
grant execute on function private.access_matrix(bigint, text, jsonb) to service_role;
revoke all on function private.audit_access_rights() from public;

revoke all on function public.my_access_rights() from public, anon;
grant execute on function public.my_access_rights() to authenticated;
grant execute on function public.my_access_rights() to service_role;
revoke all on function public.save_access_rights(bigint, jsonb, boolean) from public, anon;
grant execute on function public.save_access_rights(bigint, jsonb, boolean) to authenticated;
grant execute on function public.save_access_rights(bigint, jsonb, boolean) to service_role;

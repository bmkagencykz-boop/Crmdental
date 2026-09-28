--
-- Stage 30: access rights (see supabase/schemas/30_access_rights.sql).
-- The policies of deals, patients (and their notes and calls) and tasks now
-- follow private.access_scope(); the defaults are the rules of the roles.
--

-- Access rights of the current user (stage 30): the scope ('all',
-- 'own_and_unassigned', 'own' or 'none') of an action ('view', 'create',
-- 'edit', 'delete', 'export') on an entity ('deals', 'patients', 'tasks',
-- 'reports'). Declared here because the policies of 05_policies.sql use it;
-- the table and the rules (private.access_resolve) are in 30_access_rights.sql.
create or replace function private.access_scope(entity text, action text) returns text
    language plpgsql stable security definer
    set search_path to ''
    as $$
declare
  my_id bigint;
  my_org bigint;
  my_role text;
begin
  select s.id, s.organization_id, s.role into my_id, my_org, my_role
  from public.sales s
  where s.user_id = auth.uid() and not s.disabled
    and (s.access_expires_at is null or s.access_expires_at > now());
  if my_id is null then
    return 'none';
  end if;
  return private.access_resolve(my_org, my_role, (
    select r.rights
    from public.access_rights r
    where r.organization_id = my_org and r.sales_id = my_id
  ), entity, action);
end;
$$;

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
    return array['all', 'own_and_unassigned', 'own', 'none'];
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
  -- Manager (administrator)
  if entity = 'reports' or (entity = 'deals' and action = 'delete') then
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
-- { sales_id, role, rights: <matrix>, customized }
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
    'customized', overrides is not null and me.role in ('head', 'manager')
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

--
-- Changed functions
--

-- Reports are for the owner and the head, and for whom the owner gives the
-- right «Отчёты» (stage 30)
CREATE OR REPLACE FUNCTION "private"."report_check_access"() RETURNS "void"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
begin
  if coalesce(private.access_scope('reports', 'view') = 'all', false) is false then
    raise exception 'Нет доступа к отчётам'
      using errcode = 'insufficient_privilege', hint = 'reports_forbidden';
  end if;
end;
$$;

-- The deals RLS policy for SECURITY DEFINER code: may the current user see it
-- (the view scope of the access rights, stage 30)
CREATE OR REPLACE FUNCTION "private"."deal_visible"("deal" "public"."deals") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  scope text := private.access_scope('deals', 'view');
begin
  return coalesce(
    deal.id is not null
    and deal.organization_id = private.current_organization_id()
    and (
      scope = 'all'
      or (scope in ('own', 'own_and_unassigned') and deal.sales_id = private.current_sales_id())
      or (scope = 'own_and_unassigned' and deal.sales_id is null)
    ),
    false);
end;
$$;

-- One action on many deals. Actions and params:
--   stage: stage_id, lost_reason_id and lost_comment (a lost stage);
--   responsible: sales_id (null: nobody);
--   add_tags, remove_tags: tag_ids;
--   task: text, due_date, type (call by default), sales_id (the responsible
--     of each deal by default);
--   message: template_id or body, name (of the mailing) - owner and head;
--   archive - owner and head; delete - the delete right on deals (stage 30).
-- Returns { action, results: [{ id, ok, error, code }], ok, failed,
-- mailing_id }. At most 1000 deals per call.
CREATE OR REPLACE FUNCTION "public"."bulk_deals"("action" "text", "ids" bigint[], "params" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  org_id bigint := private.current_organization_id();
  user_role text := private.current_user_role();
  current_id bigint;
  touched bigint;
  failed boolean;
  err_message text;
  err_hint text;
  err_state text;
  results jsonb := '[]'::jsonb;
  target_stage public.stages;
  target_sales_id bigint;
  tag_ids bigint[];
  task_text text;
  task_due timestamp with time zone;
  task_type text;
  message_body text;
  template_name text;
  visible bigint[];
  new_mailing_id bigint;
begin
  if org_id is null then
    raise exception 'Нет доступа' using errcode = '42501';
  end if;
  if action is null or action not in ('stage', 'responsible', 'add_tags', 'remove_tags', 'task', 'message', 'archive', 'delete') then
    raise exception 'Неизвестное действие «%»', action
      using errcode = '22023', hint = 'bulk_unknown_action';
  end if;
  if cardinality(ids) > 1000 then
    raise exception 'Не больше 1000 сделок за раз'
      using errcode = '22023', hint = 'bulk_too_many';
  end if;
  if action in ('message', 'archive') and coalesce(user_role in ('owner', 'head'), false) is false then
    raise exception 'Это действие доступно владельцу и руководителю'
      using errcode = '42501', hint = 'bulk_forbidden';
  end if;
  -- Deleting follows the access rights (stage 30); RLS keeps it to the deals
  -- of the employee's delete scope
  if action = 'delete' and coalesce(private.access_scope('deals', 'delete') <> 'none', false) is false then
    raise exception 'Нет права удалять сделки'
      using errcode = '42501', hint = 'bulk_forbidden';
  end if;
  params := coalesce(params, '{}'::jsonb);

  -- Parameters, checked once
  if action = 'stage' then
    select s.* into target_stage from public.stages s
    where s.organization_id = org_id and s.id = nullif(params ->> 'stage_id', '')::bigint;
    if target_stage.id is null then
      raise exception 'Выберите этап' using errcode = '22023', hint = 'bulk_stage_required';
    end if;
  elsif action = 'responsible' then
    target_sales_id := nullif(params ->> 'sales_id', '')::bigint;
    if target_sales_id is not null and not exists (
      select 1 from public.sales s
      where s.organization_id = org_id and s.id = target_sales_id and not s.disabled
    ) then
      raise exception 'Сотрудник не найден' using errcode = '22023', hint = 'bulk_sales_not_found';
    end if;
  elsif action in ('add_tags', 'remove_tags') then
    tag_ids := array(
      select distinct t.value::bigint
      from jsonb_array_elements_text(case when jsonb_typeof(params -> 'tag_ids') = 'array' then params -> 'tag_ids' else '[]'::jsonb end) t
    );
    if cardinality(tag_ids) = 0 then
      raise exception 'Выберите теги' using errcode = '22023', hint = 'bulk_tags_required';
    end if;
  elsif action = 'task' then
    task_text := nullif(btrim(params ->> 'text'), '');
    task_due := nullif(params ->> 'due_date', '')::timestamp with time zone;
    task_type := coalesce(nullif(params ->> 'type', ''), 'call');
    target_sales_id := nullif(params ->> 'sales_id', '')::bigint;
    if task_text is null or task_due is null then
      raise exception 'Укажите текст и срок задачи' using errcode = '22023', hint = 'bulk_task_required';
    end if;
  elsif action = 'message' then
    select t.body, t.name into message_body, template_name
    from public.message_templates t
    where t.organization_id = org_id and t.id = nullif(params ->> 'template_id', '')::bigint;
    message_body := coalesce(nullif(btrim(params ->> 'body'), ''), message_body);
    if message_body is null then
      raise exception 'Выберите шаблон сообщения' using errcode = '22023', hint = 'bulk_message_required';
    end if;
    -- The deals the caller sees (RLS); their patients are queued by the
    -- mailing trigger with the stage 17 rules
    visible := array(
      select d.id from public.deals d
      where d.organization_id = org_id and d.id = any(ids)
    );
    if cardinality(visible) > 0 then
      insert into public.mailings (name, segment, template_id, body)
      values (
        coalesce(nullif(btrim(params ->> 'name'), ''), template_name, 'Сообщение по сделкам'),
        jsonb_build_object('deal_ids', to_jsonb(visible)),
        nullif(params ->> 'template_id', '')::bigint,
        message_body
      )
      returning id into new_mailing_id;
    end if;
  end if;

  for current_id in
    select u.id from unnest(ids) with ordinality u(id, n)
    where u.id is not null
    group by u.id
    order by min(u.n)
  loop
    touched := null;
    failed := false;
    if action = 'message' then
      if not current_id = any(visible) then
        touched := null;
      elsif exists (
        select 1 from public.mailing_messages mm
        where mm.organization_id = org_id and mm.mailing_id = new_mailing_id and mm.deal_id = current_id
      ) then
        touched := current_id;
      else
        failed := true;
        select
          case
            when p.messaging_opt_out then 'Пациент отказался от сообщений'
            when cardinality(p.phones) = 0 and not exists (
              select 1 from public.patient_chats c where c.organization_id = org_id and c.patient_id = p.id
            ) then 'Нет телефона или чата'
            else 'Пациенту уже отправляется сообщение по другой сделке'
          end,
          case
            when p.messaging_opt_out then 'opted_out'
            when cardinality(p.phones) = 0 then 'no_contact'
            else 'duplicate'
          end
        into err_message, err_hint
        from public.deals d
          join public.patients p on p.organization_id = d.organization_id and p.id = d.patient_id
        where d.organization_id = org_id and d.id = current_id;
        results := results || jsonb_build_object('id', current_id, 'ok', false, 'error', err_message, 'code', err_hint);
      end if;
    else
      begin
        if action = 'stage' then
          update public.deals d
          set stage_id = target_stage.id,
            pipeline_id = target_stage.pipeline_id,
            lost_reason_id = case when target_stage.kind = 'lost'
              then coalesce(nullif(params ->> 'lost_reason_id', '')::bigint, d.lost_reason_id)
              else d.lost_reason_id end,
            lost_comment = case when target_stage.kind = 'lost'
              then coalesce(nullif(btrim(params ->> 'lost_comment'), ''), d.lost_comment)
              else d.lost_comment end
          where d.organization_id = org_id and d.id = current_id
          returning d.id into touched;
        elsif action = 'responsible' then
          update public.deals d
          set sales_id = target_sales_id
          where d.organization_id = org_id and d.id = current_id
          returning d.id into touched;
        elsif action = 'add_tags' then
          update public.deals d
          set tags = d.tags || array(select t from unnest(tag_ids) t where t <> all(d.tags) order by t)
          where d.organization_id = org_id and d.id = current_id
          returning d.id into touched;
        elsif action = 'remove_tags' then
          update public.deals d
          set tags = array(select t.tag from unnest(d.tags) with ordinality t(tag, n) where t.tag <> all(tag_ids) order by t.n)
          where d.organization_id = org_id and d.id = current_id
          returning d.id into touched;
        elsif action = 'archive' then
          update public.deals d
          set archived_at = coalesce(d.archived_at, now())
          where d.organization_id = org_id and d.id = current_id
          returning d.id into touched;
        elsif action = 'delete' then
          delete from public.deals d
          where d.organization_id = org_id and d.id = current_id
          returning d.id into touched;
        elsif action = 'task' then
          insert into public.tasks (organization_id, deal_id, type, text, due_date, sales_id)
          select d.organization_id, d.id, task_type, task_text, task_due, coalesce(target_sales_id, d.sales_id)
          from public.deals d
          where d.organization_id = org_id and d.id = current_id
          returning deal_id into touched;
        end if;
      exception when others then
        get stacked diagnostics err_message = message_text, err_hint = pg_exception_hint, err_state = returned_sqlstate;
        failed := true;
        results := results || jsonb_build_object('id', current_id, 'ok', false, 'error', err_message,
          'code', coalesce(nullif(err_hint, ''), err_state));
      end;
    end if;
    if not failed then
      if touched is null then
        results := results || jsonb_build_object('id', current_id, 'ok', false,
          'error', 'Сделка не найдена или нет доступа', 'code', 'not_found');
      else
        results := results || jsonb_build_object('id', current_id, 'ok', true);
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'action', action,
    'results', results,
    'ok', (select count(*) from jsonb_array_elements(results) r where (r ->> 'ok')::boolean),
    'failed', (select count(*) from jsonb_array_elements(results) r where not (r ->> 'ok')::boolean),
    'mailing_id', new_mailing_id
  );
end;
$$;

--
-- Policies
--

drop policy "Visible deals can be read" on public.deals;
drop policy "Organization members can insert" on public.deals;
drop policy "Visible deals can be updated" on public.deals;
drop policy "Owner and head can delete" on public.deals;
drop policy "Organization members can read" on public.patients;
drop policy "Organization members can insert" on public.patients;
drop policy "Organization members can update" on public.patients;
drop policy "Organization members can delete" on public.patients;
drop policy "Organization members can read" on public.patient_notes;
drop policy "Organization members can insert" on public.patient_notes;
drop policy "Organization members can update" on public.patient_notes;
drop policy "Organization members can delete" on public.patient_notes;
drop policy "Rows of visible deals can be read" on public.tasks;
drop policy "Rows of visible deals can be inserted" on public.tasks;
drop policy "Rows of visible deals can be updated" on public.tasks;
drop policy "Rows of visible deals can be deleted" on public.tasks;
drop policy "Organization members can read" on public.calls;

create policy "Patients in the view scope can be read" on public.patients for select to authenticated
    using (
        organization_id = (select private.current_organization_id())
        and (
            (select private.access_scope('patients', 'view')) = 'all'
            or ((select private.access_scope('patients', 'view')) = 'own' and (
                sales_id = (select private.current_sales_id())
                or exists (select 1 from public.deals d where d.organization_id = patients.organization_id and d.patient_id = patients.id and d.sales_id = (select private.current_sales_id()))))
            or exists (select 1 from public.deals d where d.organization_id = patients.organization_id and d.patient_id = patients.id)
        )
    );
create policy "Employees with the create right can insert" on public.patients for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and (select private.access_scope('patients', 'create')) = 'all');
create policy "Patients in the edit scope can be updated" on public.patients for update to authenticated
    using (
        organization_id = (select private.current_organization_id())
        and (
            (select private.access_scope('patients', 'edit')) = 'all'
            or ((select private.access_scope('patients', 'edit')) = 'own' and (
                sales_id = (select private.current_sales_id())
                or exists (select 1 from public.deals d where d.organization_id = patients.organization_id and d.patient_id = patients.id and d.sales_id = (select private.current_sales_id()))))
        )
    )
    with check (organization_id = (select private.current_organization_id()));
create policy "Patients in the delete scope can be deleted" on public.patients for delete to authenticated
    using (
        organization_id = (select private.current_organization_id())
        and (
            (select private.access_scope('patients', 'delete')) = 'all'
            or ((select private.access_scope('patients', 'delete')) = 'own' and (
                sales_id = (select private.current_sales_id())
                or exists (select 1 from public.deals d where d.organization_id = patients.organization_id and d.patient_id = patients.id and d.sales_id = (select private.current_sales_id()))))
        )
    );
create policy "Rows of visible patients can be read" on public.patient_notes for select to authenticated
    using (organization_id = (select private.current_organization_id()) and exists (select 1 from public.patients p where p.organization_id = patient_notes.organization_id and p.id = patient_notes.patient_id));
create policy "Rows of visible patients can be inserted" on public.patient_notes for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and exists (select 1 from public.patients p where p.organization_id = patient_notes.organization_id and p.id = patient_notes.patient_id));
create policy "Rows of visible patients can be updated" on public.patient_notes for update to authenticated
    using (organization_id = (select private.current_organization_id()) and exists (select 1 from public.patients p where p.organization_id = patient_notes.organization_id and p.id = patient_notes.patient_id))
    with check (organization_id = (select private.current_organization_id()));
create policy "Rows of visible patients can be deleted" on public.patient_notes for delete to authenticated
    using (organization_id = (select private.current_organization_id()) and exists (select 1 from public.patients p where p.organization_id = patient_notes.organization_id and p.id = patient_notes.patient_id));
create policy "Visible deals can be read" on public.deals for select to authenticated
    using (
        organization_id = (select private.current_organization_id())
        and (
            (select private.access_scope('deals', 'view')) = 'all'
            or ((select private.access_scope('deals', 'view')) in ('own', 'own_and_unassigned') and sales_id = (select private.current_sales_id()))
            or ((select private.access_scope('deals', 'view')) = 'own_and_unassigned' and sales_id is null)
        )
    );
create policy "Employees with the create right can insert" on public.deals for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and (select private.access_scope('deals', 'create')) = 'all');
create policy "Deals in the edit scope can be updated" on public.deals for update to authenticated
    using (
        organization_id = (select private.current_organization_id())
        and (
            (select private.access_scope('deals', 'edit')) = 'all'
            or ((select private.access_scope('deals', 'edit')) in ('own', 'own_and_unassigned') and sales_id = (select private.current_sales_id()))
            or ((select private.access_scope('deals', 'edit')) = 'own_and_unassigned' and sales_id is null)
        )
    )
    with check (organization_id = (select private.current_organization_id()));
create policy "Deals in the delete scope can be deleted" on public.deals for delete to authenticated
    using (
        organization_id = (select private.current_organization_id())
        and (
            (select private.access_scope('deals', 'delete')) = 'all'
            or ((select private.access_scope('deals', 'delete')) in ('own', 'own_and_unassigned') and sales_id = (select private.current_sales_id()))
            or ((select private.access_scope('deals', 'delete')) = 'own_and_unassigned' and sales_id is null)
        )
    );
create policy "Tasks in the view scope can be read" on public.tasks for select to authenticated
    using (
        organization_id = (select private.current_organization_id())
        and ((select private.access_scope('tasks', 'view')) = 'all' or ((select private.access_scope('tasks', 'view')) = 'own' and sales_id = (select private.current_sales_id())))
        and exists (select 1 from public.deals d where d.organization_id = tasks.organization_id and d.id = tasks.deal_id)
    );
create policy "Tasks of visible deals can be inserted" on public.tasks for insert to authenticated
    with check (
        organization_id = (select private.current_organization_id())
        and (select private.access_scope('tasks', 'create')) = 'all'
        and exists (select 1 from public.deals d where d.organization_id = tasks.organization_id and d.id = tasks.deal_id)
    );
create policy "Tasks in the edit scope can be updated" on public.tasks for update to authenticated
    using (
        organization_id = (select private.current_organization_id())
        and ((select private.access_scope('tasks', 'edit')) = 'all' or ((select private.access_scope('tasks', 'edit')) = 'own' and sales_id = (select private.current_sales_id())))
        and exists (select 1 from public.deals d where d.organization_id = tasks.organization_id and d.id = tasks.deal_id)
    )
    with check (organization_id = (select private.current_organization_id()));
create policy "Tasks in the delete scope can be deleted" on public.tasks for delete to authenticated
    using (
        organization_id = (select private.current_organization_id())
        and ((select private.access_scope('tasks', 'delete')) = 'all' or ((select private.access_scope('tasks', 'delete')) = 'own' and sales_id = (select private.current_sales_id())))
        and exists (select 1 from public.deals d where d.organization_id = tasks.organization_id and d.id = tasks.deal_id)
    );
create policy "Calls of visible patients can be read" on public.calls for select to authenticated
    using (organization_id = (select private.current_organization_id()) and exists (select 1 from public.patients p where p.organization_id = calls.organization_id and p.id = calls.patient_id));

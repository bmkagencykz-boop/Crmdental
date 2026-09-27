--
-- Functions
-- This file declares all PL/pgSQL functions in the public schema.
--

CREATE OR REPLACE FUNCTION "public"."cleanup_note_attachments"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    DECLARE
      payload jsonb;
      request_headers jsonb;
      auth_header text;
    BEGIN
      request_headers := coalesce(
        nullif(current_setting('request.headers', true), '')::jsonb,
        '{}'::jsonb
      );
      auth_header := request_headers ->> 'authorization';

      IF auth_header IS NULL OR auth_header = '' THEN
        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;

        RETURN NEW;
      END IF;

      payload := jsonb_build_object(
        'old_record', OLD,
        'record', NEW,
        'type', TG_OP
      );

      PERFORM net.http_post(
        url := public.get_note_attachments_function_url(),
        body := payload,
        params := '{}'::jsonb,
        headers := jsonb_build_object(
          'Content-Type',
          'application/json',
          'Authorization',
          auth_header
        ),
        timeout_milliseconds := 10000
      );

      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;

      RETURN NEW;
    END;
    $$;

CREATE OR REPLACE FUNCTION "public"."get_note_attachments_function_url"() RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
    DECLARE
      issuer text;
      function_url text;
    BEGIN
      issuer := coalesce(
        nullif(current_setting('request.jwt.claim.iss', true), ''),
        (
          coalesce(
            nullif(current_setting('request.jwt.claims', true), ''),
            '{}'
          )::jsonb ->> 'iss'
        )
      );
      issuer := nullif(issuer, '');
      IF issuer IS NOT NULL THEN
        issuer := rtrim(issuer, '/');
        IF right(issuer, 8) = '/auth/v1' THEN
          function_url :=
            left(issuer, length(issuer) - 8) || '/functions/v1/delete_note_attachments';

          IF function_url LIKE 'http://127.0.0.1:%' THEN
            RETURN replace(
              function_url,
              'http://127.0.0.1:',
              'http://host.docker.internal:'
            );
          END IF;

          IF function_url LIKE 'http://localhost:%' THEN
            RETURN replace(
              function_url,
              'http://localhost:',
              'http://host.docker.internal:'
            );
          END IF;

          RETURN function_url;
        END IF;
      END IF;

      RETURN 'http://host.docker.internal:54321/functions/v1/delete_note_attachments';
    END;
    $$;

CREATE OR REPLACE FUNCTION "public"."get_user_id_by_email"("email" "text") RETURNS TABLE("id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
BEGIN
  RETURN QUERY SELECT au.id FROM auth.users au WHERE au.email = $1;
END;
$_$;

-- Staff row of an auth user in an organization. Invitations only grant the
-- head or manager role: an organization has a single owner, its creator.
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

CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  return coalesce(private.current_user_role() in ('owner', 'head'), false);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."set_sales_id_default"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Imported rows without a responsible stay unassigned
  IF NEW.sales_id IS NULL AND current_setting('crm.importing', true) IS DISTINCT FROM 'on' THEN
    SELECT id INTO NEW.sales_id FROM sales WHERE user_id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

--
-- Phones
--

-- Kazakhstan numbers to +7XXXXXXXXXX ("8 701 123 45 67", "+7 (701) 123-45-67",
-- "7011234567"); other numbers keep their digits with a leading +.
CREATE OR REPLACE FUNCTION "private"."normalize_phone"("raw" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
declare
  digits text;
begin
  if raw is null then
    return null;
  end if;
  digits := regexp_replace(raw, '\D', '', 'g');
  if digits = '' then
    return null;
  end if;
  if length(digits) = 11 and left(digits, 1) in ('7', '8') then
    return '+7' || substr(digits, 2);
  end if;
  if length(digits) = 10 then
    return '+7' || digits;
  end if;
  return '+' || digits;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."handle_patient_saved"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.phone_jsonb := coalesce((
    select jsonb_agg(jsonb_set(e, '{number}', to_jsonb(private.normalize_phone(e ->> 'number'))))
    from jsonb_array_elements(new.phone_jsonb) as e
    where private.normalize_phone(e ->> 'number') is not null
  ), '[]'::jsonb);
  new.whatsapp := private.normalize_phone(new.whatsapp);
  new.instagram := nullif(lower(ltrim(btrim(coalesce(new.instagram, '')), '@')), '');
  new.telegram := nullif(ltrim(btrim(coalesce(new.telegram, '')), '@'), '');
  new.phones := array(
    select distinct n
    from (
      select private.normalize_phone(e ->> 'number') as n
      from jsonb_array_elements(new.phone_jsonb) as e
      union
      select new.whatsapp
    ) as numbers
    where n is not null
    order by n
  );
  return new;
end;
$$;

-- Patients whose phone numbers include the given number (any format)
CREATE OR REPLACE FUNCTION "public"."find_patients_by_phone"("phone" "text") RETURNS SETOF "public"."patients"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select p.*
  from public.patients p
  where private.normalize_phone(phone) is not null
    and p.phones @> array[private.normalize_phone(phone)];
$$;

CREATE OR REPLACE FUNCTION "public"."handle_patient_note_created"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  update public.patients
  set last_seen = new.date
  where organization_id = new.organization_id
    and id = new.patient_id
    and last_seen < new.date;
  return new;
end;
$$;

--
-- Organization template
--

-- Default pipeline, dictionaries and settings of a new clinic
CREATE OR REPLACE FUNCTION "private"."seed_organization"("org_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  pipeline_id bigint;
  org_name text;
begin
  select name into org_name from public.organizations where id = org_id;

  insert into public.organization_settings (organization_id) values (org_id)
  on conflict (organization_id) do nothing;

  insert into public.configuration (organization_id, config)
  values (org_id, jsonb_build_object('title', org_name))
  on conflict (organization_id) do nothing;

  insert into public.pipelines (organization_id, name, position, is_default)
  values (org_id, 'Основная', 0, true)
  returning id into pipeline_id;

  insert into public.stages (organization_id, pipeline_id, name, position, kind, color)
  values
    (org_id, pipeline_id, 'Новый лид', 0, 'open', '#83A2DB'),
    (org_id, pipeline_id, 'В работе', 1, 'open', '#9DB5E4'),
    (org_id, pipeline_id, 'Записан', 2, 'open', '#FFCE87'),
    (org_id, pipeline_id, 'Пришёл на консультацию', 3, 'open', '#F7B98C'),
    (org_id, pipeline_id, 'План согласован', 4, 'open', '#C9B3D0'),
    (org_id, pipeline_id, 'В лечении', 5, 'open', '#A9C7E8'),
    (org_id, pipeline_id, 'Лечение завершено', 6, 'won', '#8CC9A7'),
    (org_id, pipeline_id, 'Отказ', 7, 'lost', '#FD8E8C');

  insert into public.services (organization_id, name, position)
  values
    (org_id, 'Имплантация', 0),
    (org_id, 'Ортодонтия', 1),
    (org_id, 'Терапия', 2),
    (org_id, 'Гигиена', 3),
    (org_id, 'Протезирование', 4),
    (org_id, 'Хирургия', 5),
    (org_id, 'Детская стоматология', 6),
    (org_id, 'Другое', 7);

  insert into public.lead_sources (organization_id, name, code, is_system, position)
  values
    (org_id, 'WhatsApp', 'whatsapp', true, 0),
    (org_id, 'Instagram', 'instagram', true, 1),
    (org_id, 'Telegram', 'telegram', true, 2),
    (org_id, 'Звонок', 'call', true, 3),
    (org_id, 'Сайт', 'website', true, 4),
    (org_id, '2GIS', '2gis', true, 5),
    (org_id, 'Рекомендация', 'referral', true, 6),
    (org_id, 'Другое', 'other', true, 7);

  insert into public.lost_reasons (organization_id, name, position)
  values
    (org_id, 'Дорого', 0),
    (org_id, 'Выбрал другую клинику', 1),
    (org_id, 'Не дозвонились', 2),
    (org_id, 'Передумал', 3),
    (org_id, 'Далеко или неудобно', 4),
    (org_id, 'Страх лечения', 5),
    (org_id, 'Нет времени', 6),
    (org_id, 'Другое', 7);

  -- Default automations: contact every new request, send the plan after the
  -- consultation (the clinic edits them in Settings → Automations)
  insert into public.task_rules (organization_id, event, stage_id, type, text, due_in_minutes, position)
  values (org_id, 'deal_created', null, 'call', 'Связаться с пациентом по новому обращению', 15, 0);
  insert into public.task_rules (organization_id, event, stage_id, type, text, due_in_minutes, position)
  select org_id, 'stage_entered', s.id, 'message', 'Отправить план лечения и стоимость', 24 * 60, 1
  from public.stages s
    join public.pipelines p on p.id = s.pipeline_id
  where p.organization_id = org_id and p.is_default and s.name = 'Пришёл на консультацию';

  -- Default automatic messages (Settings → Auto messages)
  perform private.seed_automessages(org_id);
end;
$$;

--
-- Pipelines
--

-- Deferred check: every pipeline keeps at least one won and one lost stage
CREATE OR REPLACE FUNCTION "private"."check_pipeline_stages"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  checked_pipeline_id bigint;
  pipeline_ids bigint[];
begin
  if tg_table_name = 'pipelines' then
    pipeline_ids := array[new.id];
  elsif tg_op = 'INSERT' then
    pipeline_ids := array[new.pipeline_id];
  elsif tg_op = 'DELETE' then
    pipeline_ids := array[old.pipeline_id];
  else
    pipeline_ids := array[old.pipeline_id, new.pipeline_id];
  end if;

  for checked_pipeline_id in
    select distinct p from unnest(pipeline_ids) as p
  loop
    if exists (select 1 from public.pipelines where id = checked_pipeline_id)
      and (
        not exists (select 1 from public.stages where pipeline_id = checked_pipeline_id and kind = 'won')
        or not exists (select 1 from public.stages where pipeline_id = checked_pipeline_id and kind = 'lost')
      )
    then
      raise exception 'В воронке должна быть хотя бы одна стадия «Успешно» и одна «Отказ»'
        using errcode = 'check_violation', hint = 'pipeline_needs_won_and_lost';
    end if;
  end loop;
  return null;
end;
$$;

-- Creates a pipeline with its minimal set of stages in one transaction
CREATE OR REPLACE FUNCTION "public"."create_pipeline"("pipeline_name" "text") RETURNS bigint
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  new_pipeline_id bigint;
begin
  insert into public.pipelines (name, position)
  values (
    pipeline_name,
    coalesce((select max(position) + 1 from public.pipelines where organization_id = private.current_organization_id()), 0)
  )
  returning id into new_pipeline_id;

  insert into public.stages (pipeline_id, name, position, kind, color)
  values
    (new_pipeline_id, 'Новый лид', 0, 'open', '#83A2DB'),
    (new_pipeline_id, 'Успешно', 1, 'won', '#8CC9A7'),
    (new_pipeline_id, 'Отказ', 2, 'lost', '#FD8E8C');

  return new_pipeline_id;
end;
$$;

--
-- Deals
--

-- Which deals the current user may see (managers depend on the clinic setting)
CREATE OR REPLACE FUNCTION "private"."manager_deal_visibility"() RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if private.current_user_role() in ('owner', 'head') then
    return 'all';
  end if;
  return coalesce((
    select s.manager_deal_visibility
    from public.organization_settings s
    where s.organization_id = private.current_organization_id()
  ), 'all');
end;
$$;

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

-- deals.paid_amount = sum of the deal's payments
CREATE OR REPLACE FUNCTION "public"."handle_deal_payment_changed"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform set_config('crm.sync_paid_amount', 'on', true);
  update public.deals d
  set paid_amount = coalesce((
    select sum(p.amount)
    from public.deal_payments p
    where p.organization_id = d.organization_id and p.deal_id = d.id
  ), 0)
  where d.organization_id = coalesce(new.organization_id, old.organization_id)
    and d.id in (new.deal_id, old.deal_id);
  perform set_config('crm.sync_paid_amount', 'off', true);
  return null;
end;
$$;

--
-- Organizations
--

-- Deleting a clinic removes its patients first. Every clinical row cascades
-- from them, so nothing still points at the staff, pipelines or dictionaries
-- that the organization cascade removes afterwards (cascades run in no
-- guaranteed order, and foreign keys to those tables are checked right away).
CREATE OR REPLACE FUNCTION "private"."delete_organization_data"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  delete from public.patients where organization_id = old.id;
  return old;
end;
$$;

--
-- Messengers
--

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

-- Delivery status of an outgoing message (edge function wazzup_webhook)
CREATE OR REPLACE FUNCTION "public"."update_message_status"("webhook_token" "text", "external_id" "text", "status" "text", "error" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  org_id bigint;
begin
  select i.organization_id into org_id
  from public.messenger_integrations i
  where i.webhook_token = update_message_status.webhook_token;
  if org_id is null then
    raise exception 'Unknown webhook token' using errcode = '28000';
  end if;
  if update_message_status.status not in ('sent', 'delivered', 'read', 'error') then
    return false;
  end if;
  update public.messages m
  set status = update_message_status.status,
      error = case when update_message_status.status = 'error' then update_message_status.error end
  where m.organization_id = org_id
    and m.external_id = update_message_status.external_id
    and m.direction = 'out';
  return found;
end;
$$;

-- The employee opened the conversation of a deal
CREATE OR REPLACE FUNCTION "public"."mark_deal_messages_read"("deal_id" bigint) RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  marked integer;
begin
  update public.messages m
  set read_at = now()
  where m.deal_id = mark_deal_messages_read.deal_id
    and m.direction = 'in'
    and m.read_at is null;
  get diagnostics marked = row_count;
  return marked;
end;
$$;

-- Is the clinic connected to Wazzup24 (owner and head; the key stays secret)
CREATE OR REPLACE FUNCTION "public"."messenger_status"() RETURNS TABLE("connected" boolean, "connected_at" timestamp with time zone, "last_error" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select i.api_key is not null, i.connected_at, i.last_error
  from public.messenger_integrations i
  where i.organization_id = private.current_organization_id()
    and private.current_user_role() in ('owner', 'head')
$$;

-- First answer to the patient: deals.first_response_at (response time reports)
CREATE OR REPLACE FUNCTION "private"."handle_message_created"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  -- An automatic message or a mailing (no author) is not an answer of the clinic
  if new.direction = 'out'
    and ((new.automessage_id is null and new.mailing_message_id is null) or new.sales_id is not null) then
    update public.deals d
    set first_response_at = new.sent_at
    where d.organization_id = new.organization_id and d.id = new.deal_id
      and d.first_response_at is null;
    -- "First to answer takes the lead", among the chosen employees
    if new.sales_id is not null then
      update public.deals d
      set sales_id = new.sales_id
      where d.organization_id = new.organization_id and d.id = new.deal_id
        and d.sales_id is null
        and exists (
          select 1 from public.organization_settings s
          where s.organization_id = new.organization_id
            and s.lead_distribution = 'first_response'
            and (cardinality(s.lead_distribution_sales_ids) = 0
              or new.sales_id = any(s.lead_distribution_sales_ids))
        );
    end if;
  end if;
  return null;
end;
$$;

--
-- Automations
--

-- Round robin among the chosen active employees (organization_settings);
-- null when the clinic does not distribute this way
CREATE OR REPLACE FUNCTION "private"."next_responsible"("org_id" bigint) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  settings public.organization_settings;
  last_position bigint;
  chosen bigint;
begin
  select * into settings from public.organization_settings s
  where s.organization_id = org_id
  for update;
  if not found or settings.lead_distribution <> 'round_robin' then
    return null;
  end if;
  select c.position into last_position
  from unnest(settings.lead_distribution_sales_ids) with ordinality as c(sales_id, position)
  where c.sales_id = settings.last_distributed_sales_id;
  select s.id into chosen
  from unnest(settings.lead_distribution_sales_ids) with ordinality as c(sales_id, position)
    join public.sales s on s.id = c.sales_id and s.organization_id = org_id and not s.disabled
  order by c.position <= coalesce(last_position, 0), c.position
  limit 1;
  if chosen is not null then
    update public.organization_settings
    set last_distributed_sales_id = chosen
    where organization_id = org_id;
  end if;
  return chosen;
end;
$$;

-- Tasks of the rules matching an event of a deal
CREATE OR REPLACE FUNCTION "private"."create_rule_tasks"("deal" "public"."deals", "rule_event" "text", "rule_stage_id" bigint) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  created integer;
begin
  -- Imported deals (public.import_batch) keep their history: no new tasks
  if current_setting('crm.importing', true) = 'on' then
    return 0;
  end if;
  insert into public.tasks (organization_id, deal_id, type, text, due_date, sales_id)
  select deal.organization_id, deal.id, r.type, r.text,
    now() + make_interval(mins => r.due_in_minutes), deal.sales_id
  from public.task_rules r
  where r.organization_id = deal.organization_id
    and r.is_active
    and r.event = rule_event
    and r.stage_id is not distinct from rule_stage_id
  order by r.position, r.id;
  get diagnostics created = row_count;
  return created;
end;
$$;

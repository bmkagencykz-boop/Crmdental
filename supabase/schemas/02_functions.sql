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

CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
-- A new auth user either:
--  * was invited by a clinic owner: the users edge function (service role) puts
--    organization_id and role in app_metadata, which end users cannot write;
--  * signed up by themselves: a new organization is created and they own it.
declare
  org_id bigint;
  user_role text;
  org_name text;
begin
  org_id := nullif(new.raw_app_meta_data ->> 'organization_id', '')::bigint;

  if org_id is not null then
    if not exists (select 1 from public.organizations o where o.id = org_id) then
      raise exception 'Organization % does not exist', org_id;
    end if;
    user_role := coalesce(new.raw_app_meta_data ->> 'role', 'manager');
    if user_role not in ('head', 'manager') then
      user_role := 'manager';
    end if;
  else
    org_name := coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'organization_name'), ''),
      'Моя клиника'
    );
    insert into public.organizations (name) values (org_name) returning id into org_id;
    perform private.seed_organization(org_id);
    user_role := 'owner';
  end if;

  insert into public.sales (organization_id, first_name, last_name, email, user_id, role)
  values (
    org_id,
    coalesce(new.raw_user_meta_data ->> 'first_name', new.raw_user_meta_data -> 'custom_claims' ->> 'first_name', 'Pending'),
    coalesce(new.raw_user_meta_data ->> 'last_name', new.raw_user_meta_data -> 'custom_claims' ->> 'last_name', 'Pending'),
    new.email,
    new.id,
    user_role
  );
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."handle_update_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
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
  IF NEW.sales_id IS NULL THEN
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
  else
    new.created_at := old.created_at;
    -- paid_amount is the total of the payments, only their trigger writes it
    if current_setting('crm.sync_paid_amount', true) is distinct from 'on' then
      new.paid_amount := old.paid_amount;
    end if;
    if (to_jsonb(new) - 'index' - 'updated_at') is distinct from (to_jsonb(old) - 'index' - 'updated_at') then
      new.updated_at := now();
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

-- Deal log and first source of the patient
CREATE OR REPLACE FUNCTION "public"."handle_deal_after_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  tracked text[] := array[
    'name', 'patient_id', 'pipeline_id', 'sales_id', 'source_id', 'service_id',
    'plan_amount', 'paid_amount', 'lost_reason_id', 'lost_comment',
    'appointment_at', 'visit_at', 'tags', 'archived_at'
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
    return null;
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

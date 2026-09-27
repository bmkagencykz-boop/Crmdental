-- Parallel branches changed the same functions; this migration brings
-- them to their final text from supabase/schemas.

-- from supabase/schemas/02_functions.sql
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
  -- A change made by a trigger of the digital pipeline has no author
  actor_id bigint := case when coalesce(nullif(current_setting('crm.automation_depth', true), ''), '0') = '0'
    then private.current_sales_id() end;
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
  -- Custom fields (19_custom_fields.sql): one entry per field, "cf:<id>"
  changes := changes || private.custom_values_diff(old_json -> 'custom_values', new_json -> 'custom_values');

  if new.stage_id is distinct from old.stage_id then
    insert into public.deal_events (organization_id, deal_id, type, from_stage_id, to_stage_id, changes, sales_id)
    values (new.organization_id, new.id, 'stage_changed', old.stage_id, new.stage_id, changes, actor_id);
  elsif changes <> '{}'::jsonb then
    insert into public.deal_events (organization_id, deal_id, type, changes, sales_id)
    values (new.organization_id, new.id, 'updated', changes, actor_id);
  end if;
  return null;
end;
$$;

-- from supabase/schemas/20_digital_pipeline.sql
CREATE OR REPLACE FUNCTION "private"."fire_stage_trigger"("trigger_row" "public"."stage_triggers", "target_deal_id" bigint, "instance_key" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  deal public.deals;
  depth integer := coalesce(nullif(current_setting('crm.automation_depth', true), '')::integer, 0);
  previous_source text := coalesce(current_setting('crm.audit_source', true), '');
  run_id bigint;
  run_status text := 'done';
  result jsonb;
  error_hint text;
  error_message text;
begin
  if current_setting('crm.importing', true) = 'on' then
    return null;
  end if;
  select * into deal from public.deals d
  where d.organization_id = trigger_row.organization_id and d.id = target_deal_id;
  -- Unsorted leads (stage 18) wait for a person to accept them
  if not found or deal.archived_at is not null or deal.unsorted_at is not null
    or deal.stage_id <> trigger_row.stage_id
    or not private.stage_trigger_matches(trigger_row, deal) then
    return null;
  end if;

  insert into public.stage_trigger_runs (organization_id, deal_id, trigger_id, trigger_name, event, event_key, action)
  values (deal.organization_id, deal.id, trigger_row.id, trigger_row.name, trigger_row.event, instance_key,
    trigger_row.action)
  on conflict (trigger_id, deal_id, event_key) do nothing
  returning id into run_id;
  if run_id is null then
    return null;
  end if;

  if depth >= 3 then
    update public.stage_trigger_runs r
    set status = 'skipped', error = 'Слишком длинная цепочка автоматических действий'
    where r.id = run_id;
    return 'skipped';
  end if;

  perform set_config('crm.automation_depth', (depth + 1)::text, true);
  perform set_config('crm.audit_source', 'automation', true);
  begin
    result := private.apply_stage_trigger_action(trigger_row, deal);
  exception when others then
    get stacked diagnostics error_hint = pg_exception_hint, error_message = message_text;
    run_status := case when error_hint = 'stage_checklist_incomplete' then 'skipped' else 'failed' end;
  end;
  perform set_config('crm.automation_depth', depth::text, true);
  perform set_config('crm.audit_source', previous_source, true);

  update public.stage_trigger_runs r
  set status = run_status, details = coalesce(result, '{}'::jsonb), error = left(error_message, 500)
  where r.id = run_id;
  return run_status;
end;
$$;

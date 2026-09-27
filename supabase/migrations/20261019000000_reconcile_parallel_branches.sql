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
    values (new.organization_id, new.id, 'stage_changed', old.stage_id, new.stage_id, changes, private.current_sales_id());
  elsif changes <> '{}'::jsonb then
    insert into public.deal_events (organization_id, deal_id, type, changes, sales_id)
    values (new.organization_id, new.id, 'updated', changes, private.current_sales_id());
  end if;
  return null;
end;
$$;

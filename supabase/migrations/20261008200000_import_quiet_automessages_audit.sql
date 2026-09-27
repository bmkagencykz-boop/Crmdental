-- Import (20261005) meets auto-messages (20261002) and the audit log
-- (20261008): imported deals get no auto-messages, and their audit rows
-- have the source 'import'.

CREATE OR REPLACE FUNCTION "private"."handle_deal_automessages"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  -- Imported deals (crm.importing, see import_batch) get no auto-messages
  if current_setting('crm.importing', true) = 'on' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform private.schedule_automessages(new);
    return null;
  end if;
  if new.stage_id is distinct from old.stage_id then
    perform private.cancel_automessages(new.organization_id, new.id, array['pending', 'awaiting'], null,
      'Сделка ушла с этапа');
    perform private.schedule_automessages(new);
  elsif new.archived_at is not null and old.archived_at is null then
    perform private.cancel_automessages(new.organization_id, new.id, array['pending', 'awaiting'], null,
      'Сделка в архиве');
  elsif new.appointment_at is distinct from old.appointment_at then
    perform private.cancel_automessages(new.organization_id, new.id, array['pending'], 'before_visit',
      'Дата визита изменилась');
    perform private.schedule_automessages(new, 'before_visit');
  end if;
  return null;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."import_batch"("kind" "text", "rows" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  org_id bigint := private.current_organization_id();
  item jsonb;
  row_position integer;
  outcome jsonb;
  row_outcome text;
  result jsonb := jsonb_build_object(
    'created', 0, 'updated', 0, 'skipped', 0,
    'patients_created', 0, 'patients_updated', 0,
    'deals_created', 0, 'deals_updated', 0,
    'errors', '[]'::jsonb
  );
begin
  if org_id is null or private.current_user_role() not in ('owner', 'head') then
    raise exception 'Импорт доступен владельцу и руководителю клиники'
      using errcode = 'insufficient_privilege';
  end if;
  if kind is null or kind not in ('patients', 'deals') then
    raise exception 'Неизвестный вид импорта: %', kind using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(rows) is distinct from 'array' then
    raise exception 'Ожидается массив строк' using errcode = 'invalid_parameter_value';
  end if;

  perform set_config('crm.importing', 'on', true);
  -- The audit log shows these changes as coming from the import
  perform set_config('crm.audit_source', 'import', true);
  for item, row_position in
    select e.value, e.ordinality::integer from jsonb_array_elements(rows) with ordinality as e
  loop
    begin
      outcome := private.import_row(org_id, kind, item);
      row_outcome := case
        when 'created' in (outcome ->> 'patient', outcome ->> 'deal') then 'created'
        when 'updated' in (outcome ->> 'patient', outcome ->> 'deal') then 'updated'
        else 'skipped'
      end;
      result := result || jsonb_build_object(row_outcome, (result ->> row_outcome)::integer + 1);
      if outcome ->> 'patient' in ('created', 'updated') then
        result := result || jsonb_build_object(
          'patients_' || (outcome ->> 'patient'),
          (result ->> ('patients_' || (outcome ->> 'patient')))::integer + 1);
      end if;
      if outcome ->> 'deal' in ('created', 'updated') then
        result := result || jsonb_build_object(
          'deals_' || (outcome ->> 'deal'),
          (result ->> ('deals_' || (outcome ->> 'deal')))::integer + 1);
      end if;
    exception when others then
      result := jsonb_set(result, '{errors}', (result -> 'errors') || jsonb_build_array(jsonb_build_object(
        'index', coalesce((item ->> 'index')::integer, row_position),
        'message', sqlerrm
      )));
    end;
  end loop;
  perform set_config('crm.importing', 'off', true);
  perform set_config('crm.audit_source', '', true);
  return result;
end;
$$;

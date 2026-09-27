-- Import (20261005) meets notifications (20261010): imported deals don't
-- notify employees.

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
  -- Imported deals don't notify employees ("deal assigned to you")
  perform set_config('crm.notifications', 'off', true);
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
  perform set_config('crm.notifications', '', true);
  return result;
end;
$$;

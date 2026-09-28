--
-- Global search (stage 31): the search field of the top bar («Поиск
-- пациента, телефона, сделки…»), like the top search of amoCRM and the
-- «Поиск пациента» field of a dental MIS.
--
-- public.global_search(q, max_per_kind) returns the best matches of each
-- kind as one JSON object:
--   { "patients": [...], "deals": [...], "tasks": [...], "messages": [...] }
-- It is SECURITY INVOKER: row level security decides what is found, so a
-- manager who only sees their own deals (manager_deal_visibility) does not
-- find a colleague's deal, its tasks or its messages; nobody finds anything
-- of another clinic.
--
-- Matching rules (the TypeScript twin, used by the demo, is
-- src/components/atomic-crm/search/globalSearch.ts):
--   * text is compared normalized: lower case (Cyrillic, Kazakh and Latin
--     letters, whatever the collation of the database), «ё» = «е»;
--   * names: every word of the query is the beginning of a word of the name
--     («ив ан» finds «Иванова Анна»), in any order;
--   * phones: a query made of digits, spaces, +, (, ) and - is a phone: its
--     digits without the trunk prefix (8 or 7 before 7XX) are looked for
--     inside the stored numbers (+7XXXXXXXXXX), so «+7 701 555 12 34»,
--     «87015551234», «5551234» and «555 12» all find +77015551234;
--   * digit words of a mixed query («Иванова 701») are looked for in the
--     phones;
--   * «#123», «№123» or a short number (up to 6 digits): the patient card
--     number (patients.id), the deal number, or the patient's number in a
--     MIS (external_refs);
--   * messages: the normalized query as one phrase inside the text.
-- Ranking: exact phone first, then the card / deal number, the exact name,
-- names starting with the query, other name matches, partial phones; then
-- the most recent.
--
-- Indexes: pg_trgm (GIN) on the normalized names, the digits of the phones
-- and the normalized message texts, so that '%…%' patterns stay fast.
--

create extension if not exists "pg_trgm" with schema "extensions";

-- Lower case without depending on the collation (Cyrillic, Kazakh), ё = е
CREATE OR REPLACE FUNCTION "private"."search_norm"("value" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    SET "search_path" TO ''
    AS $$
  select lower(translate(coalesce(value, ''),
    'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯӘҒҚҢӨҰҮҺІё',
    'абвгдеежзийклмнопрстуфхцчшщъыьэюяәғқңөұүһіе'))
$$;

-- « фамилия имя отчество» normalized, with a leading space so that
-- "like '% ' || word || '%'" finds words by their beginning
CREATE OR REPLACE FUNCTION "private"."patient_search_name"("last_name" "text", "first_name" "text", "middle_name" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    SET "search_path" TO ''
    AS $$
  select ' ' || private.search_norm(coalesce(last_name, '') || ' ' || coalesce(first_name, '') || ' ' || coalesce(middle_name, ''))
$$;

-- Digits of the normalized phones, space separated ("77011234567 77071234567")
CREATE OR REPLACE FUNCTION "private"."phones_search_digits"("phones" "text"[]) RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE PARALLEL SAFE
    SET "search_path" TO ''
    AS $$
begin
  return regexp_replace(coalesce(array_to_string(phones, ' '), ''), '[^0-9 ]', '', 'g');
end;
$$;

create index patients_search_name_trgm_idx on public.patients using gin (private.patient_search_name(last_name, first_name, middle_name) extensions.gin_trgm_ops);
create index patients_search_phones_trgm_idx on public.patients using gin (private.phones_search_digits(phones) extensions.gin_trgm_ops);
create index deals_search_name_trgm_idx on public.deals using gin (private.search_norm(name) extensions.gin_trgm_ops);
create index tasks_search_text_trgm_idx on public.tasks using gin (private.search_norm(text) extensions.gin_trgm_ops);
create index messages_search_text_trgm_idx on public.messages using gin (private.search_norm(text) extensions.gin_trgm_ops);

CREATE OR REPLACE FUNCTION "public"."global_search"("q" "text", "max_per_kind" integer DEFAULT 5) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $_$
declare
  org_id bigint := private.current_organization_id();
  lim integer := least(greatest(coalesce(max_per_kind, 5), 1), 50);
  raw text := btrim(coalesce(q, ''));
  norm text;
  tokens text[];
  name_words text[];
  digit_words text[];
  phone_digits text;
  exact_phone text;
  id_number bigint;
  phrase text;
  is_phone boolean;
  result_patients jsonb;
  result_deals jsonb;
  result_tasks jsonb;
  result_messages jsonb;
begin
  if org_id is null or char_length(raw) < 2 then
    return jsonb_build_object('patients', '[]'::jsonb, 'deals', '[]'::jsonb, 'tasks', '[]'::jsonb, 'messages', '[]'::jsonb);
  end if;

  -- The query: normalized words without LIKE wildcards
  norm := btrim(regexp_replace(private.search_norm(raw), '[%_\\]+', ' ', 'g'));
  tokens := array(select t from regexp_split_to_table(norm, '\s+') as t where t <> '');
  is_phone := raw !~ '[^0-9\s()+-]';
  if raw ~ '^[#№]\s*[0-9]{1,18}$' or (raw ~ '^[0-9]{1,6}$') then
    id_number := regexp_replace(raw, '[^0-9]', '', 'g')::bigint;
  end if;
  if is_phone then
    phone_digits := regexp_replace(raw, '[^0-9]', '', 'g');
    if length(phone_digits) >= 4 and phone_digits ~ '^[78]7' then
      phone_digits := substr(phone_digits, 2);
    end if;
    if length(phone_digits) < 3 then
      phone_digits := null;
    end if;
    if length(regexp_replace(raw, '[^0-9]', '', 'g')) >= 10 then
      exact_phone := private.normalize_phone(raw);
    end if;
    name_words := '{}';
    digit_words := '{}';
  else
    -- «#12» and «№12» are numbers, not words
    tokens := array(select regexp_replace(t, '^[#№]', '') from unnest(tokens) as t where regexp_replace(t, '^[#№]', '') <> '');
    name_words := array(select t from unnest(tokens) as t where t !~ '^[0-9]+$');
    digit_words := array(select t from unnest(tokens) as t where t ~ '^[0-9]+$' and length(t) >= 3);
    if cardinality(name_words) = 0 then
      name_words := '{}';
    end if;
    phrase := case when char_length(norm) >= 3 then norm end;
  end if;

  -- Patients: shared by the clinic
  with found as (
    select p.*,
      private.patient_search_name(p.last_name, p.first_name, p.middle_name) as search_name,
      (select min(r.external_id) from public.external_refs r
       where r.organization_id = p.organization_id and r.entity = 'patient' and r.entity_id = p.id) as card
    from public.patients p
    where p.organization_id = org_id
      and (
        (phone_digits is not null and private.phones_search_digits(p.phones) like '%' || phone_digits || '%')
        or (id_number is not null and p.id = id_number)
        or exists (
          select 1 from public.external_refs r
          where r.organization_id = p.organization_id and r.entity = 'patient'
            and r.entity_id = p.id and r.external_id = raw)
        or (
          cardinality(name_words) > 0
          and private.patient_search_name(p.last_name, p.first_name, p.middle_name) like '% ' || name_words[1] || '%'
          and not exists (
            select 1 from unnest(name_words) as w
            where private.patient_search_name(p.last_name, p.first_name, p.middle_name) not like '% ' || w || '%')
          and not exists (
            select 1 from unnest(digit_words) as w
            where private.phones_search_digits(p.phones) not like '%' || w || '%')
        )
      )
  ),
  ranked as (
    select f.*,
      case
        when exact_phone is not null and exact_phone = any(f.phones) then 0
        when id_number is not null and f.id = id_number then 1
        when f.card = raw then 1
        when cardinality(name_words) > 0 and btrim(f.search_name) = array_to_string(name_words, ' ') then 2
        when cardinality(name_words) > 0 and f.search_name like ' ' || name_words[1] || '%' then 3
        when cardinality(name_words) > 0 then 4
        else 5
      end as rank
    from found f
    order by rank, f.last_seen desc, f.id desc
    limit lim
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'first_name', r.first_name,
      'last_name', r.last_name,
      'middle_name', r.middle_name,
      'phones', to_jsonb(r.phones),
      'birth_date', r.birth_date,
      'card', r.card,
      'rank', r.rank
    ) order by r.rank, r.last_seen desc, r.id desc), '[]'::jsonb)
  into result_patients
  from ranked r;

  -- Deals: row level security keeps the deals the user cannot see out
  with found as (
    select d.*, p.first_name as patient_first_name, p.last_name as patient_last_name, p.phones as patient_phones,
      private.patient_search_name(p.last_name, p.first_name, p.middle_name) as patient_name,
      ' ' || private.search_norm(d.name) as deal_name,
      s.name as stage_name, s.kind as stage_kind, s.color as stage_color,
      nullif(btrim(coalesce(sa.first_name, '') || ' ' || coalesce(sa.last_name, '')), '') as sales_name
    from public.deals d
    join public.patients p on p.organization_id = d.organization_id and p.id = d.patient_id
    join public.stages s on s.organization_id = d.organization_id and s.id = d.stage_id
    left join public.sales sa on sa.organization_id = d.organization_id and sa.id = d.sales_id
    where d.organization_id = org_id
      and (
        (id_number is not null and d.id = id_number)
        or (phone_digits is not null and private.phones_search_digits(p.phones) like '%' || phone_digits || '%')
        or (
          cardinality(name_words) > 0
          and not exists (
            select 1 from unnest(name_words) as w
            where private.patient_search_name(p.last_name, p.first_name, p.middle_name) || ' ' || private.search_norm(d.name) not like '% ' || w || '%')
          and not exists (
            select 1 from unnest(digit_words) as w
            where private.phones_search_digits(p.phones) not like '%' || w || '%')
        )
      )
  ),
  ranked as (
    select f.*,
      case
        when id_number is not null and f.id = id_number then 0
        when exact_phone is not null and exact_phone = any(f.patient_phones) then 1
        when cardinality(name_words) > 0 and (f.patient_name like ' ' || name_words[1] || '%' or f.deal_name like ' ' || name_words[1] || '%') then 2
        when cardinality(name_words) > 0 then 3
        else 4
      end as rank
    from found f
    order by rank, (f.stage_kind = 'open' and f.archived_at is null) desc, f.updated_at desc, f.id desc
    limit lim
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'name', r.name,
      'patient_id', r.patient_id,
      'patient_first_name', r.patient_first_name,
      'patient_last_name', r.patient_last_name,
      'pipeline_id', r.pipeline_id,
      'stage_id', r.stage_id,
      'stage_name', r.stage_name,
      'stage_kind', r.stage_kind,
      'stage_color', r.stage_color,
      'sales_id', r.sales_id,
      'sales_name', r.sales_name,
      'plan_amount', r.plan_amount,
      'archived_at', r.archived_at,
      'rank', r.rank
    ) order by r.rank, (r.stage_kind = 'open' and r.archived_at is null) desc, r.updated_at desc, r.id desc), '[]'::jsonb)
  into result_deals
  from ranked r;

  -- Tasks: by their text, or by the patient of their deal
  with found as (
    select t.*, p.first_name as patient_first_name, p.last_name as patient_last_name, p.id as patient_id
    from public.tasks t
    join public.deals d on d.organization_id = t.organization_id and d.id = t.deal_id
    join public.patients p on p.organization_id = d.organization_id and p.id = d.patient_id
    where t.organization_id = org_id
      and (
        (phone_digits is not null and private.phones_search_digits(p.phones) like '%' || phone_digits || '%')
        or (
          cardinality(name_words) > 0
          and not exists (
            select 1 from unnest(name_words) as w
            where private.patient_search_name(p.last_name, p.first_name, p.middle_name) || ' ' || private.search_norm(t.text) not like '% ' || w || '%')
          and not exists (
            select 1 from unnest(digit_words) as w
            where private.phones_search_digits(p.phones) not like '%' || w || '%')
        )
      )
    order by (t.done_date is null) desc, t.due_date, t.id
    limit lim
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id,
      'text', f.text,
      'type', f.type,
      'due_date', f.due_date,
      'done_date', f.done_date,
      'deal_id', f.deal_id,
      'sales_id', f.sales_id,
      'patient_id', f.patient_id,
      'patient_first_name', f.patient_first_name,
      'patient_last_name', f.patient_last_name
    ) order by (f.done_date is null) desc, f.due_date, f.id), '[]'::jsonb)
  into result_tasks
  from found f;

  -- Messages: the query as a phrase inside the text, with a snippet around it
  with found as (
    select m.id, m.deal_id, m.patient_id, m.direction, m.transport, m.sent_at, m.text,
      strpos(private.search_norm(m.text), phrase) as pos,
      p.first_name as patient_first_name, p.last_name as patient_last_name
    from public.messages m
    join public.patients p on p.organization_id = m.organization_id and p.id = m.patient_id
    where phrase is not null
      and m.organization_id = org_id
      and private.search_norm(m.text) like '%' || phrase || '%'
    order by m.sent_at desc, m.id desc
    limit lim
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id,
      'deal_id', f.deal_id,
      'patient_id', f.patient_id,
      'patient_first_name', f.patient_first_name,
      'patient_last_name', f.patient_last_name,
      'direction', f.direction,
      'transport', f.transport,
      'sent_at', f.sent_at,
      'snippet',
        case when f.pos > 41 then '…' else '' end
        || substr(f.text, greatest(f.pos - 40, 1), 160)
        || case when char_length(f.text) >= greatest(f.pos - 40, 1) + 160 then '…' else '' end
    ) order by f.sent_at desc, f.id desc), '[]'::jsonb)
  into result_messages
  from found f;

  return jsonb_build_object(
    'patients', result_patients,
    'deals', result_deals,
    'tasks', result_tasks,
    'messages', result_messages
  );
end;
$_$;

revoke all on function private.search_norm(text) from public;
grant execute on function private.search_norm(text) to anon, authenticated, service_role;
revoke all on function private.patient_search_name(text, text, text) from public;
grant execute on function private.patient_search_name(text, text, text) to anon, authenticated, service_role;
revoke all on function private.phones_search_digits(text[]) from public;
grant execute on function private.phones_search_digits(text[]) to anon, authenticated, service_role;
revoke all on function public.global_search(text, integer) from public, anon;
grant execute on function public.global_search(text, integer) to authenticated, service_role;

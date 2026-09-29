--
-- The full patient card (stage 37), like the card of a dental MIS
-- (Dentist Plus, MacDent): a header with the IIN and the card number, the
-- dental chart with the current state of every tooth, the visit records
-- («запись приёма») with ICD-10 diagnoses, the medical questionnaire, the
-- informed consents, the X-rays and photos of the patient.
--
--   patients.iin, card_number   the Kazakh IIN (12 digits, checksum: see
--                               private.iin_valid) — an empty birth date and
--                               sex are derived from it — and the number of
--                               the paper card (free text; the app shows the
--                               patient id when it is empty).
--   patient_teeth               the current state of a tooth (FDI 11–48,
--                               51–85) and a free note, one row per tooth:
--                               healthy, caries, filling, crown, missing,
--                               implant, root, endo (pulpitis/periodontitis),
--                               treatment (needs treatment). No row: nothing
--                               recorded.
--   patient_tooth_history       every change of a tooth (before → after, who,
--                               when, source 'manual' or 'plan'), written by
--                               the trigger of patient_teeth only.
--   visit_records               «запись приёма»: complaints, anamnesis,
--                               objective status, ICD-10 diagnoses (codes +
--                               text), treatment done, recommendations — for a
--                               visit of the schedule (CRM or MIS, one record
--                               per visit) or without a visit.
--   visit_record_templates      reusable texts of a record (any fields, codes).
--   patient_questionnaires      the medical questionnaire, one per patient:
--                               answers { key: { answer: yes|no, comment } }
--                               and the date it was signed. Allergies,
--                               contraindications and chronic diseases stay
--                               the columns of stage 29.
--   consent_templates           the clinic's informed consent texts with
--                               variables ({пациент}, {дата_рождения}, {иин},
--                               {телефон}, {дата}, {клиника}, {врач}; English
--                               aliases {patient}…), seeded for every clinic.
--   patient_consents            a consent given to the patient: the rendered
--                               text (a copy), the date it was signed.
--   patient_files               files of the patient outside the deals: X-rays
--                               (ОПТГ, КТ, прицельный снимок), photos,
--                               documents, signed consents — with a type, in
--                               the private bucket deal-files, folder
--                               "<organization_id>/patients/<patient_id>/".
--
-- Tooth states from the treatment plan: an item marked done whose service
-- name names a result (private.service_tooth_state: «Пломба…» → filling,
-- «Коронка…» → crown, «Имплант…» → implant, «Удаление…» → missing) sets the
-- state of its teeth (private.parse_teeth reads «36», «11-13», «25, 26»).
-- Twin: src/components/atomic-crm/patient-card/toothStates.ts.
--
-- Rights: medical data is visible to whoever sees the patient (the
-- sub-query applies the patients policy of stage 30), never to the
-- integrator. The owner, the head and the managers (administrators) fill
-- the chart, the records, the questionnaire and the consents; deleting a
-- record, a consent or a file is for the owner, the head or its author.
-- Consent templates are edited by the owner and the head. Every change goes
-- to the audit log (group «Пациенты»).
--
-- Merging patients (stage 18) moves every row; for a tooth, and for the
-- questionnaire, the kept patient's own row wins.
--

--
-- The IIN and the card number
--

-- The birth date of an IIN (YYMMDD + the century of the 7th digit: 1–2 the
-- 1800s, 3–4 the 1900s, 5–6 the 2000s), null when it is not a date
CREATE OR REPLACE FUNCTION "private"."iin_birth_date"("value" "text") RETURNS "date"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
declare
  century integer;
begin
  if value is null or value !~ '^[0-9]{12}$' then
    return null;
  end if;
  century := case substr(value, 7, 1)
    when '1' then 1800 when '2' then 1800
    when '3' then 1900 when '4' then 1900
    when '5' then 2000 when '6' then 2000
  end;
  if century is null then
    return null;
  end if;
  return make_date(century + substr(value, 1, 2)::integer, substr(value, 3, 2)::integer, substr(value, 5, 2)::integer);
exception
  when others then
    return null;
end;
$_$;

-- The sex of an IIN: an odd 7th digit is a man, an even one a woman
CREATE OR REPLACE FUNCTION "private"."iin_gender"("value" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
  select case
    when value !~ '^[0-9]{12}$' or substr(value, 7, 1) not between '1' and '6' then null
    when substr(value, 7, 1)::integer % 2 = 1 then 'male'
    else 'female'
  end;
$_$;

-- A valid IIN: 12 digits, a real birth date, and the check digit — Σ digit
-- × weight (1…11) mod 11; when that is 10, again with the weights 3…11, 1,
-- 2; a second 10 is never valid. Twin: patient-card/iin.ts
CREATE OR REPLACE FUNCTION "private"."iin_valid"("value" "text") RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
declare
  total integer := 0;
  check_digit integer;
  i integer;
begin
  if value is null or value !~ '^[0-9]{12}$' or private.iin_birth_date(value) is null then
    return false;
  end if;
  for i in 1..11 loop
    total := total + substr(value, i, 1)::integer * i;
  end loop;
  check_digit := total % 11;
  if check_digit = 10 then
    total := 0;
    for i in 1..11 loop
      total := total + substr(value, i, 1)::integer * ((i + 1) % 11 + 1);
    end loop;
    check_digit := total % 11;
    if check_digit = 10 then
      return false;
    end if;
  end if;
  return check_digit = substr(value, 12, 1)::integer;
end;
$_$;

alter table public.patients add column iin text;
alter table public.patients add column card_number text;
alter table public.patients add constraint patients_iin_check check (iin is null or private.iin_valid(iin));
alter table public.patients add constraint patients_card_number_check check (card_number is null or (btrim(card_number) <> '' and length(card_number) <= 30));

create index patients_iin_idx on public.patients using btree (organization_id, iin) where iin is not null;

-- The IIN without spaces; a wrong IIN is refused with a clear message; an
-- empty birth date and sex are taken from it
CREATE OR REPLACE FUNCTION "private"."handle_patient_iin"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.iin := nullif(regexp_replace(coalesce(new.iin, ''), '[\s-]', '', 'g'), '');
  new.card_number := nullif(btrim(coalesce(new.card_number, '')), '');
  if new.iin is null then
    return new;
  end if;
  if not private.iin_valid(new.iin) then
    raise exception 'Неверный ИИН: 12 цифр с контрольной суммой' using errcode = '22023', hint = 'patient_iin_invalid';
  end if;
  if tg_op = 'INSERT' or new.iin is distinct from old.iin then
    new.birth_date := coalesce(new.birth_date, private.iin_birth_date(new.iin));
    new.gender := coalesce(new.gender, private.iin_gender(new.iin));
  end if;
  return new;
end;
$$;

--
-- The dental chart
--

-- FDI tooth numbers: permanent 11–18 … 41–48, primary 51–55 … 81–85
CREATE OR REPLACE FUNCTION "private"."is_fdi_tooth"("tooth" integer) RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select tooth is not null and (
    (tooth / 10 between 1 and 4 and tooth % 10 between 1 and 8)
    or (tooth / 10 between 5 and 8 and tooth % 10 between 1 and 5)
  );
$$;

-- The teeth named by the tooth text of a plan item: «36» → {36}, «25, 26»
-- → {25,26}, «11-13» or «13–23» → the teeth between them in the row of the
-- chart. A jaw or the mouth («Верхняя челюсть») names no single tooth.
-- Twin: parseTeeth() in dental-chart/teeth.ts
CREATE OR REPLACE FUNCTION "private"."parse_teeth"("tooth_text" "text") RETURNS smallint[]
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
declare
  chart_row smallint[];
  part text;
  parts text[];
  groups text[];
  number_text text;
  from_tooth integer;
  to_tooth integer;
  a integer;
  b integer;
  k integer;
  i integer;
  matched boolean;
  result smallint[] := '{}'::smallint[];
  value text := lower(btrim(coalesce(tooth_text, '')));
begin
  if value = '' or value ~ '^(верх|ниж|рот)' or value like '%полость%' then
    return result;
  end if;
  parts := regexp_split_to_array(regexp_replace(value, '\s*[-–—]\s*', '-', 'g'), '[,;\s]+');
  foreach part in array parts loop
    groups := regexp_match(part, '^(\d{2})(?:-(\d{2}))?$');
    if groups is null then
      -- Text around the numbers: every number alone
      for number_text in select m[1] from regexp_matches(part, '(\d{2})', 'g') as m loop
        if private.is_fdi_tooth(number_text::integer) and not (number_text::smallint = any(result)) then
          result := result || number_text::smallint;
        end if;
      end loop;
      continue;
    end if;
    from_tooth := groups[1]::integer;
    to_tooth := coalesce(groups[2], groups[1])::integer;
    matched := false;
    for k in 1..4 loop
      chart_row := case k
        when 1 then '{18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28}'::smallint[]
        when 2 then '{48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38}'::smallint[]
        when 3 then '{55,54,53,52,51,61,62,63,64,65}'::smallint[]
        else '{85,84,83,82,81,71,72,73,74,75}'::smallint[]
      end;
      a := array_position(chart_row, from_tooth::smallint);
      b := array_position(chart_row, to_tooth::smallint);
      if a is not null and b is not null then
        for i in least(a, b)..greatest(a, b) loop
          if not (chart_row[i] = any(result)) then
            result := result || chart_row[i];
          end if;
        end loop;
        matched := true;
        exit;
      end if;
    end loop;
    if not matched then
      foreach number_text in array array[from_tooth::text, to_tooth::text] loop
        if private.is_fdi_tooth(number_text::integer) and not (number_text::smallint = any(result)) then
          result := result || number_text::smallint;
        end if;
      end loop;
    end if;
  end loop;
  return result;
end;
$_$;

-- The state of a tooth after a service done, from its name; null: the
-- service does not change the chart. Twin: toothStateForService() in
-- patient-card/toothStates.ts
CREATE OR REPLACE FUNCTION "private"."service_tooth_state"("service_name" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case
    when v ~ '(снятие|демонтаж|консультац|осмотр|снимок|рентген|диагност|отбелив|гигиен)' then null
    when v ~ '(удален|экстракц)' then 'missing'
    when v ~ 'имплант' then 'implant'
    when v ~ 'коронк' then 'crown'
    when v ~ '(пломб|реставрац|кариес|пульпит|периодонтит|канал|эндодонт)' then 'filling'
    else null
  end
  from (select lower(coalesce(service_name, '')) as v) as s;
$$;

create table public.patient_teeth (
    id bigint generated by default as identity primary key,
    organization_id bigint not null default private.current_organization_id(),
    patient_id bigint not null,
    tooth smallint not null,
    state text not null default 'healthy',
    note text,
    updated_by bigint default private.current_sales_id(),
    updated_at timestamp with time zone not null default now(),
    created_at timestamp with time zone not null default now(),
    constraint patient_teeth_tooth_check check (private.is_fdi_tooth(tooth)),
    constraint patient_teeth_state_check check (state in ('healthy', 'caries', 'filling', 'crown', 'missing', 'implant', 'root', 'endo', 'treatment')),
    constraint patient_teeth_note_check check (note is null or length(note) <= 2000)
);

create table public.patient_tooth_history (
    id bigint generated by default as identity primary key,
    organization_id bigint not null,
    patient_id bigint not null,
    tooth smallint not null,
    -- null: no row before (or after: the state was cleared)
    state_before text,
    state text,
    note_before text,
    note text,
    sales_id bigint,
    -- 'manual': the chart; 'plan': an item of a treatment plan marked done
    source text not null default 'manual',
    plan_item_id bigint,
    created_at timestamp with time zone not null default now(),
    constraint patient_tooth_history_source_check check (source in ('manual', 'plan'))
);

--
-- Visit records
--

-- ICD-10 codes: a letter, two digits and an optional subcode (K02.1, Z01.2)
CREATE OR REPLACE FUNCTION "private"."icd_codes_valid"("codes" "text"[]) RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
  select coalesce(bool_and(c ~ '^[A-Z][0-9]{2}(\.[0-9]{1,2})?$'), true) and coalesce(cardinality(codes), 0) <= 20
  from unnest(codes) as c;
$_$;

create table public.visit_records (
    id bigint generated by default as identity primary key,
    organization_id bigint not null default private.current_organization_id(),
    patient_id bigint not null,
    -- The visit of the schedule (CRM or MIS); null: a record without a visit
    visit_id bigint,
    -- The deal of the visit (set by the trigger)
    deal_id bigint,
    doctor_id bigint,
    record_date date,
    complaints text,
    anamnesis text,
    objective text,
    diagnosis_codes text[] not null default '{}'::text[],
    diagnosis text,
    treatment text,
    recommendations text,
    created_by bigint default private.current_sales_id(),
    updated_by bigint default private.current_sales_id(),
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now(),
    constraint visit_records_codes_check check (private.icd_codes_valid(diagnosis_codes))
);

create table public.visit_record_templates (
    id bigint generated by default as identity primary key,
    organization_id bigint not null default private.current_organization_id(),
    name text not null,
    -- { complaints, anamnesis, objective, diagnosis, treatment, recommendations }
    content jsonb not null default '{}'::jsonb,
    diagnosis_codes text[] not null default '{}'::text[],
    position integer not null default 0,
    created_by bigint default private.current_sales_id(),
    created_at timestamp with time zone not null default now(),
    constraint visit_record_templates_name_not_blank check (btrim(name) <> ''),
    constraint visit_record_templates_content_object check (jsonb_typeof(content) = 'object'),
    constraint visit_record_templates_codes_check check (private.icd_codes_valid(diagnosis_codes))
);

--
-- The questionnaire and the consents
--

-- The questions of the questionnaire (besides the stage-29 columns)
CREATE OR REPLACE FUNCTION "private"."questionnaire_valid"("answers" "jsonb") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select jsonb_typeof(answers) = 'object' and not exists (
    select 1
    from jsonb_each(answers) as e(key, value)
    where e.key not in ('medications', 'pregnancy', 'blood_pressure', 'diabetes', 'hepatitis_hiv', 'anesthesia', 'bleeding', 'heart', 'epilepsy', 'smoking')
      or jsonb_typeof(e.value) <> 'object'
      or coalesce(e.value ->> 'answer', 'yes') not in ('yes', 'no')
      or length(coalesce(e.value ->> 'comment', '')) > 1000
  );
$$;

create table public.patient_questionnaires (
    id bigint generated by default as identity primary key,
    organization_id bigint not null default private.current_organization_id(),
    patient_id bigint not null,
    answers jsonb not null default '{}'::jsonb,
    signed_at date,
    updated_by bigint default private.current_sales_id(),
    updated_at timestamp with time zone not null default now(),
    created_at timestamp with time zone not null default now(),
    constraint patient_questionnaires_answers_check check (private.questionnaire_valid(answers))
);

create table public.consent_templates (
    id bigint generated by default as identity primary key,
    organization_id bigint not null default private.current_organization_id(),
    name text not null,
    body text not null default '',
    is_archived boolean not null default false,
    position integer not null default 0,
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now(),
    constraint consent_templates_name_not_blank check (btrim(name) <> ''),
    constraint consent_templates_body_check check (length(body) <= 20000)
);

create table public.patient_files (
    id bigint generated by default as identity primary key,
    organization_id bigint not null default private.current_organization_id(),
    patient_id bigint not null,
    -- Object name in the "deal-files" bucket: "<organization_id>/patients/<patient_id>/<uuid>-<name>"
    path text not null,
    name text not null,
    size bigint not null default 0,
    mime text not null default 'application/octet-stream',
    -- opg (ОПТГ), ct (КТ), periapical (прицельный), photo, document, consent
    kind text not null default 'document',
    taken_at date,
    note text,
    sales_id bigint default private.current_sales_id(),
    created_at timestamp with time zone not null default now(),
    constraint patient_files_name_not_blank check (btrim(name) <> ''),
    constraint patient_files_size_check check (size >= 0 and size <= 20971520),
    constraint patient_files_kind_check check (kind in ('opg', 'ct', 'periapical', 'photo', 'document', 'consent')),
    -- Not tied to the patient id: a merged patient's files keep their objects
    constraint patient_files_path_check check (path like organization_id::text || '/patients/%')
);

create table public.patient_consents (
    id bigint generated by default as identity primary key,
    organization_id bigint not null default private.current_organization_id(),
    patient_id bigint not null,
    template_id bigint,
    title text not null,
    -- The text given to the patient, variables filled in
    body text not null default '',
    signed_at date,
    -- The signed scan or the generated PDF, when saved to the files
    file_id bigint,
    created_by bigint default private.current_sales_id(),
    created_at timestamp with time zone not null default now(),
    constraint patient_consents_title_not_blank check (btrim(title) <> ''),
    constraint patient_consents_body_check check (length(body) <= 30000)
);

--
-- Keys
--

alter table public.patient_teeth add constraint patient_teeth_organization_id_id_key unique (organization_id, id);
alter table public.patient_teeth add constraint patient_teeth_tooth_key unique (organization_id, patient_id, tooth);
alter table public.patient_tooth_history add constraint patient_tooth_history_organization_id_id_key unique (organization_id, id);
alter table public.visit_records add constraint visit_records_organization_id_id_key unique (organization_id, id);
alter table public.visit_record_templates add constraint visit_record_templates_organization_id_id_key unique (organization_id, id);
alter table public.patient_questionnaires add constraint patient_questionnaires_organization_id_id_key unique (organization_id, id);
alter table public.patient_questionnaires add constraint patient_questionnaires_patient_key unique (organization_id, patient_id);
alter table public.consent_templates add constraint consent_templates_organization_id_id_key unique (organization_id, id);
alter table public.patient_files add constraint patient_files_organization_id_id_key unique (organization_id, id);
alter table public.patient_files add constraint patient_files_path_key unique (organization_id, path);
alter table public.patient_consents add constraint patient_consents_organization_id_id_key unique (organization_id, id);

alter table public.patient_teeth
    add constraint patient_teeth_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade;
alter table public.patient_teeth
    add constraint patient_teeth_patient_id_fkey foreign key (organization_id, patient_id) references public.patients(organization_id, id) on delete restrict;
alter table public.patient_teeth
    add constraint patient_teeth_updated_by_fkey foreign key (organization_id, updated_by) references public.sales(organization_id, id) on delete set null (updated_by);
alter table public.patient_tooth_history
    add constraint patient_tooth_history_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade;
alter table public.patient_tooth_history
    add constraint patient_tooth_history_patient_id_fkey foreign key (organization_id, patient_id) references public.patients(organization_id, id) on delete restrict;
alter table public.patient_tooth_history
    add constraint patient_tooth_history_sales_id_fkey foreign key (organization_id, sales_id) references public.sales(organization_id, id) on delete set null (sales_id);
alter table public.patient_tooth_history
    add constraint patient_tooth_history_plan_item_id_fkey foreign key (organization_id, plan_item_id) references public.treatment_plan_items(organization_id, id) on delete set null (plan_item_id);
alter table public.visit_records
    add constraint visit_records_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade;
alter table public.visit_records
    add constraint visit_records_patient_id_fkey foreign key (organization_id, patient_id) references public.patients(organization_id, id) on delete restrict;
alter table public.visit_records
    add constraint visit_records_visit_id_fkey foreign key (organization_id, visit_id) references public.visits(organization_id, id) on delete set null (visit_id);
alter table public.visit_records
    add constraint visit_records_deal_id_fkey foreign key (organization_id, deal_id) references public.deals(organization_id, id) on delete set null (deal_id);
alter table public.visit_records
    add constraint visit_records_doctor_id_fkey foreign key (organization_id, doctor_id) references public.doctors(organization_id, id) on delete set null (doctor_id);
alter table public.visit_records
    add constraint visit_records_created_by_fkey foreign key (organization_id, created_by) references public.sales(organization_id, id) on delete set null (created_by);
alter table public.visit_records
    add constraint visit_records_updated_by_fkey foreign key (organization_id, updated_by) references public.sales(organization_id, id) on delete set null (updated_by);
alter table public.visit_record_templates
    add constraint visit_record_templates_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade;
alter table public.visit_record_templates
    add constraint visit_record_templates_created_by_fkey foreign key (organization_id, created_by) references public.sales(organization_id, id) on delete set null (created_by);
alter table public.patient_questionnaires
    add constraint patient_questionnaires_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade;
alter table public.patient_questionnaires
    add constraint patient_questionnaires_patient_id_fkey foreign key (organization_id, patient_id) references public.patients(organization_id, id) on delete restrict;
alter table public.patient_questionnaires
    add constraint patient_questionnaires_updated_by_fkey foreign key (organization_id, updated_by) references public.sales(organization_id, id) on delete set null (updated_by);
alter table public.consent_templates
    add constraint consent_templates_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade;
alter table public.patient_files
    add constraint patient_files_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade;
alter table public.patient_files
    add constraint patient_files_patient_id_fkey foreign key (organization_id, patient_id) references public.patients(organization_id, id) on delete restrict;
alter table public.patient_files
    add constraint patient_files_sales_id_fkey foreign key (organization_id, sales_id) references public.sales(organization_id, id) on delete set null (sales_id);
alter table public.patient_consents
    add constraint patient_consents_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade;
alter table public.patient_consents
    add constraint patient_consents_patient_id_fkey foreign key (organization_id, patient_id) references public.patients(organization_id, id) on delete restrict;
alter table public.patient_consents
    add constraint patient_consents_template_id_fkey foreign key (organization_id, template_id) references public.consent_templates(organization_id, id) on delete set null (template_id);
alter table public.patient_consents
    add constraint patient_consents_file_id_fkey foreign key (organization_id, file_id) references public.patient_files(organization_id, id) on delete set null (file_id);
alter table public.patient_consents
    add constraint patient_consents_created_by_fkey foreign key (organization_id, created_by) references public.sales(organization_id, id) on delete set null (created_by);

create index patient_tooth_history_patient_idx on public.patient_tooth_history using btree (organization_id, patient_id, tooth, created_at desc);
create index visit_records_patient_idx on public.visit_records using btree (organization_id, patient_id, record_date desc);
create unique index visit_records_visit_idx on public.visit_records using btree (organization_id, visit_id) where visit_id is not null;
create index patient_files_patient_idx on public.patient_files using btree (organization_id, patient_id, created_at);
create index patient_consents_patient_idx on public.patient_consents using btree (organization_id, patient_id, created_at);

--
-- Functions
--

-- A tooth: who changed it and when; a merged patient's tooth gives way to
-- the kept patient's own row of the same tooth
CREATE OR REPLACE FUNCTION "private"."handle_patient_tooth_before_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'UPDATE' and new.patient_id is distinct from old.patient_id then
    if exists (
      select 1 from public.patient_teeth t
      where t.organization_id = new.organization_id and t.patient_id = new.patient_id and t.tooth = new.tooth
    ) then
      return null;
    end if;
    return new;
  end if;
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  if tg_op = 'UPDATE' and new.state is not distinct from old.state and new.note is not distinct from old.note then
    return new;
  end if;
  new.updated_by := coalesce(private.current_sales_id(), new.updated_by);
  new.updated_at := now();
  return new;
end;
$$;

-- The history of a tooth: one row per change of its state or note
CREATE OR REPLACE FUNCTION "private"."handle_patient_tooth_after_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  row_data public.patient_teeth := coalesce(new, old);
  change_source text := coalesce(nullif(current_setting('crm.tooth_source', true), ''), 'manual');
  item_id bigint := nullif(current_setting('crm.tooth_plan_item', true), '')::bigint;
begin
  if tg_op = 'UPDATE' and (new.patient_id is distinct from old.patient_id
    or (new.state is not distinct from old.state and new.note is not distinct from old.note)) then
    return null;
  end if;
  -- Deleted with the patient (or the clinic), or given way to the kept
  -- patient's own tooth in a merge (stage 41): nothing to tell
  if tg_op = 'DELETE' and (current_setting('crm.patient_merge', true) = 'on' or not exists (
    select 1 from public.patients p where p.organization_id = old.organization_id and p.id = old.patient_id
  )) then
    return null;
  end if;
  insert into public.patient_tooth_history (organization_id, patient_id, tooth, state_before, state, note_before, note, sales_id, source, plan_item_id)
  values (row_data.organization_id, row_data.patient_id, row_data.tooth,
    case when tg_op <> 'INSERT' then old.state end,
    case when tg_op <> 'DELETE' then new.state end,
    case when tg_op <> 'INSERT' then old.note end,
    case when tg_op <> 'DELETE' then new.note end,
    private.current_sales_id(),
    change_source,
    case when change_source = 'plan' then item_id end);
  return null;
end;
$$;

-- An item of a treatment plan marked done sets the state of its teeth when
-- its name names a result (private.service_tooth_state)
CREATE OR REPLACE FUNCTION "private"."handle_plan_item_tooth_state"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  next_state text;
  target_patient bigint;
  tooth_number smallint;
begin
  if not new.done or (tg_op = 'UPDATE' and old.done) then
    return null;
  end if;
  next_state := private.service_tooth_state(new.name);
  if next_state is null then
    return null;
  end if;
  select p.patient_id into target_patient
  from public.treatment_plans p
  where p.organization_id = new.organization_id and p.id = new.plan_id;
  if target_patient is null then
    return null;
  end if;
  perform set_config('crm.tooth_source', 'plan', true);
  perform set_config('crm.tooth_plan_item', new.id::text, true);
  foreach tooth_number in array private.parse_teeth(new.tooth) loop
    insert into public.patient_teeth (organization_id, patient_id, tooth, state)
    values (new.organization_id, target_patient, tooth_number, next_state)
    on conflict (organization_id, patient_id, tooth) do update set state = excluded.state;
  end loop;
  perform set_config('crm.tooth_source', '', true);
  perform set_config('crm.tooth_plan_item', '', true);
  return null;
end;
$$;

-- A record of a visit: the visit of this patient, its deal, its doctor and
-- its day by default; who changed it last
CREATE OR REPLACE FUNCTION "private"."handle_visit_record_before_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  visit public.visits;
  clinic_zone text;
begin
  -- Patients merged (stage 18): the rows only follow their patient
  if tg_op = 'UPDATE' and new.patient_id is distinct from old.patient_id
    and current_setting('crm.visit_sync', true) = 'on' then
    return new;
  end if;
  new.diagnosis_codes := coalesce(array(
    select distinct upper(btrim(c)) from unnest(new.diagnosis_codes) as c where btrim(c) <> ''
  ), '{}'::text[]);
  if new.visit_id is not null then
    select * into visit from public.visits v
    where v.organization_id = new.organization_id and v.id = new.visit_id;
    if visit.id is null or visit.patient_id <> new.patient_id then
      raise exception 'Визит другого пациента' using errcode = '22023', hint = 'visit_record_patient';
    end if;
    new.deal_id := visit.deal_id;
    new.doctor_id := coalesce(new.doctor_id, visit.doctor_id);
    if new.record_date is null then
      select o.timezone into clinic_zone from public.organizations o where o.id = new.organization_id;
      new.record_date := (visit.starts_at at time zone coalesce(clinic_zone, 'Asia/Almaty'))::date;
    end if;
  end if;
  new.record_date := coalesce(new.record_date, current_date);
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := coalesce(private.current_sales_id(), new.updated_by);
  new.updated_at := now();
  return new;
end;
$$;

-- The questionnaire: who filled it last; a merged patient's questionnaire
-- gives way to the kept patient's own
CREATE OR REPLACE FUNCTION "private"."handle_questionnaire_before_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'UPDATE' and new.patient_id is distinct from old.patient_id then
    if exists (
      select 1 from public.patient_questionnaires q
      where q.organization_id = new.organization_id and q.patient_id = new.patient_id
    ) then
      return null;
    end if;
    return new;
  end if;
  new.updated_by := coalesce(private.current_sales_id(), new.updated_by);
  new.updated_at := now();
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- The consent templates of a clinic
CREATE OR REPLACE FUNCTION "private"."seed_consent_templates"("org_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if exists (select 1 from public.consent_templates t where t.organization_id = org_id) then
    return;
  end if;
  insert into public.consent_templates (organization_id, name, body, position)
  values
    (org_id, 'Информированное добровольное согласие на стоматологическое лечение',
     E'Я, {пациент}, {дата_рождения} г. р., ИИН {иин}, даю информированное добровольное согласие на стоматологическое лечение в клинике «{клиника}».\n\n'
     || E'Врач {врач} в доступной форме объяснил(а) мне диагноз, план лечения, возможные варианты лечения, их стоимость, ожидаемые результаты, возможные осложнения и последствия отказа от лечения.\n\n'
     || E'Я сообщил(а) врачу все известные мне сведения о состоянии здоровья, аллергических реакциях и принимаемых лекарствах. Я понимаю, что результат лечения зависит также от соблюдения мной рекомендаций врача и гигиены полости рта.\n\n'
     || E'Мне понятно, что я вправе отказаться от лечения на любом этапе.\n\n'
     || E'Дата: {дата}\nПациент: ____________ / {пациент}\nВрач: ____________ / {врач}', 0),
    (org_id, 'Согласие на местную анестезию',
     E'Я, {пациент}, ИИН {иин}, согласен(на) на проведение местной анестезии.\n\n'
     || E'Мне разъяснены возможные реакции: аллергия, отёк, временное онемение, гематома. О перенесённых реакциях на анестезию, беременности и хронических заболеваниях я сообщил(а) врачу.\n\n'
     || E'Дата: {дата}\nПациент: ____________ / {пациент}', 1),
    (org_id, 'Согласие на хирургическое вмешательство и имплантацию',
     E'Я, {пациент}, {дата_рождения} г. р., даю согласие на хирургическое вмешательство (удаление зуба, имплантацию) в клинике «{клиника}».\n\n'
     || E'Врач {врач} разъяснил(а) мне ход операции, период заживления, возможные осложнения (кровотечение, отёк, боль, воспаление, отторжение импланта) и необходимость контрольных визитов.\n\n'
     || E'Дата: {дата}\nПациент: ____________ / {пациент}\nВрач: ____________ / {врач}', 2),
    (org_id, 'Согласие на обработку персональных данных',
     E'Я, {пациент}, телефон {телефон}, даю согласие клинике «{клиника}» на сбор, хранение и обработку моих персональных данных и сведений о здоровье для оказания медицинских услуг, ведения медицинской документации и связи со мной, в соответствии с Законом Республики Казахстан «О персональных данных и их защите».\n\n'
     || E'Дата: {дата}\nПациент: ____________ / {пациент}', 3);
end;
$$;

CREATE OR REPLACE FUNCTION "private"."handle_organization_consent_templates"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform private.seed_consent_templates(new.id);
  return new;
end;
$$;

-- The patient of a storage object of the current clinic
-- ("<organization_id>/patients/<patient_id>/..."), else null. Runs with the
-- caller's rights: the storage policies check the patient is visible.
CREATE OR REPLACE FUNCTION "private"."storage_patient_id"("object_name" "text") RETURNS bigint
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $_$
declare
  parts text[] := string_to_array(object_name, '/');
begin
  if coalesce(array_length(parts, 1), 0) < 4
    or parts[1] is distinct from private.current_organization_id()::text
    or parts[2] <> 'patients'
    or parts[3] !~ '^[0-9]{1,18}$'
    or parts[4] = ''
  then
    return null;
  end if;
  return parts[3]::bigint;
end;
$_$;

--
-- Views
--

-- patients_summary (19_custom_fields.sql, 29_treatment_plans.sql) with the
-- IIN and the card number at the end
create or replace view public.patients_summary with (security_invoker = on) as
select
    p.id,
    p.organization_id,
    p.first_name,
    p.last_name,
    p.middle_name,
    p.phone_jsonb,
    p.phones,
    p.birth_date,
    p.city,
    p.whatsapp,
    p.instagram,
    p.telegram,
    p.source_id,
    p.tags,
    p.sales_id,
    p.gender,
    p.avatar,
    p.background,
    p.status,
    p.first_seen,
    p.last_seen,
    array_to_string(p.phones, ' ') as phone_fts,
    (
        select count(*)
        from public.deals d
        where d.organization_id = p.organization_id and d.patient_id = p.id
    ) as nb_deals,
    (
        select count(*)
        from public.deals d
            join public.stages s on s.id = d.stage_id
        where d.organization_id = p.organization_id and d.patient_id = p.id and s.kind = 'open'
    ) as nb_open_deals,
    (
        select count(*)
        from public.tasks t
            join public.deals d on d.organization_id = t.organization_id and d.id = t.deal_id
        where d.organization_id = p.organization_id and d.patient_id = p.id and t.done_date is null
    ) as nb_tasks,
    p.custom_values,
    p.allergies,
    p.contraindications,
    p.chronic_diseases,
    p.preferred_doctor_id,
    p.iin,
    p.card_number
from public.patients p;

--
-- Triggers
--

create or replace trigger patient_iin
    before insert or update of iin, card_number on public.patients
    for each row execute function private.handle_patient_iin();

create or replace trigger patient_tooth_before_write
    before insert or update on public.patient_teeth
    for each row execute function private.handle_patient_tooth_before_write();

create or replace trigger patient_tooth_after_write
    after insert or update or delete on public.patient_teeth
    for each row execute function private.handle_patient_tooth_after_write();

create or replace trigger treatment_item_tooth_state
    after insert or update of done on public.treatment_plan_items
    for each row execute function private.handle_plan_item_tooth_state();

create or replace trigger visit_record_before_write
    before insert or update on public.visit_records
    for each row execute function private.handle_visit_record_before_write();

create or replace trigger questionnaire_before_write
    before insert or update on public.patient_questionnaires
    for each row execute function private.handle_questionnaire_before_write();

create or replace trigger consent_template_touch
    before update on public.consent_templates
    for each row execute function private.touch_updated_at();

create or replace trigger seed_consent_templates
    after insert on public.organizations
    for each row execute function private.handle_organization_consent_templates();

-- Audit log (group «Пациенты»)
create or replace trigger audit_patient_card
    after update on public.patients
    for each row execute function private.audit_row('patient', 'iin,card_number');

create or replace trigger audit_patient_tooth
    after insert or update or delete on public.patient_teeth
    for each row execute function private.audit_row('patient_tooth', 'tooth,state,note');

create or replace trigger audit_visit_record
    after insert or update or delete on public.visit_records
    for each row execute function private.audit_row('visit_record', 'visit_id,doctor_id,record_date,complaints,anamnesis,objective,diagnosis_codes,diagnosis,treatment,recommendations');

create or replace trigger audit_visit_record_template
    after insert or update or delete on public.visit_record_templates
    for each row execute function private.audit_row('visit_record_template', 'name');

create or replace trigger audit_patient_questionnaire
    after insert or update or delete on public.patient_questionnaires
    for each row execute function private.audit_row('patient_questionnaire', 'answers,signed_at');

create or replace trigger audit_consent_template
    after insert or update or delete on public.consent_templates
    for each row execute function private.audit_row('consent_template', 'name,body,is_archived');

create or replace trigger audit_patient_consent
    after insert or update or delete on public.patient_consents
    for each row execute function private.audit_row('patient_consent', 'title,signed_at');

create or replace trigger audit_patient_file_insert
    after insert on public.patient_files
    for each row execute function private.audit_row('patient_file', 'name,kind,size');

create or replace trigger audit_patient_file_update
    after update on public.patient_files
    for each row execute function private.audit_row('patient_file', 'kind,taken_at,note');

create or replace trigger audit_patient_file_delete
    after delete on public.patient_files
    for each row execute function private.audit_row('patient_file', 'name,kind,size');

--
-- Row Level Security
--

alter table public.patient_teeth enable row level security;
alter table public.patient_tooth_history enable row level security;
alter table public.visit_records enable row level security;
alter table public.visit_record_templates enable row level security;
alter table public.patient_questionnaires enable row level security;
alter table public.consent_templates enable row level security;
alter table public.patient_consents enable row level security;
alter table public.patient_files enable row level security;

-- Medical rows follow the visibility of their patient (the sub-query
-- applies the patients policy); never for the integrator
create policy "Medical rows of visible patients can be read" on public.patient_teeth for select to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) <> 'integrator'
        and exists (select 1 from public.patients p where p.organization_id = patient_teeth.organization_id and p.id = patient_teeth.patient_id));
create policy "Staff can insert on visible patients" on public.patient_teeth for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head', 'manager')
        and exists (select 1 from public.patients p where p.organization_id = patient_teeth.organization_id and p.id = patient_teeth.patient_id));
create policy "Staff can update on visible patients" on public.patient_teeth for update to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head', 'manager')
        and exists (select 1 from public.patients p where p.organization_id = patient_teeth.organization_id and p.id = patient_teeth.patient_id))
    with check (organization_id = (select private.current_organization_id()));
create policy "Staff can delete on visible patients" on public.patient_teeth for delete to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head', 'manager')
        and exists (select 1 from public.patients p where p.organization_id = patient_teeth.organization_id and p.id = patient_teeth.patient_id));

create policy "Medical rows of visible patients can be read" on public.patient_tooth_history for select to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) <> 'integrator'
        and exists (select 1 from public.patients p where p.organization_id = patient_tooth_history.organization_id and p.id = patient_tooth_history.patient_id));

create policy "Medical rows of visible patients can be read" on public.visit_records for select to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) <> 'integrator'
        and exists (select 1 from public.patients p where p.organization_id = visit_records.organization_id and p.id = visit_records.patient_id));
create policy "Staff can insert on visible patients" on public.visit_records for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head', 'manager')
        and exists (select 1 from public.patients p where p.organization_id = visit_records.organization_id and p.id = visit_records.patient_id));
create policy "Staff can update on visible patients" on public.visit_records for update to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head', 'manager')
        and exists (select 1 from public.patients p where p.organization_id = visit_records.organization_id and p.id = visit_records.patient_id))
    with check (organization_id = (select private.current_organization_id()));
create policy "Owner, head or author can delete" on public.visit_records for delete to authenticated
    using (organization_id = (select private.current_organization_id())
        and ((select private.current_user_role()) in ('owner', 'head') or ((select private.current_user_role()) = 'manager' and created_by = (select private.current_sales_id())))
        and exists (select 1 from public.patients p where p.organization_id = visit_records.organization_id and p.id = visit_records.patient_id));

-- Templates of the records: the staff read and save them; the owner, the
-- head or the author change and delete them
create policy "Staff can read" on public.visit_record_templates for select to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head', 'manager'));
create policy "Staff can insert" on public.visit_record_templates for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head', 'manager'));
create policy "Owner, head or author can update" on public.visit_record_templates for update to authenticated
    using (organization_id = (select private.current_organization_id())
        and ((select private.current_user_role()) in ('owner', 'head') or ((select private.current_user_role()) = 'manager' and created_by = (select private.current_sales_id()))))
    with check (organization_id = (select private.current_organization_id()));
create policy "Owner, head or author can delete" on public.visit_record_templates for delete to authenticated
    using (organization_id = (select private.current_organization_id())
        and ((select private.current_user_role()) in ('owner', 'head') or ((select private.current_user_role()) = 'manager' and created_by = (select private.current_sales_id()))));

create policy "Medical rows of visible patients can be read" on public.patient_questionnaires for select to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) <> 'integrator'
        and exists (select 1 from public.patients p where p.organization_id = patient_questionnaires.organization_id and p.id = patient_questionnaires.patient_id));
create policy "Staff can insert on visible patients" on public.patient_questionnaires for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head', 'manager')
        and exists (select 1 from public.patients p where p.organization_id = patient_questionnaires.organization_id and p.id = patient_questionnaires.patient_id));
create policy "Staff can update on visible patients" on public.patient_questionnaires for update to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head', 'manager')
        and exists (select 1 from public.patients p where p.organization_id = patient_questionnaires.organization_id and p.id = patient_questionnaires.patient_id))
    with check (organization_id = (select private.current_organization_id()));
create policy "Owner and head can delete" on public.patient_questionnaires for delete to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'));

-- Consent templates: the staff read them, the owner and the head write them
create policy "Staff can read" on public.consent_templates for select to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head', 'manager'));
create policy "Owner and head can insert" on public.consent_templates for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'));
create policy "Owner and head can update" on public.consent_templates for update to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'))
    with check (organization_id = (select private.current_organization_id()));
create policy "Owner and head can delete" on public.consent_templates for delete to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'));

create policy "Medical rows of visible patients can be read" on public.patient_consents for select to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) <> 'integrator'
        and exists (select 1 from public.patients p where p.organization_id = patient_consents.organization_id and p.id = patient_consents.patient_id));
create policy "Staff can insert on visible patients" on public.patient_consents for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head', 'manager')
        and exists (select 1 from public.patients p where p.organization_id = patient_consents.organization_id and p.id = patient_consents.patient_id));
create policy "Staff can update on visible patients" on public.patient_consents for update to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head', 'manager')
        and exists (select 1 from public.patients p where p.organization_id = patient_consents.organization_id and p.id = patient_consents.patient_id))
    with check (organization_id = (select private.current_organization_id()));
create policy "Owner, head or author can delete" on public.patient_consents for delete to authenticated
    using (organization_id = (select private.current_organization_id())
        and ((select private.current_user_role()) in ('owner', 'head') or ((select private.current_user_role()) = 'manager' and created_by = (select private.current_sales_id())))
        and exists (select 1 from public.patients p where p.organization_id = patient_consents.organization_id and p.id = patient_consents.patient_id));

create policy "Medical rows of visible patients can be read" on public.patient_files for select to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) <> 'integrator'
        and exists (select 1 from public.patients p where p.organization_id = patient_files.organization_id and p.id = patient_files.patient_id));
create policy "Own files of visible patients can be inserted" on public.patient_files for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head', 'manager')
        and sales_id = (select private.current_sales_id())
        and path like organization_id::text || '/patients/' || patient_id::text || '/%'
        and exists (select 1 from public.patients p where p.organization_id = patient_files.organization_id and p.id = patient_files.patient_id));
create policy "Staff can update on visible patients" on public.patient_files for update to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head', 'manager')
        and exists (select 1 from public.patients p where p.organization_id = patient_files.organization_id and p.id = patient_files.patient_id))
    with check (organization_id = (select private.current_organization_id()));
create policy "Owner, head or uploader can delete" on public.patient_files for delete to authenticated
    using (organization_id = (select private.current_organization_id())
        and ((select private.current_user_role()) in ('owner', 'head') or ((select private.current_user_role()) = 'manager' and sales_id = (select private.current_sales_id())))
        and exists (select 1 from public.patients p where p.organization_id = patient_files.organization_id and p.id = patient_files.patient_id));

-- Storage: the patient folders of the bucket deal-files. Reading goes by
-- the listed file (a merged patient's files keep their folder); uploading
-- into the folder of a visible patient; deleting by the owner, the head or
-- the uploader (the list row is removed first)
create policy "Patient files of visible patients: select" on storage.objects for select to authenticated
    using (bucket_id = 'deal-files' and exists (select 1 from public.patient_files f where f.organization_id = (select private.current_organization_id()) and f.path = objects.name));
create policy "Patient files of visible patients: insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'deal-files' and (select private.current_user_role()) in ('owner', 'head', 'manager')
        and exists (select 1 from public.patients p where p.organization_id = (select private.current_organization_id()) and p.id = private.storage_patient_id(objects.name)));
create policy "Patient files by owner, head or uploader: delete" on storage.objects for delete to authenticated
    using (bucket_id = 'deal-files' and split_part(objects.name, '/', 1) = (select private.current_organization_id())::text
        and split_part(objects.name, '/', 2) = 'patients'
        and ((select private.current_user_role()) in ('owner', 'head') or objects.owner = (select auth.uid())));

--
-- Grants
--

revoke all on table public.patient_teeth from anon;
grant select, insert, update, delete on table public.patient_teeth to authenticated;
grant all on table public.patient_teeth to service_role;
revoke all on sequence public.patient_teeth_id_seq from anon;
grant usage on sequence public.patient_teeth_id_seq to authenticated;
grant all on sequence public.patient_teeth_id_seq to service_role;

-- The history is written by the trigger only
revoke all on table public.patient_tooth_history from anon, authenticated;
grant select on table public.patient_tooth_history to authenticated;
grant all on table public.patient_tooth_history to service_role;
revoke all on sequence public.patient_tooth_history_id_seq from anon, authenticated;
grant all on sequence public.patient_tooth_history_id_seq to service_role;

revoke all on table public.visit_records from anon;
grant select, insert, update, delete on table public.visit_records to authenticated;
grant all on table public.visit_records to service_role;
revoke all on sequence public.visit_records_id_seq from anon;
grant usage on sequence public.visit_records_id_seq to authenticated;
grant all on sequence public.visit_records_id_seq to service_role;

revoke all on table public.visit_record_templates from anon;
grant select, insert, update, delete on table public.visit_record_templates to authenticated;
grant all on table public.visit_record_templates to service_role;
revoke all on sequence public.visit_record_templates_id_seq from anon;
grant usage on sequence public.visit_record_templates_id_seq to authenticated;
grant all on sequence public.visit_record_templates_id_seq to service_role;

revoke all on table public.patient_questionnaires from anon;
grant select, insert, update, delete on table public.patient_questionnaires to authenticated;
grant all on table public.patient_questionnaires to service_role;
revoke all on sequence public.patient_questionnaires_id_seq from anon;
grant usage on sequence public.patient_questionnaires_id_seq to authenticated;
grant all on sequence public.patient_questionnaires_id_seq to service_role;

revoke all on table public.consent_templates from anon;
grant select, insert, update, delete on table public.consent_templates to authenticated;
grant all on table public.consent_templates to service_role;
revoke all on sequence public.consent_templates_id_seq from anon;
grant usage on sequence public.consent_templates_id_seq to authenticated;
grant all on sequence public.consent_templates_id_seq to service_role;

revoke all on table public.patient_consents from anon;
grant select, insert, update, delete on table public.patient_consents to authenticated;
grant all on table public.patient_consents to service_role;
revoke all on sequence public.patient_consents_id_seq from anon;
grant usage on sequence public.patient_consents_id_seq to authenticated;
grant all on sequence public.patient_consents_id_seq to service_role;

-- A file is replaced by a new one: only its type, date and note change
revoke all on table public.patient_files from anon, authenticated;
grant select, insert, delete on table public.patient_files to authenticated;
grant update (kind, taken_at, note) on table public.patient_files to authenticated;
grant all on table public.patient_files to service_role;
revoke all on sequence public.patient_files_id_seq from anon, authenticated;
grant usage on sequence public.patient_files_id_seq to authenticated;
grant all on sequence public.patient_files_id_seq to service_role;

revoke all on function private.handle_patient_iin() from public;
revoke all on function private.handle_patient_tooth_before_write() from public;
revoke all on function private.handle_patient_tooth_after_write() from public;
revoke all on function private.handle_plan_item_tooth_state() from public;
revoke all on function private.handle_visit_record_before_write() from public;
revoke all on function private.handle_questionnaire_before_write() from public;
revoke all on function private.handle_organization_consent_templates() from public;
revoke all on function private.seed_consent_templates(bigint) from public;
grant execute on function private.seed_consent_templates(bigint) to service_role;

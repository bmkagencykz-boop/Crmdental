--
-- The full patient card (stage 37): the IIN (checksum, birth date and sex
-- derived), the card number, the dental chart (states, notes, history of
-- every tooth, states from the done items of a treatment plan), visit
-- records (visit of the patient, ICD-10 codes, templates), the
-- questionnaire, consent templates and consents, patient files and their
-- storage folder, rights per role (the integrator sees nothing medical),
-- the audit log, patient merge, clinic isolation.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m2', tests.invite('m2@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.int', tests.invite('int@clinic.kz', current_setting('t.org')::bigint, 'integrator')::text, true);
select set_config('t.owner_id', (select id from public.sales where email = 'owner@clinic.kz')::text, true);
select set_config('t.m1_id', (select id from public.sales where email = 'm1@clinic.kz')::text, true);
select set_config('t.m2_id', (select id from public.sales where email = 'm2@clinic.kz')::text, true);
select set_config('t.other', tests.sign_up('owner@second.kz', 'Другая')::text, true);
select set_config('t.other_org', tests.org_of(current_setting('t.other')::uuid)::text, true);

update public.task_rules set is_active = false;

create function tests.history_count(target bigint, tooth_number integer) returns bigint language sql security definer as $$
  select count(*) from public.patient_tooth_history where patient_id = target and tooth = tooth_number
$$;
create function tests.audit_count(entity_name text, target bigint) returns bigint language sql security definer as $$
  select count(*) from public.audit_log where entity = entity_name and patient_id = target
$$;
grant execute on all functions in schema tests to authenticated;

--
-- The IIN
--
select tests.assert(private.iin_valid('900515400123'), 'a valid IIN (a woman born 15.05.1990)');
select tests.assert(private.iin_valid('851203300459'), 'a valid IIN (a man born 03.12.1985)');
select tests.assert(private.iin_valid('900515400502'), 'a valid IIN checked with the second weights');
select tests.assert(not private.iin_valid('900515400124'), 'a wrong check digit');
select tests.assert(not private.iin_valid('90051540012'), 'eleven digits');
select tests.assert(not private.iin_valid('901315400123'), 'month 13 is not a date');
select tests.assert(not private.iin_valid('900515700123'), 'the 7th digit gives no century');
select tests.assert(private.iin_birth_date('120305650781') = date '2012-03-05', 'the 2000s: 7th digit 5–6');
select tests.assert(private.iin_birth_date('851203300459') = date '1985-12-03', 'the 1900s: 7th digit 3–4');
select tests.assert(private.iin_gender('851203300459') = 'male' and private.iin_gender('900515400123') = 'female', 'odd: a man, even: a woman');

-- The clinic: a doctor, patients, deals
select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert((select count(*) from public.consent_templates) = 4, 'a new clinic gets four consent templates');
insert into public.doctors (name) values ('Ахметова Айгуль');
select set_config('t.doctor', (select id from public.doctors where name = 'Ахметова Айгуль')::text, true);
insert into public.patients (first_name, last_name, iin, card_number)
values ('Асель', 'Нурланова', '9005 1540 0123', ' 1024 ');
select set_config('t.p', (select id from public.patients where first_name = 'Асель')::text, true);
select tests.assert(
  (select iin = '900515400123' and birth_date = date '1990-05-15' and gender = 'female' and card_number = '1024'
   from public.patients where id = current_setting('t.p')::bigint),
  'the IIN without spaces gives the birth date and the sex; the card number is trimmed');
select tests.assert(
  (select iin = '900515400123' and card_number = '1024' from public.patients_summary where id = current_setting('t.p')::bigint),
  'patients_summary shows the IIN and the card number');
select tests.throws($$insert into public.patients (first_name, iin) values ('Ошибка', '900515400124')$$, '22023', 'a wrong IIN is refused');
insert into public.patients (first_name, last_name, birth_date, gender) values ('Ерлан', 'Омаров', date '1985-01-01', 'female');
select set_config('t.e', (select id from public.patients where first_name = 'Ерлан')::text, true);
update public.patients set iin = '851203300459' where id = current_setting('t.e')::bigint;
select tests.assert(
  (select birth_date = date '1985-01-01' and gender = 'female' from public.patients where id = current_setting('t.e')::bigint),
  'a birth date and a sex already filled are kept');
select tests.assert(tests.audit_count('patient', current_setting('t.e')::bigint) >= 1
  and exists (select 1 from public.audit_log where entity = 'patient' and entity_id = current_setting('t.e')::bigint and changes ? 'iin'),
  'the IIN change is in the audit log');
insert into public.deals (patient_id, name, sales_id) values (current_setting('t.p')::bigint, 'implant', current_setting('t.m1_id')::bigint);
insert into public.deals (patient_id, name, sales_id) values (current_setting('t.e')::bigint, 'erlan', current_setting('t.m2_id')::bigint);
select set_config('t.d1', (select id from public.deals where name = 'implant')::text, true);
select tests.logout();

--
-- The dental chart
--
select tests.login_as(current_setting('t.m1')::uuid);
insert into public.patient_teeth (patient_id, tooth, state, note) values (current_setting('t.p')::bigint, 36, 'caries', ' глубокий ');
select tests.assert(
  (select state = 'caries' and note = 'глубокий' and updated_by = current_setting('t.m1_id')::bigint
   from public.patient_teeth where patient_id = current_setting('t.p')::bigint and tooth = 36),
  'a tooth state with a note, by the manager');
update public.patient_teeth set state = 'filling' where patient_id = current_setting('t.p')::bigint and tooth = 36;
update public.patient_teeth set state = 'filling' where patient_id = current_setting('t.p')::bigint and tooth = 36;
select tests.assert(tests.history_count(current_setting('t.p')::bigint, 36) = 2, 'two changes, two history rows (the same state again is not a change)');
select tests.assert(
  (select state_before = 'caries' and state = 'filling' and sales_id = current_setting('t.m1_id')::bigint and source = 'manual'
   from public.patient_tooth_history where patient_id = current_setting('t.p')::bigint and tooth = 36 order by id desc limit 1),
  'the history keeps before, after, who and the source');
insert into public.patient_teeth (patient_id, tooth, state) values (current_setting('t.p')::bigint, 55, 'root');
select tests.throws($$insert into public.patient_teeth (patient_id, tooth, state) values (current_setting('t.p')::bigint, 19, 'caries')$$, '23514', 'tooth 19 does not exist');
select tests.throws($$insert into public.patient_teeth (patient_id, tooth, state) values (current_setting('t.p')::bigint, 56, 'caries')$$, '23514', 'primary teeth end at 5');
select tests.throws($$insert into public.patient_teeth (patient_id, tooth, state) values (current_setting('t.p')::bigint, 11, 'broken')$$, '23514', 'an unknown state');
select tests.throws($$insert into public.patient_teeth (patient_id, tooth, state) values (current_setting('t.p')::bigint, 36, 'crown')$$, '23505', 'one row per tooth');
select tests.throws($$insert into public.patient_tooth_history (organization_id, patient_id, tooth, state) values (current_setting('t.org')::bigint, current_setting('t.p')::bigint, 11, 'crown')$$, '42501', 'nobody writes the history');
delete from public.patient_teeth where patient_id = current_setting('t.p')::bigint and tooth = 55;
select tests.assert(
  (select state_before = 'root' and state is null from public.patient_tooth_history
   where patient_id = current_setting('t.p')::bigint and tooth = 55 order by id desc limit 1),
  'a cleared tooth is in the history');
select tests.assert(tests.audit_count('patient_tooth', current_setting('t.p')::bigint) = 4, 'every change of a tooth is in the audit log, with the patient');
select tests.logout();

-- Teeth of the plan text
select tests.assert(private.parse_teeth('36') = '{36}', 'one tooth');
select tests.assert(private.parse_teeth('25, 26') = '{25,26}', 'a list');
select tests.assert(private.parse_teeth('11-13') = '{13,12,11}', 'a range in the order of the chart');
select tests.assert(private.parse_teeth('13–23') = '{13,12,11,21,22,23}', 'a range across the midline');
select tests.assert(private.parse_teeth('Верхняя челюсть') = '{}', 'a jaw is not a tooth');
select tests.assert(private.parse_teeth('36 мезиально, 99') = '{36}', 'text around the numbers, unknown numbers dropped');
select tests.assert(private.service_tooth_state('Пломба светоотверждаемая') = 'filling', 'a filling');
select tests.assert(private.service_tooth_state('Коронка металлокерамическая') = 'crown', 'a crown');
select tests.assert(private.service_tooth_state('Установка импланта Osstem') = 'implant', 'an implant');
select tests.assert(private.service_tooth_state('Коронка на имплант') = 'implant', 'a crown on an implant: an implant');
select tests.assert(private.service_tooth_state('Удаление зуба сложное') = 'missing', 'an extraction');
select tests.assert(private.service_tooth_state('Снятие коронки') is null, 'removing a crown says nothing');
select tests.assert(private.service_tooth_state('Консультация') is null, 'a consultation says nothing');

-- A done item of a treatment plan sets the state of its teeth
select tests.login_as(current_setting('t.m1')::uuid);
insert into public.treatment_plans (deal_id, name) values (current_setting('t.d1')::bigint, 'План');
select set_config('t.plan', (select id from public.treatment_plans where name = 'План')::text, true);
insert into public.treatment_plan_items (plan_id, stage_no, name, tooth, quantity, unit_price, position) values
  (current_setting('t.plan')::bigint, 1, 'Удаление зуба', '46', 1, 15000, 0),
  (current_setting('t.plan')::bigint, 1, 'Коронка циркониевая', '11-12', 2, 120000, 1),
  (current_setting('t.plan')::bigint, 1, 'Профессиональная гигиена', 'Ротовая полость', 1, 20000, 2);
select tests.assert((select count(*) from public.patient_teeth where patient_id = current_setting('t.p')::bigint and tooth in (46, 11, 12)) = 0,
  'planned items do not change the chart');
update public.treatment_plan_items set done = true where plan_id = current_setting('t.plan')::bigint;
select tests.assert((select state from public.patient_teeth where patient_id = current_setting('t.p')::bigint and tooth = 46) = 'missing', 'extraction done: 46 missing');
select tests.assert((select count(*) from public.patient_teeth where patient_id = current_setting('t.p')::bigint and tooth in (11, 12) and state = 'crown') = 2, 'crowns done on 11 and 12');
select tests.assert(
  (select source = 'plan' and plan_item_id = (select id from public.treatment_plan_items where name = 'Удаление зуба')
     and sales_id = current_setting('t.m1_id')::bigint
   from public.patient_tooth_history where patient_id = current_setting('t.p')::bigint and tooth = 46),
  'the history names the plan item and who marked it done');
select tests.assert((select count(*) from public.patient_teeth where patient_id = current_setting('t.p')::bigint) = 4, 'the hygiene of the mouth sets no tooth');
insert into public.patient_teeth (patient_id, tooth, state, note) values (current_setting('t.p')::bigint, 21, 'caries', 'к лечению');
insert into public.treatment_plan_items (plan_id, stage_no, name, tooth, quantity, unit_price, position, done)
values (current_setting('t.plan')::bigint, 1, 'Пломба', '21', 1, 25000, 3, true);
select tests.assert(
  (select state = 'filling' and note = 'к лечению' from public.patient_teeth where patient_id = current_setting('t.p')::bigint and tooth = 21),
  'an item written done at once: the state changes, the note stays');
update public.treatment_plan_items set tooth = '21', done = true where name = 'Пломба';
select tests.assert(tests.history_count(current_setting('t.p')::bigint, 21) = 2, 'an item already done changes nothing again');
select tests.logout();

--
-- Visit records
--
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.visits (patient_id, deal_id, doctor_id, starts_at, ends_at, status)
values (current_setting('t.p')::bigint, current_setting('t.d1')::bigint, current_setting('t.doctor')::bigint,
  timestamptz '2026-09-20 04:00+00', timestamptz '2026-09-20 05:00+00', 'completed');
select set_config('t.visit', (select id from public.visits where patient_id = current_setting('t.p')::bigint)::text, true);
insert into public.visits (patient_id, starts_at, ends_at, status)
values (current_setting('t.e')::bigint, timestamptz '2026-09-21 04:00+00', timestamptz '2026-09-21 05:00+00', 'scheduled');
select set_config('t.visit_e', (select id from public.visits where patient_id = current_setting('t.e')::bigint)::text, true);
select tests.logout();

select tests.login_as(current_setting('t.m1')::uuid);
insert into public.visit_records (patient_id, visit_id, complaints, diagnosis_codes, diagnosis, treatment)
values (current_setting('t.p')::bigint, current_setting('t.visit')::bigint, 'Боль от холодного', array[' k02.1 ', 'K02.1', 'K04.0'],
  'Кариес дентина 36', 'Пломба');
select tests.assert(
  (select deal_id = current_setting('t.d1')::bigint and doctor_id = current_setting('t.doctor')::bigint
     and record_date = date '2026-09-20' and diagnosis_codes = '{K02.1,K04.0}' and created_by = current_setting('t.m1_id')::bigint
   from public.visit_records where visit_id = current_setting('t.visit')::bigint),
  'the record takes the deal, the doctor and the day of the visit; codes cleaned');
select tests.throws($$insert into public.visit_records (patient_id, visit_id) values (current_setting('t.p')::bigint, current_setting('t.visit')::bigint)$$, '23505', 'one record per visit');
select tests.throws($$insert into public.visit_records (patient_id, visit_id) values (current_setting('t.p')::bigint, current_setting('t.visit_e')::bigint)$$, '22023', 'the visit of another patient');
select tests.throws($$insert into public.visit_records (patient_id, diagnosis_codes) values (current_setting('t.p')::bigint, array['кариес'])$$, '23514', 'an ICD-10 code has a format');
insert into public.visit_records (patient_id, record_date, complaints) values (current_setting('t.p')::bigint, date '2026-09-01', 'Консультация');
select tests.assert((select count(*) from public.visit_records where patient_id = current_setting('t.p')::bigint) = 2, 'a record without a visit');
select tests.logout();

select tests.login_as(current_setting('t.m2')::uuid);
update public.visit_records set recommendations = 'Не есть 2 часа' where visit_id = current_setting('t.visit')::bigint;
select tests.assert(
  (select updated_by = current_setting('t.m2_id')::bigint and created_by = current_setting('t.m1_id')::bigint
   from public.visit_records where visit_id = current_setting('t.visit')::bigint),
  'another manager completes the record: updated_by changes, the author stays');
select tests.assert(tests.affected($$delete from public.visit_records where visit_id = current_setting('t.visit')::bigint$$) = 0,
  'a manager does not delete a colleague''s record');
insert into public.visit_record_templates (name, content, diagnosis_codes)
values ('Кариес дентина', '{"diagnosis": "Кариес дентина", "treatment": "Анестезия, препарирование, пломба"}', '{K02.1}');
select tests.logout();

select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert((select count(*) from public.visit_record_templates) = 1, 'the templates are the clinic''s');
select tests.assert(tests.affected($$update public.visit_record_templates set name = 'Мой' where name = 'Кариес дентина'$$) = 0,
  'a manager does not change a colleague''s template');
select tests.throws($$insert into public.visit_record_templates (name, content) values ('Плохой', '[]')$$, '23514', 'the content of a template is an object');
select tests.logout();

select tests.login_as(current_setting('t.head')::uuid);
select tests.assert(tests.affected($$update public.visit_record_templates set position = 1 where name = 'Кариес дентина'$$) = 1, 'the head edits any template');
select tests.logout();

--
-- The questionnaire
--
select tests.login_as(current_setting('t.m1')::uuid);
insert into public.patient_questionnaires (patient_id, answers, signed_at)
values (current_setting('t.p')::bigint,
  '{"medications": {"answer": "yes", "comment": "Эутирокс"}, "pregnancy": {"answer": "no"}, "anesthesia": {"answer": "no"}}',
  date '2026-09-20');
select tests.assert(
  (select answers -> 'medications' ->> 'comment' = 'Эутирокс' and updated_by = current_setting('t.m1_id')::bigint
   from public.patient_questionnaires where patient_id = current_setting('t.p')::bigint),
  'answers with comments, signed');
select tests.throws($$insert into public.patient_questionnaires (patient_id) values (current_setting('t.p')::bigint)$$, '23505', 'one questionnaire per patient');
select tests.throws($$update public.patient_questionnaires set answers = '{"alcohol": {"answer": "yes"}}' where patient_id = current_setting('t.p')::bigint$$, '23514', 'an unknown question');
select tests.throws($$update public.patient_questionnaires set answers = '{"diabetes": {"answer": "maybe"}}' where patient_id = current_setting('t.p')::bigint$$, '23514', 'yes or no');
update public.patient_questionnaires set answers = answers || '{"diabetes": {"answer": "yes", "comment": "2 тип"}}' where patient_id = current_setting('t.p')::bigint;
select tests.assert(tests.audit_count('patient_questionnaire', current_setting('t.p')::bigint) = 2, 'the questionnaire changes are in the audit log');
select tests.logout();

--
-- Consents
--
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert((select count(*) from public.consent_templates) = 4, 'the manager reads the consent templates');
select tests.assert(tests.affected($$update public.consent_templates set name = 'X'$$) = 0, 'the manager does not edit them');
insert into public.patient_consents (patient_id, template_id, title, body)
select current_setting('t.p')::bigint, t.id, t.name, replace(t.body, '{пациент}', 'Нурланова Асель')
from public.consent_templates t where t.position = 0;
update public.patient_consents set signed_at = date '2026-09-20' where patient_id = current_setting('t.p')::bigint;
select tests.assert(
  (select signed_at = date '2026-09-20' and body like 'Я, Нурланова Асель%' and created_by = current_setting('t.m1_id')::bigint
   from public.patient_consents where patient_id = current_setting('t.p')::bigint),
  'a consent given and signed');
select tests.assert(tests.audit_count('patient_consent', current_setting('t.p')::bigint) = 2, 'the consent is in the audit log');
select tests.logout();

select tests.login_as(current_setting('t.head')::uuid);
update public.consent_templates set body = body || E'\nПодпись законного представителя: ____' where position = 0;
insert into public.consent_templates (name, body, position) values ('Согласие на ортодонтическое лечение', 'Я, {пациент}…', 4);
select tests.assert((select count(*) from public.consent_templates) = 5, 'the head edits and adds templates');
select tests.logout();

--
-- Patient files
--
select tests.login_as(current_setting('t.m1')::uuid);
select set_config('t.path', current_setting('t.org') || '/patients/' || current_setting('t.p') || '/x-optg.png', true);
insert into storage.objects (bucket_id, name, owner) values ('deal-files', current_setting('t.path'), current_setting('t.m1')::uuid);
insert into public.patient_files (patient_id, path, name, size, mime, kind, taken_at)
values (current_setting('t.p')::bigint, current_setting('t.path'), 'ОПТГ.png', 120000, 'image/png', 'opg', date '2026-09-20');
select tests.assert(
  (select kind = 'opg' and sales_id = current_setting('t.m1_id')::bigint from public.patient_files where patient_id = current_setting('t.p')::bigint),
  'an X-ray with its type');
select tests.throws($$insert into public.patient_files (patient_id, path, name, kind) values (current_setting('t.p')::bigint, current_setting('t.org') || '/patients/' || current_setting('t.e') || '/a.png', 'a.png', 'photo')$$,
  '42501', 'a file goes to the folder of its own patient');
select tests.throws($$insert into public.patient_files (patient_id, path, name, kind) values (current_setting('t.p')::bigint, current_setting('t.org') || '/patients/' || current_setting('t.p') || '/b.png', 'b.png', 'xray')$$,
  '23514', 'an unknown type');
select tests.throws($$insert into public.patient_files (patient_id, path, name, kind, sales_id) values (current_setting('t.p')::bigint, current_setting('t.org') || '/patients/' || current_setting('t.p') || '/c.png', 'c.png', 'photo', current_setting('t.m2_id')::bigint)$$,
  '42501', 'a file in a colleague''s name');
update public.patient_files set kind = 'ct', note = 'КТ верхней челюсти' where patient_id = current_setting('t.p')::bigint;
select tests.throws($$update public.patient_files set name = 'other.png' where patient_id = current_setting('t.p')::bigint$$, '42501', 'the name of a file does not change');
select tests.assert(tests.count($$select 1 from storage.objects where name = current_setting('t.path')$$) = 1, 'the manager reads the object of a listed file');
select tests.throws($$insert into storage.objects (bucket_id, name, owner) values ('deal-files', current_setting('t.other_org') || '/patients/' || current_setting('t.p') || '/z.png', auth.uid())$$,
  '42501', 'no upload into the folder of another clinic');
select tests.logout();

select tests.login_as(current_setting('t.m2')::uuid);
select tests.assert(tests.affected($$delete from public.patient_files where patient_id = current_setting('t.p')::bigint$$) = 0, 'a manager does not delete a colleague''s file');
select tests.logout();

--
-- The integrator sees nothing medical
--
select tests.login_as(current_setting('t.int')::uuid);
select tests.assert((select count(*) from public.patients where id = current_setting('t.p')::bigint) = 1, 'the integrator sees the patient');
select tests.assert(tests.count('select 1 from public.patient_teeth') = 0, 'no teeth');
select tests.assert(tests.count('select 1 from public.patient_tooth_history') = 0, 'no tooth history');
select tests.assert(tests.count('select 1 from public.visit_records') = 0, 'no visit records');
select tests.assert(tests.count('select 1 from public.visit_record_templates') = 0, 'no templates');
select tests.assert(tests.count('select 1 from public.patient_questionnaires') = 0, 'no questionnaire');
select tests.assert(tests.count('select 1 from public.consent_templates') = 0, 'no consent templates');
select tests.assert(tests.count('select 1 from public.patient_consents') = 0, 'no consents');
select tests.assert(tests.count('select 1 from public.patient_files') = 0, 'no patient files');
select tests.assert(tests.count($$select 1 from storage.objects where name = current_setting('t.path')$$) = 0, 'no X-ray objects');
select tests.throws($$insert into public.patient_teeth (patient_id, tooth, state) values (current_setting('t.p')::bigint, 11, 'crown')$$, '42501', 'the integrator writes no tooth');
select tests.logout();

--
-- «Только свои» patients (stage 30): the medical rows follow the patient
--
select tests.login_as(current_setting('t.owner')::uuid);
select public.save_access_rights(current_setting('t.m2_id')::bigint, '{"patients": {"view": "own", "edit": "own"}, "deals": {"view": "own", "edit": "own"}}'::jsonb, null);
select tests.logout();
select tests.login_as(current_setting('t.m2')::uuid);
select tests.assert(tests.count($$select 1 from public.patient_teeth where patient_id = current_setting('t.p')::bigint$$) = 0, 'another manager''s patient: no chart');
select tests.assert(tests.count($$select 1 from public.visit_records where patient_id = current_setting('t.p')::bigint$$) = 0, 'no records');
select tests.assert(tests.count($$select 1 from public.patient_files where patient_id = current_setting('t.p')::bigint$$) = 0, 'no files');
select tests.throws($$insert into public.patient_teeth (patient_id, tooth, state) values (current_setting('t.p')::bigint, 17, 'crown')$$, '42501', 'no chart of a patient out of sight');
insert into public.patient_teeth (patient_id, tooth, state) values (current_setting('t.e')::bigint, 17, 'implant');
select tests.assert(tests.count($$select 1 from public.patient_teeth where patient_id = current_setting('t.e')::bigint$$) = 1, 'his own patient''s chart');
select tests.logout();

--
-- Merge: rows follow the kept patient; for a tooth, the kept one's wins
--
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.patient_teeth (patient_id, tooth, state) values (current_setting('t.e')::bigint, 36, 'crown'), (current_setting('t.e')::bigint, 47, 'root');
insert into public.patient_questionnaires (patient_id, answers) values (current_setting('t.e')::bigint, '{"smoking": {"answer": "yes"}}');
select public.merge_patients(current_setting('t.p')::bigint, current_setting('t.e')::bigint);
select tests.assert((select state from public.patient_teeth where patient_id = current_setting('t.p')::bigint and tooth = 36) = 'filling', 'the kept patient''s tooth wins');
select tests.assert((select state from public.patient_teeth where patient_id = current_setting('t.p')::bigint and tooth = 47) = 'root', 'the other teeth come along');
select tests.assert((select state from public.patient_teeth where patient_id = current_setting('t.p')::bigint and tooth = 17) = 'implant', 'the other teeth come along (2)');
select tests.assert((select count(*) from public.patient_questionnaires where patient_id = current_setting('t.p')::bigint) = 1
  and (select answers ? 'medications' from public.patient_questionnaires where patient_id = current_setting('t.p')::bigint),
  'the kept questionnaire stays');
select tests.assert((select count(*) from public.visit_records where patient_id = current_setting('t.p')::bigint) = 2, 'the records stay');
select tests.logout();

--
-- Isolation
--
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert((select count(*) from public.consent_templates) = 4, 'the other clinic has its own templates');
select tests.assert(tests.count('select 1 from public.patient_teeth') = 0, 'no teeth of another clinic');
select tests.assert(tests.count('select 1 from public.visit_records') = 0, 'no records of another clinic');
select tests.assert(tests.count('select 1 from public.visit_record_templates') = 0, 'no templates of another clinic');
select tests.assert(tests.count('select 1 from public.patient_questionnaires') = 0, 'no questionnaires of another clinic');
select tests.assert(tests.count('select 1 from public.patient_consents') = 0, 'no consents of another clinic');
select tests.assert(tests.count('select 1 from public.patient_files') = 0, 'no files of another clinic');
select tests.assert(tests.count('select 1 from public.patient_tooth_history') = 0, 'no history of another clinic');
select tests.throws($$insert into public.patient_teeth (patient_id, tooth, state) values (current_setting('t.p')::bigint, 11, 'crown')$$, '42501', 'no chart of a patient of another clinic');
select tests.throws($$insert into public.visit_records (patient_id) values (current_setting('t.p')::bigint)$$, '42501', 'no record for a patient of another clinic');
select tests.logout();

rollback;

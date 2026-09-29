--
-- Stage 38: the waiting list. Entries (defaults, checks, the deal and the
-- visit of the patient), statuses (offered, booked by a visit, back to
-- «ждёт» when the visit is cancelled or deleted), the matching function
-- (doctor, period, days of the week, parts of the day, hour range, length,
-- branch), the freed slots of the schedule (cancelled, «не пришёл», deleted,
-- moved; highlighted entries and notifications, once per slot), the audit
-- log, rights per role (follows the patient and the deal; integrator),
-- patient merge and clinic isolation.
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

-- A moment of the clinic (Asia/Almaty) on a day of 2031: 2031-03-04 is a Tuesday
create function tests.at(day text, hhmm text) returns timestamptz language sql as $$
  select (day || ' ' || hhmm)::timestamp at time zone 'Asia/Almaty'
$$;
create function tests.notes(recipient bigint, target_patient bigint) returns bigint language sql security definer as $$
  select count(*) from public.notifications
  where sales_id = recipient and kind = 'waiting_list_slot' and patient_id = target_patient
$$;
create function tests.note_of(target_patient bigint) returns public.notifications language sql security definer as $$
  select * from public.notifications where kind = 'waiting_list_slot' and patient_id = target_patient order by id limit 1
$$;
create function tests.entry(entry_id bigint) returns public.waiting_list language sql security definer as $$
  select * from public.waiting_list where id = entry_id
$$;
create function tests.audit_count(target_patient bigint) returns bigint language sql security definer as $$
  select count(*) from public.audit_log where entity = 'waiting_list' and patient_id = target_patient
$$;
grant execute on all functions in schema tests to authenticated;

--
-- The clinic: two doctors, patients, deals
--
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.doctors (name) values ('Ахметова Айгуль'), ('Бекова Сауле');
select set_config('t.da', (select id from public.doctors where name = 'Ахметова Айгуль')::text, true);
select set_config('t.db', (select id from public.doctors where name = 'Бекова Сауле')::text, true);
insert into public.patients (first_name, last_name) values
  ('Асель', 'Нурланова'), ('Ерлан', 'Омаров'), ('Дана', 'Сейтова'), ('Мадина', 'Касымова');
select set_config('t.p1', (select id from public.patients where first_name = 'Асель')::text, true);
select set_config('t.p2', (select id from public.patients where first_name = 'Ерлан')::text, true);
select set_config('t.p3', (select id from public.patients where first_name = 'Дана')::text, true);
select set_config('t.p4', (select id from public.patients where first_name = 'Мадина')::text, true);
insert into public.deals (patient_id, name, sales_id) values
  (current_setting('t.p1')::bigint, 'implant', current_setting('t.m1_id')::bigint),
  (current_setting('t.p2')::bigint, 'braces', current_setting('t.m2_id')::bigint);
select set_config('t.d1', (select id from public.deals where name = 'implant')::text, true);
select set_config('t.d2', (select id from public.deals where name = 'braces')::text, true);

--
-- Entries
--
insert into public.waiting_list (patient_id, deal_id, doctor_id, date_from, date_to, weekdays, day_parts, priority, comment)
values (current_setting('t.p1')::bigint, current_setting('t.d1')::bigint, current_setting('t.da')::bigint,
  date '2031-03-01', date '2031-03-31', '{4,2,2}', '{morning}', 'urgent', '  хочет пораньше  ');
select set_config('t.e1', (select id from public.waiting_list where patient_id = current_setting('t.p1')::bigint)::text, true);
select tests.assert(
  (select status = 'waiting' and sales_id = current_setting('t.m1_id')::bigint and created_by = current_setting('t.owner_id')::bigint
     and weekdays = '{2,4}' and comment = 'хочет пораньше' and visit_id is null
   from public.waiting_list where id = current_setting('t.e1')::bigint),
  'a new entry: waiting, responsible of the deal, author, days sorted without repeats, comment trimmed');
insert into public.waiting_list (patient_id, date_from, direction) values (current_setting('t.p3')::bigint, date '2031-03-01', 'Гигиена');
select set_config('t.e2', (select id from public.waiting_list where patient_id = current_setting('t.p3')::bigint)::text, true);
select tests.assert(
  (select sales_id = current_setting('t.owner_id')::bigint and doctor_id is null and priority = 'normal' and date_to is null
   from public.waiting_list where id = current_setting('t.e2')::bigint),
  'without a deal: the author is responsible; any doctor, normal, open-ended');
insert into public.waiting_list (patient_id, deal_id, doctor_id, date_from)
values (current_setting('t.p2')::bigint, current_setting('t.d2')::bigint, current_setting('t.db')::bigint, date '2031-03-01');
select set_config('t.e3', (select id from public.waiting_list where patient_id = current_setting('t.p2')::bigint)::text, true);
insert into public.waiting_list (patient_id, date_from, day_parts) values (current_setting('t.p3')::bigint, date '2031-03-01', '{evening}');
select set_config('t.e4', (select max(id) from public.waiting_list where patient_id = current_setting('t.p3')::bigint)::text, true);
insert into public.waiting_list (patient_id, date_from) values (current_setting('t.p4')::bigint, date '2031-03-01');
select set_config('t.e5', (select id from public.waiting_list where patient_id = current_setting('t.p4')::bigint)::text, true);

select tests.throws(format('insert into public.waiting_list (patient_id, weekdays) values (%s, ''{8}'')', current_setting('t.p3')), '23514', 'a day of the week is 1–7');
select tests.throws(format('insert into public.waiting_list (patient_id, day_parts) values (%s, ''{night}'')', current_setting('t.p3')), '23514', 'the parts of the day are morning, day, evening');
select tests.throws(format('insert into public.waiting_list (patient_id, time_from) values (%s, ''10:00'')', current_setting('t.p3')), '23514', 'an hour range needs both ends');
select tests.throws(format('insert into public.waiting_list (patient_id, date_from, date_to) values (%s, ''2031-03-10'', ''2031-03-01'')', current_setting('t.p3')), '23514', 'the period ends after it starts');
select tests.throws(format('insert into public.waiting_list (patient_id, priority) values (%s, ''vip'')', current_setting('t.p3')), '23514', 'priority: normal or urgent');
select tests.throws(format('insert into public.waiting_list (patient_id, deal_id) values (%s, %s)', current_setting('t.p3'), current_setting('t.d1')), '22023', 'the deal must be the patient''s');

--
-- Matching
--
select tests.assert(private.waiting_day_part(9 * 60) = 'morning' and private.waiting_day_part(12 * 60) = 'day'
  and private.waiting_day_part(15 * 60 + 45) = 'day' and private.waiting_day_part(16 * 60) = 'evening', 'parts of the day');
select tests.assert(
  (select array_agg(id order by ord) from (
     select id, row_number() over () as ord from public.waiting_list_matches(current_setting('t.da')::bigint, tests.at('2031-03-04', '10:00'), tests.at('2031-03-04', '10:30'))) m)
  = array[current_setting('t.e1')::bigint, current_setting('t.e2')::bigint, current_setting('t.e5')::bigint],
  'Tuesday morning with doctor A: the urgent entry first, then any-doctor entries by age; not doctor B, not the evening');
select tests.assert(
  not exists (select 1 from public.waiting_list_matches(current_setting('t.da')::bigint, tests.at('2031-03-05', '10:00'), tests.at('2031-03-05', '10:30')) where id = current_setting('t.e1')::bigint),
  'Wednesday is not one of the days');
select tests.assert(
  not exists (select 1 from public.waiting_list_matches(current_setting('t.da')::bigint, tests.at('2031-03-04', '13:00'), tests.at('2031-03-04', '13:30')) where id = current_setting('t.e1')::bigint),
  'the afternoon is not the morning');
select tests.assert(
  not exists (select 1 from public.waiting_list_matches(current_setting('t.da')::bigint, tests.at('2031-04-01', '10:00'), tests.at('2031-04-01', '10:30')) where id = current_setting('t.e1')::bigint),
  'after the period');
select tests.assert(
  exists (select 1 from public.waiting_list_matches(current_setting('t.db')::bigint, tests.at('2031-03-04', '18:00'), tests.at('2031-03-04', '18:30')) where id = current_setting('t.e4')::bigint)
  and exists (select 1 from public.waiting_list_matches(current_setting('t.db')::bigint, tests.at('2031-03-04', '18:00'), tests.at('2031-03-04', '18:30')) where id = current_setting('t.e3')::bigint),
  'the evening entry and the doctor B entry fit an evening slot of doctor B');
update public.waiting_list set time_from = '09:00', time_to = '11:00', duration_minutes = 60 where id = current_setting('t.e2')::bigint;
select tests.assert(
  not exists (select 1 from public.waiting_list_matches(current_setting('t.da')::bigint, tests.at('2031-03-04', '10:00'), tests.at('2031-03-04', '10:30')) where id = current_setting('t.e2')::bigint)
  and exists (select 1 from public.waiting_list_matches(current_setting('t.da')::bigint, tests.at('2031-03-04', '10:00'), tests.at('2031-03-04', '11:00')) where id = current_setting('t.e2')::bigint)
  and not exists (select 1 from public.waiting_list_matches(current_setting('t.da')::bigint, tests.at('2031-03-04', '11:00'), tests.at('2031-03-04', '12:00')) where id = current_setting('t.e2')::bigint),
  'a slot shorter than the visit does not fit; the start must be inside the hour range');
update public.waiting_list set time_from = null, time_to = null, duration_minutes = null where id = current_setting('t.e2')::bigint;

-- Branches: an entry of another branch does not fit
insert into public.branches (name) values ('Достык'), ('Абая');
update public.doctors set branch_id = (select id from public.branches where name = 'Абая') where id = current_setting('t.db')::bigint;
update public.waiting_list set branch_id = (select id from public.branches where name = 'Достык') where id = current_setting('t.e4')::bigint;
select tests.assert(
  not exists (select 1 from public.waiting_list_matches(current_setting('t.db')::bigint, tests.at('2031-03-04', '18:00'), tests.at('2031-03-04', '18:30')) where id = current_setting('t.e4')::bigint),
  'an entry of another branch does not fit');
insert into public.waiting_list (patient_id, doctor_id, date_from) values (current_setting('t.p2')::bigint, current_setting('t.db')::bigint, date '2031-03-01');
select tests.assert(
  (select branch_id = (select id from public.branches where name = 'Абая') from public.waiting_list where patient_id = current_setting('t.p2')::bigint and deal_id is null),
  'the branch of a new entry comes from its doctor');
delete from public.waiting_list where patient_id = current_setting('t.p2')::bigint and deal_id is null;
update public.waiting_list set branch_id = null where id = current_setting('t.e4')::bigint;

--
-- Freed slots
--
insert into public.visits (patient_id, doctor_id, starts_at, ends_at)
values (current_setting('t.p4')::bigint, current_setting('t.da')::bigint, tests.at('2031-03-04', '10:00'), tests.at('2031-03-04', '10:30'));
select set_config('t.v4', (select id from public.visits where patient_id = current_setting('t.p4')::bigint)::text, true);
select tests.assert((select slot_starts_at is null from public.waiting_list where id = current_setting('t.e1')::bigint), 'a booked visit frees nothing');
update public.visits set status = 'cancelled' where id = current_setting('t.v4')::bigint;
select tests.assert(
  (select slot_starts_at = tests.at('2031-03-04', '10:00') and slot_ends_at = tests.at('2031-03-04', '10:30')
     and slot_doctor_id = current_setting('t.da')::bigint and slot_found_at is not null
   from public.waiting_list where id = current_setting('t.e1')::bigint)
  and (select slot_starts_at is not null from public.waiting_list where id = current_setting('t.e2')::bigint),
  'a cancelled visit highlights the fitting entries');
select tests.assert((select slot_starts_at is null from public.waiting_list where id = current_setting('t.e5')::bigint),
  'never the patient of the freed visit');
select tests.assert((select slot_starts_at is null from public.waiting_list where id = current_setting('t.e3')::bigint)
  and (select slot_starts_at is null from public.waiting_list where id = current_setting('t.e4')::bigint),
  'nor the entries of another doctor or another part of the day');
select tests.assert(tests.notes(current_setting('t.m1_id')::bigint, current_setting('t.p1')::bigint) = 1
  and tests.notes(current_setting('t.owner_id')::bigint, current_setting('t.p3')::bigint) = 1,
  'the responsible of each entry is notified');
select tests.assert(
  (select body = 'Нурланова Асель · 04.03 10:00 · Ахметова Айгуль' and deal_id = current_setting('t.d1')::bigint
   from tests.note_of(current_setting('t.p1')::bigint)),
  'the notification names the patient, the time and the doctor');
-- The same slot again: no second notification
update public.visits set status = 'scheduled' where id = current_setting('t.v4')::bigint;
update public.visits set status = 'no_show' where id = current_setting('t.v4')::bigint;
select tests.assert(tests.notes(current_setting('t.m1_id')::bigint, current_setting('t.p1')::bigint) = 1, 'once per entry and slot');
-- «Не пришёл» on another day, a deleted visit
insert into public.visits (patient_id, doctor_id, starts_at, ends_at)
values (current_setting('t.p4')::bigint, current_setting('t.da')::bigint, tests.at('2031-03-11', '09:00'), tests.at('2031-03-11', '09:30'));
update public.visits set status = 'no_show' where patient_id = current_setting('t.p4')::bigint and starts_at = tests.at('2031-03-11', '09:00');
select tests.assert((select slot_starts_at = tests.at('2031-03-11', '09:00') from public.waiting_list where id = current_setting('t.e1')::bigint)
  and tests.notes(current_setting('t.m1_id')::bigint, current_setting('t.p1')::bigint) = 2,
  '«не пришёл» frees the slot: a new slot, a new notification');
insert into public.visits (patient_id, doctor_id, starts_at, ends_at)
values (current_setting('t.p4')::bigint, current_setting('t.db')::bigint, tests.at('2031-03-12', '18:00'), tests.at('2031-03-12', '18:30'));
select set_config('t.v5', (select id from public.visits where patient_id = current_setting('t.p4')::bigint and starts_at = tests.at('2031-03-12', '18:00'))::text, true);
-- Moved by 15 minutes: the time still overlaps, nothing is freed
update public.visits set starts_at = tests.at('2031-03-12', '18:15'), ends_at = tests.at('2031-03-12', '18:45') where id = current_setting('t.v5')::bigint;
select tests.assert((select slot_starts_at is null from public.waiting_list where id = current_setting('t.e3')::bigint), 'a visit moved within its time frees nothing');
delete from public.visits where id = current_setting('t.v5')::bigint;
select tests.assert((select slot_starts_at = tests.at('2031-03-12', '18:15') from public.waiting_list where id = current_setting('t.e3')::bigint)
  and (select slot_starts_at = tests.at('2031-03-12', '18:15') from public.waiting_list where id = current_setting('t.e4')::bigint)
  and tests.notes(current_setting('t.m2_id')::bigint, current_setting('t.p2')::bigint) = 1,
  'a deleted visit frees its slot (evening, doctor B)');
-- A past visit frees nothing
insert into public.visits (patient_id, doctor_id, starts_at, ends_at)
values (current_setting('t.p4')::bigint, current_setting('t.da')::bigint, now() - interval '2 days', now() - interval '2 days' + interval '30 minutes');
update public.visits set status = 'cancelled' where patient_id = current_setting('t.p4')::bigint and starts_at < now();
select tests.assert(tests.notes(current_setting('t.m1_id')::bigint, current_setting('t.p1')::bigint) = 2, 'a past slot is not offered');
-- Notifications switched off (bulk writes): highlighted, not notified
update public.waiting_list set slot_starts_at = null, slot_doctor_id = null where id = current_setting('t.e1')::bigint;
select set_config('crm.notifications', 'off', true);
insert into public.visits (patient_id, doctor_id, starts_at, ends_at)
values (current_setting('t.p4')::bigint, current_setting('t.da')::bigint, tests.at('2031-03-18', '09:00'), tests.at('2031-03-18', '09:30'));
update public.visits set status = 'cancelled' where patient_id = current_setting('t.p4')::bigint and starts_at = tests.at('2031-03-18', '09:00');
select set_config('crm.notifications', '', true);
select tests.assert((select slot_starts_at = tests.at('2031-03-18', '09:00') from public.waiting_list where id = current_setting('t.e1')::bigint)
  and tests.notes(current_setting('t.m1_id')::bigint, current_setting('t.p1')::bigint) = 2,
  'crm.notifications off: highlighted without a notification');

--
-- Statuses: offered, booked by a visit, back when the visit goes
--
update public.waiting_list set status = 'offered', offered_starts_at = tests.at('2031-03-18', '09:00'), offered_doctor_id = current_setting('t.da')::bigint
where id = current_setting('t.e1')::bigint;
select tests.assert(
  (select offered_at is not null and offered_by = current_setting('t.owner_id')::bigint and status_changed_at is not null
   from public.waiting_list where id = current_setting('t.e1')::bigint),
  'offered: when and by whom');
insert into public.visits (patient_id, deal_id, doctor_id, starts_at, ends_at)
values (current_setting('t.p1')::bigint, current_setting('t.d1')::bigint, current_setting('t.da')::bigint, tests.at('2031-03-18', '09:00'), tests.at('2031-03-18', '09:30'));
select set_config('t.v1', (select id from public.visits where patient_id = current_setting('t.p1')::bigint)::text, true);
select tests.throws(format('update public.waiting_list set visit_id = %s where id = %s', current_setting('t.v1'), current_setting('t.e2')), '22023', 'a visit of another patient');
update public.waiting_list set visit_id = current_setting('t.v1')::bigint where id = current_setting('t.e1')::bigint;
select tests.assert(
  (select status = 'booked' and slot_starts_at is null and slot_doctor_id is null from public.waiting_list where id = current_setting('t.e1')::bigint),
  'linking the visit books the entry and clears its slot');
update public.visits set status = 'cancelled' where id = current_setting('t.v1')::bigint;
select tests.assert(
  (select status = 'waiting' and visit_id is null from public.waiting_list where id = current_setting('t.e1')::bigint),
  'the booked visit cancelled: back to «ждёт»');
update public.visits set status = 'scheduled' where id = current_setting('t.v1')::bigint;
update public.waiting_list set visit_id = current_setting('t.v1')::bigint where id = current_setting('t.e1')::bigint;
delete from public.visits where id = current_setting('t.v1')::bigint;
select tests.assert(
  (select status = 'waiting' and visit_id is null from public.waiting_list where id = current_setting('t.e1')::bigint),
  'the booked visit deleted: back to «ждёт»');
update public.waiting_list set status = 'cancelled' where id = current_setting('t.e4')::bigint;
select tests.assert(
  (select slot_starts_at is null from public.waiting_list where id = current_setting('t.e4')::bigint)
  and not exists (select 1 from public.waiting_list_matches(current_setting('t.db')::bigint, tests.at('2031-03-04', '18:00'), tests.at('2031-03-04', '18:30')) where id = current_setting('t.e4')::bigint),
  'a cancelled entry fits nothing');
select tests.throws(format('update public.waiting_list set status = ''lost'' where id = %s', current_setting('t.e4')), '23514', 'unknown status');

-- The audit log: an entry without a deal is linked to its patient
select tests.assert(tests.audit_count(current_setting('t.p3')::bigint) >= 2, 'the entries of a patient without a deal are in the audit log');
select tests.assert(
  exists (select 1 from public.audit_log where entity = 'waiting_list' and entity_id = current_setting('t.e1')::bigint
    and action = 'update' and changes ? 'status' and deal_id = current_setting('t.d1')::bigint),
  'status changes are logged with the deal');
select tests.logout();

--
-- Rights
--
select tests.login_as(current_setting('t.owner')::uuid);
select public.save_access_rights(current_setting('t.m2_id')::bigint, '{"deals": {"view": "own", "edit": "own"}, "patients": {"view": "own", "edit": "own"}}');
select tests.logout();

select tests.login_as(current_setting('t.m2')::uuid);
select tests.assert(
  (select array_agg(id order by id) from public.waiting_list) = array[current_setting('t.e3')::bigint],
  '«Только свои»: a manager sees the entries of their own patients and deals');
update public.waiting_list set comment = 'чужое' where id = current_setting('t.e1')::bigint;
select tests.assert((select comment is distinct from 'чужое' from tests.entry(current_setting('t.e1')::bigint)), 'nor edits the others');
select tests.throws(format('insert into public.waiting_list (patient_id) values (%s)', current_setting('t.p1')), '42501', 'nor adds a patient they do not see');
insert into public.waiting_list (patient_id, deal_id, comment) values (current_setting('t.p2')::bigint, current_setting('t.d2')::bigint, 'своё');
delete from public.waiting_list where id = current_setting('t.e3')::bigint;
select tests.assert((tests.entry(current_setting('t.e3')::bigint)).id is not null, 'a manager does not delete an entry of somebody else');
delete from public.waiting_list where comment = 'своё';
select tests.assert(not exists (select 1 from public.waiting_list where comment = 'своё'), 'a manager deletes their own entry');
select tests.logout();

select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert((select count(*) from public.waiting_list) = 5, 'a manager with the default rights sees the whole list');
update public.waiting_list set comment = 'позвонить после 18' where id = current_setting('t.e2')::bigint;
select tests.assert((select comment = 'позвонить после 18' from tests.entry(current_setting('t.e2')::bigint)), 'and edits it');
select tests.logout();

select tests.login_as(current_setting('t.int')::uuid);
select tests.assert((select count(*) from public.waiting_list) = 0, 'the integrator sees no entry');
select tests.throws(format('insert into public.waiting_list (patient_id) values (%s)', current_setting('t.p3')), '42501', 'the integrator adds nothing');
select tests.logout();

select tests.login_as(current_setting('t.head')::uuid);
delete from public.waiting_list where id = current_setting('t.e4')::bigint;
select tests.assert((tests.entry(current_setting('t.e4')::bigint)).id is null, 'the head deletes any entry');
select tests.logout();

--
-- Patient merge: the entries follow their patient
--
select tests.login_as(current_setting('t.owner')::uuid);
select public.merge_patients(current_setting('t.p3')::bigint, current_setting('t.p4')::bigint);
select tests.assert((select patient_id = current_setting('t.p3')::bigint from public.waiting_list where id = current_setting('t.e5')::bigint),
  'a merged patient''s entries move to the kept patient');
select tests.logout();

--
-- Clinic isolation
--
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert((select count(*) from public.waiting_list) = 0, 'another clinic sees no entry');
select tests.assert((select count(*) from public.waiting_list_matches(current_setting('t.da')::bigint, tests.at('2031-03-04', '10:00'), tests.at('2031-03-04', '10:30'))) = 0,
  'nor matches them');
select tests.throws(format('insert into public.waiting_list (patient_id) values (%s)', current_setting('t.p1')), '42501', 'nor adds a patient of another clinic');
update public.waiting_list set comment = 'x' where id = current_setting('t.e1')::bigint;
select tests.assert((select comment is distinct from 'x' from tests.entry(current_setting('t.e1')::bigint)), 'nor edits one');
select tests.logout();
select tests.assert(
  not exists (select 1 from public.notifications n join public.sales s on s.id = n.sales_id
    where n.kind = 'waiting_list_slot' and s.organization_id = current_setting('t.other_org')::bigint),
  'no notification leaks to another clinic');

rollback;

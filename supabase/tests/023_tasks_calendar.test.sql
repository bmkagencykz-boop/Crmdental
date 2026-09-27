--
-- Task calendar (stage 23): duration and result of a task, the meeting type
-- (tasks and task rules), the audit log of the new columns, rights per role
-- and clinic isolation.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.owner_id', (select id from public.sales where email = 'owner@clinic.kz')::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m1_id', (select id from public.sales where email = 'm1@clinic.kz')::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);

-- The owner: a meeting rule, managers see their own deals only, two deals
select tests.login_as(current_setting('t.owner')::uuid);
update public.task_rules set is_active = false;
insert into public.task_rules (event, type, text, due_in_minutes)
values ('deal_created', 'meeting', 'Консультация в клинике', 60);
update public.organization_settings set manager_deal_visibility = 'own';
insert into public.patients (first_name) values ('Асель');
insert into public.deals (patient_id, name, sales_id)
select id, 'Имплантация', current_setting('t.m1_id')::bigint from public.patients;
insert into public.deals (patient_id, name, sales_id)
select id, 'Гигиена', current_setting('t.owner_id')::bigint from public.patients;
select set_config('t.deal_m1', (select id from public.deals where name = 'Имплантация')::text, true);
select set_config('t.deal_owner', (select id from public.deals where name = 'Гигиена')::text, true);

select tests.assert(
  (select count(*) from public.tasks where type = 'meeting' and text = 'Консультация в клинике'
     and duration_minutes is null and result is null) = 2,
  'a task rule may create meetings; their duration is the default of the type (null)');

-- Duration and type
insert into public.tasks (deal_id, type, text, due_date, duration_minutes)
values (current_setting('t.deal_owner')::bigint, 'meeting', 'Встреча с пациентом', now() + interval '1 day', 90);
select tests.assert(
  (select duration_minutes from public.tasks where text = 'Встреча с пациентом') = 90,
  'a task keeps its duration');
select tests.throws(
  format('insert into public.tasks (deal_id, text, due_date, duration_minutes) values (%s, ''x'', now(), 0)', current_setting('t.deal_owner')),
  '23514', 'a duration is at least 5 minutes');
select tests.throws(
  format('insert into public.tasks (deal_id, text, due_date, duration_minutes) values (%s, ''x'', now(), 1441)', current_setting('t.deal_owner')),
  '23514', 'a duration is at most a day');
select tests.throws(
  format('insert into public.tasks (deal_id, type, text, due_date) values (%s, ''visit'', ''x'', now())', current_setting('t.deal_owner')),
  '23514', 'task types stay a fixed list');
select tests.throws(
  'insert into public.task_rules (event, type, text) values (''deal_created'', ''visit'', ''x'')',
  '23514', 'task rule types stay a fixed list');
select tests.throws(
  format('update public.tasks set result = repeat(''x'', 2001) where deal_id = %s', current_setting('t.deal_owner')),
  '23514', 'a result is at most 2000 characters');

-- The manager reschedules and completes a task of their deal with a result
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(
  tests.affected(format(
    'update public.tasks set due_date = date_trunc(''hour'', now()) + interval ''26 hours'', duration_minutes = 45 where deal_id = %s',
    current_setting('t.deal_m1'))) = 1,
  'the manager reschedules a task of their deal');
select tests.assert(
  tests.affected(format(
    'update public.tasks set done_date = now(), result = ''Записана на 12:00'' where deal_id = %s',
    current_setting('t.deal_m1'))) = 1,
  'the manager completes it with a result');
select tests.assert(
  tests.affected(format(
    'update public.tasks set result = ''чужая'' where deal_id = %s', current_setting('t.deal_owner'))) = 0,
  'a manager cannot complete a task of a deal they do not see');
select tests.assert(
  (select count(*) from public.tasks where deal_id = current_setting('t.deal_owner')::bigint) = 0,
  'nor read it');
select tests.logout();

select tests.assert(
  (select result from public.tasks where deal_id = current_setting('t.deal_m1')::bigint) = 'Записана на 12:00'
  and (select duration_minutes from public.tasks where deal_id = current_setting('t.deal_m1')::bigint) = 45,
  'the result and the duration are stored');
select tests.assert(
  (select result from public.tasks where deal_id = current_setting('t.deal_owner')::bigint and type = 'meeting' and text = 'Консультация в клинике') is null,
  'the task of the other deal is untouched');

-- Audit log: completion with the result, rescheduling with the duration
select tests.assert(
  (select changes -> 'result' from public.audit_log
   where entity = 'task' and action = 'complete' and deal_id = current_setting('t.deal_m1')::bigint
     and organization_id = current_setting('t.org')::bigint) = '[null, "Записана на 12:00"]'::jsonb,
  'the audit log shows the result of a completed task');
select tests.assert(
  (select changes ? 'duration_minutes' and changes ? 'due_date' from public.audit_log
   where entity = 'task' and action = 'update' and deal_id = current_setting('t.deal_m1')::bigint
     and organization_id = current_setting('t.org')::bigint
   order by id desc limit 1),
  'the audit log shows the new time and duration');

-- The head sees and edits every task of the clinic
select tests.login_as(current_setting('t.head')::uuid);
select tests.assert(
  tests.affected(format(
    'update public.tasks set duration_minutes = 30 where deal_id = %s', current_setting('t.deal_owner'))) = 2,
  'the head edits the tasks of any deal');
select tests.logout();

-- Another clinic sees nothing and changes nothing
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert((select count(*) from public.tasks) = 0, 'another clinic sees no task');
select tests.assert(
  tests.affected('update public.tasks set result = ''взлом'', due_date = now()') = 0,
  'another clinic cannot reschedule or complete tasks');
select tests.logout();
select tests.assert(
  (select count(*) from public.tasks where result = 'взлом') = 0,
  'the tasks of the clinic are untouched');

rollback;

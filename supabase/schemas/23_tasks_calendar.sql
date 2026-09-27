--
-- Task calendar and task improvements (stage 23, amoCRM parity)
--
-- The calendar of the tasks screen (day, week, month) reads public.tasks as
-- they are: a task sits at its due_date for duration_minutes. Nothing new is
-- needed for it besides two columns:
--   duration_minutes  how long the call, message or meeting takes; null means
--                     the default of its type (30 minutes, 60 for a meeting),
--                     computed by the app (tasks/calendarLayout.ts)
--   result            what came out of it («Результат»), written when the
--                     task is completed and shown in the deal feed
-- Task types stay a fixed list (no dictionary in the codebase): «Встреча»
-- (meeting) joins it, see tasks_type_check and task_rules_type_check in
-- 01_tables.sql. Both columns are logged by the audit trigger (15_audit.sql).
-- Rights and clinic isolation are the ones of the tasks (05_policies.sql).
--

alter table public.tasks add column duration_minutes integer;
alter table public.tasks add column result text;

alter table public.tasks add constraint tasks_duration_minutes_check
    check (duration_minutes is null or duration_minutes between 5 and 1440);
alter table public.tasks add constraint tasks_result_length_check
    check (result is null or char_length(result) <= 2000);

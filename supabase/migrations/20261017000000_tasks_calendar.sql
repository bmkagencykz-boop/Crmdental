-- Task calendar (stage 23): duration and result of a task, the «Встреча»
-- (meeting) type, both new columns in the audit log.

alter table public.tasks add column duration_minutes integer;
alter table public.tasks add column result text;

alter table public.tasks add constraint tasks_duration_minutes_check
    check (duration_minutes is null or duration_minutes between 5 and 1440);
alter table public.tasks add constraint tasks_result_length_check
    check (result is null or char_length(result) <= 2000);

alter table public.tasks drop constraint tasks_type_check;
alter table public.tasks add constraint tasks_type_check
    check (type in ('call', 'message', 'meeting', 'reminder', 'other'));

alter table public.task_rules drop constraint task_rules_type_check;
alter table public.task_rules add constraint task_rules_type_check
    check (type in ('call', 'message', 'meeting', 'reminder', 'other'));

create or replace trigger audit_task
    after insert or update or delete on public.tasks
    for each row execute function private.audit_row('task', 'type,text,due_date,duration_minutes,done_date,result,sales_id');

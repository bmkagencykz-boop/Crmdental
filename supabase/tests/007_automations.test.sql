--
-- Automations (stage 5): tasks created by rules, lead distribution (round
-- robin, first to answer), stage checklists blocking the way forward.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m2', tests.invite('m2@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m1_id', (select id from public.sales where email = 'm1@clinic.kz')::text, true);
select set_config('t.m2_id', (select id from public.sales where email = 'm2@clinic.kz')::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);

-- Default rules of a new clinic
select tests.assert(
  (select count(*) from public.task_rules where organization_id = current_setting('t.org')::bigint) = 2,
  'a new clinic gets the default task rules');

-- A deal created by an employee gets the "contact the patient" task
select tests.login_as(current_setting('t.m1')::uuid);
insert into public.patients (first_name) values ('Асель');
insert into public.deals (patient_id, name) select id, 'ручная' from public.patients;
select set_config('t.deal', (select id from public.deals where name = 'ручная')::text, true);
select tests.assert(
  (select count(*) = 1 and bool_and(sales_id = current_setting('t.m1_id')::bigint)
     and bool_and(due_date between now() + interval '14 minutes' and now() + interval '16 minutes')
   from public.tasks where deal_id = current_setting('t.deal')::bigint),
  'a new deal gets its first task, for its responsible, due in 15 minutes');

-- Entering a stage creates the tasks of this stage
update public.deals
set stage_id = (select id from public.stages s where s.pipeline_id = deals.pipeline_id and s.name = 'Пришёл на консультацию')
where id = current_setting('t.deal')::bigint;
select tests.assert(
  exists (select 1 from public.tasks where deal_id = current_setting('t.deal')::bigint and text = 'Отправить план лечения и стоимость'),
  'entering a stage creates the tasks of its rules');
select tests.logout();

-- Only the owner and the head edit rules and checklists
select tests.login_as(current_setting('t.m1')::uuid);
select tests.throws(
  $q$insert into public.task_rules (event, type, text) values ('deal_created', 'call', 'x')$q$,
  '42501', 'managers cannot add task rules');
select tests.throws(
  $q$insert into public.stage_checklist_items (stage_id, text) select id, 'x' from public.stages limit 1$q$,
  '42501', 'managers cannot edit checklists');
select tests.logout();

select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.count('select * from public.task_rules') = 2, 'another clinic only sees its own rules');
select tests.logout();

-- Round robin among the chosen employees, for leads coming from outside
select tests.login_as(current_setting('t.owner')::uuid);
update public.organization_settings
set lead_distribution = 'round_robin',
    lead_distribution_sales_ids = array[current_setting('t.m1_id')::bigint, current_setting('t.m2_id')::bigint];
select tests.logout();

create function tests.external_deal(label text) returns bigint language plpgsql as $$
declare patient bigint; deal bigint;
begin
  insert into public.patients (organization_id, first_name)
  values (current_setting('t.org')::bigint, label) returning id into patient;
  insert into public.deals (organization_id, patient_id, name)
  values (current_setting('t.org')::bigint, patient, label) returning id into deal;
  return deal;
end;
$$;

select set_config('t.rr1', tests.external_deal('rr1')::text, true);
select set_config('t.rr2', tests.external_deal('rr2')::text, true);
select set_config('t.rr3', tests.external_deal('rr3')::text, true);
select tests.assert(
  (select array_agg(sales_id order by id) from public.deals where name in ('rr1', 'rr2', 'rr3'))
    = array[current_setting('t.m1_id')::bigint, current_setting('t.m2_id')::bigint, current_setting('t.m1_id')::bigint],
  'external leads go to the chosen employees in turn');
select tests.assert(
  (select p.sales_id from public.patients p join public.deals d on d.patient_id = p.id where d.id = current_setting('t.rr2')::bigint)
    = current_setting('t.m2_id')::bigint
  and (select sales_id from public.tasks where deal_id = current_setting('t.rr2')::bigint) = current_setting('t.m2_id')::bigint,
  'the patient and the first task follow the responsible');
update public.sales set disabled = true where id = current_setting('t.m2_id')::bigint;
select set_config('t.rr4', tests.external_deal('rr4')::text, true);
select tests.assert(
  (select sales_id from public.deals where id = current_setting('t.rr4')::bigint) = current_setting('t.m1_id')::bigint,
  'disabled employees are skipped');
update public.sales set disabled = false where id = current_setting('t.m2_id')::bigint;

-- First to answer takes the lead
update public.organization_settings
set lead_distribution = 'first_response',
    lead_distribution_sales_ids = array[current_setting('t.m2_id')::bigint]
where organization_id = current_setting('t.org')::bigint;
select set_config('t.fr', tests.external_deal('fr')::text, true);
select tests.assert((select sales_id from public.deals where id = current_setting('t.fr')::bigint) is null,
  'with "first to answer" a new lead waits unassigned');
insert into public.messages (organization_id, patient_id, deal_id, transport, chat_id, direction, text, sales_id)
select organization_id, patient_id, id, 'whatsapp', '1', 'out', 'Здравствуйте', current_setting('t.m1_id')::bigint
from public.deals where id = current_setting('t.fr')::bigint;
select tests.assert((select sales_id from public.deals where id = current_setting('t.fr')::bigint) is null,
  'only the chosen employees take leads by answering');
insert into public.messages (organization_id, patient_id, deal_id, transport, chat_id, direction, text, sales_id)
select organization_id, patient_id, id, 'whatsapp', '1', 'out', 'Добрый день', current_setting('t.m2_id')::bigint
from public.deals where id = current_setting('t.fr')::bigint;
select tests.assert(
  (select sales_id from public.deals where id = current_setting('t.fr')::bigint) = current_setting('t.m2_id')::bigint
  and (select sales_id from public.tasks where deal_id = current_setting('t.fr')::bigint and done_date is null) = current_setting('t.m2_id')::bigint,
  'the first chosen employee to answer takes the lead and its tasks');

-- Checklists block the way forward
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.stage_checklist_items (stage_id, text, position)
select s.id, t.text, t.position
from public.stages s join public.pipelines p on p.id = s.pipeline_id,
  (values ('Уточнить жалобу', 0), ('Записать на консультацию', 1)) as t(text, position)
where p.is_default and s.name = 'Новый лид';
insert into public.patients (first_name) values ('Чек-лист');
insert into public.deals (patient_id, name) select id, 'чек-лист' from public.patients where first_name = 'Чек-лист';
select set_config('t.cl', (select id from public.deals where name = 'чек-лист')::text, true);
select tests.logout();

select tests.login_as(current_setting('t.m1')::uuid);
select set_config('t.next_stage', (select s.id from public.stages s join public.deals d on d.pipeline_id = s.pipeline_id where d.id = current_setting('t.cl')::bigint and s.name = 'В работе')::text, true);
select tests.throws(
  format('update public.deals set stage_id = %s where id = %s', current_setting('t.next_stage'), current_setting('t.cl')),
  '23514', 'a deal cannot move forward with its checklist undone');
insert into public.deal_checklist_checks (deal_id, item_id)
select current_setting('t.cl')::bigint, i.id from public.stage_checklist_items i where i.text = 'Уточнить жалобу';
select tests.throws(
  format('update public.deals set stage_id = %s where id = %s', current_setting('t.next_stage'), current_setting('t.cl')),
  '23514', 'every item must be checked');
insert into public.deal_checklist_checks (deal_id, item_id)
select current_setting('t.cl')::bigint, i.id from public.stage_checklist_items i where i.text = 'Записать на консультацию';
update public.deals set stage_id = current_setting('t.next_stage')::bigint where id = current_setting('t.cl')::bigint;
select tests.assert(
  (select stage_id from public.deals where id = current_setting('t.cl')::bigint) = current_setting('t.next_stage')::bigint,
  'with the checklist done the deal moves on');
select tests.logout();

-- Refusing is always possible
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.deals (patient_id, name) select id, 'отказ' from public.patients where first_name = 'Чек-лист';
update public.deals
set stage_id = (select id from public.stages s where s.pipeline_id = deals.pipeline_id and s.kind = 'lost'),
    lost_reason_id = (select id from public.lost_reasons limit 1)
where name = 'отказ';
select tests.assert(
  (select s.kind from public.deals d join public.stages s on s.id = d.stage_id where d.name = 'отказ') = 'lost',
  'a deal can be lost whatever its checklist');
select tests.logout();

rollback;

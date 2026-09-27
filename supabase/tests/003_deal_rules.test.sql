--
-- Domain rules: clinic template, phones, deal defaults, stages and refusal,
-- payments, log, pipelines, dictionaries.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.manager', tests.invite('admin@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);

select tests.login_as(current_setting('t.owner')::uuid);

-- Clinic template
select tests.assert((select count(*) from public.pipelines where is_default) = 1, 'a default pipeline is created');
select tests.assert(
  (select string_agg(name, ' → ' order by position) from public.stages)
    = 'Новый лид → В работе → Записан → Пришёл на консультацию → План согласован → В лечении → Лечение завершено → Отказ',
  'the template stages of the spec are created in order');
select tests.assert((select count(*) from public.stages where kind = 'won') = 1 and (select count(*) from public.stages where kind = 'lost') = 1, 'one won and one lost stage');
select tests.assert((select count(*) from public.lead_sources where is_system) = 8, 'system lead sources are created');
select tests.assert((select count(*) from public.services) = 8, 'services are created');
select tests.assert((select count(*) from public.lost_reasons) = 8, 'lost reasons are created');
select tests.assert((select manager_deal_visibility from public.organization_settings) = 'all', 'managers see all deals by default');

-- Phones and messenger handles are normalized
insert into public.patients (last_name, first_name, phone_jsonb, whatsapp, instagram, telegram)
values ('Нурланова', 'Асель',
  '[{"number":"8 (701) 123-45-67","type":"Mobile"},{"number":"","type":"Home"},{"number":"7 702 765 43 21"}]',
  '87017654321', ' @Asel.Dent ', '@asel_tg');
select tests.assert(
  (select phone_jsonb -> 0 ->> 'number' from public.patients) = '+77011234567', 'phone numbers are stored as +7XXXXXXXXXX');
select tests.assert((select jsonb_array_length(phone_jsonb) from public.patients) = 2, 'empty phone numbers are dropped');
select tests.assert((select whatsapp from public.patients) = '+77017654321', 'the WhatsApp number is normalized');
select tests.assert((select instagram from public.patients) = 'asel.dent', 'the Instagram handle is cleaned');
select tests.assert((select telegram from public.patients) = 'asel_tg', 'the Telegram handle is cleaned');
select tests.assert(
  (select phones from public.patients) = array['+77011234567', '+77017654321', '+77027654321'], 'all numbers are searchable');
select tests.assert(tests.count('select * from public.find_patients_by_phone(''+7 701 123 45 67'')') = 1, 'search by phone in any format');
select tests.assert(tests.count('select * from public.find_patients_by_phone(''8 701 765 43 21'')') = 1, 'search by the WhatsApp number');
select tests.assert(tests.count('select * from public.find_patients_by_phone(''8 700 000 00 00'')') = 0, 'unknown number finds nobody');
select set_config('t.patient', (select id from public.patients)::text, true);

-- Deal defaults: default pipeline, first stage, log, patient source
insert into public.deals (patient_id, source_id)
select current_setting('t.patient')::bigint, id from public.lead_sources where code = 'whatsapp';
select set_config('t.deal', (select max(id) from public.deals)::text, true);
select tests.assert(
  (select s.name from public.deals d join public.stages s on s.id = d.stage_id where d.id = current_setting('t.deal')::bigint) = 'Новый лид',
  'a new deal lands on the first stage of the default pipeline');
select tests.assert(
  (select count(*) from public.deal_events where deal_id = current_setting('t.deal')::bigint and type = 'created') = 1,
  'the creation is logged');
select tests.assert(
  (select code from public.lead_sources where id = (select source_id from public.patients)) = 'whatsapp',
  'the first deal gives the patient its source');
insert into public.deals (patient_id, source_id)
select current_setting('t.patient')::bigint, id from public.lead_sources where code = 'instagram';
select tests.assert(
  (select code from public.lead_sources where id = (select source_id from public.patients)) = 'whatsapp',
  'later deals do not change the source of the first request');

-- Stage change is logged
update public.deals set stage_id = (select id from public.stages where name = 'Записан'), plan_amount = 650000
where id = current_setting('t.deal')::bigint;
select tests.assert(
  (select count(*) from public.deal_events e
   where e.deal_id = current_setting('t.deal')::bigint and e.type = 'stage_changed'
     and e.to_stage_id = (select id from public.stages where name = 'Записан')
     and e.changes ? 'plan_amount'
     and e.sales_id = (select id from public.sales where user_id = current_setting('t.owner')::uuid)) = 1,
  'a stage change is logged with the other changes and the author');

-- Refusal needs a reason, then the deal is locked
select tests.throws(
  format('update public.deals set stage_id = (select id from public.stages where kind = ''lost'') where id = %s', current_setting('t.deal')),
  '23514', 'moving to the lost stage without a reason fails');
update public.deals
set stage_id = (select id from public.stages where kind = 'lost'),
    lost_reason_id = (select id from public.lost_reasons where name = 'Дорого')
where id = current_setting('t.deal')::bigint;
select tests.assert(
  (select closed_at is not null from public.deals where id = current_setting('t.deal')::bigint), 'a lost deal is closed');
select tests.throws(
  format('update public.deals set stage_id = (select id from public.stages where name = ''В работе'') where id = %s', current_setting('t.deal')),
  '23514', 'a lost deal cannot go back to work');
select tests.throws(
  format('update public.deals set lost_reason_id = null where id = %s', current_setting('t.deal')),
  '23514', 'the reason of a lost deal cannot be removed');

-- Won deals are closed, reopening them clears closed_at
select set_config('t.deal2', (select max(id) from public.deals)::text, true);
update public.deals set stage_id = (select id from public.stages where kind = 'won') where id = current_setting('t.deal2')::bigint;
select tests.assert((select closed_at is not null from public.deals where id = current_setting('t.deal2')::bigint), 'a won deal is closed');
update public.deals set stage_id = (select id from public.stages where name = 'В лечении') where id = current_setting('t.deal2')::bigint;
select tests.assert((select closed_at is null from public.deals where id = current_setting('t.deal2')::bigint), 'reopening a won deal clears closed_at');

-- Payments maintain paid_amount; users cannot write it directly
insert into public.deal_payments (deal_id, amount) values (current_setting('t.deal2')::bigint, 100000), (current_setting('t.deal2')::bigint, 50000);
select tests.assert((select paid_amount from public.deals where id = current_setting('t.deal2')::bigint) = 150000, 'paid_amount is the sum of payments');
update public.deals set paid_amount = 999999999 where id = current_setting('t.deal2')::bigint;
select tests.assert((select paid_amount from public.deals where id = current_setting('t.deal2')::bigint) = 150000, 'paid_amount cannot be forged');
delete from public.deal_payments where amount = 50000;
select tests.assert((select paid_amount from public.deals where id = current_setting('t.deal2')::bigint) = 100000, 'deleting a payment updates paid_amount');
select tests.assert(
  (select count(*) from public.deal_events where deal_id = current_setting('t.deal2')::bigint and changes ? 'paid_amount') = 2,
  'payments show up in the deal log');
select tests.throws(
  format('insert into public.deal_payments (deal_id, amount) values (%s, 0)', current_setting('t.deal2')),
  '23514', 'a payment must be positive');
select tests.throws(
  format('insert into public.deal_events (organization_id, deal_id, type) values (%s, %s, ''created'')', current_setting('t.org'), current_setting('t.deal2')),
  '42501', 'the deal log cannot be written by users');

-- Pipelines: stages belong to their pipeline; moving needs both
select set_config('t.pipeline2', public.create_pipeline('Ортодонтия')::text, true);
select tests.assert(
  (select string_agg(kind, ',' order by position) from public.stages where pipeline_id = current_setting('t.pipeline2')::bigint) = 'open,won,lost',
  'a new pipeline gets an open, a won and a lost stage');
select tests.throws(
  format('update public.deals set stage_id = (select id from public.stages where pipeline_id = %s and kind = ''open'') where id = %s',
    current_setting('t.pipeline2'), current_setting('t.deal2')),
  '23503', 'a deal cannot sit in a stage of another pipeline');
update public.deals
set pipeline_id = current_setting('t.pipeline2')::bigint,
    stage_id = (select id from public.stages where pipeline_id = current_setting('t.pipeline2')::bigint and kind = 'open')
where id = current_setting('t.deal2')::bigint;
select tests.assert(
  (select changes ? 'pipeline_id' from public.deal_events where deal_id = current_setting('t.deal2')::bigint order by id desc limit 1),
  'moving to another pipeline is logged');

-- By default a deal moved to another pipeline lands on its first stage...
update public.deals
set pipeline_id = (select id from public.pipelines where is_default),
    stage_id = (select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id where p.is_default and s.name = 'Записан')
where id = current_setting('t.deal2')::bigint;
select tests.assert(
  (select s.name from public.deals d join public.stages s on s.id = d.stage_id where d.id = current_setting('t.deal2')::bigint) = 'Новый лид',
  'first_stage: a deal moved to another pipeline starts at its first stage');
-- ...unless the clinic lets employees choose the stage
update public.organization_settings set pipeline_move_mode = 'choose_stage';
update public.deals
set pipeline_id = current_setting('t.pipeline2')::bigint,
    stage_id = (select id from public.stages where pipeline_id = current_setting('t.pipeline2')::bigint and kind = 'won')
where id = current_setting('t.deal2')::bigint;
select tests.assert(
  (select s.kind from public.deals d join public.stages s on s.id = d.stage_id where d.id = current_setting('t.deal2')::bigint) = 'won',
  'choose_stage: the chosen stage is kept');
update public.organization_settings set pipeline_move_mode = 'first_stage';
-- Back to the open stage of the second pipeline for the checks below
update public.deals set pipeline_id = (select id from public.pipelines where is_default)
where id = current_setting('t.deal2')::bigint;
update public.deals set pipeline_id = current_setting('t.pipeline2')::bigint
where id = current_setting('t.deal2')::bigint;

-- Every pipeline keeps a won and a lost stage (checked at commit)
do $$
begin
  delete from public.stages where pipeline_id = current_setting('t.pipeline2')::bigint and kind = 'won';
  set constraints all immediate;
  raise exception 'ASSERTION FAILED: the last won stage of a pipeline can be deleted';
exception
  when check_violation then null;
end;
$$;
select tests.throws(
  format('delete from public.stages where id = (select stage_id from public.deals where id = %s)', current_setting('t.deal2')),
  '23503', 'a stage with deals cannot be deleted');
select tests.throws(
  format('delete from public.pipelines where id = %s', current_setting('t.pipeline2')),
  '23503', 'a pipeline with deals cannot be deleted');

-- Tasks have a fixed set of types
select tests.throws(
  format('insert into public.tasks (deal_id, type, text, due_date) values (%s, ''lunch'', ''x'', now())', current_setting('t.deal2')),
  '23514', 'unknown task types are rejected');
select tests.logout();

-- Dictionaries: managers read, owner and head manage
select tests.login_as(current_setting('t.manager')::uuid);
select tests.assert(tests.count('select * from public.services') = 8, 'managers read services');
select tests.throws('insert into public.services (name) values (''Отбеливание'')', '42501', 'managers cannot add services');
select tests.assert(tests.affected('update public.stages set name = ''x''') = 0, 'managers cannot rename stages');
select tests.throws('select public.create_pipeline(''x'')', '42501', 'managers cannot create pipelines');
select tests.assert(tests.affected('delete from public.deals') = 0, 'managers cannot delete deals');
select tests.logout();

select tests.login_as(current_setting('t.head')::uuid);
insert into public.services (name) values ('Отбеливание');
select tests.assert(tests.affected('update public.stages set color = ''#000000'' where name = ''Записан''') = 1, 'heads edit stages');
insert into public.lead_sources (name) values ('Выставка');
select tests.assert(tests.affected('update public.lead_sources set name = ''WA'' where code = ''whatsapp''') = 1, 'system sources can be renamed');
select tests.throws('update public.lead_sources set code = ''x'' where code = ''whatsapp''', '42501', 'the code of a source cannot change');
select tests.throws('insert into public.lead_sources (name, code, is_system) values (''Фейк'', ''fake'', true)', '42501', 'users cannot create system sources');
select tests.assert(tests.affected('delete from public.lead_sources where code = ''instagram''') = 0, 'system sources cannot be deleted');
select tests.assert(tests.affected('delete from public.lead_sources where name = ''Выставка''') = 1, 'custom sources can be deleted');
select tests.logout();

rollback;

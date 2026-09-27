--
-- Telephony (stage 12): call events of the PBX find or create the patient and
-- the deal, update one row per call, map the employee by internal number and
-- turn a missed call into a call-back task; the secrets stay with the service
-- role and every clinic keeps its calls to itself.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.manager', tests.invite('admin@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.manager_id', (select id from public.sales where user_id = current_setting('t.manager')::uuid)::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);
select set_config('t.other_org', tests.org_of(current_setting('t.other')::uuid)::text, true);

create function tests.call(token text, provider text, call jsonb) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  execute 'set local role service_role';
  result := public.ingest_call(token, provider, call);
  execute 'reset role';
  return result;
end;
$$;

--
-- Settings: owner and head only; the secret never reaches a client
--
select tests.login_as(current_setting('t.owner')::uuid);
select public.save_telephony('zadarma', 'zd-secret', 'zd-key');
select tests.assert(
  (select provider = 'zadarma' and has_secret and has_api_key and length(webhook_token) >= 32 from public.telephony_status()),
  'the owner connects the PBX and sees its status');
select public.save_telephony('binotel');
select tests.assert(
  (select provider = 'binotel' and has_secret and has_api_key from public.telephony_status()),
  'changing the provider keeps the stored secret');
select public.save_telephony('generic', '', null);
select tests.assert(
  (select provider = 'generic' and not has_secret and has_api_key from public.telephony_status()),
  'an empty secret removes it');
select set_config('t.old_token', (select webhook_token from public.telephony_status()), true);
select set_config('t.token', public.regenerate_telephony_token(), true);
select tests.assert(current_setting('t.token') <> current_setting('t.old_token'), 'the webhook token is regenerated');
select public.set_sales_phone_extension(current_setting('t.manager_id')::bigint, ' 101 ');
select tests.logout();
select tests.assert(
  (select phone_extension from public.sales where id = current_setting('t.manager_id')::bigint) = '101',
  'the owner sets the internal number of an employee');

select tests.login_as(current_setting('t.head')::uuid);
select tests.assert((select count(*) from public.telephony_status()) = 1, 'the head sees the telephony status');
select tests.logout();

select tests.login_as(current_setting('t.manager')::uuid);
select tests.throws('select * from public.telephony_integrations', '42501', 'employees cannot read the secrets');
select tests.assert((select count(*) from public.telephony_status()) = 0, 'a manager gets no telephony status (nor the token)');
select tests.throws($q$select public.save_telephony('mango', 'x')$q$, '42501', 'a manager cannot change telephony');
select tests.throws('select public.regenerate_telephony_token()', '42501', 'a manager cannot regenerate the token');
select tests.throws('select public.telephony_test_call()', '42501', 'a manager cannot simulate a call');
select tests.throws(
  format('select public.set_sales_phone_extension(%s, ''999'')', current_setting('t.manager_id')),
  '42501', 'a manager cannot change internal numbers');
select tests.throws(
  format('select public.ingest_call(%L, ''generic'', ''{"call_id":"x","phone":"+77010000000"}'')', current_setting('t.token')),
  '42501', 'employees cannot call the webhook function');
select tests.logout();

-- The other clinic's PBX
insert into public.telephony_integrations (organization_id, provider, webhook_token, secret)
values (current_setting('t.other_org')::bigint, 'binotel', 'token-b', 'b-secret');

select tests.throws($q$select tests.call('nope', 'generic', '{"call_id":"c0","phone":"+77010000000"}')$q$,
  '28000', 'an unknown webhook token is refused');
select tests.throws(format($q$select tests.call(%L, 'asterisk', '{"call_id":"c0","phone":"+77010000000"}')$q$, current_setting('t.token')),
  '22023', 'an unknown provider is refused');
select tests.throws(format($q$select tests.call(%L, 'generic', '{"phone":"+77010000000"}')$q$, current_setting('t.token')),
  '22023', 'a call without id is refused');

--
-- An incoming call from an unknown number: patient, deal, call
--
select set_config('t.r1', tests.call(current_setting('t.token'), 'zadarma',
  '{"call_id":"zd-1","direction":"in","phone":"8 (701) 555-12-34","started_at":"2026-10-06T09:00:00Z"}')::text, true);
select set_config('t.patient', current_setting('t.r1')::jsonb ->> 'patient_id', true);
select set_config('t.deal', current_setting('t.r1')::jsonb ->> 'deal_id', true);
select set_config('t.call', current_setting('t.r1')::jsonb ->> 'call_id', true);
select tests.assert(
  (current_setting('t.r1')::jsonb ->> 'created_patient')::boolean and (current_setting('t.r1')::jsonb ->> 'created_deal')::boolean,
  'a call from a new number creates the patient and the deal');
select tests.assert(
  (select first_name = '+77015551234' and phones = array['+77015551234']
     and source_id = (select id from public.lead_sources where organization_id = p.organization_id and code = 'call')
   from public.patients p where id = current_setting('t.patient')::bigint),
  'the patient gets the normalized number and the «Звонок» source');
select tests.assert(
  (select s.name = 'Новый лид' and d.source_id = (select id from public.lead_sources where organization_id = d.organization_id and code = 'call')
   from public.deals d join public.stages s on s.id = d.stage_id where d.id = current_setting('t.deal')::bigint),
  'the deal starts at the first stage of the default pipeline with the «Звонок» source');
select tests.assert(
  (select count(*) from public.tasks where deal_id = current_setting('t.deal')::bigint and text = 'Связаться с пациентом по новому обращению') = 1,
  'the task rules of stage 5 apply to the new deal');
select tests.assert(
  (select status = 'in_progress' and direction = 'in' and provider = 'zadarma' and external_id = 'zd-1'
     and phone = '+77015551234' and called_at = '2026-10-06T09:00:00Z'::timestamptz and deal_id = current_setting('t.deal')::bigint
   from public.calls where id = current_setting('t.call')::bigint),
  'the start event stores a call in progress');

--
-- Start / end idempotency, extension → employee, later recording
--
select set_config('t.r2', tests.call(current_setting('t.token'), 'zadarma',
  '{"call_id":"zd-1","direction":"in","phone":"+77015551234","extension":"101","status":"answered","duration":95}')::text, true);
select tests.assert(
  (current_setting('t.r2')::jsonb ->> 'call_id') = current_setting('t.call')
  and (current_setting('t.r2')::jsonb ->> 'duplicate')::boolean,
  'the end event updates the call of the start event');
select tests.assert((select count(*) from public.calls where external_id = 'zd-1') = 1, 'one row per call');
select tests.assert(
  (select status = 'answered' and duration_seconds = 95 and sales_id = current_setting('t.manager_id')::bigint and extension = '101'
   from public.calls where id = current_setting('t.call')::bigint),
  'the end event sets the status, the duration and the employee of the internal number');
-- A retried start event does not undo the end
select tests.call(current_setting('t.token'), 'zadarma', '{"call_id":"zd-1","direction":"in","phone":"+77015551234"}');
select tests.assert(
  (select status = 'answered' and duration_seconds = 95 from public.calls where id = current_setting('t.call')::bigint),
  'a late start event keeps the final status');
-- The recording comes later, without the number
select tests.call(current_setting('t.token'), 'zadarma', '{"call_id":"zd-1","record_url":"https://example.com/zd-1.mp3"}');
select tests.assert(
  (select recording_url = 'https://example.com/zd-1.mp3' and status = 'answered' from public.calls where id = current_setting('t.call')::bigint),
  'a later recording event stores the recording on the same call');
select tests.assert(
  (tests.call(current_setting('t.token'), 'zadarma', '{"call_id":"zd-unknown","record_url":"https://example.com/x.mp3"}') ->> 'ignored')::boolean,
  'a recording of an unknown call is ignored');
select tests.assert(
  (select count(*) from public.calls where external_id = 'zd-1') = 1
  and (select count(*) from public.tasks where deal_id = current_setting('t.deal')::bigint and text = 'Перезвонить') = 0,
  'an answered call gives no call-back task');

--
-- Missed incoming calls: a call-back task for the responsible
--
update public.deals set sales_id = current_setting('t.manager_id')::bigint where id = current_setting('t.deal')::bigint;
select set_config('t.r3', tests.call(current_setting('t.token'), 'generic',
  '{"call_id":"g-2","direction":"in","phone":"+7 701 555 12 34","status":"missed"}')::text, true);
select tests.assert(
  (current_setting('t.r3')::jsonb ->> 'deal_id') = current_setting('t.deal')
  and not (current_setting('t.r3')::jsonb ->> 'created_patient')::boolean,
  'the next call of the patient goes to the open deal');
select tests.assert(
  (select count(*) from public.tasks t
   where t.deal_id = current_setting('t.deal')::bigint and t.text = 'Перезвонить' and t.type = 'call'
     and t.done_date is null and t.due_date <= now() and t.sales_id = current_setting('t.manager_id')::bigint) = 1,
  'a missed call gives the responsible a task «Перезвонить» due now');
select tests.call(current_setting('t.token'), 'generic', '{"call_id":"g-2","direction":"in","phone":"+77015551234","status":"missed"}');
select tests.assert(
  (select count(*) from public.tasks where deal_id = current_setting('t.deal')::bigint and text = 'Перезвонить') = 1,
  'a retried missed call event gives no second task');
-- Started, then missed: the task comes with the end event
select tests.call(current_setting('t.token'), 'generic', '{"call_id":"g-3","direction":"in","phone":"+77015551234"}');
select tests.assert(
  (select count(*) from public.tasks where deal_id = current_setting('t.deal')::bigint and text = 'Перезвонить') = 1,
  'a call in progress gives no task yet');
select tests.call(current_setting('t.token'), 'generic', '{"call_id":"g-3","status":"missed"}');
select tests.assert(
  (select count(*) from public.tasks where deal_id = current_setting('t.deal')::bigint and text = 'Перезвонить') = 2
  and (select status from public.calls where external_id = 'g-3') = 'missed',
  'the end event of a missed call gives the task');
-- A missed outgoing call (the patient did not pick up) is no call-back
select tests.call(current_setting('t.token'), 'generic', '{"call_id":"g-4","direction":"out","phone":"+77015551234","status":"missed","extension":"101"}');
select tests.assert(
  (select count(*) from public.tasks where deal_id = current_setting('t.deal')::bigint and text = 'Перезвонить') = 2,
  'an unanswered outgoing call gives no call-back task');

-- Same call id at another provider: another call
select tests.call(current_setting('t.token'), 'mango', '{"call_id":"zd-1","direction":"in","phone":"+77015551234","status":"answered"}');
select tests.assert((select count(*) from public.calls where external_id = 'zd-1') = 2, 'call ids are unique per provider');

--
-- Outgoing call to a new number: the deal belongs to the caller
--
select set_config('t.r5', tests.call(current_setting('t.token'), 'generic',
  '{"call_id":"g-5","direction":"out","phone":"87079990000","extension":"101","status":"answered","duration":"40"}')::text, true);
select tests.assert(
  (select sales_id = current_setting('t.manager_id')::bigint from public.deals where id = (current_setting('t.r5')::jsonb ->> 'deal_id')::bigint),
  'an outgoing call to a new number opens a deal for the employee who called');

-- A deal in refusal is not reopened by a call
update public.deals
set stage_id = (select id from public.stages where pipeline_id = deals.pipeline_id and kind = 'lost'),
    lost_reason_id = (select id from public.lost_reasons where organization_id = deals.organization_id limit 1)
where id = (current_setting('t.r5')::jsonb ->> 'deal_id')::bigint;
select tests.assert(
  (tests.call(current_setting('t.token'), 'generic', '{"call_id":"g-6","direction":"in","phone":"+77079990000","status":"answered"}') ->> 'created_deal')::boolean,
  'after a refusal the next call opens a new deal');

-- Round robin distribution of stage 5 applies to incoming calls
update public.organization_settings
set lead_distribution = 'round_robin', lead_distribution_sales_ids = array[current_setting('t.manager_id')::bigint]
where organization_id = current_setting('t.org')::bigint;
select set_config('t.r7', tests.call(current_setting('t.token'), 'generic',
  '{"call_id":"g-7","direction":"in","phone":"+77071112233","status":"missed"}')::text, true);
select tests.assert(
  (select sales_id = current_setting('t.manager_id')::bigint from public.deals
   where id = (current_setting('t.r7')::jsonb ->> 'deal_id')::bigint),
  'a new incoming call is distributed by the clinic rules');
select tests.assert(
  (select t.sales_id = current_setting('t.manager_id')::bigint from public.tasks t
   join public.calls c on c.deal_id = t.deal_id where c.external_id = 'g-7' and t.text = 'Перезвонить'),
  'the call-back task goes to the distributed responsible');

--
-- Test call from the settings, disconnecting
--
select tests.login_as(current_setting('t.owner')::uuid);
select set_config('t.test', public.telephony_test_call()::text, true);
select tests.assert(
  (select first_name = 'Тестовый звонок' from public.patients where id = (current_setting('t.test')::jsonb ->> 'patient_id')::bigint)
  and (select status = 'missed' from public.calls where id = (current_setting('t.test')::jsonb ->> 'call_id')::bigint),
  'the test call creates a missed call from a test patient');
select tests.assert(
  (select last_event_at is not null from public.telephony_status()),
  'the status shows the last event');
select tests.logout();

--
-- Clinic isolation
--
-- The other clinic has lost its «Звонок» source: the first call brings it back
delete from public.lead_sources where organization_id = current_setting('t.other_org')::bigint and code = 'call';
select set_config('t.rb', tests.call('token-b', 'zadarma',
  '{"call_id":"zd-1","direction":"in","phone":"+77015551234","status":"answered"}')::text, true);
select tests.assert(
  (current_setting('t.rb')::jsonb ->> 'created_patient')::boolean
  and (current_setting('t.rb')::jsonb ->> 'patient_id') <> current_setting('t.patient'),
  'the other clinic gets its own patient for the same number and call id');
select tests.assert(
  (select s.is_system and s.name = 'Звонок' and p.source_id = s.id
   from public.patients p join public.lead_sources s on s.organization_id = p.organization_id and s.code = 'call'
   where p.id = (current_setting('t.rb')::jsonb ->> 'patient_id')::bigint),
  'a missing «Звонок» source is added back as a system source');
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.count('select * from public.calls') = 1, 'a clinic reads only its calls');
select tests.assert(
  (select provider = 'binotel' and has_secret from public.telephony_status()),
  'a clinic sees only its telephony');
select tests.throws(
  format('select public.set_sales_phone_extension(%s, ''555'')', current_setting('t.manager_id')),
  'P0002', 'an owner cannot touch the employees of another clinic');
select tests.logout();
select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert(tests.count($q$select * from public.calls where external_id = 'zd-1'$q$) = 2, 'the owner reads only the clinic''s calls');
select public.disconnect_telephony();
select tests.assert((select count(*) from public.telephony_status()) = 0, 'the owner disconnects the PBX');
select tests.logout();
select tests.throws(format($q$select tests.call(%L, 'generic', '{"call_id":"g-9","phone":"+77010000000"}')$q$, current_setting('t.token')),
  '28000', 'a disconnected clinic refuses calls');

rollback;

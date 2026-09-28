--
-- Stage 32: marketing analytics. UTM tags of the deal (ingest_lead, first
-- touch, the deal page), utm_source → lead source, the ad spend (owner and
-- head only, clinic isolation) and public.report_marketing on a fixture
-- whose numbers are repeated in src/components/atomic-crm/marketing/
-- marketingMath.test.ts.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.integrator', tests.invite('agency@clinic.kz', current_setting('t.org')::bigint, 'integrator')::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);

delete from public.task_rules;

create function tests.source(code text) returns bigint language sql as $$
  select id from public.lead_sources where organization_id = current_setting('t.org')::bigint and lead_sources.code = source.code
$$;
create function tests.source_named(source_name text) returns bigint language sql as $$
  select id from public.lead_sources where organization_id = current_setting('t.org')::bigint and name = source_name
$$;
create function tests.stage(stage_name text) returns bigint language sql as $$
  select s.id from public.stages s join public.pipelines p on p.id = s.pipeline_id
  where p.organization_id = current_setting('t.org')::bigint and p.is_default and s.name = stage_name
$$;
create function tests.deal(deal_name text) returns bigint language sql as $$
  select id from public.deals where organization_id = current_setting('t.org')::bigint and name = deal_name
$$;
create function tests.walk(deal_name text, stage_names text[]) returns void language plpgsql as $$
declare stage_name text;
begin
  foreach stage_name in array stage_names loop
    update public.deals set stage_id = tests.stage(stage_name) where id = tests.deal(deal_name);
  end loop;
end;
$$;
-- Moves the creation of a deal (and its log) to a date
create function tests.created(deal_name text, created timestamptz) returns void language plpgsql as $$
begin
  set local session_replication_role = replica;
  update public.deal_events set created_at = created where deal_id = tests.deal(deal_name);
  update public.deals set created_at = created, stage_changed_at = created where id = tests.deal(deal_name);
  set local session_replication_role = origin;
end;
$$;
create function tests.lead(token text, lead jsonb) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  execute 'set local role service_role';
  result := public.ingest_lead(token, lead);
  execute 'reset role';
  return result;
end;
$$;

--
-- utm_source → lead source
--
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.lead_sources (name, position) values ('Google', 10);
update public.lead_sources set utm_sources = array[' Google ', 'google', 'AdWords', '']
where id = tests.source_named('Google');
select tests.assert(
  (select utm_sources from public.lead_sources where id = tests.source_named('Google')) = array['google', 'adwords'],
  'utm_sources are trimmed, lower case, without blanks and repeats');
select tests.assert(private.utm_lead_source(current_setting('t.org')::bigint, 'ADWORDS') = tests.source_named('Google'),
  'a listed utm_source maps to its source');
select tests.assert(private.utm_lead_source(current_setting('t.org')::bigint, 'instagram') = tests.source('instagram'),
  'the code of a source maps too');
select tests.assert(private.utm_lead_source(current_setting('t.org')::bigint, '2GIS') = tests.source('2gis'),
  'the name of a source maps too, any case');
select tests.assert(private.utm_lead_source(current_setting('t.org')::bigint, 'tiktok') is null, 'an unknown value maps to nothing');
select tests.assert(private.utm_lead_source(current_setting('t.org')::bigint, '  ') is null, 'a blank value maps to nothing');
-- The listed value wins over a code
update public.lead_sources set utm_sources = array['instagram'] where id = tests.source_named('Google');
select tests.assert(private.utm_lead_source(current_setting('t.org')::bigint, 'instagram') = tests.source_named('Google'),
  'utm_sources win over the code of another source');
update public.lead_sources set utm_sources = array['google', 'adwords'] where id = tests.source_named('Google');
select tests.logout();

select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(tests.affected($q$update public.lead_sources set utm_sources = array['x'] where name = 'Google'$q$) = 0,
  'a manager cannot change the mapping');
select tests.logout();

-- A deal written without a source takes the mapped one; tags are trimmed
select tests.login_as(current_setting('t.m1')::uuid);
insert into public.patients (first_name) values ('Пациент');
insert into public.deals (patient_id, name, utm_source, utm_medium, utm_campaign, utm_term)
select id, 'mapped', ' adwords ', 'cpc', '  ', 'имплант цена' from public.patients where first_name = 'Пациент';
insert into public.deals (patient_id, name, source_id, utm_source)
select id, 'explicit', tests.source('referral'), 'google' from public.patients where first_name = 'Пациент';
select tests.assert((select source_id from public.deals where id = tests.deal('mapped')) = tests.source_named('Google'),
  'utm_source gives the source of a deal without one');
select tests.assert((select utm_source from public.deals where id = tests.deal('mapped')) = 'adwords', 'utm tags are trimmed');
select tests.assert((select utm_campaign from public.deals where id = tests.deal('mapped')) is null, 'a blank tag is null');
select tests.assert((select source_id from public.deals where id = tests.deal('explicit')) = tests.source('referral'),
  'a chosen source is kept');
-- The deal page edits the tags; deals_summary shows them
update public.deals set utm_campaign = 'Весна' where id = tests.deal('mapped');
select tests.assert((select utm_campaign from public.deals_summary where id = tests.deal('mapped')) = 'Весна',
  'the tags are editable and shown by deals_summary');
select tests.logout();

--
-- Website requests keep the tags (first touch)
--
select tests.login_as(current_setting('t.owner')::uuid);
select set_config('t.token', public.lead_webhook_token(), true);
select tests.logout();

select set_config('t.lead1', tests.lead(current_setting('t.token'), jsonb_build_object(
  'name', 'Айгерим', 'phone', '+7 701 555 00 01', 'source', 'website',
  'utm', jsonb_build_object('utm_source', 'google', 'utm_medium', 'cpc', 'utm_campaign', 'implant', 'utm_content', 'ad1'),
  'utm_term', 'импланты алматы',
  'referrer', 'https://www.google.com/', 'landing_page', 'https://clinic.kz/implant'
))::text, true);
select tests.assert((current_setting('t.lead1')::jsonb ->> 'created_deal')::boolean, 'the request opens a deal');
select tests.assert((
  select d.source_id = tests.source_named('Google')
    and d.utm_source = 'google' and d.utm_medium = 'cpc' and d.utm_campaign = 'implant'
    and d.utm_content = 'ad1' and d.utm_term = 'импланты алматы'
    and d.referrer = 'https://www.google.com/' and d.landing_page = 'https://clinic.kz/implant'
  from public.deals d where d.id = (current_setting('t.lead1')::jsonb ->> 'deal_id')::bigint),
  'the deal keeps the UTM tags, the referrer and the landing page; utm_source gives the source');
select tests.assert((
  select n.text like '%utm_campaign: implant%' and n.text like '%Страница: https://clinic.kz/implant%'
  from public.deal_notes n where n.id = (current_setting('t.lead1')::jsonb ->> 'note_id')::bigint),
  'the note lists the tags and the page');
select tests.assert((
  select p.source_id = tests.source_named('Google') from public.patients p
  where p.id = (current_setting('t.lead1')::jsonb ->> 'patient_id')::bigint),
  'the new patient gets the mapped source');

-- A repeated request on the open deal keeps the first tags
select set_config('t.lead2', tests.lead(current_setting('t.token'), jsonb_build_object(
  'name', 'Айгерим', 'phone', '+77015550001',
  'utm_source', 'instagram', 'utm_campaign', 'stories'
))::text, true);
select tests.assert(not (current_setting('t.lead2')::jsonb ->> 'created_deal')::boolean, 'the repeat joins the open deal');
select tests.assert((
  select d.utm_source = 'google' and d.utm_campaign = 'implant'
  from public.deals d where d.id = (current_setting('t.lead2')::jsonb ->> 'deal_id')::bigint),
  'the open deal keeps its first tags');

-- An open deal without tags takes those of the request
select tests.login_as(current_setting('t.m1')::uuid);
insert into public.patients (first_name, phone_jsonb) values ('Без меток', '[{"number": "+77015550002", "type": "mobile"}]');
insert into public.deals (patient_id, name, source_id)
select id, 'untagged', tests.source('call') from public.patients where first_name = 'Без меток';
select tests.logout();
select tests.lead(current_setting('t.token'), jsonb_build_object('phone', '+77015550002', 'utm_source', 'instagram', 'utm_campaign', 'Stories'));
select tests.assert((select utm_source = 'instagram' and utm_campaign = 'Stories' and source_id = tests.source('call')
  from public.deals where id = tests.deal('untagged')),
  'an open deal without tags takes the tags, its source stays');

-- Without tags and a mapping, the form's source is used as before
select set_config('t.lead3', tests.lead(current_setting('t.token'), jsonb_build_object('phone', '+77015550003', 'source', '2gis'))::text, true);
select tests.assert((
  select d.source_id = tests.source('2gis') and d.utm_source is null
  from public.deals d where d.id = (current_setting('t.lead3')::jsonb ->> 'deal_id')::bigint),
  'a request without tags keeps the source of the form');

-- The fixture of the report starts from a clean clinic
select tests.login_as(current_setting('t.owner')::uuid);
delete from public.deals;
select set_config('t.instagram', tests.source('instagram')::text, true);
select tests.logout();

--
-- Ad spend: owner and head only
--
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.ad_spend (source_id, campaign, spent_from, spent_to, amount, comment) values
  (tests.source('instagram'), 'Implant', '2026-09-01', '2026-09-30', 60000, 'Таргет'),
  (tests.source('instagram'), null, '2026-09-01', '2026-09-30', 30000, null),
  (tests.source('2gis'), null, '2026-10-01', '2026-10-31', 45000, 'Размещение');
select tests.throws($q$insert into public.ad_spend (source_id, spent_from, spent_to, amount) values (tests.source('website'), '2026-09-10', '2026-09-01', 1000)$q$,
  '23514', 'a range ends after it starts');
select tests.throws($q$insert into public.ad_spend (source_id, spent_from, spent_to, amount) values (tests.source('website'), '2026-09-01', '2026-09-30', -1)$q$,
  '23514', 'an amount is not negative');
select tests.assert((select sales_id from public.ad_spend where campaign = 'Implant') is not null, 'the author is kept');
select tests.logout();

select tests.login_as(current_setting('t.head')::uuid);
insert into public.ad_spend (source_id, campaign, spent_from, spent_to, amount)
values (tests.source_named('Google'), 'brand', '2026-08-16', '2026-09-15', 62000);
select tests.assert(tests.count('select * from public.ad_spend') = 4, 'the head reads the spend');
select tests.logout();

select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(tests.count('select * from public.ad_spend') = 0, 'a manager does not see the spend');
select tests.throws($q$insert into public.ad_spend (source_id, spent_from, spent_to, amount) values (tests.source('website'), '2026-09-01', '2026-09-30', 1000)$q$,
  '42501', 'a manager cannot add spend');
select tests.assert(tests.affected('update public.ad_spend set amount = 0') = 0, 'a manager cannot change spend');
select tests.throws($q$select public.report_marketing()$q$, '42501', 'a manager cannot read the marketing report');
select tests.logout();

select tests.login_as(current_setting('t.integrator')::uuid);
select tests.assert(tests.count('select * from public.ad_spend') = 0, 'the integrator does not see the spend');
select tests.throws($q$select public.report_marketing()$q$, '42501', 'the integrator cannot read the marketing report');
select tests.logout();

select tests.login_anon();
select tests.throws($q$select public.report_marketing()$q$, '42501', 'anonymous users cannot call the report');
select tests.logout();

--
-- The report on a fixture: September 2026
--
select tests.login_as(current_setting('t.m1')::uuid);
insert into public.patients (first_name) values ('Фикстура');
insert into public.deals (patient_id, name, source_id, utm_campaign)
select p.id, v.name, v.source_id, v.campaign
from public.patients p, (values
  ('i1', tests.source('instagram'), 'implant'),
  ('i2', tests.source('instagram'), 'IMPLANT '),
  ('i3', tests.source('instagram'), null),
  ('g1', tests.source_named('Google'), 'Brand'),
  ('r1', tests.source('referral'), null),
  ('n1', null, null),
  ('old', tests.source('instagram'), 'implant')
) as v(name, source_id, campaign)
where p.first_name = 'Фикстура';
select tests.walk('i1', array['Записан', 'Пришёл на консультацию']);
select tests.walk('g1', array['В работе', 'План согласован']);
select tests.walk('r1', array['Записан', 'Пришёл на консультацию']);
-- i3 came to a visit of the schedule (the visit date is set), no stage move
update public.deals set visit_at = '2026-09-18 11:00+05' where id = tests.deal('i3');
select tests.logout();
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.deal_payments (deal_id, amount, paid_at) values
  (tests.deal('i1'), 100000, '2026-09-20'),
  (tests.deal('i3'), 50000, '2026-10-05'),
  (tests.deal('g1'), 200000, '2026-09-25'),
  (tests.deal('g1'), 10000, '2026-08-30'),
  (tests.deal('r1'), 40000, '2026-09-10');
select tests.logout();

select tests.created('i1', '2026-09-05 10:00+05');
select tests.created('i2', '2026-09-06 10:00+05');
select tests.created('i3', '2026-09-07 10:00+05');
select tests.created('g1', '2026-09-08 10:00+05');
select tests.created('r1', '2026-09-09 10:00+05');
select tests.created('n1', '2026-09-10 10:00+05');
select tests.created('old', '2026-08-10 10:00+05');

create function tests.row(source_name text) returns jsonb language sql as $$
  select r from jsonb_array_elements(current_setting('t.report')::jsonb -> 'by_source') r
  where r ->> 'name' is not distinct from source_name
$$;
create function tests.campaign(source_name text, campaign_name text) returns jsonb language sql as $$
  select c from jsonb_array_elements(tests.row(source_name) -> 'campaigns') c
  where c ->> 'campaign' is not distinct from campaign_name
$$;
create function tests.metrics(value jsonb) returns text language sql as $$
  select concat_ws(' ', value ->> 'spend', value ->> 'leads', value ->> 'came', value ->> 'paid', value ->> 'revenue',
    coalesce(value ->> 'cpl', '-'), coalesce(value ->> 'cost_per_came', '-'), coalesce(value ->> 'cost_per_paid', '-'),
    coalesce(value ->> 'romi', '-'))
$$;

select tests.login_as(current_setting('t.owner')::uuid);
select set_config('t.report', public.report_marketing('2026-09-01 00:00+05', '2026-10-01 00:00+05')::text, true);
select tests.assert(tests.metrics(current_setting('t.report')::jsonb -> 'totals') = '120000 6 4 3 340000 20000 30000 40000 183',
  'totals: ' || tests.metrics(current_setting('t.report')::jsonb -> 'totals'));
select tests.assert(tests.metrics(tests.row('Instagram')) = '90000 3 2 1 100000 30000 45000 90000 11',
  'Instagram: ' || tests.metrics(tests.row('Instagram')));
select tests.assert(tests.metrics(tests.campaign('Instagram', 'implant')) = '60000 2 1 1 100000 30000 60000 60000 67',
  'Instagram / implant (campaigns match in any case): ' || tests.metrics(tests.campaign('Instagram', 'implant')));
select tests.assert(tests.metrics(tests.campaign('Instagram', null)) = '30000 1 1 0 0 30000 30000 - -100',
  'Instagram without campaign: ' || tests.metrics(tests.campaign('Instagram', null)));
select tests.assert(tests.metrics(tests.row('Google')) = '30000 1 1 1 200000 30000 30000 30000 567',
  'Google (a range across the period counts pro rata: 62000 × 15 / 31): ' || tests.metrics(tests.row('Google')));
select tests.assert(tests.metrics(tests.row('Рекомендация')) = '0 1 1 1 40000 - - - -',
  'Рекомендация, no spend: ' || tests.metrics(tests.row('Рекомендация')));
select tests.assert(tests.metrics(tests.row(null)) = '0 1 0 0 0 - - - -',
  'deals without a source: ' || tests.metrics(tests.row(null)));
select tests.assert(tests.row('2GIS') is null, 'spend outside the period is not counted');
select tests.assert(
  (select string_agg(coalesce(r ->> 'name', '∅'), ',' order by n)
   from jsonb_array_elements(current_setting('t.report')::jsonb -> 'by_source') with ordinality as t(r, n))
  = 'Instagram,Google,Рекомендация,∅',
  'sources by spend, then leads, then position');

-- Filter by source, whole time
select tests.assert(tests.metrics(public.report_marketing(null, null, tests.source('2gis')) -> 'totals') = '45000 0 0 0 0 - - - -100',
  'a source filter and no period: all its spend');
select tests.assert((public.report_marketing(null, null) -> 'totals' ->> 'leads')::int = 7, 'no period: every deal');
select tests.logout();

select tests.login_as(current_setting('t.head')::uuid);
select tests.assert((public.report_marketing('2026-09-01 00:00+05', '2026-10-01 00:00+05') -> 'totals' ->> 'spend')::int = 120000,
  'the head reads the report');
select tests.logout();

--
-- Clinic isolation
--
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.count('select * from public.ad_spend') = 0, 'another clinic sees none of the spend');
select tests.assert(tests.metrics(public.report_marketing() -> 'totals') = '0 0 0 0 0 - - - -', 'another clinic reports nothing of this one');
select tests.throws(format($q$insert into public.ad_spend (source_id, spent_from, spent_to, amount) values (%s, '2026-09-01', '2026-09-30', 1000)$q$, current_setting('t.instagram')),
  '23503', 'another clinic cannot book spend on this clinic''s source');
select tests.assert(private.utm_lead_source(current_setting('t.org')::bigint, 'google') is null,
  'another clinic cannot read this clinic''s mapping');
select tests.logout();
select tests.assert(private.utm_lead_source(current_setting('t.org')::bigint, 'google') is not null
  and private.utm_lead_source(tests.org_of(current_setting('t.other')::uuid), 'google') is null,
  'the mapping is per clinic');

rollback;

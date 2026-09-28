--
-- First-run setup wizard (stage 24): the progress row of a clinic (rights,
-- isolation, step statuses), the clinic profile (name, time zone, contacts)
-- and the quick reply placeholders filled from the address and the price of
-- the consultation.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.manager', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.manager_id', (select id from public.sales where email = 'm1@clinic.kz')::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);
select set_config('t.other_org', tests.org_of(current_setting('t.other')::uuid)::text, true);

-- A new clinic starts with an empty progress
select tests.assert(
  (select steps = '{}'::jsonb and postponed_at is null and dismissed_at is null and completed_at is null
   from public.onboarding_progress where organization_id = current_setting('t.org')::bigint),
  'a new clinic gets an empty onboarding progress');

-- Clinics that existed before the wizard count as set up (migration backfill)
insert into public.organizations (name) values ('Старая клиника');
delete from public.onboarding_progress where organization_id = (select id from public.organizations where name = 'Старая клиника');
insert into public.onboarding_progress (organization_id, completed_at)
select o.id, now() from public.organizations o
on conflict (organization_id) do nothing;
select tests.assert(
  (select completed_at is not null from public.onboarding_progress p join public.organizations o on o.id = p.organization_id
   where o.name = 'Старая клиника'),
  'the backfill marks an existing clinic as set up');
select tests.assert(
  (select completed_at is null from public.onboarding_progress where organization_id = current_setting('t.org')::bigint),
  'the backfill leaves clinics with a progress alone');

-- The owner marks steps; the timestamp follows
select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert(tests.count('select * from public.onboarding_progress') = 1, 'the owner reads the progress of the clinic');
select tests.assert(
  tests.affected($q$update public.onboarding_progress set steps = '{"clinic": "done", "doctors": "skipped"}'$q$) = 1,
  'the owner saves step statuses');
select tests.throws(
  $q$update public.onboarding_progress set steps = '{"clinic": "maybe"}'$q$,
  '23514', 'a step is done or skipped');
select tests.throws(
  $q$update public.onboarding_progress set steps = '["clinic"]'$q$,
  '23514', 'the steps are an object');
select tests.throws(
  format($q$insert into public.onboarding_progress (organization_id) values (%s)$q$, current_setting('t.org')),
  '42501', 'the progress row is created by the database only');
select tests.assert(
  tests.affected($q$delete from public.onboarding_progress$q$) = 0,
  'the progress row cannot be deleted');
select tests.logout();

-- The head puts the wizard off
select tests.login_as(current_setting('t.head')::uuid);
select tests.assert(
  tests.affected($q$update public.onboarding_progress set postponed_at = now(), steps = steps || '{"team": "skipped"}'$q$) = 1,
  'the head changes the progress');
select tests.logout();
select tests.assert(
  (select steps = '{"clinic": "done", "doctors": "skipped", "team": "skipped"}'::jsonb and postponed_at is not null
   from public.onboarding_progress where organization_id = current_setting('t.org')::bigint),
  'the statuses of the owner and the head are kept');

-- A manager reads it, cannot change it
select tests.login_as(current_setting('t.manager')::uuid);
select tests.assert(tests.count('select * from public.onboarding_progress') = 1, 'a manager reads the progress');
select tests.assert(
  tests.affected($q$update public.onboarding_progress set dismissed_at = now()$q$) = 0,
  'a manager cannot change the progress');
select tests.throws(
  $q$select public.save_clinic_profile('Взлом', null, 'Asia/Almaty', null, null)$q$,
  '42501', 'a manager cannot edit the clinic');
select tests.logout();

-- Another clinic neither sees nor changes it
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(
  (select count(*) = 1 and bool_and(organization_id = current_setting('t.other_org')::bigint) from public.onboarding_progress),
  'another clinic only sees its own progress');
select tests.assert(
  tests.affected(format($q$update public.onboarding_progress set completed_at = now() where organization_id = %s$q$, current_setting('t.org'))) = 0,
  'another clinic cannot change the progress of the first one');
select tests.logout();

-- Step «Клиника»: name, time zone, contacts; the address fills the quick reply
select tests.login_as(current_setting('t.owner')::uuid);
select public.save_clinic_profile('  Жемчуг Дентал ', 'Алматы', 'Asia/Aqtobe', '8 701 555 12 34', 'Абая, 10, 2 этаж');
select tests.throws(
  $q$select public.save_clinic_profile('Клиника', null, 'Mars/Olympus', null, null)$q$,
  '22023', 'the time zone must exist');
select tests.throws(
  $q$select public.save_clinic_profile('   ', null, null, null, null)$q$,
  '23514', 'the clinic needs a name');
select tests.logout();

select tests.assert(
  (select name = 'Жемчуг Дентал' and timezone = 'Asia/Aqtobe' from public.organizations where id = current_setting('t.org')::bigint),
  'the name and the time zone of the clinic are saved');
select tests.assert(
  (select config ->> 'title' = 'Жемчуг Дентал' from public.configuration where organization_id = current_setting('t.org')::bigint),
  'the title of the app ({клиника} in the texts) follows the name');
select tests.assert(
  (select clinic_city = 'Алматы' and clinic_phone = '+77015551234' and clinic_address = 'Абая, 10, 2 этаж'
   from public.organization_settings where organization_id = current_setting('t.org')::bigint),
  'the city, the normalized phone and the address are saved');
select tests.assert(
  (select text = 'Наш адрес: Абая, 10, 2 этаж. Рядом есть бесплатная парковка [уточните, где именно]. Ждём вас!'
   from public.quick_replies where organization_id = current_setting('t.org')::bigint and shortcut = 'адрес'),
  'the address fills the placeholder of the address reply');
select tests.assert(
  (select text like '%[укажите адрес клиники]%' from public.quick_replies
   where organization_id = current_setting('t.other_org')::bigint and shortcut = 'адрес'),
  'the replies of another clinic keep their placeholder');

-- The head can save the clinic too; a blank time zone falls back to Almaty
select tests.login_as(current_setting('t.head')::uuid);
select public.save_clinic_profile('Жемчуг Дентал', '', '', '', 'Абая, 12');
select tests.logout();
select tests.assert(
  (select o.timezone = 'Asia/Almaty' and s.clinic_city is null and s.clinic_phone is null and s.clinic_address = 'Абая, 12'
   from public.organizations o join public.organization_settings s on s.organization_id = o.id
   where o.id = current_setting('t.org')::bigint),
  'the head saves the clinic, empty fields are cleared');
select tests.assert(
  (select text like 'Наш адрес: Абая, 10, 2 этаж.%' from public.quick_replies
   where organization_id = current_setting('t.org')::bigint and shortcut = 'адрес'),
  'an edited reply is not rewritten again');

-- Step «Услуги и цены»: the consultation price fills its reply
select tests.assert(private.format_tenge(5000) = '5 000', 'format_tenge 5000');
select tests.assert(private.format_tenge(1250000.4) = '1 250 000', 'format_tenge 1250000.4');
select tests.assert(private.format_tenge(900) = '900', 'format_tenge 900');

select tests.login_as(current_setting('t.manager')::uuid);
insert into public.quick_replies (title, text, sales_id)
values ('Моя цена', 'Консультация [укажите цену] ₸', current_setting('t.manager_id')::bigint);
select tests.throws(
  $q$insert into public.services (name, price) values ('Консультация', 1000)$q$,
  '42501', 'a manager cannot add services');
select tests.logout();

select tests.login_as(current_setting('t.owner')::uuid);
insert into public.services (name, position, price) values ('Лечение кариеса', 10, 25000);
select tests.assert(
  (select text like '%[укажите цену]%' from public.quick_replies
   where organization_id = current_setting('t.org')::bigint and shortcut = 'цена'),
  'another service price does not touch the consultation reply');
insert into public.services (name, position) values ('Консультация', 11);
select tests.assert(
  tests.affected($q$update public.services set price = 5000 where name = 'Консультация'$q$) = 1,
  'the owner sets a price');
select tests.throws(
  $q$update public.services set price = -1 where name = 'Консультация'$q$,
  '23514', 'a price is not negative');
select tests.logout();

select tests.assert(
  (select text = '{имя}, консультация врача стоит 5 000 ₸. На ней врач проведёт осмотр и составит план лечения.'
   from public.quick_replies where organization_id = current_setting('t.org')::bigint and shortcut = 'цена'),
  'the consultation price fills the price reply');
select tests.assert(
  (select text = 'Консультация [укажите цену] ₸' from public.quick_replies where title = 'Моя цена'),
  'personal replies are left alone');
select tests.assert(
  (select text like '%[укажите цену]%' from public.quick_replies
   where organization_id = current_setting('t.other_org')::bigint and shortcut = 'цена'),
  'the price reply of another clinic keeps its placeholder');

-- Another clinic cannot save the profile of the first one: it only ever saves its own
select tests.login_as(current_setting('t.other')::uuid);
select public.save_clinic_profile('Другая', null, 'Asia/Almaty', null, 'Сатпаева, 1');
select tests.assert(
  tests.count($q$select * from public.services where name = 'Консультация'$q$) = 0,
  'another clinic does not see the services of the first one');
select tests.logout();
select tests.assert(
  (select name = 'Жемчуг Дентал' from public.organizations where id = current_setting('t.org')::bigint),
  'the first clinic keeps its name');
select tests.assert(
  (select clinic_address = 'Сатпаева, 1' from public.organization_settings where organization_id = current_setting('t.other_org')::bigint),
  'the other clinic saved its own address');

-- Anonymous visitors cannot call it
select tests.login_anon();
select tests.throws(
  $q$select public.save_clinic_profile('Аноним', null, null, null, null)$q$,
  '42501', 'an anonymous visitor cannot edit a clinic');
select tests.logout();

-- Deleting a clinic removes its progress
delete from public.organizations where id = current_setting('t.other_org')::bigint;
select tests.assert(
  not exists (select 1 from public.onboarding_progress where organization_id = current_setting('t.other_org')::bigint),
  'the progress goes with the clinic');

rollback;

--
-- Doctors (stage 13): rights on the dictionary, clinic isolation, the
-- composite foreign key of deals.doctor_id, the consultation price, the
-- prepayments in deals_summary, the deal log and the {врач} variable.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);

-- The owner and the head edit the dictionary
select tests.login_as(current_setting('t.owner')::uuid);
insert into public.doctors (name, specialty, position) values ('Ахметова Айгуль', 'хирург-имплантолог', 0);
select set_config('t.doctor', (select id from public.doctors where name = 'Ахметова Айгуль')::text, true);
select tests.assert(
  (select organization_id from public.doctors where id = current_setting('t.doctor')::bigint) = current_setting('t.org')::bigint,
  'a new doctor belongs to the clinic of the owner');
select tests.throws($q$insert into public.doctors (name) values ('  ')$q$, '23514', 'a doctor needs a name');
select tests.logout();

select tests.login_as(current_setting('t.head')::uuid);
insert into public.doctors (name, specialty, position) values ('Сериков Бахыт', 'ортодонт', 1);
select tests.assert(
  tests.affected('update public.doctors set specialty = ''ортодонт, ортопед'' where name = ''Сериков Бахыт''') = 1,
  'the head renames a doctor');
select tests.assert(
  tests.affected('delete from public.doctors where name = ''Сериков Бахыт''') = 1,
  'the head deletes an unused doctor');
select tests.logout();

-- A manager reads the doctors (pickers) but cannot change them
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(tests.count('select * from public.doctors') = 1, 'a manager reads the doctors');
select tests.throws($q$insert into public.doctors (name) values ('Врач')$q$, '42501', 'a manager cannot add a doctor');
select tests.assert(tests.affected('update public.doctors set name = ''hacked''') = 0, 'a manager cannot rename a doctor');
select tests.assert(tests.affected('delete from public.doctors') = 0, 'a manager cannot delete a doctor');

-- ...but sets the doctor, the consultation price on a deal
insert into public.patients (first_name) values ('Асель');
insert into public.deals (patient_id, name, doctor_id, consultation_amount)
select p.id, 'Имплантация', current_setting('t.doctor')::bigint, 5000 from public.patients p;
select set_config('t.deal', (select id from public.deals where name = 'Имплантация')::text, true);
select tests.assert(
  (select doctor_name from public.deals_summary where id = current_setting('t.deal')::bigint) = 'Ахметова Айгуль'
  and (select consultation_amount from public.deals_summary where id = current_setting('t.deal')::bigint) = 5000,
  'deals_summary shows the doctor and the consultation price');
select tests.throws(
  format('update public.deals set consultation_amount = -1 where id = %s', current_setting('t.deal')),
  '23514', 'the consultation price cannot be negative');

-- Prepayments: a kind of payment; paid = all payments, prepayment = prepayments only
insert into public.deal_payments (deal_id, amount, kind) values (current_setting('t.deal')::bigint, 20000, 'prepayment');
insert into public.deal_payments (deal_id, amount) values (current_setting('t.deal')::bigint, 30000);
select tests.assert(
  (select paid_amount from public.deals_summary where id = current_setting('t.deal')::bigint) = 50000
  and (select prepayment_amount from public.deals_summary where id = current_setting('t.deal')::bigint) = 20000,
  'the prepayment is the sum of the prepayments, the paid amount the sum of all payments');
select tests.assert(
  (select kind from public.deal_payments where amount = 30000) = 'payment',
  'a payment is a regular payment by default');
select tests.throws(
  format($q$insert into public.deal_payments (deal_id, amount, kind) values (%s, 100, 'refund')$q$, current_setting('t.deal')),
  '23514', 'only the prepayment and payment kinds exist');

-- The deal log follows the doctor
update public.deals set doctor_id = null where id = current_setting('t.deal')::bigint;
select tests.assert(
  (select changes ? 'doctor_id' from public.deal_events
   where deal_id = current_setting('t.deal')::bigint and type = 'updated' order by id desc limit 1),
  'changing the doctor is logged');
update public.deals set doctor_id = current_setting('t.doctor')::bigint where id = current_setting('t.deal')::bigint;
select tests.logout();

-- An inactive doctor stays on the old deals; a doctor with deals cannot be deleted
select tests.login_as(current_setting('t.owner')::uuid);
update public.doctors set is_active = false where id = current_setting('t.doctor')::bigint;
select tests.assert(
  (select doctor_name from public.deals_summary where id = current_setting('t.deal')::bigint) = 'Ахметова Айгуль',
  'an inactive doctor stays on the deal');
select tests.throws(
  format('delete from public.doctors where id = %s', current_setting('t.doctor')),
  '23503', 'a doctor with deals cannot be deleted');
select tests.logout();

-- {врач} of the auto-messages
select tests.assert(
  (select private.automessage_vars(d) ->> 'врач' from public.deals d where d.id = current_setting('t.deal')::bigint) = 'Ахметова Айгуль',
  'the {врач} variable is the name of the doctor');
select tests.assert(
  private.render_template('{имя}, ваш врач — {врач}.',
    (select private.automessage_vars(d) from public.deals d where d.id = current_setting('t.deal')::bigint))
    = 'Асель, ваш врач — Ахметова Айгуль.',
  'a template with {врач} renders the name');

-- Another clinic sees nothing and cannot point at these doctors
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.count('select * from public.doctors') = 0, 'another clinic sees no doctors of this one');
select tests.assert(tests.affected('update public.doctors set name = ''hacked''') = 0, 'nor renames them');
select tests.assert(tests.affected('delete from public.doctors') = 0, 'nor deletes them');
select tests.throws(
  format($q$insert into public.doctors (organization_id, name) values (%s, 'Чужой')$q$, current_setting('t.org')),
  '42501', 'nor adds a doctor to it');
insert into public.patients (first_name) values ('Чужой пациент');
select tests.throws(
  format($q$insert into public.deals (patient_id, doctor_id) select id, %s from public.patients$q$, current_setting('t.doctor')),
  '23503', 'a deal cannot point at a doctor of another clinic');
insert into public.deals (patient_id) select id from public.patients;
select tests.throws(
  format('update public.deals set doctor_id = %s', current_setting('t.doctor')),
  '23503', 'nor be moved to one');
select tests.logout();

-- Anonymous users read nothing
select tests.login_anon();
select tests.assert(tests.count('select * from public.doctors') = 0, 'anonymous users see no doctors');
select tests.logout();

-- Deleting the clinic removes its doctors after the deals pointing at them
delete from public.organizations where id = current_setting('t.org')::bigint;
select tests.assert(
  (select count(*) from public.doctors where organization_id = current_setting('t.org')::bigint) = 0,
  'deleting the clinic deletes its doctors');

rollback;

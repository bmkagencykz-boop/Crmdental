--
-- Quick replies (stage 14): default replies, clinic-wide replies for the owner
-- and the head, personal replies seen and edited by their author only.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic.kz', 'Клиника')::text, true);
select set_config('t.org', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.head', tests.invite('head@clinic.kz', current_setting('t.org')::bigint, 'head')::text, true);
select set_config('t.m1', tests.invite('m1@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m2', tests.invite('m2@clinic.kz', current_setting('t.org')::bigint, 'manager')::text, true);
select set_config('t.m1_id', (select id from public.sales where email = 'm1@clinic.kz')::text, true);
select set_config('t.m2_id', (select id from public.sales where email = 'm2@clinic.kz')::text, true);
select set_config('t.other', tests.sign_up('owner@other.kz', 'Другая')::text, true);

-- Default replies of a new clinic, clinic-wide, with a shortcut
select tests.assert(
  (select count(*) = 5 and bool_and(sales_id is null) and bool_and(shortcut is not null)
   from public.quick_replies where organization_id = current_setting('t.org')::bigint),
  'a new clinic gets 5 default clinic-wide replies');
select tests.assert(
  exists (select 1 from public.quick_replies
          where organization_id = current_setting('t.org')::bigint and shortcut = 'адрес' and text like '%[укажите адрес клиники]%'),
  'the address reply has a placeholder to edit');

-- Existing clinics: the migration seeds them with the same function
insert into public.organizations (name) values ('Без ответов');
delete from public.quick_replies where organization_id = (select id from public.organizations where name = 'Без ответов');
select private.seed_quick_replies(o.id)
from public.organizations o
where not exists (select 1 from public.quick_replies q where q.organization_id = o.id);
select tests.assert(
  (select count(*) from public.quick_replies q join public.organizations o on o.id = q.organization_id where o.name = 'Без ответов') = 5,
  'the backfill seeds a clinic without replies');
select tests.assert(
  (select count(*) from public.quick_replies where organization_id = current_setting('t.org')::bigint) = 5,
  'the backfill leaves clinics with replies alone');

-- A manager reads the clinic replies, cannot edit them
select tests.login_as(current_setting('t.m1')::uuid);
select tests.assert(tests.count('select * from public.quick_replies') = 5, 'a manager reads the clinic replies');
select tests.throws(
  $q$insert into public.quick_replies (title, text) values ('Общий', 'Текст')$q$,
  '42501', 'a manager cannot add a clinic-wide reply');
select tests.throws(
  format($q$insert into public.quick_replies (title, text, sales_id) values ('Чужой', 'Текст', %s)$q$, current_setting('t.m2_id')),
  '42501', 'a manager cannot add a reply for another employee');
select tests.assert(
  tests.affected($q$update public.quick_replies set text = 'Взлом' where sales_id is null$q$) = 0,
  'a manager cannot edit clinic replies');
select tests.assert(
  tests.affected($q$delete from public.quick_replies where sales_id is null$q$) = 0,
  'a manager cannot delete clinic replies');

-- ...but has personal replies
insert into public.quick_replies (title, text, shortcut, sales_id)
values ('Мой ответ', 'Здравствуйте, {имя}!', 'мой', current_setting('t.m1_id')::bigint);
select tests.assert(tests.count('select * from public.quick_replies') = 6, 'a manager sees their personal reply');
select tests.assert(
  tests.affected($q$update public.quick_replies set text = 'Новый текст' where shortcut = 'мой'$q$) = 1,
  'a manager edits their personal reply');
select tests.throws(
  format($q$update public.quick_replies set sales_id = %s where shortcut = 'мой'$q$, current_setting('t.m2_id')),
  '42501', 'a personal reply cannot be handed to another employee');
select tests.throws(
  $q$update public.quick_replies set sales_id = null where shortcut = 'мой'$q$,
  '42501', 'a manager cannot turn a personal reply into a clinic-wide one');
select tests.logout();

-- Another employee does not see my personal replies, even the owner
select tests.login_as(current_setting('t.m2')::uuid);
select tests.assert(tests.count('select * from public.quick_replies') = 5, 'another manager does not see my personal reply');
select tests.assert(
  tests.affected($q$delete from public.quick_replies where shortcut = 'мой'$q$) = 0,
  'another manager cannot delete my personal reply');
select tests.logout();

select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert(tests.count($q$select * from public.quick_replies where shortcut = 'мой'$q$) = 0, 'the owner does not see personal replies of employees');
select tests.logout();

-- The owner and the head edit clinic replies
select tests.login_as(current_setting('t.head')::uuid);
insert into public.quick_replies (title, text, shortcut) values ('Рассрочка', 'Есть рассрочка 0-0-12.', 'рассрочка');
select tests.assert(
  tests.affected($q$update public.quick_replies set text = 'Наш адрес: Абая, 1.' where shortcut = 'адрес'$q$) = 1,
  'the head edits a clinic reply');
select tests.logout();

select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert(
  tests.affected($q$delete from public.quick_replies where shortcut = 'рассрочка'$q$) = 1,
  'the owner deletes a clinic reply');
select tests.throws(
  $q$insert into public.quick_replies (title, text, shortcut) values ('Плохой', 'Текст', 'два слова')$q$,
  '23514', 'a shortcut has no spaces');
select tests.throws(
  $q$insert into public.quick_replies (title, text) values ('Пустой', '  ')$q$,
  '23514', 'a reply has a text');
select tests.logout();

-- Clinic isolation
select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.count('select * from public.quick_replies') = 5, 'another clinic only sees its own replies');
select tests.assert(
  tests.count($q$select * from public.quick_replies where text like '%Абая%'$q$) = 0,
  'another clinic does not see edits of the first one');
select tests.assert(
  tests.affected(format($q$update public.quick_replies set text = 'x' where organization_id = %s$q$, current_setting('t.org'))) = 0,
  'another clinic cannot edit the replies of the first one');
select tests.throws(
  format($q$insert into public.quick_replies (organization_id, title, text) values (%s, 'Чужая', 'Текст')$q$, current_setting('t.org')),
  '42501', 'another clinic cannot add replies to the first one');
select tests.throws(
  format($q$insert into public.quick_replies (title, text, sales_id) values ('Чужой', 'Текст', %s)$q$, current_setting('t.m1_id')),
  '42501', 'a reply cannot belong to an employee of another clinic');
select tests.logout();

-- Deleting a clinic removes its replies
delete from public.organizations where id = current_setting('t.org')::bigint;
select tests.assert(
  (select count(*) from public.quick_replies where organization_id = current_setting('t.org')::bigint) = 0,
  'deleting a clinic removes its replies');

rollback;

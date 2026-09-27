--
-- Roles (owner / head / manager), invitations, organization settings and
-- storage isolation.
--
begin;
\ir helpers.sql

select set_config('t.owner', tests.sign_up('owner@clinic-a.kz', 'Клиника A')::text, true);
select set_config('t.org_a', tests.org_of(current_setting('t.owner')::uuid)::text, true);
select set_config('t.other', tests.sign_up('owner@clinic-b.kz', 'Клиника B')::text, true);
select set_config('t.org_b', tests.org_of(current_setting('t.other')::uuid)::text, true);

-- Invitations (created by the users edge function with the service role)
select set_config('t.nb_orgs', (select count(*) from public.organizations)::text, true);
select set_config('t.head', tests.invite('head@clinic-a.kz', current_setting('t.org_a')::bigint, 'head')::text, true);
select set_config('t.manager', tests.invite('admin@clinic-a.kz', current_setting('t.org_a')::bigint, 'manager')::text, true);
select set_config('t.sneaky', tests.invite('sneaky@clinic-a.kz', current_setting('t.org_a')::bigint, 'owner')::text, true);

select tests.assert(tests.org_of(current_setting('t.manager')::uuid) = current_setting('t.org_a')::bigint, 'invited user joins the inviting clinic');
select tests.assert((select role from public.sales where user_id = current_setting('t.head')::uuid) = 'head', 'invited head gets the head role');
select tests.assert((select role from public.sales where user_id = current_setting('t.sneaky')::uuid) = 'manager', 'an invitation cannot create another owner');
select tests.assert(
  (select administrator from public.sales where user_id = current_setting('t.head')::uuid)
  and not (select administrator from public.sales where user_id = current_setting('t.manager')::uuid),
  'administrator flag follows the role');
select tests.assert((select count(*) from public.organizations) = current_setting('t.nb_orgs')::bigint, 'invitations do not create organizations');
select tests.throws(
  'select tests.invite(''ghost@nowhere.kz'', -1, ''manager'')',
  'P0001', 'inviting into a missing organization fails');

-- A self sign-up cannot join an existing clinic through user metadata
insert into auth.users (email, raw_user_meta_data)
values ('attacker@evil.kz', jsonb_build_object('organization_id', current_setting('t.org_a'), 'role', 'owner'));
select tests.assert(
  (select organization_id from public.sales where email = 'attacker@evil.kz') not in (current_setting('t.org_a')::bigint, current_setting('t.org_b')::bigint),
  'user metadata cannot pick an organization');

-- Everybody in the clinic sees colleagues
select tests.login_as(current_setting('t.manager')::uuid);
select tests.assert(tests.count('select * from public.sales') = 4, 'manager sees the 4 members of clinic A');

-- Nobody writes sales directly (the users edge function does it)
select tests.assert(tests.affected('update public.sales set role = ''owner''') = 0, 'manager cannot promote himself');
select tests.throws(
  format('insert into public.sales (organization_id, email, user_id, role) values (%s, ''x@x.kz'', gen_random_uuid(), ''owner'')', current_setting('t.org_a')),
  '42501', 'manager cannot insert sales');

-- Configuration: owner and head only
select tests.assert(tests.affected('update public.configuration set config = ''{"title":"m"}''') = 0, 'manager cannot change configuration');
select tests.assert(public.is_admin() = false, 'manager is not admin');
-- Organization: owner only
select tests.assert(tests.affected('update public.organizations set name = ''m''') = 0, 'manager cannot rename the clinic');
select tests.logout();

select tests.login_as(current_setting('t.head')::uuid);
select tests.assert(public.is_admin(), 'head is admin');
select tests.assert(tests.affected('update public.configuration set config = ''{"title":"h"}''') = 1, 'head can change configuration');
select tests.assert(tests.affected('update public.organizations set name = ''h''') = 0, 'head cannot rename the clinic');
select tests.logout();

select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert(tests.affected('update public.organizations set name = ''Клиника A+'', timezone = ''Asia/Aqtobe''') = 1, 'owner can rename the clinic');
select tests.throws('update public.organizations set plan = ''pro''', '42501', 'owner cannot change the billing plan');
select tests.throws('update public.organizations set trial_ends_at = now() + interval ''10 years''', '42501', 'owner cannot extend the trial');
select tests.throws('insert into public.organizations (name) values (''new'')', '42501', 'users cannot create organizations directly');
select tests.throws('delete from public.organizations', '42501', 'users cannot delete organizations');
select tests.logout();

-- Global reference data is read-only
select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert(tests.count('select * from public.favicons_excluded_domains') > 0, 'excluded favicon domains are readable');
select tests.throws('insert into public.favicons_excluded_domains (domain) values (''x.kz'')', '42501', 'excluded favicon domains are read-only');
select tests.logout();

-- Storage: files live under "<organization_id>/..."
select tests.login_as(current_setting('t.owner')::uuid);
select tests.assert(tests.affected(format('insert into storage.objects (bucket_id, name) values (''attachments'', ''%s/photo.jpg'')', current_setting('t.org_a'))) = 1, 'upload into own folder');
select tests.throws(format('insert into storage.objects (bucket_id, name) values (''attachments'', ''%s/photo.jpg'')', current_setting('t.org_b')), '42501', 'cannot upload into another clinic folder');
select tests.throws('insert into storage.objects (bucket_id, name) values (''attachments'', ''photo.jpg'')', '42501', 'cannot upload outside of a clinic folder');
select tests.logout();

select tests.login_as(current_setting('t.other')::uuid);
select tests.assert(tests.count('select * from storage.objects') = 0, 'cannot list files of another clinic');
select tests.assert(tests.affected('delete from storage.objects') = 0, 'cannot delete files of another clinic');
select tests.logout();

rollback;

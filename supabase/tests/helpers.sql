--
-- Test helpers, included by every *.test.sql file (\ir helpers.sql) inside its
-- transaction, so nothing here outlives the test.
--

create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

-- Creates an auth user the way Supabase Auth does. The sign-up form passes
-- organization_name in user metadata. An invitation (users edge function,
-- auth.admin.createUser) inserts the user, then writes the organization and
-- role to app metadata with a second statement: only the service role can.
create function tests.sign_up(email text, organization_name text default null) returns uuid
language plpgsql as $$
declare uid uuid;
begin
  insert into auth.users (email, raw_user_meta_data, raw_app_meta_data)
  values (email, jsonb_build_object('first_name', split_part(email, '@', 1), 'last_name', 'Test', 'organization_name', organization_name),
          '{"provider": "email", "providers": ["email"]}')
  returning id into uid;
  return uid;
end;
$$;

create function tests.invite(email text, org_id bigint, invited_role text) returns uuid
language plpgsql as $$
declare uid uuid;
begin
  insert into auth.users (email, raw_user_meta_data, raw_app_meta_data)
  values (email, jsonb_build_object('first_name', split_part(email, '@', 1), 'last_name', 'Test'),
          '{"provider": "email", "providers": ["email"]}')
  returning id into uid;
  update auth.users
  set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('organization_id', org_id, 'role', invited_role)
  where id = uid;
  return uid;
end;
$$;

create function tests.org_of(uid uuid) returns bigint language sql as $$
  select organization_id from public.sales where user_id = uid
$$;

-- Switch the session to an authenticated user (as PostgREST does)
create function tests.login_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create function tests.login_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end;
$$;

create function tests.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create function tests.assert(condition boolean, message text) returns void
language plpgsql as $$
begin
  if condition is not true then
    raise exception 'ASSERTION FAILED: %', message;
  end if;
end;
$$;

create function tests.count(query text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from (%s) q', query) into n;
  return n;
end;
$$;

-- Number of rows touched by an UPDATE/DELETE statement
create function tests.affected(statement text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute statement;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Asserts that a statement fails with the given SQLSTATE
create function tests.throws(statement text, expected_sqlstate text, message text) returns void
language plpgsql as $$
begin
  execute statement;
  raise exception 'ASSERTION FAILED: % (statement succeeded: %)', message, statement;
exception
  when others then
    if sqlstate like 'P0001' and sqlerrm like 'ASSERTION FAILED%' then
      raise;
    end if;
    if sqlstate <> expected_sqlstate then
      raise exception 'ASSERTION FAILED: % (expected %, got %: %)', message, expected_sqlstate, sqlstate, sqlerrm;
    end if;
end;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

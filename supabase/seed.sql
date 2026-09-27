INSERT INTO favicons_excluded_domains (domain) VALUES
    ('gmail.com'),
    ('yahoo.com'),
    ('hotmail.com'),
    ('aol.com'),
    ('hotmail.co.uk'),
    ('hotmail.fr'),
    ('msn.com'),
    ('yahoo.fr'),
    ('wanadoo.fr'),
    ('orange.fr'),
    ('comcast.net'),
    ('yahoo.co.uk'),
    ('yahoo.com.br'),
    ('yahoo.co.in'),
    ('live.com'),
    ('rediffmail.com'),
    ('free.fr'),
    ('gmx.de'),
    ('web.de'),
    ('yandex.ru'),
    ('ymail.com'),
    ('libero.it'),
    ('outlook.com'),
    ('uol.com.br'),
    ('bol.com.br'),
    ('mail.ru'),
    ('cox.net'),
    ('hotmail.it'),
    ('sbcglobal.net'),
    ('sfr.fr'),
    ('live.fr'),
    ('verizon.net'),
    ('live.co.uk'),
    ('googlemail.com'),
    ('yahoo.es'),
    ('ig.com.br'),
    ('live.nl'),
    ('bigpond.com'),
    ('terra.com.br'),
    ('yahoo.it'),
    ('neuf.fr'),
    ('yahoo.de'),
    ('alice.it'),
    ('rocketmail.com'),
    ('att.net'),
    ('laposte.net'),
    ('facebook.com'),
    ('bellsouth.net'),
    ('yahoo.in'),
    ('hotmail.es'),
    ('charter.net'),
    ('yahoo.ca'),
    ('yahoo.com.au'),
    ('rambler.ru'),
    ('hotmail.de'),
    ('tiscali.it'),
    ('shaw.ca'),
    ('yahoo.co.jp'),
    ('sky.com'),
    ('earthlink.net'),
    ('optonline.net'),
    ('freenet.de'),
    ('t-online.de'),
    ('aliceadsl.fr'),
    ('virgilio.it'),
    ('home.nl'),
    ('qq.com'),
    ('telenet.be'),
    ('me.com'),
    ('yahoo.com.ar'),
    ('tiscali.co.uk'),
    ('yahoo.com.mx'),
    ('voila.fr'),
    ('gmx.net'),
    ('mail.com'),
    ('planet.nl'),
    ('tin.it'),
    ('live.it'),
    ('ntlworld.com'),
    ('arcor.de'),
    ('yahoo.co.id'),
    ('frontiernet.net'),
    ('hetnet.nl'),
    ('live.com.au'),
    ('yahoo.com.sg'),
    ('zonnet.nl'),
    ('club-internet.fr'),
    ('juno.com'),
    ('optusnet.com.au'),
    ('blueyonder.co.uk'),
    ('bluewin.ch'),
    ('skynet.be'),
    ('sympatico.ca'),
    ('windstream.net'),
    ('mac.com'),
    ('centurytel.net'),
    ('chello.nl'),
    ('live.ca'),
    ('aim.com'),
    ('bigpond.net.au'),
    ('online.de'),
    ('apple.com');


--
-- Demo data for local development (supabase db reset).
-- Two clinics, to see that each one only sees its own data.
-- Every demo account uses the password: demo1234
--

create function pg_temp.create_demo_user(
  user_email text,
  first_name text,
  last_name text,
  user_metadata jsonb default '{}'::jsonb,
  app_metadata jsonb default '{}'::jsonb
) returns uuid language plpgsql as $$
declare uid uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', user_email,
    extensions.crypt('demo1234', extensions.gen_salt('bf')), now(),
    '', '', '', '',
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')) || app_metadata,
    jsonb_build_object('first_name', first_name, 'last_name', last_name) || user_metadata,
    now(), now()
  );
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid::text, uid, jsonb_build_object('sub', uid::text, 'email', user_email), 'email', now(), now(), now());
  return uid;
end;
$$;

do $$
declare
  owner_id uuid;
  org_id bigint;
  head_sales_id bigint;
  manager_sales_id bigint;
  other_owner_id uuid;
  other_org_id bigint;
begin
  -- Clinic 1: owner signs up, then invites a head and an administrator
  owner_id := pg_temp.create_demo_user('owner@demo.kz', 'Айгерим', 'Садыкова',
    jsonb_build_object('organization_name', 'Демо-клиника «Жемчуг»'));
  select organization_id into org_id from public.sales where user_id = owner_id;

  perform pg_temp.create_demo_user('head@demo.kz', 'Ержан', 'Касымов', '{}',
    jsonb_build_object('organization_id', org_id, 'role', 'head'));
  perform pg_temp.create_demo_user('admin@demo.kz', 'Дана', 'Омарова', '{}',
    jsonb_build_object('organization_id', org_id, 'role', 'manager'));
  select id into head_sales_id from public.sales where email = 'head@demo.kz';
  select id into manager_sales_id from public.sales where email = 'admin@demo.kz';

  insert into public.contacts (organization_id, first_name, last_name, phone_jsonb, sales_id, first_seen, last_seen, status)
  values
    (org_id, 'Асель', 'Нурланова', '[{"number":"+77011234567","type":"Other"}]', manager_sales_id, now() - interval '10 days', now() - interval '1 day', 'hot'),
    (org_id, 'Марат', 'Ахметов', '[{"number":"+77027654321","type":"Other"}]', manager_sales_id, now() - interval '5 days', now() - interval '2 days', 'warm'),
    (org_id, 'Гульнара', 'Беккер', '[{"number":"+77071112233","type":"Other"}]', head_sales_id, now() - interval '3 days', now(), 'cold');

  insert into public.deals (organization_id, name, contact_ids, category, stage, amount, sales_id, index)
  select org_id, d.name, array[c.id], d.category, d.stage, d.amount, c.sales_id, d.idx
  from (values
    ('Асель', 'Имплантация 2 зубов', 'implantation', 'plan-agreed', 900000, 0),
    ('Марат', 'Брекеты', 'orthodontics', 'booked', 650000, 0),
    ('Гульнара', 'Профгигиена', 'hygiene', 'new-lead', 25000, 0)
  ) as d(first_name, name, category, stage, amount, idx)
  join public.contacts c on c.first_name = d.first_name and c.organization_id = org_id;

  insert into public.tasks (organization_id, contact_id, type, text, due_date, sales_id)
  select org_id, c.id, 'call', 'Перезвонить и подтвердить запись', now() + interval '1 day', c.sales_id
  from public.contacts c where c.organization_id = org_id and c.first_name in ('Асель', 'Марат');

  -- Clinic 2: its data must never show up in clinic 1
  other_owner_id := pg_temp.create_demo_user('owner@other.kz', 'Тимур', 'Жаксылыков',
    jsonb_build_object('organization_name', 'Демо-клиника «Улыбка»'));
  select organization_id into other_org_id from public.sales where user_id = other_owner_id;
  insert into public.contacts (organization_id, first_name, last_name, phone_jsonb, first_seen, last_seen)
  values (other_org_id, 'Пациент', 'Другой клиники', '[{"number":"+77009998877","type":"Other"}]', now(), now());
end;
$$;

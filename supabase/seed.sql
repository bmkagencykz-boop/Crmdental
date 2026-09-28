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
  default_pipeline_id bigint;
  owner_sales_id bigint;
  head_sales_id bigint;
  manager_sales_id bigint;
  other_owner_id uuid;
  other_org_id bigint;
begin
  -- Clinic 1: the owner signs up (the clinic gets its pipeline and dictionaries),
  -- then invites a head and an administrator
  owner_id := pg_temp.create_demo_user('owner@demo.kz', 'Айгерим', 'Садыкова',
    jsonb_build_object('organization_name', 'Демо-клиника «Жемчуг»'));
  select organization_id, id into org_id, owner_sales_id from public.sales where user_id = owner_id;
  select id into default_pipeline_id from public.pipelines where organization_id = org_id and is_default;

  perform pg_temp.create_demo_user('head@demo.kz', 'Ержан', 'Касымов', '{}',
    jsonb_build_object('organization_id', org_id, 'role', 'head'));
  perform pg_temp.create_demo_user('admin@demo.kz', 'Дана', 'Омарова', '{}',
    jsonb_build_object('organization_id', org_id, 'role', 'manager'));
  select id into head_sales_id from public.sales where email = 'head@demo.kz';
  select id into manager_sales_id from public.sales where email = 'admin@demo.kz';

  insert into public.tags (organization_id, name, color)
  values (org_id, 'VIP', '#ffe7c2'), (org_id, 'Рассрочка', '#dbe4f5'), (org_id, 'Боится боли', '#f3e2d6');

  insert into public.patients (organization_id, last_name, first_name, phone_jsonb, whatsapp, city, sales_id, first_seen, last_seen)
  select org_id, p.last_name, p.first_name,
    jsonb_build_array(jsonb_build_object('number', p.phone, 'type', 'Mobile')),
    p.phone, 'Алматы', manager_sales_id,
    now() - (p.days || ' days')::interval, now() - (p.days / 2 || ' days')::interval
  from (values
    ('Нурланова', 'Асель', '8 701 123 45 67', 12),
    ('Ахметов', 'Марат', '+7 (702) 765-43-21', 9),
    ('Беккер', 'Гульнара', '87071112233', 7),
    ('Искаков', 'Айдос', '7 777 555 12 12', 6),
    ('Ким', 'Анна', '8 705 333 22 11', 5),
    ('Сейтказин', 'Бекзат', '+77471234567', 4),
    ('Омарова', 'Мадина', '8 778 000 11 22', 3),
    ('Петров', 'Алексей', '8 700 999 88 77', 2),
    ('Жаксылыкова', 'Томирис', '8 771 222 33 44', 1),
    ('Утепов', 'Ерлан', '8 775 444 55 66', 0)
  ) as p(last_name, first_name, phone, days);

  -- Deals across the stages of the default pipeline
  insert into public.deals (organization_id, patient_id, pipeline_id, stage_id, name, source_id, service_id, plan_amount, sales_id, lost_reason_id, appointment_at, created_at)
  select org_id, pt.id, default_pipeline_id, st.id, d.name,
    (select id from public.lead_sources where organization_id = org_id and code = d.source),
    (select id from public.services where organization_id = org_id and name = d.service),
    d.amount,
    case when d.mine then manager_sales_id else head_sales_id end,
    case when st.kind = 'lost' then (select id from public.lost_reasons where organization_id = org_id and name = 'Дорого') end,
    case when d.stage = 'Записан' then now() + interval '1 day' end,
    now() - (d.days || ' days')::interval
  from (values
    ('Нурланова', 'Имплантация 2 зубов', 'instagram', 'Имплантация', 'План согласован', 900000, true, 12),
    ('Ахметов', 'Брекеты', 'whatsapp', 'Ортодонтия', 'Записан', 650000, true, 9),
    ('Беккер', 'Профгигиена', 'website', 'Гигиена', 'Новый лид', 25000, false, 7),
    ('Искаков', 'Лечение каналов', 'call', 'Терапия', 'В работе', 60000, true, 6),
    ('Ким', 'Виниры E-max, 6 шт.', 'instagram', 'Протезирование', 'Пришёл на консультацию', 1200000, false, 5),
    ('Сейтказин', 'Удаление зуба мудрости', '2gis', 'Хирургия', 'В лечении', 45000, true, 4),
    ('Омарова', 'Детский приём', 'referral', 'Детская стоматология', 'Лечение завершено', 18000, false, 3),
    ('Петров', 'All-on-4', 'whatsapp', 'Имплантация', 'Отказ', 3500000, true, 2),
    ('Жаксылыкова', 'Отбеливание', 'telegram', 'Гигиена', 'Новый лид', 40000, true, 1),
    ('Утепов', 'Коронка из диоксида циркония', 'whatsapp', 'Протезирование', 'В работе', 150000, false, 0)
  ) as d(last_name, name, source, service, stage, amount, mine, days)
  join public.patients pt on pt.organization_id = org_id and pt.last_name = d.last_name
  join public.stages st on st.pipeline_id = default_pipeline_id and st.name = d.stage;

  -- Payments on deals in treatment and finished
  insert into public.deal_payments (organization_id, deal_id, amount, paid_at, comment, sales_id)
  select org_id, d.id, p.amount, current_date - p.days, p.comment, owner_sales_id
  from (values
    ('Имплантация 2 зубов', 300000, 3, 'Предоплата'),
    ('Удаление зуба мудрости', 45000, 1, 'Kaspi'),
    ('Детский приём', 18000, 2, 'Наличные')
  ) as p(deal, amount, days, comment)
  join public.deals d on d.organization_id = org_id and d.name = p.deal;

  -- Open tasks: some overdue, some for today and later; one deal has none
  insert into public.tasks (organization_id, deal_id, type, text, due_date, sales_id)
  select org_id, d.id, t.type, t.text, now() + (t.hours || ' hours')::interval, d.sales_id
  from (values
    ('Имплантация 2 зубов', 'call', 'Перезвонить и согласовать дату операции', -20),
    ('Брекеты', 'reminder', 'Напомнить о визите за день', 18),
    ('Профгигиена', 'message', 'Написать в WhatsApp: прислать цены', -3),
    ('Лечение каналов', 'call', 'Уточнить удобное время', 4),
    ('Виниры E-max, 6 шт.', 'message', 'Отправить план лечения', 30),
    ('Удаление зуба мудрости', 'call', 'Спросить, как прошло удаление', 48)
  ) as t(deal, type, text, hours)
  join public.deals d on d.organization_id = org_id and d.name = t.deal;

  insert into public.patient_notes (organization_id, patient_id, text, sales_id)
  select org_id, p.id, 'Боится боли, рассказали про седацию. Думает.', manager_sales_id
  from public.patients p where p.organization_id = org_id and p.last_name = 'Ким';

  insert into public.calls (organization_id, patient_id, direction, duration_seconds, comment, sales_id)
  select org_id, p.id, 'in', 184, 'Спрашивала про рассрочку на имплантацию', manager_sales_id
  from public.patients p where p.organization_id = org_id and p.last_name = 'Нурланова';

  -- Custom fields (stage 19) and their values on some deals and patients
  insert into public.custom_fields (organization_id, entity, name, type, options, position, show_on_card)
  values
    (org_id, 'deal', 'Жалоба', 'textarea', '[]', 0, false),
    (org_id, 'deal', 'Откуда узнал', 'select', '["Инстаграм", "2GIS", "Рекомендация", "Реклама"]', 1, true),
    (org_id, 'deal', 'Есть снимок КТ', 'checkbox', '[]', 2, true),
    (org_id, 'patient', 'Полис ДМС', 'text', '[]', 0, false);
  update public.deals d
  set custom_values = jsonb_strip_nulls(jsonb_build_object(
    (select id::text from public.custom_fields where organization_id = org_id and name = 'Жалоба'), v.complaint,
    (select id::text from public.custom_fields where organization_id = org_id and name = 'Откуда узнал'), v.found,
    (select id::text from public.custom_fields where organization_id = org_id and name = 'Есть снимок КТ'), v.ct))
  from (values
    ('Имплантация 2 зубов', 'Нет двух зубов снизу, мешает жевать', 'Инстаграм', true),
    ('Брекеты', 'Кривые зубы, хочет ровную улыбку', 'Рекомендация', false),
    ('Лечение каналов', 'Ноет зуб по ночам', '2GIS', true),
    ('Виниры E-max, 6 шт.', 'Хочет белую улыбку к свадьбе', 'Инстаграм', null),
    ('Удаление зуба мудрости', 'Режется зуб мудрости', 'Реклама', true)
  ) as v(deal, complaint, found, ct)
  where d.organization_id = org_id and d.name = v.deal;
  update public.patients p
  set custom_values = jsonb_build_object(
    (select id::text from public.custom_fields where organization_id = org_id and name = 'Полис ДМС'), v.policy)
  from (values ('Нурланова', 'ДМС-000123'), ('Ким', 'ДМС-004517')) as v(last_name, policy)
  where p.organization_id = org_id and p.last_name = v.last_name;

  -- Clinic 2: its data must never show up in clinic 1
  other_owner_id := pg_temp.create_demo_user('owner@other.kz', 'Тимур', 'Жаксылыков',
    jsonb_build_object('organization_name', 'Демо-клиника «Улыбка»'));
  select organization_id into other_org_id from public.sales where user_id = other_owner_id;
  insert into public.patients (organization_id, last_name, first_name, phone_jsonb)
  values (other_org_id, 'Другой', 'Пациент', '[{"number":"+77009998877","type":"Mobile"}]');
end;
$$;

-- The demo clinics count as set up: they open on the dashboard, the setup
-- wizard (stage 24) stays reachable from the user menu
update public.onboarding_progress set completed_at = now() where completed_at is null;

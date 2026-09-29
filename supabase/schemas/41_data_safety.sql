--
-- Data safety (stage 41): what real clinics need before they trust the CRM
-- with money and medical records.
--
--   Patient archive   patients.archived_at / archived_by. «В архив» hides a
--                     patient from the lists, the search and the pickers
--                     (the app filters archived_at is null unless the
--                     «Архив» filter is on); the card stays readable and
--                     «Вернуть из архива» restores it. Archiving needs the
--                     patients «delete» right of stage 30 (owner and head by
--                     default, a manager only when the owner grants it);
--                     restoring: the owner or the head.
--   Hard delete       only the owner, only a patient without money, visits
--                     or medical rows (private.patient_has_history), else a
--                     clear error (hint patient_has_history). The money and
--                     medical tables reference patients ON DELETE RESTRICT
--                     (account_operations, visits, visit_records,
--                     treatment_plans, patient_teeth, patient_tooth_history,
--                     patient_questionnaires, patient_consents,
--                     patient_files, lab_orders); deal_payments and
--                     account_operations reference deals ON DELETE RESTRICT.
--                     Communications and automation rows (notes, calls,
--                     messages, chats, notifications, recalls, mailings,
--                     lead submissions, deal files, the waiting list, the
--                     MIS appointments) still follow the patient.
--                     private.delete_organization_data removes the
--                     protected rows first when a whole clinic is deleted.
--   Deals             a deal with payments or ledger rows is not deleted
--                     (hint deal_has_payments): archive it.
--   Closed shifts     an account operation of a closed cash shift is
--                     neither changed nor cancelled (hint shift_closed): the
--                     owner writes a correction instead. Re-linking an
--                     operation (patients or deals merged, a plan, visit or
--                     branch removed) still works; a cascade (a clinic
--                     deleted) too.
--   Medical data      IIN, allergies, contraindications and chronic
--                     diseases live in public.patient_medical, whose rows
--                     the integrator never reads. The columns of the same
--                     names on patients stay as the write path (the form,
--                     the imports, the tests write them): a trigger moves
--                     every value given into patient_medical and stores
--                     null on patients. patients_summary reads them back
--                     from patient_medical.
--   IIN               unique per clinic (a partial unique index); IINs that
--                     were already duplicated keep iin_duplicate = true and
--                     show up as duplicates to merge (reason «iin»).
--   Card numbers      a new patient without a card number gets the next
--                     number of the clinic (patient_card_counters); the
--                     existing patients keep the number the card showed
--                     (their CRM id).
--   Retention         private.retention_tick() (pg_cron, daily) purges old
--                     technical rows; the audit log, money and medical data
--                     are never purged.
--

--
-- Patient archive
--

alter table public.patients add column archived_at timestamp with time zone;
alter table public.patients add column archived_by bigint;

alter table public.patients
    add constraint patients_archived_by_fkey foreign key (organization_id, archived_by) references public.sales(organization_id, id) on delete set null (archived_by);

create index patients_archived_at_idx on public.patients using btree (organization_id, archived_at) where archived_at is not null;

-- «В архив» and «Вернуть из архива»: the rights, who and when
CREATE OR REPLACE FUNCTION "private"."handle_patient_archive"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  role text := private.current_user_role();
  me bigint := private.current_sales_id();
  scope text;
begin
  if new.archived_at is not distinct from old.archived_at then
    new.archived_by := old.archived_by;
    return new;
  end if;
  if old.archived_at is not null and new.archived_at is not null then
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
    return new;
  end if;
  if new.archived_at is not null then
    if role is not null then
      scope := private.access_scope('patients', 'delete');
      if scope = 'all' or (scope = 'own' and (old.sales_id = me or exists (
        select 1 from public.deals d
        where d.organization_id = old.organization_id and d.patient_id = old.id and d.sales_id = me))) then
        null;
      else
        raise exception 'Нет права переместить пациента в архив' using errcode = '42501', hint = 'patient_archive_forbidden';
      end if;
    end if;
    new.archived_at := now();
    new.archived_by := me;
  else
    if role is not null and role not in ('owner', 'head') then
      raise exception 'Вернуть пациента из архива могут владелец или руководитель' using errcode = '42501', hint = 'patient_restore_forbidden';
    end if;
    new.archived_by := null;
  end if;
  return new;
end;
$$;

-- Money, visits or medical rows of a patient: such a patient is archived,
-- never deleted
CREATE OR REPLACE FUNCTION "private"."patient_has_history"("org_id" bigint, "target_patient_id" bigint) RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  return exists (select 1 from public.account_operations o where o.organization_id = org_id and o.patient_id = target_patient_id)
    or exists (select 1 from public.deal_payments dp join public.deals d on d.organization_id = dp.organization_id and d.id = dp.deal_id
               where d.organization_id = org_id and d.patient_id = target_patient_id)
    or exists (select 1 from public.visits v where v.organization_id = org_id and v.patient_id = target_patient_id)
    or exists (select 1 from public.visit_records r where r.organization_id = org_id and r.patient_id = target_patient_id)
    or exists (select 1 from public.treatment_plans tp where tp.organization_id = org_id and tp.patient_id = target_patient_id)
    or exists (select 1 from public.patient_teeth t where t.organization_id = org_id and t.patient_id = target_patient_id)
    or exists (select 1 from public.patient_tooth_history h where h.organization_id = org_id and h.patient_id = target_patient_id)
    or exists (select 1 from public.patient_questionnaires q where q.organization_id = org_id and q.patient_id = target_patient_id)
    or exists (select 1 from public.patient_consents c where c.organization_id = org_id and c.patient_id = target_patient_id)
    or exists (select 1 from public.patient_files f where f.organization_id = org_id and f.patient_id = target_patient_id)
    or exists (select 1 from public.lab_orders l where l.organization_id = org_id and l.patient_id = target_patient_id);
end;
$$;

-- Deleting a patient: the owner only, a patient without history only. A
-- cascade (a clinic deleted) passes; a merge (crm.patient_merge, the rows
-- moved first) needs no owner.
CREATE OR REPLACE FUNCTION "private"."handle_patient_before_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  role text := private.current_user_role();
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  -- Patients merged (stage 18): whoever may merge, once the rows moved
  if role is not null and role <> 'owner' and coalesce(current_setting('crm.patient_merge', true), '') <> 'on' then
    raise exception 'Удалить пациента насовсем может только владелец. Переместите пациента в архив'
      using errcode = '42501', hint = 'patient_delete_owner_only';
  end if;
  if private.patient_has_history(old.organization_id, old.id) then
    raise exception 'У пациента есть оплаты, визиты или медицинские записи — удалить его нельзя. Переместите пациента в архив'
      using errcode = '23503', hint = 'patient_has_history';
  end if;
  return old;
end;
$$;

-- Deleting a deal with payments or ledger rows is refused (archive it). A
-- cascade (a patient without history, a clinic) passes.
CREATE OR REPLACE FUNCTION "private"."handle_deal_before_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  if exists (select 1 from public.deal_payments p where p.organization_id = old.organization_id and p.deal_id = old.id)
    or exists (select 1 from public.account_operations o where o.organization_id = old.organization_id and o.deal_id = old.id) then
    raise exception 'По сделке есть оплаты — удалить её нельзя. Переместите сделку в архив'
      using errcode = '23503', hint = 'deal_has_payments';
  end if;
  return old;
end;
$$;

--
-- Closed cash shifts
--

-- An operation of a closed shift stays as it was counted. Re-linking
-- (patient, deal, plan, visit, branch: merges and set-null cascades) passes,
-- and so does a cascade (a clinic deleted) unless it comes from a deal
-- payment changed or deleted directly (crm.ledger_sync = 'deal').
CREATE OR REPLACE FUNCTION "private"."handle_account_operation_shift_lock"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  sync text := coalesce(current_setting('crm.ledger_sync', true), '');
  links text[] := array['patient_id', 'deal_id', 'plan_id', 'visit_id', 'branch_id'];
begin
  if old.shift_id is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - links) = (to_jsonb(old) - links) then
    return new;
  end if;
  if pg_trigger_depth() > 1 and sync <> 'deal' then
    return coalesce(new, old);
  end if;
  if exists (
    select 1 from public.cash_shifts s
    where s.organization_id = old.organization_id and s.id = old.shift_id and s.closed_at is not null
  ) then
    raise exception 'Смена закрыта: операцию нельзя изменить или отменить. Проведите корректировку'
      using errcode = '22023', hint = 'shift_closed';
  end if;
  return coalesce(new, old);
end;
$$;

--
-- Medical data out of the integrator's reach
--

create table public.patient_medical (
    patient_id bigint not null primary key,
    organization_id bigint not null default private.current_organization_id(),
    iin text,
    -- An IIN shared with another patient before stage 41 (merge them)
    iin_duplicate boolean not null default false,
    allergies text,
    contraindications text,
    chronic_diseases text,
    updated_at timestamp with time zone not null default now(),
    updated_by bigint,
    constraint patient_medical_iin_check check (iin is null or private.iin_valid(iin))
);

alter table public.patient_medical add constraint patient_medical_organization_id_patient_id_key unique (organization_id, patient_id);
alter table public.patient_medical
    add constraint patient_medical_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade;
-- Deferred: the row is written by the patient's BEFORE INSERT trigger
alter table public.patient_medical
    add constraint patient_medical_patient_id_fkey foreign key (organization_id, patient_id) references public.patients(organization_id, id) on delete cascade deferrable initially deferred;
alter table public.patient_medical
    add constraint patient_medical_updated_by_fkey foreign key (organization_id, updated_by) references public.sales(organization_id, id) on delete set null (updated_by);

create unique index patient_medical_iin_key on public.patient_medical using btree (organization_id, iin) where iin is not null and not iin_duplicate;
create index patient_medical_iin_idx on public.patient_medical using btree (organization_id, iin) where iin is not null;

-- Writes the given fields ({ iin, allergies, contraindications,
-- chronic_diseases }, only the keys present) of a patient's medical data.
-- The IIN is checked (hint patient_iin_invalid) and unique in the clinic
-- (hint patient_iin_duplicate).
CREATE OR REPLACE FUNCTION "private"."save_patient_medical"("org_id" bigint, "target_patient_id" bigint, "given" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  new_iin text := nullif(regexp_replace(coalesce(given ->> 'iin', ''), '[\s-]', '', 'g'), '');
begin
  -- The same IIN written again (a whole form saved) is not checked again
  if given ? 'iin' and new_iin is not null and new_iin is distinct from (
    select m.iin from public.patient_medical m where m.patient_id = target_patient_id) then
    if not private.iin_valid(new_iin) then
      raise exception 'Неверный ИИН: 12 цифр с контрольной суммой' using errcode = '22023', hint = 'patient_iin_invalid';
    end if;
    if exists (
      select 1 from public.patient_medical m
      where m.organization_id = org_id and m.iin = new_iin and m.patient_id <> target_patient_id and not m.iin_duplicate
    ) then
      raise exception 'Пациент с ИИН % уже есть в клинике', new_iin using errcode = '23505', hint = 'patient_iin_duplicate';
    end if;
  end if;
  insert into public.patient_medical as m (organization_id, patient_id, iin, allergies, contraindications, chronic_diseases, updated_by)
  values (org_id, target_patient_id, new_iin, given ->> 'allergies', given ->> 'contraindications',
    given ->> 'chronic_diseases', private.current_sales_id())
  on conflict (patient_id) do update
  set iin = case when given ? 'iin' then excluded.iin else m.iin end,
      iin_duplicate = case when given ? 'iin' and excluded.iin is distinct from m.iin then false else m.iin_duplicate end,
      allergies = case when given ? 'allergies' then excluded.allergies else m.allergies end,
      contraindications = case when given ? 'contraindications' then excluded.contraindications else m.contraindications end,
      chronic_diseases = case when given ? 'chronic_diseases' then excluded.chronic_diseases else m.chronic_diseases end,
      updated_at = now(),
      updated_by = excluded.updated_by;
end;
$$;

-- The medical columns of patients are a write path: the values given go to
-- patient_medical, the patients row keeps null. One trigger per column on
-- update (a column in the SET list is given, even when cleared).
CREATE OR REPLACE FUNCTION "private"."handle_patient_medical_transit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  fields text[] := case when tg_op = 'INSERT'
    then array['iin', 'allergies', 'contraindications', 'chronic_diseases'] else array[tg_argv[0]] end;
  row_data jsonb := to_jsonb(new);
  given jsonb := '{}'::jsonb;
  cleared jsonb := '{}'::jsonb;
  field text;
begin
  foreach field in array fields loop
    given := given || jsonb_build_object(field, row_data -> field);
    cleared := cleared || jsonb_build_object(field, null);
  end loop;
  if tg_op = 'INSERT' and not exists (select 1 from jsonb_each(given) e where e.value <> 'null'::jsonb) then
    return new;
  end if;
  perform private.save_patient_medical(new.organization_id, new.id, given);
  new := jsonb_populate_record(new, cleared);
  return new;
end;
$$;

--
-- Card numbers
--

create table public.patient_card_counters (
    organization_id bigint not null primary key,
    last_number bigint not null default 0
);

alter table public.patient_card_counters
    add constraint patient_card_counters_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade;

-- The next free card number of a clinic
CREATE OR REPLACE FUNCTION "private"."next_card_number"("org_id" bigint) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  next_number bigint;
begin
  insert into public.patient_card_counters (organization_id, last_number)
  values (org_id, 0)
  on conflict (organization_id) do nothing;
  loop
    update public.patient_card_counters c
    set last_number = c.last_number + 1
    where c.organization_id = org_id
    returning c.last_number into next_number;
    exit when not exists (
      select 1 from public.patients p where p.organization_id = org_id and p.card_number = next_number::text);
  end loop;
  return next_number::text;
end;
$$;

CREATE OR REPLACE FUNCTION "private"."handle_patient_card_number"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if new.organization_id is not null and nullif(btrim(coalesce(new.card_number, '')), '') is null then
    new.card_number := private.next_card_number(new.organization_id);
  end if;
  return new;
end;
$$;

--
-- Retention
--

-- Purges the old technical rows, daily (pg_cron «retention-daily»). Periods:
--   webhook_deliveries   90 days, delivered / failed / cancelled
--   mis_sync_log         90 days
--   mis_outbox           90 days, done / failed / cancelled
--   notifications        90 days after being read
--   salesbot_logs        180 days
--   stage_trigger_runs   180 days, when the deal is no longer in the
--                        trigger's stage (a run marks «done once»)
--   lead_submissions     365 days (the dedupe window is minutes)
--   net._http_response   7 days (pg_net responses), when accessible
-- Never: audit_log, money, medical data, messages. At most 50 000 rows per
-- table and run. Returns the rows purged per table.
CREATE OR REPLACE FUNCTION "private"."retention_tick"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  batch constant integer := 50000;
  technical_days constant integer := 90;
  log_days constant integer := 180;
  lead_days constant integer := 365;
  http_days constant integer := 7;
  purged jsonb := '{}'::jsonb;
  n bigint;
begin
  delete from public.webhook_deliveries w
  where w.id in (
    select x.id from public.webhook_deliveries x
    where x.status in ('delivered', 'failed', 'cancelled') and x.created_at < now() - make_interval(days => technical_days)
    limit batch);
  get diagnostics n = row_count;
  purged := purged || jsonb_build_object('webhook_deliveries', n);

  delete from public.mis_sync_log l
  where l.id in (
    select x.id from public.mis_sync_log x
    where x.created_at < now() - make_interval(days => technical_days)
    limit batch);
  get diagnostics n = row_count;
  purged := purged || jsonb_build_object('mis_sync_log', n);

  delete from public.mis_outbox o
  where o.id in (
    select x.id from public.mis_outbox x
    where x.status in ('done', 'failed', 'cancelled') and x.created_at < now() - make_interval(days => technical_days)
    limit batch);
  get diagnostics n = row_count;
  purged := purged || jsonb_build_object('mis_outbox', n);

  delete from public.notifications nt
  where nt.id in (
    select x.id from public.notifications x
    where x.read_at is not null and x.read_at < now() - make_interval(days => technical_days)
    limit batch);
  get diagnostics n = row_count;
  purged := purged || jsonb_build_object('notifications', n);

  delete from public.salesbot_logs l
  where l.id in (
    select x.id from public.salesbot_logs x
    where x.created_at < now() - make_interval(days => log_days)
    limit batch);
  get diagnostics n = row_count;
  purged := purged || jsonb_build_object('salesbot_logs', n);

  delete from public.stage_trigger_runs r
  where r.id in (
    select x.id from public.stage_trigger_runs x
    where x.created_at < now() - make_interval(days => log_days)
      and not exists (
        select 1 from public.stage_triggers t
          join public.deals d on d.organization_id = t.organization_id and d.stage_id = t.stage_id
        where t.id = x.trigger_id and d.id = x.deal_id and d.archived_at is null)
    limit batch);
  get diagnostics n = row_count;
  purged := purged || jsonb_build_object('stage_trigger_runs', n);

  delete from public.lead_submissions s
  where s.id in (
    select x.id from public.lead_submissions x
    where x.created_at < now() - make_interval(days => lead_days)
    limit batch);
  get diagnostics n = row_count;
  purged := purged || jsonb_build_object('lead_submissions', n);

  if to_regclass('net._http_response') is not null then
    begin
      execute format('delete from net._http_response where created < now() - interval %L', http_days || ' days');
      get diagnostics n = row_count;
      purged := purged || jsonb_build_object('http_responses', n);
    exception when others then
      purged := purged || jsonb_build_object('http_responses', null);
    end;
  end if;
  return purged;
end;
$$;

--
-- Views
--

-- patients_summary (19, 29, 37) with the medical data from patient_medical
-- (null for the integrator) and the archive at the end
create or replace view public.patients_summary with (security_invoker = on) as
select
    p.id,
    p.organization_id,
    p.first_name,
    p.last_name,
    p.middle_name,
    p.phone_jsonb,
    p.phones,
    p.birth_date,
    p.city,
    p.whatsapp,
    p.instagram,
    p.telegram,
    p.source_id,
    p.tags,
    p.sales_id,
    p.gender,
    p.avatar,
    p.background,
    p.status,
    p.first_seen,
    p.last_seen,
    array_to_string(p.phones, ' ') as phone_fts,
    (
        select count(*)
        from public.deals d
        where d.organization_id = p.organization_id and d.patient_id = p.id
    ) as nb_deals,
    (
        select count(*)
        from public.deals d
            join public.stages s on s.id = d.stage_id
        where d.organization_id = p.organization_id and d.patient_id = p.id and s.kind = 'open'
    ) as nb_open_deals,
    (
        select count(*)
        from public.tasks t
            join public.deals d on d.organization_id = t.organization_id and d.id = t.deal_id
        where d.organization_id = p.organization_id and d.patient_id = p.id and t.done_date is null
    ) as nb_tasks,
    p.custom_values,
    m.allergies,
    m.contraindications,
    m.chronic_diseases,
    p.preferred_doctor_id,
    m.iin,
    p.card_number,
    p.archived_at,
    p.archived_by
from public.patients p
    left join public.patient_medical m on m.organization_id = p.organization_id and m.patient_id = p.id;

--
-- Indexes of hot paths
--

-- «История» of the patient card: the messages of a patient by date
create index messages_patient_id_idx on public.messages using btree (organization_id, patient_id, sent_at desc);
-- Foreign keys set to null when a visit or a deal is deleted
create index account_operations_visit_id_idx on public.account_operations using btree (organization_id, visit_id) where visit_id is not null;
create index lab_orders_deal_id_idx on public.lab_orders using btree (organization_id, deal_id) where deal_id is not null;

--
-- Triggers
--

create or replace trigger patient_archive
    before update of archived_at, archived_by on public.patients
    for each row execute function private.handle_patient_archive();

create or replace trigger patient_before_delete
    before delete on public.patients
    for each row execute function private.handle_patient_before_delete();

create or replace trigger deal_before_delete
    before delete on public.deals
    for each row execute function private.handle_deal_before_delete();

create or replace trigger account_operation_shift_lock
    before update or delete on public.account_operations
    for each row execute function private.handle_account_operation_shift_lock();

-- After patient_iin (37), which checks the IIN and fills the birth date
create or replace trigger patient_medical_insert
    before insert on public.patients
    for each row execute function private.handle_patient_medical_transit();

create or replace trigger patient_medical_iin
    before update of iin on public.patients
    for each row execute function private.handle_patient_medical_transit('iin');

create or replace trigger patient_medical_allergies
    before update of allergies on public.patients
    for each row execute function private.handle_patient_medical_transit('allergies');

create or replace trigger patient_medical_contraindications
    before update of contraindications on public.patients
    for each row execute function private.handle_patient_medical_transit('contraindications');

create or replace trigger patient_medical_chronic_diseases
    before update of chronic_diseases on public.patients
    for each row execute function private.handle_patient_medical_transit('chronic_diseases');

create or replace trigger assign_patient_card_number
    before insert on public.patients
    for each row execute function private.handle_patient_card_number();

-- Audit log (group «Пациенты»): the medical data of the patient
create or replace trigger audit_patient_medical_data
    after insert or update or delete on public.patient_medical
    for each row execute function private.audit_row('patient', 'iin,allergies,contraindications,chronic_diseases');

--
-- Row Level Security
--

alter table public.patient_medical enable row level security;
alter table public.patient_card_counters enable row level security;

-- Whoever sees the patient, never the integrator; written through patients
create policy "Medical data of visible patients can be read" on public.patient_medical for select to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head', 'manager')
        and exists (select 1 from public.patients p where p.organization_id = patient_medical.organization_id and p.id = patient_medical.patient_id));

--
-- Storage: note attachments, avatars and logos in a private bucket (read
-- through signed links, the policies of 07_storage.sql)
--

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do update set public = false;

--
-- Grants
--

revoke all on table public.patient_medical from anon, authenticated;
grant select on table public.patient_medical to authenticated;
grant all on table public.patient_medical to service_role;

revoke all on table public.patient_card_counters from anon, authenticated;
grant all on table public.patient_card_counters to service_role;

revoke all on function private.handle_patient_archive() from public;
revoke all on function private.patient_has_history(bigint, bigint) from public;
grant execute on function private.patient_has_history(bigint, bigint) to service_role;
revoke all on function private.handle_patient_before_delete() from public;
revoke all on function private.handle_deal_before_delete() from public;
revoke all on function private.handle_account_operation_shift_lock() from public;
revoke all on function private.save_patient_medical(bigint, bigint, jsonb) from public;
grant execute on function private.save_patient_medical(bigint, bigint, jsonb) to service_role;
revoke all on function private.handle_patient_medical_transit() from public;
revoke all on function private.next_card_number(bigint) from public;
grant execute on function private.next_card_number(bigint) to service_role;
revoke all on function private.handle_patient_card_number() from public;
revoke all on function private.retention_tick() from public;
grant execute on function private.retention_tick() to service_role;

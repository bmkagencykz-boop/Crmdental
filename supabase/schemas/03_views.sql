--
-- Views
-- This file declares all views in the public schema.
-- All views are security_invoker: the RLS policies of the underlying tables apply.
--

create or replace view public.activity_log with (security_invoker = on) as
select
    ('patient.' || p.id || '.created') as id,
    'patient.created' as type,
    p.first_seen as date,
    p.id as patient_id,
    p.sales_id,
    to_json(p.*) as patient,
    null::json as deal,
    null::json as patient_note,
    null::json as deal_note
from public.patients p
union all
select
    ('patientNote.' || n.id || '.created') as id,
    'patientNote.created' as type,
    n.date,
    n.patient_id,
    n.sales_id,
    null::json as patient,
    null::json as deal,
    to_json(n.*) as patient_note,
    null::json as deal_note
from public.patient_notes n
union all
select
    ('deal.' || d.id || '.created') as id,
    'deal.created' as type,
    d.created_at as date,
    d.patient_id,
    d.sales_id,
    null::json as patient,
    to_json(d.*) as deal,
    null::json as patient_note,
    null::json as deal_note
from public.deals d
union all
select
    ('dealNote.' || n.id || '.created') as id,
    'dealNote.created' as type,
    n.date,
    d.patient_id,
    n.sales_id,
    null::json as patient,
    null::json as deal,
    null::json as patient_note,
    to_json(n.*) as deal_note
from public.deal_notes n
    join public.deals d on d.organization_id = n.organization_id and d.id = n.deal_id;

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
    ) as nb_tasks
from public.patients p;

-- public.deals_summary (deals with what the board and the lists display) is
-- declared in 13_doctors.sql: it shows the doctor of the deal, and the
-- doctors table and the deal columns of stage 13 are declared there.

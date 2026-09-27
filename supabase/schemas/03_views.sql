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

-- public.patients_summary and public.deals_summary (deals with what the board
-- and the lists display) are declared in 19_custom_fields.sql: they show the
-- custom field values, and the columns of stage 19 (and the doctors of stage
-- 13) are declared in later files.

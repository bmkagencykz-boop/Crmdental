--
-- Row Level Security
-- This file declares RLS policies for all tables.
--
-- Tenant isolation: a user only ever sees and writes rows whose organization_id
-- is their own organization (private.current_organization_id()). Helpers are
-- wrapped in sub-selects so Postgres evaluates them once per statement.
--
-- Deals, patients and tasks follow the access rights of the employee (stage
-- 30, private.access_scope): per action a scope — all, their branches
-- («Мой филиал», stage 33: their own, those of the branches they work in and
-- those without a branch; deals and tasks), their own, their own and the
-- unassigned ones (deals), or none. The defaults are the rules of the
-- roles: owners and heads everything; managers see the deals the clinic
-- setting allows (all, their own, their own and unassigned), all patients
-- and tasks, and delete no deal. Rows that belong to a deal (notes, tasks,
-- payments, log, messages...) follow the deal's visibility through the
-- deals policy; notes and calls of a patient follow the patient's.
--

alter table public.organizations enable row level security;
alter table public.organization_settings enable row level security;
alter table public.sales enable row level security;
alter table public.configuration enable row level security;
alter table public.pipelines enable row level security;
alter table public.stages enable row level security;
alter table public.services enable row level security;
alter table public.lead_sources enable row level security;
alter table public.lost_reasons enable row level security;
alter table public.tags enable row level security;
alter table public.patients enable row level security;
alter table public.patient_notes enable row level security;
alter table public.deals enable row level security;
alter table public.deal_notes enable row level security;
alter table public.deal_payments enable row level security;
alter table public.deal_events enable row level security;
alter table public.tasks enable row level security;
alter table public.calls enable row level security;
alter table public.messenger_integrations enable row level security;
alter table public.messenger_channels enable row level security;
alter table public.patient_chats enable row level security;
alter table public.messages enable row level security;
alter table public.task_rules enable row level security;
alter table public.stage_checklist_items enable row level security;
alter table public.deal_checklist_checks enable row level security;

-- Organizations: members read their clinic, only the owner edits it
create policy "Organization members can read" on public.organizations for select to authenticated
    using (id = (select private.current_organization_id()));
create policy "Owner can update" on public.organizations for update to authenticated
    using (id = (select private.current_organization_id()) and (select private.current_user_role()) = 'owner')
    with check (id = (select private.current_organization_id()));

-- Organization settings: members read, owner and head edit
create policy "Organization members can read" on public.organization_settings for select to authenticated
    using (organization_id = (select private.current_organization_id()));
create policy "Owner and head can update" on public.organization_settings for update to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'))
    with check (organization_id = (select private.current_organization_id()));

-- Sales: members see their colleagues; writes go through the users edge function
create policy "Organization members can read" on public.sales for select to authenticated
    using (organization_id = (select private.current_organization_id()));

-- Configuration: members read, owner and head edit (the row is created with the organization)
create policy "Organization members can read" on public.configuration for select to authenticated
    using (organization_id = (select private.current_organization_id()));
create policy "Owner and head can update" on public.configuration for update to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'))
    with check (organization_id = (select private.current_organization_id()));

-- Dictionaries: members read, owner and head manage
create policy "Organization members can read" on public.pipelines for select to authenticated
    using (organization_id = (select private.current_organization_id()));
create policy "Owner and head can insert" on public.pipelines for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'));
create policy "Owner and head can update" on public.pipelines for update to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'))
    with check (organization_id = (select private.current_organization_id()));
create policy "Owner and head can delete" on public.pipelines for delete to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'));

create policy "Organization members can read" on public.stages for select to authenticated
    using (organization_id = (select private.current_organization_id()));
create policy "Owner and head can insert" on public.stages for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'));
create policy "Owner and head can update" on public.stages for update to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'))
    with check (organization_id = (select private.current_organization_id()));
create policy "Owner and head can delete" on public.stages for delete to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'));

create policy "Organization members can read" on public.services for select to authenticated
    using (organization_id = (select private.current_organization_id()));
create policy "Owner and head can insert" on public.services for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'));
create policy "Owner and head can update" on public.services for update to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'))
    with check (organization_id = (select private.current_organization_id()));
create policy "Owner and head can delete" on public.services for delete to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'));

-- Lead sources: system sources (used by integrations) are never created or deleted by users
create policy "Organization members can read" on public.lead_sources for select to authenticated
    using (organization_id = (select private.current_organization_id()));
create policy "Owner and head can insert" on public.lead_sources for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head') and not is_system and code is null);
create policy "Owner and head can update" on public.lead_sources for update to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'))
    with check (organization_id = (select private.current_organization_id()));
create policy "Owner and head can delete" on public.lead_sources for delete to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head') and not is_system);

create policy "Organization members can read" on public.lost_reasons for select to authenticated
    using (organization_id = (select private.current_organization_id()));
create policy "Owner and head can insert" on public.lost_reasons for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'));
create policy "Owner and head can update" on public.lost_reasons for update to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'))
    with check (organization_id = (select private.current_organization_id()));
create policy "Owner and head can delete" on public.lost_reasons for delete to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'));

-- Tags: every member can manage them
create policy "Organization members can read" on public.tags for select to authenticated
    using (organization_id = (select private.current_organization_id()));
create policy "Organization members can insert" on public.tags for insert to authenticated
    with check (organization_id = (select private.current_organization_id()));
create policy "Organization members can update" on public.tags for update to authenticated
    using (organization_id = (select private.current_organization_id()))
    with check (organization_id = (select private.current_organization_id()));
create policy "Organization members can delete" on public.tags for delete to authenticated
    using (organization_id = (select private.current_organization_id()));

-- Patients: by default shared by the whole clinic (search by phone before
-- creating a deal). «Own» patients: the employee is responsible for the
-- patient or for one of their deals. The patient of a visible deal is always
-- visible (the board and the deal card show them).
create policy "Patients in the view scope can be read" on public.patients for select to authenticated
    using (
        organization_id = (select private.current_organization_id())
        and (
            (select private.access_scope('patients', 'view')) = 'all'
            or ((select private.access_scope('patients', 'view')) = 'own' and (
                sales_id = (select private.current_sales_id())
                or exists (select 1 from public.deals d where d.organization_id = patients.organization_id and d.patient_id = patients.id and d.sales_id = (select private.current_sales_id()))))
            or exists (select 1 from public.deals d where d.organization_id = patients.organization_id and d.patient_id = patients.id)
        )
    );
create policy "Employees with the create right can insert" on public.patients for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and (select private.access_scope('patients', 'create')) = 'all');
create policy "Patients in the edit scope can be updated" on public.patients for update to authenticated
    using (
        organization_id = (select private.current_organization_id())
        and (
            (select private.access_scope('patients', 'edit')) = 'all'
            or ((select private.access_scope('patients', 'edit')) = 'own' and (
                sales_id = (select private.current_sales_id())
                or exists (select 1 from public.deals d where d.organization_id = patients.organization_id and d.patient_id = patients.id and d.sales_id = (select private.current_sales_id()))))
        )
    )
    with check (organization_id = (select private.current_organization_id()));
create policy "Patients in the delete scope can be deleted" on public.patients for delete to authenticated
    using (
        organization_id = (select private.current_organization_id())
        and (
            (select private.access_scope('patients', 'delete')) = 'all'
            or ((select private.access_scope('patients', 'delete')) = 'own' and (
                sales_id = (select private.current_sales_id())
                or exists (select 1 from public.deals d where d.organization_id = patients.organization_id and d.patient_id = patients.id and d.sales_id = (select private.current_sales_id()))))
        )
    );

-- Notes of a patient: visible when the patient is (the sub-query applies the patients policy)
create policy "Rows of visible patients can be read" on public.patient_notes for select to authenticated
    using (organization_id = (select private.current_organization_id()) and exists (select 1 from public.patients p where p.organization_id = patient_notes.organization_id and p.id = patient_notes.patient_id));
create policy "Rows of visible patients can be inserted" on public.patient_notes for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and exists (select 1 from public.patients p where p.organization_id = patient_notes.organization_id and p.id = patient_notes.patient_id));
create policy "Rows of visible patients can be updated" on public.patient_notes for update to authenticated
    using (organization_id = (select private.current_organization_id()) and exists (select 1 from public.patients p where p.organization_id = patient_notes.organization_id and p.id = patient_notes.patient_id))
    with check (organization_id = (select private.current_organization_id()));
create policy "Rows of visible patients can be deleted" on public.patient_notes for delete to authenticated
    using (organization_id = (select private.current_organization_id()) and exists (select 1 from public.patients p where p.organization_id = patient_notes.organization_id and p.id = patient_notes.patient_id));

-- Deals: the view, edit and delete scopes of the employee (a manager's
-- default view and edit scope is the clinic setting manager_deal_visibility).
-- private.deal_visible() is the same view rule for SECURITY DEFINER code.
-- The select, update and delete policies are declared in 33_branches.sql:
-- the scope «Мой филиал» reads deals.branch_id, added there (stage 33).
create policy "Employees with the create right can insert" on public.deals for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and (select private.access_scope('deals', 'create')) = 'all');

-- Rows of a deal: visible when the deal is (the sub-query applies the deals policy)
create policy "Rows of visible deals can be read" on public.deal_notes for select to authenticated
    using (organization_id = (select private.current_organization_id()) and exists (select 1 from public.deals d where d.organization_id = deal_notes.organization_id and d.id = deal_notes.deal_id));
create policy "Rows of visible deals can be inserted" on public.deal_notes for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and exists (select 1 from public.deals d where d.organization_id = deal_notes.organization_id and d.id = deal_notes.deal_id));
create policy "Rows of visible deals can be updated" on public.deal_notes for update to authenticated
    using (organization_id = (select private.current_organization_id()) and exists (select 1 from public.deals d where d.organization_id = deal_notes.organization_id and d.id = deal_notes.deal_id))
    with check (organization_id = (select private.current_organization_id()));
create policy "Rows of visible deals can be deleted" on public.deal_notes for delete to authenticated
    using (organization_id = (select private.current_organization_id()) and exists (select 1 from public.deals d where d.organization_id = deal_notes.organization_id and d.id = deal_notes.deal_id));

create policy "Rows of visible deals can be read" on public.deal_payments for select to authenticated
    using (organization_id = (select private.current_organization_id()) and exists (select 1 from public.deals d where d.organization_id = deal_payments.organization_id and d.id = deal_payments.deal_id));
create policy "Rows of visible deals can be inserted" on public.deal_payments for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and exists (select 1 from public.deals d where d.organization_id = deal_payments.organization_id and d.id = deal_payments.deal_id));
create policy "Rows of visible deals can be updated" on public.deal_payments for update to authenticated
    using (organization_id = (select private.current_organization_id()) and exists (select 1 from public.deals d where d.organization_id = deal_payments.organization_id and d.id = deal_payments.deal_id))
    with check (organization_id = (select private.current_organization_id()));
create policy "Rows of visible deals can be deleted" on public.deal_payments for delete to authenticated
    using (organization_id = (select private.current_organization_id()) and exists (select 1 from public.deals d where d.organization_id = deal_payments.organization_id and d.id = deal_payments.deal_id));

-- Deal log: read-only, written by triggers
create policy "Rows of visible deals can be read" on public.deal_events for select to authenticated
    using (organization_id = (select private.current_organization_id()) and exists (select 1 from public.deals d where d.organization_id = deal_events.organization_id and d.id = deal_events.deal_id));

-- Tasks: of visible deals, within the scope of the action («own»: the
-- employee is the one who does the task). The select, update and delete
-- policies are declared in 33_branches.sql (tasks.branch_id, stage 33).
create policy "Tasks of visible deals can be inserted" on public.tasks for insert to authenticated
    with check (
        organization_id = (select private.current_organization_id())
        and (select private.access_scope('tasks', 'create')) = 'all'
        and exists (select 1 from public.deals d where d.organization_id = tasks.organization_id and d.id = tasks.deal_id)
    );

-- Calls: shared by the clinic, like patients; read when the patient is visible
create policy "Calls of visible patients can be read" on public.calls for select to authenticated
    using (organization_id = (select private.current_organization_id()) and exists (select 1 from public.patients p where p.organization_id = calls.organization_id and p.id = calls.patient_id));
create policy "Organization members can insert" on public.calls for insert to authenticated
    with check (organization_id = (select private.current_organization_id()));
create policy "Organization members can update" on public.calls for update to authenticated
    using (organization_id = (select private.current_organization_id()))
    with check (organization_id = (select private.current_organization_id()));
create policy "Organization members can delete" on public.calls for delete to authenticated
    using (organization_id = (select private.current_organization_id()));

-- Messengers. messenger_integrations has no policy at all: its API key is
-- only read by the edge functions (service role).
create policy "Organization members can read" on public.messenger_channels for select to authenticated
    using (organization_id = (select private.current_organization_id()));
create policy "Organization members can read" on public.patient_chats for select to authenticated
    using (organization_id = (select private.current_organization_id()));
create policy "Rows of visible deals can be read" on public.messages for select to authenticated
    using (organization_id = (select private.current_organization_id()) and exists (select 1 from public.deals d where d.organization_id = messages.organization_id and d.id = messages.deal_id));
-- Only read_at is updatable (column grant): opening a conversation
create policy "Rows of visible deals can be updated" on public.messages for update to authenticated
    using (organization_id = (select private.current_organization_id()) and exists (select 1 from public.deals d where d.organization_id = messages.organization_id and d.id = messages.deal_id))
    with check (organization_id = (select private.current_organization_id()));

-- Automations: rules and checklists are settings (owner and head); checks
-- follow the deal
create policy "Organization members can read" on public.task_rules for select to authenticated
    using (organization_id = (select private.current_organization_id()));
create policy "Owner and head can insert" on public.task_rules for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'));
create policy "Owner and head can update" on public.task_rules for update to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'))
    with check (organization_id = (select private.current_organization_id()));
create policy "Owner and head can delete" on public.task_rules for delete to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'));
create policy "Organization members can read" on public.stage_checklist_items for select to authenticated
    using (organization_id = (select private.current_organization_id()));
create policy "Owner and head can insert" on public.stage_checklist_items for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'));
create policy "Owner and head can update" on public.stage_checklist_items for update to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'))
    with check (organization_id = (select private.current_organization_id()));
create policy "Owner and head can delete" on public.stage_checklist_items for delete to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'));
create policy "Rows of visible deals can be read" on public.deal_checklist_checks for select to authenticated
    using (organization_id = (select private.current_organization_id()) and exists (select 1 from public.deals d where d.organization_id = deal_checklist_checks.organization_id and d.id = deal_checklist_checks.deal_id));
create policy "Rows of visible deals can be inserted" on public.deal_checklist_checks for insert to authenticated
    with check (organization_id = (select private.current_organization_id()) and exists (select 1 from public.deals d where d.organization_id = deal_checklist_checks.organization_id and d.id = deal_checklist_checks.deal_id));
create policy "Rows of visible deals can be deleted" on public.deal_checklist_checks for delete to authenticated
    using (organization_id = (select private.current_organization_id()) and exists (select 1 from public.deals d where d.organization_id = deal_checklist_checks.organization_id and d.id = deal_checklist_checks.deal_id));

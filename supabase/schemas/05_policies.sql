--
-- Row Level Security
-- This file declares RLS policies for all tables.
--
-- Tenant isolation: a user only ever sees and writes rows whose organization_id
-- is their own organization (private.current_organization_id()). The helper is
-- wrapped in a sub-select so Postgres evaluates it once per statement.
--

-- Enable RLS on all tables
alter table public.organizations enable row level security;
alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_notes enable row level security;
alter table public.deals enable row level security;
alter table public.deal_notes enable row level security;
alter table public.sales enable row level security;
alter table public.tags enable row level security;
alter table public.tasks enable row level security;
alter table public.configuration enable row level security;
alter table public.favicons_excluded_domains enable row level security;

-- Organizations: members read their clinic, only the owner edits it
create policy "Organization members can read" on public.organizations for select to authenticated
    using (id = (select private.current_organization_id()));
create policy "Owner can update" on public.organizations for update to authenticated
    using (id = (select private.current_organization_id()) and (select private.current_user_role()) = 'owner')
    with check (id = (select private.current_organization_id()));

-- Sales: members see their colleagues; writes go through the users edge function
create policy "Organization members can read" on public.sales for select to authenticated
    using (organization_id = (select private.current_organization_id()));

-- Companies
create policy "Organization members can read" on public.companies for select to authenticated
    using (organization_id = (select private.current_organization_id()));
create policy "Organization members can insert" on public.companies for insert to authenticated
    with check (organization_id = (select private.current_organization_id()));
create policy "Organization members can update" on public.companies for update to authenticated
    using (organization_id = (select private.current_organization_id()))
    with check (organization_id = (select private.current_organization_id()));
create policy "Organization members can delete" on public.companies for delete to authenticated
    using (organization_id = (select private.current_organization_id()));

-- Contacts
create policy "Organization members can read" on public.contacts for select to authenticated
    using (organization_id = (select private.current_organization_id()));
create policy "Organization members can insert" on public.contacts for insert to authenticated
    with check (organization_id = (select private.current_organization_id()));
create policy "Organization members can update" on public.contacts for update to authenticated
    using (organization_id = (select private.current_organization_id()))
    with check (organization_id = (select private.current_organization_id()));
create policy "Organization members can delete" on public.contacts for delete to authenticated
    using (organization_id = (select private.current_organization_id()));

-- Contact Notes
create policy "Organization members can read" on public.contact_notes for select to authenticated
    using (organization_id = (select private.current_organization_id()));
create policy "Organization members can insert" on public.contact_notes for insert to authenticated
    with check (organization_id = (select private.current_organization_id()));
create policy "Organization members can update" on public.contact_notes for update to authenticated
    using (organization_id = (select private.current_organization_id()))
    with check (organization_id = (select private.current_organization_id()));
create policy "Organization members can delete" on public.contact_notes for delete to authenticated
    using (organization_id = (select private.current_organization_id()));

-- Deals
create policy "Organization members can read" on public.deals for select to authenticated
    using (organization_id = (select private.current_organization_id()));
create policy "Organization members can insert" on public.deals for insert to authenticated
    with check (organization_id = (select private.current_organization_id()));
create policy "Organization members can update" on public.deals for update to authenticated
    using (organization_id = (select private.current_organization_id()))
    with check (organization_id = (select private.current_organization_id()));
create policy "Organization members can delete" on public.deals for delete to authenticated
    using (organization_id = (select private.current_organization_id()));

-- Deal Notes
create policy "Organization members can read" on public.deal_notes for select to authenticated
    using (organization_id = (select private.current_organization_id()));
create policy "Organization members can insert" on public.deal_notes for insert to authenticated
    with check (organization_id = (select private.current_organization_id()));
create policy "Organization members can update" on public.deal_notes for update to authenticated
    using (organization_id = (select private.current_organization_id()))
    with check (organization_id = (select private.current_organization_id()));
create policy "Organization members can delete" on public.deal_notes for delete to authenticated
    using (organization_id = (select private.current_organization_id()));

-- Tags
create policy "Organization members can read" on public.tags for select to authenticated
    using (organization_id = (select private.current_organization_id()));
create policy "Organization members can insert" on public.tags for insert to authenticated
    with check (organization_id = (select private.current_organization_id()));
create policy "Organization members can update" on public.tags for update to authenticated
    using (organization_id = (select private.current_organization_id()))
    with check (organization_id = (select private.current_organization_id()));
create policy "Organization members can delete" on public.tags for delete to authenticated
    using (organization_id = (select private.current_organization_id()));

-- Tasks
create policy "Organization members can read" on public.tasks for select to authenticated
    using (organization_id = (select private.current_organization_id()));
create policy "Organization members can insert" on public.tasks for insert to authenticated
    with check (organization_id = (select private.current_organization_id()));
create policy "Organization members can update" on public.tasks for update to authenticated
    using (organization_id = (select private.current_organization_id()))
    with check (organization_id = (select private.current_organization_id()));
create policy "Organization members can delete" on public.tasks for delete to authenticated
    using (organization_id = (select private.current_organization_id()));

-- Configuration: members read, owner and head edit (the row is created with the organization)
create policy "Organization members can read" on public.configuration for select to authenticated
    using (organization_id = (select private.current_organization_id()));
create policy "Owner and head can update" on public.configuration for update to authenticated
    using (organization_id = (select private.current_organization_id()) and (select private.current_user_role()) in ('owner', 'head'))
    with check (organization_id = (select private.current_organization_id()));

-- Favicons excluded domains: global, read-only
create policy "Authenticated users can read" on public.favicons_excluded_domains for select to authenticated
    using (true);

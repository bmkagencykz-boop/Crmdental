--
-- Grants
-- This file declares all grants and default privileges for the public schema.
--

-- Schema usage
grant usage on schema public to postgres;
grant usage on schema public to anon;
grant usage on schema public to authenticated;
grant usage on schema public to service_role;

-- Private schema: helpers called from RLS policies, column defaults and triggers
grant usage on schema private to anon;
grant usage on schema private to authenticated;
grant usage on schema private to service_role;

revoke all on function private.current_organization_id() from public;
grant execute on function private.current_organization_id() to anon;
grant execute on function private.current_organization_id() to authenticated;
grant execute on function private.current_organization_id() to service_role;

revoke all on function private.current_user_role() from public;
grant execute on function private.current_user_role() to anon;
grant execute on function private.current_user_role() to authenticated;
grant execute on function private.current_user_role() to service_role;

revoke all on function private.current_sales_id() from public;
grant execute on function private.current_sales_id() to anon;
grant execute on function private.current_sales_id() to authenticated;
grant execute on function private.current_sales_id() to service_role;

revoke all on function private.manager_deal_visibility() from public;
grant execute on function private.manager_deal_visibility() to anon;
grant execute on function private.manager_deal_visibility() to authenticated;
grant execute on function private.manager_deal_visibility() to service_role;

revoke all on function private.normalize_phone(text) from public;
grant execute on function private.normalize_phone(text) to anon;
grant execute on function private.normalize_phone(text) to authenticated;
grant execute on function private.normalize_phone(text) to service_role;

-- Internal helpers: only reachable through SECURITY DEFINER code
revoke all on function private.seed_organization(bigint) from public;
grant execute on function private.seed_organization(bigint) to service_role;
revoke all on function private.check_pipeline_stages() from public;
grant execute on function private.check_pipeline_stages() to service_role;
revoke all on function private.create_sales_for_user(auth.users, bigint, text) from public;
grant execute on function private.create_sales_for_user(auth.users, bigint, text) to service_role;
revoke all on function private.invited_role(jsonb) from public;
grant execute on function private.invited_role(jsonb) to service_role;
revoke all on function private.delete_organization_data() from public;
grant execute on function private.delete_organization_data() to service_role;

-- Function grants
grant all on function public.cleanup_note_attachments() to anon;
grant all on function public.cleanup_note_attachments() to authenticated;
grant all on function public.cleanup_note_attachments() to service_role;

grant all on function public.get_note_attachments_function_url() to anon;
grant all on function public.get_note_attachments_function_url() to authenticated;
grant all on function public.get_note_attachments_function_url() to service_role;

grant all on function public.handle_new_user() to anon;
grant all on function public.handle_new_user() to authenticated;
grant all on function public.handle_new_user() to service_role;

grant all on function public.handle_update_user() to anon;
grant all on function public.handle_update_user() to authenticated;
grant all on function public.handle_update_user() to service_role;

grant all on function public.is_admin() to anon;
grant all on function public.is_admin() to authenticated;
grant all on function public.is_admin() to service_role;

grant all on function public.set_sales_id_default() to anon;
grant all on function public.set_sales_id_default() to authenticated;
grant all on function public.set_sales_id_default() to service_role;

grant all on function public.handle_patient_saved() to anon;
grant all on function public.handle_patient_saved() to authenticated;
grant all on function public.handle_patient_saved() to service_role;

grant all on function public.find_patients_by_phone(text) to anon;
grant all on function public.find_patients_by_phone(text) to authenticated;
grant all on function public.find_patients_by_phone(text) to service_role;

grant all on function public.handle_patient_note_created() to anon;
grant all on function public.handle_patient_note_created() to authenticated;
grant all on function public.handle_patient_note_created() to service_role;

grant all on function public.create_pipeline(text) to anon;
grant all on function public.create_pipeline(text) to authenticated;
grant all on function public.create_pipeline(text) to service_role;

grant all on function public.handle_deal_before_write() to anon;
grant all on function public.handle_deal_before_write() to authenticated;
grant all on function public.handle_deal_before_write() to service_role;

grant all on function public.handle_deal_after_write() to anon;
grant all on function public.handle_deal_after_write() to authenticated;
grant all on function public.handle_deal_after_write() to service_role;

grant all on function public.handle_deal_payment_changed() to anon;
grant all on function public.handle_deal_payment_changed() to authenticated;
grant all on function public.handle_deal_payment_changed() to service_role;

revoke all on function public.get_user_id_by_email(text) from public;
grant all on function public.get_user_id_by_email(text) to service_role;

-- Table grants
-- Organizations: users may only rename their clinic or change its timezone;
-- billing columns are written by the service role only.
-- Supabase's default privileges grant everything on new tables: reset first.
revoke all on table public.organizations from anon, authenticated;
grant select on table public.organizations to anon;
grant select on table public.organizations to authenticated;
grant update (name, timezone) on table public.organizations to authenticated;
grant all on table public.organizations to service_role;

grant all on table public.organization_settings to anon;
grant all on table public.organization_settings to authenticated;
grant all on table public.organization_settings to service_role;

grant all on table public.sales to anon;
grant all on table public.sales to authenticated;
grant all on table public.sales to service_role;

grant all on table public.configuration to anon;
grant all on table public.configuration to authenticated;
grant all on table public.configuration to service_role;

grant all on table public.pipelines to anon;
grant all on table public.pipelines to authenticated;
grant all on table public.pipelines to service_role;

grant all on table public.stages to anon;
grant all on table public.stages to authenticated;
grant all on table public.stages to service_role;

grant all on table public.services to anon;
grant all on table public.services to authenticated;
grant all on table public.services to service_role;

grant all on table public.lead_sources to anon;
grant all on table public.lead_sources to authenticated;
grant all on table public.lead_sources to service_role;

grant all on table public.lost_reasons to anon;
grant all on table public.lost_reasons to authenticated;
grant all on table public.lost_reasons to service_role;

grant all on table public.tags to anon;
grant all on table public.tags to authenticated;
grant all on table public.tags to service_role;

grant all on table public.patients to anon;
grant all on table public.patients to authenticated;
grant all on table public.patients to service_role;

grant all on table public.patient_notes to anon;
grant all on table public.patient_notes to authenticated;
grant all on table public.patient_notes to service_role;

grant all on table public.deals to anon;
grant all on table public.deals to authenticated;
grant all on table public.deals to service_role;

grant all on table public.deal_notes to anon;
grant all on table public.deal_notes to authenticated;
grant all on table public.deal_notes to service_role;

grant all on table public.deal_payments to anon;
grant all on table public.deal_payments to authenticated;
grant all on table public.deal_payments to service_role;

grant all on table public.deal_events to anon;
grant all on table public.deal_events to authenticated;
grant all on table public.deal_events to service_role;

grant all on table public.tasks to anon;
grant all on table public.tasks to authenticated;
grant all on table public.tasks to service_role;

grant all on table public.calls to anon;
grant all on table public.calls to authenticated;
grant all on table public.calls to service_role;

-- System lead sources keep their code: users only rename, reorder or archive
revoke update on table public.lead_sources from anon, authenticated;
grant update (name, position, is_archived) on table public.lead_sources to authenticated;

-- The deal log is written by triggers only
revoke insert, update, delete on table public.deal_events from anon, authenticated;

-- View grants
grant all on table public.activity_log to anon;
grant all on table public.activity_log to authenticated;
grant all on table public.activity_log to service_role;

grant all on table public.patients_summary to anon;
grant all on table public.patients_summary to authenticated;
grant all on table public.patients_summary to service_role;

grant all on table public.deals_summary to anon;
grant all on table public.deals_summary to authenticated;
grant all on table public.deals_summary to service_role;

-- Sequence grants
grant all on sequence public.organizations_id_seq to service_role;

grant all on sequence public.configuration_id_seq to anon;
grant all on sequence public.configuration_id_seq to authenticated;
grant all on sequence public.configuration_id_seq to service_role;

grant all on sequence public.sales_id_seq to anon;
grant all on sequence public.sales_id_seq to authenticated;
grant all on sequence public.sales_id_seq to service_role;

grant all on sequence public.pipelines_id_seq to anon;
grant all on sequence public.pipelines_id_seq to authenticated;
grant all on sequence public.pipelines_id_seq to service_role;

grant all on sequence public.stages_id_seq to anon;
grant all on sequence public.stages_id_seq to authenticated;
grant all on sequence public.stages_id_seq to service_role;

grant all on sequence public.services_id_seq to anon;
grant all on sequence public.services_id_seq to authenticated;
grant all on sequence public.services_id_seq to service_role;

grant all on sequence public.lead_sources_id_seq to anon;
grant all on sequence public.lead_sources_id_seq to authenticated;
grant all on sequence public.lead_sources_id_seq to service_role;

grant all on sequence public.lost_reasons_id_seq to anon;
grant all on sequence public.lost_reasons_id_seq to authenticated;
grant all on sequence public.lost_reasons_id_seq to service_role;

grant all on sequence public.tags_id_seq to anon;
grant all on sequence public.tags_id_seq to authenticated;
grant all on sequence public.tags_id_seq to service_role;

grant all on sequence public.patients_id_seq to anon;
grant all on sequence public.patients_id_seq to authenticated;
grant all on sequence public.patients_id_seq to service_role;

grant all on sequence public.patient_notes_id_seq to anon;
grant all on sequence public.patient_notes_id_seq to authenticated;
grant all on sequence public.patient_notes_id_seq to service_role;

grant all on sequence public.deals_id_seq to anon;
grant all on sequence public.deals_id_seq to authenticated;
grant all on sequence public.deals_id_seq to service_role;

grant all on sequence public.deal_notes_id_seq to anon;
grant all on sequence public.deal_notes_id_seq to authenticated;
grant all on sequence public.deal_notes_id_seq to service_role;

grant all on sequence public.deal_payments_id_seq to anon;
grant all on sequence public.deal_payments_id_seq to authenticated;
grant all on sequence public.deal_payments_id_seq to service_role;

grant all on sequence public.deal_events_id_seq to anon;
grant all on sequence public.deal_events_id_seq to authenticated;
grant all on sequence public.deal_events_id_seq to service_role;

grant all on sequence public.tasks_id_seq to anon;
grant all on sequence public.tasks_id_seq to authenticated;
grant all on sequence public.tasks_id_seq to service_role;

grant all on sequence public.calls_id_seq to anon;
grant all on sequence public.calls_id_seq to authenticated;
grant all on sequence public.calls_id_seq to service_role;

-- Default privileges
alter default privileges for role postgres in schema public grant all on sequences to postgres;
alter default privileges for role postgres in schema public grant all on sequences to anon;
alter default privileges for role postgres in schema public grant all on sequences to authenticated;
alter default privileges for role postgres in schema public grant all on sequences to service_role;

alter default privileges for role postgres in schema public grant all on functions to postgres;
alter default privileges for role postgres in schema public grant all on functions to anon;
alter default privileges for role postgres in schema public grant all on functions to authenticated;
alter default privileges for role postgres in schema public grant all on functions to service_role;

alter default privileges for role postgres in schema public grant all on tables to postgres;
alter default privileges for role postgres in schema public grant all on tables to anon;
alter default privileges for role postgres in schema public grant all on tables to authenticated;
alter default privileges for role postgres in schema public grant all on tables to service_role;

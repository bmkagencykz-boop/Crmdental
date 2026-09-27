--
-- Triggers
-- This file declares all triggers.
--

-- Auto-populate sales_id from current auth user on insert
create or replace trigger set_patient_sales_id_trigger
    before insert on public.patients
    for each row execute function public.set_sales_id_default();

create or replace trigger set_patient_notes_sales_id_trigger
    before insert on public.patient_notes
    for each row execute function public.set_sales_id_default();

create or replace trigger set_deal_sales_id_trigger
    before insert on public.deals
    for each row execute function public.set_sales_id_default();

create or replace trigger set_deal_notes_sales_id_trigger
    before insert on public.deal_notes
    for each row execute function public.set_sales_id_default();

create or replace trigger set_deal_payments_sales_id_trigger
    before insert on public.deal_payments
    for each row execute function public.set_sales_id_default();

create or replace trigger set_task_sales_id_trigger
    before insert on public.tasks
    for each row execute function public.set_sales_id_default();

create or replace trigger set_call_sales_id_trigger
    before insert on public.calls
    for each row execute function public.set_sales_id_default();

-- Normalize phones and messenger handles of patients
create or replace trigger patient_saved
    before insert or update on public.patients
    for each row execute function public.handle_patient_saved();

-- Update patients.last_seen when a note is created
create or replace trigger on_patient_notes_created
    after insert on public.patient_notes
    for each row execute function public.handle_patient_note_created();

-- Every pipeline keeps a won and a lost stage (checked at commit)
create constraint trigger check_pipeline_stages_on_stages
    after insert or update or delete on public.stages
    deferrable initially deferred
    for each row execute function private.check_pipeline_stages();

create constraint trigger check_pipeline_stages_on_pipelines
    after insert on public.pipelines
    deferrable initially deferred
    for each row execute function private.check_pipeline_stages();

-- Deals: defaults, stage rules, log, patient source
create or replace trigger deal_before_write
    before insert or update on public.deals
    for each row execute function public.handle_deal_before_write();

create or replace trigger deal_after_write
    after insert or update on public.deals
    for each row execute function public.handle_deal_after_write();

-- Keep deals.paid_amount in sync with the payments
create or replace trigger deal_payment_changed
    after insert or update or delete on public.deal_payments
    for each row execute function public.handle_deal_payment_changed();

-- Cleanup storage attachments when notes are updated or deleted
create or replace trigger on_patient_notes_attachments_updated_delete_note_attachments
    after update on public.patient_notes
    for each row
    when (old.attachments is distinct from new.attachments)
    execute function public.cleanup_note_attachments();

create or replace trigger on_patient_notes_deleted_delete_note_attachments
    after delete on public.patient_notes
    for each row execute function public.cleanup_note_attachments();

create or replace trigger on_deal_notes_attachments_updated_delete_note_attachments
    after update on public.deal_notes
    for each row
    when (old.attachments is distinct from new.attachments)
    execute function public.cleanup_note_attachments();

create or replace trigger on_deal_notes_deleted_delete_note_attachments
    after delete on public.deal_notes
    for each row execute function public.cleanup_note_attachments();

-- Auth triggers: sync auth.users to public.sales
create or replace trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

create or replace trigger on_auth_user_updated
    after update on auth.users
    for each row execute function public.handle_update_user();

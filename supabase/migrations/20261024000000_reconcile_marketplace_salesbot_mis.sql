-- Parallel branches changed the same functions; this migration brings
-- them to their final text from supabase/schemas.

-- from supabase/schemas/08_automessages.sql
CREATE OR REPLACE FUNCTION "public"."claim_automessages"("per_clinic" integer DEFAULT 20) RETURNS TABLE("id" bigint, "organization_id" bigint, "deal_id" bigint, "patient_id" bigint, "message_text" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  job public.automessages;
  job_deal public.deals;
  job_rule public.automessage_rules;
  template_body text;
  rendered text;
  taken jsonb := '{}'::jsonb;
begin
  -- A run that died while sending: rather a failed row than a message sent twice
  update public.automessages a
  set status = 'failed', error = 'Отправка прервалась, проверьте переписку', processed_at = now()
  where a.status = 'sending' and a.claimed_at < now() - interval '10 minutes';

  for job in
    select a.* from public.automessages a
    where a.status = 'pending' and a.send_at <= now()
    order by a.send_at, a.id
    limit 1000
    for update skip locked
  loop
    if coalesce((taken ->> job.organization_id::text)::integer, 0) >= per_clinic then
      continue;
    end if;
    select d.* into job_deal from public.deals d
    where d.organization_id = job.organization_id and d.id = job.deal_id;
    select r.* into job_rule from public.automessage_rules r
    where r.organization_id = job.organization_id and r.id = job.rule_id;

    -- A message of a salesbot (stage 26) has its text and stays when the
    -- deal changes stage (the bot moves it itself)
    if (job.salesbot_session_id is null and job_deal.stage_id is distinct from job.stage_id)
      or job_deal.archived_at is not null then
      update public.automessages a
      set status = 'cancelled', error = 'Сделка ушла с этапа', processed_at = now()
      where a.id = job.id;
      continue;
    end if;
    -- A salesbot row (stage 26) and a message of the public API (stage 25)
    -- carry their ready text; a row queued by a stage trigger (stage 20) has
    -- its template and no rule
    if job.salesbot_session_id is not null then
      rendered := job.text;
    elsif job.rule_id is null and job.template_id is null and coalesce(btrim(job.text), '') <> '' then
      rendered := job.text;
    else
      if job.template_id is null and (job_rule.id is null or not job_rule.is_active) then
        update public.automessages a
        set status = 'cancelled', error = 'Правило выключено или удалено', processed_at = now()
        where a.id = job.id;
        continue;
      end if;

      select t.body into template_body from public.message_templates t
      where t.organization_id = job.organization_id and t.id = coalesce(job.template_id, job_rule.template_id);
      rendered := private.render_template(template_body, private.automessage_vars(job_deal));
    end if;
    if coalesce(rendered, '') = '' then
      update public.automessages a
      set status = 'failed', error = 'Пустой текст сообщения', processed_at = now()
      where a.id = job.id;
      continue;
    end if;

    if job_rule.mode = 'confirm' then
      insert into public.tasks (organization_id, deal_id, type, text, due_date, sales_id, automessage_id)
      values (job.organization_id, job.deal_id, 'message', rendered, now(), job_deal.sales_id, job.id);
      update public.automessages a
      set status = 'awaiting', text = rendered, processed_at = now()
      where a.id = job.id;
      continue;
    end if;

    if not exists (
      select 1 from public.messenger_integrations i
      where i.organization_id = job.organization_id and i.api_key is not null
    ) and not exists (
      select 1 from public.telegram_bots b
      where b.organization_id = job.organization_id and b.bot_token is not null
    ) then
      update public.automessages a
      set status = 'failed', text = rendered, processed_at = now(),
          error = 'Мессенджеры не подключены (Настройки → Мессенджеры)'
      where a.id = job.id;
      continue;
    end if;

    update public.automessages a
    set status = 'sending', text = rendered, claimed_at = now()
    where a.id = job.id;
    taken := jsonb_set(taken, array[job.organization_id::text],
      to_jsonb(coalesce((taken ->> job.organization_id::text)::integer, 0) + 1));
    id := job.id;
    organization_id := job.organization_id;
    deal_id := job.deal_id;
    patient_id := job_deal.patient_id;
    message_text := rendered;
    return next;
  end loop;
end;
$$;

-- from supabase/schemas/12_telephony.sql
CREATE OR REPLACE FUNCTION "public"."save_telephony"("telephony_provider" "text", "new_secret" "text" DEFAULT NULL::"text", "new_api_key" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if private.current_organization_id() is null
    or private.current_user_role() not in ('owner', 'head', 'integrator') then
    raise exception 'Only the owner and the head manage telephony' using errcode = '42501';
  end if;
  if telephony_provider is null or telephony_provider not in ('binotel', 'zadarma', 'mango', 'sipuni', 'generic') then
    raise exception 'Unknown telephony provider' using errcode = '22023';
  end if;
  insert into public.telephony_integrations (organization_id, provider, secret, api_key)
  values (
    private.current_organization_id(),
    telephony_provider,
    nullif(btrim(new_secret), ''),
    nullif(btrim(new_api_key), '')
  )
  on conflict (organization_id) do update
  set provider = excluded.provider,
      secret = case when new_secret is null then public.telephony_integrations.secret else excluded.secret end,
      api_key = case when new_api_key is null then public.telephony_integrations.api_key else excluded.api_key end;
end;
$$;

-- from supabase/schemas/26_salesbot.sql
CREATE OR REPLACE FUNCTION "private"."can_configure"() RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  -- The integrator (stage 25) configures bots too
  return coalesce(private.current_user_role() in ('owner', 'head', 'integrator'), false);
end;
$$;

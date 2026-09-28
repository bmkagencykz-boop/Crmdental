import { formatPhone } from "../misc/formatPhone";
import { useGetList, useTranslate, type Identifier } from "ra-core";
import { useNavigate } from "react-router";

import {
  findById,
  useLeadSources,
  useOrganizationSettings,
} from "../dictionaries/useDictionaries";
import { patientDisplayName } from "../patients/parsePatientText";
import { UnsortedActions } from "./UnsortedActions";
import { leadExcerpt, unsortedAge, type UnsortedLead } from "./unsorted";

export const UNSORTED_REFRESH_MS = 30_000;

/** The unsorted leads of a pipeline, newest first */
export const useUnsortedLeads = (pipelineId?: Identifier) =>
  useGetList<UnsortedLead>(
    "unsorted_leads",
    {
      filter: pipelineId != null ? { pipeline_id: pipelineId } : {},
      sort: { field: "unsorted_at", order: "DESC" },
      pagination: { page: 1, perPage: 200 },
    },
    { refetchInterval: UNSORTED_REFRESH_MS },
  );

/**
 * Leftmost column of the board (amoCRM): the leads waiting to be accepted,
 * with their channel, their first words and how long they wait. Shown when
 * the clinic uses «Неразобранное» or leads are still waiting.
 */
export const UnsortedColumn = ({ pipelineId }: { pipelineId: Identifier }) => {
  const translate = useTranslate();
  const { data: settings } = useOrganizationSettings();
  const { data: leads = [], isPending } = useUnsortedLeads(pipelineId);
  if (isPending || (!settings?.unsorted_enabled && !leads.length)) return null;

  return (
    <section
      className="flex min-h-[calc(100vh-18rem)] w-[17rem] shrink-0 flex-col px-1.5"
      aria-label={translate("unsorted.column")}
      data-testid="unsorted-column"
    >
      <header className="mb-2 px-1">
        <h3 className="truncate text-[12px] font-semibold uppercase tracking-[0.04em] text-foreground">
          {translate("unsorted.column")}
        </h3>
        <span
          className="mt-1.5 block h-[3px] rounded-sm bg-muted-foreground/60"
          aria-hidden
        />
        <p className="mt-1.5 text-[12px] tabular-nums text-muted-foreground">
          {translate("unsorted.count", { smart_count: leads.length })}
        </p>
      </header>
      <div className="flex flex-1 flex-col gap-1.5 rounded-md bg-muted/40 p-1">
        {leads.map((lead) => (
          <UnsortedCard key={lead.id} lead={lead} />
        ))}
        {!leads.length ? (
          <p className="px-2 py-3 text-center text-[12px] text-muted-foreground">
            {translate("unsorted.empty")}
          </p>
        ) : null}
      </div>
    </section>
  );
};

const UnsortedCard = ({ lead }: { lead: UnsortedLead }) => {
  const translate = useTranslate();
  const navigate = useNavigate();
  const { data: sources } = useLeadSources();
  const age = unsortedAge(lead.unsorted_at);
  const name =
    patientDisplayName({
      last_name: lead.patient_last_name,
      first_name: lead.patient_first_name,
    }) ||
    formatPhone(lead.patient_phone) ||
    "—";
  const excerpt = leadExcerpt(lead);
  const source = findById(sources, lead.source_id ?? undefined);

  return (
    <article
      className="cursor-pointer rounded-md border border-border bg-pill py-2 pr-2.5 pl-3 text-[13px] leading-snug shadow-card transition-colors hover:bg-pill-hover"
      onClick={() => navigate(`/deals/${lead.id}/show`)}
      data-unsorted-id={lead.id}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-center font-semibold text-brand-link">
          <span className="truncate">{name}</span>
        </p>
        <time
          className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
          dateTime={lead.unsorted_at}
          title={new Date(lead.unsorted_at).toLocaleString("ru-RU")}
        >
          {translate(`unsorted.age.${age.unit}`, { count: age.value })}
        </time>
      </div>
      <p className="mt-1 line-clamp-3 text-[12px] text-foreground/85">
        {excerpt ||
          (lead.channel === "call"
            ? translate("unsorted.channels.call")
            : translate("unsorted.no_text"))}
      </p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground">
        {[
          lead.channel ? translate(`unsorted.channels.${lead.channel}`) : null,
          source?.name,
        ]
          .filter((part, index, parts) => part && parts.indexOf(part) === index)
          .join(" · ")}
      </p>
      <div className="mt-2">
        <UnsortedActions lead={lead} compact />
      </div>
    </article>
  );
};

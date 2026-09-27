import { useGetList, useTranslate } from "ra-core";

import {
  findById,
  toChoices,
  useLeadSources,
  useLostReasons,
  usePipelines,
  useServices,
  useStages,
} from "../../dictionaries/useDictionaries";
import { useConfigurationContext } from "../../root/ConfigurationContext";
import type { Deal, Sale } from "../../types";
import { formatMoney } from "../kanbanFormat";
import { InlineField } from "./InlineField";
import { useDealUpdate } from "./useDealUpdate";

export const formatDateTime = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

/** Response time as "12 min", "3 h 5 min" */
export const formatDelay = (from?: string | null, to?: string | null) => {
  if (!from || !to) return null;
  const minutes = Math.max(
    0,
    Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000),
  );
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч ${minutes % 60} мин`;
  return `${Math.floor(hours / 24)} д ${hours % 24} ч`;
};

/** "Основное" tab: every field of the deal, edited in place */
export const DealFields = ({ deal }: { deal: Deal }) => {
  const translate = useTranslate();
  const { currency } = useConfigurationContext();
  const { save } = useDealUpdate(deal);
  const { data: services } = useServices();
  const { data: sources } = useLeadSources();
  const { data: lostReasons } = useLostReasons();
  const { data: pipelines } = usePipelines();
  const { data: stages } = useStages();
  const { data: sales = [] } = useGetList<Sale>("sales", {
    filter: { "disabled@neq": true },
    sort: { field: "last_name", order: "ASC" },
    pagination: { page: 1, perPage: 100 },
  });
  const field = (source: string) =>
    translate(`resources.deals.fields.${source}`);
  const responsible = sales.find((s) => s.id === deal.sales_id);
  const isLost = findById(stages, deal.stage_id)?.kind === "lost";

  return (
    <div className="flex flex-col">
      <InlineField
        label={field("sales_id")}
        value={deal.sales_id}
        display={
          responsible
            ? `${responsible.first_name} ${responsible.last_name}`
            : null
        }
        editor={{
          kind: "select",
          choices: sales.map((s) => ({
            id: s.id,
            name: `${s.first_name} ${s.last_name}`,
          })),
          emptyLabel: translate("crm.deals.unassigned"),
        }}
        onSave={(sales_id) => save({ sales_id: sales_id as Deal["sales_id"] })}
      />
      <InlineField
        label={field("plan_amount")}
        value={deal.plan_amount}
        display={formatMoney(deal.plan_amount, currency)}
        editor={{ kind: "number" }}
        onSave={(plan_amount) => save({ plan_amount: Number(plan_amount) })}
      />
      <InlineField
        label={field("paid_amount")}
        value={deal.paid_amount}
        display={formatMoney(deal.paid_amount, currency)}
        readOnly
      />
      <InlineField
        label={field("name")}
        value={deal.name}
        editor={{ kind: "text" }}
        onSave={(name) => save({ name: name as string | null })}
      />
      <InlineField
        label={field("service_id")}
        value={deal.service_id}
        display={findById(services, deal.service_id)?.name}
        editor={{
          kind: "select",
          choices: toChoices(services, deal.service_id),
        }}
        onSave={(service_id) =>
          save({ service_id: service_id as Deal["service_id"] })
        }
      />
      <InlineField
        label={field("source_id")}
        value={deal.source_id}
        display={findById(sources, deal.source_id)?.name}
        editor={{
          kind: "select",
          choices: toChoices(sources, deal.source_id),
        }}
        onSave={(source_id) =>
          save({ source_id: source_id as Deal["source_id"] })
        }
      />
      <InlineField
        label={field("appointment_at")}
        value={deal.appointment_at}
        display={formatDateTime(deal.appointment_at)}
        editor={{ kind: "datetime" }}
        onSave={(appointment_at) =>
          save({ appointment_at: appointment_at as string | null })
        }
      />
      <InlineField
        label={field("visit_at")}
        value={deal.visit_at}
        display={formatDateTime(deal.visit_at)}
        editor={{ kind: "datetime" }}
        onSave={(visit_at) => save({ visit_at: visit_at as string | null })}
      />
      {isLost ? (
        <>
          <InlineField
            label={field("lost_reason_id")}
            value={deal.lost_reason_id}
            display={findById(lostReasons, deal.lost_reason_id)?.name}
            editor={{
              kind: "select",
              choices: toChoices(lostReasons, deal.lost_reason_id),
            }}
            onSave={(lost_reason_id) =>
              save({ lost_reason_id: lost_reason_id as Deal["lost_reason_id"] })
            }
          />
          <InlineField
            label={field("lost_comment")}
            value={deal.lost_comment}
            editor={{ kind: "textarea" }}
            onSave={(lost_comment) =>
              save({ lost_comment: lost_comment as string | null })
            }
          />
        </>
      ) : null}
      <InlineField
        label={field("pipeline_id")}
        value={deal.pipeline_id}
        display={findById(pipelines, deal.pipeline_id)?.name}
        editor={{
          kind: "select",
          choices: pipelines.map((p) => ({ id: p.id, name: p.name })),
        }}
        onSave={(pipeline_id) =>
          pipeline_id != null &&
          save({ pipeline_id: pipeline_id as Deal["pipeline_id"] })
        }
      />
      <InlineField
        label={field("description")}
        value={deal.description}
        editor={{ kind: "textarea" }}
        onSave={(description) =>
          save({ description: description as string | null })
        }
      />
      <InlineField
        label={field("created_at")}
        value={deal.created_at}
        display={formatDateTime(deal.created_at)}
        readOnly
      />
      <InlineField
        label={translate("crm.deals.page.first_response")}
        value={deal.first_response_at}
        display={formatDelay(deal.created_at, deal.first_response_at)}
        readOnly
      />
    </div>
  );
};

import { useGetList, useTranslate, type Identifier } from "ra-core";

import { formatMoney } from "../deals/kanbanFormat";
import {
  findById,
  useDoctors,
  useServices,
  useStages,
} from "../dictionaries/useDictionaries";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { MessageTemplate, Sale, Tag } from "../types";
import { describeRun } from "./automation";
import type { StageTriggerRun } from "./types";

const listAll = { page: 1, perPage: 500 };
const options = { staleTime: 5 * 60 * 1000 };

/**
 * «Автоматически: этап → В работе (правило «Пациент ответил»)», or why the
 * trigger was skipped. A line of the deal feed.
 */
export const AutomationRunLine = ({ run }: { run: StageTriggerRun }) => {
  const translate = useTranslate();
  const { currency } = useConfigurationContext();
  const { data: stages } = useStages();
  const { data: services } = useServices();
  const { data: doctors } = useDoctors();
  const { data: sales = [] } = useGetList<Sale>(
    "sales",
    { pagination: listAll, sort: { field: "last_name", order: "ASC" } },
    options,
  );
  const { data: tags = [] } = useGetList<Tag>(
    "tags",
    { pagination: listAll, sort: { field: "name", order: "ASC" } },
    options,
  );
  const { data: templates = [] } = useGetList<MessageTemplate>(
    "message_templates",
    { pagination: listAll, sort: { field: "position", order: "ASC" } },
    { ...options, enabled: run.action === "send_template" },
  );
  const name = (
    items: { id: Identifier; name: string }[],
    id: Identifier | null | undefined,
  ) => findById(items, id)?.name;

  return (
    <>
      {describeRun(
        run,
        {
          stageName: (id) => name(stages, id),
          salesName: (id) => {
            const sale = findById(sales, id);
            return sale ? `${sale.first_name} ${sale.last_name}` : undefined;
          },
          tagName: (id) => findById(tags, id)?.name,
          templateName: (id) => name(templates, id),
          fieldValue: (field, value) =>
            field === "plan_amount"
              ? formatMoney(Number(value ?? 0), currency)
              : field === "doctor_id"
                ? name(doctors, value as Identifier)
                : name(services, value as Identifier),
        },
        translate,
      )}
    </>
  );
};

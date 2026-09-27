import type { ReactNode } from "react";
import type { Identifier, InputProps } from "ra-core";
import { useCanAccess, useTranslate } from "ra-core";
import { ReferenceInput } from "@/components/admin/reference-input";
import { SearchInput } from "@/components/admin/search-input";
import { SelectInput } from "@/components/admin/select-input";

import {
  toChoices,
  useDoctors,
  useLeadSources,
  usePipelines,
  useServices,
  useStages,
} from "../../dictionaries/useDictionaries";
import { WaitingOnlyInput } from "../../notifications/WaitingOnlyInput";
import { CustomFieldsFilter } from "../../custom-fields/CustomFieldsFilter";
import {
  CUSTOM_VALUES_FILTER,
  filterableFields,
} from "../../custom-fields/customFields";
import { useCustomFields } from "../../custom-fields/useCustomFields";
import { WAITING_FILTER } from "../../providers/commons/responseTime";
import { AccountManagerInput } from "../../sales/AccountManagerInput";
import { OnlyMineInput } from "../OnlyMineInput";
import { periodChoices } from "../periods";
import { TASK_STATE_FILTER } from "./dealFilters";

/**
 * Filters of the deals, the same on the board and in the list (stage 21):
 * search, responsible, «ждут ответа», source, service, doctor, period, tags,
 * stage and tasks; the list adds the pipeline (the board shows one).
 */
export const useDealFilters = ({
  pipelineId,
}: {
  /** The board's pipeline; undefined: the list, every pipeline */
  pipelineId?: Identifier;
}) => {
  const translate = useTranslate();
  const { data: services } = useServices();
  const { data: sources } = useLeadSources();
  const { data: doctors } = useDoctors();
  const { data: customFields } = useCustomFields();
  const { data: pipelines } = usePipelines();
  const { data: stages } = useStages();
  const { canAccess: canAccessSalesList, isPending } = useCanAccess({
    resource: "sales",
    action: "list",
  });

  const pipelineName = (id: Identifier) =>
    pipelines.find((p) => String(p.id) === String(id))?.name ?? "";
  const stageChoices = [...stages]
    .filter(
      (stage) =>
        pipelineId == null || String(stage.pipeline_id) === String(pipelineId),
    )
    .sort((a, b) => {
      const pa = pipelines.findIndex(
        (p) => String(p.id) === String(a.pipeline_id),
      );
      const pb = pipelines.findIndex(
        (p) => String(p.id) === String(b.pipeline_id),
      );
      return pa - pb || a.position - b.position;
    })
    .map((stage) => ({
      id: stage.id,
      name:
        pipelineId == null && pipelines.length > 1
          ? `${pipelineName(stage.pipeline_id)} · ${stage.name}`
          : stage.name,
    }));

  return [
    <SearchInput
      source="q"
      alwaysOn
      placeholder={translate("crm.deals.search")}
    />,
    ...(isPending
      ? []
      : [
          canAccessSalesList ? (
            <AccountManagerInput source="sales_id" alwaysOn />
          ) : (
            <OnlyMineInput source="sales_id" alwaysOn />
          ),
        ]),
    <WaitingOnlyInput source={WAITING_FILTER} alwaysOn />,
    ...(pipelineId == null && pipelines.length > 1
      ? [
          <WrapperField source="pipeline_id" label="deal_list.filters.pipeline">
            <SelectInput
              source="pipeline_id"
              label={false}
              emptyText="deal_list.filters.pipeline"
              choices={toChoices(pipelines)}
            />
          </WrapperField>,
        ]
      : []),
    <WrapperField source="stage_id" label="deal_list.filters.stage">
      <SelectInput
        source="stage_id"
        label={false}
        emptyText="deal_list.filters.stage"
        choices={stageChoices}
      />
    </WrapperField>,
    <WrapperField source={TASK_STATE_FILTER} label="deal_list.filters.tasks">
      <SelectInput
        source={TASK_STATE_FILTER}
        label={false}
        emptyText="deal_list.filters.tasks"
        choices={[
          { id: "no_task", name: translate("deal_list.filters.no_task") },
          { id: "overdue", name: translate("deal_list.filters.overdue") },
        ]}
      />
    </WrapperField>,
    <WrapperField source="source_id" label="resources.deals.fields.source_id">
      <SelectInput
        source="source_id"
        label={false}
        emptyText="resources.deals.fields.source_id"
        choices={toChoices(sources)}
      />
    </WrapperField>,
    <WrapperField source="service_id" label="resources.deals.fields.service_id">
      <SelectInput
        source="service_id"
        label={false}
        emptyText="resources.deals.fields.service_id"
        choices={toChoices(services)}
      />
    </WrapperField>,
    <WrapperField source="doctor_id" label="resources.deals.fields.doctor_id">
      <SelectInput
        source="doctor_id"
        label={false}
        emptyText="resources.deals.fields.doctor_id"
        // Inactive doctors too: their old deals stay findable
        choices={doctors.map((d) => ({ id: d.id, name: d.name }))}
      />
    </WrapperField>,
    // Custom fields: lists and checkboxes (stage 19)
    ...(filterableFields(customFields).length
      ? [
          <WrapperField
            source={CUSTOM_VALUES_FILTER}
            label="custom_fields.filter.label"
          >
            <CustomFieldsFilter source={CUSTOM_VALUES_FILTER} />
          </WrapperField>,
        ]
      : []),
    <WrapperField source="created_at@gte" label="crm.deals.period">
      <SelectInput
        source="created_at@gte"
        label={false}
        emptyText="crm.deals.period"
        choices={periodChoices(translate)}
      />
    </WrapperField>,
    <WrapperField source="tags@cs" label="resources.tags.name">
      <ReferenceInput source="tags@cs" reference="tags">
        <SelectInput
          label={false}
          emptyText="resources.tags.name"
          format={(value: string) => value?.replace(/[{}]/g, "")}
          parse={(value: string) => (value ? `{${value}}` : value)}
        />
      </ReferenceInput>
    </WrapperField>,
  ];
};

/**
 * Used so that label of filters can be inferred for the select display,
 * but not be displayed when showing the input.
 */
const WrapperField = ({ children }: InputProps & { children: ReactNode }) =>
  children;

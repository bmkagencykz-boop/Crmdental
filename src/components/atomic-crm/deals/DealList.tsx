import type { ReactNode } from "react";
import type { InputProps } from "ra-core";
import {
  useCanAccess,
  useGetIdentity,
  useStore,
  useTranslate,
  type Identifier,
} from "ra-core";
import { Link, matchPath, useLocation } from "react-router";
import { Plus } from "lucide-react";
import { CreateButton } from "@/components/admin/create-button";
import { ExportButton } from "@/components/admin/export-button";
import { List } from "@/components/admin/list";
import { FilterButton } from "@/components/admin/filter-form";
import { SearchInput } from "@/components/admin/search-input";
import { SelectInput } from "@/components/admin/select-input";
import { cn } from "@/lib/utils";

import {
  findById,
  getDefaultPipeline,
  toChoices,
  useDoctors,
  useLeadSources,
  usePipelines,
  useServices,
} from "../dictionaries/useDictionaries";
import { TopToolbar } from "../layout/TopToolbar";
import { ReferenceInput } from "@/components/admin/reference-input";
import { AccountManagerInput } from "../sales/AccountManagerInput";
import { DealArchivedList } from "./DealArchivedList";
import { DealCreate } from "./DealCreate";
import { DealEdit } from "./DealEdit";
import { DealListContent } from "./DealListContent";
import { OnlyMineInput } from "./OnlyMineInput";
import { WaitingOnlyInput } from "../notifications/WaitingOnlyInput";
import { WAITING_FILTER } from "../providers/commons/responseTime";
import { periodChoices } from "./periods";
import { CustomFieldsFilter } from "../custom-fields/CustomFieldsFilter";
import {
  CUSTOM_VALUES_FILTER,
  filterableFields,
} from "../custom-fields/customFields";
import { customFieldsExporter } from "../custom-fields/exporters";
import { useCustomFields } from "../custom-fields/useCustomFields";

const dealExporter = customFieldsExporter("deal");

export const DEAL_PIPELINE_STORE_KEY = "deals.pipeline_id";

/** The pipeline shown on the board, remembered per user */
export const useCurrentPipeline = () => {
  const { data: pipelines, isPending } = usePipelines();
  const [storedId, setStoredId] = useStore<Identifier | undefined>(
    DEAL_PIPELINE_STORE_KEY,
  );
  const current =
    findById(pipelines, storedId) ?? getDefaultPipeline(pipelines);
  return { pipelines, current, setCurrent: setStoredId, isPending };
};

const DealList = () => {
  const { identity } = useGetIdentity();
  const translate = useTranslate();
  const { data: services } = useServices();
  const { data: sources } = useLeadSources();
  const { data: doctors } = useDoctors();
  const { data: customFields } = useCustomFields();
  const { current } = useCurrentPipeline();
  const { canAccess: canAccessSalesList, isPending } = useCanAccess({
    resource: "sales",
    action: "list",
  });

  if (!identity || !current) return null;

  const dealFilters = [
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
  ];

  return (
    <>
      <PipelineTabs />
      <List
        key={current.id}
        perPage={500}
        filter={{ "archived_at@is": null, pipeline_id: current.id }}
        title={false}
        sort={{ field: "index", order: "ASC" }}
        filters={dealFilters}
        actions={<DealActions />}
        pagination={null}
        exporter={dealExporter}
        storeKey={`deals.pipeline.${current.id}`}
      >
        <DealLayout pipelineId={current.id} />
      </List>
    </>
  );
};

/** Pipeline switcher: pills, the current one in ink (Stratus tabs) */
const PipelineTabs = () => {
  const { pipelines, current, setCurrent } = useCurrentPipeline();
  if (pipelines.length < 2) return null;
  return (
    <nav className="-mt-2 mb-5 flex flex-wrap gap-2" aria-label="pipelines">
      {pipelines.map((pipeline) => {
        const active = pipeline.id === current?.id;
        return (
          <button
            key={pipeline.id}
            type="button"
            onClick={() => setCurrent(pipeline.id)}
            aria-pressed={active}
            className={cn(
              "rounded-md px-4 py-2 text-sm font-semibold transition-all",
              active
                ? "bg-primary text-primary-foreground shadow-soft"
                : "text-muted-foreground hover:bg-[var(--surface-strong)] hover:text-foreground",
            )}
          >
            {pipeline.name}
          </button>
        );
      })}
    </nav>
  );
};

const DealLayout = ({ pipelineId }: { pipelineId: Identifier }) => {
  const translate = useTranslate();
  const location = useLocation();
  const matchCreate = matchPath("/deals/create", location.pathname);
  const matchEdit = matchPath("/deals/:id", location.pathname);

  return (
    <div className="w-full">
      <DealListContent pipelineId={pipelineId} />
      <DealArchivedList />
      <Link
        to="/deals/create"
        className="fixed right-8 bottom-8 z-20 flex size-14 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_14px_40px_-10px_rgba(239,59,110,0.6)] transition-transform hover:scale-105"
        aria-label={translate("resources.deals.action.new")}
      >
        <Plus className="size-7" strokeWidth={2.2} />
      </Link>
      <DealCreate open={!!matchCreate} pipelineId={pipelineId} />
      <DealEdit open={!!matchEdit && !matchCreate} id={matchEdit?.params.id} />
    </div>
  );
};

const DealActions = () => (
  <TopToolbar className="items-center">
    <FilterButton iconOnly />
    <ExportButton iconOnly />
    <CreateButton label="resources.deals.action.new" />
  </TopToolbar>
);

/**
 * Used so that label of filters can be inferred for the select display,
 * but not be displayed when showing the input.
 */
const WrapperField = ({ children }: InputProps & { children: ReactNode }) =>
  children;

export default DealList;

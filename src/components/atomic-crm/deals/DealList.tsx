import {
  CanAccess,
  useCanAccess,
  useGetIdentity,
  useStore,
  useTranslate,
  type Identifier,
} from "ra-core";
import { Link, matchPath, useLocation, useNavigate } from "react-router";
import { KanbanSquare, List as ListIcon, Plus } from "lucide-react";
import { CreateButton } from "@/components/admin/create-button";
import { ExportButton } from "@/components/admin/export-button";
import { List } from "@/components/admin/list";
import { FilterButton } from "@/components/admin/filter-form";
import { cn } from "@/lib/utils";

import {
  findById,
  getDefaultPipeline,
  usePipelines,
} from "../dictionaries/useDictionaries";
import { TopToolbar } from "../layout/TopToolbar";
import { DealArchivedList } from "./DealArchivedList";
import { DealCreate } from "./DealCreate";
import { DealEdit } from "./DealEdit";
import { DealListContent } from "./DealListContent";
import { DealListView } from "./list/DealListView";
import { SavedFiltersBar } from "./list/SavedFiltersBar";
import { useDealFilters } from "./list/useDealFilters";
import { customFieldsExporter } from "../custom-fields/exporters";
import { useScopedExporter } from "../access-rights/useAccessRights";
import { SORTED_FILTER } from "../unsorted/unsorted";
import { branchFilter } from "../branches/branches";
import { useCurrentBranch } from "../branches/useBranches";

const dealExporter = customFieldsExporter("deal");

export const DEAL_PIPELINE_STORE_KEY = "deals.pipeline_id";
/** «Воронка» or «Список», remembered per user */
export const DEAL_VIEW_STORE_KEY = "deals.view";
export type DealView = "kanban" | "list";

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
  const { current } = useCurrentPipeline();
  // Branches (stage 33): the branch chosen in the top bar
  const { currentId: branchId } = useCurrentBranch();
  const [view] = useStore<DealView>(DEAL_VIEW_STORE_KEY, "kanban");
  const filters = useDealFilters({ pipelineId: current?.id });
  // Access rights (stage 30): the export scope «own» keeps own deals
  const exporter = useScopedExporter("deals", dealExporter);

  if (!identity || !current) return null;

  return (
    <>
      <div className="-mt-2 mb-5 flex flex-wrap items-center gap-4">
        <ViewSwitch />
        {view === "kanban" ? <PipelineTabs /> : null}
      </div>
      {view === "list" ? (
        <DealListView
          actions={<DealActions />}
          exporter={exporter}
          dialogs={<DealDialogs pipelineId={current.id} fab={false} />}
        />
      ) : (
        <List
          key={current.id}
          perPage={500}
          // Unsorted leads have their own column (stage 18)
          filter={{
            "archived_at@is": null,
            ...SORTED_FILTER,
            pipeline_id: current.id,
            ...branchFilter(branchId),
          }}
          title={false}
          exporter={exporter}
          sort={{ field: "index", order: "ASC" }}
          filters={filters}
          actions={<DealActions />}
          pagination={null}
          storeKey={`deals.pipeline.${current.id}`}
        >
          <DealLayout pipelineId={current.id} />
        </List>
      )}
    </>
  );
};

/** «Воронка / Список» (amoCRM) */
const ViewSwitch = () => {
  const translate = useTranslate();
  const navigate = useNavigate();
  const [view, setView] = useStore<DealView>(DEAL_VIEW_STORE_KEY, "kanban");
  const choose = (next: DealView) => {
    if (next === view) return;
    setView(next);
    // Each view keeps its own filters, sort and pages: drop the other's query
    navigate("/deals");
  };
  return (
    <div
      className="inline-flex rounded-md border bg-card p-0.5"
      role="group"
      aria-label={translate("deal_list.view.label")}
    >
      {(
        [
          ["kanban", KanbanSquare],
          ["list", ListIcon],
        ] as const
      ).map(([id, Icon]) => (
        <button
          key={id}
          type="button"
          aria-pressed={view === id}
          onClick={() => choose(id)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm font-semibold transition-colors",
            view === id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-4" />
          {translate(`deal_list.view.${id}`)}
        </button>
      ))}
    </div>
  );
};

/** Pipeline switcher: pills, the current one in ink (Stratus tabs) */
const PipelineTabs = () => {
  const { pipelines, current, setCurrent } = useCurrentPipeline();
  if (pipelines.length < 2) return null;
  return (
    <nav className="flex flex-wrap gap-2" aria-label="pipelines">
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

const DealLayout = ({ pipelineId }: { pipelineId: Identifier }) => (
  <div className="w-full">
    <SavedFiltersBar />
    <DealListContent pipelineId={pipelineId} />
    <DealArchivedList />
    <DealDialogs pipelineId={pipelineId} />
  </div>
);

/** New deal button and the create / edit dialogs of both views */
const DealDialogs = ({
  pipelineId,
  fab = true,
}: {
  pipelineId: Identifier;
  /** The round «+» of the board (the list has the toolbar button) */
  fab?: boolean;
}) => {
  const translate = useTranslate();
  const location = useLocation();
  const matchCreate = matchPath("/deals/create", location.pathname);
  const matchEdit = matchPath("/deals/:id", location.pathname);
  // The integrator (stage 25) only reads the deals
  const { canAccess: canCreate } = useCanAccess({
    resource: "deals",
    action: "create",
  });
  return (
    <>
      {fab && canCreate ? (
        <Link
          to="/deals/create"
          className="fixed right-8 bottom-8 z-20 flex size-14 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-[0_14px_40px_-10px_rgba(239,59,110,0.6)] transition-transform hover:scale-105"
          aria-label={translate("resources.deals.action.new")}
        >
          <Plus className="size-7" strokeWidth={2.2} />
        </Link>
      ) : null}
      <DealCreate open={!!matchCreate} pipelineId={pipelineId} />
      <DealEdit open={!!matchEdit && !matchCreate} id={matchEdit?.params.id} />
    </>
  );
};

const DealActions = () => (
  <TopToolbar className="items-center">
    <FilterButton iconOnly />
    <CanAccess resource="deals" action="export">
      <ExportButton iconOnly />
    </CanAccess>
    <DigitalPipelineButton />
    <CanAccess resource="deals" action="create">
      <CreateButton label="resources.deals.action.new" />
    </CanAccess>
  </TopToolbar>
);

/** «Цифровая воронка» of the current pipeline (owner and head) */
const DigitalPipelineButton = () => {
  const translate = useTranslate();
  const { current } = useCurrentPipeline();
  const { canAccess } = useCanAccess({
    resource: "configuration",
    action: "edit",
  });
  if (!canAccess || !current) return null;
  return (
    <Link
      to={`/settings?section=pipeline_automation&pipeline=${current.id}`}
      title={translate("pipeline_automation.open_hint")}
      className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium text-foreground no-underline hover:bg-accent"
    >
      {translate("pipeline_automation.open")}
    </Link>
  );
};

export default DealList;

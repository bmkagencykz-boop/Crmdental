import { ChevronDown } from "lucide-react";
import {
  useDataProvider,
  useGetList,
  useGetMany,
  useListContext,
  useNotify,
  useRefresh,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import {
  useLostReasons,
  usePipelines,
  useStages,
} from "../../dictionaries/useDictionaries";
import type { CrmDataProvider } from "../../providers/types";
import { TASK_TYPES } from "../../tasks/taskTypes";
import type { Deal, MessageTemplate, Sale, Tag } from "../../types";
import {
  BULK_ACTIONS,
  BULK_MAX,
  chunk,
  isAllowedAction,
  mergeResults,
  type BulkActionId,
  type BulkDealsAction,
  type BulkDealsResult,
  type BulkParams,
} from "./bulk";
import { exportDealsCsv } from "./exportDeals";
import { useIsAdmin } from "./useIsAdmin";

const NONE = "none";

/**
 * Bulk actions of the deal list: the selection bar (count, «all matching the
 * filter», clear) and the actions. Every database action goes through
 * public.bulk_deals in chunks, with the progress, then the per-deal results.
 */
export const BulkActions = ({
  allMatching,
  setAllMatching,
  permanentFilter,
}: {
  allMatching: boolean;
  setAllMatching: (value: boolean) => void;
  permanentFilter: Record<string, unknown>;
}) => {
  const translate = useTranslate();
  const isAdmin = useIsAdmin();
  const { selectedIds, onUnselectItems, total, data, filterValues, sort } =
    useListContext<Deal>();
  const [action, setAction] = useState<BulkActionId | null>(null);
  const count = allMatching
    ? Math.min(total ?? 0, BULK_MAX)
    : selectedIds.length;
  const pageIds = (data ?? []).map((deal) => deal.id);
  const pageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));

  if (!count) return null;

  const clear = () => {
    setAllMatching(false);
    onUnselectItems();
  };

  return (
    <div
      className="sticky bottom-4 z-20 mt-3 flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-2.5 shadow-lg"
      role="region"
      aria-label={translate("deal_list.bulk.title")}
    >
      <span className="text-sm font-semibold" aria-live="polite">
        {translate("deal_list.bulk.selected", { smart_count: count })}
      </span>
      {!allMatching && pageSelected && (total ?? 0) > pageIds.length ? (
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0"
          onClick={() => setAllMatching(true)}
        >
          {translate("deal_list.bulk.select_all_matching", {
            smart_count: Math.min(total ?? 0, BULK_MAX),
          })}
        </Button>
      ) : null}
      <Button variant="ghost" size="sm" className="h-7" onClick={clear}>
        {translate("deal_list.bulk.clear")}
      </Button>
      <div className="ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="h-8 gap-1">
              {translate("deal_list.bulk.actions")}
              <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {BULK_ACTIONS.filter((id) =>
              isAllowedAction(id, isAdmin ? "owner" : "manager"),
            ).map((id) => (
              <span key={id}>
                {id === "export" || id === "archive" ? (
                  <DropdownMenuSeparator />
                ) : null}
                <DropdownMenuItem onSelect={() => setAction(id)}>
                  {translate(`deal_list.bulk.action.${id}`)}
                </DropdownMenuItem>
              </span>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {action ? (
        <BulkDialog
          action={action}
          count={count}
          onClose={(done) => {
            setAction(null);
            if (done) clear();
          }}
          resolveIds={async (dataProvider) => {
            if (!allMatching) return { ids: selectedIds, deals: [] as Deal[] };
            const { data: deals } = await dataProvider.getList<Deal>("deals", {
              filter: { ...filterValues, ...permanentFilter },
              sort,
              pagination: { page: 1, perPage: BULK_MAX },
            });
            return { ids: deals.map((deal) => deal.id), deals };
          }}
        />
      ) : null}
    </div>
  );
};

type Phase =
  | { step: "form" }
  | { step: "running"; done: number; total: number }
  | { step: "results"; result: BulkDealsResult };

const BulkDialog = ({
  action,
  count,
  onClose,
  resolveIds,
}: {
  action: BulkActionId;
  count: number;
  onClose: (done: boolean) => void;
  resolveIds: (
    dataProvider: CrmDataProvider,
  ) => Promise<{ ids: Identifier[]; deals: Deal[] }>;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefresh();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [params, setParams] = useState<BulkParams>(() =>
    action === "task"
      ? { type: "call", due_date: tomorrowAt10(), text: "" }
      : {},
  );
  const [phase, setPhase] = useState<Phase>({ step: "form" });
  const set = (patch: Partial<BulkParams>) =>
    setParams((current) => ({ ...current, ...patch }));

  const run = async () => {
    try {
      setPhase({ step: "running", done: 0, total: count });
      const { ids, deals } = await resolveIds(dataProvider);
      if (action === "export") {
        const rows = deals.length
          ? deals
          : (await dataProvider.getMany<Deal>("deals", { ids })).data;
        await exportDealsCsv(rows, dataProvider, translate);
        notify("deal_list.bulk.exported", {
          type: "info",
          messageArgs: { smart_count: rows.length },
        });
        onClose(false);
        return;
      }
      const answers: BulkDealsResult[] = [];
      let done = 0;
      setPhase({ step: "running", done, total: ids.length });
      // A message is one mailing: all the deals at once
      const chunks = action === "message" ? [ids] : chunk(ids);
      for (const part of chunks) {
        answers.push(
          await dataProvider.bulkDeals(action as BulkDealsAction, part, params),
        );
        done += part.length;
        setPhase({ step: "running", done, total: ids.length });
      }
      setPhase({
        step: "results",
        result: mergeResults(action as BulkDealsAction, answers),
      });
      refresh();
    } catch (error) {
      notify(
        translate((error as Error)?.message || "ra.notification.http_error", {
          _: (error as Error)?.message,
        }),
        { type: "error" },
      );
      setPhase({ step: "form" });
    }
  };

  const valid = isValid(action, params);
  const title = translate(`deal_list.bulk.action.${action}`);

  return (
    <Dialog
      open
      onOpenChange={(open) =>
        !open && phase.step !== "running" && onClose(phase.step === "results")
      }
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {translate("deal_list.bulk.for_deals", { smart_count: count })}
          </DialogDescription>
        </DialogHeader>
        {phase.step === "form" ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (valid) run();
            }}
          >
            <BulkForm action={action} params={params} set={set} />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onClose(false)}
              >
                {translate("ra.action.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={!valid}
                variant={action === "delete" ? "destructive" : "default"}
              >
                {translate(
                  action === "delete"
                    ? "deal_list.bulk.confirm_delete"
                    : "deal_list.bulk.run",
                )}
              </Button>
            </DialogFooter>
          </form>
        ) : phase.step === "running" ? (
          <div className="flex flex-col gap-2 py-2" role="status">
            <Progress
              value={phase.total ? (phase.done / phase.total) * 100 : 0}
              aria-label={translate("deal_list.bulk.progress")}
            />
            <p className="text-sm text-muted-foreground tabular-nums">
              {translate("deal_list.bulk.progress_count", {
                done: phase.done,
                total: phase.total,
              })}
            </p>
          </div>
        ) : (
          <BulkResults result={phase.result} onClose={() => onClose(true)} />
        )}
      </DialogContent>
    </Dialog>
  );
};

const tomorrowAt10 = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(10, 0, 0, 0);
  return date.toISOString();
};

/** "2026-09-28T10:00" for the datetime-local input */
const toLocalInput = (iso?: string) => {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const isValid = (action: BulkActionId, params: BulkParams) => {
  switch (action) {
    case "stage":
      return params.stage_id != null;
    case "add_tags":
    case "remove_tags":
      return !!params.tag_ids?.length;
    case "task":
      return !!params.text?.trim() && !!params.due_date;
    case "message":
      return params.template_id != null || !!params.body?.trim();
    default:
      return true;
  }
};

const Field = ({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) => (
  <div className="flex flex-col gap-1.5">
    <Label htmlFor={htmlFor}>{label}</Label>
    {children}
  </div>
);

const BulkForm = ({
  action,
  params,
  set,
}: {
  action: BulkActionId;
  params: BulkParams;
  set: (patch: Partial<BulkParams>) => void;
}) => {
  const translate = useTranslate();
  const { data: stages } = useStages();
  const { data: pipelines } = usePipelines();
  const { data: reasons } = useLostReasons();
  const { data: sales = [] } = useGetList<Sale>(
    "sales",
    {
      pagination: { page: 1, perPage: 500 },
      sort: { field: "last_name", order: "ASC" },
      filter: { "disabled@neq": true },
    },
    { enabled: action === "responsible" || action === "task" },
  );
  const { data: tags = [] } = useGetList<Tag>(
    "tags",
    {
      pagination: { page: 1, perPage: 500 },
      sort: { field: "name", order: "ASC" },
    },
    { enabled: action === "add_tags" || action === "remove_tags" },
  );
  const { data: templates = [] } = useGetList<MessageTemplate>(
    "message_templates",
    {
      pagination: { page: 1, perPage: 200 },
      sort: { field: "position", order: "ASC" },
    },
    { enabled: action === "message" },
  );

  switch (action) {
    case "stage": {
      const stage = stages.find(
        (s) => String(s.id) === String(params.stage_id),
      );
      return (
        <>
          <Field label={translate("deal_list.bulk.stage")}>
            <Select
              value={params.stage_id != null ? String(params.stage_id) : ""}
              onValueChange={(value) => set({ stage_id: Number(value) })}
            >
              <SelectTrigger aria-label={translate("deal_list.bulk.stage")}>
                <SelectValue placeholder={translate("deal_list.bulk.choose")} />
              </SelectTrigger>
              <SelectContent>
                {pipelines.flatMap((pipeline) =>
                  stages
                    .filter(
                      (s) => String(s.pipeline_id) === String(pipeline.id),
                    )
                    .sort((a, b) => a.position - b.position)
                    .map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {pipelines.length > 1
                          ? `${pipeline.name} · ${s.name}`
                          : s.name}
                      </SelectItem>
                    )),
                )}
              </SelectContent>
            </Select>
          </Field>
          {stage?.kind === "lost" ? (
            <>
              <Field label={translate("deal_list.bulk.lost_reason")}>
                <Select
                  value={
                    params.lost_reason_id != null
                      ? String(params.lost_reason_id)
                      : ""
                  }
                  onValueChange={(value) =>
                    set({ lost_reason_id: Number(value) })
                  }
                >
                  <SelectTrigger
                    aria-label={translate("deal_list.bulk.lost_reason")}
                  >
                    <SelectValue
                      placeholder={translate("deal_list.bulk.choose")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {reasons
                      .filter((reason) => !reason.is_archived)
                      .map((reason) => (
                        <SelectItem key={reason.id} value={String(reason.id)}>
                          {reason.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label={translate("crm.deals.lost.comment")}
                htmlFor="bulk-lost-comment"
              >
                <Textarea
                  id="bulk-lost-comment"
                  value={params.lost_comment ?? ""}
                  onChange={(event) =>
                    set({ lost_comment: event.target.value })
                  }
                />
              </Field>
            </>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {translate("deal_list.bulk.stage_hint")}
          </p>
        </>
      );
    }
    case "responsible":
      return (
        <Field label={translate("deal_list.bulk.responsible")}>
          <Select
            value={
              params.sales_id === undefined
                ? ""
                : params.sales_id === null
                  ? NONE
                  : String(params.sales_id)
            }
            onValueChange={(value) =>
              set({ sales_id: value === NONE ? null : Number(value) })
            }
          >
            <SelectTrigger aria-label={translate("deal_list.bulk.responsible")}>
              <SelectValue placeholder={translate("deal_list.bulk.choose")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>
                {translate("crm.deals.unassigned")}
              </SelectItem>
              {sales.map((sale) => (
                <SelectItem key={sale.id} value={String(sale.id)}>
                  {`${sale.first_name} ${sale.last_name}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      );
    case "add_tags":
    case "remove_tags":
      return (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">
            {translate("deal_list.bulk.tags")}
          </legend>
          <div className="flex flex-wrap gap-3">
            {tags.map((tag) => {
              const checked = (params.tag_ids ?? []).some(
                (id) => String(id) === String(tag.id),
              );
              return (
                <label
                  key={tag.id}
                  className="flex items-center gap-1.5 text-sm"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() =>
                      set({
                        tag_ids: checked
                          ? (params.tag_ids ?? []).filter(
                              (id) => String(id) !== String(tag.id),
                            )
                          : [...(params.tag_ids ?? []), tag.id],
                      })
                    }
                  />
                  {tag.name}
                </label>
              );
            })}
          </div>
        </fieldset>
      );
    case "task":
      return (
        <>
          <Field label={translate("deal_list.bulk.task_type")}>
            <Select
              value={params.type ?? "call"}
              onValueChange={(type) => set({ type })}
            >
              <SelectTrigger aria-label={translate("deal_list.bulk.task_type")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {translate(`crm.tasks.types.${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label={translate("deal_list.bulk.task_text")}
            htmlFor="bulk-task-text"
          >
            <Textarea
              id="bulk-task-text"
              value={params.text ?? ""}
              onChange={(event) => set({ text: event.target.value })}
            />
          </Field>
          <Field
            label={translate("deal_list.bulk.task_due")}
            htmlFor="bulk-task-due"
          >
            <Input
              id="bulk-task-due"
              type="datetime-local"
              value={toLocalInput(params.due_date)}
              onChange={(event) =>
                set({
                  due_date: event.target.value
                    ? new Date(event.target.value).toISOString()
                    : undefined,
                })
              }
            />
          </Field>
          <Field label={translate("deal_list.bulk.task_assignee")}>
            <Select
              value={params.sales_id != null ? String(params.sales_id) : NONE}
              onValueChange={(value) =>
                set({ sales_id: value === NONE ? null : Number(value) })
              }
            >
              <SelectTrigger
                aria-label={translate("deal_list.bulk.task_assignee")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>
                  {translate("deal_list.bulk.deal_responsible")}
                </SelectItem>
                {sales.map((sale) => (
                  <SelectItem key={sale.id} value={String(sale.id)}>
                    {`${sale.first_name} ${sale.last_name}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </>
      );
    case "message": {
      const template = templates.find(
        (t) => String(t.id) === String(params.template_id),
      );
      return (
        <>
          <Field label={translate("deal_list.bulk.template")}>
            <Select
              value={
                params.template_id != null ? String(params.template_id) : ""
              }
              onValueChange={(value) => set({ template_id: Number(value) })}
            >
              <SelectTrigger aria-label={translate("deal_list.bulk.template")}>
                <SelectValue placeholder={translate("deal_list.bulk.choose")} />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {template ? (
            <p className="rounded-md bg-muted p-3 text-sm whitespace-pre-wrap">
              {template.body}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {translate("deal_list.bulk.message_hint")}
          </p>
        </>
      );
    }
    case "export":
      return (
        <p className="text-sm text-muted-foreground">
          {translate("deal_list.bulk.export_hint")}
        </p>
      );
    case "archive":
      return (
        <p className="text-sm text-muted-foreground">
          {translate("deal_list.bulk.archive_hint")}
        </p>
      );
    case "delete":
      return (
        <p className="text-sm text-destructive">
          {translate("deal_list.bulk.delete_hint")}
        </p>
      );
  }
};

const BulkResults = ({
  result,
  onClose,
}: {
  result: BulkDealsResult;
  onClose: () => void;
}) => {
  const translate = useTranslate();
  const failures = result.results.filter((r) => !r.ok);
  const { data: deals = [] } = useGetMany<Deal>(
    "deals",
    { ids: failures.map((f) => f.id).filter((id) => Number(id) > 0) },
    { enabled: failures.length > 0 && result.action !== "delete" },
  );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm" role="status">
        {translate("deal_list.bulk.result_ok", { smart_count: result.ok })}
        {result.failed
          ? ` · ${translate("deal_list.bulk.result_failed", {
              smart_count: result.failed,
            })}`
          : null}
      </p>
      {result.action === "message" && result.ok ? (
        <p className="text-xs text-muted-foreground">
          {translate("deal_list.bulk.message_queued")}{" "}
          <Link to="/mailings" className="text-brand-link">
            {translate("deal_list.bulk.open_mailings")}
          </Link>
        </p>
      ) : null}
      {failures.length ? (
        <ul
          className="max-h-72 divide-y overflow-y-auto rounded-md border text-sm"
          aria-label={translate("deal_list.bulk.failures")}
        >
          {failures.map((failure) => {
            const deal = deals.find((d) => String(d.id) === String(failure.id));
            return (
              <li key={failure.id} className="flex flex-col px-3 py-2">
                <span className="font-medium">
                  {deal?.name ||
                    translate("deal_list.bulk.deal_number", { id: failure.id })}
                </span>
                <span className="text-destructive">{failure.error}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <DialogFooter>
        <Button onClick={onClose}>{translate("deal_list.bulk.done")}</Button>
      </DialogFooter>
    </div>
  );
};

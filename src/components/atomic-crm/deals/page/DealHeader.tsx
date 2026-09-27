import { useMutation } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  useDataProvider,
  useDelete,
  useNotify,
  useRedirect,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useState } from "react";
import { Link } from "react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { accent, onAccent } from "../../misc/accent";

import {
  findById,
  getPipelineStages,
  usePipelines,
  useStages,
} from "../../dictionaries/useDictionaries";
import type { CrmDataProvider } from "../../providers/types";
import type { Deal } from "../../types";
import { LostReasonDialog } from "../LostReasonDialog";
import { useDealUpdate } from "./useDealUpdate";

/** Title, actions, pipeline and stage with its progress bar (amoCRM style) */
export const DealHeader = ({ deal }: { deal: Deal }) => {
  const translate = useTranslate();
  const { save } = useDealUpdate(deal);
  const [editingTitle, setEditingTitle] = useState(false);
  const title =
    deal.name || translate("crm.deals.page.number", { id: deal.id });

  return (
    <div className="flex flex-col gap-4 px-6 pt-5 pb-4">
      <div className="flex items-start gap-2">
        <Link
          to="/deals"
          className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-card hover:text-foreground"
          aria-label={translate("crm.deals.page.back")}
        >
          <ChevronLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          {editingTitle ? (
            <Input
              autoFocus
              defaultValue={deal.name ?? ""}
              aria-label={translate("resources.deals.fields.name")}
              className="h-9 text-lg font-bold"
              onBlur={(event) => {
                setEditingTitle(false);
                const name = event.target.value.trim() || null;
                if (name !== (deal.name ?? null)) save({ name });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter")
                  (event.target as HTMLInputElement).blur();
                if (event.key === "Escape") setEditingTitle(false);
              }}
            />
          ) : (
            <h1
              className="cursor-text break-words text-[1.35rem] font-bold leading-tight tracking-[-0.02em]"
              onClick={() => setEditingTitle(true)}
              title={translate("ra.action.edit")}
            >
              {title}
            </h1>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">
            {translate("crm.deals.page.number", { id: deal.id })}
          </p>
        </div>
        <DealMenu deal={deal} />
      </div>
      <StageBar deal={deal} />
    </div>
  );
};

const DealMenu = ({ deal }: { deal: Deal }) => {
  const translate = useTranslate();
  const redirect = useRedirect();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { save } = useDealUpdate(deal);
  const [remove] = useDelete();
  const unarchive = useMutation({
    mutationFn: () => dataProvider.unarchiveDeal(deal),
    onSuccess: () =>
      notify("resources.deals.unarchived.success", { type: "info" }),
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-card"
        aria-label={translate("crm.deals.page.actions")}
      >
        <MoreHorizontal className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link to={`/deals/${deal.id}`}>
            <Pencil className="size-4" />
            {translate("crm.deals.page.edit_all")}
          </Link>
        </DropdownMenuItem>
        {deal.archived_at ? (
          <DropdownMenuItem onClick={() => unarchive.mutate()}>
            <ArchiveRestore className="size-4" />
            {translate("resources.deals.unarchived.action")}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onClick={() =>
              save({ archived_at: new Date().toISOString() }, () => {
                notify("resources.deals.archived.success", { type: "info" });
                redirect("/deals");
              })
            }
          >
            <Archive className="size-4" />
            {translate("resources.deals.archived.action")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className="text-destructive"
          onClick={() =>
            remove(
              "deals",
              { id: deal.id, previousData: deal },
              {
                mutationMode: "pessimistic",
                onSuccess: () => redirect("/deals"),
              },
            )
          }
        >
          <Trash2 className="size-4" />
          {translate("ra.action.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** Days spent in the current stage */
export const daysInStage = (since?: string | null, now = new Date()) =>
  since
    ? Math.max(
        0,
        Math.floor((now.getTime() - new Date(since).getTime()) / 86_400_000),
      )
    : 0;

/**
 * Pipeline and stage, picked from a list like in amoCRM, with a bar showing
 * how far the deal went. Moving to a lost stage asks for the reason.
 */
const StageBar = ({ deal }: { deal: Deal }) => {
  const translate = useTranslate();
  const { data: pipelines } = usePipelines();
  const { data: allStages } = useStages();
  const { save } = useDealUpdate(deal);
  const [lostStageId, setLostStageId] = useState<Identifier | null>(null);
  const stages = getPipelineStages(allStages, deal.pipeline_id);
  const stage = findById(stages, deal.stage_id);
  const index = stages.findIndex((s) => s.id === stage?.id);
  const days = daysInStage(deal.stage_changed_at ?? deal.created_at);

  const change = (stageId: string) => {
    const target = findById(stages, stageId);
    if (!target || target.id === deal.stage_id) return;
    if (target.kind === "lost") setLostStageId(target.id);
    else save({ stage_id: target.id });
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {findById(pipelines, deal.pipeline_id)?.name}
      </p>
      <label
        className="relative flex items-center gap-2 rounded-md px-4 py-1.5"
        style={{
          backgroundColor: accent(stage?.color),
          color: onAccent(stage?.color),
        }}
      >
        <span className="sr-only">
          {translate("resources.deals.fields.stage_id")}
        </span>
        <select
          value={String(deal.stage_id)}
          onChange={(event) => change(event.target.value)}
          aria-label={translate("resources.deals.fields.stage_id")}
          className="w-full cursor-pointer appearance-none bg-transparent py-1 pr-6 text-[15px] font-bold outline-none [&>option]:bg-card [&>option]:text-foreground"
        >
          {stages.map((s) => (
            <option key={s.id} value={String(s.id)}>
              {s.name}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-4 text-xs opacity-70">
          ▾
        </span>
      </label>
      <div className="flex items-center gap-2">
        <div className="flex h-1.5 flex-1 gap-0.5" aria-hidden>
          {stages
            .filter((s) => s.kind !== "lost")
            .map((s, position) => (
              <span
                key={s.id}
                className={cn("flex-1 rounded-sm bg-muted")}
                style={
                  stage?.kind === "lost"
                    ? { backgroundColor: "var(--color-brand-red)" }
                    : position <= index
                      ? { backgroundColor: accent(stage?.color ?? s.color) }
                      : undefined
                }
              />
            ))}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {translate("crm.deals.page.days_in_stage", { smart_count: days })}
        </span>
      </div>
      <LostReasonDialog
        open={lostStageId != null}
        onCancel={() => setLostStageId(null)}
        onConfirm={(reasonId, comment) => {
          save({
            stage_id: lostStageId!,
            lost_reason_id: reasonId,
            lost_comment: comment || null,
          });
          setLostStageId(null);
        }}
      />
    </div>
  );
};

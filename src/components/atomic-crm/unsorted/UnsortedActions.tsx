import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useCanAccess,
  useDataProvider,
  useGetList,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  findById,
  usePipelines,
  useStages,
} from "../dictionaries/useDictionaries";
import { patientDisplayName } from "../patients/parsePatientText";
import type { CrmDataProvider } from "../providers/types";
import type { Deal, Sale } from "../types";
import {
  acceptStageChoices,
  defaultAcceptStage,
  mergeTargets,
  SORTED_FILTER,
} from "./unsorted";

type Lead = Pick<Deal, "id" | "patient_id" | "pipeline_id"> & {
  sales_id?: Identifier | null;
};

const BY_RULE = "by_rule";

/** Error of a stage 18 function as a translatable message */
const unsortedError = (error: any) => {
  const hints: Record<string, string> = {
    deal_not_unsorted: "unsorted.errors.not_unsorted",
    unsorted_stage_not_open: "unsorted.errors.stage_not_open",
    unsorted_merge_target: "unsorted.errors.merge_target",
    unsorted_sales_unknown: "unsorted.errors.sales_unknown",
  };
  return hints[error?.hint] ?? error?.message ?? "ra.notification.http_error";
};

/** Everything a sorted lead changes: the board, the lead, its history */
const useRefresh = () => {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      [
        "deals",
        "unsorted_leads",
        "patients",
        "tasks",
        "messages",
        "deal_notes",
        "deal_events",
        "calls",
        "automessages",
        "lost_reasons",
      ].map((resource) =>
        queryClient.invalidateQueries({ queryKey: [resource] }),
      ),
    );
};

/**
 * «Принять», «Отклонить», «Объединить с…» of an unsorted lead (board card,
 * deal page, inbox). onMerged: the deal the lead went into.
 */
export const UnsortedActions = ({
  lead,
  compact = false,
  onMerged,
}: {
  lead: Lead;
  compact?: boolean;
  onMerged?: (dealId: Identifier) => void;
}) => {
  const translate = useTranslate();
  const [dialog, setDialog] = useState<"accept" | "reject" | "merge" | null>(
    null,
  );
  // The integrator (stage 25) only reads the deals
  const { canAccess: canEdit } = useCanAccess({
    resource: "deals",
    action: "edit",
  });
  if (canEdit === false) return null;
  return (
    <div
      className={cn("flex flex-wrap gap-1.5", compact && "gap-1")}
      onClick={(event) => event.stopPropagation()}
    >
      <Button
        size="sm"
        className={cn(compact && "h-7 px-2 text-xs")}
        onClick={() => setDialog("accept")}
      >
        {translate("unsorted.actions.accept")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className={cn(compact && "h-7 px-2 text-xs")}
        onClick={() => setDialog("reject")}
      >
        {translate("unsorted.actions.reject")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className={cn(compact && "h-7 px-2 text-xs")}
        onClick={() => setDialog("merge")}
      >
        {translate("unsorted.actions.merge")}
      </Button>
      {dialog === "accept" ? (
        <AcceptDialog lead={lead} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "reject" ? (
        <RejectDialog lead={lead} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "merge" ? (
        <MergeDialog
          lead={lead}
          onClose={() => setDialog(null)}
          onMerged={onMerged}
        />
      ) : null}
    </div>
  );
};

const AcceptDialog = ({
  lead,
  onClose,
}: {
  lead: Lead;
  onClose: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefresh();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { data: stages } = useStages();
  const { data: pipelines } = usePipelines();
  const { data: sales = [] } = useGetList<Sale>("sales", {
    filter: { "disabled@neq": true },
    sort: { field: "last_name", order: "ASC" },
    pagination: { page: 1, perPage: 100 },
  });
  const choices = acceptStageChoices(stages, pipelines);
  const [stageId, setStageId] = useState<string>("");
  const [salesId, setSalesId] = useState<string>(
    lead.sales_id != null ? String(lead.sales_id) : BY_RULE,
  );
  useEffect(() => {
    if (!stageId) {
      const stage = defaultAcceptStage(stages, lead.pipeline_id);
      if (stage) setStageId(String(stage.id));
    }
  }, [stages, lead.pipeline_id, stageId]);
  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      dataProvider.acceptUnsorted(
        lead.id,
        stageId ? Number(stageId) : null,
        salesId === BY_RULE ? null : Number(salesId),
      ),
    onSuccess: async () => {
      await refresh();
      notify("unsorted.notify.accepted", { type: "info" });
      onClose();
    },
    onError: (error) => notify(unsortedError(error), { type: "error" }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{translate("unsorted.accept_dialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label>{translate("unsorted.accept_dialog.stage")}</Label>
          <Select value={stageId} onValueChange={setStageId}>
            <SelectTrigger
              aria-label={translate("unsorted.accept_dialog.stage")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem key={choice.id} value={String(choice.id)}>
                  {choice.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label>{translate("unsorted.accept_dialog.responsible")}</Label>
          <Select value={salesId} onValueChange={setSalesId}>
            <SelectTrigger
              aria-label={translate("unsorted.accept_dialog.responsible")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={BY_RULE}>
                {translate("unsorted.accept_dialog.by_rule")}
              </SelectItem>
              {sales.map((sale) => (
                <SelectItem key={sale.id} value={String(sale.id)}>
                  {sale.first_name} {sale.last_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {translate("ra.action.cancel")}
          </Button>
          <Button disabled={!stageId || isPending} onClick={() => mutate()}>
            {translate("unsorted.accept_dialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const RejectDialog = ({
  lead,
  onClose,
}: {
  lead: Lead;
  onClose: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefresh();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [comment, setComment] = useState("");
  const { mutate, isPending } = useMutation({
    mutationFn: () => dataProvider.rejectUnsorted(lead.id, comment),
    onSuccess: async () => {
      await refresh();
      notify("unsorted.notify.rejected", { type: "info" });
      onClose();
    },
    onError: (error) => notify(unsortedError(error), { type: "error" }),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{translate("unsorted.reject_dialog.title")}</DialogTitle>
          <DialogDescription>
            {translate("unsorted.reject_dialog.hint")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="unsorted-reject-comment">
            {translate("unsorted.reject_dialog.comment")}
          </Label>
          <Textarea
            id="unsorted-reject-comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {translate("ra.action.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={isPending}
            onClick={() => mutate()}
          >
            {translate("unsorted.reject_dialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const MergeDialog = ({
  lead,
  onClose,
  onMerged,
}: {
  lead: Lead;
  onClose: () => void;
  onMerged?: (dealId: Identifier) => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefresh();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { data: stages } = useStages();
  const [search, setSearch] = useState("");
  const [targetId, setTargetId] = useState<Identifier | null>(null);
  const query = search.trim();
  const { data: found = [] } = useGetList<Deal>("deals", {
    filter: {
      ...SORTED_FILTER,
      "archived_at@is": null,
      ...(query ? { q: query } : {}),
    },
    sort: { field: "updated_at", order: "DESC" },
    pagination: { page: 1, perPage: 30 },
  });
  const { data: own = [] } = useGetList<Deal>("deals", {
    filter: { ...SORTED_FILTER, patient_id: lead.patient_id },
    sort: { field: "updated_at", order: "DESC" },
    pagination: { page: 1, perPage: 30 },
  });
  const targets = useMemo(() => {
    const byId = new Map(
      [...(query ? [] : own), ...found].map((deal) => [String(deal.id), deal]),
    );
    return mergeTargets([...byId.values()], stages, lead);
  }, [found, own, stages, lead, query]);
  const { mutate, isPending } = useMutation({
    mutationFn: () => dataProvider.mergeUnsorted(lead.id, targetId!),
    onSuccess: (result) => {
      notify("unsorted.notify.merged", { type: "info" });
      onClose();
      // Leave the page of the deleted lead before refreshing, so that it is
      // not fetched again
      onMerged?.(result.deal_id);
      setTimeout(() => void refresh(), 0);
    },
    onError: (error) => notify(unsortedError(error), { type: "error" }),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{translate("unsorted.merge_dialog.title")}</DialogTitle>
          <DialogDescription>
            {translate("unsorted.merge_dialog.hint")}
          </DialogDescription>
        </DialogHeader>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={translate("unsorted.merge_dialog.search")}
          aria-label={translate("unsorted.merge_dialog.search")}
        />
        <ul
          className="flex max-h-72 flex-col gap-1 overflow-y-auto"
          role="radiogroup"
        >
          {targets.map((deal) => {
            const stage = findById(stages, deal.stage_id);
            const active = targetId === deal.id;
            const samePatient =
              String(deal.patient_id) === String(lead.patient_id);
            return (
              <li key={deal.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTargetId(deal.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                    active
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-card",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">
                      {patientDisplayName({
                        last_name: deal.patient_last_name,
                        first_name: deal.patient_first_name,
                      }) || deal.patient_phone}
                      {samePatient ? (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          ({translate("unsorted.merge_dialog.same_patient")})
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[
                        deal.name || translate("crm.deals.untitled"),
                        stage?.name,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    #{deal.id}
                  </span>
                </button>
              </li>
            );
          })}
          {!targets.length ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              {translate("unsorted.merge_dialog.empty")}
            </li>
          ) : null}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {translate("ra.action.cancel")}
          </Button>
          <Button
            disabled={targetId == null || isPending}
            onClick={() => mutate()}
          >
            {translate("unsorted.merge_dialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

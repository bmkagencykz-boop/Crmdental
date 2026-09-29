import {
  useCanAccess,
  useDelete,
  useListContext,
  useNotify,
  useRecordContext,
  useRedirect,
  useRefresh,
  useTranslate,
  useUpdate,
  useUpdateMany,
} from "ra-core";
import { useState } from "react";
import { Confirm } from "@/components/admin/confirm";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ruDate } from "../patient-card/consents";
import type { Patient } from "../types";
import { ARCHIVED_FILTER, isArchived } from "./dataSafety";

const errorText = (error: unknown) =>
  (error as { message?: string })?.message || "data_safety.errors.generic";

/**
 * «В архив» / «Вернуть из архива» of the patient card (stage 41), and the
 * hard deletion for the owner (a patient without money, visits or medical
 * rows; the database refuses the others with a clear message).
 */
export const PatientArchiveActions = () => {
  const record = useRecordContext<Patient>();
  const translate = useTranslate();
  const notify = useNotify();
  const redirect = useRedirect();
  const [update, { isPending }] = useUpdate();
  const [deleteOne, { isPending: deleting }] = useDelete();
  const [confirm, setConfirm] = useState<"archive" | "delete" | null>(null);
  const { canAccess: canArchive } = useCanAccess({
    resource: "patients",
    action: "archive",
    record,
  });
  const { canAccess: canRestore } = useCanAccess({
    resource: "patients",
    action: "restore",
    record,
  });
  const { canAccess: canDelete } = useCanAccess({
    resource: "patients",
    action: "delete",
    record,
  });
  if (!record) return null;
  const archived = isArchived(record);
  if (!canArchive && !canRestore && !canDelete) return null;

  const setArchived = (value: boolean) =>
    update(
      "patients",
      {
        id: record.id,
        data: { archived_at: value ? new Date().toISOString() : null },
        previousData: record,
      },
      {
        mutationMode: "pessimistic",
        onSuccess: () => {
          setConfirm(null);
          notify(
            value ? "data_safety.archive.done" : "data_safety.archive.restored",
            { type: "info" },
          );
        },
        onError: (error) => {
          setConfirm(null);
          notify(errorText(error), { type: "error" });
        },
      },
    );

  return (
    <div
      className="flex flex-col gap-2 border-t border-border pt-4"
      data-testid="patient-archive"
    >
      {archived ? (
        <>
          <p className="text-sm text-muted-foreground">
            {translate("data_safety.archive.since", {
              date: ruDate(record.archived_at!),
            })}
          </p>
          {canRestore ? (
            <Button
              variant="outline"
              size="sm"
              className="w-fit rounded-full"
              disabled={isPending}
              onClick={() => setArchived(false)}
            >
              {translate("data_safety.archive.restore")}
            </Button>
          ) : null}
        </>
      ) : canArchive ? (
        <Button
          variant="outline"
          size="sm"
          className="w-fit rounded-full"
          disabled={isPending}
          onClick={() => setConfirm("archive")}
        >
          {translate("data_safety.archive.action")}
        </Button>
      ) : null}
      {canDelete ? (
        <button
          type="button"
          className="w-fit text-xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
          onClick={() => setConfirm("delete")}
        >
          {translate("data_safety.delete.action")}
        </button>
      ) : null}
      <Confirm
        isOpen={confirm === "archive"}
        title="data_safety.archive.confirm_title"
        content="data_safety.archive.confirm_text"
        confirm="data_safety.archive.action"
        loading={isPending}
        onConfirm={() => setArchived(true)}
        onClose={() => setConfirm(null)}
      />
      <Confirm
        isOpen={confirm === "delete"}
        title="data_safety.delete.confirm_title"
        content="data_safety.delete.confirm_text"
        confirm="data_safety.delete.action"
        confirmColor="warning"
        loading={deleting}
        onConfirm={() =>
          deleteOne(
            "patients",
            { id: record.id, previousData: record },
            {
              mutationMode: "pessimistic",
              onSuccess: () => {
                setConfirm(null);
                notify("data_safety.delete.done", { type: "info" });
                redirect("list", "patients");
              },
              onError: (error) => {
                setConfirm(null);
                notify(errorText(error), { type: "error" });
              },
            },
          )
        }
        onClose={() => setConfirm(null)}
      />
    </div>
  );
};

/** «В архиве» next to the name of an archived patient */
export const ArchivedBadge = ({
  patient,
  className,
}: {
  patient?: { archived_at?: string | null } | null;
  className?: string;
}) => {
  const translate = useTranslate();
  if (!isArchived(patient)) return null;
  return (
    <span
      className={cn(
        "rounded-full bg-pill px-3 py-1 text-xs font-semibold text-muted-foreground",
        className,
      )}
      data-testid="patient-archived"
    >
      {translate("data_safety.archive.badge")}
    </span>
  );
};

/** «Архив» pill of the patient list: the archived patients instead */
export const ArchivedFilterToggle = () => {
  const translate = useTranslate();
  const { filterValues, displayedFilters, setFilters } = useListContext();
  const active =
    filterValues?.[ARCHIVED_FILTER] === true ||
    filterValues?.[ARCHIVED_FILTER] === "true";
  const toggle = () => {
    const { [ARCHIVED_FILTER]: _ignored, ...rest } = filterValues ?? {};
    setFilters(
      active ? rest : { ...rest, [ARCHIVED_FILTER]: true },
      displayedFilters,
    );
  };
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      className="rounded-full"
      aria-pressed={active}
      onClick={toggle}
      data-testid="patients-archive-filter"
    >
      {translate("data_safety.archive.filter")}
    </Button>
  );
};

/** Bulk «В архив» / «Вернуть из архива» of the patient list */
export const BulkArchiveButton = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefresh();
  const { selectedIds, filterValues, onUnselectItems } = useListContext();
  const [updateMany, { isPending }] = useUpdateMany();
  const archive = !(
    filterValues?.[ARCHIVED_FILTER] === true ||
    filterValues?.[ARCHIVED_FILTER] === "true"
  );
  const { canAccess } = useCanAccess({
    resource: "patients",
    action: archive ? "archive" : "restore",
  });
  if (!canAccess) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="rounded-full"
      disabled={isPending || !selectedIds.length}
      onClick={() =>
        updateMany(
          "patients",
          {
            ids: selectedIds,
            data: { archived_at: archive ? new Date().toISOString() : null },
          },
          {
            mutationMode: "pessimistic",
            onSuccess: () => {
              onUnselectItems();
              refresh();
              notify(
                archive
                  ? "data_safety.archive.done_many"
                  : "data_safety.archive.restored_many",
                {
                  type: "info",
                  messageArgs: { smart_count: selectedIds.length },
                },
              );
            },
            onError: (error) => notify(errorText(error), { type: "error" }),
          },
        )
      }
    >
      {translate(
        archive ? "data_safety.archive.action" : "data_safety.archive.restore",
      )}
    </Button>
  );
};

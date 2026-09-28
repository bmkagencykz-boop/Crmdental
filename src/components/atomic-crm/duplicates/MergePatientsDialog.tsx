import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  useDataProvider,
  useGetList,
  useGetMany,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { findById, useLeadSources } from "../dictionaries/useDictionaries";
import { patientDisplayName } from "../patients/parsePatientText";
import type { CrmDataProvider } from "../providers/types";
import type { Patient, Sale } from "../types";
import {
  defaultMergeChoices,
  MERGE_FIELDS,
  mergeFieldValue,
  suggestKeep,
  type MergeChoice,
  type MergeField,
} from "./duplicates";

const formatDay = (value: string) => {
  const [year, month, day] = value.slice(0, 10).split("-");
  return day && month && year ? `${day}.${month}.${year}` : value;
};

/** Error of merge_patients as a translatable message */
const mergeError = (error: any) =>
  error?.code === "42501"
    ? "duplicates.errors.forbidden"
    : error?.code === "22023"
      ? "duplicates.errors.same"
      : error?.code === "P0002"
        ? "duplicates.errors.not_found"
        : (error?.message ?? "ra.notification.http_error");

/**
 * Merge of two patients (owner and head): which card to keep, and per field
 * which value (name, birth date, source, responsible, comment). Phones, tags
 * and chats are combined by the database.
 */
export const MergePatientsDialog = ({
  patientIds,
  onClose,
  onMerged,
}: {
  patientIds: [Identifier, Identifier];
  onClose: () => void;
  onMerged?: (keepId: Identifier, mergeId: Identifier) => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { data: patients = [] } = useGetMany<Patient>("patients", {
    ids: patientIds,
  });
  const { data: sources } = useLeadSources();
  const { data: sales = [] } = useGetList<Sale>("sales", {
    sort: { field: "last_name", order: "ASC" },
    pagination: { page: 1, perPage: 200 },
  });
  const [order, setOrder] = useState<[Patient, Patient] | null>(null);
  const [choices, setChoices] = useState<Record<MergeField, MergeChoice>>();
  useEffect(() => {
    if (order || patients.length < 2) return;
    const pair = suggestKeep(patients[0], patients[1]);
    setOrder(pair);
    setChoices(defaultMergeChoices(pair[0], pair[1]));
  }, [patients, order]);

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      dataProvider.mergePatients(order![0].id, order![1].id, choices ?? {}),
    onSuccess: async () => {
      await Promise.all(
        [
          "patients",
          "deals",
          "patient_duplicates",
          "duplicate_groups",
          "patient_notes",
          "calls",
          "audit_log",
        ].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      );
      notify("duplicates.notify.merged", { type: "info" });
      onClose();
      onMerged?.(order![0].id, order![1].id);
    },
    onError: (error) => notify(mergeError(error), { type: "error" }),
  });

  const display = (field: MergeField, patient: Patient) => {
    const value = mergeFieldValue(field, patient);
    if (value == null) return "—";
    if (field === "birth_date") return formatDay(String(value));
    if (field === "source") return findById(sources, value)?.name ?? "—";
    if (field === "responsible") {
      const sale = findById(sales, value);
      return sale ? `${sale.first_name} ${sale.last_name}` : "—";
    }
    return String(value);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="merge-patients-dialog">
        <DialogHeader>
          <DialogTitle>{translate("duplicates.dialog.title")}</DialogTitle>
          <DialogDescription>
            {translate("duplicates.dialog.hint")}
          </DialogDescription>
        </DialogHeader>
        {order && choices ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">
                    {translate("duplicates.dialog.field")}
                  </th>
                  {order.map((patient, index) => (
                    <th key={patient.id} className="py-1.5 pr-3 font-medium">
                      <span className="block uppercase tracking-[0.04em]">
                        {translate(
                          index === 0
                            ? "duplicates.dialog.keep"
                            : "duplicates.dialog.merge",
                        )}
                      </span>
                      <span className="block truncate font-semibold text-foreground">
                        {patientDisplayName(patient)} · #{patient.id}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MERGE_FIELDS.map((field) => (
                  <tr key={field} className="border-t border-border">
                    <td className="py-2 pr-3 text-muted-foreground">
                      {translate(`duplicates.dialog.${field}`)}
                    </td>
                    {order.map((patient, index) => {
                      const side: MergeChoice = index === 0 ? "keep" : "merge";
                      const active = choices[field] === side;
                      return (
                        <td key={patient.id} className="py-1.5 pr-3">
                          <button
                            type="button"
                            role="radio"
                            aria-checked={active}
                            aria-label={`${translate(`duplicates.dialog.${field}`)}: ${display(field, patient)}`}
                            onClick={() =>
                              setChoices({ ...choices, [field]: side })
                            }
                            className={cn(
                              "w-full rounded-md border px-2.5 py-1.5 text-left transition-colors",
                              active
                                ? "border-primary bg-primary/10 font-semibold"
                                : "border-border hover:bg-card",
                            )}
                          >
                            <span className="line-clamp-2">
                              {display(field, patient)}
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            disabled={!order}
            onClick={() => {
              if (!order) return;
              const swapped: [Patient, Patient] = [order[1], order[0]];
              setOrder(swapped);
              setChoices(defaultMergeChoices(swapped[0], swapped[1]));
            }}
          >
            {translate("duplicates.dialog.swap")}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {translate("ra.action.cancel")}
            </Button>
            <Button disabled={!order || isPending} onClick={() => mutate()}>
              {translate("duplicates.dialog.submit")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

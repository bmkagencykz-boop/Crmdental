import { useQuery } from "@tanstack/react-query";

import { useDataProvider, useTranslate, type Identifier } from "ra-core";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";

import { patientDisplayName } from "../patients/parsePatientText";
import type { CrmDataProvider } from "../providers/types";
import { MergePatientsDialog } from "./MergePatientsDialog";
import { groupDuplicates } from "./duplicates";

const formatDay = (value?: string | null) => {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}.${month}.${year}`;
};

/**
 * Settings → «Дубли» (owner and head): the groups of possible duplicates of
 * the clinic (public.duplicate_groups); each other patient of a group can be
 * merged with the first one.
 */
export const DuplicatesSettings = () => {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const {
    data: rows = [],
    isPending,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["duplicate_groups"],
    queryFn: () => dataProvider.getDuplicateGroups(),
  });
  const [pair, setPair] = useState<[Identifier, Identifier] | null>(null);
  const groups = groupDuplicates(rows);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {translate("duplicates.settings.refresh")}
        </Button>
      </div>
      {!isPending && !groups.length ? (
        <p className="text-sm text-muted-foreground">
          {translate("duplicates.settings.empty")}
        </p>
      ) : null}
      <ul className="flex flex-col gap-3" data-testid="duplicate-groups">
        {groups.map((group) => {
          const [first, ...others] = group.patients;
          return (
            <li
              key={group.id}
              className="rounded-md border border-border bg-card/60 p-3"
            >
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                {group.reasons
                  .map((reason) => translate(`duplicates.reasons.${reason}`))
                  .join(" · ")}
              </p>
              <ul className="flex flex-col divide-y divide-border">
                {[first, ...others].map((patient, index) => (
                  <li
                    key={patient.patient_id}
                    className="flex items-center justify-between gap-3 py-1.5 text-sm"
                  >
                    <span className="min-w-0">
                      <Link
                        to={`/patients/${patient.patient_id}/show`}
                        className="font-semibold text-brand-link hover:underline"
                      >
                        {patientDisplayName(patient) ||
                          `#${patient.patient_id}`}
                      </Link>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {[
                          ...(patient.phones ?? []),
                          formatDay(patient.birth_date),
                          translate("duplicates.settings.deals", {
                            smart_count: patient.nb_deals ?? 0,
                          }),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    {index > 0 ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setPair([first.patient_id, patient.patient_id])
                        }
                      >
                        {translate("duplicates.merge")}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
      {pair ? (
        <MergePatientsDialog
          patientIds={pair}
          onClose={() => setPair(null)}
          onMerged={() => refetch()}
        />
      ) : null}
    </div>
  );
};

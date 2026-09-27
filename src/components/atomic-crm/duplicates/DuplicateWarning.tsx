import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import {
  useCanAccess,
  useDataProvider,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { cn } from "@/lib/utils";

import { patientDisplayName } from "../patients/parsePatientText";
import type { CrmDataProvider } from "../providers/types";
import { MergePatientsDialog } from "./MergePatientsDialog";
import type { PatientDuplicate } from "./duplicates";

/** Possible duplicates of a patient (public.patient_duplicates) */
export const usePatientDuplicates = (patientId?: Identifier) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  return useQuery({
    queryKey: ["patient_duplicates", String(patientId)],
    queryFn: () => dataProvider.getPatientDuplicates(patientId!),
    enabled: patientId != null,
  });
};

/**
 * «Возможный дубль: Ахметов Даулет (тот же телефон)» with a link, and for
 * the owner and the head the «Объединить» button. Patient card and the
 * patient block of the deal page.
 */
export const DuplicateWarning = ({
  patientId,
  className,
}: {
  patientId: Identifier;
  className?: string;
}) => {
  const translate = useTranslate();
  const navigate = useNavigate();
  const { data: duplicates = [] } = usePatientDuplicates(patientId);
  const { canAccess: canMerge } = useCanAccess({
    resource: "duplicates",
    action: "merge",
  });
  const [merging, setMerging] = useState<PatientDuplicate | null>(null);
  if (!duplicates.length) return null;

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm",
        className,
      )}
      role="status"
      data-testid="duplicate-warning"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
      <div className="min-w-0 flex-1">
        <span className="font-semibold">
          {translate("duplicates.possible")}
        </span>{" "}
        {duplicates.map((duplicate, index) => (
          <span key={duplicate.patient_id}>
            {index > 0 ? "; " : ""}
            <Link
              to={`/patients/${duplicate.patient_id}/show`}
              className="font-semibold text-brand-link hover:underline"
            >
              {patientDisplayName(duplicate) || `#${duplicate.patient_id}`}
            </Link>{" "}
            <span className="text-muted-foreground">
              (
              {duplicate.reasons
                .map((reason) => translate(`duplicates.reasons.${reason}`))
                .join(", ")}
              )
            </span>
            {canMerge ? (
              <button
                type="button"
                onClick={() => setMerging(duplicate)}
                className="ml-1.5 text-xs font-semibold text-brand-link underline-offset-2 hover:underline"
              >
                {translate("duplicates.merge")}
              </button>
            ) : null}
          </span>
        ))}
      </div>
      {merging ? (
        <MergePatientsDialog
          patientIds={[patientId, merging.patient_id]}
          onClose={() => setMerging(null)}
          onMerged={(keepId, mergeId) => {
            // The card shown may be the one that was merged away
            if (String(mergeId) === String(patientId)) {
              navigate(`/patients/${keepId}/show`);
            }
          }}
        />
      ) : null}
    </div>
  );
};

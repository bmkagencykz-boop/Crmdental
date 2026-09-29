import { useLocaleState, useTranslate } from "ra-core";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { findById, useDoctors } from "../dictionaries/useDictionaries";
import { useClinicTimeZone } from "../tasks/useClinicTimeZone";
import type { Deal } from "../types";
import { shortDay, slotLabel } from "./format";
import { useWaitingEntries, useWaitingRights } from "./useWaitingList";
import { WaitingEntryDialog, type WaitingDraft } from "./WaitingEntryDialog";
import { freedSlotOf, isActiveEntry } from "./waitingMatch";

/**
 * «В лист ожидания»: opens the entry dialog with the patient (and the deal,
 * the doctor, the service) filled in. Hidden from the integrator.
 */
export const AddToWaitingListButton = ({
  draft,
  label = "waiting_list.add_short",
  className,
  variant = "outline",
}: {
  draft: WaitingDraft;
  label?: string;
  className?: string;
  variant?: "outline" | "default";
}) => {
  const translate = useTranslate();
  const rights = useWaitingRights();
  const [open, setOpen] = useState(false);
  if (!rights.canUse) return null;
  return (
    <>
      <Button
        type="button"
        variant={variant}
        className={className}
        onClick={() => setOpen(true)}
        data-testid="add-to-waiting-list"
      >
        {translate(label)}
      </Button>
      {open ? (
        <WaitingEntryDialog open draft={draft} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
};

/**
 * «Лист ожидания» of the deal page: the entries of the deal (status,
 * wishes, a freed slot) and «В лист ожидания».
 */
export const DealWaitingList = ({ deal }: { deal: Deal }) => {
  const translate = useTranslate();
  const [locale] = useLocaleState();
  const timeZone = useClinicTimeZone();
  const rights = useWaitingRights();
  const { data: doctors } = useDoctors();
  const { data: entries } = useWaitingEntries(
    { deal_id: deal.id },
    rights.canUse,
  );
  if (!rights.canUse) return null;
  return (
    <section
      className="flex flex-col gap-2 border-t border-border px-5 py-4"
      data-testid="deal-waiting-list"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {translate("waiting_list.block.title")}
        </h3>
        <AddToWaitingListButton
          draft={{
            patient_id: deal.patient_id,
            deal_id: deal.id,
            doctor_id: deal.doctor_id ?? null,
            service_id: deal.service_id ?? null,
            branch_id: deal.branch_id ?? null,
          }}
          className="h-7 px-3 text-xs"
        />
      </div>
      {entries.length ? (
        <ul className="flex flex-col gap-1.5 text-sm">
          {entries.map((entry) => {
            const freed = freedSlotOf(entry);
            return (
              <li
                key={entry.id}
                className={cn(
                  "flex flex-wrap items-center gap-2 rounded-2xl bg-muted/60 px-3 py-2",
                  !isActiveEntry(entry) && "opacity-60",
                )}
                data-testid="deal-waiting-entry"
              >
                <span className="rounded-full bg-card px-2 py-0.5 text-xs">
                  {translate(`waiting_list.statuses.${entry.status}`)}
                </span>
                {entry.priority === "urgent" ? (
                  <span className="rounded-full bg-neon px-2 py-0.5 text-xs text-neon-ink">
                    {translate("waiting_list.priorities.urgent")}
                  </span>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {[
                    findById(doctors, entry.doctor_id ?? undefined)?.name ??
                      translate("waiting_list.any_doctor"),
                    translate("waiting_list.card.period_open", {
                      from: shortDay(entry.date_from, locale),
                    }),
                  ].join(" · ")}
                </span>
                {freed ? (
                  <span className="text-xs font-medium">
                    {translate("waiting_list.card.freed", {
                      time: slotLabel(freed.starts_at, timeZone, locale),
                    })}
                  </span>
                ) : null}
                <Link
                  to="/waiting-list"
                  className="ml-auto text-xs text-brand-link hover:underline"
                >
                  {translate("waiting_list.nav")} ›
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          {translate("waiting_list.block.empty")}
        </p>
      )}
    </section>
  );
};

import {
  useDataProvider,
  useGetList,
  useLocaleState,
  useNotify,
  useTranslate,
} from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

import { findById, useDoctors } from "../dictionaries/useDictionaries";
import type { CrmDataProvider } from "../providers/types";
import { useClinicTimeZone } from "../tasks/useClinicTimeZone";
import type { Deal, Patient } from "../types";
import { slotDate, slotLabel, slotTime } from "./format";
import type { WaitingEntry } from "./types";
import { useRefreshWaiting } from "./useWaitingList";
import { fillOffer, type Slot } from "./waitingMatch";

/**
 * «Предложить время»: the text of the offer (editable) goes to the patient
 * through the messenger of the deal (the entry's deal, else the patient's
 * latest open deal) — the same path as a message typed on the deal page —
 * and the entry becomes «Предложено» with the time. Without a deal the
 * offer is only marked (the employee calls). The reply is handled by hand.
 */
export const OfferDialog = ({
  entry,
  patient,
  slot,
  onClose,
}: {
  entry: WaitingEntry;
  patient?: Patient;
  slot: Slot;
  onClose: () => void;
}) => {
  const translate = useTranslate();
  const [locale] = useLocaleState();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const refreshWaiting = useRefreshWaiting();
  const timeZone = useClinicTimeZone();
  const { data: doctors } = useDoctors();
  const doctor = findById(doctors, slot.doctor_id ?? undefined);
  const { data: deals = [] } = useGetList<Deal>("deals", {
    pagination: { page: 1, perPage: 20 },
    sort: { field: "updated_at", order: "DESC" },
    filter: { patient_id: entry.patient_id, "archived_at@is": null },
  });
  const deal =
    deals.find((item) => String(item.id) === String(entry.deal_id)) ??
    deals.find((item) => item.stage_kind === "open");
  const [text, setText] = useState(() =>
    fillOffer(
      translate(
        doctor
          ? "waiting_list.offer.template"
          : "waiting_list.offer.template_no_doctor",
      ),
      {
        name: patient?.first_name,
        doctor: doctor?.name,
        date: slotDate(slot.starts_at, timeZone, locale),
        time: slotTime(slot.starts_at, timeZone),
      },
    ),
  );
  const [busy, setBusy] = useState(false);

  const markOffered = () =>
    dataProvider.update<WaitingEntry>("waiting_list", {
      id: entry.id,
      data: {
        status: "offered",
        offered_starts_at: slot.starts_at,
        offered_doctor_id: slot.doctor_id ?? null,
      },
      previousData: entry,
    });

  const submit = async (send: boolean) => {
    setBusy(true);
    try {
      if (send && deal) {
        await dataProvider.sendMessage(deal.id, text.trim());
      }
      await markOffered();
      notify(send ? "waiting_list.offer.sent" : "waiting_list.offer.marked", {
        type: "info",
      });
      refreshWaiting();
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), {
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="rounded-[28px] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[22px] font-normal tracking-[-0.02em]">
            {translate("waiting_list.offer.title")}
          </DialogTitle>
          <DialogDescription>
            {translate("waiting_list.offer.reply_hint")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-neon px-3 py-1.5 text-sm font-medium text-neon-ink">
              {slotLabel(slot.starts_at, timeZone, locale)}
            </span>
            <span className="rounded-full bg-muted px-3 py-1.5 text-sm">
              {doctor?.name ?? translate("waiting_list.any_doctor")}
            </span>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {translate("waiting_list.offer.text")}
            </span>
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={5}
              className="rounded-2xl"
              data-testid="waiting-offer-text"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            {deal
              ? translate("waiting_list.offer.deal", {
                  name: deal.name || `#${deal.id}`,
                })
              : translate("waiting_list.offer.no_deal")}
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => submit(false)}
          >
            {translate("waiting_list.offer.mark_only")}
          </Button>
          <Button
            disabled={busy || !deal || !text.trim()}
            onClick={() => submit(true)}
          >
            {translate("waiting_list.offer.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

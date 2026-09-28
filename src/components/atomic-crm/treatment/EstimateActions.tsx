import { useQueryClient } from "@tanstack/react-query";
import { useDataProvider, useNotify, useTranslate } from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";

import {
  findById,
  useDoctors,
  useOrganizationSettings,
} from "../dictionaries/useDictionaries";
import { useSendMessage } from "../messages/useMessages";
import type { CrmDataProvider } from "../providers/types";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal } from "../types";
import { estimateFileName } from "./format";
import type { TreatmentPlan, TreatmentPlanItem, TreatmentStage } from "./types";

const patientName = (deal: Deal) =>
  [deal.patient_last_name, deal.patient_first_name]
    .filter((part) => part?.trim())
    .join(" ");

const download = (file: File) => {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * «Смета PDF»: builds the A4 estimate of a plan in the browser, then
 * «Скачать PDF», «Сохранить в файлы сделки» (tab «Файлы») or «Отправить
 * пациенту» — the file goes through the chat of the deal with a caption,
 * like a file sent from the composer.
 */
export const EstimateActions = ({
  deal,
  plan,
  items,
  stages = [],
}: {
  deal: Deal;
  plan: TreatmentPlan;
  items: TreatmentPlanItem[];
  /** The stages of the plan (stage 34): names, doctors, deadlines */
  stages?: TreatmentStage[];
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const { title } = useConfigurationContext();
  const { data: settings } = useOrganizationSettings();
  const { data: doctors } = useDoctors();
  const send = useSendMessage(deal.id);
  const [open, setOpen] = useState(false);
  const [caption, setCaption] = useState(() =>
    translate("treatment.pdf.caption"),
  );
  const [busy, setBusy] = useState<null | "download" | "save" | "send">(null);

  const build = async () => {
    // jsPDF and the fonts load with the first estimate, not with the app
    const [{ buildEstimatePdf }, { loadEstimateFonts }] = await Promise.all([
      import("./estimatePdf"),
      import("./estimateFonts"),
    ]);
    const fonts = await loadEstimateFonts();
    const patient = patientName(deal) || translate("crm.deals.untitled");
    const bytes = buildEstimatePdf(
      {
        clinic: {
          name: title || "",
          city: settings?.clinic_city,
          address: settings?.clinic_address,
          phone: settings?.clinic_phone,
        },
        patient: { name: patient, phone: deal.patient_phone },
        plan,
        items,
        stages: stages.map((stage) => ({
          ...stage,
          doctor: findById(doctors, stage.doctor_id)?.name ?? null,
        })),
        doctor: findById(doctors, plan.doctor_id)?.name ?? null,
        date: new Date(),
      },
      fonts,
      translate,
    );
    return new File(
      [bytes as BlobPart],
      estimateFileName(
        plan.name,
        patient,
        translate("treatment.pdf.file_prefix"),
      ),
      {
        type: "application/pdf",
      },
    );
  };

  const run = async (
    kind: "download" | "save" | "send",
    action: (file: File) => Promise<unknown>,
  ) => {
    setBusy(kind);
    let built = false;
    try {
      const file = await build();
      built = true;
      await action(file);
    } catch (error) {
      // A failed sending is reported by useSendMessage already
      if (!built || kind !== "send") {
        notify((error as Error)?.message || "treatment.pdf.error", {
          type: "error",
        });
      }
    } finally {
      setBusy(null);
    }
  };

  if (!items.length) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled
        title={translate("treatment.pdf.no_items")}
      >
        {translate("treatment.pdf.button")}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        size="sm"
        variant="outline"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {translate("treatment.pdf.button")}
      </Button>
      {open ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-2xl bg-muted p-2"
          role="group"
          aria-label={translate("treatment.pdf.button")}
        >
          <Button
            size="sm"
            variant="ghost"
            disabled={busy != null}
            onClick={() => run("download", async (file) => download(file))}
          >
            {translate(
              busy === "download"
                ? "treatment.pdf.building"
                : "treatment.pdf.download",
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy != null}
            onClick={() =>
              run("save", async (file) => {
                await dataProvider.uploadDealFile(deal.id, file);
                await Promise.all(
                  ["deal_files", "audit_log"].map((key) =>
                    queryClient.invalidateQueries({ queryKey: [key] }),
                  ),
                );
                notify("treatment.pdf.saved", { type: "info" });
              })
            }
          >
            {translate(
              busy === "save" ? "treatment.pdf.building" : "treatment.pdf.save",
            )}
          </Button>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <input
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            aria-label={translate("treatment.pdf.caption_label")}
            className="h-8 w-48 rounded-full bg-pill px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            size="sm"
            disabled={busy != null}
            onClick={() =>
              run("send", (file) =>
                send
                  .mutateAsync({ text: caption.trim(), file })
                  .then(() => notify("treatment.pdf.sent", { type: "info" })),
              )
            }
          >
            {translate(
              busy === "send" ? "treatment.pdf.building" : "treatment.pdf.send",
            )}
          </Button>
        </div>
      ) : null}
    </div>
  );
};

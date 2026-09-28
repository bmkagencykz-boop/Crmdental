import {
  useCreate,
  useDataProvider,
  useDelete,
  useNotify,
  useTranslate,
  useUpdate,
} from "ra-core";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

import {
  findById,
  useDoctors,
  useOrganizationSettings,
} from "../dictionaries/useDictionaries";
import { patientDisplayName } from "../patients/parsePatientText";
import type { CrmDataProvider } from "../providers/types";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Patient } from "../types";
import {
  consentFileName,
  consentValues,
  missingValues,
  renderConsent,
  ruDate,
} from "./consents";
import type { PatientConsent } from "./types";
import {
  useConsentTemplates,
  useMedicalRights,
  usePatientConsents,
  useRefreshPatientCard,
} from "./usePatientCard";

const today = () => new Date().toISOString().slice(0, 10);

/** The consent as a PDF (jsPDF and the fonts load with the first one) */
const useConsentPdf = () => {
  const translate = useTranslate();
  const { title } = useConfigurationContext();
  const { data: settings } = useOrganizationSettings();
  return async (consent: PatientConsent, patientName: string) => {
    const [{ buildConsentPdf }, { loadEstimateFonts }] = await Promise.all([
      import("./consentPdf"),
      import("../treatment/estimateFonts"),
    ]);
    const fonts = await loadEstimateFonts();
    return buildConsentPdf(
      {
        clinic: {
          name: title || "",
          city: settings?.clinic_city,
          address: settings?.clinic_address,
          phone: settings?.clinic_phone,
        },
        title: consent.title,
        body: consent.body,
        patientName,
        signedAt: consent.signed_at,
      },
      fonts,
      translate,
    );
  };
};

const download = (bytes: Uint8Array, name: string) => {
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], { type: "application/pdf" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * «Согласия» (stage 37): informed consents from the clinic's templates
 * with the patient's data filled in ({пациент}, {иин}…), as a PDF; marked
 * signed with a date; the PDF can go to the patient's files.
 */
export const ConsentsBlock = ({ patient }: { patient: Patient }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const rights = useMedicalRights();
  const refresh = useRefreshPatientCard();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { title: clinic } = useConfigurationContext();
  const { data: doctors } = useDoctors();
  const { data: templates = [] } = useConsentTemplates(rights.canSee);
  const { data: consents = [] } = usePatientConsents(patient.id, rights.canSee);
  const [create, { isPending: creating }] = useCreate<PatientConsent>();
  const [update] = useUpdate();
  const [remove] = useDelete();
  const buildPdf = useConsentPdf();
  const [templateId, setTemplateId] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);

  const name = patientDisplayName(patient);
  const values = useMemo(
    () =>
      consentValues({
        patientName: name,
        birthDate: patient.birth_date,
        iin: patient.iin,
        phone: patient.phones?.[0],
        clinic,
        doctor: findById(doctors, patient.preferred_doctor_id ?? undefined)
          ?.name,
      }),
    [name, patient, clinic, doctors],
  );
  const active = templates.filter((template) => !template.is_archived);
  const template = active.find((t) => String(t.id) === templateId);
  const preview = template ? renderConsent(template.body, values) : "";
  const missing = template ? missingValues(template.body, values) : [];

  const onError = (error: unknown) =>
    notify((error as Error)?.message || "ra.notification.http_error", {
      type: "error",
    });
  const give = () => {
    if (!template) return;
    create(
      "patient_consents",
      {
        data: {
          patient_id: patient.id,
          template_id: template.id,
          title: template.name,
          body: preview,
        },
      },
      {
        onSuccess: () => {
          setTemplateId("");
          refresh();
          notify("patient_card.consents.created", { type: "info" });
        },
        onError,
      },
    );
  };
  const pdf = async (consent: PatientConsent) => {
    setBusy(`pdf${consent.id}`);
    try {
      download(
        await buildPdf(consent, name),
        consentFileName(consent.title, name),
      );
    } catch {
      notify("patient_card.consents.error", { type: "error" });
    } finally {
      setBusy(null);
    }
  };
  const toFiles = async (consent: PatientConsent) => {
    setBusy(`file${consent.id}`);
    try {
      const bytes = await buildPdf(consent, name);
      const fileName = consentFileName(consent.title, name);
      const file = await dataProvider.uploadPatientFile(
        patient.id,
        new File([bytes as BlobPart], fileName, { type: "application/pdf" }),
        "consent",
        { taken_at: consent.signed_at ?? today() },
      );
      await dataProvider.update("patient_consents", {
        id: consent.id,
        data: { file_id: file.id },
        previousData: consent,
      });
      refresh();
      notify("patient_card.consents.saved_to_files", { type: "info" });
    } catch (error) {
      onError(error as Error);
    } finally {
      setBusy(null);
    }
  };
  const sign = (consent: PatientConsent, date: string | null) =>
    update(
      "patient_consents",
      { id: consent.id, data: { signed_at: date }, previousData: consent },
      { mutationMode: "pessimistic", onSuccess: () => refresh(), onError },
    );

  return (
    <section
      className="flex flex-col gap-4 rounded-[28px] bg-card p-6"
      data-testid="patient-consents"
    >
      <div>
        <h2 className="text-[22px] leading-tight font-normal tracking-[-0.02em]">
          {translate("patient_card.consents.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {translate("patient_card.consents.subtitle")}
        </p>
      </div>

      {rights.canEdit && active.length ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-background p-4">
          <div className="flex flex-wrap gap-2">
            <select
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              aria-label={translate("patient_card.consents.template")}
              className="field h-10 min-w-0 flex-1 rounded-full px-4 text-sm"
            >
              <option value="">
                {translate("patient_card.consents.pick_template")}
              </option>
              {active.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.name}
                </option>
              ))}
            </select>
            <Button onClick={give} disabled={!template || creating}>
              {translate("patient_card.consents.give")}
            </Button>
          </div>
          {template ? (
            <>
              {missing.length ? (
                <p className="text-xs text-muted-foreground">
                  {translate("patient_card.consents.missing", {
                    fields: missing
                      .map((key) =>
                        translate(`patient_card.consents.variables.${key}`),
                      )
                      .join(", "),
                  })}
                </p>
              ) : null}
              <pre
                className="max-h-64 overflow-y-auto rounded-xl bg-card p-3 font-sans text-xs leading-5 whitespace-pre-wrap"
                aria-label={translate("patient_card.consents.preview")}
              >
                {preview}
              </pre>
            </>
          ) : null}
        </div>
      ) : null}

      {consents.length ? (
        <ul className="flex flex-col gap-2">
          {consents.map((consent) => (
            <li
              key={consent.id}
              className="flex flex-col gap-2 rounded-2xl bg-background px-4 py-3"
              data-testid="consent-row"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm">{consent.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {ruDate(consent.created_at.slice(0, 10))}
                    {consent.file_id != null
                      ? ` · ${translate("patient_card.consents.in_files")}`
                      : ""}
                  </p>
                </div>
                {consent.signed_at ? (
                  <span className="rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground">
                    {translate("patient_card.consents.signed_on", {
                      date: ruDate(consent.signed_at),
                    })}
                  </span>
                ) : (
                  <span className="rounded-full bg-neon px-3 py-1 text-xs text-neon-ink">
                    {translate("patient_card.consents.unsigned")}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === `pdf${consent.id}`}
                  onClick={() => pdf(consent)}
                >
                  {translate("patient_card.consents.pdf")}
                </Button>
                {rights.canEdit && !consent.signed_at ? (
                  <Button size="sm" onClick={() => sign(consent, today())}>
                    {translate("patient_card.consents.mark_signed")}
                  </Button>
                ) : null}
                {rights.canEdit && consent.signed_at ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => sign(consent, null)}
                  >
                    {translate("patient_card.consents.unsign")}
                  </Button>
                ) : null}
                {rights.canEdit && consent.file_id == null ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === `file${consent.id}`}
                    onClick={() => toFiles(consent)}
                  >
                    {translate("patient_card.consents.save_to_files")}
                  </Button>
                ) : null}
                {rights.canDelete(consent.created_by) ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto text-tone-red"
                    onClick={() => {
                      if (
                        window.confirm(
                          translate("patient_card.consents.delete_confirm", {
                            name: consent.title,
                          }),
                        )
                      ) {
                        remove(
                          "patient_consents",
                          { id: consent.id, previousData: consent },
                          {
                            mutationMode: "pessimistic",
                            onSuccess: () => refresh(),
                            onError,
                          },
                        );
                      }
                    }}
                  >
                    {translate("patient_card.consents.delete")}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {translate("patient_card.consents.empty")}
        </p>
      )}
    </section>
  );
};

import {
  useCreate,
  useDelete,
  useNotify,
  useTranslate,
  useUpdate,
  type Identifier,
} from "ra-core";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { toDoctorChoices, useDoctors } from "../dictionaries/useDictionaries";
import type { Visit } from "../schedule/types";
import { Field, PillSelect, pillInput } from "../treatment/PlanFields";
import { pickId } from "../treatment/planUi";
import { applyTemplate, type Draft } from "./cardLogic";
import { ruDate } from "./consents";
import { icdLabel, icdName, normalizeIcdCode, searchIcd } from "./icd10";
import { RECORD_FIELDS, type RecordField, type VisitRecord } from "./types";
import {
  useMedicalRights,
  useRecordTemplates,
  useRefreshPatientCard,
} from "./usePatientCard";

const today = () => new Date().toISOString().slice(0, 10);

const draftOf = (record: VisitRecord | undefined, visit?: Visit): Draft => ({
  doctor_id: record?.doctor_id ?? visit?.doctor_id ?? null,
  record_date:
    record?.record_date ?? (visit ? visit.starts_at.slice(0, 10) : today()),
  diagnosis_codes: record?.diagnosis_codes ?? [],
  ...Object.fromEntries(
    RECORD_FIELDS.map((field) => [field, record?.[field] ?? ""]),
  ),
});

/**
 * «Запись приёма» of a visit (or without a visit): complaints, anamnesis,
 * objective status, the ICD-10 diagnoses (a searchable list of the dental
 * codes K00–K14, or any code typed in) with the diagnosis in words, the
 * treatment done and the recommendations. The clinic's templates fill the
 * texts in a click; any record can be saved as a template.
 */
export const VisitRecordDialog = ({
  open,
  onClose,
  patientId,
  visit,
  record,
}: {
  open: boolean;
  onClose: () => void;
  patientId: Identifier;
  visit?: Visit;
  record?: VisitRecord;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefreshPatientCard();
  const rights = useMedicalRights();
  const { data: doctors } = useDoctors();
  const { data: templates = [], refetch: refetchTemplates } =
    useRecordTemplates(open);
  const [create, { isPending: creating }] = useCreate();
  const [update, { isPending: updating }] = useUpdate();
  const [remove] = useDelete();
  const [draft, setDraft] = useState<Draft>(() => draftOf(record, visit));
  const [codeQuery, setCodeQuery] = useState("");
  const [templateName, setTemplateName] = useState<string | null>(null);

  useEffect(() => {
    if (open) setDraft(draftOf(record, visit));
    // A fresh form each time it opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const readOnly = !rights.canEdit;
  const suggestions = useMemo(() => searchIcd(codeQuery, 8), [codeQuery]);
  const set = (patch: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const addCode = (code: string) => {
    const normalized = normalizeIcdCode(code);
    if (!normalized) {
      notify("patient_card.record.invalid_code", { type: "warning" });
      return;
    }
    set({
      diagnosis_codes: [...new Set([...draft.diagnosis_codes, normalized])],
      // The first code names the diagnosis when it is empty
      diagnosis: draft.diagnosis?.trim()
        ? draft.diagnosis
        : (icdName(normalized) ?? draft.diagnosis),
    });
    setCodeQuery("");
  };

  const onError = (error: unknown) =>
    notify((error as Error)?.message || "ra.notification.http_error", {
      type: "error",
    });
  const save = () => {
    const data = {
      doctor_id: draft.doctor_id,
      record_date: draft.record_date || null,
      diagnosis_codes: draft.diagnosis_codes,
      ...Object.fromEntries(
        RECORD_FIELDS.map((field) => [field, draft[field]?.trim() || null]),
      ),
    };
    const onSuccess = () => {
      refresh();
      notify("patient_card.record.saved", { type: "info" });
      onClose();
    };
    if (record) {
      update(
        "visit_records",
        { id: record.id, data, previousData: record },
        { mutationMode: "pessimistic", onSuccess, onError },
      );
    } else {
      create(
        "visit_records",
        {
          data: {
            ...data,
            patient_id: patientId,
            visit_id: visit?.id ?? null,
          },
        },
        { onSuccess, onError },
      );
    }
  };

  const saveTemplate = () => {
    const name = templateName?.trim();
    if (!name) return;
    create(
      "visit_record_templates",
      {
        data: {
          name,
          content: Object.fromEntries(
            RECORD_FIELDS.map((field) => [
              field,
              draft[field]?.trim() ?? "",
            ]).filter(([, text]) => text),
          ),
          diagnosis_codes: draft.diagnosis_codes,
          position: templates.length,
        },
      },
      {
        onSuccess: () => {
          setTemplateName(null);
          refetchTemplates();
          notify("patient_card.record.template_saved", { type: "info" });
        },
        onError,
      },
    );
  };

  const deleteRecord = () => {
    if (
      !record ||
      !window.confirm(translate("patient_card.record.delete_confirm"))
    )
      return;
    remove(
      "visit_records",
      { id: record.id, previousData: record },
      {
        mutationMode: "pessimistic",
        onSuccess: () => {
          refresh();
          notify("patient_card.record.deleted", { type: "info" });
          onClose();
        },
        onError,
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="max-h-[92vh] overflow-y-auto rounded-[28px] sm:max-w-3xl"
        data-testid="visit-record-dialog"
      >
        <DialogHeader>
          <DialogTitle className="text-[26px] font-normal tracking-[-0.02em]">
            {translate("patient_card.record.title")}
          </DialogTitle>
          <DialogDescription>
            {visit
              ? translate("patient_card.record.of_visit", {
                  date: ruDate(visit.starts_at.slice(0, 10)),
                })
              : translate("patient_card.record.without_visit")}
          </DialogDescription>
        </DialogHeader>

        {templates.length && !readOnly ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-muted-foreground">
              {translate("patient_card.record.templates")}
            </span>
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() =>
                  setDraft((current) => applyTemplate(current, template))
                }
                className="rounded-full bg-pill px-3 py-1 text-xs hover:bg-pill-hover"
              >
                {template.name}
              </button>
            ))}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <Field label={translate("patient_card.record.date")}>
            <input
              type="date"
              value={draft.record_date}
              disabled={readOnly || !!visit}
              onChange={(event) => set({ record_date: event.target.value })}
              className={pillInput}
            />
          </Field>
          <Field label={translate("patient_card.record.doctor")}>
            <PillSelect
              label={translate("patient_card.record.doctor")}
              value={draft.doctor_id}
              disabled={readOnly}
              empty={translate("patient_card.record.no_doctor")}
              options={toDoctorChoices(doctors, draft.doctor_id)}
              onChange={(value) => set({ doctor_id: pickId(doctors, value) })}
            />
          </Field>
        </div>

        {(["complaints", "anamnesis", "objective"] as const).map((field) => (
          <RecordText
            key={field}
            field={field}
            value={draft[field] ?? ""}
            readOnly={readOnly}
            onChange={(value) => set({ [field]: value })}
          />
        ))}

        <div className="flex flex-col gap-2 rounded-2xl bg-muted/60 p-4">
          <span className="text-xs text-muted-foreground">
            {translate("patient_card.record.codes")}
          </span>
          <div className="flex flex-wrap gap-1.5" data-testid="record-codes">
            {draft.diagnosis_codes.map((code) => (
              <span
                key={code}
                className="flex items-center gap-1 rounded-full bg-primary py-1 pr-1 pl-3 text-xs text-primary-foreground"
                title={icdLabel(code)}
              >
                {icdLabel(code)}
                {!readOnly ? (
                  <button
                    type="button"
                    aria-label={translate("patient_card.record.remove_code", {
                      code,
                    })}
                    onClick={() =>
                      set({
                        diagnosis_codes: draft.diagnosis_codes.filter(
                          (c) => c !== code,
                        ),
                      })
                    }
                    className="flex size-5 items-center justify-center rounded-full hover:bg-white/20"
                  >
                    ×
                  </button>
                ) : null}
              </span>
            ))}
          </div>
          {!readOnly ? (
            <div className="relative">
              <input
                value={codeQuery}
                onChange={(event) => setCodeQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const first = suggestions[0];
                    addCode(
                      normalizeIcdCode(codeQuery) ?? first?.code ?? codeQuery,
                    );
                  }
                }}
                placeholder={translate("patient_card.record.code_search")}
                aria-label={translate("patient_card.record.code_search")}
                className={pillInput}
              />
              {codeQuery.trim() ? (
                <ul
                  className="absolute top-full right-0 left-0 z-10 mt-1 max-h-64 overflow-y-auto rounded-2xl bg-popover p-1 shadow-lg"
                  role="listbox"
                  aria-label={translate("patient_card.record.codes")}
                >
                  {suggestions.map((entry) => (
                    <li key={entry.code}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => addCode(entry.code)}
                        className="flex w-full gap-3 rounded-xl px-3 py-1.5 text-left text-sm hover:bg-muted"
                      >
                        <span className="w-14 shrink-0 tabular-nums">
                          {entry.code}
                        </span>
                        <span className="text-muted-foreground">
                          {entry.name}
                        </span>
                      </button>
                    </li>
                  ))}
                  {!suggestions.length ? (
                    <li className="px-3 py-1.5 text-sm text-muted-foreground">
                      {normalizeIcdCode(codeQuery)
                        ? translate("patient_card.record.press_enter")
                        : translate("patient_card.record.no_codes")}
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          ) : null}
          <RecordText
            field="diagnosis"
            value={draft.diagnosis ?? ""}
            readOnly={readOnly}
            rows={1}
            onChange={(value) => set({ diagnosis: value })}
          />
        </div>

        {(["treatment", "recommendations"] as const).map((field) => (
          <RecordText
            key={field}
            field={field}
            value={draft[field] ?? ""}
            readOnly={readOnly}
            onChange={(value) => set({ [field]: value })}
          />
        ))}

        {!readOnly ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <Button onClick={save} disabled={creating || updating}>
              {translate("patient_card.record.save")}
            </Button>
            <Button variant="outline" onClick={onClose}>
              {translate("patient_card.record.cancel")}
            </Button>
            {templateName == null ? (
              <Button variant="ghost" onClick={() => setTemplateName("")}>
                {translate("patient_card.record.save_template")}
              </Button>
            ) : (
              <span className="flex items-center gap-2">
                <input
                  autoFocus
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  placeholder={translate("patient_card.record.template_name")}
                  aria-label={translate("patient_card.record.template_name")}
                  className={cn(pillInput, "w-56")}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!templateName.trim()}
                  onClick={saveTemplate}
                >
                  {translate("patient_card.record.save_template_ok")}
                </Button>
              </span>
            )}
            {record && rights.canDelete(record.created_by) ? (
              <Button
                variant="ghost"
                className="ml-auto text-tone-red"
                onClick={deleteRecord}
              >
                {translate("patient_card.record.delete")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

const RecordText = ({
  field,
  value,
  onChange,
  readOnly,
  rows = 2,
}: {
  field: RecordField;
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  rows?: number;
}) => {
  const translate = useTranslate();
  const label = translate(`patient_card.record.fields.${field}`);
  return (
    <label className="flex flex-col gap-1.5">
      <span className="px-1 text-xs text-muted-foreground">{label}</span>
      <textarea
        value={value}
        rows={rows}
        disabled={readOnly}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        className="field rounded-2xl px-4 py-2.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:opacity-70"
      />
    </label>
  );
};

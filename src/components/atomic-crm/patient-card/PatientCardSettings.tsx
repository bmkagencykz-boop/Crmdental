import {
  useCreate,
  useDelete,
  useNotify,
  useTranslate,
  useUpdate,
} from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { pillInput } from "../treatment/PlanFields";
import { CONSENT_VARIABLES } from "./consents";
import { icdLabel } from "./icd10";
import type { ConsentTemplate, VisitRecordTemplate } from "./types";
import {
  useConsentTemplates,
  useMedicalRights,
  useRecordTemplates,
} from "./usePatientCard";

/**
 * Settings → «Медкарта» (stage 37): the clinic's informed consent templates
 * (name, text with variables, archive) — the owner and the head edit them —
 * and the templates of the visit records, saved from the record dialog.
 */
export const PatientCardSettings = () => {
  const translate = useTranslate();
  const rights = useMedicalRights();
  const { data: consents = [] } = useConsentTemplates(rights.canSee);
  const { data: records = [] } = useRecordTemplates(rights.canSee);
  const [editing, setEditing] = useState<ConsentTemplate | "new" | null>(null);
  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="flex flex-col gap-3" data-testid="consent-templates">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-normal tracking-[-0.01em]">
            {translate("patient_card.settings.consents")}
          </h3>
          {rights.canEditTemplates ? (
            <Button size="sm" onClick={() => setEditing("new")}>
              {translate("patient_card.settings.add")}
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {translate("patient_card.settings.variables_hint", {
            variables: CONSENT_VARIABLES.map(([ru]) => `{${ru}}`).join(", "),
          })}
        </p>
        {editing ? (
          <ConsentTemplateForm
            template={editing === "new" ? undefined : editing}
            position={consents.length}
            onDone={() => setEditing(null)}
          />
        ) : null}
        <ul className="flex flex-col gap-2">
          {consents.map((template) => (
            <li
              key={template.id}
              className={cn(
                "flex flex-wrap items-center gap-3 rounded-2xl bg-background px-4 py-3",
                template.is_archived && "opacity-60",
              )}
            >
              <span className="min-w-0 flex-1 text-sm">{template.name}</span>
              {template.is_archived ? (
                <span className="rounded-full bg-pill px-2.5 py-0.5 text-xs text-muted-foreground">
                  {translate("patient_card.settings.archived")}
                </span>
              ) : null}
              {rights.canEditTemplates ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(template)}
                >
                  {translate("patient_card.settings.edit")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-3">
        <h3 className="text-lg font-normal tracking-[-0.01em]">
          {translate("patient_card.settings.records")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {translate("patient_card.settings.records_hint")}
        </p>
        {records.length ? (
          <ul className="flex flex-col gap-2">
            {records.map((template) => (
              <RecordTemplateRow key={template.id} template={template} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {translate("patient_card.settings.records_empty")}
          </p>
        )}
      </section>
    </div>
  );
};

const ConsentTemplateForm = ({
  template,
  position,
  onDone,
}: {
  template?: ConsentTemplate;
  position: number;
  onDone: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const [create] = useCreate();
  const [update] = useUpdate();
  const [remove] = useDelete();
  const [name, setName] = useState(template?.name ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [archived, setArchived] = useState(template?.is_archived ?? false);
  const onSuccess = () => {
    notify("patient_card.settings.saved", { type: "info" });
    onDone();
  };
  const onError = (error: unknown) =>
    notify((error as Error)?.message || "ra.notification.http_error", {
      type: "error",
    });
  const save = () => {
    const data = { name: name.trim(), body, is_archived: archived };
    if (!data.name) return;
    if (template) {
      update(
        "consent_templates",
        { id: template.id, data, previousData: template },
        { mutationMode: "pessimistic", onSuccess, onError },
      );
    } else {
      create(
        "consent_templates",
        { data: { ...data, position } },
        { onSuccess, onError },
      );
    }
  };
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-card p-4">
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={translate("patient_card.settings.name")}
        aria-label={translate("patient_card.settings.name")}
        className={pillInput}
      />
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={10}
        maxLength={20000}
        aria-label={translate("patient_card.settings.body")}
        placeholder={translate("patient_card.settings.body")}
        className="field rounded-2xl px-4 py-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={archived}
          onChange={(event) => setArchived(event.target.checked)}
          className="size-4 accent-primary"
        />
        {translate("patient_card.settings.archived")}
      </label>
      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={!name.trim()}>
          {translate("patient_card.settings.save")}
        </Button>
        <Button variant="outline" onClick={onDone}>
          {translate("patient_card.record.cancel")}
        </Button>
        {template ? (
          <Button
            variant="ghost"
            className="ml-auto text-tone-red"
            onClick={() => {
              if (
                window.confirm(
                  translate("patient_card.settings.delete_confirm", {
                    name: template.name,
                  }),
                )
              ) {
                remove(
                  "consent_templates",
                  { id: template.id, previousData: template },
                  { mutationMode: "pessimistic", onSuccess, onError },
                );
              }
            }}
          >
            {translate("patient_card.settings.delete")}
          </Button>
        ) : null}
      </div>
    </div>
  );
};

const RecordTemplateRow = ({ template }: { template: VisitRecordTemplate }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const rights = useMedicalRights();
  const [remove] = useDelete();
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl bg-background px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm">{template.name}</p>
        {template.diagnosis_codes.length ? (
          <p className="text-xs text-muted-foreground">
            {template.diagnosis_codes.map(icdLabel).join(", ")}
          </p>
        ) : null}
      </div>
      {rights.canDelete(template.created_by) ? (
        <Button
          size="sm"
          variant="ghost"
          className="text-tone-red"
          onClick={() => {
            if (
              window.confirm(
                translate("patient_card.settings.delete_confirm", {
                  name: template.name,
                }),
              )
            ) {
              remove(
                "visit_record_templates",
                { id: template.id, previousData: template },
                {
                  mutationMode: "pessimistic",
                  onError: (error: unknown) =>
                    notify(
                      (error as Error)?.message || "ra.notification.http_error",
                      {
                        type: "error",
                      },
                    ),
                },
              );
            }
          }}
        >
          {translate("patient_card.settings.delete")}
        </Button>
      ) : null}
    </li>
  );
};

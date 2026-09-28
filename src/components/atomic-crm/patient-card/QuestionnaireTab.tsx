import { useCreate, useNotify, useTranslate, useUpdate } from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { PatientMedical } from "../treatment/PatientTreatment";
import type { Patient } from "../types";
import { questionnaireAlerts } from "./cardLogic";
import { ConsentsBlock } from "./ConsentsBlock";
import { ruDate } from "./consents";
import { QUESTIONS, type Answer, type Answers, type Question } from "./types";
import {
  useMedicalRights,
  useQuestionnaire,
  useRefreshPatientCard,
} from "./usePatientCard";

/**
 * «Анкета» of the patient card (stage 37): the medical note of stage 29
 * (allergies, contraindications, chronic diseases, the preferred doctor),
 * the questionnaire — yes / no and a comment for every question — with the
 * date it was signed, and the informed consents.
 */
export const QuestionnaireTab = ({ patient }: { patient: Patient }) => {
  const translate = useTranslate();
  const rights = useMedicalRights();
  const { questionnaire, isPending } = useQuestionnaire(
    patient.id,
    rights.canSee,
  );
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-5">
        <section className="rounded-[28px] bg-card p-6">
          <h2 className="mb-4 text-[22px] leading-tight font-normal tracking-[-0.02em]">
            {translate("patient_card.questionnaire.medical")}
          </h2>
          <PatientMedical patient={patient} />
        </section>
        {!isPending ? (
          <QuestionnaireForm
            key={String(questionnaire?.id ?? "new")}
            patient={patient}
            questionnaire={questionnaire}
            canEdit={rights.canEdit}
          />
        ) : null}
      </div>
      <ConsentsBlock patient={patient} />
    </div>
  );
};

const QuestionnaireForm = ({
  patient,
  questionnaire,
  canEdit,
}: {
  patient: Patient;
  questionnaire?: ReturnType<typeof useQuestionnaire>["questionnaire"];
  canEdit: boolean;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefreshPatientCard();
  const [create, { isPending: creating }] = useCreate();
  const [update, { isPending: updating }] = useUpdate();
  const [answers, setAnswers] = useState<Answers>(questionnaire?.answers ?? {});
  const [signedAt, setSignedAt] = useState(questionnaire?.signed_at ?? "");
  const dirty =
    JSON.stringify(answers) !== JSON.stringify(questionnaire?.answers ?? {}) ||
    (signedAt || null) !== (questionnaire?.signed_at ?? null);
  const setAnswer = (question: Question, patch: Answer) =>
    setAnswers((current) => ({
      ...current,
      [question]: { ...current[question], ...patch },
    }));

  const save = () => {
    const data = { answers: clean(answers), signed_at: signedAt || null };
    const onSuccess = () => {
      refresh();
      notify("patient_card.questionnaire.saved", { type: "info" });
    };
    const onError = (error: unknown) =>
      notify((error as Error)?.message || "ra.notification.http_error", {
        type: "error",
      });
    if (questionnaire) {
      update(
        "patient_questionnaires",
        { id: questionnaire.id, data, previousData: questionnaire },
        { mutationMode: "pessimistic", onSuccess, onError },
      );
    } else {
      create(
        "patient_questionnaires",
        { data: { ...data, patient_id: patient.id } },
        { onSuccess, onError },
      );
    }
  };

  const alerts = questionnaireAlerts(questionnaire?.answers);
  return (
    <section
      className="rounded-[28px] bg-card p-6"
      data-testid="patient-questionnaire"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[22px] leading-tight font-normal tracking-[-0.02em]">
            {translate("patient_card.questionnaire.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {questionnaire?.signed_at
              ? translate("patient_card.questionnaire.signed", {
                  date: ruDate(questionnaire.signed_at),
                })
              : translate("patient_card.questionnaire.not_signed")}
          </p>
        </div>
        {alerts.length ? (
          <div className="flex max-w-sm flex-wrap justify-end gap-1.5">
            {alerts.map((question) => (
              <span
                key={question}
                className="rounded-full bg-neon px-2.5 py-1 text-[11px] font-medium text-neon-ink"
              >
                {translate(`patient_card.questionnaire.questions.${question}`)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {QUESTIONS.map((question) => {
          const answer = answers[question];
          const label = translate(
            `patient_card.questionnaire.questions.${question}`,
          );
          return (
            <li
              key={question}
              className="grid gap-2 py-2.5 md:grid-cols-[minmax(0,14rem)_auto_minmax(0,1fr)] md:items-center"
            >
              <span className="text-sm">{label}</span>
              <div
                className="flex w-fit gap-1 rounded-full bg-muted p-1"
                role="radiogroup"
                aria-label={label}
              >
                {(["yes", "no"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={answer?.answer === value}
                    disabled={!canEdit}
                    onClick={() =>
                      setAnswer(question, {
                        answer: answer?.answer === value ? null : value,
                      })
                    }
                    className={cn(
                      "rounded-full px-3.5 py-1 text-xs transition-colors disabled:cursor-default",
                      answer?.answer === value
                        ? value === "yes"
                          ? "bg-neon text-neon-ink"
                          : "bg-primary text-primary-foreground"
                        : "text-muted-foreground enabled:hover:text-foreground",
                    )}
                  >
                    {translate(`patient_card.questionnaire.${value}`)}
                  </button>
                ))}
              </div>
              <input
                value={answer?.comment ?? ""}
                disabled={!canEdit}
                maxLength={1000}
                onChange={(event) =>
                  setAnswer(question, { comment: event.target.value })
                }
                placeholder={translate("patient_card.questionnaire.comment")}
                aria-label={`${label}: ${translate("patient_card.questionnaire.comment")}`}
                className="field h-9 rounded-full px-4 text-sm outline-none disabled:opacity-60"
              />
            </li>
          );
        })}
      </ul>
      {canEdit ? (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="px-1 text-xs text-muted-foreground">
              {translate("patient_card.questionnaire.signed_at")}
            </span>
            <input
              type="date"
              value={signedAt}
              onChange={(event) => setSignedAt(event.target.value)}
              className="field h-10 rounded-full px-4 text-sm"
              aria-label={translate("patient_card.questionnaire.signed_at")}
            />
          </label>
          <Button onClick={save} disabled={!dirty || creating || updating}>
            {translate("patient_card.questionnaire.save")}
          </Button>
          {dirty ? (
            <span className="text-xs text-muted-foreground">
              {translate("patient_card.questionnaire.unsaved")}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

/** Unanswered questions without a comment are not stored */
const clean = (answers: Answers): Answers =>
  Object.fromEntries(
    Object.entries(answers)
      .map(([key, value]) => [
        key,
        {
          ...(value?.answer ? { answer: value.answer } : {}),
          ...(value?.comment?.trim() ? { comment: value.comment.trim() } : {}),
        },
      ])
      .filter(([, value]) => Object.keys(value as object).length > 0),
  ) as Answers;

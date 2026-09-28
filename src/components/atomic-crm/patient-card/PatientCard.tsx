import {
  InfiniteListBase,
  useGetList,
  useTranslate,
  type Identifier,
} from "ra-core";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  findById,
  useServices,
  useStages,
} from "../dictionaries/useDictionaries";
import { formatMoney } from "../deals/kanbanFormat";
import { DuplicateWarning } from "../duplicates/DuplicateWarning";
import { accent } from "../misc/accent";
import { NoteCreate } from "../notes/NoteCreate";
import { NotesIterator } from "../notes/NotesIterator";
import { PatientAccountBlock } from "../payments/PatientAccountBlock";
import { usePaymentRights } from "../payments/usePayments";
import { PatientAside } from "../patients/PatientAside";
import { PatientCalls } from "../patients/PatientCalls";
import { patientDisplayName } from "../patients/parsePatientText";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { useVisitsOf } from "../schedule/useSchedule";
import { PatientPlans } from "../treatment/PatientTreatment";
import type { Deal, Patient } from "../types";
import { ChartTab } from "./ChartTab";
import { FilesTab } from "./FilesTab";
import { HistoryTab } from "./HistoryTab";
import { PatientHeader } from "./PatientHeader";
import {
  PATIENT_TABS,
  questionnaireAlerts,
  type PatientTab,
} from "./cardLogic";
import { QuestionnaireTab } from "./QuestionnaireTab";
import { useMedicalRights, useQuestionnaire } from "./usePatientCard";
import { VisitsTab } from "./VisitsTab";

/** Medical tabs: never for the integrator; money tabs: not either */
const MEDICAL_TABS: PatientTab[] = [
  "chart",
  "visits",
  "files",
  "questionnaire",
];
const MONEY_TABS: PatientTab[] = ["plans", "account"];

/**
 * The full patient card (stage 37), like a dental MIS: the header (name,
 * age, card number, IIN, phones, responsible, doctor, tags, balance and
 * debt, «1В») and the tabs «Обзор», «Зубная формула», «Визиты», «Планы
 * лечения», «Счёт», «Файлы и снимки», «Анкета», «История». The tab is in
 * the address (?tab=chart), so a link opens it.
 */
export const PatientCard = ({ patient }: { patient: Patient }) => {
  const translate = useTranslate();
  const [searchParams, setSearchParams] = useSearchParams();
  const medical = useMedicalRights();
  const payments = usePaymentRights();
  // Money (plans, account, balance): whoever works with the patients, not
  // the integrator (the rights of stage 36)
  const canSeeMoney = payments.canAccept;
  const { data: deals = [] } = useGetList<Deal>("deals", {
    filter: { patient_id: patient.id },
    sort: { field: "created_at", order: "DESC" },
    pagination: { page: 1, perPage: 100 },
  });
  const { data: visits } = useVisitsOf("patient_id", patient.id);

  const tabs = PATIENT_TABS.filter(
    (tab) =>
      (medical.canSee || !MEDICAL_TABS.includes(tab)) &&
      (canSeeMoney || !MONEY_TABS.includes(tab)),
  );
  const requested = searchParams.get("tab") as PatientTab | null;
  const tab: PatientTab =
    requested && tabs.includes(requested) ? requested : "overview";
  const select = (next: PatientTab) =>
    setSearchParams(
      (params) => {
        const copy = new URLSearchParams(params);
        if (next === "overview") copy.delete("tab");
        else copy.set("tab", next);
        return copy;
      },
      { replace: true },
    );

  return (
    <div
      className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 pb-16"
      data-testid="patient-card"
    >
      <nav
        aria-label={translate("patient_card.breadcrumbs")}
        className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
      >
        <Link
          to="/patients"
          className="text-muted-foreground no-underline hover:text-foreground"
        >
          {translate("patient_card.patients")}
        </Link>
        <span aria-hidden>/</span>
        <span className="text-foreground" aria-current="page">
          {patientDisplayName(patient)}
        </span>
      </nav>
      <DuplicateWarning patientId={patient.id} />
      <PatientHeader
        patient={patient}
        deals={deals}
        visits={visits}
        canSeeMoney={canSeeMoney}
      />
      <div
        className="flex w-fit max-w-full flex-wrap gap-1 rounded-full bg-card p-1"
        role="tablist"
        aria-label={translate("patient_card.tabs.label")}
      >
        {tabs.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => select(value)}
            className={cn(
              "rounded-full px-4 py-2 text-sm transition-colors",
              tab === value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {translate(`patient_card.tabs.${value}`)}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <OverviewTab patient={patient} deals={deals} />
      ) : null}
      {tab === "chart" ? <ChartTab patientId={patient.id} /> : null}
      {tab === "visits" ? (
        <VisitsTab patientId={patient.id} visits={visits} />
      ) : null}
      {tab === "plans" ? (
        <Card title={translate("patient_card.tabs.plans")}>
          <PatientPlans patient={patient} />
        </Card>
      ) : null}
      {tab === "account" ? (
        <PatientAccountBlock patientId={patient.id} />
      ) : null}
      {tab === "files" ? <FilesTab patientId={patient.id} /> : null}
      {tab === "questionnaire" ? <QuestionnaireTab patient={patient} /> : null}
      {tab === "history" ? (
        <HistoryTab
          patientId={patient.id}
          deals={deals}
          visits={visits}
          canSeeMoney={canSeeMoney}
        />
      ) : null}
    </div>
  );
};

/** «Обзор»: requests (deals), what the doctor must know, notes, calls, the contact card */
const OverviewTab = ({
  patient,
  deals,
}: {
  patient: Patient;
  deals: Deal[];
}) => {
  const translate = useTranslate();
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex flex-col gap-5">
        <MedicalAlerts patient={patient} />
        <Card
          title={translate("crm.patients.sections.requests")}
          action={
            <Button asChild size="sm">
              <Link to={`/deals/create?patient_id=${patient.id}`}>
                {translate("crm.patients.new_request")}
              </Link>
            </Button>
          }
        >
          <PatientDeals deals={deals} />
        </Card>
        <Card title={translate("resources.notes.name", { smart_count: 2 })}>
          <InfiniteListBase
            resource="patient_notes"
            filter={{ patient_id: patient.id }}
            sort={{ field: "date", order: "DESC" }}
            perPage={25}
            disableSyncWithLocation
            storeKey={false}
            empty={<NoteCreate reference="patients" />}
          >
            <NotesIterator reference="patients" />
          </InfiniteListBase>
        </Card>
        <Card title={translate("crm.calls.title")}>
          <PatientCalls patientId={patient.id} />
        </Card>
      </div>
      <PatientAside />
    </div>
  );
};

/** The «yes» answers of the questionnaire, the contraindications */
const MedicalAlerts = ({ patient }: { patient: Patient }) => {
  const translate = useTranslate();
  const rights = useMedicalRights();
  const { questionnaire } = useQuestionnaire(patient.id, rights.canSee);
  if (!rights.canSee) return null;
  const alerts = questionnaireAlerts(questionnaire?.answers);
  const contraindications = patient.contraindications?.trim();
  if (!alerts.length && !contraindications) return null;
  return (
    <section
      className="flex flex-wrap items-center gap-2 rounded-[28px] bg-card px-6 py-4"
      aria-label={translate("patient_card.overview.alerts")}
      data-testid="medical-alerts"
    >
      <span className="mr-1 text-sm text-muted-foreground">
        {translate("patient_card.overview.alerts")}
      </span>
      {alerts.map((question) => (
        <span
          key={question}
          className="rounded-full bg-neon px-3 py-1 text-xs text-neon-ink"
          title={questionnaire?.answers[question]?.comment ?? undefined}
        >
          {translate(`patient_card.questionnaire.questions.${question}`)}
          {questionnaire?.answers[question]?.comment
            ? `: ${questionnaire.answers[question]!.comment}`
            : ""}
        </span>
      ))}
      {contraindications ? (
        <span className="rounded-full bg-pill px-3 py-1 text-xs">
          {translate("treatment.patient.contraindications")}:{" "}
          {contraindications}
        </span>
      ) : null}
    </section>
  );
};

const PatientDeals = ({ deals }: { deals: Deal[] }) => {
  const translate = useTranslate();
  const { currency } = useConfigurationContext();
  const { data: stages } = useStages();
  const { data: services } = useServices();
  if (!deals.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {translate("crm.patients.no_requests")}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {deals.map((deal) => {
        const stage = findById(stages, deal.stage_id as Identifier);
        return (
          <li key={deal.id}>
            <Link
              to={`/deals/${deal.id}/show`}
              className="flex items-center gap-4 rounded-2xl bg-background px-4 py-3 no-underline transition-colors hover:bg-pill-hover"
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: accent(stage?.color) }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-foreground">
                  {deal.name ||
                    findById(services, deal.service_id as Identifier)?.name ||
                    translate("crm.deals.untitled")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {stage?.name} ·{" "}
                  {new Date(deal.created_at).toLocaleDateString("ru-RU")}
                </span>
              </span>
              <span className="text-right text-sm tabular-nums">
                <span className="block text-foreground">
                  {formatMoney(deal.plan_amount, currency)}
                </span>
                {deal.paid_amount ? (
                  <span className="text-xs text-muted-foreground">
                    {translate("crm.patients.paid", {
                      amount: formatMoney(deal.paid_amount, currency),
                    })}
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
};

const Card = ({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) => (
  <section className="rounded-[28px] bg-card p-6">
    <div className="mb-4 flex items-center justify-between gap-2">
      <h2 className="text-[22px] leading-tight font-normal tracking-[-0.02em]">
        {title}
      </h2>
      {action}
    </div>
    {children}
  </section>
);

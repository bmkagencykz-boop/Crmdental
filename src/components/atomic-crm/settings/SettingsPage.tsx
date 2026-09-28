import { History } from "lucide-react";
import { CanAccess, useCanAccess, useTranslate } from "ra-core";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useSearchParams } from "react-router";
import { ClinicStep } from "../onboarding/ClinicStep";
import type { NextHandler } from "../onboarding/stepTypes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  useLeadSources,
  useLostReasons,
} from "../dictionaries/useDictionaries";
import { ImportWizard } from "../import/ImportWizard";
import { AccessSettings } from "./AccessSettings";
import { AutomessagesSettings } from "./AutomessagesSettings";
import { DictionaryEditor } from "./DictionaryEditor";
import { DoctorsEditor } from "./DoctorsEditor";
import { CustomFieldsEditor } from "../custom-fields/CustomFieldsEditor";
import { DistributionSettings } from "./DistributionSettings";
import { MessengerSettings } from "./MessengerSettings";
import { LeadSettings } from "../leads/LeadSettings";
import { MisSettings } from "./MisSettings";
import { TelephonySettings } from "../telephony/TelephonySettings";
import { TaskRulesEditor } from "./TaskRulesEditor";
import { PipelinesEditor } from "./PipelinesEditor";
import { QuickRepliesEditor } from "../quick-replies/QuickRepliesEditor";
import { ResponseControlSettings } from "../notifications/ResponseControlSettings";
import { RecallRulesSettings } from "../mailings/RecallRulesSettings";
import { UnsortedSettings } from "../unsorted/UnsortedSettings";
import { DuplicatesSettings } from "../duplicates/DuplicatesSettings";
import { DigitalPipelineSettings } from "../pipeline-automation/DigitalPipelineSettings";
import { ApiSettings } from "../pipeline-automation/ApiSettings";
import { SalesbotSettings } from "../salesbot/SalesbotSettings";
import { PriceListEditor } from "../treatment/PriceListEditor";

const SECTIONS = [
  "pipelines",
  "pipeline_automation",
  "salesbots",
  "services",
  "sources",
  "lost_reasons",
  "doctors",
  "custom_fields",
  "messengers",
  "leads",
  "telephony",
  "distribution",
  "unsorted",
  "response",
  "automations",
  "automessages",
  "quick_replies",
  "recalls",
  "api",
  "access",
  "clinic",
  "duplicates",
  "import",
  "mis",
] as const;
type Section = (typeof SECTIONS)[number];

/** Sections grouped like amoCRM's settings menu */
const GROUPS: { id: string; sections: Section[] }[] = [
  {
    id: "sales",
    sections: [
      "pipelines",
      "pipeline_automation",
      "salesbots",
      "automations",
      "automessages",
      "distribution",
      "unsorted",
      "response",
    ],
  },
  {
    id: "channels",
    sections: ["messengers", "leads", "telephony", "quick_replies"],
  },
  {
    id: "data",
    sections: [
      "services",
      "sources",
      "lost_reasons",
      "doctors",
      "custom_fields",
    ],
  },
  { id: "patients", sections: ["recalls", "duplicates", "import"] },
  { id: "clinic", sections: ["clinic", "access", "api", "mis"] },
];
// Every employee manages their own quick replies; the rest is for the owner
// and the head (the database enforces the same rules)
const EVERYONE_SECTIONS: Section[] = ["quick_replies"];
const isSection = (value: string | null): value is Section =>
  SECTIONS.includes(value as Section);

/** Some sections keep their texts in their own namespaces */
const sectionLabel = (section: Section, kind: "title" | "hint") =>
  section === "services"
    ? `treatment.price_list.${kind === "title" ? "section" : "hint"}`
    : section === "salesbots"
      ? `salesbot.${kind === "title" ? "section" : "hint"}`
      : section === "custom_fields"
        ? `custom_fields.settings.${kind === "title" ? "section" : "hint"}`
        : section === "pipeline_automation" || section === "api"
          ? `${section}.settings.${kind === "title" ? "section" : "hint"}`
          : section === "quick_replies"
            ? `quick_replies.${kind}`
            : section === "automessages" ||
                section === "recalls" ||
                section === "doctors" ||
                section === "unsorted" ||
                section === "duplicates"
              ? `${section}.settings.${kind === "title" ? "section" : "hint"}`
              : section === "leads"
                ? `leads.${kind === "title" ? "section" : "hint"}`
                : section === "import" || section === "mis"
                  ? `${section}.${kind}`
                  : section === "telephony"
                    ? `telephony.${kind === "title" ? "section" : "hint"}`
                    : section === "response"
                      ? `notifications.settings.${kind === "title" ? "section" : "hint"}`
                      : `crm.settings.${kind === "title" ? "sections" : "hints"}.${section}`;

/**
 * Clinic settings (spec §4.7): pipelines and stages, dictionaries, access
 * rules and branding. Everything is stored in tables, not in code.
 * Managers only see their quick replies. ?section=<id> opens a section.
 */
export const SettingsPage = () => {
  const translate = useTranslate();
  const [searchParams] = useSearchParams();
  const requested = searchParams.get("section");
  const { canAccess: isAdmin, isPending } = useCanAccess({
    resource: "configuration",
    action: "edit",
  });
  // The integrator (stage 25) configures, but neither imports data, merges
  // patients nor edits the clinic profile
  const { canAccess: canImport } = useCanAccess({
    resource: "import",
    action: "create",
  });
  const { canAccess: canMerge } = useCanAccess({
    resource: "duplicates",
    action: "merge",
  });
  const { canAccess: canEditClinic } = useCanAccess({
    resource: "organization",
    action: "edit",
  });
  const hidden: Section[] = [
    ...(canImport ? [] : (["import"] as const)),
    ...(canMerge ? [] : (["duplicates"] as const)),
    ...(canEditClinic ? [] : (["clinic"] as const)),
  ];
  const sections = isAdmin
    ? SECTIONS.filter((id) => !hidden.includes(id))
    : EVERYONE_SECTIONS;
  const [chosen, setSection] = useState<Section>(
    isSection(requested) ? requested : "pipelines",
  );
  useEffect(() => {
    if (isSection(requested)) setSection(requested);
  }, [requested]);
  const section = sections.includes(chosen) ? chosen : sections[0];
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = (id: Section) =>
    !needle ||
    translate(sectionLabel(id, "title")).toLowerCase().includes(needle) ||
    translate(sectionLabel(id, "hint")).toLowerCase().includes(needle);
  const groups = GROUPS.map((group) => ({
    ...group,
    sections: group.sections.filter(
      (id) => sections.includes(id) && matches(id),
    ),
  })).filter((group) => group.sections.length > 0);
  const { data: sources } = useLeadSources();
  const { data: lostReasons } = useLostReasons();
  if (isPending) return null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <nav
        className="flex flex-col gap-1"
        aria-label={translate("crm.settings.title")}
      >
        {sections.length > 4 ? (
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={translate("crm.settings.search")}
            aria-label={translate("crm.settings.search")}
            className="field mb-2 h-9 w-full rounded-md border border-input px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        ) : null}
        {groups.map((group) => (
          <div
            key={group.id}
            role="group"
            aria-labelledby={`settings-group-${group.id}`}
            className="flex flex-row flex-wrap gap-0.5 lg:mb-3 lg:flex-col"
          >
            {sections.length > 4 ? (
              <p
                id={`settings-group-${group.id}`}
                className="hidden px-4 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground lg:block"
              >
                {translate(`crm.settings.groups.${group.id}`)}
              </p>
            ) : null}
            {group.sections.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                aria-current={section === id ? "page" : undefined}
                className={cn(
                  "rounded-md px-4 py-1.5 text-left text-sm font-medium transition-all",
                  section === id
                    ? "bg-primary font-semibold text-primary-foreground shadow-soft"
                    : "text-foreground/80 hover:bg-[var(--surface-strong)] hover:text-foreground",
                )}
              >
                {translate(sectionLabel(id, "title"))}
              </button>
            ))}
          </div>
        ))}
        {groups.length === 0 ? (
          <p className="px-4 text-sm text-muted-foreground">
            {translate("crm.settings.search_empty")}
          </p>
        ) : null}
        <CanAccess resource="integrations" action="list">
          <Link
            to="/integrations"
            className="flex items-center gap-2 rounded-md px-4 py-2 text-left text-sm font-semibold text-muted-foreground no-underline transition-all hover:bg-[var(--surface-strong)] hover:text-foreground lg:mt-2 lg:border-t lg:pt-3"
          >
            {translate("market.settings_link")}
          </Link>
        </CanAccess>
        <CanAccess resource="audit_log" action="list">
          <Link
            to="/audit"
            title={translate("audit.open_hint")}
            className="flex items-center gap-2 rounded-md px-4 py-2 text-left text-sm font-semibold text-muted-foreground no-underline transition-all hover:bg-[var(--surface-strong)] hover:text-foreground lg:mt-2 lg:border-t lg:pt-3"
          >
            <History className="size-4" />
            {translate("audit.open")}
          </Link>
        </CanAccess>
      </nav>
      <Panel
        title={translate(sectionLabel(section, "title"))}
        hint={translate(sectionLabel(section, "hint"))}
      >
        {section === "pipelines" ? <PipelinesEditor /> : null}
        {section === "pipeline_automation" ? <DigitalPipelineSettings /> : null}
        {section === "salesbots" ? <SalesbotSettings /> : null}
        {/* «Прайс» (stage 29): the services with code, category and price */}
        {section === "services" ? <PriceListEditor /> : null}
        {section === "sources" ? (
          <DictionaryEditor resource="lead_sources" items={sources} />
        ) : null}
        {section === "lost_reasons" ? (
          <DictionaryEditor resource="lost_reasons" items={lostReasons} />
        ) : null}
        {section === "doctors" ? <DoctorsEditor /> : null}
        {section === "custom_fields" ? <CustomFieldsEditor /> : null}
        {section === "messengers" ? <MessengerSettings /> : null}
        {section === "leads" ? <LeadSettings /> : null}
        {section === "telephony" ? <TelephonySettings /> : null}
        {section === "distribution" ? <DistributionSettings /> : null}
        {section === "unsorted" ? <UnsortedSettings /> : null}
        {section === "duplicates" ? <DuplicatesSettings /> : null}
        {section === "response" ? <ResponseControlSettings /> : null}
        {section === "automations" ? <TaskRulesEditor /> : null}
        {section === "automessages" ? <AutomessagesSettings /> : null}
        {section === "quick_replies" ? <QuickRepliesEditor /> : null}
        {section === "recalls" ? <RecallRulesSettings /> : null}
        {section === "api" ? <ApiSettings /> : null}
        {section === "access" ? <AccessSettings /> : null}
        {section === "clinic" ? <ClinicSettings /> : null}
        {section === "import" ? <ImportWizard /> : null}
        {section === "mis" ? <MisSettings /> : null}
      </Panel>
    </div>
  );
};

SettingsPage.path = "/settings";

const Panel = ({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) => (
  <section className="glass flex flex-col gap-6 rounded-lg p-7">
    <div>
      <h2 className="text-xl font-bold tracking-[-0.02em]">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
    </div>
    {children}
  </section>
);

/**
 * Clinic profile: name, city, time zone, phone and address — the same form
 * as the «Клиника» step of the setup wizard (public.save_clinic_profile).
 */
const ClinicSettings = () => {
  const translate = useTranslate();
  const save = useRef<NextHandler | null>(null);
  const [saving, setSaving] = useState(false);
  const register = useCallback((handler: NextHandler | null) => {
    save.current = handler;
  }, []);
  return (
    <div className="flex flex-col gap-4">
      <ClinicStep registerNext={register} />
      <Button
        className="w-fit"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          await save.current?.();
          setSaving(false);
        }}
      >
        {translate("ra.action.save")}
      </Button>
    </div>
  );
};

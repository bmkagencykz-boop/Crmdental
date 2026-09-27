import { History } from "lucide-react";
import { CanAccess, useCanAccess, useTranslate } from "ra-core";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  useLeadSources,
  useLostReasons,
  useServices,
} from "../dictionaries/useDictionaries";
import {
  useConfigurationContext,
  useConfigurationUpdater,
} from "../root/ConfigurationContext";
import { useDataProvider, useNotify } from "ra-core";
import type { CrmDataProvider } from "../providers/types";
import { AccessSettings } from "./AccessSettings";
import { AutomessagesSettings } from "./AutomessagesSettings";
import { DictionaryEditor } from "./DictionaryEditor";
import { DistributionSettings } from "./DistributionSettings";
import { MessengerSettings } from "./MessengerSettings";
import { LeadSettings } from "../leads/LeadSettings";
import { TaskRulesEditor } from "./TaskRulesEditor";
import { PipelinesEditor } from "./PipelinesEditor";
import { QuickRepliesEditor } from "../quick-replies/QuickRepliesEditor";

const SECTIONS = [
  "pipelines",
  "services",
  "sources",
  "lost_reasons",
  "messengers",
  "leads",
  "distribution",
  "automations",
  "automessages",
  "quick_replies",
  "access",
  "clinic",
] as const;
type Section = (typeof SECTIONS)[number];
// Every employee manages their own quick replies; the rest is for the owner
// and the head (the database enforces the same rules)
const EVERYONE_SECTIONS: Section[] = ["quick_replies"];
const isSection = (value: string | null): value is Section =>
  SECTIONS.includes(value as Section);

/** Some sections keep their texts in their own namespaces */
const sectionLabel = (section: Section, kind: "title" | "hint") =>
  section === "quick_replies"
    ? `quick_replies.${kind}`
    : section === "automessages"
      ? `automessages.settings.${kind === "title" ? "section" : "hint"}`
      : section === "leads"
        ? `leads.${kind === "title" ? "section" : "hint"}`
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
  const sections = isAdmin ? SECTIONS : EVERYONE_SECTIONS;
  const [chosen, setSection] = useState<Section>(
    isSection(requested) ? requested : "pipelines",
  );
  useEffect(() => {
    if (isSection(requested)) setSection(requested);
  }, [requested]);
  const section = sections.includes(chosen) ? chosen : sections[0];
  const { data: services } = useServices();
  const { data: sources } = useLeadSources();
  const { data: lostReasons } = useLostReasons();
  if (isPending) return null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[14rem_1fr]">
      <nav
        className="flex flex-row flex-wrap gap-1 lg:flex-col"
        aria-label={translate("crm.settings.title")}
      >
        {sections.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            aria-current={section === id ? "page" : undefined}
            className={cn(
              "rounded-md px-4 py-2 text-left text-sm font-semibold transition-all",
              section === id
                ? "bg-primary text-primary-foreground shadow-soft"
                : "text-muted-foreground hover:bg-[var(--surface-strong)] hover:text-foreground",
            )}
          >
            {translate(sectionLabel(id, "title"))}
          </button>
        ))}
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
        {section === "services" ? (
          <DictionaryEditor resource="services" items={services} />
        ) : null}
        {section === "sources" ? (
          <DictionaryEditor resource="lead_sources" items={sources} />
        ) : null}
        {section === "lost_reasons" ? (
          <DictionaryEditor resource="lost_reasons" items={lostReasons} />
        ) : null}
        {section === "messengers" ? <MessengerSettings /> : null}
        {section === "leads" ? <LeadSettings /> : null}
        {section === "distribution" ? <DistributionSettings /> : null}
        {section === "automations" ? <TaskRulesEditor /> : null}
        {section === "automessages" ? <AutomessagesSettings /> : null}
        {section === "quick_replies" ? <QuickRepliesEditor /> : null}
        {section === "access" ? <AccessSettings /> : null}
        {section === "clinic" ? <ClinicSettings /> : null}
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

/** Name shown in the app (configuration) */
const ClinicSettings = () => {
  const translate = useTranslate();
  const config = useConfigurationContext();
  const updateConfiguration = useConfigurationUpdater();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const [title, setTitle] = useState(config.title);

  const save = async () => {
    try {
      const saved = await dataProvider.updateConfiguration({
        ...config,
        title,
      });
      updateConfiguration({ ...config, ...saved });
      notify("crm.settings.saved", { type: "info" });
    } catch {
      notify("crm.settings.save_error", { type: "error" });
    }
  };

  return (
    <div className="flex max-w-md flex-col gap-3">
      <label className="text-sm font-medium" htmlFor="clinic-title">
        {translate("crm.settings.app_title")}
      </label>
      <Input
        id="clinic-title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Button className="w-fit" onClick={save} disabled={!title.trim()}>
        {translate("ra.action.save")}
      </Button>
    </div>
  );
};

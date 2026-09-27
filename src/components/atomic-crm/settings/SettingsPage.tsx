import { useTranslate } from "ra-core";
import { useState, type ReactNode } from "react";
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
import { DictionaryEditor } from "./DictionaryEditor";
import { DistributionSettings } from "./DistributionSettings";
import { MessengerSettings } from "./MessengerSettings";
import { TelephonySettings } from "../telephony/TelephonySettings";
import { TaskRulesEditor } from "./TaskRulesEditor";
import { PipelinesEditor } from "./PipelinesEditor";

const SECTIONS = [
  "pipelines",
  "services",
  "sources",
  "lost_reasons",
  "messengers",
  "telephony",
  "distribution",
  "automations",
  "access",
  "clinic",
] as const;
type Section = (typeof SECTIONS)[number];

// Telephony keeps its texts in its own namespace
const sectionTitle = (id: Section) =>
  id === "telephony" ? "telephony.section" : `crm.settings.sections.${id}`;
const sectionHint = (id: Section) =>
  id === "telephony" ? "telephony.hint" : `crm.settings.hints.${id}`;

/**
 * Clinic settings (spec §4.7): pipelines and stages, dictionaries, access
 * rules and branding. Everything is stored in tables, not in code.
 */
export const SettingsPage = () => {
  const translate = useTranslate();
  const [section, setSection] = useState<Section>("pipelines");
  const { data: services } = useServices();
  const { data: sources } = useLeadSources();
  const { data: lostReasons } = useLostReasons();

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[14rem_1fr]">
      <nav
        className="flex flex-row flex-wrap gap-1 lg:flex-col"
        aria-label={translate("crm.settings.title")}
      >
        {SECTIONS.map((id) => (
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
            {translate(sectionTitle(id))}
          </button>
        ))}
      </nav>
      <Panel
        title={translate(sectionTitle(section))}
        hint={translate(sectionHint(section))}
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
        {section === "telephony" ? <TelephonySettings /> : null}
        {section === "distribution" ? <DistributionSettings /> : null}
        {section === "automations" ? <TaskRulesEditor /> : null}
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
